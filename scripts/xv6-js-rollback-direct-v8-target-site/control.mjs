import assert from 'node:assert/strict';
import { gradeCase, gradeFour } from './policy.mjs';

const cases = ['minor-baseline', 'minor-enabled', 'major-baseline', 'major-enabled'];
function sample(ids) {
  return { nodes: [{ id: 1, parent: 0, depth: 0, name: 'root', script: '', line: -1 },
    { id: 2, parent: 1, depth: 1, name: 'allocateTarget', script: 'file:///repo/scripts/xv6-js-rollback-direct-v8-target-site/case.mjs', line: 16 }],
  samples: ids.map(id => ({ id, node: 2, size: 100, count: 1 })) };
}
function valid(kind) {
  const minor = kind.startsWith('minor-'), enabled = kind.endsWith('enabled');
  return { kind, flags: minor ? (enabled ? 4 : 0) : (enabled ? 2 : 0),
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
bad('minor-baseline', c => { c.afterRelease.gcCount = 1; }, /release gap/);
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
}, /major collection before minor witness/);
const rootZero = valid('minor-baseline');
rootZero.pre.nodes[0].id = 0;
rootZero.pre.nodes[1].parent = 0;
rootZero.post.nodes[0].id = 0;
rootZero.post.nodes[1].parent = 0;
assert.equal(gradeCase(rootZero).preCount, 2);
assert.throws(() => gradeFour([valid(cases[0]), valid(cases[0]), valid(cases[2]), valid(cases[3])]), /case order or duplicate/);
assert.throws(() => gradeFour([valid(cases[1]), valid(cases[0]), valid(cases[2]), valid(cases[3])]), /case order or duplicate/);
console.log('direct V8 target-site policy controls PASS');
