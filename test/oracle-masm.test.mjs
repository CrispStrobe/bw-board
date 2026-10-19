/**
 * The MASM 1.10 differential oracle, end to end.
 *
 * Every test here needs Microsoft's own 1982 binaries -- MASM.EXE, LINK.EXE
 * and EXE2BIN.EXE from the MIT-licensed microsoft/MS-DOS release -- which are
 * not vendored in this repository. When they are absent the file SKIPS AND
 * SAYS SO: a silent skip reads exactly like a pass in a summary line, and
 * this is the one test file whose absence is most likely to go unnoticed.
 *
 * What is asserted is deliberately narrow. That MASM and we agree on a
 * particular byte is interesting but volatile; what must not regress is that
 * the ORACLE ITSELF still works -- that the 1982 toolchain still runs inside
 * our emulator without asking for a DOS service we do not have, that the
 * three PSP fields it needs are still written, and that the classifier still
 * separates an encoding choice from a computed value.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    findTools, masmBuild, runImage, shimSimplified, classifyCode, decodeAll,
    parseListing, imageFromListing, omfSegments, DEFAULT_MSDOS_DIR,
} from '../scripts/oracle-masm.mjs';
import { assemble } from '../src/i8086-asm.js';

const tools = findTools(process.env.MSDOS_BIN_DIR || DEFAULT_MSDOS_DIR);
const skip = tools.ok ? false
    : `SKIPPED: the MS-DOS 2.0 toolchain is not in ${tools.dir} (missing ${tools.missing.join(', ')}). `
    + 'Fetch MASM.EXE, LINK.EXE and EXE2BIN.EXE from '
    + 'https://raw.githubusercontent.com/microsoft/MS-DOS/main/v2.0/bin/ to run these.';

if (skip) console.log(skip);

/** A whole 1982-dialect .COM program around one body. */
const wrap = (body) => [
    'CODE    SEGMENT',
    '        ASSUME CS:CODE,DS:CODE,ES:CODE,SS:CODE',
    '        ORG 100H',
    'START:',
    ...body,
    '        INT 20H',
    'CODE    ENDS',
    '        END START',
].join('\n') + '\n';

test('MASM 1.10 itself runs under Tier B and wants no service we lack', { skip }, () => {
    const r = masmBuild(wrap(['        MOV AX, BX']), tools.paths);
    assert.equal(r.severe, 0, 'MASM reported no severe errors');
    // THE POINT OF THE WHOLE EXERCISE: a 1982 assembler executing on our
    // 8086 core, over our DOS services, asking for nothing we cannot give.
    assert.deepEqual(r.unsupported, [], 'no unsupported DOS service');
    assert.ok(r.out.includes('Microsoft MACRO Assembler'), 'it identified itself');
    assert.ok(r.ok && r.com, 'MASM, LINK and EXE2BIN all completed');
});

test('the three tools chain into a .COM byte-identical to ours', { skip }, () => {
    const source = wrap([
        '        MOV DX, OFFSET MSG',
        '        MOV AH, 9',
        '        INT 21H',
        '        INT 20H',
        // The data goes AFTER the exit, or execution runs straight into it
        // and "hello" prints as many times as the string happens to loop.
        'MSG     DB "hello$"',
    ]);
    const masm = masmBuild(source, tools.paths);
    assert.ok(masm.com, 'EXE2BIN produced a .COM');
    const ours = assemble(source, { format: 'com' });
    assert.deepEqual([...masm.com], [...ours.bytes],
        'MASM 1.10 and i8086-asm.js emitted the same image');
});

test('both images run to the same output, which is the behavioural half', { skip }, () => {
    const source = wrap([
        '        MOV DX, OFFSET MSG',
        '        MOV AH, 9',
        '        INT 21H',
        '        INT 20H',
        // The data goes AFTER the exit, or execution runs straight into it
        // and "hello" prints as many times as the string happens to loop.
        'MSG     DB "hello$"',
    ]);
    const masm = masmBuild(source, tools.paths);
    const ours = assemble(source, { format: 'com' });
    const a = runImage(masm.com, 'com', { keys: '' });
    const b = runImage(ours.bytes, 'com', { keys: '' });
    assert.equal(a.out, 'hello');
    assert.equal(a.out, b.out);
    assert.ok(a.terminated && b.terminated);
});

test('MASM refuses the forms i8086-asm.js documents as extensions', { skip }, () => {
    // Each of these is a judgement call recorded in i8086-asm.js's header.
    // The oracle's job is not to say we are wrong to accept them -- it is to
    // establish, as fact rather than belief, that MASM does not.
    const cases = [
        [['MSG     DW "Enter a number: ",0'], /Syntax error/],
        [['        MOV [SI], 5'], /Operand must have size/],
        [['        LEA DX, SI'], /Illegal use of register/],
        [['        SHL AX, 4'], /Improper operand type/],
    ];
    for (const [body, expected] of cases) {
        const r = masmBuild(wrap(body), tools.paths);
        assert.equal(r.ok, false, `MASM should refuse ${body.join(' ')}`);
        assert.match(r.errors.join(' | '), expected);
    }
});

