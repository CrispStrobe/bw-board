import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {assertNativeTraceParity,assertCaptureModeParity,assertDirectNativeBindings,assertDirectCallbackParity} from '../scripts/audit-i80386-native-direct-board-adapter.mjs';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const actual=(name,digest)=>{const bytes=gunzipSync(readFileSync(new URL('./fixtures/i80386-native-direct-board-r3-'+name+'.gz',import.meta.url)));assert.equal(sha(bytes),digest,'exact genuine r3 historical artifact bytes');return bytes.toString();};
// Exact r3 diagnostic capture; neither metadata nor guest observations are rewritten.
const captured=JSON.parse(actual('continuous-capture-true.json','eddf98771c3730a89ec6fdd5369296573e41a2f0bac6c670f9f56ebb98f5a866'));
const uncaptured=JSON.parse(actual('continuous-capture-false.json','5a6a1aab4a622c6f606c8e4874877ce07697d6091f32860344a1d46ecfbfce3b'));
const raw=actual('continuous-capture-true.stderr','94711af24873431303dc0ebccfbcd8b2f7586e96003e1bdb087d50325920095e');
let bytes=gunzipSync(readFileSync(new URL('../docs/receipts/2026-10-01-i80386-native-combined-paging-ram-capture.json.gz',import.meta.url)));
assert.equal(sha(bytes),'6f190e35f95630138b206461212a8f05b339bb9616fe9cfa5b1649bfa6c40bcd','published qualified FIFO actual bytes');
const fifo=JSON.parse(bytes).arms.continuous;bytes=null;
const clone=()=>structuredClone(captured);
const replaceRow=(trace,tag,mutate)=>{let done=false;const result=trace.split('\n').map(line=>{const p=line.split('\t');if(!done&&p[0]==='BWSD1'&&p[1]===tag){mutate(p);done=true;return p.join('\t');}return line;}).join('\n');assert.ok(done,`actual ${tag} row`);return result;};
test('actual r3 capture modes retain full native trace CPU/cache/bus and actual board parity',()=>{
 assertCaptureModeParity(captured,uncaptured);assertNativeTraceParity(raw,fifo.raw.stderr,{direct:captured,fifo});
});
test('coherent terminal CPU operand and raw STATE corruption rejects at CPU binding',()=>{
 const direct=clone();direct.final.state[0]^=1;const changed=replaceRow(raw,'STATE',p=>{p[2]=direct.final.state[0].toString(16).padStart(8,'0');});
 assert.throws(()=>assertNativeTraceParity(changed,fifo.raw.stderr,{direct,fifo}),/full native final state/);
});
test('native cached execute-pointer census is distinct from eight PAGE admissions',()=>{
 const direct=clone();direct.final.callbacks.executePages='8';const changed=replaceRow(raw,'CALLBACKS',p=>{p[4]='8';});
 assert.throws(()=>assertNativeTraceParity(changed,fifo.raw.stderr,{direct,fifo}),/actual native callback summary including cached execute pointers/);
});
test('nonzero fallback cannot be hidden by raw summary or lifecycle projection',()=>{
 const direct=clone();direct.final.fallback.bochsRamReads='1';const changed=replaceRow(raw,'FALLBACK',p=>{p[2]='1';});
 assert.throws(()=>assertNativeTraceParity(changed,fifo.raw.stderr,{direct,fifo}),/every actual native fallback counter/);
});
test('ordered physical callbacks cannot exchange observed memory operations',()=>{
 const direct=clone(),indices=direct.callbacks.flatMap((event,i)=>event.operation==='read'?[i]:[]);assert.ok(indices.length>2);
 [direct.callbacks[indices[0]],direct.callbacks[indices[1]]]=[direct.callbacks[indices[1]],direct.callbacks[indices[0]]];
 assert.throws(()=>assertDirectCallbackParity(direct,fifo),/ordered callback operation and arguments/);
});
test('authoritative PIO epoch cannot move to the post-quantum phase',()=>{
 const direct=clone(),event=direct.callbacks.find(e=>e.operation==='outPort'&&e.args[0]===0x60&&e.args[2]===1);assert.ok(event);
 event.result.mappingEpoch=0;event.result.boardA20=1;
 assert.throws(()=>assertDirectCallbackParity(direct,fifo),/authoritative PIO mapping phase before quantum/);
});
test('typed PAGE digest cannot substitute a different payload identity',()=>{
 const direct=clone(),event=direct.callbacks.find(e=>e.operation==='page');assert.ok(event);event.result.sha256='0'.repeat(64);
 assert.throws(()=>assertDirectCallbackParity(direct,fifo),/typed executable page bytes and SHA/);
});
test('intermediate raw CPU checkpoint corruption reaches exact raw semantic comparison',()=>{
 const changed=replaceRow(raw,'POST_STATE',p=>{p[2]=(parseInt(p[2],16)^1).toString(16).padStart(8,'0');});
 assert.throws(()=>assertNativeTraceParity(changed,fifo.raw.stderr,{direct:captured,fifo}),/all raw native CPU\/cache\/bus\/fault\/IRQ fields/);
});
test('raw alias generation corruption cannot be dropped as administration',()=>{
 const changed=replaceRow(raw,'ALIAS_UPDATE',p=>{p[6]=String(Number(p[6])+1);});
 assert.throws(()=>assertNativeTraceParity(changed,fifo.raw.stderr,{direct:captured,fifo}),/all raw native CPU\/cache\/bus\/fault\/IRQ fields/);
});
test('capture toggle corruption changes coherent final CPU and terminal checkpoint',()=>{
 const off=structuredClone(uncaptured);off.final.state[0]^=1;off.checkpoints.at(-1).native.state[0]^=1;
 assert.throws(()=>assertCaptureModeParity(captured,off),/capture mode parity: final/);
});
test('missing successful close witness rejects before lifecycle removal',()=>{
 const direct=clone();direct.closed.native=false;
 assert.throws(()=>assertDirectNativeBindings(direct,fifo),/successful native and facade close witness/);
});
test('raw callback summary must mirror the actual exported native counters',()=>{
 const changed=replaceRow(raw,'CALLBACKS',p=>{p[2]=String(Number(p[2])+1);});
 assert.throws(()=>assertNativeTraceParity(changed,fifo.raw.stderr,{direct:captured,fifo}),/raw native callback summary binds exported counters/);
});
