// Deepened BASIC: GOSUB/RETURN, integer arrays (DIM + element read/write), and
// DEF FN (inline-expanded). Compiles through the built-in assembler and runs on
// the 8086/80186/80286 like the rest of the native BASIC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { basicToAsm } from '../src/basic-to-asm.js';
import { assemble } from '../src/i8086-asm.js';
import { runImage } from '../scripts/run-dos.mjs';

function run(src, flavor = '80286') {
    const bytes = assemble(basicToAsm(src), { format: 'com' }).bytes;
    let out = '';
    const r = runImage(bytes, 'com', { variant: flavor, preset: 'at', max: 40_000_000 }, { write: (s) => { out += s; } });
    assert.ok(r.result.terminated && r.result.exitCode === 0, `ran cleanly (${flavor})`);
    return out;
}

test('GOSUB/RETURN calls a subroutine and returns', () => {
    assert.equal(run('10 GOSUB 100\n20 GOSUB 100\n30 END\n100 PRINT "hi"\n110 RETURN\n'), 'hi\r\nhi\r\n');
});

test('integer arrays: DIM, element write and read, sum in a loop', () => {
    assert.equal(run('10 DIM A(5)\n20 FOR I=0 TO 4\n30 A(I)=I*I\n40 NEXT\n50 S=0\n60 FOR I=0 TO 4\n70 S=S+A(I)\n80 NEXT\n90 PRINT S\n'), '30\r\n');
    // array element inside an expression and an IF
    assert.equal(run('10 DIM B(3)\n20 B(1)=7\n30 B(2)=B(1)*2\n40 IF B(2)>10 THEN 60\n50 PRINT 0\n60 PRINT B(2)\n'), '14\r\n');
});

test('DEF FN defines a one-argument integer function (inline)', () => {
    assert.equal(run('10 DEF FNSQ(X) = X*X\n20 PRINT FNSQ(6)\n30 PRINT FNSQ(2)+FNSQ(3)\n'), '36\r\n13\r\n');
    assert.equal(run('10 DEF FND(N) = N*2+1\n20 FOR I=1 TO 3\n30 PRINT FND(I)\n40 NEXT\n'), '3\r\n5\r\n7\r\n');
});

test('the new features run on 8086 and 80186 too', () => {
    for (const f of ['8086', '80186']) {
        assert.equal(run('10 DIM A(3)\n20 A(2)=9\n30 GOSUB 100\n40 END\n100 PRINT A(2)\n110 RETURN\n', f), '9\r\n');
    }
});

test('using an array before DIM is a clear error', () => {
    assert.throws(() => basicToAsm('10 A(1)=5\n'), /used before DIM/);
});
