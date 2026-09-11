/**
 * THE EIGHT ORDERING RULES for the converged debug bridges (z80-debug, m6502-debug),
 * which carry BOTH the veto (the ASK hook, onDebugInputAdmission) and the dedup
 * (the TELL hook, onDebugInput).
 *
 * ## Why a discrimination matrix and not just a red run against the bridges
 *
 * The bridges do not have the ASK hook yet, so a rule-check run against them fails
 * with `onDebugInputAdmission is not a function` — and EVERY check fails that way,
 * with an empty body or a full one. That red proves the checks EXECUTE; it does
 * not prove they DISCRIMINATE, and for R2/R3 (the falsifiers) discrimination is
 * the whole point. It is the shape of `assert.throws(fn, TypeError)` passing with
 * the guard deleted, because the unguarded call raises its own TypeError.
 *
 * So each rule-check is a function run against a TARGET, and the matrix below runs
 * them against STUBS — plain objects that HAVE the hook and get exactly one
 * ordering wrong each. The matrix asserts that a wrong stub reds its named rule
 * AND leaves the others green: a stub that reds a rule it should not means the
 * checks are coupled and a real failure will point at the wrong rule; a stub that
 * reds nothing means the rule is vacuous. Only then do the same checks, run
 * against the real bridges, mean anything — and until step 3 implements the hook,
 * those bridge checks are red, which is the red-first the lane asked for.
 *
 * The load-bearing observable is the ADMITTER CALL COUNT, supplied by this file,
 * so it is an external observation of the target rather than the target marking
 * its own homework. "A vetoed input did not seed the dedup map" shows up as "the
 * next identical input is ASKED AGAIN".
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertAdmissionVerdict } from '../src/debug-replay-contract.js';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';

// A reference admission target, mutated in one place per variant. S0 is correct.
// Buttons are a 5-bit joystick, so the ONE signature masks & 0x1f; the dedup map
// is keyed by producer. `apply` is a no-op — the tests read the hook call counts,
// not machine state.
function makeStub(variant) {
  const observed = new Map();
  const admitters = [];
  const listeners = [];
  const applied = [];                                                  // observable apply, for R6
  let clock = 0;
  let era = 0;                                                         // a rewind bumps this; the domain carries it
  let lastDomain = null;
  // The era gate: stamp() clears the dedup map on a domain change, so a rewind is
  // consumed. It MUST run before the dedup read — S8 is the stub that reads first.
  const stamp = () => {
    const time = { ticks: ++clock, domain: `stub-era-${era}`, hz: 1 };
    if (lastDomain !== null && time.domain !== lastDomain) observed.clear();
    lastDomain = time.domain;
    return time;
  };
  // The payload is the record; the signature is the comparison. buttons: raw
  // identity. keys: order-independent (S9 wrongly preserves order).
  const signatureOf = (producer, payload) =>
    producer === 'stub.keys'
      ? (variant === 'S9' ? JSON.stringify({ names: payload.names }) : JSON.stringify({ names: [...payload.names].sort() }))
      : JSON.stringify(payload);
  const replaySignature = (producer, payload) => variant === 'S4' && producer === 'stub.buttons'
    ? JSON.stringify({ mask: payload.mask & 0x1f })                    // S4: the real master bug — seed MASKED against a raw live record
    : signatureOf(producer, payload);
  const ask = input => {
    for (const a of admitters) if (!assertAdmissionVerdict(a(input), 'stub-admitter').accepted) return false;
    return true;
  };
  const tell = fact => { for (const l of listeners) l(fact); };

  return {
    appliedCount: () => applied.length,
    rewind() { era++; },                                               // an era change the next stamp must consume
    onDebugInputAdmission(a) { admitters.push(a); return () => {}; },
    onDebugInput(l) { listeners.push(l); return () => {}; },

    applyLevel(producer, payload, appliedValue) {
      const key = producer;                                            // the stub keys the dedup map by producer
      let time;
      if (variant !== 'S8') time = stamp();                            // R1: stamp (era gate) BEFORE the dedup read
      const sig = signatureOf(producer, payload);
      if (observed.get(key) === sig) {                                // R6: deduped
        if (variant !== 'S7') applied.push(appliedValue);            //   applied SILENTLY; S7 skips the apply
        return;
      }
      if (variant === 'S8') time = stamp();                            // S8: stamp AFTER the read — era gate too late
      const input = { time, producer, payload };                     // the recorded payload keeps its order/rawness
      if (variant === 'S1' || variant === 'S2') observed.set(key, sig); // S1/S2: seed BEFORE the verdict is known
      if (!ask(input)) return;                                        // R2: ASK before apply; refused writes nothing
      applied.push(appliedValue);                                    // apply, observably
      observed.set(key, sig);                                         // R3/R4: seed on acceptance
      const telling = variant === 'S5' ? { ...input, time: stamp() } : input; // S5: a fresh stamp for TELL
      tell(telling);                                                  // R5: reuse the ASK's stamp (S0)
    },
    setButtons(mask) { this.applyLevel('stub.buttons', { mask }, mask); },        // RAW payload
    setKeys(names) { this.applyLevel('stub.keys', { names: [...names] }, names); }, // face-order payload

    applyReplayInput(fact) {
      const key = fact.producer;
      const sig = replaySignature(fact.producer, fact.payload);
      if (variant === 'S3') {                                         // S3: replay routed through the hooks
        const time = stamp();
        const input = { time, producer: fact.producer, payload: fact.payload };
        if (!ask(input)) return { accepted: false };
        observed.set(key, sig);
        tell(input);
        return { accepted: true };
      }
      stamp();                                                        // era gate on replay too, then seed; never ASK/TELL
      observed.set(key, sig);
      return { accepted: true };
    },

    nmi() {                                                           // an EVENT
      const time = stamp();
      const input = { time, producer: 'stub.nmi', payload: {} };
      if (variant === 'S6') {                                         // S6: an event WRONGLY deduped
        if (observed.get('stub.nmi') === '{}') return;
        observed.set('stub.nmi', '{}');
      }
      if (!ask(input)) return;                                        // R7: events ASK unconditionally
      tell(input);                                                    //     and TELL unconditionally
      // R7 (S0): never touches `observed`
    }
  };
}

// Register a counting admitter (with a fixed verdict) and a fact-collecting
// listener. Both are this file's functions, so their call counts are exact.
const wire = (t, { accept = true } = {}) => {
  const asked = [], told = [];
  t.onDebugInputAdmission(input => { asked.push(input); return { accepted: accept }; });
  t.onDebugInput(fact => { told.push(fact); });
  return { asked, told };
};

// Each rule-check throws on failure so the matrix can catch it. `drv` abstracts
// the producer a given target actually takes.
const RULES = {
  R1: drv => { // ORDERING: the stamp (era gate) runs BEFORE the dedup read, so a rewind is consumed
    if (!drv.rewind) return;
    const t = drv.make(); const { asked } = wire(t, { accept: true });
    drv.setLevel(t, drv.levelA);
    drv.rewind(t);                        // abandon the era the first input lived in
    drv.setLevel(t, drv.levelA);          // identical value, NEW era → must be asked again
    assert.equal(asked.length, 2,
      'after a rewind an identical level is asked again — the stamp cleared the abandoned era before the dedup '
      + 'read; a late stamp would silently dedup the first input after a restore, an input that never gets recorded');
  },
  R2: drv => { // FALSIFIER: a refused ASK writes nothing — the vetoed input does not seed
    const t = drv.make(); const { asked, told } = wire(t, { accept: false });
    drv.setLevel(t, drv.levelA); drv.setLevel(t, drv.levelA);
    assert.equal(asked.length, 2,
      'the second identical input must be ASKED AGAIN; asked===1 means the vetoed first seeded');
    assert.equal(told.length, 0, 'a vetoed input is never told');
  },
  R3: drv => { // FALSIFIER: replay bypasses both hooks and seeds
    const t = drv.make(); const { asked, told } = wire(t, { accept: false });
    const out = drv.replayLevel(t, drv.levelA);
    assert.equal((out && out.accepted) || out === true, true, 'replay applies');
    assert.equal(asked.length, 0, 'replay must NOT ASK');
    assert.equal(told.length, 0, 'replay must NOT TELL');
    drv.setLevel(t, drv.levelA);
    assert.equal(asked.length, 0, 'a live level equal to the replayed one is deduped by the seed');
  },
  R5: drv => { // the TELL reuses the ASK's stamp — ONE stamp, by value
    const t = drv.make(); let ask = null, tell = null;
    t.onDebugInputAdmission(i => { ask = i; return { accepted: true }; });
    t.onDebugInput(f => { tell = f; });
    drv.setLevel(t, drv.levelA);
    assert.ok(ask && tell, 'both hooks fired for an accepted level');
    // Deep-equal, not identical: the TELL delivers a COPY (a listener must not be
    // able to corrupt the next listener's fact), so the objects cannot be the
    // same reference. But they must be ONE stamp — the incrementing clock makes a
    // second stamp show as different ticks, which is what S5 does and this catches.
    assert.deepEqual(tell.time, ask.time, 'the TELL carries the ASK\'s stamp (one stamp, same ticks/domain), not a fresh one');
  },
  R6: drv => { // a deduped level is APPLIED SILENTLY — still reaches the machine, but not asked/told
    const t = drv.make(); const { asked, told } = wire(t, { accept: true });
    drv.setLevel(t, drv.levelA);
    const a = asked.length, d = told.length, ap = drv.appliedCount ? drv.appliedCount(t) : null;
    drv.setLevel(t, drv.levelA);
    assert.equal(asked.length, a, 'a deduped repeat is not asked');
    assert.equal(told.length, d, 'nor told');
    if (drv.appliedCount) assert.equal(drv.appliedCount(t), ap + 1,
      'but the deduped level is STILL applied — a held level must keep reaching the machine, or a button '
      + 'held across a recorded fact is released');
  },
  R7: drv => { // events never touch the map; ASK/TELL unconditional
    if (!drv.event) return;
    const t = drv.make(); const { asked, told } = wire(t, { accept: true });
    drv.event(t); drv.event(t);
    assert.equal(asked.length, 2, 'an event is asked every time — not a level to dedup');
    assert.equal(told.length, 2, 'and told every time');
  },
  R8: drv => { // one signatureOf both paths, computing the RAW value — and it says WHAT they agree on
    if (!drv.supportsMask) return;
    // (a) the recorded fact carries the RAW value the caller passed. 0xFF is the
    // probe precisely because it is the value that separates raw from narrowed;
    // a log that recorded 0x1F where the host sent 0xFF is not a record of the host.
    const t1 = drv.make(); const { told } = wire(t1, { accept: true });
    drv.setLevel(t1, drv.big);
    assert.ok(told.length >= 1, 'the fixture recorded the live input');
    assert.equal(told[told.length - 1].payload.mask, drv.big,
      'the recorded fact carries the RAW value the caller passed (0xFF), not a value narrowed to the machine mask');
    // (b) a live value dedups against a replay seed of the SAME value — both raw,
    // one signatureOf — with a control so the no-ASK means deduped, not dead.
    const t2 = drv.make(); const { asked } = wire(t2, { accept: true });
    drv.replayLevel(t2, drv.big);
    const base = asked.length;            // R3 owns whether replay asked; R8 is a DELTA
    drv.setLevel(t2, drv.big);
    assert.equal(asked.length, base, 'a live value equal to the replay seed raises no new ASK (one signatureOf, both raw)');
    drv.setLevel(t2, drv.control);        // CONTROL: a different value MUST be asked exactly once
    assert.equal(asked.length, base + 1,
      'the control proves the fixture drives and asks — so no-new-ASK above is "deduped", not "nothing happened"');
  },
  R9: drv => { // keys are order-INDEPENDENT: the recorded SET, not its order, is the change
    if (!drv.setKeysLevel) return;
    // (a) a reordered held set is one input, not two — the ULA ANDs a bit per
    // name (zx-ula.js), so ['a','b'] and ['b','a'] are the same machine state.
    const t1 = drv.make(); const { asked, told } = wire(t1, { accept: true });
    drv.setKeysLevel(t1, ['a', 'b']);
    const a = asked.length, d = told.length;
    drv.setKeysLevel(t1, ['b', 'a']);
    assert.equal(asked.length, a, 'a reordered held set raises no new ASK — the order is not a change');
    assert.equal(told.length, d, 'nor a new fact');
    // (b) a live set dedups against a replay seed of the same set in another order.
    const t2 = drv.make(); const { asked: asked2 } = wire(t2, { accept: true });
    drv.replayKeys(t2, ['a', 'b']);
    const base = asked2.length;
    drv.setKeysLevel(t2, ['b', 'a']);
    assert.equal(asked2.length, base, 'a live key set dedups against a replayed one regardless of order');
  }
};

// ---- the discrimination matrix, over stubs ---------------------------------

const stubDrv = variant => ({
  make: () => makeStub(variant),
  setLevel: (t, v) => t.setButtons(v),
  replayLevel: (t, v) => t.applyReplayInput({ producer: 'stub.buttons', payload: { mask: v }, time: { ticks: 1, domain: 'stub', hz: 1 } }),
  setKeysLevel: (t, v) => t.setKeys(v),
  replayKeys: (t, v) => t.applyReplayInput({ producer: 'stub.keys', payload: { names: v }, time: { ticks: 1, domain: 'stub', hz: 1 } }),
  event: t => t.nmi(),
  appliedCount: t => t.appliedCount(),
  rewind: t => t.rewind(),
  levelA: 0b0001, big: 0xff, control: 0b0010, supportsMask: true
});

// R1 ("stamp before the dedup read") and R5 ("the TELL reuses the ASK's stamp")
// are DIFFERENT rules with different breakers: R1 is about ORDER (S8 stamps after
// the read, so a rewind is not consumed and a post-restore input is silently
// deduped), R5 is about IDENTITY (S5 gives the TELL a fresh stamp). Both are worth
// having — an earlier version folded R1 into R5, which retired the ordering guard
// that keeps a level from an abandoned era surviving a rewind.
//
// R4 ("no listener between the stamp and the seed write on the replay path") has
// NO breaker here and is UNPROVEN by this file. It holds by construction: the
// replay path applies directly and never reaches the hooks (that is R3), so there
// is no publish between the stamp and the seed. If that ever stops being true
// this matrix will not tell you — R3 is the closest guard.
const EXPECTED = { S0: [], S1: ['R2'], S2: ['R2'], S3: ['R3'], S4: ['R8'], S5: ['R5'], S6: ['R7'], S7: ['R6'], S8: ['R1'], S9: ['R9'] };

describe('the rules discriminate: a wrong stub reds exactly its rule and no other', () => {
  for (const variant of Object.keys(EXPECTED)) {
    it(`${variant} reds exactly ${JSON.stringify(EXPECTED[variant])}`, () => {
      const drv = stubDrv(variant);
      const reds = [];
      for (const [name, check] of Object.entries(RULES)) {
        try { check(drv); } catch { reds.push(name); }
      }
      assert.deepEqual(reds.sort(), [...EXPECTED[variant]].sort(),
        `${variant} should red exactly ${JSON.stringify(EXPECTED[variant])}, got ${JSON.stringify(reds.sort())}`);
    });
  }
});

// ---- the real bridges: RED until step 3 implements onDebugInputAdmission ----

const BRIDGES = {
  'z80-debug': {
    make: () => createZ80DebugTarget({ machine: new Z80Machine(
      { clockHz: 3_500_000, regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }], ula: true }, {}) }),
    setLevel: (t, v) => t.setKeys(v),
    replayLevel: (t, v) => t.applyReplayInput({ producer: 'z80.keys', payload: { names: v }, time: { ticks: 1, domain: 'z80-cycles', hz: 3.5e6 } }),
    setKeysLevel: (t, v) => t.setKeys(v),
    replayKeys: (t, v) => t.applyReplayInput({ producer: 'z80.keys', payload: { names: v }, time: { ticks: 1, domain: 'z80-cycles', hz: 3.5e6 } }),
    levelA: ['a']                        // keys, no mask and no in-fixture event: R2/R3/R5/R6/R9 apply
  },
  'm6502-debug': {
    make: () => {
      const adapter = createM6502Adapter({});
      adapter.machine.loadRom([0xea, 0x4c, 0x00, 0x80]);
      adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;
      adapter.machine.reset();
      return createM6502DebugTarget(adapter);
    },
    setLevel: (t, v) => t.setButtons(v),
    replayLevel: (t, v) => t.applyReplayInput({ producer: 'm6502.buttons', payload: { mask: v }, time: { ticks: 1, domain: 'm6502-cycles', hz: 1e6 } }),
    event: t => t.nmi(),
    levelA: 0b0001, big: 0xff, control: 0b0010, supportsMask: true
  }
};

describe('the bridges satisfy the rules (RED until step 3 implements the ASK hook)', () => {
  for (const [name, drv] of Object.entries(BRIDGES)) {
    for (const [rule, check] of Object.entries(RULES)) {
      it(`${name} ${rule}`, () => check(drv));
    }
  }
});
