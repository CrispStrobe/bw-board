// Native BASIC: a .BAS transpiles to asm and runs on any x86 flavor through the
// built-in assembler — BASIC on the 8086/80186/80286 with no interpreter binary.
// A real (if compact) integer BASIC: variables, expressions, FOR/NEXT, IF/GOTO,
// PRINT of integers and strings, and INPUT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runToolchain, listToolchains } from '../scripts/toolchains.mjs';
import { basicToAsm } from '../scripts/basic.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'bas-'));
function runBas(src, flavor = '80286-at', keys = '') {
    const p = join(DIR, 'p.bas');
    writeFileSync(p, src);
    let out = '';
    const r = runToolchain('basic-native', p, { flavor, keys }, { write: (s) => { out += s; } });
    return { out, r };
}

test('BASIC runs on 8086, 80186, and 80286 (native toolchain)', () => {
    for (const flavor of ['8086', '80186', '80286-at']) {
        const { out, r } = runBas('10 PRINT "HI"\n20 END\n', flavor);
        assert.ok(r.ran && r.ran.terminated && r.ran.exitCode === 0, `ran cleanly on ${flavor}`);
        assert.equal(out, 'HI\r\n', `printed on ${flavor}`);
    }
});

test('integer expressions honor precedence and parens', () => {
    assert.equal(runBas('PRINT 2+3*4\n').out, '14\r\n');
    assert.equal(runBas('PRINT (2+3)*4\n').out, '20\r\n');
    assert.equal(runBas('PRINT 7-3\n').out, '4\r\n');
    assert.equal(runBas('PRINT 20/6\n').out, '3\r\n');      // integer division
    assert.equal(runBas('PRINT -5\n').out, '-5\r\n');       // signed print
});

test('variables: LET/assignment, use in expressions, PRINT', () => {
    assert.equal(runBas('10 A=7\n20 B=3\n30 PRINT A*B\n40 PRINT A-B\n').out, '21\r\n4\r\n');
    assert.equal(runBas('10 LET X = 10\n20 X = X + 5\n30 PRINT X\n').out, '15\r\n');
});

test('FOR/NEXT counts and STEP works; a loop can sum', () => {
    assert.equal(runBas('10 FOR I=1 TO 3\n20 PRINT I\n30 NEXT\n').out, '1\r\n2\r\n3\r\n');
    assert.equal(runBas('10 FOR I=1 TO 10\n20 S=S+I\n30 NEXT\n40 PRINT S\n').out, '55\r\n');
    assert.equal(runBas('10 FOR I=10 TO 1 STEP -3\n20 PRINT I\n30 NEXT\n').out, '10\r\n7\r\n4\r\n1\r\n');
});

test('IF/THEN jumps to a line; GOTO jumps', () => {
    // A=5 > 3 -> jump to 40, skipping the PRINT 99.
    assert.equal(runBas('10 A=5\n20 IF A>3 THEN 40\n30 PRINT 99\n40 PRINT A\n').out, '5\r\n');
    // A=2, not > 3 -> falls through, prints 99 then 2.
    assert.equal(runBas('10 A=2\n20 IF A>3 THEN 40\n30 PRINT 99\n40 PRINT A\n').out, '99\r\n2\r\n');
    // GOTO forms an early exit.
    assert.equal(runBas('10 PRINT 1\n20 GOTO 40\n30 PRINT 2\n40 PRINT 3\n').out, '1\r\n3\r\n');
});

test('a WHILE-style loop via IF+GOTO terminates and prints a series', () => {
    // print 1..4 using a manual counter loop
    assert.equal(runBas('10 N=1\n20 PRINT N\n30 N=N+1\n40 IF N<=4 THEN 20\n').out, '1\r\n2\r\n3\r\n4\r\n');
});

test('INPUT reads an integer (signed) from the keyboard', () => {
    assert.equal(runBas('10 INPUT A\n20 PRINT A*2\n', '80286-at', '21\r').out, '21\r\n42\r\n');
    assert.equal(runBas('10 INPUT A\n20 INPUT B\n30 PRINT A+B\n', '80286-at', '12\r30\r').out, '12\r\n30\r\n42\r\n');
    assert.equal(runBas('10 INPUT A\n20 PRINT A\n', '80286-at', '-45\r').out, '-45\r\n-45\r\n');  // echo, then PRINT
});

test('PRINT separators: ; concatenates, trailing ; suppresses newline', () => {
    assert.equal(runBas('PRINT "A";\nPRINT "B"\n').out, 'AB\r\n');
    assert.equal(runBas('PRINT "x="; 42\n').out, 'x=42\r\n');
});

test('REM, blank lines and line numbers are ignored', () => {
    const { out } = runBas("10 REM a comment\n15 ' also a comment\n20 PRINT \"X\"\n");
    assert.equal(out, 'X\r\n');
    // A string literal becomes a '$'-terminated DB; the CRLF is a runtime CALL.
    assert.match(basicToAsm('20 PRINT "X"\n'), /DB 88,'\$'/);  // 'X' == 88
    assert.match(basicToAsm('20 PRINT "X"\n'), /CALL CRLF/);
});

test('basic-native is offered for bas even with no external binary', () => {
    assert.ok(listToolchains('bas', { available: new Set() }).some((t) => t.id === 'basic-native'),
        'the built-in BASIC always lists');
});
