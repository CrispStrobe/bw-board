/**
 * UF2 → ELF, so a drag-and-drop image (a Pico's `.uf2`) can run on labwired,
 * whose Cortex-M path ends in `load_elf_bytes` and takes nothing else.
 *
 * UF2 (https://github.com/microsoft/uf2) is a stream of 512-byte blocks, each
 * carrying up to 476 payload bytes and the flash ADDRESS they belong at — so
 * unlike a raw .bin it already says where every byte loads, and converting it
 * needs no guessed origin. Blocks are merged into contiguous segments and each
 * segment becomes one PT_LOAD (the four fields `load_elf_bytes` reads:
 * e_machine, e_entry, and each header's p_offset/p_filesz/p_vaddr).
 *
 * Nothing is lost that a UF2 had: it carries no symbols either.
 * @module
 */

const UF2_MAGIC_START0 = 0x0A324655;
const UF2_MAGIC_START1 = 0x9E5D5157;
const UF2_MAGIC_END = 0x0AB16F30;
const UF2_FLAG_NOT_MAIN_FLASH = 0x00000001;
const UF2_FLAG_FAMILY_ID = 0x00002000;
const BLOCK = 512;

/** RP2040's UF2 family id. Its image starts with the 256-byte stage-2 boot. */
export const UF2_FAMILY_RP2040 = 0xe48bff56;
const RP2040_FLASH = 0x10000000;
const RP2040_BOOT2_BYTES = 0x100;

const EHDR_SIZE = 52;
const PHDR_SIZE = 32;
const EM_ARM = 40;
const ET_EXEC = 2;
const PT_LOAD = 1;
const PF_X = 1, PF_R = 4;
const EF_ARM_EABI_VER5 = 0x05000000;

/** True when `bytes` starts with a UF2 block. */
export function isUf2 (bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < BLOCK) return false;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return dv.getUint32(0, true) === UF2_MAGIC_START0 && dv.getUint32(4, true) === UF2_MAGIC_START1;
}

/**
 * Parse a UF2 into address-ordered contiguous segments.
 * @param {Uint8Array} bytes
 * @returns {{familyId: number|null, segments: {addr: number, data: Uint8Array}[]}}
 */
export function parseUf2 (bytes) {
  if (!isUf2(bytes)) throw new Error('not a UF2 image (no UF2 block magic at offset 0)');
  if (bytes.length % BLOCK !== 0) throw new Error(`UF2 length ${bytes.length} is not a multiple of ${BLOCK}`);
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const chunks = [];
  let familyId = null;
  for (let off = 0; off < bytes.length; off += BLOCK) {
    if (dv.getUint32(off, true) !== UF2_MAGIC_START0 || dv.getUint32(off + 4, true) !== UF2_MAGIC_START1 ||
        dv.getUint32(off + BLOCK - 4, true) !== UF2_MAGIC_END) {
      throw new Error(`UF2 block at byte ${off} has bad magic`);
    }
    const flags = dv.getUint32(off + 8, true);
    if (flags & UF2_FLAG_NOT_MAIN_FLASH) continue;   // metadata, not an image byte
    const addr = dv.getUint32(off + 12, true);
    const size = dv.getUint32(off + 16, true);
    if (size > 476) throw new Error(`UF2 block at byte ${off} claims ${size} payload bytes (max 476)`);
    if (flags & UF2_FLAG_FAMILY_ID) {
      const fam = dv.getUint32(off + 28, true);
      if (familyId !== null && fam !== familyId) {
        throw new Error(`UF2 mixes family ids 0x${familyId.toString(16)} and 0x${fam.toString(16)}`);
      }
      familyId = fam;
    }
    chunks.push({ addr, data: bytes.subarray(off + 32, off + 32 + size) });
  }
  if (!chunks.length) throw new Error('UF2 has no main-flash blocks');
  chunks.sort((a, b) => a.addr - b.addr);
  const segments = [];
  for (const c of chunks) {
    const last = segments[segments.length - 1];
    if (last && last.addr + last.len === c.addr) {
      last.parts.push(c.data); last.len += c.data.length;
    } else if (last && c.addr < last.addr + last.len) {
      throw new Error(`UF2 blocks overlap at 0x${c.addr.toString(16)}`);
    } else {
      segments.push({ addr: c.addr, len: c.data.length, parts: [c.data] });
    }
  }
  return {
    familyId,
    segments: segments.map(s => {
      const data = new Uint8Array(s.len);
      let o = 0;
      for (const p of s.parts) { data.set(p, o); o += p.length; }
      return { addr: s.addr, data };
    }),
  };
}

