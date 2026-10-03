/** Pure diagnostic fixtures and reset constructors only; never step a CPU. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateReadyBinding,validateSuccessfulCapture,authorizedTarget} from '../scripts/cold-plain-js-performance/admission.mjs';
import {createPlainJsBochsResetMachine} from '../scripts/cold-plain-js-performance/factory.mjs';
import {validateWorkerInput,compareFinalEvidence} from '../scripts/cold-plain-js-performance/worker.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),hash='a'.repeat(64);
function fixture(){
 const identity={revision:'64514be6e45418910c5f952873382a2581810e1f',hashes:{diagnostic:hash}};
 // Synthetic data tests protocol refusal, not real capture provenance. The
 // public validator keeps the actual frozen driver hash literal unchanged.
 const b={schema:'bw.cold-plain-js.capture-binding.v1',status:'INDEPENDENTLY_AUDITED_CAPTURE_READY',compiledRevision:'a6fae61a549d595c88a324f50589d92497040c07',driverRevision:identity.revision,driverSourceSha256:'ec9a89ec22aa6332fd64f6058c88706ed493fbefd33d8576a9d88e747dfd7ea9',captureSha256:hash,independentAuditSha256:hash,independentAuditApproved:true,targetQ:10};
 return {b,identity};
}
test('pending capture and invalid audit/target/role bindings deny',()=>{
 const pending=JSON.parse(readFileSync(new URL('../scripts/cold-plain-js-performance/capture-binding.json',import.meta.url)));assert.throws(()=>validateReadyBinding(pending));
 const {b}=fixture();assert.equal(validateReadyBinding(b),b);for(const change of [x=>x.targetQ=null,x=>x.targetQ=0,x=>x.targetQ=400001,x=>x.targetQ=1.5,x=>x.independentAuditApproved=false,x=>x.captureSha256=null,x=>x.status='FAIL',x=>x.compiledRevision='b'.repeat(40),x=>x.extra=1]){const v=clone(b);change(v);assert.throws(()=>validateReadyBinding(v));}
});
test('missing/failed/mismatched successful capture denies without execution',()=>{
 const {b}=fixture();for(const c of [{},{schema:'bw.native-cold-bios.external-diagnostic.v1',status:'FAIL'},{schema:'bw.native-cold-bios.external-diagnostic.v1',status:'CLOSED_COLD_BIOS_BOCHS_RESET_MODEL_JS_DIAGNOSTIC_PASS',input:{compiledRevision:'b'.repeat(40)}}])assert.throws(()=>validateSuccessfulCapture(c,b));
 assert.throws(()=>authorizedTarget({targetQ:10}));assert.throws(()=>authorizedTarget(null));
});
test('fixed constructor has exact reset model, caller hooks denied, synthetic token cannot run',()=>{
 assert.throws(()=>createPlainJsBochsResetMachine({onPortAccess(){}}));const m=createPlainJsBochsResetMachine(),r=m.reset();assert.equal(r.q,0);assert.equal(r.cpu.edx,0);assert.equal(r.cpu.cr0,0x7ffffff0);assert.equal(r.cpu.segmentCaches[1].base,0xffff0000);assert.deepEqual(r.cpu.gdtr,{base:0,limit:0xffff});assert.deepEqual(r.cpu.idtr,{base:0,limit:0xffff});assert.deepEqual(r.cpu.debugRegisters,[0,0,0,0,0,0,0xffff1ff0,0x400]);assert.equal(r.board.cycles,4);assert.equal(r.board.debt,0);assert.deepEqual(r.board.a20.outputQueue,[]);assert.equal(r.board.a20.delayedResponse,null);
 assert.throws(()=>m.execute({targetQ:1}));assert.deepEqual(m.reset(),r,'no instruction executed on invalid token');m.close();assert.throws(()=>m.reset());
});
test('raw final CPU, whole board/RAM and complete ordered PIO comparator rejects mutations',()=>{
 const final={q:10,cpu:{edx:0,cr0:0x7ffffff0,eip:0xe16},board:{pic1:{irr:1},cycles:64},ramSha256:hash},ports=[{ordinal:1,q:3,cycles:16,width:8,dir:'out',port:0x64,value:0xaa},{ordinal:2,q:9,cycles:52,width:8,dir:'in',port:0x60,value:0x55}],capture={javascriptFinal:clone(final),javascriptPorts:clone(ports)},result={final,ports};assert.equal(compareFinalEvidence(result,capture).q,10);
 for(const change of [x=>x.final.cpu.edx=0x300,x=>x.final.cpu.cr0=0,x=>x.final.board.pic1.irr=0,x=>x.final.ramSha256='b'.repeat(64),x=>x.ports.reverse(),x=>x.ports[0].q++,x=>x.ports[1].value=0,x=>x.ports.pop()]){const v=clone(result);change(v);assert.throws(()=>compareFinalEvidence(v,capture));}
});
test('closed worker input refuses extra hooks, aliases and unbounded paths',()=>{
 const input={capture:'/capture.json',independentAudit:'/audit.json',output:'/new-output',workerRevision:'b'.repeat(40),workerSourceSha256:hash,nodeSha256:hash};assert.equal(validateWorkerInput(input),input);
 for(const change of [x=>x.hooks={},x=>x.capture='relative',x=>x.output=x.capture,x=>x.nodeSha256='bad',x=>x.workerRevision=null,x=>x.output='/x/../out']){const v=clone(input);change(v);assert.throws(()=>validateWorkerInput(v));}
});
