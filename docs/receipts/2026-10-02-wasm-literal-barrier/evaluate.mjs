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
const state = {schema: 1, diagnosticOnly: true, startedAt: new Date().toISOString(),
  toolHead, sources, verifications: {}, comparisons: [],
  automaticMerge: false, publication: false, appPinChanges: false};
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
if (existsSync(join(root, 'pipeline.json'))) {
  throw Error('Refusing to overwrite an existing pipeline receipt; inspect it before restarting.');
}
try {
  save();
  // The CLI supplies the recurring monitor. A failed RTx run is inspected
  // below rather than treated as a passing gate or automatically retried.
  await watchRun(37013735063, 'CrispStrobe/labwired-core');
  const native = JSON.parse(await readGh(['run', 'view', '37013735063', '--repo', 'CrispStrobe/labwired-core', '--json', 'headSha,status,conclusion,jobs,url']));
  assert.equal(native.headSha, sources.candidate.commit);
  assert.equal(native.conclusion, 'success', 'Source opcode/differential tests must pass');
  state.nativeCorrectness = native;
  save();
  for (const [label, source] of Object.entries(sources)) {
    console.log(`Watching ${label} build ${source.run}; publication disabled.`);
    await watchRun(source.run);
    const run = JSON.parse(await readGh(['run', 'view', String(source.run), '--repo', repo,
      '--json', 'headSha,status,conclusion,jobs,url']));
    const jobs = requiredJobs(run, label);
    const integration = await logs(jobs.get('test').databaseId);
    const counts = integration.match(/^tests=(\d+) fail=(\d+) skipped=(\d+)\s*$/m);
    assert(counts && Number(counts[1]) >= 101 && counts[2] === '0' && counts[3] === '0',
      'Actual-WASM integration must run at least 101 tests, zero failures/skips');
    const qualification = await logs(jobs.get('motion').databaseId);
    const result = motionProbeResult(qualification, jobs.get('motion').conclusion === 'success' ? 0 : 1);
    writeFileSync(join(root, `${label}-integration.txt`), integration + '\n');
    writeFileSync(join(root, `${label}-qualification.txt`), qualification + '\n');
    const directory = join(root, label);
    mkdirSync(directory);
    await gh(['run', 'download', String(source.run), '--repo', repo, '--name', 'labwired-wasm-b', '--dir', directory]);
    const info = JSON.parse(readFileSync(join(directory, 'BUILD-INFO.json'), 'utf8'));
    assert.equal(info.ref, source.commit, `${label} artifact source mismatch`);
    for (const target of ['nodejs', 'web']) for (const file of ['labwired_wasm.js', 'labwired_wasm_bg.wasm']) {
      const bytes = readFileSync(join(directory, target, file));
      assert.equal(bytes.length, info.targets[target][file].bytes, `${label}/${target}/${file} byte mismatch`);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), info.targets[target][file].sha256,
        `${label}/${target}/${file} hash mismatch`);
    }
    assert.equal(info.postprocess, undefined, 'No optimizer recipe may be stacked');
    assert(!readFileSync(join(directory, 'nodejs/labwired_wasm.js'), 'utf8').includes('fastpath_census'), 'No instrumentation in timed builds');
    if (label === 'candidate') assert.notEqual(info.targets.nodejs['labwired_wasm_bg.wasm'].sha256, state.verifications.baseline.buildInfo.targets.nodejs['labwired_wasm_bg.wasm'].sha256);
    state.verifications[label] = {url: run.url, integrationTests: Number(counts[1]),
      qualification: result, buildInfo: info};
    save();
    console.log(`${label} verified; fresh floor pass=${result.allWindowsMeet1x}.`);
  }
  for (let repeat = 1; repeat <= 4; repeat++) {
    const nodeVersion = repeat <= 2 ? "20.20.2" : "22.23.3";
    const reverse = repeat % 2 === 0;
    const liveTool = await readGh(['api', `repos/${repo}/git/ref/heads/${toolRef}`, '--jq', '.object.sha']);
    assert.equal(liveTool, toolHead, 'Tooling branch changed before comparison');
    // A dispatch timeout is ambiguous: stop, never retry and create duplicates.
    const dispatched = await gh(['workflow', 'run', 'labwired-motion-ab.yml', '--repo', repo,
      '--ref', toolRef, '-f', `baseline_run=${sources.baseline.run}`,
      '-f', `baseline_commit=${sources.baseline.commit}`, '-f', `candidate_run=${sources.candidate.run}`,
      '-f', `candidate_commit=${sources.candidate.commit}`, '-f', 'allow_paired_glue=true', '-f', 'profile=false', '-f', 'f0=true',
      '-f', `node_version=${nodeVersion}`, '-f', `reverse=${reverse}`]);
    const id = dispatched.match(/\/actions\/runs\/(\d+)/)?.[1];
    assert(id, `Dispatch receipt missing; inspect remote before any retry: ${dispatched}`);
    const comparison = {repeat, nodeVersion, reverse, run: Number(id), url: `https://github.com/${repo}/actions/runs/${id}`};
    state.comparisons.push(comparison);
    save();
    console.log(`Ordinary hosted comparison ${repeat}: ${comparison.url}`);
    await watchRun(id);
    const verdict = JSON.parse(await readGh(['run', 'view', id, '--repo', repo,
      '--json', 'headSha,status,conclusion']));
    assert.equal(verdict.headSha, toolHead);
    assert.equal(verdict.conclusion, 'success', 'A/B diagnostic failed; inspect raw evidence');
    const directory = join(root, `hosted-ab-${repeat}`);
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
