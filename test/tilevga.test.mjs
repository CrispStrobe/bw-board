import test from 'node:test';
import assert from 'node:assert/strict';
import { TileVGA, TILE_W, TILE_H } from '../src/tilevga.js';
import { FUNSCII } from '../src/funscii-font.js';
import { M6502Machine } from '../src/m6502-machine.js';

/**
 * rene6502's tile VGA card, semantics measured from its Propeller
 * driver: the renderer reads ONLY the display-side buffers, sections
 * copy at vblank per ctrl_cmd bits, and the frame counter lands back
 * in VRAM every vblank whether anything copied or not.
 */

const px = (f, x, y) => [...f.rgba.slice((y * TILE_W + x) * 4, (y * TILE_W + x) * 4 + 3)];

test('double buffer: VRAM writes are invisible until cmd + vblank', () => {
    const c = new TileVGA({ clockHz: 60 }); // 1 cycle = 1 vblank for the test
    // Tile (0,0) = 'H' in palette 1; palette 1 = black/green.
    c.write(0x0210, 0x48); c.write(0x0211, 0x01);
    c.write(0x0b70 + 16, 0x00); c.write(0x0b70 + 17, 0x30);
    // No cmd, a vblank passes: still black — the renderer never saw it.
    c.advance(1);
    assert.deepEqual(px(c.videoFrame(), 1, 0), [0, 0, 0], 'live VRAM is not the screen');
    // cmd bit1, next vblank: the copy happens.
    c.write(0x0200, 0x02);
    c.advance(1);
    const f = c.videoFrame();
    let green = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const p = px(f, x, y);
        if (p[1] === 255 && p[0] === 0) green++;
    }
    assert.ok(green > 10, `the H renders in green after the copy (${green} px)`);
    // The glyph itself: funscii row bits, bit 0 = leftmost.
    const row1 = FUNSCII[0x48 * 8 + 1];
    for (let x = 0; x < 8; x++) {
        const want = (row1 >> x) & 1 ? [0, 255, 0] : [0, 0, 0];
        assert.deepEqual(px(f, x, 1), want, `H row 1 pixel ${x}`);
    }
});

test('frame counter lands in VRAM every vblank, copy or not', () => {
    const c = new TileVGA({ clockHz: 60 });
    assert.equal(c.read(0x0c70), 0);
    c.advance(3);
    assert.equal(c.read(0x0c70) | (c.read(0x0c71) << 8), 3);
});

test('user charset: 4bpp, LOW nibble is the leftmost pixel', () => {
    const c = new TileVGA({ clockHz: 60 });
    c.write(0x0210, 0x00); c.write(0x0211, 0x10);   // char 0, USER charset, palette 0
    c.write(0x0c80, 0x21);                           // row 0: pixel0=idx1, pixel1=idx2
    c.write(0x0b70 + 1, 0xc0);                       // palette 0 color 1 = red
    c.write(0x0b70 + 2, 0x0c);                       // palette 0 color 2 = blue
    c.write(0x0200, 0x06);                           // copy tiles+palettes and charset
    c.advance(1);
    const f = c.videoFrame();
    assert.deepEqual(px(f, 0, 0), [255, 0, 0], 'leftmost pixel from the low nibble (red)');
    assert.deepEqual(px(f, 1, 0), [0, 0, 255], 'second pixel from the high nibble (blue)');
});

test('the hello-world idiom runs on the machine: write, cmd, poll FRAME, clear', () => {
    // Hand-assembled port of rene6502's demo loop, card at $4000-$7FFF:
    //   tile(0,0)='H' pal 1; palette 1 black/green; cmd=3; poll $4C70
    //   until it moves; cmd=0; STP.
    const prog = [
        0xa9, 0x48, 0x8d, 0x10, 0x42,   // LDA #'H'  STA $4210
        0xa9, 0x01, 0x8d, 0x11, 0x42,   // LDA #1    STA $4211
        0xa9, 0x00, 0x8d, 0x80, 0x4b,   // LDA #0    STA $4B80
        0xa9, 0x30, 0x8d, 0x81, 0x4b,   // LDA #$30  STA $4B81 (green)
        0xa9, 0x03, 0x8d, 0x00, 0x42,   // LDA #3    STA $4200
        0xad, 0x70, 0x4c,               // LDA $4C70
        0xcd, 0x70, 0x4c,               // wait: CMP $4C70
        0xf0, 0xfb,                     // BEQ wait
        0xa9, 0x00, 0x8d, 0x00, 0x42,   // LDA #0    STA $4200
        0xdb,                           // STP
    ];
    const m = new M6502Machine({
        clockHz: 1_000_000,
        regions: [
            { kind: 'ram', start: 0x0000, end: 0x3fff },
            { kind: 'rom', start: 0x8000, end: 0xffff },
        ],
        chips: [{ kind: 'tilevga', name: 'vga', at: 0x4000 }],
    }, {});
    m.loadRom(prog, 0x8000);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    m.advanceToMs(100); // several vblanks; the program STPs itself
    const f = m.chips.vga.videoFrame();
    let green = 0;
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (px(f, x, y)[1] === 255) green++;
    }
    assert.ok(green > 10, `H on screen via the real CPU idiom (${green} green px)`);
    assert.equal(m.chips.vga.read(0x0200), 0, 'the program cleared cmd after the FRAME poll');
    assert.equal(f.width, TILE_W); assert.equal(f.height, TILE_H);
});
