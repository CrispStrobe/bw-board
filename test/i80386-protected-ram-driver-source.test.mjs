/** Manufactured diagnostic fixtures only: no machine construction or CPU/addon. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {sha} from '../scripts/bochs-cpu3-native-protected-ram/driver-auth.mjs';
import {deriveDriverProvider,profileProviderSha256} from '../scripts/bochs-cpu3-native-protected-ram/driver-provider.mjs';
import {deriveProtectedRamProvider} from '../scripts/bochs-cpu3-native-protected-ram/provider-derivation.mjs';
import {deriveProtectedComparison,comparisonParentSha256} from '../scripts/bochs-cpu3-native-protected-ram/cpu-comparison.mjs';
import {compareBoundary,protectedProgress,validateMilestones,wholeNativeWords} from '../scripts/bochs-cpu3-native-protected-ram/parity.mjs';
import {validateInput,finalizeAuthentication} from '../scripts/bochs-cpu3-native-protected-ram/runner.mjs';
import {compiledRevision,relativeImports,ownedBuildBinding,requireReadyBuild,validateBuildBinding} from '../scripts/bochs-cpu3-native-protected-ram/driver-auth.mjs';
import {namedCuts,expectedRamPage,expectedGdtPage,stores} from '../scripts/bochs-cpu3-native-protected-ram/profile.mjs';
const copy=x=>structuredClone(x);
function fixture(){
 const j={eax:0x1234,ecx:0,edx:0,ebx:0,esp:0,ebp:0,esi:0,edi:0,eip:0x7003,eflags:2,cr0:0x7ffffff1,cr2:0,cr3:0,cr4:0,cs:0x18,ds:0,ss:0,es:0,fs:0,gs:0,pc:0x7003,gdtr:{base:0x600,limit:0x1f},idtr:{base:0,limit:0xffff},ldtr:{selector:0,base:0,limit:0xffff,present:true,type:2},tr:{selector:0,base:0,limit:0xffff,present:true,type:11},segmentCaches:Array.from({length:6},()=>({base:0,limit:0xffff,default32:false,present:true})),debugRegisters:[0,0,0,0,0,0,0xffff1ff0,0x400],halted:false,shutdown:false,interruptShadow:0,nmiShadow:0,debugShadow:0};
 const n={state:['eax','ecx','edx','ebx','esp','ebp','esi','edi','eip','eflags','cr0','cr2','cr3','cs','ds','ss'].map(k=>j[k]).concat(0x600,0x1f,0,0xffff),extra:Array(20).fill(0),segments:Array(90).fill(0),system:Array(30).fill(0),debug:[0,0,0,0,0xffff1ff0,0x400],nativeTicks:1,successfulQuanta:1,mappingEpoch:0,boardA20:1,activityState:0,chargedNativeTicks:1,chargedQuanta:1,reason:1,execution:{attempts:1,completed:1,repIterations:0,repPartial:0,faults:0,portCommits:0,irqDeliveries:0,haltIdleCuts:0},fallback:{bochsRamReads:0,bochsRamWrites:0,bochsDirectPointers:0,bochsPio:0,bochsTimer:0}};
 n.extra[0]=j.debugRegisters[6];n.extra[1]=j.debugRegisters[7];n.extra[9]=1;n.extra[14]=0xffff;
 for(let i=0;i<6;i++){n.segments[i*15]=i;n.segments[i*15+6]=1;n.segments[i*15+11]=0xffff;}
 for(let i=0;i<2;i++){n.system[i*15]=i+6;n.system[i*15+6]=1;n.system[i*15+9]=i?11:2;n.system[i*15+11]=0xffff;}
 j.segmentCaches[1]={base:0,limit:0xffff,default32:false,code:true,readable:true,writable:false,access:0x9b,address:0x618,dpl:0,conforming:false,present:true};n.segments.splice(15,15,1,24,3,0,0,1,1,0,1,11,0,65535,0,0,0);n.extra[5]=3;
 const page=expectedRamPage(),board={board:{cycles:10,debt:6,deadline:6000,a20Enabled:true},successfulQuanta:1,mappingEpoch:0,generations:[[0,2],[0x7000,2]],ram:{bootStores:4,admitted:true,writes:stores.map((w,i)=>({raw:w.raw,bytes:[...w.bytes],generation:i%2+1}))}};
 return {n,board,js:{q:1,cpu:j,board:copy(board.board),ramPage:Uint8Array.from(page),gdtPage:expectedGdtPage(),stores:stores.map(w=>({raw:w.raw,bytes:[...w.bytes]}))},pages:{code:page,gdt:expectedGdtPage()}};
}
test('paused two-page adapter and strict CR0 comparison scope have exact inverses',()=>{
 const p=deriveDriverProvider(deriveProtectedRamProvider().bytes);assert.equal(p.parentSha256,profileProviderSha256);assert.ok(p.bytes.includes('ramPages()'));assert.ok(p.bytes.includes('gdt:Uint8Array.from'));assert.throws(()=>deriveDriverProvider(Buffer.from('unknown')));
 const parent=readFileSync(new URL('../scripts/bochs-cpu3-native-cold-bios/parity.mjs',import.meta.url)),c=deriveProtectedComparison(parent);assert.equal(c.baseSha256,comparisonParentSha256);assert.ok(c.bytes.includes('fixed protected oracle CR0 phase'));assert.throws(()=>deriveProtectedComparison(Buffer.from('unknown')));
 const actual=readFileSync(new URL('../src/i8086-machine.js',import.meta.url));assert.ok(relativeImports(actual).includes('./machine-checkpoint.js'));assert.deepEqual(relativeImports(Buffer.from(`const q="import {x} from './foreign.js'";\nexport {\n x\n} from './actual.js';`)),['./actual.js']);
});
test('manufactured represented CPU/board/both pages stay strict across PE',()=>{
 const f=fixture();compareBoundary(f.n,f.board,f.js,f.pages);assert.equal(wholeNativeWords(f.n).length,166);
 for(const change of [x=>x.n.state[0]=2,x=>x.n.state[10]=0x7ffffff0,x=>x.n.state[9]=0x802,x=>x.n.segments[55]=1,x=>x.n.system[11]=0,x=>x.n.debug[0]=1,x=>x.n.mappingEpoch=1,x=>x.n.boardA20=0,x=>x.board.board.debt=0,x=>x.pages.code[3000]=1,x=>x.pages.gdt[4095]=1,x=>x.js.stores[0].raw=0x61c,x=>x.js.cpu.cr4=1]){const x=copy(f);change(x);assert.throws(()=>compareBoundary(x.n,x.board,x.js,x.pages));}
 const x=copy(f);x.js.cpu.cs=0xf000;x.js.cpu.eip=0x130;x.n.state[13]=0xf000;x.n.state[8]=0x130;assert.throws(()=>compareBoundary(x.n,x.board,x.js,x.pages));
});
test('independent progress refuses caps/fallback/IRQ/REP/HLT/missing fields',()=>{
 const f=fixture();assert.deepEqual(protectedProgress({n:0,q:0},f.n),{n:1,q:1,dn:1,dq:1});
 for(const change of [n=>n.nativeTicks=513,n=>n.successfulQuanta=513,n=>n.chargedQuanta=0,n=>n.activityState=1,n=>n.reason=4,n=>n.fallback={},n=>n.fallback.bochsRamWrites=1,n=>n.execution.irqDeliveries=1,n=>n.execution.repIterations=1,n=>delete n.execution.portCommits]){const n=copy(f.n);change(n);assert.throws(()=>protectedProgress({n:0,q:0},n));}
 const zero=copy(f.n);Object.assign(zero,{chargedNativeTicks:0,chargedQuanta:0,reason:7});assert.equal(protectedProgress({n:1,q:1},zero).dq,0);
});
function manufacturedCuts(){return namedCuts.map((c,i)=>{const f=fixture();f.js.q=i;Object.assign(f.js.cpu,{cs:c.cs,eip:c.eip,cr0:c.cr0,eax:c.ax??0});if(i===0){f.js.cpu.gdtr={base:0,limit:0xffff};f.js.gdtPage=new Uint8Array(4096);f.js.ramPage=new Uint8Array(4096);f.pages.gdt=new Uint8Array(4096);f.pages.code=new Uint8Array(4096);}return {name:c.name,q:i,native:f.n,board:f.board,javascript:f.js,pages:f.pages};});}
test('manufactured milestone proof requires GDT/code pages, protected cache, stores/generations',()=>{
 const f=manufacturedCuts();assert.equal(validateMilestones(f).milestones,5);
 for(const change of [x=>x.pop(),x=>x.reverse(),x=>x[2].q=1,x=>x[2].javascript.cpu.cr0=0x7ffffff0,x=>x[4].javascript.cpu.eax=2,x=>x[3].javascript.cpu.segmentCaches[1].access=0x99,x=>x[1].pages.gdt[0x61d]=0x99,x=>x[1].javascript.gdtPage[4000]=1,x=>x[4].pages.code[0]=0,x=>x[2].board.ram.writes[3].generation=3,x=>x[3].board.generations[1][1]=4,x=>x[3].native.segments[24]=9]){const x=copy(f);change(x);assert.throws(()=>validateMilestones(x));}
});
test('owned audited build authority and manufactured pending/old addon refusals stay closed',()=>{
 const b=ownedBuildBinding();assert.equal(b.compiledRevision,compiledRevision);assert.deepEqual(requireReadyBuild(),b);assert.equal(b.addonSha256,'98c7d11961463ae8a4dfbd108cf94d1e745f09f5d7684afa3bc31792cdac203e');assert.equal(b.buildRun,37149215092);assert.equal(b.artifactId,11283630476);assert.throws(()=>validateInput({}));
 const pending={...copy(b),status:'PENDING_PROTECTED_NATIVE_BUILD',addonSha256:null,buildRun:null,artifactId:null};validateBuildBinding(pending);assert.throws(()=>validateBuildBinding({...pending,addonSha256:b.addonSha256}));
 for(const change of [x=>x.compiledRevision='f'.repeat(40),x=>x.compiledSourceSha256='0'.repeat(64),x=>delete x.compiledFiles['package.json'],x=>x.compiledFiles['package.json']='0'.repeat(64),x=>x.status='READY',x=>x.addonSha256=null]){const x=copy(b);change(x);assert.throws(()=>validateBuildBinding(x));}
 const ready=copy(b);validateBuildBinding(ready);for(const h of ['9475b94b4dd067bc6c25ccd7c61c60cef5c9696fba0725ed05913838a3ee9873','40179a4f0bc2456e59bc2ea49303e17e29be72ef564adb1fe1a6879abb015ab0'])assert.throws(()=>validateBuildBinding({...ready,addonSha256:h}));
});
test('final input/config/tool authentication preserves primary failure and separately refuses mutation',()=>{
 const pins={input:'a',driver:{revision:'b'},compiled:{revision:'c'},build:{sha:'d'},configuration:{sha:'e'},node:'f'},good={status:'PASS'};assert.equal(finalizeAuthentication(good,null,pins,copy(pins)),null);
 for(const k of Object.keys(pins)){const after=copy(pins);after[k]='changed';const primary=Error('manufactured first divergence'),r={status:'FAIL',error:String(primary)};assert.equal(finalizeAuthentication(r,primary,pins,after),primary);assert.match(r.error,/first divergence/);assert.match(r.finalAuthenticationError,/final /);}
 const r={status:'PASS'},missing=Error('manufactured config read failure');assert.equal(finalizeAuthentication(r,null,pins,{},missing),missing);assert.equal(r.status,'FAIL');
});
test('driver source identity authenticates clean HEAD and includes owned build asset in owned alternate fixture',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),revision=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),paths=new Set();
 const seeds=['scripts/bochs-cpu3-native-protected-ram/runner.mjs','scripts/bochs-cpu3-native-protected-ram/DRIVER-SOURCE.md','scripts/bochs-cpu3-native-protected-ram/driver-build-binding.json','scripts/bochs-cpu3-native-cold-bios/board-provider.mjs','test/i80386-protected-ram-driver-source.test.mjs','package.json','roms/free-at-bios/LICENSE','roms/free-at-bios/BIOS-bochs-legacy','roms/free-at-bios/vgabios-lgpl.bin'];
 function visit(p){if(paths.has(p))return;paths.add(p);const b=readFileSync(resolve(root,p)),g=execFileSync('git',['show',revision+':'+p],{cwd:root,maxBuffer:16<<20});assert.equal(sha(b),sha(g));if(/\.(js|mjs)$/.test(p))for(const q of relativeImports(b))visit(resolve(root,dirname(p),q).slice(root.length));}for(const p of seeds)visit(p);
 const d=mkdtempSync(join(tmpdir(),'protected-driver-clean-')),clean=join(d,'source');try{mkdirSync(clean);execFileSync('git',['init','--quiet',clean]);const objects=execFileSync('git',['rev-parse','--path-format=absolute','--git-path','objects'],{cwd:root,encoding:'utf8'}).trim();writeFileSync(join(clean,'.git/objects/info/alternates'),objects+'\n');const shallow=execFileSync('git',['rev-parse','--path-format=absolute','--git-path','shallow'],{cwd:root,encoding:'utf8'}).trim();try{writeFileSync(join(clean,'.git/shallow'),readFileSync(shallow));}catch(e){if(e.code!=='ENOENT')throw e;}execFileSync('git',['update-ref','HEAD',revision],{cwd:clean});execFileSync('git',['sparse-checkout','init','--no-cone'],{cwd:clean});execFileSync('git',['sparse-checkout','set','--no-cone','--stdin'],{cwd:clean,input:[...paths].sort().map(p=>'/'+p).join('\n')+'\n'});execFileSync('git',['checkout','--quiet','--detach',revision],{cwd:clean});const raw=execFileSync(process.execPath,['--max-old-space-size=128','--input-type=module','-e',"import {driverSourceIdentity,ownedBuildBinding} from './scripts/bochs-cpu3-native-protected-ram/driver-auth.mjs';console.log(JSON.stringify({source:driverSourceIdentity(),pending:ownedBuildBinding().status}))"],{cwd:clean,encoding:'utf8',timeout:10000,maxBuffer:2<<20});const v=JSON.parse(raw);assert.equal(v.source.revision,revision);assert.deepEqual(Object.keys(v.source.hashes).sort(),[...paths].sort());assert.ok(v.source.hashes['scripts/bochs-cpu3-native-protected-ram/driver-build-binding.json']);assert.equal(v.pending,ownedBuildBinding().status);}finally{rmSync(d,{recursive:true,force:true});}
});
