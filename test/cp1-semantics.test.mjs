// SPDX-License-Identifier: MIT
// Original tiny 8049 test monitor. This is not historical firmware, nor an oracle translation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createCp1Adapter} from '../src/cp1-adapter.js';
import {createCp1DebugTarget} from '../src/cp1-debug.js';
import {createDebugSession} from '../src/debug-session.js';
import {sha1Bytes} from '../src/cp1-rom-profiles.js';
import {CP1_SEMANTIC_PROFILES} from '../src/cp1-semantic-profiles.js';
import {CP1_INDEPENDENT_MONITOR_ROM} from '../src/cp1-monitor-profile.generated.js';
import {CP1_INDEPENDENT_MONITOR_ROM as CP1_CP2_MONITOR_ROM} from '../src/cp1-monitor-cp2-profile.generated.js';
import {validateCp1SemanticProfile} from '../src/cp1-semantics.js';

function testFirmware() {
  const rom = new Uint8Array(2048);
  const put = (at, bytes) => rom.set(bytes, at);
  put(0, [0x04, 0x10]);                           // JMP initialization
  put(7, [0x1f, 0x93]);                           // timer ISR: INC R7; RETR
  put(0x10, [0x23, 0x2f, 0x3a,                   // base RAM selected on P2
    0xb9, 0x44, 0xb1, 0, 0x04, 0x20]);           // clear error indicator; dispatch
  put(0x20, [0xb9, 0x40, 0xf1, 0xe7, 0xa8,       // R0 = cell number * 2
    0x80, 0xaa, 0x18, 0x80, 0xab,                // R2 = opcode; R3 = operand (real MOVX)
    0xfa, 0xd3, 1, 0xc6, 0xa0,                   // 1: halt
    0xfa, 0xd3, 9, 0xc6, 0x90,                   // 9: branch
    0xfa, 0xd3, 3, 0xc6, 0xb0,                   // 3: bounded work loop
    0xfa, 0xd3, 255, 0xc6, 0xc0,                 // 255: error
    0xfa, 0xd3, 5, 0xc6, 0x80,                   // 5: copy full cell
    0xfa, 0xd3, 6, 0xc6, 0xd0,                   // 6: store full cell
    0xb9, 0x41, 0xb1, 0, 0x19, 0xfb, 0xa1,     // otherwise literal 0.operand
    0x04, 0x70]);
  put(0x70, [0xb9, 0x40, 0x11, 0x04, 0x20]);    // increment cell PC; dispatch
  put(0x80, [0xfb, 0xe7, 0xa8, 0x80, 0xb9, 0x41,
    0xa1, 0x18, 0x19, 0x80, 0xa1, 0x04, 0x70]); // copy two external bytes
  put(0x90, [0xb9, 0x40, 0xfb, 0xa1, 0x04, 0x20]); // branch
  put(0xa0, [0xb9, 0x40, 0x11, 0x04, 0xe0]);    // HLT advances PC and returns idle
  put(0xb0, [0xbc, 0xff, 0xec, 0xb2, 0x04, 0x70]); // 255 DJNZ iterations
  put(0xc0, [0xb9, 0x44, 0xb1, 0x71, 0x19, 0xb1, 0x3f,
    0x19, 0xb1, 0x3f, 0x19, 0xb1, 0x7d, 0x04, 0xe0]); // F006
  put(0xd0, [0xfb, 0xe7, 0xa8, 0xb9, 0x41, 0xf1, 0x90,
    0x18, 0x19, 0xf1, 0x90, 0x04, 0x70]);        // store two external bytes
  put(0xe0, [0x04, 0xe0]);                        // monitor continues executing
  return rom;
}

function testProfile(rom) {
  return {version: 1, id: 'original-test-monitor', romSha1: sha1Bytes(rom), evidence: 'This file',
    registers: {pc: 0x40, accumulator: {opcode: 0x41, operand: 0x42},
      comparison: {address: 0x43, mask: 2, label: 'Synthetic comparison'}},
    commandBoundary: 0x20, monitorBoundary: 0xe0, haltOpcodes: [1],
    errorDisplay: {indicatorAddress: 0x44, indicatorValue: 0x71,
      digitAddresses: [0x45, 0x46, 0x47],
      digitMasks: [0x3f, 6, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x27, 0x7f, 0x6f]}};
}

