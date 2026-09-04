// The BIOS ROM's graphics services, asserted on PIXELS.
//
// Not "the mode byte changed" and not "a port was written": the ROM image is
// loaded at F0000h, the CPU is reset, POST runs, and then a program assembled
// by the tier's own assembler calls INT 10h the way a program calls it. What
// comes back out is a rendered frame from `createDebugTarget('i8086')` --
// width, height and RGBA -- and the assertions are on individual pixels and
// on the bytes of video memory underneath them.
//
// WHY PIXELS AND NOT THE MODE REGISTER. Every interesting bug in a graphics
// BIOS still writes SOMETHING. Get the CGA scanline interleave wrong and the
// picture appears in half-height stripes; get the bit order wrong and it
// mirrors within each group of four; get the packing wrong and it smears.
// All three set the mode byte correctly and all three light up A pixel, so a
// test that stops at "a byte changed" passes for every one of them. The
// neighbour assertions are the other half of that: an off-by-one in the
// interleave lights the right pixel AND a wrong one.
//
// TWO MACHINES, and the second is not a convenience. CGACard models 3D8h and
// 3D9h and explicitly does NOT model the 6845 -- so on a CGA machine the
// twenty-eight CRTC writes a mode set makes are unobservable, and an
// unobservable property is one nothing can test. VGACard DOES latch the
// index/data pair at 3D4h/3D5h, and it is the same pair the 6845 answers on,
// because that is how an EGA and a VGA stayed compatible. So the CRTC
// programming is tested by setting a CGA mode on a machine whose display card
// happens to be a VGA, which is a real configuration and reads back real
// latches.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDebugTarget } from '../src/debug-target-factory.js';
import { assembleRaw } from '../src/i8086-asm.js';
import { renderMode } from '../src/i8086-cga.js';
import { buildBios } from '../scripts/build-bios.mjs';

const rom = buildBios().bytes;

/** The XT this ROM is written for, plus memory behind the CGA aperture. */
const CGAPC = {
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x9ffff },
        { kind: 'ram', start: 0xb8000, end: 0xbffff },   // the CGA aperture
        { kind: 'rom', start: 0xf0000, end: 0xfffff },
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },
        { kind: 'ppi', name: 'ppi1', at: 0x60 },
        { kind: 'cga', name: 'cga1', at: 0x3d0 },
    ],
};

/** The same machine with a VGA in the slot: 3C0h-3DFh, and 64K at A0000h. */
const VGAPC = {
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x9ffff },
        { kind: 'ram', start: 0xa0000, end: 0xaffff },   // mode 13h, linear
        { kind: 'ram', start: 0xb8000, end: 0xbffff },
        { kind: 'rom', start: 0xf0000, end: 0xfffff },
    ],
    chips: [
        { kind: 'pic', name: 'pic1', at: 0x20 },
        { kind: 'pit', name: 'pit1', at: 0x40, irq: 0 },
        { kind: 'ppi', name: 'ppi1', at: 0x60 },
        { kind: 'vga', name: 'vga1', at: 0x3c0 },
    ],
};

const VRAM = 0xb8000;
const VRAM13 = 0xa0000;
const BDA = 0x400;
const PROG = 0x0600;            // below the boot sector, above the BDA

/**
 * A board that answers the adapter and nothing else.
 *
 * NOT OPTIONAL, and not this test's choice. createDebugTarget('i8086')
 * defaults the board to `{ advanceTo() {} }`, and the adapter's onPinChange
 * hook calls `board.setPin(...)` on the first 8255 output edge -- which POST
 * causes the instant it writes the PPI control word. So a target created
 * without a board throws `board.setPin is not a function` before the machine
 * has drawn anything. Reported to the debug-target lane; a two-line stub is
 * the workaround here.
 */
const NULL_BOARD = { advanceTo() {}, setPin() {} };

/** Reset a machine with the ROM in it and let POST run to its HLT. */
async function booted(config = CGAPC) {
    const { target, adapter } = await createDebugTarget('i8086', { config, rom, board: NULL_BOARD });
    const m = adapter.machine;
    let n = 0;
    while (n < 3_000_000 && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, 'POST ran off the end without halting');
    return { target, m };
}

