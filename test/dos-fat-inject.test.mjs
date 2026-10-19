// The browser-safe FAT12 injector: add a file to an already-built DOS image and
// read it back. Deterministic — a synthetic FAT12 image, no MS-DOS binaries, so
// nothing to skip. (The end-to-end "runs on real booted DOS" check lives in the
// gated dos-boot-compiled-com suite.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { injectFile, readFile, name83 } from '../src/dos-fat-inject.js';

/** A blank but well-formed 360K FAT12 image (BPB + reserved FAT entries). */
function blankImage() {
    const img = new Uint8Array(368640);
    const w16 = (o, v) => { img[o] = v & 0xff; img[o + 1] = (v >> 8) & 0xff; };
    w16(11, 512); img[13] = 2; w16(14, 1); img[16] = 2; w16(17, 112); w16(19, 720); w16(22, 2);
    img[510] = 0x55; img[511] = 0xaa;
    // FAT[0], FAT[1] reserved (media byte + EOC), both FAT copies (spf=2 -> 1024 bytes each).
    for (const fatStart of [1 * 512, (1 + 2) * 512]) { img[fatStart] = 0xfd; img[fatStart + 1] = 0xff; img[fatStart + 2] = 0xff; }
    return img;
}

test('name83 pads to an 11-byte 8.3 field, uppercased', () => {
    assert.equal(name83('prog.com'), 'PROG    COM');
    assert.equal(name83('a'), 'A          ');
    assert.equal(name83('longname.text'), 'LONGNAMETEX');
});

test('inject then read back is byte-identical, across cluster boundaries', () => {
    const img = blankImage();
    for (const size of [4, 1024, 1025, 3000, 8192]) {
        const data = new Uint8Array(size).map((_, i) => (i * 37 + 11) & 0xff);
        const out = injectFile(img, `F${size}.COM`, data);
        const back = readFile(out, `F${size}.COM`);
        assert.ok(back, `F${size}.COM found`);
        assert.deepEqual([...back], [...data], `F${size}.COM round-trips (${size} bytes)`);
    }
});

test('the injected file does not disturb the boot signature or BPB', () => {
    const img = blankImage();
    const out = injectFile(img, 'PROG.COM', new Uint8Array([0xb4, 0x4c, 0xcd, 0x21]));
    assert.equal(out[510], 0x55); assert.equal(out[511], 0xaa);   // AA55
    assert.equal(out[13], 2); assert.equal(out.length, img.length);
    assert.notEqual(out, img);   // a copy, not a mutation
    // the original is untouched
    assert.equal(readFile(img, 'PROG.COM'), null);
});

test('two files can be injected and both read back', () => {
    let img = blankImage();
    img = injectFile(img, 'ONE.COM', new Uint8Array([1, 2, 3]));
    img = injectFile(img, 'TWO.COM', new Uint8Array([9, 8, 7, 6, 5]));
    assert.deepEqual([...readFile(img, 'ONE.COM')], [1, 2, 3]);
    assert.deepEqual([...readFile(img, 'TWO.COM')], [9, 8, 7, 6, 5]);
});

test('running out of clusters is refused, not silently truncated', () => {
    const img = blankImage();
    assert.throws(() => injectFile(img, 'BIG.COM', new Uint8Array(400 * 1024)), /not enough free clusters/);
});
