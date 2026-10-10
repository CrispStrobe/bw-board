// CPU-free predicate for a prospective isolated target-site support case.
const CASES = Object.freeze({
  'minor-baseline': { flag: 0, type: 1, retained: false },
  'minor-enabled': { flag: 4, type: 1, retained: true },
  'major-baseline': { flag: 0, type: 4, retained: false },
  'major-enabled': { flag: 2, type: 4, retained: true },
});
const uint = (v, max = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(v) && v >= 0 && v <= max;
const FACTORY_SCRIPT = '/scripts/xv6-js-rollback-direct-v8-target-site/case.mjs';
const FACTORY_LINE = 16;
const FACTORY_NAME = 'allocateTarget';

function profileIds(profile) {
  if (!profile || !Array.isArray(profile.nodes) || !Array.isArray(profile.samples) ||
      profile.nodes.length > 4096 || profile.samples.length > 65536) throw Error('profile shape');
  const nodes = new Map();
  let roots = 0;
  for (const n of profile.nodes) {
    if (!uint(n.id, 0xffffffff) || !uint(n.parent, 0xffffffff) ||
        !uint(n.depth, 64) || typeof n.name !== 'string' || n.name.length > 256 ||
        typeof n.script !== 'string' || n.script.length > 1024 ||
        !Number.isInteger(n.line) || n.line < -1 || n.line > 1000000 ||
        nodes.has(n.id)) throw Error('node shape');
    nodes.set(n.id, n);
    if (n.depth === 0) {
      roots++;
      if (n.parent !== 0) throw Error('root parent');
    }
  }
  if (roots !== 1) throw Error('root count');
  for (const n of nodes.values()) {
    if (n.depth === 0) continue;
    const parent = nodes.get(n.parent);
    if (!parent || parent.depth + 1 !== n.depth) throw Error('node ancestry');
  }
  const ids = new Set();
  const selected = new Set();
  for (const s of profile.samples) {
    if (!s || typeof s.id !== 'string' || !/^[1-9][0-9]{0,19}$/.test(s.id) ||
        BigInt(s.id) > 18446744073709551615n ||
        ids.has(s.id) || !uint(s.node, 0xffffffff) || !nodes.has(s.node) ||
        !uint(s.size) || !uint(s.count, 0xffffffff) || s.count === 0) throw Error('sample shape');
    ids.add(s.id);
    let n = nodes.get(s.node), depth = 0, found = false;
    while (n) {
      if (n.name === FACTORY_NAME && n.script.endsWith(FACTORY_SCRIPT) &&
          n.line === FACTORY_LINE) found = true;
      if (n.depth === 0) break;
      n = nodes.get(n.parent);
      if (++depth > 64) throw Error('node ancestry');
    }
    if (!n || !found) continue;
    selected.add(s.id);
  }
  return selected;
}

export function gradeCase({ kind, flags, pre, post, beforeRelease, afterRelease,
                            finalFacts }) {
  const spec = CASES[kind];
  if (!spec || flags !== spec.flag) throw Error('case authority');
  const preIds = profileIds(pre), postIds = profileIds(post);
  if (!preIds.size || !beforeRelease || !afterRelease || !finalFacts ||
      !Array.isArray(finalFacts.gc) || finalFacts.gc.length > 256 ||
      !Array.isArray(finalFacts.weak) || finalFacts.weak.length !== 64 ||
      finalFacts.overflow !== false || finalFacts.poison !== false ||
      finalFacts.closed !== true) throw Error('bounded facts');
  if (!uint(beforeRelease.gcCount, 256) || !uint(afterRelease.gcCount, 256) ||
      afterRelease.gcCount !== beforeRelease.gcCount ||
      finalFacts.gc.length <= afterRelease.gcCount) throw Error('release gap');
  const events = finalFacts.gc;
  for (const e of events) if (!e || !uint(e.type, 31) || !uint(e.flags, 127) ||
      e.ended !== true) throw Error('GC event');
  const designated = afterRelease.gcCount;
  if (events[designated].type !== spec.type) throw Error('wrong designated GC');
  if (spec.type === 1 && events.some(e => (e.type & 4) !== 0))
    throw Error('major collection before minor witness');
  for (const index of finalFacts.weak) if (index !== designated) throw Error('weak callback attribution');
  if (events.length !== designated + 1) throw Error('post-witness GC');
  for (const id of preIds) {
    if (postIds.has(id) !== spec.retained) throw Error('sample ID predicate');
  }
  if (postIds.size !== (spec.retained ? preIds.size : 0))
    throw Error('extra target-site sample ID');
  return Object.freeze({ kind, preCount: preIds.size, postCount: postIds.size,
    designated, callbacks: finalFacts.weak.length });
}

export function gradeFour(cases) {
  if (!Array.isArray(cases) || cases.length !== 4) throw Error('four cases required');
  const expected = Object.keys(CASES);
  for (let i = 0; i < expected.length; ++i) {
    if (cases[i]?.kind !== expected[i]) throw Error('case order or duplicate');
    gradeCase(cases[i]);
  }
  return Object.freeze({ supported: true, cases: expected });
}
