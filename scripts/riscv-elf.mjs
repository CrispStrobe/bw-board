/**
 * A tiny RISC-V ELF32 loader + relocator — enough to turn a single relocatable
 * object (`clang --target=riscv32 -c`) into a runnable image for RiscV32Machine,
 * WITHOUT a linker (ld.lld isn't installable here). It places the object's
 * allocatable sections, resolves its symbols, and applies the relocations a
 * freestanding `-fno-pic -mno-relax` build emits — absolute HI20/LO12 addressing
 * plus intra-text CALL/JAL/BRANCH. PC-relative (GOT/PLT) relocations are refused
 * loudly rather than mis-linked; a freestanding no-pic build does not need them.
 *
 * Not a general linker: one object, no `.bss` zeroing beyond the machine's
 * already-zero RAM, no multi-object symbol resolution. It exists so `clang`
 * output runs end to end (the RiscV32Machine ecall ABI does the I/O).
 *
 * @module
 */

// RISC-V ELF relocation types we handle (from the psABI).
const R = {NONE: 0, R32: 1, BRANCH: 16, JAL: 17, CALL: 18, CALL_PLT: 19, HI20: 26, LO12_I: 27, LO12_S: 28};
const SHF_ALLOC = 0x2, SHF_EXECINSTR = 0x4, SHT_NOBITS = 8;

const bits = (v, hi, lo) => (v >>> lo) & ((1 << (hi - lo + 1)) - 1);

/**
 * @param {Uint8Array} obj the ELF object bytes
 * @param {{textBase?: number, dataBase?: number, entry?: string}} [opts]
 * @returns {{segments: {addr: number, bytes: Uint8Array}[], entry: number, symbols: Map<string,number>}}
 */
export function linkElf(obj, opts = {}) {
    const textBase = opts.textBase ?? 0x1000;
    const dataBase = opts.dataBase ?? 0x8000;
    const dv = new DataView(obj.buffer, obj.byteOffset, obj.byteLength);
    if (!(obj[0] === 0x7f && obj[1] === 0x45 && obj[2] === 0x4c && obj[3] === 0x46)) throw new Error('not an ELF file');
    if (obj[4] !== 1) throw new Error('not ELF32 (need a riscv32 object)');

    const shoff = dv.getUint32(0x20, true), shent = dv.getUint16(0x2e, true),
        shnum = dv.getUint16(0x30, true), shstr = dv.getUint16(0x32, true);
    const shBase = i => shoff + i * shent;
    const sec = i => ({
        name: dv.getUint32(shBase(i), true), type: dv.getUint32(shBase(i) + 4, true),
        flags: dv.getUint32(shBase(i) + 8, true), off: dv.getUint32(shBase(i) + 0x10, true),
        size: dv.getUint32(shBase(i) + 0x14, true), link: dv.getUint32(shBase(i) + 0x18, true),
        info: dv.getUint32(shBase(i) + 0x1c, true)
    });
    const secs = Array.from({length: shnum}, (_, i) => sec(i));
    const strOf = (base, off) => { let s = '', p = base + off; while (obj[p]) s += String.fromCharCode(obj[p++]); return s; };
    const shName = i => strOf(secs[shstr].off, secs[i].name);

    // Place every allocatable section: executable → textBase run, others → dataBase run.
    const placed = new Array(shnum).fill(null);
    let tp = textBase, dp = dataBase;
    for (let i = 0; i < shnum; i++) {
        const s = secs[i];
        if (!(s.flags & SHF_ALLOC)) continue;
        const align = a => (a + 3) & ~3;
        if (s.flags & SHF_EXECINSTR) { placed[i] = tp; tp = align(tp + s.size); }
        else { placed[i] = dp; dp = align(dp + s.size); }
    }

    // Symbol table.
    const symSecIdx = secs.findIndex(s => shName(secs.indexOf(s)) === '.symtab');
    const symSec = secs[symSecIdx], strSec = secs[symSec.link];
    const symCount = symSec.size / 16;
    const symbols = new Map();
    const symAddr = idx => {
        const e = symSec.off + idx * 16;
        const shndx = dv.getUint16(e + 14, true), val = dv.getUint32(e + 4, true);
        return (placed[shndx] ?? 0) + val;
    };
    for (let i = 0; i < symCount; i++) {
        const nm = strOf(strSec.off, dv.getUint32(symSec.off + i * 16, true));
        if (nm) symbols.set(nm, symAddr(i));
    }

    // Copy placed sections into segments (NOBITS/.bss stays zero in RAM).
    const segments = [];
    for (let i = 0; i < shnum; i++) {
        if (placed[i] == null) continue;
        const s = secs[i];
        const bytes = s.type === SHT_NOBITS ? new Uint8Array(s.size) : obj.subarray(s.off, s.off + s.size);
        segments.push({addr: placed[i], bytes: new Uint8Array(bytes), _shndx: i});
    }
    const segFor = shndx => segments.find(g => g._shndx === shndx);
    const patch = (shndx, off, word) => {
        const g = segFor(shndx);
        g.bytes[off] = word & 0xff; g.bytes[off + 1] = word >>> 8; g.bytes[off + 2] = word >>> 16; g.bytes[off + 3] = word >>> 24;
    };
    const read = (shndx, off) => { const g = segFor(shndx); return (g.bytes[off] | g.bytes[off + 1] << 8 | g.bytes[off + 2] << 16 | g.bytes[off + 3] << 24) >>> 0; };

    // Apply relocations (.rela.<name> against section <name>).
    for (let i = 0; i < shnum; i++) {
        if (secs[i].type !== 4) continue;                       // SHT_RELA
        const target = secs[i].info;
        if (placed[target] == null) continue;
        const rela = secs[i];
        for (let o = rela.off; o < rela.off + rela.size; o += 12) {
            const roff = dv.getUint32(o, true), info = dv.getUint32(o + 4, true), add = dv.getInt32(o + 8, true);
            const type = info & 0xff, sym = info >>> 8;
            const S = symAddr(sym) + add;                        // symbol value + addend
            const P = placed[target] + roff;                     // reloc location address
            let w = read(target, roff);
            switch (type) {
                case R.NONE: break;
                case R.R32: patch(target, roff, S >>> 0); break;
                case R.HI20:   w = (w & 0x00000fff) | ((((S + 0x800) >>> 12) & 0xfffff) << 12); patch(target, roff, w); break;
                case R.LO12_I: w = (w & 0x000fffff) | ((S & 0xfff) << 20); patch(target, roff, w); break;
                case R.LO12_S: {
                    const imm = S & 0xfff;
                    w = (w & 0x01fff07f) | (bits(imm, 11, 5) << 25) | (bits(imm, 4, 0) << 7);
                    patch(target, roff, w); break;
                }
                case R.JAL: {
                    const d = (S - P) | 0;
                    w = (w & 0x00000fff) | (bits(d, 20, 20) << 31) | (bits(d, 10, 1) << 21) | (bits(d, 11, 11) << 20) | (bits(d, 19, 12) << 12);
                    patch(target, roff, w); break;
                }
                case R.BRANCH: {
                    const d = (S - P) | 0;
                    w = (w & 0x01fff07f) | (bits(d, 12, 12) << 31) | (bits(d, 10, 5) << 25) | (bits(d, 4, 1) << 8) | (bits(d, 11, 11) << 7);
                    patch(target, roff, w); break;
                }
                case R.CALL: case R.CALL_PLT: {                  // auipc (P) + jalr (P+4)
                    const d = (S - P) | 0;
                    const hi = ((d + 0x800) >>> 12) & 0xfffff, lo = d & 0xfff;
                    patch(target, roff, (read(target, roff) & 0x00000fff) | (hi << 12));           // auipc
                    patch(target, roff + 4, (read(target, roff + 4) & 0x000fffff) | (lo << 20));   // jalr
                    break;
                }
                default: throw new Error(`unsupported RISC-V relocation type ${type} (build with -fno-pic -mno-relax)`);
            }
        }
    }

    return {segments: segments.map(({addr, bytes}) => ({addr, bytes})), entry: symbols.get(opts.entry || '_start') ?? textBase, symbols};
}

