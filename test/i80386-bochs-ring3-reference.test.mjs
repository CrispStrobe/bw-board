import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {inflateSync} from 'node:zlib';
import {buildFixture} from '../scripts/i80386-ring3-int-iret/fixture.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = resolve(root, '.github/workflows/i80386-bochs-ring3-reference.yml');
const controlsPath = resolve(root, 'scripts/i80386-bochs-ring3-reference/controls.py');
const readerPath = resolve(root, 'scripts/i80386-bochs-ring3-reference/reader.py');
const workflow = readFileSync(workflowPath, 'utf8');
const producerSource = readFileSync(resolve(root, 'scripts/i80386-bochs-ring3-reference/run.py'), 'utf8');
const checkout = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const setupNode = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const upload = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
const routes = [
  ['toolchain', 'bochs-ring3-toolchain-inventory-v1', 'Admit Bochs toolchain inventory source and request', 'Read selected Bochs toolchain files without execution', 'Retain Bochs toolchain inventory originals', 'x86-bochs-ring3-toolchain-inventory-v1', 'toolchain-v1', false],
  ['toolchain-v2', 'bochs-ring3-toolchain-inventory-v2', 'Admit Bochs toolchain inventory source and request', 'Read selected Bochs toolchain files without execution', 'Retain Bochs toolchain inventory originals', 'x86-bochs-ring3-toolchain-inventory-v2', 'toolchain-v2', false],
  ['build', 'bochs-ring3-build-v1', 'Admit Bochs build source and request', 'Build pinned Bochs CPU3 and retain originals', 'Retain Bochs build originals', 'x86-bochs-ring3-build-v1', 'build-v1', true],
  ['reference', 'bochs-ring3-reference-v1', 'Admit Bochs reference source and request', 'Capture fresh JavaScript and Bochs unchanged wire', 'Retain Bochs reference originals', 'x86-bochs-ring3-reference-v1', 'reference-v1', true],
];