/** Assemble a fragment, load it, run it to its HLT. How a program calls. */
function run(m, source, cap = 3_000_000) {
    const code = assembleRaw(`${source}\n hlt\n`, 0);
    m.mem.set(code, PROG);
    m.cpu.cs = 0; m.cpu.ip = PROG;
    m.cpu.ss = 0; m.cpu.sp = 0x7000;
    m.cpu.ds = 0; m.cpu.es = 0;
    m.cpu.halted = false;
    m.cpu.flags |= 0x0200;
    let n = 0;
    while (n < cap && !m.cpu.halted) { m.step(); n++; }
    assert.ok(m.cpu.halted, `the injected program did not reach its HLT in ${cap} steps`);
}

const rd8 = (m, a) => m.mem[a];
const rd16 = (m, a) => m.mem[a] | (m.mem[a + 1] << 8);

/** One pixel of a rendered frame, as [r, g, b]. */
function px(frame, x, y) {
    assert.ok(x >= 0 && x < frame.width && y >= 0 && y < frame.height,
        `(${x},${y}) is outside the ${frame.width}x${frame.height} frame`);
    const o = (y * frame.width + x) * 4;
    return [frame.rgba[o], frame.rgba[o + 1], frame.rgba[o + 2]];
}

// The sixteen RGBI colours as the monitor shows them, stated here
// INDEPENDENTLY of the renderer's table: a channel is 42/63 of full when its
// bit is set (dark/bright) and 0/21 when it is not, and the six-bit DAC value
// is widened to eight by repeating its top two bits. Colour 6 is brown --
// green pulled down -- and colour 14 is plain yellow.
const exp6 = (v) => ((v << 2) | (v >> 4)) & 0xff;
function rgbi(i) {
    const on = (i & 8) ? 63 : 42, off = (i & 8) ? 21 : 0;
    const r = (i & 4) ? on : off;
    const g = i === 6 ? 21 : ((i & 2) ? on : off);
    const b = (i & 1) ? on : off;
    return [exp6(r), exp6(g), exp6(b)];
}
const BLACK = rgbi(0);

// ---------------------------------------------------------------------------
// Setting a graphics mode.
// ---------------------------------------------------------------------------

test('mode 4 clears the whole aperture and gives the BDA a graphics geometry', async () => {
    const { target, m } = await booted();
    // Dirty every corner of both interleaved banks first, so "cleared" means
    // cleared and not "was already zero".
    for (const a of [VRAM, VRAM + 0x1fff, VRAM + 0x2000, VRAM + 0x3fff]) m.mem[a] = 0xa5;

    run(m, ' mov ax, 0004h\n int 10h\n');

    assert.equal(rd8(m, BDA + 0x49), 0x04, '40:49h is the current mode');
    // 320 pixels IS forty eight-pixel character cells, and DOS-era code reads
    // 40:4Ah to position text on a graphics screen. 80 would be the text
    // answer carried over, which is the bug this asserts against.
    assert.equal(rd16(m, BDA + 0x4a), 40, '40:4Ah: 320 pixels is 40 columns');
    assert.equal(rd16(m, BDA + 0x4c), 0x4000, '40:4Ch: a graphics page is the 16K aperture');
    for (const a of [VRAM, VRAM + 0x1fff, VRAM + 0x2000, VRAM + 0x3fff]) {
        assert.equal(m.mem[a], 0, `${a.toString(16)}h was not cleared`);
    }
    // 3D8h: graphics (bit 1) and video enabled (bit 3), 320-wide (bit 4 clear).
    const st = m.chips.cga1.getVideoState();
    assert.equal(st.mode & 0x1a, 0x0a, `3D8h = ${st.mode.toString(16)}h`);
    const f = target.video();
    assert.equal(f.mode, 0x04);
    assert.equal(f.width, 320);
    assert.equal(f.height, 200);
});

