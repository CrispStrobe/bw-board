import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {expectedBuildMetadata,validateBuildMetadata} from './verify-build.mjs';

const [path]=process.argv.slice(2);assert.equal(process.argv.length,3);
const original=JSON.parse(readFileSync(path,'utf8'));
const expected=expectedBuildMetadata();assert.equal(validateBuildMetadata(original,expected),true);
const workflow='.github/workflows/i80386-native-cold-direct-ram-actual.yml';
assert.match(expected.directSourceHashes[workflow]??'',/^[0-9a-f]{64}$/);
const deny=(mutate,label)=>{const copy=structuredClone(original);mutate(copy);assert.throws(()=>validateBuildMetadata(copy,expected),label);};
deny(m=>{delete m.sourceHashes[Object.keys(m.sourceHashes)[0]];},'omitted source role');
deny(m=>{delete m.directSourceHashes[Object.keys(m.directSourceHashes)[0]];},'omitted direct role');
deny(m=>{delete m.directSourceHashes[workflow];},'omitted actual workflow role');
deny(m=>{delete m.actualPreparedHashes[Object.keys(m.actualPreparedHashes)[0]];},'omitted generated role');
deny(m=>{delete m.patchedHashes[Object.keys(m.patchedHashes)[0]];},'omitted CPU patch role');
deny(m=>{m.directRamProfile='wrong';},'wrong distinct profile');
deny(m=>{m.ownedClock.ownerCoreSha256='0'.repeat(64);},'wrong owner core pin');
console.log('direct-RAM exact metadata omission/tamper controls PASS');
