// The CGA/VGA framebuffer renderer. Memory goes in through a plain
// Uint8Array and EXACT pixel values come out, because every claim this
// renderer makes is a claim about a specific byte reaching a specific
// pixel in a specific colour.
//
// The assertions that earn their keep are the ones covering the four
// documented traps: the CGA scanline interleave (an odd row must come from
// the +2000h bank, and the byte a naive y*80 renderer would have used must
// turn up two rows further down), the attribute nibble order, the
// blink-versus-background-intensity ambiguity, and colour 6 being brown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    renderMode, modeInfo, likelyMode, buildFont, DEFAULT_DAC,
} from '../src/i8086-cga.js';

const TEXT = 0xb8000;
const GRAPH = 0xa0000;
const BANK = 0x2000;

/** A megabyte of RAM and a reader over it -- the machine layer's shape, minus the machine. */
function mem() {
    const ram = new Uint8Array(0x100000);
    return { ram, read: (a) => ram[a & 0xfffff] };
}

/** One pixel as [r, g, b, a]. */
function px(img, x, y) {
    const o = (y * img.width + x) * 4;
    return [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]];
}

// The sixteen CGA colours as this renderer resolves them, for readability.
const BLACK = [0, 0, 0, 255];
const BLUE = [0, 0, 170, 255];
const GREEN = [0, 170, 0, 255];
const RED = [170, 0, 0, 255];
const BROWN = [170, 85, 0, 255];
const GREY = [170, 170, 170, 255];
const DARKGREY = [85, 85, 85, 255];
const LTGREEN = [85, 255, 85, 255];
const YELLOW = [255, 255, 85, 255];
const WHITE = [255, 255, 255, 255];

// ---- the default VGA palette ----------------------------------------

test('the mode 13h default palette is generated to the IBM table exactly', () => {
    assert.equal(DEFAULT_DAC.length, 768, '256 entries of three six-bit channels');
    const at = (i) => [DEFAULT_DAC[i * 3], DEFAULT_DAC[i * 3 + 1], DEFAULT_DAC[i * 3 + 2]];

    // 00h-0Fh: the sixteen CGA colours at DAC width.
    assert.deepEqual(at(0), [0, 0, 0], 'entry 0 is black');
    assert.deepEqual(at(1), [0, 0, 42], 'entry 1 is CGA blue, 2Ah not 3Fh');
    assert.deepEqual(at(6), [42, 21, 0],
        'entry 6 is BROWN -- green pulled down. Generating it from the RGBI bits alone gives olive');
    assert.deepEqual(at(14), [63, 63, 21],
        'entry 14 is plain yellow: the brown correction must NOT reach the bright twin');
    assert.deepEqual(at(15), [63, 63, 63], 'entry 15 is white');

    // 10h-1Fh: the sixteen greys, a widening perceptual ramp.
    assert.deepEqual(at(16), [0, 0, 0], 'the grey ramp starts at black');
    assert.deepEqual(at(17), [5, 5, 5], 'the second grey is 5, not 4 -- the ramp is not linear');
    assert.deepEqual(at(31), [63, 63, 63], 'the grey ramp ends at white');

    // 20h-F7h: nine blocks of six sextants of four steps.
    assert.deepEqual(at(32), [0, 0, 63], 'the hue wheel starts at full-value blue');
    assert.deepEqual(at(33), [16, 0, 63], 'the first quarter step rounds 15.75 UP to 16');
    assert.deepEqual(at(34), [31, 0, 63], 'the half step rounds 31.5 DOWN to 31');
    assert.deepEqual(at(36), [63, 0, 63], 'four steps later the wheel is at magenta');
    assert.deepEqual(at(42), [63, 31, 0], 'index 42 is two steps from red toward yellow');
    assert.deepEqual(at(56), [31, 31, 63], 'the half-saturation block lifts the floor to 31');
    assert.deepEqual(at(81), [49, 45, 63], 'the low-saturation ramp rounds 49.5 DOWN to 49');
    assert.deepEqual(at(104), [0, 0, 28], 'the mid-value block tops out at 28');
    assert.deepEqual(at(176), [0, 0, 16], 'the low-value block tops out at 16');
    assert.deepEqual(at(224), [11, 11, 16], '16*5/7 floors to 11');

    // F8h-FFh: the table really does end in eight unused blacks.
    for (let i = 248; i < 256; i++) {
        assert.deepEqual(at(i), [0, 0, 0], `entry ${i} is one of the eight trailing blacks`);
    }
});

