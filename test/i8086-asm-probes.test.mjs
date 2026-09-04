/**
 * The constructs the corpus never writes.
 *
 * The assembler's strongest number is a corpus agreement: of 525 textbook
 * programs, 510 assemble and 470 produce byte-identical output against an
 * independent implementation. That is real evidence and it is narrower than it
 * sounds, because **a corpus is evidence only about the constructs it
 * contains** (VERIFICATION.md), and this one is 525 programs in a single
 * textbook's house style.
 *
 * Measured across all 525 files, by construct, as a fraction of the corpus:
 *
 *     $ 97.1%   .MODEL 94.9%   .CODE 94.9%   .DATA 94.1%   PROC 91.0%
 *     EQU 57.5%   DUP 16.4%   OFFSET 13.7%   PTR 12.8%   MACRO 3.2%
 *     SEG 3.2%   ORG 2.5%   ES: 2.5%   SEGMENT 1.5%   ASSUME 1.5%
 *     data-in-CODE 1.0%   LOCAL 0.8%   REPT 0.4%   IF/ELSE 0.4%   SS: 0.4%
 *
 * and SEVEN at exactly zero: `=`, a CS: override, a far CALL/JMP,
 * PUBLIC/EXTRN, STRUC, RECORD, and a nested DUP.
 *
 * THAT ZERO IS WHY THIS FILE EXISTS. It is not a gap in coverage that a
 * bigger corpus would close — it is the reason the corpus could not see the
 * missing-ASSUME defect at all, and why 467 MATCH was identical before and
 * after the fix for it. A corpus tells you the common path works; only a
 * probe reaches a construct nobody happened to write.
 *
 * Every expectation here is checked against something independent of the
 * assembler: either the disassembler, which is ground against 646,000
 * hardware-generated vectors on text AND length, or a named refusal. Nothing
 * asserts merely that the assembler agrees with itself.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assemble, assembleRaw } from '../src/i8086-asm.js';
import { disasmI8086 } from '../src/i8086-disasm.js';

const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join(' ');

/** Assemble one instruction and read it back through the vector-ground
 *  disassembler. Agreement is a check against hardware at one remove. */
function roundTrip(source) {
    const bytes = assembleRaw(source);
    const mem = new Uint8Array(1 << 20);
    mem.set(bytes, 0x100);
    const d = disasmI8086((a) => mem[a & 0xfffff], 0x100, { ip: 0x100 });
    return { bytes, hex: hex(bytes), text: d.text, len: d.bytes.length };
}

// ---- supported, and correct: proved rather than assumed --------------------

test('CS: override — the segment prefix is emitted and reads back', () => {
    // 2Eh is the CS prefix. The corpus writes ES: (2.5%) and SS: (0.4%) and
    // never CS:, which matters because CS: is the override the missing-ASSUME
    // rule has to generate for a variable living in the code segment.
    const r = roundTrip('mov al, cs:[100h]');
    assert.equal(r.hex, '2e a0 00 01');
    assert.equal(r.text, 'mov al, byte [cs:100h]');

    const w = roundTrip('mov cs:[101h], al');
    assert.equal(w.hex, '2e a2 01 01');
    assert.equal(w.text, 'mov byte [cs:101h], al');
});

test('a variable in .CODE gets a CS override; one in .DATA does not', () => {
    // THE CASE THE CORPUS CANNOT SEE, and the reason its 470 agreements were
    // silent on it: a `.model small` program keeps its variables in .data and
    // points DS at @data, so no override is ever needed. Only 1.0% of the
    // corpus puts data in the code segment at all.
    const { bytes } = assemble(`.model small
.data
dvar dw 1111h
.code
start:
 mov ax,@data
 mov ds,ax
 mov ax, dvar
 mov bx, cvar
 mov ax,4c00h
 int 21h
cvar dw 2222h
end start
`, { name: 'assume-probe' });
    const h = hex(bytes);
    // dvar is reached through DS, so a bare A1 (mov ax, moffs16).
    assert.ok(h.includes('a1 00 00'),
        `expected an un-prefixed DS-relative load for the .DATA variable, got: ${h}`);
    // cvar lives in the code segment, so it MUST carry the 2Eh CS prefix or
    // the program reads whatever happens to sit at that offset in @data.
    assert.ok(/2e 8b 1e/.test(h),
        `expected a CS-prefixed load (2E 8B 1E) for the .CODE variable, got: ${h}`);
});

