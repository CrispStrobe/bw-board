import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {ORACLE, sha256, verifyOracleArchive, verifyOracleVersion, admitOracle, installOracle} from '../scripts/install-ngspice-oracle.mjs';

function fixture() {
  const prefix = mkdtempSync(join(tmpdir(), 'bw-oracle-control-'));
  mkdirSync(join(prefix, 'bin'));
  const binary = join(prefix, 'bin', 'ngspice');
  const bytes = Buffer.from("#!/usr/bin/env node\nprocess.stdout.write('** ngspice-47 : explicit test double\\n');\n");
  writeFileSync(binary, bytes, {mode: 0o755});
  const identity = {version: ORACLE.version, archiveSha256: ORACLE.archiveSha256,
    configure: ORACLE.configure, platform: process.platform, arch: process.arch,
    binarySha256: sha256(bytes)};
  const save = value => writeFileSync(join(prefix, 'oracle-identity.json'), JSON.stringify(value));
  save(identity); return {prefix, binary, identity, save, clean: () => rmSync(prefix, {recursive:true, force:true})};
}

test('literal oracle identity pins release archive and preserves the system oracle', () => {
  assert.equal(ORACLE.version, 47);
  assert.match(ORACLE.archiveUrl, /^https:\/\/sourceforge\.net\/projects\/ngspice\/files\/ng-spice-rework\/47\//);
  assert.match(ORACLE.archiveSha256, /^[0-9a-f]{64}$/);
  assert.ok(ORACLE.configure.includes('--with-x=no'));
  assert.throws(() => verifyOracleArchive(Buffer.from('altered release bytes')), /SHA256 mismatch/);
});

test('version admission refuses old, absent, duplicate and malformed banners', () => {
  verifyOracleVersion('** ngspice-47 : Circuit level simulation program');
  for (const text of ['', 'ngspice-42 : old', 'ngspice-470 : wrong', 'ngspice-47 : one\nngspice-42 : two']) {
    assert.throws(() => verifyOracleVersion(text), /exactly one/);
  }
});

for (const field of ['version','archiveSha256','configure','platform','arch','binarySha256']) test(`admission rejects changed ${field}`, () => {
  const f = fixture();try {
    assert.equal(admitOracle(f.binary).version, 47);
    f.save({...f.identity, [field]: field === 'configure' ? [] : 'changed'});
    assert.throws(() => admitOracle(f.binary), /identity/);
  } finally {f.clean();}
});

test('admission rejects missing identity, changed executable, wrong runtime and failed process', () => {
  const f = fixture();try {
    rmSync(join(f.prefix,'oracle-identity.json'));assert.throws(() => admitOracle(f.binary));f.save(f.identity);
    writeFileSync(f.binary,readFileSync(f.binary)+'// changed');assert.throws(() => admitOracle(f.binary), /identity/);
    for(const code of ["process.stdout.write('ngspice-42 : old');", 'process.exit(1);']) {
      const bytes=Buffer.from('#!/usr/bin/env node\n'+code);writeFileSync(f.binary,bytes);
      f.save({...f.identity,binarySha256:sha256(bytes)});
      assert.throws(() => admitOracle(f.binary), /exactly one|failed/);
    }
  } finally {f.clean();}
});

test('an existing prefix must be admitted, never silently rebuilt or overwritten', async () => {
  const f=fixture();try {
    assert.equal(await installOracle(f.prefix),f.binary);
    f.save({...f.identity,archiveSha256:'wrong'});
    await assert.rejects(installOracle(f.prefix),/identity/);
    assert.equal(JSON.parse(readFileSync(join(f.prefix,'oracle-identity.json'),'utf8')).archiveSha256,'wrong');
  } finally {f.clean();}
});

test('unknown installer flags refuse without reusing or changing an existing binary', () => {
  const f=fixture();try {
    const before=readFileSync(f.binary);
    const result=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/install-ngspice-oracle.mjs',import.meta.url)),'--prefix',f.prefix,'--unknown'],{encoding:'utf8'});
    assert.notEqual(result.status,0);assert.match(result.stderr,/Unknown option/);
    assert.deepEqual(readFileSync(f.binary),before);
  } finally {f.clean();}
});
