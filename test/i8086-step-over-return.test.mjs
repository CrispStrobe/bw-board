// STEP-OVER LANDS AFTER THE CALL, NOT WHEREVER THE STACK HAPPENS TO BALANCE.
//
// Step-over resumed and halted when the stack pointer had risen back to where it
// started. That is necessary and not sufficient: a callee can balance the stack
// mid-body -- `pop` the return address, work, `push` it back, `ret` -- and the
// debugger stops inside the function the user asked to step OVER.
//
// The failure is quiet and it lies in the most convincing way available: the
// debugger reports `cause: 'step'`, the UI shows a halted machine at a plausible
// address, and a user reading the source sees execution stopped somewhere they
// have no reason to distrust. Nothing throws and no test that only steps over
// well-behaved callees ever sees it.
//
// The fix is to require BOTH: the stack is back, AND execution is at the
// instruction after the call. The return address is known at step-over time --
// decode the call and add its length.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

//  0000 E8 03 00   call 0006
//  0003 90         nop            <- the true return address, F000:0003
//  0004 F4         hlt
//  0005 90
//  0006 58         pop ax         <- SP returns to sp0 INSIDE the callee
//  0007 90         nop            <- where the stack-only test stops
//  0008 50         push ax
//  0009 C3         ret
const BALANCING_CALLEE = [0xe8, 0x03, 0x00, 0x90, 0xf4, 0x90, 0x58, 0x90, 0x50, 0xc3];
//  A callee that does NOT touch the stack, so both rules agree.
const PLAIN_CALLEE = [0xe8, 0x03, 0x00, 0x90, 0xf4, 0x90, 0x90, 0x90, 0x90, 0xc3];

const build = code => {
    const r = new Uint8Array(0x10000).fill(0x90);
    r.set(code, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf0], 0xfff0);
    const machine = new I8086Machine(PCXT8086, {});
    machine.loadRom(r);
    machine.reset();
    machine.step();                         // consume the reset-vector jump
    return {machine, target: createI8086DebugTarget({machine})};
};

test('a callee that balances the stack mid-body does not end the step early', () => {
    const {machine, target} = build(BALANCING_CALLEE);
    assert.equal(machine.cpu.pc, 0xf0000, 'the fixture is not sitting on the call');

    target.step('over');
    const verdict = target.runFor(1_000_000);

    assert.equal(verdict, 'halted', 'the step never completed');
    assert.equal(machine.cpu.pc, 0xf0003,
        `step-over stopped at 0x${machine.cpu.pc.toString(16)}, inside the callee; ` +
        'the instruction after the call is 0xF0003');
});

test('and an ordinary callee still ends the step exactly where it always did', () => {
    // The other direction. A rule that only ever halts at the return address
    // would pass the case above while breaking every well-behaved step-over,
    // and a rule that never halts would hang rather than fail loudly.
    const {machine, target} = build(PLAIN_CALLEE);
    target.step('over');
    const verdict = target.runFor(1_000_000);

    assert.equal(verdict, 'halted');
    assert.equal(machine.cpu.pc, 0xf0003);
});

test('stepping over a NON-call is still a single instruction', () => {
    // step('over') on something that is not a call must not compute a return
    // address for an instruction that never returns.
    const {machine, target} = build([0x90, 0x90, 0xf4]);
    const before = machine.cpu.pc;
    target.step('over');
    target.runFor(1_000_000);
    assert.equal(machine.cpu.pc, before + 1, 'a NOP stepped over is one instruction');
});
