/** Pure schema controls using manufactured and retained snapshots; no machine/addon/step. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {nextBudget,validateReturn,validateTerminalMetadata,validateInspectMetadata,validateFinalReturn,compareReset,compareFinalEvidence,noArtificialNativeDeadline} from '../scripts/cold-native-performance/protocol.mjs';
import {validateReadyBinding,validateSuccessfulCapture,validateIndependentAudit,authorizedTarget,sha} from '../scripts/cold-native-performance/admission.mjs';
import {validateWorkerInput} from '../scripts/cold-native-performance/worker.mjs';
const clone=x=>JSON.parse(JSON.stringify(x)),hash='a'.repeat(64);
function cpuFixture(final=false){
 return {eax:0,ecx:0,edx:0,ebx:0,esp:0,ebp:0,esi:0,edi:0,eip:final?0xe16:0xfff0,eflags:2,cr0:0x7ffffff0,cr2:0,cr3:0,cs:0xf000,ds:0,ss:0,es:0,fs:0,gs:0,pc:final?0xf0e16:0xfffffff0,gdtr:{base:0,limit:0xffff},idtr:{base:0,limit:0xffff},ldtr:{selector:0,base:0,limit:0xffff,present:true,type:2},tr:{selector:0,base:0,limit:0xffff,present:true,type:11},segmentCaches:Object.fromEntries(Array.from({length:6},(_,i)=>[i,{base:i===1?(final?0xf0000:0xffff0000):0,limit:0xffff,default32:false,present:true}])),debugRegisters:[0,0,0,0,0,0,0xffff1ff0,0x400],halted:false,shutdown:false,cycles:final?10:0};
}
function nativeFixture(j=cpuFixture()){
 const fields=['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'];const row=(i,selector,c,type=3)=>[i,selector,selector>>>3,(selector>>>2)&1,selector&3,1,Number(c.present),0,1,type,c.base,c.limit,0,Number(!!c.default32),0];
 return {state:[...fields.map(k=>j[k]),j.gdtr.base,j.gdtr.limit,j.idtr.base,j.idtr.limit],extra:[j.debugRegisters[6],j.debugRegisters[7],j.es,j.fs,j.gs,...row(1,j.cs,j.segmentCaches[1]).slice(2),0,0],segments:['es','cs','ss','ds','fs','gs'].flatMap((k,i)=>row(i,j[k],j.segmentCaches[i])),system:['ldtr','tr'].flatMap((k,i)=>row(i+6,j[k].selector,j[k],j[k].type)),debug:[...j.debugRegisters.slice(0,4),j.debugRegisters[6],j.debugRegisters[7]],nativeTicks:j.cycles,successfulQuanta:j.cycles,mappingEpoch:0,boardA20:1,fallback:Object.fromEntries(['bochsRamReads','bochsRamWrites','bochsDirectPointers','bochsPio','bochsTimer'].map(k=>[k,0])),execution:Object.fromEntries(['attempts','completed','repIterations','repPartial','faults','portCommits','irqDeliveries','haltIdleCuts'].map(k=>[k,0])),clockTransfers:Object.fromEntries(['transfers','commits','words'].map(k=>[k,0])),callbacks:Object.fromEntries(['physicalReads','physicalWrites','executePages','nativeTickCallbacks','quantumCallbacks'].map(k=>[k,0]))};
}
function resumeFixture(n=nativeFixture()){return {...n,activityState:0,reason:1,chargedNativeTicks:0,chargedQuanta:0,sliceBytes:new Uint8Array(160)};}
function fixture(){
 const identity={revision:'b'.repeat(40),hashes:{driver:hash}},compiledRevision='7632e6a0995ceaab88bc8cede91506a5330d2e1c';const binding={schema:'bw.cold-native-performance.capture-binding.v1',status:'INDEPENDENTLY_AUDITED_CAPTURE_READY',compiledRevision,driverRevision:identity.revision,driverSourceSha256:sha(Buffer.from(JSON.stringify(identity))),captureSha256:hash,independentAuditSha256:hash,independentAuditApproved:true,targetQ:10};
 const resetJs=cpuFixture(),finalJs=cpuFixture(true),reset=nativeFixture(resetJs),final={...nativeFixture(finalJs),nativeTicks:12},board={cycles:64,debt:0,a20Enabled:true,pic1:{irr:1,imr:0,isr:0}},ports=[{ordinal:1,q:3,cycles:16,width:8,dir:'out',port:0x64,value:0xaa},{ordinal:2,q:9,cycles:52,width:8,dir:'in',port:0x60,value:0x55}];
 const capture={schema:'bw.native-cold-bios.external-diagnostic.v1',status:'CLOSED_COLD_BIOS_BOCHS_RESET_MODEL_JS_DIAGNOSTIC_PASS',input:{compiledRevision,driverRevision:identity.revision,driverSourceSha256:binding.driverSourceSha256,nativeTrace:false},closed:{native:true,provider:true,javascript:true},driverBefore:identity,driverAfter:clone(identity),compiledBefore:{revision:compiledRevision},compiledAfter:{revision:compiledRevision},progress:{n:12,q:10},javascriptFinal:{q:10,cpu:finalJs,board,ramSha256:hash},nativeFinal:{ramSha256:hash},javascriptPorts:ports,cuts:[{name:'reset',native:reset,javascript:{cpu:resetJs,board:{cycles:4,debt:0}}},...Array.from({length:13},(_,i)=>({name:'synthetic-'+i})),{name:'before-F000-E16',native:final,javascript:{q:10,cpu:clone(finalJs)}}]};
 const settled={state:{board:clone(board),successfulQuanta:10,nativeTicks:12,mappingEpoch:0,cold:{phase:'complete',portEventCount:2}},ramSha256:hash};const nativePorts=ports.map(p=>({...p,successfulQuanta:p.q-1,nativeTicks:p.q+2}));return {binding,capture,final,settled,nativePorts,last:{...resumeFixture(final),chargedNativeTicks:1,chargedQuanta:1}};
}
test('closed oneQ/batched budgets clip remaining Q without equating independent N',()=>{
 assert.deepEqual(nextBudget('oneQ',0,1000),{maxN:1,maxQ:1});assert.deepEqual(nextBudget('batched',0,1000),{maxN:600,maxQ:300});assert.deepEqual(nextBudget('batched',995,1000),{maxN:600,maxQ:5});assert.equal(noArtificialNativeDeadline,0xffffffffffffffffn);
 for(const args of [['wide',0,10],['batched',10,10],['oneQ',-1,10],['batched',0,400001],['oneQ',0,null],['batched',0,1.5]])assert.throws(()=>nextBudget(...args));
});
test('real return guard allows N/Q differences, PIO and zero-Q events within exact caps',()=>{
 const n=resumeFixture(),previous={n:0,q:0},budget={maxN:600,maxQ:300};const r={...n,nativeTicks:600,successfulQuanta:300,chargedNativeTicks:600,chargedQuanta:300};assert.deepEqual(validateReturn(previous,r,budget,1000),{n:600,q:300,dn:600,dq:300});assert.equal(validateReturn(previous,{...n,reason:7},budget,1000).dq,0);assert.equal(validateReturn(previous,{...n,nativeTicks:1,chargedNativeTicks:1,reason:3},budget,1000).dq,0);assert.deepEqual(validateReturn(previous,{...n,successfulQuanta:1,chargedQuanta:1},nextBudget('oneQ',0,10),10),{n:0,q:1,dn:0,dq:1});
 for(const patch of [{nativeTicks:601,chargedNativeTicks:601},{successfulQuanta:301,chargedQuanta:301},{successfulQuanta:11,chargedQuanta:11},{chargedNativeTicks:1},{reason:4},{reason:2},{reason:6},{activityState:undefined},{activityState:1},{mappingEpoch:1},{boardA20:0},{nativeTicks:'01'}])assert.throws(()=>validateReturn(previous,{...n,...patch},budget,10));
});
test('terminal guard retains raw CR0, real activity and all fallback/execution counters',()=>{
 const {final}=fixture();validateTerminalMetadata(final);for(const change of [n=>n.state[8]++,n=>n.state[10]=0,n=>n.activityState=1,n=>n.fallback={},n=>n.execution={},n=>n.execution.faults=1,n=>n.execution.irqDeliveries=1,n=>n.execution.haltIdleCuts=1,n=>n.fallback.bochsPio=1]){const n=clone(final);change(n);assert.throws(()=>validateTerminalMetadata(n));}
});
test('every raw final166 word and independent final N remain strict',()=>{
 const {final,settled,nativePorts,capture,last}=fixture();assert.equal(compareFinalEvidence(final,settled,nativePorts,capture,last).q,10);assert.equal(final.nativeTicks,12);assert.equal(final.successfulQuanta,10);assert.throws(()=>compareFinalEvidence({...final,nativeTicks:11},settled,nativePorts,capture,last));const badCut=clone(capture);badCut.cuts.at(-1).javascript.cpu.edx=1;assert.throws(()=>compareFinalEvidence(final,settled,nativePorts,badCut,last));
 for(const k of ['state','extra','segments','system','debug'])for(let i=0;i<final[k].length;i++){const n=clone(final);n[k][i]=(n[k][i]^1)>>>0;assert.throws(()=>compareFinalEvidence(n,settled,nativePorts,capture,last),k+' '+i);}
 compareReset(capture.cuts[0].native,{board:capture.cuts[0].javascript.board},capture);const reset=clone(capture.cuts[0].native);reset.state[2]=0x300;assert.throws(()=>compareReset(reset,{board:capture.cuts[0].javascript.board},capture));
});
test('complete PIO, real asserted PIC and whole raw RAM cannot be normalized away',()=>{
 const {final,settled,nativePorts,capture,last}=fixture();for(const change of [s=>s.state.board.pic1.irr=0,s=>s.ramSha256='b'.repeat(64),s=>s.state.cold.phase='waiting55',s=>s.state.nativeTicks=10,s=>s.state.successfulQuanta=9,s=>s.state.cold.portEventCount=1]){const s=clone(settled);change(s);assert.throws(()=>compareFinalEvidence(final,s,nativePorts,capture,last));}
 for(const change of [p=>p.reverse(),p=>p.pop(),p=>p[0].cycles++,p=>p[0].successfulQuanta++,p=>p[1].value=0]){const p=clone(nativePorts);change(p);assert.throws(()=>compareFinalEvidence(final,settled,p,capture,last));}
});
test('pending/failed/unaudited or inconsistent capture cannot authorize native execution',()=>{
 const pending=JSON.parse(readFileSync(new URL('../scripts/cold-native-performance/capture-binding.json',import.meta.url)));validateReadyBinding(pending);assert.equal(pending.targetQ,316562);assert.throws(()=>validateReadyBinding({...pending,status:'PENDING_INDEPENDENTLY_AUDITED_SUCCESSFUL_CAPTURE'}));assert.throws(()=>authorizedTarget({targetQ:10}));const {binding,capture}=fixture();validateSuccessfulCapture(capture,binding);
 for(const change of [b=>b.targetQ=null,b=>b.targetQ=400001,b=>b.independentAuditApproved=false,b=>b.driverRevision='bad',b=>b.driverSourceSha256=null,b=>b.compiledRevision='a'.repeat(40)]){const b=clone(binding);change(b);assert.throws(()=>validateReadyBinding(b));}
 for(const change of [c=>c.status='FAIL',c=>c.input.driverRevision='c'.repeat(40),c=>c.input.driverSourceSha256='c'.repeat(64),c=>c.progress.q=9,c=>c.driverAfter.hashes.driver='b'.repeat(64),c=>c.javascriptPorts[0].cycles++,c=>c.nativeFinal.ramSha256='b'.repeat(64)]){const c=clone(capture);change(c);assert.throws(()=>validateSuccessfulCapture(c,binding));}
});
test('fixed CLI mode/source/artifact/output roles refuse caller knobs before native load',()=>{
 const input={compiledRoot:'/compiled',compiledRevision:'7632e6a0995ceaab88bc8cede91506a5330d2e1c',addon:'/addon.node',sha256:hash,configuration:'/config',preparedManifest:'/manifest',preparedManifestSha256:hash,buildReceipt:'/receipt',buildReceiptSha256:hash,capture:'/capture',independentAudit:'/audit',output:'/exclusive-output',workerRevision:'b'.repeat(40),workerSourceSha256:hash,nodeSha256:hash,mode:'batched'};assert.equal(validateWorkerInput(input),input);validateWorkerInput({...input,mode:'oneQ'});
 for(const patch of [{mode:'custom'},{maxQ:1000},{nativeTrace:true},{compiledRevision:'a'.repeat(40)},{output:'/compiled/new'},{capture:'/exclusive-output/capture'},{independentAudit:'/capture'},{addon:'relative'},{nodeSha256:null}])assert.throws(()=>validateWorkerInput({...input,...patch}));
});

test('genuine aggregate audit must bind the same capture extent, cuts, ports and raw RAM phase',()=>{
 const {binding,capture}=fixture();capture.progress.resumes=10;
 const audit={status:'PASS_INDEPENDENT_EIGHTH_COLD_E16_AUDIT',checks:34066,members:448,extent:{n:12,q:10,resumes:10,zeroQ:0},cuts:15,repElements:400,ports:2,ramSha256:capture.javascriptFinal.ramSha256};
 validateIndependentAudit(audit,capture,binding);
 for(const mutate of [a=>a.status='PASS',a=>a.extent.q++,a=>a.extent.n++,a=>a.extent.resumes++,a=>a.extent.zeroQ=1,a=>a.cuts--,a=>a.repElements--,a=>a.ports++,a=>a.ramSha256='b'.repeat(64)]){const a=clone(audit);mutate(a);assert.throws(()=>validateIndependentAudit(a,capture,binding));}
});

test('genuine eighth inspect and resume schemas remain distinct without fabricated activity',()=>{
 const actual=JSON.parse(readFileSync(new URL('../scripts/cold-native-performance/actual-snapshot-fixtures.json',import.meta.url)));
 validateInspectMetadata(actual.reset);validateTerminalMetadata(actual.finalInspect);assert.equal(Object.hasOwn(actual.reset,'activityState'),false);assert.equal(Object.hasOwn(actual.finalInspect,'activityState'),false);
 // Retained JSON bytes reconstruct the live napi_uint8_array ABI type; not a retained live object.
 const returned={...actual.resume,sliceBytes:Uint8Array.from(actual.resume.sliceBytes)},previous={n:Number(returned.nativeTicks)-returned.chargedNativeTicks,q:Number(returned.successfulQuanta)-returned.chargedQuanta};validateReturn(previous,returned,{maxN:1,maxQ:1},316562);
 const inspect=clone(returned);for(const key of ['activityState','reason','chargedNativeTicks','chargedQuanta','sliceBytes'])delete inspect[key];validateInspectMetadata(inspect);validateFinalReturn(returned,inspect);
 for(const slice of [actual.resume.sliceBytes,undefined,new Uint16Array(160),new DataView(new ArrayBuffer(160)),new Uint8Array(159),new Uint8Array(161)])assert.throws(()=>validateFinalReturn({...returned,sliceBytes:slice},inspect));
 assert.deepEqual(Array.from(returned.sliceBytes),actual.resume.sliceBytes);
 for(const mutate of [n=>delete n.activityState,n=>n.activityState=1,n=>delete n.reason,n=>delete n.chargedNativeTicks,n=>delete n.chargedQuanta]){const n=structuredClone(returned);mutate(n);assert.throws(()=>validateReturn(previous,n,{maxN:1,maxQ:1},316562));}
 for(const mutate of [n=>n.execution.faults='1',n=>n.execution.irqDeliveries='1',n=>n.execution.haltIdleCuts='1',n=>n.activityState=0,n=>delete n.callbacks]){const n=clone(actual.finalInspect);mutate(n);assert.throws(()=>validateTerminalMetadata(n));}
 for(const mutate of [n=>n.activityState=1,n=>delete n.activityState,n=>n.chargedNativeTicks=601,n=>n.chargedQuanta=-1,n=>delete n.sliceBytes,n=>n.nativeTicks=Number(n.nativeTicks)+1,n=>n.successfulQuanta=Number(n.successfulQuanta)+1,n=>n.state[2]^=1]){const n=structuredClone(returned);mutate(n);assert.throws(()=>validateFinalReturn(n,inspect));}
});