/**
 * Load a **fully-linked** ELF32 executable (ET_EXEC — the output of a real
 * linker like ld.lld) by walking its program headers: each PT_LOAD segment is
 * copied to its p_vaddr and the trailing [filesz, memsz) (.bss) is zeroed. pc is
 * set to e_entry. This is the counterpart to {@link linkElf}, which relocates a
 * single *object*; a linked executable already has its addresses baked in, so it
 * must be loaded, not re-placed.
 *
 * @param {Uint8Array} elf the linked ELF32 executable bytes
 * @returns {{addr:number, bytes:Uint8Array}[]} the PT_LOAD segments (vaddr-based)
 */
export function loadExecSegments(elf) {
    const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
    if (!(elf[0] === 0x7f && elf[1] === 0x45 && elf[2] === 0x4c && elf[3] === 0x46)) throw new Error('not an ELF file');
    if (elf[4] !== 1) throw new Error('not ELF32');
    const phoff = dv.getUint32(0x1c, true), phent = dv.getUint16(0x2a, true), phnum = dv.getUint16(0x2c, true);
    const segments = [];
    for (let i = 0; i < phnum; i++) {
        const p = phoff + i * phent;
        if (dv.getUint32(p, true) !== 1) continue;               // PT_LOAD only
        const off = dv.getUint32(p + 4, true), vaddr = dv.getUint32(p + 8, true);
        const filesz = dv.getUint32(p + 16, true), memsz = dv.getUint32(p + 20, true);
        const bytes = new Uint8Array(memsz);                     // memsz ≥ filesz; tail (.bss) stays 0
        bytes.set(elf.subarray(off, off + filesz));
        segments.push({addr: vaddr >>> 0, bytes});
    }
    return segments;
}

/**
 * Load an ELF into a RiscV32Machine and set its entry. Auto-detects the kind:
 * a relocatable object (ET_REL) is linked via {@link linkElf}; a fully-linked
 * executable (ET_EXEC) is loaded by its program headers via {@link loadExecSegments}.
 */
export function loadElfInto(machine, obj, opts = {}) {
    const dv = new DataView(obj.buffer, obj.byteOffset, obj.byteLength);
    const etype = dv.getUint16(0x10, true);
    if (etype === 2) {                                            // ET_EXEC — already linked
        const segments = loadExecSegments(obj);
        for (const {addr, bytes} of segments) machine.load(bytes, addr);
        const entry = dv.getUint32(0x18, true) >>> 0;
        machine.cpu.pc = entry;
        return {entry, symbols: new Map()};
    }
    const {segments, entry, symbols} = linkElf(obj, opts);        // ET_REL — relocate the object
    for (const {addr, bytes} of segments) machine.load(bytes, addr);
    machine.cpu.pc = entry >>> 0;
    return {entry, symbols};
}
