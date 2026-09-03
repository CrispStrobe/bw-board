/**
 * 8086 assembler -- Tier C of the 8086 stack, and the piece that was missing.
 *
 * The core, the disassembler, the machine and the DOS/BIOS layer could all
 * run 8086 code; nothing could PRODUCE any. Measured across the 525 programs
 * of the Amey-Thakur corpus, 502 use `.MODEL` / `PROC` / `MACRO`, so a raw
 * byte-poker is no use: the blocker was MASM syntax, not encoding.
 *
 * SCOPE WAS MEASURED, NOT GUESSED. The whole corpus was surveyed before a
 * line was written, and the directive set it actually contains is tiny:
 * DB, DW, PROC/ENDP, END, .MODEL/.STACK/.CODE/.DATA, EQU, MACRO/ENDM,
 * SEGMENT/ENDS, ORG, ASSUME, `=`, LOCAL, IF/ELSE/ENDIF, LABEL, REPT --
 * twenty-six distinct directives across 525 files, and the operand
 * vocabulary is `$`, `@DATA`, BYTE/WORD PTR, DUP, OFFSET, SEG, SHORT and
 * arithmetic. That list, plus the full 8086 instruction set, is what this
 * implements. It is not a MASM clone and does not try to be.
 *
 * THE ENCODER IS VERIFIED BY ROUND TRIP, which is why it needs no reference
 * assembler. `disasmI8086` is ground against 646,000 hardware-generated
 * vectors on BOTH text and length, so assembling an instruction,
 * disassembling the bytes back and comparing the text is a check against
 * hardware at one remove. test/i8086-asm.test.mjs does that for every
 * mnemonic and every addressing mode here.
 *
 * WHERE IT STANDS, measured 2026-09-03 over two corpora.
 *
 *   Amey-Thakur (525 DOS programs): 510 accepted, 15 refused. Run under
 *   Tier B, 498 exit through INT 21h/4Ch having printed, 12 are deliberate
 *   infinite control loops around device ports, none is silent and none
 *   hangs. The 15 refusals are honest: 14 contain a relative jump further
 *   than an 8086 can reach -- MASM refuses those too, and none is within 4
 *   bytes of reaching -- and 1 wants .FARDATA.
 *
 *   yousefkotp (10 emu8086 coursework programs): 8 accepted and running,
 *   2 refused. Both refusals are defects in the repository rather than
 *   gaps here: one file is truncated and begins mid-program with no
 *   include line, the other carries a stray word on a line of its own and
 *   an unterminated string literal.
 *
 * SECOND DIALECT, SAME ASSEMBLER. The coursework corpus targets emu8086,
 * which is looser than MASM in specific and knowable ways. Each place this
 * gave ground is listed below with the evidence; none of them is a silent
 * change, every one records a warning, and the rule in every case is that a
 * reading which cannot lose or invent a byte beats a refusal.
 *
 * SIX THINGS LOOK LIKE BUGS AND ARE NOT:
 *
 *   - `SHL AX, 4` IS EXPANDED into four `SHL AX, 1`. The immediate-count
 *     shift is an 80186 instruction; on an 8086 its opcode C1 decodes as
 *     `RET imm16`, so emitting it would not be a slightly-wrong program, it
 *     would be a program that returns instead of shifting. 52 corpus files
 *     write it anyway. The expansion is semantically identical for CF, ZF,
 *     SF and PF, differs only in OF -- which the 8086 leaves undefined for
 *     counts above one -- and is RECORDED in `warnings`, never silent.
 *   - LOW, HIGH, LENGTH, SIZE, MASK and TYPE lose to a defined symbol of the
 *     same name. MASM reserves them; the corpus writes `HIGH EQU 5` and
 *     `LENGTH EQU 16` and then reads them back, so a symbol that exists wins
 *     over an operator that might have been meant.
 *   - A bare data label IS a memory operand. `MOV AX, VAL16` loads the
 *     contents; `MOV AX, OFFSET VAL16` loads the address. That is MASM's
 *     rule and it is the one thing a naive implementation always gets
 *     backwards.
 *   - A string too long for its item (`MSG DW "Enter a number: ",0`) is
 *     laid out as BYTES, as DB would. Refuse, truncate, pad, or lay down
 *     what was written: only the last can neither lose nor invent a byte.
 *     `DW 'AB'`, which FITS, is still the word 4142h.
 *   - A sizeless memory operand against an immediate (`MOV [SI], cret`)
 *     takes the width the immediate fits. MASM and NASM both refuse the
 *     form, so no program that ever assembled anywhere expects a WORD from
 *     it, and every dialect that accepts it makes it a byte; a character
 *     literal overrules, since it carries its own width. Two sizeless
 *     operands are still refused -- there is nothing there to read.
 *   - `LEA DX, SI` is read as `LEA DX, [SI]`. LEA's source is an address, a
 *     bare register is not one, and the only address it could name is
 *     [SI]. Only for SI/DI/BX/BP; `LEA DX, AX` is still refused.
 *   - A NEAR procedure left open at END is closed. There is no code after
 *     it for the missing ENDP to have changed. A FAR one is still refused,
 *     because it would make every later RET far without saying so.
 *   - A segment override IS inserted on the assembler's own initiative,
 *     from ASSUME, when a label lives somewhere the default segment
 *     register is not assumed to reach. Five corpus files declare `DW`
 *     after `.CODE` and then store to it through DS; without the override
 *     that store lands in the data segment at the code segment's offset
 *     and quietly corrupts an instruction. An earlier version of this
 *     module refused to synthesise overrides on the belief that every
 *     program here reaches its data through DS. Four of them do not, and
 *     the belief cost a print-string that turned into an NMI. See
 *     `autoOverride`. A segment NO assume reaches is a warning and not a
 *     refusal, and a MISSING assume synthesises nothing at all: not knowing
 *     what a register holds is not the same as knowing it is wrong.
 *   - `MOV r16, SEG x` in a .COM image assembles as `MOV r16, CS`. A .COM
 *     has one segment and no relocation table, and at entry
 *     CS = DS = ES = SS = that segment, so this is the only encoding that
 *     can express it; an immediate would need a fixup the format cannot
 *     carry. Recorded in `warnings`. Anywhere else (`DW SEG x`) it is
 *     refused instead of faked.
 *   - Code found outside any segment REOPENS the last segment, with a
 *     warning. Seven corpus files append helper procedures after
 *     `CODE ENDS` and then name a label inside them from `END`. MASM
 *     refuses that; the intent is not ambiguous, and dropping the bytes
 *     silently would be worse than either.
 *
 * OUTPUT. `.MODEL SMALL`, the older `SEGMENT`/`ENDS` form, and `.DATA` with
 * `.CODE` and no ORG all become an MZ .EXE with a real relocation table,
 * because `MOV AX, @DATA` cannot be expressed any other way -- the data
 * segment's paragraph is not known until load time. Anything else becomes a
 * flat .COM at ORG 100h, INCLUDING `.DATA` and `.CODE` under an explicit
 * `ORG`, where they are section markers inside one image: the code section
 * is laid down first, because a .COM enters at its ORG and a source that
 * declares its data first would otherwise execute its own strings.
 * `createDos8086(...).loadExe` / `.loadCom` take either.
 *
 * A LITERAL FAR POINTER, `JMP 0F000h:005Ch` and `CALL seg:off`, is the only
 * syntax that reaches EA and 9A without a relocation, and it is what makes a
 * ROM possible here. `JMP FAR PTR label` needs a label in a named segment
 * and emits a fixup, which a flat image has nowhere to put -- so a BIOS
 * written against this assembler had to hand-encode its reset vector and its
 * jump to the boot sector as `db 0EAh / dw off / dw seg`. Both halves of a
 * literal pair are known at assembly time, so there is nothing to relocate.
 * A segment-valued expression on the left (`SEG x`, `@DATA`) still gets its
 * fixup, and is therefore still .EXE-only.
 *
 * ONE THING IS OPT-IN, AND THE DEFAULT IS THE POINT. `{ longJumps: true }`
 * promotes a conditional jump or LOOP that cannot reach into a sequence
 * that can -- `Jcc far` into `Jncc over; JMP near far; over:`, and the LOOP
 * family, which has neither an inverse opcode nor a near form, into a jump
 * over a jump. It is off by default and stays off, because the fourteen
 * corpus programs it rescues CANNOT ASSEMBLE ANYWHERE: MASM refuses them
 * too. Promoting silently would hand a learner a program that works here
 * and fails on the lab machine with nothing to say why, which is worse than
 * a refusal that names the line. Faithfulness to the tool the corpus was
 * written for is the default; reach is a choice made with the eyes open,
 * and every promotion records a warning saying the program will no longer
 * assemble under MASM. With the flag on, Amey goes from 510 accepted and
 * 498 running to 524 and 512, and ten of the fourteen rescued programs are
 * byte-identical to the corpus's own independent simulator.
 *
 * NOT SUPPORTED, deliberately, each of which raises a named error rather
 * than encoding something plausible:
 *
 *   - 80186 and later instructions: PUSH imm, ENTER/LEAVE, INS/OUTS, BOUND,
 *     the immediate-count shifts (see the expansion above), IMUL r,r/m,imm.
 *   - 8087 floating point (the ESC group is not assembled at all).
 *   - The undocumented 8086 opcodes the disassembler names -- SETMO,
 *     SETMOC, SALC, POP CS, the 0x60-0x6F jump aliases. They decode; they
 *     are not things a source file should be able to ask for.
 *   - STRUC/RECORD/UNION, TEXTEQU and the string macro functions
 *     (CATSTR/SUBSTR/INSTR), IRP/IRPC, WHILE/FOR, INCLUDE, EXTRN/PUBLIC and
 *     multi-module linking, .STARTUP/.EXIT, MEDIUM/COMPACT/LARGE/HUGE
 *     models, FAR data, OPTION, and the listing directives.
 *   - Overlapping segments, GROUP, ORG inside a named segment other than
 *     the first, and segment-register-relative ASSUME tracking.
 *   - A listing file, a symbol map, and any object output: this assembles
 *     straight to a loadable image, so there is nothing to link.
 *
 * THE FIXPOINT INCLUDES THE SYMBOL VALUES, not just the segment sizes. A
 * pass can be the same size as its predecessor and lay out differently --
 * four bytes of new segment override against a jump that shrank by four --
 * and a loop that only watches sizes stops one pass early with every label
 * after the reshuffle holding a stale address. That is not a theoretical
 * hazard: it put a `CALL` four bytes inside the previous instruction, so a
 * procedure pushed one register where it meant to push three and returned
 * into its own entry point.
 *
 * Accuracy tier: encodings are round-trip-verified against a
 * vector-verified disassembler, so the byte level is as trustworthy as the
 * disassembler is. The DIRECTIVE level is verified only by what the corpus
 * exercises and by end-to-end runs under Tier B -- there is no MASM here to
 * diff a listing against, and no claim that a listing would match one.
 *
 * @module
 */

/** A refusal or a source error, always naming the line and the construct. */
export class AsmError extends Error {
    /** @param {string} message @param {{line?:number, text?:string, what?:string}} [ctx] */
    constructor(message, ctx = {}) {
        const where = ctx.line ? ` (line ${ctx.line})` : '';
        super(`8086 asm${where}: ${message}`);
        this.name = 'AsmError';
        this.line = ctx.line ?? 0;
        this.text = ctx.text ?? '';
        /** A short, stable tag for the construct refused -- what the corpus
         *  histogram is bucketed by. */
        this.what = ctx.what ?? 'error';
    }
}

const R8 = { al: 0, cl: 1, dl: 2, bl: 3, ah: 4, ch: 5, dh: 6, bh: 7 };
const R16 = { ax: 0, cx: 1, dx: 2, bx: 3, sp: 4, bp: 5, si: 6, di: 7 };
const SREG = { es: 0, cs: 1, ss: 2, ds: 3 };

/** base+index -> the r/m field. `[bp]` is absent because mod 0 rm 6 is the
 *  direct form; BP with no displacement must borrow a zero disp8. */
const RM_CODE = { 'bx,si': 0, 'bx,di': 1, 'bp,si': 2, 'bp,di': 3, ',si': 4, ',di': 5, 'bp,': 6, 'bx,': 7 };

const ALU = { add: 0, or: 1, adc: 2, sbb: 3, and: 4, sub: 5, xor: 6, cmp: 7 };
const SHIFT = { rol: 0, ror: 1, rcl: 2, rcr: 3, shl: 4, sal: 4, shr: 5, sar: 7 };
const GRP3 = { not: 2, neg: 3, mul: 4, imul: 5, div: 6, idiv: 7 };

/** Every conditional jump, including the aliases MASM accepts. The 8086 has
 *  only the 8-bit-displacement form, so an out-of-range target is an error
 *  and not something to widen. */
const JCC = {
    jo: 0x70, jno: 0x71,
    jb: 0x72, jnae: 0x72, jc: 0x72,
    jnb: 0x73, jae: 0x73, jnc: 0x73,
    je: 0x74, jz: 0x74,
    jne: 0x75, jnz: 0x75,
    jbe: 0x76, jna: 0x76,
    jnbe: 0x77, ja: 0x77,
    js: 0x78, jns: 0x79,
    jp: 0x7a, jpe: 0x7a, jnp: 0x7b, jpo: 0x7b,
    jl: 0x7c, jnge: 0x7c, jnl: 0x7d, jge: 0x7d,
    jle: 0x7e, jng: 0x7e, jnle: 0x7f, jg: 0x7f,
};

/** The string primitives, suffixed form only -- see NOT SUPPORTED. */
const STRING_OPS = {
    movsb: 0xa4, movsw: 0xa5, cmpsb: 0xa6, cmpsw: 0xa7,
    stosb: 0xaa, stosw: 0xab, lodsb: 0xac, lodsw: 0xad,
    scasb: 0xae, scasw: 0xaf,
};
const REP_PREFIX = { rep: 0xf3, repe: 0xf3, repz: 0xf3, repne: 0xf2, repnz: 0xf2 };

/** No-operand instructions, opcode straight through. */
const NO_OPERAND = {
    nop: [0x90], cbw: [0x98], cwd: [0x99], cwde: null,
    wait: [0x9b], fwait: [0x9b], pushf: [0x9c], popf: [0x9d],
    sahf: [0x9e], lahf: [0x9f], xlat: [0xd7], xlatb: [0xd7],
    daa: [0x27], das: [0x2f], aaa: [0x37], aas: [0x3f],
    into: [0xce], iret: [0xcf], int3: [0xcc],
    hlt: [0xf4], cmc: [0xf5], clc: [0xf8], stc: [0xf9],
    cli: [0xfa], sti: [0xfb], cld: [0xfc], std: [0xfd],
    lock: [0xf0],
};

/** Directives that make the token BEFORE them a name being defined. */
const NAME_DEFINING = new Set(['db', 'dw', 'dd', 'dq', 'dt', 'equ', '=',
    'proc', 'endp', 'macro', 'segment', 'ends', 'label']);

