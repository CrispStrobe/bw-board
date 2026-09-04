/**
 * 8086 assembler -- Tier C of the 8086 stack, and the piece that was missing.
 *
 * TWO DIALECTS, ONE ENCODER. MASM is the one this module was written for and
 * the one everything below `operand()` speaks; NASM arrives through a
 * source-to-source front end (see "The NASM front end" further down) plus a
 * short list of named parse-level rules, and reaches exactly the same
 * encoder by exactly the same path. `assemble()` reads the dialect off the
 * source and REFUSES rather than guesses when the evidence points both ways,
 * because the two disagree about what `MOV AX, VAR` means.
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
 *   The four NASM repositories (31 sources): 21 assemble BYTE-IDENTICALLY
 *   to NASM 2.16 under `--before "cpu 8086"`, which is the strongest check
 *   anything in this module has. Of the ten that do not: seven are
 *   `%include` fragments that were never standalone programs and NASM
 *   refuses them too, and three are not 8086 programs -- Snake.asm's `inc
 *   dword`, MazeRunnercode.asm's `pusha`, and ega.asm's immediate-count
 *   `shr`, which this module expands rather than refuses and so runs where
 *   NASM's own output would not.
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
 *   - `SHL AX, 4` IS EXPANDED into four `SHL AX, 1` ON AN 8086. The
 *     immediate-count shift is an 80186 instruction; on an 8086 its opcode
 *     C1 decodes as a near RET, so emitting it would not be a
 *     slightly-wrong program, it would be a program that returns instead of
 *     shifting. 52 corpus files write it anyway. The expansion is
 *     semantically identical for CF, ZF, SF and PF, differs only in OF --
 *     which the 8086 leaves undefined for counts above one -- and is
 *     RECORDED in `warnings`, never silent. On a 186 (see below) the real
 *     one-instruction form is emitted and there is no warning, because
 *     nothing was substituted.
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
 *     `autoOverride`. TWO HALVES OF THAT RULE WERE THEMSELVES WRONG, AND
 *     MASM 1.10 SAID SO -- run as a differential oracle inside our own
 *     emulator, which is what `scripts/oracle-masm.mjs` is for. A MISSING
 *     assume used to synthesise nothing at all, on the reasoning that not
 *     knowing what a register holds is not the same as knowing it is
 *     wrong. MASM, given only `ASSUME CS:CODE` and a variable in CODE,
 *     assembles `MOV AX, CVAR` as `2E: A1 0005`: it reaches for whichever
 *     register IS assumed to the symbol's segment, and does not care that
 *     DS is unassumed. And a segment NO assume reaches used to be a
 *     warning; MASM makes it error 68, `Can't reach with segment reg`, and
 *     error 62 when there is no ASSUME at all. Both now match MASM. What
 *     the old rule cost was nothing in a .COM, where DS = CS at entry, and
 *     a silently wrong load in an .EXE that sets DS to @DATA -- which is
 *     the whole reason the .EXE path exists.
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
 * THE 80186 VARIANT. `assemble(src, {variant: '80186'})` encodes the fifteen
 * instructions the 80186 adds; the default is an 8086 and an unknown variant
 * is REFUSED rather than quietly becoming one.
 *
 * THE OPTION IS SPELLED THE WAY THE REST OF THE CHAIN SPELLS IT, and that is
 * worth more than a shorter name. `new I8086(bus, {variant: '80186'})`, `new
 * I8086Machine({variant: '80186'})` and `disasmI8086(read, at, {variant:
 * '80186'})` all existed first; a fourth module in the same pipeline calling
 * the same chip something else is a bug waiting to be typed by whoever wires
 * the four together.
 *
 * The fifteen: 60/61 PUSHA POPA, 62 BOUND, 68/6A PUSH imm16/imm8, 69/6B the
 * non-widening IMUL r16,r/m16,imm, 6C-6F INSB INSW OUTSB OUTSW, C0/C1 the
 * immediate-count shifts, C8 ENTER, C9 LEAVE.
 *
 * THE 8086 REFUSAL IS DELIBERATELY UNTOUCHED. `LATER_THAN_8086` and the
 * message it raises are what stop `pusha` alone on a line from being read as
 * a LABEL under NASM's colon-optional rule -- Maze Runner's pusha/popa pair
 * vanished exactly that way and the program assembled, ran, and returned
 * through a stack it had never balanced. So the variant is an extra way IN
 * at `instruction`, not a change to the way out.
 *
 * WHY IT EXISTS, WHICH IS NOT "for completeness". SmallerC (BSD-2) compiles
 * C to NASM 16-bit assembly, and the only non-8086 instructions in its
 * output are LEAVE, PUSH imm and the three-operand IMUL. With this option a
 * C program compiles, assembles here and RUNS on `I8086Machine({variant:
 * '80186'})` -- test/i8086-asm-186.test.mjs runs one and checks the number
 * it computes. `Maze_Runner_Go/MazeRunnercode.asm` needed it too, and is now
 * 6,088 bytes identical to NASM's own image.
 *
 * The encodings are checked twice and by nothing this module says itself:
 * round trip through the vector-graded disassembler, and 2,448 generated
 * forms diffed byte for byte against NASM 2.16 (`scripts/oracle-nasm.mjs
 * --sweep186`). The second caught a real difference the first cannot see --
 * `PUSH 65535` and `PUSH -1` push the same word, so both take the two-byte
 * 6A, and sizing the first at three bytes round-trips perfectly while
 * disagreeing with NASM.
 *
 * ONE THING IS OPT-IN, AND WHOSE DEFAULT IT IS DEPENDS ON THE DIALECT.
 * `{ longJumps: true }` promotes a conditional jump or LOOP that cannot
 * reach into a sequence that can -- `Jcc far` into `Jncc over; JMP near
 * far; over:`, and the LOOP family, which has neither an inverse opcode nor
 * a near form, into a jump over a jump.
 *
 * IT IS NOT A MATTER OF TASTE. It is a question about the source's own
 * assembler, and the two answer it differently, so the default follows the
 * dialect and the flag overrides it either way:
 *
 *   MASM 1.10 REFUSES, so this refuses. The fourteen Amey programs the flag
 *   rescues CANNOT ASSEMBLE ANYWHERE. Promoting silently would hand a
 *   learner a program that works here and fails on the lab machine with
 *   nothing to say why, which is worse than a refusal that names the line.
 *   With the flag on, Amey goes from 510 accepted and 498 running to 524
 *   and 512, and ten of the fourteen rescued programs are byte-identical to
 *   the corpus's own independent simulator.
 *
 *   NASM PROMOTES, and emits the same bytes this does, so this promotes.
 *   Told `CPU 8086` it rewrites an out-of-range `JGE` as `7C 03 E9 rel16`
 *   -- `Jncc over ; JMP near` -- which is `promote()` exactly; left alone it
 *   reaches for the 80386's `0F 8D rel16`, which on an 8086 decodes as POP
 *   CS and two bytes of rubbish. Three of the four NASM corpora contain a
 *   conditional jump further than 127 bytes, so refusing them would be
 *   refusing what NASM itself assembles. `scripts/oracle-nasm.mjs` checks
 *   that claim the only way worth checking it, byte for byte.
 *
 * The principle is the same one in both halves and it is the one the MASM
 * default was always about: FAITHFULNESS TO THE TOOL THE SOURCE WAS WRITTEN
 * FOR. It just does not point the same way twice. Every promotion records a
 * warning either way, saying which assembler agrees with it.
 *
 * NOT SUPPORTED, deliberately, each of which raises a named error rather
 * than encoding something plausible:
 *
 *   - 80286 and later instructions. The 80186's fifteen are supported, but
 *     only when asked for; see THE 80186 VARIANT below.
 *   - INS and OUTS in MASM's explicit-operand spelling (`INS ES:[DI], DX`),
 *     even on a 186. The operands are fixed by the opcode, so INSB/INSW and
 *     OUTSB/OUTSW say the same thing, and guessing a width from an operand
 *     this module does not parse is the one way to get INSB where INSW was
 *     meant. Refused by name, with the mnemonic to write instead.
 *   - `BOUND r16, r16`. mod 3 is not an instruction: an 80186 raises INT 6
 *     on it, so emitting it would be emitting a trap.
 *   - A source-level `.186` (MASM) that turns the variant on by itself.
 *     NASM's `CPU 186` is ACCEPTED when the caller already asked for a 186
 *     and refused otherwise; see the directive for why a source that can
 *     silently raise the target defeats the point of the default.
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
        const where = ctx.line ? ` (${ctx.file ? `${ctx.file} ` : ''}line ${ctx.line})` : '';
        super(`8086 asm${where}: ${message}`);
        this.name = 'AsmError';
        this.line = ctx.line ?? 0;
        this.text = ctx.text ?? '';
        /** Which file the line came from, once %include can bring in more
         *  than one. Empty for a single-file source. */
        this.file = ctx.file ?? '';
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

/**
 * NASM's precedence, lowest first, which is C's and not MASM's: `|` binds
 * looser than `^`, `^` looser than `&`, and the shifts sit BETWEEN `&` and
 * `+` rather than alongside `*`. Keeping MASM's table for both would read
 * `A | B << 2` the other way round, and nothing would say so.
 */
const NASM_LEVELS = [
    ['or'],
    ['xor'],
    ['and'],
    ['shl', 'shr'],
    ['+', '-'],
    ['*', '/', 'mod'],
];

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
 * @param {object} ctx
 * @param {boolean} [nasm] -- accept `0x`/`0b`/`0o`/`0d` PREFIXES as well as
 *   MASM's trailing radix letter. Gated on the dialect rather than always
 *   on, so that a MASM source lexes byte-identically to the way it did
 *   before this front end existed: `0x` is not valid MASM, and a dialect
 *   this module guessed wrong about must not quietly start reading numbers
 *   the other tool's way.
 * @returns {{k:string, v:any}[]} k is 'num' | 'str' | 'id' | 'op'
 */
