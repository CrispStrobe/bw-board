// Native C: a small integer .C (variables, expressions, control flow, printf
// with %d/%c) compiles to asm and runs on any x86 flavor through the built-in
// assembler — C on 8086/80186/80286 with no compiler binary. A real DOS C
// compiler covers full C (types, pointers, floats) when installed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runToolchain, listToolchains } from '../scripts/toolchains.mjs';
import { cToAsm } from '../scripts/cc.mjs';

const DIR = mkdtempSync(join(tmpdir(), 'cc-'));
function runC(src, flavor = '80286-at') {
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
    const { out, r } = runC('int main(void){ printf("A\\n"); puts("B"); return 7; }');
    assert.equal(out, 'A\r\nB\r\n', 'printf \\n and puts newline');
    assert.equal(r.ran.exitCode, 7, 'return 7 -> exit code 7');
});

test('variables and integer expressions (precedence, /, %)', () => {
    assert.equal(runC('int main(){ int x=6, y=7; printf("%d\\n", x*y); return 0; }').out, '42\r\n');
    assert.equal(runC('int main(){ printf("%d\\n", 2+3*4); return 0; }').out, '14\r\n');
    assert.equal(runC('int main(){ int a=10,b=3; printf("%d %d\\n", a/b, a%b); return 0; }').out, '3 1\r\n');
    assert.equal(runC('int main(){ printf("%d\\n", -5); return 0; }').out, '-5\r\n');
});

test('printf with %d/%c and multiple arguments', () => {
    assert.equal(runC('int main(){ printf("%d and %d\\n", 3+4, 10-2); return 0; }').out, '7 and 8\r\n');
    assert.equal(runC('int main(){ printf("%c%c\\n", 72, 105); return 0; }').out, 'Hi\r\n');
    assert.equal(runC('int main(){ printf("100%%\\n"); return 0; }').out, '100%\r\n');
});

test('control flow: if/else, while, for', () => {
    assert.equal(runC('int main(){ int a=5; if(a>3){ puts("big"); } else { puts("small"); } return 0; }').out, 'big\r\n');
    assert.equal(runC('int main(){ int a=2; if(a>3){ puts("big"); } else { puts("small"); } return 0; }').out, 'small\r\n');
    assert.equal(runC('int main(){ int i=0; while(i<3){ printf("%d\\n", i); i++; } return 0; }').out, '0\r\n1\r\n2\r\n');
    assert.equal(runC('int main(){ int s=0,i; for(i=1;i<=10;i++){ s+=i; } printf("%d\\n", s); return 0; }').out, '55\r\n');
});

test('a real little program: factorial via a while loop', () => {
    assert.equal(runC('int main(){ int n=5, f=1; while(n>1){ f*=n; n--; } printf("%d!=%d\\n", 5, f); return 0; }').out, '5!=120\r\n');
});

test('&& and || short-circuit in conditions', () => {
    assert.equal(runC('int main(){ int a=4; if(a>1 && a<10){ puts("mid"); } return 0; }').out, 'mid\r\n');
    assert.equal(runC('int main(){ int a=0; if(a==0 || a==5){ puts("hit"); } return 0; }').out, 'hit\r\n');
});

test('comments and #include are ignored; escapes handled', () => {
    const { out } = runC('#include <stdio.h>\n// hi\nint main(){ /* c */ printf("tab\\there"); return 0; }');
    assert.equal(out, 'tab\there');
});

test('the subset boundary is honest: unknown conversion / missing arg are refused', () => {
    // A float conversion is outside the integer subset.
    assert.throws(() => cToAsm('int main(){ printf("%f", 1); return 0; }'), /unsupported printf conversion/);
    // A conversion with no matching argument is refused.
    assert.throws(() => cToAsm('int main(){ printf("%d"); return 0; }'), /not enough arguments/);
    // A call to a function that is never defined is refused at compile time.
    assert.throws(() => cToAsm('int main(){ gets(x); return 0; }'), /undefined function/);
});

test('cc-native and the gated Turbo C are the C toolchains; native always lists', () => {
    assert.deepEqual(listToolchains('c', { available: new Set() }).map((t) => t.id), ['cc-native']);
    assert.deepEqual(listToolchains('c', { available: new Set(['TCC.EXE']) }).map((t) => t.id), ['cc-native', 'tcc']);
});