function fixture(words = [[4, 42], [1, 0]], options = {}) {
  const rom = testFirmware();
  const profile = testProfile(rom);
  const adapter = createCp1Adapter({rom, expansion: !!options.expansion});
  const machine = adapter.machine;
  machine.loadProgram(words.map(([opcode, operand]) => ({opcode, operand})));
  const target = createCp1DebugTarget(adapter, {semanticProfiles: [profile], ...options});
  const events = [], halts = [];
  target.onEvent(event => events.push(event));
  target.onHalt(why => halts.push(why));
  while (machine.cpu.pc !== 0x20) adapter.step();
  return {rom, profile, adapter, machine, cpu: machine.cpu, target, events, halts};
}

function pump(target, budget = 100000000) {
  for (let slices = 0; slices < 100; slices++) {
    const result = target.runFor(budget);
    if (result !== 'budget') return result;
  }
  assert.fail('test pump exceeded its explicit bound');
}

test('exact ROM bytes admit semantic control; names and one changed byte do not', () => {
  const f = fixture();
  assert.deepEqual(f.target.capabilities().steps, ['insn', 'cp1']);
  assert.deepEqual(f.target.capabilities().breakpoints, ['code', 'cp1']);
  assert.deepEqual(f.target.capabilities().events, ['cp1.command', 'cp1.halt', 'cp1.error']);
  assert.equal(f.target.semanticState().profileQualified, true);
  assert.equal(f.target.semanticState().profileId, f.profile.id);
  const changed = f.rom.slice(); changed[2047] ^= 1;
  f.adapter.loadRom(changed);
  assert.deepEqual(f.target.capabilities().steps, ['insn']);
  assert.deepEqual(f.target.capabilities().breakpoints, ['code']);
  assert.equal(f.target.semanticState().available, false);
  assert.equal(f.target.semanticState().pc, undefined);
  assert.match(f.target.semanticState().reason, /exact ROM/);
  const before = f.machine.saveState();
  assert.ok(f.target.step('cp1').unsupported);
  assert.ok(f.target.setBreakpoint({kind: 'cp1', addr: 0}).unsupported);
  assert.deepEqual(f.machine.saveState(), before);
  f.target.step('insn'); assert.equal(pump(f.target), 'halted');
  assert.equal(f.cpu.pc, 0x10);
  assert.deepEqual(f.events, []);
});

test('built-in profiles qualify the measured 2716 and independent identities with detached metadata', () => {
  assert.deepEqual(CP1_SEMANTIC_PROFILES.map(profile => profile.romSha1), [
    'ff4befcf82a664950186d3af1843fdef70d2209f', CP1_INDEPENDENT_MONITOR_ROM.sha1,
    CP1_CP2_MONITOR_ROM.sha1,
  ]);
  const source = testProfile(testFirmware());
  const profile = validateCp1SemanticProfile(source);
  source.registers.accumulator.opcode = 127;
  assert.equal(profile.registers.accumulator.opcode, 0x41);
  assert.equal(Object.isFrozen(profile.registers.accumulator), true);
  for (const mutate of [
    p => { p.romSha1 = 'same-name'; }, p => { p.commandBoundary = 2048; },
    p => { p.monitorBoundary = p.commandBoundary; }, p => { p.registers.pc = 128; },
    p => { p.registers.accumulator.operand = p.registers.accumulator.opcode; },
    p => { p.registers.comparison.mask = 0; }, p => { p.errorDisplay.digitAddresses.push(4); },
    p => { p.errorDisplay.digitMasks[1] = p.errorDisplay.digitMasks[0]; },
  ]) {
    const invalid = testProfile(testFirmware()); mutate(invalid);
    assert.throws(() => validateCp1SemanticProfile(invalid), TypeError);
  }
  const adapter = createCp1Adapter({rom: testFirmware()});
  assert.throws(() => createCp1DebugTarget(adapter, {semanticProfiles: [profile, profile]}), /Duplicate/);
  assert.throws(() => createCp1DebugTarget(adapter, {maxCp1Instructions: 0}), RangeError);
});

