// The shared INPUT-ADMISSION unit, driven directly. The bridges' own suites
// (bridge-admission-ordering — the R1-R9 matrix — and *-replay-input) exercise it
// end-to-end; this pins its DIRECT API in isolation so a change to the module that
// no bridge test happens to cover still reddens something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputAdmission, createCheckpointMethods, validButtonMask } from '../src/debug-input-admission.js';

const jsonSig = (_producer, payload) => JSON.stringify(payload);

// An injectable clock whose domain a test can advance, to drive the era gate.
const eraClock = () => {
  let ticks = 100, era = 0;
  const clock = () => ({ ticks: (ticks += 10), domain: era ? `d-${era}` : 'd', hz: 1e6 });
  clock.newEra = () => { era++; };
  return clock;
};

const mk = (opts = {}) => createInputAdmission({
  machine: { cycles: 0, clockHz: 1e6 }, domainBase: 'd', signatureOf: jsonSig,
  admitLabel: 'test onDebugInputAdmission', uncapturedInputReason: 'unlogged', ...opts,
});

test('level: applies, records once, and DEDUPS the same value', () => {
  const a = mk({ injectedClock: eraClock() });
  const seen = []; a.onDebugInput(f => seen.push(f));
  let applied = 0;
  const set = v => a.level('p', 'k', { v }, () => { applied++; return true; });
  set(1); set(1); set(2);
  assert.equal(applied, 3, 'a deduped level still reaches the machine (applied every time)');
  assert.deepEqual(seen.map(f => f.payload.v), [1, 2], 'but only a CHANGE is recorded');
});

test('level: a refused ASK writes nothing and seeds nothing', () => {
  const a = mk({ injectedClock: eraClock() });
  const seen = []; a.onDebugInput(f => seen.push(f));
  const off = a.onDebugInputAdmission(() => ({ accepted: false }));
  let applied = 0;
  assert.equal(a.level('p', 'k', { v: 1 }, () => { applied++; return true; }), false);
  assert.equal(applied, 0, 'refused before apply');
  assert.equal(seen.length, 0, 'and recorded nothing');
  off();
  assert.equal(a.level('p', 'k', { v: 1 }, () => { applied++; return true; }), true,
    'with the veto gone the SAME value is now a fact — the refusal never seeded it');
  assert.equal(seen.length, 1);
});

test('the era gate clears the dedup map when the clock domain changes', () => {
  const clock = eraClock();
  const a = mk({ injectedClock: clock });
  const seen = []; a.onDebugInput(f => seen.push(f));
  const set = v => a.level('p', 'k', { v }, () => true);
  set(1); set(1);                     // one fact, second deduped
  clock.newEra();                     // a rewind: the domain moves
  set(1);                             // same value, new era — must record again
  assert.deepEqual(seen.map(f => f.time.domain), ['d', 'd-1'],
    'the post-rewind repeat is a fact, on the new domain');
});

test('seed makes a later LIVE level of that value dedup (replay path)', () => {
  const a = mk({ injectedClock: eraClock() });
  const seen = []; a.onDebugInput(f => seen.push(f));
  a.seed('k', 'p', { v: 7 });                       // replay seeded it
  a.level('p', 'k', { v: 7 }, () => true);          // live, same value
  assert.equal(seen.length, 0, 'the live input dedups against the replayed seed');
});

test('openEpochOnRestore advances the input domain even without a tick regression', () => {
  const a = mk();                                   // ownClock, machine.cycles = 0
  assert.equal(a.eventDomain(), 'd');
  a.openEpochOnRestore();
  assert.equal(a.eventDomain(), 'd-rewind-1', 'a restore opens a fresh epoch outright');
});

test('tell gives each listener its OWN copy (a mutation cannot corrupt the log)', () => {
  const a = mk({ injectedClock: eraClock() });
  const first = []; const second = [];
  a.onDebugInput(f => { first.push(f); f.payload.v = 999; f.time.ticks = -1; });  // hostile
  a.onDebugInput(f => second.push(f));
  a.level('p', 'k', { v: 1 }, () => true);
  assert.equal(second[0].payload.v, 1, 'the second listener saw the unmutated value');
  assert.notEqual(second[0].time.ticks, -1);
});

test('admit THROWS on a non-{accepted:boolean} verdict, naming the target', () => {
  const a = mk();
  a.onDebugInputAdmission(() => true);              // wrong shape (bare true)
  assert.throws(() => a.level('p', 'k', { v: 1 }, () => true), /test onDebugInputAdmission/);
});

test('validButtonMask accepts a safe integer and rejects the rest', () => {
  assert.equal(validButtonMask(0x1f), true);
  assert.equal(validButtonMask(2 ** 60), false);
  assert.equal(validButtonMask('3'), false);
  assert.equal(validButtonMask(NaN), false);
});

