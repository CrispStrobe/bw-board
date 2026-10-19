/**
 * Serial is recorded AT THE ADAPTER, because that is where the bypass was.
 *
 * Both targets used to record inside their own `sendSerial` and both said so in
 * the same words: "a caller holding the adapter can still call
 * adapter.sendSerial directly and will not be recorded. Closing that means
 * recording inside the adapter." A downstream consumer had already closed it
 * exactly that way, and this is that approach brought back upstream — so these
 * tests are the ones the upstream comment was an apology for.
 *
 * FOUR PROPERTIES, and the fourth is the one that was got wrong first.
 *
 *   1. A caller reaching PAST the target to the adapter is recorded.
 *   2. A caller coming THROUGH the target is recorded exactly once, not twice.
 *   3. A REPLAYED byte is not recorded at all.
 *   4. Two targets over one adapter: a live byte reaches BOTH recorders, and a
 *      replay into one reaches NEITHER.
 *
 * The first version of the wrap satisfied 1-3 and failed 4: each target
 * captured the previous target's WRAPPER as its replay route, so replaying into
 * the second target published a fact into the first one's log. Measured, not
 * reasoned about — it takes five lines to construct and it reproduced
 * immediately.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createZ80Adapter } from '../src/z80-adapter.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { createI8086Adapter } from '../src/i8086-adapter.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { SERIALSHELL8086 } from '../src/i8086-machine.js';
import { replayOutcome } from '../src/debug-replay-contract.js';

const TARGETS = {
  z80: {
    adapter: () => createZ80Adapter({}),          // SEARLE: carries an ACIA
    target: createZ80DebugTarget,
    producer: 'z80.serial'
  },
  m6502: {
    adapter: () => {
      const adapter = createM6502Adapter({});     // EATER: via1 + acia1
      adapter.machine.loadRom([0xea, 0x4c, 0x00, 0x80]);
      adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;
      adapter.machine.reset();
      return adapter;
    },
    target: createM6502DebugTarget,
    producer: 'm6502.serial'
  },
  i8086: {
    adapter: () => {
      const img = new Uint8Array(0x8000);
      img.set([0x90, 0xeb, 0xfd], 0);
      img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
      const adapter = createI8086Adapter({config: SERIALSHELL8086, rom: img});
      adapter.machine.reset(); adapter.machine.step();
      return adapter;
    },
    target: createI8086DebugTarget,
    producer: 'i8086.serial'
  }
};

const record = target => {
  const facts = [];
  target.onDebugInput(f => facts.push(f));
  return facts;
};

for (const [name, spec] of Object.entries(TARGETS)) {
  describe(`${name}: serial recording lives at the adapter`, () => {
    it('A CALLER REACHING PAST THE TARGET IS RECORDED — the bypass is closed', () => {
      const adapter = spec.adapter();
      const target = spec.target(adapter);
      const facts = record(target);

      assert.equal(adapter.sendSerial(0x41), true, 'the adapter still delivers the byte');
      assert.equal(facts.length, 1, 'and the fact is in the log');
      assert.equal(facts[0].producer, spec.producer);
      assert.equal(facts[0].payload.byte, 0x41);
    });

    it('a caller coming through the target is recorded ONCE, not twice', () => {
      // Both would record if the target's own method still published as well as
      // delegating to the wrapper.
      const adapter = spec.adapter();
      const target = spec.target(adapter);
      const facts = record(target);

      assert.equal(target.sendSerial(0x42), true);
      assert.equal(facts.length, 1, 'one byte, one fact');
    });

    it('a REPLAYED byte is not recorded', () => {
      const adapter = spec.adapter();
      const target = spec.target(adapter);
      const facts = record(target);

      const outcome = replayOutcome(
        target.applyReplayInput({producer: spec.producer, payload: {byte: 0x43}}));
      assert.equal(outcome.accepted, true, `replay was refused: ${outcome.reason}`);
      assert.equal(facts.length, 0, 'a replayed byte must not come back out of the recorder');
    });

    it('TWO TARGETS OVER ONE ADAPTER: a live byte reaches both, a replay reaches neither', () => {
      // The property the first version of the wrap failed. Each target keeps
      // TWO functions: the one it found at construction, so wrapping chains and
      // both recorders see a live byte; and the adapter's true original, so a
      // replay bypasses every wrapper including the other target's.
      const adapter = spec.adapter();
      const first = spec.target(adapter);
      const second = spec.target(adapter);
      const factsFirst = record(first);
      const factsSecond = record(second);

      assert.equal(first.sendSerial(0x44), true);
      assert.equal(factsFirst.length, 1, 'the first target recorded the live byte');
      assert.equal(factsSecond.length, 1, 'and so did the second');

      assert.equal(replayOutcome(
        second.applyReplayInput({producer: spec.producer, payload: {byte: 0x45}})).accepted, true);
      assert.equal(factsSecond.length, 1, 'replay did not record on the target replaying');
      assert.equal(factsFirst.length, 1,
        'and it did not leak a fact into the OTHER target sharing the adapter');
    });

    it('REPLAY GOES THROUGH THE ADAPTER, not around it', () => {
      // Pinned because on one target the two routes are currently the same
      // function: i8086-adapter.js:74 is a one-line delegation to
      // machine.serialIn, so replacing the replay route with a direct
      // machine.serialIn call there is an INERT mutation — it reports MISSED
      // the way a blind test does, and it is neither. It stops being inert the
      // moment an adapter grows logic of its own, as the z80's has (a CP/M mode
      // key queue that machine.serialIn knows nothing about).
      //
      // A counting stub installed BEFORE construction is what makes the route
      // observable regardless.
      const adapter = spec.adapter();
      const original = adapter.sendSerial.bind(adapter);
      let through = 0;
      adapter.sendSerial = byte => { through++; return original(byte); };

      const target = spec.target(adapter);
      const facts = record(target);
      assert.equal(replayOutcome(
        target.applyReplayInput({producer: spec.producer, payload: {byte: 0x46}})).accepted, true);
      assert.equal(through, 1, 'the replay was delivered through the adapter');
      assert.equal(facts.length, 0, 'and it was not recorded');
    });

    it('a target over a bare {machine} still refuses rather than throwing', () => {
      // No adapter, so nothing to wrap and nothing to unwrap.
      const target = spec.target({machine: {cpu: {}}});
      assert.equal(target.sendSerial(0x41), false);
      const outcome = replayOutcome(
        target.applyReplayInput({producer: spec.producer, payload: {byte: 0x41}}));
      assert.equal(outcome.accepted, false);
      assert.equal(outcome.code, 'no-input-path');
    });

    it('a byte NO CHIP TOOK is not recorded', () => {
      // The deliberate difference from the downstream version, which publishes
      // BEFORE calling the real method because its listeners can veto an input.
      // This one publishes after, and only on acceptance: a logged byte nothing
      // received would replay a character that never arrived.
      const adapter = spec.adapter();
      // Remove every receiver, so the adapter's own scan finds nothing.
      for (const chipName of Object.keys(adapter.machine.chips)) {
        const chip = adapter.machine.chips[chipName];
        if (typeof chip.rxPush === 'function') delete adapter.machine.chips[chipName];
      }
      const target = spec.target(adapter);
      const facts = record(target);

      assert.equal(adapter.sendSerial(0x41), false, 'nothing took it');
      assert.equal(facts.length, 0, 'so it is not a fact');
    });
  });
}