test('far CALL and far JMP encode as 9Ah and EAh, offset then segment', () => {
    const c = roundTrip('call 1234h:5678h');
    assert.equal(c.hex, '9a 78 56 34 12', 'offset precedes segment, both little-endian');
    assert.equal(c.text, 'callf 1234h:5678h');

    const j = roundTrip('jmp 0F000h:0FFF0h');
    assert.equal(j.hex, 'ea f0 ff 00 f0');
    assert.equal(j.text, 'jmpf F000h:FFF0h');
});

test('DUP nests, and the inner count multiplies rather than replaces', () => {
    assert.equal(hex(assembleRaw('db 3 dup (2 dup (0FFh))')), 'ff ff ff ff ff ff',
        '3 x 2 = six bytes, not three and not two');
    assert.equal(hex(assembleRaw('dw 2 dup (3 dup (1234h))')),
        '34 12 34 12 34 12 34 12 34 12 34 12', '2 x 3 = six words');
});

// ---- refused, and the refusal is the contract -----------------------------

test('PUBLIC and EXTRN are refused BY NAME, not by falling through', () => {
    // A stated non-goal: this assembler has no linker, so a symbol it cannot
    // resolve must be a refusal rather than a zero. The message names the
    // directive and points at the list, which is the difference between a
    // non-goal and a bug.
    for (const src of ['.model small\n.code\npublic start\nstart:\n int 20h\nend start\n',
        '.model small\n.code\nextrn helper:near\nstart:\n call helper\nend start\n']) {
        assert.throws(() => assemble(src, { name: 'x' }),
            /not supported|NOT SUPPORTED/,
            'PUBLIC/EXTRN must be refused with a message naming the directive');
    }
});

test('STRUC and RECORD are refused rather than silently mis-assembled', () => {
    // These are refused today, which is correct — but the message is the
    // generic "not an instruction, directive or macro this assembler knows"
    // rather than the named non-goal PUBLIC gets. Pinned as it stands so that
    // a change is deliberate: silently ACCEPTING either would be the bad
    // outcome, and this test is what would catch it.
    const struc = '.model small\n.data\npt struc\n x dw 0\npt ends\n.code\nstart:\n int 20h\nend start\n';
    const record = '.model small\n.data\nfl record a:1, b:3\n.code\nstart:\n int 20h\nend start\n';
    assert.throws(() => assemble(struc, { name: 'x' }), /not an instruction|not supported/i);
    assert.throws(() => assemble(record, { name: 'x' }), /not an instruction|not supported/i);
});

// ---- a defect this file found, pinned until it is fixed -------------------

test('`=` is redefinable and EQU is not, which is why MASM has both', () => {
    // WAS A KNOWN DEFECT, FIXED BY THE TRIGGER THIS TEST USED TO BE. `EQU`
    // and `=` differ in exactly one way: a numeric EQU may not be redefined
    // and `=` may. One switch arm, `case 'equ': case '=':`, served both, so
    // `=` inherited EQU's rule and the four lines below were REFUSED as
    // "defined twice" instead of assembled.
    //
    // The corpus uses `=` in ZERO of 525 files, which is why 470
    // byte-identical agreements with NASM and a MASM oracle over 414 files
    // said nothing about it, and why the check belongs here rather than in
    // a corpus re-run.
    //
    // THE VALUE IS POSITIONAL, which is the part worth asserting rather
    // than merely "it does not throw": each read takes the assignment above
    // it, not the last one in the file. AX gets 5 and BX gets 7 — a fix that
    // made `=` redefinable but resolved every read to the final value would
    // produce `b8 07 00 bb 07 00` and pass a test that only checked for the
    // absence of a refusal.
    assert.equal(hex(assembleRaw('K = 5\n mov ax, K\nK = 7\n mov bx, K')),
        'b8 05 00 bb 07 00', 'each read takes the value in force at its own line');

    // Asserted so the fix cannot overshoot: a numeric EQU must STAY
    // non-redefinable. MASM refuses this too.
    assert.throws(() => assembleRaw('K equ 5\n mov ax, K\nK equ 7\n mov bx, K'),
        /defined twice/, 'a numeric EQU must remain non-redefinable');

    // AND MIXING THE TWO IS STILL A DUPLICATE, in both directions. `=` may
    // reassign a `=`; it may not quietly overwrite a constant, and a
    // constant may not overwrite a variable. MASM calls that a symbol type
    // conflict, and the failure mode of allowing it is a real mistake
    // becoming a silent reassignment.
    assert.throws(() => assembleRaw('K equ 5\nK = 7'), /defined twice/,
        '`=` may not overwrite an EQU');
    assert.throws(() => assembleRaw('K = 5\nK equ 7'), /defined twice/,
        'EQU may not overwrite a `=`');

    // And the single-use case still works, so nothing was traded for the fix.
    assert.equal(hex(assembleRaw('K = 5\n mov ax, K')), 'b8 05 00');

    // Three assignments, to show the mechanism is the pass loop re-running
    // the definitions in order and not a special case for exactly two.
    assert.equal(hex(assembleRaw('N = 1\n mov al, N\nN = 2\n mov al, N\nN = 3\n mov al, N')),
        'b0 01 b0 02 b0 03');
});

