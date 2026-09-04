/**
 * 8086 disassembler — the debugger's live pane for the 8086 machines, held
 * to a standard the other two could not reach: the SingleStepTests 8086
 * suite carries a disassembly STRING for every one of its 646,000 vectors,
 * so both the length AND the text are ground against hardware-derived
 * ground truth rather than spot-checked against the published table.
 * scripts/grind-i8086-disasm.mjs is that comparison.
 *
 * Consequences of matching a real disassembler rather than inventing a
 * house style, all of which look like bugs until you check:
 *
 *   - Memory operands ALWAYS name their segment, override or not, and
 *     always carry a size keyword (`byte`/`word`/`dword`) -- except LEA,
 *     which carries none.
 *   - A segment override is shown as a bare prefix WORD (`cs movsb`) only
 *     for the string primitives, whose operands are implicit. Everywhere
 *     else it lives inside the brackets, and where there is no memory
 *     operand at all it is not shown, because it did nothing.
 *   - Jump and call targets are zero-padded to four digits; immediates are
 *     not padded at all. `jle 002Bh` and `mov bl, 2h` in the same syntax.
 *   - Displacements are SIGNED and printed sign-and-magnitude; the direct
 *     [seg:addr] form is unsigned.
 *
 * Addresses here are LINEAR (20-bit), not offsets: the caller resolves
 * CS:IP before asking. That is the same rule the debug target follows for
 * breakpoints, because two seg:off pairs can name one instruction and only
 * the linear form cannot be fooled.
 *
 * THE 80186 VARIANT (added 2026-09-04, E6.8.1). `{variant: '80186'}` renders
 * the fifteen opcodes the 186 put in holes the 8086 leaves as aliases, and
 * `scripts/grind-i8086-v20-disasm.mjs` holds it to the SAME standard as the
 * 8086 half -- **172,430/172,430 on text and length** against the disassembly
 * strings the SingleStepTests v20 suite ships with every vector. That matters
 * more here than in the core: a core that renders an opcode wrong computes a
 * wrong answer and something eventually notices, but a disassembler that does
 * is read by a person who then believes it. `pusha` shown as `jo` is not a
 * missing feature, it is a confident lie.
 *
 * THREE PLACES THIS DELIBERATELY DISAGREES WITH THAT ORACLE, each behind
 * `v20Syntax: true` so the grinder can ask for the test convention without
 * the product inheriting it -- the bargain `targetBase` already strikes:
 *
 *   - The suite DROPS the three-operand IMUL's immediate (`imul cx, word
 *     [ds:si]` for 69 0C 86 DA, with DA86h nowhere in the text). Lossy in
 *     exactly the way a debugger pane must not be.
 *   - The suite hides a segment override on OUTS, where it APPLIES. It also
 *     hides one on INS, where it does not -- and there we agree, because an
 *     override on a write to ES:DI is inert. "Print it when it does
 *     something" is one rule that happens to match the suite for half of a
 *     pair and not the other half.
 *   - REPC/REPNC (0x64/0x65) are NEC prefixes with no 186 meaning; the
 *     grinder excludes those 3,570 vectors by name and prints the count.
 *
 * And one place it matches the oracle against all instinct: the WORD shift
 * form pads its count to two digits and the BYTE form does not -- `shl word
 * [ss:bp+di], 03h` beside `shl ah, 0h`. 800 vectors disagreed in one leading
 * zero until that matched.
 *
 * NOT HANDLED, stated rather than left to be found: 0x63-0x67 are UNDEFINED
 * on an 80186 and are still rendered as their 8086 aliases.
 *
 * @module
 */

const hx = (v) => v.toString(16).toUpperCase() + 'h';
const hx2 = (v) => v.toString(16).toUpperCase().padStart(2, '0') + 'h';
const hx4 = (v) => v.toString(16).toUpperCase().padStart(4, '0') + 'h';

