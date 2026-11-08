/**
 * 80386 forward linear disassembler for the debugger's code listing.
 *
 * TWO DECODERS, ONE RULE. Plain 16-bit code with no 386-only byte in it
 * (no 0x0F map, no FS/GS override, no operand/address-size prefix) is handed
 * to `disasmI8086` in its 80186 variant, which is ground against the
 * SingleStepTests disassembly strings. Everything else -- the 0x0F map, a
 * 66h/67h prefix, FS/GS, and every instruction in a 32-bit (D=1) code
 * segment -- is decoded here, in the same syntax: memory operands always
 * name their segment and carry a size keyword (LEA none), immediates are
 * unpadded hex with an `h` suffix, relative targets are padded to the
 * operand width.
 *
 * A handful of 8086/186 encodings mean something else, or nothing, on a
 * 386 (0x0F `pop cs`, 0x63, 0xF1, `mov` to/from sreg 4..7, FE/FF/8F/C6/C7
 * group holes, LES/LDS/LEA with a register operand). Those never reach the
 * 8086 decoder: they are decoded here or rendered as an explicit `db` row.
 *
 * UNKNOWN BYTES NEVER THROW. An encoding this module does not know, a
 * prefix run longer than the architectural 15-byte limit, or an invalid
 * group member yields `{text: 'db XXh', bytes: [first byte], length: 1,
 * unknown: true}` so a forward listing resynchronises one byte later.
 *
 * NOT HANDLED, stated: x87 opcodes render as `esc N, operand` (length is
 * right, mnemonic is not decoded); 486+ opcodes (CPUID, BSWAP, CMPXCHG,
 * XADD, INVLPG) are `db` rows because the target is a 386.
 *
 * Addresses are LINEAR. The caller passes the EIP that produced `addr` and
 * whether the code segment is 32-bit, because relative targets and fetch
 * wrap are defined in the segment, not in linear space.
 *
 * @module
 */
import {disasmI8086} from './i8086-disasm.js';

const hx = (v) => (v >>> 0).toString(16).toUpperCase() + 'h';
const hxw = (v, digits) => (v >>> 0).toString(16).toUpperCase().padStart(digits, '0') + 'h';

const R8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const R16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const R32 = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const SREG = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];
const RM16 = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx'];
const RM16SEG = ['ds', 'ds', 'ss', 'ss', 'ds', 'ds', 'ss', 'ds'];
const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
const SHIFT = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'shl', 'sar'];
const GRP3 = ['test', 'test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'];
const CC = ['o', 'no', 'b', 'nb', 'z', 'nz', 'be', 'nbe',
    's', 'ns', 'p', 'np', 'l', 'nl', 'le', 'nle'];
const STR = {
    0x6c: ['insb', 'ins'], 0x6e: ['outsb', 'outs'],
    0xa4: ['movsb', 'movs'], 0xa6: ['cmpsb', 'cmps'], 0xaa: ['stosb', 'stos'],
    0xac: ['lodsb', 'lods'], 0xae: ['scasb', 'scas'],
};
const ZF_STRING = new Set([0xa6, 0xa7, 0xae, 0xaf]);
const PREFIX = new Set([0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65, 0x66, 0x67, 0xf0, 0xf2, 0xf3]);
const MAX_LENGTH = 15;

class Unknown extends Error {}

/**
 * Whether the 8086/186 decoder renders these bytes exactly as a 386 in
 * 16-bit code would execute them. Conservative: a `false` only costs the
 * own decoder a turn.
 */
function delegable(read, at) {
    let i = 0, op;
    for (;;) {
        op = read(at(i++)) & 0xff;
        if (i > MAX_LENGTH) return false;
        if (op === 0x64 || op === 0x65 || op === 0x66 || op === 0x67 || op === 0xf1) return false;
        if (!PREFIX.has(op)) break;
    }
    if (op === 0x0f || op === 0x63 || op === 0x8c || op === 0x8e) return false;
    const peek = () => read(at(i)) & 0xff;
    const reg = () => (peek() >> 3) & 7;
    const mod = () => peek() >> 6;
    if ((op === 0x8f || op === 0xc6 || op === 0xc7) && reg() !== 0) return false;
    if (op === 0xfe && reg() > 1) return false;
    if (op === 0xff && (reg() === 7 || ((reg() === 3 || reg() === 5) && mod() === 3))) return false;
    if ((op === 0xc4 || op === 0xc5 || op === 0x8d || op === 0x62) && mod() === 3) return false;
    return true;
}

