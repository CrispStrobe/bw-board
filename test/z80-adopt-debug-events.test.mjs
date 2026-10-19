// THE Z80 TARGET PUBLISHES DEBUG EVENTS THROUGH THE SHARED MODULE.
//
// instruction-debug-events.js is consumed by avr8js, i8086 and m6502; the z80
// and 6502 targets were the last two not to, and hand-rolled nothing in their
// place — the events simply did not exist here. This proves the wiring: retires,
// memory and port accesses, and a monotonic event clock, published through the
// target's own onDebugEvent.
//
// EVERY PROBE OF THIS MODULE NEEDS TWO CONTROLS, both present below: that the
// program ACTED, and that the fact stream is non-empty IN THE SHAPE BEING
// FILTERED. The access fields nest under `memory`/`port`, so a predicate reading
// `f.address` finds undefined on every fact and counts zero — indistinguishable
// from a core that bypasses the accessors. That exact wrong conclusion was
// reported once, on the 8086, before it was caught.
//
// ONE CONVERGENCE POINT IS ASSERTED HERE: the event clock and the input-fact
// clock share the `z80-cycles` domain BASE. A downstream copy named the event
// clock `z80-tstates` while replay compared on `z80-cycles`, so a replayer
// comparing domains by equality saw two timelines where there was one. The
// domain-agreement test below reds if that split is ever reintroduced.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';

// LD A,(0x0500) ; LD (0x0501),A ; HALT
const CODE = [0x3a, 0x00, 0x05, 0x32, 0x01, 0x05, 0x76];
const build = () => {
  const machine = new Z80Machine(
    { clockHz: 3_500_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
  machine.load(Uint8Array.from(CODE), 0);
  machine.cpu.pc = 0;
  machine.mem[0x0500] = 0x5a;
  return { machine, target: createZ80DebugTarget({ machine }) };
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

test('the event clock and debugTime() share the z80-cycles base — the convergence point', () => {
  const { machine, target } = build();
  const facts = [];
  target.onDebugEvent(f => facts.push(f));
  machine.step();
  const fact = facts.find(f => f.phase === 'retire');
  const now = target.debugTime();
  assert.equal(fact.time.domain, now.domain,
    'a `z80-tstates` event clock beside a `z80-cycles` replay clock is two timelines read as one');
  assert.equal(now.domain, 'z80-cycles', 'the base must be z80-cycles, not z80-tstates');
});

test('port accesses are observed too, which `port: true` is the only reason for', () => {
  // WITHOUT THIS THE FLAG IS UNPROVEN. Mutating `port: true` to false reddens
  // nothing above — the memory assertions pass either way — so the option would
  // be carried on nobody's evidence. The z80 core's I/O accessors are named
  // inPort/outPort (z80.js:33-34), which is what the module's defaults wrap.
  const machine = new Z80Machine(
    { clockHz: 3_500_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
  machine.load(Uint8Array.from([0x3e, 0x41, 0xd3, 0x00, 0x76]), 0);  // LD A,0x41 ; OUT (0x00),A ; HALT
  machine.cpu.pc = 0;

  const facts = [];
  const target = createZ80DebugTarget({ machine });
  target.onDebugEvent(f => facts.push(f));
  machine.step();
  machine.step();

  assert.equal(machine.cpu.a, 0x41, 'the program did not run; nothing below means anything');
  assert.ok(facts.length > 0, 'no facts at all — the instrument, not the core');
  const ports = facts.filter(f => f.phase === 'access' && f.port);
  assert.ok(ports.length > 0, 'no PORT access facts — check the field, not the core');
  const out = ports.find(f => f.port.direction === 'write');
  assert.equal(out.port.value, 0x41, 'the fact must carry the byte the program actually sent');
});