/** Word operators in expressions, lowest precedence first. */
const BINARY_LEVELS = [
    ['or', 'xor'],
    ['and'],
    ['eq', 'ne', 'lt', 'le', 'gt', 'ge'],
    ['+', '-'],
    ['*', '/', 'mod', 'shl', 'shr'],
];

/** How many bytes a size keyword names. */
const SIZE_OF = { byte: 1, word: 2, dword: 4, qword: 8, tbyte: 10 };

// ---------------------------------------------------------------------------
// Line splitting.  A comment starts at the first `;` that is not inside a
// quoted string -- `DB ';'` is a real thing in the corpus and a naive
// indexOf(';') truncates it.
// ---------------------------------------------------------------------------

/** @returns {string} the line with its comment removed and ends trimmed */
function stripComment(line) {
    let quote = null;
    for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (quote) { if (c === quote) quote = null; }
        else if (c === "'" || c === '"') quote = c;
        else if (c === ';') return line.slice(0, i).trim();
    }
    return line.trim();
}

/** Split on `sep` at bracket/paren depth zero, outside quotes. */
function splitTop(text, sep) {
    const out = [];
    let depth = 0, quote = null, start = 0;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quote) { if (c === quote) quote = null; continue; }
        if (c === "'" || c === '"') { quote = c; continue; }
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === sep && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
    }
    out.push(text.slice(start));
    return out;
}

// ---------------------------------------------------------------------------
// Expression lexer.  Shared by operands, data initialisers and IF conditions.
// ---------------------------------------------------------------------------

/**
 * @param {string} text
 * @returns {{k:string, v:any}[]} k is 'num' | 'str' | 'id' | 'op'
 */
function lex(text, ctx) {
    const toks = [];
    let i = 0;
    while (i < text.length) {
        const c = text[i];
        if (/\s/.test(c)) { i++; continue; }
        if (c === "'" || c === '"') {
            // A doubled quote inside a same-quoted string is one literal
            // quote: `DB 'It''s'`. Without this the string ends early and
            // the rest of the line lexes as garbage.
            let s = '', j = i + 1;
            for (;;) {
                if (j >= text.length) {
                    throw new AsmError(`unterminated string ${text.slice(i, i + 20)}`,
                        { ...ctx, what: 'unterminated string' });
                }
                if (text[j] === c) {
                    if (text[j + 1] === c) { s += c; j += 2; continue; }
                    j++; break;
                }
                s += text[j++];
            }
            toks.push({ k: 'str', v: s });
            i = j;
            continue;
        }
        if (/[0-9]/.test(c)) {
            // The radix is a SUFFIX here (0FFh, 1010b, 777o, 12d, 99), and
            // B and D are both radix letters AND hex digits. A greedy run of
            // [0-9a-fA-F] therefore swallows the marker: `1010b` lexes as the
            // hex number 1010B unless the last character is reconsidered,
            // which turns a bit mask into 65,547.
            let j = i;
            // Underscores group digits (`0000_0010b`) and carry no value.
            while (j < text.length && /[0-9a-fA-F_]/.test(text[j])) j++;
            while (text[j - 1] === '_') j--;
            let run = text.slice(i, j).replace(/_/g, ''), radix = null;
            const suffix = (text[j] || '').toLowerCase();
            if (suffix === 'h') { radix = 16; j++; }
            else if (suffix === 'o' || suffix === 'q') { radix = 8; j++; }
            else if (suffix === 'y') { radix = 2; j++; }
            else {
                const last = run[run.length - 1].toLowerCase(), head = run.slice(0, -1);
                if (last === 'b' && /^[01]+$/.test(head)) { radix = 2; run = head; }
                else if (last === 'd' && /^[0-9]+$/.test(head)) { radix = 10; run = head; }
                else if (/^[0-9]+$/.test(run)) radix = 10;
                else radix = 16;         // a hex digit with no suffix; MASM would object
            }
            const v = parseInt(run, radix);
            if (!Number.isFinite(v)) {
                throw new AsmError(`cannot read the number ${text.slice(i, j)}`, { ...ctx, what: 'bad number' });
            }
            toks.push({ k: 'num', v });
            i = j;
            continue;
        }
        if (/[A-Za-z_@?$]/.test(c)) {
            let j = i;
            while (j < text.length && /[\w@?$.]/.test(text[j])) j++;
            toks.push({ k: 'id', v: text.slice(i, j) });
            i = j;
            continue;
        }
        if ('+-*/()[]:,'.includes(c)) { toks.push({ k: 'op', v: c }); i++; continue; }
        throw new AsmError(`unexpected character ${JSON.stringify(c)}`, { ...ctx, what: 'unexpected character' });
    }
    return toks;
}

/** A fresh expression value. Everything an operand needs to know travels in
 *  one object so that `+` can merge register terms with numeric ones. */
function newVal(v = 0) {
    return {
        v,                  // the numeric part
        base: null,         // bx | bp
        index: null,        // si | di
        mem: false,         // brackets were WRITTEN -- see `operand`
        ref: null,          // the symbol record behind a bare label
        reloc: null,        // a segment name whose paragraph must be patched
        segRel: 0,          // net count of relocatable label terms
        segName: null,      // which segment those labels live in
        known: true,        // false when a symbol is not resolved this pass
        forced: 0,          // a size keyword the operand carried
    };
}

// ---------------------------------------------------------------------------
// The assembler.
// ---------------------------------------------------------------------------

class Assembler {
    constructor(source, opts) {
        this.source = String(source).split(/\r?\n/);
        this.opts = opts;
        /** Symbols persist ACROSS passes on purpose: pass 1 needs to know
         *  that `HIGH` is a name and not the HIGH operator, and forward
         *  references need a value to size against. */
        this.symbols = new Map();
        this.macros = new Map();
        this.warnings = [];
        /** Sticky shrink decisions, indexed by a pass-stable jump counter.
         *  Once a jump is known to reach in 8 bits it stays short, which is
         *  what makes the pass loop terminate instead of oscillating. */
        this.shortJump = [];
        /** Sticky promotion decisions, filed under the same pass-stable
         *  counter. Promotion GROWS an instruction while the short-jump
         *  logic SHRINKS others, and a scheme that can do both without
         *  remembering can oscillate between two layouts forever. */
        this.promoted = [];
        this.localSeq = 0;
    }

    // -- segments ---------------------------------------------------------

    /** @returns {{name:string, bytes:number[], org:number, para:number, kind:string}} */
    segment(name, kind) {
        let s = this.segs.get(name);
        if (!s) {
            s = { name, bytes: [], org: this.origins.get(name) ?? 0, para: 0, kind };
            this.segs.set(name, s);
        }
        if (!this.segOrder.includes(name)) this.segOrder.push(name);
        return s;
    }

    /**
     * A source with no segment directives at all is a .COM program: one
     * segment at ORG 100h. Creating it lazily is what lets `EQU` and `MACRO`
     * appear before the first byte in EVERY dialect the corpus uses, while
     * still refusing code that lands outside an explicitly opened segment.
     */
    ensureSegment() {
        if (this.cur) return this.cur;
        if (this.lastSeg) {
            // Seven corpus files append helper procedures AFTER `CODE ENDS`
            // and then name a label inside them from `END`. MASM refuses
            // that; the intent is not ambiguous, so the segment reopens and
            // the fact is recorded rather than assumed away.
            this.note(`this is outside any segment; it has been put back into "${this.lastSeg.name}"`);
            this.cur = this.lastSeg;
            return this.cur;
        }
        if (this.model || this.explicitSegments) {
            throw new AsmError(
                'this is before .CODE / .DATA or outside any SEGMENT, so there is nowhere to put it',
                { ...this.ctx, what: 'outside segment' });
        }
        this.cur = this.segment('_TEXT', 'code');
        this.codeSegName = '_TEXT';
        // NOTHING is assumed here. An earlier version wrote the flat-.COM
        // assumption (all four registers hold the one segment) into the
        // table at this point, which is true for a .COM and a lie for a
        // program that opens real segments LATER: an emu8086 coursework
        // file whose macro library lands outside a segment picked up
        // `DS:_TEXT`, and every later reference to its own DATA segment was
        // then refused as unreachable. Flatness is decided in
        // `autoOverride`, from what the program turned out to be.
        if (!this.cur.bytes.length && !this.sawOrg) this.cur.org = 0x100;
        return this.cur;
    }

    get here() { return this.ensureSegment().org + this.cur.bytes.length; }

    emit(...bytes) {
        this.ensureSegment();
        for (const b of bytes) this.cur.bytes.push(b & 0xff);
    }

    emitWord(v) { this.emit(v & 0xff, (v >> 8) & 0xff); }

    /** Record that the word about to be emitted holds a segment paragraph
     *  and must be biased by the load address. */
    reloc(segName) {
        this.relocs.push({ seg: this.cur, off: this.cur.bytes.length, target: segName });
    }

    // -- the line source --------------------------------------------------

    /** Push a body (macro expansion, REPT body) in front of the input. */
    push(lines, name) {
        if (this.stack.length > 48) throw new AsmError(
            `${name} nests more than 48 deep -- a macro that invokes itself?`,
            { ...this.ctx, what: 'macro recursion' });
        this.stack.push({ lines, i: 0, name });
    }

    nextLine() {
        while (this.stack.length) {
            const top = this.stack[this.stack.length - 1];
            if (top.i >= top.lines.length) { this.stack.pop(); continue; }
            const entry = top.lines[top.i++];
            if (++this.lineBudget > 400_000) throw new AsmError('expansion produced more than 400,000 lines',
                { ...this.ctx, what: 'expansion runaway' });
            return entry;
        }
        return null;
    }

    // -- expression evaluation --------------------------------------------

    /**
     * @param {{k:string,v:any}[]} toks
     * @returns {{val:object, next:number}}
     */
    parseExpr(toks, pos = 0, level = 0) {
        if (level >= BINARY_LEVELS.length) return this.parseUnary(toks, pos);
        let { val, next } = this.parseExpr(toks, pos, level + 1);
        for (;;) {
            const t = toks[next];
            if (!t) break;
            const op = t.k === 'op' ? t.v : (t.k === 'id' ? t.v.toLowerCase() : null);
            // A word operator loses to a symbol of the same name -- see the
            // module header. `AND`/`OR`/`SHL` are never symbol names here
            // because they are also mnemonics, so only the value-like ones
            // (LOW, HIGH, ...) can collide, and those are unary.
            if (!op || !BINARY_LEVELS[level].includes(op)) break;
            if (t.k === 'id' && this.symbols.has(op)) break;
            const rhs = this.parseExpr(toks, next + 1, level + 1);
            val = this.combine(op, val, rhs.val);
            next = rhs.next;
        }
        return { val, next };
    }

    combine(op, a, b) {
        const out = newVal();
        out.known = a.known && b.known;
        if (op === '+' || op === '-') {
            const sign = op === '+' ? 1 : -1;
            out.base = a.base ?? (sign > 0 ? b.base : null);
            out.index = a.index ?? (sign > 0 ? b.index : null);
            if (sign > 0 && a.base && b.base) throw new AsmError('two base registers in one address',
                { ...this.ctx, what: 'bad address' });
            if (sign > 0 && a.index && b.index) throw new AsmError('two index registers in one address',
                { ...this.ctx, what: 'bad address' });
            if (sign < 0 && (b.base || b.index)) throw new AsmError('a register cannot be subtracted',
                { ...this.ctx, what: 'bad address' });
            out.mem = a.mem || b.mem;
            out.ref = a.ref ?? b.ref;
            out.reloc = a.reloc ?? b.reloc;
            out.v = (a.v + sign * b.v) | 0;
            out.segRel = a.segRel + sign * b.segRel;
            out.segName = a.segName ?? b.segName;
            // Two labels in one segment subtract to a plain number, which is
            // how `LEN EQU $-MSG` works -- 84 corpus files depend on it.
            if (out.segRel === 0) out.segName = null;
            return out;
        }
        if (a.base || a.index || b.base || b.index) throw new AsmError(
            `a register cannot take part in "${op}"`,
            { ...this.ctx, what: 'bad address' });
        if (a.segRel || b.segRel) {
            // Multiplying an address by something is meaningless and
            // usually means a symbol was mistaken for a constant.
            if (op !== 'eq' && op !== 'ne' && op !== 'lt' && op !== 'le' && op !== 'gt' && op !== 'ge') {
                throw new AsmError(`"${op}" needs plain numbers, not addresses`,
                    { ...this.ctx, what: 'bad expression' });
            }
        }
        out.mem = a.mem || b.mem;
        const x = a.v, y = b.v;
        switch (op) {
            case '*': out.v = (x * y) | 0; break;
            case '/': if (y === 0) throw new AsmError('division by zero',
                { ...this.ctx, what: 'division by zero' }); out.v = Math.trunc(x / y); break;
            case 'mod': if (y === 0) throw new AsmError('division by zero',
                { ...this.ctx, what: 'division by zero' }); out.v = x % y; break;
            case 'shl': out.v = (x << y) | 0; break;
            case 'shr': out.v = x >>> y; break;
            case 'and': out.v = x & y; break;
            case 'or': out.v = x | y; break;
            case 'xor': out.v = x ^ y; break;
            // MASM's relational operators answer with all bits set, not 1,
            // so that `IF (A EQ B) AND MASK` behaves.
            case 'eq': out.v = x === y ? -1 : 0; break;
            case 'ne': out.v = x !== y ? -1 : 0; break;
            case 'lt': out.v = x < y ? -1 : 0; break;
            case 'le': out.v = x <= y ? -1 : 0; break;
            case 'gt': out.v = x > y ? -1 : 0; break;
            case 'ge': out.v = x >= y ? -1 : 0; break;
            default: throw new AsmError(`unknown operator "${op}"`, { ...this.ctx, what: 'bad expression' });
        }
        return out;
    }

    /**
     * A primary, plus any `[...]` groups written straight after it.
     * `ARRAY[SI]` is `ARRAY + SI` in MASM -- 300 corpus operands are written
     * that way -- and a parser that only understands brackets at the START
     * of an operand rejects every one of them.
     */
    parseUnary(toks, pos) {
        let r = this.parsePrimary(toks, pos);
        while (toks[r.next] && toks[r.next].k === 'op' && toks[r.next].v === '[') {
            const group = this.parsePrimary(toks, r.next);
            const merged = this.combine('+', r.val, group.val);
            merged.mem = true;
            merged.forced = r.val.forced || group.val.forced;
            merged.distance = r.val.distance || group.val.distance;
            r = { val: merged, next: group.next };
        }
        return r;
    }

