// The compressed (C) extension. RVC is syntactic sugar — each 16-bit instruction
// expands to one 32-bit base instruction — so the core decompresses at fetch and
// the executor is unchanged. The primary test is end-to-end: a clang program
// built WITH -march=rv32imac (its .text is full of C instructions) boots and
// computes fib(10)=55, exercising C.JAL/JR/branches/arith. A few unit tests pin
// specific expansions by executing them. (A real Zephyr qemu_riscv32 image, all
// compressed, boots on this same decoder — see the zephyr-riscv workflow.)

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {RiscV32} from '../src/riscv32.js';
import {RiscV32Machine} from '../src/riscv32-machine.js';
import {loadElfInto} from '../scripts/riscv-elf.mjs';

const here = dirname(fileURLToPath(import.meta.url));

test('a clang rv32imac program boots and runs (compressed instructions decode)', () => {
    const elf = new Uint8Array(Buffer.from(
        readFileSync(join(here, 'fixtures/riscv-rvc/rvc-hello.elf.b64'), 'utf8').trim(), 'base64'));
    let out = '';
    const m = new RiscV32Machine({}, {onSerial: b => out += String.fromCharCode(b)});
    loadElfInto(m, elf);
    m.run(2_000_000);
    assert.ok(out.includes('RVC works'), `printed via compressed code: ${JSON.stringify(out.slice(0, 30))}`);
    assert.ok(out.includes('fib=55'), 'fib(10)=55 — recursion/branches/arith all decoded through RVC');
    assert.equal(m.exitCode, 0);
});

// ── unit expansions (execute one compressed instruction, check the effect) ──
function runC(halfword, setup) {
    const mem = new Uint8Array(0x1000);
    const c = new RiscV32(mem, {});
    mem[0] = halfword & 0xff; mem[1] = (halfword >>> 8) & 0xff;
    if (setup) setup(c);
    c.step();
    return c;
}

test('C.LI expands to addi rd, x0, imm', () => {
    const c = runC(0x4515);                  // C.LI x10, 5
    assert.equal(c.x[10], 5);
    assert.equal(c.pc >>> 0, 2, 'pc advanced by 2 (a 16-bit instruction)');
});

test('C.ADDI expands to addi rd, rd, imm', () => {
    const c = runC(0x0505, cpu => { cpu.x[10] = 5; });   // C.ADDI x10, 1
    assert.equal(c.x[10], 6);
});

test('C.MV expands to add rd, x0, rs2', () => {
    const c = runC(0x85aa, cpu => { cpu.x[10] = 42; });  // C.MV x11, x10
    assert.equal(c.x[11], 42);
});

test('C.ADD expands to add rd, rd, rs2', () => {
    const c = runC(0x952e, cpu => { cpu.x[10] = 10; cpu.x[11] = 20; });  // C.ADD x10, x11
    assert.equal(c.x[10], 30);
});

test('C.JAL links x1 and jumps (RV32)', () => {
    const c = runC(0x2001);                  // C.JAL +0 (offset 0 → self); check x1 = return
    assert.equal(c.x[1] >>> 0, 2, 'ra = pc+2');
});
