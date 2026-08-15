import test from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';

/**
 * The 128K memory model: port $7FFD banking over 8×16K pages and two
 * ROMs. The load-bearing facts, each tested: pages are isolated and
 * persistent; pages 5 and 2 ALIAS the fixed $4000/$8000 windows; the
 * shadow screen swaps the ULA's source; the lock bit is final until
 * reset; snapshots carry all of it.
 */

const zx128 = () => new Z80Machine({ clockHz: 3_546_900, zx128: true }, {});
const BANK = 0x7ffd;

test('paging: pages are isolated, persistent, and CPU-switchable', () => {
    const m = zx128();
    const out = (v) => m.cpu.outPort(BANK, v);
    out(0); m.writeBus(0xc000, 0xaa);
    out(1); m.writeBus(0xc000, 0xbb);
    out(3); assert.equal(m.readBus(0xc000), 0x00, 'page 3 untouched');
    out(0); assert.equal(m.readBus(0xc000), 0xaa, 'page 0 kept its byte');
    out(1); assert.equal(m.readBus(0xc000), 0xbb, 'page 1 kept its byte');

    // The CPU idiom: LD BC,$7FFD / LD A,n / OUT (C),A / LD ($C000),A
    const prog = [0x01, 0xfd, 0x7f, 0x3e, 0x04, 0xed, 0x79, 0x32, 0x00, 0xc0, 0x76];
    // Programs run from page 5's fixed window ($4000) — ROM is empty.
    m.mem.set(prog, 0x4000);
    m.cpu.pc = 0x4000; m.cpu.sp = 0xbf00;
    m.advanceToMs(1);
    assert.equal(m.pages[4][0], 0x04, 'the CPU paged in 4 and wrote there');
});

test('pages 5 and 2 alias the fixed windows — one storage, two addresses', () => {
    const m = zx128();
    m.cpu.outPort(BANK, 5);
    m.writeBus(0xc123, 0x77);
    assert.equal(m.readBus(0x4123), 0x77, 'page 5 at $C000 IS the $4000 window');
    m.writeBus(0x8055, 0x66);
    m.cpu.outPort(BANK, 2);
    assert.equal(m.readBus(0xc055), 0x66, 'page 2 at $C000 IS the $8000 window');
});

test('ROM select: bit 4 swaps the two ROMs; ROM writes bounce', () => {
    const m = zx128();
    m.loadRom128(0, Uint8Array.of(0x11));
    m.loadRom128(1, Uint8Array.of(0x22));
    m.cpu.outPort(BANK, 0x00);
    assert.equal(m.readBus(0x0000), 0x11, 'ROM 0 (128 editor)');
    m.cpu.outPort(BANK, 0x10);
    assert.equal(m.readBus(0x0000), 0x22, 'ROM 1 (48 BASIC)');
    m.writeBus(0x0000, 0xff);
    assert.equal(m.readBus(0x0000), 0x22, 'ROM is ROM');
});

test('shadow screen: bit 3 renders from page 7', () => {
    const m = zx128();
    m.mem[0x4000] = 0xff;                    // normal screen: 8 ink pixels
    m.mem[0x4000 + 0x1800] = 0x07;           // white ink so they show
    m.cpu.outPort(BANK, 7);                  // page 7 at $C000
    m.writeBus(0xc000, 0x0f);                // shadow screen: 4 pixels
    m.writeBus(0xc000 + 0x1800, 0x07);
    const a = m.ula.renderFrame().indices.join(',');
    m.cpu.outPort(BANK, 0x08 | 7);           // shadow on
    const b = m.ula.renderFrame().indices.join(',');
    assert.notEqual(a, b, 'the ULA switched to the shadow screen');
    m.cpu.outPort(BANK, 7);                  // back
    assert.equal(m.ula.renderFrame().indices.join(','), a, 'and back again');
});

test('the lock bit is final until reset', () => {
    const m = zx128();
    m.cpu.outPort(BANK, 0x20 | 1);           // page 1 + LOCK
    m.cpu.outPort(BANK, 3);                  // ignored
    m.writeBus(0xc000, 0x5a);
    assert.equal(m.pages[1][0], 0x5a, 'still on page 1 — the lock held');
});

test('snapshot round-trip carries pages and banking', () => {
    const m = zx128();
    m.cpu.outPort(BANK, 6);
    m.writeBus(0xc010, 0x99);
    m.cpu.outPort(BANK, 0x08 | 6);           // shadow on, page 6
    const s = m.saveState();
    const m2 = zx128();
    m2.loadState(s);
    assert.equal(m2._bank.page, 6);
    assert.equal(m2._bank.shadow, 1);
    assert.equal(m2.readBus(0xc010), 0x99, 'page 6 contents restored');
    assert.equal(m2.ula.screen, m2.pages[7], 'the ULA renders the shadow after restore');
});

test('48K mode: the original ROM boots on the BANKED machine (USR0 semantics)', async (t) => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { zxScreenText } = await import('../src/zx-ula.js');
    const romPath = process.env.ZX_ROM || join(homedir(), 'code', 'zxs-rom', '48.ROM');
    if (!existsSync(romPath)) { t.skip('48.ROM not built'); return; }

    // How every 128K machine runs 48K software: 48 BASIC in ROM slot 1,
    // OUT $7FFD with ROM 1 + LOCK, then reset into it.
    const m = zx128();
    m.loadRom128(1, readFileSync(romPath));
    m.cpu.outPort(BANK, 0x30);               // ROM 1 + lock
    m.cpu.pc = 0;
    m.advanceToMs(4200);
    const font = m.roms[1].subarray(0x3d00, 0x4000);
    const text = zxScreenText(m.mem, { font }).filter(Boolean).join('|');
    assert.ok(/1982/.test(text), `the (c) 1982 boot screen on the banked bus (${JSON.stringify(text)})`);

    // The whole 48K input path holds: a keypress lands via the ULA.
    m.ula.setKeys(['b']);
    m.advanceToMs(m.tMs + 150);
    m.ula.setKeys([]);
    m.advanceToMs(m.tMs + 300);
    assert.notEqual(zxScreenText(m.mem, { font }).filter(Boolean).join('|'), text, 'keys reach 48 BASIC');
});
