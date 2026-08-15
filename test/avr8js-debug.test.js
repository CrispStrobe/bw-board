// Boundary-D on avr8js, proven against HAND-ASSEMBLED programs — the same
// no-toolchain oracle discipline as the adapter tests. Two programs:
//
// BLINK (from avr8js-adapter.test.js):
//   word 0 (byte 0)  SBI DDRB,5   0x9A25
//   word 1 (byte 2)  SBI PINB,5   0x9A1D   <- code breakpoint target
//   word 2 (byte 4)  LDI r24,255  0xEF8F
//   word 3 (byte 6)  DEC r24      0x958A
//   word 4 (byte 8)  BRNE .-2     0xF7F1
//   word 5 (byte 10) RJMP .-5     0xCFFB
//
// SCHED — a one-task scheduler in miniature, state var at SRAM 0x0100:
//   word 0 (byte 0)  LDI r16,1        0xE001
//   word 1 (byte 2)  STS 0x0100,r16   0x9300 0x0100   (state := 1)
//   word 3 (byte 6)  SBI DDRB,5       0x9A25
//   word 4 (byte 8)  SBI PINB,5       0x9A1D   <- the yield address (byte 8)
//   word 5 (byte 10) RJMP .-2         0xCFFE   (back to word 4)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { createAvr8jsDebugTarget } from '../src/avr8js-debug.js';

const BLINK = new Uint16Array([0x9A25, 0x9A1D, 0xEF8F, 0x958A, 0xF7F1, 0xCFFB]);
const SCHED = new Uint16Array([0xE001, 0x9300, 0x0100, 0x9A25, 0x9A1D, 0xCFFE]);

const SCHED_SYMBOLS = {
  scheduler: {
    tasks: [{
      name: 'main0',
      state: { addr: 0x0100, size: 2 },
      yields: [{ state: 1, addr: 8 }],
    }],
  },
};

function make(program, symbols) {
  const adapter = createAvr8jsAdapter({ program });
  const target = createAvr8jsDebugTarget(adapter, { symbols });
  const halts = [];
  target.onHalt(why => halts.push(why));
  return { adapter, target, halts };
}

test('capabilities: declares what it has, not what it wishes', () => {
  const { target } = make(BLINK);
  const caps = target.capabilities();
  assert.deepEqual(caps.steps, ['insn', 'block', 'over', 'out']);
  assert.deepEqual(caps.breakpoints, ['code', 'yield', 'write']);
  assert.equal(caps.timeFreezes, true);
  assert.deepEqual(caps.consumes, []);
});

test('code breakpoint: halts AT the address, before executing it', () => {
  const { target, halts } = make(BLINK);
  const handle = target.setBreakpoint({ kind: 'code', addr: 2 }); // SBI PINB,5
  assert.equal(typeof handle, 'number');
  target.run();
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.state(), 'halted');
  assert.equal(target.regs().pc, 2, 'stopped ON the breakpoint, not past it');
  assert.equal(halts.length, 1);
  assert.equal(halts[0].cause, 'breakpoint');
  assert.equal(halts[0].bp, handle);
  assert.equal(halts[0].bpKind, 'code');
});

test('resume from a breakpoint executes THROUGH it and re-fires next lap', () => {
  const { target, halts } = make(BLINK);
  target.setBreakpoint({ kind: 'code', addr: 2 });
  target.run();
  target.runFor(1_000_000);
  const cyclesAtFirst = target.regs().cycles;
  target.run();
  assert.equal(target.runFor(1_000_000), 'halted', 'came around the loop');
  assert.equal(target.regs().pc, 2);
  assert.ok(target.regs().cycles > cyclesAtFirst + 500,
    'a whole delay loop ran between the two halts');
  assert.equal(halts.length, 2);
});

test('insn step: exactly one instruction, announced as a step', () => {
  const { target, halts } = make(BLINK);
  const pc0 = target.regs().pc;
  assert.equal(target.step('insn', 1), undefined);
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.regs().pc, pc0 + 2, 'SBI is one word');
  assert.equal(target.regs().cycles, 2, 'SBI costs 2 cycles');
  assert.equal(halts[0].cause, 'step');
  assert.equal(target.state(), 'halted');
});

test('halting freezes time; resuming continues it (freeze-timers policy)', () => {
  const { target } = make(BLINK);
  target.run();
  target.runFor(50_000); // 50 µs of budget
  const t1 = target.timeNs();
  target.halt();
  const t2 = target.timeNs();
  assert.equal(t1, t2, 'no time passes while halted');
  target.run();
  target.runFor(50_000);
  assert.ok(target.timeNs() > t2, 'time flows again after resume');
});

