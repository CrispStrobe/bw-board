/**
 * The raw-image → ELF bridge.
 *
 * Lite builds a raw flash image; labwired's ARM path ends in
 * `load_elf_bytes` and takes nothing else. This wrapper is what lets the
 * heavy tier run what lite can already compile.
 *
 * The structural assertions here are cheap and run everywhere. The one that
 * actually matters — that a REAL ELF reader agrees — is checked against
 * arm-none-eabi-readelf when it is installed, and against the labwired engine
 * itself in test/labwired-adapter.test.mjs. A hand-rolled binary format that
 * only its own parser accepts is not a format.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { binToElf, isElf, toLoadableElf, DEFAULT_FLASH_ORIGIN } from '../src/bin-to-elf.js';

/** A minimal Cortex-M image: initial SP, reset vector, then some filler. */
function image (sp = 0x20001000, reset = 0x08000101, extra = 16) {
  const buf = new Uint8Array(8 + extra);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, sp, true);
  dv.setUint32(4, reset, true);
  for (let i = 0; i < extra; i++) buf[8 + i] = i;
  return buf;
}

const u32 = (b, o) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, true);
const u16 = (b, o) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(o, true);

describe('bin-to-elf', () => {
    it('produces an ELF32 little-endian ARM executable', () => {
        const elf = binToElf(image());
        assert.ok(isElf(elf), 'no ELF magic');
        assert.equal(elf[4], 1, 'ELFCLASS32');
        assert.equal(elf[5], 1, 'ELFDATA2LSB');
        assert.equal(u16(elf, 16), 2, 'ET_EXEC');
        assert.equal(u16(elf, 18), 40, 'EM_ARM — the loader picks the arch from this');
    });

    it('takes the entry point from the reset vector, Thumb bit intact', () => {
        const elf = binToElf(image(0x20001000, 0x08000101));
        assert.equal(u32(elf, 24), 0x08000101,
            'bit 0 is the Thumb state flag and is part of the vector — masking it would ' +
            'describe an ARM-state entry a Cortex-M cannot take');
    });

    it('maps the whole image at the flash origin, in one PT_LOAD', () => {
        const img = image();
        const elf = binToElf(img);
        const phoff = u32(elf, 28);
        assert.equal(u16(elf, 44), 1, 'exactly one program header');
        assert.equal(u32(elf, phoff + 0), 1, 'PT_LOAD');
        const offset = u32(elf, phoff + 4);
        assert.equal(u32(elf, phoff + 8), DEFAULT_FLASH_ORIGIN, 'p_vaddr');
        assert.equal(u32(elf, phoff + 12), DEFAULT_FLASH_ORIGIN, 'p_paddr — flash is its own LMA');
        assert.equal(u32(elf, phoff + 16), img.length, 'p_filesz');
        // The bytes the loader will copy must BE the image.
        assert.deepEqual(elf.slice(offset, offset + img.length), img);
    });

    it('honours an explicit load address', () => {
        const elf = binToElf(image(), { loadAddress: 0x00000000 });
        assert.equal(u32(elf, u32(elf, 28) + 8), 0);
    });

    it('refuses an image too short to hold a vector table', () => {
        assert.throws(() => binToElf(new Uint8Array(4)), /vector table/);
    });

    it('passes an ELF through untouched, so a caller need not care which it has', () => {
        const elf = binToElf(image());
        assert.equal(toLoadableElf(elf), elf, 'an ELF must not be double-wrapped');
        assert.ok(isElf(toLoadableElf(image())), 'a raw image must come back as an ELF');
    });

    it('a real ELF reader agrees', { skip: (() => {
        try { execFileSync('arm-none-eabi-readelf', ['--version'], { stdio: 'pipe' }); return false; }
        catch { return 'arm-none-eabi-readelf not installed'; }
    })() }, () => {
        const dir = mkdtempSync(join(tmpdir(), 'bin2elf-'));
        const f = join(dir, 'fw.elf');
        writeFileSync(f, binToElf(image(0x20001000, 0x08000101)));
        const hdr = execFileSync('arm-none-eabi-readelf', ['-h', f], { encoding: 'utf8' });
        assert.match(hdr, /Class:\s+ELF32/);
        assert.match(hdr, /Data:\s+2's complement, little endian/);
        assert.match(hdr, /Machine:\s+ARM/);
        assert.match(hdr, /Entry point address:\s+0x8000101/);
        const seg = execFileSync('arm-none-eabi-readelf', ['-l', f], { encoding: 'utf8' });
        assert.match(seg, /LOAD\s+0x0+54\s+0x08000000\s+0x08000000/,
            `readelf did not see the segment as expected:\n${seg}`);
    });
});