test('mode 6 is 640 wide and says so in the BDA and at 3D8h', async () => {
    const { target, m } = await booted();
    run(m, ' mov ax, 0006h\n int 10h\n');
    assert.equal(rd8(m, BDA + 0x49), 0x06);
    assert.equal(rd16(m, BDA + 0x4a), 80, '640 pixels is 80 columns');
    assert.equal(rd16(m, BDA + 0x4c), 0x4000);
    assert.equal(m.chips.cga1.getVideoState().mode & 0x1a, 0x1a, '3D8h bit 4: 640x200');
    const f = target.video();
    assert.equal(f.mode, 0x06);
    assert.equal(f.width, 640);
    assert.equal(f.height, 200);
});

test('mode 5 is a distinct mode and not mode 4 with a different number', async () => {
    const { target, m } = await booted();
    run(m, ' mov ax, 0005h\n int 10h\n'
        + ' mov ax, 0C02h\n mov cx, 4\n mov dx, 0\n int 10h\n');
    // 3D8h bit 2 is the bit that tells them apart on the wire.
    assert.equal(m.chips.cga1.getVideoState().mode & 0x1e, 0x0e, '3D8h bit 2 set: mode 5');
    assert.equal(target.video().mode, 0x05);
    // And they really look different. "Colour burst off" is not monochrome on
    // an RGBI monitor: it selects a THIRD four-colour palette, cyan/red/white,
    // so colour 2 is red here where mode 4 would have made it magenta.
    assert.deepEqual(px(target.video(), 4, 0), rgbi(12), 'mode 5 colour 2 is bright red');
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C02h\n mov cx, 4\n mov dx, 0\n int 10h\n');
    assert.deepEqual(px(target.video(), 4, 0), rgbi(13), 'mode 4 colour 2 is bright magenta');
});

test('each mode gets the colour-select value its own bits mean', async () => {
    const { m } = await booted();
    // 3D9h is write-only on the card, so the latch is the only evidence --
    // and the two families read the low nibble differently, which is why one
    // constant for all of them would be wrong for one of them.
    run(m, ' mov ax, 0004h\n int 10h\n');
    assert.equal(m.chips.cga1.getVideoState().color, 0x30,
        '320x200: black background, bright cyan/magenta/white');
    assert.equal(m.mem[BDA + 0x66], 0x30, 'and 40:66h agrees with the port');
    run(m, ' mov ax, 0006h\n int 10h\n');
    assert.equal(m.chips.cga1.getVideoState().color, 0x3f,
        '640x200: the low nibble is the FOREGROUND, so white on black');
    assert.equal(m.mem[BDA + 0x66], 0x3f);
});

test('AL bit 7 keeps the picture; without it a mode set wipes it', async () => {
    const { m } = await booted();
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C03h\n mov cx, 8\n mov dx, 4\n int 10h\n');   // one white pixel
    const drawn = m.mem[VRAM + 2 * 80 + 2];
    assert.notEqual(drawn, 0, 'nothing was drawn, so this test proves nothing');
    run(m, ' mov ax, 0084h\n int 10h\n');                          // 04h + "keep"
    assert.equal(m.mem[VRAM + 2 * 80 + 2], drawn, 'AL bit 7 must not clear');
    run(m, ' mov ax, 0004h\n int 10h\n');
    assert.equal(m.mem[VRAM + 2 * 80 + 2], 0, 'without bit 7 it must clear');
});

// ---------------------------------------------------------------------------
// The 6845. Observable only on a machine whose card decodes 3D4h/3D5h.
// ---------------------------------------------------------------------------

test('a mode set programs the CRTC, not just the mode register', async () => {
    const { m } = await booted(VGAPC);
    const crtc = m.chips.vga1.crtc;

    run(m, ' mov ax, 0003h\n int 10h\n');
    // 80-column text: 114 character times to a line (R0 holds total-1), 80 of
    // them displayed, 32 rows of 8 scan lines (R9 holds lines-1), 25 shown.
    assert.equal(crtc[0], 113, 'R0: 80-column horizontal total');
    assert.equal(crtc[1], 80, 'R1: displayed characters');
    assert.equal(crtc[6], 25, 'R6: displayed rows');
    assert.equal(crtc[9], 7, 'R9: eight scan lines to a character row');

    run(m, ' mov ax, 0004h\n int 10h\n');
    // Graphics: the 40-column horizontal timings, and rows of TWO scan lines.
    // R9 is the register the interleave exists because of -- 100 rows of two
    // lines is 200 -- so a mode set that leaves it at 7 displays a graphics
    // buffer through a text raster.
    assert.equal(crtc[0], 56, 'R0: the halved dot clock gives 57 character times');
    assert.equal(crtc[1], 40, 'R1: 320 pixels is 40 characters');
    assert.equal(crtc[4], 127, 'R4: 128 character rows to a frame');
    assert.equal(crtc[6], 100, 'R6: 100 displayed rows of two lines each');
    assert.equal(crtc[9], 1, 'R9: TWO scan lines to a character row');
    assert.equal(crtc[12], 0, 'R12/R13: a mode set puts the start address back to 0');
    assert.equal(crtc[13], 0);

    run(m, ' mov ax, 0001h\n int 10h\n');
    assert.equal(crtc[0], 56, 'R0: 40-column text shares the graphics horizontal timing');
    assert.equal(crtc[9], 7, '...but not its character height');
});