test('yield breakpoint + position: the scheduler contract end to end', () => {
  const { target, halts } = make(SCHED, SCHED_SYMBOLS);
  const handle = target.setBreakpoint({ kind: 'yield', task: 'main0', state: 1 });
  assert.equal(typeof handle, 'number', `got ${JSON.stringify(handle)}`);
  target.run();
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.regs().pc, 8, 'halted at the yield address');
  assert.equal(halts[0].bpKind, 'yield');
  // The state variable was written BEFORE the yield: position sees it.
  assert.deepEqual(halts[0].tasks, [{ task: 'main0', state: 1 }]);
  assert.deepEqual(target.position(), [{ task: 'main0', state: 1 }]);
});

test('block step: runs to the next yield without an explicit breakpoint', () => {
  const { target, halts } = make(SCHED, SCHED_SYMBOLS);
  assert.equal(target.step('block'), undefined);
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.regs().pc, 8);
  assert.equal(halts[0].cause, 'step');
  // Again: the yield loops back to itself, so the next block step comes
  // around the RJMP and halts at the same address one lap later.
  const cycles1 = target.regs().cycles;
  assert.equal(target.step('block'), undefined);
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.regs().pc, 8);
  assert.ok(target.regs().cycles > cycles1, 'a lap of the loop ran');
});

test('refusals are stated, not silent', () => {
  const { target } = make(BLINK); // no symbols
  assert.ok(target.step('block').unsupported, 'block without symbols refuses');
  assert.ok(target.step('line').unsupported, 'line is not offered');
  assert.ok(target.setBreakpoint({ kind: 'yield', task: 'x', state: 1 }).unsupported);
  assert.ok(target.setBreakpoint({ kind: 'code', addr: 3 }).unsupported,
    'odd byte address refused');
  assert.ok(target.readMem('xram', 0, 1).unsupported, 'no such space on AVR');
  assert.ok(target.writeMem('code', 0, new Uint8Array(1)).refused);
});

test('memory: sram round-trips; code reads back the hand-assembled words', () => {
  const { target } = make(BLINK);
  target.writeMem('sram', 0x0200, new Uint8Array([0xAB, 0xCD]));
  assert.deepEqual(Array.from(target.readMem('sram', 0x0200, 2)), [0xAB, 0xCD]);
  // Flash bytes little-endian: word 0 = 0x9A25 → bytes 25 9A.
  assert.deepEqual(Array.from(target.readMem('code', 0, 4)), [0x25, 0x9A, 0x1D, 0x9A]);
});

test('clearBreakpoint: the program runs through the former address', () => {
  const { target } = make(BLINK);
  const h = target.setBreakpoint({ kind: 'code', addr: 2 });
  target.clearBreakpoint(h);
  target.run();
  assert.equal(target.runFor(100_000), 'budget', 'no halt: breakpoint is gone');
  assert.equal(target.state(), 'running');
});

test('the board follows the debugger: LED state visible at a breakpoint', () => {
  const adapter = createAvr8jsAdapter({ program: BLINK });
  const target = createAvr8jsDebugTarget(adapter);
  const calls = [];
  adapter.attachBoard({
    setPin: (name, mode, high) => calls.push({ name, mode, high }),
    advanceTo: (t) => calls.push({ t }),
  });
  // Break AFTER the first toggle: LDI at byte 4 follows SBI PINB,5.
  target.setBreakpoint({ kind: 'code', addr: 4 });
  target.run();
  assert.equal(target.runFor(1_000_000), 'halted');
  const d13 = calls.filter(c => c.name === 'D13');
  assert.ok(d13.length > 0, 'the pin edge reached the board before the halt');
  assert.equal(d13[d13.length - 1].high, true, 'D13 high after the toggle');
  const times = calls.filter(c => c.t !== undefined);
  assert.equal(times[times.length - 1].t, target.timeNs(),
    'board time synced to program time at the halt');
});

test('through the REAL session layer: run, breakpoint halt, position, resume', async () => {
  const { createDebugSession } = await import('../src/debug-session.js');
  const adapter = createAvr8jsAdapter({ program: SCHED });
  const target = createAvr8jsDebugTarget(adapter, { symbols: SCHED_SYMBOLS });
  const session = createDebugSession(target);
  target.setBreakpoint({ kind: 'yield', task: 'main0', state: 1 });
  session.start();
  // Pump like a host frame loop until the yield breakpoint fires.
  let state;
  for (let i = 0; i < 50; i++) {
    session.pump();
    state = session.state();
    if (state.intent === 'paused') break;
  }
  assert.equal(state.intent, 'paused', 'session paused at the yield');
  assert.deepEqual(state.tasks, [{ task: 'main0', state: 1 }],
    'the session reports Level-1 position from the halt');
  session.resume();
  session.pump();
  assert.equal(session.state().intent, 'paused', 're-fired one lap later');
});