    parsePrimary(toks, pos) {
        const t = toks[pos];
        if (!t) throw new AsmError('an expression ends where a value was expected',
            { ...this.ctx, what: 'bad expression' });
        if (t.k === 'op' && (t.v === '+' || t.v === '-')) {
            const r = this.parseUnary(toks, pos + 1);
            if (t.v === '+') return r;
            if (r.val.base || r.val.index) throw new AsmError('a register cannot be negated',
                { ...this.ctx, what: 'bad address' });
            const out = { ...r.val, v: -r.val.v, segRel: -r.val.segRel };
            return { val: out, next: r.next };
        }
        if (t.k === 'op' && t.v === '(') {
            const r = this.parseExpr(toks, pos + 1, 0);
            if (!toks[r.next] || toks[r.next].v !== ')') throw new AsmError('a "(" is not closed',
                { ...this.ctx, what: 'bad expression' });
            return { val: r.val, next: r.next + 1 };
        }
        if (t.k === 'op' && t.v === '[') {
            // Brackets are what make an operand a memory reference; the
            // contents are just an expression, so `SYM[BX+2]` and
            // `[SYM+BX+2]` are the same thing by construction.
            const r = this.parseExpr(toks, pos + 1, 0);
            if (!toks[r.next] || toks[r.next].v !== ']') throw new AsmError('a "[" is not closed',
                { ...this.ctx, what: 'bad expression' });
            return { val: { ...r.val, mem: true }, next: r.next + 1 };
        }
        if (t.k === 'num') return { val: newVal(t.v), next: pos + 1 };
        if (t.k === 'str') {
            // 'A' is 41h; 'AB' is 4142h, the first character in the high
            // half, which is the opposite of how DB lays the same two bytes
            // out. Both are MASM's rules.
            if (t.v.length === 0) throw new AsmError('an empty string has no value',
                { ...this.ctx, what: 'bad expression' });
            if (t.v.length > 2) throw new AsmError(
                `the string ${JSON.stringify(t.v)} is too long to be a number`,
                { ...this.ctx, what: 'string too long' });
            let v = 0;
            for (const ch of t.v) v = (v << 8) | (ch.charCodeAt(0) & 0xff);
            // A character literal knows its own width, and that is the one
            // case where an otherwise sizeless operand settles without a
            // guess -- see `agreeWidth`.
            const out = newVal(v);
            out.chars = t.v.length;
            return { val: out, next: pos + 1 };
        }
        if (t.k !== 'id') throw new AsmError(`"${t.v}" cannot start a value`,
            { ...this.ctx, what: 'bad expression' });

        const name = t.v.toLowerCase();
        // `$` is the offset of the instruction or item being assembled.
        if (name === '$') return { val: this.labelValue({ kind: 'code', seg: this.cur, value: this.here }), next: pos + 1 };
        if (name === '@data') {
            if (!this.dataSegName) throw new AsmError(
                '@DATA needs a data segment (.DATA or a SEGMENT), and this source has none',
                { ...this.ctx, what: '@DATA without data segment' });
            const out = newVal(0);
            out.reloc = this.dataSegName;
            return { val: out, next: pos + 1 };
        }
        if (name === '@code') {
            const out = newVal(0);
            out.reloc = this.codeSegName;
            return { val: out, next: pos + 1 };
        }
        // Register terms inside an address.
        if (name === 'bx' || name === 'bp') { const o = newVal(); o.base = name; return { val: o, next: pos + 1 }; }
        if (name === 'si' || name === 'di') { const o = newVal(); o.index = name; return { val: o, next: pos + 1 }; }

        // Unary word operators, each of which loses to a symbol of the same
        // name -- see the module header.
        if (!this.symbols.has(name)) {
            if (name === 'offset' || name === 'seg') {
                const r = this.parseUnary(toks, pos + 1);
                if (!r.val.ref && !r.val.segRel) throw new AsmError(`${name.toUpperCase()} needs a label`,
                    { ...this.ctx, what: `${name} of non-label` });
                if (name === 'offset') { const o = { ...r.val, mem: false, ref: null }; return { val: o, next: r.next }; }
                const o = newVal(0);
                o.known = r.val.known;
                if (!r.val.segName) throw new AsmError('SEG needs a label in a named segment',
                    { ...this.ctx, what: 'seg without segment' });
                o.reloc = r.val.segName;
                return { val: o, next: r.next };
            }
            if (name === 'not') {
                const r = this.parseUnary(toks, pos + 1);
                return { val: { ...newVal(~r.val.v), known: r.val.known }, next: r.next };
            }
            if (name === 'low' || name === 'high') {
                const r = this.parseUnary(toks, pos + 1);
                const v = name === 'low' ? (r.val.v & 0xff) : ((r.val.v >> 8) & 0xff);
                return { val: { ...newVal(v), known: r.val.known }, next: r.next };
            }
            if (name === 'type' || name === 'length' || name === 'size' || name === 'lengthof' || name === 'sizeof') {
                const r = this.parseUnary(toks, pos + 1);
                const sym = r.val.ref;
                if (!sym) throw new AsmError(`${name.toUpperCase()} needs a declared label`,
                    { ...this.ctx, what: `${name} of non-label` });
                const type = sym.type || 1, count = sym.count || 1;
                const v = name === 'type' ? type : name === 'length' || name === 'lengthof' ? count : type * count;
                return { val: newVal(v), next: r.next };
            }
            if (SIZE_OF[name] !== undefined) {
                // `WORD PTR x`, and `TABLE LABEL WORD` handled by the caller.
                if (toks[pos + 1] && toks[pos + 1].k === 'id' && toks[pos + 1].v.toLowerCase() === 'ptr') {
                    const r = this.parseUnary(toks, pos + 2);
                    return { val: { ...r.val, forced: SIZE_OF[name] }, next: r.next };
                }
            }
            if (name === 'short' || name === 'near' || name === 'far') {
                let at = pos + 1;
                if (toks[at] && toks[at].k === 'id' && toks[at].v.toLowerCase() === 'ptr') at++;
                const r = this.parseUnary(toks, at);
                return { val: { ...r.val, distance: name }, next: r.next };
            }
        }

        // A plain symbol.
        const sym = this.symbols.get(name);
        if (!sym) {
            // Unknown on this pass. Sizing must not depend on the value, so
            // hand back a placeholder wide enough to force the widest form.
            const o = newVal(0x7fff);
            o.known = false;
            o.segRel = 1;
            o.segName = this.cur ? this.cur.name : null;
            o.mem = true;
            this.unresolved.add(t.v);
            return { val: o, next: pos + 1 };
        }
        if (sym.kind === 'segment') {
            const o = newVal(0);
            o.reloc = sym.name;
            return { val: o, next: pos + 1 };
        }
        if (sym.kind === 'equ') {
            const o = newVal(sym.value);
            o.known = sym.known !== false;
            return { val: o, next: pos + 1 };
        }
        return { val: this.labelValue(sym), next: pos + 1 };
    }

    /**
     * A data or code label: an offset in its segment.
     *
     * It does NOT set `mem`. A bare label is a memory reference and an
     * OFFSET is a number, but which one this is cannot be decided here --
     * only after the whole expression is known, because `TABLE_END - TABLE`
     * is a plain count of bytes while `TABLE_END` alone is an address. What
     * marks it is `segRel`, which subtraction cancels. See `operand`.
     */
    labelValue(sym) {
        const o = newVal(sym.value);
        o.segRel = 1;
        o.segName = sym.seg ? sym.seg.name : null;
        o.ref = sym;
        o.known = sym.known !== false;
        return o;
    }

    /** Evaluate a whole expression string, insisting nothing is left over. */
    evalText(text) {
        const toks = lex(text, this.ctx);
        if (!toks.length) throw new AsmError('an operand is empty', { ...this.ctx, what: 'empty operand' });
        const r = this.parseExpr(toks, 0, 0);
        if (r.next !== toks.length) throw new AsmError(`cannot read the operand "${text.trim()}"`,
            { ...this.ctx, what: 'bad operand' });
        return r.val;
    }

    // -- operands ---------------------------------------------------------

    /**
     * @param {string} text
     * @returns {object} one of the operand shapes described in the header
     */
    operand(text) {
        let t = text.trim();
        let forced = 0, segOverride = null, distance = null;

        // A size keyword and a segment override are prefixes, and both can
        // appear: `BYTE PTR ES:[DI]`.
        for (;;) {
            let m = /^(byte|word|dword|qword|tbyte)\s+ptr\b/i.exec(t);
            if (m && !this.symbols.has(m[1].toLowerCase())) {
                forced = SIZE_OF[m[1].toLowerCase()];
                t = t.slice(m[0].length).trim();
                continue;
            }
            m = /^(short|near|far)\s+(ptr\s+)?/i.exec(t);
            if (m && !this.symbols.has(m[1].toLowerCase())) {
                distance = m[1].toLowerCase();
                t = t.slice(m[0].length).trim();
                continue;
            }
            m = /^(cs|ds|es|ss)\s*:/i.exec(t);
            if (m) { segOverride = m[1].toLowerCase(); t = t.slice(m[0].length).trim(); continue; }
            break;
        }

        // A LITERAL FAR POINTER, `0F000h:005Ch`.
        //
        // This is the only syntax that reaches EA and 9A without a
        // relocation, and without it a ROM cannot express a far jump at all:
        // `JMP FAR PTR label` needs a label in a named segment and emits a
        // fixup, which a flat image has nowhere to put. A reset vector and a
        // jump to a boot sector are both literal seg:off pairs known at
        // assembly time, and a BIOS written here had to hand-encode both as
        // `db 0EAh / dw off / dw seg`.
        //
        // A segment-register override was already eaten above, and a `:`
        // inside brackets is at depth one, so what is left at depth zero can
        // only be this.
        const halves = splitTop(t, ':');
        if (halves.length > 1) {
            if (halves.length > 2) {
                throw new AsmError(`"${text.trim()}" has more than one ":" in it`,
                    { ...this.ctx, what: 'bad far pointer' });
            }
            if (segOverride) {
                throw new AsmError('a segment override and a far pointer cannot both apply here',
                    { ...this.ctx, what: 'bad far pointer' });
            }
            const seg = this.evalText(halves[0]);
            const off = this.evalText(halves[1]);
            for (const [half, which] of [[seg, 'segment'], [off, 'offset']]) {
                if (half.base || half.index) {
                    throw new AsmError(`the ${which} half of a far pointer cannot hold a register`,
                        { ...this.ctx, what: 'bad far pointer' });
                }
            }
            return { k: 'far', seg, off, distance: distance || 'far', text };
        }

        const low = t.toLowerCase();
        if (R8[low] !== undefined) return { k: 'r8', n: R8[low], text };
        if (R16[low] !== undefined) return { k: 'r16', n: R16[low], text };
        if (SREG[low] !== undefined) return { k: 'sr', n: SREG[low], text };

        const v = this.evalText(t);
        if (forced) v.forced = forced;
        // WHAT MAKES AN OPERAND A MEMORY REFERENCE, and the one place a
        // label difference used to go wrong.
        //
        // Brackets make one. A base or index register makes one. And a bare
        // label makes one -- `MOV AX, TABLE` loads the contents, which is
        // MASM's rule and the thing a naive implementation inverts.
        //
        // But a label DIFFERENCE is not a label: `MOV AX, TABLE_END - TABLE`
        // is the number of bytes between them, and `segRel` going to zero is
        // exactly what says so. Carrying the memory flag through the
        // subtraction instead -- which an earlier version did, by setting it
        // on the label itself -- turned that into a LOAD FROM ADDRESS 20 and
        // a table that reported its size as whatever happened to be stored
        // there. It printed a confident zero, threw nothing, and no test
        // failed; the corpus's own simulator caught it.
        //
        // The `EQU` path never had the bug, because it asks `segRel && ref`
        // rather than reading the flag -- which is why 84 files using
        // `LEN EQU $-MSG` were right and the four that write the difference
        // straight into an instruction were not.
        const isMem = v.mem || v.base || v.index || (v.segRel !== 0 && v.ref);
        if (isMem) {
            return {
                k: 'm', base: v.base, index: v.index, disp: v.v,
                seg: segOverride, size: v.forced || (v.ref ? v.ref.type || 0 : 0),
                known: v.known, segRel: v.segRel, segName: v.segName, ref: v.ref,
                distance: distance || v.distance || null, text,
            };
        }
        if (segOverride) throw new AsmError('a segment override needs a memory operand',
            { ...this.ctx, what: 'override without memory' });
        return {
            k: 'i', v: v.v, reloc: v.reloc, size: v.forced, known: v.known, chars: v.chars || 0,
            segRel: v.segRel, segName: v.segName, distance: distance || v.distance || null, text,
        };
    }

    // -- ModR/M -----------------------------------------------------------

    /**
     * The segment override a labelled address NEEDS but did not write.
     *
     * THIS IS THE BUG THAT COST THE MOST TO FIND, and it is silent by
     * construction. A memory operand reaches DS by default (SS when BP is
     * the base). If the label it names lives in a segment that register is
     * not assumed to hold, the instruction reads or writes the wrong
     * segment and NOTHING says so: the program runs, prints plausible
     * output, and exits.
     *
     * Five corpus files declare `DW` after `.CODE`, which puts the variable
     * in _TEXT while `MOV FIRST_AT, AX` still reaches through DS. With
     * _DATA at paragraph 0 and _TEXT at paragraph 6 of the same image,
     * DS:00B9h aliases _TEXT:0059h -- the operand byte of an `INT 21H` --
     * so the store turned `cd 21` into `cd 02` and a print became an NMI.
     * The EMITTED BYTES WERE CORRECT; only the running program was wrong,
     * which is why no amount of disassembling the output could have found
     * it and only running the program did.
     *
     * MASM does exactly this from its own ASSUME, and an earlier version of
     * this module deliberately did not, on the belief that every program in
     * the corpus reaches its data through DS. Four of them do not.
     *
     * @returns {string|null} the register to override with
     */
    autoOverride(o) {
        if (o.seg) return null;                       // written explicitly; leave it alone
        const want = o.ref && o.ref.seg ? o.ref.seg.name : null;
        if (!want) return null;                       // no label: nothing to check against
        // A program with one segment reaches everything through every
        // register, so there is nothing to override and nothing to warn
        // about. This is asked at USE time rather than recorded at segment
        // time because a source is not known to be flat until it ends.
        if (this.flatOutput()) return null;
        const dflt = o.base === 'bp' ? 'ss' : 'ds';
        // Not knowing what a register holds is not the same as knowing it is
        // wrong. Without an ASSUME (the bare SEGMENT dialect, which two
        // coursework programs use) this says nothing rather than guessing.
        if (!this.assume[dflt]) return null;
        if (this.assume[dflt] === want) return null;
        for (const r of ['ds', 'cs', 'es', 'ss']) if (this.assume[r] === want) return r;
        // Nothing reaches it. REFUSING here would be over-reach: the
        // assembler's model of what the registers hold is a static
        // approximation, and a program that loads DS itself at run time is
        // perfectly entitled to reach a segment no ASSUME mentions. Say so
        // and emit what was written.
        this.note(`"${o.ref.name}" is in segment ${want}, which no ASSUME reaches:`
            + ' no override was added, so this reaches whatever DS holds at the time');
        return null;
    }

