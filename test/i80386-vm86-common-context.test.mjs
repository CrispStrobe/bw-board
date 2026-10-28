import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync, spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {buildGuest} from '../scripts/i80386-vm86-common-context/build.mjs';
import {expectedStream, layout, firstDifference, allDifferences} from '../scripts/i80386-vm86-common-context/expected.mjs';
import {runJs, repo, CORE} from '../scripts/i80386-vm86-common-context/engines.mjs';

const guest = buildGuest();
const expected = expectedStream(guest);
const sha = data => createHash('sha256').update(data).digest('hex');
const fieldAt = offset => layout().fields.find(([s, l]) => offset >= s && offset < s + l)?.[2];

function mutantCore(from, to) {
  const source = readFileSync(resolve(repo, CORE), 'utf8');
  assert.equal(source.split(from).length, 2, `mutation anchor must be unique: ${from}`);
  const dir = mkdtempSync(join(tmpdir(), 'bw-vm86cc-mutant-'));
  const path = join(dir, 'i80386.mjs');
  writeFileSync(path, source.replace(from, to));
  return {path, dir};
}

test('frozen guest is a boot sector plus stage 2 and the expectation matches the layout', () => {
  assert.equal(guest.image.length, 1536);
  assert.equal(expected.length, layout().length);
  assert.deepEqual([...expected.subarray(0, 4)], [...Buffer.from('VMCC')]);
});

test('ordinary strict386 JS reproduces the independent expectation byte for byte', async () => {
  const js = await runJs(guest.image);
  assert.equal(js.fault, null);
  assert.equal(firstDifference(expected, js.stream), null);
});

test('mutation: suppressing descriptor accessed-bit writes is detected at GDT access bytes', async () => {
  const {path, dir} = mutantCore('  _markAccessed(descriptor) {\n', '  _markAccessed(descriptor) {\n    return;\n');
  try {
    const js = await runJs(guest.image, {corePath: path});
    const diffs = allDifferences(expected, js.stream);
    assert.ok(diffs.length > 0, 'mutant must not pass');
    assert.match(fieldAt(diffs[0]), /^P0\.gdt\[0x8\]$/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('mutation: dropping NT on a nested task gate is detected in the task2 EFLAGS', async () => {
  const {path, dir} = mutantCore('kind === "call" ? flags | NT :', 'kind === "call" ? flags :');
  try {
    const js = await runJs(guest.image, {corePath: path});
    const fields = new Set(allDifferences(expected, js.stream).map(fieldAt));
    assert.ok(fields.has('T41.stack'), [...fields].join(','));
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('a CS.A-omitting reference (QEMU 8.2 TCG gate/task CS path) differs only at those access bytes', () => {
  const omitted = expectedStream(guest, {omitAccessedOn: [0x28, 0x30, 0x38]});
  const fields = allDifferences(expected, omitted).map(fieldAt);
  assert.deepEqual(fields, ['H40.gdt[0x28]', 'T41.gdt[0x28]', 'T41.gdt[0x30]', 'T41.gdt[0x38]']);
});

function readerOn(streams) {
  const dir = mkdtempSync(join(tmpdir(), 'bw-vm86cc-reader-'));
  try {
    const files = {};
    for (const [name, data] of Object.entries(streams)) { writeFileSync(join(dir, name), data); files[name] = sha(data); }
    writeFileSync(join(dir, 'summary.json'), JSON.stringify({files, guest: {imageSha256: sha(guest.image)}}));
    const r = spawnSync('python3', ['-I', resolve(repo, 'scripts/i80386-vm86-common-context/reader.py'), dir], {encoding: 'utf8'});
    return {status: r.status, verdict: JSON.parse(r.stdout)};
  } finally { rmSync(dir, {recursive: true, force: true}); }
}

test('independent reader accepts the expectation and rejects nonvacuous adversaries', () => {
  const base = {'guest.bin': guest.image, 'expected.bin': expected, 'js.bin': expected, 'bochs.bin': expected};
  assert.equal(readerOn(base).status, 0);
  const vm = Buffer.from(expected); vm[layout().fields.find(f => f[2] === 'T41.tss1')[0] + 0x26] &= ~2;
  const r1 = readerOn({...base, 'bochs.bin': vm});
  assert.equal(r1.status, 1); assert.equal(r1.verdict.firstFailedFact.fact, 'T41 TSS1 saved VM86 EFLAGS');
  const omitted = expectedStream(guest, {omitAccessedOn: [0x28]});
  const r2 = readerOn({...base, 'js.bin': omitted});
  assert.equal(r2.status, 1); assert.equal(r2.verdict.firstFailedFact.fact, 'H40 INT-gate CS.A written in GDT RAM');
  assert.equal(readerOn({...base, 'bochs.bin': expected.subarray(0, expected.length - 1)}).status, 1);
  const dir = mkdtempSync(join(tmpdir(), 'bw-vm86cc-hash-'));
  try {
    for (const [n, d] of Object.entries(base)) writeFileSync(join(dir, n), d);
    writeFileSync(join(dir, 'summary.json'), JSON.stringify({files: {...Object.fromEntries(Object.entries(base).map(([n, d]) => [n, sha(d)])), 'js.bin': '0'.repeat(64)}, guest: {imageSha256: sha(guest.image)}}));
    const r = spawnSync('python3', ['-I', resolve(repo, 'scripts/i80386-vm86-common-context/reader.py'), dir], {encoding: 'utf8'});
    assert.equal(r.status, 1); assert.match(JSON.parse(r.stdout).failure, /hash mismatch js\.bin/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('toolchain is the runner GNU binutils (recorded, not vendored)', () => {
  assert.match(execFileSync('as', ['--version'], {encoding: 'utf8'}), /GNU assembler/);
});
