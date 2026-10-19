/**
 * UF2 → flat image. A pico-sdk UF2 is a stream of 512-byte blocks, each with a
 * 32-byte header (two magic words, a target address, a payload size) and up to
 * 476 bytes of payload. Flattening them into one contiguous image, with byte 0
 * at the first block's address, is exactly what the RP2040 flash wants:
 * `rp2040.flash.set(image, 0)` with the SoC's FLASH_BASE = 0x10000000.
 *
 * This is the loader the generic runMediaBundle lacked for a 32-bit Cortex-M0+
 * target (its slot logic assumes an 8/16-bit core). It is pure and side-effect
 * free so it can be unit-tested without the emulator, and shared by the rp2040
 * media-bundle runner, the GPL-Lab proof, and (later) the GUI, which today each
 * carry their own copy.
 *
 * @module
 */

/** RP2040 external flash is mapped here; a pico-sdk UF2's first block targets it. */
export const FLASH_BASE = 0x10000000;

const UF2_MAGIC_START0 = 0x0a324655; // "UF2\n"
const UF2_MAGIC_START1 = 0x9e5d5157;
const UF2_BLOCK = 512;
const UF2_HEADER = 32;

/**
 * Flatten a UF2 into one contiguous image (payload of block 0 at image[0]).
 *
 * @param {Uint8Array} uf2 - the raw .uf2 bytes
 * @returns {{blocks: number, base: number, image: Uint8Array}}
 *   base: the target address of the first block (0x10000000 for a pico flash image)
 * @throws if a block's magic is wrong (not a UF2, or truncated)
 */
export function parseUF2(uf2) {
    if (!(uf2 instanceof Uint8Array)) throw new Error('parseUF2: expected a Uint8Array');
    const view = new DataView(uf2.buffer, uf2.byteOffset, uf2.byteLength);
    const nblocks = Math.floor(uf2.length / UF2_BLOCK);
    if (nblocks === 0) throw new Error('parseUF2: no complete 512-byte UF2 blocks');
    let base = null;
    let image = new Uint8Array(0);
    for (let i = 0; i < nblocks; i++) {
        const o = i * UF2_BLOCK;
        if (view.getUint32(o, true) !== UF2_MAGIC_START0 ||
            view.getUint32(o + 4, true) !== UF2_MAGIC_START1) {
            throw new Error(`parseUF2: block ${i} has bad magic (not a UF2, or truncated)`);
        }
        const addr = view.getUint32(o + 12, true);
        const size = view.getUint32(o + 16, true);
        if (base === null) base = addr;
        const off = addr - base;
        if (off < 0) throw new Error(`parseUF2: block ${i} addresses below the image base`);
        if (off + size > image.length) {
            const grown = new Uint8Array(off + size);
            grown.set(image);
            image = grown;
        }
        image.set(uf2.subarray(o + UF2_HEADER, o + UF2_HEADER + size), off);
    }
    return { blocks: nblocks, base, image };
}
