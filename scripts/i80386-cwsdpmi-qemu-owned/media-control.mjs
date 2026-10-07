import assert from 'node:assert/strict';
import {buildMedia, sha256, SUCCESS, EXIT_OK, RETURN} from './media.mjs';
import {readRootFile} from '../i80386-dos32a-owned/media.mjs';

const host = Buffer.from('synthetic CWSDPMI package member');
const client = Buffer.alloc(2048);
client.writeUInt16LE(0x5a4d, 0);
client.writeUInt16LE(0x014c, 512);
const report = {
  schema: 'bw.cwsdpmi-owned.compile-only.v1',
  status: 'COMPILED_NO_GUEST_NO_BINARY_PUBLICATION',
  ownedSource: {path: 'scripts/i80386-cwsdpmi-owned/client.c',
    sha256: 'c8c654326633b244c64baac144fe9300ce5a1800c330e52615470c62d8c3bb1d'},
  executable: {bytes: client.length, sha256: sha256(client), uploaded: false,
    format: {valid: true, coff: {valid: true}, coffOffset: 512}},
};
const hostPin = {bytes: host.length, sha256: sha256(host)};
const built = buildMedia({host, client, compileReport: report, hostPin});
assert.equal(built.manifest.files['CWSDPMI EXE'].sha256, sha256(host));
assert.deepEqual(readRootFile(built.image, 'CWSDPMI EXE'), host);
assert.deepEqual(readRootFile(built.image, 'CLIENT  EXE'), client);
const batch = readRootFile(built.image, 'RUNDP   BAT').toString('ascii');
assert.ok(batch.startsWith('@ECHO OFF\r\nC:\r\nCD \\\r\n'));
assert.match(batch, /C:\\CLIENT\.EXE > C:\\DPOUT\.TXT/);
assert.match(batch, /IF ERRORLEVEL 1 GOTO FAILED/);
assert.ok(batch.includes(EXIT_OK));
assert.equal(readRootFile(built.image, 'VERIFY  BAT').toString('ascii').includes(RETURN), true);
assert.equal(readRootFile(built.image, 'DPOUT   TXT'), null);
assert.ok(!batch.includes(SUCCESS));
assert.throws(() => buildMedia({host, client, compileReport: report,
  hostPin: {bytes: host.length, sha256: '0'.repeat(64)}}));
assert.throws(() => buildMedia({host, client: Buffer.concat([client, Buffer.from([1])]),
  compileReport: report, hostPin}));
assert.throws(() => buildMedia({host, client, compileReport: {...report,
  executable: {...report.executable, format: {valid: false}}}, hostPin}));
console.log('CWSDPMI media controls PASS');