/**
 * @param {(a:number)=>number} read  reads a LINEAR byte
 * @param {number} addr  linear address of the first byte
 * @param {{eip?: number, code32?: boolean, labels?: Map<number,string>,
 *          own?: boolean}} [opts]  `own` forces this module's decoder even
 *   for delegable 16-bit code (used by tests to cross-check both halves).
 * @returns {{text: string, bytes: number[], length: number, unknown?: true}}
 */
export function disasmI80386(read, addr, opts = {}) {
    const code32 = opts.code32 === true;
    const ipMask = code32 ? 0xffffffff : 0xffff;
    const eip0 = ((opts.eip ?? addr) & ipMask) >>> 0;
    const base = (addr - eip0) >>> 0;
    const at = (i) => (base + (((eip0 + i) & ipMask) >>> 0)) >>> 0;
    const readByte = (a) => read(a) & 0xff;

    if (!code32 && !opts.own && delegable(readByte, at)) {
        const linear20 = addr & 0xfffff;
        return disasmI8086((a) => readByte(at((a - linear20) & 0xffff)), linear20,
            opts.labels ? {ip: eip0, variant: '80186', labels: opts.labels} : {ip: eip0, variant: '80186'});
    }
    try {
        return decode(readByte, at, eip0, code32, ipMask, opts.labels);
    } catch (error) {
        if (!(error instanceof Unknown)) throw error;
        const b = readByte(at(0));
        return {text: `db ${hxw(b, 2)}`, bytes: [b], length: 1, unknown: true};
    }
}

