import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80Machine } from '../src/z80-machine.js';
import { saveSNA, loadSNA, SNA_SIZE } from '../src/zx-sna.js';
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
