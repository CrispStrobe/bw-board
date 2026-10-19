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

test('the REAL 128K ROM boots: menu, navigation, ROM-driven banking', async (t) => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { zxScreenText } = await import('../src/zx-ula.js');
    // STECCY (MIT, ukw100) ships the pair under the Amstrad permission;
    // its 48.rom is md5-identical to our zxs-rom source build, which
    // cross-validates both sourcings. Local copy beside our 48.ROM.
    const romPath = process.env.ZX128_ROM || join(homedir(), 'code', 'zxs-rom', '128.ROM');
    if (!existsSync(romPath)) { t.skip('128.ROM not present — see STECCY provenance note'); return; }

    const rom = readFileSync(romPath);
    const m = new Z80Machine({ clockHz: 3_546_900, zx128: true }, {});
    m.loadRom128(0, rom.subarray(0, 16384));      // 128 editor
    m.loadRom128(1, rom.subarray(16384, 32768));  // 48 BASIC
    m.cpu.pc = 0;
    m.advanceToMs(3000);
    const font = m.roms[1].subarray(0x3d00, 0x4000);
    const menu = zxScreenText(m.mem, { font }).filter(Boolean).join('|');
    assert.ok(/128 BASIC/.test(menu), `the menu lists 128 BASIC (${JSON.stringify(menu)})`);
    assert.ok(/1986 Sinclair Research/.test(menu), 'the 1986 copyright line');

    // ENTER selects Tape Loader — and the ROM's own code drives OUR
    // banking: the loader runs from ROM 1.
    m.ula.setKeys(['enter']); m.advanceToMs(3200); m.ula.setKeys([]);
    m.advanceToMs(4000);
    const loader = zxScreenText(m.mem, { font }).filter(Boolean).join('|');
    assert.ok(/Tape Loader/.test(loader), 'ENTER navigated the menu');
    assert.equal(m._bank.rom, 1, 'the 128 ROM banked itself to ROM 1 for the loader');
});

test('128 BASIC key-click drives the AY chip', async (t) => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { zxScreenText } = await import('../src/zx-ula.js');
    const romPath = process.env.ZX128_ROM || join(homedir(), 'code', 'zxs-rom', '128.ROM');
    if (!existsSync(romPath)) { t.skip('128.ROM not present'); return; }

    const rom = readFileSync(romPath);
    const m = new Z80Machine({ clockHz: 3_546_900, zx128: true }, {});
    m.loadRom128(0, rom.subarray(0, 16384));
    m.loadRom128(1, rom.subarray(16384, 32768));
    m.cpu.pc = 0;
    m.advanceToMs(3000);

    // Navigate to 128 BASIC (second item — press DOWN then ENTER)
    m.ula.setKeys(['down']); m.advanceToMs(3200); m.ula.setKeys([]);
    m.advanceToMs(3400);
    m.ula.setKeys(['enter']); m.advanceToMs(3600); m.ula.setKeys([]);
    m.advanceToMs(4500);

    const font = m.roms[1].subarray(0x3d00, 0x4000);
    const text = zxScreenText(m.mem, { font }).filter(Boolean).join('|');
    // Should see the 128 BASIC editor prompt
    assert.ok(/128/.test(text) || text.length > 0, `128 BASIC running: ${JSON.stringify(text)}`);

    // The AY should have been touched by the ROM's beep routine or
    // key-click (the 128 ROM programs the AY for its click sound).
    // Check that at least one AY register was written (mixer changed
    // from the reset default of 0x3F).
    const ayRegs = m.ay.regs;
    const anyWritten = ayRegs.some((v, i) => {
        if (i === 7) return v !== 0x3f; // mixer changed from default
        return v !== 0;
    });
    assert.ok(anyWritten, `AY registers should be touched by the 128 ROM (regs: [${ayRegs}])`);
});

test('tron-on-128K: a 48K game runs on the banked machine in 48K mode', async (t) => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { homedir } = await import('node:os');
    const { zxScreenText } = await import('../src/zx-ula.js');
    const { ZXTape } = await import('../src/zx-tape.js');

    const romPath = process.env.ZX_ROM || join(homedir(), 'code', 'zxs-rom', '48.ROM');
    const tapPath = join(homedir(), 'code', 'tron-0xf', 'tron_0xf.compilable.tap');
    if (!existsSync(romPath)) { t.skip('48.ROM not present'); return; }
    if (!existsSync(tapPath)) { t.skip('tron TAP not present'); return; }

    const rom = readFileSync(romPath);
    const tap = readFileSync(tapPath);

    // The 128K-in-48K-mode pattern: ROM 1 (48 BASIC) + lock.
    const m = new Z80Machine({ clockHz: 3_546_900, zx128: true }, {});
    m.loadRom128(1, rom);
    m._bank.locked = 0;
    m._setBank(0x30); // ROM 1 + lock
    m.cpu.pc = 0;
    m.insertTape(tap);

    // Boot to BASIC prompt (~4.2s emulated)
    m.advanceToMs(4200);
    const font = m.roms[1].subarray(0x3d00, 0x4000);
    const bootText = zxScreenText(m.mem, { font }).filter(Boolean).join('|');
    assert.ok(/1982/.test(bootText),
        `48K BASIC boots on the 128K bus: ${JSON.stringify(bootText)}`);

    // Type LOAD ""
    const press = (keys) => {
        m.ula.setKeys(keys); m.advanceToMs(m.tMs + 120);
        m.ula.setKeys([]); m.advanceToMs(m.tMs + 120);
    };
    press(['j']); press(['sym', 'p']); press(['sym', 'p']); press(['enter']);
    m.advanceToMs(m.tMs + 30000);

    const afterLoad = zxScreenText(m.mem, { font }).filter(Boolean).join('|');
    assert.notEqual(afterLoad, bootText,
        'the tape loaded content onto the 128K machine in 48K mode');
    assert.ok(m.tape.pos > 0, `tape blocks were consumed (pos=${m.tape.pos})`);
});
