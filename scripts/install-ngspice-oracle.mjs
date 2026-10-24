#!/usr/bin/env node
// Separate source-admitted oracle; never replaces the system ngspice.
import {createHash} from 'node:crypto';
import {existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';

export const ORACLE = JSON.parse(readFileSync(new URL('../.github/ci-ngspice47.json', import.meta.url), 'utf8'));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyOracleArchive(bytes) {
  if (sha256(bytes) !== ORACLE.archiveSha256) throw new Error('ngspice oracle archive SHA256 mismatch');
}
export function verifyOracleVersion(banner) {
  const versions = [...banner.matchAll(/\bngspice-(\d+)\s*:/g)].map(m => Number(m[1]));
  if (versions.length !== 1 || versions[0] !== ORACLE.version) throw new Error(`Expected exactly one ngspice-${ORACLE.version} version banner`);
}
const run = (program, args) => {
  const result = spawnSync(program, args, {encoding: 'utf8', timeout: 60_000});
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout || '';
};
export function admitOracle(binary) {
  const executable = resolve(binary);
  const identity = JSON.parse(readFileSync(join(dirname(dirname(executable)), 'oracle-identity.json'), 'utf8'));
  if (identity.version !== ORACLE.version || identity.archiveSha256 !== ORACLE.archiveSha256 ||
      JSON.stringify(identity.configure) !== JSON.stringify(ORACLE.configure) ||
      identity.platform !== process.platform || identity.arch !== process.arch ||
      identity.binarySha256 !== sha256(readFileSync(executable))) {
    throw new Error('ngspice oracle identity does not match source, configuration or binary');
  }
  verifyOracleVersion(run(executable, ['--version']));
  return identity;
}
export async function installOracle(prefix, {archive} = {}) {
  prefix = resolve(prefix);
  const binary = join(prefix, 'bin', 'ngspice');
  if (existsSync(prefix)) { admitOracle(binary); return binary; }
  const work = mkdtempSync(join(tmpdir(), 'bw-ngspice47-'));
  const archiveFile = join(work, 'ngspice-47.tar.gz');
  const bytes = archive ? readFileSync(resolve(archive)) : Buffer.from(await (async () => {
    const response = await fetch(ORACLE.archiveUrl, {signal: AbortSignal.timeout(60_000)});
    if (!response.ok) throw new Error(`ngspice source download HTTP ${response.status}`);
    return response.arrayBuffer();
  })());
  verifyOracleArchive(bytes);
  writeFileSync(archiveFile, bytes);
  run('tar', ['-xzf', archiveFile, '-C', work]);
  const source = join(work, ORACLE.sourceDirectory), logFile = join(work, 'build.log');
  console.log(`Building admitted ngspice-${ORACLE.version}; work/log: ${work}`);
  for (const [program, args] of [
    ['./configure', [`--prefix=${prefix}`, ...ORACLE.configure]],
    ['make', ['-j2']], ['make', ['install']],
  ]) {
    const result = spawnSync(program, args, {cwd: source, encoding: 'utf8', timeout: 600_000, maxBuffer: 32*1024*1024});
    writeFileSync(logFile, `${program}\n${result.stdout || ''}\n${result.stderr || ''}\n`, {flag: 'a'});
    if (result.error || result.status !== 0) throw new Error(`${program} failed; see ${logFile}: ${result.error || result.status}`);
  }
  const banner = run(binary, ['--version']); verifyOracleVersion(banner);
  writeFileSync(join(prefix, 'oracle-identity.json'), JSON.stringify({version: ORACLE.version,
    archiveUrl: ORACLE.archiveUrl, archiveSha256: ORACLE.archiveSha256, configure: ORACLE.configure,
    platform: process.platform, arch: process.arch, binarySha256: sha256(readFileSync(binary)),
    versionBanner: banner}, null, 2) + '\n');
  admitOracle(binary); return binary;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {values} = parseArgs({options: {prefix: {type: 'string'}, archive: {type: 'string'}}, strict: true, allowPositionals: false});
  if (!values.prefix) throw new Error('Usage: install-ngspice-oracle.mjs --prefix DIRECTORY [--archive VERIFIED-ARCHIVE]');
  console.log(await installOracle(values.prefix, {archive: values.archive}));
}
