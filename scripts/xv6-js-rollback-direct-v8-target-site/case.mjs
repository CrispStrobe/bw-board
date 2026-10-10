// One hosted Node 20.20.2 child per case. Never imported by the emulator.
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';
import { gradeCase } from './policy.mjs';

const KINDS = Object.freeze({
  'minor-baseline': 0, 'minor-enabled': 4,
  'major-baseline': 0, 'major-enabled': 2,
});
const require = createRequire(import.meta.url);
const tick = () => new Promise(resolve => setImmediate(resolve));

// The selected function contains one target allocation expression. Cohort
// bookkeeping runs in its caller, outside the selected call-tree branch.
function allocateTarget() {
  return new Array(1024);
}
function allocateCohort() {
  const cohort = [];
  for (let i = 0; i < 64; ++i) cohort.push(allocateTarget());
  return cohort;
}

async function main() {
  const [addonPath, kind, outDir] = process.argv.slice(2);
  if (process.version !== 'v20.20.2' || !Object.hasOwn(KINDS, kind) ||
      typeof addonPath !== 'string' || typeof outDir !== 'string' ||
      process.argv.length !== 5) throw Error('pinned case arguments');
  if (kind.startsWith('major-') && typeof global.gc !== 'function')
    throw Error('major control requires explicit hosted --expose-gc');
  const addon = require(resolve(addonPath));
  mkdirSync(outDir, { recursive: false });
  const record = { schema: 'bw.direct-v8.support-case.v1', kind,
    runtime: { node: process.version, v8: process.versions.v8,
      execArgv: process.execArgv }, firstFailure: null, pre: null, post: null,
    beforeRelease: null, afterRelease: null, finalFacts: null, grade: null,
    secondaryFailures: [] };
  const save = (name, value, max = 8 * 1024 * 1024) => {
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > max) throw Error(`${name} exceeds bound`);
    writeFileSync(join(outDir, name), raw, { flag: 'wx', mode: 0o600 });
  };
  try {
    addon.begin(KINDS[kind]);
    let held = allocateCohort();
    addon.adopt(held);
    record.pre = addon.snapshot();
    save('pre.json', record.pre);
    // Crossing a job while retained prevents the release from being credited
    // to an earlier GC or an only-in-the-current-job JS reference.
    await tick();
    record.beforeRelease = { gcCount: addon.facts().gc.length };
    held = null;
    record.afterRelease = { gcCount: addon.facts().gc.length };
    if (record.beforeRelease.gcCount !== record.afterRelease.gcCount)
      throw Error('GC in release gap');
    if (kind.startsWith('major-')) {
      global.gc();
    } else {
      const pressure = [];
      for (let i = 0; i < 512; ++i) {
        pressure.push(Array.from({ length: 1024 }, (_, j) => i + j));
        if (addon.facts().gc.length > record.afterRelease.gcCount) break;
      }
      if (addon.facts().gc.length === record.afterRelease.gcCount)
        throw Error('no bounded minor collection');
    }
    record.post = addon.snapshot();
    save('post.json', record.post);
  } catch (error) {
    record.firstFailure = String(error?.message ?? error).slice(0, 200);
  } finally {
    try { addon.stop(); }
    catch (error) {
      const reason = `stop: ${String(error).slice(0, 160)}`;
      if (record.firstFailure) record.secondaryFailures.push(reason);
      else record.firstFailure = reason;
    }
    try { record.finalFacts = addon.facts(); save('facts.json', record.finalFacts, 65536); }
    catch (error) {
      const reason = `facts: ${String(error).slice(0, 160)}`;
      if (record.firstFailure) record.secondaryFailures.push(reason);
      else record.firstFailure = reason;
    }
    if (!record.firstFailure) {
      try { record.grade = gradeCase({ ...record, flags: KINDS[kind] }); }
      catch (error) { record.firstFailure = String(error?.message ?? error).slice(0, 200); }
    }
    save('result.json', { ...record, pre: undefined, post: undefined }, 65536);
  }
  if (record.firstFailure) process.exitCode = 1;
}
await main();