    /** Bytes for the ModR/M and its displacement, plus any segment prefix.
     *  `auto` is false for LEA, which computes an address and reaches no
     *  segment at all, so an override there would be a wasted byte. */
    modrm(regField, o, auto = true) {
        if (o.k === 'r8' || o.k === 'r16' || o.k === 'sr') return { prefix: [], bytes: [0xc0 | (regField << 3) | o.n] };
        const over = o.seg || (auto ? this.autoOverride(o) : null);
        const prefix = over ? [[0x26, 0x2e, 0x36, 0x3e][SREG[over]]] : [];
        if (!o.base && !o.index) {
            // The direct form. Always a 16-bit displacement; there is no
            // shorter encoding for an absolute address on this machine.
            return { prefix, bytes: [(regField << 3) | 6, o.disp & 0xff, (o.disp >> 8) & 0xff] };
        }
        const key = `${o.base || ''},${o.index || ''}`;
        const rm = RM_CODE[key];
        if (rm === undefined) throw new AsmError(
            `[${o.base || ''}${o.base && o.index ? '+' : ''}${o.index || ''}] is not an 8086 address`,
            { ...this.ctx, what: 'bad address' });
        const d = o.disp | 0;
        // BP with no displacement would encode as the direct form, so it
        // borrows a zero displacement byte instead. Getting this wrong turns
        // `[BP]` into an absolute address, which is the classic 8086 bug.
        if (d === 0 && key !== 'bp,') return { prefix, bytes: [(regField << 3) | rm] };
        if (d >= -128 && d <= 127) return { prefix, bytes: [0x40 | (regField << 3) | rm, d & 0xff] };
        return { prefix, bytes: [0x80 | (regField << 3) | rm, d & 0xff, (d >> 8) & 0xff] };
    }

    /** Emit `opcode, modrm...` with the segment prefix in front. */
    emitRM(opcodes, regField, rm, tail = [], auto = true) {
        const { prefix, bytes } = this.modrm(regField, rm, auto);
        this.emit(...prefix, ...opcodes, ...bytes, ...tail);
    }

    // -- instruction encoding ---------------------------------------------

    /** Operand width in bytes, or 0 when nothing said. */
    width(o) {
        if (o.k === 'r8') return 1;
        if (o.k === 'r16' || o.k === 'sr') return 2;
        if (o.k === 'm') return o.size;
        return 0;
    }

    /** An immediate, checked against the width it is going into. */
    immBytes(o, w) {
        if (o.reloc) {
            if (w !== 2) throw new AsmError('a segment value is a word and will not fit a byte',
                { ...this.ctx, what: 'segment in byte' });
            return null;    // the caller must emit it itself, with a fixup
        }
        if (w === 1) {
            if (o.known && (o.v < -128 || o.v > 255)) throw new AsmError(`${o.v} does not fit in a byte`,
                { ...this.ctx, what: 'immediate too wide' });
            return [o.v & 0xff];
        }
        if (o.known && (o.v < -32768 || o.v > 65535)) throw new AsmError(`${o.v} does not fit in a word`,
            { ...this.ctx, what: 'immediate too wide' });
        return [o.v & 0xff, (o.v >> 8) & 0xff];
    }

    /** Emit a 16-bit immediate that may need a relocation entry. */
    emitImm16(o) {
        if (o.reloc) { this.reloc(o.reloc); this.emitWord(this.segParaOf(o.reloc)); }
        else this.emitWord(o.v);
    }

    /** Encode one instruction. `ops` are already-parsed operands. */
    encode(mn, ops, prefixes) {
        this.mn = mn;
        // Caught here rather than left to whatever the operand happens to
        // trip over further down, so that `MOV AX, 1:2` says what is wrong
        // with it instead of complaining about an operand size.
        if (ops.some((o) => o.k === 'far') && mn !== 'jmp' && mn !== 'call') {
            throw new AsmError(`a seg:off pair is a target for JMP or CALL, not for ${mn.toUpperCase()}`,
                { ...this.ctx, what: 'far pointer operand' });
        }
        for (const p of prefixes) this.emit(p);

        if (NO_OPERAND[mn]) {
            if (ops.length) throw new AsmError(`${mn.toUpperCase()} takes no operands`,
                { ...this.ctx, what: 'operand count' });
            return this.emit(...NO_OPERAND[mn]);
        }
        if (STRING_OPS[mn] !== undefined) {
            if (ops.length) throw new AsmError(
                `${mn.toUpperCase()} takes no operands here -- the explicit-operand string forms are not supported`,
                { ...this.ctx, what: 'string op with operands' });
            return this.emit(STRING_OPS[mn]);
        }
        if (ALU[mn] !== undefined) return this.aluOp(ALU[mn], ops);
        if (SHIFT[mn] !== undefined) return this.shiftOp(mn, SHIFT[mn], ops);
        if (GRP3[mn] !== undefined) return this.grp3Op(mn, GRP3[mn], ops);
        if (JCC[mn] !== undefined) return this.relJump(JCC[mn], ops, 1, mn);

        switch (mn) {
            case 'mov': return this.movOp(ops);
            case 'xchg': return this.xchgOp(ops);
            case 'test': return this.testOp(ops);
            case 'push': case 'pop': return this.pushPop(mn, ops);
            case 'inc': case 'dec': return this.incDec(mn, ops);
            case 'lea': return this.leaOp(ops);
            case 'lds': case 'les': return this.loadFar(mn, ops);
            case 'int': return this.intOp(ops);
            case 'in': case 'out': return this.portOp(mn, ops);
            case 'jmp': return this.branch('jmp', ops, 4, 5, 0xe9, 0xea);
            case 'call': return this.branch('call', ops, 2, 3, 0xe8, 0x9a);
            case 'ret': case 'retn': return this.retOp(ops, this.procFar ? 0xcb : 0xc3, this.procFar ? 0xca : 0xc2);
            case 'retf': return this.retOp(ops, 0xcb, 0xca);
            case 'loop': return this.relJump(0xe2, ops, 1, mn);
            case 'loope': case 'loopz': return this.relJump(0xe1, ops, 1, mn);
            case 'loopne': case 'loopnz': return this.relJump(0xe0, ops, 1, mn);
            case 'jcxz': return this.relJump(0xe3, ops, 1, mn);
            case 'aam': case 'aad': {
                // MASM emits the base as an operand byte; bare AAM/AAD mean
                // base ten, which is the only base anybody uses.
                const base = ops.length ? ops[0] : { k: 'i', v: 10, known: true };
                this.expect(ops.length <= 1, `${mn.toUpperCase()} takes at most one operand`);
                if (base.k !== 'i') throw new AsmError(`${mn.toUpperCase()} needs an immediate base`,
                    { ...this.ctx, what: 'operand kind' });
                return this.emit(mn === 'aam' ? 0xd4 : 0xd5, base.v & 0xff);
            }
            default:
                throw new AsmError(`"${mn.toUpperCase()}" is not an instruction this assembler knows`,
                    { ...this.ctx, what: `unknown mnemonic ${mn.toUpperCase()}` });
        }
    }

    expect(cond, message, what = 'operand count') {
        if (!cond) throw new AsmError(message, { ...this.ctx, what });
    }

    /** The width both operands agree on, or an error naming the conflict. */
    agreeWidth(mn, a, b) {
        const wa = this.width(a), wb = this.width(b);
        if (wa && wb && wa !== wb) throw new AsmError(
            `${mn.toUpperCase()} has a ${wa}-byte and a ${wb}-byte operand`,
            { ...this.ctx, what: 'operand size mismatch' });
        const w = wa || wb || this.impliedWidth(mn, a, b);
        if (!w) throw new AsmError(
            `${mn.toUpperCase()} cannot tell whether this is a byte or a word -- say BYTE PTR or WORD PTR`,
            { ...this.ctx, what: 'operand size unknown' });
        if (w !== 1 && w !== 2) throw new AsmError(
            `${mn.toUpperCase()} cannot take a ${w}-byte operand on an 8086`,
            { ...this.ctx, what: 'operand size' });
        return w;
    }

    /**
     * The width of `MOV [SI], 'x'` and `MOV [SI-1], cret`, where neither
     * operand carries one.
     *
     * MASM refuses this outright and an earlier version here did too, on the
     * grounds that guessing is the silent wrongness this assembler exists to
     * avoid. That was too strict, and the argument that changed it is this:
     * MASM and NASM BOTH refuse the form, so no program that ever assembled
     * anywhere was written expecting a WORD store from it. Every dialect
     * that accepts it -- emu8086, which these corpora target -- makes it a
     * byte. A word default would contradict every existing program; a byte
     * default contradicts none.
     *
     * The immediate still gets a vote and it overrules: a character literal
     * says its own width (`'AB'` is a word by MASM's own rule), and a value
     * that will not fit in a byte must be a word. So this narrows to a
     * guess only where every reading agrees, and it says so out loud.
     */
    impliedWidth(mn, a, b) {
        const imm = a.k === 'i' ? a : b.k === 'i' ? b : null;
        const mem = a.k === 'm' ? a : b.k === 'm' ? b : null;
        if (!imm || !mem) return 0;
        if (imm.chars === 1) return 1;
        if (imm.chars === 2) return 2;
        if (!imm.known) return 2;                 // unresolved: take the wide form
        const fitsByte = imm.v >= -128 && imm.v <= 255;
        this.note(`${mn.toUpperCase()} has no declared size; ${imm.text.trim()} fits`
            + ` a ${fitsByte ? 'byte' : 'word'}, so that is what was stored`);
        return fitsByte ? 1 : 2;
    }

    aluOp(code, ops) {
        this.expect(ops.length === 2, 'this instruction takes two operands');
        const [d, s] = ops;
        if (s.k === 'i') {
            const ww = this.agreeWidth(this.mn, d, s);
            // The accumulator has a short form with no ModR/M at all.
            if ((d.k === 'r8' && d.n === 0) || (d.k === 'r16' && d.n === 0)) {
                const bytes = this.immBytes(s, ww);
                this.emit((code << 3) | 0x04 | (ww === 2 ? 1 : 0));
                if (bytes) this.emit(...bytes); else this.emitImm16(s);
                return;
            }
            if (ww === 1) return this.emitRM([0x80], code, d, this.immBytes(s, 1));
            // 83 sign-extends a byte into a word, which is two bytes shorter
            // and what MASM picks whenever the value fits.
            if (!s.reloc && s.known && s.v >= -128 && s.v <= 127) return this.emitRM([0x83], code, d, [s.v & 0xff]);
            const bytes = this.immBytes(s, 2);
            if (bytes) return this.emitRM([0x81], code, d, bytes);
            const { prefix, bytes: mrm } = this.modrm(code, d);
            this.emit(...prefix, 0x81, ...mrm);
            return this.emitImm16(s);
        }
        if (d.k === 'r8' || d.k === 'r16') {
            const w = this.agreeWidth('alu', d, s);
            if (s.k === 'm') return this.emitRM([(code << 3) | 0x02 | (w === 2 ? 1 : 0)], d.n, s);
            return this.emitRM([(code << 3) | 0x00 | (w === 2 ? 1 : 0)], s.n, d);
        }
        this.expect(s.k === 'r8' || s.k === 'r16', 'one operand must be a register');
        const w = this.agreeWidth('alu', d, s);
        return this.emitRM([(code << 3) | (w === 2 ? 1 : 0)], s.n, d);
    }

    shiftOp(mn, code, ops) {
        this.expect(ops.length === 2, `${mn.toUpperCase()} takes a destination and a count`);
        const [d, c] = ops;
        const w = this.width(d);
        if (!w) throw new AsmError(
            `${mn.toUpperCase()} cannot tell whether this is a byte or a word -- say BYTE PTR or WORD PTR`,
            { ...this.ctx, what: 'operand size unknown' });
        if (c.k === 'r8' && c.n === R8.cl) return this.emitRM([0xd2 | (w === 2 ? 1 : 0)], code, d);
        if (c.k !== 'i') throw new AsmError(`${mn.toUpperCase()} counts by 1 or by CL`,
            { ...this.ctx, what: 'bad shift count' });
        if (!c.known) throw new AsmError(`${mn.toUpperCase()} needs a count known at assembly time`,
            { ...this.ctx, what: 'bad shift count' });
        if (c.v === 1) return this.emitRM([0xd0 | (w === 2 ? 1 : 0)], code, d);
        // See the module header: C1 is not a shift on an 8086, it is
        // `RET imm16`. Repeating the single-count form is the only correct
        // encoding of what the programmer wrote.
        if (c.v < 0 || c.v > 31) throw new AsmError(`a shift count of ${c.v} is not meaningful`,
            { ...this.ctx, what: 'bad shift count' });
        this.note(`${mn.toUpperCase()} by ${c.v} expanded into ${c.v} single shifts:`
            + ' the immediate-count form is an 80186 instruction');
        for (let i = 0; i < c.v; i++) this.emitRM([0xd0 | (w === 2 ? 1 : 0)], code, d);
    }

    grp3Op(mn, code, ops) {
        // IMUL and MUL take one operand on an 8086; the three-operand form
        // is 80186 and is refused rather than guessed at.
        this.expect(ops.length === 1,
            `${mn.toUpperCase()} takes one operand on an 8086`, ops.length > 1 ? 'i186 form' : 'operand count');
        const w = this.width(ops[0]);
        if (!w) throw new AsmError(
            `${mn.toUpperCase()} cannot tell whether this is a byte or a word -- say BYTE PTR or WORD PTR`,
            { ...this.ctx, what: 'operand size unknown' });
        return this.emitRM([0xf6 | (w === 2 ? 1 : 0)], code, ops[0]);
    }

