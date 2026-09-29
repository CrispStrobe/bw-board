/**
 * Function symbols from an ELF32 little-endian image, so a debugger can say
 * `main+0x12` instead of `0x08000134`.
 *
 * Reads the section headers, the first SHT_SYMTAB and the string table it
 * links to, and keeps FUNC symbols with an address. Nothing else: no DWARF,
 * no line tables. A UF2 or raw image has no symbols and yields an empty table
 * — callers get null names rather than a guess.
 * @module
 */

const SHT_SYMTAB = 2;
const STT_FUNC = 2;

/**
 * @param {Uint8Array} elf
 * @param {{thumb?: boolean}} [opts] thumb: mask bit 0 of ARM function addresses
 * @returns {{name: string, addr: number, size: number}[]} sorted by addr
 */
export function readElfFunctionSymbols (elf, opts = {}) {
  if (!(elf instanceof Uint8Array) || elf.length < 52 ||
      elf[0] !== 0x7f || elf[1] !== 0x45 || elf[2] !== 0x4c || elf[3] !== 0x46 ||
      elf[4] !== 1 || elf[5] !== 1) {
    return [];                                   // not ELF32 LE: no symbols, not an error
  }
  const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
  const shoff = dv.getUint32(32, true);
  const shentsize = dv.getUint16(46, true);
  const shnum = dv.getUint16(48, true);
  if (!shoff || shentsize < 40 || shoff + shnum * shentsize > elf.length) return [];
  const sh = i => {
    const o = shoff + i * shentsize;
    return { type: dv.getUint32(o + 4, true), offset: dv.getUint32(o + 16, true),
      size: dv.getUint32(o + 20, true), link: dv.getUint32(o + 24, true),
      entsize: dv.getUint32(o + 36, true) };
  };
  let symtab = null;
  for (let i = 0; i < shnum; i++) { const s = sh(i); if (s.type === SHT_SYMTAB) { symtab = s; break; } }
  if (!symtab || symtab.link >= shnum || (symtab.entsize && symtab.entsize < 16)) return [];
  const strtab = sh(symtab.link);
  const ent = symtab.entsize || 16;
  const name = off => {
    let end = strtab.offset + off;
    const start = end;
    while (end < elf.length && end < strtab.offset + strtab.size && elf[end] !== 0) end++;
    return new TextDecoder().decode(elf.subarray(start, end));
  };
  const out = [];
  for (let o = symtab.offset; o + 16 <= symtab.offset + symtab.size && o + 16 <= elf.length; o += ent) {
    const info = elf[o + 12];
    if ((info & 0xf) !== STT_FUNC) continue;
    let addr = dv.getUint32(o + 4, true);
    if (!addr) continue;
    if (opts.thumb) addr &= ~1;
    const n = name(dv.getUint32(o, true));
    if (n) out.push({ name: n, addr: addr >>> 0, size: dv.getUint32(o + 8, true) });
  }
  return out.sort((a, b) => a.addr - b.addr);
}

/**
 * `addr` -> `{name, offset}` of the function containing it, or null. A symbol
 * with a size covers [addr, addr+size); one without covers up to the next.
 * @param {{name: string, addr: number, size: number}[]} symbols sorted by addr
 */
export function symbolizer (symbols) {
  return (addr) => {
    const a = addr >>> 0;
    let lo = 0, hi = symbols.length - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (symbols[mid].addr <= a) { hit = mid; lo = mid + 1; } else hi = mid - 1;
    }
    if (hit < 0) return null;
    const s = symbols[hit];
    const end = s.size ? s.addr + s.size : (symbols[hit + 1]?.addr ?? Infinity);
    return a < end ? { name: s.name, offset: a - s.addr } : null;
  };
}
