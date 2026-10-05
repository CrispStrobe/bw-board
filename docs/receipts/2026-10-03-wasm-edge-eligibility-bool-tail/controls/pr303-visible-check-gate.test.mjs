import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readyVisibleChecks} from './pr303-visible-check-gate.mjs';
const core='43b2d62f5a0fa24ae0b38a645069f5aaa78af685';
const fixture=[...['test','vectors','corpus','vectors186','qualify'].flatMap(name=>[1,2].map(()=>({name,status:'COMPLETED',conclusion:'SUCCESS'}))),{name:'Inspect edge layout '+core,status:'COMPLETED',conclusion:'SUCCESS'},...[1,2].map(()=>({name:'vectors-full',status:'COMPLETED',conclusion:'SKIPPED'}))];
test('all eleven visible enabled checks plus exactly two intentional skips are required',()=>{
 assert(readyVisibleChecks(fixture,core));
 for(const index of fixture.keys())assert(!readyVisibleChecks(fixture.filter((_,i)=>i!==index),core));
 for(const change of [{status:'IN_PROGRESS'},{conclusion:'FAILURE'},{conclusion:'CANCELLED'},{conclusion:'SKIPPED'},{name:'unrelated'}]){
  const changed=structuredClone(fixture);Object.assign(changed[0],change);assert(!readyVisibleChecks(changed,core));
 }
 assert(!readyVisibleChecks([...fixture,fixture[0]],core));assert(!readyVisibleChecks(fixture,'different-core'));
 const wrongSkip=structuredClone(fixture);wrongSkip.at(-1).name='other';assert(!readyVisibleChecks(wrongSkip,core));
});
