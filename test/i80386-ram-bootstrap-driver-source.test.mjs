/** Manufactured diagnostic fixtures only: no machine construction or CPU/addon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveDriverProvider,builtProviderSha256} from '../scripts/bochs-cpu3-native-ram-bootstrap/driver-provider.mjs';
import {deriveRamProvider} from '../scripts/bochs-cpu3-native-ram-bootstrap/provider-derivation.mjs';
import {compareBoundary,ramProgress,validateMilestones,wholeNativeWords} from '../scripts/bochs-cpu3-native-ram-bootstrap/parity.mjs';
import {initializeRamReset,cutName} from '../scripts/bochs-cpu3-native-ram-bootstrap/reference.mjs';
import {validateInput,finalizeAuthentication} from '../scripts/bochs-cpu3-native-ram-bootstrap/runner.mjs';
import {compiledRevision,addonSha256} from '../scripts/bochs-cpu3-native-ram-bootstrap/driver-auth.mjs';
import {namedCuts,expectedRamPage,bootStores,patchStore} from '../scripts/bochs-cpu3-native-ram-bootstrap/profile.mjs';
const copy=x=>structuredClone(x);
function fixture(){
 const j={eax:1,ecx:0,edx:0,ebx:0,esp:0,ebp:0,esi:0,edi:0,eip:0x7003,eflags:2,cr0:0x7ffffff0,cr2:0,cr3:0,cr4:0,cs:0,ds:0,ss:0,es:0,fs:0,gs:0,pc:0x7003,gdtr:{base:0,limit:0xffff},idtr:{base:0,limit:0xffff},ldtr:{selector:0,base:0,limit:0xffff,present:true,type:2},tr:{selector:0,base:0,limit:0xffff,present:true,type:11},segmentCaches:Array.from({length:6},()=>({base:0,limit:0xffff,default32:false,present:true})),debugRegisters:[0,0,0,0,0,0,0xffff1ff0,0x400],halted:false,shutdown:false,interruptShadow:0,nmiShadow:0,debugShadow:0};
 const n={state:['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'].map(k=>j[k]).concat(0,0xffff,0,0xffff),extra:Array(20).fill(0),segments:Array(90).fill(0),system:Array(30).fill(0),debug:[0,0,0,0,0xffff1ff0,0x400],nativeTicks:1,successfulQuanta:1,mappingEpoch:0,boardA20:1,activityState:0,chargedNativeTicks:1,chargedQuanta:1,reason:1,execution:{attempts:1,completed:1,repIterations:0,repPartial:0,faults:0,portCommits:0,irqDeliveries:0,haltIdleCuts:0},fallback:{bochsRamReads:0,bochsRamWrites:0,bochsDirectPointers:0,bochsPio:0,bochsTimer:0}};
 n.extra[0]=j.debugRegisters[6];n.extra[1]=j.debugRegisters[7];n.extra[9]=1;n.extra[14]=0xffff;
 for(let i=0;i<6;i++){n.segments[i*15]=i;n.segments[i*15+6]=1;n.segments[i*15+11]=0xffff;}
 for(let i=0;i<2;i++){n.system[i*15]=i+6;n.system[i*15+6]=1;n.system[i*15+9]=i?11:2;n.system[i*15+11]=0xffff;}
 const page=expectedRamPage(4),board={board:{cycles:10,debt:6,deadline:6000,a20Enabled:true},successfulQuanta:1,mappingEpoch:0};
 return {n,board,js:{q:1,cpu:j,board:copy(board.board),ramPage:Uint8Array.from(page)},page};
}
test('driver provider has exactly one byte-invertible paused copied page seam',()=>{
 const original=deriveRamProvider().bytes,result=deriveDriverProvider(original);assert.equal(result.parentSha256,builtProviderSha256);assert.ok(result.bytes.toString().includes('return Uint8Array.from(board.machine.mem.subarray(0x7000,0x8000))'));
 const bad=Buffer.from(original);bad[0]^=1;assert.throws(()=>deriveDriverProvider(bad));assert.throws(()=>deriveDriverProvider(Buffer.from('unknown provider')));
});
test('manufactured dynamic CPU/page/board parity refuses real field mutations',()=>{
 const f=fixture();compareBoundary(f.n,f.board,f.js,f.page);assert.equal(wholeNativeWords(f.n).length,166);
 for(const mutation of [x=>x.n.state[0]=2,x=>x.n.state[9]=0x802,x=>x.n.segments[55]=1,x=>x.n.system[11]=0,x=>x.n.debug[0]=1,x=>x.n.mappingEpoch=1,x=>x.n.boardA20=0,x=>x.board.board.debt=0,x=>x.page[3000]=1,x=>x.page[1]=2,x=>x.js.cpu.cr4=1,x=>x.js.cpu.interruptShadow=1]){const x=copy(f);mutation(x);assert.throws(()=>compareBoundary(x.n,x.board,x.js,x.page));}
});
test('independent one-Q progress refuses caps, fallback, IRQ, REP, halt and missing fields',()=>{
 const f=fixture();assert.deepEqual(ramProgress({n:0,q:0},f.n),{n:1,q:1,dn:1,dq:1});
 for(const mutation of [x=>x.nativeTicks=513,x=>x.successfulQuanta=513,x=>x.chargedQuanta=0,x=>x.activityState=1,x=>x.reason=4,x=>x.fallback={},x=>x.fallback.bochsRamWrites=1,x=>x.execution.irqDeliveries=1,x=>x.execution.repIterations=1,x=>delete x.execution.portCommits]){const n=copy(f.n);mutation(n);assert.throws(()=>ramProgress({n:0,q:0},n));}
 const zero=copy(f.n);Object.assign(zero,{chargedNativeTicks:0,chargedQuanta:0,reason:7});assert.equal(ramProgress({n:1,q:1},zero).dq,0);
});
test('exact named milestone order and page generations are required',()=>{
 const cuts=namedCuts.map((c,i)=>({name:c.name,q:i,javascript:{cpu:{cs:c.cs,eip:c.eip,eax:c.ax??0},ramPage:Array.from(i?expectedRamPage(i===1?4:5):new Uint8Array(4096))},board:{generations:[[0x7000,i===1?4:5]],ram:{bootStores:4,patches:i===1?0:1,admitted:true,writes:[...bootStores,...(i===1?[]:[patchStore])].map(([raw,...bytes],k)=>({raw,bytes,generation:k+1}))}}}));
 assert.equal(validateMilestones(cuts).milestones,5);
 for(const mutation of [x=>x.pop(),x=>x.reverse(),x=>x[2].q=1,x=>x[3].javascript.cpu.eax=1,x=>x[3].javascript.ramPage[1]=1,x=>x[2].board.ram.writes[3].generation=9,x=>x[2].board.ram.writes[4].raw=0x7000,x=>x[3].board.generations[0][1]=4]){const x=copy(cuts);mutation(x);assert.throws(()=>validateMilestones(x));}
 assert.equal(cutName({cs:0,eip:0x7003,eax:1}),'AX1');assert.equal(cutName({cs:0,eip:0x7003,eax:2}),'AX2');assert.equal(cutName({cs:0,eip:0x7003,eax:3}),null);
});
test('reset model initialization is before first instruction only',()=>{
 const cpu={cycles:0,edx:0x300,cr0:0,cs:0xf000,eip:0xfff0,segmentCaches:[{}, {base:0xffff0000}],gdtr:{base:0,limit:0},idtr:{base:0,limit:0x3ff},_debugRegisters:Array(8).fill(0)};initializeRamReset(cpu);assert.equal(cpu.edx,0);assert.equal(cpu.cr0,0x7ffffff0);assert.equal(cpu._debugRegisters[6],0xffff1ff0);assert.throws(()=>initializeRamReset(cpu));const later=copy(cpu);later.cycles=1;assert.throws(()=>initializeRamReset(later));
});
test('closed input refuses old addon/revision, caller ROM, trace and malformed paths',()=>{
 const input={compiledRoot:'/tmp/compiled',compiledRevision,driverRevision:'a'.repeat(40),driverSourceSha256:'b'.repeat(64),addon:'/tmp/a.node',sha256:addonSha256,configuration:'/tmp/cfg',preparedManifest:'/tmp/m.json',preparedManifestSha256:'c'.repeat(64),buildReceipt:'/tmp/r.json',buildReceiptSha256:'d'.repeat(64),output:'/tmp/out',nativeTrace:false};validateInput(input);
 for(const mutation of [x=>x.sha256='e'.repeat(64),x=>x.compiledRevision='f'.repeat(40),x=>x.rom='/tmp/caller.bin',x=>x.nativeTrace=true,x=>x.output='/tmp/../out',x=>x.driverSourceSha256='invalid',x=>delete x.buildReceipt]){const x=copy(input);mutation(x);assert.throws(()=>validateInput(x));}
});
test('post-create/resume failure authentication checks input/config and retains primary error',()=>{
 const pins={input:'a',driver:{revision:'b'},compiled:{revision:'c'},build:{sha:'d'},configuration:{sha:'e'},node:'f'};
 const good={status:'PASS'};assert.equal(finalizeAuthentication(good,null,pins,copy(pins)),null);assert.equal(good.status,'PASS');
 for(const key of Object.keys(pins)){const after=copy(pins);after[key]='changed';const primary=Error('manufactured resume failure'),receipt={status:'FAIL',error:String(primary)};assert.equal(finalizeAuthentication(receipt,primary,pins,after),primary);assert.match(receipt.error,/resume failure/);assert.match(receipt.finalAuthenticationError,/final /);}
 const unavailable={status:'PASS'},readFailure=Error('manufactured configuration read failure');assert.equal(finalizeAuthentication(unavailable,null,pins,{},readFailure),readFailure);assert.equal(unavailable.status,'FAIL');assert.match(unavailable.finalAuthenticationError,/configuration read failure/);
});
