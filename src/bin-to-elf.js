/**
 * Wrap a raw Cortex-M flash image in the smallest ELF that will load it.
 *
 * WHY THIS EXISTS
 * ---------------
 * Lite compiles an STM32F030 project to a raw flash image — a real image the
 * hand-rolled CortexM0Machine boots the way silicon does, straight from the
 * vector table. labwired cannot take that: `new_from_config_arm` ends in
 * `load_elf_bytes(firmware)`, so the heavy tier accepts an ELF and nothing
 * else. Without a bridge, everything lite can already build is exactly what
 * labwired cannot run, which would make the second tier reachable only from
 * a toolchain lite does not have.
 *
 * The alternative was to have the compile service return its ELF as well as
 * the .bin — it has one, just before objcopy. That is the better long-term
 * answer because it carries SYMBOLS, and it is a change in another repo behind
 * a deploy. This is the part that can be done here, today, and the two are not
 * exclusive: when the service returns an ELF, pass that instead and get source
 * lines with it.
 *
 * WHAT IT DOES NOT GIVE YOU
 * -------------------------
 * Symbols. There are none in the input, so there are none in the output: no
 * source lines, no `bwMs()`, no symbol-driven block stepping. The engine runs
 * the bytes and the PC is a number. Said here because a debugger that quietly
 * loses source mapping is worse than one that never claimed it.
 *
 * THE SHAPE, and why each field is what it is
 * -------------------------------------------
 * `load_elf_bytes` uses exactly four things: `e_machine` (to pick the arch),
 * `e_entry`, and each `PT_LOAD` header's `p_offset`/`p_filesz`/`p_vaddr`. So
 * one program header over one contiguous segment is sufficient, and anything
 * more would be decoration a reader would have to disbelieve.
 *
 * @module
 */

const EI_NIDENT = 16;
const EHDR_SIZE = 52;   // ELF32
const PHDR_SIZE = 32;   // ELF32
const EM_ARM = 40;
const ET_EXEC = 2;
const PT_LOAD = 1;
const PF_X = 1, PF_R = 4;
/** EF_ARM_EABI_VER5. Not read by the loader; correct because a wrong value
 *  would mislead every other tool that opens the file. */
const EF_ARM_EABI_VER5 = 0x05000000;

/** Default Cortex-M flash origin: the STM32 F0/F1/F3/F4/F7 mapping. */
export const DEFAULT_FLASH_ORIGIN = 0x08000000;

/**
 * @param {Uint8Array} image  raw flash image, vector table first
 * @param {object} [opts]
 * @param {number} [opts.loadAddress] where the image is mapped (default 0x08000000)
 * @param {number} [opts.entry] override the entry point; by default it is taken
 *   from the vector table, which is where the silicon takes it from too
 * @returns {Uint8Array} an ELF32 little-endian ARM executable
 */
export function binToElf (image, opts = {}) {
  if (!(image instanceof Uint8Array)) throw new TypeError('binToElf: image must be a Uint8Array');
  if (image.length < 8) {
    throw new Error('binToElf: a Cortex-M image needs at least a vector table ' +
      `(initial SP + reset vector = 8 bytes); got ${image.length}`);
  }
  const loadAddress = opts.loadAddress ?? DEFAULT_FLASH_ORIGIN;

  // The reset vector IS the entry point — word 1 of the table, exactly what the
  // core loads into the PC out of reset. Bit 0 is the Thumb state flag and is
  // part of the vector by design, so it is preserved rather than masked: an
  // even reset vector would mean ARM state, which a Cortex-M cannot enter.
  const view = new DataView(image.buffer, image.byteOffset, image.byteLength);
  const entry = opts.entry ?? view.getUint32(4, true);

  const dataOffset = EHDR_SIZE + PHDR_SIZE;   // 84, already 4-aligned
  const out = new Uint8Array(dataOffset + image.length);
  const dv = new DataView(out.buffer);

  // e_ident
  out.set([0x7f, 0x45, 0x4c, 0x46], 0);       // \x7fELF
  out[4] = 1;                                  // ELFCLASS32
  out[5] = 1;                                  // ELFDATA2LSB
  out[6] = 1;                                  // EV_CURRENT
  // out[7] EI_OSABI = 0 (System V), out[8..] padding — already zero.

  let o = EI_NIDENT;
  dv.setUint16(o, ET_EXEC, true); o += 2;
  dv.setUint16(o, EM_ARM, true); o += 2;
  dv.setUint32(o, 1, true); o += 4;            // e_version
  dv.setUint32(o, entry >>> 0, true); o += 4;  // e_entry
  dv.setUint32(o, EHDR_SIZE, true); o += 4;    // e_phoff
  dv.setUint32(o, 0, true); o += 4;            // e_shoff — no section headers
  dv.setUint32(o, EF_ARM_EABI_VER5, true); o += 4;
  dv.setUint16(o, EHDR_SIZE, true); o += 2;
  dv.setUint16(o, PHDR_SIZE, true); o += 2;
  dv.setUint16(o, 1, true); o += 2;            // e_phnum
  dv.setUint16(o, 40, true); o += 2;           // e_shentsize (ELF32 nominal)
  dv.setUint16(o, 0, true); o += 2;            // e_shnum
  dv.setUint16(o, 0, true); o += 2;            // e_shstrndx

  // the one PT_LOAD
  o = EHDR_SIZE;
  dv.setUint32(o, PT_LOAD, true); o += 4;
  dv.setUint32(o, dataOffset, true); o += 4;   // p_offset
  dv.setUint32(o, loadAddress >>> 0, true); o += 4;  // p_vaddr
  dv.setUint32(o, loadAddress >>> 0, true); o += 4;  // p_paddr — flash is its own LMA
  dv.setUint32(o, image.length, true); o += 4; // p_filesz
  dv.setUint32(o, image.length, true); o += 4; // p_memsz — no .bss here; the image is what there is
  dv.setUint32(o, PF_R | PF_X, true); o += 4;
  dv.setUint32(o, 4, true);                    // p_align

  out.set(image, dataOffset);
  return out;
}

/** True when `bytes` already looks like an ELF, so a caller can accept either. */
export function isElf (bytes) {
  return bytes instanceof Uint8Array && bytes.length >= 4 &&
    bytes[0] === 0x7f && bytes[1] === 0x45 && bytes[2] === 0x4c && bytes[3] === 0x46;
}

/**
 * Accept an ELF or a raw image and return something labwired can load.
 * The point of entry for a caller that does not want to care which it has.
 */
export function toLoadableElf (bytes, opts) {
  return isElf(bytes) ? bytes : binToElf(bytes, opts);
}

export default binToElf;