// ---- the NEAR-zero constructs: 1 to 4 files out of 525 --------------------
//
// A construct exercised by two files is barely better evidence than one
// exercised by none — the corpus rule is about coverage, not about a
// threshold at exactly zero. These carry 0.2%-3.2% and are asserted here for
// the same reason as the sevens above.

test('all four segment override prefixes encode correctly', () => {
    // CS is 0% of the corpus, SS 0.4%, ES 2.5%, and an explicit DS is rare
    // enough not to register. Getting one of these wrong points a load at the
    // wrong 64K and is invisible in a program that never overrides.
    assert.equal(roundTrip('mov ax, es:[bx]').hex, '26 8b 07', 'ES prefix is 26h');
    assert.equal(roundTrip('mov ax, cs:[bx]').hex, '2e 8b 07', 'CS prefix is 2Eh');
    assert.equal(roundTrip('mov ax, ss:[bx]').hex, '36 8b 07', 'SS prefix is 36h');
    assert.equal(roundTrip('mov ax, ds:[bx]').hex, '3e 8b 07', 'DS prefix is 3Eh');
    // And each reads back naming the segment it actually encoded.
    for (const [seg, pfx] of [['es', '26'], ['cs', '2e'], ['ss', '36'], ['ds', '3e']]) {
        const r = roundTrip(`mov ax, ${seg}:[bx]`);
        assert.ok(r.text.includes(`${seg}:`), `${pfx} should disassemble naming ${seg}:`);
    }
});

test('REPT repeats its body, and IF/ELSE assembles exactly one branch', () => {
    // REPT is in 0.4% of the corpus and IF/ELSE in 0.4% — two files each.
    assert.equal(hex(assembleRaw('rept 3\n nop\nendm\n')), '90 90 90');
    // The taken branch and ONLY the taken branch: a conditional that emitted
    // both would still "work" for any program whose else-branch is harmless.
    assert.equal(hex(assembleRaw('X equ 1\nif X\n nop\nelse\n hlt\nendif\n')), '90');
    assert.equal(hex(assembleRaw('X equ 0\nif X\n nop\nelse\n hlt\nendif\n')), 'f4');
});

test('GROUP and .FARDATA are refused, and .FARDATA is refused by name', () => {
    // .FARDATA is wanted by exactly ONE corpus file, which is the reason the
    // ROADMAP lists it among the honest refusals rather than as a gap.
    assert.throws(() => assemble('.model small\n.fardata\nv dw 1\n.code\ns:\n int 20h\nend s\n',
        { name: 'x' }), /not supported/, '.FARDATA must be refused by name');
    // GROUP falls through to the generic message, like STRUC and RECORD.
    // Pinned so that silently accepting it — and quietly getting segment
    // arithmetic wrong — would be caught.
    assert.throws(() => assemble('.model small\ndgroup group _data\n_data segment\nv dw 1\n'
        + '_data ends\n.code\ns:\n int 20h\nend s\n', { name: 'x' }),
    /not an instruction|not supported/i);
});
