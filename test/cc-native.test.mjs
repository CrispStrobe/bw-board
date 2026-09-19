// Native C: a minimal .C (printf/puts literals + return) transpiles to asm and
// runs on any x86 flavor through the built-in assembler — C on 8086/80186/80286
// with no compiler binary. A real DOS C compiler covers full C when installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runToolchain, listToolchains } from '../scripts/toolchains.mjs';
import { cToAsm } from '../scripts/cc.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'cc-'));
function runC(src, flavor) {
    const p = join(DIR, 'p.c');
    writeFileSync(p, src);
    let out = '';
    const r = runToolchain('cc-native', p, { flavor }, { write: (s) => { out += s; } });
    return { out, r };
}

test('C runs on 8086, 80186, and 80286 (native subset)', () => {
    for (const flavor of ['8086', '80186', '80286-at']) {
        const { out, r } = runC('#include <stdio.h>\nint main(void){ printf("HI\\n"); return 0; }', flavor);
        assert.ok(r.ran && r.ran.terminated && r.ran.exitCode === 0, `ran cleanly on ${flavor}`);
        assert.equal(out, 'HI\r\n', `printed on ${flavor} (\\n -> CRLF)`);
    }
});

test('printf and puts both emit; return sets the DOS exit code', () => {
    const { out, r } = runC('int main(void){ printf("A\\n"); puts("B"); return 7; }', '80286-at');
    assert.equal(out, 'A\r\nB\r\n', 'printf \\n and puts newline');
    assert.equal(r.ran.exitCode, 7, 'return 7 -> exit code 7');
});

test('comments and #include are ignored; escapes handled', () => {
    const { out } = runC('#include <stdio.h>\n// hi\nint main(){ /* c */ printf("tab\\there"); return 0; }', '80286-at');
    assert.equal(out, 'tab\there');
});

test('a printf with format arguments is refused (honest subset boundary)', () => {
    // With args, the strict printf("literal") match fails -> unsupported statement.
    assert.throws(() => cToAsm('int main(){ printf("%d", 5); return 0; }'), /unsupported statement/);
    // A bare %-format with no args is caught by the format-argument check.
    assert.throws(() => cToAsm('int main(){ printf("%d"); return 0; }'), /format arguments are not supported/);
});

test('cc-native and the gated Turbo C are the C toolchains; native always lists', () => {
    assert.deepEqual(listToolchains('c', { available: new Set() }).map((t) => t.id), ['cc-native']);
    assert.deepEqual(listToolchains('c', { available: new Set(['TCC.EXE']) }).map((t) => t.id), ['cc-native', 'tcc']);
});
