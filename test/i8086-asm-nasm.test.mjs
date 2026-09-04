// The NASM dialect of src/i8086-asm.js.
//
// WHAT THIS FILE IS FOR AND WHAT IT IS NOT FOR. The strong check on the NASM
// side is `test/oracle-nasm.test.mjs`, which runs NASM 2.16 over the four
// shipped corpora and compares the images byte for byte -- but NASM is not
// vendored, so that file skips when it is absent. This one needs nothing
// installed and pins the RULES rather than the corpus: the seven parse-level
// differences between the dialects, each construct the front end refuses BY
// NAME, and the two regressions that were found by diffing against NASM and
// would have been invisible without it.
//
// The first test in the file is the one that matters most. NASM's
// `MOV AX, VAR` is the ADDRESS and MASM's is the CONTENTS, exactly inverted,
// and getting it backwards produces a program that assembles, runs, and
// computes with the wrong number. It is asserted in both directions in both
// dialects, because asserting it one way would pass for an assembler that
// had simply stopped reading brackets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, detectDialect, AsmError } from '../src/i8086-asm.js';

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/** Assemble and hand back the .COM image, refusing to guess the dialect. */
const nasm = (body, opts = {}) => assemble(body, { dialect: 'nasm', ...opts });
const masm = (body, opts = {}) => assemble(body, { dialect: 'masm', ...opts });

/** @returns {AsmError|null} */
function refusal(fn) {
    try { fn(); } catch (e) {
        assert.ok(e instanceof AsmError, `expected an AsmError, got ${e}`);
        return e;
    }
    return null;
}

// ---------------------------------------------------------------------------
// The rule that inverts.
// ---------------------------------------------------------------------------

test('a bare label is its ADDRESS in NASM and its CONTENTS in MASM', () => {
    // Same program, same layout, one dialect apart. B8 is `mov ax, imm16`
    // and A1 is `mov ax, [addr]`, so the two encodings are unmistakable and
    // the assertion cannot be satisfied by accident.
    const n = nasm('bits 16\norg 100h\nstart:\n mov ax, var\n mov bx, [var]\n int 20h\nvar dw 1234h\n');
    assert.equal(hex(n.bytes.slice(0, 3)), 'b8 09 01', 'NASM: a bare label is the address');
    assert.equal(hex(n.bytes.slice(3, 7)), '8b 1e 09 01', 'NASM: brackets are the load');

    const m = masm('ORG 100H\nSTART:\n MOV AX, OFFSET VAR\n MOV BX, VAR\n INT 20H\nVAR DW 1234H\n');
    assert.equal(hex(m.bytes.slice(0, 3)), 'b8 09 01', 'MASM: OFFSET is the address');
    assert.equal(hex(m.bytes.slice(3, 7)), '8b 1e 09 01', 'MASM: a bare label is the load');

    // AND THE SAME TEXT MEANS DIFFERENT THINGS, which is the whole hazard:
    // `MOV AX, VAR` assembles under both and is not the same instruction.
    const same = 'ORG 100H\nSTART:\n MOV AX, VAR\n INT 20H\nVAR DW 1234H\n';
    assert.equal(hex(masm(same).bytes.slice(0, 3)), 'a1 05 01');
    assert.equal(hex(nasm(same).bytes.slice(0, 3)), 'b8 05 01');
});

test('brackets on a jump target mean INDIRECT in NASM and are refused on a conditional', () => {
    // In MASM `JMP TARGET` and `JMP [TARGET]` are the same thing and the
    // declared type decides. In NASM the brackets decide, so a bracketed
    // target has to go THROUGH the word stored there.
    const r = nasm('bits 16\norg 100h\nstart:\n jmp [vec]\nvec dw 0\n');
    assert.equal(hex(r.bytes.slice(0, 4)), 'ff 26 04 01', 'jmp [vec] is the indirect near form');
    const e = refusal(() => nasm('bits 16\norg 100h\nstart:\n jz [vec]\nvec dw 0\n'));
    assert.equal(e && e.what, 'indirect conditional jump',
        'and a conditional cannot be indirect at all, so it is refused rather than made relative');
    // The direct form is still relative, and still one byte of displacement.
    const d = nasm('bits 16\norg 100h\nstart:\n jz start\n int 20h\n');
    assert.equal(hex(d.bytes.slice(0, 2)), '74 fe');
});

// ---------------------------------------------------------------------------
// Autodetection. A wrong guess here is a wrong program, not an error.
// ---------------------------------------------------------------------------

