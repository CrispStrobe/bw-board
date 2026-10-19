// Deepened native C: integer arrays (int a[n]; a[i] read/write, index by any
// expression). Compiles through the built-in assembler and runs on the x86.
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

test('int arrays: declare, write in a loop, read and sum', () => {
    assert.equal(run('int main(){int a[5],i,s=0; for(i=0;i<5;i++) a[i]=i*i; for(i=0;i<5;i++) s+=a[i]; printf("%d\\n",s); return 0;}'), '30\r\n');
});

test('array elements in expressions; index by an expression', () => {
    assert.equal(run('int main(){int a[3]; a[0]=10; a[1]=20; a[2]=a[0]+a[1]; printf("%d\\n",a[2]); return 0;}'), '30\r\n');
    // Fibonacci via f[i-1]+f[i-2] — array reads with computed indices
    assert.equal(run('int main(){int f[10],i; f[0]=0; f[1]=1; for(i=2;i<10;i++) f[i]=f[i-1]+f[i-2]; printf("%d\\n",f[9]); return 0;}'), '34\r\n');
});

test('arrays run on 8086 and 80186 too', () => {
    for (const flavor of ['8086', '80186']) {
        assert.equal(run('int main(){int a[4]; a[3]=42; printf("%d\\n",a[3]); return 0;}', flavor), '42\r\n');
    }
});

test('an undeclared array and a non-literal size are refused', () => {
    assert.throws(() => cToAsm('int main(){ b[0]=1; return 0; }'), /used before declaration/);
    assert.throws(() => cToAsm('int main(){ int n; int a[n]; return 0; }'), /array size must be an integer literal/);
});
