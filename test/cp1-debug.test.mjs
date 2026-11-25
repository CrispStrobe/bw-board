// SPDX-License-Identifier: MIT
// Original, synthetic 8049 programs. No historical firmware or emulator traces.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCp1Adapter } from '../src/cp1-adapter.js';
import { createCp1DebugTarget } from '../src/cp1-debug.js';
import { createDebugSession } from '../src/debug-session.js';

function fixture(code = [0x17, 0x04, 0], options = {}) {
  const rom = new Uint8Array(2048);
  rom.set(code);
  const adapter = createCp1Adapter({rom, ...options});
  const target = createCp1DebugTarget(adapter);
  return {adapter, target, machine: adapter.machine, cpu: adapter.machine.cpu};
}

function boardProbe() {
  return {
    times: [], pins: [], reads: 0,
    advanceTo(at) { this.times.push(at); },
    setPin(...args) { this.pins.push(args); },
    readPin() { this.reads++; return undefined; },
  };
}

test('CP1 debugger advertises 8049 instruction control and refuses unqualified semantic steps', () => {
  const {target, machine} = fixture();
  const caps = target.capabilities();
  assert.deepEqual(caps.steps, ['insn']);
  assert.deepEqual(caps.breakpoints, ['code']);
  assert.equal(caps.timeFreezes, true);
  assert.equal(caps.extensions.instructionUnit, '8049 instruction');
  assert.deepEqual(caps.recording, []);
  assert.equal(caps.spaces.code.write, false);
  assert.equal(caps.spaces.idata.write, false);
  assert.equal(caps.spaces.program.write, true);
  assert.equal(caps.runTo[0].addressMax, 2047);
  const before = machine.saveState();
  for (const kind of ['block', 'line', 'cycle', 'cp1', 'over', 'out']) {
    assert.ok(target.step(kind).unsupported);
  }
  for (const count of [0, -1, 1.5, NaN, Infinity, 1000001, '1']) {
    assert.ok(target.step('insn', count).unsupported);
  }
  assert.equal(target.state(), 'halted');
  assert.deepEqual(machine.saveState(), before);
});

test('shared DebugSession runs, pauses, resumes, and freezes the same attached board', () => {
  const {target, adapter, machine, cpu} = fixture();
  const board = boardProbe();
  adapter.attachBoard(board);
  const session = createDebugSession(target, {sliceNs: 7500});
  session.start();
  assert.equal(session.pump(), 'ran');
  assert.equal(cpu.a, 1);
  assert.equal(cpu.pc, 0);
  assert.equal(machine.cycles, 3);
  assert.equal(board.times.at(-1), 7500n, 'board time advances even on instructions without I/O');
  target.setKey('RUN', true);
  session.pause();
  assert.equal(session.state().intent, 'paused');
  assert.equal(session.state().why.cause, 'user');
  assert.deepEqual(session.state().tasks, []);
  assert.deepEqual(machine.pressedKeys, []);
  const paused = machine.saveState();
  const boardCalls = [board.times.length, board.pins.length, board.reads];
  assert.equal(session.pump(), 'idle');
  assert.equal(target.runFor(100000), 'idle');
  target.snapshot();
  target.regs();
  assert.deepEqual(machine.saveState(), paused);
  assert.deepEqual([board.times.length, board.pins.length, board.reads], boardCalls);
  session.resume();
  assert.equal(session.pump(), 'ran');
  assert.equal(cpu.a, 2, 'resume retains the CPU state');
  assert.equal(machine.cycles, 6);
  assert.equal(board.times.at(-1), 15000n);
  session.stop();
  assert.equal(session.state().intent, 'stopped');
  assert.equal(cpu.pc, 0);
  assert.equal(target.timeNs(), 15000n, 'electrical reset retains monotonic board time');
  session.destroy();
  target.destroy();
});

test('instruction steps count opcodes, not bytes or machine cycles', () => {
  const {target, cpu} = fixture([0x23, 0x5a, 0x17, 0x04, 2]);
  const session = createDebugSession(target, {sliceNs: 100000});
  assert.equal(session.step('insn', 1), undefined);
  assert.equal(cpu.pc, 0, 'arming a step does not execute it');
  assert.equal(session.pump(), 'halted');
  assert.equal(cpu.pc, 2);
  assert.equal(cpu.a, 0x5a);
  assert.equal(cpu.cycles, 2);
  assert.equal(session.state().why.cause, 'step');
  assert.equal(session.state().why.pc, 2);
  assert.equal(session.state().why.tNs, 5000n);
  assert.equal(session.state().why.skewNs, 0n);
  session.step('insn', 2);
  session.pump();
  assert.equal(cpu.pc, 2);
  assert.equal(cpu.a, 0x5b);
  assert.equal(cpu.cycles, 5);
  assert.equal(session.stepping, false);
  session.destroy();
});

