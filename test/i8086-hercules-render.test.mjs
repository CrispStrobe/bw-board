// Hercules graphics: 720x348 mono at B0000h, and the reason this file exists
// is that its interleave is NOT the CGA one.
//
// CGA has TWO banks 0x2000 apart, chosen by scanline PARITY.
// HGC has FOUR banks of 8 KB, chosen by `y mod 4`, each holding every fourth
// scanline, with a 90-byte stride WITHIN the bank.
//
// Both halves have to be right. A decoder that picks the bank correctly but
// keeps the CGA's `y >> 1` stride still lights pixels; one that keeps the CGA
// two-bank rule draws a coherent, quarter-height, entirely wrong picture. That
// is the failure this file is shaped to catch, because it looks like a
// rendering bug rather than the wrong address arithmetic it is.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { renderMode } from '../src/i8086-cga.js';

const HGC = Object.freeze({
    clockHz: 4_772_727,
    regions: [
        { kind: 'ram', start: 0x00000, end: 0x9ffff },
        { kind: 'ram', start: 0xb0000, end: 0xb7fff },   // 32K: four 8K banks
        { kind: 'rom', start: 0xf0000, end: 0xfffff },
    ],
    chips: [{ kind: 'hercules', name: 'hgc', at: 0x3b0 }],
});

const BASE = 0xb0000, BANK = 0x2000, STRIDE = 90;

/** A card in graphics mode, with a writer for its framebuffer. */
function card() {
    const m = new I8086Machine(HGC);
    // 3BFh bit 0 permits graphics at all; 3B8h bit 1 selects it, bit 3 enables
    // video. Both writes are required on real hardware and this is the pair a
    // bare-metal HGC program always makes.
    m._out(0x3bf, 0x03);
    m._out(0x3b8, 0x0a);
    return {
        m,
        /** Set one byte of the framebuffer, addressed the way hardware does. */
        put: (y, byteX, val) => m._write(BASE + (y % 4) * BANK + (y >> 2) * STRIDE + byteX, val),
        frame: () => createI8086DebugTarget({ machine: m }).video(),
    };
}
const lit = (f, x, y) => f.rgba[(y * f.width + x) * 4] > 128;

test('a Hercules card in graphics mode renders 720x348 instead of refusing', () => {
    const c = card();
    const f = c.frame();
    assert.ok(!f.unsupported, `still refused: ${f.unsupported}`);
    assert.equal(f.width, 720);
    assert.equal(f.height, 348);
});

test('the four banks land on consecutive scanlines, not four rows apart', () => {
    // One lit pixel in each bank, all at x=0, on rows 0..3. If the decoder used
    // the CGA's two-bank parity rule these would collapse onto two rows.
    const c = card();
    for (let y = 0; y < 4; y++) c.put(y, 0, 0x80);
    const f = c.frame();
    for (let y = 0; y < 4; y++) assert.ok(lit(f, 0, y), `row ${y} (bank ${y}) is lit`);
    assert.ok(!lit(f, 0, 4), 'row 4 was not written and stays dark');
});

test('the stride WITHIN a bank is 90 bytes, so row 4 is bank 0 row 1', () => {
    // The half a bank-only fix gets wrong. Row 4 shares bank 0 with row 0 and
    // sits one 90-byte stride further in.
    const c = card();
    c.m._write(BASE + STRIDE, 0x80);            // bank 0, second row -> y = 4
    const f = c.frame();
    assert.ok(lit(f, 0, 4), 'the byte at BASE+90 is scanline 4');
    assert.ok(!lit(f, 0, 1), 'and NOT scanline 1, which lives in bank 1');
    assert.ok(!lit(f, 0, 0), 'nor scanline 0, which is BASE+0');
});

test('bit 7 is the leftmost pixel of its byte', () => {
    const c = card();
    c.put(0, 0, 0x81);                           // bits 7 and 0
    const f = c.frame();
    assert.ok(lit(f, 0, 0), 'bit 7 -> x=0');
    assert.ok(lit(f, 7, 0), 'bit 0 -> x=7');
    for (const x of [1, 2, 3, 4, 5, 6]) assert.ok(!lit(f, x, 0), `x=${x} dark`);
});

test('the last scanline is reachable, which pins the bank size', () => {
    // 348 rows over four banks is 87 rows each, 87 * 90 = 7830 bytes -- inside
    // an 8K bank. Row 347 is bank 3, row 86. A bank size or stride that is
    // wrong by any amount puts this byte somewhere else.
    const c = card();
    c.put(347, 0, 0x80);
    const f = c.frame();
    assert.ok(lit(f, 0, 347), 'the bottom scanline draws');
    assert.ok(!lit(f, 0, 346), 'and its neighbour does not');
});

test('Hercules is pseudo-mode 100h, NOT 06h — 06h is a different card', () => {
    // The bug this replaced: modeFromHercules returned 0x06, which the mode
    // table defines as CGA 640x200 at B8000h with two-bank parity interleave.
    // Same resolution class, different base, different arithmetic. It would
    // have drawn a coherent and entirely wrong picture from the wrong address.
    const cga6 = renderMode(0x06, () => 0);
    const hgc = renderMode(0x100, () => 0);
    assert.equal(cga6.height, 200, 'mode 6 is the 200-line CGA mode');
    assert.equal(hgc.height, 348, 'mode 100h is the 348-line Hercules one');
    assert.notEqual(cga6.width, hgc.width);
});

test('the mode register is what selects Hercules, not the card being present', () => {
    // Without the 3B8h graphics+enable bits there is no Hercules picture, and
    // a card that merely EXISTS must not produce one -- otherwise an
    // unprogrammed board is indistinguishable from a working one.
    const m = new I8086Machine(HGC);
    m._write(BASE, 0xff);
    const f = createI8086DebugTarget({ machine: m }).video();
    assert.notEqual(f.height, 348,
        'an unprogrammed card does not claim the 348-line Hercules raster');

    // WHAT IT DOES INSTEAD IS A PRE-EXISTING GAP, recorded here rather than
    // asserted as correct. With no card reporting a programmed mode, the
    // renderer falls back to 80x25 text and draws 720x400 from B8000h -- an
    // address this machine does not map, because a Hercules framebuffer lives
    // at B0000h. The result is a plausible grey screen built from open-bus
    // reads. It predates this change and belongs to the fallback path, not to
    // Hercules; pinned here so the fix has a test waiting for it, and so the
    // next reader does not mistake the grey screen for a decode bug.
    assert.equal(f.height, 400, 'today it falls back to the 720x400 text raster');
});
