// Sequential ordinary measurements only; no owned build/profile runs overlap.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, existsSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const exec = promisify(execFile), root = dirname(fileURLToPath(import.meta.url));
const tool = '/mnt/volume1/code/lego/cp13-motion-board-20261001';
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
assert.equal(process.version, 'v20.20.2');
assert(!process.env.NODE_OPTIONS);
assert.equal((await exec('git', ['rev-parse', 'HEAD'], {cwd: tool})).stdout.trim(), 'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162');
const state = {diagnosticOnly: true, startedAt: new Date().toISOString(), node: process.version,
  publication: false, appPinChanges: false, hardwareAcknowledgementChanges: false,
  harnessHashes: Object.fromEntries(['probe-labwired-motion-ab.mjs', 'probe-labwired-f0-ab.mjs'].map(s => [s, hash(join(tool, 'scripts', s))])), runs: []};
const output = join(root, 'vps-summary.json');
assert(!existsSync(output), 'Refusing to overwrite original evidence');
const save = () => writeFileSync(output, JSON.stringify(state, null, 2) + '\n');
save();
try {
  for (const mode of ['instructions', 'locals']) {
    const directory = join(root, mode), deadline = Date.now() + 45 * 60_000;
    for (;;) {
      const pipeline = JSON.parse(readFileSync(join(directory, 'pipeline.json')));
      assert(!pipeline.error, 'Hosted candidate verification failed: ' + pipeline.error);
      if (pipeline.verifications.candidate) break;
      assert(Date.now() < deadline, 'Build did not qualify for local measurement in time');
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    const info = JSON.parse(readFileSync(join(directory, 'candidate/BUILD-INFO.json')));
    assert.equal(info.postprocess.mode, mode);
    for (const reverse of [false, true]) for (const workload of ['motion', 'f0']) {
      const name = `vps-${workload}-${reverse ? 'reverse' : 'primary'}`;
      const out = join(directory, workload === 'motion' ? name + '.json' : name);
      const args = [join(tool, `scripts/probe-labwired-${workload}-ab.mjs`),
        '--baseline', join(directory, 'baseline/nodejs'), '--candidate', join(directory, 'candidate/nodejs'), '--out', out,
        ...(reverse ? ['--reverse'] : [])];
      console.log(`Sequential VPS: ${mode} ${workload} ${reverse ? 'BAAB' : 'ABBA'}`);
      const result = await exec(process.execPath, args, {cwd: tool, encoding: 'utf8', timeout: 1000000, maxBuffer: 32 * 1024 * 1024});
      writeFileSync(join(directory, name + '-launcher-stdout.txt'), result.stdout);
      writeFileSync(join(directory, name + '-launcher-stderr.txt'), result.stderr);
      const receiptPath = workload === 'motion' ? out : join(out, 'abba.json');
      const receipt = JSON.parse(readFileSync(receiptPath));
      assert(receipt.completedAt && receipt.guestObservationsMatch);
      state.runs.push({mode, workload, reverse, receipt: receiptPath, sha256: hash(receiptPath), summary: receipt.summary});
      save(); console.log(JSON.stringify(state.runs.at(-1)));
    }
  }
  state.completedAt = new Date().toISOString(); save();
} catch (error) {
  state.error = error.message; state.stoppedAt = new Date().toISOString(); save();
  console.error(error); process.exitCode = 1;
}
