/** Source/build bytes only; no native addon import/require. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const request=JSON.parse(readFileSync(process.argv[2]));
const {sourceIdentity,authenticateBuild}=await import(pathToFileURL(request.sourceWorktree+'/scripts/bochs-cpu3-native-owned-in8/identity.mjs'));
const source=sourceIdentity();assert.equal(source.revision,'fe1eff2039520536350922a2164c8bbe29404c68');assert.equal(Object.keys(source.hashes).length,103);
console.log(JSON.stringify({source,provenance:authenticateBuild(request.input,source),status:'STATIC_SOURCE_ONLY_NO_ADDON_LOAD'}));
