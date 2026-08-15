import test from 'node:test';
import assert from 'node:assert/strict';
import { M6502Machine, EATER6502 } from '../src/m6502-machine.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';

/**
 * Debug-capability parity with emu8051: step-over, step-out, and TRUE
 * write watchpoints on both retro cores. Over/out are SP-depth waits
 * armed only on call-class opcodes; watchpoints wrap the core's write
 * callback, so same-value stores fire too.
 */

//   8000: JSR $8007   8003: LDA #$01   8005: STP
//   8007: LDA #$42    8009: STA $0010  800c: RTS
const PROG_6502 = [0x20, 0x07, 0x80, 0xa9, 0x01, 0xdb, 0x00, 0xa9, 0x42, 0x8d, 0x10, 0x00, 0x60];
const m6502 = () => {
    const m = new M6502Machine(EATER6502, {});
    m.loadRom(PROG_6502);
    m.mem[0xfffc] = 0x00; m.mem[0xfffd] = 0x80;
    m.reset();
    return { m, t: createM6502DebugTarget({ machine: m, timeNs: () => 0n }) };
};

//   0000: CALL $0008  0003: LD A,$01  0005: HALT
//   0008: LD A,$42    000a: LD ($4000),A  000d: RET
const PROG_Z80 = [0xcd, 0x08, 0x00, 0x3e, 0x01, 0x76, 0x00, 0x00, 0x3e, 0x42, 0x32, 0x00, 0x40, 0xc9];
const z80 = () => {
    const m = new Z80Machine({ clockHz: 1_000_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
    m.load(Uint8Array.from(PROG_Z80), 0);
    m.cpu.pc = 0; m.cpu.sp = 0xff00;
    return { m, t: createZ80DebugTarget({ machine: m }) };
};

test('6502 step-over: the JSR body runs, control halts after it', () => {
    const { m, t } = m6502();
    t.step('over');
    assert.equal(t.runFor(1_000_000_000), 'halted');
    assert.equal(t.regs().pc, 0x8003, 'halted at the insn after JSR');
    assert.equal(m.mem[0x0010], 0x42, 'the subroutine really ran');
});

test('6502 step-out: from inside the subroutine back to the caller', () => {
    const { t } = m6502();
    t.step('insn'); t.runFor(1_000_000_000);       // execute the JSR
    assert.equal(t.regs().pc, 0x8007, 'inside the subroutine');
    t.step('out');
    assert.equal(t.runFor(1_000_000_000), 'halted');
    assert.equal(t.regs().pc, 0x8003, 'back at the return site');
});

test('6502 write watchpoint: STA $0010 halts with address and value', () => {
    const { t } = m6502();
    const id = t.setBreakpoint({ kind: 'write', addr: 0x0010 });
    assert.equal(typeof id, 'number');
    let cause = null;
    t.onHalt((info) => { cause = info; });
    t.run();
    assert.equal(t.runFor(1_000_000_000), 'halted');
    assert.equal(cause.cause, 'watchpoint');
    assert.equal(cause.addr, 0x0010);
    assert.equal(cause.value, 0x42);
    t.clearBreakpoint(id);
});

test('6502 step-over on a non-call opcode is a single step', () => {
    const { t } = m6502();
    t.step('insn'); t.runFor(1_000_000_000);       // now at LDA #$42
    t.step('over'); t.runFor(1_000_000_000);
    assert.equal(t.regs().pc, 0x8009, 'one instruction, no depth wait');
});

test('Z80 step-over: the CALL body runs, control halts after it', () => {
    const { m, t } = z80();
    t.step('over');
    assert.equal(t.runFor(1_000_000_000), 'halted');
    assert.equal(t.regs().pc, 0x0003, 'halted at the insn after CALL');
    assert.equal(m.mem[0x4000], 0x42, 'the subroutine really ran');
});

test('Z80 step-out: from inside the subroutine back to the caller', () => {
    const { t } = z80();
    t.step('insn'); t.runFor(1_000_000_000);       // execute the CALL
    assert.equal(t.regs().pc, 0x0008, 'inside the subroutine');
    t.step('out');
    assert.equal(t.runFor(1_000_000_000), 'halted');
    assert.equal(t.regs().pc, 0x0003, 'back at the return site');
});

test('Z80 write watchpoint: LD ($4000),A halts with address and value', () => {
    const { t } = z80();
    assert.equal(typeof t.setBreakpoint({ kind: 'write', addr: 0x4000 }), 'number');
    let cause = null;
    t.onHalt((info) => { cause = info; });
    t.run();
    assert.equal(t.runFor(1_000_000_000), 'halted');
    assert.equal(cause.cause, 'watchpoint');
    assert.equal(cause.addr, 0x4000);
    assert.equal(cause.value, 0x42);
});

test('capabilities declare the new powers on both targets', () => {
    const c6 = m6502().t.capabilities();
    assert.ok(c6.steps.includes('over') && c6.steps.includes('out'));
    assert.ok(c6.breakpoints.includes('write'));
    const cz = z80().t.capabilities();
    assert.ok(cz.steps.includes('over') && cz.steps.includes('out'));
    assert.ok(cz.breakpoints.includes('write'));
});
