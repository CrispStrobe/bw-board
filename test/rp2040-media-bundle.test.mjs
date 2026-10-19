// runRp2040Bundle — the GPL-Lab's brickwright-media.json contract made
// executable for a 32-bit RP2040 (Cortex-M0+) target: manifest + fetched UF2 →
// a booted pico-sdk firmware talking a UART0 console, no app-side machine
// knowledge. Mirrors runI8086FloppyBundle's split from the pinned
// runMediaBundle (see machine-media-rp2040.js).
//
// The parseUF2 flattener is checked on a synthetic block (no emulator). The
// runner's mechanics are checked on a bad bundle (fails by name before booting).
// The full-fat acceptance boots the REAL PicoBB UF2 when PICOBB_UF2 points at
// it — the firmware is a built Zlib artifact that lives in brickwright-media-lab,
// never vendored here, so CI without it skips that leg HONESTLY.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseUF2, FLASH_BASE } from '../src/uf2.js';
import { runRp2040Bundle } from '../src/machine-media-rp2040.js';

/** Build one well-formed 512-byte UF2 block at `addr` carrying `payload`. */
function uf2Block(addr, payload) {
    const b = new Uint8Array(512);
    const v = new DataView(b.buffer);
    v.setUint32(0, 0x0a324655, true);   // magic start 0
    v.setUint32(4, 0x9e5d5157, true);   // magic start 1
    v.setUint32(12, addr, true);        // target address
    v.setUint32(16, payload.length, true); // payload size
    b.set(payload, 32);
    return b;
}

test('parseUF2 flattens blocks to a contiguous image based at the first block address', () => {
    const blk0 = uf2Block(FLASH_BASE, Uint8Array.from([1, 2, 3, 4]));
    const blk1 = uf2Block(FLASH_BASE + 476, Uint8Array.from([9, 8]));
    const uf2 = new Uint8Array(1024);
    uf2.set(blk0, 0); uf2.set(blk1, 512);
    const { blocks, base, image } = parseUF2(uf2);
    assert.equal(blocks, 2);
    assert.equal(base, FLASH_BASE);
    assert.deepEqual([...image.slice(0, 4)], [1, 2, 3, 4]);
    assert.deepEqual([...image.slice(476, 478)], [9, 8]);
});

test('parseUF2 rejects a non-UF2 / truncated block by its magic', () => {
    assert.throws(() => parseUF2(new Uint8Array(512)), /bad magic/);
    assert.throws(() => parseUF2(new Uint8Array(10)), /no complete .* UF2 blocks/);
    assert.throws(() => parseUF2([1, 2, 3]), /expected a Uint8Array/);
});

// The PicoBB bundle's manifest, as the lab ships it (our authored contract; the
// Zlib firmware it points at stays in brickwright-media-lab).
const PICOBB_MANIFEST = {
    machine: 'rp2040js',
    program: { kind: 'uf2', console: 'uart0', startKey: '\r', bootMs: 400 },
    slots: { flash: 'bbcbasic_console_pico.uf2' },
    expect: ['BBC BASIC for Pico Console v0.50', 'UART Console', '(C) Copyright R. T. Russell, 2025', '>'],
    programs: [
        { title: 'arithmetic one-liner', input: 'PRINT 2+2\r', expect: ['PRINT 2+2', '         4'] },
    ],
};

test('mechanics: a bad bundle fails by name before the emulator spins up', () => {
    assert.throws(() => runRp2040Bundle({ ...PICOBB_MANIFEST, machine: 'i8086' }, {}),
        /machine is 'i8086', expected 'rp2040js'/);
    assert.throws(() => runRp2040Bundle({ ...PICOBB_MANIFEST, slots: {} }, {}),
        /no slots\.flash/);
    assert.throws(() => runRp2040Bundle(PICOBB_MANIFEST, {}),
        /file not provided: bbcbasic_console_pico\.uf2/);
});

const picoUf2 = process.env.PICOBB_UF2;
const havePico = picoUf2 && existsSync(picoUf2);

test('the PicoBB bundle boots and runs its REPL programs end to end',
    { skip: havePico ? false : 'PICOBB_UF2 unset (built Zlib firmware, never vendored)' }, () => {
        const files = { 'bbcbasic_console_pico.uf2': new Uint8Array(readFileSync(picoUf2)) };
        const r = runRp2040Bundle(PICOBB_MANIFEST, files);
        for (const e of r.expect) assert.ok(e.ok, `boot expect missing: ${JSON.stringify(e.text)}`);
        for (const p of r.programs) {
            for (const e of p.expect) assert.ok(e.ok, `[${p.title}] expect missing: ${JSON.stringify(e.text)}`);
        }
        assert.ok(r.ok, 'all expectations met');
    });
