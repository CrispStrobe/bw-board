import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {fixedProtectedStackRom,protectedStackProfile,romInstructions,ramInstructions,ramProgram,terminalEip,bootStores,stackStores,stores,expectedPages,codeDescriptor,dataDescriptor,expectedCache,namedCuts,validateStore,fetchDomain,validateMilestone,afterLgdt,cr0WriteIp,farJumpIp} from '../scripts/bochs-cpu3-native-protected-stack/profile.mjs';
import {createProtectedStackOracle} from '../scripts/bochs-cpu3-native-protected-stack/reference.mjs';
test('fixed ROM encodes nonoverlapping boot stores and the exact code16 call/return program',()=>{
 const rom=fixedProtectedStackRom();assert.equal(rom.length,65536);assert.throws(()=>fixedProtectedStackRom({rom}));assert.deepEqual([...rom.subarray(0xfff0,0xfff5)],[0xea,0,1,0,0xf0]);
 let next=0x100;for(const i of romInstructions){assert.equal(i.ip,next);assert.deepEqual([...rom.subarray(i.ip,i.ip+i.bytes.length)],i.bytes);next+=i.bytes.length;}assert.ok(next<0x180);
 assert.deepEqual([...rom.subarray(0x180,0x186)],[0x1f,0,0,6,0,0]);assert.equal(afterLgdt,0x16c);assert.equal(cr0WriteIp,0x172);assert.equal(farJumpIp,0x175);
 assert.deepEqual(ramProgram,[0xb8,0x10,0,0x8e,0xd8,0x8e,0xd0,0xbc,0,0x90,0xb8,0x34,0x12,0x50,0x5b,0xe8,4,0,0xb9,0x78,0x56,0xf4,0xb8,0xcd,0xab,0xc3]);
 assert.equal(0x700f+3+ramProgram[16],0x7016);assert.deepEqual(stackStores.map(s=>s.bytes),[[0x34,0x12],[0x12,0x70]]);assert.equal(terminalEip,0x7015);assert.equal(ramInstructions.some(i=>i.ip===terminalEip),false);assert.equal(createHash('sha256').update(rom).digest('hex'),protectedStackProfile.romSha256);
});
test('accessed data/code descriptors and three copied complete pages have exact ownership',()=>{
 assert.deepEqual(codeDescriptor,[255,255,0,0,0,0x9b,0,0]);assert.deepEqual(dataDescriptor,[255,255,0,0,0,0x93,0,0]);const p=expectedPages();assert.equal(Object.values(p).every(p=>p.length===4096),true);assert.deepEqual([...p.gdt.subarray(0x610,0x618)],dataDescriptor);assert.deepEqual([...p.gdt.subarray(0x618,0x620)],codeDescriptor);assert.deepEqual([...p.stack.subarray(4094)],[0x12,0x70]);assert.equal(p.code.subarray(26).some(v=>v),false);p.gdt[0x610]=0;assert.equal(expectedPages().gdt[0x610],255);assert.throws(()=>expectedCache(8));
});
test('fetch domain rejects unowned stack code, paging, wrong mode and terminal HLT',()=>{
 const v={selector:0x18,base:0,eip:0x700f,length:3,pe:1,cs32:0,interrupts:0,paging:0,mappingPending:0,a20:1};assert.equal(fetchDomain(v),true);
 for(const [key,value]of [['selector',0x10],['base',0xf0000],['eip',terminalEip],['length',2],['pe',0],['cs32',1],['interrupts',1],['paging',1],['mappingPending',1],['a20',0]])assert.equal(fetchDomain({...v,[key]:value}),false,key);
 for(const i of ramInstructions)assert.equal(fetchDomain({...v,eip:i.ip,length:i.bytes.length}),true);assert.throws(()=>fetchDomain({...v,length:-1}));
 const far={...v,selector:0xf000,base:0xf0000,eip:farJumpIp,length:5};assert.equal(fetchDomain(far),true);assert.equal(fetchDomain({...far,pe:0}),false);
});
test('ordered ROM and stack stores refuse wrong value, phase, address and extra effect',()=>{
 assert.equal(bootStores.length,11);assert.equal(stores.length,13);
 for(const [k,s]of stores.entries()){assert.equal(validateStore(s.raw,Uint8Array.from(s.bytes),k,s.cs,s.ip),k+1);for(const args of [[s.raw+1,Uint8Array.from(s.bytes),k,s.cs,s.ip],[s.raw,Uint8Array.from(s.bytes),k,s.cs,s.ip+1],[s.raw,Uint8Array.from(s.bytes),k,s.cs^1,s.ip],[s.raw,Uint8Array.from(s.bytes.map((b,i)=>i?b:b^1)),k,s.cs,s.ip]])assert.throws(()=>validateStore(...args));}
 assert.throws(()=>validateStore(0x8ffe,Uint8Array.of(0x34,0x12),11,0x18,0x700f));assert.throws(()=>validateStore(0x8ffe,Uint8Array.of(0,0),13,0x18,0x7019));
});
const manufactured=()=>({cpu:{cs:0x18,eip:0x7015,cr0:0x7ffffff1,eflags:2,halted:false,eax:0xabcd,ebx:0x1234,ecx:0x5678,esp:0x9000,ds:0x10,ss:0x10,gdtr:{base:0x600,limit:0x1f},interruptShadow:0,nmiShadow:0,debugShadow:0,segmentCaches:{1:expectedCache(0x18),2:expectedCache(0x10),3:expectedCache(0x10)}},pages:expectedPages()});
test('manufactured terminal proof refuses wrong caches, shadows, stack bytes and witnesses',()=>{
 const s=manufactured();assert.equal(validateMilestone('before-HLT',s),'before-HLT');for(const change of [{cr0:0x7ffffff0},{cr0:0xfffffff1},{ds:0},{ss:0},{esp:0x8ffe},{eax:1},{ebx:0},{ecx:0},{eflags:0x202},{interruptShadow:1}])assert.throws(()=>validateMilestone('before-HLT',{...s,cpu:{...s.cpu,...change}}));
 for(const key of ['gdt','code','stack']){const bad=structuredClone(s);bad.pages[key][4095]^=1;assert.throws(()=>validateMilestone('before-HLT',bad));}for(const key of [1,2,3]){const bad=structuredClone(s);bad.cpu.segmentCaches[key].default32=true;assert.throws(()=>validateMilestone('before-HLT',bad));}assert.throws(()=>validateMilestone('unknown',s));
 const ss=manufactured();ss.cpu.eip=0x7007;ss.cpu.interruptShadow=ss.cpu.nmiShadow=1;ss.pages=expectedPages(bootStores);assert.equal(validateMilestone('after-SS-load',ss),'after-SS-load');ss.cpu.nmiShadow=0;assert.throws(()=>validateMilestone('after-SS-load',ss));
});
test('private no-argument oracle reset/stage copies cannot expose mutable backing or execute caller input',async()=>{
 await assert.rejects(createProtectedStackOracle({hooks:{}}));const o=await createProtectedStackOracle();try{const reset=o.checkpoint();assert.equal(reset.q,0);assert.equal(reset.cpu.cr0,0x7ffffff0);assert.equal(reset.cpu.edx,0);assert.equal(o.milestone(),'reset');assert.deepEqual(o.stage(),{asserted:false,changed:false});assert.deepEqual(o.checkpoint(),reset);reset.pages.stack[4095]=1;assert.equal(o.checkpoint().pages.stack[4095],0);assert.throws(()=>o.settle());}finally{o.close();}assert.throws(()=>o.checkpoint());
});
test('tiny fixed JS oracle proves actual DS/SS shadows PUSH/POP CALL/RET and exact full-page effects',async()=>{
 const o=await createProtectedStackOracle();try{const frames=[],cuts=[];for(let i=0;i<64;i++){const s=o.checkpoint();frames.push(s);const name=o.milestone();if(name)cuts.push({name,q:s.q});if(name==='before-HLT')break;o.stage();o.step();}
  const end=o.checkpoint();assert.equal(end.q,30);assert.equal(frames.length,31);assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));assert.deepEqual(cuts.map(c=>c.q),[0,16,18,19,21,22,23,25,26,27,28,29,30]);assert.deepEqual(end.stores.map(s=>[s.cs,s.ip,s.raw,s.bytes]),stores.map(s=>[s.cs,s.ip,s.raw,s.bytes]));assert.deepEqual(end.stores.map(s=>s.q),[5,6,7,8,9,10,11,12,13,14,15,25,27]);assert.deepEqual(end.pages,expectedPages());
  assert.deepEqual([end.cpu.eax&65535,end.cpu.ebx&65535,end.cpu.ecx&65535,end.cpu.esp&65535],[0xabcd,0x1234,0x5678,0x9000]);assert.throws(()=>o.step());const settled=o.settle();assert.equal(settled.board.debt,0);assert.deepEqual(settled.cpu,end.cpu);assert.match(settled.ramSha256,/^[0-9a-f]{64}$/);
  if(process.env.BW_PROTECTED_STACK_CONTROL_OUTPUT)writeFileSync(process.env.BW_PROTECTED_STACK_CONTROL_OUTPUT,JSON.stringify({schema:'bw.protected-stack.js-source-control.v1',scope:'Fixed Bochs-model JS source control; no native build, admission or execution',romSha256:protectedStackProfile.romSha256,frames,cuts,settled},(_,v)=>v instanceof Uint8Array?[...v]:v,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({scope:'tiny actual JS source control only',q:end.q,cuts,stores:end.stores.length,ramSha256:settled.ramSha256}));
 }finally{o.close();}
});
