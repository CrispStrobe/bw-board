import fs from 'node:fs';
import assert from 'node:assert/strict';
import {buildMedia, CLIENT_PATH, CLIENT_SHA, HOST, sha256} from './media.mjs';

const source = fs.readFileSync(CLIENT_PATH);
assert.equal(sha256(source), CLIENT_SHA);
const client = Buffer.alloc(4096);
client.writeUInt16LE(0x5a4d, 0);
client.writeUInt16LE(0x014c, 2048);
const format = {valid: true, coffOffset: 2048, coff: {valid: true}};
const executable = {bytes: client.length, sha256: sha256(client), uploaded: false, format};
const rawCompile = {ownedSource: {path: CLIENT_PATH, sha256: CLIENT_SHA}, executable};
const compile = {schema: 'bw.cwsdpmi-highmem-timer.compile-adapter.v1',
  status: 'COMPILED_INTERNAL_ONLY', ownedSource: rawCompile.ownedSource, executable};
const host = Buffer.alloc(HOST.bytes);
// A synthetic host cannot pass the production pin; the explicit test-only pin
// permits the parser/media path to be exercised without acquiring host bytes.
assert.throws(() => buildMedia({host, client, source, compile, rawCompile}), /pinned CWSDPMI/);
const hostPin = {bytes: HOST.bytes, sha256: sha256(host)};
assert.notEqual(hostPin.sha256, HOST.sha256);
const built = buildMedia({host, client, source, compile, rawCompile, hostPin});
assert.equal(built.manifest.schema, 'bw.cwsdpmi-highmem-timer.qemu-media.v1');
assert.equal(built.manifest.files['CLIENT  EXE'].sha256, sha256(client));
assert.notEqual(built.manifest.files['RUNHT   BAT'].sha256,
  built.manifest.files['VERIFYHTBAT'].sha256);
const wrong = structuredClone(compile);
wrong.ownedSource.path = 'scripts/i80386-cwsdpmi-owned/client.c';
assert.throws(() => buildMedia({host, client, source, compile: wrong, rawCompile, hostPin}), /compile profile/);
const badSource = Buffer.from(source);
badSource[0] ^= 1;
assert.throws(() => buildMedia({host, client, source: badSource, compile, rawCompile, hostPin}), /source hash/);
const wrongClient = Buffer.from(client);
wrongClient[2050] ^= 1;
assert.throws(() => buildMedia({host, client: wrongClient, source, compile, rawCompile, hostPin}), /compile profile/);
console.log('high-memory/timer media controls PASS');