// ---------------------------------------------------------------------------
// The interleave. The bug that still draws.
// ---------------------------------------------------------------------------

test('an odd scan line lands in the second bank, not 8000 bytes further down', async () => {
    const { target, m } = await booted();
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C03h\n mov cx, 0\n mov dx, 1\n int 10h\n');   // (0,1), colour 3

    // Row 1 is row 0 of the ODD bank: B800:2000. The wrong answer -- 1*80 --
    // is B800:0050, and it renders as a pixel on row 2 of the picture.
    assert.equal(m.mem[VRAM + 0x2000], 0xc0, 'colour 3 in the top bit pair of the odd bank');
    assert.equal(m.mem[VRAM + 80], 0, 'nothing may land at y*80');
    assert.equal(m.mem[VRAM], 0, 'nor in the even bank');

    const f = target.video();
    assert.deepEqual(px(f, 0, 1), rgbi(15), '(0,1) is the pixel that was asked for');
    assert.deepEqual(px(f, 0, 0), BLACK, 'and (0,0) is not');
    assert.deepEqual(px(f, 0, 2), BLACK, 'nor (0,2)');
    assert.deepEqual(px(f, 1, 1), BLACK, 'nor its neighbour along');
});

test('the two banks stay separate all the way down the screen', async () => {
    const { target, m } = await booted();
    // The last row of each bank: y=198 is row 99 of the even bank, y=199 is
    // row 99 of the odd one. Both land in the last 80 bytes of their 8K, and
    // a version that multiplied y by 80 would have run off the end at y=103.
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 316\n mov dx, 198\n int 10h\n'
        + ' mov ax, 0C02h\n mov cx, 316\n mov dx, 199\n int 10h\n');
    assert.equal(m.mem[VRAM + 99 * 80 + 79], 0x40, 'y=198: even bank, last row');
    assert.equal(m.mem[VRAM + 0x2000 + 99 * 80 + 79], 0x80, 'y=199: odd bank, last row');
    const f = target.video();
    assert.deepEqual(px(f, 316, 198), rgbi(11));
    assert.deepEqual(px(f, 316, 199), rgbi(13));
    assert.deepEqual(px(f, 317, 198), BLACK);
    assert.deepEqual(px(f, 316, 197), BLACK);
});

// ---------------------------------------------------------------------------
// The bit packing.
// ---------------------------------------------------------------------------

test('x = 0,1,2,3 share one byte, left to right, high bits first', async () => {
    const { target, m } = await booted();
    let src = ' mov ax, 0004h\n int 10h\n';
    // Four different colours across the four pixels of one byte. If the
    // shifts were reversed the byte would come out 1Bh instead of E4h and
    // the picture would be mirrored inside every group of four.
    for (const [x, c] of [[0, 3], [1, 2], [2, 1], [3, 0]]) {
        src += ` mov ax, 0C0${c}h\n mov cx, ${x}\n mov dx, 0\n int 10h\n`;
    }
    run(m, src);
    assert.equal(m.mem[VRAM], 0xe4, '11 10 01 00 -- leftmost pixel in the high pair');
    assert.equal(m.mem[VRAM + 1], 0, 'x=4 would be the next byte and nothing went there');

    const f = target.video();
    assert.deepEqual(px(f, 0, 0), rgbi(15), 'x=0 is colour 3');
    assert.deepEqual(px(f, 1, 0), rgbi(13), 'x=1 is colour 2');
    assert.deepEqual(px(f, 2, 0), rgbi(11), 'x=2 is colour 1');
    assert.deepEqual(px(f, 3, 0), BLACK, 'x=3 is colour 0, the background');
});

