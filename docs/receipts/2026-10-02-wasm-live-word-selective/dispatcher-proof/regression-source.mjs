/**
 * SPDX-License-Identifier: MIT
 * No compiler, downloads, debugger writes, breakpoints, or single-step mode.
 * Run after installing normal bw-board dependencies:
 * LABWIRED_WASM=/absolute/path/to/nodejs LABWIRED_WORD_REQUIRED=1
 *   node --test test/labwired-word-admission.test.mjs
 *
 * This proves deployed dispatcher semantics, not fast-path hit counts or RTx.
 * Word accesses always reuse identical guest PCs. PA1 input changes advance
 * a guest-owned descriptor pointer; neither host memory/register writes nor
 * reset may clear the decode cache between phases.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {join, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {binToElf} from '../src/bin-to-elf.js';
import {buildLabwiredSystem} from '../src/labwired-bridge.js';
import {createLabwiredAdapter, plain} from '../src/labwired-adapter.js';

const nodeDir = process.env.LABWIRED_WASM;
const skip = !nodeDir ? 'requires actual LABWIRED_WASM nodejs artifact' : false;
if (skip && process.env.LABWIRED_WORD_REQUIRED === '1') throw Error(skip);
const wasm = skip ? null : createRequire(import.meta.url)(join(resolve(nodeDir), 'labwired_wasm.js'));
const FLASH = 0x08000000;
const RAM = 0x20000000;
// Existing real F0 catalog fixture declares 64KB. Assert that contract below.
const RAM_END = RAM + 64 * 1024;
const RECEIPT = RAM + 0x200;
const GPIO_MODER = 0x48000000;
const GPIO_IDR = GPIO_MODER + 0x10;
const GPIO_ODR = GPIO_MODER + 0x14;
const phases = [
    {address: RAM, value: 0xa5a55a5a},
    {address: GPIO_ODR, value: 1},
    {address: RAM + 0x100, value: 0x55aa1234},
    {address: RAM + 0x109, value: 0x78563412}, // intentionally unaligned
    {address: RAM_END - 4, value: 0x89abcdef}, // last fully backed word
];

// Minimal label/fixup writer, not a substitute ISA implementation. All guest
// instruction encodings are documented here; tests observe the real engine.
function guestImage() {
    const bytes = new Uint8Array(0x200);
    const view = new DataView(bytes.buffer);
    const labels = new Map(), fixups = [], literals = [];
    let at = 0x40; // room for vector table; no interrupt handlers enabled
    view.setUint32(0, RAM + 0x8000, true);
    view.setUint32(4, FLASH + at + 1, true);
    function label(name) { assert.ok(!labels.has(name)); labels.set(name, at); }
    function emit(op) { view.setUint16(at, op, true); at += 2; }
    function literal(rd, value) {
        literals.push({at, rd, value});
        emit(0); // LDR literal, fixed after code layout
    }
    function branch(name, conditional = false) {
        fixups.push({at, name, conditional});
        emit(0);
    }
    const load = (rt, rn, wordOffset = 0) => emit(0x6800 | (wordOffset << 6) | (rn << 3) | rt);
    const store = (rt, rn, wordOffset = 0) => emit(0x6000 | (wordOffset << 6) | (rn << 3) | rt);
    const movImmediate = (rd, value) => emit(0x2000 | (rd << 8) | value);
    const addImmediate = (rd, value) => emit(0x3000 | (rd << 8) | value);

    label('reset');
    literal(4, RECEIPT);
    literal(5, GPIO_IDR);
    literal(6, null); // descriptor table address, fixed below
    movImmediate(7, 0); // previous PA1 input, initially low
    movImmediate(0, 0);
    store(0, 4, 0); // most recent target readback
    store(0, 4, 1); // completed loop count
    store(0, 4, 2); // descriptor phase index
    literal(1, 0x40021014); // RCC_AHBENR
    literal(0, 0x00020000); // GPIOA enable
    store(0, 1);
    literal(1, GPIO_MODER);
    movImmediate(0, 1); // PA0 output; PA1 input
    store(0, 1);

    label('loop');
    load(1, 6); // current target address, owned/mutated by guest
    load(0, 6, 1); // current value
    label('targetStore');
    store(0, 1); // STR r0,[r1,#0]: EXACT SAME PC in all phases
    label('targetLoad');
    load(2, 1); // LDR r2,[r1,#0]: EXACT SAME PC in all phases
    store(2, 4);
    load(3, 4, 1);
    addImmediate(3, 1);
    store(3, 4, 1);
    load(2, 5); // live GPIO IDR, not a synthetic input receipt
    movImmediate(3, 2);
    emit(0x401a); // ANDS r2,r3: isolate PA1
    emit(0x42ba); // CMP r2,r7
    branch('loop', true); // BEQ loop while input unchanged
    emit(0x4617); // MOV r7,r2: consume input edge once
    addImmediate(6, 8); // next address/value pair
    load(3, 4, 2);
    addImmediate(3, 1);
    store(3, 4, 2);
    branch('loop');

    at = (at + 3) & ~3;
    for (const item of literals) {
        const address = at;
        const pcAligned = (item.at + 4) & ~3;
        const delta = address - pcAligned;
        assert.ok(delta >= 0 && delta % 4 === 0 && delta / 4 <= 255);
        view.setUint16(item.at, 0x4800 | (item.rd << 8) | (delta / 4), true);
        item.poolAt = address;
        view.setUint32(at, item.value ?? 0, true);
        at += 4;
    }
    const tableAt = at;
    for (const row of phases) {
        view.setUint32(at, row.address, true);
        view.setUint32(at + 4, row.value, true);
        at += 8;
    }
    for (const item of literals) {
        if (item.value === null) view.setUint32(item.poolAt, FLASH + tableAt, true);
    }
    for (const item of fixups) {
        const delta = labels.get(item.name) - (item.at + 4);
        const bits = item.conditional ? 8 : 11;
        assert.ok(delta % 2 === 0 && delta / 2 >= -(2 ** (bits - 1)) && delta / 2 < 2 ** (bits - 1));
        view.setUint16(item.at, (item.conditional ? 0xd000 : 0xe000) | ((delta / 2) & ((1 << bits) - 1)), true);
    }
    assert.ok(at <= bytes.length);
    return {image: bytes.slice(0, at),
        storePc: FLASH + labels.get('targetStore'), loadPc: FLASH + labels.get('targetLoad')};
}

function u32(sim, address) {
    const bytes = Uint8Array.from(sim.read_memory(address, 4));
    assert.equal(bytes.length, 4);
    return new DataView(bytes.buffer).getUint32(0, true);
}
function advance(sim, total, budget) {
    let remaining = total;
    while (remaining > 0) {
        const asked = Math.min(remaining, budget);
        const ran = sim.step_batch(asked);
        assert.ok(Number.isInteger(ran) && ran > 0 && ran <= asked,
            `bounded actual progress: asked=${asked}, returned=${ran}`);
        remaining -= ran;
    }
}

for (const budget of [1, 7, 8, 16, 31, 64, 257]) {
    test(`actual WASM same-PC word RAM/MMIO/RAM, alignment and bounds; budget=${budget}`, {skip}, () => {
        const built = buildLabwiredSystem({chipKind: 'stm32f030',
            netlist: {parts: [{id: 'f0', kind: 'stm32f030'}], nets: []}});
        assert.equal(built.ok, true);
        assert.deepEqual(built.refusals, []);
        assert.match(built.chipYaml, /ram:\s*\n\s*base:\s*536870912\s*\n\s*size:\s*64KB/);
        const guest = guestImage();
        const adapter = createLabwiredAdapter({wasm, chipYaml: built.chipYaml,
            systemYaml: built.systemYaml, firmware: binToElf(guest.image),
            firmwareOnly: true, clockHz: 48_000_000});
        const sim = adapter.sim;
        try {
            for (const method of ['step_batch', 'read_memory', 'get_peripheral_snapshot',
                'set_board_io_input', 'recommended_tick_interval', 'set_peripheral_tick_interval']) {
                assert.equal(typeof sim[method], 'function', `missing actual ${method}`);
            }
            // The adapter already applies this engine-declared safe interval;
            // do not override it to force admission or bypass scheduler guards.
            const safeInterval = sim.recommended_tick_interval();
            assert.ok(Number.isInteger(safeInterval) && safeInterval >= 8,
                `fixture must permit production fast-path admission; safe interval=${safeInterval}`);
            sim.set_board_io_input('PA1', false);
            let previousCount = 0;
            for (let phase = 0; phase < phases.length; phase++) {
                if (phase > 0) sim.set_board_io_input('PA1', (phase & 1) === 1);
                advance(sim, 4096, budget); // many visits to the SAME cached PCs
                assert.equal(u32(sim, RECEIPT + 8), phase, 'one descriptor change per input transition');
                const count = u32(sim, RECEIPT + 4);
                assert.ok(count > previousCount, 'guest target accesses remain active');
                previousCount = count;
                const expected = phases[phase];
                assert.equal(u32(sim, RECEIPT), expected.value, 'guest word load readback');
                if (expected.address !== GPIO_ODR) {
                    assert.equal(u32(sim, expected.address), expected.value, 'actual target SRAM bytes');
                }
                const gpio = plain(sim.get_peripheral_snapshot('gpioPortA'));
                assert.equal(gpio.moder & 3, 1, 'PA0 is output in actual GPIO model');
                assert.equal(gpio.idr & 2, (phase & 1) === 1 ? 2 : 0, 'held actual PA1 input');
                assert.equal(gpio.odr & 1, phase === 0 ? 0 : 1,
                    'same guest store PC reached MMIO; later RAM writes did not rewrite GPIO');
            }
            // Unaligned word spans exactly four bytes, with untouched neighbors.
            assert.deepEqual([...sim.read_memory(RAM + 0x108, 6)], [0, 0x12, 0x34, 0x56, 0x78, 0]);
            assert.deepEqual([...sim.read_memory(RAM_END - 4, 4)], [0xef, 0xcd, 0xab, 0x89]);
            console.log('WASM_WORD_DISPATCH_PROOF ' + JSON.stringify({budget,
                imageSha256: createHash('sha256').update(guest.image).digest('hex'),
                storePc: guest.storePc, loadPc: guest.loadPc, safeInterval,
                phases: phases.length, loops: previousCount}));
        } finally { sim.free(); }
    });
}