test('the dialect is detected, and an ambiguous source is refused rather than guessed', () => {
    assert.equal(detectDialect('[org 0x100]\nmov ax, 1\n'), 'nasm');
    assert.equal(detectDialect('bits 16\nsection .text\n'), 'nasm');
    assert.equal(detectDialect('.MODEL SMALL\n.CODE\n'), 'masm');
    assert.equal(detectDialect('CODE SEGMENT\nASSUME CS:CODE\nCODE ENDS\n'), 'masm');
    // No evidence at all is MASM, which is what every caller that predates
    // the front end means.
    assert.equal(detectDialect('MOV AX, BX\n'), 'masm');
    const e = refusal(() => detectDialect('bits 16\n.MODEL SMALL\nMOV AX, BX\n'));
    assert.equal(e && e.what, 'ambiguous dialect');
    assert.match(e.message, /BITS/, 'the message names what said NASM');
    assert.match(e.message, /\.MODEL/, 'and what said MASM');
    // ...and an explicit dialect settles it without complaint.
    assert.ok(masm('.MODEL SMALL\n.CODE\nMAIN PROC\nMOV AX, BX\nINT 20H\nMAIN ENDP\nEND MAIN\n').bytes.length);
});

test('a MASM constant called TIMES does not make the source look like NASM', () => {
    // A signal that fires on a plain identifier is not a signal. Two Amey
    // programs write `TIMES EQU 5`, and reading those as NASM would have
    // inverted every memory reference in them.
    assert.equal(detectDialect('CODE SEGMENT\n TIMES EQU 5\nCODE ENDS\nEND\n'), 'masm');
});

// ---------------------------------------------------------------------------
// The rest of the parse-level differences.
// ---------------------------------------------------------------------------

test('a size keyword needs no PTR, and needs no space either', () => {
    const a = nasm('bits 16\norg 100h\n mov byte [bx], 1\n mov word [bx], 1\n');
    assert.equal(hex(a.bytes), 'c6 07 01 c7 07 01 00');
    // `mov word[es:di],0x5820` is written without a space in Maze Runner,
    // and the segment override lives INSIDE the brackets there.
    const b = nasm('bits 16\norg 100h\n mov word[es:di],0x5820\n');
    assert.equal(hex(b.bytes), '26 c7 05 20 58');
});

test('0x is a hex prefix and 0b, 0d and 0h deliberately are not', () => {
    const r = nasm('bits 16\norg 100h\n mov ax, 0x1f\n mov bx, 0B800h\n mov cx, 00000010b\n mov dx, 0Bx\n');
    assert.equal(hex(r.bytes.slice(0, 3)), 'b8 1f 00', '0x is hex');
    // THE REASON THE OTHER PREFIXES ARE NOT IMPLEMENTED. `0B800h` is CGA's
    // segment under the trailing-h rule this lexer already had, and 5 under
    // a `0b` binary-prefix rule. Two readings that differ by a factor of
    // five hundred are not a thing to guess at.
    assert.equal(hex(r.bytes.slice(3, 6)), 'bb 00 b8', '0B800h is B800h, not binary 0');
    assert.equal(hex(r.bytes.slice(6, 9)), 'b9 02 00', 'and the trailing-b form still works');
    // NASM also spells hex with a trailing x, which retro-dos-graphics does.
    assert.equal(hex(r.bytes.slice(9, 12)), 'ba 0b 00', '0Bx is 0Bh');
});

test('NASM binds | ^ & << >> the way C does, not the way MASM does', () => {
    const r = nasm('bits 16\norg 100h\n mov ax, 1 | 2 | 8\n mov bx, 1 << 4\n mov cx, 0Fh & 3\n mov dx, 5 ^ 1\n');
    assert.equal(hex(r.bytes.slice(0, 3)), 'b8 0b 00');
    assert.equal(hex(r.bytes.slice(3, 6)), 'bb 10 00');
    assert.equal(hex(r.bytes.slice(6, 9)), 'b9 03 00');
    assert.equal(hex(r.bytes.slice(9, 12)), 'ba 04 00');
    // The precedence, which is where MASM's table would have been wrong:
    // NASM puts the shifts BETWEEN & and +, so `1 | 2 << 2` is 9 and not 12.
    assert.equal(hex(nasm('bits 16\norg 100h\n mov ax, 1 | 2 << 2\n').bytes), 'b8 09 00');
});