// ---- mode 3, text ----------------------------------------------------

test('mode 3 geometry follows the CELL SIZE, not a constant', () => {
    assert.deepEqual(modeInfo(0x03), {
        kind: 'text', cols: 80, rows: 25, base: TEXT,
        cellW: 9, cellH: 16, width: 720, height: 400,
    }, '80x25 in 9x16 cells is the 720x400 VGA text raster');
    const cga = modeInfo(0x03, { cellW: 8, cellH: 8 });
    assert.equal(cga.width, 640, '80 columns of 8-pixel cells is 640 across');
    assert.equal(cga.height, 200, '25 rows of 8-line cells is 200 down');
    assert.equal(modeInfo(0x01).cols, 40, 'modes 0 and 1 are the 40-column text modes');
});

test('a character cell renders foreground and background from the RIGHT nibbles', () => {
    const { ram, read } = mem();
    // DBh is the full block, so every pixel in the cell is foreground and
    // the glyph shape cannot hide a colour mistake.
    ram[TEXT] = 0xdb;
    ram[TEXT + 1] = 0x1e;
    ram[TEXT + 2] = 0x20;             // a space: every pixel is background
    ram[TEXT + 3] = 0x1e;
    const img = renderMode(0x03, read, { cellW: 8, cellH: 8 });

    assert.deepEqual(px(img, 0, 0), YELLOW,
        'attribute 1Eh is yellow ON blue: the LOW nibble Eh is the FOREGROUND');
    assert.deepEqual(px(img, 7, 7), YELLOW, 'the full block reaches the last pixel of the cell');
    assert.deepEqual(px(img, 8, 0), BLUE,
        'the next cell is a space, so attribute 1Eh shows its background: blue, from the HIGH nibble');
    assert.notDeepEqual(px(img, 0, 0), BLUE,
        'reading the attribute byte left to right would put blue text on a yellow screen');
});

test('a funscii glyph lands with bit 0 as the LEFTMOST column', () => {
    const { ram, read } = mem();
    ram[TEXT] = 0x46;                 // 'F': a left stem, so it is not mirror-symmetric
    ram[TEXT + 1] = 0x0f;             // white on black
    const img = renderMode(0x03, read, { cellW: 8, cellH: 8 });
    assert.deepEqual(px(img, 1, 1), WHITE, "the stem of 'F' is on the LEFT of the cell");
    assert.deepEqual(px(img, 5, 1), BLACK,
        "the right of row 1 is empty; if it were lit the font's bit order is reversed");
});

test('the generated full block fills all NINE columns of a 9x16 cell', () => {
    const { ram, read } = mem();
    ram[TEXT] = 0xdb;
    ram[TEXT + 1] = 0x0f;
    const img = renderMode(0x03, read);
    assert.equal(img.width, 720);
    for (const x of [0, 7, 8]) {
        assert.deepEqual(px(img, x, 0), WHITE,
            `column ${x} of the block is lit -- block art must tile with no seam at column 8`);
    }
    assert.deepEqual(px(img, 0, 15), WHITE, 'and all sixteen rows of it');
    assert.deepEqual(px(img, 9, 0), BLACK, 'the neighbouring cell is untouched');
});

