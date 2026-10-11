import assert from 'node:assert/strict';
import { gradeCase, gradeFour } from './policy.mjs';

const cases = ['minor-baseline', 'minor-enabled', 'major-baseline', 'major-enabled'];
function sample(ids) {
  return { nodes: [{ id: 1, parent: 0, depth: 0, name: 'root', script: '', line: -1 },
    { id: 2, parent: 1, depth: 1, name: 'allocateTarget', script: 'file:///repo/scripts/xv6-js-rollback-direct-v8-target-site-nursery/case.mjs', line: 17 }],
  samples: ids.map(id => ({ id, node: 2, size: 100, count: 1 })) };
}
function valid(kind) {
  const minor = kind.startsWith('minor-'), enabled = kind.endsWith('enabled');
  return { premise: { fullGCCompleted: true, afterBegin: 0, afterSnapshot: 0 }, kind, flags: minor ? (enabled ? 4 : 0) : (enabled ? 2 : 0),
    pre: sample(['1', '2']), post: sample(enabled ? ['1', '2'] : []),
    beforeRelease: { gcCount: 0 }, afterRelease: { gcCount: 0 },
    finalFacts: { gc: [{ type: minor ? 1 : 4, flags: 0, ended: true }],
      weak: Array(64).fill(0), overflow: false, poison: false, closed: true } };
}
assert.equal(gradeFour(cases.map(valid)).supported, true);
for (const kind of cases) assert.equal(gradeCase(valid(kind)).callbacks, 64);
const bad = (kind, mutate, reason) => {
  const c = valid(kind); mutate(c); assert.throws(() => gradeCase(c), reason);
};
bad('minor-enabled', c => { c.post.samples = []; }, /sample ID/);
bad('minor-enabled', c => { c.post.samples.push({ id: '3', node: 2, size: 100, count: 1 }); }, /extra target-site/);
bad('minor-baseline', c => { c.post.samples.push({ id: '3', node: 2, size: 100, count: 1 }); }, /extra target-site/);
bad('major-baseline', c => { c.post.samples = c.pre.samples; }, /sample ID/);
bad('minor-baseline', c => { c.finalFacts.gc[0].type = 4; }, /designated GC/);
bad('major-enabled', c => { c.finalFacts.weak[17] = -1; }, /weak callback/);
bad('major-enabled', c => { c.finalFacts.gc.push({ type: 1, flags: 0, ended: true }); }, /post-witness/);
bad('minor-baseline', c => { c.afterRelease.gcCount = 1; }, /nursery admission premise/);
bad('minor-baseline', c => { c.pre.samples[1].id = '1'; }, /sample shape/);
bad('minor-baseline', c => { c.pre.samples[1].id = '18446744073709551616'; }, /sample shape/);
bad('minor-baseline', c => { c.pre.nodes[1].parent = 99; }, /node ancestry/);
bad('minor-baseline', c => { c.pre.nodes[1].depth = 0; }, /root parent/);
bad('minor-baseline', c => { c.pre.nodes[1].script = 'other.mjs'; }, /bounded facts/);
bad('minor-baseline', c => { c.pre.nodes[1].line = 18; }, /bounded facts/);
bad('minor-baseline', c => { c.pre.nodes[1].name = 'allocateCohort'; }, /bounded facts/);
bad('minor-baseline', c => { c.finalFacts.closed = false; }, /bounded facts/);
bad('minor-baseline', c => { c.finalFacts.overflow = true; }, /bounded facts/);
bad('minor-baseline', c => {
  c.beforeRelease.gcCount = 1; c.afterRelease.gcCount = 1;
  c.finalFacts.gc.unshift({ type: 4, flags: 0, ended: true });
  c.finalFacts.weak.fill(1);
}, /nursery admission premise/);
const rootZero = valid('minor-baseline');
rootZero.pre.nodes[0].id = 0;
rootZero.pre.nodes[1].parent = 0;
rootZero.post.nodes[0].id = 0;
rootZero.post.nodes[1].parent = 0;
assert.equal(gradeCase(rootZero).preCount, 2);
assert.throws(() => gradeFour([valid(cases[0]), valid(cases[0]), valid(cases[2]), valid(cases[3])]), /case order or duplicate/);
assert.throws(() => gradeFour([valid(cases[1]), valid(cases[0]), valid(cases[2]), valid(cases[3])]), /case order or duplicate/);


