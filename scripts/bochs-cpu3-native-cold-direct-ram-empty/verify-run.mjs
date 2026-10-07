/** Pre-addon admission of exact harness, qualified source, generated fixture and binary. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {sourceIdentity} from './actual-materialize.mjs';

const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const [harnessRoot,qualifiedRoot,evidenceDir,expectedHead,addonPath,buildAuthPath,configAuthPath]=process.argv.slice(2);
assert.equal(process.argv.length,9,'source roots, evidence, head, addon, build and config receipts');
for(const path of [harnessRoot,qualifiedRoot,evidenceDir,addonPath,buildAuthPath,configAuthPath]){
 assert.ok(isAbsolute(path)&&resolve(path)===path,'absolute admission path');
}
function ordinary(path){
 const stat=lstatSync(path);assert.ok(stat.isFile()&&!stat.isSymbolicLink(),'ordinary file: '+path);
 assert.equal(realpathSync(path),path,'canonical file: '+path);
 return readFileSync(path);
}
const {manifest,generated}=sourceIdentity(harnessRoot,qualifiedRoot,expectedHead);
assert.deepEqual(JSON.parse(ordinary(join(evidenceDir,'empty-source-manifest.json'))),manifest,'recomputed source closure');
assert.equal(sha256(ordinary(join(evidenceDir,'actual-empty.mjs'))),manifest.generatedFixtureSha256);
assert.equal(sha256(generated),manifest.generatedFixtureSha256,'fresh fixture derivation');
const build=JSON.parse(ordinary(buildAuthPath));
assert.equal(build.schema,'bw.cold-native.direct-ram-static-build.v1');
assert.equal(build.sourceHead,manifest.qualifiedHead);
assert.equal(sha256(ordinary(addonPath)),build.addonSha256,'fresh qualified addon bytes');
const config=JSON.parse(ordinary(configAuthPath));
assert.ok(config.direct&&typeof config.direct.path==='string');
const configBytes=ordinary(config.direct.path);
assert.equal(sha256(configBytes),config.direct.sha256);
const {authenticateConfiguration}=await import(pathToFileURL(join(qualifiedRoot,
 'scripts/bochs-cpu3-native-cold-memory-fusion/identity.mjs')).href);
const authenticated=authenticateConfiguration(config.direct.path);
assert.equal(authenticated.sha256,config.direct.sha256);
assert.equal(authenticated.biosSha256,manifest.qualifiedHashes['roms/free-at-bios/BIOS-bochs-legacy']);
const reference=JSON.parse(ordinary(join(evidenceDir,'empty-held-reference.json')));
assert.equal(reference.schema,'bw.cold-direct-ram.empty-held-reference.v1');
assert.equal(reference.qualifiedHead,manifest.qualifiedHead);
assert.equal(reference.zipSha256,'3881456e5dd46f256640cd28af30117f0be1a92f1b2fe9df1712067c3ea31905');
for(const name of ['direct.json','owned.json','callback.json']){
 const bytes=ordinary(join(evidenceDir,'held-'+name)),entry=reference.reports[name];
 assert.equal(bytes.length,entry.bytes);assert.equal(sha256(bytes),entry.sha256);
}
const receipt={schema:'bw.cold-direct-ram.empty-run-admission.v1',harnessHead:expectedHead,
 qualifiedHead:manifest.qualifiedHead,sourceManifestSha256:sha256(ordinary(join(evidenceDir,'empty-source-manifest.json'))),
 generatedFixtureSha256:manifest.generatedFixtureSha256,addonSha256:build.addonSha256,
 buildAuthSha256:sha256(ordinary(buildAuthPath)),configurationSha256:config.direct.sha256,
 referenceZipSha256:reference.zipSha256,status:'ADMITTED_BEFORE_ADDON_LOAD'};
writeFileSync(join(evidenceDir,'empty-run-admission.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o644});
process.stdout.write(JSON.stringify(receipt)+'\n');