test('a two-cycle interrupt entry does not consume the requested instruction step', () => {
  const rom = new Uint8Array(2048);
  rom[7] = 0x17; // first timer service instruction: INC A
  const {target, cpu} = fixture([], {rom});
  cpu.timerInterruptEnabled = true;
  cpu.timerInterruptPending = true;
  cpu.timerFlag = true;
  target.step('insn', 1);
  assert.equal(target.runFor(50000), 'halted');
  assert.equal(cpu.cycles, 3, 'two entry cycles plus one instruction cycle');
  assert.equal(cpu.pc, 8);
  assert.equal(cpu.a, 1);
  assert.equal(cpu.interruptInProgress, true);
});

test('a new breakpoint at current PC stops before execution and resume exempts exactly one instruction', () => {
  const {target, cpu} = fixture();
  const reasons = [];
  target.onHalt((why) => reasons.push(why));
  const id = target.setBreakpoint({kind: 'code', space: 'code', addr: 0, stopSide: 'before'});
  target.run();
  assert.equal(target.runFor(100000), 'halted');
  assert.equal(cpu.a, 0);
  assert.equal(cpu.cycles, 0);
  assert.deepEqual(reasons[0], {
    pc: 0, tasks: [], tNs: 0n, skewNs: 0n, cause: 'breakpoint', bp: id, bpKind: 'code',
  });
  target.run();
  assert.equal(target.runFor(100000), 'halted');
  assert.equal(cpu.a, 1);
  assert.equal(cpu.pc, 0);
  assert.equal(cpu.cycles, 3);
  assert.equal(reasons.length, 2);
  assert.equal(reasons[1].bp, id);
});

test('stepping off and onto breakpoints supports continue while retaining loop re-hits', () => {
  const {target, cpu} = fixture();
  const atZero = target.setBreakpoint({kind: 'code', addr: 0});
  const atOne = target.setBreakpoint({kind: 'code', addr: 1});
  const reasons = [];
  target.onHalt((why) => reasons.push(why));
  target.run(); target.runFor(100000);
  target.step('insn', 1); target.runFor(100000);
  assert.equal(cpu.pc, 1);
  assert.equal(cpu.a, 1);
  assert.equal(reasons.at(-1).cause, 'step');
  target.run(); target.runFor(100000);
  assert.equal(cpu.pc, 0);
  assert.equal(cpu.cycles, 3);
  assert.equal(reasons.at(-1).bp, atZero);
  target.clearBreakpoint(atZero);
  target.run(); target.runFor(100000);
  assert.equal(cpu.pc, 1);
  assert.equal(cpu.a, 2);
  assert.equal(reasons.at(-1).bp, atOne);
});

test('reset and an explicitly changed PC invalidate stale breakpoint exemptions', () => {
  const {target, cpu} = fixture();
  target.setBreakpoint({kind: 'code', addr: 0});
  target.setBreakpoint({kind: 'code', addr: 1});
  target.run(); target.runFor(100000);
  target.reset();
  target.run(); target.runFor(100000);
  assert.equal(cpu.pc, 0);
  assert.equal(cpu.cycles, 0, 'reset must not preserve an old leave-breakpoint exemption');
  cpu.pc = 1;
  target.run(); target.runFor(100000);
  assert.equal(cpu.pc, 1);
  assert.equal(cpu.cycles, 0, 'changing PC is not permission to skip a new breakpoint');
});