test('two command steps preserve the entire accumulator cell and store it through real 8155 RAM', () => {
  const f = fixture([[5, 90], [6, 91], [4, 73], [1, 0]]);
  f.machine.writeCell(90, 17, 231);
  f.cpu.ram[0x43] = 3;
  assert.equal(f.target.semanticState().execution, 'ready');
  assert.equal(f.target.semanticState().atCommandBoundary, true);
  assert.deepEqual(f.target.semanticState().command, {address: 0, opcode: 5, operand: 90});
  assert.equal(f.target.semanticState().comparison.value, true);
  const before = f.machine.saveState();
  assert.equal(f.target.step('cp1', 2), undefined);
  assert.deepEqual(f.machine.saveState(), before, 'arming does not execute firmware or inject a key');
  assert.equal(pump(f.target), 'halted');
  assert.deepEqual(f.machine.readCell(91), {opcode: 17, operand: 231});
  assert.deepEqual(f.target.regs().cp1.accumulator, {opcode: 17, operand: 231});
  assert.equal(f.target.snapshot().cp1.pc, 2);
  assert.equal(f.cpu.pc, 0x20, 'raw and teaching PCs remain separate');
  assert.deepEqual(f.events.map(event => [event.type, event.command.address, event.pc]), [
    ['cp1.command', 0, 1], ['cp1.command', 1, 2],
  ]);
  assert.equal(f.events[0].outcome, 'completed');
  assert.equal(f.halts.at(-1).cause, 'step');
  assert.equal(f.halts.at(-1).stepKind, 'cp1');
  assert.equal(f.halts.at(-1).cp1Step.completed, 2);
  assert.equal(f.halts.at(-1).cp1Step.reason, 'complete');
  assert.ok(f.halts.at(-1).cp1Step.instructions > 2);
  f.target.step('cp1'); pump(f.target);
  assert.deepEqual(f.target.semanticState().accumulator, {opcode: 0, operand: 73});
});

test('command breakpoints stop before execution, leave once, and re-hit a self-branch at the same cell', () => {
  const f = fixture([[9, 0]]);
  const id = f.target.setBreakpoint({kind: 'cp1', space: 'program', addr: 0, stopSide: 'before'});
  const cycles = f.machine.cycles;
  f.target.run(); assert.equal(pump(f.target), 'halted');
  assert.equal(f.machine.cycles, cycles);
  assert.equal(f.halts.at(-1).bp, id);
  assert.equal(f.halts.at(-1).bpKind, 'cp1');
  assert.equal(f.halts.at(-1).cp1Pc, 0);
  assert.deepEqual(f.events, []);
  const boundary = f.target.semanticState().boundaryId;
  f.target.run(); assert.equal(pump(f.target), 'halted');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].command.address, 0);
  assert.equal(f.events[0].pc, 0);
  assert.notEqual(f.target.semanticState().boundaryId, boundary);
  f.target.step('cp1'); pump(f.target);
  assert.equal(f.events.length, 2);
  assert.equal(f.halts.at(-1).cause, 'step');
  f.target.run(); pump(f.target);
  assert.equal(f.events.length, 3);
  assert.equal(f.halts.at(-1).bp, id);
});

