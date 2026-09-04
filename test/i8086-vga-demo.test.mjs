// The VGA example — the 256-colour member of the display-demo set (ROADMAP
// E7.1) and the second display board that actually renders. It boots bare-metal,
// sets exactly the four register bits the renderer's modeFromVga keys off for
// mode 13h, and paints the linear framebuffer at A000:0000 with 200 horizontal
// colour bands (row y = palette entry y).
//
// This tests the STATE this lane owns: the exact mode-13h discriminator lego-47
// specified (src/i8086-debug.js:73) and the linear framebuffer. Turning that
// into pixels is the renderer's job — which already decodes vga8 (confirmed) —
// so unlike Hercules this one's loader entry ships. State here, pixels there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, VGADEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'vga-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

function boot() {
    const m = new I8086Machine(VGADEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 20000 && !m.cpu.halted; i++) m.step();
    return m;
}

test('it sets the exact four-bit mode-13h discriminator the renderer keys off', () => {
    const vs = boot().chips.vga1.getVideoState();
    assert.notEqual(vs.misc, 0, 'misc output non-zero — the card was programmed');
    assert.equal(vs.gc[0x06] & 0x01, 0x01, 'GR6 bit 0 = graphics (not alphanumeric)');
    assert.equal(vs.seq[0x04] & 0x08, 0x08, 'SR4 bit 3 = chain-4');
    assert.equal(vs.attr[0x10] & 0x40, 0x40, 'AR10h bit 6 = 8-bit colour — the 256-colour flag');
});

test('it leaves the DAC alone, so the renderer uses the real VGA default palette', () => {
    // No DAC writes: an all-zero DAC signals "unprogrammed" and the renderer
    // falls back to the power-on 256-colour palette, which is the correct one.
    const dac = boot().chips.vga1.getVideoState().dac;
    assert.ok(dac.every((b) => b === 0), 'the demo programmed no palette entry — default palette by design');
});

test('it paints A0000 as a linear framebuffer — row y is palette entry y, no interleave', () => {
    const m = boot();
    // Mode 13h is linear: offset = y*320 + x. Row y is filled with colour y.
    for (const y of [0, 1, 5, 100, 199]) {
        assert.equal(m._read(0xa0000 + y * 320), y & 0xff, `row ${y} is colour ${y}`);
    }
    // Within a row the colour is constant (a solid band), and it is NOT the CGA
    // bank layout — the +0x2000 "bank" that CGA uses is just row ~25 here.
    assert.equal(m._read(0xa0000 + 10 * 320 + 200), 10, 'mid-row-10 is still colour 10');
});

test('the board is the VGA screen board — one card, the A0000 framebuffer, no CGA page', () => {
    const m = new I8086Machine(VGADEMO8086);
    assert.deepEqual(Object.keys(m.chips), ['vga1']);
    assert.ok(VGADEMO8086.regions.some((r) => r.start === 0xa0000), 'the mode-13h framebuffer is mapped');
    assert.ok(!VGADEMO8086.regions.some((r) => r.start === 0xb8000), 'no CGA text page — this is a VGA board');
});