test('a sizeless MOV against an immediate: MASM refuses, but recovers as a BYTE', { skip }, () => {
    // This is the case i8086-asm.js settles by argument -- "every dialect
    // that accepts it makes it a byte". MASM will not accept it, but the
    // encoding it lays down while complaining is C6 (mov r/m8, imm8), which
    // is the same reading, and that is worth pinning down.
    const r = masmBuild(wrap(['        MOV [SI-1], 0DH']), tools.paths);
    assert.equal(r.ok, false);
    const image = imageFromListing(r.lst);
    assert.deepEqual([...image.subarray(0, 4)], [0xc6, 0x44, 0xff, 0x0d]);
    const ours = assemble(wrap(['        MOV [SI-1], 0DH']), { format: 'com' });
    assert.deepEqual([...ours.bytes.subarray(0, 4)], [0xc6, 0x44, 0xff, 0x0d]);
});

test('MASM synthesises a CS override from ASSUME, exactly as autoOverride does', { skip }, () => {
    const source = [
        'DATA    SEGMENT', 'V1      DW 1', 'DATA    ENDS',
        'CODE    SEGMENT', '        ASSUME CS:CODE,DS:DATA', '        ORG 100H',
        'CVAR    DW 5', 'START:  MOV AX, CVAR', '        INT 20H',
        'CODE    ENDS', '        END START',
    ].join('\n') + '\n';
    const r = masmBuild(source, tools.paths);
    assert.equal(r.severe, 0);
    const rows = parseListing(r.lst).filter((x) => /MOV AX, CVAR/.test(x.text));
    assert.equal(rows.length, 1);
    // 2E is the CS prefix. MASM put it there because DS is assumed to DATA
    // and CVAR lives in CODE -- the case i8086-asm.js's autoOverride exists
    // for, and this is the measurement that says it was right to.
    assert.equal(rows[0].bytes[0], 0x2e, 'MASM emitted the CS override itself');
});

test('a PARTIAL ASSUME: MASM overrides from whichever register has it', { skip }, () => {
    // THE MEASUREMENT THAT CHANGED THE RULE. i8086-asm.js used to hold that
    // a MISSING assume synthesises nothing -- "not knowing what a register
    // holds is not the same as knowing it is wrong" -- and this asks MASM
    // whether that is how MASM reasons. It is not: with DS unassumed and
    // only CS:CODE named, MASM reaches for CS.
    const source = [
        'CODE    SEGMENT', '        ASSUME CS:CODE', '        ORG 100H',
        'CVAR    DW 5', 'START:  MOV AX, CVAR', '        INT 20H',
        'CODE    ENDS', '        END START',
    ].join('\n') + '\n';
    const r = masmBuild(source, tools.paths);
    assert.equal(r.severe, 0);
    const rows = parseListing(r.lst).filter((x) => /MOV AX, CVAR/.test(x.text));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].bytes[0], 0x2e, 'MASM emitted a CS override with DS unassumed');
    // EXE2BIN will not make a .COM of this one -- it has no ASSUME DS -- so
    // the comparison is against the LISTING, which is where the encoding
    // actually is.
    const ours = assemble(source, { format: 'com' });
    assert.deepEqual([...ours.bytes.subarray(2, 2 + rows[0].bytes.length)], [...rows[0].bytes],
        'and so do we, byte for byte');
});