    movOp(ops) {
        this.expect(ops.length === 2, 'MOV takes two operands');
        const [d, s] = ops;
        if (d.k === 'sr') {
            this.expect(s.k === 'r16' || s.k === 'm',
                'a segment register loads from a word register or memory');
            if (s.k === 'm' && s.size && s.size !== 2) throw new AsmError('a segment register loads a word',
                { ...this.ctx, what: 'operand size mismatch' });
            return this.emitRM([0x8e], d.n, s);
        }
        if (s.k === 'sr') {
            this.expect(d.k === 'r16' || d.k === 'm',
                'a segment register stores to a word register or memory');
            return this.emitRM([0x8c], s.n, d);
        }
        if (s.k === 'i') {
            if (d.k === 'r8') { const b = this.immBytes(s, 1); return this.emit(0xb0 | d.n, ...b); }
            if (d.k === 'r16') {
                // A .COM image has ONE segment and no relocation table, and
                // at entry CS = DS = ES = SS = that segment. `SEG x` is
                // therefore CS by definition, and `MOV r, CS` is the only
                // encoding that can express it -- `MOV r, imm` would need a
                // fixup the format cannot carry. Recorded, not silent.
                if (s.reloc && this.flatOutput()) {
                    this.note(`SEG resolves to CS here: a .COM image is one segment and carries no relocations`);
                    return this.emit(0x8c, 0xc0 | (SREG.cs << 3) | d.n);
                }
                this.emit(0xb8 | d.n);
                return this.emitImm16(s);
            }
            this.expect(d.k === 'm', 'MOV needs a register or memory destination');
            const w = this.width(d) || s.size || this.impliedWidth('mov', d, s);
            if (!w) throw new AsmError(
                'MOV cannot tell whether this stores a byte or a word -- say BYTE PTR or WORD PTR',
                { ...this.ctx, what: 'operand size unknown' });
            if (w === 1) return this.emitRM([0xc6], 0, d, this.immBytes(s, 1));
            const bytes = this.immBytes(s, 2);
            if (bytes) return this.emitRM([0xc7], 0, d, bytes);
            const { prefix, bytes: mrm } = this.modrm(0, d);
            this.emit(...prefix, 0xc7, ...mrm);
            return this.emitImm16(s);
        }
        // The accumulator-to-direct-address forms are one byte shorter and
        // are what MASM picks. They disassemble identically to 8A/8B, so the
        // round trip does not care -- but the byte count does.
        const direct = (m, w) => m.k === 'm' && !m.base && !m.index && (!m.size || m.size === w);
        if (s.k === 'r8' && s.n === 0 && direct(d, 1)) return this.emitAcc(0xa2, d);
        if (s.k === 'r16' && s.n === 0 && direct(d, 2)) return this.emitAcc(0xa3, d);
        if (d.k === 'r8' && d.n === 0 && direct(s, 1)) return this.emitAcc(0xa0, s);
        if (d.k === 'r16' && d.n === 0 && direct(s, 2)) return this.emitAcc(0xa1, s);
        if (d.k === 'r8' || d.k === 'r16') {
            const w = this.agreeWidth('mov', d, s);
            if (s.k === 'm') return this.emitRM([0x8a | (w === 2 ? 1 : 0)], d.n, s);
            return this.emitRM([0x88 | (w === 2 ? 1 : 0)], s.n, d);
        }
        this.expect(s.k === 'r8' || s.k === 'r16', 'MOV cannot move memory to memory', 'memory to memory');
        const w = this.agreeWidth('mov', d, s);
        return this.emitRM([0x88 | (w === 2 ? 1 : 0)], s.n, d);
    }

    emitAcc(opcode, m) {
        const over = m.seg || this.autoOverride(m);
        const prefix = over ? [[0x26, 0x2e, 0x36, 0x3e][SREG[over]]] : [];
        this.emit(...prefix, opcode, m.disp & 0xff, (m.disp >> 8) & 0xff);
    }

    xchgOp(ops) {
        this.expect(ops.length === 2, 'XCHG takes two operands');
        let [a, b] = ops;
        // The one-byte form only exists against AX.
        if (b.k === 'r16' && b.n === 0 && a.k === 'r16') return this.emit(0x90 | a.n);
        if (a.k === 'r16' && a.n === 0 && b.k === 'r16') return this.emit(0x90 | b.n);
        if (a.k === 'm') [a, b] = [b, a];
        this.expect(a.k === 'r8' || a.k === 'r16', 'XCHG needs at least one register');
        const w = this.agreeWidth('xchg', a, b);
        return this.emitRM([0x86 | (w === 2 ? 1 : 0)], a.n, b);
    }

    testOp(ops) {
        this.expect(ops.length === 2, 'TEST takes two operands');
        const [d, s] = ops;
        if (s.k === 'i') {
            const w = this.agreeWidth('test', d, s);
            if ((d.k === 'r8' || d.k === 'r16') && d.n === 0) {
                const b = this.immBytes(s, w);
                this.emit(0xa8 | (w === 2 ? 1 : 0));
                if (b) this.emit(...b); else this.emitImm16(s);
                return;
            }
            const bytes = this.immBytes(s, w);
            if (bytes) return this.emitRM([0xf6 | (w === 2 ? 1 : 0)], 0, d, bytes);
            const { prefix, bytes: mrm } = this.modrm(0, d);
            this.emit(...prefix, 0xf7, ...mrm);
            return this.emitImm16(s);
        }
        // The SECOND operand goes in the reg field, the first in the r/m --
        // the same direction as `ALU r/m, r`. TEST is commutative so the
        // wrong way round still computes the right flags, but it assembles
        // to different bytes from MASM's and the round trip catches it.
        const reg = (s.k === 'r8' || s.k === 'r16') ? s : d;
        const other = reg === s ? d : s;
        this.expect(reg.k === 'r8' || reg.k === 'r16', 'TEST needs a register operand');
        const w = this.agreeWidth('test', reg, other);
        return this.emitRM([0x84 | (w === 2 ? 1 : 0)], reg.n, other);
    }

    pushPop(mn, ops) {
        this.expect(ops.length === 1, `${mn.toUpperCase()} takes one operand`);
        const o = ops[0];
        if (o.k === 'r16') return this.emit((mn === 'push' ? 0x50 : 0x58) | o.n);
        if (o.k === 'sr') {
            // POP CS exists in silicon and is a way to crash; MASM refuses
            // it and so does this.
            if (mn === 'pop' && o.n === SREG.cs) throw new AsmError(
                'POP CS is not an instruction a program should contain',
                { ...this.ctx, what: 'pop cs' });
            return this.emit((o.n << 3) | (mn === 'push' ? 0x06 : 0x07));
        }
        if (o.k === 'i') throw new AsmError(`${mn.toUpperCase()} of an immediate is an 80186 instruction`,
            { ...this.ctx, what: 'i186 push imm' });
        if (o.k === 'r8') throw new AsmError(`${mn.toUpperCase()} works on words, not on ${o.text.trim()}`,
            { ...this.ctx, what: 'operand size' });
        if (o.size && o.size !== 2) throw new AsmError(`${mn.toUpperCase()} works on words`,
            { ...this.ctx, what: 'operand size' });
        return mn === 'push' ? this.emitRM([0xff], 6, o) : this.emitRM([0x8f], 0, o);
    }

    incDec(mn, ops) {
        this.expect(ops.length === 1, `${mn.toUpperCase()} takes one operand`);
        const o = ops[0];
        if (o.k === 'r16') return this.emit((mn === 'inc' ? 0x40 : 0x48) | o.n);
        const w = this.width(o);
        if (!w) throw new AsmError(
            `${mn.toUpperCase()} cannot tell whether this is a byte or a word -- say BYTE PTR or WORD PTR`,
            { ...this.ctx, what: 'operand size unknown' });
        return this.emitRM([0xfe | (w === 2 ? 1 : 0)], mn === 'inc' ? 0 : 1, o);
    }

    leaOp(ops) {
        this.expect(ops.length === 2, 'LEA takes a register and an address');
        this.expect(ops[0].k === 'r16', 'LEA loads a word register');
        if (ops[1].k === 'r16' && RM_CODE[`,${R16_NAME[ops[1].n]}`] !== undefined) {
            // `LEA DX, SI` has no other possible reading: LEA's source is an
            // address, a bare register is not one, and the only address that
            // register could name is [SI]. The coursework program that
            // writes it goes straight on to `MOV AH,9 / INT 21H`, so it
            // wants DX = SI -- exactly what this produces. Recorded, not
            // assumed, and only for SI/DI/BX/BP, the only registers that can
            // BE an address on an 8086.
            const name = R16_NAME[ops[1].n];
            this.note(`LEA of the bare register ${name.toUpperCase()} was read as [${name.toUpperCase()}]`);
            ops[1] = {
                k: 'm', base: null, index: name, disp: 0, seg: null, size: 0,
                known: true, segRel: 0, ref: null, text: ops[1].text,
            };
        }
        if (ops[1].k !== 'm') throw new AsmError('LEA needs an address, not a register or a number',
            { ...this.ctx, what: 'lea of non-address' });
        return this.emitRM([0x8d], ops[0].n, ops[1], [], false);
    }

    loadFar(mn, ops) {
        this.expect(ops.length === 2, `${mn.toUpperCase()} takes a register and an address`);
        this.expect(ops[0].k === 'r16', `${mn.toUpperCase()} loads a word register`);
        this.expect(ops[1].k === 'm', `${mn.toUpperCase()} needs a memory operand`);
        return this.emitRM([mn === 'les' ? 0xc4 : 0xc5], ops[0].n, ops[1]);
    }

    intOp(ops) {
        this.expect(ops.length === 1 && ops[0].k === 'i', 'INT takes an immediate vector number');
        const n = ops[0].v & 0xff;
        // INT 3 has its own one-byte opcode and MASM uses it.
        if (n === 3) return this.emit(0xcc);
        return this.emit(0xcd, n);
    }

    portOp(mn, ops) {
        this.expect(ops.length === 2, `${mn.toUpperCase()} takes two operands`);
        const [a, b] = mn === 'in' ? ops : [ops[1], ops[0]];
        this.expect((a.k === 'r8' && a.n === 0) || (a.k === 'r16' && a.n === 0),
            `${mn.toUpperCase()} uses AL or AX`);
        const w = a.k === 'r16' ? 1 : 0;
        if (b.k === 'r16' && b.n === R16.dx) return this.emit((mn === 'in' ? 0xec : 0xee) | w);
        this.expect(b.k === 'i', `${mn.toUpperCase()} takes a port number or DX`);
        if (b.known && (b.v < 0 || b.v > 255)) throw new AsmError(
            'a port number above 255 must go through DX',
            { ...this.ctx, what: 'port too high' });
        return this.emit((mn === 'in' ? 0xe4 : 0xe6) | w, b.v & 0xff);
    }

    /** A relative jump. `width` 1 is the only form the conditionals have. */
    relJump(opcode, ops, width, mn) {
        this.expect(ops.length === 1, `${mn.toUpperCase()} takes one target`);
        const o = ops[0];
        if (o.k !== 'i' && o.k !== 'm') throw new AsmError(`${mn.toUpperCase()} needs a label`,
            { ...this.ctx, what: 'bad jump target' });
        // `JE [BX]` has no encoding: the conditionals and LOOP are relative
        // only. Taking o.disp anyway would jump to the displacement.
        if (o.k === 'm' && (o.base || o.index)) throw new AsmError(`${mn.toUpperCase()} cannot be indirect`,
            { ...this.ctx, what: 'indirect conditional jump' });
        const target = o.k === 'm' ? o.disp : o.v;
        const from = this.here + 1 + width;
        const d = (target - from) | 0;
        // The slot is claimed UNCONDITIONALLY. It indexes a sticky decision
        // and the index has to mean the same thing on every pass; claiming
        // it inside the branch below would shift every later jump's slot the
        // moment one of them changed its mind.
        const slot = this.jumpSlot();
        const reaches = !o.known || (d >= -128 && d <= 127);
        if (!reaches || this.promoted[slot]) {
            // JMP is not promoted here: it HAS a near form, and `branch`
            // widens it on its own. An explicit `JMP SHORT` is the
            // programmer saying which encoding they want, so it is not
            // second-guessed either.
            const promotable = opcode !== 0xeb;
            if (promotable && (this.opts.longJumps || this.promoted[slot])) {
                this.promoted[slot] = true;
                this.note(`${mn.toUpperCase()} to ${o.text.trim()} is ${d} bytes away, which this`
                    + ' instruction cannot reach; promoted to a branch over a near jump.'
                    + ' This program will no longer assemble under MASM');
                return this.promote(opcode, target);
            }
            if (!reaches) {
                throw new AsmError(
                    `${mn.toUpperCase()} to ${o.text.trim()} is ${d} bytes away and this instruction`
                    + ' only reaches 127 -- pass { longJumps: true } to promote it, at the cost of a'
                    + ' program that no longer assembles anywhere else',
                    { ...this.ctx, what: 'jump out of range' });
            }
        }
        return this.emit(opcode, d & 0xff);
    }

    /**
     * Rewrite an out-of-range relative jump into a sequence that reaches.
     * OFF BY DEFAULT -- see `longJumps` in the module header, and the reason
     * the default is faithfulness rather than reach.
     *
     * Two shapes, because the 8086 gives the two families different tools:
     *
     *   Jcc far      ->  Jncc over ; JMP near far ; over:
     *   LOOP far     ->  LOOP take ; JMP SHORT over ; take: JMP near far ; over:
     *
     * The second shape is the one to be careful with. LOOP, LOOPE, LOOPNE
     * and JCXZ have no inverted opcode to branch the other way with and no
     * near form to widen into, so the jump has to be jumped OVER instead --
     * and CX must still be decremented exactly once, which it is, because
     * the LOOP itself still executes exactly once. Inverting that one by
     * hand instead would give a loop that runs once or forever rather than
     * one that fails loudly.
     */
    promote(opcode, target) {
        if (opcode >= 0x70 && opcode <= 0x7f) {
            // Bit 0 of a conditional opcode IS the sense of its condition on
            // this machine, so XOR 1 is the exact inverse for all sixteen:
            // 74/75 is JZ/JNZ, 7C/7D is JL/JNL, and so on through the table.
            this.emit(opcode ^ 1, 0x03);       // skip the three-byte JMP
            this.emit(0xe9);
            return this.emitWord((target - (this.here + 2)) & 0xffff);
        }
        this.emit(opcode, 0x02);               // taken -> the near JMP
        this.emit(0xeb, 0x03);                 // not taken -> past it
        this.emit(0xe9);
        return this.emitWord((target - (this.here + 2)) & 0xffff);
    }

    /** The pass-stable index a jump's shrink decision is filed under. */
    jumpSlot() { return this.jumpCount++; }

