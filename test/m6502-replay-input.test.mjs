/**
 * The 6502 target's two replay halves, driven for real.
 *
 * The APPLY half without the RECORD half is a method nothing can feed, and the
 * RECORD half without APPLY is a log nothing can play back; both are declared in
 * `src/debug-replay-contract.js` and this file exercises them against a real
 * M6502Machine rather than a stand-in.
 *
 * THREE THINGS HERE ARE NOT COPIES of the z80's tests, because the machine is
 * different and the difference was measured rather than assumed:
 *
 *   1. `machine.reset()` (m6502-machine.js:510) ADVANCES `cycles` by 7 and does
 *      not reset the chips. So no reset trigger is needed, and a VIA holding a
 *      button level still holds it after a reset — the dedup map stays true.
 *      Both are asserted, because both were reasoned about before being checked.
 *   2. All three producers have a path in THIS build. The first draft of the
 *      apply half refused `m6502.serial` and `m6502.nmi` by name on the strength
 *      of a sentence; `adapter.sendSerial` is m6502-adapter.js:156 and
 *      `cpu.nmi()` is w65c02.js:64. The refusal was the defect, not the gap.
 *   3. Serial is an EVENT, not a level, so it must NOT be deduplicated. The same
 *      byte typed twice is two bytes.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { replayOutcome, replayCapabilities } from '../src/debug-replay-contract.js';

// NOP; JMP $8000 — a program whose only job is to make the clock move.
const SPIN = [0xea, 0x4c, 0x00, 0x80];

/** A running 6502 with a VIA and an ACIA (the default Eater map). */
function makeTarget(config) {
  const adapter = createM6502Adapter(config ? {config} : {});
  const machine = adapter.machine;
  machine.loadRom(SPIN);
  machine.mem[0xfffc] = 0x00; machine.mem[0xfffd] = 0x80; // reset vector
  machine.mem[0xfffa] = 0x34; machine.mem[0xfffb] = 0x12; // NMI vector → $1234
  machine.reset();
  return {adapter, machine, target: createM6502DebugTarget(adapter)};
}

const record = target => {
  const facts = [];
  const stop = target.onDebugInput(f => facts.push(f));
  return {facts, stop};
};

const spin = (machine, steps) => { for (let i = 0; i < steps; i++) machine.step(); };

/** The four active-low button lines, as the VIA actually holds them. */
const buttonPins = machine => {
  const via = machine.chips.via1;
  return [0, 1, 2, 3].map(bit => (via.inA >> bit) & 1);
};

describe('the 6502 target implements both halves', () => {
  it('reports both capabilities', () => {
    const {target} = makeTarget();
    assert.deepEqual(replayCapabilities(target), {applies: true, records: true});
  });
});

