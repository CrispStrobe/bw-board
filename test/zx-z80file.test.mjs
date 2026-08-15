import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { Z80Machine } from '../src/z80-machine.js';
import { parseZ80, loadZ80, saveZ80, compressZ80 } from '../src/zx-z80file.js';
import { zxScreenText } from '../src/zx-ula.js';

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

test('ED-ED compression: runs, lone ED, and ED runs all round-trip', () => {
    const cases = [
        Uint8Array.from([1, 2, 3, 4, 5]),                              // no runs
        Uint8Array.from(Array(200).fill(7)),                           // long run
        Uint8Array.from([0xed, 9, 9, 9, 9, 9, 9]),                     // lone ED forces next literal
        Uint8Array.from([0xed, 0xed]),                                 // ED run of 2 must encode
        Uint8Array.from([1, 0xed, 0xed, 0xed, 2, 2, 2, 2, 2, 2, 3]),   // mixed
        Uint8Array.from([0, 0xed, 0xed, 0]),                           // the v1 end marker as DATA
    ];
    for (const data of cases) {
        const packed = compressZ80(data);
        const out = new Uint8Array(data.length);
        // decompress via parseZ80's machinery: wrap as a v1 body
        const buf = new Uint8Array(30 + packed.length + 4);
        buf[6] = 0x01; // PC != 0 → v1
        buf[12] = 0x20; // compressed
        buf.set(packed, 30);
        buf.set([0x00, 0xed, 0xed, 0x00], 30 + packed.length);
        const { mem48k } = parseZ80(buf);
        assert.deepEqual([...mem48k.slice(0, data.length)], [...data],
            `round-trip of [${data.slice(0, 8)}...]`);
        assert.ok(out.length === data.length);
    }
});

test('v1 round-trip: a booted Spectrum survives .z80 and keeps running', (t) => {
    if (!existsSync(romPath)) { t.skip('48.ROM not built'); return; }
    const m = zx();
    m.advanceToMs(4200);
    const before = zxScreenText(m.mem).filter(Boolean).join('|');

    const z80 = saveZ80(m);
    assert.ok(z80.length < 49182, `compression did something (${z80.length} bytes for 48K+header)`);
    const m2 = zx();
    loadZ80(m2, z80);
    assert.equal(zxScreenText(m2.mem).filter(Boolean).join('|'), before, 'identical screen');
    for (const k of ['pc', 'sp', 'hl', 'bc', 'de', 'af_', 'ix', 'iy', 'i', 'im', 'iff1']) {
        assert.equal(m2.cpu[k], m.cpu[k], k);
    }
    m2.advanceToMs(m2.tMs + 200);
    m2.ula.setKeys(['b']);
    m2.advanceToMs(m2.tMs + 150);
    m2.ula.setKeys([]);
    m2.advanceToMs(m2.tMs + 300);
    assert.notEqual(zxScreenText(m2.mem).filter(Boolean).join('|'), before, 'restored machine reacted to a key');
});

test('v2 header: PC from the extra header, pages land, 128K refuses by mode', () => {
    // Synthetic v2: header PC=0, extra len 23, real PC $8123, hw mode 0,
    // one uncompressed page (page 8 → $4000) carrying a pattern.
    const page = new Uint8Array(16384);
    for (let i = 0; i < page.length; i++) page[i] = (i * 7) & 0xff;
    const buf = new Uint8Array(32 + 23 + 3 + 16384);
    buf[12] = 0x02;            // border 1
    buf[30] = 23; buf[31] = 0; // extra header length → v2
    buf[32] = 0x23; buf[33] = 0x81;
    buf[34] = 0;               // 48K
    const p = 32 + 23;
    buf[p] = 0xff; buf[p + 1] = 0xff; buf[p + 2] = 8;
    buf.set(page, p + 3);
    const r = parseZ80(buf);
    assert.equal(r.version, 2);
    assert.equal(r.regs.pc, 0x8123);
    assert.equal(r.border, 1);
    assert.deepEqual([...r.mem48k.slice(0, 8)], [...page.slice(0, 8)], 'page 8 at $4000');

    buf[34] = 2; // SamRam — not a recognized 48K or 128K mode
    assert.throws(() => parseZ80(buf), /not a recognized/, 'refuses unrecognized hw mode');
});

test('the debug target takes both formats through one loadSnapshot', async (t) => {
    if (!existsSync(romPath)) { t.skip('48.ROM not built'); return; }
    const { createZ80DebugTarget } = await import('../src/z80-debug.js');
    const { saveSNA } = await import('../src/zx-sna.js');
    const m = zx();
    m.advanceToMs(4200);
    const screen = zxScreenText(m.mem).filter(Boolean).join('|');

    for (const [name, snap] of [['sna', saveSNA(m)], ['z80', saveZ80(m)]]) {
        const m2 = zx();
        const target = createZ80DebugTarget({ machine: m2 });
        assert.equal(target.loadSnapshot(snap), true, `${name} accepted`);
        assert.equal(zxScreenText(m2.mem).filter(Boolean).join('|'), screen, `${name} restored the screen`);
    }
    const bare = createZ80DebugTarget({
        machine: { cpu: {}, mem: new Uint8Array(65536), chips: {}, tMs: 0, cycles: 0 },
    });
    assert.equal(bare.loadSnapshot(saveZ80(m)), false, 'no ULA refuses');
    assert.equal(createZ80DebugTarget({ machine: zx() }).loadSnapshot(Uint8Array.of(1, 2, 3)), false, 'junk refuses');
});