const R8 = ['al', 'cl', 'dl', 'bl', 'ah', 'ch', 'dh', 'bh'];
const R16 = ['ax', 'cx', 'dx', 'bx', 'sp', 'bp', 'si', 'di'];
const SREG = ['es', 'cs', 'ss', 'ds'];
const RM = ['bx+si', 'bx+di', 'bp+si', 'bp+di', 'si', 'di', 'bp', 'bx'];
const RMSEG = ['ds', 'ds', 'ss', 'ss', 'ds', 'ds', 'ss', 'ds'];
const ALU = ['add', 'or', 'adc', 'sbb', 'and', 'sub', 'xor', 'cmp'];
const SHIFT = ['rol', 'ror', 'rcl', 'rcr', 'shl', 'shr', 'setmo', 'sar'];
const GRP3 = ['test', 'test', 'not', 'neg', 'mul', 'imul', 'div', 'idiv'];
const GRP5 = ['inc', 'dec', 'call', 'callf', 'jmp', 'jmpf', 'push', 'push'];
const CC = ['jo', 'jno', 'jb', 'jnb', 'jz', 'jnz', 'jbe', 'jnbe',
    'js', 'jns', 'jp', 'jnp', 'jl', 'jnl', 'jle', 'jnle'];
const STR = {
    0xa4: 'movsb', 0xa5: 'movsw', 0xa6: 'cmpsb', 0xa7: 'cmpsw',
    0xaa: 'stosb', 0xab: 'stosw', 0xac: 'lodsb', 0xad: 'lodsw',
    0xae: 'scasb', 0xaf: 'scasw',
};
/** CMPS and SCAS read the zero flag, so their REP spells out which way. */
const ZF_STRING = new Set([0xa6, 0xa7, 0xae, 0xaf]);

/**
 * @param {(a:number)=>number} read — reads a LINEAR address
 * @param {number} addr — linear address of the first byte
 * @param {{ ip?: number, labels?: Map<number,string> }} [opts] — `ip` is the
 *   offset half of the CS:IP that produced `addr`, needed because relative
 *   targets are computed in the segment and a linear address cannot say
 *   which offset it came from -- and because instruction FETCH wraps at the
 *   segment boundary. `targetBase` overrides what relative targets are
 *   measured from (the suite's disassembler uses 0). `labels` renders a
 *   known target as its name.
 * @returns {{ text: string, bytes: number[], length: number }}
 */
