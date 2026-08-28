/**
 * A boot ROM we are allowed to ship.
 *
 * Raspberry Pi's RP2040 bootrom is BSD-3 — except `mufplib.S`, which says
 * "Raspberry Pi (Trading) Ltd hereby grants to you a non-exclusive license
 * to use the software SOLELY ON A RASPBERRY PI RP2040 DEVICE. No other use
 * is permitted", or GPLv2 from the copyright owner. An emulator is not an
 * RP2040 device and GPL cannot be bundled here, so the 16 KB blob cannot
 * ship under either licence offered, and asking a user to supply one does
 * not change what the licence says.
 *
 * So it is written from the datasheet instead, the same way this repo
 * already does the SSD1306 and the ATmega32U4. These tests hold it to the
 * two things that make it useful: the fixed header the SDK reads by
 * address, and routines that RETURN.
 *
 * That second one is not padding. The first version of memcpy here copied
 * correct bytes and never terminated — a branch offset counted from the
 * wrong place landed inside the loop body and took the count to -1. A test
 * that only compared the destination passed it.
 */

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
    buildBootrom, BOOTROM_SIZE, ROM_FUNC
} from '../src/rp2040-bootrom.js';

let rp2040Available = true;
try {
    await import('rp2040js');
} catch {
    rp2040Available = false;
}
const SKIP = rp2040Available ? false : 'rp2040js not available';

test('the header sits where the datasheet says, because the SDK reads it by address', () => {
    const rom = buildBootrom();
    assert.equal(rom.length, BOOTROM_SIZE);
    const view = new DataView(rom.buffer);

    assert.equal(String.fromCharCode(rom[0x10], rom[0x11]), 'Mu', 'the magic identifies the ROM');
    assert.equal(rom[0x12], 1, 'version');
    // Nothing else names these tables — they are found only by offset.
    assert.ok(view.getUint16(0x14, true) > 0x100, 'no function table pointer');
    assert.ok(view.getUint16(0x18, true) > 0x100, 'no lookup routine pointer');
    // Vectors must not point at zero, or a fault jumps to the SP word.
    assert.ok(view.getUint32(0x04, true) > 0, 'reset vector is null');
    assert.equal(view.getUint32(0x00, true), 0x20042000, 'initial SP is not the top of SRAM');
});

test('function-table entries carry the Thumb bit', () => {
    // The caller `blx`es straight to what the table holds. An even address
    // means ARM mode, which this core does not have — the failure is a
    // fault on the first call, a long way from the table.
    const rom = buildBootrom();
    const view = new DataView(rom.buffer);
    let at = view.getUint16(0x14, true);
    let entries = 0;
    while (view.getUint16(at, true) !== 0 && entries < 16) {
        const addr = view.getUint16(at + 2, true);
        assert.equal(addr & 1, 1, `entry ${entries} is not a Thumb address`);
        entries++;
        at += 4;
    }
    assert.ok(entries >= 4, `only ${entries} functions in the table`);
});

/** Run a ROM routine on a real core and report the steps it took to return. */
const callRom = async (entry, regs, limit = 4000) => {
    const {RP2040} = await import('rp2040js');
    const mcu = new RP2040();
    mcu.loadBootrom(new Uint32Array(buildBootrom().buffer));
    return {mcu, run (pc, r) {
        mcu.core.PC = pc & ~1;
        for (const [i, v] of Object.entries(r)) mcu.core.registers[Number(i)] = v;
        const RETURN = 0x20040000;               // an address we can recognise
        mcu.core.registers[14] = RETURN | 1;
        for (let i = 0; i < limit; i++) {
            if ((mcu.core.PC >>> 0) === RETURN) return i;
            mcu.step();
        }
        return -1;                               // did not return
    }, regs};
};

test('rom_table_lookup finds a function, and misses cleanly', {skip: SKIP}, async () => {
    const {mcu, run} = await callRom();
    const view = new DataView(buildBootrom().buffer);
    const table = view.getUint16(0x14, true);
    const lookup = view.getUint16(0x18, true);

    assert.ok(run(lookup, {0: table, 1: ROM_FUNC.MEMCPY}) >= 0, 'lookup never returned');
    const found = mcu.core.registers[0] >>> 0;
    assert.ok(found > 0x100 && (found & 1) === 1, `lookup gave 0x${found.toString(16)}`);

    // An unknown code must return 0 rather than run off the end of the table.
    assert.ok(run(lookup, {0: table, 1: 0x5A5A}) >= 0, 'lookup never returned on a miss');
    assert.equal(mcu.core.registers[0] >>> 0, 0, 'an unknown code did not return 0');
});

test('memcpy copies, and RETURNS', {skip: SKIP}, async () => {
    const {mcu, run} = await callRom();
    const view = new DataView(buildBootrom().buffer);
    const lookup = view.getUint16(0x18, true);
    run(lookup, {0: view.getUint16(0x14, true), 1: ROM_FUNC.MEMCPY});
    const memcpy = mcu.core.registers[0];

    const dst = 0x20001000;
    const src = 0x20002000;
    for (let i = 0; i < 16; i++) mcu.writeUint8(src + i, 0xA0 + i);
    const steps = run(memcpy, {0: dst, 1: src, 2: 16});

    assert.ok(steps >= 0, 'memcpy never returned — the loop does not terminate');
    const got = [];
    for (let i = 0; i < 16; i++) got.push(mcu.readUint8(dst + i));
    assert.deepEqual(got, [...Array(16)].map((_, i) => 0xA0 + i));
    assert.equal(mcu.core.registers[0] >>> 0, dst, 'memcpy must return its destination');
});

