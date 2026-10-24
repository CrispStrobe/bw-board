import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = resolve(root, '.github/workflows/i80386-bochs-ring3-reference.yml');
const controlsPath = resolve(root, 'scripts/i80386-bochs-ring3-reference/controls.py');
const workflow = readFileSync(workflowPath, 'utf8');
const checkout = 'actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const setupNode = 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020';
const upload = 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02';
const routes = [
  ['toolchain', 'bochs-ring3-toolchain-inventory-v1', 'Admit Bochs toolchain inventory source and request', 'Read selected Bochs toolchain files without execution', 'Retain Bochs toolchain inventory originals'],
  ['build', 'bochs-ring3-build-v1', 'Admit Bochs build source and request', 'Build pinned Bochs CPU3 and retain originals', 'Retain Bochs build originals'],
  ['reference', 'bochs-ring3-reference-v1', 'Admit Bochs reference source and request', 'Capture fresh JavaScript and Bochs unchanged wire', 'Retain Bochs reference originals'],
];

function auditWorkflow(raw) {
  assert.match(raw, /^on:\s*\n\s+pull_request:/m);
  assert.match(raw, /cancel-in-progress:\s*false/);
  assert.equal((raw.match(/uses: actions\/checkout@/g) || []).length, 6);
  assert.equal((raw.match(/uses: actions\/setup-node@/g) || []).length, 3);
  assert.equal((raw.match(/uses: actions\/upload-artifact@/g) || []).length, 3);
  assert.equal((raw.match(/uses: actions\/(?:checkout|setup-node|upload-artifact)@/g) || []).length, 12);
  for (const [route, job, admission, work, retention] of routes) {
    const start = raw.indexOf(`  ${job}:\n`);
    assert.ok(start >= 0, `${job} present`);
    const rest = raw.slice(start + job.length + 4);
    const next = rest.search(/^  [a-z][a-z0-9-]*:\s*$/m);
    const section = next < 0 ? rest : rest.slice(0, next);
    assert.match(section, /if: \$\{\{ false &&/);
    assert.match(section, new RegExp(`timeout-minutes: ${route === 'toolchain' ? 5 : route === 'build' ? 20 : 10}\\b`));
    assert.match(section, new RegExp(`github\\.event\\.label\\.name == 'x86-bochs-ring3-${route === 'toolchain' ? 'toolchain-inventory' : route}-v1'`));
    assert.match(section, /github\.actor == 'CrispStrobe'/);
    assert.match(section, /github\.event\.pull_request\.head\.repo\.fork == false/);
    assert.match(section, /github\.run_attempt == '1'/);
    assert.equal(section.split(checkout).length - 1, 2);
    assert.equal(section.split(setupNode).length - 1, 1);
    assert.equal(section.split(upload).length - 1, 1);
    const names = [...section.matchAll(/^\s+- name: (.+)$/gm)].map(match => match[1]);
    assert.deepEqual(names, ['Checkout selected producer source', 'Checkout executing workflow source', admission,
      'Prepare pinned Node input cache', work, retention]);
    assert.ok(section.indexOf(admission) < section.indexOf(setupNode), 'request and source before setup-node');
    assert.ok(section.indexOf('workflow-source') < section.indexOf('--admit'), 'workflow checkout before admission');
    assert.match(section, /--admit --route/);
    assert.match(section, /--run-service --route/);
    assert.match(section, /--finish --route/);
    assert.match(section, /--capture-service-status --route/);
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

test('Bochs route workflow has three inactive authenticated bounded six-step jobs', () => {
  auditWorkflow(workflow);
});

test('workflow policy mutations are detected without enabling a job', () => {
  const cuts = [
    ['guard', workflow.replace('if: ${{ false &&', 'if: ${{ true &&')],
    ['checkout pin', workflow.replace(checkout, 'actions/checkout@main')],
    ['unknown service status', workflow.replace('--service-exit unknown', '--service-exit 0')],
    ['finish', workflow.replace('--finish --route', '--no-finish --route')],
    ['run service', workflow.replace('--run-service --route', '--unsafe-run --route')],
    ['job budget', workflow.replace('timeout-minutes: 5', 'timeout-minutes: 1')],
    ['finish status', workflow.replace('test "$finish_status" -eq 0', 'true')],
    ['workflow checkout', workflow.replace('Checkout executing workflow source', 'Unchecked workflow source')],
    ['bounded source blob', workflow.replace("'cat-file', '-s'", "'cat-file', 'blob'")],
  ];
  for (const [name, changed] of cuts) assert.throws(() => auditWorkflow(changed), name);
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