    /**
     * JMP and CALL, whose four encodings are told apart by the operand's
     * TYPE, not by its shape:
     *
     *   - a register, or an address with a register in it -- indirect;
     *   - a DWORD-typed address -- indirect FAR, through a seg:off pair;
     *   - a WORD-typed address (a `DW` variable, or WORD PTR) -- indirect
     *     near, through the word stored there;
     *   - FAR PTR on a label -- a direct far jump with an immediate seg:off;
     *   - a bare code label, which has no type -- relative.
     *
     * The trap is the third and fifth: `JMP TARGET` where TARGET is a code
     * label jumps TO it, and where TARGET is a `DW` jumps THROUGH it, and
     * the source text is identical. Only the declared type separates them,
     * which is why a code label is given type 0 and never 2.
     */
    branch(mn, ops, regNear, regFar, relOpcode, farOpcode) {
        this.expect(ops.length === 1, `${mn.toUpperCase()} takes one target`);
        const o = ops[0];
        if (o.k === 'far') {
            // Both halves are known here, so unlike `FAR PTR label` this
            // needs no relocation -- which is what makes it usable in a flat
            // ROM image. A segment-valued expression (`SEG x`, `@DATA`) in
            // the left half still gets its fixup.
            this.emit(farOpcode);
            this.emitWord(o.off.v);
            if (o.seg.reloc) {
                this.reloc(o.seg.reloc);
                return this.emitWord(this.segParaOf(o.seg.reloc));
            }
            return this.emitWord(o.seg.v);
        }
        if (o.k === 'r16') return this.emitRM([0xff], regNear, o);
        if (o.k === 'm') {
            if (o.size === 1) throw new AsmError(`${mn.toUpperCase()} cannot go through a byte`,
                { ...this.ctx, what: 'branch through byte' });
            if (o.size === 4) return this.emitRM([0xff], regFar, o);
            if (o.size === 2 || o.base || o.index) return this.emitRM([0xff], regNear, o);
        }
        if (o.k !== 'i' && o.k !== 'm') throw new AsmError(`${mn.toUpperCase()} needs a label`,
            { ...this.ctx, what: 'bad jump target' });
        const target = o.k === 'm' ? o.disp : o.v;
        if (o.distance === 'far') {
            if (!o.segName) throw new AsmError(`a far ${mn.toUpperCase()} needs a label in a named segment`,
                { ...this.ctx, what: `far ${mn}` });
            this.emit(farOpcode);
            this.emitWord(target);
            this.reloc(o.segName);
            return this.emitWord(this.segParaOf(o.segName));
        }
        if (mn === 'jmp') {
            const slot = this.jumpSlot();
            if (o.distance === 'short') return this.relJump(0xeb, [o], 1, 'jmp');
            // Optimistically near on the first pass, then shrunk -- and the
            // decision is STICKY, which is what stops the pass loop
            // oscillating between two byte counts forever.
            const d = (target - (this.here + 2)) | 0;
            // NOT on pass one. Pass one is the only pass that can be too
            // SMALL -- a forward label has no segment yet, so the automatic
            // override it will need has not been counted. Making a sticky
            // shrink decision against those sizes can strand a jump out of
            // range once the prefixes appear.
            const fits = this.pass > 1 && o.known && o.distance !== 'near' && d >= -128 && d <= 127;
            if (this.shortJump[slot] || fits) {
                this.shortJump[slot] = true;
                return this.relJump(0xeb, [o], 1, 'jmp');
            }
        }
        this.emit(relOpcode);
        return this.emitWord((target - (this.here + 2)) & 0xffff);
    }

    retOp(ops, bare, withCount) {
        if (!ops.length) return this.emit(bare);
        this.expect(ops.length === 1 && ops[0].k === 'i', 'RET takes an optional immediate byte count');
        this.emit(withCount);
        return this.emitWord(ops[0].v);
    }

    // -- data -------------------------------------------------------------

    /** DB/DW/DD, including DUP and `?`. @returns {number} items emitted */
    data(unit, text, define) {
        let count = 0;
        for (const raw of splitTop(text, ',')) {
            const item = raw.trim();
            if (!item) throw new AsmError(`${unit === 1 ? 'DB' : unit === 2 ? 'DW' : 'DD'} has an empty item`,
                { ...this.ctx, what: 'empty data item' });
            const m = /^(.*?)\s*\bdup\b\s*\((.*)\)$/is.exec(item);
            if (m) {
                const n = this.evalText(m[1]);
                if (!n.known) throw new AsmError('a DUP count must be known when it is reached',
                    { ...this.ctx, what: 'forward DUP count' });
                if (n.v < 0 || n.v > 65535) throw new AsmError(`a DUP count of ${n.v} is not meaningful`,
                    { ...this.ctx, what: 'bad DUP count' });
                for (let i = 0; i < n.v; i++) count += this.data(unit, m[2], false);
                continue;
            }
            if (item === '?') {
                // Uninitialised. This assembler has no BSS: `?` is a zero,
                // which is what DOS gives an EXE's uninitialised data anyway.
                for (let i = 0; i < unit; i++) this.emit(0);
                count++;
                continue;
            }
            // A string longer than the unit lays out as characters, which is
            // how `DB 'Hello$'` works -- and is NOT how `DW 'AB'` works.
            const toks = lex(item, this.ctx);
            if (toks.length === 1 && toks[0].k === 'str' && toks[0].v.length > unit) {
                // A string that does not fit its item is laid out as BYTES,
                // exactly as DB would, and the fact is recorded.
                //
                // THE ALTERNATIVE WAS TO REFUSE, and it was rejected on the
                // evidence. Three coursework programs write
                // `MSG DW "Enter number of packets: ",0` and
                // `ID DW 'A150','B255',...`; emu8086 assembled all three, so
                // the authors never saw an error. Of the readings available
                // -- refuse, truncate to the low two characters, pad each
                // character out to a word, or lay the characters down as
                // written -- only the last can neither lose nor invent a
                // byte, and it is what DB does with the same text.
                // Truncation in particular would silently drop half of
                // every ID in the security-lock table.
                //
                // Only the OVER-LONG case moves. `DW 'AB'` is still the word
                // 4142h, which is MASM's rule and what programs rely on.
                if (unit !== 1) {
                    this.note(`the string ${JSON.stringify(toks[0].v)} does not fit a ${unit}-byte item`
                        + ' and was laid out as bytes, as DB would');
                }
                for (const ch of toks[0].v) { this.emit(ch.charCodeAt(0) & 0xff); count++; }
                continue;
            }
            if (toks.length === 1 && toks[0].k === 'str' && unit === 1 && toks[0].v.length !== 1) {
                for (const ch of toks[0].v) { this.emit(ch.charCodeAt(0) & 0xff); count++; }
                continue;
            }
            const v = this.evalText(item);
            if (v.base || v.index) throw new AsmError('a register cannot be stored as data',
                { ...this.ctx, what: 'register in data' });
            if (v.reloc) {
                if (unit < 2) throw new AsmError('a segment value does not fit in a byte',
                    { ...this.ctx, what: 'segment in byte' });
                this.reloc(v.reloc);
                this.emitWord(this.segParaOf(v.reloc));
                for (let i = 2; i < unit; i++) this.emit(0);
            } else if (unit === 1) {
                if (v.known && (v.v < -128 || v.v > 255)) throw new AsmError(`${v.v} does not fit in a byte`,
                    { ...this.ctx, what: 'data too wide' });
                this.emit(v.v);
            } else if (unit === 2) {
                this.emitWord(v.v);
            } else {
                // DD of a label is a FAR pointer: offset then segment, and
                // the segment half needs a relocation like any other.
                this.emitWord(v.v);
                if (v.segRel === 1 && v.segName) { this.reloc(v.segName); this.emitWord(this.segParaOf(v.segName)); }
                else this.emitWord((v.v / 65536) | 0);
            }
            count++;
        }
        if (define) define(count);
        return count;
    }

    // -- symbol definition ------------------------------------------------

    define(name, sym) {
        const key = name.toLowerCase();
        const prev = this.symbols.get(key);
        // A redefinition inside the same pass is a real duplicate; the same
        // symbol arriving again on a LATER pass is just the pass loop.
        if (prev && prev.pass === this.pass) {
            // NAME BOTH SITES. The first definition can be hundreds of lines
            // away, and because symbols are case-insensitive (as in MASM)
            // the two spellings need not even look alike -- `SC_FILL equ 6`
            // and a later `sc_fill:` are the same symbol, and a message that
            // names only the second sends the reader hunting for a
            // definition that is not spelled the way they are searching.
            const where = prev.line ? ` at line ${prev.line}` : '';
            const spelling = prev.name === name ? ''
                : ` as "${prev.name}" -- symbol names are case-insensitive, as in MASM`;
            throw new AsmError(`"${name}" is defined twice: first${where}${spelling}`,
                { ...this.ctx, what: 'duplicate symbol' });
        }
        this.symbols.set(key, { ...sym, name, pass: this.pass, known: true, line: this.ctx.line });
        return this.symbols.get(key);
    }

    // -- the pass ---------------------------------------------------------

    onePass(pass) {
        this.pass = pass;
        this.segs = new Map();
        this.segOrder = [];
        this.relocs = [];
        this.stack = [{ lines: this.source.map((text, i) => ({ text, line: i + 1 })), i: 0, name: 'source' }];
        this.lineBudget = 0;
        this.jumpCount = 0;
        this.unresolved = new Set();
        this.cur = null;
        this.dataSegName = null;
        this.codeSegName = null;
        this.stackSize = 0;
        this.entry = null;
        this.model = null;
        this.procFar = false;
        this.procStack = [];
        this.ifStack = [];
        this.ended = false;
        this.ctx = {};
        this.warnings = [];
        // What each segment register is ASSUMED to hold, by segment name.
        // null means "not known", and not knowing is not the same as knowing
        // it is wrong: an unknown register produces no override and no
        // refusal, which is what keeps the SEGMENT dialect without an
        // ASSUME working exactly as it did.
        this.assume = { cs: null, ds: null, es: null, ss: null };
        this.explicitSegments = false;
        // Reset per pass, because a LOCAL name must be THE SAME on every
        // pass. Counting on from the last pass renames the label between
        // its definition and the forward reference that was sized against
        // it, and every macro-local jump becomes an undefined symbol.
        this.localSeq = 0;
        this.lastSeg = null;
        this.sawOrg = false;

        for (;;) {
            const entry = this.nextLine();
            if (entry === null) break;
            this.ctx = { line: entry.line, text: entry.text };
            const line = stripComment(entry.text);
            if (!line) continue;
            if (this.ended) continue;
            this.line(line);
        }
        if (this.ifStack.length) throw new AsmError('an IF is never closed by an ENDIF',
            { ...this.ctx, what: 'unclosed IF' });
        // A PROC left open at the end of the module is CLOSED, not refused.
        // MASM objects; emu8086 does not, and a coursework program writing
        // `MAIN PROC ... END MAIN` with no ENDP is unambiguous -- there is
        // no code after it for the missing ENDP to have changed. The only
        // thing PROC decides here is whether RET is near or far, so a NEAR
        // procedure left open costs exactly nothing. A FAR one would make
        // later RETs far without saying so, and that is still refused.
        for (const open of this.procStack) {
            if (open.far) {
                throw new AsmError(`the FAR procedure "${open.name}" is never closed by ENDP`,
                    { ...this.ctx, what: 'unclosed PROC' });
            }
            this.note(`the procedure "${open.name}" is never closed by ENDP; END closed it`);
        }
        this.procStack = [];
        return this;
    }

    /** True when conditional assembly says the current line is excluded. */
    get skipping() { return this.ifStack.some((f) => !f.active); }

    line(line) {
        // emu8086 carries its build settings in `#...#` lines. They name an
        // output file and a boot mode; neither means anything here, and
        // failing on them would reject six otherwise fine programs.
        if (line.startsWith('#')) return;

        let text = line;
        let label = null;
        // A trailing colon makes a code label, and it can share a line with
        // an instruction.
        const lm = /^([A-Za-z_@?$][\w@?$.]*)\s*:(?!=)\s*/.exec(text);
        if (lm && !/^(cs|ds|es|ss)$/i.test(lm[1])) { label = lm[1]; text = text.slice(lm[0].length).trim(); }

        // The head is split on WHITESPACE with lengths kept, because the
        // remainder has to be sliced by position. Finding the second word
        // with indexOf instead puts `MYDB DB 1` at offset 2 -- inside the
        // label -- and the data list becomes "B 1".
        const head = /^([.@A-Za-z_?$][\w@?$.]*|=)(?:\s+([.@A-Za-z_?$][\w@?$.]*|=))?/.exec(text);
        const w0 = head ? head[1].toLowerCase() : '';
        const w1 = head && head[2] ? head[2].toLowerCase() : '';
        const words = [head ? head[1] : '', head && head[2] ? head[2] : ''];

        // A conditional's own directives are read even inside a dead branch,
        // because that is how the branch ever ends.
        if (w0 === 'if' || w0 === 'ife' || w0 === 'ifdef' || w0 === 'ifndef' || w0 === 'ifb' || w0 === 'ifnb') {
            return this.ifDirective(w0, text.slice(w0.length).trim());
        }
        if (w0 === 'else') {
            if (!this.ifStack.length) throw new AsmError('ELSE with no IF',
                { ...this.ctx, what: 'stray ELSE' });
            const f = this.ifStack[this.ifStack.length - 1];
            f.active = !f.active && !f.taken;
            f.taken = f.taken || f.active;
            return;
        }
        if (w0 === 'endif') {
            if (!this.ifStack.length) throw new AsmError('ENDIF with no IF',
                { ...this.ctx, what: 'stray ENDIF' });
            this.ifStack.pop();
            return;
        }
        if (this.skipping) return;

        if (label) this.defineCodeLabel(label);
        if (!text) return;

        // `NAME name DIRECTIVE ...` -- the definition forms. A directive in
        // the second position claims the first word as the name it defines.
        // `RECORD DW 1985` declares a variable that happens to be spelled
        // like a directive this assembler refuses. The name-defining word in
        // the SECOND position settles it, so w0 is not consulted.
        if (w1 && NAME_DEFINING.has(w1) && !w0.startsWith('.')) {
            return this.definition(words[0], w1, text.slice(head[0].length).trim());
        }
        // `NAME = expr` -- the head regex only reaches `=` when it stands
        // alone as a word, so an explicit check picks up `COUNT=4`.
        const eq = /^([A-Za-z_@?$][\w@?$.]*)\s*=(?!=)([\s\S]*)$/.exec(text);
        if (eq && !DIRECTIVES.has(eq[1].toLowerCase())) return this.definition(eq[1], '=', eq[2].trim());

        const rest = text.slice(w0.length).trim();
        if (w0.startsWith('.') || DIRECTIVES.has(w0)) return this.directive(w0, rest, words);

        if (this.macros.has(w0)) return this.invokeMacro(w0, rest);

        return this.instruction(w0, rest);
    }

    defineCodeLabel(name) {
        this.ensureSegment();
        this.define(name, { kind: 'code', seg: this.cur, value: this.here, type: 0 });
    }

    ifDirective(kind, rest) {
        if (this.skipping) { this.ifStack.push({ active: false, taken: true }); return; }
        let active;
        if (kind === 'ifdef' || kind === 'ifndef') {
            const has = this.symbols.has(rest.trim().toLowerCase());
            active = kind === 'ifdef' ? has : !has;
        } else if (kind === 'ifb' || kind === 'ifnb') {
            // IFB tests a macro argument for emptiness; after substitution
            // an omitted argument leaves `<>` or nothing at all.
            const blank = rest.trim() === '' || rest.trim() === '<>';
            active = kind === 'ifb' ? blank : !blank;
        } else {
            const v = this.evalText(rest);
            if (!v.known) throw new AsmError(
                'an IF condition must be known when it is reached -- no forward references',
                { ...this.ctx, what: 'forward IF' });
            active = kind === 'if' ? v.v !== 0 : v.v === 0;
        }
        this.ifStack.push({ active, taken: active });
    }

