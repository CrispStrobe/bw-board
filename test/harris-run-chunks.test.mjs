import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runHarrisChunks} from '../src/experimental/harris-run-chunks.js';
test('chunk runner preserves exact period budget and input order across host yields',async()=>{
    let periods=0,yields=0;const inputs=[];
    const cpu={status:'running',stepClock(){assert.equal(inputs.at(-1),periods);periods++;}};
    const result=await runHarrisChunks({cpu,maxClocks:11,chunkClocks:3,now:()=>0,
        beforeClock:clock=>inputs.push(clock),yieldTask:async()=>{yields++;}});
    assert.equal(result.status,'budget-exhausted');assert.equal(result.clocks,11);assert.equal(periods,11);
    assert.equal(result.chunks,4);assert.equal(yields,3);assert.deepEqual(inputs,Array.from({length:11},(_,i)=>i));
});
test('chunk runner stops before the requested period and yields at cooperative wall limits',async()=>{
    let time=0,yields=0;
    const cpu={status:'running',stepClock(){time++;}};
    const result=await runHarrisChunks({cpu,maxClocks:20,checkEvery:1,wallBudgetMS:2,now:()=>time,
        stopped:clock=>clock===7,yieldTask:async()=>{yields++;}});
    assert.equal(result.status,'stopped');assert.equal(result.clocks,7);assert.equal(time,7);
    assert.equal(yields,3);assert.equal(result.maxChunkMS,2);
});
test('chunk runner propagates faults and does not execute after a completion predicate',async()=>{
    let clocks=0;const cpu={stepClock(){clocks++;}};
    const done=await runHarrisChunks({cpu,maxClocks:10,finished:()=>clocks===2,now:()=>0});
    assert.equal(done.status,'completed');assert.equal(done.clocks,2);
    await assert.rejects(()=>runHarrisChunks({cpu:{stepClock(){throw new Error('wired fault');}},maxClocks:1,finished:()=>false}),/wired fault/);
});