function lex(text, ctx, nasm = false) {
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
            // `0x` AND NOTHING ELSE. NASM also spells hex `0hFF`, binary
            // `0b1010`, octal `0o17` and decimal `0d99` -- and every one of
            // those prefixes collides with a constant this lexer ALREADY
            // reads the other way: `0B800h` is CGA's segment under the
            // suffix rule and 5 under a binary-prefix rule, `0D15h` is 3349
            // or 15. Two readings of the same text that differ by a factor
            // of five hundred are not a thing to guess at, the four corpora
            // write `0x` and the suffix form and nothing else, so the other
            // four prefixes are not implemented rather than half-implemented.
            if (nasm && c === '0' && (text[i + 1] === 'x' || text[i + 1] === 'X')
                && /[0-9a-fA-F]/.test(text[i + 2] || '')) {
                let j = i + 2;
                while (j < text.length && /[0-9a-fA-F_]/.test(text[j])) j++;
                toks.push({ k: 'num', v: parseInt(text.slice(i + 2, j).replace(/_/g, ''), 16) });
                i = j;
                continue;
            }
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
            // NASM spells hex with a trailing `x` as well as a trailing
            // `h` -- `mov ah, 0Bx` is written four times in
            // retro-dos-graphics -- and nothing else can end a number that
            // way, so there is nothing for it to collide with.
            if (suffix === 'h' || (nasm && suffix === 'x')) { radix = 16; j++; }
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
        // NASM spells the bit operators the way C does. They are the SAME
        // operators this module already has under MASM's names, so they are
        // translated here rather than given a second evaluator -- and
        // `NASM_LEVELS` gives them NASM's precedence, which is not MASM's.
        if (nasm) {
            const two = text.slice(i, i + 2);
            if (two === '<<' || two === '>>') { toks.push({ k: 'id', v: two === '<<' ? 'shl' : 'shr' }); i += 2; continue; }
            const one = { '|': 'or', '^': 'xor', '&': 'and', '~': 'not', '%': 'mod' }[c];
            if (one) { toks.push({ k: 'id', v: one }); i++; continue; }
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
        // A NASM source arrives as ENTRIES rather than text, because the
        // front end has already expanded macros and pulled in includes: the
        // line number and file name an error names must be the ones the
        // author wrote, not the ones the expansion produced.
        this.source = Array.isArray(source)
            ? source.map((e) => ({ text: e.text, line: e.line, file: e.file }))
            : String(source).split(/\r?\n/).map((text, i) => ({ text, line: i + 1 }));
        this.opts = opts;
        /** NASM dialect. Everything it changes is listed in the front end's
         *  header; there are seven rules and no others. */
        this.nasm = opts.dialect === 'nasm';
        /** WHOSE DEFAULT THIS IS, AND WHY IT IS NOT ONE DEFAULT.
         *
         *  Promoting an unreachable conditional jump is not a question of
         *  taste, it is a question of what the source's own assembler does,
         *  and the two assemblers answer it differently:
         *
         *    MASM 1.10 REFUSES. Fourteen Amey programs are refused here for
         *    exactly the reason MASM refuses them, none is within four bytes
         *    of reaching, and promoting silently would hand a learner a
         *    program that works here and fails on the lab machine.
         *
         *    NASM PROMOTES, and emits the same bytes this does. Told `CPU
         *    8086` it rewrites `JGE far` as `7C 03 E9 rel16` -- `Jncc over ;
         *    JMP near` -- which is `promote()` exactly. Left alone it
         *    reaches for the 80386's `0F 8D rel16` instead, which on an 8086
         *    decodes as POP CS and two bytes of rubbish.
         *
         *  So the default is per dialect and `longJumps` still overrides it
         *  either way. Three of the four NASM corpora contain a conditional
         *  jump further than 127 bytes -- Snake, Maze Runner and the balloon
         *  game all do -- and refusing them would be refusing what NASM
         *  itself assembles, which is the opposite of the faithfulness the
         *  MASM default is there to protect. `scripts/oracle-nasm.mjs`
         *  checks the claim the only way worth checking it: byte for byte
         *  against NASM 2.16 under `--before "cpu 8086"`. */
        this.longJumps = opts.longJumps ?? this.nasm;
        /** WHICH CHIP THIS ASSEMBLES FOR. The name and the spelling are the
         *  core's -- `new I8086(bus, {variant: '80186'})`, `new
         *  I8086Machine({variant: '80186'})`, `disasmI8086(..., {variant:
         *  '80186'})` -- because an assembler, a core and a disassembler
         *  disagreeing about what to call the same chip is a bug waiting to
         *  be typed. `assemble()` has already refused anything but the two
         *  known spellings by the time this runs, so a truthy test here is
         *  never a typo silently becoming an 8086. */
        this.is186 = opts.variant === '80186';
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
            // `align` is what the SECTION needs, not what one item does:
            // NASM's bin writer raises a section's own alignment to the
            // largest ALIGN inside it, so `align 8` in .data moves where
            // .data starts and therefore every label in it.
            s = { name, bytes: [], org: this.origins.get(name) ?? 0, para: 0, kind, align: 1 };
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
        const levels = this.nasm ? NASM_LEVELS : BINARY_LEVELS;
        if (level >= levels.length) return this.parseUnary(toks, pos);
        let { val, next } = this.parseExpr(toks, pos, level + 1);
        for (;;) {
            const t = toks[next];
            if (!t) break;
            const op = t.k === 'op' ? t.v : (t.k === 'id' ? t.v.toLowerCase() : null);
            // A word operator loses to a symbol of the same name -- see the
            // module header. `AND`/`OR`/`SHL` are never symbol names here
            // because they are also mnemonics, so only the value-like ones
            // (LOW, HIGH, ...) can collide, and those are unary.
            if (!op || !levels[level].includes(op)) break;
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
        // `$$` is the start of the current section, which is what makes
        // `times 510-($-$$) db 0` a boot sector. In a flat image there is
        // one section and its start is its ORG.
        if (name === '$$' && this.nasm) {
            this.ensureSegment();
            return { val: this.labelValue({ kind: 'code', seg: this.cur, value: this.cur.org }), next: pos + 1 };
        }
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
            // `mov cx, (ilog2e(ALTOTILE) - 1)` -- NASM's `ifunc` package is
            // not only a preprocessor thing; engine/graphics.asm calls it in
            // an ordinary operand too. Same function, same table, evaluated
            // here because here is where the symbol values are.
            if (this.nasm && IFUNCS[name] && toks[pos + 1] && toks[pos + 1].v === '(') {
                const r = this.parseExpr(toks, pos + 2, 0);
                if (!toks[r.next] || toks[r.next].v !== ')') throw new AsmError(`${name} is not closed`,
                    { ...this.ctx, what: 'bad expression' });
                if (!r.val.known) throw new AsmError(`${name} needs a value known when it is reached`,
                    { ...this.ctx, what: 'forward ifunc' });
                return { val: newVal(IFUNCS[name](r.val.v, this.ctx)), next: r.next + 1 };
            }
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
            // MASM's placeholder is a MEMORY reference, because a bare label
            // is one there. NASM's is not, and setting it would make every
            // forward jump indirect on pass one and refuse the program.
            o.mem = !this.nasm;
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
        const toks = lex(text, this.ctx, this.nasm);
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
            // NASM writes `mov byte [bx], 1` and MASM writes
            // `mov byte ptr [bx], 1`. The keyword means the same thing in
            // both; only the noise word differs.
            // `word[es:di]` with no space at all is written in the Maze
            // corpus, so the separator is only required when what follows
            // could otherwise run into the keyword.
            let m = this.nasm
                ? /^(byte|word|dword|qword|tbyte)(?:\s*(?:ptr\s+)?(?=\[)|\s+(?:ptr\s+)?(?=[A-Za-z_@?$]))/i.exec(t)
                : /^(byte|word|dword|qword|tbyte)\s+ptr\b/i.exec(t);
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
        //
        // AND NASM MEANS THE OPPOSITE. `MOV AX, VAR` is the ADDRESS there
        // and `MOV AX, [VAR]` is the contents -- exactly inverted -- which
        // is the single most dangerous difference between the two dialects,
        // because reading a NASM source MASM's way assembles cleanly, runs,
        // and computes with the wrong number. Nothing throws. So in NASM a
        // bare label falls through to the immediate branch below, which is
        // precisely what `OFFSET label` produces on the MASM side: same
        // encoder, same relocation, one clause different. Both directions
        // are tested, in both dialects, in test/i8086-asm-nasm.test.mjs.
        const isMem = v.mem || v.base || v.index || (!this.nasm && v.segRel !== 0 && v.ref);
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
        if (this.assume[dflt] === want) return null;
        // WHERE MASM'S AUTHORITY STOPS. A source with NO ASSUME anywhere is
        // not a source MASM has an opinion about this operand in: asked,
        // it answers error 62, `No or unreachable CS`, and it answers that
        // for `MOV AX, BX` too -- for the MODULE, before it looks at any
        // operand. This assembler deliberately does not make that refusal,
        // because the whole bare-SEGMENT dialect two coursework programs
        // are written in would go with it. So where there is no table there
        // is no ruling: synthesise nothing, refuse nothing. Every rule
        // below this line is one MASM actually stated.
        if (!this.assume.cs && !this.assume.ds && !this.assume.es && !this.assume.ss) return null;
        // A MISSING ASSUME USED TO STOP THE SEARCH HERE, on the reasoning
        // that not knowing what a register holds is not the same as knowing
        // it is wrong. MASM 1.10 does not reason that way, and it was asked,
        // through `scripts/oracle-masm.mjs`, inside our own emulator:
        //
        //     CODE SEGMENT / ASSUME CS:CODE / MOV AX, CVAR
        //     -> 2E: A1 0005          (a CS override)
        //
        // DS has no ASSUME there at all, and MASM still reaches for the
        // register that IS assumed to the symbol's segment. The old rule
        // emitted A1 0005 bare. In a .COM that is invisible, because
        // DS = CS at entry; in an .EXE that sets DS to @DATA it is a load
        // from the wrong segment that runs and prints.
        for (const r of ['ds', 'cs', 'es', 'ss']) if (this.assume[r] === want) return r;
        // AND NOTHING REACHING IT IS A REFUSAL, not a warning. Asked the
        // same way:
        //
        //     DSEG SEGMENT / DVAR DW 7 / DSEG ENDS
        //     CODE SEGMENT / ASSUME CS:CODE / MOV AX, DVAR
        //     -> error 68, "Can't reach with segment reg"
        //
        // and with no ASSUME anywhere, error 62, "No or unreachable CS".
        // The old rule wrote a warning and emitted the instruction, on the
        // reasoning that a program may load DS itself at run time. It may --
        // and if it does it can SAY so, with `ASSUME DS:name`, which is
        // what the directive is for. A warning nobody reads, on an
        // instruction that reads the wrong segment, is the worst of the
        // three outcomes available.
        throw new AsmError(
            `"${o.ref.name}" is in segment ${want} and no ASSUME puts any segment register there,`
            + ` so ${dflt.toUpperCase()} cannot reach it -- add ASSUME ${dflt.toUpperCase()}:${want}`
            + ' (or an explicit override) to say which register holds it',
            { ...this.ctx, what: 'unreachable segment' });
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

    /**
     * Does this immediate fit the sign-extended BYTE form -- PUSH's 6A and
     * IMUL's 6B -- as opposed to the word form?
     *
     * THE TEST IS ON THE SIXTEEN-BIT VALUE, NOT ON WHAT WAS TYPED, and that
     * is the whole subtlety. `PUSH 65535` and `PUSH -1` push the identical
     * word FFFFh, so both take 6A FF; testing `o.v >= -128` on the written
     * number instead makes the first three bytes and the second two, which
     * is one byte of disagreement with NASM 2.16 over an instruction that
     * does exactly the same thing. Found by the differential, not by
     * reading.
     *
     * A value not yet known says NO, so the wide form is chosen. That is not
     * caution about the value: the pass loop terminates because instructions
     * only ever SHRINK, and one that started narrow and grew when its symbol
     * resolved could oscillate between two layouts forever.
     */
    fitsSignedByte(o) {
        if (!o.known || o.reloc) return false;
        const w = o.v & 0xffff;
        const signed = w >= 0x8000 ? w - 0x10000 : w;
        return signed >= -128 && signed <= 127;
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
        // A DWORD OPERAND IS AN 80386 OPERAND, except in the four places
        // the 8086 genuinely reads four bytes: an indirect far JMP or CALL
        // and LDS/LES. `inc dword [score]` in Snake.asm reached `incDec`,
        // whose width test asks only "is it two", and came out as
        // `inc byte [score]` -- three quarters of a counter that never
        // incremented, with nothing said.
        for (const o of ops) {
            if (o.k === 'm' && o.size > 2 && mn !== 'jmp' && mn !== 'call' && mn !== 'lds' && mn !== 'les') {
                throw new AsmError(
                    `${mn.toUpperCase()} on a ${o.size}-byte operand needs an 80386; the 8086 has`
                    + ' byte and word only',
                    { ...this.ctx, what: 'operand too wide' });
            }
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
        // THE 186 BLOCK GETS FIRST REFUSAL, the same order the core's
        // `_exec186` and the disassembler both use, and for the same
        // reason: nothing below can claim these mnemonics, and putting the
        // test here keeps all three modules readable side by side. It is
        // reached only when `instruction` has already let the mnemonic
        // through, so `this.is186` is the only guard needed.
        if (this.is186) {
            if (I186_NO_OPERAND[mn]) {
                if (ops.length) throw new AsmError(`${mn.toUpperCase()} takes no operands`,
                    { ...this.ctx, what: 'operand count' });
                return this.emit(...I186_NO_OPERAND[mn]);
            }
            if (I186_STRING_OPS[mn] !== undefined) {
                if (ops.length) throw new AsmError(
                    `${mn.toUpperCase()} takes no operands here -- the explicit-operand`
                    + ' string forms are not supported',
                    { ...this.ctx, what: 'string op with operands' });
                return this.emit(I186_STRING_OPS[mn]);
            }
            // MASM spells these `INS ES:[DI], DX`. The operands are fixed by
            // the opcode -- there is nothing to choose -- so the sized forms
            // say the same thing in a syntax this module does not parse, and
            // guessing the width from a memory operand it has not read would
            // be the one way to get INSB where INSW was meant.
            if (mn === 'ins' || mn === 'outs') throw new AsmError(
                `${mn.toUpperCase()} needs its width in the mnemonic here --`
                + ` write ${mn.toUpperCase()}B or ${mn.toUpperCase()}W`,
                { ...this.ctx, what: `${mn} without width` });
            if (mn === 'bound') return this.boundOp(ops);
            if (mn === 'enter') return this.enterOp(ops);
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
            //
            // MASM TAKES IT ALWAYS AND NASM DOES NOT. For a WORD accumulator
            // and an immediate that fits a signed byte the two encodings are
            // the SAME LENGTH -- `3D 10 00` against `83 F8 10` -- so this
            // changes no address and no layout, only which of two equal
            // spellings comes out. It is the last difference between this
            // module and NASM 2.16 over the retro-dos-graphics corpus, and
            // it is gated on the dialect so that MASM's own choice, which
            // oracle-masm.mjs checks against the 1982 binaries, is untouched.
            const nasmPrefers83 = this.nasm && d.k === 'r16' && !s.reloc && s.known
                && s.v >= -128 && s.v <= 127;
            if (!nasmPrefers83 && ((d.k === 'r8' && d.n === 0) || (d.k === 'r16' && d.n === 0))) {
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
        // A COUNT OF ONE IS D0/D1 ON BOTH CHIPS. The 186 could encode it as
        // `C0 /code 01` and NASM does not; D0 is a byte shorter and the two
        // are the same instruction, so there is no variant question here.
        if (c.v === 1) return this.emitRM([0xd0 | (w === 2 ? 1 : 0)], code, d);
        // THE FORK. On a 186 the immediate-count shift is a real
        // instruction and this emits it -- one instruction, the count in a
        // byte, and NO WARNING, because there is nothing to warn about.
        //
        // On an 8086 C1 is not a shift at all, it is `RET imm16`, so
        // repeating the single-count form is the only correct encoding of
        // what the programmer wrote, and the expansion is RECORDED. 52
        // corpus files write the immediate form on an 8086; see the module
        // header for what the expansion does and does not preserve.
        if (this.is186) {
            // The hardware masks the count to five bits, so 32 and 0 are the
            // same instruction. A count out of the 0..31 range is still
            // refused rather than masked here: the source that wrote it
            // meant something else, and silently shifting by count & 31
            // would encode a shift nobody asked for.
            if (c.v < 0 || c.v > 31) throw new AsmError(`a shift count of ${c.v} is not meaningful`,
                { ...this.ctx, what: 'bad shift count' });
            return this.emitRM([0xc0 | (w === 2 ? 1 : 0)], code, d, [c.v & 0xff]);
        }
        if (c.v < 0 || c.v > 31) throw new AsmError(`a shift count of ${c.v} is not meaningful`,
            { ...this.ctx, what: 'bad shift count' });
        this.note(`${mn.toUpperCase()} by ${c.v} expanded into ${c.v} single shifts:`
            + ' the immediate-count form is an 80186 instruction');
        for (let i = 0; i < c.v; i++) this.emitRM([0xd0 | (w === 2 ? 1 : 0)], code, d);
    }

    /**
     * BOUND r16, m -- the 186's array-index check. 62 /r.
     *
     * The memory operand is a PAIR of words (lower bound then upper) and
     * the disassembler still spells it `word`, matching the vector suite;
     * this accepts a sizeless operand or an explicit WORD and refuses BYTE,
     * because a byte pair is not a form the instruction has.
     *
     * A REGISTER second operand is refused rather than encoded. mod 3 makes
     * the encoding `BOUND r16, r16`, which is not an instruction: the
     * 80186 raises INT 6 on it. Emitting it would be emitting a trap.
     */
    boundOp(ops) {
        this.expect(ops.length === 2, 'BOUND takes a register and a pair of bounds in memory');
        const [r, m] = ops;
        this.expect(r.k === 'r16', 'BOUND checks a word register');
        if (m.k !== 'm') throw new AsmError('BOUND reads its two bounds from memory',
            { ...this.ctx, what: 'bound operand kind' });
        if (m.size && m.size !== 2) throw new AsmError(
            'BOUND reads a pair of words; say WORD PTR or leave the size out',
            { ...this.ctx, what: 'operand size' });
        return this.emitRM([0x62], r.n, m);
    }

    /**
     * ENTER imm16, imm8 -- the 186's stack frame. C8 iw ib.
     *
     * The second operand is the LEXICAL NESTING LEVEL, not a byte count,
     * and the hardware takes it modulo 32. It is checked as a plain byte
     * here: a level above 31 is what a source that meant something else
     * writes, and `immBytes` already names an immediate that does not fit.
     */
    enterOp(ops) {
        this.expect(ops.length === 2, 'ENTER takes a frame size and a nesting level');
        const [size, level] = ops;
        this.expect(size.k === 'i' && level.k === 'i', 'ENTER takes two immediates', 'operand kind');
        if (!size.known || !level.known) throw new AsmError(
            'ENTER needs a frame size and a level known at assembly time',
            { ...this.ctx, what: 'enter operand unknown' });
        const lo = this.immBytes(size, 2), hi = this.immBytes(level, 1);
        if (!lo) throw new AsmError('ENTER cannot take a segment value as its frame size',
            { ...this.ctx, what: 'segment in enter' });
        return this.emit(0xc8, ...lo, ...hi);
    }

    grp3Op(mn, code, ops) {
        // IMUL and MUL take one operand on an 8086; the three-operand form
        // is 80186 and is refused rather than guessed at.
        if (this.is186 && mn === 'imul' && ops.length > 1) return this.imul186(ops);
        this.expect(ops.length === 1,
            `${mn.toUpperCase()} takes one operand on an 8086`, ops.length > 1 ? 'i186 form' : 'operand count');
        const w = this.width(ops[0]);
        if (!w) throw new AsmError(
            `${mn.toUpperCase()} cannot tell whether this is a byte or a word -- say BYTE PTR or WORD PTR`,
            { ...this.ctx, what: 'operand size unknown' });
        return this.emitRM([0xf6 | (w === 2 ? 1 : 0)], code, ops[0]);
    }

    /**
     * The 186's IMUL with an immediate: 69 /r iw and 6B /r ib.
     *
     * UNLIKE F7 /5 THIS ONE IS NOT WIDENING. Destination, source and result
     * are all sixteen bits and the high half is discarded, which is what
     * makes it the multiply a C compiler emits for `int * constant`; the
     * 8086 form's DX:AX result is the reason it cannot be used for that.
     *
     * The two-operand spelling `IMUL AX, 10` is NASM's and MASM's shorthand
     * for `IMUL AX, AX, 10` -- the destination is also the source -- and is
     * accepted here as the same instruction, because it is.
     *
     * 6B sign-extends its byte, so it is chosen only for a value that fits a
     * SIGNED byte; the same rule, and the same `fitsSignedByte`, as PUSH's 6A.
     */
    imul186(ops) {
        this.expect(ops.length === 2 || ops.length === 3,
            'IMUL takes one operand, or a destination and a source and an immediate');
        const [d, a, b] = ops.length === 3 ? ops : [ops[0], ops[0], ops[1]];
        this.expect(d.k === 'r16', 'the IMUL with an immediate writes a word register');
        if (b.k !== 'i') throw new AsmError(
            'the three-operand IMUL multiplies by an immediate',
            { ...this.ctx, what: 'operand kind' });
        if (a.k !== 'r16' && a.k !== 'm') throw new AsmError(
            'the three-operand IMUL reads a word register or memory',
            { ...this.ctx, what: 'operand kind' });
        if (a.k === 'm' && a.size && a.size !== 2) throw new AsmError(
            'the three-operand IMUL is a word multiply',
            { ...this.ctx, what: 'operand size' });
        if (this.fitsSignedByte(b)) return this.emitRM([0x6b], d.n, a, [b.v & 0xff]);
        const imm = this.immBytes(b, 2);
        if (!imm) throw new AsmError('IMUL cannot multiply by a segment value',
            { ...this.ctx, what: 'segment in imul' });
        return this.emitRM([0x69], d.n, a, imm);
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
        if (o.k === 'i') {
            if (!this.is186 || mn === 'pop') {
                // POP of an immediate is not an instruction on ANY chip, so
                // the 186 does not rescue it; the message names the 186 only
                // for PUSH, where the 186 is genuinely the answer.
                throw new AsmError(mn === 'pop'
                    ? 'POP needs somewhere to pop TO; an immediate is not a place'
                    : 'PUSH of an immediate is an 80186 instruction',
                    { ...this.ctx, what: mn === 'pop' ? 'pop immediate' : 'i186 push imm' });
            }
            // TWO ENCODINGS, AND THE CHOICE IS NASM'S. 6A sign-extends a
            // byte to the word it pushes, so it says the same thing as 68
            // in two bytes instead of three -- but only for a value that
            // fits a SIGNED byte, since 6A FF pushes FFFFh and not 00FFh.
            // See `fitsSignedByte` for why the test is on the word and not
            // on what was typed.
            if (this.fitsSignedByte(o)) return this.emit(0x6a, o.v & 0xff);
            this.emit(0x68);
            return this.emitImm16(o);
        }
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

    /**
     * A relative jump. `width` 1 is the only form the conditionals have.
     *
     * `slot` IS PASSED IN BY `branch`, and that is a fix and not a
     * convenience. See `jumpSlot`.
     */
    relJump(opcode, ops, width, mn, slot = this.jumpSlot()) {
        this.expect(ops.length === 1, `${mn.toUpperCase()} takes one target`);
        const o = ops[0];
        if (o.k !== 'i' && o.k !== 'm') throw new AsmError(`${mn.toUpperCase()} needs a label`,
            { ...this.ctx, what: 'bad jump target' });
        // `JE [BX]` has no encoding: the conditionals and LOOP are relative
        // only. Taking o.disp anyway would jump to the displacement.
        if (o.k === 'm' && (o.base || o.index || this.nasm)) throw new AsmError(
            `${mn.toUpperCase()} cannot be indirect`,
            { ...this.ctx, what: 'indirect conditional jump' });
        const target = o.k === 'm' ? o.disp : o.v;
        const from = this.here + 1 + width;
        const d = (target - from) | 0;
        const reaches = !o.known || (d >= -128 && d <= 127);
        // TWO SCHEMES, BECAUSE THE TWO DIALECTS CAN PROMISE DIFFERENT
        // THINGS ABOUT THE PASS LOOP.
        //
        // Promotion GROWS an instruction from two bytes to five while the
        // short-jump logic SHRINKS others, and a loop that can do both
        // without remembering oscillates forever. The MASM scheme therefore
        // makes promotion STICKY: once promoted, always promoted. That
        // terminates, and it costs three bytes per jump that would have
        // reached after everything else shrank -- which nothing in the MASM
        // corpus notices, because promotion there is opt-in and rare.
        //
        // In NASM it is neither. Every NASM program here has out-of-range
        // conditional jumps, and the sticky scheme left five of them three
        // to six bytes larger than NASM's own output -- correct programs,
        // but not the same image, and "same image" is the check.
        //
        // So NASM gets the opposite monotonicity: pass one promotes
        // EVERYTHING promotable, which is the largest layout there is, and
        // every later pass may only ever UN-promote. Sizes then only fall,
        // which terminates for the same reason the sticky scheme does, and
        // it settles on the same image NASM writes. This is safe here and
        // not in MASM because a NASM image is flat -- `flatOutput()` is
        // true by construction -- so no automatic segment override can
        // appear on a later pass and make something bigger again.
        if (this.nasm && this.longJumps && opcode !== 0xeb) {
            if (this.pass === 1) this.promoted[slot] = true;
            else if (this.promoted[slot] && o.known && d >= -128 && d <= 127) this.promoted[slot] = false;
            if (this.promoted[slot]) {
                this.note(`${mn.toUpperCase()} to ${o.text.trim()} is ${d} bytes away, which this`
                    + ' instruction cannot reach; promoted to a branch over a near jump,'
                    + ' which is byte for byte what NASM emits under CPU 8086');
                return this.promote(opcode, target);
            }
            if (!reaches) {
                throw new AsmError(
                    `${mn.toUpperCase()} to ${o.text.trim()} is ${d} bytes away and this instruction`
                    + ' only reaches 127', { ...this.ctx, what: 'jump out of range' });
            }
            return this.emit(opcode, d & 0xff);
        }
        if (!reaches || this.promoted[slot]) {
            // JMP is not promoted here: it HAS a near form, and `branch`
            // widens it on its own. An explicit `JMP SHORT` is the
            // programmer saying which encoding they want, so it is not
            // second-guessed either.
            const promotable = opcode !== 0xeb;
            if (promotable && (this.longJumps || this.promoted[slot])) {
                this.promoted[slot] = true;
                this.note(`${mn.toUpperCase()} to ${o.text.trim()} is ${d} bytes away, which this`
                    + ' instruction cannot reach; promoted to a branch over a near jump.'
                    + (this.nasm ? ' This is byte for byte what NASM emits under CPU 8086.'
                        : ' This program will no longer assemble under MASM'));
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

    /**
     * The pass-stable index a jump's shrink decision is filed under.
     *
     * "PASS-STABLE" WAS A CLAIM AND NOT A FACT, and this is the bug it hid.
     * `relJump` claimed a slot of its own, and `branch` claimed one too and
     * then CALLED `relJump` for the short form -- so a `JMP` consumed one
     * slot while it was near and TWO once it shrank to short. The first
     * time any JMP in a module changed its mind, every jump after it moved
     * up one slot and inherited a decision belonging to its neighbour.
     *
     * It is mostly loud: a jump handed someone else's "this one is short"
     * that cannot reach 127 raises `jump out of range` on a line that is
     * perfectly in range, which is a confusing refusal rather than a wrong
     * program. Two of the fourteen retro-dos-graphics programs
     * (`primitiv/jstick3.asm` at line 1000, `primitiv/p16doble.asm` at line
     * 432) refused for exactly that reason, and both assemble byte-for-byte
     * with NASM once the slot is claimed once per jump instead of once per
     * ENCODING of a jump. `test/i8086-asm-nasm.test.mjs` carries a
     * five-line MASM-dialect reduction that fails the same way.
     *
     * The rule now, and it is the one the old comment stated: ONE JUMP, ONE
     * SLOT, whichever form it ends up in. `branch` claims it and hands it
     * down rather than letting `relJump` claim a second.
     */
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
            // In MASM `JMP TARGET` and `JMP [TARGET]` are the same thing
            // and the DECLARED TYPE decides between relative and indirect.
            // In NASM the BRACKETS decide, and a bare label never reaches
            // here at all -- it is an immediate -- so anything that does is
            // an address to jump THROUGH.
            if (o.size === 2 || o.base || o.index || this.nasm) return this.emitRM([0xff], regNear, o);
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
            if (o.distance === 'short') return this.relJump(0xeb, [o], 1, 'jmp', slot);
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
                return this.relJump(0xeb, [o], 1, 'jmp', slot);
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
            const toks = lex(item, this.ctx, this.nasm);
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
        //
        // UNLESS BOTH SIDES ARE `=`. MASM's `=` defines a variable that may
        // be assigned again; EQU defines a constant that may not, and the
        // check below still refuses `K EQU 5` followed by `K EQU 7`. BOTH
        // sides have to be `=` on purpose: mixing the two is a type
        // conflict in MASM as well, and letting `=` overwrite an EQU (or the
        // reverse) would turn a real mistake into a silent reassignment.
        if (prev && prev.pass === this.pass && !(prev.variable && sym.variable)) {
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
        this.stack = [{ lines: this.source, i: 0, name: 'source' }];
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
            this.ctx = { line: entry.line, text: entry.text, file: entry.file };
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
                if (v.base || v.index) throw new AsmError(`${kind === '=' ? '=' : 'EQU'} cannot hold a register`,
                    { ...this.ctx, what: 'equ of register' });
                // `=` IS REDEFINABLE AND `EQU` IS NOT, AND THAT IS THE WHOLE
                // REASON MASM HAS BOTH. A numeric EQU names a constant; `=`
                // names a variable, and a source that writes
                //
                //     K = 5 / MOV AX, K / K = 7 / MOV BX, K
                //
                // means AX = 5 and BX = 7. One switch arm served both for as
                // long as this module existed, so `=` inherited EQU's
                // one-definition rule and the program above was REFUSED --
                // "K is defined twice" -- rather than assembled.
                //
                // THE CORPUS COULD NOT SEE THIS. `=` appears in zero of the
                // 525 files, so 470 byte-identical agreements with NASM and
                // a MASM oracle over 414 files all said nothing about it.
                // Same shape as the ASSUME rule: a corpus is evidence only
                // about the constructs it contains.
                //
                // POSITIONAL VALUES FALL OUT OF THE PASS LOOP for free. Each
                // pass re-executes the definitions in source order, so a
                // read between two assignments sees the one above it, not
                // the last one in the file -- which is exactly MASM's rule.
                const variable = kind === '=';
                if (v.reloc) return void this.define(name, { kind: 'segment', name: v.reloc, variable });
                if (v.segRel && v.ref) {
                    return void this.define(name, {
                        kind: 'data', seg: v.ref.seg, value: v.v,
                        type: v.ref.type, count: v.ref.count, variable,
                    });
                }
                return void this.define(name, { kind: 'equ', value: v.v, variable });
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
            case '.bss': {
                // NASM's .bss is NOBITS: the labels get addresses and the
                // bytes never reach the file. Laying it down as zeros the
                // way `?` is laid down would have made mapedit.asm 459
                // bytes longer than NASM's own image and Snake.asm 2000 --
                // a difference no test that only reads symbols would see.
                this.dataSegName = this.dataSegName || '_BSS';
                this.cur = this.lastSeg = this.segment('_BSS', 'bss');
                return;
            }
            case '.data': case '.data?': case '.const': {
                this.dataSegName = '_DATA';
                this.cur = this.lastSeg = this.segment('_DATA', 'data');
                return;
            }
            case '.fardata': case '.fardata?': {
                // A FAR data segment: its own segment OUTSIDE DGROUP, reached
                // only through a segment register (`MOV AX, SEG label ; MOV ES,
                // AX`) rather than the assumed DS. That is the whole point of
                // the directive — a destination for string primitives (ES:DI)
                // that lives somewhere other than DS. The generic layout gives
                // it a paragraph and SEG resolves to it as a relocation, the
                // same as any named segment; nothing is assumed to it, so a
                // label here is unreachable without the explicit MOV ES.
                this.cur = this.lastSeg = this.segment('FAR_DATA', 'data');
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
            case 'even': case 'align': case 'alignb': {
                // NASM writes `align 8, db 0` -- the second half names what
                // to pad WITH, and every use of ALIGN in retro-dos-graphics
                // is in front of data, where a run of NOPs would be five
                // corpus programs' worth of wrong bytes.
                //
                // ALIGNB is ALIGN's .bss twin and its default filler is ZERO,
                // not NOP. That difference is not cosmetic: .bss holds
                // variables, and padding them with 90h gives every aligned
                // variable a neighbour holding 0x9090 instead of 0. SmallerC
                // emits `alignb 2` in front of every file-scope variable, so
                // this is the second thing a C program meets after GLOBAL.
                let expr = rest, pad = w0 === 'alignb' ? 0x00 : 0x90;
                const am = this.nasm && /^([^,]*),\s*db\s+([\s\S]*)$/i.exec(rest);
                if (am) { expr = am[1]; pad = this.evalText(am[2]).v & 0xff; }
                else if (this.nasm && /,/.test(rest)) {
                    throw new AsmError(`ALIGN ${rest.trim()} -- only a DB filler is supported`,
                        { ...this.ctx, what: 'ALIGN filler' });
                }
                const n = w0 === 'even' ? 2 : (expr.trim() ? this.evalText(expr).v : 2);
                if (n < 1 || (n & (n - 1))) throw new AsmError(`ALIGN ${n} is not a power of two`,
                    { ...this.ctx, what: 'bad ALIGN' });
                this.cur.align = Math.max(this.cur.align || 1, n);
                while (this.here % n) this.emit(pad);
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
            case '.startup': case '.exit': case '.286':
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
            if (STRING_OPS[head] !== undefined || REP_PREFIX[head] !== undefined
                || (this.is186 && I186_STRING_OPS[head] !== undefined)) {
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
        // THE 186 GATE IS AN EXTRA WAY IN, NOT A CHANGE TO THE WAY OUT.
        // `LATER_THAN_8086` and the message it raises are untouched on an
        // 8086, deliberately: that refusal is what stops `pusha` alone on a
        // line from being read as a LABEL under NASM's colon-optional rule,
        // and the instruction disappearing without a word. See the Map's
        // own comment for the incident.
        if (!KNOWN_MNEMONICS.has(mn) && !(this.is186 && I186_MNEMONICS.has(mn))
            && !this.macros.has(mn)) {
            if (LATER_THAN_8086.has(mn)) {
                throw new AsmError(
                    `"${mn.toUpperCase()}" is ${LATER_THAN_8086.get(mn)} instruction and this is an 8086`,
                    { ...this.ctx, what: `${LATER_THAN_8086.get(mn)} instruction` });
            }
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
        // NASM's `bin` format has no relocation table, no `@DATA` and no
        // segment registers to assume anything about: it is one image and
        // the sections are places inside it. Nothing here can produce an
        // .EXE from a NASM source, so this is not a guess.
        if (this.nasm) return true;
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
            // NASM's `bin` writer starts every section on a four-byte
            // boundary unless the source says otherwise. Three zero bytes
            // between .text and .data is not a rounding error: it moves
            // every label in .data.
            // Four bytes is NASM's default; an ALIGN inside the section
            // raises it, and rebota.asm's `align 8, db 0` moves .data by
            // four bytes when it does.
            if (this.nasm) {
                const a = Math.max(4, this.segs.get(name).align || 1);
                at = (at + a - 1) & ~(a - 1);
            }
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

/**
 * The mnemonics the 80186 ADDS -- the ones that do not exist at all on an
 * 8086, as opposed to the ones that gain a new operand form there.
 *
 * `{variant: '80186'}` lets these through `instruction`'s gate; without it
 * they fall to `LATER_THAN_8086` and are refused exactly as before. The
 * three 186 additions that are NOT here are `PUSH imm`, `IMUL r,r/m,imm`
 * and the immediate-count shifts, because their mnemonics already exist on
 * an 8086 -- they are handled at their own encoders, where the variant
 * decides between a new encoding and the old refusal or expansion.
 *
 * `ins` and `outs` are on this list even though this module will not encode
 * either: on a 186 they must reach `encode`, where the refusal can say to
 * write INSB or INSW, rather than being told they need a 186 on a machine
 * that IS one.
 */
const I186_MNEMONICS = new Set([
    'pusha', 'popa', 'bound', 'enter', 'leave',
    'ins', 'insb', 'insw', 'outs', 'outsb', 'outsw',
]);

/** The 186's no-operand additions, in the same shape as NO_OPERAND. */
const I186_NO_OPERAND = { pusha: [0x60], popa: [0x61], leave: [0xc9] };

/** The 186's string primitives, in the same shape as STRING_OPS. */
const I186_STRING_OPS = { insb: 0x6c, insw: 0x6d, outsb: 0x6e, outsw: 0x6f };

/**
 * Instructions this assembler KNOWS ABOUT AND WILL NOT ENCODE, each with
 * the machine that introduced it.
 *
 * These were named in the NOT SUPPORTED list from the start; what they did
 * not have was a NAME AT THE POINT OF REFUSAL, and in NASM that turned out
 * to matter enormously. NASM lets a label go without its colon, so any word
 * this module does not recognise, alone on a line, reads as a label -- and
 * `pusha` in Maze Runner and `popa` after it did exactly that. The
 * instructions VANISHED. The program assembled, ran, and returned through a
 * stack it had never balanced. Nothing threw and no byte was obviously
 * wrong; only a diff against NASM's own image found it.
 *
 * So the list is a data structure now rather than a paragraph, and it is
 * consulted in two places: here, so the refusal names the machine, and in
 * the NASM front end, so a word on this list can never be mistaken for a
 * label.
 */
const LATER_THAN_8086 = new Map([
    ...['pusha', 'popa', 'pushad', 'popad', 'enter', 'leave', 'bound',
        'ins', 'insb', 'insw', 'outs', 'outsb', 'outsw']
        .map((m) => [m, 'an 80186']),
    ...['arpl', 'clts', 'lar', 'lsl', 'lgdt', 'lidt', 'lldt', 'lmsw', 'ltr',
        'sgdt', 'sidt', 'sldt', 'smsw', 'str', 'verr', 'verw', 'loadall']
        .map((m) => [m, 'an 80286']),
    ...['movsx', 'movzx', 'bt', 'bts', 'btr', 'btc', 'bsf', 'bsr', 'shld', 'shrd',
        'cdq', 'cwde', 'lfs', 'lgs', 'lss', 'jecxz', 'pushfd', 'popfd', 'iretd',
        'movsd', 'cmpsd', 'stosd', 'lodsd', 'scasd', 'insd', 'outsd', 'pushad', 'popad',
        'seto', 'setno', 'setb', 'setnb', 'setz', 'setnz', 'setbe', 'setnbe',
        'sets', 'setns', 'setp', 'setnp', 'setl', 'setnl', 'setle', 'setnle',
        'sete', 'setne', 'seta', 'setae', 'setg', 'setge', 'setc', 'setnc']
        .map((m) => [m, 'an 80386']),
    ...['cmpxchg', 'xadd', 'bswap', 'invd', 'wbinvd', 'invlpg'].map((m) => [m, 'an 80486']),
    ...['cpuid', 'rdtsc', 'rdmsr', 'wrmsr', 'cmov', 'rsm'].map((m) => [m, 'a Pentium']),
    ...['fadd', 'faddp', 'fiadd', 'fsub', 'fsubp', 'fsubr', 'fsubrp', 'fisub',
        'fmul', 'fmulp', 'fimul', 'fdiv', 'fdivp', 'fdivr', 'fdivrp', 'fidiv',
        'fld', 'fld1', 'fldz', 'fldpi', 'fldcw', 'fldenv', 'fild', 'fst', 'fstp',
        'fstcw', 'fstenv', 'fstsw', 'fist', 'fistp', 'fcom', 'fcomp', 'fcompp',
        'ficom', 'ficomp', 'ftst', 'fxam', 'fchs', 'fabs', 'fsqrt', 'fscale',
        'fprem', 'frndint', 'fxtract', 'fptan', 'fpatan', 'f2xm1', 'fyl2x',
        'fyl2xp1', 'finit', 'fninit', 'fclex', 'fnclex', 'fsave', 'fnsave',
        'frstor', 'fincstp', 'fdecstp', 'ffree', 'fnop', 'fxch']
        .map((m) => [m, 'an 8087']),
]);

/** R16 the other way round, for naming a register in a message. */
const R16_NAME = Object.keys(R16);

/** Directives that stand alone at the start of a line. */
const DIRECTIVES = new Set([
    'assume', 'end', 'org', 'even', 'align', 'alignb', 'rept', 'endm', 'local', 'name',
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
// The NASM front end.
//
// FOUR MIT-LICENSED CORPORA ARE NASM AND THIS MODULE REFUSED ALL OF THEM.
// The encoder is not the problem -- it is ground against a vector-verified
// disassembler and, through `scripts/oracle-masm.mjs`, against MASM 1.10
// itself -- so the LAST thing to do was put a second encoder beside it.
//
// WHAT THIS IS INSTEAD: a source-to-source normaliser that turns NASM text
// into the text the existing assembler already reads, plus a SHORT, NAMED
// list of parse-level rules that flip when the dialect is NASM. Nothing
// below `operand()` knows which dialect it came from; the ModR/M builder,
// every `encode` path and the pass loop are the same code on both. The
// flipped rules are exactly these, and there are no others:
//
//   1. A BARE LABEL IS ITS ADDRESS, not its contents. `MOV AX, VAR` loads
//      the address in NASM and the contents in MASM, and this is the single
//      most dangerous difference in the whole dialect: reading it MASM's way
//      assembles cleanly, runs, and computes with the wrong number. It is
//      one clause in `operand()` and it is tested BOTH WAYS.
//   2. `BYTE [BX]` -- the size keyword without MASM's `PTR`.
//   3. `0x`, `0b`, `0o`, `0d` prefixes alongside MASM's trailing `h`/`b`.
//   4. `$$`, the start of the current section.
//   5. Brackets on a JMP/CALL target mean INDIRECT. In MASM `JMP TARGET`
//      and `JMP [TARGET]` are the same thing and the declared type decides;
//      in NASM the brackets decide, so a bracketed conditional jump is a
//      refusal rather than a silently-relative one.
//   6. The output is one flat image. NASM's `bin` format has no relocation
//      table and no `@DATA`, so `flatOutput()` is true by construction --
//      which also means no ASSUME machinery runs, because there is only one
//      segment to reach.
//   7. `ALIGN n, db x` -- NASM names its own padding.
//
// Everything else -- local labels, `RESB`, `TIMES`, `SECTION`, `STRUC`, the
// whole `%`-preprocessor -- is text, and text is where it belongs: it can be
// printed, diffed and read, and it cannot introduce an encoding.
//
// SCOPE WAS MEASURED, NOT GUESSED, the same way the MASM side was. The 31
// NASM files of the four corpora were surveyed before a line was written:
//
//   Snake-Game-8086-Assembly/Snake.asm        `bits 16`, `org 100h`, local
//                                             labels, `section .bss`, RESB/RESW
//   typing-balloon-game-asm/                  `[org 0x0100]`, EQU, 2271 lines
//   Maze_Runner_Go/MazeRunnercode.asm         `[org 0x0100]`, `dw` grids
//   retro-dos-graphics/ (28 files)            the whole `%`-preprocessor:
//                                             %define/%assign/%macro/%rep/
//                                             %include/%push/%pop/%use ifunc,
//                                             STRUC/ISTRUC/AT, INCBIN, CPU,
//                                             `align n, db 0`, `[ds:bp+X]`
//
// GROUND TRUTH IS NASM ITSELF. `scripts/oracle-nasm.mjs` runs NASM 2.16 over
// the same sources and compares the images BYTE FOR BYTE; that is a stronger
// check than the MASM side has, and it is what every claim below rests on.
// NASM is not vendored, so `test/oracle-nasm.test.mjs` SKIPS AND SAYS SO
// when it is absent -- a silent skip reads exactly like a pass.
//
// NOT SUPPORTED, deliberately, each raising an error that NAMES the
// construct rather than encoding something plausible:
//
//   - %if/%ifdef/%elif/%else/%endif and the whole conditional preprocessor,
//     %error/%warning/%fatal, %rotate, %strlen/%substr, %defstr, %idefine
//     and the case-insensitive macro forms, %imacro, %unmacro, %exitrep,
//     %local, %arg, %stacksize, %line, %clear, %pathsearch, %depend.
//   - `%use` of anything but `ifunc`; `%$$` outer-context names.
//   - GLOBAL, EXTERN, COMMON, ABSOLUTE, DEFAULT, GROUP, and multi-module
//     linking of any kind: this assembles straight to a loadable image.
//   - Output formats other than `bin`: no `-f obj`, `-f elf`, `-f coff`.
//   - SECTION names other than .text, .data, .rodata and .bss, and section
//     attributes (`align=`, `nobits`, `progbits`, `vstart=`, `start=`).
//   - WRT, SEG, STRICT, the `$`-prefixed hex and float literals, and the
//     80186-and-later instructions the MASM side already refuses.
//   - `.bss` written BEFORE `.data`. NASM's `bin` writer orders sections
//     .text, .data, .bss whatever order the source declares them in; this
//     lays them out in the order they first appear, so the one arrangement
//     where the two would differ is refused rather than mis-ordered.
//
// TWO THINGS ARE IMPLEMENTED THAT THE CORPUS DOES NOT USE, and saying so is
// the point: `TIMES` and `$$`. They are named in the brief, they are the
// idiom every boot sector is padded with (`times 510-($-$$) db 0`), and they
// cost ten lines between them -- but nothing in the four corpora drives
// them, so their only evidence is `test/i8086-asm-nasm.test.mjs` and the
// NASM differential. That is a weaker guarantee than everything else here
// and it should be read as one.
//
// CASE. NASM is case-SENSITIVE and this assembler's symbol table is not.
// The preprocessor is therefore case-sensitive -- it has to be, because
// retro-dos-graphics defines `%macro EsperaTiempo 0` whose body is
// `call esperatiempo`, and folding the two together turns a call into
// unbounded recursion -- while symbols that reach the assembler are folded
// as they always were. Two NASM symbols differing only in case therefore
// collide, and collide LOUDLY: `define()` refuses a duplicate by name.
// ---------------------------------------------------------------------------

/** What says a source is NASM. Each carries the name it is reported under. */
const NASM_SIGNALS = [
    [/^[ \t]*\[?[ \t]*bits[ \t]+\d+/im, 'BITS'],
    [/^[ \t]*\[[ \t]*org\b/im, '[ORG'],
    [/^[ \t]*\[?[ \t]*section[ \t]+\.[a-z]/im, 'SECTION .name'],
    [/^[ \t]*%[a-z]/im, 'a %-directive'],
    [/^[ \t]*[A-Za-z_.$][\w.$#@~?]*[ \t]+res[bwdqt][ \t]+\S/im, 'RESB/RESW'],
    [/^[ \t]*cpu[ \t]+\d/im, 'CPU'],
    [/^[ \t]*incbin\b/im, 'INCBIN'],
    // NOT `TIMES`. `TIMES EQU 5` is a perfectly ordinary MASM constant and
    // two Amey programs declare one; a signal that fires on a plain
    // identifier is not a signal.
    [/\$\$/, '$$'],
];

/** What says it is MASM. Both lists firing at once is a REFUSAL, not a
 *  vote: a source this module guessed wrong about would assemble cleanly
 *  and compute with addresses where it meant contents. */
const MASM_SIGNALS = [
    [/^[ \t]*\.model\b/im, '.MODEL'],
    [/^[ \t]*[A-Za-z_@?$][\w@?$]*[ \t]+segment\b/im, 'SEGMENT'],
    [/^[ \t]*assume\b/im, 'ASSUME'],
    [/^[ \t]*[A-Za-z_@?$][\w@?$]*[ \t]+proc\b/im, 'PROC'],
    [/\bdup[ \t]*\(/i, 'DUP'],
    [/\b(byte|word|dword)[ \t]+ptr\b/i, 'PTR'],
    [/^[ \t]*\.(code|data|stack|const)\b/im, '.CODE/.DATA/.STACK'],
    [/^[ \t]*[A-Za-z_@?$][\w@?$]*[ \t]+macro\b/im, 'MACRO'],
    [/\boffset[ \t]+[A-Za-z_@?$]/i, 'OFFSET'],
];

/**
 * Which dialect a source is written in.
 *
 * AUTODETECTION THAT GUESSES WRONG MUST FAIL LOUDLY. A NASM source read as
 * MASM turns every `MOV AX, VAR` into a load where an address was meant --
 * it assembles, it runs, and it is wrong -- so a source carrying evidence of
 * both is refused with both lists named rather than resolved by counting.
 * No evidence at all is MASM, which is what every existing caller means --
 * AND THAT IS THE ONE GAP LEFT. A NASM source that writes no `org`, no
 * `bits`, no `section`, no `%`-directive, no `RESB`, no `CPU` and no
 * `INCBIN` carries nothing to detect, and would be read as MASM with its
 * memory references inverted. Nothing in the four corpora is that file --
 * every one of the 31 announces itself in its first three lines, because a
 * NASM program has to say where it starts -- but a caller who has a source
 * and knows what it is should say so rather than rely on this. That is what
 * `{ dialect: 'nasm' }` is for, and it is why the option exists alongside
 * the detector rather than behind it.
 *
 * @param {string} source
 * @returns {'nasm'|'masm'}
 */
export function detectDialect(source) {
    const text = String(source);
    const nasm = NASM_SIGNALS.filter(([re]) => re.test(text)).map(([, n]) => n);
    const masm = MASM_SIGNALS.filter(([re]) => re.test(text)).map(([, n]) => n);
    if (nasm.length && masm.length) {
        throw new AsmError(
            `this source reads as BOTH dialects -- ${nasm.join(', ')} say NASM and `
            + `${masm.join(', ')} say MASM. They mean opposite things by "MOV AX, VAR", so `
            + "guessing here would assemble a wrong program silently: pass { dialect: 'nasm' } "
            + "or { dialect: 'masm' } to settle it",
            { what: 'ambiguous dialect' });
    }
    return nasm.length ? 'nasm' : 'masm';
}

/** The prefix every name this front end INVENTS carries -- `%%` macro
 *  labels, `%$` context labels and ISTRUC anchors. It is what tells the
 *  local-label scope which labels are the author's and which are not. */
const NASM_GENERATED = '__n';

/** NASM's identifier, which is wider than MASM's: `#`, `~` and `.` are all
 *  in it, and `_C#` really is one name in retro-dos-graphics/speaker.asm. */
const NASM_ID = /^[A-Za-z_?][A-Za-z0-9_$#@~?.]*/;

/** Words that may open a line WITHOUT being a label. Anything else in that
 *  position IS one -- that is NASM's rule, and it is what makes the
 *  colon optional. */
let NASM_HEAD = null;
function nasmHeadWords() {
    if (NASM_HEAD) return NASM_HEAD;
    NASM_HEAD = new Set([...KNOWN_MNEMONICS,
        'db', 'dw', 'dd', 'dq', 'dt', 'resb', 'resw', 'resd', 'resq', 'rest',
        'times', 'equ', 'incbin', 'section', 'segment', 'org', 'bits', 'cpu',
        'align', 'alignb', 'struc', 'endstruc', 'istruc', 'at', 'iend',
        'global', 'extern', 'common', 'absolute', 'default', 'group',
        'use16', 'use32', 'end',
        // A bare segment-register prefix -- `ES: MOVSB` -- and the operand
        // and address size overrides. None of them is a label either, and
        // `es` read as one would silently drop the override.
        'cs', 'ds', 'es', 'ss', 'o16', 'o32', 'a16', 'a32',
        // Not a label. See LATER_THAN_8086: `pusha` alone on a line reads
        // as a label under NASM's colon-optional rule, and the instruction
        // then disappears without a word.
        ...LATER_THAN_8086.keys(),
    ]);
    return NASM_HEAD;
}

/** The `ifunc` package, which engine/header.asm asks for by name. `%rep
 *  ilog2e(ALTOTILE)` turns a multiply into a run of shifts, so the count has
 *  to be a number HERE, in the preprocessor, and not an expression the
 *  assembler evaluates later. */
const IFUNCS = {
    ilog2e: (x, ctx) => {
        if (x <= 0 || (x & (x - 1))) throw new AsmError(`ilog2e(${x}) -- not a power of two`,
            { ...ctx, what: 'ilog2e of non-power-of-two' });
        return Math.log2(x);
    },
    ilog2f: (x) => (x <= 0 ? 0 : Math.floor(Math.log2(x))),
    ilog2c: (x) => (x <= 0 ? 0 : Math.ceil(Math.log2(x))),
    ilog2w: (x) => (x <= 0 ? 0 : Math.round(Math.log2(x))),
};

/**
 * A constant the PREPROCESSOR must know, as opposed to one the assembler
 * evaluates. Only `%rep`, `%assign` and INCBIN's skip/length need this;
 * everything else is handed to `evalText` where the symbol table is.
 */
function nasmConst(text, ctx) {
    const toks = lex(text, ctx, true);
    let pos = 0;
    const primary = () => {
        const t = toks[pos];
        if (!t) throw new AsmError(`"${text.trim()}" ends where a number was expected`,
            { ...ctx, what: 'bad preprocessor expression' });
        if (t.k === 'op' && (t.v === '-' || t.v === '+')) { pos++; const v = primary(); return t.v === '-' ? -v : v; }
        if (t.k === 'op' && t.v === '(') { pos++; const v = sum(); if (!toks[pos] || toks[pos].v !== ')')
            throw new AsmError('a "(" is not closed', { ...ctx, what: 'bad preprocessor expression' });
            pos++; return v; }
        if (t.k === 'num') { pos++; return t.v; }
        if (t.k === 'str') { pos++; let v = 0; for (const c of t.v) v = (v << 8) | (c.charCodeAt(0) & 0xff); return v; }
        if (t.k === 'id' && IFUNCS[t.v.toLowerCase()]) {
            pos++;
            if (!toks[pos] || toks[pos].v !== '(') throw new AsmError(`${t.v} needs a "(" after it`,
                { ...ctx, what: 'bad preprocessor expression' });
            pos++;
            const arg = sum();
            if (!toks[pos] || toks[pos].v !== ')') throw new AsmError(`${t.v} is not closed`,
                { ...ctx, what: 'bad preprocessor expression' });
            pos++;
            return IFUNCS[t.v.toLowerCase()](arg, ctx);
        }
        throw new AsmError(
            `"${t.v}" has no value in the preprocessor -- %rep, %assign and INCBIN counts must be`
            + ' numbers by the time they are read, not symbols the assembler resolves later',
            { ...ctx, what: 'symbol in preprocessor expression' });
    };
    const product = () => {
        let v = primary();
        for (;;) {
            const t = toks[pos];
            const op = t && (t.k === 'op' ? t.v : t.k === 'id' ? t.v.toLowerCase() : null);
            if (op !== '*' && op !== '/' && op !== 'mod' && op !== 'shl' && op !== 'shr') break;
            pos++;
            const r = primary();
            if ((op === '/' || op === 'mod') && r === 0) throw new AsmError('division by zero',
                { ...ctx, what: 'division by zero' });
            v = op === '*' ? v * r : op === '/' ? Math.trunc(v / r) : op === 'mod' ? v % r
                : op === 'shl' ? v << r : v >> r;
        }
        return v;
    };
    const sum = () => {
        let v = product();
        for (;;) {
            const t = toks[pos];
            if (!t || t.k !== 'op' || (t.v !== '+' && t.v !== '-')) break;
            pos++;
            const r = product();
            v = t.v === '+' ? v + r : v - r;
        }
        return v;
    };
    const v = sum();
    if (pos !== toks.length) throw new AsmError(`cannot read the preprocessor expression "${text.trim()}"`,
        { ...ctx, what: 'bad preprocessor expression' });
    return v | 0;
}

/** Rewrite outside string literals, so `db ';.'` and `db "[es:di]"` survive. */
function outsideStrings(text, fn) {
    let out = '', i = 0, run = 0;
    while (i < text.length) {
        const c = text[i];
        if (c === "'" || c === '"' || c === '`') {
            out += fn(text.slice(run, i));
            let j = i + 1;
            while (j < text.length && text[j] !== c) j++;
            out += text.slice(i, Math.min(j + 1, text.length));
            i = j + 1; run = i;
            continue;
        }
        i++;
    }
    return out + fn(text.slice(run));
}

/**
 * NASM source in, MASM-dialect line entries out.
 *
 * Two stages, in NASM's own order: the `%`-preprocessor is purely textual
 * and knows nothing about instructions, and the normaliser is purely
 * syntactic and knows nothing about macros. Line numbers and file names
 * travel with every line all the way to an error message, which is the
 * whole reason this hands back entries rather than a string.
 */
class NasmFrontEnd {
    constructor(source, opts) {
        this.opts = opts || {};
        this.name = this.opts.name || 'source';
        // CASE SENSITIVE, unlike the symbol table -- see the header.
        this.defines = new Map();
        this.macros = new Map();
        this.contexts = [];
        this.seq = 0;
        this.budget = 0;
        this.warnings = [];
        this.pre = [];
        this.here = { line: 0, text: '', file: this.name };
        this.stack = [{ lines: NasmFrontEnd.split(source, this.name), i: 0, name: this.name }];
    }

    static split(source, file) {
        return String(source).split(/\r?\n/).map((text, i) => ({ text, line: i + 1, file }));
    }

    note(message) {
        if (!this.warnings.some((w) => w.line === this.here.line && w.message === message)) {
            this.warnings.push({ line: this.here.line, file: this.here.file, message });
        }
    }

    push(lines, what) {
        if (this.stack.length > 64) throw new AsmError(`${what} nests more than 64 deep`,
            { ...this.here, what: 'preprocessor recursion' });
        this.stack.push({ lines, i: 0, name: what });
    }

    next() {
        while (this.stack.length) {
            const top = this.stack[this.stack.length - 1];
            if (top.i >= top.lines.length) { this.stack.pop(); continue; }
            if (++this.budget > 400_000) throw new AsmError(
                'the preprocessor produced more than 400,000 lines',
                { ...this.here, what: 'preprocessor runaway' });
            return top.lines[top.i++];
        }
        return null;
    }

    // -- stage one: the % preprocessor -------------------------------------

    run() {
        for (;;) {
            const e = this.next();
            if (e === null) break;
            this.here = { line: e.line, text: e.text, file: e.file };
            const line = stripComment(e.text);
            if (!line) continue;
            // `%$label:` and `%%label:` OPEN A LINE and are not directives:
            // a context-local label is the one thing that starts with `%`
            // and has to be expanded rather than obeyed.
            if (line[0] === '%' && !/^%[$%]/.test(line)) { this.preDirective(line); continue; }
            const text = this.expand(line);
            // A macro can follow a label on the same line, so the label is
            // split off before the first word is tested.
            let head = '', rest = text;
            const lm = /^([A-Za-z_?.$][\w$#@~?.]*)\s*:\s*/.exec(text);
            if (lm) { head = lm[0]; rest = text.slice(lm[0].length); }
            const w = NASM_ID.exec(rest.trim());
            if (w && this.macros.has(w[0])) {
                if (head.trim()) this.emit(head.trim(), e);
                this.invoke(w[0], rest.trim().slice(w[0].length).trim());
                continue;
            }
            this.emit(text, e);
        }
        if (this.contexts.length) throw new AsmError(
            `the %push context "${this.contexts[this.contexts.length - 1].name}" is never %popped`,
            { ...this.here, what: 'unclosed %push' });
        return this.normalise();
    }

    emit(text, e) { this.pre.push({ text, line: e.line, file: e.file }); }

    preDirective(line) {
        const m = /^%\s*([A-Za-z_]+)\s*(.*)$/s.exec(line);
        if (!m) throw new AsmError(`cannot read the preprocessor line "${line}"`,
            { ...this.here, what: 'bad %-directive' });
        const d = m[1].toLowerCase(), rest = m[2].trim();
        switch (d) {
            case 'define': case 'assign': case 'xdefine': return this.define(d, rest);
            case 'undef': this.defines.delete(rest.split(/\s+/)[0]); return;
            case 'macro': return this.collectMacro(rest);
            case 'endmacro': case 'endm':
                throw new AsmError('%endmacro with no %macro', { ...this.here, what: 'stray %endmacro' });
            case 'rep': return this.collectRep(rest);
            case 'endrep':
                throw new AsmError('%endrep with no %rep', { ...this.here, what: 'stray %endrep' });
            case 'include': return this.include(rest);
            case 'push':
                this.contexts.push({ name: rest || 'ctx', tag: `${NASM_GENERATED}c${this.seq++}` });
                return;
            case 'pop': {
                const top = this.contexts.pop();
                if (!top) throw new AsmError('%pop with no %push', { ...this.here, what: 'stray %pop' });
                if (rest && rest !== top.name) throw new AsmError(
                    `%pop names "${rest}" but the open context is "${top.name}"`,
                    { ...this.here, what: 'mismatched %pop' });
                return;
            }
            case 'use':
                if (rest.replace(/^['"]|['"]$/g, '').toLowerCase() !== 'ifunc') {
                    throw new AsmError(`%use ${rest} -- only the "ifunc" package is supported`,
                        { ...this.here, what: `%use ${rest}` });
                }
                return;                          // ifunc is always available here
            default:
                throw new AsmError(
                    `"%${m[1]}" is not a preprocessor directive this assembler knows -- see the`
                    + ' NOT SUPPORTED list in the NASM front end of src/i8086-asm.js',
                    { ...this.here, what: `unsupported %${m[1].toLowerCase()}` });
        }
    }

    define(kind, rest) {
        // The `(` must TOUCH the name. `%assign BYTESPERSCAN (WIDTHPX / PXB)`
        // is a plain value whose body happens to be parenthesised, and
        // reading that as a parameter list makes the body empty.
        const m = /^([A-Za-z_?][\w$#@~?.]*)(\(([^)]*)\))?\s*([\s\S]*)$/.exec(rest);
        if (!m) throw new AsmError(`cannot read the %${kind} "${rest}"`,
            { ...this.here, what: `bad %${kind}` });
        const name = m[1];
        const params = m[2] ? m[3].split(',').map((s) => s.trim()).filter(Boolean) : null;
        let body = (m[4] || '').trim();
        // %assign and %xdefine are EAGER: the body is expanded once, now,
        // against what is defined at this point. %define is lazy and is
        // expanded every time it is used, which is why a %define may name a
        // symbol that does not exist yet and a %assign may not.
        if (kind === 'assign') body = String(nasmConst(this.expand(body), this.here));
        else if (kind === 'xdefine') body = this.expand(body);
        this.defines.set(name, { params, body });
    }

    /** One round of name substitution, outside string literals. */
    expandOnce(text) {
        let out = '', i = 0;
        while (i < text.length) {
            const c = text[i];
            if (c === "'" || c === '"' || c === '`') {
                let j = i + 1;
                while (j < text.length && text[j] !== c) j++;
                out += text.slice(i, Math.min(j + 1, text.length));
                i = j + 1;
                continue;
            }
            // A number is never a macro name, and scanning it as one would
            // let `%define d 4` rewrite the middle of `160d`.
            if (/[0-9]/.test(c)) {
                let j = i;
                while (j < text.length && /[\w.]/.test(text[j])) j++;
                out += text.slice(i, j); i = j;
                continue;
            }
            if (c === '%' && text[i + 1] === '$') {
                const cm = /^%\$(\$?)([A-Za-z0-9_$#@~?.]+)/.exec(text.slice(i));
                if (cm) {
                    if (cm[1]) throw new AsmError('%$$ (an outer context) is not supported',
                        { ...this.here, what: '%$$ context' });
                    if (!this.contexts.length) throw new AsmError(
                        `%$${cm[2]} needs a %push context and none is open`,
                        { ...this.here, what: '%$ without %push' });
                    out += `${this.contexts[this.contexts.length - 1].tag}_${cm[2]}`;
                    i += cm[0].length;
                    continue;
                }
            }
            const im = NASM_ID.exec(text.slice(i));
            if (im) {
                const name = im[0];
                let j = i + name.length;
                const d = this.defines.get(name);
                if (d && d.params) {
                    let k = j;
                    while (k < text.length && /\s/.test(text[k])) k++;
                    if (text[k] !== '(') { out += name; i = j; continue; }
                    let depth = 0, end = k;
                    for (; end < text.length; end++) {
                        if (text[end] === '(') depth++;
                        else if (text[end] === ')' && --depth === 0) break;
                    }
                    if (depth !== 0) throw new AsmError(`the call to ${name} is not closed`,
                        { ...this.here, what: 'bad %define call' });
                    const args = splitTop(text.slice(k + 1, end), ',').map((s) => s.trim());
                    let body = d.body;
                    d.params.forEach((p, n) => {
                        body = body.replace(new RegExp(`(^|[^\\w$#@~?.])${p}(?![\\w$#@~?.])`, 'g'),
                            (m0, pre) => `${pre}(${args[n] ?? ''})`);
                    });
                    out += body;
                    i = end + 1;
                    continue;
                }
                out += d ? d.body : name;
                i = j;
                continue;
            }
            out += c;
            i++;
        }
        return out;
    }

    expand(text) {
        for (let round = 0; round < 64; round++) {
            const next = this.expandOnce(text);
            if (next === text) return text;
            text = next;
        }
        throw new AsmError(`"${text.slice(0, 40)}" expands into itself`,
            { ...this.here, what: '%define recursion' });
    }

    /** Read a `%macro`/`%rep` body, counting nesting so an inner `%endrep`
     *  is not mistaken for the outer terminator. */
    collectBody(opener, closer, what) {
        const body = [];
        let depth = 1;
        for (;;) {
            const e = this.next();
            if (e === null) throw new AsmError(`a ${what} is never closed by %${closer}`,
                { ...this.here, what: `unclosed %${opener}` });
            const line = stripComment(e.text).trim().toLowerCase();
            if (line.startsWith(`%${closer}`)) { if (--depth === 0) return body; }
            else if (new RegExp(`^%${opener}\\b`).test(line)) depth++;
            body.push(e);
        }
    }

    collectMacro(rest) {
        // `%macro NAME 1-2 0` -- one required parameter, one optional, and
        // `0` is what the optional one is when it is left out. mapedit.asm
        // writes exactly that, which is why the range is read rather than
        // refused.
        const m = /^([A-Za-z_?][\w$#@~?.]*)\s+(\d+)(?:\s*-\s*(\d+|\*))?\s*([\s\S]*)$/.exec(rest);
        if (!m) throw new AsmError(`cannot read the %macro "${rest}"`,
            { ...this.here, what: 'bad %macro' });
        if (m[3] === '*') throw new AsmError(
            `%macro ${m[1]} takes any number of parameters (${m[2]}-*), which is not supported`,
            { ...this.here, what: '%macro greedy parameters' });
        const min = Number(m[2]);
        const max = m[3] === undefined ? min : Number(m[3]);
        const defaults = m[4].trim() ? splitTop(m[4].trim().replace(/\s+/g, ','), ',').map((x) => x.trim()).filter(Boolean) : [];
        this.macros.set(m[1], {
            name: m[1], min, max, defaults,
            body: this.collectBody('macro', 'endmacro', 'MACRO'),
        });
    }

    collectRep(rest) {
        const n = nasmConst(this.expand(rest), this.here);
        if (n < 0 || n > 65535) throw new AsmError(`a %rep count of ${n} is not meaningful`,
            { ...this.here, what: 'bad %rep count' });
        const body = this.collectBody('rep', 'endrep', 'REP');
        const out = [];
        for (let i = 0; i < n; i++) out.push(...body);
        this.push(out, '%rep');
    }

    invoke(name, argText) {
        const mac = this.macros.get(name);
        const args = argText ? splitTop(argText, ',').map((s) => s.trim().replace(/^\{([\s\S]*)\}$/, '$1')) : [];
        if (args.length < mac.min || args.length > mac.max) {
            throw new AsmError(
                `${mac.name} takes ${mac.min === mac.max ? mac.min : `${mac.min} to ${mac.max}`}`
                + ` parameter(s) and was given ${args.length}`,
                { ...this.here, what: 'macro arity' });
        }
        for (let i = args.length; i < mac.max; i++) args.push(mac.defaults[i - mac.min] ?? '');
        // `%%label` is unique PER INVOCATION -- a macro used twice would
        // otherwise define the same label twice -- and it is spelled without
        // a dot on purpose, so that it is a global label and does not become
        // a member of whatever local-label scope is open at the call site.
        const tag = `${NASM_GENERATED}l${this.seq++}`;
        const body = mac.body.map((b) => ({
            file: b.file,
            line: b.line,
            text: b.text
                .replace(/%%([A-Za-z0-9_$#@~?.]+)/g, (m0, l) => `${tag}_${l}`)
                .replace(/%(\d)/g, (m0, d) => (d === '0' ? String(args.length) : (args[Number(d) - 1] ?? ''))),
        }));
        this.push(body, `macro ${mac.name}`);
    }

    include(rest) {
        const path = rest.trim().replace(/^['"<]|['">]$/g, '');
        const read = this.opts.readInclude;
        if (typeof read !== 'function') {
            throw new AsmError(
                `%include '${path}' -- this assembler has no file system of its own; pass`
                + ' { readInclude(path) -> string } to resolve includes',
                { ...this.here, what: '%include without readInclude' });
        }
        const text = read(path);
        if (typeof text !== 'string') throw new AsmError(`%include '${path}' -- the file was not found`,
            { ...this.here, what: '%include not found' });
        this.push(NasmFrontEnd.split(text, path), `include ${path}`);
    }

    // -- stage two: syntax --------------------------------------------------

    /** The primitive directives NASM also accepts wrapped in brackets. */
    static BRACKETED = /^(org|bits|section|segment|cpu|absolute|global|extern|warning|map)\b/i;

    normalise() {
        const out = [];
        const push = (text, e) => out.push({ text, line: e.line, file: e.file });
        /** The last non-local label: what a leading `.` is scoped to. */
        let parent = '';
        let struc = null, istruc = null, sections = [];
        for (const e of this.pre) {
            this.here = { line: e.line, text: e.text, file: e.file };
            let text = e.text.trim();
            if (!text) continue;
            const br = /^\[\s*([^\]]*?)\s*\]$/.exec(text);
            if (br && NasmFrontEnd.BRACKETED.test(br[1])) text = br[1];

            // A label is the first word unless the first word is something
            // that cannot be one. NASM lets the colon go, and every one of
            // the four corpora uses both spellings.
            let label = null, rest = text;
            const lm = /^([A-Za-z_?.$][\w$#@~?.]*)\s*(:)?\s*/.exec(text);
            if (lm && (lm[2] || !nasmHeadWords().has(lm[1].toLowerCase()))) {
                label = lm[1];
                rest = text.slice(lm[0].length).trim();
            }
            if (label && !lm[2] && !rest) {
                // NASM warns on exactly this shape and so does this: a word
                // alone on a line with no colon is a label, and it is also
                // what a misspelled or unsupported instruction looks like.
                this.note(`"${label}" is a label on a line of its own with no colon`);
            }
            if (label) {
                if (label[0] === '.') {
                    if (!parent) throw new AsmError(
                        `the local label "${label}" has no label above it to belong to`,
                        { ...this.here, what: 'orphan local label' });
                    label = parent + label;
                    // A `%%` or `%$` label does NOT become the local-label
                    // scope. NASM spells those `..@N.name`, and names
                    // beginning `..@` are exempt from the local-label
                    // mechanism there for exactly this reason: a macro that
                    // defines `%%Retrace1` in the middle of a procedure must
                    // not capture the `.mainloop` written after it.
                } else if (!label.startsWith(NASM_GENERATED)) parent = label;
            }

            // STRUC is an offset table, not bytes: every member becomes an
            // EQU of the running total, so `resb SPRITE_size` inside another
            // STRUC is the assembler's arithmetic and not a second evaluator
            // here.
            if (struc) {
                if (/^endstruc\b/i.test(rest)) {
                    push(`${struc.name}_size equ ${struc.expr}`, e);
                    struc = null; parent = '';
                    continue;
                }
                const rm = /^(res[bwdqt])\s+([\s\S]*)$/i.exec(rest);
                if (!rm) {
                    if (!rest && label) { push(`${label} equ ${struc.expr}`, e); continue; }
                    throw new AsmError(
                        `"${rest}" inside STRUC ${struc.name} -- only RESB/RESW/RESD members and`
                        + ' ENDSTRUC are supported',
                        { ...this.here, what: 'STRUC member' });
                }
                const unit = { resb: 1, resw: 2, resd: 4, resq: 8, rest: 10 }[rm[1].toLowerCase()];
                if (label) push(`${label} equ ${struc.expr}`, e);
                struc.expr = `(${struc.expr})+(${unit})*(${this.fix(rm[2], parent)})`;
                continue;
            }
            const sm = /^struc\s+([A-Za-z_?][\w$#@~?.]*)\s*$/i.exec(rest);
            if (sm) { struc = { name: sm[1], expr: '0' }; parent = sm[1]; continue; }
            if (/^endstruc\b/i.test(rest)) throw new AsmError('ENDSTRUC with no STRUC',
                { ...this.here, what: 'stray ENDSTRUC' });

            // `NAME equ expr` keeps its MASM shape: a colon here would make
            // NAME a code label AND leave `equ 5` on a line of its own.
            const em = label && /^equ\s+([\s\S]*)$/i.exec(rest);
            if (em) { push(`${label} equ ${this.fix(em[1], parent)}`, e); continue; }
            if (label) push(`${label}:`, e);

            // ISTRUC lays an instance down at the offsets STRUC computed.
            // `ORG` inside a segment already pads forward and already
            // refuses to go backwards, which is exactly what AT needs.
            const im = /^istruc\s+([A-Za-z_?][\w$#@~?.]*)\s*$/i.exec(rest);
            if (im) {
                if (istruc) push(`org ${istruc.tag}+${istruc.name}_size`, e);
                istruc = { name: im[1], tag: `${NASM_GENERATED}i${this.seq++}` };
                push(`${istruc.tag}:`, e);
                continue;
            }
            if (istruc) {
                const am = /^at\s+([\s\S]*)$/i.exec(rest);
                if (am) {
                    const parts = splitTop(am[1], ',');
                    push(`org ${istruc.tag}+(${this.fix(parts[0], parent)})`, e);
                    const body = parts.slice(1).join(',').trim();
                    if (body) push(this.fix(body, parent), e);
                    continue;
                }
                // NASM 2.16 accepts an ISTRUC that is never closed by IEND
                // -- games/platform.asm has six of them and assembles -- so
                // closing it here rather than refusing is what matches the
                // tool the corpus was written for.
                push(`org ${istruc.tag}+${istruc.name}_size`, e);
                const wasIend = /^iend\b/i.test(rest);
                istruc = null;
                if (wasIend) continue;
            }
            if (/^iend\b/i.test(rest)) throw new AsmError('IEND with no ISTRUC',
                { ...this.here, what: 'stray IEND' });
            if (!rest) continue;

            const word = (/^([A-Za-z_?.$][\w$#@~?.]*)/.exec(rest) || [, ''])[1].toLowerCase();
            switch (word) {
                case 'bits': {
                    const n = rest.slice(4).trim();
                    if (n !== '16') throw new AsmError(`BITS ${n} -- this is an 8086`,
                        { ...this.here, what: `BITS ${n}` });
                    continue;
                }
                case 'cpu': {
                    const c = rest.slice(3).trim().toLowerCase();
                    // `CPU 186` IS ACCEPTED ONLY WHEN THE CALLER ASKED FOR A
                    // 186, and does not itself turn one on. NASM's directive
                    // is positional and this front end runs once over the
                    // whole file, so honouring it would mean honouring it
                    // for lines above where it appears -- and a source that
                    // can silently raise the target defeats the point of the
                    // default being 8086. It is accepted so that a genuine
                    // 186 source assembles, and refused otherwise so that
                    // the mismatch is named at the directive rather than
                    // fifty lines later at the first PUSHA.
                    const ok = c === '8086'
                        || ((c === '186' || c === '80186') && this.opts.variant === '80186');
                    if (!ok) throw new AsmError(
                        `CPU ${rest.slice(3).trim()} -- this assembler encodes 8086 instructions,`
                        + " and 80186 ones with {variant: '80186'}",
                        { ...this.here, what: `CPU ${c}` });
                    continue;
                }
                case 'section': case 'segment': {
                    const s = rest.slice(word.length).trim().split(/[\s]+/)[0].toLowerCase();
                    const map = { '.text': '.CODE', '.code': '.CODE', '.data': '.DATA', '.rodata': '.DATA', '.bss': '.BSS' };
                    if (!map[s]) throw new AsmError(
                        `SECTION ${rest.slice(word.length).trim()} -- only .text, .data, .rodata and`
                        + ' .bss are supported, with no attributes',
                        { ...this.here, what: `SECTION ${s}` });
                    if (rest.slice(word.length).trim().split(/\s+/).length > 1) {
                        throw new AsmError(
                            `SECTION ${rest.slice(word.length).trim()} -- section attributes`
                            + ' (align=, vstart=, nobits) are not supported',
                            { ...this.here, what: 'SECTION attributes' });
                    }
                    // NASM's bin writer emits .text, then .data, then .bss,
                    // whatever order they are declared in; this lays them
                    // out in declaration order. The one arrangement where
                    // the two disagree is refused rather than mis-ordered.
                    sections.push(s);
                    if (s === '.bss' && !sections.includes('.data')
                        && this.pre.some((p) => /^\s*\[?\s*section\s+\.data\b/i.test(p.text))) {
                        throw new AsmError(
                            'SECTION .bss is declared before SECTION .data, and NASM would still write'
                            + ' .data first; that reordering is not supported',
                            { ...this.here, what: '.bss before .data' });
                    }
                    push(map[s], e);
                    continue;
                }
                case 'global':
                    // ACCEPTED AND IGNORED, and the distinction from EXTERN
                    // below is the whole point. GLOBAL says "let other modules
                    // see this name". In a single-module flat image there ARE
                    // no other modules, and the label it names is defined right
                    // here -- so honouring it means doing nothing, and refusing
                    // it rejects a program that is completely well-formed.
                    //
                    // This is what a C compiler's output is made of: SmallerC
                    // marks every function and every file-scope variable GLOBAL,
                    // so refusing it refused every C program before it reached
                    // the first instruction.
                    continue;
                case 'extern':
                    // STILL REFUSED, because it is genuinely unresolvable: it
                    // names something that is NOT in this file and there is no
                    // second file to find it in. Named in the message, because
                    // "extern is unsupported" sends someone to look at the
                    // directive when what they need is the missing symbol --
                    // usually a libc function, which tells them what to do next.
                    throw new AsmError(
                        `EXTERN "${(String(rest || '').trim().replace(/^extern\s+/i, '')
                            .split(/[\s,]+/)[0]) || '?'}" cannot be`
                        + ' resolved: this assembles straight to a loadable image, so there is no'
                        + ' second module to find it in. Define it in this file, or link it in'
                        + ' before assembling.',
                        { ...this.here, what: 'unresolvable EXTERN' });
                case 'common': case 'absolute':
                case 'default': case 'group': case 'use16': case 'use32':
                    throw new AsmError(
                        `"${word.toUpperCase()}" is not supported -- this assembles straight to a`
                        + ' loadable image, so there is nothing to link',
                        { ...this.here, what: `unsupported ${word.toUpperCase()}` });
                case 'resb': case 'resw': case 'resd': case 'resq': case 'rest': {
                    const unit = { resb: 1, resw: 2, resd: 4, resq: 8, rest: 10 }[word];
                    if (unit > 4) throw new AsmError(`${word.toUpperCase()} is not supported (no 8087 here)`,
                        { ...this.here, what: `${word} unsupported` });
                    // There is no BSS here: reserved space is zeros, which
                    // is what DOS hands an image anyway. It costs file size
                    // and nothing else.
                    push(`${['', 'db', 'dw', '', 'dd'][unit]} (${this.fix(rest.slice(word.length), parent)}) dup (0)`, e);
                    continue;
                }
                case 'incbin': {
                    push(this.incbin(rest.slice(6)), e);
                    continue;
                }
                case 'times': {
                    // REPT already exists and already evaluates its count
                    // with the symbol table open, so `times 510-($-$$) db 0`
                    // needs no arithmetic here.
                    const t = /^times\s+([\s\S]*)$/i.exec(rest);
                    const split = this.splitTimes(t[1]);
                    push(`REPT ${this.fix(split.count, parent)}`, e);
                    push(this.fix(split.body, parent), e);
                    push('ENDM', e);
                    continue;
                }
                default:
                    push(this.fix(rest, parent), e);
            }
        }
        if (struc) throw new AsmError(`STRUC ${struc.name} is never closed by ENDSTRUC`,
            { ...this.here, what: 'unclosed STRUC' });
        if (istruc) out.push({ text: `org ${istruc.tag}+${istruc.name}_size`, line: this.here.line, file: this.here.file });
        return out;
    }

    /**
     * `TIMES <count> <instruction>` -- the count ends where the instruction
     * begins, and nothing in the grammar marks the join. The first word that
     * can OPEN a line is the instruction; everything before it is the count.
     */
    splitTimes(text) {
        const toks = [...text.matchAll(/[A-Za-z_?.$][\w$#@~?.]*/g)];
        for (const m of toks) {
            if (!nasmHeadWords().has(m[0].toLowerCase())) continue;
            return { count: text.slice(0, m.index).trim(), body: text.slice(m.index).trim() };
        }
        throw new AsmError(`TIMES ${text.trim()} -- nothing here looks like the instruction to repeat`,
            { ...this.here, what: 'bad TIMES' });
    }

    incbin(rest) {
        const parts = splitTop(rest, ',');
        const path = parts[0].trim().replace(/^['"]|['"]$/g, '');
        const read = this.opts.readBinary;
        if (typeof read !== 'function') {
            throw new AsmError(
                `INCBIN "${path}" -- this assembler has no file system of its own; pass`
                + ' { readBinary(path) -> Uint8Array } to resolve it',
                { ...this.here, what: 'INCBIN without readBinary' });
        }
        const data = read(path);
        if (!data) throw new AsmError(`INCBIN "${path}" -- the file was not found`,
            { ...this.here, what: 'INCBIN not found' });
        const all = Array.from(data);
        const skip = parts[1] ? nasmConst(parts[1], this.here) : 0;
        const len = parts[2] ? nasmConst(parts[2], this.here) : all.length - skip;
        if (skip < 0 || skip > all.length) throw new AsmError(
            `INCBIN "${path}" skips ${skip} bytes of a ${all.length}-byte file`,
            { ...this.here, what: 'INCBIN skip past end' });
        const bytes = all.slice(skip, skip + len);
        if (bytes.length < len) throw new AsmError(
            `INCBIN "${path}" wants ${len} bytes from offset ${skip} and the file holds ${all.length}`,
            { ...this.here, what: 'INCBIN short file' });
        return bytes.length ? `db ${bytes.map((b) => `0${(b & 0xff).toString(16)}h`).join(',')}` : 'db ';
    }

    /**
     * The two operand rewrites, both outside string literals.
     *
     * A LEADING DOT IS A LOCAL LABEL, scoped to the last global one, and
     * spelling it `parent.child` is not a workaround -- it is what NASM
     * itself does, which is why `SPRITE.x` and `.x` inside `struc SPRITE`
     * name the same symbol here as they do there.
     *
     * A SEGMENT OVERRIDE INSIDE THE BRACKETS, `[ds:bp+8]`, is NASM's
     * spelling of MASM's `ds:[bp+8]`. They are the same prefix byte.
     */
    fix(text, parent) {
        return outsideStrings(text, (s) => s
            // The SPACE is load-bearing: `mov word[es:di],0` is written
            // without one, and moving the prefix out without putting one in
            // spells `wordes:[di]`.
            .replace(/\[\s*(cs|ds|es|ss)\s*:/gi, (m0, r) => ` ${r}:[`)
            .replace(/(^|[^\w$#@~?.])\.([A-Za-z_?][\w$#@~?.]*)/g, (m0, pre, name) => {
                if (!parent) throw new AsmError(`the local label ".${name}" has no label above it to belong to`,
                    { ...this.here, what: 'orphan local label' });
                return `${pre}${parent}.${name}`;
            }));
    }
}

// ---------------------------------------------------------------------------
// Output.
// ---------------------------------------------------------------------------

function buildCom(asm, order) {
    // A NOBITS section is placed but not written: its labels are real
    // addresses past the end of the file, which is what a .COM gets for
    // free because DOS hands the program the rest of the segment.
    for (const s of order.map((n) => asm.segs.get(n))) {
        if (s.kind !== 'bss') continue;
        if (s.bytes.some((b) => (b & 0xff) !== 0)) {
            throw new AsmError(
                `the section "${s.name}" is uninitialised (.bss) and something in it emitted real`
                + ' bytes; those would not reach the image',
                { what: 'bytes in bss' });
        }
    }
    const segs = order.map((n) => asm.segs.get(n)).filter((s) => s.bytes.length && s.kind !== 'bss');
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
 * Assemble 8086 source, in either dialect.
 *
 * @param {string} source
 * @param {{ format?: 'auto'|'com'|'exe', maxPasses?: number,
 *           longJumps?: boolean, dialect?: 'auto'|'masm'|'nasm', name?: string,
 *           variant?: '8086'|'80186',
 *           readInclude?: (path:string) => string,
 *           readBinary?: (path:string) => Uint8Array }} [opts]
 *   `variant` is which chip to assemble FOR, spelled as the core and the
 *   disassembler spell it. It defaults to '8086' and an unknown value is
 *   refused rather than quietly becoming one; see the module header for
 *   what '80186' adds and what it does not.
 *   `longJumps` promotes a conditional jump or LOOP that cannot reach; OFF
 *   by default, and see the module header for why the default is the
 *   interesting part. `dialect` defaults to 'auto', which reads the source
 *   for the signals listed in the NASM front end and REFUSES rather than
 *   guesses when both dialects' signals are present. `readInclude` and
 *   `readBinary` are what `%include` and `INCBIN` reach the file system
 *   through; this module has none of its own.
 * @returns {{ bytes: Uint8Array, format: 'com'|'exe', org?: number,
 *             entry?: {para:number, off:number}, symbols: Map<string,object>,
 *             warnings: {line:number, message:string}[], passes: number,
 *             segments: {name:string, para:number, size:number}[] }}
 */
export function assemble(source, opts = {}) {
    // REFUSED, NOT DEFAULTED. `{variant: '186'}` and `{variant: 'V20'}` are
    // the two spellings a caller reaches for first, and both are wrong;
    // falling back to '8086' would hand them an assembler that silently
    // refuses the fifteen instructions they asked for. The core and the
    // disassembler refuse the same two strings with the same message shape.
    if (opts.variant !== undefined && opts.variant !== '8086' && opts.variant !== '80186') {
        throw new AsmError(`unknown variant ${JSON.stringify(opts.variant)} `
            + "-- expected '8086' or '80186'", { what: 'unknown variant' });
    }
    const dialect = !opts.dialect || opts.dialect === 'auto' ? detectDialect(source) : opts.dialect;
    if (dialect !== 'masm' && dialect !== 'nasm') {
        throw new AsmError(`dialect "${dialect}" -- only 'masm', 'nasm' and 'auto' exist here`,
            { what: 'unknown dialect' });
    }
    let front = null;
    if (dialect === 'nasm') {
        front = new NasmFrontEnd(source, opts);
        source = front.run();
    }
    const asm = new Assembler(source, { ...opts, dialect });
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
    // The front end's own notes belong in the same list. They come FIRST
    // because they happened first, and because a preprocessor warning
    // usually explains the assembler warning under it.
    const warnings = front ? [...front.warnings, ...asm.warnings] : asm.warnings;
    if (format === 'com') {
        const { bytes, org } = buildCom(asm, order);
        return { bytes, format, org, dialect, symbols: asm.symbols, warnings, passes, segments };
    }
    const { bytes, entry } = buildExe(asm, order);
    return { bytes, format, entry, dialect, symbols: asm.symbols, warnings, passes, segments };
}

/**
 * Assemble a bare instruction stream to raw bytes at a chosen origin. This
 * is what the round-trip test drives: no segments, no header, nothing but
 * the encoder.
 *
 * @param {string} source @param {number} [org]
 * @param {{ variant?: '8086'|'80186' }} [opts] passed straight through, so
 *   the round-trip test can drive a 186 the same way it drives an 8086.
 * @returns {Uint8Array}
 */
export function assembleRaw(source, org = 0, opts = {}) {
    const r = assemble(`ORG ${org}\n${source}\nEND\n`, { ...opts, format: 'com' });
    return r.bytes;
}

export default assemble;
