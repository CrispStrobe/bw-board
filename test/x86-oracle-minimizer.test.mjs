import {test} from 'node:test';
import assert from 'node:assert/strict';
import {minimizeOracleProbe} from '../scripts/lib/minimize-x86-oracle-probe.mjs';
const fixture=()=>({name:'owned',bytes:[0x01,0xd8],models:['80286'],flagsMask:0xfd5,
    regs:{ax:0xffff,bx:3,cx:77},ram:[[100,0xff],[101,17],[102,33],[103,8]]});
test('oracle reduction preserves the reproducing state and never changes instructions/masks',async()=>{
    const original=fixture(),before=structuredClone(original);
    const fails=p=>!!((p.regs.ax??0)&0x8000)&&p.ram.some(([a,v])=>a===100&&(v&0x40));
    const result=await minimizeOracleProbe(original,fails);
    assert.ok(fails(result.probe));assert.deepEqual(result.probe.regs,{ax:0x8000});
    assert.deepEqual(result.probe.ram,[[100,0x40]]);assert.deepEqual(original,before);
    assert.deepEqual(result.probe.bytes,original.bytes);assert.equal(result.probe.flagsMask,original.flagsMask);
    assert.deepEqual(result.probe.models,original.models);assert.equal(result.budgetExhausted,false);
});
test('oracle reduction has a hard call budget and refuses an unreproducible seed',async()=>{
    let calls=0;const result=await minimizeOracleProbe(fixture(),()=>{calls++;return true;},{maxEvaluations:3});
    assert.equal(calls,3);assert.equal(result.evaluations,3);assert.equal(result.budgetExhausted,true);
    await assert.rejects(()=>minimizeOracleProbe(fixture(),()=>false),/does not reproduce/);
    await assert.rejects(()=>minimizeOracleProbe({...fixture(),ram:[[0x100,0x90]]},()=>true),/instruction-byte/);
});
