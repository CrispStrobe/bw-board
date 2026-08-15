/**
 * MC6845 CRTC golden tests — register interface, geometry, cursor,
 * start address, text rendering, and videoFrame() contract.
 *
 * Expectations hand-computed from the Motorola MC6845 datasheet.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MC6845 } from '../src/mc6845.js';

// A minimal 4×6 charset for test assertions: just characters A (0x41)
// and B (0x42) with recognizable patterns.
function testCharset(charH) {
    const font = new Uint8Array(256 * charH);
    // 'A' = 0x41: top row all-on, rest column 0 on
    font[0x41 * charH] = 0xff;
    for (let r = 1; r < charH; r++) font[0x41 * charH + r] = 0x80;
    // 'B' = 0x42: checkerboard
    for (let r = 0; r < charH; r++) font[0x42 * charH + r] = r & 1 ? 0x55 : 0xaa;
    // ' ' = 0x20: all zero (default)
    return font;
}

describe('MC6845 CRTC', () => {

    it('defaults to 80×25 text mode with 8-line chars', () => {
        const crtc = new MC6845();
        assert.equal(crtc.cols, 80);
        assert.equal(crtc.rows, 25);
        assert.equal(crtc.charH, 8);
        assert.equal(crtc.startAddr, 0);
        assert.equal(crtc.cursorAddr, 0);
    });

    it('address/data register port pair: write R1, read it back', () => {
        const crtc = new MC6845();
        // Select register 1 (horizontal displayed)
        crtc.write(0, 1);
        // Write 40 to it
        crtc.write(1, 40);
        assert.equal(crtc.cols, 40);
        // Read it back
        crtc.write(0, 1); // select R1 again
        assert.equal(crtc.read(1), 40);
    });

    it('R0-R9: geometry registers store and read back', () => {
        const crtc = new MC6845();
        const vals = [99, 80, 82, 0x28, 30, 2, 25, 27, 0, 7];
        for (let r = 0; r <= 9; r++) {
            crtc.write(0, r);
            crtc.write(1, vals[r]);
        }
        for (let r = 0; r <= 9; r++) {
            crtc.write(0, r);
            assert.equal(crtc.read(1), vals[r], `R${r}`);
        }
    });

    it('R12/R13: start address sets framebuffer base', () => {
        const crtc = new MC6845();
        // Start address = 0x0400 (1024)
        crtc.write(0, 12); crtc.write(1, 0x04); // R12 = high byte
        crtc.write(0, 13); crtc.write(1, 0x00); // R13 = low byte
        assert.equal(crtc.startAddr, 0x0400);
    });

    it('R14/R15: cursor position', () => {
        const crtc = new MC6845();
        // Cursor at position 83 (row 1, col 3 in 80-col mode)
        crtc.write(0, 14); crtc.write(1, 0x00);
        crtc.write(0, 15); crtc.write(1, 83);
        assert.equal(crtc.cursorAddr, 83);
    });

    it('R16/R17: light pen registers are read-only (always 0)', () => {
        const crtc = new MC6845();
        crtc.write(0, 16); crtc.write(1, 0xff);
        assert.equal(crtc.read(1), 0, 'R16 is read-only');
        crtc.write(0, 17); crtc.write(1, 0xff);
        assert.equal(crtc.read(1), 0, 'R17 is read-only');
    });

    it('R10/R11: cursor start/end scan lines', () => {
        const crtc = new MC6845();
        crtc.write(0, 10); crtc.write(1, 6);  // cursor start = line 6
        crtc.write(0, 11); crtc.write(1, 7);  // cursor end = line 7
        assert.equal(crtc.cursorStart, 6);
        assert.equal(crtc.cursorEnd, 7);
        assert.equal(crtc.cursorEnabled, true);
    });

    it('R10 bits 6:5 = 01 disables cursor', () => {
        const crtc = new MC6845();
        // Bits 6:5 = 01 → cursor off (datasheet §3.2.10)
        crtc.write(0, 10); crtc.write(1, 0x20); // 0b00100000
        assert.equal(crtc.cursorEnabled, false);
    });

    it('advance() ticks frame counter', () => {
        const crtc = new MC6845({ clockHz: 2_000_000, fps: 50 });
        assert.equal(crtc.frame, 0);
        // 2MHz / 50fps = 40000 cycles per frame
        crtc.advance(40000);
        assert.equal(crtc.frame, 1);
        crtc.advance(80000); // two more frames
        assert.equal(crtc.frame, 3);
    });

    it('40×25 mode: R1=40, R6=25, R9=7 → 320×200 video', () => {
        const crtc = new MC6845();
        crtc.write(0, 1); crtc.write(1, 40);  // 40 cols
        crtc.write(0, 6); crtc.write(1, 25);  // 25 rows
        crtc.write(0, 9); crtc.write(1, 7);   // 8 lines/char
        const vf = crtc.videoFrame();
        assert.equal(vf.width, 320);
        assert.equal(vf.height, 200);
        assert.equal(vf.mode, 'text');
        assert.equal(vf.signal, true);
        assert.equal(vf.rgba.length, 320 * 200 * 4);
    });

    it('videoFrame() contract: width, height, rgba, frame, signal', () => {
        const crtc = new MC6845();
        const vf = crtc.videoFrame();
        assert.ok('width' in vf);
        assert.ok('height' in vf);
        assert.ok('rgba' in vf);
        assert.ok('frame' in vf);
        assert.ok('signal' in vf);
        assert.ok(vf.rgba instanceof Uint8ClampedArray);
        assert.equal(vf.rgba.length, vf.width * vf.height * 4);
    });
});

describe('MC6845 text rendering', () => {

    it('character A at (0,0) renders the glyph from charset', () => {
        const charH = 6;
        const charW = 8;
        const charset = testCharset(charH);
        const crtc = new MC6845({
            charset, charW,
            fg: [255, 255, 255, 255],
            bg: [0, 0, 0, 255],
        });
        // Set 4×2 mode for a small test
        crtc.write(0, 1); crtc.write(1, 4);  // 4 cols
        crtc.write(0, 6); crtc.write(1, 2);  // 2 rows
        crtc.write(0, 9); crtc.write(1, charH - 1);
        // Move cursor away so it doesn't invert position 0
        crtc.write(0, 14); crtc.write(1, 0);
        crtc.write(0, 15); crtc.write(1, 99);

        // Put 'A' at position 0
        crtc.vram[0] = 0x41;
        const rgba = crtc.rgba();
        const w = 4 * charW; // 32

        // Top-left pixel of 'A': glyph row 0 is 0xFF, bit 7 is set → FG
        assert.equal(rgba[0], 255, 'A top-left R = FG');
        assert.equal(rgba[1], 255, 'A top-left G = FG');
        assert.equal(rgba[2], 255, 'A top-left B = FG');

        // Row 1, col 0 of 'A': glyph byte is 0x80, bit 7 set → FG
        const row1px0 = (1 * w + 0) * 4;
        assert.equal(rgba[row1px0], 255, 'A row1 col0 = FG');

        // Row 1, col 1 of 'A': 0x80, bit 6 is NOT set → BG
        const row1px1 = (1 * w + 1) * 4;
        assert.equal(rgba[row1px1], 0, 'A row1 col1 = BG');
    });

    it('start address offsets the framebuffer read', () => {
        const charH = 6;
        const charset = testCharset(charH);
        const crtc = new MC6845({ charset });
        crtc.write(0, 1); crtc.write(1, 4);
        crtc.write(0, 6); crtc.write(1, 1);
        crtc.write(0, 9); crtc.write(1, charH - 1);

        // Place 'B' at VRAM address 0x100
        crtc.vram[0x100] = 0x42;
        // Set start address to 0x100
        crtc.write(0, 12); crtc.write(1, 0x01);
        crtc.write(0, 13); crtc.write(1, 0x00);
        assert.equal(crtc.startAddr, 0x0100);

        const rgba = crtc.rgba();
        // First char should be 'B' — row 0 of B's glyph is 0xAA
        // bit 7 (pixel 0) is 1 → FG
        assert.equal(rgba[0], 0xaa, 'B pixel 0 = FG (default grey)');
    });

    it('cursor inverts the character cell at the cursor position', () => {
        const charH = 6;
        const charset = testCharset(charH);
        const crtc = new MC6845({
            charset,
            fg: [255, 255, 255, 255],
            bg: [0, 0, 0, 255],
        });
        crtc.write(0, 1); crtc.write(1, 4);
        crtc.write(0, 6); crtc.write(1, 1);
        crtc.write(0, 9); crtc.write(1, charH - 1);
        crtc.write(0, 10); crtc.write(1, 0);           // cursor start = 0
        crtc.write(0, 11); crtc.write(1, charH - 1);   // cursor end = 5

        // Space at position 0 (all glyph bits = 0)
        crtc.vram[0] = 0x20;
        // Cursor at position 0
        crtc.write(0, 14); crtc.write(1, 0);
        crtc.write(0, 15); crtc.write(1, 0);

        const rgba = crtc.rgba();
        // Without cursor: space = all BG (black)
        // With cursor (inversion): all pixels in the cursor scan lines → FG
        assert.equal(rgba[0], 255, 'cursor inverts space → FG R');
        assert.equal(rgba[1], 255, 'cursor inverts space → FG G');
        assert.equal(rgba[2], 255, 'cursor inverts space → FG B');
    });

    it('cursor only affects scan lines between cursorStart and cursorEnd', () => {
        const charH = 8;
        const charset = testCharset(charH);
        const crtc = new MC6845({
            charset,
            fg: [255, 255, 255, 255],
            bg: [0, 0, 0, 255],
        });
        crtc.write(0, 1); crtc.write(1, 2);
        crtc.write(0, 6); crtc.write(1, 1);
        crtc.write(0, 9); crtc.write(1, charH - 1);
        // Cursor only on lines 6-7 (underline cursor)
        crtc.write(0, 10); crtc.write(1, 6);
        crtc.write(0, 11); crtc.write(1, 7);

        crtc.vram[0] = 0x20; // space
        crtc.write(0, 14); crtc.write(1, 0);
        crtc.write(0, 15); crtc.write(1, 0);

        const w = 2 * 8;
        const rgba = crtc.rgba();

        // Line 0 of char: no cursor → BG
        assert.equal(rgba[0], 0, 'line 0 = BG (no cursor here)');
        // Line 6 of char: cursor → FG
        const line6 = (6 * w) * 4;
        assert.equal(rgba[line6], 255, 'line 6 = FG (cursor underline)');
        // Line 7 of char: cursor → FG
        const line7 = (7 * w) * 4;
        assert.equal(rgba[line7], 255, 'line 7 = FG (cursor underline)');
    });

    it('VRAM wraps around when start address + screen exceeds vram size', () => {
        const charH = 6;
        const charset = testCharset(charH);
        const crtc = new MC6845({ charset, vramSize: 256 });
        crtc.write(0, 1); crtc.write(1, 4);
        crtc.write(0, 6); crtc.write(1, 1);
        crtc.write(0, 9); crtc.write(1, charH - 1);

        // Start at address 254, so chars 2 and 3 wrap to 0 and 1
        crtc.write(0, 12); crtc.write(1, 0);
        crtc.write(0, 13); crtc.write(1, 254);
        crtc.vram[254] = 0x41; // 'A'
        crtc.vram[255] = 0x42; // 'B'
        crtc.vram[0] = 0x41;   // 'A' (wrapped)
        crtc.vram[1] = 0x42;   // 'B' (wrapped)

        // Should not crash
        const rgba = crtc.rgba();
        assert.ok(rgba.length > 0, 'rendering with wrap-around succeeds');
    });
});