test('attribute bit 7 is blink OR background intensity, and the caller decides which', () => {
    const { ram, read } = mem();
    ram[TEXT] = 0x20;                 // a space: the cell is its background
    ram[TEXT + 1] = 0x87;             // fg 7, and bit 7 set

    const blinking = renderMode(0x03, read, { cellW: 8, cellH: 8 });
    assert.deepEqual(px(blinking, 0, 0), BLACK,
        'with blink enabled (the BIOS default) the background is clamped to 0-7, so 8h reads as 0h');

    const bright = renderMode(0x03, read, { cellW: 8, cellH: 8, blink: false });
    assert.deepEqual(px(bright, 0, 0), DARKGREY,
        'with blink disabled the same byte means background 8h -- dark grey, a colour blink cannot reach');

    ram[TEXT] = 0xdb;                 // a full block, so the glyph is visible
    const on = renderMode(0x03, read, { cellW: 8, cellH: 8, blinkOn: true });
    const off = renderMode(0x03, read, { cellW: 8, cellH: 8, blinkOn: false });
    assert.deepEqual(px(on, 0, 0), GREY, 'on the lit phase a blinking cell shows its foreground');
    assert.deepEqual(px(off, 0, 0), BLACK,
        'on the dark phase it renders entirely in its background -- the phase is the caller\'s, not the clock\'s');
});

// ---- mode 13h --------------------------------------------------------

test('a mode 13h pixel takes its byte as a palette index, in order, with no packing', () => {
    const { ram, read } = mem();
    ram[GRAPH + 3 * 320 + 17] = 42;
    ram[GRAPH + 3 * 320 + 18] = 6;
    ram[GRAPH] = 15;
    const img = renderMode(0x13, read);

    assert.equal(img.width, 320);
    assert.equal(img.height, 200);
    assert.equal(img.rgba.length, 320 * 200 * 4);
    assert.deepEqual(px(img, 17, 3), [255, 125, 0, 255],
        'byte 42 selects DAC entry 42 = (63,31,0) six-bit, which expands to (255,125,0)');
    assert.deepEqual(px(img, 18, 3), BROWN, 'byte 6 selects brown, not olive');
    assert.deepEqual(px(img, 0, 0), WHITE, 'byte 15 at A000:0000 is the top-left pixel');
    assert.deepEqual(px(img, 1, 0), BLACK, 'untouched memory is palette entry 0');
});

test('a reprogrammed DAC is honoured, in the six-bit units the hardware register holds', () => {
    const { ram, read } = mem();
    ram[GRAPH] = 1;
    const dac = Uint8Array.from(DEFAULT_DAC);
    dac[3] = 63; dac[4] = 0; dac[5] = 0;              // entry 1 := full red
    const img = renderMode(0x13, read, { dac });
    assert.deepEqual(px(img, 0, 0), [255, 0, 0, 255],
        'entry 1 was rewritten to 3Fh,00h,00h, so the pixel is full red rather than CGA blue');
});

// ---- modes 4 and 5, the interleave -----------------------------------

test('a mode 4 pixel on an ODD scanline comes from the +2000h bank', () => {
    const { ram, read } = mem();
    // The odd bank, first byte: pixel value 3 in the leftmost pixel pair.
    ram[TEXT + BANK] = 0xc0;
    // The byte a naive `y * 80` renderer would have used for row 1. It
    // belongs to row 2, and if it shows up on row 1 the interleave is
    // missing.
    ram[TEXT + 80] = 0x40;            // pixel value 1 in the leftmost pair
    const img = renderMode(0x04, read);

    assert.deepEqual(px(img, 0, 1), BROWN,
        'row 1 is ODD, so its bytes live at B800:2000 -- value 3 of palette 0 is brown');
    assert.deepEqual(px(img, 0, 0), BLACK,
        'row 0 is EVEN and its bank is still empty, which is what proves row 1 did not read row 0');
    assert.deepEqual(px(img, 0, 2), GREEN,
        'the byte at +0050h is row 2, not row 1: even rows step 80 bytes for every TWO scanlines');
    assert.deepEqual(px(img, 0, 3), BLACK, 'and row 3 reads +2050h, which is untouched');
});

test('mode 4 packs four pixels per byte with the leftmost in the HIGH bits', () => {
    const { ram, read } = mem();
    ram[TEXT] = 0x1b;                 // 00 01 10 11
    const img = renderMode(0x04, read);
    assert.deepEqual(px(img, 0, 0), BLACK, 'bits 7-6 are pixel 0: value 0, the background');
    assert.deepEqual(px(img, 1, 0), GREEN, 'bits 5-4 are pixel 1: value 1');
    assert.deepEqual(px(img, 2, 0), RED, 'bits 3-2 are pixel 2: value 2');
    assert.deepEqual(px(img, 3, 0), BROWN, 'bits 1-0 are pixel 3: value 3');
});