function auditWorkflow(raw) {
  assert.match(raw, /^on:\s*\n\s+pull_request:/m);
  assert.match(raw, /cancel-in-progress:\s*false/);
  assert.doesNotMatch(raw.slice(0, raw.indexOf('jobs:')), /^  actions: read$/m);
  assert.equal((raw.match(/uses: actions\/checkout@/g) || []).length, 8);
  assert.equal((raw.match(/uses: actions\/setup-node@/g) || []).length, 4);
  assert.equal((raw.match(/uses: actions\/upload-artifact@/g) || []).length, 4);
  assert.equal((raw.match(/uses: actions\/(?:checkout|setup-node|upload-artifact)@/g) || []).length, 16);
  for (const [route, job, admission, work, retention, label, stem, active] of routes) {
    const start = raw.indexOf(`  ${job}:\n`);
    assert.ok(start >= 0, `${job} present`);
    const rest = raw.slice(start + job.length + 4);
    const next = rest.search(/^  [a-z][a-z0-9-]*:\s*$/m);
    const section = next < 0 ? rest : rest.slice(0, next);
    assert.match(section, new RegExp(`if: \\$\\{\\{ ${active ? 'true' : 'false'} &&`));
    assert.match(section, new RegExp(`timeout-minutes: ${route.startsWith('toolchain') ? 5 : route === 'build' ? 20 : 10}\\b`));
    assert.ok(section.includes(`github.event.label.name == '${label}'`));
    assert.match(section, /github\.actor == 'CrispStrobe'/);
    if (route === 'reference') {
      assert.match(section, /permissions:\s*\n\s+contents: read\s*\n\s+actions: read/);
      assert.match(section, /GH_TOKEN: \$\{\{ github\.token \}\}/);
      assert.match(section, /sudo --preserve-env=GH_TOKEN -- \/usr\/bin\/env/);
    } else {
      assert.doesNotMatch(section, /GH_TOKEN|actions: read/);
    }
    assert.match(section, /github\.event\.pull_request\.head\.repo\.fork == false/);
    assert.match(section, /github\.run_attempt == '1'/);
    assert.equal(section.split(checkout).length - 1, 2);
    assert.match(section, /path: workflow-source\s*\n\s+fetch-depth: 2/);
    assert.equal(section.split(setupNode).length - 1, 1);
    assert.equal(section.split(upload).length - 1, 1);
    const names = [...section.matchAll(/^\s+- name: (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(names, ['Checkout selected producer source', 'Checkout executing workflow source', admission,
      'Prepare pinned Node input cache', work, retention]);
    const uploadBlock = section.slice(section.lastIndexOf(`      - name: ${retention}`));
    assert.match(uploadBlock, new RegExp(`path: /run/bw-bochs-${stem}-\\$\\{\\{ github\\.run_id \\}\\}-1-originals`));
    assert.doesNotMatch(uploadBlock, /-1-(?:work|node)/);
    assert.ok(section.indexOf(admission) < section.indexOf(setupNode), 'request and source before setup-node');
    assert.ok(section.indexOf('workflow-source') < section.indexOf('--admit'), 'workflow checkout before admission');
    assert.ok(section.includes(`--admit --route ${route}`));
    assert.ok(section.includes(`--run-service --route ${route}`));
    assert.ok(section.includes(`--finish --route ${route}`));
    assert.ok(section.includes(`--capture-service-status --route ${route}`));
    assert.match(section, /--service-status/);
    assert.match(section, /--service-exit unknown --client-exit unknown/);
    assert.match(section, /run_status="\$\?"/);
    assert.match(section, /capture_status="\$\?"/);
    assert.match(section, /finish_status="\$\?"/);
    assert.match(section, /test "\$run_status" -eq 0/);
    assert.match(section, /test "\$capture_status" -eq 0/);
    assert.match(section, /test "\$finish_status" -eq 0/);
    assert.match(section, /if: always\(\)/);
    assert.match(section, /node-version:\s*22\.23\.3/);
    assert.match(section, /persist-credentials:\s*false/g);
    assert.match(section, /github\.workflow_sha/);
    assert.match(section, /BW_EXPECTED_HEAD/);
    assert.ok(section.indexOf("'cat-file', '-s'") >= 0 &&
      section.indexOf("'cat-file', '-s'") < section.indexOf("'cat-file', 'blob'"),
      'blob size admitted before a source blob is read');
  }
}

test('Bochs route workflow has four authenticated bounded six-step jobs with spent metadata disabled', () => {
  auditWorkflow(workflow);
});

test('source-held authored inputs equal the unchanged pure fixture builder', () => {
  const match = producerSource.match(/^AUTHORED_INPUT_ZLIB_B64 = '([A-Za-z0-9+/=]+)'$/m);
  assert.ok(match, 'one source-held bounded compressed input');
  const compressed = Buffer.from(match[1], 'base64');
  assert.equal(compressed.toString('base64'), match[1]);
  assert.ok(compressed.length <= 4096);
  const raw = inflateSync(compressed, {maxOutputLength: 1 << 20});
  const input = JSON.parse(raw);
  const fixture = buildFixture(); // Pure bytes only; no CPU/probe execution.
  const rom = Buffer.from(input.romBase64, 'base64');
  assert.equal(rom.length, 65536);
  assert.deepEqual(rom, Buffer.from(fixture.rom));
  assert.deepEqual(input.manifest, fixture.manifest);
  const stable = value => Array.isArray(value) ? value.map(stable) :
    value !== null && typeof value === 'object' ? Object.fromEntries(
      Object.keys(value).sort().map(key => [key, stable(value[key])])) : value;
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  assert.equal(digest(rom), 'd1aa0e35a81c68bc61621309589c8f4afa12ce2e7369af43879c718d109e2529');
  assert.equal(digest(Buffer.from(JSON.stringify(stable(fixture.manifest)) + '\n')),
    'd222aa19e62acc0a95f19306fe9b9a5fef70a04e2b1112293cf70ac883ce22df');
  const altered = Buffer.from(rom); altered[0] ^= 1;
  assert.notDeepEqual(altered, Buffer.from(fixture.rom));
});

test('workflow policy mutations are detected without enabling a job', () => {
  const cuts = [
    ['guard', workflow.replace('if: ${{ true &&', 'if: ${{ false &&')],
    ['spent metadata guard', workflow.replace('bochs-ring3-toolchain-inventory-v1:\n    if: ${{ false &&', 'bochs-ring3-toolchain-inventory-v1:\n    if: ${{ true &&')],
    ['new metadata guard', workflow.replace('bochs-ring3-toolchain-inventory-v2:\n    if: ${{ false &&', 'bochs-ring3-toolchain-inventory-v2:\n    if: ${{ true &&')],
    ['checkout pin', workflow.replace(checkout, 'actions/checkout@main')],
    ['unknown service status', workflow.replace('--service-exit unknown', '--service-exit 0')],
    ['finish', workflow.replace('--finish --route', '--no-finish --route')],
    ['run service', workflow.replace('--run-service --route', '--unsafe-run --route')],
    ['job budget', workflow.replace('timeout-minutes: 5', 'timeout-minutes: 1')],
    ['reference token', workflow.replace('sudo --preserve-env=GH_TOKEN', 'sudo --')],
    ['finish status', workflow.replace('test "$finish_status" -eq 0', 'true')],
    ['workflow checkout', workflow.replace('Checkout executing workflow source', 'Unchecked workflow source')],
    ['workflow parents', workflow.replace('fetch-depth: 2', 'fetch-depth: 1')],
    ['originals only', workflow.replace('-1-originals\n          if-no-files-found', '-1-work\n          if-no-files-found')],
    ['bounded source blob', workflow.replace("'cat-file', '-s'", "'cat-file', 'blob'")],
  ];
  for (const [name, changed] of cuts) assert.throws(() => auditWorkflow(changed), name);
});

test('new V2 reader routes refuse before retained file I/O while inactive', () => {
  for (const route of ['toolchain-v2', 'build-current-v2', 'reference-current-v2']) {
    const result = spawnSync('/usr/bin/python3', ['-I', '-B', readerPath,
      '--route', route, '--archive', '/definitely-absent-bochs-original.zip'], {
      cwd: root, encoding: 'utf8', timeout: 5000, maxBuffer: 1 << 16,
      env: {PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1'},
    });
    assert.equal(result.error, undefined, `${route}: ${result.error}`);
    assert.equal(result.status, 1, `${route}: ${result.stdout}`);
    const refusal = JSON.parse(result.stderr.trim());
    assert.equal(refusal.actualRunApproved, false);
    assert.equal(refusal.guestApproved, false);
    assert.equal(refusal.reason.message, 'reader route inactive');
  }
});

test('genuine Bochs pure controls run with bounded system Python and no guest', () => {
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', controlsPath], {
    cwd: root, encoding: 'utf8', timeout: 60_000, maxBuffer: 2 << 20,
    env: {PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1'},
  });
  assert.equal(result.error, undefined, String(result.error));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout + result.stderr, /OK|PASS/);
});
