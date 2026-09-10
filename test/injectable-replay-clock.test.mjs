/**
 * The replay surface's clock is INJECTABLE, and the era gate is DERIVED from
 * the clock's domain string rather than from a tick regression this target can
 * see for itself.
 *
 * WHY THE DESIGN IS THIS AND NOT "USE THE CALLER'S debugTime()". A record half
 * needs two things from a clock: a stamp, and a signal that the timeline moved
 * so the dedup map can be cleared. A consumer's shared clock offers a pure READ
 * — it reports the era, it does not detect a change — so a target that simply
 * stamped from it would get the domain right and never clear the map, which is
 * the defect these targets already fixed once: a level from an abandoned
 * timeline suppresses the first genuine change afterwards, silently, and the
 * log comes out shorter than the run.
 *
 * Watching the DOMAIN STRING solves both. It needs nothing from the clock but
 * the stamp it already returns, and it inherits every trigger that clock has —
 * including an EXPLICIT one from a restore, which is the signal the design note
 * says is required to close the invisible-rewind limit and which no target can
 * produce for itself.
 *
 * THE CENTRAL TEST IS THE ONE THAT MOVES TICKS FORWARD. A rewind signalled only
 * through the domain, with the clock running monotonically upward, is the exact
 * case a tick-regression check cannot see — and a fixture that moved ticks
 * backwards as well would pass whether or not the domain was ever consulted.
 * Every era change below is asserted to have happened with the ticks INCREASING.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { replayOutcome } from '../src/debug-replay-contract.js';
import { readFileSync } from 'node:fs';

/** A clock the test drives: ticks only ever go UP; the era is set by hand. */
function fakeClock() {
  let ticks = 1000, era = 0;
  const seen = [];
  const clock = () => {
    ticks += 17;                       // strictly increasing, always
    const time = {ticks, domain: era ? `test-era-${era}` : 'test-era', hz: 1e6};
    seen.push(time);
    return time;
  };
  clock.newEra = () => { era++; };
  clock.seen = seen;
  return clock;
}

const rom = code => {
  const img = new Uint8Array(0x8000);
  img.set(code, 0);
  img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
  return img;
};

/**
 * The three targets, each with a LEVEL input and the fact that replays it.
 * A level rather than an event on purpose: only levels consult the dedup map,
 * so only a level can show that the map was cleared.
 */
const TARGETS = {
  z80: {
    make: opts => {
      const machine = new Z80Machine(
        {clockHz: 3_500_000, regions: [{kind: 'rom', start: 0x0000, end: 0x3fff}], ula: true}, {});
      return {machine, target: createZ80DebugTarget({machine}, opts)};
    },
    ownDomain: 'z80-cycles',
    source: 'src/z80-debug.js',
    levels: [
      {name: 'keys', set: (t, v) => t.setKeys(v ? ['a'] : ['b']),
        fact: v => ({producer: 'z80.keys', payload: {names: v ? ['a'] : ['b']}})},
      {name: 'buttons', set: (t, v) => t.setButtons(v ? 0b0001 : 0b0010),
        fact: v => ({producer: 'z80.buttons', payload: {mask: v ? 0b0001 : 0b0010}})}
    ]
  },
  m6502: {
    make: opts => {
      const adapter = createM6502Adapter({});
      adapter.machine.loadRom([0xea, 0x4c, 0x00, 0x80]);
      adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;
      adapter.machine.reset();
      return {machine: adapter.machine, target: createM6502DebugTarget(adapter, opts)};
    },
    ownDomain: 'm6502-cycles',
    source: 'src/m6502-debug.js',
    levels: [
      {name: 'buttons', set: (t, v) => t.setButtons(v ? 0b0001 : 0b0010),
        fact: v => ({producer: 'm6502.buttons', payload: {mask: v ? 0b0001 : 0b0010}})}
    ]
  },
  i8086: {
    make: opts => {
      const machine = new I8086Machine(BREADBOARD8086);
      machine.loadRom(rom([0x90, 0xeb, 0xfd]));
      machine.reset(); machine.step();
      return {machine, target: createI8086DebugTarget({machine}, opts)};
    },
    ownDomain: 'i8086-cycles',
    source: 'src/i8086-debug.js',
    levels: [
      {name: 'gpio', set: (t, v) => t.setInput('ppi1', 'b', 0, v ? 1 : 0),
        fact: v => ({producer: 'i8086.gpio',
          payload: {chip: 'ppi1', port: 'b', bit: 0, level: v ? 1 : 0}})}
    ]
  }
};

const record = target => {
  const facts = [];
  target.onDebugInput(f => facts.push(f));
  return facts;
};