test('CP1 breakpoint addresses are cells, validate installed capacity, and coexist with raw ROM breakpoints', () => {
  for (const expansion of [false, true]) {
    const f = fixture([[4, 42], [1, 0]], {expansion});
    const capacity = expansion ? 256 : 128;
    for (const addr of [-1, capacity, capacity * 2, 0.5, NaN, Infinity, '0', 0n]) {
      assert.ok(f.target.setBreakpoint({kind: 'cp1', addr}).unsupported);
    }
    assert.equal(typeof f.target.setBreakpoint({kind: 'cp1', addr: capacity - 1}), 'number');
    assert.ok(f.target.setBreakpoint({kind: 'cp1', addr: 0, space: 'code'}).unsupported);
    assert.ok(f.target.setBreakpoint({kind: 'cp1', addr: 0, stopSide: 'after'}).unsupported);
    const raw = f.target.setBreakpoint({kind: 'code', addr: 0x22});
    f.target.step('cp1'); pump(f.target);
    assert.equal(f.halts.at(-1).bp, raw);
    assert.equal(f.target.semanticState().step.reason, 'breakpoint');
    assert.equal(f.target.semanticState().step.completed, 0);
    f.target.clearBreakpoint(raw);
    f.target.step('cp1'); pump(f.target);
    assert.equal(f.target.semanticState().pc, 1, 'resuming mid-command finishes that command');
  }
});

test('timer interrupt entry and return to the same dispatch do not manufacture a command completion', () => {
  const f = fixture();
  const boundary = f.target.semanticState().boundaryId;
  f.cpu.timerInterruptEnabled = true;
  f.cpu.timerInterruptPending = true;
  f.cpu.timerFlag = true;
  f.target.step('cp1');
  assert.equal(f.target.runFor(5000), 'budget');
  assert.equal(f.cpu.interruptInProgress, true);
  assert.equal(f.target.semanticState().atCommandBoundary, false);
  assert.equal(f.target.semanticState().boundaryId, boundary);
  assert.deepEqual(f.events, []);
  assert.equal(pump(f.target), 'halted');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].command.address, 0);
  assert.equal(f.target.semanticState().pc, 1);
  assert.equal(f.target.semanticState().step.completed, 1);
  assert.equal(f.target.semanticState().step.interrupts, 1);
  assert.equal(f.target.semanticState().step.cpuSteps, f.target.semanticState().step.instructions + 1);
});

test('editing a paused boundary reports the newly executed bytes, while a mid-command edit invalidates attribution', () => {
  const f = fixture();
  const boundary = f.target.semanticState().boundaryId;
  f.target.writeMem('program', 0, new Uint8Array([4, 73]));
  assert.equal(f.target.semanticState().boundaryId, boundary);
  assert.deepEqual(f.target.semanticState().command, {address: 0, opcode: 4, operand: 73});
  f.target.step('cp1'); pump(f.target);
  assert.equal(f.events[0].command.operand, 73);
  assert.deepEqual(f.events[0].accumulator, {opcode: 0, operand: 73});
  f.target.step('cp1'); f.target.runFor(5000);
  f.machine.writeCell(90, 17, 231);
  const before = f.machine.saveState();
  assert.equal(pump(f.target), 'halted');
  assert.equal(f.target.semanticState().step.reason, 'state-changed');
  assert.deepEqual(f.machine.saveState(), before);
  assert.equal(f.events.length, 1, 'edited unfinished command produces no fabricated completion');
});

test('restoring onto a dispatch boundary still honors a newly installed command breakpoint', () => {
  const f = fixture();
  const checkpoint = f.machine.saveState();
  f.target.step('cp1'); pump(f.target);
  f.machine.loadState(checkpoint);
  const id = f.target.setBreakpoint({kind: 'cp1', addr: 0});
  const before = f.machine.saveState();
  f.target.run(); assert.equal(pump(f.target), 'halted');
  assert.equal(f.halts.at(-1).bp, id);
  assert.deepEqual(f.machine.saveState(), before);
});

