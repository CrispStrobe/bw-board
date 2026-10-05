import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {layout,entries,gate,selector,terminalEip,ramInstructions,ramProgram,romInstructions,bootStores,frameStores,adTransitions,fixedIntIretRom,intIretProfile,namedCuts,afterLgdt,afterLidt,afterCr3,afterPe,afterDs,afterSs,afterSp,afterPg,farJumpIp,lgdtIp,lidtIp,ssWriteIp,spWriteIp,expectedCr0,expectedShadow,expectedAx,physicalFetch,validateStore,validateAdTransition,expectedPages,wordAt,codeCache,dataCache,validateMilestone} from '../scripts/bochs-cpu3-native-paged-int-iret/profile.mjs';
import {createPagedIntIretOracle} from '../scripts/bochs-cpu3-native-paged-int-iret/reference.mjs';
test('fixed ROM owns LGDT/LIDT pointers, MOVSS shadow successor, gate and exact code bytes',()=>{
 const rom=fixedIntIretRom();assert.throws(()=>fixedIntIretRom({rom}));assert.equal(rom.length,65536);assert.equal(createHash('sha256').update(rom).digest('hex'),intIretProfile.romSha256);assert.deepEqual([...rom.subarray(0xfff0,0xfff5)],[0xea,0,1,0,0xf0]);let ip=0x100;
 for(const i of romInstructions){assert.equal(i.ip,ip);assert.deepEqual([...rom.subarray(ip,ip+i.bytes.length)],i.bytes);ip+=i.bytes.length;}assert.ok(ip<0x400);assert.deepEqual([...rom.subarray(0x400,0x40c)],[31,0,0,6,0,0,0x87,1,0,0x30,0,0]);
 assert.deepEqual(romInstructions.find(i=>i.ip===lgdtIp).bytes,[0x2e,0x0f,1,0x16,0,4]);assert.deepEqual(romInstructions.find(i=>i.ip===lidtIp).bytes,[0x2e,0x0f,1,0x1e,6,4]);assert.equal(afterSs,spWriteIp);assert.equal(afterPg,farJumpIp);assert.ok(ssWriteIp<spWriteIp);assert.ok(afterSp<afterPg);
 const p=expectedPages(bootStores);for(const i of ramInstructions)assert.deepEqual([...p.code.subarray(i.ip-0x7000,i.ip-0x7000+i.bytes.length)],i.bytes);assert.deepEqual([...p.code.subarray(0,ramProgram.length)],ramProgram);assert.equal(p.code[terminalEip-0x7000],0xf4);assert.deepEqual([...p.idt.subarray(0x180,0x188)],gate.bytes);assert.equal(gate.limit,0x30*8+7);
 for(const e of Object.values(entries))assert.equal(wordAt(e.raw<0x2000?p.directory:p.table,e.raw&4095),e.value);assert.notEqual(layout.stack,layout.aliasStack);assert.equal(layout.aliasStack,0xd000);assert.equal(layout.stack,0xc000);
});
test('nonidentity fetch rejects poisoned aliases and executed HLT sentinel',()=>{
 assert.equal(physicalFetch(0xf000,0xffff0000,0xfff0),0xfffffff0);assert.equal(physicalFetch(0xf000,0xf0000,farJumpIp),0xf0000+farJumpIp);for(const i of ramInstructions)assert.equal(physicalFetch(selector,0,i.ip),layout.code+i.ip-0x7000);
 for(const args of [[selector,0x7000,0x7000],[0x10,0,0x7000],[selector,0,terminalEip],[selector,0,0x7011],[0xf000,0xffff0000,farJumpIp],[selector,0,-1]])assert.throws(()=>physicalFetch(...args));
 assert.equal(expectedCr0(selector,handlerEipForTest()),0xfffffff1);assert.equal(expectedAx(selector,0x7013),0x8000beef);assert.deepEqual(expectedShadow(0xf000,afterSs),[1,1,0]);assert.deepEqual(expectedShadow(0xf000,afterSp),[0,0,0]);
});
function handlerEipForTest(){return 0x7010;}
test('exact boot and authentic six-byte frame owners reject every changed byte or address',()=>{
 const all=[...bootStores,...frameStores];for(const [i,e]of all.entries()){
  assert.equal(validateStore(i,e.raw,e.bytes,e.cs,e.ip),i+1);for(const patch of [[e.raw+1,e.bytes,e.cs,e.ip],[e.raw,e.bytes,e.cs,e.ip+1],[e.raw,e.bytes,e.cs^1,e.ip],[e.raw,e.bytes.map((v,k)=>k?v:v^1),e.cs,e.ip]])assert.throws(()=>validateStore(i,...patch));
 }assert.throws(()=>validateStore(all.length,0xcffa,[0,0],selector,0x7003));assert.deepEqual(frameStores.map(e=>[e.raw,e.bytes]),[[0xcffa,[5,0x70]],[0xcffc,[24,0]],[0xcffe,[2,0]]]);
});
test('JS-owned A/D transitions keep code and IDT clean, stack dirty, with exact instruction owners',()=>{
 for(const [i,e]of adTransitions.entries()){assert.equal(validateAdTransition(i,e.raw,e.before,e.after,e.cs,e.ip),e.kind);for(const a of [[i,e.raw+4,e.before,e.after,e.cs,e.ip],[i,e.raw,e.before^1,e.after,e.cs,e.ip],[i,e.raw,e.before,e.after^0x40,e.cs,e.ip],[i,e.raw,e.before,e.after,e.cs,e.ip+1],[i+1,e.raw,e.before,e.after,e.cs,e.ip]])assert.throws(()=>validateAdTransition(...a));}
 const p=expectedPages([...bootStores,...frameStores],adTransitions);assert.equal(wordAt(p.table,13*4),0xc063);assert.equal(wordAt(p.table,3*4),0x3023);assert.equal(wordAt(p.table,7*4),0xa023);assert.equal(wordAt(p.directory,0),0x2023);
});
const manufactured=()=>({cpu:{cs:selector,eip:terminalEip,cr0:0xfffffff1,cr4:0,cr3:0x1000,eflags:2,halted:false,ds:0x10,ss:0x10,eax:0x8000beef,esp:0xe000,gdtr:{base:0x600,limit:31},idtr:{base:0x3000,limit:0x187},segmentCaches:{1:structuredClone(codeCache),2:structuredClone(dataCache),3:structuredClone(dataCache)},interruptShadow:0,nmiShadow:0,debugShadow:0},stores:[...bootStores,...frameStores],updates:adTransitions,pages:expectedPages([...bootStores,...frameStores],adTransitions)});
test('manufactured terminal proof refuses wrong full EAX, frame, gate, cache, shadow and any page byte',()=>{
 const s=manufactured();assert.equal(validateMilestone('returned-from-IRET-before-HLT',s),'returned-from-IRET-before-HLT');for(const patch of [{eax:0xbeef},{esp:0xdffa},{eflags:0x202},{ss:0},{cr3:0},{cr4:16},{interruptShadow:1},{idtr:{base:0x3000,limit:0x186}}])assert.throws(()=>validateMilestone('returned-from-IRET-before-HLT',{...s,cpu:{...s.cpu,...patch}}));
 for(const key of Object.keys(layout)){const bad=structuredClone(s);bad.pages[key][4095]^=1;assert.throws(()=>validateMilestone('returned-from-IRET-before-HLT',bad));}
 for(const k of [1,2,3]){const bad=structuredClone(s);bad.cpu.segmentCaches[k].default32=true;assert.throws(()=>validateMilestone('returned-from-IRET-before-HLT',bad));}const missing=structuredClone(s);missing.stores.pop();missing.pages=expectedPages(missing.stores,missing.updates);assert.throws(()=>validateMilestone('returned-from-IRET-before-HLT',missing));
 const early={...s,cpu:{...s.cpu,cs:0xf000,eip:afterSs,cr0:0x7ffffff1,eax:0x10,segmentCaches:{...s.cpu.segmentCaches,1:{base:0xf0000}},interruptShadow:1,nmiShadow:1},stores:bootStores,updates:[],pages:expectedPages(bootStores)};assert.equal(validateMilestone('SS-loaded',early),'SS-loaded');assert.throws(()=>validateMilestone('SS-loaded',{...early,cpu:{...early.cpu,nmiShadow:0}}));assert.throws(()=>validateMilestone('unknown',s));
});
test('private factory/reset/stage exposes only detached state and refuses caller inputs/early settle',async()=>{
 await assert.rejects(createPagedIntIretOracle({gate}));const o=await createPagedIntIretOracle();try{const s=o.checkpoint();assert.equal(s.q,0);assert.equal(o.milestone(),'reset');assert.equal(s.cpu.cr0,0x7ffffff0);assert.deepEqual(o.stage(),{asserted:false,changed:false});assert.deepEqual(o.checkpoint(),s);s.pages.stack[0]=255;assert.equal(o.checkpoint().pages.stack[0],0);assert.throws(()=>o.settle());}finally{o.close();}assert.throws(()=>o.step());
});
test('bounded actual private JS INT30/IRET run retains genuine frame, shadows, all ten pages and read order',async()=>{
 const o=await createPagedIntIretOracle();try{const frames=[],cuts=[];for(let i=0;i<intIretProfile.maxQuanta+1;i++){const s=o.checkpoint();frames.push(s);const name=o.milestone();if(name)cuts.push({name,q:s.q});if(name==='returned-from-IRET-before-HLT')break;o.stage();o.step();}
  const end=o.checkpoint();assert.equal(end.q,1+romInstructions.length+ramInstructions.length);assert.equal(frames.length,end.q+1);assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));assert.equal(end.stores.length,bootStores.length+3);assert.equal(end.updates.length,7);assert.equal(end.deliveries.length,1);assert.deepEqual(end.deliveries[0],{q:cuts.find(c=>c.name==='entered-handler').q,vector:0x30,returnEip:0x7005,errorCode:null,software:true,cs:selector,eip:0x7010,esp:0xdffa,eflags:2});
  assert.equal(end.cpu.eax,0x8000beef);assert.equal(end.cpu.esp,0xe000);assert.throws(()=>o.step());const ss=frames.find(s=>s.cpu.cs===0xf000&&s.cpu.eip===afterSs);assert.deepEqual([ss.cpu.interruptShadow,ss.cpu.nmiShadow,ss.cpu.debugShadow],[1,1,0]);const sp=frames.find(s=>s.cpu.cs===0xf000&&s.cpu.eip===afterSp);assert.deepEqual([sp.cpu.interruptShadow,sp.cpu.nmiShadow,sp.cpu.debugShadow],[0,0,0]);
  const settled=o.settle();assert.equal(settled.board.debt,0);assert.deepEqual(settled.cpu,end.cpu);assert.deepEqual([...settled.pages.stack.subarray(0xffa)],[5,0x70,24,0,2,0]);const reads=settled.accesses.filter(a=>a.cs===selector&&a.eip===0x7013&&a.raw>=0xcffa&&a.raw<0xd000);assert.deepEqual(reads.map(a=>[a.raw,a.value]),[[0xcffa,5],[0xcffb,0x70],[0xcffc,24],[0xcffd,0],[0xcffe,2],[0xcfff,0]]);
  for(const page of [layout.aliasCode,layout.aliasData,layout.aliasStack])assert.equal(settled.accesses.some(a=>a.cs===selector&&a.raw>=page&&a.raw<page+4096),false);
  if(process.env.BW_PAGED_INT_IRET_CONTROL_OUTPUT)writeFileSync(process.env.BW_PAGED_INT_IRET_CONTROL_OUTPUT,JSON.stringify({schema:'bw.paged-int-iret.js-source-control.v1',scope:'Private Bochs-model JS only; no native INT/IRET admission',romSha256:intIretProfile.romSha256,frames,cuts,settled},(_,v)=>v instanceof Uint8Array?[...v]:v)+'\n',{flag:'wx'});
  console.log(JSON.stringify({scope:'tiny actual private JS INT/IRET control only',q:end.q,cuts,stores:end.stores.length,updates:end.updates.length,ramSha256:settled.ramSha256}));
 }finally{o.close();}
});