test('a leading dot is a local label scoped to the label above it', () => {
    // Two procedures each with a `.loop`, which is the whole point of the
    // mechanism and an immediate duplicate-symbol error without it.
    const r = nasm(`bits 16
org 100h
first:
.loop:
    dec cx
    jnz .loop
    ret
second:
.loop:
    dec dx
    jnz .loop
    ret
`);
    assert.equal(hex(r.bytes), '49 75 fd c3 4a 75 fd c3');
    const e = refusal(() => nasm('bits 16\norg 100h\n.orphan:\n ret\n'));
    assert.equal(e && e.what, 'orphan local label', 'and one with nothing above it is refused by name');
});

test('a label may go without its colon, and a post-8086 instruction may NOT become one', () => {
    // NASM's colon-optional rule is what makes `score resw 1` work. It is
    // also how `pusha` in MazeRunnercode.asm silently BECAME A LABEL and the
    // instruction disappeared -- the program assembled, ran, and returned
    // through a stack it had never balanced.
    const r = nasm('bits 16\norg 100h\nstart\n mov ax, 1\nwl\n jmp wl\n');
    assert.equal(hex(r.bytes), 'b8 01 00 eb fe');
    assert.ok(r.warnings.some((w) => /label on a line of its own with no colon/.test(w.message)),
        'and the shape that hides a typo is at least reported, as NASM reports it');
    for (const [mn, machine] of [['pusha', '80186'], ['popa', '80186'], ['leave', '80186'],
        ['movzx', '80386'], ['fld', '8087']]) {
        const e = refusal(() => nasm(`bits 16\norg 100h\nstart:\n ${mn}\n`));
        assert.ok(e, `${mn} is refused, not turned into a label`);
        assert.match(e.message, new RegExp(machine), 'and the refusal names the machine that has it');
    }
});

test('a DWORD operand is refused everywhere the 8086 does not read four bytes', () => {
    // `inc dword [score]` in Snake.asm reached a width test that asks only
    // "is it two" and came out as `inc byte [score]`: three quarters of a
    // counter that never incremented, with nothing said.
    const e = refusal(() => nasm('bits 16\norg 100h\nstart:\n inc dword [score]\nscore dw 0,0\n'));
    assert.equal(e && e.what, 'operand too wide');
    assert.match(e.message, /80386/);
    // The four places it is legitimate still work.
    const ok = nasm('bits 16\norg 100h\nstart:\n les di, [vec]\n jmp far [vec]\nvec dd 0\n');
    assert.equal(hex(ok.bytes.slice(0, 4)), 'c4 3e 08 01');
});

test('RESB reserves bytes and .bss reserves them without writing any', () => {
    // NASM's .bss is NOBITS. Writing it out as zeros made mapedit.asm 459
    // bytes longer than NASM's own image and Snake.asm 2000 -- a difference
    // no test that only reads symbols would ever see.
    const r = nasm(`bits 16
org 100h
start:
    mov al, [flag]
    int 20h
section .bss
flag    resb 1
buffer  resb 2000
`);
    assert.equal(r.bytes.length, 5, 'the image is the code and nothing else');
    // The label is still a real address, past the end of the file: .text is
    // five bytes at 100h, and .bss starts on the next four-byte boundary.
    assert.equal(hex(r.bytes.slice(0, 3)), 'a0 08 01');
    const e = refusal(() => nasm('bits 16\norg 100h\nsection .bss\n db 1\n'));
    assert.equal(e && e.what, 'bytes in bss', 'and real bytes in .bss are refused, not dropped');
});

test('sections come out in NASM bin order, aligned the way NASM aligns them', () => {
    // NASM's bin writer starts each section on a four-byte boundary, and
    // raises that to the largest ALIGN inside the section. `align 8, db 0`
    // in .data moved five retro-dos-graphics programs by four bytes.
    const four = nasm('bits 16\norg 100h\nstart:\n mov al, [v]\nsection .data\nv db 7\n');
    assert.equal(hex(four.bytes), 'a0 04 01 00 07', '.data is padded to 4');
    const eight = nasm('bits 16\norg 100h\nstart:\n mov al, [v]\nsection .data\n align 8, db 0\nv db 7\n');
    assert.equal(hex(eight.bytes), 'a0 08 01 00 00 00 00 00 07', 'and to 8 when an ALIGN says so');
});

