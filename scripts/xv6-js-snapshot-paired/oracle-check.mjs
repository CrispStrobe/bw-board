#!/usr/bin/env node
/** Bind the independent QEMU execution to the exact owned JS ROM capture. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';

const [jsPath,qemuPath,outputPath,expectedHead]=process.argv.slice(2);
assert(jsPath&&qemuPath&&outputPath&&/^[0-9a-f]{40}$/.test(expectedHead),
  'usage: oracle-check.mjs js.json.gz qemu.json output.json exact-head');
const js=JSON.parse(gunzipSync(readFileSync(jsPath)));
const qemu=JSON.parse(readFileSync(qemuPath,'utf8'));
assert.equal(js.schema,'bw.i80386-code32-rep-pf-js.v1');
assert.equal(js.source.revision,expectedHead);
assert.equal(qemu.schema,'bw.i80386-code32-rep-pf-qemu.v1');
assert.equal(qemu.result,'PASS');
assert.equal(js.romSha256,qemu.fixture.romSha256);
assert.deepEqual(js.symbols,qemu.fixture.symbols);
assert.equal(js.deliveries.length,1);
assert.equal(js.deliveries[0].vector,14);
assert.equal(js.deliveries[0].errorCode,2);
assert.equal(qemu.execution.faultCount,1);
assert.equal(qemu.execution.stdout,'P32OK');
writeFileSync(outputPath,JSON.stringify({
  schema:'bw.xv6-js-snapshot-affected-oracle.v1',
  result:'PASS',testedHead:expectedHead,
  romSha256:js.romSha256,
  jsFault:{vector:js.deliveries[0].vector,errorCode:js.deliveries[0].errorCode},
  qemuBinarySha256:qemu.emulator.sha256,
  qemuVersion:qemu.emulator.version,
  qemuFaultCount:qemu.execution.faultCount,
  qemuGuestOutput:qemu.execution.stdout,
},null,2)+'\n',{flag:'wx'});
