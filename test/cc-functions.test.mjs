// Deepened native C: user-defined functions with parameters and a return value,
// via a real BP-frame calling convention (params [BP+4+2k], locals [BP-2-2k],
// cdecl args right-to-left, result in AX) — recursion included. Runs on the x86.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cToAsm } from '../scripts/cc.mjs';
import { assemble } from '../src/i8086-asm.js';
import { runImage } from '../scripts/run-dos.mjs';

function run(src, flavor = '80286') {
    const bytes = assemble(cToAsm(src), { format: 'com' }).bytes;
    let out = '';
    const r = runImage(bytes, 'com', { variant: flavor, preset: 'at', max: 80_000_000 }, { write: (s) => { out += s; } });
    assert.ok(r.result.terminated, `terminated (${flavor})`);
    return { out, code: r.result.exitCode };
}

test('a function with parameters and a return value', () => {
    assert.equal(run('int add(int a,int b){return a+b;} int main(){printf("%d\\n",add(3,4));return 0;}').out, '7\r\n');
    assert.equal(run('int sq(int x){return x*x;} int main(){printf("%d\\n",sq(5)+sq(2));return 0;}').out, '29\r\n');
});

test('recursion works (its own frame per call)', () => {
    assert.equal(run('int fact(int n){if(n<=1)return 1;return n*fact(n-1);} int main(){printf("%d\\n",fact(6));return 0;}').out, '720\r\n');
    assert.equal(run('int fib(int n){if(n<2)return n;return fib(n-1)+fib(n-2);} int main(){printf("%d\\n",fib(10));return 0;}').out, '55\r\n');
});

test('void functions, multiple calls, and locals inside a function', () => {
    assert.equal(run('void hi(){puts("hi");} int main(){hi();hi();return 0;}').out, 'hi\r\nhi\r\n');
    assert.equal(run('int inc(int x){int y; y=x+1; return y;} int main(){int i,s=0;for(i=0;i<5;i++)s=inc(s);printf("%d\\n",s);return 0;}').out, '5\r\n');
});

test('a function return flows out as main\'s exit code', () => {
    assert.equal(run('int pick(){return 9;} int main(){return pick();}').code, 9);
});

test('functions run on 8086 and 80186 too', () => {
    for (const flavor of ['8086', '80186']) {
        assert.equal(run('int dbl(int x){return x+x;} int main(){printf("%d\\n",dbl(21));return 0;}', flavor).out, '42\r\n');
    }
});

test('a call to a function that is never defined is refused', () => {
    assert.throws(() => cToAsm('int main(){ nope(1); return 0; }'), /undefined function 'nope'/);
});