export function disasmI8086(read, addr, opts = {}) {
    const bytes = [];
    let i = 0;
    // Relative targets are IP-relative, and IP is only defined modulo the
    // segment -- so they are computed in 16 bits from the instruction's own
    // OFFSET, which a linear address does not carry. The caller that
    // resolved CS:IP into `addr` still knows the IP and passes it back;
    // without it the fallback is only right when CS is zero.
    if (opts.variant !== undefined && opts.variant !== '8086' && opts.variant !== '80186') {
        throw new Error(`8086 disasm: unknown variant ${JSON.stringify(opts.variant)} `
            + "-- expected '8086' or '80186'");
    }
    const is186 = opts.variant === '80186';
    const ip0 = (opts.ip ?? addr) & 0xffff;
    // Fetch wraps at the SEGMENT boundary, not the linear one. An
    // instruction beginning at offset FFFCh takes its fifth byte from
    // offset 0000h of the same segment, and reading straight on through
    // the linear address instead disassembles a different instruction --
    // one vector in 646,000 says so, which is exactly the kind of thing
    // that never shows up in hand-written tests.
    const base = (addr - ip0) & 0xfffff;
    const next = () => {
        const b = read((base + ((ip0 + i) & 0xffff)) & 0xfffff) & 0xff;
        bytes.push(b); i++; return b;
    };
    const imm8 = () => next();
    const imm16 = () => { const lo = next(); return lo | (next() << 8); };
    const s8 = () => { const b = next(); return b & 0x80 ? b - 256 : b; };
    const s16 = () => { const v = imm16(); return v & 0x8000 ? v - 65536 : v; };

    // ---- prefixes ------------------------------------------------------
    let seg = null, rep = 0, lock = false, op = next();
    for (;;) {
        if (op === 0x26 || op === 0x2e || op === 0x36 || op === 0x3e) seg = SREG[(op >> 3) & 3];
        else if (op === 0xf2 || op === 0xf3) rep = op;
        else if (op === 0xf0 || op === 0xf1) lock = true;
        else break;
        op = next();
    }

    // ---- ModR/M --------------------------------------------------------
    let mod = 0, reg = 0, rm = 0, disp = 0, direct = 0, haveModrm = false;
    const modrm = () => {
        const m = next();
        mod = m >> 6; reg = (m >> 3) & 7; rm = m & 7;
        haveModrm = true;
        disp = 0; direct = 0;
        if (mod === 0 && rm === 6) direct = imm16();
        else if (mod === 1) disp = s8();
        else if (mod === 2) disp = s16();
        return m;
    };
    /** The memory form, with its segment and (optionally) its size. */
    const mem = (size) => {
        const s = seg ?? (mod === 0 && rm === 6 ? 'ds' : RMSEG[rm]);
        // A displacement byte or word that happens to be zero is still
        // PRINTED (`[ss:bp+si+0h]`): mod says whether one was encoded, and
        // the value it holds does not get a vote.
        // The direct form IS an address, so it takes a label -- and it takes
        // one at any width. The old regex needed four digits, so a datum at
        // 0042h could never be named while one at 1042h could, which is a
        // distinction nothing in the machine makes.
        const inner = mod === 0 && rm === 6
            ? label(direct, hx(direct))
            : RM[rm] + (mod === 0 ? '' : (disp < 0 ? '-' : '+') + hx(Math.abs(disp)));
        return `${size ? size + ' ' : ''}[${s}:${inner}]`;
    };
    const rmOp = (w) => (mod === 3 ? (w ? R16[rm] : R8[rm]) : mem(w ? 'word' : 'byte'));
    const regOp = (w) => (w ? R16[reg] : R8[reg]);

    // What a relative target is measured FROM is a rendering choice, not a
    // decoding one. A debugger pane wants the address in the segment, which
    // is the default; the vector suite's own disassembler measures from the
    // instruction's start instead, and asks for that with targetBase: 0.
    const relBase = (opts.targetBase ?? ip0) & 0xffff;

    /**
     * A number that IS AN ADDRESS, rendered as its label when one is known.
     *
     * SUBSTITUTION IS BY POSITION, NOT BY PATTERN, and that is the whole
     * point of this function. The obvious implementation -- and the one this
     * module shipped, and the one `w65c02-disasm.js` and `z80-disasm.js`
     * still use -- is a regex over the finished text swapping any four-digit
     * hex value for a label. That is safe in 6502 syntax, where a 16-bit
     * value can only BE an address because immediates are eight bits and
     * carry a `#`. It is not safe here. In 8086 syntax an immediate and an
     * address look identical, so `mov ax, 1234h` became `mov ax, start` and
     * `enter 9C4Bh, 1Ah` -- a frame SIZE -- became `enter start, 1Ah`. A
     * debugger pane that renames a constant after some unrelated label is
     * not a cosmetic problem: it is the pane inventing a cross-reference
     * that does not exist.
     *
     * So only the operands that are genuinely addresses ask for a label:
     * relative jump and call targets, and the direct `[seg:addr]` memory
     * form. Immediates never do.
     *
     * NOT LABELLED, deliberately: the far `SSSS:OOOOh` pointer of `callf` and
     * `jmpf`. Its offset means nothing without its segment, and a map keyed
     * on sixteen bits cannot say which segment a name belongs to -- labelling
     * it would be right only when CS happens to match.
     */
    const label = (v, rendered) => opts.labels?.get(v & 0xffff) ?? rendered;
    const rel = (d) => { const t = (relBase + i + d) & 0xffff; return label(t, hx4(t)); };

    const done = (text) => ({ text: (lock ? 'lock ' : '') + text, bytes, length: i });

    // ---- the 80186 additions --------------------------------------------
    // Same shape as the core's _exec186: the 186 gets first refusal, because
    // on an 8086 every one of these encodings is an ALIAS -- 60-6F are the
    // conditional jumps a second time and C0/C1/C8/C9 are the returns -- and
    // an alias cannot be made conditional where it is written.
    //
    // NOT HANDLED, and stated rather than left to be found: 63-67 are
    // UNDEFINED on an 80186 (it raises INT 6) and are still rendered here as
    // their 8086 aliases. The v20 suite cannot grade them either -- on an NEC
    // part 64/65 are the REPNC/REPC prefixes, which is a third meaning again.
    if (is186) {
        switch (op) {
            case 0x60: return done('pusha');
            case 0x61: return done('popa');
            // BOUND's operand is a PAIR of words and the suite still spells it
            // `word`, not `dword` -- unlike les/lds, which say dword for the
            // same two-word read. Matching a real disassembler beats being
            // consistent with ourselves.
            case 0x62: modrm(); return done(`bound ${R16[reg]}, ${rmOp(1)}`);
            case 0x68: return done(`push ${hx(imm16())}`);
            case 0x6a: return done(`push ${hx(imm8())}`);
            // The three-operand IMUL, and the one place this module
            // DELIBERATELY DISAGREES with its oracle. The v20 suite's own
            // disassembler drops the immediate -- `imul cx, word [ds:si]` for
            // bytes 69 0C 86 DA, with DA86h nowhere in the text -- which is
            // lossy in the exact way a debugger pane must not be. So the
            // default prints all three operands and `v20Syntax: true` asks
            // for the suite's two, the same bargain `targetBase: 0` already
            // strikes for relative targets: do the useful thing by default,
            // and let the grinder ask for the test convention.
            case 0x69: case 0x6b: {
                modrm();
                const dst = `imul ${R16[reg]}, ${rmOp(1)}`;
                const imm = op === 0x69 ? hx(imm16()) : hx(imm8());
                return done(opts.v20Syntax ? dst : `${dst}, ${imm}`);
            }
            case 0x6c: case 0x6d: case 0x6e: case 0x6f: {
                // A SEGMENT OVERRIDE IS PRINTED WHEN IT DOES SOMETHING, which
                // for once splits a pair of string primitives. INS writes
                // ES:DI and an override cannot change that, so the prefix
                // byte is inert and the suite does not show it -- agreed.
                // OUTS reads DS:SI and the override DOES apply, so hiding it
                // would lose the operand; the suite hides it anyway, which is
                // the same lossiness as the dropped IMUL immediate, so the
                // default shows it and v20Syntax asks for the suite's form.
                // CMPS and SCAS spell out repe/repne because they read ZF;
                // these do not, so F2 and F3 both read `rep`.
                const outs = op >= 0x6e;
                const parts = [];
                if (seg && outs && !opts.v20Syntax) parts.push(seg);
                if (rep) parts.push('rep');
                parts.push(['insb', 'insw', 'outsb', 'outsw'][op - 0x6c]);
                return done(parts.join(' '));
            }
            // Shift by immediate. reg=6 is `shl` here and `setmo` on an 8086:
            // the 186 reclaimed the encoding, and the suite's own text agrees
            // (`shl ah, 0h`, not `setmo`).
            case 0xc0: case 0xc1: {
                modrm();
                // THE WORD FORM PADS ITS COUNT TO TWO DIGITS AND THE BYTE FORM
                // DOES NOT -- `shl word [ss:bp+di], 03h` beside `shl ah, 0h`,
                // from the same suite and the same immediate width. There is
                // no principle in it; it is what the oracle emits, and this
                // module matches a real disassembler rather than inventing a
                // house style. Discovered by 800 vectors disagreeing in one
                // leading zero.
                const count = op === 0xc1 ? hx2(imm8()) : hx(imm8());
                return done(`${reg === 6 ? 'shl' : SHIFT[reg]} ${rmOp(op & 1)}, ${count}`);
            }
            case 0xc8: return done(`enter ${hx(imm16())}, ${hx(imm8())}`);
            case 0xc9: return done('leave');
            default: break;                              // not a 186 opcode
        }
    }

    // ---- 00-3F: the ALU block and the segment/BCD singles ---------------
    if (op < 0x40 && (op & 7) < 6) {
        const kind = ALU[op >> 3], form = op & 7, w = form & 1;
        if (form < 2) { modrm(); return done(`${kind} ${rmOp(w)}, ${regOp(w)}`); }
        if (form < 4) { modrm(); return done(`${kind} ${regOp(w)}, ${rmOp(w)}`); }
        return done(`${kind} ${w ? 'ax' : 'al'}, ${hx(w ? imm16() : imm8())}`);
    }
    if (op < 0x40) {
        const singles = {
            0x06: 'push es', 0x07: 'pop es', 0x0e: 'push cs', 0x0f: 'pop cs',
            0x16: 'push ss', 0x17: 'pop ss', 0x1e: 'push ds', 0x1f: 'pop ds',
            0x27: 'daa', 0x2f: 'das', 0x37: 'aaa', 0x3f: 'aas',
        };
        return done(singles[op]);
    }
    if (op < 0x50) return done(`${op < 0x48 ? 'inc' : 'dec'} ${R16[op & 7]}`);
    if (op < 0x60) return done(`${op < 0x58 ? 'push' : 'pop'} ${R16[op & 7]}`);
    // 60-6F have no opcodes of their own: bit 4 is ignored and they are the
    // conditional jumps a second time.
    if (op < 0x80) return done(`${CC[op & 15]} ${rel(s8())}`);

    switch (op) {
        case 0x80: case 0x82: modrm(); return done(`${ALU[reg]} ${rmOp(0)}, ${hx(imm8())}`);
        case 0x81: modrm(); return done(`${ALU[reg]} ${rmOp(1)}, ${hx(imm16())}`);
        case 0x83: modrm(); return done(`${ALU[reg]} ${rmOp(1)}, ${hx(s8() & 0xffff)}`);
        case 0x84: case 0x85: modrm(); return done(`test ${rmOp(op & 1)}, ${regOp(op & 1)}`);
        case 0x86: case 0x87: modrm(); return done(`xchg ${regOp(op & 1)}, ${rmOp(op & 1)}`);
        case 0x88: case 0x89: modrm(); return done(`mov ${rmOp(op & 1)}, ${regOp(op & 1)}`);
        case 0x8a: case 0x8b: modrm(); return done(`mov ${regOp(op & 1)}, ${rmOp(op & 1)}`);
        case 0x8c: modrm(); return done(`mov ${rmOp(1)}, ${SREG[reg & 3]}`);
        case 0x8d: modrm(); return done(`lea ${R16[reg]}, ${mod === 3 ? R16[rm] : mem('')}`);
        case 0x8e: modrm(); return done(`mov ${SREG[reg & 3]}, ${rmOp(1)}`);
        case 0x8f: modrm(); return done(`pop ${rmOp(1)}`);
        case 0x90: return done('nop');
        case 0x91: case 0x92: case 0x93: case 0x94:
        case 0x95: case 0x96: case 0x97: return done(`xchg ${R16[op & 7]}, ax`);
        case 0x98: return done('cbw');
        case 0x99: return done('cwd');
        // A far pointer pads both halves; an immediate pads neither.
        case 0x9a: { const o = imm16(), s = imm16(); return done(`callf ${hx4(s)}:${hx4(o)}`); }
        case 0x9b: return done('wait');
        case 0x9c: return done('pushf');
        case 0x9d: return done('popf');
        case 0x9e: return done('sahf');
        case 0x9f: return done('lahf');
        // The moffs forms render their address inline rather than through
        // mem(), so they need the label call of their own -- and they are the
        // most label-worthy operand in the instruction set, being a bare
        // global variable with nothing else in the brackets.
        case 0xa0: case 0xa1: {
            const a = imm16(), w = op & 1;
            return done(`mov ${w ? 'ax' : 'al'}, ${w ? 'word' : 'byte'} [${seg ?? 'ds'}:${label(a, hx(a))}]`);
        }
        case 0xa2: case 0xa3: {
            const a = imm16(), w = op & 1;
            return done(`mov ${w ? 'word' : 'byte'} [${seg ?? 'ds'}:${label(a, hx(a))}], ${w ? 'ax' : 'al'}`);
        }
        case 0xa8: return done(`test al, ${hx(imm8())}`);
        case 0xa9: return done(`test ax, ${hx(imm16())}`);
        case 0xb0: case 0xb1: case 0xb2: case 0xb3:
        case 0xb4: case 0xb5: case 0xb6: case 0xb7:
            return done(`mov ${R8[op & 7]}, ${hx(imm8())}`);
        case 0xb8: case 0xb9: case 0xba: case 0xbb:
        case 0xbc: case 0xbd: case 0xbe: case 0xbf:
            return done(`mov ${R16[op & 7]}, ${hx(imm16())}`);
        case 0xc0: case 0xc2: return done(`retn ${hx(imm16())}`);
        case 0xc1: case 0xc3: return done('retn');
        case 0xc4: modrm(); return done(`les ${R16[reg]}, ${mod === 3 ? R16[rm] : mem('dword')}`);
        case 0xc5: modrm(); return done(`lds ${R16[reg]}, ${mod === 3 ? R16[rm] : mem('dword')}`);
        case 0xc6: modrm(); return done(`mov ${rmOp(0)}, ${hx(imm8())}`);
        case 0xc7: modrm(); return done(`mov ${rmOp(1)}, ${hx(imm16())}`);
        case 0xc8: case 0xca: return done(`retf ${hx(imm16())}`);
        case 0xc9: case 0xcb: return done('retf');
        case 0xcc: return done('int3');
        case 0xcd: return done(`int ${hx(imm8())}`);
        case 0xce: return done('into');
        case 0xcf: return done('iret');
        case 0xd0: case 0xd1:
            modrm();
            return done(`${is186 && reg === 6 ? 'shl' : SHIFT[reg]} ${rmOp(op & 1)}`);
        // The CL-counted form of the undocumented reg=6 has its own name,
        // because it is conditional: SETMOC does nothing when CL is zero.
        case 0xd2: case 0xd3:
            modrm();
            return done(`${reg === 6 ? (is186 ? 'shl' : 'setmoc') : SHIFT[reg]} ${rmOp(op & 1)}, cl`);
        case 0xd4: return done(`aam ${hx(imm8())}`);
        case 0xd5: return done(`aad ${hx(imm8())}`);
        case 0xd6: return done('salc');
        case 0xd7: return done('xlat');
        case 0xd8: case 0xd9: case 0xda: case 0xdb:
        case 0xdc: case 0xdd: case 0xde: case 0xdf:
            modrm(); return done(`esc ${rmOp(1)}`);
        case 0xe0: return done(`loopne ${rel(s8())}`);
        case 0xe1: return done(`loope ${rel(s8())}`);
        case 0xe2: return done(`loop ${rel(s8())}`);
        case 0xe3: return done(`jcxz ${rel(s8())}`);
        case 0xe4: case 0xe5: return done(`in ${op & 1 ? 'ax' : 'al'}, ${hx(imm8())}`);
        case 0xe6: case 0xe7: return done(`out ${hx(imm8())}, ${op & 1 ? 'ax' : 'al'}`);
        case 0xe8: return done(`call ${rel(s16())}`);
        case 0xe9: return done(`jmp ${rel(s16())}`);
        case 0xea: { const o = imm16(), s = imm16(); return done(`jmpf ${hx4(s)}:${hx4(o)}`); }
        case 0xeb: return done(`jmp ${rel(s8())}`);
        case 0xec: case 0xed: return done(`in ${op & 1 ? 'ax' : 'al'}, dx`);
        case 0xee: case 0xef: return done(`out dx, ${op & 1 ? 'ax' : 'al'}`);
        case 0xf4: return done('hlt');
        case 0xf5: return done('cmc');
        case 0xf6: case 0xf7: {
            modrm();
            const w = op & 1;
            if (reg < 2) return done(`test ${rmOp(w)}, ${hx(w ? imm16() : imm8())}`);
            return done(`${GRP3[reg]} ${rmOp(w)}`);
        }
        case 0xf8: return done('clc');
        case 0xf9: return done('stc');
        case 0xfa: return done('cli');
        case 0xfb: return done('sti');
        case 0xfc: return done('cld');
        case 0xfd: return done('std');
        case 0xfe: modrm(); return done(`${reg & 1 ? 'dec' : 'inc'} ${rmOp(0)}`);
        case 0xff: modrm(); return done(`${GRP5[reg]} ${rmOp(1)}`);
        default: break;
    }

    // ---- the string primitives, the only place a prefix is spelled out --
    if (STR[op]) {
        const parts = [];
        if (seg) parts.push(seg);
        if (rep) parts.push(ZF_STRING.has(op) ? (rep === 0xf3 ? 'repe' : 'repne') : 'rep');
        parts.push(STR[op]);
        return done(parts.join(' '));
    }
    return done(`db ${hx(op)}`);
}

export default disasmI8086;
