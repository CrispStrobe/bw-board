/** Read/hash only; runtime3792 proof is distinct from compiled a6/111. */
import assert from 'node:assert/strict';import {readFileSync}from 'node:fs';import {pathToFileURL}from 'node:url';
const request=JSON.parse(readFileSync(process.argv[2]));assert.equal(request.runtimeRevision,'3792a908d81e04903974aa7d2bdc545e0713a290');assert.equal(request.compiledRevision,'a6f605280f778b2bc409ef97ac3b40e15874530c');
const {sourceIdentity,authenticateBuild}=await import(pathToFileURL(request.sourceWorktree+'/scripts/bochs-cpu3-native-owned-pic-imr-profile/identity.mjs'));
const source=sourceIdentity();assert.equal(source.revision,request.runtimeRevision);assert.deepEqual(source.hashes,request.runtimeSourceHashes);assert.equal(Object.keys(source.hashes).length,122);
const provenance=authenticateBuild(request.input,source);assert.equal(provenance.compiled.revision,request.compiledRevision);assert.deepEqual(provenance.compiled.hashes,request.compiledSourceHashes);assert.equal(Object.keys(provenance.compiled.hashes).length,111);assert.deepEqual(provenance.runtime,source);
console.log(JSON.stringify({source,provenance,status:'STATIC_PIC_SOURCE_ONLY_NO_ADDON_LOAD'}));
