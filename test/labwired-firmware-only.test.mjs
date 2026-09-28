/**
 * Firmware-only labwired targets: a user's own ELF on a catalog chip, with no
 * circuit. Two halves:
 *
 *  - WITHOUT the engine (always runs): the catalog is the pinned engine's own
 *    chip set, the factory builds a firmware-only adapter from a catalog entry,
 *    a raw .bin is refused rather than loaded at a guessed address, and the
 *    Thumb bit is masked on ARM only.
 *  - WITH the engine (LABWIRED_WASM, run by .github/workflows/labwired-wasm.yml):
 *    real ELFs on chips with different memory maps actually boot and run, and
 *    a breakpoint on the loop stops there.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

import { LABWIRED_CATALOG, LABWIRED_CATALOG_PIN } from '../src/labwired-catalog.js';
import { CATALOG_CHIPS, buildScriptPin } from '../scripts/gen-labwired-catalog.mjs';
import { createDebugTarget } from '../src/debug-target-factory.js';
import { createLabwiredAdapter, chipArch } from '../src/labwired-adapter.js';
import { createLabwiredDebugTarget } from '../src/labwired-debug.js';
import { parseUf2, uf2ToElf, UF2_FAMILY_RP2040 } from '../src/uf2-to-elf.js';
import { buildBootrom } from '../src/rp2040-bootrom.js';

/** A WasmSimulator stand-in that records its construction. */
function stubWasm(pcSeq = [0x100]) {
    const built = [];
    let i = 0;
    const sim = {
        get_pc: () => pcSeq[Math.min(i, pcSeq.length - 1)],
        step_single: () => { i++; },
        step_batch: () => {},
        read_logic_edges: () => ({ cursor: 0, dropped: 0, nowCycle: i, edges: [] }),
        watch_logic_signals: () => [],
        get_register_names: () => [],
    };
    return {
        built,
        wasm: { WasmSimulator: { new_from_config: (sys, chip, fw, blobs) => { built.push({ sys, chip, fw, blobs }); return sim; } } },
    };
}

/** Smallest ELF32 header the adapter's isElf() accepts (magic + class). */
const ELF_MAGIC = Uint8Array.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0, ...new Array(44).fill(0)]);

describe('labwired catalog', () => {
    it('is generated at the wasm build PIN — regenerate after a PIN bump', () => {
        assert.equal(LABWIRED_CATALOG_PIN, buildScriptPin(),
            'run: node scripts/gen-labwired-catalog.mjs --labwired <labwired-core checkout>');
    });
    it('holds exactly the generator\'s chips, each with the arch and clock its own YAML declares', () => {
        assert.deepEqual(Object.keys(LABWIRED_CATALOG), CATALOG_CHIPS);
        for (const e of Object.values(LABWIRED_CATALOG)) {
            assert.equal(chipArch(e.chipYaml), e.arch, e.name);
            assert.match(e.chipYaml, new RegExp(`^cpu_hz:\\s*${e.clockHz.toLocaleString('en').replace(/,/g, '_?')}\\s*$`, 'm'), e.name);
        }
    });
});

describe('firmware-only construction (no engine)', () => {
    it('the factory builds from a catalog chip with no board, and no board_io', async () => {
        const { wasm, built } = stubWasm();
        const chip = LABWIRED_CATALOG.nrf52840;
        const { target, adapter, refusals } = await createDebugTarget('labwired', { wasm, chip, firmware: ELF_MAGIC });
        assert.equal(built.length, 1);
        assert.equal(built[0].chip, chip.chipYaml, 'the engine gets the catalog chip text verbatim');
        assert.match(built[0].sys, /^board_io: \[\]$/m);
        assert.equal(adapter.firmwareOnly, true);
        assert.equal(adapter.arch, 'arm');
        assert.equal(adapter.clockHz, chip.clockHz);
        assert.deepEqual(refusals, []);
        assert.equal(typeof target.runFor, 'function');
    });
    it('a raw .bin is refused by name instead of loaded at a guessed address', () => {
        const { wasm, built } = stubWasm();
        assert.throws(() => createLabwiredAdapter({
            wasm, chipYaml: LABWIRED_CATALOG.rp2040.chipYaml, firmware: Uint8Array.of(0, 0x20, 0, 0, 1, 1, 0, 0x10),
            firmwareOnly: true,
        }), /needs an ELF or UF2 image/);
        assert.equal(built.length, 0, 'nothing was constructed');
    });
    it('the bench path still requires a header map', () => {
        const { wasm } = stubWasm();
        assert.throws(() => createLabwiredAdapter({ wasm, chipYaml: 'arch: arm', firmware: ELF_MAGIC }),
            /opts.pins is required/);
    });
});

