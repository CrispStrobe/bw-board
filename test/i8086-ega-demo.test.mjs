// The EGA example — the 16-colour PLANAR member of the display-demo set (ROADMAP
// E7.1) and the hardest. It boots bare-metal, selects a planar graphics mode,
// loads a 16-entry attribute palette, and fills the four bit planes with distinct
// bytes through the sequencer map mask.
//
// This tests the STATE this lane owns: the planar-mode discriminator, the map-
// mask plane routing, the read-map-select read path, and the palette. Composing
// pixels from the four planes is the renderer's job, and its planar decode is the
// DOS/host lane's half — not written yet, so (like Hercules before its decode)
// the board is NOT wired into the Machine-Loader. State here, pixels there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, EGADEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'ega-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

function boot() {
    const m = new I8086Machine(EGADEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 80000 && !m.cpu.halted; i++) m.step();
    return m;
}

test('it selects a PLANAR graphics mode — graphics, not chain-4, not 8-bit colour', () => {
    const vs = boot().chips.ega1.getVideoState();
    assert.notEqual(vs.misc, 0, 'misc programmed');
    assert.equal(vs.gc[0x06] & 0x01, 0x01, 'GR6 bit 0 = graphics');
    assert.equal(vs.seq[0x04] & 0x08, 0x00, 'SR4 bit 3 CLEAR = not chain-4 (this is what makes it planar)');
    assert.equal(vs.attr[0x10] & 0x40, 0x00, 'AR10h bit 6 CLEAR = not 8-bit colour (EGA, not VGA mode 13h)');
});

test('the map mask routes each fill into its own plane — the planar write path', () => {
    const vs = boot().chips.ega1.getVideoState();
    // Each plane got a distinct byte only because SR2 selected it alone.
    assert.equal(vs.planes[0][0], 0xff, 'plane 0 filled (map mask 0x01)');
    assert.equal(vs.planes[1][0], 0xaa, 'plane 1 filled (map mask 0x02)');
    assert.equal(vs.planes[2][0], 0xcc, 'plane 2 filled (map mask 0x04)');
    assert.equal(vs.planes[3][0], 0xf0, 'plane 3 filled (map mask 0x08)');
    // The whole 8000-byte plane, not just the first byte.
    assert.equal(vs.planes[0][7999], 0xff, 'plane 0 filled to the end');
    assert.equal(vs.planes[3][7999], 0xf0, 'plane 3 filled to the end');
});

test('a pixel composes from one bit per plane at the same offset', () => {
    // Byte 0 of the planes is FF / AA / CC / F0. Pixel i takes bit (7-i) of each
    // plane as colour bits 0..3, so the eight pixels are 15,13,11,9,7,5,3,1 — a
    // clean descending odd ramp that only comes out right if the planes overlay.
    const vs = boot().chips.ega1.getVideoState();
    const bit = (plane, pixel) => (vs.planes[plane][0] >> (7 - pixel)) & 1;
    const colour = (pixel) => bit(0, pixel) | (bit(1, pixel) << 1) | (bit(2, pixel) << 2) | (bit(3, pixel) << 3);
    const pixels = Array.from({ length: 8 }, (_, i) => colour(i));
    assert.deepEqual(pixels, [15, 13, 11, 9, 7, 5, 3, 1], 'the eight pixels compose across all four planes');
});

test('read-map-select returns the chosen plane', () => {
    const m = boot();
    m._out(0x3ce, 0x04); m._out(0x3cf, 0x02);       // GR4 = read plane 2
    assert.equal(m._read(0xa0000), 0xcc, 'reading A0000 with GR4=2 returns plane 2');
    m._out(0x3ce, 0x04); m._out(0x3cf, 0x01);       // GR4 = read plane 1
    assert.equal(m._read(0xa0000), 0xaa, 'and GR4=1 returns plane 1');
});

test('the board maps NO plain RAM at A0000 — the EGA card mediates that window', () => {
    const m = new I8086Machine(EGADEMO8086);
    assert.deepEqual(Object.keys(m.chips), ['ega1']);
    assert.ok(!EGADEMO8086.regions.some((r) => r.start <= 0xa0000 && r.end >= 0xa0000),
        'no RAM region covers A0000 — a write there is planar, not linear');
    // Prove it: a write with map mask 0 lands in NO plane (linear RAM would keep it).
    m._out(0x3c4, 0x02); m._out(0x3c5, 0x00);        // map mask = 0
    m._write(0xa0000, 0x55);
    m._out(0x3ce, 0x04); m._out(0x3cf, 0x00);
    assert.equal(m._read(0xa0000), 0x00, 'map mask 0 wrote to no plane — not plain memory');
});
