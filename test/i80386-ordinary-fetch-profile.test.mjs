import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeOrdinaryFetchProfile} from
  '../scripts/summarize-i80386-ordinary-fetch-profile.mjs';

const node=(id,functionName,url,children=[])=>({id,callFrame:{functionName,url},children});
const core='file:///board/src/experimental/i80386.js';
const board='file:///board/src/experimental/i80386-at-machine.js';

test('self samples form disjoint fetch, data and other bins by ancestry',()=>{
  const profile={nodes:[
    node(1,'(root)','',[2,5,7,8]),
    node(2,'_stepInstruction',core,[3,4]),
    node(3,'_fetch8',core,[6]),
    node(4,'_readLinear',core),
    node(5,'_read386',board),
    node(6,'_translate',core),
    node(7,'run','file:///board/scripts/run-i80386-at-console.mjs'),
    node(8,'(garbage collector)',''),
  ],samples:[3,6,4,2,5,7,8,6,6,6]};
  const result=summarizeOrdinaryFetchProfile(profile);
  assert.equal(result.totalSamples,10);
  assert.deepEqual(result.counts,{codeFetchOrigin:5,dataOrEaOrigin:1,
    coreOther:1,atBoardOther:1,consoleOther:1,allOther:1});
  assert.equal(result.codeFetchPercent,50);
  assert.equal(result.screenPass,true);
});

test('translate without a visible fetch ancestor is not credited to code fetch',()=>{
  const profile={nodes:[node(1,'(root)','',[2]),node(2,'_translate',core)],samples:[2]};
  assert.equal(summarizeOrdinaryFetchProfile(profile).counts.coreOther,1);
  assert.equal(summarizeOrdinaryFetchProfile(profile).screenPass,false);
});
