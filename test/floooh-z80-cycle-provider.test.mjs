// THE OPTIONAL FLOOOH Z80 CYCLE BOUNDARY, DRIVEN WITH A FAKE MODULE.
//
// The engine's third-party source and WASM are deliberately not bundled, so
// the provider takes an injected `loadModule`. That makes this suite fully
// self-contained: there is no oracle to find and no case here can skip, which
// is the property to keep if a real wrapper is ever added beside it.
//
// THE FAKE IS THE WHOLE ABI, on purpose. A partial stub would pass the ABI
// check for the wrong reason and the refusal cases below would stop meaning
// anything -- `cycle-provider-abi-mismatch` has to be reachable by a module
// that is genuinely missing a method, not by one this fixture forgot.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFlooohZ80CycleProvider, FLOOOH_Z80_PINS, FLOOOH_Z80_STATE_FIELDS }
  from '../src/floooh-z80-cycle-provider.js';

const pins = value => Object.fromEntries(
  FLOOOH_Z80_PINS.map((name, i) => [name, name === 'data' ? value : i]));
const state = value => Object.fromEntries(FLOOOH_Z80_STATE_FIELDS.map((name, i) =>
  [name, ['prefixActive', 'iff1', 'iff2'].includes(name) ? false : value + i]));

const fakeModule = () => {
  let cpu = state(10);
  let pinState = pins(0);
  let loads = 0;
  let crossings = 0;
  return {
    reset() { pinState = pins(0); return pinState; },
    tickBatch(count) {
      crossings++;
      return Array.from({ length: count }, () => {
        cpu.step++;
        pinState = pins(cpu.step);
        return { ...pinState, registers: { pc: cpu.pc, step: cpu.step }, retired: cpu.step % 4 === 0 };
      });
    },
    costMetadata: () => ({ maxBatchTicks: 64, maxEvents: 64, eventBytes: 4096, moduleBytes: 8192 }),
    registers() { return { pc: cpu.pc, step: cpu.step }; },
    saveState() { return structuredClone(cpu); },
    loadState(next, nextPins) {
      cpu = structuredClone(next);
      pinState = structuredClone(nextPins);
      loads++;
    },
    loadCount: () => loads,
    crossings: () => crossings
  };
};

test('the fixture module is accepted, so the refusals below are about the module and not the fixture', async () => {
  // ANTI-VACUITY, FIRST. Every refusal case here asserts a code; if the fake
  // were rejected for its own reasons they would all pass while testing
  // nothing about the condition they name.
  const provider = await createFlooohZ80CycleProvider({ clockHz: 4_000_000, loadModule: async () => fakeModule() });
  assert.notEqual(provider.accepted, false, `the fixture was refused: ${JSON.stringify(provider)}`);
  assert.equal(typeof provider.tick, 'function');
});

test('snapshots enumerate named state, reject omissions BEFORE mutation, and restore defensively', async () => {
  const core = fakeModule();
  const provider = await createFlooohZ80CycleProvider({ clockHz: 4_000_000, loadModule: async () => core });
  provider.tick();

  const snapshot = provider.captureState();
  assert.deepEqual(Object.keys(snapshot.cpu), [...FLOOOH_Z80_STATE_FIELDS],
    'a snapshot names every field, so a reader can tell a complete one from a partial one');

  const malformed = structuredClone(snapshot);
  delete malformed.cpu.intBits;
  assert.throws(() => provider.restoreState(malformed), /incomplete/);
  // THE ORDERING IS THE GUARANTEE: validated before the core is touched, so a
  // rejected restore cannot leave the engine half-written.
  assert.equal(core.loadCount(), 0, 'invalid state is rejected before the core is touched');

  const mistyped = structuredClone(snapshot);
  mistyped.cpu.step = '1';
  assert.throws(() => provider.restoreState(mistyped), /incomplete/);
  assert.equal(core.loadCount(), 0, 'a type error is caught by the same gate, also before the core');

  provider.tick();
  assert.equal(provider.restoreState(snapshot), true);
  assert.equal(core.loadCount(), 1, 'and a valid restore does reach the core');

  snapshot.cpu.pc = 0xffff;
  assert.notEqual(provider.registers().pc, 0xffff, 'restore does not alias caller-owned state');
});

test('wrapper ABI, loader and cost failures each refuse by their own name', async () => {
  // THREE DISTINCT CAUSES, THREE CODES. A single `unavailable` would leave a
  // caller unable to tell a missing wrapper from a wrapper too expensive to
  // run, which are different things to do something about.
  assert.equal((await createFlooohZ80CycleProvider({ clockHz: 1, loadModule: async () => ({}) })).code,
    'cycle-provider-abi-mismatch');
  assert.equal((await createFlooohZ80CycleProvider({
    clockHz: 1, loadModule: async () => { throw new Error('missing wasm'); }
  })).code, 'cycle-provider-load-failed');

  const oversized = fakeModule();
  oversized.costMetadata = () => ({
    maxBatchTicks: 70_000, maxEvents: 70_000, eventBytes: 5_000_000, moduleBytes: 3_000_000
  });
  assert.equal((await createFlooohZ80CycleProvider({ clockHz: 1, loadModule: async () => oversized })).code,
    'cycle-provider-cost-unsupported');
});

test('a clock that is not a positive integer is refused before any module is loaded', async () => {
  let loaded = 0;
  const loadModule = async () => { loaded++; return fakeModule(); };
  for (const clockHz of [0, -1, 1.5, NaN, '4000000', undefined]) {
    const result = await createFlooohZ80CycleProvider({ clockHz, loadModule });
    assert.equal(result.code, 'invalid-cycle-clock', `clockHz ${String(clockHz)} must refuse by name`);
  }
  assert.equal(loaded, 0, 'a bad clock is refused without paying to load a module');
});
