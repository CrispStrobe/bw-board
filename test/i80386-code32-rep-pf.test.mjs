import test from 'node:test';
import assert from 'node:assert/strict';
import {assembleCode32RepPfRom,runCode32RepPfOracle,validateCode32RepPfOracle} from '../scripts/i80386-code32-rep-pf-oracle.mjs';

test('owned code32 ROM executes a genuine third-element #PF, handler and once-only REP restart',()=>{
 const {rom,symbols}=assembleCode32RepPfRom();assert.equal(rom.length,65536);
 assert.deepEqual([...rom.subarray(0xfff0,0xfff5)],[0xea,0,1,0,0xf0]);
 const r=runCode32RepPfOracle();const result=validateCode32RepPfOracle(r);
 assert.deepEqual([result.faults,result.rep,result.completed],[1,5,85]);
 assert.equal(r.deliveries[0].q,42);
 assert.equal(r.final.cpu.segmentCaches[1].default32,true);
 assert.equal(r.final.cpu.segmentCaches[2].default32,true);
 assert.equal(r.deliveries[0].before.eip,symbols.rep_fill);
});

test('independent effect replay rejects a missing committed byte and altered frame',()=>{
 const r=runCode32RepPfOracle();
 const missing=structuredClone(r);const i=missing.events.findIndex(e=>e.kind==='write'&&e.address===0x5004);missing.events.splice(i,1);
 assert.throws(()=>validateCode32RepPfOracle(missing),/complete backing replay|exact destination byte effects/);
 const changed=structuredClone(r);changed.deliveries[0].frame[4]^=1;
 assert.throws(()=>validateCode32RepPfOracle(changed),/real four-dword frame/);
 const duplicate=structuredClone(r);duplicate.events.push({...duplicate.events.find(e=>e.kind==='write'&&e.address===0x4ff8)});
 assert.throws(()=>validateCode32RepPfOracle(duplicate),/physical write before|exact destination byte effects/);
});