test('all four mode 4/5 palette selections, plus the background register', () => {
    const { ram, read } = mem();
    ram[TEXT] = 0x1b;                 // pixel values 0, 1, 2, 3

    const p0 = renderMode(0x04, read);
    assert.deepEqual([px(p0, 1, 0), px(p0, 2, 0), px(p0, 3, 0)], [GREEN, RED, BROWN],
        'palette 0 at normal intensity is green / red / brown');

    const p0i = renderMode(0x04, read, { intensity: true });
    assert.deepEqual(px(p0i, 1, 0), LTGREEN, 'palette 0 intensified starts at light green');
    assert.deepEqual(px(p0i, 3, 0), YELLOW, 'and its third colour is yellow, not brown');

    const p1 = renderMode(0x04, read, { cgaPalette: 1 });
    assert.deepEqual([px(p1, 1, 0), px(p1, 2, 0), px(p1, 3, 0)],
        [[0, 170, 170, 255], [170, 0, 170, 255], GREY],
        'palette 1 at normal intensity is cyan / magenta / light grey');

    const p1i = renderMode(0x04, read, { cgaPalette: 1, intensity: true });
    assert.deepEqual(px(p1i, 3, 0), WHITE, 'palette 1 intensified reaches white');

    const m5 = renderMode(0x05, read);
    assert.deepEqual([px(m5, 1, 0), px(m5, 2, 0), px(m5, 3, 0)], [[0, 170, 170, 255], RED, GREY],
        'mode 5 is not monochrome: disabling the colour burst selects a THIRD palette, cyan / red / grey');

    const bg = renderMode(0x04, read, { background: 1 });
    assert.deepEqual(px(bg, 0, 0), BLUE,
        'pixel value 0 is the border/background field of port 3D9h, so all sixteen colours reach it');
    assert.deepEqual(px(bg, 1, 0), GREEN, 'and it does not disturb colours 1-3');
});

// ---- mode 6 ----------------------------------------------------------

test('mode 6 is one bit per pixel, bit 7 leftmost, on the same interleave', () => {
    const { ram, read } = mem();
    ram[TEXT + BANK] = 0x81;          // bits 7 and 0
    const img = renderMode(0x06, read);

    assert.equal(img.width, 640);
    assert.equal(img.height, 200);
    assert.deepEqual(px(img, 0, 1), WHITE, 'bit 7 is the leftmost pixel of the byte');
    assert.deepEqual(px(img, 7, 1), WHITE, 'bit 0 is the eighth');
    assert.deepEqual(px(img, 3, 1), BLACK, 'the six bits between are clear');
    assert.deepEqual(px(img, 0, 0), BLACK,
        'and row 1 came from the +2000h bank, so the even row above it is still blank');

    const tinted = renderMode(0x06, read, { foreground: 10 });
    assert.deepEqual(px(tinted, 0, 1), LTGREEN,
        'the "white" of mode 6 is the colour field of port 3D9h and can be tinted');
});

// ---- purity ----------------------------------------------------------

test('rendering writes nothing and reads nothing outside the mode window', () => {
    const { ram } = mem();
    for (let i = 0; i < 0x100000; i += 7919) ram[i] = i & 0xff;    // some texture
    const before = Uint8Array.from(ram);

    const cases = [
        [0x13, GRAPH, GRAPH + 320 * 200],
        [0x04, TEXT, TEXT + BANK + 100 * 80],
        [0x06, TEXT, TEXT + BANK + 100 * 80],
        [0x03, TEXT, TEXT + 80 * 25 * 2],
    ];
    for (const [mode, lo, hi] of cases) {
        let min = Infinity, max = -Infinity;
        renderMode(mode, (a) => { if (a < min) min = a; if (a > max) max = a; return ram[a]; });
        assert.ok(min >= lo && max < hi,
            `mode ${mode.toString(16)}h read only ${lo.toString(16)}h..${hi.toString(16)}h,`
            + ` not ${min.toString(16)}h..${max.toString(16)}h`);
    }
    assert.deepEqual(ram, before, 'renderMode is a pure function of memory: it never writes');
});

