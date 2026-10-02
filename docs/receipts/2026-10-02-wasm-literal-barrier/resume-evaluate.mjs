import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync, writeFileSync, mkdirSync, existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {createHash} from 'node:crypto';
import {motionProbeResult} from '/mnt/volume1/code/lego/cp13-motion-board-20261001/scripts/lib/motion-ab-receipt.mjs';

const exec = promisify(execFile);
const root = dirname(fileURLToPath(import.meta.url));
const repo = 'CrispStrobe/bw-board';
const toolRef = 'perf/register-inline-node-control-20261002';
const toolHead = 'fb13d48b7bc377bceb5da5a1d4ed5cd11555e162';
const buildToolHeads = {baseline: '1cac10ba28ddd5e71c5a7e32437a3b0080d47f14',
  candidate: 'be39f8f1d52699bd40dcd535e91d6946c27ff41a'};
const candidateRun = process.argv.includes('--self-test') ? 1 : Number(process.argv[2]);
assert(Number.isSafeInteger(candidateRun) && candidateRun > 0, 'Explicit candidate run ID required');
const sources = {
  baseline: {run: 36915940413, commit: '43b2d62f5a0fa24ae0b38a645069f5aaa78af685'},
  candidate: {run: candidateRun, commit: '45463b863decbe085ffb890edb8d11041594b7f2'},
};
const state = JSON.parse(readFileSync(join(root, 'pipeline.json'), 'utf8'));
assert.deepEqual(state.sources, sources);
assert.equal(state.toolHead, toolHead);
assert.equal(state.automaticMerge, false);
assert.equal(state.publication, false);
assert.equal(state.appPinChanges, false);
assert(!state.error && !state.completedAt);
const save = () => writeFileSync(join(root, 'pipeline.json'), JSON.stringify(state, null, 2) + '\n');
const gh = async (args, timeout = 120_000) =>
  (await exec('gh', args, {encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024})).stdout.trim();