test('code breakpoint and disassembly bounds cannot alias program bank zero', () => {
  const {target, cpu} = fixture([0x64, 0x42]);
  for (const addr of [-1, 2048, 4096, 0.5, NaN, Infinity, '0', 0n]) {
    assert.ok(target.setBreakpoint({kind: 'code', addr}).unsupported);
    assert.ok(target.disasm(addr).unsupported);
  }
  assert.ok(target.setBreakpoint({kind: 'cp1', addr: 0}).unsupported);
  assert.ok(target.setBreakpoint({kind: 'code', space: 'program', addr: 0}).unsupported);
  assert.ok(target.setBreakpoint({kind: 'code', addr: 0, stopSide: 'after'}).unsupported);
  assert.equal(typeof target.setBreakpoint({kind: 'code', addr: 2047}), 'number');
  assert.equal(target.nextCodeAddress(2047, 1), 0);
  assert.ok(target.nextCodeAddress(2048, 1).unsupported);
  assert.ok(target.nextCodeAddress(0, -1).unsupported);
  assert.ok(target.nextCodeAddress(0, 1.5).unsupported);
  cpu.memoryBank = 1;
  assert.equal(target.disasm(0).target, 0xb42);
  cpu.interruptInProgress = true;
  assert.equal(target.disasm(0).target, 0x342);
});

test('run budgets are validated, zero budgets are passive, and budget expiry is not a halt', () => {
  const {target, machine} = fixture();
  const reasons = [];
  target.onHalt((why) => reasons.push(why));
  target.run();
  const before = machine.saveState();
  for (const budget of [-1, NaN, Infinity, '1000', 1000n]) assert.throws(() => target.runFor(budget), RangeError);
  assert.equal(target.runFor(0), 'budget');
  assert.deepEqual(machine.saveState(), before);
  assert.equal(target.runFor(7500), 'budget');
  assert.equal(target.state(), 'running');
  assert.equal(reasons.length, 0);
  assert.equal(machine.cycles, 3);
});

test('one runFor call remains bounded even when the host supplies a very large slice', () => {
  const {target, machine} = fixture([]); // all NOPs
  target.run();
  assert.equal(target.runFor(1000000000), 'budget');
  assert.equal(machine.cycles, 40000, 'one call caps its emulated duration at 100 ms');
  assert.equal(target.timeNs(), 100000000n);
  assert.equal(target.state(), 'running');
});

test('snapshots, register views, disassembly, and all memory reads never advance or sample the board', () => {
  const {target, adapter, machine} = fixture([0x23, 0x5a, 0x39, 0x04, 0]);
  const board = boardProbe();
  adapter.attachBoard(board);
  machine.writeCell(3, 7, 81);
  target.run(); target.runFor(100000);
  const before = machine.saveState();
  const boardBefore = [board.times.length, board.pins.length, board.reads];
  for (let i = 0; i < 10; i++) {
    const view = target.snapshot();
    view.cells[3].operand = 255;
    target.regs();
    target.position();
    target.timeNs();
    target.disasm(0);
    target.readMem('code', 0, 2048).fill(0);
    target.readMem('idata', 0, 128).fill(0);
    target.readMem('program', 0, 256).fill(0);
  }
  assert.deepEqual(machine.saveState(), before);
  assert.deepEqual([board.times.length, board.pins.length, board.reads], boardBefore);
});

test('passive memory ranges reject overflow and permit empty reads at the end', () => {
  for (const expansion of [false, true]) {
    const {target, machine} = fixture([], {expansion});
    const before = machine.saveState();
    for (const [space, limit] of [['code', 2048], ['idata', 128], ['program', expansion ? 512 : 256]]) {
      assert.equal(target.readMem(space, limit - 1, 1).length, 1);
      assert.equal(target.readMem(space, limit, 0).length, 0);
      for (const [at, len] of [[limit, 1], [limit + 1, 0], [-1, 1], [0, -1], [0.5, 1], [0, 1.5], [NaN, 1], [0, Number.MAX_SAFE_INTEGER]]) {
        assert.ok(target.readMem(space, at, len).unsupported, `${space} ${at} + ${len}`);
      }
    }
    assert.ok(target.readMem('unknown', 0, 0).unsupported);
    assert.deepEqual(machine.saveState(), before);
  }
});

