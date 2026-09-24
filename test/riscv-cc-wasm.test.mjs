// End-to-end: C source -> the in-browser shecc compiler (wasm/riscv-cc.wasm,
// run through this module's own WASI shim) -> a loadable RV32 image -> the
// RiscV32Machine, whose ecall ABI prints the program's output. No native
// toolchain and no server: the whole C -> RISC-V path runs in this process, the
// same way it runs in a browser tab. This is the C companion to
// riscv-asm.test.mjs (assembly) and riscv32-elf.test.mjs (a clang object).

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileRiscvC, RiscvCcError} from '../src/riscv-cc-wasm.js';
import {RiscV32Machine} from '../src/riscv32-machine.js';

// Boot an image the way a bare machine does: place the segments, give _start a
// valid stack with argc=0 (shecc's Linux _start reads argc/argv off sp), run.
function boot(image) {
    const memSize = 1 << 22;                                  // 4 MiB
    const m = new RiscV32Machine({memSize, resetPc: image.entry});
    for (const {addr, bytes} of image.segments) m.load(bytes, addr);
    const sp = (memSize - 4096) >>> 0;
    m.cpu.x[2] = sp | 0;                                      // sp
    for (let i = 0; i < 32; i++) m.mem[sp + i] = 0;           // argc/argv = 0
    m.run(20_000_000);
    return m;
}

test('compiles C to a bootable RV32 image (functions, recursion, arrays, printf)', async () => {
    const {ok, image} = await compileRiscvC(`
        int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
        int main() {
            printf("%s\\n", "hello from riscv-cc.wasm");
            for (int i = 0; i < 8; i++) printf("fib(%d)=%d\\n", i, fib(i));
            int a[4]; int s = 0;
            for (int i = 0; i < 4; i++) { a[i] = i * i; s += a[i]; }
            printf("sumsq=%d\\n", s);
            return 0;
        }`);
    assert.equal(ok, true);
    assert.equal(typeof image.entry, 'number');
    assert.ok(image.segments.length >= 1, 'has at least one PT_LOAD segment');

    const m = boot(image);
    assert.ok(m.halted, 'the program halted (exit)');
    assert.equal(m.exitCode, 0, 'exited cleanly');
    assert.match(m.output, /hello from riscv-cc\.wasm/);
    assert.match(m.output, /fib\(7\)=13/, 'recursion computed correctly');
    assert.match(m.output, /sumsq=14/, 'array + loop computed correctly (0+1+4+9)');
});

test("main's return value reaches the machine exit code", async () => {
    const {image} = await compileRiscvC('int main() { return 42; }');
    const m = boot(image);
    assert.ok(m.halted);
    assert.equal(m.exitCode, 42, 'the C return value is the exit code');
});

test('a compile error is the program\'s, with the compiler\'s diagnostics', async () => {
    await assert.rejects(
        () => compileRiscvC('int main() { this is not valid C ; }'),
        (e) => {
            assert.ok(e instanceof RiscvCcError);
            assert.equal(e.reason, 'compile', 'reason names the program, not the tool');
            assert.match(e.log, /in\.c:\d+/, 'the diagnostic points at a line');
            return true;
        });
});

test('empty source is refused, not compiled to nothing', async () => {
    await assert.rejects(
        () => compileRiscvC('   \n  '),
        (e) => e instanceof RiscvCcError && e.reason === 'compile');
});

test('the same source compiles deterministically to the same image', async () => {
    const src = 'int main() { int s = 0; for (int i = 1; i <= 100; i++) s += i; return s % 256; }';
    const a = await compileRiscvC(src);
    const b = await compileRiscvC(src);
    assert.equal(a.image.entry, b.image.entry);
    assert.equal(a.image.segments.length, b.image.segments.length);
    for (let i = 0; i < a.image.segments.length; i++) {
        assert.equal(a.image.segments[i].addr, b.image.segments[i].addr);
        assert.deepEqual(a.image.segments[i].bytes, b.image.segments[i].bytes,
            'a pure compiler gives byte-identical output for identical input');
    }
    assert.equal(boot(a.image).exitCode, 5050 % 256, 'sum(1..100) = 5050');
});
