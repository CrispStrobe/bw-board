// Minimal ELF32 reader for the oracle harness: the loadable segments (for the
// core) and the symbol table (to find riscv-tests' `tohost`/`begin_signature`).
// Kept separate from scripts/riscv-elf.mjs, which links relocatable objects.

export function elfSegments(elf) {
    const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
    const phoff = dv.getUint32(0x1c, true), phentsize = dv.getUint16(0x2a, true), phnum = dv.getUint16(0x2c, true);
    const segs = [];
    for (let i = 0; i < phnum; i++) {
        const p = phoff + i * phentsize;
        if (dv.getUint32(p, true) !== 1) continue;                   // PT_LOAD
        const off = dv.getUint32(p + 4, true), paddr = dv.getUint32(p + 12, true);
        const filesz = dv.getUint32(p + 16, true), memsz = dv.getUint32(p + 20, true);
        const bytes = new Uint8Array(memsz);
        bytes.set(elf.subarray(off, off + filesz));
        segs.push({addr: paddr >>> 0, bytes});
    }
    return {entry: dv.getUint32(0x18, true) >>> 0, segments: segs};
}

export function elfSymbols(elf) {
    const dv = new DataView(elf.buffer, elf.byteOffset, elf.byteLength);
    const shoff = dv.getUint32(0x20, true), shentsize = dv.getUint16(0x2e, true), shnum = dv.getUint16(0x30, true);
    const sh = i => {
        const b = shoff + i * shentsize;
        return {type: dv.getUint32(b + 4, true), offset: dv.getUint32(b + 16, true), size: dv.getUint32(b + 20, true),
            link: dv.getUint32(b + 24, true), entsize: dv.getUint32(b + 36, true)};
    };
    const syms = new Map();
    for (let i = 0; i < shnum; i++) {
        const s = sh(i);
        if (s.type !== 2) continue;                                   // SHT_SYMTAB
        const str = sh(s.link);
        for (let o = s.offset; o < s.offset + s.size; o += 16) {
            const nameOff = dv.getUint32(o, true);
            let e = str.offset + nameOff, name = '';
            while (elf[e]) name += String.fromCharCode(elf[e++]);
            if (name) syms.set(name, dv.getUint32(o + 4, true) >>> 0);
        }
    }
    return syms;
}
