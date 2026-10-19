import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80Machine } from '../src/z80-machine.js';
import { saveSNA, loadSNA, SNA_SIZE, saveSNA128, loadSNA128, SNA128_SIZE } from '../src/zx-sna.js';
import { zxScreenText } from '../src/zx-ula.js';

/** .SNA round-trip: registers exact, screen identical, and the
 *  restored machine keeps RUNNING — the only test that matters. */

const romPath = process.env.ZX_ROM || join(homedir(), 'code', 'zxs-rom', '48.ROM');

const zx = () => {
    const m = new Z80Machine({
        clockHz: 3_500_000,
        regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }],
        ula: true,
    }, {});
    if (existsSync(romPath)) { m.load(readFileSync(romPath), 0); m.cpu.pc = 0; }
    return m;
};

test('SNA: register header round-trips exactly, PC via the stack', () => {
    const m = zx();
    Object.assign(m.cpu, { i: 0x3f, r: 0x55, im: 1, iff1: 1, iff2: 1, sp: 0xff24, pc: 0x1234 });
    m.cpu.hl = 0x1122; m.cpu.de = 0x3344; m.cpu.bc = 0x5566; m.cpu.af = 0x7788;
    m.cpu.hl_ = 0x99aa; m.cpu.de_ = 0xbbcc; m.cpu.bc_ = 0xddee; m.cpu.af_ = 0x0ff0;
    m.cpu.ix = 0xa5a5; m.cpu.iy = 0x5a5a;
    if (m.ula) m.ula.border = 5;

    const sna = saveSNA(m);
    assert.equal(sna.length, SNA_SIZE);

    const m2 = zx();
    loadSNA(m2, sna);
    for (const k of ['i', 'r', 'im', 'iff1', 'iff2', 'hl', 'de', 'bc', 'af',
        'hl_', 'de_', 'bc_', 'af_', 'ix', 'iy', 'pc', 'sp']) {
        assert.equal(m2.cpu[k], m.cpu[k], k);
    }
    assert.equal(m2.ula.border, 5);
});

test('SNA: a booted Spectrum survives the trip and keeps running', (t) => {
    if (!existsSync(romPath)) { t.skip('48.ROM not built'); return; }
    const m = zx();
    m.advanceToMs(4200); // the (c) 1982 boot screen
    const before = zxScreenText(m.mem).filter(Boolean).join('|');
    assert.ok(before.length > 0, 'boot screen present');

    const sna = saveSNA(m);
    const m2 = zx();
    loadSNA(m2, sna);
    assert.equal(zxScreenText(m2.mem).filter(Boolean).join('|'), before, 'identical screen');

    // The proof of life: the restored machine accepts a keypress.
    m2.advanceToMs(m2.tMs + 200);
    m2.ula.setKeys(['b']);
    m2.advanceToMs(m2.tMs + 150);
    m2.ula.setKeys([]);
    m2.advanceToMs(m2.tMs + 300);
    const after = zxScreenText(m2.mem).filter(Boolean).join('|');
    assert.notEqual(after, before, 'the restored machine reacted to a key');
});

// ─── 128K SNA ─────────────────────────────────────────────────────

test('SNA128_SIZE is 131103 bytes', () => {
    assert.equal(SNA128_SIZE, 27 + 49152 + 4 + 5 * 16384);
    assert.equal(SNA128_SIZE, 131103);
});

test('128K SNA round-trip: registers, banks, and banking state survive', () => {
    const m = new Z80Machine({
        clockHz: 3_546_900,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        zx128: true,
    }, {});

    // Set up some state
    m.cpu.pc = 0x1234;
    m.cpu.sp = 0xff00;
    m.cpu.a = 0x42;
    m.cpu.bc = 0xBEEF;
    m.cpu.im = 1;
    // Write markers into specific banks
    m.pages[0][0] = 0xA0;
    m.pages[1][0] = 0xA1;
    m.pages[3][0] = 0xA3;
    m.pages[4][0] = 0xA4;
    m.pages[6][0] = 0xA6;
    m.pages[7][0] = 0xA7;
    // Page 5 lives in mem at $4000
    m.mem[0x4000] = 0xA5;
    // Page 2 lives in mem at $8000
    m.mem[0x8000] = 0xA2;
    // Set banking: page 3 at $C000
    m._bank.locked = 0;
    m._setBank(0x03); // bank 3
    // Write to the banked region ($C000)
    m.writeBus(0xc000, 0xCC);

    const snap = saveSNA128(m);
    assert.equal(snap.length, SNA128_SIZE, 'snapshot is 131103 bytes');

    // Load onto a fresh machine
    const m2 = new Z80Machine({
        clockHz: 3_546_900,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        zx128: true,
    }, {});
    loadSNA128(m2, snap);

    assert.equal(m2.cpu.pc, 0x1234, 'PC restored');
    assert.equal(m2.cpu.a, 0x42, 'A restored');
    assert.equal(m2.cpu.bc, 0xBEEF, 'BC restored');
    assert.equal(m2._bank.page, 3, 'bank 3 at $C000');
    // Check bank markers
    assert.equal(m2.pages[0][0], 0xA0, 'bank 0');
    assert.equal(m2.pages[1][0], 0xA1, 'bank 1');
    assert.equal(m2.pages[3][0], 0xCC, 'bank 3 (overwritten via $C000)');
    assert.equal(m2.pages[4][0], 0xA4, 'bank 4');
    assert.equal(m2.pages[6][0], 0xA6, 'bank 6');
    assert.equal(m2.pages[7][0], 0xA7, 'bank 7');
    // Pages 5 and 2 are subarrays of mem
    assert.equal(m2.mem[0x4000], 0xA5, 'page 5 via mem');
    assert.equal(m2.mem[0x8000], 0xA2, 'page 2 via mem');
    // Banked data at $C000
    assert.equal(m2.readBus(0xc000), 0xCC, 'banked data at $C000');
});

test('128K SNA on 48K machine throws', () => {
    const m = new Z80Machine({
        clockHz: 3_546_900,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
    }, {});
    const buf = new Uint8Array(SNA128_SIZE);
    assert.throws(() => loadSNA128(m, buf), /128K .SNA requires a zx128 machine/);
});

test('short buffer for 128K SNA throws', () => {
    const m = new Z80Machine({
        clockHz: 3_546_900,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        zx128: true,
    }, {});
    assert.throws(() => loadSNA128(m, new Uint8Array(100)), /not a 128K .SNA/);
});
