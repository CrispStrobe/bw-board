import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {validateMilestone,expectedPages,namedCuts,romInstructions,ramInstructions,layout} from '/tmp/bw-native-paged-int-iret-source-20261004/scripts/bochs-cpu3-native-paged-int-iret/profile.mjs';
const path='/tmp/native-paged-int-iret-source-controls-20261004/js-control.json',raw=fs.readFileSync(path),r=JSON.parse(raw);
assert.equal(r.schema,'bw.paged-int-iret.js-source-control.v1');
for(const s of [...r.frames,r.settled]){
 assert.deepEqual(Object.keys(s.pages),Object.keys(layout));
 for(const k of Object.keys(layout)){const p=s.pages[k];assert.equal(p.length,4096);assert.ok(p.every(v=>Number.isInteger(v)&&v>=0&&v<=255));s.pages[k]=Uint8Array.from(p);}
 assert.deepEqual(s.pages,expectedPages(s.stores,s.updates));
}
assert.equal(r.frames.length,42);r.frames.forEach((s,i)=>assert.equal(s.q,i));
assert.equal(r.settled.q,1+romInstructions.length+ramInstructions.length);
assert.deepEqual(r.cuts.map(c=>c.name),namedCuts.map(c=>c.name));
for(const c of r.cuts)assert.equal(validateMilestone(c.name,r.frames[c.q]),c.name);
assert.equal(validateMilestone('returned-from-IRET-before-HLT',r.settled),'returned-from-IRET-before-HLT');
assert.deepEqual(r.settled.cpu,r.frames.at(-1).cpu);assert.equal(r.settled.board.debt,0);
assert.equal(r.settled.deliveries.length,1);assert.equal(r.settled.deliveries[0].q,39);
assert.equal(r.settled.stores.length,23);assert.equal(r.settled.updates.length,7);
const result={status:'ROOT_SAVED_CAPTURE_PASS',scope:'Offline unchanged frozen JS policy; no factory, CPU instruction or native load',captureSha256:crypto.createHash('sha256').update(raw).digest('hex'),frames:42,steps:r.settled.q,cuts:14,wholePagesPerFrame:10,terminalRamSha256:r.settled.ramSha256};
fs.writeFileSync('/tmp/native-paged-int-iret-source-controls-20261004/root-saved-capture-audit.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