// --- createCheckpointMethods: the shared CHECKPOINT/REPLAY half ---------------
// The bridge suites (unlogged-board-inputs, debug-replay-contract, the *-replay
// suites) exercise these end-to-end; this pins the factory's DIRECT contract in
// isolation, including the per-CPU parameters (halt predicate + reason strings)
// and the watch-latch reset, so a drift the bridge fixtures don't happen to cover
// still reddens.
const mkCkpt = (opts = {}) => {
  const calls = { resetWatch: 0 };
  const state = { uncaptured: false, epochOpened: 0 };
  const machine = {
    cycles: 42, clockHz: 1e6,
    checkpointSupport: () => ({ supported: true, reasons: [] }),
    captureCheckpoint: () => ({ data: 'snap' }),
    restoreCheckpoint: () => undefined,          // falsy return = a successful restore
    step: () => 4,
    ...opts.machine,
  };
  const admission = {
    eventDomain: () => 'dom-1',
    hasUncapturedInputState: () => state.uncaptured,
    uncapturedInputReason: 'unlogged board sampling',
    openEpochOnRestore: () => { state.epochOpened++; },
  };
  const methods = createCheckpointMethods({
    machine, admission,
    isHalted: () => opts.halted === true,
    haltReason: 'HALT-REASON', notRetiredReason: 'NOT-RETIRED-REASON',
    resetWatch: () => { calls.resetWatch++; },
  });
  return { methods, machine, state, calls };
};

test('captureCheckpoint: refuses over uncaptured input, else stamps the event clock', () => {
  const c = mkCkpt();
  const ok = c.methods.captureCheckpoint();
  assert.deepEqual(ok.time, { ticks: 42, domain: 'dom-1', hz: 1e6 }, 'a sound checkpoint carries the event clock');
  c.state.uncaptured = true;
  assert.deepEqual(c.methods.captureCheckpoint(),
    { code: 'INCOMPLETE_CHECKPOINT_STATE', refused: 'unlogged board sampling' },
    'over unlogged inputs it refuses with the shared reason, unstamped');
});

test('captureCheckpoint: a machine that refuses is passed through UNSTAMPED', () => {
  const c = mkCkpt({ machine: { captureCheckpoint: () => ({ refused: 'no support' }) } });
  const out = c.methods.captureCheckpoint();
  assert.equal(out.refused, 'no support');
  assert.equal(out.time, undefined, 'a refused checkpoint is not given a time');
});

test('restoreCheckpoint: opens a fresh epoch on success, not on refusal, gated on uncaptured input', () => {
  const ok = mkCkpt();
  assert.equal(ok.methods.restoreCheckpoint({}), undefined);
  assert.equal(ok.state.epochOpened, 1, 'a successful restore opens the input epoch');

  const bad = mkCkpt({ machine: { restoreCheckpoint: () => ({ error: 'bad' }) } });
  assert.deepEqual(bad.methods.restoreCheckpoint({}), { error: 'bad' });
  assert.equal(bad.state.epochOpened, 0, 'a failed restore does NOT branch the timeline');

  let restored = false;
  const d = mkCkpt({ machine: { restoreCheckpoint: () => { restored = true; return undefined; } } });
  d.state.uncaptured = true;
  const out = d.methods.restoreCheckpoint({});
  assert.equal(out.code, 'INCOMPLETE_CHECKPOINT_STATE');
  assert.equal(restored, false, 'it refuses BEFORE touching the machine');
  assert.equal(d.state.epochOpened, 0);
});

test('replayInstruction: unsupported / halted / not-retired / accepted, with per-CPU reasons', () => {
  const unsup = mkCkpt({ machine: { checkpointSupport: () => ({ supported: false, reasons: ['a', 'b'] }) } });
  assert.deepEqual(unsup.methods.replayInstruction(),
    { accepted: false, code: 'unsupported-replay', reason: 'a; b' });

  const halted = mkCkpt({ halted: true });
  assert.deepEqual(halted.methods.replayInstruction(),
    { accepted: false, code: 'halted-without-instruction', reason: 'HALT-REASON' },
    'the injected halt predicate and its reason are used');

  const stuck = mkCkpt({ machine: { step: () => 0 } });
  assert.deepEqual(stuck.methods.replayInstruction(),
    { accepted: false, code: 'instruction-not-retired', reason: 'NOT-RETIRED-REASON' });

  const good = mkCkpt({ machine: { cycles: 100, step() { this.cycles = 106; return 6; } } });
  assert.deepEqual(good.methods.replayInstruction(),
    { accepted: true, boundary: 'instruction', cycles: 6 }, 'cycles is the delta the step advanced');
});

test('replayInstruction: resets the watch latch around the step, even if the step throws', () => {
  const ok = mkCkpt();
  ok.methods.replayInstruction();
  assert.equal(ok.calls.resetWatch, 2, 'reset before the step and again in the finally');

  const boom = mkCkpt({ machine: { step: () => { throw new Error('bang'); } } });
  assert.throws(() => boom.methods.replayInstruction(), /bang/);
  assert.equal(boom.calls.resetWatch, 2, 'the finally still cleared the latch when the step threw');
});