test('a semantic instruction budget bounds long commands, reports partial progress, and permits resume', () => {
  const f = fixture([[3, 200], [1, 0]]);
  const board = {timeNs: 0n, advanceTo(at) { this.timeNs = at; }, setPin() {}, readPin() { return undefined; }};
  f.adapter.attachBoard(board);
  const start = f.machine.cycles;
  f.target.step('cp1', 1, {maxInstructions: 25});
  assert.equal(pump(f.target), 'halted');
  const partial = f.target.semanticState();
  assert.equal(partial.step.status, 'limit');
  assert.equal(partial.step.reason, 'instruction-budget');
  assert.equal(partial.step.maxInstructions, 25);
  assert.equal(partial.step.instructions, 25);
  assert.equal(partial.step.completed, 0);
  assert.equal(partial.execution, 'running', 'firmware command and debugger pause are different states');
  assert.equal(f.halts.at(-1).cause, 'step-limit');
  assert.equal(partial.step.cycles, f.machine.cycles - start);
  assert.equal(board.timeNs, f.target.timeNs());
  const paused = f.machine.saveState();
  assert.equal(f.target.runFor(1000000), 'idle');
  assert.deepEqual(f.machine.saveState(), paused);
  f.target.step('cp1', 1, {maxInstructions: 1000});
  assert.equal(pump(f.target, 50000), 'halted', 'one step can span many small host slices');
  assert.equal(f.target.semanticState().step.reason, 'complete');
  assert.equal(f.target.semanticState().pc, 1);
  assert.equal(f.events.length, 1);
  assert.equal(board.timeNs, f.target.timeNs());
});

test('HLT yields command and halt observations while free running keeps the CPU clock alive', () => {
  const f = fixture([[1, 0]]);
  f.target.step('cp1'); assert.equal(pump(f.target), 'halted');
  assert.deepEqual(f.events.map(event => [event.kind, event.reason ?? event.outcome]), [
    ['command', 'halted'], ['halt', 'hlt'],
  ]);
  assert.equal(f.target.semanticState().pc, 1);
  assert.equal(f.target.semanticState().execution, 'halted');
  assert.equal(f.target.semanticState().step.reason, 'halt');
  assert.equal(f.target.semanticState().step.completed, 1);
  const idle = f.machine.saveState();
  assert.match(f.target.step('cp1').unsupported, /original STEP key/);
  assert.deepEqual(f.machine.saveState(), idle, 'idle semantic step refuses immediately');
  const time = f.target.timeNs();
  f.target.run(); assert.equal(f.target.runFor(1000000), 'budget');
  assert.ok(f.target.timeNs() > time);
  assert.equal(f.target.state(), 'running');
  assert.equal(f.target.semanticState().execution, 'halted');
  assert.equal(f.events.length, 2, 'repeated monitor visits are not repeated halt events');
});

test('settled error-buffer observation reports F006 without counting a failed command or pausing free-run', () => {
  const f = fixture([[255, 0]]);
  f.target.step('cp1'); assert.equal(pump(f.target), 'halted');
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, 'cp1.error');
  assert.deepEqual(f.events[0].error, {code: 6, digits: [0x3f, 0x3f, 0x7d]});
  assert.equal(f.events[0].command.address, 0);
  assert.equal(f.target.semanticState().step.completed, 0);
  assert.equal(f.target.semanticState().step.reason, 'error');
  assert.equal(f.halts.at(-1).cause, 'cp1-error');
  assert.ok(f.target.step('cp1').unsupported);
  f.target.run(); assert.equal(f.target.runFor(1000000), 'budget');
  assert.equal(f.events.length, 1);
  assert.equal(f.target.state(), 'running');
  assert.equal(f.target.semanticState().execution, 'error');
});

test('unknown seven-segment errors stay observable without inventing a numeric code', () => {
  const f = fixture([[255, 0]]);
  f.target.run(); f.target.runFor(1000000);
  assert.equal(f.events[0].error.code, 6);
  f.cpu.ram[0x47] = 0x01;
  f.target.runFor(1000000);
  assert.equal(f.events.at(-1).error.code, null);
  const count = f.events.length;
  f.target.runFor(1000000);
  assert.equal(f.events.length, count);
});