/** A UF2 of `blocks` = [{addr, data, flags?}], family RP2040. */
function makeUf2(blocks, family = UF2_FAMILY_RP2040) {
    const out = new Uint8Array(512 * blocks.length);
    const dv = new DataView(out.buffer);
    blocks.forEach((b, i) => {
        const o = i * 512;
        dv.setUint32(o, 0x0A324655, true); dv.setUint32(o + 4, 0x9E5D5157, true);
        dv.setUint32(o + 8, (b.flags ?? 0) | 0x2000, true);
        dv.setUint32(o + 12, b.addr, true); dv.setUint32(o + 16, b.data.length, true);
        dv.setUint32(o + 20, i, true); dv.setUint32(o + 24, blocks.length, true);
        dv.setUint32(o + 28, family, true);
        out.set(b.data, o + 32);
        dv.setUint32(o + 508, 0x0AB16F30, true);
    });
    return out;
}
const fill = (n, v) => new Uint8Array(n).fill(v);

describe('UF2 → ELF', () => {
    it('merges contiguous blocks, keeps a gap as a second segment, skips non-flash blocks', () => {
        const vt = new Uint8Array(256); new DataView(vt.buffer).setUint32(4, 0x10000201, true);
        const uf2 = makeUf2([
            { addr: 0x10000000, data: fill(256, 0xB2) },          // stage 2
            { addr: 0x10000100, data: vt },                      // vector table
            { addr: 0x10002000, data: fill(16, 0xC3) },          // after a gap
            { addr: 0x0, data: fill(8, 0xEE), flags: 1 },        // NOT_MAIN_FLASH: metadata
        ]);
        const { familyId, segments } = parseUf2(uf2);
        assert.equal(familyId, UF2_FAMILY_RP2040);
        assert.deepEqual(segments.map(s => [s.addr, s.data.length]), [[0x10000000, 512], [0x10002000, 16]]);
        const { elf } = uf2ToElf(uf2);
        const dv = new DataView(elf.buffer);
        assert.equal(dv.getUint16(18, true), 40, 'EM_ARM');
        assert.equal(dv.getUint32(24, true), 0x10000201, 'entry is the reset vector AFTER boot2');
        assert.equal(dv.getUint16(44, true), 2, 'one PT_LOAD per segment');
        assert.equal(dv.getUint32(52 + 8, true), 0x10000000);
        assert.equal(dv.getUint32(52 + 32 + 8, true), 0x10002000);
    });
    it('refuses a corrupt block by position instead of loading half an image', () => {
        const uf2 = makeUf2([{ addr: 0x10000000, data: fill(256, 1) }, { addr: 0x10000100, data: fill(256, 2) }]);
        new DataView(uf2.buffer).setUint32(512 + 508, 0, true);
        assert.throws(() => parseUf2(uf2), /block at byte 512 has bad magic/);
    });
    it('firmware-only accepts a UF2 (converted), and hands the engine an ELF', () => {
        const { wasm, built } = stubWasm();
        const vt = new Uint8Array(256); new DataView(vt.buffer).setUint32(4, 0x10000201, true);
        createLabwiredAdapter({ wasm, chipYaml: LABWIRED_CATALOG.rp2040.chipYaml, firmwareOnly: true,
            firmware: makeUf2([{ addr: 0x10000000, data: fill(256, 0) }, { addr: 0x10000100, data: vt }]) });
        assert.deepEqual([...built[0].fw.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46]);
    });
});

describe('RP2040 bootrom as a named blob', () => {
    it('firmware-only rp2040 hands the engine this repo\'s clean-room ROM as `bootrom`', async () => {
        const { wasm, built } = stubWasm();
        await createDebugTarget('labwired', { wasm, chip: LABWIRED_CATALOG.rp2040, firmware: ELF_MAGIC });
        assert.deepEqual([...built[0].blobs.bootrom], [...buildBootrom()]);
    });
    it('no other chip gets a blob', async () => {
        for (const name of ['stm32f103', 'nrf52840', 'rp2350', 'esp32c3']) {
            const { wasm, built } = stubWasm();
            await createDebugTarget('labwired', { wasm, chip: LABWIRED_CATALOG[name], firmware: ELF_MAGIC });
            assert.equal(built[0].blobs, undefined, name);
        }
    });
});

