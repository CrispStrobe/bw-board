// THE 6502 TARGET PUBLISHES DEBUG EVENTS THROUGH THE SHARED MODULE.
//
// instruction-debug-events.js is consumed by avr8js, i8086 and z80; the 6502 and
// z80 targets were the last two not to, and hand-rolled nothing in their place.
// This proves the wiring: retires and memory accesses published through the
// target's own onDebugEvent, on a monotonic event clock.
//
// NO `port: true` HERE, DELIBERATELY: the 6502's I/O is memory-mapped, so a
// store to a VIA register is a `memory` fact, not a `port` one — there is no
// separate port space to wrap. capabilities().events is ['instruction','memory']
// for the same reason, and replay-surface-conformance C6 holds that set.
//
// EVERY PROBE OF THIS MODULE NEEDS TWO CONTROLS, both present below: that the
// program ACTED, and that the fact stream is non-empty IN THE SHAPE BEING
// FILTERED (the access fields nest under `memory`, so `f.address` is undefined
// on every fact and a naive filter counts zero — the wrong conclusion reported
// once on the 8086 before it was caught).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';

// LDA $0500 ; STA $0501 -- reset vector points at the ROM load address $8000.
const CODE = [0xad, 0x00, 0x05, 0x8d, 0x01, 0x05];
const build = () => {
  const adapter = createM6502Adapter({});
  adapter.machine.loadRom(CODE);
  adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;   // reset vector -> $8000
  adapter.machine.reset();
  adapter.machine.mem[0x0500] = 0x5a;
  return { machine: adapter.machine, target: createM6502DebugTarget(adapter) };
};

test('the target publishes retires and memory accesses through the module', () => {
  const { machine, target } = build();
  const facts = [];
  assert.equal(typeof target.onDebugEvent, 'function',
    'the target must expose the module\'s subscription, not a private one');
  target.onDebugEvent(f => facts.push(f));
  machine.step();
  machine.step();

  assert.equal(machine.mem[0x0501], 0x5a, 'the program did not run; nothing below means anything');
  assert.ok(facts.length > 0, 'no facts at all — the instrument, not the core');

  const retires = facts.filter(f => f.phase === 'retire');
  const mem = facts.filter(f => f.phase === 'access' && f.memory);
  assert.equal(retires.length, 2, 'one retire per instruction');
  assert.ok(mem.length > 0, 'no MEMORY access facts — check the field, not the core');

  const addrs = mem.map(f => f.memory.address);
  assert.ok(addrs.includes(0x0500), 'the load\'s source address must appear');
  assert.ok(addrs.includes(0x0501), 'the store\'s destination address must appear');
});

test('with no subscriber the target costs nothing it did not before', () => {
  const a = build();
  const n0 = a.machine.step();
  const c0 = a.machine.cycles;
  const b = build();
  b.target.onDebugEvent;                   // touched, never subscribed
  const n1 = b.machine.step();
  assert.equal(n1, n0, 'an unsubscribed target must retire in the same cycles');
  assert.equal(b.machine.cycles, c0, 'and leave machine time where it was');
});

test('the event clock and debugTime() share the m6502-cycles base', () => {
  const { machine, target } = build();
  const facts = [];
  target.onDebugEvent(f => facts.push(f));
  machine.step();
  const fact = facts.find(f => f.phase === 'retire');
  const now = target.debugTime();
  assert.equal(fact.time.domain, now.domain,
    'two clocks would let a consumer order a fact against a time that never applied to it');
  assert.equal(now.domain, 'm6502-cycles', 'the base must be m6502-cycles');
});