test('TIMES and $$ assemble the idiom every boot sector is padded with', () => {
    // NOTHING IN THE FOUR CORPORA USES EITHER, and that is worth saying out
    // loud: this test and the NASM differential are their only evidence,
    // which is a weaker guarantee than the rest of this file carries.
    const r = nasm('bits 16\norg 7c00h\nstart:\n jmp start\n times 510-($-$$) db 0\n dw 0AA55h\n');
    assert.equal(r.bytes.length, 512);
    assert.equal(hex(r.bytes.slice(0, 2)), 'eb fe');
    assert.equal(hex(r.bytes.slice(510)), '55 aa');
    assert.ok([...r.bytes.slice(2, 510)].every((b) => b === 0));
});

// ---------------------------------------------------------------------------
// The preprocessor.
// ---------------------------------------------------------------------------

test('%define, %assign, %macro, %rep and %%labels', () => {
    const r = nasm(`bits 16
org 100h
%define VIDEO 0x10
%assign TWICE (2 * 3)
%macro SETMODE 1
    mov ah, 0
    mov al, %1
    int VIDEO
%endmacro
%macro SPIN 0
%%again:
    dec cx
    jnz %%again
%endmacro
start:
    SETMODE 4
    mov bx, TWICE
%rep 3
    nop
%endrep
    SPIN
    SPIN
`);
    assert.equal(hex(r.bytes.slice(0, 6)), 'b4 00 b0 04 cd 10', 'the macro expanded with its argument');
    assert.equal(hex(r.bytes.slice(6, 9)), 'bb 06 00', '%assign evaluated once, eagerly');
    assert.equal(hex(r.bytes.slice(9, 12)), '90 90 90', '%rep repeated the body');
    // TWO INVOCATIONS, TWO LABELS. A `%%` label that was not unique per
    // invocation would be a duplicate-symbol error here, and one that
    // captured the local-label scope would steal the next `.name`.
    assert.equal(hex(r.bytes.slice(12)), '49 75 fd 49 75 fd');
});

test('%macro takes a parameter range with defaults, as mapedit.asm writes it', () => {
    const r = nasm(`bits 16
org 100h
%macro DIR 1-2 7
    mov si, %1
    mov dl, %2
%endmacro
start:
    DIR 0x1234
    DIR 0x1234, 9
`);
    assert.equal(hex(r.bytes.slice(0, 5)), 'be 34 12 b2 07', 'the default filled the missing parameter');
    assert.equal(hex(r.bytes.slice(5)), 'be 34 12 b2 09', 'and an explicit one overrides it');
    const e = refusal(() => nasm('bits 16\norg 100h\n%macro D 1-2 7\n nop\n%endmacro\nstart:\n D 1,2,3\n'));
    assert.equal(e && e.what, 'macro arity');
});

test('%%labels and %$ context labels do not capture the local-label scope', () => {
    // NASM spells both `..@N.name`, and names beginning `..@` are exempt
    // from the local-label mechanism there for exactly this reason: a macro
    // expanded in the middle of a procedure must not steal the `.name`
    // written after it. Four retro-dos-graphics programs refused with
    // `undefined symbol __nl3_Retrace2.mainloop` before this was right.
    const r = nasm(`bits 16
org 100h
%macro VSYNC 0
%%wait:
    in al, dx
    test al, 8
    jz %%wait
%endmacro
outer:
    VSYNC
.mainloop:
    dec cx
    jnz .mainloop
`);
    assert.equal(hex(r.bytes.slice(-3)), '49 75 fd', '.mainloop still belongs to outer');
});

test('%include and INCBIN reach the file system only through the caller', () => {
    // This module has no file system of its own, on purpose: it runs in a
    // browser. Both hooks are named in the refusal so that the caller knows
    // which one to pass.
    const src = "bits 16\norg 100h\n%include 'lib.inc'\nstart:\n HELLO\n incbin 'art.bin'\n";
    const e = refusal(() => nasm(src));
    assert.equal(e && e.what, '%include without readInclude');
    assert.match(e.message, /readInclude/);
    const r = nasm(src, {
        readInclude: (p) => (p === 'lib.inc' ? '%macro HELLO 0\n mov ax, 0x4c00\n%endmacro\n' : undefined),
        readBinary: (p) => (p === 'art.bin' ? Uint8Array.from([1, 2, 3]) : undefined),
    });
    assert.equal(hex(r.bytes), 'b8 00 4c 01 02 03');
    const missing = refusal(() => nasm(src, { readInclude: () => undefined, readBinary: () => undefined }));
    assert.equal(missing && missing.what, '%include not found');
});