const readGh = async args => {
  for (let attempt = 0; ; attempt++) {
    try { return await gh(args); }
    catch (error) {
      if (attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  }
};
// Read-only polling avoids a single transient gh-watch TLS error ending the run.
const watchRun = async (id, repository = repo) => {
  const deadline = Date.now() + 3 * 60 * 60 * 1000;
  while (Date.now() < deadline) {
    const run = JSON.parse(await readGh(['run', 'view', String(id), '--repo', repository,
      '--json', 'status,conclusion']));
    if (run.status === 'completed') return;
    await new Promise(resolve => setTimeout(resolve, 45_000));
  }
  throw Error('Read-only monitor deadline exceeded; inspect existing run, do not redispatch');
};
const logs = async id => (await readGh(['api', `repos/${repo}/actions/jobs/${id}/logs`]))
  .split('\n').map(line => line.replace(/^\d{4}-\d\d-\d\dT\S+ /, '')).join('\n');
function requiredJobs(run, label = 'baseline') {
  assert.equal(run.headSha, buildToolHeads[label], 'Build tooling source changed');
  assert.equal(run.status, 'completed', 'Build run incomplete');
  const jobs = new Map(run.jobs.map(job => [job.name, job]));
  for (const name of ['build (a)', 'build (b)', 'determinism', 'test']) {
    assert.equal(jobs.get(name)?.conclusion, 'success', `Critical build check did not pass: ${name}`);
  }
  assert.equal(jobs.get('publish')?.conclusion, 'skipped', 'Publication must stay disabled');
  assert(['success', 'failure'].includes(jobs.get('motion')?.conclusion), 'Motion gate must execute');
  return jobs;
}
if (process.argv.includes('--self-test')) {
  const names = ['build (a)', 'build (b)', 'determinism', 'test', 'motion', 'publish'];
  const good = {headSha: buildToolHeads.baseline, status: 'completed', jobs: names.map(name => ({name,
    conclusion: name === 'publish' ? 'skipped' : name === 'motion' ? 'failure' : 'success'}))};
  requiredJobs(good);
  for (const name of ['build (a)', 'build (b)', 'determinism', 'test', 'motion', 'publish']) {
    assert.throws(() => requiredJobs({...good, jobs: good.jobs.filter(job => job.name !== name)}));
  }
  assert.throws(() => requiredJobs({...good, headSha: 'changed'}));
  assert.throws(() => requiredJobs({...good, status: 'in_progress'}));
  assert.throws(() => requiredJobs({...good, jobs: good.jobs.map(job => job.name === 'test'
    ? {...job, conclusion: 'failure'} : job)}));
  assert.throws(() => requiredJobs({...good, jobs: good.jobs.map(job => job.name === 'publish'
    ? {...job, conclusion: 'success'} : job)}));
  const candidate = {...good, headSha: buildToolHeads.candidate};
  requiredJobs(candidate, 'candidate');
  assert.throws(() => requiredJobs(good, 'candidate'));
  assert.throws(() => requiredJobs({...candidate, jobs: candidate.jobs.filter(j => j.name !== 'publish')}, 'candidate'));
  console.log('Pipeline guard self-tests passed; not CI evidence.');
  process.exit(0);
}
try {
  assert.equal(state.nativeCorrectness.headSha, sources.candidate.commit);
  assert.equal(state.nativeCorrectness.conclusion, 'success');
  for (const [label, source] of Object.entries(sources)) {
    const verified = state.verifications[label];
    assert(verified && verified.integrationTests >= 101);
    const info = JSON.parse(readFileSync(join(root, label, 'BUILD-INFO.json')));
    assert.equal(info.ref, source.commit);
    assert.deepEqual(info, verified.buildInfo);
    assert.equal(info.postprocess, undefined);
    for (const target of ['nodejs', 'web']) for (const file of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
      const bytes = readFileSync(join(root, label, target, file));
      assert.equal(bytes.length, info.targets[target][file].bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), info.targets[target][file].sha256);
    }
  }
  for (let repeat = 1; repeat <= 4; repeat++) {
    const nodeVersion = repeat <= 2 ? "20.20.2" : "22.23.3";
    const reverse = repeat % 2 === 0;
    const liveTool = await readGh(['api', `repos/${repo}/git/ref/heads/${toolRef}`, '--jq', '.object.sha']);
    assert.equal(liveTool, toolHead, 'Tooling branch changed before comparison');
    let comparison = state.comparisons.find(item => item.repeat === repeat);
    if (comparison) {
      assert.equal(comparison.nodeVersion, nodeVersion);
      assert.equal(comparison.reverse, reverse);
      assert(Number.isSafeInteger(comparison.run));
      if (comparison.summary && comparison.f0Summary) continue;
      console.log('Collecting EXISTING comparison ' + comparison.run);
    } else {
      // Never retry an ambiguous write/dispatch.
      const dispatched = await gh(['workflow', 'run', 'labwired-motion-ab.yml', '--repo', repo,
        '--ref', toolRef, '-f', 'baseline_run=' + sources.baseline.run,
        '-f', 'baseline_commit=' + sources.baseline.commit, '-f', 'candidate_run=' + sources.candidate.run,
        '-f', 'candidate_commit=' + sources.candidate.commit, '-f', 'allow_paired_glue=true',
        '-f', 'profile=false', '-f', 'f0=true', '-f', 'node_version=' + nodeVersion, '-f', 'reverse=' + reverse]);
      const dispatchedId = dispatched.match(/\/actions\/runs\/(\d+)/)?.[1];
      assert(dispatchedId, 'Missing dispatch receipt: inspect remote before retry');
      comparison = {repeat, nodeVersion, reverse, run: Number(dispatchedId),
        url: 'https://github.com/' + repo + '/actions/runs/' + dispatchedId};
      state.comparisons.push(comparison);
      save();
      console.log('New comparison: ' + comparison.url);
    }
    const id = String(comparison.run);
    await watchRun(id);
    const verdict = JSON.parse(await readGh(['run', 'view', id, '--repo', repo,
      '--json', 'headSha,status,conclusion']));
    assert.equal(verdict.headSha, toolHead);
    assert.equal(verdict.conclusion, 'success', 'A/B diagnostic failed; inspect raw evidence');
    const directory = join(root, `hosted-ab-${repeat}`);
    assert(!existsSync(directory), 'Partial download exists: inspect without overwriting');
    mkdirSync(directory);
    await gh(['run', 'download', id, '--repo', repo, '--name', 'motion-artifact-ab-diagnostic', '--dir', directory]);
    const receipt = JSON.parse(readFileSync(join(directory, 'abba.json'), 'utf8'));
    assert.equal(receipt.node, `v${nodeVersion}`);
    assert.deepEqual(receipt.order, reverse ? ['candidate','baseline','baseline','candidate'] : ['baseline','candidate','candidate','baseline']);
    assert.equal(receipt.guestObservationsMatch, true);
    assert.equal(receipt.runs.length, 4);
    comparison.summary = receipt.summary;
    const f0 = JSON.parse(readFileSync(join(directory, 'f0-abba/abba.json'), 'utf8'));
    assert.equal(f0.guestObservationsMatch, true);
    assert.equal(f0.runs.length, 4);
    comparison.f0Summary = f0.summary;
    save();
    console.log(JSON.stringify({repeat, motion: receipt.summary, f0: f0.summary}));
  }
  state.completedAt = new Date().toISOString();
  save();
  console.log('Four runtime/order comparisons retained. No automatic merge, publication or acknowledgement update.');
} catch (error) {
  state.stoppedAt = new Date().toISOString();
  state.error = error.message;
  save();
  console.error(`STOPPED: ${error.message}`);
  process.exitCode = 1;
}
