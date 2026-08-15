// Boundary-D on rp2040js, proven against HAND-ASSEMBLED Thumb — the same
// no-toolchain oracle discipline as the adapter tests. Two programs, both
// loaded at RAM_START (0x20000000):
//
// BLINK — GP25 via the SIO OUT_XOR toggle idiom, tight loop:
//   0x00  0x2005  movs r0, #5
//   0x02  0x4904  ldr  r1, =0x400140CC   (lit @0x14)
//   0x04  0x6008  str  r0, [r1]          ; funcsel = SIO
//   0x06  0x2001  movs r0, #1
//   0x08  0x0640  lsls r0, r0, #25
//   0x0A  0x4903  ldr  r1, =0xd0000000   (lit @0x18)
//   0x0C  0x6248  str  r0, [r1, #0x24]   ; GPIO_OE_SET
//   loop:
//   0x0E  0x61C8  str  r0, [r1, #0x1C]   ; GPIO_OUT_XOR  <- code bp target
//   0x10  0xE7FD  b    loop
//   The loop is exactly 3 cycles (SIO str 1 + taken b 2) — an arithmetic
//   oracle for "one lap ran between two halts".
//
// SCHED — a one-task scheduler in miniature, state var at 0x20003000:
//   0x00  0x2001  movs r0, #1
//   0x02  0x4905  ldr  r1, =0x20003000   (lit @0x18)
//   0x04  0x6008  str  r0, [r1]          ; state := 1
//   0x06  0x2005  movs r0, #5
//   0x08  0x4904  ldr  r1, =0x400140CC   (lit @0x1C)
//   0x0A  0x6008  str  r0, [r1]
//   0x0C  0x2001  movs r0, #1
//   0x0E  0x0640  lsls r0, r0, #25
//   0x10  0x4903  ldr  r1, =0xd0000000   (lit @0x20)
//   0x12  0x6248  str  r0, [r1, #0x24]
//   yield:
//   0x14  0x61C8  str  r0, [r1, #0x1C]   <- the yield address
//   0x16  0xE7FD  b    yield
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRp2040jsAdapter, RAM_START } from '../src/rp2040js-adapter.js';
import { createRp2040jsDebugTarget } from '../src/rp2040js-debug.js';

const BLINK = new Uint16Array([
  0x2005, 0x4904, 0x6008, 0x2001, 0x0640, 0x4903, 0x6248,
  0x61C8, 0xE7FD, 0x0000,
  0x40CC, 0x4001, 0x0000, 0xd000,
]);

const SCHED = new Uint16Array([
  0x2001, 0x4905, 0x6008, 0x2005, 0x4904, 0x6008,
  0x2001, 0x0640, 0x4903, 0x6248, 0x61C8, 0xE7FD,
  0x3000, 0x2000, 0x40CC, 0x4001, 0x0000, 0xd000,
]);

const SCHED_SYMBOLS = {
  scheduler: {
    tasks: [{
      name: 'main0',
      state: { addr: 0x20003000, size: 2 },
      yields: [{ state: 1, addr: RAM_START + 0x14 }],
    }],
  },
};

function make(program, symbols) {
  const adapter = createRp2040jsAdapter({ program });
  const target = createRp2040jsDebugTarget(adapter, { symbols });
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
  const handle = target.setBreakpoint({ kind: 'code', addr: RAM_START + 0x0E });
  assert.equal(typeof handle, 'number');
  target.run();
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.state(), 'halted');
  assert.equal(target.regs().pc, RAM_START + 0x0E, 'stopped ON the breakpoint');
  assert.equal(halts.length, 1);
  assert.equal(halts[0].cause, 'breakpoint');
  assert.equal(halts[0].bp, handle);
  assert.equal(halts[0].bpKind, 'code');
});

test('resume executes THROUGH the breakpoint; one lap is exactly 3 cycles', () => {
  const { target, halts } = make(BLINK);
  target.setBreakpoint({ kind: 'code', addr: RAM_START + 0x0E });
  target.run();
  target.runFor(1_000_000);
  const cycles1 = target.regs().cycles;
  target.run();
  assert.equal(target.runFor(1_000_000), 'halted', 'came around the loop');
  assert.equal(target.regs().pc, RAM_START + 0x0E);
  // SIO str (1 cycle) + taken b (2 cycles) — the hand-computed lap.
  assert.equal(target.regs().cycles - cycles1, 3, 'one lap of the XOR loop');
  assert.equal(halts.length, 2);
});

test('insn step: exactly one instruction, announced as a step', () => {
  const { target, halts } = make(BLINK);
  const pc0 = target.regs().pc;
  assert.equal(target.step('insn', 1), undefined);
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.regs().pc, pc0 + 2, 'movs is one halfword');
  assert.equal(target.regs().cycles, 1, 'movs costs 1 cycle');
  assert.equal(halts[0].cause, 'step');
  assert.equal(target.state(), 'halted');
});

