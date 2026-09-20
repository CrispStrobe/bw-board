// Deepened native C: pointers — int *p; the address-of operator &x (and &a[i]);
// and dereference *p for both read and write. Runs on the x86.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cToAsm } from '../scripts/cc.mjs';
import { assemble } from '../src/i8086-asm.js';
import { runImage } from '../scripts/run-dos.mjs';

function run(src, flavor = '80286') {
    const bytes = assemble(cToAsm(src), { format: 'com' }).bytes;
    let out = '';
    const r = runImage(bytes, 'com', { variant: flavor, preset: 'at', max: 40_000_000 }, { write: (s) => { out += s; } });
    assert.ok(r.result.terminated && r.result.exitCode === 0, `ran cleanly (${flavor})`);
    return out;
}

test('&x and *p: write through a pointer changes the pointee', () => {
    assert.equal(run('int main(){int x=5; int *p; p=&x; *p=42; printf("%d\\n",x); return 0;}'), '42\r\n');
});

test('int *p = &x and dereference read', () => {
    assert.equal(run('int main(){int x=7; int *p=&x; printf("%d\\n",*p); return 0;}'), '7\r\n');
});

test('&a[i]: a pointer to an array element', () => {
    assert.equal(run('int main(){int a[3]; int *p; p=&a[1]; *p=99; printf("%d\\n",a[1]); return 0;}'), '99\r\n');
});

test('deref on both sides: *p = *p + y', () => {
    assert.equal(run('int main(){int x=3,y=4; int *p; p=&x; *p=*p+y; printf("%d\\n",x); return 0;}'), '7\r\n');
    for (const flavor of ['8086', '80186']) {
        assert.equal(run('int main(){int v=1; int *q=&v; *q=*q+10; printf("%d\\n",v); return 0;}', flavor), '11\r\n');
    }
});

test('& needs a variable', () => {
    assert.throws(() => cToAsm('int main(){ int *p; p=&5; return 0; }'), /& needs a variable/);
});