test('mode 6 packs eight pixels to a byte, so its bytes hold twice the screen', async () => {
    const { target, m } = await booted();
    // The SAME x lands in a different byte in the two modes, which is the
    // whole difference between a 320-wide and a 640-wide addressing.
    run(m, ' mov ax, 0006h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 8\n mov dx, 0\n int 10h\n');
    assert.equal(m.mem[VRAM + 1], 0x80, 'mode 6: x=8 is bit 7 of byte 1');
    assert.equal(m.mem[VRAM], 0, 'byte 0 is x=0..7');

    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 8\n mov dx, 0\n int 10h\n');
    assert.equal(m.mem[VRAM + 2], 0x40, 'mode 4: the same x=8 is byte 2, bits 7-6');
    assert.equal(m.mem[VRAM + 1], 0, 'and byte 1 is untouched');

    // ...and the far edge of a 640-wide screen exists at all.
    run(m, ' mov ax, 0006h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 639\n mov dx, 199\n int 10h\n');
    assert.equal(m.mem[VRAM + 0x2000 + 99 * 80 + 79], 0x01, 'x=639 is bit 0 of the last byte');
    const f = target.video();
    assert.equal(f.width, 640);
    assert.deepEqual(px(f, 639, 199), rgbi(15));
    assert.deepEqual(px(f, 638, 199), BLACK);
});

// ---------------------------------------------------------------------------
// AH=0Dh, and the round trip.
// ---------------------------------------------------------------------------

test('AH=0Dh reads back what AH=0Ch wrote, four colours by two parities', async () => {
    const { m } = await booted();
    // Sixteen plots and sixteen reads, driven entirely by the ROM: the
    // colours land in RAM at 0500h and the test only compares.
    let src = ' mov ax, 0004h\n int 10h\n';
    let slot = 0;
    const want = [];
    for (const y of [0, 1, 42, 43]) {
        for (const c of [0, 1, 2, 3]) {
            const x = 40 + c;               // four colours inside ONE byte
            src += ` mov ax, 0C0${c}h\n mov cx, ${x}\n mov dx, ${y}\n int 10h\n`;
            want.push({ x, y, c, slot: slot++ });
        }
    }
    for (const w of want) {
        src += ` mov ah, 0Dh\n mov cx, ${w.x}\n mov dx, ${w.y}\n int 10h\n`
            + ` mov si, ${0x500 + w.slot}\n mov [si], al\n`;
    }
    run(m, src);
    for (const w of want) {
        assert.equal(m.mem[0x500 + w.slot], w.c,
            `(${w.x},${w.y}) was written ${w.c} and read back ${m.mem[0x500 + w.slot]}`);
    }
});

test('AH=0Dh in mode 6 reads the one bit, not the byte around it', async () => {
    const { m } = await booted();
    run(m, ' mov ax, 0006h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 100\n mov dx, 7\n int 10h\n'
        + ' mov ah, 0Dh\n mov cx, 100\n mov dx, 7\n int 10h\n mov [0500h], al\n'
        + ' mov ah, 0Dh\n mov cx, 101\n mov dx, 7\n int 10h\n mov [0501h], al\n'
        + ' mov ah, 0Dh\n mov cx, 100\n mov dx, 6\n int 10h\n mov [0502h], al\n');
    assert.equal(m.mem[0x500], 1, 'the pixel that was set');
    assert.equal(m.mem[0x501], 0, 'its neighbour in the same byte');
    assert.equal(m.mem[0x502], 0, 'the same column on the other bank');
});

