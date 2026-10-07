/** Exact changed-provider guest projection against the immutable qualified direct arm. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const [actualPath,heldPath,manifestPath,buildAuthPath,configAuthPath,generatedFixturePath]=process.argv.slice(2);
assert.equal(process.argv.length,8,'changed/held reports, source/build/config receipts, generated fixture');
const read=path=>JSON.parse(readFileSync(path));
const actual=read(actualPath),held=read(heldPath),source=read(manifestPath),build=read(buildAuthPath),config=read(configAuthPath);
assert.equal(source.schema,'bw.cold-direct-ram.empty-actual-source.v1');
assert.equal(source.qualifiedHead,'acdb5dcef438c0ac7bc3c7794d43af4371d6e0d1');
assert.equal(sha256(readFileSync(generatedFixturePath)),source.generatedFixtureSha256,'exact generated fixture bytes');
assert.equal(build.schema,'bw.cold-native.direct-ram-static-build.v1');
assert.equal(build.sourceHead,source.qualifiedHead);
assert.equal(actual.admission.sourceHead,source.qualifiedHead);
assert.equal(actual.admission.addonSha256,build.addonSha256);
assert.equal(actual.admission.buildAuthSha256,sha256(readFileSync(buildAuthPath)));
assert.equal(actual.admission.configSha256,config.direct.sha256);
assert.equal(actual.admission.biosSha256,source.qualifiedHashes['roms/free-at-bios/BIOS-bochs-legacy']);
assert.equal(actual.schema,held.schema);
assert.equal(actual.mode,held.mode);
const fields=['target','resumes','zero','reset','lastReturn','last','final','board','initialRamSha256',
 'initialRamBase64','ramSha256','ports','journal','generationEntries','direct'];
assert.deepEqual(Object.keys(actual).sort(),Object.keys(held).sort(),'complete held report field set');
for(const field of fields)assert.deepEqual(actual[field],held[field],'changed provider versus held: '+field);
assert.equal(actual.target,316562);assert.equal(actual.resumes,16524);
assert.equal(actual.ports.length,16475);assert.equal(actual.journal.length,91958);
assert.equal(actual.direct.afterClose.ownerClosed,true);assert.equal(actual.direct.afterClose.cpuClosed,true);
assert.equal(actual.direct.closure.providerClosed,true);assert.equal(actual.direct.closure.boardClosed,true);
process.stdout.write(JSON.stringify({schema:'bw.cold-direct-ram.empty-held-guest-parity.v1',
 harnessHead:source.harnessHead,qualifiedHead:source.qualifiedHead,target:actual.target,
 ports:actual.ports.length,journalEntries:actual.journal.length,
 journalSha256:sha256(JSON.stringify(actual.journal)),ramSha256:actual.ramSha256,
 parity:'PASS',adoptionGate:'NOT_RUN'})+'\n');