for (const [name, spec] of Object.entries(TARGETS)) {
  describe(`${name}: the injected clock`, () => {
    it('the level list covers every SEED SITE in the source', () => {
      // Self-maintaining, and it caught a real gap: the first version of this
      // file drove z80 through setKeys only, so the buttons seed site was
      // untested and removing its era gate passed. One rule, applied where the
      // author was looking rather than across the surface it governs — the
      // same species this whole surface has been chasing all day, committed in
      // the test for it.
      //
      // `observedInputs.set(` appears once inside publishInput (the dedup
      // write) and once per replay SEED. So seeds = occurrences - 1.
      const src = readFileSync(new URL(`../${spec.source}`, import.meta.url), 'utf8');
      const seeds = src.split('observedInputs.set(').length - 1 - 1;
      assert.equal(spec.levels.length, seeds,
        `${spec.source} has ${seeds} replay seed sites and this table declares `
        + `${spec.levels.length} levels: every seed site needs one`);
      assert.ok(spec.levels.length >= 1);
    });

    it('stamps facts with the INJECTED domain, not its own', () => {
      const clock = fakeClock();
      const {target} = spec.make({debugTime: clock});
      const facts = record(target);
      assert.equal(spec.levels[0].set(target, true), true);
      assert.equal(facts.length, 1);
      assert.equal(facts[0].time.domain, 'test-era');
      assert.equal(facts[0].time.hz, 1e6, 'the whole stamp comes from the clock, not just the name');
      assert.notEqual(facts[0].time.domain, spec.ownDomain);
    });

    it('falls back to its OWN clock when nothing is injected', () => {
      // The default has to be unchanged, or every existing caller silently
      // loses its stamp.
      const {target} = spec.make();
      const facts = record(target);
      spec.levels[0].set(target, true);
      assert.equal(facts.length, 1);
      assert.equal(facts[0].time.domain, spec.ownDomain);
    });

    for (const level of spec.levels) {
      it(`${level.name}: AN ERA CHANGE WITH THE TICKS GOING FORWARD clears the dedup map`, () => {
        // The property the whole design turns on. A tick-regression check
        // cannot see this, and a fixture that moved ticks backwards would pass
        // whether or not the domain was ever consulted — so the ticks are
        // asserted to have INCREASED across the change.
        const clock = fakeClock();
        const {target} = spec.make({debugTime: clock});
        const facts = record(target);

        assert.equal(level.set(target, true), true);
        assert.equal(facts.length, 1, 'the first value is a fact');
        level.set(target, true);
        assert.equal(facts.length, 1, 'the same value again is not');

        clock.newEra();                      // a rewind only the CLOCK knows about

        level.set(target, true);
        assert.equal(facts.length, 2,
          'the same value in a NEW era is a fact again: the map did not survive the era');
        assert.equal(facts[1].time.domain, 'test-era-1');

        const ticks = clock.seen.map(t => t.ticks);
        assert.deepEqual(ticks, [...ticks].sort((a, b) => a - b),
          'the clock must never have gone backwards, or this test proves nothing');
        assert.ok(ticks.at(-1) > ticks[0], 'and it must actually have moved');
      });

      it(`${level.name}: an era change does NOT re-record a REPLAYED input`, () => {
        // Regression, measured on the landed version before this change: the
        // replay path seeded the dedup map and the publish path then CLEARED
        // the map before the dedup gate read it, so the replayed input came
        // back out of the recorder as a fresh fact. A second replay pass
        // therefore produced a log longer than the run — in the one moment
        // replay actually happens, immediately after a restore.
        const clock = fakeClock();
        const {target} = spec.make({debugTime: clock});
        const facts = record(target);

        level.set(target, true);
        assert.equal(facts.length, 1);

        clock.newEra();                      // the restore
        const outcome = replayOutcome(target.applyReplayInput(level.fact(false)));
        assert.equal(outcome.accepted, true, `replay was refused: ${outcome.reason}`);
        assert.equal(facts.length, 1, 'a replayed input must not come back out of the recorder');

        // And the seed is still doing its job afterwards: the replayed value is
        // the known state, a different one is a change.
        level.set(target, false);
        assert.equal(facts.length, 1, 'the replayed value is the known state');
        level.set(target, true);
        assert.equal(facts.length, 2, 'a genuine change still gets through');
      });

      it(`${level.name}: a clock that never changes era never clears the map`, () => {
        // The other direction, so the era check is not just "clear on every
        // stamp" — which would pass every assertion above and destroy dedup.
        const clock = fakeClock();
        const {target} = spec.make({debugTime: clock});
        const facts = record(target);
        for (let i = 0; i < 5; i++) level.set(target, true);
        assert.equal(facts.length, 1, 'five identical inputs in one era are one fact');
      });
    }
  });
}