test('STRUC is an offset table and ISTRUC lays one down at those offsets', () => {
    const r = nasm(`bits 16
org 100h
struc POINT
    .x  resw 1
    .y  resw 1
    .tag resb 1
endstruc
start:
    mov ax, [bx + POINT.y]
    mov cx, POINT_size
    int 20h
p1:
    istruc POINT
    at POINT.x,   dw 11
    at POINT.tag, db 3
    iend
`);
    assert.equal(hex(r.bytes.slice(0, 3)), '8b 47 02', 'POINT.y is offset 2');
    assert.equal(hex(r.bytes.slice(3, 6)), 'b9 05 00', 'and POINT_size is 5');
    // AT places by offset and the gap is zero-filled, which is what makes
    // this different from writing the members out in order.
    assert.equal(hex(r.bytes.slice(8)), '0b 00 00 00 03');
});

// ---------------------------------------------------------------------------
// What is refused, by name.
// ---------------------------------------------------------------------------

test('every unsupported NASM construct is refused by a name, not by a symptom', () => {
    const cases = [
        ['%if 1\n nop\n%endif\n', 'unsupported %if'],
        ['%strlen a b\n', 'unsupported %strlen'],
        ['%use altreg\n', '%use altreg'],
        ['bits 32\n', 'BITS 32'],
        ['cpu 386\n', 'CPU 386'],
        ['section .weird\n', 'SECTION .weird'],
        ['section .data align=16\n', 'SECTION attributes'],
        // EXTERN's `what` changed when GLOBAL stopped being refused with it.
        // They were one case and are now two different facts: GLOBAL is a
        // no-op in a flat image, EXTERN is genuinely unresolvable.
        ['extern printf\n', 'unresolvable EXTERN'],
        ['%macro M 1-*\n%endmacro\n', '%macro greedy parameters'],
    ];
    for (const [body, what] of cases) {
        const e = refusal(() => nasm(`bits 16\norg 100h\n${body}`));
        assert.ok(e, `${body.trim()} is refused`);
        assert.equal(e.what, what, `and it is refused as "${what}"`);
    }
});

// ---------------------------------------------------------------------------
// Jumps: the slot defect, and whose default promotion is.
// ---------------------------------------------------------------------------

test('one jump claims one slot, whichever form it ends up in', () => {
    // THE REPRODUCTION. `jumpSlot()` was called at two places, and `branch`
    // claimed a slot AND then called `relJump`, which claimed another -- so
    // a JMP consumed one slot while it was near and two once it shrank to
    // short. The first time any JMP in a module changed its mind, every jump
    // after it moved up one slot and read a decision belonging to its
    // neighbour.
    //
    // Here `jmp s0` is near on pass one and short on pass two. That shifts
    // the JNZ, which was promoted on pass one, onto an untouched slot, and
    // it is then emitted short against pass-one distances it cannot reach --
    // so a jump that reaches by twenty bytes is refused as out of range.
    // primitiv/jstick3.asm (line 1000) and primitiv/p16doble.asm (line 432)
    // both failed exactly this way.
    const src = `bits 16
org 100h
start:
    jmp tail
    jmp s0
s0:
    jnz faraway
    jmp near1
near1:
    times 121 db 0x90
faraway:
tail:
    int 20h
`;
    const r = nasm(src);
    assert.equal(hex(r.bytes.slice(0, 3)), 'e9 7f 00', 'the far JMP stayed near');
    assert.equal(hex(r.bytes.slice(3, 5)), 'eb 00', 'the near one shrank to short');
    assert.equal(hex(r.bytes.slice(5, 7)), '75 7b', 'and the JNZ reaches in one byte, as it always did');
});

test('JMP NEAR PTR is honoured even after a jump ahead of it has shrunk', () => {
    // THE DEFECT THAT WAS REPORTED AND IS NOT THERE. The claim was that
    // `JMP NEAR PTR label` is ignored in a large source because of the slot
    // desynchronisation above. It is not: `near` sets `distance`, `distance`
    // makes `fits` false whatever any slot says, and E9 comes out. Two
    // shapes, including one where the JMP in front of it shrinks between
    // passes, which is the condition the report named.
    const r = masm(`ORG 100H
START:
    JMP SHRINKS
SHRINKS:
    JMP NEAR PTR NEARBY
NEARBY:
    INT 20H
`);
    assert.equal(hex(r.bytes), 'eb 00 e9 00 00 cd 20');
    assert.equal(hex(nasm('bits 16\norg 100h\nstart:\n jmp short a\na:\n jmp near b\nb:\n int 20h\n').bytes),
        'eb 00 e9 00 00 cd 20');
});

