/**
 * Function symbols from an ELF, built here byte by byte so the test needs no
 * toolchain (and so cannot skip): a symtab with two FUNC symbols (one Thumb,
 * bit 0 set), an OBJECT symbol that must be ignored, and its strtab.
 */
import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readElfFunctionSymbols, symbolizer } from '../src/elf-symbols.js';
import { createLabwiredDebugTarget } from '../src/labwired-debug.js';

function elfWithSymbols(syms) {
    const strs = ['', ...syms.map(s => s.name)];
    const strtab = new TextEncoder().encode(strs.join('\0') + '\0');
    const nameOff = []; let o = 0; for (const s of strs) { nameOff.push(o); o += s.length + 1; }
    const symtab = new Uint8Array(16 * (syms.length + 1));
    const sdv = new DataView(symtab.buffer);
    syms.forEach((s, i) => {
        const e = 16 * (i + 1);
        sdv.setUint32(e, nameOff[i + 1], true); sdv.setUint32(e + 4, s.addr, true);
        sdv.setUint32(e + 8, s.size, true); symtab[e + 12] = s.type;
    });
    const shoff = 52 + symtab.length + strtab.length;
    const out = new Uint8Array(shoff + 40 * 3);
    const dv = new DataView(out.buffer);
    out.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1], 0);
    dv.setUint32(32, shoff, true); dv.setUint16(46, 40, true); dv.setUint16(48, 3, true);
    out.set(symtab, 52); out.set(strtab, 52 + symtab.length);
    const sec = (i, type, off, size, link, entsize) => {
        const b = shoff + 40 * i;
        dv.setUint32(b + 4, type, true); dv.setUint32(b + 16, off, true); dv.setUint32(b + 20, size, true);
        dv.setUint32(b + 24, link, true); dv.setUint32(b + 36, entsize, true);
    };
    sec(1, 2, 52, symtab.length, 2, 16);            // SHT_SYMTAB -> strtab at index 2
    sec(2, 3, 52 + symtab.length, strtab.length, 0, 0);
    return out;
}

const ELF = elfWithSymbols([
    { name: 'main', addr: 0x08000101, size: 0x20, type: 2 },        // Thumb FUNC
    { name: 'HardFault_Handler', addr: 0x08000201, size: 0, type: 2 },
    { name: 'counter', addr: 0x20000000, size: 4, type: 1 },       // OBJECT: ignored
]);

it('reads FUNC symbols, masks the Thumb bit, ignores data', () => {
    const syms = readElfFunctionSymbols(ELF, { thumb: true });
    assert.deepEqual(syms.map(s => [s.name, s.addr]), [['main', 0x08000100], ['HardFault_Handler', 0x08000200]]);
});

it('symbolizes inside a sized function, and a sizeless one up to the next', () => {
    const at = symbolizer(readElfFunctionSymbols(ELF, { thumb: true }));
    assert.deepEqual(at(0x08000112), { name: 'main', offset: 0x12 });
    assert.equal(at(0x08000130), null, 'past main\'s size and before the next symbol');
    assert.deepEqual(at(0x08000210), { name: 'HardFault_Handler', offset: 0x10 });
    assert.equal(at(0x07ffffff), null);
});

it('a UF2 or raw image has no symbols, and says nothing rather than guess', () => {
    assert.deepEqual(readElfFunctionSymbols(Uint8Array.of(0x55, 0x46, 0x32, 0x0a)), []);
});

it('the labwired target names the function beside the decode at the PC', () => {
    const t = createLabwiredDebugTarget({ elf: ELF, adapter: {
        sim: { get_pc: () => 0x08000113, get_disassembly: () => 'Branch { offset: -4 }', step_single() {}, step_batch() {} },
        clockHz: 48_000_000, timeNs: () => 0n, pump() {},
    } });
    assert.equal(t.disasm(0x08000112), '<main+0x12> Branch { offset: -4 }');
    assert.deepEqual(t.symbolize(0x08000113), { name: 'main', offset: 0x12 });
});