// ─── 128K .z80 tests ──────────────────────────────────────────────

test('parseZ80: v3 hw=4 (128K) produces is128 + 8 banks + port7ffd', () => {
    // Build a synthetic v3 128K .z80 with two pages (bank 0 and bank 5)
    const w16 = (arr, off, v) => { arr[off] = v & 0xff; arr[off + 1] = (v >> 8) & 0xff; };
    const header = new Uint8Array(86); // 30 + 2 (extra len) + 54 (extra header)
    header[6] = 0; header[7] = 0; // PC=0 → v2/v3
    w16(header, 30, 54);           // extra header length = 54 → v3
    w16(header, 32, 0x1234);       // real PC
    header[34] = 4;                // hw mode 4 = 128K
    header[35] = 0x13;             // last OUT $7FFD: bank 3, ROM 1, shadow
    // AY registers at bytes 39-55 (offsets in the file)
    for (let i = 0; i < 16; i++) header[39 + i] = 0x10 + i;

    // Page for bank 0 (page# = 3): uncompressed
    const page0 = new Uint8Array(3 + 16384);
    w16(page0, 0, 0xffff); // len = $FFFF = uncompressed
    page0[2] = 3;           // page# 3 = bank 0
    page0[3] = 0xAA;        // first byte of bank 0

    // Page for bank 5 (page# = 8): uncompressed
    const page5 = new Uint8Array(3 + 16384);
    w16(page5, 0, 0xffff);
    page5[2] = 8;           // page# 8 = bank 5
    page5[3] = 0xBB;

    const buf = new Uint8Array(header.length + page0.length + page5.length);
    buf.set(header);
    buf.set(page0, header.length);
    buf.set(page5, header.length + page0.length);

    const snap = parseZ80(buf);
    assert.equal(snap.is128, true);
    assert.equal(snap.version, 3);
    assert.equal(snap.regs.pc, 0x1234);
    assert.equal(snap.port7ffd, 0x13);
    assert.equal(snap.banks[0][0], 0xAA, 'bank 0 first byte');
    assert.equal(snap.banks[5][0], 0xBB, 'bank 5 first byte');
    assert.equal(snap.ayRegs[0], 0x10, 'AY R0');
    assert.equal(snap.ayRegs[15], 0x1f, 'AY R15');
});

test('loadZ80 128K: banks land in machine.pages, banking applied', () => {
    const m = new Z80Machine({
        clockHz: 3_546_900,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        zx128: true,
    }, {});

    // Build a minimal 128K .z80 v3
    const w16 = (arr, off, v) => { arr[off] = v & 0xff; arr[off + 1] = (v >> 8) & 0xff; };
    const header = new Uint8Array(86);
    header[0] = 0x42; // A = 0x42
    header[6] = 0; header[7] = 0; // PC=0 → v2/v3
    w16(header, 8, 0xff00);       // SP
    w16(header, 30, 54);          // extra = 54 → v3
    w16(header, 32, 0x8000);      // real PC
    header[34] = 4;               // hw = 128K
    header[35] = 0x03;            // port $7FFD: bank 3 at $C000, ROM 0
    // AY: R0 = 0x42
    header[39] = 0x42;

    // One page: bank 3 (page# = 6) with a marker byte
    const page = new Uint8Array(3 + 16384);
    w16(page, 0, 0xffff);
    page[2] = 6; // page# 6 = bank 3
    page[3 + 100] = 0xDE; // marker at offset 100

    const buf = new Uint8Array(header.length + page.length);
    buf.set(header); buf.set(page, header.length);

    loadZ80(m, buf);
    assert.equal(m.cpu.a, 0x42, 'register A restored');
    assert.equal(m.cpu.pc, 0x8000, 'PC restored');
    assert.equal(m._bank.page, 3, 'bank 3 paged in');
    // Bank 3 is at $C000 now — read via the bus
    assert.equal(m.readBus(0xc000 + 100), 0xDE, 'bank 3 data visible at $C000');
    // AY register
    assert.ok(m.ay, 'AY chip exists');
    m.ay.select(0);
    assert.equal(m.ay.read(), 0x42, 'AY R0 = 0x42');
});

test('loadZ80 128K on 48K machine throws', () => {
    const m = new Z80Machine({
        clockHz: 3_546_900,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
    }, {});

    const w16 = (arr, off, v) => { arr[off] = v & 0xff; arr[off + 1] = (v >> 8) & 0xff; };
    const header = new Uint8Array(86);
    header[6] = 0; header[7] = 0;
    w16(header, 30, 54);
    w16(header, 32, 0x1000);
    header[34] = 4; // 128K hw mode

    assert.throws(() => loadZ80(m, header), /128K .z80 snapshot requires a zx128 machine/);
});