test('program writes stage whole cells, preserve odd-byte neighbors, and cross CP3 atomically', () => {
  const {target, machine} = fixture([], {expansion: true});
  machine.writeCell(127, 0xaa, 0xbb);
  machine.writeCell(128, 0xcc, 0xdd);
  let batches = 0;
  const load = machine.loadProgram.bind(machine);
  machine.loadProgram = (cells, options) => { batches++; return load(cells, options); };
  const data = new Uint8Array([0x11, 0x22]);
  assert.equal(target.writeMem('program', 255, data), undefined);
  data.fill(255);
  assert.deepEqual(machine.readCell(127), {opcode: 0xaa, operand: 0x11});
  assert.deepEqual(machine.readCell(128), {opcode: 0x22, operand: 0xdd});
  assert.deepEqual(Array.from(target.readMem('program', 254, 4)), [0xaa, 0x11, 0x22, 0xdd]);
  assert.equal(batches, 1);
  assert.equal(machine.cycles, 0);
  assert.equal(target.writeMem('program', 512, new Uint8Array()), undefined);
  assert.equal(batches, 1, 'empty write does not invoke a loader');
});

test('invalid and running program edits leave every byte unchanged', () => {
  const {target, machine} = fixture();
  machine.writeCell(127, 0x12, 0x34);
  const before = machine.saveState();
  const data = new Uint8Array([0x56, 0x78]);
  for (const [space, at, value] of [
    ['program', 255, data], ['program', -1, data], ['program', 0.5, data],
    ['program', 0, [1, 2]], ['program', 0, new Uint16Array([1, 2])],
    ['code', 0, data], ['idata', 0, data], ['unknown', 0, data],
  ]) {
    assert.ok(target.writeMem(space, at, value).refused);
    assert.deepEqual(machine.saveState(), before);
  }
  target.run();
  assert.ok(target.writeMem('program', 0, data).refused);
  assert.deepEqual(machine.saveState(), before);
  target.halt();
  assert.equal(target.writeMem('program', 0, data), undefined);
  assert.deepEqual(machine.readCell(0), {opcode: 0x56, operand: 0x78});
});

test('an undefined CPU opcode produces a visible fault halt without retiring an instruction', () => {
  const {target, cpu} = fixture([0x01]);
  const reasons = [];
  target.onHalt((why) => reasons.push(why));
  target.step('insn', 1);
  assert.equal(target.runFor(100000), 'halted');
  assert.equal(target.state(), 'halted');
  assert.equal(cpu.pc, 0);
  assert.equal(cpu.cycles, 0);
  assert.equal(reasons[0].cause, 'fault');
  assert.equal(reasons[0].fault.name, 'MCS48IllegalOpcodeError');
  assert.equal(reasons[0].fault.opcode, 1);
  assert.equal(reasons[0].fault.address, 0);
});

test('halt listeners can unsubscribe, and destroy releases duplicate contacts and detaches the board', () => {
  const {target, adapter, machine} = fixture();
  const board = boardProbe();
  adapter.attachBoard(board);
  let halts = 0;
  const unsubscribe = target.onHalt(() => halts++);
  assert.throws(() => target.onHalt(null), TypeError);
  target.run(); target.halt();
  assert.equal(halts, 1);
  unsubscribe();
  target.setKey('7', true, 0);
  target.setKey('7', true, 1);
  target.setKey('RUN', true);
  target.run();
  target.destroy();
  target.destroy();
  assert.equal(target.state(), 'detached');
  assert.deepEqual(machine.pressedKeys, []);
  assert.deepEqual(machine.saveState().keys, []);
  assert.equal(target.runFor(100000), 'idle');
  assert.ok(target.run().refused);
  assert.ok(target.step('insn').unsupported);
  assert.ok(target.setKey('RUN', true).refused);
  const calls = [board.times.length, board.pins.length, board.reads];
  machine.writeCpuPort(1, 0);
  assert.deepEqual([board.times.length, board.pins.length, board.reads], calls);
  assert.equal(halts, 1);
});

test('shared target factory wires the CP1 debugger and board adapter to one machine', async () => {
  const {createDebugTarget} = await import('../src/debug-target-factory.js');
  const rom = new Uint8Array(2048);
  rom.set([0x17, 0x04, 0]);
  const board = boardProbe();
  const {target, adapter} = await createDebugTarget('cp1', {rom, board});
  assert.equal(target.adapter, adapter);
  assert.equal(target.machine, adapter.machine);
  const session = createDebugSession(target, {sliceNs: 7500});
  session.start();
  assert.equal(session.pump(), 'ran');
  assert.equal(target.regs().a, 1);
  assert.equal(board.times.at(-1), target.timeNs());
  session.pause();
  const time = target.timeNs();
  assert.equal(session.pump(), 'idle');
  assert.equal(target.timeNs(), time);
  session.destroy();
  target.destroy();
});
