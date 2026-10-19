// The display-shell example: the CGADEMO8086 preset booting the cga-demo ROM,
// end to end through the real core and CGA card. This is the screen counterpart
// to the serial shell — "boots into a screen when you open it", proven to select
// text mode and land its message in the B800 text page the VdpScreen renders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, CGADEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'cga-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

const EXPECTED = '8086 PC/XT - CGA text ready';

/** Read the CGA text page (B800:0000) back as the string it spells, one char per cell. */
function screenText(m, len) {
    let s = '';
    for (let i = 0; i < len; i++) s += String.fromCharCode(m._read(0xb8000 + i * 2));
    return s;
}

test('it boots itself and writes its message into the CGA text page', () => {
    const m = new I8086Machine(CGADEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();
    assert.equal(screenText(m, EXPECTED.length), EXPECTED, 'the message landed in B800, cell by cell');
});

test('it selects CGA text mode on the way in', () => {
    const m = new I8086Machine(CGADEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();
    // 3D8h mode-control was written 29h: 80x25 text, video on, blink enabled.
    assert.equal(m.chips.cga1.getVideoState().mode & 0x02, 0x00, 'bit 1 clear = text (not graphics) mode');
});

test('the attribute cells carry the colour the ROM wrote', () => {
    const m = new I8086Machine(CGADEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();
    assert.equal(m._read(0xb8000 + 1), 0x1f, 'white-on-blue attribute beside the first glyph');
});

test('the preset is a self-contained screen machine — one card, no BIOS, no disk', () => {
    const m = new I8086Machine(CGADEMO8086);
    assert.deepEqual(Object.keys(m.chips), ['cga1']);
    const rom = CGADEMO8086.regions.find((r) => r.kind === 'rom');
    assert.ok(rom.start <= 0xffff0 && rom.end >= 0xfffff, 'ROM covers the reset vector');
    assert.ok(CGADEMO8086.regions.some((r) => r.start === 0xb8000), 'the CGA text page is mapped');
});