describe('Thumb bit is ARM\'s alone', () => {
    const targetOn = (chip, pcSeq) => {
        const { wasm } = stubWasm(pcSeq);
        const adapter = createLabwiredAdapter({ wasm, chipYaml: LABWIRED_CATALOG[chip].chipYaml, firmware: ELF_MAGIC, firmwareOnly: true });
        return createLabwiredDebugTarget({ adapter });
    };
    it('xtensa: an odd PC is reported and breakable as-is', () => {
        const t = targetOn('esp32', [0x40080003]);
        assert.equal(t.regs().pc, 0x40080003);
        assert.equal(typeof t.setBreakpoint({ kind: 'code', addr: 0x40080003 }), 'number');
    });
    it('arm: the Thumb bit is masked and an odd breakpoint refused', () => {
        const t = targetOn('stm32f103', [0x08000101]);
        assert.equal(t.regs().pc, 0x08000100);
        assert.match(t.setBreakpoint({ kind: 'code', addr: 0x08000101 }).unsupported, /Thumb/);
    });
    it('xtensa: a breakpoint on an odd address halts there', () => {
        const t = targetOn('esp32', [0x40080000, 0x40080003, 0x40080006]);
        t.setBreakpoint({ kind: 'code', addr: 0x40080003 });
        t.run();
        assert.equal(t.runFor(1_000_000), 'halted');
        assert.equal(t.regs().pc, 0x40080003);
    });
});

// ─── with the real engine ────────────────────────────────────────────────

const WASM_DIR = process.env.LABWIRED_WASM;
const haveGcc = (() => { try { execFileSync('arm-none-eabi-gcc', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } })();
const skipEngine = !WASM_DIR ? 'set LABWIRED_WASM to the wasm-bindgen NODEJS out-dir' : false;

/** A Cortex-M ELF that spins incrementing r0, linked at `flash`/`ram`. */
function cortexSpinElf(flash, ram) {
    const dir = mkdtempSync(join(tmpdir(), 'lw-fwonly-'));
    writeFileSync(join(dir, 's.S'), [
        '.syntax unified', '.thumb', '.section .vectors,"a"', '.word _estack', '.word reset + 1',
        '.text', '.thumb_func', '.global reset', 'reset:', '  movs r0, #0',
        'loop:', '  adds r0, r0, #1', '  b loop', '',
    ].join('\n'));
    writeFileSync(join(dir, 'l.ld'), [
        `MEMORY { FLASH (rx) : ORIGIN = ${flash}, LENGTH = 64K  RAM (rwx) : ORIGIN = ${ram}, LENGTH = 16K }`,
        '_estack = ORIGIN(RAM) + LENGTH(RAM);',
        'SECTIONS { .vectors : { KEEP(*(.vectors)) } > FLASH  .text : { *(.text*) } > FLASH }', '',
    ].join('\n'));
    const elf = join(dir, 's.elf');
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m4', '-mthumb', '-nostdlib', '-T', join(dir, 'l.ld'),
        join(dir, 's.S'), '-o', elf]);
    const nm = execFileSync('arm-none-eabi-nm', [elf], { encoding: 'utf8' });
    const loop = parseInt(nm.match(/^([0-9a-f]+) t loop$/m)[1], 16);
    return { bytes: new Uint8Array(readFileSync(elf)), loop };
}

/**
 * An RP2040 ELF that finds `popcount32` through the ROM's table pointers
 * (0x14 function table, 0x18 rom_table_lookup) and calls it on 0xF0F0F0F0.
 * r5 == 16 only if a ROM is actually mapped at 0 — without the bootrom blob
 * those halfwords are the flash alias and the call goes nowhere.
 */