test('a coordinate off the screen writes nothing and reads zero', async () => {
    const { m } = await booted();
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C03h\n mov cx, 320\n mov dx, 0\n int 10h\n'      // x = width
        + ' mov ax, 0C03h\n mov cx, 0\n mov dx, 200\n int 10h\n'      // y = height
        + ' mov al, 7\n mov ah, 0Dh\n mov cx, 400\n mov dx, 0\n int 10h\n mov [0500h], al\n');
    assert.equal(m.mem[0x500], 0, 'off the screen reads as nothing there');
    for (let i = 0; i < 0x4000; i++) {
        assert.equal(m.mem[VRAM + i], 0, `an off-screen plot wrote to ${(VRAM + i).toString(16)}h`);
    }
});

// ---------------------------------------------------------------------------
// The XOR flag.
// ---------------------------------------------------------------------------

test('bit 7 of AL toggles rather than sets, and a second write undoes it', async () => {
    const { target, m } = await booted();
    // Paint a background of colour 1, then XOR colour 3 over it twice. If bit
    // 7 were treated as part of the colour, or as a plain store, the first
    // XOR would leave 3 and the second would leave 3 again -- never 2, and
    // never back to 1.
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 12\n mov dx, 5\n int 10h\n'
        + ' mov ah, 0Dh\n mov cx, 12\n mov dx, 5\n int 10h\n mov [0500h], al\n'
        + ' mov ax, 0C83h\n mov cx, 12\n mov dx, 5\n int 10h\n'
        + ' mov ah, 0Dh\n mov cx, 12\n mov dx, 5\n int 10h\n mov [0501h], al\n'
        + ' mov ax, 0C83h\n mov cx, 12\n mov dx, 5\n int 10h\n'
        + ' mov ah, 0Dh\n mov cx, 12\n mov dx, 5\n int 10h\n mov [0502h], al\n');
    assert.equal(m.mem[0x500], 1, 'the background this sprite is drawn over');
    assert.equal(m.mem[0x501], 2, '1 XOR 3 = 2, which a plain store would have made 3');
    assert.equal(m.mem[0x502], 1, 'drawn again, the background comes back exactly');
    const f = target.video();
    assert.deepEqual(px(f, 12, 5), rgbi(11), 'and the picture agrees');
});

test('XOR touches only its own pixel inside a shared byte', async () => {
    const { m } = await booted();
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C03h\n mov cx, 0\n mov dx, 0\n int 10h\n'
        + ' mov ax, 0C03h\n mov cx, 1\n mov dx, 0\n int 10h\n'
        + ' mov ax, 0C03h\n mov cx, 2\n mov dx, 0\n int 10h\n'
        + ' mov ax, 0C03h\n mov cx, 3\n mov dx, 0\n int 10h\n'
        + ' mov ax, 0C82h\n mov cx, 1\n mov dx, 0\n int 10h\n');
    // FFh with 10b XORed into pixel 1: 11 01 11 11 = DFh.
    assert.equal(m.mem[VRAM], 0xdf, 'the other three pixels of the byte are untouched');
});

// ---------------------------------------------------------------------------
// AH=0Bh, the palette.
// ---------------------------------------------------------------------------

test('AH=0Bh BH=0 repaints the background without disturbing the palette', async () => {
    const { target, m } = await booted();
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 4\n mov dx, 0\n int 10h\n');
    let f = target.video();
    assert.deepEqual(px(f, 0, 0), BLACK, 'the untouched screen starts black');
    assert.deepEqual(px(f, 4, 0), rgbi(11), 'palette 1 bright: colour 1 is bright cyan');

    // BL IS FIVE BITS WIDE, not four, and the fifth is the foreground
    // intensity. Bits 0-3 are the background as IRGB (colour 4 is red) and
    // bit 4 brightens the four-colour palette, so 14h means "red background,
    // bright palette" -- and 04h would mean "red background, and while you
    // are there turn the palette dim". That is the register's own layout and
    // the reason this service takes 0-31 rather than 0-15.
    run(m, ' mov ax, 0B00h\n mov bx, 0014h\n int 10h\n');
    f = target.video();
    assert.deepEqual(px(f, 0, 0), rgbi(4), 'colour 0 IS the background register');
    assert.deepEqual(px(f, 4, 0), rgbi(11), 'and bit 5, the palette, was not disturbed');
    assert.equal(m.mem[BDA + 0x66], 0x34, '40:66h: the palette bit kept, the field replaced');

    // The same call with bit 4 clear really does dim the palette, which is
    // the hardware's answer and not an oversight in the service.
    run(m, ' mov ax, 0B00h\n mov bx, 0004h\n int 10h\n');
    assert.deepEqual(px(target.video(), 4, 0), rgbi(3), 'bit 4 clear: the dim cyan');
});