for (const field of ['afterBegin', 'afterSnapshot']) {
  for (const count of [-1, 1, 2, null, '0'])
    bad('minor-baseline', c => { c.premise[field] = count; }, /nursery admission premise/);
}
bad('minor-baseline', c => { c.premise.extra = 0; }, /nursery admission premise/);
bad('minor-baseline', c => { c.premise.fullGCCompleted = false; }, /nursery admission premise/);
bad('minor-baseline', c => { c.finalFacts.weak.fill(-1); }, /weak callback/);
import { makeAdmission } from './admission.mjs';
const runtime = { node: 'v20.20.2', execArgv: ['--expose-gc'] };
const order = [];
const addon = { begin: flags => order.push(['begin', flags]), facts: () => ({ gc: [] }) };
const admission = makeAdmission();
assert.deepEqual(admission(runtime, () => order.push(['fullGC']), addon, 4),
  { fullGCCompleted: true, afterBegin: 0, afterSnapshot: null });
assert.deepEqual(order, [['fullGC'], ['begin', 4]]);
assert.throws(() => admission(runtime, () => {}, addon, 4), /reentry/);
for (const execArgv of [[], ['--expose-gc', '--trace-gc'], ['--trace-gc'], ['--expose-gc', '--expose-gc']])
  assert.throws(() => makeAdmission()({ ...runtime, execArgv }, () => {}, addon, 0), /arguments/);
let began = false;
assert.throws(() => makeAdmission()(runtime, () => { throw Error('full GC failed'); },
  { ...addon, begin: () => { began = true; } }, 0), /full GC failed/);
assert.equal(began, false);
const nested = makeAdmission();
assert.throws(() => nested(runtime, () => nested(runtime, () => {}, addon, 0), addon, 0), /reentry/);
assert.throws(() => makeAdmission()(runtime, () => {}, { ...addon, facts: () => ({ gc: [{}] }) }, 0), /premise/);


for (const failingPhase of ['begin', 'facts']) {
  const attempt = makeAdmission();
  const original = Error(`original ${failingPhase} failure`);
  let credited = false, firstFailure = null;
  const failingAddon = {
    begin: () => { if (failingPhase === 'begin') throw original; },
    facts: () => { throw original; },
  };
  try { attempt(runtime, () => {}, failingAddon, 0); credited = true; }
  catch (error) { firstFailure = error; }
  assert.equal(firstFailure, original);
  assert.equal(credited, false);
  assert.deepEqual(attempt.status(), { phase: failingPhase, fullGCCompleted: true, afterBegin: null });
  assert.equal(Object.isFrozen(attempt.status()), true);
  assert.throws(() => { attempt.status().fullGCCompleted = false; }, TypeError);
}
const gcFailure = makeAdmission();
assert.throws(() => gcFailure(runtime, () => { throw Error('GC failure'); }, addon, 0), /GC failure/);
assert.deepEqual(gcFailure.status(), { phase: 'fullGC', fullGCCompleted: false, afterBegin: null });
assert.throws(() => { gcFailure.status = () => ({ fullGCCompleted: true }); }, TypeError);



for (const boundary of ['runtime', 'fullGC', 'begin', 'facts']) {
  const attempt = makeAdmission();
  const calls = [];
  const swallow = () => { try { attempt(runtime, () => {}, addon, 0); } catch {} };
  const observedRuntime = { node: 'v20.20.2', execArgv: ['--expose-gc'] };
  if (boundary === 'runtime') Object.defineProperty(observedRuntime, 'node', {
    enumerable: true, get: () => { swallow(); return 'v20.20.2'; },
  });
  const invoke = phase => { calls.push(phase); if (boundary === phase) swallow(); };
  let credited = false;
  assert.throws(() => {
    attempt(observedRuntime, () => invoke('fullGC'), {
      begin: () => invoke('begin'),
      facts: () => { invoke('facts'); return { gc: [] }; },
    }, 0);
    credited = true;
  }, /reentry/);
  assert.equal(credited, false);
  assert.deepEqual(calls, boundary === 'runtime' ? [] :
    ['fullGC', 'begin', 'facts'].slice(0, ['fullGC', 'begin', 'facts'].indexOf(boundary) + 1));
  assert.equal(attempt.status().fullGCCompleted, boundary !== 'runtime');
  assert.notEqual(attempt.status().phase, 'admitted');
}
console.log('nursery admission synthetic controls PASS');
