// Z80 EXECUTION-MODE SELECTION: the optional cycle core must stay optional.
//
// The point of extracting this selector from debug-target-factory.js is that
// the cycle path is reached ONLY by a dynamic import, so the fast path never
// pulls the optional engine into a bundle. That is invisible in the returned
// target -- both modes produce a working one -- so the cases below count LOADER
// INVOCATIONS. A default or explicit-fast selection that touched the loader
// would still pass every behavioural assertion.
//
// Ported from the downstream tree with the source, unchanged apart from import
// paths: it is the suite that was holding this file, and re-deriving it here
// would have lost the loader-laziness cases, which are the ones a reviewer
// would not think to write.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createZ80Target} from '../src/z80-target-factory.js';
import {createFlooohZ80CycleProvider, FLOOOH_Z80_PINS, FLOOOH_Z80_STATE_FIELDS}
  from '../src/floooh-z80-cycle-provider.js';

const pins = value => Object.fromEntries(FLOOOH_Z80_PINS.map(name =>
  [name, ['m1', 'mreq', 'iorq', 'rd', 'wr', 'rfsh', 'halt', 'wait', 'int', 'nmi'].includes(name)
    ? false : value]));
const cpuState = () => Object.fromEntries(FLOOOH_Z80_STATE_FIELDS.map((name, index) =>
  [name, ['prefixActive', 'iff1', 'iff2'].includes(name) ? false : index]));
const wrapper = (cost = {}) => {
  let crossings = 0;
  let step = 0;
  const metadata = {maxBatchTicks: 64, maxEvents: 64, eventBytes: 4096,
    moduleBytes: 8192, ...cost};
  return {
    reset: () => pins(0),
    tickBatch(count) {
      crossings++;
      return Array.from({length: count}, () => {
        step++;
        return {...pins(step), registers: {pc: step, step}, retired: step % 4 === 0};
      });
    },
    registers: () => ({pc: step, step}),
    saveState: cpuState,
    loadState: () => true,
    costMetadata: () => metadata,
    crossings: () => crossings
  };
};

const fastConfig = {clockHz: 4_000_000,
  regions: [{kind: 'ram', start: 0, end: 0xffff}], ports: []};

test('the cycle module is imported ONLY inside the cycle branch', () => {
    // A STRUCTURAL PROXY FOR A BUNDLER PROPERTY, and labelled as one. The
    // reason this selector exists is that the fast path must not pull the
    // optional engine into a bundle -- and no runtime test can see that: the
    // loader-invocation cases below pass with the fast path eagerly importing
    // `z80-cycle-debug.js`, because the caller's loader is only called from
    // inside the provider. Measured, not assumed: adding that import to the
    // fast path reds nothing else in this file.
    //
    // So the claim is held where it is decidable -- in the source the bundler
    // reads. Brittle in the usual way a source scan is, hence the anti-vacuity
    // assertion first: a pattern that matches nothing must fail rather than
    // pass.
    const src = readFileSync(new URL('../src/z80-target-factory.js', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/await import\('\.\/([a-z0-9-]+\.js)'\)/g)].map(m => m[1]);
    assert.ok(imports.length >= 2,
        `the import scan found ${imports.length} dynamic imports; the pattern no longer `
        + 'matches how this file imports and cannot hold anything');
    assert.ok(imports.includes('z80-cycle-debug.js'), 'fixture: the cycle module is imported at all');

    // EXACTLY ONE MENTION, AND INSIDE THE BRANCH. Checking only the text
    // BEFORE the branch was my first version and it missed the case that
    // matters just as much: an import in the FAST path, which sits after the
    // branch. Counting the occurrences and locating the single one is the
    // complete claim -- a mention anywhere else, before or after, reds.
    const mentions = [...src.matchAll(/z80-cycle-debug/g)].map(m => m.index);
    assert.equal(mentions.length, 1,
        `z80-cycle-debug is named ${mentions.length} times; exactly one dynamic import, `
        + 'inside the cycle branch, is what keeps the optional engine out of a fast bundle');
    const branchStart = src.indexOf("executionMode === 'cycle'");
    const fastPathStart = src.indexOf("await import('./z80-adapter.js')");
    assert.ok(branchStart > 0 && fastPathStart > branchStart,
        'fixture: the cycle branch must precede the fast path for this slice to mean anything');
    assert.ok(mentions[0] > branchStart && mentions[0] < fastPathStart,
        'the one mention must sit inside the cycle branch, not at the top level and not '
        + 'in the fast path');
});