test('AH=0Bh BH=1 switches the four-colour palette without losing the background', async () => {
    const { target, m } = await booted();
    run(m, ' mov ax, 0004h\n int 10h\n'
        + ' mov ax, 0C01h\n mov cx, 4\n mov dx, 0\n int 10h\n'
        + ' mov ax, 0B00h\n mov bx, 0011h\n int 10h\n'          // blue bg, bright
        + ' mov ax, 0B01h\n mov bx, 0100h\n int 10h\n');        // palette 0
    const f = target.video();
    // Palette 0 with intensity is green/red/brown brightened: colour 1 is
    // bright green (0Ah). Palette 1's colour 1 was bright cyan (0Bh).
    assert.deepEqual(px(f, 4, 0), rgbi(10), 'palette 0: colour 1 is green');
    assert.deepEqual(px(f, 0, 0), rgbi(1), 'and the background set before it survived');
    assert.equal(m.mem[BDA + 0x66], 0x11, '40:66h: bit 5 cleared, the colour field kept');
});

// ---------------------------------------------------------------------------
// Mode 13h.
// ---------------------------------------------------------------------------

test('mode 13h programs the three registers that make it mode 13h', async () => {
    const { target, m } = await booted(VGAPC);
    run(m, ' mov ax, 0013h\n int 10h\n');
    const v = m.chips.vga1.getVideoState();
    assert.notEqual(v.misc, 0, 'the misc output register was written');
    assert.equal(v.gc[0x06] & 0x01, 0x01, 'graphics controller 06h bit 0: graphics');
    assert.equal((v.gc[0x06] >> 2) & 3, 1, '...with the aperture at A0000h');
    assert.equal(v.seq[0x04] & 0x08, 0x08, 'sequencer 04h bit 3: chain-4, the linear map');
    assert.equal(v.attr[0x10] & 0x40, 0x40, 'attribute 10h bit 6: 8-bit colour');
    assert.equal(v.crtc[0x09] & 0x1f, 1, 'CRTC 09h: two scan lines per row, 200 into 400');
    assert.equal(v.crtc[0x13], 40, 'CRTC 13h: the offset chain-4 turns into 320 bytes');
    assert.equal(rd8(m, BDA + 0x49), 0x13);
    assert.equal(rd16(m, BDA + 0x4a), 40, '320 pixels is 40 columns here too');
    assert.equal(rd16(m, BDA + 0x4c), 0, 'mode 13h has one page, so no page length');
    const f = target.video();
    assert.equal(f.mode, 0x13);
    assert.equal(f.width, 320);
    assert.equal(f.height, 200);
});

test('mode 13h clears its 64000 bytes and plots linearly', async () => {
    const { target, m } = await booted(VGAPC);
    for (const a of [VRAM13, VRAM13 + 31999, VRAM13 + 63999]) m.mem[a] = 0x5a;
    run(m, ' mov ax, 0013h\n int 10h\n');
    for (const a of [VRAM13, VRAM13 + 31999, VRAM13 + 63999]) {
        assert.equal(m.mem[a], 0, `${a.toString(16)}h survived the mode set`);
    }
    // NO INTERLEAVE and NO PACKING: (5,3) is byte 3*320+5 and nothing else.
    run(m, ' mov ax, 0C2Ah\n mov cx, 5\n mov dx, 3\n int 10h\n');
    assert.equal(m.mem[VRAM13 + 3 * 320 + 5], 0x2a);
    assert.equal(m.mem[VRAM13 + 3 * 320 + 4], 0, 'the byte before it is a different pixel');
    assert.equal(m.mem[VRAM13 + 3 * 320 + 6], 0, 'and so is the byte after');
    assert.equal(m.mem[VRAM13 + 0x2000 + 5], 0, 'the CGA odd bank means nothing here');
    const f = target.video();
    assert.deepEqual(px(f, 5, 3), px(f, 5, 3), 'the pixel renders');
    assert.notDeepEqual(px(f, 5, 3), BLACK, '...and is not the cleared background');
    assert.deepEqual(px(f, 4, 3), BLACK);
    assert.deepEqual(px(f, 6, 3), BLACK);
    assert.deepEqual(px(f, 5, 2), BLACK);
});

