/** Bounded exact-source materializer control; no native addon or guest. */
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {deriveEmptyBatchProvider} from './provider-derivation.mjs';
import {sourceIdentity,materialize} from './actual-materialize.mjs';

const [harnessRoot,qualifiedRoot,expectedHead]=process.argv.slice(2);
assert.equal(process.argv.length,5,'harness, qualified, expected head');
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const output=mkdtempSync(join(tmpdir(),'bw-direct-empty-control-'));
try{
 const {manifest,generated}=sourceIdentity(harnessRoot,qualifiedRoot,expectedHead);
 assert.ok(Object.keys(manifest.qualifiedHashes).length>=20,'recursive qualified JS/source closure');
 for(const required of ['scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs',
  'scripts/bochs-cpu3-native-cold-bios/board-provider.mjs',
  'scripts/bochs-cpu3-native-cold-bios/board-profile.mjs',
  'src/experimental/i80386-at-machine.js','roms/free-at-bios/BIOS-bochs-legacy'])
  assert.ok(manifest.qualifiedHashes[required],'required source role: '+required);
 assert.equal(sha256(generated),manifest.generatedFixtureSha256);
 assert.equal(materialize(harnessRoot,qualifiedRoot,output,expectedHead).generatedFixtureSha256,
  manifest.generatedFixtureSha256);
 assert.equal(readFileSync(join(output,'actual-empty.mjs'),'utf8'),generated);
 assert.deepEqual(JSON.parse(readFileSync(join(output,'empty-source-manifest.json'))),manifest);
 const copied=join(output,'copied-provider.mjs'),parent=join(qualifiedRoot,
  'scripts/bochs-cpu3-native-cold-direct-ram/provider.mjs');
 writeFileSync(copied,readFileSync(parent));
 assert.equal(deriveEmptyBatchProvider(pathToFileURL(copied)).normalizedSha256,
  manifest.provider.normalizedSha256,'same bytes in second root normalize identically');
 writeFileSync(copied,'tampered source');
 assert.throws(()=>deriveEmptyBatchProvider(pathToFileURL(copied)),/exact qualified provider parent/);
 const link=join(output,'provider-link.mjs');symlinkSync(parent,link);
 assert.throws(()=>deriveEmptyBatchProvider(pathToFileURL(link)),/ordinary held provider file/);
 process.stdout.write(JSON.stringify({schema:'bw.cold-direct-ram.empty-actual-control.v1',
  status:'PASS_SOURCE_ONLY',harnessRoles:Object.keys(manifest.harnessHashes).length,
  qualifiedRoles:Object.keys(manifest.qualifiedHashes).length,
  generatedFixtureSha256:manifest.generatedFixtureSha256})+'\n');
}finally{rmSync(output,{recursive:true,force:true});}