test('default and explicit fast selection never invoke the optional loader', async () => {
  let loads = 0;
  const loadCycleModule = async () => { loads++; throw new Error('must stay lazy'); };
  for (const options of [{}, {executionMode: 'fast'}]) {
    const made = await createZ80Target({...options, config: fastConfig, loadCycleModule});
    assert.ok(made.target);
    assert.equal(made.target.capabilities().steps.includes('cycle'), false);
  }
  assert.equal(loads, 0);
});

test('only explicit cycle selection loads once and failures never masquerade as fast success', async () => {
  let loads = 0;
  const failed = await createZ80Target({executionMode: 'cycle', config: fastConfig,
    loadCycleModule: async () => { loads++; throw new Error('missing optional chunk'); }});
  assert.equal(loads, 1);
  assert.equal(failed.target, null);
  assert.equal(failed.adapter, null);
  assert.deepEqual(failed.refusal, {accepted: false, code: 'cycle-provider-load-failed',
    reason: 'missing optional chunk'});
  assert.equal(Object.hasOwn(failed, 'fallback'), false);

  await assert.rejects(() => createZ80Target({executionMode: 'automatic',
    config: fastConfig, loadCycleModule: async () => { loads++; return wrapper(); }}),
  /unknown Z80 execution mode/);
  assert.equal(loads, 1, 'an invalid selection is rejected before optional code loads');
});

test('large run slices use bounded batches and preserve a multi-batch cycle step', async () => {
  const core = wrapper();
  const made = await createZ80Target({executionMode: 'cycle', config: fastConfig,
    loadCycleModule: async () => core});
  const events = [];
  made.target.onDebugEvent(event => events.push(event));
  made.target.step('cycle', 130);
  assert.equal(made.target.runFor(1_000_000_000), 'budget');
  assert.equal(events.length, 64);
  assert.equal(made.target.runFor(1_000_000_000), 'budget');
  assert.equal(events.length, 128);
  assert.equal(made.target.runFor(1_000_000_000), 'halted');
  assert.equal(events.length, 130);
  assert.equal(core.crossings(), 3, 'one wrapper crossing per bounded batch, never one per tick');
  assert.deepEqual(events.map(event => event.time.ticks).slice(-3), [128, 129, 130]);
});

test('every module and transfer cost boundary rejects independently before ticking', async () => {
  const mutations = [
    {maxBatchTicks: 0}, {maxBatchTicks: 65_537},
    {maxBatchTicks: 64, maxEvents: 63}, {maxEvents: 65_537},
    {eventBytes: 4 * 1024 * 1024 + 1}, {moduleBytes: 2 * 1024 * 1024 + 1}
  ];
  for (const cost of mutations) {
    const core = wrapper(cost);
    const result = await createFlooohZ80CycleProvider({clockHz: 4_000_000,
      loadModule: async () => core});
    assert.equal(result.code, 'cycle-provider-cost-unsupported', JSON.stringify(cost));
    assert.equal(core.crossings(), 0);
  }
});

test('short or oversized drains throw instead of publishing partial cycle history', async () => {
  for (const tickBatch of [count => Array.from({length: count - 1}, () =>
    ({...pins(0), registers: {}})), count => Array.from({length: count + 1}, () =>
    ({...pins(0), registers: {}}))]) {
    const core = wrapper();
    core.tickBatch = tickBatch;
    const provider = await createFlooohZ80CycleProvider({clockHz: 4_000_000,
      loadModule: async () => core});
    assert.throws(() => provider.tickBatch(4), /incomplete or oversized/);
    assert.equal(provider.debugTime().ticks, 0, 'rejected drain advances no host-visible time');
  }
});