function decode(read, at, eip0, code32, ipMask, labels) {
    const bytes = [];
    let i = 0;
    const next = () => {
        if (i >= MAX_LENGTH) throw new Unknown();
        const b = read(at(i)); bytes.push(b); i++; return b;
    };
    const imm8 = () => next();
    const imm16 = () => { const lo = next(); return lo | (next() << 8); };
    const imm32 = () => (imm16() | (imm16() << 16)) >>> 0;
    const s8 = () => { const b = next(); return b & 0x80 ? b - 256 : b; };

    let seg = null, rep = 0, lock = false, osz = code32, asz = code32, op = next();
    for (;;) {
        if (op === 0x26 || op === 0x2e || op === 0x36 || op === 0x3e) seg = SREG[(op >> 3) & 3];
        else if (op === 0x64 || op === 0x65) seg = SREG[op - 0x60];
        else if (op === 0x66) osz = !code32;
        else if (op === 0x67) asz = !code32;
        else if (op === 0xf2 || op === 0xf3) rep = op;
        else if (op === 0xf0) lock = true;
        else break;
        op = next();
    }
    const immv = () => (osz ? imm32() : imm16());
    const RV = osz ? R32 : R16;
    const vsize = osz ? 'dword' : 'word';
    const acc = osz ? 'eax' : 'ax';

    // ---- ModR/M (+SIB) ---------------------------------------------------
    let mod = 0, reg = 0, rm = 0, memText = null, memSeg = 'ds';
    const signed = (d) => (d < 0 ? '-' : '+') + hx(Math.abs(d));
    const modrm = () => {
        const m = next();
        mod = m >> 6; reg = (m >> 3) & 7; rm = m & 7;
        if (mod === 3) return;
        if (!asz) {
            if (mod === 0 && rm === 6) {
                const d = imm16(); memText = label(d, hx(d)); memSeg = 'ds';
            } else {
                memSeg = RM16SEG[rm];
                const d = mod === 1 ? s8() : mod === 2 ? ((v) => (v & 0x8000 ? v - 65536 : v))(imm16()) : null;
                memText = RM16[rm] + (d === null ? '' : signed(d));
            }
            return;
        }
        let baseReg = rm, index = '', noBase = false;
        if (rm === 4) {
            const sib = next();
            const scale = 1 << (sib >> 6), idx = (sib >> 3) & 7;
            baseReg = sib & 7;
            if (idx !== 4) index = R32[idx] + (scale > 1 ? '*' + scale : '');
            if (baseReg === 5 && mod === 0) noBase = true;
        } else if (rm === 5 && mod === 0) noBase = true;
        let d = null;
        if (noBase) d = imm32();
        else if (mod === 1) d = s8();
        else if (mod === 2) d = imm32() | 0;
        memSeg = !noBase && (baseReg === 4 || baseReg === 5) ? 'ss' : 'ds';
        const parts = [];
        if (!noBase) parts.push(R32[baseReg]);
        if (index) parts.push(index);
        let text = parts.join('+');
        if (noBase) text = parts.length ? `${text}+${hx(d)}` : label(d, hx(d));
        else if (d !== null) text += signed(d);
        memText = text;
    };
    const mem = (size) => `${size ? size + ' ' : ''}[${seg ?? memSeg}:${memText}]`;
    const memOnly = (size) => { if (mod === 3) throw new Unknown(); return mem(size); };
    const rmOp = (w) => (mod === 3 ? (w ? RV[rm] : R8[rm]) : mem(w ? vsize : 'byte'));
    const rm16 = () => (mod === 3 ? R16[rm] : mem('word'));
    const regOp = (w) => (w ? RV[reg] : R8[reg]);

    const label = (v, rendered) => labels?.get(v >>> 0) ?? rendered;
    const relWidth = osz ? 8 : 4;
    const rel = (d) => {
        const t = ((eip0 + i + d) & (osz ? 0xffffffff : 0xffff)) >>> 0;
        return label(t, hxw(t, relWidth));
    };
    const relv = () => rel(osz ? imm32() | 0 : ((v) => (v & 0x8000 ? v - 65536 : v))(imm16()));
    const done = (text) => ({text: (lock ? 'lock ' : '') + text, bytes, length: i});

    if (op === 0x0f) return twoByte();

    if (op < 0x40 && (op & 7) < 6) {
        const kind = ALU[op >> 3], form = op & 7, w = form & 1;
        if (form < 2) { modrm(); return done(`${kind} ${rmOp(w)}, ${regOp(w)}`); }
        if (form < 4) { modrm(); return done(`${kind} ${regOp(w)}, ${rmOp(w)}`); }
        return done(`${kind} ${w ? acc : 'al'}, ${hx(w ? immv() : imm8())}`);
    }
    if (op < 0x40) {
        const singles = {
            0x06: 'push es', 0x07: 'pop es', 0x0e: 'push cs',
            0x16: 'push ss', 0x17: 'pop ss', 0x1e: 'push ds', 0x1f: 'pop ds',
            0x27: 'daa', 0x2f: 'das', 0x37: 'aaa', 0x3f: 'aas',
        };
        if (!singles[op]) throw new Unknown();
        return done(singles[op]);
    }
    if (op < 0x50) return done(`${op < 0x48 ? 'inc' : 'dec'} ${RV[op & 7]}`);
    if (op < 0x60) return done(`${op < 0x58 ? 'push' : 'pop'} ${RV[op & 7]}`);
    if (op >= 0x70 && op < 0x80) return done(`j${CC[op & 15]} ${rel(s8())}`);

    const strName = (o) => {
        const entry = STR[o & 0xfe];
        return o & 1 ? entry[1] + (osz ? 'd' : 'w') : entry[0];
    };
    if (STR[op & 0xfe] && op !== 0xa8 && op !== 0xa9) {
        const parts = [];
        if (seg && op !== 0x6c && op !== 0x6d && op !== 0xaa && op !== 0xab && op !== 0xae && op !== 0xaf)
            parts.push(seg);
        if (rep) parts.push(ZF_STRING.has(op) ? (rep === 0xf3 ? 'repe' : 'repne') : 'rep');
        if (asz !== code32) parts.push(asz ? 'a32' : 'a16');
        parts.push(strName(op));
        return done(parts.join(' '));
    }

    switch (op) {
        case 0x60: return done(osz ? 'pushad' : 'pusha');
        case 0x61: return done(osz ? 'popad' : 'popa');
        case 0x62: modrm(); return done(`bound ${RV[reg]}, ${memOnly(vsize)}`);
        case 0x63: modrm(); return done(`arpl ${rm16()}, ${R16[reg]}`);
        case 0x68: return done(`push ${hx(immv())}`);
        case 0x69: modrm(); { const r = rmOp(1); return done(`imul ${RV[reg]}, ${r}, ${hx(immv())}`); }
        case 0x6a: return done(`push ${hx(s8() & (osz ? 0xffffffff : 0xffff))}`);
        case 0x6b: modrm(); { const r = rmOp(1); return done(`imul ${RV[reg]}, ${r}, ${hx(s8() & (osz ? 0xffffffff : 0xffff))}`); }
        case 0x80: case 0x82: modrm(); { const r = rmOp(0); return done(`${ALU[reg]} ${r}, ${hx(imm8())}`); }
        case 0x81: modrm(); { const r = rmOp(1); return done(`${ALU[reg]} ${r}, ${hx(immv())}`); }
        case 0x83: modrm(); { const r = rmOp(1); return done(`${ALU[reg]} ${r}, ${hx(s8() & (osz ? 0xffffffff : 0xffff))}`); }
        case 0x84: case 0x85: modrm(); return done(`test ${rmOp(op & 1)}, ${regOp(op & 1)}`);
        case 0x86: case 0x87: modrm(); return done(`xchg ${regOp(op & 1)}, ${rmOp(op & 1)}`);
        case 0x88: case 0x89: modrm(); return done(`mov ${rmOp(op & 1)}, ${regOp(op & 1)}`);
        case 0x8a: case 0x8b: modrm(); return done(`mov ${regOp(op & 1)}, ${rmOp(op & 1)}`);
        case 0x8c: modrm(); if (reg > 5) throw new Unknown();
            return done(`mov ${mod === 3 ? RV[rm] : mem('word')}, ${SREG[reg]}`);
        case 0x8d: modrm(); return done(`lea ${RV[reg]}, ${memOnly('')}`);
        case 0x8e: modrm(); if (reg > 5 || reg === 1) throw new Unknown();
            return done(`mov ${SREG[reg]}, ${rm16()}`);
        case 0x8f: modrm(); if (reg !== 0) throw new Unknown(); return done(`pop ${rmOp(1)}`);
        case 0x90: return done('nop');
        case 0x91: case 0x92: case 0x93: case 0x94:
        case 0x95: case 0x96: case 0x97: return done(`xchg ${RV[op & 7]}, ${acc}`);
        case 0x98: return done(osz ? 'cwde' : 'cbw');
        case 0x99: return done(osz ? 'cdq' : 'cwd');
        case 0x9a: case 0xea: {
            const o = immv(), s = imm16();
            return done(`${op === 0x9a ? 'callf' : 'jmpf'} ${hxw(s, 4)}:${hxw(o, osz ? 8 : 4)}`);
        }
        case 0x9b: return done('wait');
        case 0x9c: return done(osz ? 'pushfd' : 'pushf');
        case 0x9d: return done(osz ? 'popfd' : 'popf');
        case 0x9e: return done('sahf');
        case 0x9f: return done('lahf');
        case 0xa0: case 0xa1: case 0xa2: case 0xa3: {
            const a = asz ? imm32() : imm16(), w = op & 1;
            const m = `${w ? vsize : 'byte'} [${seg ?? 'ds'}:${label(a, hx(a))}]`;
            const r = w ? acc : 'al';
            return done(op < 0xa2 ? `mov ${r}, ${m}` : `mov ${m}, ${r}`);
        }
        case 0xa8: return done(`test al, ${hx(imm8())}`);
        case 0xa9: return done(`test ${acc}, ${hx(immv())}`);
        case 0xb0: case 0xb1: case 0xb2: case 0xb3:
        case 0xb4: case 0xb5: case 0xb6: case 0xb7:
            return done(`mov ${R8[op & 7]}, ${hx(imm8())}`);
        case 0xb8: case 0xb9: case 0xba: case 0xbb:
        case 0xbc: case 0xbd: case 0xbe: case 0xbf:
            return done(`mov ${RV[op & 7]}, ${hx(immv())}`);
        case 0xc0: case 0xc1: modrm(); { const r = rmOp(op & 1); return done(`${SHIFT[reg]} ${r}, ${op & 1 ? hxw(imm8(), 2) : hx(imm8())}`); }
        case 0xc2: return done(`retn ${hx(imm16())}`);
        case 0xc3: return done('retn');
        case 0xc4: modrm(); return done(`les ${RV[reg]}, ${memOnly(osz ? 'fword' : 'dword')}`);
        case 0xc5: modrm(); return done(`lds ${RV[reg]}, ${memOnly(osz ? 'fword' : 'dword')}`);
        case 0xc6: modrm(); if (reg !== 0) throw new Unknown(); { const r = rmOp(0); return done(`mov ${r}, ${hx(imm8())}`); }
        case 0xc7: modrm(); if (reg !== 0) throw new Unknown(); { const r = rmOp(1); return done(`mov ${r}, ${hx(immv())}`); }
        case 0xc8: { const size = imm16(); return done(`enter ${hx(size)}, ${hx(imm8())}`); }
        case 0xc9: return done('leave');
        case 0xca: return done(`retf ${hx(imm16())}`);
        case 0xcb: return done('retf');
        case 0xcc: return done('int3');
        case 0xcd: return done(`int ${hx(imm8())}`);
        case 0xce: return done('into');
        case 0xcf: return done(osz ? 'iretd' : 'iret');
        case 0xd0: case 0xd1: modrm(); return done(`${SHIFT[reg]} ${rmOp(op & 1)}`);
        case 0xd2: case 0xd3: modrm(); return done(`${SHIFT[reg]} ${rmOp(op & 1)}, cl`);
        case 0xd4: return done(`aam ${hx(imm8())}`);
        case 0xd5: return done(`aad ${hx(imm8())}`);
        case 0xd6: return done('salc');
        case 0xd7: return done('xlat');
        case 0xd8: case 0xd9: case 0xda: case 0xdb:
        case 0xdc: case 0xdd: case 0xde: case 0xdf:
            modrm(); return done(`esc ${op & 7}, ${mod === 3 ? 'st' + rm : mem('')}`);
        case 0xe0: return done(`loopne ${rel(s8())}`);
        case 0xe1: return done(`loope ${rel(s8())}`);
        case 0xe2: return done(`loop ${rel(s8())}`);
        case 0xe3: return done(`${asz ? 'jecxz' : 'jcxz'} ${rel(s8())}`);
        case 0xe4: case 0xe5: return done(`in ${op & 1 ? acc : 'al'}, ${hx(imm8())}`);
        case 0xe6: case 0xe7: return done(`out ${hx(imm8())}, ${op & 1 ? acc : 'al'}`);
        case 0xe8: return done(`call ${relv()}`);
        case 0xe9: return done(`jmp ${relv()}`);
        case 0xeb: return done(`jmp ${rel(s8())}`);
        case 0xec: case 0xed: return done(`in ${op & 1 ? acc : 'al'}, dx`);
        case 0xee: case 0xef: return done(`out dx, ${op & 1 ? acc : 'al'}`);
        case 0xf4: return done('hlt');
        case 0xf5: return done('cmc');
        case 0xf6: case 0xf7: {
            modrm();
            const w = op & 1, r = rmOp(w);
            if (reg < 2) return done(`test ${r}, ${hx(w ? immv() : imm8())}`);
            return done(`${GRP3[reg]} ${r}`);
        }
        case 0xf8: return done('clc');
        case 0xf9: return done('stc');
        case 0xfa: return done('cli');
        case 0xfb: return done('sti');
        case 0xfc: return done('cld');
        case 0xfd: return done('std');
        case 0xfe: modrm(); if (reg > 1) throw new Unknown(); return done(`${reg ? 'dec' : 'inc'} ${rmOp(0)}`);
        case 0xff: {
            modrm();
            switch (reg) {
                case 0: return done(`inc ${rmOp(1)}`);
                case 1: return done(`dec ${rmOp(1)}`);
                case 2: return done(`call ${rmOp(1)}`);
                case 3: return done(`callf ${memOnly(osz ? 'fword' : 'dword')}`);
                case 4: return done(`jmp ${rmOp(1)}`);
                case 5: return done(`jmpf ${memOnly(osz ? 'fword' : 'dword')}`);
                case 6: return done(`push ${rmOp(1)}`);
                default: throw new Unknown();
            }
        }
        default: throw new Unknown();
    }

    function twoByte() {
        const op2 = next();
        if (op2 >= 0x80 && op2 <= 0x8f) return done(`j${CC[op2 & 15]} ${relv()}`);
        if (op2 >= 0x90 && op2 <= 0x9f) { modrm(); return done(`set${CC[op2 & 15]} ${rmOp(0)}`); }
        const bitOp = {0xa3: 'bt', 0xab: 'bts', 0xb3: 'btr', 0xbb: 'btc'};
        if (bitOp[op2]) { modrm(); return done(`${bitOp[op2]} ${rmOp(1)}, ${RV[reg]}`); }
        switch (op2) {
            case 0x00: {
                modrm();
                const names = ['sldt', 'str', 'lldt', 'ltr', 'verr', 'verw'];
                if (reg > 5) throw new Unknown();
                return done(`${names[reg]} ${rm16()}`);
            }
            case 0x01: {
                modrm();
                if (reg === 4 || reg === 6) return done(`${reg === 4 ? 'smsw' : 'lmsw'} ${rm16()}`);
                if (reg > 3) throw new Unknown();
                return done(`${['sgdt', 'sidt', 'lgdt', 'lidt'][reg]} ${memOnly('fword')}`);
            }
            case 0x02: case 0x03: modrm(); return done(`${op2 === 2 ? 'lar' : 'lsl'} ${RV[reg]}, ${rm16()}`);
            case 0x06: return done('clts');
            case 0x20: case 0x21: case 0x22: case 0x23: case 0x24: case 0x26: {
                modrm();
                const special = (op2 & 4 ? 'tr' : op2 & 1 ? 'dr' : 'cr') + reg;
                if (op2 < 0x24 && !(op2 & 1) && (reg === 1 || reg > 3)) throw new Unknown();
                if (op2 & 4 && reg < 6) throw new Unknown();
                return done(op2 & 2 || op2 === 0x26 ? `mov ${special}, ${R32[rm]}` : `mov ${R32[rm]}, ${special}`);
            }
            case 0xa0: return done('push fs');
            case 0xa1: return done('pop fs');
            case 0xa8: return done('push gs');
            case 0xa9: return done('pop gs');
            case 0xa4: case 0xac: modrm(); { const r = rmOp(1); return done(`${op2 === 0xa4 ? 'shld' : 'shrd'} ${r}, ${RV[reg]}, ${hx(imm8())}`); }
            case 0xa5: case 0xad: modrm(); return done(`${op2 === 0xa5 ? 'shld' : 'shrd'} ${rmOp(1)}, ${RV[reg]}, cl`);
            case 0xaf: modrm(); return done(`imul ${RV[reg]}, ${rmOp(1)}`);
            case 0xb2: case 0xb4: case 0xb5:
                modrm(); return done(`${{0xb2: 'lss', 0xb4: 'lfs', 0xb5: 'lgs'}[op2]} ${RV[reg]}, ${memOnly(osz ? 'fword' : 'dword')}`);
            case 0xb6: case 0xbe: modrm();
                return done(`${op2 === 0xb6 ? 'movzx' : 'movsx'} ${RV[reg]}, ${mod === 3 ? R8[rm] : mem('byte')}`);
            case 0xb7: case 0xbf: modrm();
                return done(`${op2 === 0xb7 ? 'movzx' : 'movsx'} ${RV[reg]}, ${rm16()}`);
            case 0xba: {
                modrm();
                if (reg < 4) throw new Unknown();
                const r = rmOp(1);
                return done(`${['bt', 'bts', 'btr', 'btc'][reg - 4]} ${r}, ${hx(imm8())}`);
            }
            case 0xbc: case 0xbd: modrm(); return done(`${op2 === 0xbc ? 'bsf' : 'bsr'} ${RV[reg]}, ${rmOp(1)}`);
            default: throw new Unknown();
        }
    }
}

export default disasmI80386;