    definition(name, kind, rest) {
        switch (kind) {
            case 'db': case 'dw': case 'dd': case 'dq': case 'dt': {
                const unit = { db: 1, dw: 2, dd: 4, dq: 8, dt: 10 }[kind];
                if (unit > 4) throw new AsmError(`${kind.toUpperCase()} is not supported (no 8087 here)`,
                    { ...this.ctx, what: `${kind} unsupported` });
                this.ensureSegment();
                const sym = this.define(name, { kind: 'data', seg: this.cur, value: this.here, type: unit, count: 1 });
                return void this.data(unit, rest, (n) => { sym.count = n; });
            }
            case 'equ': case '=': {
                // `LEN EQU $-MSG` is the common shape and needs `$` to mean
                // the offset here, which is why EQU is evaluated eagerly.
                const v = this.evalText(rest);
                if (v.base || v.index) throw new AsmError('EQU cannot hold a register',
                    { ...this.ctx, what: 'equ of register' });
                if (v.reloc) return void this.define(name, { kind: 'segment', name: v.reloc });
                if (v.segRel && v.ref) {
                    return void this.define(name,
                        { kind: 'data', seg: v.ref.seg, value: v.v, type: v.ref.type, count: v.ref.count });
                }
                return void this.define(name, { kind: 'equ', value: v.v });
            }
            case 'proc': {
                const far = /\bfar\b/i.test(rest);
                if (rest.trim() && !/^(far|near)$/i.test(rest.trim())) {
                    throw new AsmError(
                        `PROC "${rest.trim()}" -- only NEAR and FAR are supported (no language or parameter lists)`,
                        { ...this.ctx, what: 'PROC options' });
                }
                this.defineCodeLabel(name);
                this.procStack.push({ name, far });
                this.procFar = far;
                return;
            }
            case 'endp': {
                const top = this.procStack.pop();
                if (!top) throw new AsmError(`ENDP for "${name}" with no matching PROC`,
                    { ...this.ctx, what: 'stray ENDP' });
                if (top.name.toLowerCase() !== name.toLowerCase()) throw new AsmError(
                    `ENDP names "${name}" but the open procedure is "${top.name}"`,
                    { ...this.ctx, what: 'mismatched ENDP' });
                this.procFar = this.procStack.length ? this.procStack[this.procStack.length - 1].far : false;
                return;
            }
            case 'macro': return this.collectMacro(name, rest);
            case 'segment': return this.openSegment(name, rest);
            case 'ends': {
                if (!this.cur || this.cur.name.toLowerCase() !== name.toLowerCase()) {
                    throw new AsmError(
                        `ENDS names "${name}" but the open segment is "${this.cur ? this.cur.name : 'none'}"`,
                        { ...this.ctx, what: 'mismatched ENDS' });
                }
                this.cur = null;
                return;
            }
            case 'label': {
                const t = rest.trim().toLowerCase();
                if (SIZE_OF[t] === undefined) throw new AsmError(
                    `LABEL ${rest.trim()} -- only BYTE, WORD and DWORD are supported`,
                    { ...this.ctx, what: 'LABEL type' });
                this.ensureSegment();
                return void this.define(name, { kind: 'data', seg: this.cur, value: this.here, type: SIZE_OF[t], count: 1 });
            }
            default:
                throw new AsmError(`"${kind.toUpperCase()}" is not a definition this assembler knows`,
                    { ...this.ctx, what: `unknown directive ${kind.toUpperCase()}` });
        }
    }

    openSegment(name, rest) {
        this.explicitSegments = true;
        // Alignment, combine class and 'CLASS' are accepted and ignored:
        // this assembler lays every segment out paragraph-aligned and
        // separate, which is the only arrangement it can honestly claim.
        const s = this.segment(name, 'mixed');
        this.cur = s;
        this.lastSeg = s;
        // The segment NAME is itself a symbol: `MOV AX, DATA` in the older
        // dialect loads the data segment's paragraph, which is a relocation
        // and not a number, and 9 corpus files open with exactly that line.
        if (!this.symbols.has(name.toLowerCase()) || this.symbols.get(name.toLowerCase()).kind !== 'segment') {
            this.symbols.set(name.toLowerCase(), { kind: 'segment', name, pass: this.pass, known: true });
        }
        if (!this.dataSegName && /^(data|_data|dseg|dataseg|datas)$/i.test(name)) this.dataSegName = name;
        if (!this.codeSegName && /^(code|_text|cseg|codeseg|codes)$/i.test(name)) this.codeSegName = name;
        void rest;
    }

    directive(w0, rest, words) {
        switch (w0) {
            case '.model': {
                const m = rest.trim().toLowerCase().split(/[\s,]+/)[0];
                if (m !== 'small' && m !== 'tiny') {
                    throw new AsmError(`.MODEL ${rest.trim()} is not supported -- only SMALL and TINY`,
                        { ...this.ctx, what: `.MODEL ${m.toUpperCase()}` });
                }
                this.model = m;
                // DGROUP exists from the moment the model does, so `@DATA`
                // resolves even in a program whose .DATA is empty.
                this.dataSegName = '_DATA';
                this.segment('_DATA', 'data');
                // .MODEL carries an implicit ASSUME. Note SS: MASM puts the
                // stack INSIDE DGROUP, so SS and DS name the same thing
                // there; this assembler lays the stack out as its own
                // segment, which means a BP-based address reaching a .DATA
                // label genuinely needs a DS: override here where MASM
                // needs none.
                this.assume.ds = '_DATA';
                this.assume.ss = 'STACK';
                return;
            }
            case '.stack': {
                const v = rest.trim() ? this.evalText(rest) : newVal(0x400);
                this.stackSize = v.v || 0x400;
                this.segment('STACK', 'stack');
                return;
            }
            case '.data': case '.data?': case '.const': {
                this.dataSegName = '_DATA';
                this.cur = this.lastSeg = this.segment('_DATA', 'data');
                return;
            }
            case '.code': {
                this.codeSegName = '_TEXT';
                this.cur = this.lastSeg = this.segment('_TEXT', 'code');
                this.assume.cs = '_TEXT';
                return;
            }
            case 'assume': {
                // `ASSUME DS:DATA CS:CODE` -- entries separated by SPACES,
                // which two coursework programs write and emu8086 accepts.
                // Splitting on commas alone hands the whole line to the
                // pair matcher and the directive is refused wholesale.
                for (const part of splitTop(rest.replace(/\s+(?=(cs|ds|es|ss)\s*:)/gi, ','), ',')) {
                    const m = /^\s*(cs|ds|es|ss)\s*:\s*(\S+)\s*$/i.exec(part);
                    if (!m) {
                        if (/^\s*nothing\s*$/i.test(part)) { for (const r of ['cs', 'ds', 'es', 'ss'])
                            this.assume[r] = null; continue; }
                        if (!part.trim()) continue;
                        throw new AsmError(`cannot read the ASSUME "${part.trim()}"`, { ...this.ctx, what: 'bad ASSUME' });
                    }
                    const reg = m[1].toLowerCase(), name = m[2].replace(/,$/, '');
                    this.assume[reg] = /^nothing$/i.test(name) ? null : name;
                }
                return;
            }
            case 'name': return;                     // an emu8086 module name
            case 'org': {
                const v = this.evalText(rest);
                if (!v.known) throw new AsmError('ORG needs a value known when it is reached',
                    { ...this.ctx, what: 'forward ORG' });
                this.sawOrg = true;
                this.ensureSegment();
                if (this.cur.bytes.length) {
                    // Padding forward inside a segment is a different thing
                    // from setting its origin, and conflating them silently
                    // moves every label after it.
                    const target = v.v - this.cur.org;
                    if (target < this.cur.bytes.length) throw new AsmError(
                        `ORG ${v.v} goes backwards inside "${this.cur.name}"`,
                        { ...this.ctx, what: 'backwards ORG' });
                    while (this.cur.bytes.length < target) this.cur.bytes.push(0);
                    return;
                }
                this.cur.org = v.v;
                this.sawOrg = true;
                return;
            }
            case 'even': case 'align': {
                const n = w0 === 'even' ? 2 : (rest.trim() ? this.evalText(rest).v : 2);
                if (n < 1 || (n & (n - 1))) throw new AsmError(`ALIGN ${n} is not a power of two`,
                    { ...this.ctx, what: 'bad ALIGN' });
                while (this.here % n) this.emit(0x90);
                return;
            }
            case 'end': {
                this.ended = true;
                const t = rest.trim();
                if (t) {
                    const v = this.evalText(t);
                    if (!v.segName) throw new AsmError(
                        `END ${t} -- the entry point is not a label in a segment`,
                        { ...this.ctx, what: 'bad END label' });
                    this.entry = { seg: v.segName, off: v.v };
                }
                return;
            }
            case 'db': case 'dw': case 'dd': case 'dq': case 'dt': {
                const unit = { db: 1, dw: 2, dd: 4, dq: 8, dt: 10 }[w0];
                if (unit > 4) throw new AsmError(`${w0.toUpperCase()} is not supported (no 8087 here)`,
                    { ...this.ctx, what: `${w0} unsupported` });
                return void this.data(unit, rest, null);
            }
            case 'rept': return this.collectRept(rest);
            case 'endm': throw new AsmError('ENDM with no MACRO or REPT',
                { ...this.ctx, what: 'stray ENDM' });
            case 'local':
                // LOCAL outside a macro body has nothing to rename.
                return;
            case 'public': case 'extrn': case 'extern': case 'global': case 'include':
            case 'includelib': case 'dosseg': case 'option': case 'group': case 'comment':
            case '.startup': case '.exit': case '.fardata': case '.fardata?': case '.286':
            case '.386': case '.486': case '.586': case '.8087': case '.287': case '.387':
            case 'struc': case 'struct': case 'union': case 'record': case 'textequ':
            case 'irp': case 'irpc': case 'while': case 'for': case 'forc': case 'repeat':
                throw new AsmError(
                    `"${words[0]}" is not supported -- see the NOT SUPPORTED list in src/i8086-asm.js`,
                    { ...this.ctx, what: `unsupported directive ${words[0].toUpperCase()}` });
            case '.8086': case '.list': case '.xlist': case '.lall': case '.sall':
            case '.xall': case 'page': case 'title': case 'subttl': case '.radix':
            case 'radix': case '.cref': case '.xcref': case '.lfcond': case '.sfcond':
            case '.tfcond': case '.seq': case '.alpha':
                return;                              // listing control: no bytes either way
            default:
                throw new AsmError(`"${words[0]}" is not a directive this assembler knows`,
                    { ...this.ctx, what: `unknown directive ${words[0].toUpperCase()}` });
        }
    }

    // -- macros -----------------------------------------------------------

    /** Read a MACRO body up to its matching ENDM, counting nesting. */
    collectBody(what) {
        const body = [];
        let depth = 1;
        for (;;) {
            const entry = this.nextLine();
            if (entry === null) throw new AsmError(`a ${what} is never closed by ENDM`,
                { ...this.ctx, what: 'unclosed MACRO' });
            const line = stripComment(entry.text);
            const head = (line.split(/[\s,]+/)[1] || '').toLowerCase();
            const first = (line.split(/[\s,]+/)[0] || '').toLowerCase();
            // The inner ENDM of a REPT nested in a MACRO belongs to the
            // BODY. Dropping it (the obvious `if (--depth === 0) return`)
            // leaves the REPT unterminated at expansion time and the whole
            // rest of the file gets swallowed into it.
            if (first === 'endm') { if (--depth === 0) return body; }
            else if (first === 'rept' || first === 'irp' || first === 'irpc' || head === 'macro') depth++;
            body.push(entry);
        }
    }

    collectMacro(name, rest) {
        const params = rest.trim() ? splitTop(rest, ',').map((s) => s.trim()).filter(Boolean) : [];
        const body = this.collectBody('MACRO');
        this.macros.set(name.toLowerCase(), { name, params, body });
    }

    collectRept(rest) {
        const n = this.evalText(rest);
        if (!n.known) throw new AsmError('a REPT count must be known when it is reached',
            { ...this.ctx, what: 'forward REPT' });
        if (n.v < 0 || n.v > 65535) throw new AsmError(`a REPT count of ${n.v} is not meaningful`,
            { ...this.ctx, what: 'bad REPT count' });
        const body = this.collectBody('REPT');
        const out = [];
        for (let i = 0; i < n.v; i++) out.push(...body);
        this.push(out, 'REPT');
    }

    invokeMacro(name, rest) {
        const mac = this.macros.get(name);
        const args = rest.trim() ? splitTop(rest, ',').map((s) => s.trim().replace(/^<(.*)>$/s, '$1')) : [];
        if (args.length > mac.params.length) {
            throw new AsmError(
                `${mac.name} takes ${mac.params.length} parameter(s) and was given ${args.length}`,
                { ...this.ctx, what: 'macro arity' });
        }
        const map = new Map();
        mac.params.forEach((p, i) => map.set(p.toLowerCase(), args[i] ?? ''));

        // LOCAL names are renamed per invocation, or a macro used twice
        // defines the same label twice and the second use fails.
        const body = [];
        const locals = new Map();
        for (const entry of mac.body) {
            const line = stripComment(entry.text);
            const m = /^local\s+(.*)$/i.exec(line);
            if (m) {
                for (const l of splitTop(m[1], ',')) {
                    const nm = l.trim();
                    if (nm) locals.set(nm.toLowerCase(), `??${(this.localSeq++).toString(16).padStart(4, '0')}`);
                }
                continue;
            }
            body.push(entry);
        }
        for (const [k, v] of locals) map.set(k, v);

        const expanded = body.map((entry) => ({
            text: substitute(entry.text, map),
            line: entry.line,
        }));
        this.push(expanded, `macro ${mac.name}`);
    }

    // -- instructions -----------------------------------------------------

    instruction(w0, rest, inherited = []) {
        let mn = w0;
        const prefixes = [...inherited];
        let text = rest;
        // REP and LOCK are written as words in front of the instruction.
        for (;;) {
            if (REP_PREFIX[mn] !== undefined || mn === 'lock') {
                if (!text) {
                    if (mn === 'lock') { this.emit(0xf0); return; }
                    throw new AsmError(`${mn.toUpperCase()} needs a string instruction after it`,
                        { ...this.ctx, what: 'bare REP' });
                }
                prefixes.push(mn === 'lock' ? 0xf0 : REP_PREFIX[mn]);
                const parts = text.split(/\s+/);
                mn = parts[0].toLowerCase();
                text = text.slice(parts[0].length).trim();
                continue;
            }
            break;
        }
        // A segment override written as a bare prefix word -- `ES: MOVSB` or
        // `ES MOVSB` -- which is the only way to override a string
        // instruction's implicit source. The corpus never writes it, but the
        // disassembler prints it, so the round trip has to be able to.
        if (SREG[mn] !== undefined && text) {
            const bare = text.replace(/^:\s*/, '');
            const parts = bare.split(/\s+/);
            const head = parts[0].toLowerCase();
            if (STRING_OPS[head] !== undefined || REP_PREFIX[head] !== undefined) {
                return this.instruction(head, bare.slice(parts[0].length).trim(),
                    [[0x26, 0x2e, 0x36, 0x3e][SREG[mn]], ...prefixes]);
            }
        }
        // THE MNEMONIC IS CHECKED FIRST, and the order is the whole point.
        // Parsing operands first means an undefined macro is reported by
        // whatever its arguments happen to trip over: a truncated coursework
        // file calling `PRINT 'GREEN LED IS TURNED ON'` with no library
        // included was refused for "the string is too long to be a number",
        // which sends the reader after the string instead of after the
        // missing include.
        if (!KNOWN_MNEMONICS.has(mn) && !this.macros.has(mn)) {
            throw new AsmError(
                `"${mn.toUpperCase()}" is not an instruction, directive or macro this assembler knows`,
                { ...this.ctx, what: `unknown mnemonic ${mn.toUpperCase()}` });
        }
        const ops = text ? splitTop(text, ',').map((s) => this.operand(s)) : [];
        return this.encode(mn, ops, prefixes);
    }

