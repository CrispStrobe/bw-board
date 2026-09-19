// Native BASIC: a .BAS transpiles to asm and runs on any x86 flavor through the
// built-in assembler — BASIC on the 8086/80186/80286 with no interpreter binary.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runToolchain, listToolchains } from '../scripts/toolchains.mjs';
import { basicToAsm } from '../scripts/basic.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'bas-'));
function runBas(src, flavor) {
    const p = join(DIR, 'p.bas');
    writeFileSync(p, src);
    let out = '';
    const r = runToolchain('basic-native', p, { flavor }, { write: (s) => { out += s; } });
    return { out, r };
}

test('BASIC runs on 8086, 80186, and 80286 (native toolchain)', () => {
    for (const flavor of ['8086', '80186', '80286-at']) {
        const { out, r } = runBas('10 PRINT "HI"\n20 END\n', flavor);
        assert.ok(r.ran && r.ran.terminated && r.ran.exitCode === 0, `ran cleanly on ${flavor}`);
        assert.equal(out, 'HI\r\n', `printed on ${flavor}`);
    }
});

test('PRINT of a constant integer expression is folded (precedence honored)', () => {
    assert.equal(runBas('PRINT 2+3*4\n', '80286-at').out, '14\r\n');
    assert.equal(runBas('PRINT (2+3)*4\n', '80286-at').out, '20\r\n');
});

test('a trailing ; suppresses the newline', () => {
    assert.equal(runBas('PRINT "A";\nPRINT "B"\n', '80286-at').out, 'AB\r\n');
});

test('REM, blank lines and line numbers are ignored', () => {
    const { out } = runBas("10 REM a comment\n15 ' also a comment\n20 PRINT \"X\"\n", '80286-at');
    assert.equal(out, 'X\r\n');
    assert.match(basicToAsm('20 PRINT "X"\n'), /DB 88,13,10,'\$'/);  // 'X' == 88
});

test('basic-native is offered for bas even with no external binary', () => {
    assert.ok(listToolchains('bas', { available: new Set() }).some((t) => t.id === 'basic-native'),
        'the built-in BASIC always lists');
});
