import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const [ownedPath,callbackPath]=process.argv.slice(2);
assert.ok(ownedPath&&callbackPath&&process.argv.length===4);
const owned=JSON.parse(readFileSync(ownedPath,'utf8'));
const callback=JSON.parse(readFileSync(callbackPath,'utf8'));
assert.equal(owned.mode,'owned');assert.equal(callback.mode,'callback');
assert.equal(owned.schema,'bw.cold-native.owned-ram-actual-fixture.v1');
const normalize=({mode,...rest})=>rest;
assert.deepEqual(normalize(owned),normalize(callback),'actual owned/callback cold guest parity');
for(const cut of [owned.reset.native,owned.last,owned.final]){
 assert.equal(cut.state.length+cut.extra.length+cut.segments.length+cut.system.length+cut.debug.length,166,'full 166-word native state');
}
assert.equal(owned.reset.native.successfulQuanta,'0','reset Q');
assert.equal(owned.last.successfulQuanta,owned.target.toString(),'requested last Q');
assert.equal(owned.final.successfulQuanta,owned.target.toString(),'exact target Q');
assert.match(owned.ramSha256,/^[a-f0-9]{64}$/);
if(owned.target===316562){assert.equal(owned.resumes,16524,'full cold resume count');assert.equal(owned.ports.length,16475,'full ordered PIO count');assert.equal(owned.final.nativeTicks,'316562','full cold N');}
console.log(JSON.stringify({schema:owned.schema,target:owned.target,resumes:owned.resumes,zero:owned.zero,ports:owned.ports.length,nativeTicks:owned.final.nativeTicks,successfulQuanta:owned.final.successfulQuanta,ramSha256:owned.ramSha256,fullStateWords:166,parity:'PASS'}));