function rp2040RomLookupElf() {
    const dir = mkdtempSync(join(tmpdir(), 'lw-rp2040-'));
    writeFileSync(join(dir, 's.S'), [
        '.syntax unified', '.cpu cortex-m0plus', '.thumb',
        '.section .boot2,"a"', '.fill 256, 1, 0',
        '.section .vectors,"a"', '.word _estack', '.word reset + 1',
        '.text', '.thumb_func', '.global reset', 'reset:',
        '  ldr r3, =0x18', '  ldrh r3, [r3]',          /* rom_table_lookup */
        '  ldr r0, =0x14', '  ldrh r0, [r0]',          /* function table */
        '  ldr r1, =0x3350',                           /* \'P3\' popcount32 */
        '  blx r3', '  mov r4, r0',
        '  ldr r0, =0xF0F0F0F0', '  blx r4', '  mov r5, r0',
        'done:', '  b done', '.ltorg', '',
    ].join('\n'));
    writeFileSync(join(dir, 'l.ld'), [
        'MEMORY { FLASH (rx) : ORIGIN = 0x10000000, LENGTH = 64K  RAM (rwx) : ORIGIN = 0x20000000, LENGTH = 16K }',
        '_estack = ORIGIN(RAM) + LENGTH(RAM);',
        'SECTIONS { .boot2 : { KEEP(*(.boot2)) } > FLASH  .vectors : { KEEP(*(.vectors)) } > FLASH  .text : { *(.text*) } > FLASH }', '',
    ].join('\n'));
    const elf = join(dir, 's.elf');
    execFileSync('arm-none-eabi-gcc', ['-mcpu=cortex-m0plus', '-mthumb', '-nostdlib', '-T', join(dir, 'l.ld'),
        join(dir, 's.S'), '-o', elf]);
    const nm = execFileSync('arm-none-eabi-nm', [elf], { encoding: 'utf8' });
    return { bytes: new Uint8Array(readFileSync(elf)), done: parseInt(nm.match(/^([0-9a-f]+) t done$/m)[1], 16) };
}

describe('firmware-only on the real engine', { skip: skipEngine }, () => {
    const require = createRequire(import.meta.url);
    const wasm = WASM_DIR ? require(join(WASM_DIR, 'labwired_wasm.js')) : null;
    // Two memory maps: STM32 flash at 0x0800_0000, nRF flash at 0. A raw-.bin
    // path with one default origin could run at most one of these.
    for (const [chip, flash, ram] of [['stm32f103', '0x08000000', '0x20000000'], ['nrf52840', '0x00000000', '0x20000000']]) {
        it(`${chip}: a user ELF boots, runs, and stops on a breakpoint at its loop`, { skip: haveGcc ? false : 'arm-none-eabi-gcc not installed' }, async () => {
            const { bytes, loop } = cortexSpinElf(flash, ram);
            const { target } = await createDebugTarget('labwired', { wasm, chip: LABWIRED_CATALOG[chip], firmware: bytes });
            target.step('insn', 3);
            assert.equal(target.runFor(1_000_000), 'halted');
            const before = target.regs().r0;
            target.setBreakpoint({ kind: 'code', addr: loop });
            target.run();
            assert.equal(target.runFor(1_000_000), 'halted');
            assert.equal(target.regs().pc, loop, 'stopped at the loop head');
            assert.ok(target.regs().r0 > before, 'r0 counted while running');
            assert.deepEqual(Object.keys(target.regs()).filter(k => /^r\d+$/.test(k)).length, 13);
        });
    }
    it('stm32f103: record, restore the checkpoint, and replay reproduces every retire event', { skip: haveGcc ? false : 'arm-none-eabi-gcc not installed' }, async () => {
        const { bytes } = cortexSpinElf('0x08000000', '0x20000000');
        const { target } = await createDebugTarget('labwired', { wasm, chip: LABWIRED_CATALOG.stm32f103, firmware: bytes });
        assert.equal(target.setRecording(true), undefined, 'firmware-only can record');
        const events = [];
        target.onDebugEvent(e => events.push(e));
        target.step('insn', 4);
        target.runFor(1_000_000);
        const cp = target.captureCheckpoint();
        assert.equal(typeof cp.snapshotId, 'number', JSON.stringify(cp));
        events.length = 0;
        target.step('insn', 25);
        assert.equal(target.runFor(1_000_000), 'halted');
        const live = events.splice(0);
        assert.equal(live.length, 25);
        assert.equal(target.restoreCheckpoint(cp), undefined, 'the engine replayed its journal to the checkpoint');
        for (let i = 0; i < 25; i++) assert.equal(target.replayInstruction().accepted, true);
        const strip = e => ({ ...e, time: { ...e.time, domain: e.time.domain.replace(/-rewind-\d+$/, '') } });
        assert.deepEqual(events.map(strip), live, 'the replay is the recording, field for field');
    });
    it('rp2040: pico-sdk ROM lookup finds popcount32 in the clean-room bootrom', { skip: haveGcc ? false : 'arm-none-eabi-gcc not installed' }, async () => {
        const { bytes, done } = rp2040RomLookupElf();
        const { target } = await createDebugTarget('labwired', { wasm, chip: LABWIRED_CATALOG.rp2040, firmware: bytes });
        target.setBreakpoint({ kind: 'code', addr: done });
        target.run();
        assert.equal(target.runFor(1_000_000), 'halted', 'reached `done`: the ROM calls returned');
        assert.equal(target.regs().r5, 16, 'popcount32(0xF0F0F0F0) through the ROM table');
    });
});
