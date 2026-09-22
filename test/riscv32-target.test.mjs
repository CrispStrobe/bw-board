// The riscv32 debug target: createDebugTarget('riscv32', {image}) builds the
// adapter around a RiscV32Machine, and its ecall ABI output reaches the
// adapter's onSerial. Proves the target-factory wiring end to end (the console
// path lite's debug-runner drives), with a hand-assembled write+exit program.

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDebugTarget} from '../src/debug-target-factory.js';

const I = (op, f3, rd, rs1, imm) =>
    ((imm & 0xfff) << 20 | (rs1 & 0x1f) << 15 | (f3 & 7) << 12 | (rd & 0x1f) << 7 | op) >>> 0;
const ADDI = (rd, rs1, imm) => I(0x13, 0, rd, rs1, imm);
const ECALL = () => 0x00000073;
const wordsToBytes = words => {
    const b = new Uint8Array(words.length * 4);
    words.forEach((w, i) => { b[i * 4] = w; b[i * 4 + 1] = w >>> 8; b[i * 4 + 2] = w >>> 16; b[i * 4 + 3] = w >>> 24; });
    return b;
};

// write(1, 0x400, 3) then exit(0); the string "HI\n" lives at 0x400.
const CODE = wordsToBytes([
    ADDI(11, 0, 0x400), ADDI(12, 0, 3), ADDI(10, 0, 1), ADDI(17, 0, 64), ECALL(),
    ADDI(10, 0, 0), ADDI(17, 0, 93), ECALL()
]);
const IMAGE = {segments: [{addr: 0, bytes: CODE}, {addr: 0x400, bytes: new Uint8Array([0x48, 0x49, 0x0a])}], entry: 0};

test("createDebugTarget('riscv32') builds an adapter that runs a program to serial", async () => {
    const {target, adapter} = await createDebugTarget('riscv32', {image: IMAGE});
    assert.equal(target, null, 'adapter-only mode (no debug UI yet)');
    assert.equal(adapter.kind, 'riscv32');
    let out = '';
    adapter.onSerial(b => { out += String.fromCharCode(b); });
    // Drive it the way the app does — advance time until it exits.
    for (let i = 0; i < 100 && !adapter.exited(); i++) adapter.advanceNs(10000);
    assert.equal(out, 'HI\n', 'the ecall write reached the adapter serial face');
    assert.ok(adapter.exited(), 'the exit syscall halted the machine');
    assert.equal(adapter.exitCode(), 0);
});

test("an unknown target kind still names riscv32 in its error", async () => {
    await assert.rejects(() => createDebugTarget('nonsense', {}), /riscv32/);
});