test('promotion is on by default for NASM and off by default for MASM', () => {
    // NOT A PREFERENCE: it is what the source's own assembler does. NASM
    // told `CPU 8086` rewrites an out-of-range `JGE` as `7C 03 E9 rel16`,
    // which is this module's `promote()` byte for byte. MASM 1.10 refuses,
    // and fourteen Amey programs are refused here for that reason.
    const far = (dialect) => (dialect === 'nasm'
        ? `bits 16\norg 100h\nstart:\n jge done\n times 200 db 0x90\ndone:\n int 20h\n`
        : `ORG 100H\nSTART:\n JGE DONE\n DB 200 DUP(90H)\nDONE:\n INT 20H\n`);
    const n = nasm(far('nasm'));
    assert.equal(hex(n.bytes.slice(0, 5)), '7c 03 e9 c8 00', 'NASM promotes, and this is NASM’s sequence');
    assert.ok(n.warnings.some((w) => /promoted to a branch over a near jump/.test(w.message)),
        'and says so rather than doing it silently');
    const e = refusal(() => masm(far('masm')));
    assert.equal(e && e.what, 'jump out of range', 'MASM refuses, so this refuses');
    assert.match(e.message, /longJumps/, 'and the refusal offers the option');
    // The flag still overrides the default in both directions.
    assert.equal(hex(masm(far('masm'), { longJumps: true }).bytes.slice(0, 5)), '7c 03 e9 c8 00');
    assert.equal(refusal(() => nasm(far('nasm'), { longJumps: false })).what, 'jump out of range');
});


// ---------------------------------------------------------------------------
// What a C COMPILER'S output is made of
// ---------------------------------------------------------------------------
//
// SmallerC (BSD-2) emits NASM `bits 16` for DOS, and its output met this
// assembler at exactly two directives -- both of which it emits before the
// first instruction of any program, so refusing either refused every C program
// outright. Verified against real compiler output, not a guess at its shape.

const asm = (src) => { const r = assemble(src, {}); return [...(r.bytes || r)]; };

test('GLOBAL is accepted and ignored, because a flat image has no other module', () => {
    // GLOBAL says "let other modules see this name". In a single-module flat
    // image there ARE none, and the label is defined right here -- so honouring
    // it means doing nothing. SmallerC marks every function and every
    // file-scope variable GLOBAL, so this was the first thing every C program
    // hit.
    assert.deepEqual(asm('bits 16\nsection .text\n global _main\n_main:\n mov ax, 1\n ret\n'),
        [0xb8, 0x01, 0x00, 0xc3],
        'the GLOBAL emitted nothing and the code is unchanged by it');
});

test('EXTERN is still refused, and the message names the SYMBOL', () => {
    // The distinction: EXTERN names something NOT in this file and there is no
    // second file. Naming the directive sends someone to look at the directive;
    // naming the symbol tells them what is missing -- usually a libc function,
    // which tells them what to do next.
    assert.throws(() => assemble('bits 16\n extern _printf\n call _printf\n', {}),
        /EXTERN "_printf" cannot be resolved/);
});

test('ALIGNB pads with ZERO, not with NOP, and that is not cosmetic', () => {
    // ALIGNB is ALIGN's .bss twin. .bss holds VARIABLES, so padding with 90h
    // gives every aligned variable a neighbour holding 0x9090 instead of 0.
    assert.deepEqual(asm('bits 16\n db 1\n alignb 4\n db 2\n'), [1, 0, 0, 0, 2]);
    assert.deepEqual(asm('bits 16\n db 1\n align 4\n db 2\n'), [1, 0x90, 0x90, 0x90, 2],
        'while ALIGN still pads with NOP, which is right in front of CODE');
});

test('a compiler-shaped module assembles: sections, globals, bss, a frame', () => {
    const b = asm([
        'bits 16', 'section .bss', ' alignb 2', ' global _count', '_count:', ' resb 2',
        'section .text', ' global _bump', '_bump:',
        ' push bp', ' mov bp, sp', ' mov ax, [_count]', ' add ax, [bp+4]',
        ' mov [_count], ax', ' pop bp', ' ret',
    ].join('\n'));
    assert.ok(b.length > 10, `assembled ${b.length} bytes`);
});