test('halting freezes time; resuming continues it (freeze-timers policy)', () => {
  const { target } = make(BLINK);
  target.run();
  target.runFor(50_000);
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
  assert.equal(target.regs().pc, RAM_START + 0x14, 'halted at the yield address');
  assert.equal(halts[0].bpKind, 'yield');
  // The state variable was written BEFORE the yield: position sees it.
  assert.deepEqual(halts[0].tasks, [{ task: 'main0', state: 1 }]);
  assert.deepEqual(target.position(), [{ task: 'main0', state: 1 }]);
});

test('block step: runs to the next yield without an explicit breakpoint', () => {
  const { target, halts } = make(SCHED, SCHED_SYMBOLS);
  assert.equal(target.step('block'), undefined);
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.regs().pc, RAM_START + 0x14);
  assert.equal(halts[0].cause, 'step');
  // The yield loops back to itself: the next block step comes around the
  // branch and halts at the same address, exactly 3 cycles later.
  const cycles1 = target.regs().cycles;
  assert.equal(target.step('block'), undefined);
  assert.equal(target.runFor(1_000_000), 'halted');
  assert.equal(target.regs().pc, RAM_START + 0x14);
  assert.equal(target.regs().cycles - cycles1, 3, 'one lap of the yield loop');
});

test('refusals are stated, not silent', () => {
  const { target } = make(BLINK); // no symbols
  assert.ok(target.step('block').unsupported, 'block without symbols refuses');
  assert.ok(target.step('line').unsupported, 'line is not offered');
  assert.ok(target.setBreakpoint({ kind: 'yield', task: 'x', state: 1 }).unsupported);
  assert.ok(target.setBreakpoint({ kind: 'code', addr: RAM_START + 1 }).unsupported,
    'odd (Thumb-flagged) address refused');
  assert.ok(target.readMem('xram', RAM_START, 1).unsupported, 'no such space on ARM');
  assert.ok(target.writeMem('code', RAM_START, new Uint8Array(1)).refused);
  assert.ok(target.writeMem('sram', 0x10000000, new Uint8Array(1)).refused,
    'flash is not SRAM, even though the address space is flat');
});

test('memory: sram round-trips; code reads back the hand-assembled bytes', () => {
  const { target } = make(BLINK);
  target.writeMem('sram', 0x20002000, new Uint8Array([0xAB, 0xCD]));
  assert.deepEqual(Array.from(target.readMem('sram', 0x20002000, 2)), [0xAB, 0xCD]);
  // Program halfwords little-endian: 0x2005 → bytes 05 20, 0x4904 → 04 49.
  assert.deepEqual(Array.from(target.readMem('code', RAM_START, 4)), [0x05, 0x20, 0x04, 0x49]);
});

test('clearBreakpoint: the program runs through the former address', () => {
  const { target } = make(BLINK);
  const h = target.setBreakpoint({ kind: 'code', addr: RAM_START + 0x0E });
  target.clearBreakpoint(h);
  target.run();
  assert.equal(target.runFor(100_000), 'budget', 'no halt: breakpoint is gone');
  assert.equal(target.state(), 'running');
});

test('the board follows the debugger: GP25 state visible at a breakpoint', () => {
  const adapter = createRp2040jsAdapter({ program: BLINK });
  const target = createRp2040jsDebugTarget(adapter);
  const calls = [];
  adapter.attachBoard({
    setPin: (name, mode, high) => calls.push({ name, mode, high }),
    advanceTo: (t) => calls.push({ t }),
  });
  // Break AFTER the first toggle: the b at 0x10 follows the OUT_XOR str.
  target.setBreakpoint({ kind: 'code', addr: RAM_START + 0x10 });
  target.run();
  assert.equal(target.runFor(1_000_000), 'halted');
  const gp25 = calls.filter(c => c.name === 'GP25');
  assert.ok(gp25.length > 0, 'the pin edge reached the board before the halt');
  assert.equal(gp25[gp25.length - 1].high, true, 'GP25 high after the toggle');
  const times = calls.filter(c => c.t !== undefined);
  assert.equal(times[times.length - 1].t, target.timeNs(),
    'board time synced to program time at the halt');
});

test('through the REAL session layer: run, breakpoint halt, position, resume', async () => {
  const { createDebugSession } = await import('../src/debug-session.js');
  const adapter = createRp2040jsAdapter({ program: SCHED });
  const target = createRp2040jsDebugTarget(adapter, { symbols: SCHED_SYMBOLS });
  const session = createDebugSession(target);
  target.setBreakpoint({ kind: 'yield', task: 'main0', state: 1 });
  session.start();
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
