import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertHotBaseline} from '../scripts/i80386-free-combined-hot-proof.mjs';
// Explicit actual external baseline; these tests do not fabricate CPU execution.
const path=process.env.HOT_BASELINE;
if(!path)throw Error('HOT_BASELINE actual capture directory required');
const original=JSON.parse(readFileSync(path+'/capture.json')),journal=readFileSync(path+'/events.jsonl');
test('actual captured hot baseline and ordered compact journal pass',()=>assertHotBaseline(original,journal));
for(const [name,mutate,pattern] of [
 ['changed checksum',r=>r.final.checksums[0]++,/hot checksums/],
 ['lost committed work',r=>r.q--,/final committed Q/],
 ['invented strict profile',r=>r.reset.cpu.strict386=true,/compatibility profile/],
 ['unsettled device debt',r=>r.final.board.debt=1,/settled device debt/],
 ['wrong loop boundary',r=>r.boundaries.hot_register_end.q++,/register boundary/],
 ['lost original SMC witness',r=>r.final.witnesses[0]=0,/original SMC witnesses/],
])test(name,()=>{const r=structuredClone(original);mutate(r);assert.throws(()=>assertHotBaseline(r,journal),pattern);});
