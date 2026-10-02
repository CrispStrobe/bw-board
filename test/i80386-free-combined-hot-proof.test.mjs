import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {assertHotBaseline} from '../scripts/i80386-free-combined-hot-proof.mjs';
// Explicit actual external baseline; these tests do not fabricate CPU execution.
const path=process.env.HOT_BASELINE;
const capture=path?readFileSync(path+'/capture.json'):gunzipSync(readFileSync(new URL('./fixtures/i80386-free-combined-hot-initial-capture.json.gz',import.meta.url)));
const journal=path?readFileSync(path+'/events.jsonl'):gunzipSync(readFileSync(new URL('./fixtures/i80386-free-combined-hot-initial-events.jsonl.gz',import.meta.url)));
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(capture),'6e3e59b9c2e108ff3dc12d3b1ae087763f1a7df97b4778c79671b315369e4f74','actual historical capture bytes');
assert.equal(sha(journal),'2831037576f6426fbc622b6800f5ca6646c99e3b907858575ac352c8accad2f3','actual historical journal bytes');
const original=JSON.parse(capture);
test('actual captured hot baseline and ordered compact journal pass',()=>assertHotBaseline(original,journal));
for(const [name,mutate,pattern] of [
 ['changed checksum',r=>r.final.checksums[0]++,/hot checksums/],
 ['lost committed work',r=>r.q--,/final committed Q/],
 ['invented strict profile',r=>r.reset.cpu.strict386=true,/compatibility profile/],
 ['unsettled device debt',r=>r.final.board.debt=1,/settled device debt/],
 ['wrong loop boundary',r=>r.boundaries.hot_register_end.q++,/register boundary/],
 ['lost original SMC witness',r=>r.final.witnesses[0]=0,/original SMC witnesses/],
])test(name,()=>{const r=structuredClone(original);mutate(r);assert.throws(()=>assertHotBaseline(r,journal),pattern);});