test('opts.base relocates the framebuffer, which is how a display page is reached', () => {
    const { ram, read } = mem();
    ram[TEXT + 0x1000] = 0xdb;
    ram[TEXT + 0x1000 + 1] = 0x0f;
    const page0 = renderMode(0x03, read, { cellW: 8, cellH: 8 });
    const page1 = renderMode(0x03, read, { cellW: 8, cellH: 8, base: TEXT + 0x1000 });
    assert.deepEqual(px(page0, 0, 0), BLACK, 'page 0 is empty');
    assert.deepEqual(px(page1, 0, 0), WHITE,
        'page 1 of mode 3 lives 1000h further on; there is no page register, so base is the way in');
});

// ---- the font table --------------------------------------------------

test('the font is memoised per cell size and generated for CP437 semigraphics', () => {
    assert.equal(buildFont(8, 8), buildFont(8, 8), 'the same cell size returns the same table');
    assert.notEqual(buildFont(8, 8), buildFont(9, 16), 'a different cell size is a different table');

    const f = buildFont(8, 8);
    const row = (code, y) => f[code * 8 + y];
    assert.equal(row(0xdb, 0), 0xff, 'DBh is a solid block');
    assert.equal(row(0xdf, 0), 0xff, 'DFh is solid on its top row');
    assert.equal(row(0xdf, 7), 0x00, 'and empty on its bottom row');
    assert.equal(row(0xdd, 0) | row(0xde, 0), 0xff,
        'the left and right half blocks tile with no overlap and no gap');
    assert.equal(row(0xdd, 0) & row(0xde, 0), 0x00, 'and they do not overlap');
    // C4h is a single horizontal rule: one full row, nothing else.
    const c4 = [...Array(8).keys()].map((y) => row(0xc4, y));
    assert.equal(c4.filter((v) => v === 0xff).length, 1, 'C4h has exactly one solid row');
    // CEh is the double cross, whose defining feature is the HOLE.
    assert.equal(row(0xce, 4) & (1 << 4), 0,
        'CEh leaves the centre of the cross empty -- double crossing double is the only broken junction');
    assert.notEqual(row(0xd8, 4) & (1 << 4), 0,
        'D8h crosses a single vertical through a double horizontal and must NOT be broken');
});

// ---- which mode is on screen? ---------------------------------------

test('likelyMode reads the last AH=00h call and masks the no-clear flag', () => {
    assert.deepEqual(likelyMode().mode, 0x03,
        'a program that never set a mode is in the power-on text mode');
    assert.ok(likelyMode().supported);

    assert.equal(likelyMode([0x13]).mode, 0x13);
    assert.equal(likelyMode([0x03, 0x04, 0x13]).mode, 0x13, 'the LAST mode set is the one on screen');

    const noClear = likelyMode([0x83]);
    assert.equal(noClear.mode, 0x03,
        'AL bit 7 means "do not clear the display", so AL=83h is mode 3 -- not an unknown mode');
    assert.ok(noClear.supported);
    assert.match(noClear.reason, /bit 7/);

    const ega = likelyMode([0x10]);
    assert.equal(ega.supported, false);
    assert.match(ega.reason, /planar/, 'the EGA modes are refused by name, not rendered as rubbish');
    assert.equal(likelyMode([0x07]).supported, false, 'mode 7 is MDA at B0000h and is not modelled');

    assert.equal(likelyMode([], { fallback: 0x13 }).mode, 0x13, 'the fallback is the caller\'s');
});

test('an unrenderable mode throws with the reason, rather than drawing noise', () => {
    const { read } = mem();
    assert.throws(() => renderMode(0x10, read), /planar/,
        'a planar EGA mode says what it is instead of producing a plausible-looking wrong picture');
    assert.throws(() => renderMode(0x99, read), /not rendered/);
    assert.equal(modeInfo(0x10), null);
});