    note(message) {
        const line = this.ctx.line;
        if (!this.warnings.some((w) => w.line === line && w.message === message)) {
            this.warnings.push({ line, message });
        }
    }

    // -- layout -----------------------------------------------------------

    /**
     * A segment's paragraph index inside the load image.
     *
     * THIS IS WHY THERE IS A PASS LOOP AT ALL for `MOV AX, @DATA`: the data
     * segment's paragraph depends on how big the code segment is, and the
     * code segment's size depends on nothing else, so the paragraphs are
     * taken from the PREVIOUS pass's sizes. Reading them from the pass in
     * progress would give zero for every segment not yet closed, and the
     * final image would point @DATA at the code.
     */
    segParaOf(name) {
        return this.paras.get(name) ?? this.paras.get(String(name).toUpperCase()) ?? 0;
    }

    /**
     * Is this program one flat segment -- a .COM -- or several?
     *
     * `.MODEL SMALL` and an explicit `SEGMENT` both mean several. So does
     * `.DATA` alongside `.CODE` with no ORG: a program that wants a data
     * segment it reaches through DS wants an .EXE. But `.DATA` and `.CODE`
     * UNDER an `ORG 100h` are section markers inside one .COM image -- a
     * coursework program writes exactly that, and forcing it to .EXE would
     * break the ORG while refusing it outright costs a working program.
     */
    flatOutput() {
        if (this.model && this.model !== 'tiny') return false;
        if (this.explicitSegments) return false;
        if (this.segs.has('STACK')) return false;
        return this.sawOrg || this.segOrder.filter((n) => this.segs.has(n)).length <= 1;
    }

    /**
     * Where each section starts inside a flat image.
     *
     * The CODE section goes first, because a .COM enters at its ORG and
     * everything else has to come after the first instruction -- a source
     * that writes `.data` before `.code` (as the coursework one does) would
     * otherwise start executing its own strings. Sizes come from the
     * PREVIOUS pass, the same way paragraph numbers do, and the fixpoint
     * settles them.
     * @returns {Map<string,number>}
     */
    computeOrigins() {
        const out = new Map();
        if (!this.flatOutput()) return out;
        const codeName = this.codeSegName || '_TEXT';
        const code = this.segs.get(codeName);
        let at = code ? code.org + code.bytes.length : 0x100;
        for (const name of this.segOrder) {
            if (name === codeName || !this.segs.has(name)) continue;
            out.set(name, at);
            at += this.segs.get(name).bytes.length;
        }
        return out;
    }

    /**
     * Paragraph-align every segment in the order it first appeared, except
     * that the .STACK segment always goes last so SP can simply be its size.
     * @returns {Map<string,number>}
     */
    computeParas() {
        const out = new Map();
        let para = 0;
        for (const name of this.segOrder) {
            const s = this.segs.get(name);
            if (!s || s.kind === 'stack') continue;
            out.set(name, para);
            para += Math.ceil((s.org + s.bytes.length) / 16);
        }
        if (this.segs.has('STACK')) out.set('STACK', para);
        return out;
    }

    /** Fix the paragraphs onto the segments and hand back the load order. */
    layout() {
        const paras = this.computeParas();
        for (const [name, para] of paras) this.segs.get(name).para = para;
        const stack = this.segs.get('STACK');
        if (stack) stack.bytes = new Array(this.stackSize).fill(0);
        return this.segOrder.filter((n) => this.segs.has(n));
    }
}

/** Word for word the mnemonics `encode` can handle, so an unknown one is
 *  named before its operands get a chance to fail for another reason. */
const KNOWN_MNEMONICS = new Set([
    ...Object.keys(NO_OPERAND), ...Object.keys(STRING_OPS), ...Object.keys(ALU),
    ...Object.keys(SHIFT), ...Object.keys(GRP3), ...Object.keys(JCC), ...Object.keys(REP_PREFIX),
    'mov', 'xchg', 'test', 'push', 'pop', 'inc', 'dec', 'lea', 'lds', 'les',
    'int', 'in', 'out', 'jmp', 'call', 'ret', 'retn', 'retf',
    'loop', 'loope', 'loopz', 'loopne', 'loopnz', 'jcxz', 'aam', 'aad',
]);

/** R16 the other way round, for naming a register in a message. */
const R16_NAME = Object.keys(R16);

/** Directives that stand alone at the start of a line. */
const DIRECTIVES = new Set([
    'assume', 'end', 'org', 'even', 'align', 'rept', 'endm', 'local', 'name',
    'public', 'extrn', 'extern', 'global', 'include', 'includelib', 'dosseg',
    'option', 'group', 'comment', 'struc', 'struct', 'union', 'record',
    'textequ', 'irp', 'irpc', 'while', 'for', 'forc', 'repeat', 'page',
    'title', 'subttl', 'radix',
    // A data directive with no label in front of it continues the previous
    // declaration, which is how every long message in the corpus is
    // written. Leaving these out makes `DB 0DH, 0AH, '$'` on its own line
    // look like an instruction called DB -- 61 files failed exactly that way.
    'db', 'dw', 'dd', 'dq', 'dt',
]);

/**
 * Substitute macro parameters. Whole-token only, so a parameter named `N`
 * does not eat the `N` inside `COUNT`; and `&P&` splices, which is how a
 * macro builds a label out of its argument.
 */
function substitute(text, map) {
    if (!map.size) return text;
    let out = text.replace(/&([A-Za-z_@?$][\w@?$]*)&?/g, (m0, name) => {
        const v = map.get(name.toLowerCase());
        return v === undefined ? m0 : v;
    });
    out = out.replace(/[A-Za-z_@?$][\w@?$]*|'(?:[^']|'')*'|"(?:[^"]|"")*"/g, (m0) => {
        if (m0[0] === "'" || m0[0] === '"') return m0;
        const v = map.get(m0.toLowerCase());
        return v === undefined ? m0 : v;
    });
    return out;
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

function buildCom(asm, order) {
    const segs = order.map((n) => asm.segs.get(n)).filter((s) => s.bytes.length);
    if (asm.relocs.length) {
        throw new AsmError('this program needs a segment value (@DATA or SEG) at load time, '
            + 'which a .COM image cannot carry -- give it .MODEL SMALL so it can be an .EXE',
            { what: 'reloc in com' });
    }
    if (!segs.length) return { bytes: new Uint8Array(0), org: 0x100 };
    // Several SECTIONS, one segment. `computeOrigins` has already laid them
    // end to end with the code first; all that is left is to paint them into
    // one image and check that none of them landed on another, which would
    // silently overwrite code with data.
    const origin = Math.min(...segs.map((s) => s.org));
    const end = Math.max(...segs.map((s) => s.org + s.bytes.length));
    const bytes = new Uint8Array(end - origin);
    const claimed = new Uint8Array(end - origin);
    for (const s of segs) {
        for (let i = 0; i < s.bytes.length; i++) {
            const at = s.org - origin + i;
            if (claimed[at]) {
                throw new AsmError(`the sections "${s.name}" and another both claim offset `
                    + `${(origin + at).toString(16).toUpperCase()}h of the .COM image`,
                    { what: 'overlapping sections' });
            }
            claimed[at] = 1;
            bytes[at] = s.bytes[i] & 0xff;
        }
    }
    return { bytes, org: origin };
}

function buildExe(asm, order) {
    const segs = order.map((n) => asm.segs.get(n));
    const totalParas = segs.reduce(
        (n, s) => Math.max(n, s.para + Math.ceil((s.org + s.bytes.length) / 16)), 0);
    const image = new Uint8Array(totalParas * 16);
    for (const s of segs) {
        const at = s.para * 16 + s.org;
        for (let i = 0; i < s.bytes.length; i++) image[at + i] = s.bytes[i] & 0xff;
    }

    const relocs = asm.relocs.map((r) => ({
        // A relocation names a word by segment:offset. Everything here lives
        // in one flat image, so segment 0 and a linear offset is exact and
        // cannot overflow for images this size.
        off: r.seg.para * 16 + r.seg.org + r.off,
    }));
    const headerBytes = 28 + relocs.length * 4;
    const headerParas = Math.ceil(headerBytes / 16);
    const total = headerParas * 16 + image.length;
    const out = new Uint8Array(total);
    const w16 = (o, v) => { out[o] = v & 0xff; out[o + 1] = (v >> 8) & 0xff; };
    out[0] = 0x4d; out[1] = 0x5a;
    w16(0x02, total % 512);
    w16(0x04, Math.ceil(total / 512));
    w16(0x06, relocs.length);
    w16(0x08, headerParas);
    w16(0x0a, 0);                        // minalloc
    w16(0x0c, 0xffff);                   // maxalloc
    const stack = asm.segs.get('STACK');
    w16(0x0e, stack ? stack.para : 0);
    w16(0x10, stack ? asm.stackSize & 0xffff : 0xfffe);
    w16(0x12, 0);                        // checksum, which nothing checks
    const entry = asm.entry
        ? { para: asm.segParaOf(asm.entry.seg), off: asm.entry.off }
        : { para: asm.segs.get(asm.codeSegName)?.para ?? 0, off: asm.segs.get(asm.codeSegName)?.org ?? 0 };
    w16(0x14, entry.off);
    w16(0x16, entry.para);
    w16(0x18, 28);
    w16(0x1a, 0);                        // no overlay
    relocs.forEach((r, i) => { w16(28 + i * 4, r.off); w16(28 + i * 4 + 2, 0); });
    out.set(image, headerParas * 16);
    return { bytes: out, entry };
}

/**
 * Assemble MASM-dialect 8086 source.
 *
 * @param {string} source
 * @param {{ format?: 'auto'|'com'|'exe', maxPasses?: number,
 *           longJumps?: boolean }} [opts] -- `longJumps` promotes a
 *   conditional jump or LOOP that cannot reach; OFF by default, and see the
 *   module header for why the default is the interesting part.
 * @returns {{ bytes: Uint8Array, format: 'com'|'exe', org?: number,
 *             entry?: {para:number, off:number}, symbols: Map<string,object>,
 *             warnings: {line:number, message:string}[], passes: number,
 *             segments: {name:string, para:number, size:number}[] }}
 */
export function assemble(source, opts = {}) {
    const asm = new Assembler(source, opts);
    const maxPasses = opts.maxPasses ?? 12;
    let prev = null, passes = 0;
    asm.paras = new Map();
    asm.origins = new Map();

    // The pass loop. Pass one sizes everything pessimistically -- an unknown
    // symbol is 7FFFh, so every jump is near and every displacement is wide
    // -- and later passes only ever SHRINK, with the short-jump decisions
    // sticky. That is what makes this terminate: a scheme that also grows
    // can flip a jump between two and three bytes forever.
    for (;;) {
        asm.onePass(++passes);
        // Paragraph numbers -- what `@DATA` and `SEG` resolve to -- are a
        // pure function of the sizes, so carrying them into the next pass
        // and comparing them alongside the sizes makes the fixpoint cover
        // the relocated words as well as the code length.
        asm.paras = asm.computeParas();
        asm.origins = asm.computeOrigins();
        const shape = asm.segOrder.map((n) => [n, asm.segs.get(n).org, asm.segs.get(n).bytes.length]);
        // THE SYMBOL VALUES ARE PART OF THE FIXPOINT, and leaving them out
        // is a bug that hides for a long time. A pass can be the same SIZE
        // as the one before it and lay out differently: here, four bytes of
        // segment override appeared while a jump four bytes away shrank to
        // its short form. The totals matched, the loop declared victory, and
        // the emitted `CALL` still held the address the label had had one
        // pass earlier -- four bytes short of the procedure, landing inside
        // the previous instruction. The program pushed one register where
        // it meant to push three and returned into its own entry point.
        //
        // Comparing sizes alone only asks "did the segment stop moving";
        // this asks "did anything move", which is the question.
        const syms = [...asm.symbols]
            .map(([k, v]) => [k, v.kind, v.value ?? 0, v.seg ? v.seg.name : ''])
            .sort();
        const sig = JSON.stringify([shape, [...asm.paras], [...asm.origins], syms]);
        if (sig === prev) break;
        if (passes >= maxPasses) {
            throw new AsmError(`the code size did not settle after ${passes} passes`, { what: 'no convergence' });
        }
        prev = sig;
    }
    // A forward reference is unresolved DURING a pass and resolved by the
    // next one, since the symbol table survives; what is left after the
    // fixpoint is genuinely undefined.
    const missing = [...asm.unresolved].filter((n) => !asm.symbols.has(n.toLowerCase()));
    if (missing.length) {
        const names = missing.sort();
        const shown = names.slice(0, 6).join(', ') + (names.length > 6 ? ', ...' : '');
        throw new AsmError(`undefined symbol${names.length > 1 ? 's' : ''}: ${shown}`,
            { what: 'undefined symbol' });
    }

    const order = asm.layout();
    let format = opts.format ?? 'auto';
    if (format === 'auto') format = asm.flatOutput() ? 'com' : 'exe';

    const segments = order.map((n) => ({ name: n, para: asm.segs.get(n).para, size: asm.segs.get(n).bytes.length }));
    if (format === 'com') {
        const { bytes, org } = buildCom(asm, order);
        return { bytes, format, org, symbols: asm.symbols, warnings: asm.warnings, passes, segments };
    }
    const { bytes, entry } = buildExe(asm, order);
    return { bytes, format, entry, symbols: asm.symbols, warnings: asm.warnings, passes, segments };
}

/**
 * Assemble a bare instruction stream to raw bytes at a chosen origin. This
 * is what the round-trip test drives: no segments, no header, nothing but
 * the encoder.
 *
 * @param {string} source @param {number} [org]
 * @returns {Uint8Array}
 */
export function assembleRaw(source, org = 0) {
    const r = assemble(`ORG ${org}\n${source}\nEND\n`, { format: 'com' });
    return r.bytes;
}

export default assemble;
