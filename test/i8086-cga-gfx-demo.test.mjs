// The CGA GRAPHICS example: the cga-gfx-demo ROM on the same CGADEMO8086 board
// as the text demo. It selects CGA mode 4 (320x200x4) at the mode register and
// fills the two interleaved banks with a 2-bit pattern — vertical colour bars.
//
// This tests what THIS lane owns: the firmware drives the correct graphics
// STATE — the mode register and the interleaved framebuffer bytes. Turning that
// state into pixels is the renderer's job (i8086-debug.js modeFromCga ->
// renderMode 'cga4', on the DOS/host lane's branch); lego-47 proved that decode
// in-process — mode 4, (0,0)=white, the +0x2000 bank landing on scanline 1 —
// before this demo was built. So: state here, pixels there, one seam.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, CGADEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'cga-gfx-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

function boot() {
    const m = new I8086Machine(CGADEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();
    return m;
}

test('it selects CGA mode 4 — graphics, video enabled, not the 640-wide mono mode', () => {
    const mode = boot().chips.cga1.getVideoState().mode;
    assert.equal(mode & 0x02, 0x02, 'bit 1 set = graphics mode');
    assert.equal(mode & 0x08, 0x08, 'bit 3 set = video enabled');
    assert.equal(mode & 0x10, 0x00, 'bit 4 clear = 320-wide (mode 4/5), not 640-wide mode 6');
});

test('it fills BOTH interleaved banks — the odd-scanline bank at +0x2000, not 8000 bytes linear', () => {
    const m = boot();
    assert.equal(m._read(0xb8000 + 0x0000), 0x1b, 'bank 0 (even scanlines) written');
    assert.equal(m._read(0xb8000 + 0x2000), 0x1b, 'bank 1 (odd scanlines) written — the CGA interleave');
    // A whole bank, not just the first byte: 100 lines x 80 bytes = 8000 = 0x1F40.
    assert.equal(m._read(0xb8000 + 0x1f3e), 0x1b, 'the last cell of bank 0 is filled');
    assert.equal(m._read(0xb8000 + 0x2000 + 0x1f3e), 0x1b, 'the last cell of bank 1 is filled');
});

test('the pattern byte decodes to the four palette colours in order (vertical bars)', () => {
    // 0x1B = 00 01 10 11: four pixels of colours 0,1,2,3, left to right. Under
    // palette 1 (3D9h=0x30) that is black / cyan / magenta / white, repeating
    // every four pixels across the whole frame.
    const b = boot()._read(0xb8000);
    assert.equal((b >> 6) & 3, 0, 'leftmost pixel = colour 0');
    assert.equal((b >> 4) & 3, 1, 'next = colour 1');
    assert.equal((b >> 2) & 3, 2, 'next = colour 2');
    assert.equal(b & 3, 3, 'rightmost = colour 3');
});

test('it runs on the SAME board as the text demo — CGADEMO8086 is the CGA screen board', () => {
    // No new preset: the board is the hardware, the ROM chooses text or graphics.
    const m = new I8086Machine(CGADEMO8086);
    assert.deepEqual(Object.keys(m.chips), ['cga1']);
    assert.ok(CGADEMO8086.regions.some((r) => r.start === 0xb8000), 'the CGA page is mapped for the bitmap');
});