test('a segment NO assume reaches: MASM refuses it, error 68', { skip }, () => {
    // The other half, and the other thing i8086-asm.js used to get wrong: it
    // emitted the instruction with a warning. MASM will not emit it at all,
    // and the number 68 is worth pinning because the message is the only
    // thing that says this is a REACHABILITY refusal rather than a syntax
    // one.
    const source = [
        'DATA    SEGMENT', 'V1      DW 1', 'DATA    ENDS',
        'OTHER   SEGMENT', 'W1      DW 2', 'OTHER   ENDS',
        'CODE    SEGMENT', '        ASSUME CS:CODE,DS:DATA',
        'START:  MOV AX, W1', '        INT 20H',
        'CODE    ENDS', '        END START',
    ].join('\n') + '\n';
    const r = masmBuild(source, tools.paths);
    assert.equal(r.ok, false, 'MASM refuses it');
    assert.match(r.errors.join(' | '), /Can't reach with segment reg/);
    let ours = null;
    try { assemble(source); } catch (e) { ours = e; }
    assert.ok(ours, 'and so do we');
    assert.equal(ours.what, 'unreachable segment');
});

test('MASM has no opinion on a source with no ASSUME at all -- it refuses the module', { skip }, () => {
    // WHERE THE ORACLE'S AUTHORITY STOPS, and why i8086-asm.js does not
    // follow it here. Error 62 is not about the operand: MASM raises it for
    // `MOV AX, BX`, with no memory reference anywhere, purely because no
    // ASSUME CS: was written. Following that would refuse the entire bare
    // SEGMENT dialect two coursework programs are written in, which is a
    // much larger change than the reachability rule -- so the no-ASSUME
    // case stays as it was, and this test is what stops that being a
    // silent assumption.
    const bare = ['CODE SEGMENT', 'START:  MOV AX, BX', '        INT 20H',
        'CODE ENDS', '        END START'].join('\n') + '\n';
    const r = masmBuild(bare, tools.paths);
    assert.equal(r.ok, false, 'MASM refuses even this');
    assert.match(r.errors.join(' | '), /No or unreachable CS/);
    // And we assemble it, deliberately.
    const ours = assemble(bare);
    assert.ok(ours.bytes.length > 0);
});

test('the simplified-directive shim reaches a .MODEL SMALL program', { skip }, () => {
    const source = [
        '.MODEL SMALL', '.STACK 100H', '.DATA',
        'MSG     DB "shim$"', '.CODE',
        'MAIN    PROC', '        MOV AX, @DATA', '        MOV DS, AX',
        '        LEA DX, MSG', '        MOV AH, 9', '        INT 21H',
        '        MOV AX, 4C00H', '        INT 21H', 'MAIN    ENDP', '        END MAIN',
    ].join('\n') + '\n';
    const sh = shimSimplified(source);
    assert.ok(sh.shimmed, 'the shim reports that it changed the source');
    assert.ok(!/\.MODEL|@DATA/i.test(sh.source), 'no MASM 5 directive survives');
    const masm = masmBuild(sh.source, tools.paths);
    assert.equal(masm.severe, 0, 'MASM 1.10 accepted the shimmed source');
    const ours = assemble(source);
    // Behaviour, which is the level the shim cannot distort.
    assert.equal(runImage(masm.exe, 'exe', { keys: '' }).out, 'shim');
    assert.equal(runImage(ours.bytes, ours.format, { keys: '' }).out, 'shim');
});

test('the classifier separates an encoding choice from a computed value', { skip }, () => {
    // 33 C0 and 31 C0 are both `xor ax, ax`; EB 02 90 and EB 01 both jump to
    // the next instruction. Neither is a bug, and a classifier that called
    // them one would bury the case that is.
    const equivalent = classifyCode(
        Uint8Array.from([0x33, 0xc0, 0x90, 0x40, 0xc3]),
        Uint8Array.from([0x31, 0xc0, 0x40, 0xc3]));
    assert.equal(equivalent.histogram['equiv-encoding'], 1);
    assert.equal(equivalent.histogram['nop-pad'], 1);
    assert.ok(!equivalent.histogram['operand-value'], 'and nothing was called a value difference');

    // A different immediate IS a value difference, and must be named one.
    const real = classifyCode(
        Uint8Array.from([0xb8, 0x05, 0x00, 0xc3]),
        Uint8Array.from([0xb8, 0x06, 0x00, 0xc3]));
    assert.equal(real.histogram['operand-value'], 1);
    assert.equal(real.events[0].masmText, 'mov ax, 5h');
    assert.equal(real.events[0].ourText, 'mov ax, 6h');
});

test('decodeAll and the listing parser agree about where instructions are', { skip }, () => {
    const source = wrap(['        MOV AX, 1', '        ADD AX, 2', '        NOP']);
    const r = masmBuild(source, tools.paths);
    assert.ok(r.com);
    const decoded = decodeAll(r.com);
    assert.deepEqual(decoded.map((d) => d.text),
        ['mov ax, 1h', 'add ax, 2h', 'nop', 'int 20h']);
    // The listing's own offsets, biased by the ORG, must land on the same
    // instruction boundaries -- that equivalence is what lets a byte offset
    // be reported as a source line.
    const rows = parseListing(r.lst).filter((x) => x.bytes.length);
    assert.deepEqual(rows.map((x) => x.off - 0x100), decoded.map((d) => d.off));
});

test('the OBJ names the segments MASM built', { skip }, () => {
    const source = ['.MODEL SMALL', '.STACK 100H', '.DATA', 'V DW 1', '.CODE',
        'MAIN PROC', 'MOV AX,@DATA', 'MOV AX,4C00H', 'INT 21H', 'MAIN ENDP', 'END MAIN'].join('\n') + '\n';
    const r = masmBuild(shimSimplified(source).source, tools.paths);
    const segs = omfSegments(r.obj);
    assert.deepEqual(segs.map((s) => s.cls).sort(), ['CODE', 'DATA', 'STACK']);
});

test('a program with no MS-DOS toolchain reports the skip rather than passing', () => {
    // This one always runs. It is the guard on the guard: if findTools ever
    // starts claiming success for a directory with nothing in it, every test
    // above would silently stop testing anything.
    const missing = findTools('/nonexistent-directory-for-this-test');
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.missing.sort(),
        ['v2.0_bin_EXE2BIN.EXE', 'v2.0_bin_LINK.EXE', 'v2.0_bin_MASM.EXE']);
});
