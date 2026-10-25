import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const controls = resolve(root, 'scripts/i80386-read16-failure/controls.py');
const deadlineMs = 60_000;
const outputCap = 4 * 1024 * 1024;

function sourceMethods() {
  const size = statSync(controls).size;
  assert.ok(size > 0 && size <= 256 * 1024, 'bounded controls source');
  const source = readFileSync(controls, 'utf8');
  const names = [...source.matchAll(/^    def (test_[A-Za-z0-9_]+)\(/gm)].map((match) => match[1]);
  assert.equal(names.length, 10, 'all ten source control methods remain present');
  assert.equal(new Set(names).size, names.length, 'unique source control methods');
  return names.length;
}

function runControls() {
  return new Promise((resolveRun) => {
    const child = spawn('/usr/bin/python3', ['-B', controls], {
      cwd: root,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    });
    let first = null;
    let bytes = 0;
    const stdout = [];
    const stderr = [];
    const fail = (reason) => {
      if (first === null) first = reason;
      child.kill('SIGKILL');
    };
    const capture = (chunks) => (chunk) => {
      bytes += chunk.length;
      if (bytes > outputCap) return fail('aggregate output cap');
      chunks.push(chunk);
    };
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.once('error', () => fail('Python child start error'));
    const timer = setTimeout(() => fail('Python child deadline'), deadlineMs);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveRun({ first, code, signal, stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'), bytes });
    });
  });
}

test('read16 failure-only Python controls run in hosted test discovery', { timeout: 65_000 }, async () => {
  const sourceCount = sourceMethods();
  const result = await runControls();
  assert.equal(result.first, null, 'bounded child completed');
  assert.equal(result.signal, null, 'no child signal');
  assert.equal(result.code, 0, 'Python controls exit success');
  assert.ok(result.bytes > 0 && result.bytes <= outputCap, 'bounded nonempty control output');
  assert.equal(result.stdout, '', 'controls produce no stdout');
  const summary = result.stderr.match(/^Ran ([1-9][0-9]*) tests? in [0-9.]+s$/m);
  assert.ok(summary, 'well-formed unittest summary');
  assert.equal(Number(summary[1]), sourceCount, 'every source control executed');
  assert.match(result.stderr, /(?:^|\n)OK\n?$/, 'all controls passed without skips');
  assert.doesNotMatch(result.stderr, /\b(?:FAILED|ERROR|skipped)\b/, 'no hidden failure or skip');
});