test('memcpy of zero bytes returns immediately and writes nothing', {skip: SKIP}, async () => {
    // The boundary the broken branch got wrong: with n = 0 the very first
    // compare has to exit, not fall into the body.
    const {mcu, run} = await callRom();
    const view = new DataView(buildBootrom().buffer);
    const lookup = view.getUint16(0x18, true);
    run(lookup, {0: view.getUint16(0x14, true), 1: ROM_FUNC.MEMCPY});
    const memcpy = mcu.core.registers[0];

    const dst = 0x20003000;
    mcu.writeUint8(dst, 0x5A);
    assert.ok(run(memcpy, {0: dst, 1: 0x20002000, 2: 0}) >= 0, 'memcpy(n=0) never returned');
    assert.equal(mcu.readUint8(dst), 0x5A, 'memcpy(n=0) wrote anyway');
});

test('memset fills, and returns', {skip: SKIP}, async () => {
    const {mcu, run} = await callRom();
    const view = new DataView(buildBootrom().buffer);
    const lookup = view.getUint16(0x18, true);
    run(lookup, {0: view.getUint16(0x14, true), 1: ROM_FUNC.MEMSET});
    const memset = mcu.core.registers[0];

    const dst = 0x20004000;
    const steps = run(memset, {0: dst, 1: 0x5A, 2: 12});
    assert.ok(steps >= 0, 'memset never returned');
    for (let i = 0; i < 12; i++) assert.equal(mcu.readUint8(dst + i), 0x5A, `byte ${i}`);
    assert.equal(mcu.readUint8(dst + 12), 0, 'memset ran past its count');
});

// ── the bit helpers ARMv6-M has no instructions for ─────────────────────

const bitHelper = async (name, cases) => {
    const {mcu, run} = await callRom();
    const view = new DataView(buildBootrom().buffer);
    const lookup = view.getUint16(0x18, true);
    run(lookup, {0: view.getUint16(0x14, true), 1: ROM_FUNC[name]});
    const fn = mcu.core.registers[0];
    assert.ok(fn > 0x100, `${name} is not in the function table`);
    for (const [input, expected] of cases) {
        const steps = run(fn, {0: input >>> 0});
        assert.ok(steps >= 0, `${name}(0x${(input >>> 0).toString(16)}) never returned`);
        assert.equal(mcu.core.registers[0] >>> 0, expected >>> 0,
            `${name}(0x${(input >>> 0).toString(16)})`);
    }
};

test('clz32 counts leading zeros, including the all-zero case', {skip: SKIP}, async () => {
    // MicroPython asks for this fifteen times during startup: ARMv6-M has
    // no CLZ instruction, which is why the ROM carries one at all.
    await bitHelper('CLZ32', [
        [0x80000000, 0], [0x40000000, 1], [1, 31], [0, 32], [0x00FF0000, 8]
    ]);
});

test('ctz32 counts trailing zeros, including the all-zero case', {skip: SKIP}, async () => {
    await bitHelper('CTZ32', [
        [1, 0], [2, 1], [0x80000000, 31], [0, 32], [0x00FF0000, 16]
    ]);
});

test('popcount32 counts set bits', {skip: SKIP}, async () => {
    await bitHelper('POPCOUNT32', [
        [0, 0], [1, 1], [0xFFFFFFFF, 32], [0xF0F0F0F0, 16], [0x80000001, 2]
    ]);
});

test('reverse32 reverses bit order', {skip: SKIP}, async () => {
    await bitHelper('REVERSE32', [
        [1, 0x80000000], [0x80000000, 1], [0, 0], [0xFFFFFFFF, 0xFFFFFFFF],
        [0x12345678, 0x1E6A2C48]
    ]);
});

/**
 * Built is not installed. rp2040js constructs its bootrom as an all-zero
 * Uint32Array, and zeros disassemble to `movs r0, r0` — so a core that
 * reaches ROM slides silently instead of faulting, and the failure surfaces
 * far from the jump that caused it. This asserts the ROM the adapter builds
 * is the ROM the core reads, through the emulator's own bus.
 */
test('the adapter installs the ROM where the core reads it', {skip: SKIP}, async () => {
    const {createRp2040jsAdapter} = await import(
        '../src/rp2040js-adapter.js');
    const {rp2040} = createRp2040jsAdapter();
    const rom = buildBootrom();
    const view = new DataView(rom.buffer);

    // Word 4 covers 0x10..0x13: 'M', 'u', version, pad.
    assert.equal(rp2040.readUint32(0x10), view.getUint32(0x10, true),
        'the §2.8.2 header is not what the core sees at 0x10');
    assert.equal(String.fromCharCode(rp2040.readUint32(0x10) & 0xff,
        (rp2040.readUint32(0x10) >>> 8) & 0xff), 'Mu');

    // The lookup pointer at 0x18 must point at code, and that code must not
    // be zeros — the exact thing an uninstalled ROM would still satisfy if
    // we only checked the pointer.
    const lookup = view.getUint16(0x18, true);
    assert.ok(lookup > 0x100, 'lookup pointer does not reach the routines');
    assert.notEqual(rp2040.readUint32(lookup & ~3), 0,
        'the lookup routine reads as zeros: the ROM was not installed');
});
