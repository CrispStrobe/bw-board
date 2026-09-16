import test from 'node:test';
import assert from 'node:assert/strict';
import {createExecutionPolicy, MACHINE_SEMANTICS} from 'bw-board/execution-policy';

// Synthetic providers, not declarations about existing CPU backends.
const entry = (id, overrides = {}) => ({id, family: 'test-cpu',
  semantics: 'functional-hardware', implementation: 'javascript', rank: 10,
  capabilities: ['registers', 'memory'], reference: false, experimental: false,
  qualification: 'qualified', evidence: 'test-fixture:owned-v1', ...overrides});
const request = overrides => ({family: 'test-cpu', semantics: 'functional-hardware', ...overrides});
const explicit = id => request({mode: 'implementation', implementationId: id});

test('Auto uses reviewed rank then code-point ID, independent of registration and availability order', () => {
  const catalog = [entry('z', {rank: 2}), entry('a', {rank: 2}), entry('cheap', {rank: 1})];
  for (const order of [catalog, [...catalog].reverse()]) {
    const policy = createExecutionPolicy(order);
    assert.equal(policy.select(request(), {available: ['z', 'a']}).selected.id, 'a');
    assert.equal(policy.select(request(), {available: ['z', 'a', 'cheap']}).selected.id, 'cheap');
  }
});

test('explicit reference excludes optimized entries and preserves machine semantics', () => {
  const policy = createExecutionPolicy([entry('optimized', {rank: 0}), entry('reference', {reference: true}),
    entry('wired-ref', {reference: true, semantics: 'wired-digital', rank: 0})]);
  const result = policy.select(request({mode: 'reference'}), {available: ['optimized', 'reference', 'wired-ref']});
  assert.equal(result.selected.id, 'reference');
  assert.equal(policy.select(request({semantics: 'dos-services'}), {available: ['reference']}).code,
    'no-matching-implementation');
});

test('explicit override never falls back on family or semantic mismatch', () => {
  const policy = createExecutionPolicy([entry('normal'), entry('wired', {semantics: 'wired-digital'}),
    entry('other', {family: 'other-cpu'})]);
  const runtime = {available: ['normal', 'wired', 'other']};
  assert.equal(policy.select(explicit('wired'), runtime).code, 'semantics-mismatch');
  assert.equal(policy.select(explicit('other'), runtime).code, 'family-mismatch');
  assert.equal(policy.select(explicit('missing'), runtime).code, 'unknown-implementation');
});

test('observation attachment re-admits and can refuse, never inventing bus/analog capabilities', () => {
  const policy = createExecutionPolicy([entry('fast', {rank: 0}),
    entry('observable', {capabilities: ['registers', 'memory', 'instruction-events']})]);
  const runtime = {available: ['fast', 'observable']};
  assert.equal(policy.select(request(), runtime).selected.id, 'fast');
  assert.equal(policy.select(request({requiredCapabilities: ['instruction-events']}), runtime).selected.id, 'observable');
  const result = policy.select(request({requiredCapabilities: ['bus-events', 'analog']}), runtime);
  assert.equal(result.code, 'no-eligible-implementation');
  assert.ok(result.refusals.every(item => item.code === 'missing-capability'));
  assert.equal(policy.select({...explicit('fast'), requiredCapabilities: ['bus-events']}, runtime).code, 'missing-capability');
});

test('loader omission fails closed and arbitrary runtime metadata cannot promote candidates', () => {
  const policy = createExecutionPolicy([entry('available'),
    entry('broken', {qualification: 'rejected', reason: 'oracle mismatch'}),
    entry('pending', {qualification: 'pending', reason: 'not measured'})]);
  assert.equal(policy.select(explicit('available')).code, 'implementation-unavailable');
  const runtime = {available: ['broken', 'pending'], qualification: 'qualified', capabilities: ['analog']};
  assert.equal(policy.select(explicit('broken'), runtime).code, 'candidate-rejected');
  assert.equal(policy.select(explicit('pending'), runtime).code, 'candidate-unqualified');
  assert.equal(createExecutionPolicy([]).select(request(), {available: ['full-wired-wasm']}).accepted, false);
});

test('experimental paths require explicit implementation AND opt-in; Auto never picks them', () => {
  const policy = createExecutionPolicy([entry('experiment', {experimental: true, rank: 0}), entry('normal')]);
  const runtime = {available: ['experiment', 'normal']};
  assert.equal(policy.select(explicit('experiment'), runtime).code, 'experimental-opt-in-required');
  assert.equal(policy.select({...explicit('experiment'), allowExperimental: true}, runtime).selected.id, 'experiment');
  assert.equal(policy.select(request({allowExperimental: true}), runtime).selected.id, 'normal');
});

test('defensive immutable results and catalog snapshot; selection never invokes or mutates a target', () => {
  const catalog = [entry('normal')];
  const policy = createExecutionPolicy(catalog);
  catalog[0].capabilities.push('bus-events');
  catalog[0].qualification = 'rejected';
  const input = request();
  const runtime = {available: ['normal'], load () { throw Error('must not load'); }, target: {pc: 12}};
  const result = policy.select(input, runtime);
  assert.equal(result.restartRequired, true);
  assert.equal(result.selected.qualification, 'qualified');
  assert.deepEqual(result.selected.capabilities, ['registers', 'memory']);
  assert.equal(runtime.target.pc, 12);
  assert.deepEqual(input, request());
  assert.throws(() => result.selected.capabilities.push('analog'), TypeError);
  assert.throws(() => { result.requested.mode = 'reference'; }, TypeError);
  assert.equal(policy.select(request(), runtime).selected.id, 'normal');
  assert.ok(Object.isFrozen(MACHINE_SEMANTICS));
});