/**
 * ELF32 (ARM, little-endian) with one PT_LOAD per segment.
 * @param {{addr: number, data: Uint8Array}[]} segments
 * @param {number} entry e_entry (a Thumb address keeps bit 0)
 */
export function armSegmentsToElf (segments, entry) {
  const dataStart = EHDR_SIZE + PHDR_SIZE * segments.length;
  const total = dataStart + segments.reduce((n, s) => n + s.data.length, 0);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  out.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0);   // \x7fELF, ELF32, LSB, EV_CURRENT
  let o = 16;
  dv.setUint16(o, ET_EXEC, true); o += 2;
  dv.setUint16(o, EM_ARM, true); o += 2;
  dv.setUint32(o, 1, true); o += 4;
  dv.setUint32(o, entry >>> 0, true); o += 4;
  dv.setUint32(o, EHDR_SIZE, true); o += 4;         // e_phoff
  dv.setUint32(o, 0, true); o += 4;                 // e_shoff
  dv.setUint32(o, EF_ARM_EABI_VER5, true); o += 4;
  dv.setUint16(o, EHDR_SIZE, true); o += 2;
  dv.setUint16(o, PHDR_SIZE, true); o += 2;
  dv.setUint16(o, segments.length, true); o += 2;
  dv.setUint16(o, 40, true); o += 2;
  dv.setUint16(o, 0, true); o += 2;
  dv.setUint16(o, 0, true);
  let data = dataStart;
  segments.forEach((s, i) => {
    let p = EHDR_SIZE + i * PHDR_SIZE;
    dv.setUint32(p, PT_LOAD, true); p += 4;
    dv.setUint32(p, data, true); p += 4;
    dv.setUint32(p, s.addr >>> 0, true); p += 4;
    dv.setUint32(p, s.addr >>> 0, true); p += 4;
    dv.setUint32(p, s.data.length, true); p += 4;
    dv.setUint32(p, s.data.length, true); p += 4;
    dv.setUint32(p, PF_R | PF_X, true); p += 4;
    dv.setUint32(p, 4, true);
    out.set(s.data, data);
    data += s.data.length;
  });
  return out;
}

/** The 32-bit word at `addr`, from whichever segment holds it, or null. */
function wordAt (segments, addr) {
  for (const s of segments) {
    if (addr >= s.addr && addr + 4 <= s.addr + s.data.length) {
      return new DataView(s.data.buffer, s.data.byteOffset).getUint32(addr - s.addr, true);
    }
  }
  return null;
}

/**
 * Convert a Cortex-M UF2 to an ELF labwired can load.
 *
 * The entry is the image's own reset vector: word 1 of the vector table. On an
 * RP2040 that table sits AFTER the 256-byte stage-2 boot (the chip's
 * `reset_vector_offset: 0x100`), at 0x1000_0100; anywhere else it is the
 * lowest segment's start.
 * @param {Uint8Array} bytes
 * @returns {{elf: Uint8Array, familyId: number|null, segments: number}}
 */
export function uf2ToElf (bytes) {
  const { familyId, segments } = parseUf2(bytes);
  const table = familyId === UF2_FAMILY_RP2040 && segments[0].addr === RP2040_FLASH
    ? RP2040_FLASH + RP2040_BOOT2_BYTES
    : segments[0].addr;
  const entry = wordAt(segments, table + 4);
  if (entry === null) throw new Error(`UF2 has no vector table at 0x${table.toString(16)}`);
  return { elf: armSegmentsToElf(segments, entry), familyId, segments: segments.length };
}

export default uf2ToElf;
