// The shared INPUT-ADMISSION unit, driven directly. The bridges' own suites
// (bridge-admission-ordering — the R1-R9 matrix — and *-replay-input) exercise it
// end-to-end; this pins its DIRECT API in isolation so a change to the module that
// no bridge test happens to cover still reddens something.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInputAdmission, validButtonMask } from '../src/debug-input-admission.js';

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