test('generic monitor return is a halt observation without a guessed command completion', () => {
  const f = fixture([[3, 200]]);
  f.target.step('insn', 3); pump(f.target);
  assert.equal(f.target.semanticState().execution, 'running');
  // External control of the test CPU emulates an unclassified monitor return;
  // no production logic may treat an arbitrary return as completed HLT.
  f.cpu.pc = 0xe0;
  f.adapter.step();
  assert.deepEqual(f.events.map(event => event.kind), ['halt']);
  assert.equal(f.events[0].reason, 'monitor');
  assert.equal(f.events[0].command.opcode, 3);
});

test('read-only teaching snapshots, events and listeners cannot mutate live state or advance the board', () => {
  const f = fixture();
  const board = {calls: 0, advanceTo() { this.calls++; }, setPin() {}, readPin() { this.calls++; return undefined; }};
  f.adapter.attachBoard(board);
  f.target.step('cp1'); pump(f.target);
  const before = f.machine.saveState();
  const calls = board.calls;
  const snapshot = f.target.snapshot();
  snapshot.cp1.accumulator.operand = 255;
  snapshot.cp1.lastEvent.command.operand = 255;
  snapshot.cp1.step.instructions = 0;
  f.target.regs(); f.target.semanticState(); f.target.capabilities();
  assert.deepEqual(f.machine.saveState(), before);
  assert.equal(board.calls, calls);
  assert.equal(f.events[0].command.operand, 42);
  assert.equal(Object.isFrozen(f.events[0]), true);
  assert.equal(Object.isFrozen(f.events[0].command), true);
  assert.throws(() => f.target.onEvent(null), TypeError);
});

test('all machine advance paths share observations, and destroy detaches the passive observer', () => {
  const f = fixture([[4, 42], [9, 0]]);
  let calls = 0;
  const unsubscribe = f.target.onEvent(() => calls++);
  f.machine.advanceCycles(300);
  assert.ok(f.events.length >= 2, 'direct machine execution is observable without a second interpreter');
  assert.equal(calls, f.events.length);
  unsubscribe();
  const previousCalls = calls;
  f.adapter.advanceNs(1000000);
  assert.equal(calls, previousCalls);
  const eventCount = f.events.length;
  f.target.destroy();
  f.machine.advanceCycles(300);
  assert.equal(f.events.length, eventCount);
  assert.equal(f.target.state(), 'detached');
});

test('state restore and ROM replacement invalidate an in-flight semantic step without executing extra instructions', () => {
  for (const replaceRom of [false, true]) {
    const f = fixture([[3, 200], [1, 0]]);
    const checkpoint = f.machine.saveState();
    f.target.step('cp1');
    assert.equal(f.target.runFor(10000), 'budget');
    if (replaceRom) {
      const changed = f.rom.slice(); changed[2047] ^= 1; f.adapter.loadRom(changed);
    } else f.machine.loadState(checkpoint);
    const before = f.machine.saveState();
    assert.equal(pump(f.target), 'halted');
    assert.equal(f.target.semanticState().step.reason, replaceRom ? 'profile-changed' : 'state-changed');
    assert.deepEqual(f.machine.saveState(), before);
    assert.equal(f.events.length, 0);
  }
});

test('DebugSession semantic stepping preserves one owner and reports the completed step to the host', () => {
  const f = fixture([[4, 42], [4, 73], [1, 0]]);
  const session = createDebugSession(f.target, {sliceNs: 100000});
  // Starting a session resets CPU state. Use an explicit pause at a real CP1
  // breakpoint, the same entry workflow as the historical monitor's RUN key.
  f.target.setBreakpoint({kind: 'cp1', addr: 0});
  session.start();
  for (let i = 0; i < 20 && session.state().intent === 'running'; i++) session.pump();
  assert.equal(session.state().why.bpKind, 'cp1');
  assert.equal(session.step('cp1'), undefined);
  for (let i = 0; i < 20 && session.stepping; i++) session.pump();
  assert.equal(session.state().intent, 'paused');
  assert.equal(session.state().why.stepKind, 'cp1');
  assert.equal(session.state().why.cp1Step.completed, 1);
  assert.deepEqual(session.state().why.cp1.accumulator, {opcode: 0, operand: 42});
  session.destroy(); f.target.destroy();
});
