// Growing the RV32 console machine: loadImage() gives a program a real OS-style
// boot (pc = entry, a stack near the top of RAM, argc/argv = 0), and the
// console adapter gives it room (8 MiB, not 1) so a learner's C program — heap,
// stack, a few arrays — is not cramped. Proven by compiling C with the shipped
// shecc.wasm and booting it exactly as the app does, through the adapter.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {createRiscV32Adapter} from '../src/riscv32-adapter.js';
import {compileRiscvC} from '../src/riscv-cc-wasm.js';

test('loadImage boots a program with pc = entry and a real stack (argc = 0)', () => {
    const m = new RiscV32Machine({memSize: 1 << 20});
    m.loadImage({entry: 0x1000, segments: [{addr: 0x1000, bytes: new Uint8Array([1, 2, 3, 4])}]});
    assert.equal(m.cpu.pc >>> 0, 0x1000, 'pc is the entry');
    const sp = m.cpu.x[2] >>> 0;
    assert.ok(sp >= m.ramBase + m.memSize - 64 && sp < m.ramBase + m.memSize,
        'sp sits just below the top of RAM');
    // argc/argv laid out where a Linux-style _start reads them (all zero)
    for (let i = 0; i < 16; i++) {
        assert.equal(m.mem[(sp + i - m.ramBase) & (m.memSize - 1)], 0, 'argc/argv area is zeroed');
    }
});

test('loadImage honours an explicit stack top', () => {
    const m = new RiscV32Machine({memSize: 1 << 20});
    m.loadImage({entry: 0x1000, segments: [{addr: 0x1000, bytes: new Uint8Array([0])}]}, 0x40000);
    assert.equal(m.cpu.x[2] >>> 0, 0x40000);
});

test('the console adapter gives a program 8 MiB by default (a caller can override)', () => {
    const big = createRiscV32Adapter({image: {entry: 0x1000, segments: [{addr: 0x1000, bytes: new Uint8Array([0])}]}});
    assert.equal(big.machine.memSize, 8 * 1024 * 1024, 'default is 8 MiB, not 1');
    const custom = createRiscV32Adapter({config: {memSize: 1 << 20}, image: {entry: 0x1000, segments: [{addr: 0x1000, bytes: new Uint8Array([0])}]}});
    assert.equal(custom.machine.memSize, 1 << 20, 'config.memSize still wins');
});

test('a C program with arrays boots through the adapter the way the app boots it', async () => {
    // shecc.wasm — the SAME compiler the browser route uses — then the adapter
    // path (no manual sp), proving loadImage set the machine up correctly.
    const r = await compileRiscvC(`
        int main(void) {
            int a[500]; int s = 0;
            for (int i = 0; i < 500; i++) a[i] = i;
            for (int i = 0; i < 500; i++) s += a[i];
            printf("sum(0..499) = %d\\n", s);
            return 0;
        }`);
    const a = createRiscV32Adapter({image: r.image});
    a.machine.run(20_000_000);
    assert.ok(a.machine.halted, 'the program halted');
    assert.equal(a.machine.exitCode, 0);
    assert.match(a.machine.output, /sum\(0\.\.499\) = 124750/);
    assert.ok((a.machine.cpu.x[2] >>> 0) >= a.machine.memSize - 64,
        'it ran on a stack the adapter set, not sp = 0');
});