test('invalid catalogs cannot accidentally qualify or ambiguously rank implementations', () => {
  for (const catalog of [null, [entry('x'), entry('x')], [entry('x', {rank: NaN})],
    [entry('x', {rank: -1})], [entry('x', {evidence: ''})],
    [entry('x', {semantics: 'auto'})], [entry('x', {capabilities: ['memory', 'memory']})],
    [entry('x', {qualification: 'rejected', reason: ''})], [entry('x', {experimental: 'false'})],
    [entry('x', {reason: {nested: 'not text'}})], new Array(1),
    [entry('x', {capabilities: new Array(1)})]]) {
    assert.throws(() => createExecutionPolicy(catalog), TypeError);
  }
});

test('malformed preferences return named refusal instead of changing execution', () => {
  const policy = createExecutionPolicy([entry('normal')]);
  for (const input of [null, [], {}, request({mode: 'fast'}), request({mode: 'implementation'}),
    request({implementationId: 'normal'}), request({allowExperimental: 'yes'}),
    request({requiredCapabilities: 'memory'})]) {
    const result = policy.select(input);
    assert.equal(result.code, 'invalid-request');
    assert.equal(result.selected, null);
    assert.equal(result.restartRequired, false);
  }
  assert.equal(policy.select(request(), {available: 'normal'}).code, 'invalid-request');
  assert.equal(policy.select(request(), null).code, 'invalid-request');
});

// ── 'gate-level' — the fourth machine semantics ──────────────────────
//
// Added for FPGA work (a synthesised netlist simulated gate by gate). The
// tests that matter are not "the value exists" but "it never silently becomes
// something coarser", which is the whole point of the policy layer.

test('gate-level is a machine semantics, beneath wired-digital and distinct from it', () => {
  assert.ok(MACHINE_SEMANTICS.includes('gate-level'));
  // The three that existed before must survive, in order: other modules and
  // saved catalogs depend on these spellings.
  assert.deepEqual(MACHINE_SEMANTICS.slice(0, 3),
    ['dos-services', 'functional-hardware', 'wired-digital']);
  assert.ok(Object.isFrozen(MACHINE_SEMANTICS));
});

test('a gate-level request is REFUSED BY NAME rather than degraded to a coarser machine', () => {
  // The catalog offers the two nearest neighbours and no netlist provider.
  const policy = createExecutionPolicy([
    entry('functional', {semantics: 'functional-hardware', rank: 0}),
    entry('wired', {semantics: 'wired-digital', rank: 1}),
  ]);
  const result = policy.select(request({semantics: 'gate-level'}),
    {available: ['functional', 'wired']});
  assert.equal(result.accepted, false);
  assert.equal(result.code, 'no-matching-implementation');
  assert.equal(result.selected, null,
    'silently selecting a coarser machine is the failure this layer exists to prevent');
  assert.equal(result.requested.semantics, 'gate-level',
    'the refusal must still say what was asked for');
});

test('gate-level is selected when a provider actually offers it', () => {
  const policy = createExecutionPolicy([
    entry('netlist', {semantics: 'gate-level', capabilities: ['nets', 'gates']}),
    entry('wired', {semantics: 'wired-digital', rank: 0}),
  ]);
  const result = policy.select(request({semantics: 'gate-level'}), {available: ['netlist', 'wired']});
  assert.equal(result.accepted, true);
  assert.equal(result.selected.id, 'netlist');
  assert.equal(result.selected.semantics, 'gate-level');
  assert.equal(result.restartRequired, true);
});

test('a gate-level provider never satisfies a request for a coarser machine', () => {
  // The converse leak: a cheap netlist entry must not be handed to something
  // that asked for bus-phase behaviour it cannot model.
  const policy = createExecutionPolicy([entry('netlist', {semantics: 'gate-level', rank: 0})]);
  for (const semantics of ['wired-digital', 'functional-hardware', 'dos-services']) {
    const result = policy.select(request({semantics}), {available: ['netlist']});
    assert.equal(result.accepted, false, `${semantics} must not be served by a gate-level entry`);
    assert.equal(result.code, 'no-matching-implementation');
  }
});

test('gate-level obeys the same admission rules as every other semantics', () => {
  const policy = createExecutionPolicy([
    entry('unavailable', {semantics: 'gate-level', rank: 0}),
    entry('needs-caps', {semantics: 'gate-level', rank: 1, capabilities: ['nets']}),
  ]);
  const missing = policy.select(request({semantics: 'gate-level', requiredCapabilities: ['waveforms']}),
    {available: ['unavailable', 'needs-caps']});
  assert.equal(missing.accepted, false);
  assert.ok(missing.refusals.some(r => r.code === 'missing-capability'));
  const unavailable = policy.select(request({semantics: 'gate-level'}), {available: []});
  assert.equal(unavailable.accepted, false);
  assert.ok(unavailable.refusals.every(r => r.code === 'implementation-unavailable'));
});