test('in mode 13h bit 7 of AL is colour, not the XOR flag', async () => {
    const { m } = await booted(VGAPC);
    // Half the palette lives above 7Fh. Treating bit 7 as a flag there would
    // make colours 80h-FFh unreachable through the service AND would XOR
    // instead of storing, which two writes would expose.
    run(m, ' mov ax, 0013h\n int 10h\n'
        + ' mov ax, 0CC8h\n mov cx, 9\n mov dx, 9\n int 10h\n'
        + ' mov ah, 0Dh\n mov cx, 9\n mov dx, 9\n int 10h\n mov [0500h], al\n'
        + ' mov ax, 0CC8h\n mov cx, 9\n mov dx, 9\n int 10h\n'
        + ' mov ah, 0Dh\n mov cx, 9\n mov dx, 9\n int 10h\n mov [0501h], al\n');
    assert.equal(m.mem[0x500], 0xc8, 'colour C8h stored as itself');
    assert.equal(m.mem[0x501], 0xc8, 'and written again it is still C8h, not 0');
});

test('mode 13h loads the default 256-colour palette, generated not stored', async () => {
    const { target, m } = await booted(VGAPC);
    // Paint every one of the 256 colours as a run of pixels, then compare the
    // frame the machine's own DAC produces against the frame the renderer's
    // independently-generated default produces. They are two implementations
    // of the same table -- one in 8086, one in JavaScript -- so agreeing on
    // all 768 six-bit values is evidence, not a tautology. If the ROM had
    // skipped the DAC the card would hold zeros and every pixel would be
    // black; if it had loaded a partial table the upper entries would be.
    let src = ' mov ax, 0013h\n int 10h\n mov bx, 0\n';
    // 256 plots would be 256 INT 10h calls; a loop is the same evidence and
    // assembles smaller.
    src += ' mov cx, 0\n mov dx, 0\n mov si, 0\n'
        + 'plot:\n'
        + ' mov ax, si\n mov ah, 0Ch\n mov cx, si\n mov dx, 100\n int 10h\n'
        + ' inc si\n cmp si, 256\n jb plot\n';
    run(m, src);

    const v = m.chips.vga1.getVideoState();
    assert.ok(v.dac.some((b) => b !== 0), 'the DAC was loaded at all');
    const f = target.video();
    const want = renderMode(0x13, (a) => m._read(a & 0xfffff), {});
    assert.deepEqual([...f.rgba], [...want.rgba],
        'the ROM-generated palette differs from the standard default table');
    // ...and spot-check the two entries a generator gets wrong: brown, and
    // its bright twin which must NOT get the correction.
    assert.deepEqual(px(f, 6, 100), rgbi(6), 'entry 6 is brown, green pulled down');
    assert.deepEqual(px(f, 14, 100), rgbi(14), 'entry 14 is plain yellow');
    assert.deepEqual(px(f, 255, 100), BLACK, 'F8h-FFh are the entries nobody defined');
});

// ---------------------------------------------------------------------------
// Text is not broken by any of this.
// ---------------------------------------------------------------------------

test('coming back to text mode restores the text geometry and raster', async () => {
    const { target, m } = await booted(VGAPC);
    run(m, ' mov ax, 0004h\n int 10h\n mov ax, 0003h\n int 10h\n');
    assert.equal(rd8(m, BDA + 0x49), 0x03);
    assert.equal(rd16(m, BDA + 0x4a), 80);
    assert.equal(rd16(m, BDA + 0x4c), 0x1000);
    assert.equal(m.chips.vga1.crtc[9], 7, 'the CRTC went back to eight-line rows');
    // And the teletype still prints through the restored geometry.
    run(m, ' mov ax, 0E48h\n mov bx, 7\n int 10h\n');
    assert.equal(m.mem[0xb8000], 0x48, 'H, at the top-left cell');
    assert.equal(target.video().mode, 0x03);
});
