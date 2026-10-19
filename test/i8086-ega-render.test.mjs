// EGA 320x200x16 planar — the only card in this tier whose framebuffer is not
// in the address space. A0000 is a WINDOW the card routes by its map mask, so
// a write lands in whichever planes the mask selects, and the renderer composes
// pixels from card state rather than from memory.
//
// FOUR PLANES, ONE BIT EACH, AT THE SAME OFFSET. A pixel's colour is bit
// (7 - (x & 7)) of the same byte in each plane, assembled low plane to high.
// Getting the plane ORDER wrong still produces a picture -- in the wrong
// colours -- which is the failure that survives review, and it is why the
// support-chip lane's demo fills FF/AA/CC/F0: any transposition changes the
// resulting sequence visibly instead of subtly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMode } from '../src/i8086-cga.js';

/** Four planes, with byte 0 of each set as the demo sets it. */
function planes([p0, p1, p2, p3]) {
    return [p0, p1, p2, p3].map((v) => {
        const a = new Uint8Array(0x10000);
        a[0] = v;
        return a;
    });
}
const px = (f, x) => [f.rgba[x * 4], f.rgba[x * 4 + 1], f.rgba[x * 4 + 2]];

test('FF/AA/CC/F0 composes to the descending ramp 15,13,11,9,7,5,3,1', () => {
    // The eyeball check the other lane built its demo around, asserted. Plane 0
    // is the LOW bit of the colour, so the first pixel takes bit 7 of each of
    // FF, AA, CC, F0 -> 1,1,1,1 -> 15, and the eighth takes bit 0 -> 1,0,0,0 -> 1.
    const f = renderMode(0x0d, () => 0, { planes: planes([0xff, 0xaa, 0xcc, 0xf0]) });
    assert.equal(f.width, 320);
    assert.equal(f.height, 200);
    // With no attribute palette supplied the colour indexes itself, so the
    // RGBrgb decode is what is under test here rather than the palette.
    const want = [15, 13, 11, 9, 7, 5, 3, 1];
    for (let x = 0; x < 8; x++) {
        const v = want[x];
        const chan = (prim, sec) => prim * 0xaa + sec * 0x55;
        assert.deepEqual(px(f, x), [
            chan((v >> 2) & 1, (v >> 5) & 1),
            chan((v >> 1) & 1, (v >> 4) & 1),
            chan(v & 1, (v >> 3) & 1),
        ], `pixel ${x} is colour ${v}`);
    }
});

test('the plane ORDER is load-bearing: swapping two changes the picture', () => {
    // A transposed decode is the bug that looks like a palette problem. Swap
    // planes 0 and 3 and the ramp inverts its bit weights rather than vanishing.
    const a = renderMode(0x0d, () => 0, { planes: planes([0xff, 0xaa, 0xcc, 0xf0]) });
    const b = renderMode(0x0d, () => 0, { planes: planes([0xf0, 0xaa, 0xcc, 0xff]) });
    // PIXEL 7, not pixel 1, and the reason is worth writing down: pixel 1 reads
    // BIT 6, where FF and F0 are both 1, so swapping those two planes changes
    // nothing there. The first draft of this test asserted on pixel 1 and
    // failed -- correctly. A test for "the order matters" has to be taken at a
    // bit where the swapped planes actually differ, which for FF against F0 is
    // bits 0-3, i.e. pixels 4-7.
    assert.notDeepEqual(px(a, 7), px(b, 7),
        'if these agreed, the decode would not be reading the planes it claims to');
    assert.deepEqual(px(a, 1), px(b, 1),
        'and pixel 1 legitimately DOES agree, because both planes carry 1 in bit 6 '
        + '-- kept as an assertion so the choice of pixel 7 above reads as deliberate');
});

test('the attribute palette is applied, and it is not a DAC', () => {
    // EGA has no DAC. Colour goes through the attribute registers, six bits as
    // RGBrgb -- two bits per channel, which is why a 16-colour EGA is not a
    // subset of a 256-colour VGA ramp. A palette that maps everything to 0
    // must render black even though the planes are full.
    const attr = new Uint8Array(16);                 // every colour -> 0
    const f = renderMode(0x0d, () => 0, { planes: planes([0xff, 0xff, 0xff, 0xff]), attr });
    assert.deepEqual(px(f, 0), [0, 0, 0], 'the palette decides, not the plane bits');
});

test('mode 0Dh without planes is refused rather than drawn as zeros', () => {
    // The planes come from card state, so a caller that forgets them would
    // otherwise get a black 320x200 frame -- indistinguishable from a program
    // that drew nothing.
    assert.throws(() => renderMode(0x0d, () => 0, {}), /needs opts\.planes/);
});