describe('buttons: record on one machine, apply on another', () => {
  it('the REPLAYED MACHINE ends in the recorded machine’s input state', () => {
    // The round trip is of the STATE, not of the fact: a test that only checks
    // the returned outcome passes against an applyReplayInput that does nothing.
    const live = makeTarget();
    const {facts} = record(live.target);

    live.target.setButtons(0b0101);
    spin(live.machine, 50);
    live.target.setButtons(0b1010);

    assert.equal(facts.length, 2, 'two distinct masks are two facts');
    assert.deepEqual(facts.map(f => f.payload.mask), [0b0101, 0b1010]);
    const recordedPins = buttonPins(live.machine);
    assert.deepEqual(recordedPins, [1, 0, 1, 0], 'active-low: bits 1 and 3 pressed');

    const replayed = makeTarget();
    assert.deepEqual(buttonPins(replayed.machine), [1, 1, 1, 1], 'starts unpressed');
    for (const fact of facts) {
      assert.equal(replayOutcome(replayed.target.applyReplayInput(fact)).accepted, true);
    }
    assert.deepEqual(buttonPins(replayed.machine), recordedPins,
      'the replayed VIA holds what the recorded VIA held');
  });

  it('an unchanged mask is not a second fact, and a changed one is', () => {
    // Both halves are asserted: with the dedup gate removed the first assertion
    // fails, and with publishInput never called at all the second does.
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    target.setButtons(0b0011);
    spin(machine, 20);
    target.setButtons(0b0011);
    assert.equal(facts.length, 1, 'the same mask twice is one input state');
    target.setButtons(0b0100);
    assert.equal(facts.length, 2, 'a different mask is a new fact');
  });

  it('a REPLAYED input does not come back out of the recorder', () => {
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    const outcome = replayOutcome(
      target.applyReplayInput({producer: 'm6502.buttons', payload: {mask: 0b1100}}));
    assert.equal(outcome.accepted, true);
    assert.equal(facts.length, 0, 'replay seeds the dedup map before applying');
    assert.deepEqual(buttonPins(machine), [1, 1, 0, 0], 'and it did reach the VIA');
  });

  it('unsubscribing stops the listener', () => {
    const {target, machine} = makeTarget();
    const {facts, stop} = record(target);
    target.setButtons(1);
    stop();
    spin(machine, 10);
    target.setButtons(2);
    assert.equal(facts.length, 1, 'nothing arrives after the unsubscribe');
  });

  it('refuses a mask that is not a safe integer, without touching the machine', () => {
    const {target, machine} = makeTarget();
    const before = buttonPins(machine);
    for (const mask of [undefined, null, '3', 1.5, NaN]) {
      const out = replayOutcome(target.applyReplayInput({producer: 'm6502.buttons', payload: {mask}}));
      assert.equal(out.accepted, false, `${String(mask)} must be refused`);
      assert.equal(out.code, 'invalid-replay-input');
    }
    assert.deepEqual(buttonPins(machine), before, 'a refused input changed nothing');
  });

  it('a machine with no VIA REFUSES the input instead of reporting success', () => {
    // m6502-machine.js:606 returns false when it finds no chip with an `inA`.
    // Accepting here would replay a button press into a machine that has no
    // buttons and tell the driver the run matched.
    const {target} = makeTarget({
      clockHz: 1_000_000,
      regions: [
        {kind: 'ram', start: 0x0000, end: 0x3fff},
        {kind: 'rom', start: 0x8000, end: 0xffff}
      ],
      chips: [{kind: 'latch', name: 'leds', at: 0x7000, span: 0x1000}]
    });
    const out = replayOutcome(target.applyReplayInput({producer: 'm6502.buttons', payload: {mask: 1}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'no-input-path');
    assert.match(out.reason, /VIA/);
  });

  it('and a REFUSED live press is not recorded either', () => {
    // The gap the refusal above closes on the apply side, closed on the record
    // side: a fact for an input no chip took would replay a press that never
    // happened, and the log would be longer than the run.
    const {target} = makeTarget({
      clockHz: 1_000_000,
      regions: [
        {kind: 'ram', start: 0x0000, end: 0x3fff},
        {kind: 'rom', start: 0x8000, end: 0xffff}
      ],
      chips: [{kind: 'latch', name: 'leds', at: 0x7000, span: 0x1000}]
    });
    const {facts} = record(target);
    assert.equal(target.setButtons(0b0001), false, 'the machine did not take it');
    assert.equal(facts.length, 0, 'so it is not a fact');
  });
});

describe('serial is an EVENT, and events are not deduplicated', () => {
  it('the same byte twice is two facts and two bytes at the ACIA', () => {
    const live = makeTarget();
    const {facts} = record(live.target);
    assert.equal(live.target.sendSerial(0x41), true);
    assert.equal(live.target.sendSerial(0x41), true);
    assert.equal(facts.length, 2, 'a repeated byte is a repeated byte, not one state');
    assert.deepEqual(facts.map(f => f.payload.byte), [0x41, 0x41]);
    assert.equal(facts[0].producer, 'm6502.serial');

    const replayed = makeTarget();
    const acia = replayed.machine.chips.acia1;
    assert.equal(acia.rdrf, false, 'idle before replay');
    for (const fact of facts) {
      assert.equal(replayOutcome(replayed.target.applyReplayInput(fact)).accepted, true);
    }
    assert.equal(acia.rdrf, true, 'the replayed ACIA has data ready');
    assert.equal(acia.read(0), 0x41, 'and it is the recorded byte');
  });

  it('a replayed byte is not re-recorded', () => {
    // applyReplayInput deliberately does NOT route through target.sendSerial,
    // which records: a second replay pass would otherwise double every byte.
    const {target} = makeTarget();
    const {facts} = record(target);
    assert.equal(replayOutcome(
      target.applyReplayInput({producer: 'm6502.serial', payload: {byte: 0x37}})).accepted, true);
    assert.equal(facts.length, 0);
  });

  it('refuses a byte outside 0..255', () => {
    const {target} = makeTarget();
    for (const byte of [-1, 256, 1.5, undefined, '0x41']) {
      const out = replayOutcome(target.applyReplayInput({producer: 'm6502.serial', payload: {byte}}));
      assert.equal(out.accepted, false, `${String(byte)} must be refused`);
      assert.equal(out.code, 'invalid-replay-input');
    }
  });

  it('refuses when no chip in the config can receive a byte', () => {
    const {target} = makeTarget({
      clockHz: 1_000_000,
      regions: [
        {kind: 'ram', start: 0x0000, end: 0x3fff},
        {kind: 'rom', start: 0x8000, end: 0xffff}
      ],
      chips: [{kind: 'via', name: 'via1', at: 0x6000}]
    });
    const out = replayOutcome(target.applyReplayInput({producer: 'm6502.serial', payload: {byte: 0x41}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'no-input-path');
  });
});

describe('nmi reaches the CPU through the route the machine itself uses', () => {
  it('applies through cpu.nmi() and lands on the vector', () => {
    const {target, machine} = makeTarget();
    spin(machine, 5);
    assert.notEqual(machine.cpu.pc, 0x1234);
    assert.equal(replayOutcome(target.applyReplayInput({producer: 'm6502.nmi', payload: {}})).accepted, true);
    assert.equal(machine.cpu.pc, 0x1234, 'PC is at the NMI vector at $FFFA');
  });

  it('is NOT recorded, because nothing on this target produces one', () => {
    // The vsync NMI (m6502-machine.js:705) is a MACHINE event, not host input:
    // replay regenerates it, so recording it would double it.
    const {target} = makeTarget();
    const {facts} = record(target);
    target.applyReplayInput({producer: 'm6502.nmi', payload: {}});
    assert.equal(facts.length, 0);
  });
});

describe('an unknown producer is refused by name', () => {
  it('names the producer it could not place', () => {
    const {target} = makeTarget();
    const out = replayOutcome(target.applyReplayInput({producer: 'm6502.paddle', payload: {}}));
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'unsupported-replay-input');
    assert.match(out.reason, /m6502\.paddle/);
  });

  it('a fact with no producer at all is refused, not thrown on', () => {
    const {target} = makeTarget();
    for (const bad of [undefined, null, {}, {payload: {}}]) {
      const out = replayOutcome(target.applyReplayInput(bad));
      assert.equal(out.accepted, false);
      assert.match(out.reason, /\(none\)/);
    }
  });
});

describe('the time stamp, and the rewind it can and cannot see', () => {
  it('stamps ticks from the machine clock and hz from the config', () => {
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    spin(machine, 40);
    target.setButtons(1);
    assert.equal(facts[0].time.ticks, machine.cycles);
    assert.equal(facts[0].time.hz, 1_000_000);
    assert.equal(facts[0].time.domain, 'm6502-cycles');
    assert.ok(facts[0].time.ticks > 0, 'the clock actually moved');
  });

  it('A VISIBLE REWIND changes the domain and CLEARS the dedup map', () => {
    // m6502-machine.js:806 (`this.cycles = s.cycles` in loadState) is this
    // machine's only rewind. Clearing the map matters as much as the domain: a
    // map surviving the rewind would hold values from an abandoned timeline and
    // silently drop the first genuine change that happened to match one.
    const {target, machine} = makeTarget();
    const {facts} = record(target);

    spin(machine, 20);
    const snap = machine.saveState();
    spin(machine, 200);
    target.setButtons(0b0001);            // recorded high on the timeline
    const highTicks = facts[0].time.ticks;

    machine.loadState(snap);
    assert.ok(machine.cycles < highTicks, 'the restore really moved the clock back');
    target.setButtons(0b0001);            // the SAME mask, on the new timeline

    assert.equal(facts.length, 2, 'the cleared map lets the repeat through');
    assert.equal(facts[1].time.domain, 'm6502-cycles-rewind-1');
    assert.ok(facts[1].time.ticks < highTicks);
  });

  it('THE LIMIT, pinned: a rewind that runs past its own high-water mark is invisible', () => {
    // Not a bug being hidden — a boundary being stated. From this side the
    // clock only went forward, so nothing distinguishes it from progress.
    // Closing it needs a signal from loadState itself.
    const {target, machine} = makeTarget();
    const {facts} = record(target);

    target.setButtons(0b0001);
    const snap = machine.saveState();
    spin(machine, 300);
    machine.loadState(snap);
    spin(machine, 600);                   // now PAST where the last fact was stamped
    target.setButtons(0b0010);

    assert.equal(facts.length, 2);
    assert.equal(facts[1].time.domain, 'm6502-cycles',
      'monotonic from here: the epoch does not bump, and this is the known limit');
  });

  it('reset() advances the clock rather than rewinding it, and keeps the VIA', () => {
    // The 8051 needs an epoch trigger on reset because its clock goes back to
    // zero. This one does not: m6502-machine.js:510 does `this.cycles += 7` and
    // resets only the CPU, so the chips — and the button levels they hold —
    // survive. Asserted because it was reasoned about before it was measured.
    const {target, machine} = makeTarget();
    const {facts} = record(target);
    target.setButtons(0b0001);
    const before = machine.cycles;
    const pins = buttonPins(machine);

    target.reset();

    assert.ok(machine.cycles > before, 'reset advanced the clock');
    assert.deepEqual(buttonPins(machine), pins, 'the VIA still holds the button level');
    target.setButtons(0b0001);
    assert.equal(facts.length, 1, 'so the same mask is still the same state');
    assert.equal(facts[0].time.domain, 'm6502-cycles', 'and no epoch was bumped');
  });
});
