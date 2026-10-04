import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import {layout,entries,dword,wordAt,selector,dataSelector,terminalEip,ramInstructions,ramProgram,romInstructions,bootStores,dataStore,adTransitions,fixedPagingRom,pagingProfile,namedCuts,afterLgdt,afterCr3,afterPe,afterDs,afterPg,farJumpIp,pgWriteIp,expectedCr0,physicalFetch,validateBootStore,validateAdTransition,expectedPages,codeCache,dataCache,validateMilestone} from '../scripts/bochs-cpu3-native-nonidentity-paging/profile.mjs';
import {createNonidentityPagingOracle} from '../scripts/bochs-cpu3-native-nonidentity-paging/reference.mjs';
test('fixed ROM enables PG in identity ROM and encodes different physical code/data pages',()=>{
 const rom=fixedPagingRom();assert.throws(()=>fixedPagingRom({rom}));assert.equal(rom.length,65536);assert.deepEqual([...rom.subarray(0xfff0,0xfff5)],[0xea,0,1,0,0xf0]);let ip=0x100;
 for(const i of romInstructions){assert.equal(i.ip,ip);assert.deepEqual([...rom.subarray(ip,ip+i.bytes.length)],i.bytes);ip+=i.bytes.length;}assert.ok(ip<0x400);assert.deepEqual([...rom.subarray(0x400,0x406)],[31,0,0,6,0,0]);assert.ok(pgWriteIp<farJumpIp);assert.equal(afterPg,farJumpIp);
 assert.equal(bootStores.length,16);assert.equal(ramProgram.length,16);assert.equal(createHash('sha256').update(rom).digest('hex'),pagingProfile.romSha256);assert.notEqual(layout.code,layout.aliasCode);assert.notEqual(layout.data,layout.aliasData);
 const pages=expectedPages(bootStores);for(const entry of Object.values(entries)){const key=entry.raw<0x2000?'directory':'table';assert.equal(wordAt(pages[key],entry.raw&4095),entry.value);assert.equal(entry.value&0xfc,0,'present writable supervisor, no A/D/PSE');}assert.deepEqual([...pages.code.subarray(0,16)],ramProgram);
});
test('nonidentity fetch and full-page ownership reject wrong aliases, selectors and side effects',()=>{
 assert.equal(physicalFetch(0xf000,0xffff0000,0xfff0),0xfffffff0);assert.equal(physicalFetch(0xf000,0xf0000,farJumpIp),0xf0000+farJumpIp);for(const i of ramInstructions)assert.equal(physicalFetch(selector,0,i.ip),layout.code+i.ip-0x7000);
 for(const args of [[selector,0x7000,0x7000],[dataSelector,0,0x7000],[selector,0,terminalEip],[0xf000,0xffff0000,farJumpIp],[selector,0,-1]])assert.throws(()=>physicalFetch(...args));
 const p=expectedPages(bootStores);p.code[4095]=1;assert.equal(expectedPages(bootStores).code[4095],0);assert.deepEqual([...p.aliasCode.subarray(0,4)],[0xf4,0xcc,0xcc,0xcc]);assert.deepEqual([...p.aliasData.subarray(0,4)],[0xad,0xde,0xef,0xbe]);
});
test('owned boot stores deny phase/address/value changes and unowned physical writes',()=>{
 for(const [index,e]of bootStores.entries()){
  assert.equal(validateBootStore(e.raw,Uint8Array.from(e.bytes),index,e.cs,e.ip),index+1);
  for(const change of [[e.raw+1,e.bytes,index,e.cs,e.ip],[e.raw,e.bytes,index,e.cs,e.ip+1],[e.raw,e.bytes,index,e.cs^1,e.ip],[e.raw,e.bytes.map((b,k)=>k?b:b^1),index,e.cs,e.ip]])assert.throws(()=>validateBootStore(...change));
 }
 assert.throws(()=>validateBootStore(0xb000,Uint8Array.of(0,0,0,0),16,selector,0x7005));
});
test('six source-owned A/D updates reject dirty code, wrong old values, order and owners',()=>{
 for(const [index,e]of adTransitions.entries()){
  assert.equal(validateAdTransition(index,e.raw,e.before,e.after,e.cs,e.ip),e.kind);
  for(const change of [[index,e.raw+4,e.before,e.after,e.cs,e.ip],[index,e.raw,e.before^1,e.after,e.cs,e.ip],[index,e.raw,e.before,e.after^0x40,e.cs,e.ip],[index,e.raw,e.before,e.after,e.cs,e.ip+1],[index+1,e.raw,e.before,e.after,e.cs,e.ip]])assert.throws(()=>validateAdTransition(...change));
 }
 const p=expectedPages([...bootStores,dataStore],adTransitions);assert.equal(wordAt(p.table,7*4),0xa023);assert.equal(wordAt(p.table,9*4),0xb063);assert.equal(wordAt(p.directory,0),0x2023);assert.equal(wordAt(p.table,7*4)&0x40,0);
});
const manufactured=()=>({cpu:{cs:selector,eip:terminalEip,cr0:0xfffffff1,cr4:0,cr3:layout.directory,eflags:2,halted:false,ds:dataSelector,ebx:0x1234,edx:0x5678,gdtr:{base:0x600,limit:31},segmentCaches:{1:structuredClone(codeCache),3:structuredClone(dataCache)},interruptShadow:0,nmiShadow:0,debugShadow:0},stores:[...bootStores,dataStore],updates:adTransitions,pages:expectedPages([...bootStores,dataStore],adTransitions)});
test('manufactured terminal paging proof refuses missing A/D, stale alias changes and bad caches',()=>{
 const s=manufactured();assert.equal(validateMilestone('before-HLT',s),'before-HLT');for(const patch of [{cr0:0x7ffffff1},{cr4:0x10},{cr3:0},{ebx:0xdead},{edx:0},{eflags:0x202},{ds:0},{interruptShadow:1}])assert.throws(()=>validateMilestone('before-HLT',{...s,cpu:{...s.cpu,...patch}}));
 for(const key of Object.keys(layout)){const bad=structuredClone(s);bad.pages[key][4095]^=1;assert.throws(()=>validateMilestone('before-HLT',bad));}const bad=structuredClone(s);bad.updates[5].after=0xb023;bad.pages=expectedPages(bad.stores,bad.updates);assert.throws(()=>validateMilestone('before-HLT',bad));
 const cache=structuredClone(s);cache.cpu.segmentCaches[1].default32=true;assert.throws(()=>validateMilestone('before-HLT',cache));assert.throws(()=>validateMilestone('unknown',s));
});
test('private no-argument reset/stage exposes detached copies and refuses early settlement',async()=>{
 await assert.rejects(createNonidentityPagingOracle({tables:{}}));const o=await createNonidentityPagingOracle();try{const s=o.checkpoint();assert.equal(s.q,0);assert.equal(o.milestone(),'reset');assert.equal(s.cpu.cr0,0x7ffffff0);assert.equal(s.cpu.segmentCaches[1].base>>>0,0xffff0000);assert.deepEqual(o.stage(),{asserted:false,changed:false});assert.deepEqual(o.checkpoint(),s);s.pages.table[1]=255;assert.equal(o.checkpoint().pages.table[1],0);assert.throws(()=>o.settle());}finally{o.close();}assert.throws(()=>o.step());
});
test('tiny fixed JS execution proves separate nonidentity fetch/read/write and exact A/D effects',async()=>{
 const o=await createNonidentityPagingOracle();try{const frames=[],cuts=[];for(let i=0;i<96;i++){const s=o.checkpoint();frames.push(s);const name=o.milestone();if(name)cuts.push({name,q:s.q});if(name==='before-HLT')break;o.stage();o.step();}
  const end=o.checkpoint();assert.equal(end.q,34);assert.equal(frames.length,35);assert.deepEqual(cuts.map(c=>c.name),namedCuts.map(c=>c.name));assert.deepEqual(cuts.map(c=>c.q),[0,21,23,25,27,29,30,31,32,33,34]);assert.equal(end.stores.length,17);assert.equal(end.updates.length,6);assert.equal(end.cpu.cr3,0x1000);assert.equal(end.cpu.cr0,0xfffffff1);assert.equal(end.cpu.cr4,0);assert.equal(end.cpu.ebx&65535,0x1234);assert.equal(end.cpu.edx&65535,0x5678);assert.throws(()=>o.step());
  const settled=o.settle();assert.equal(settled.board.debt,0);assert.deepEqual(settled.cpu,end.cpu);assert.ok(settled.accesses.some(x=>x.cs===selector&&x.eip===0x7000&&x.raw===0xa000));assert.ok(settled.accesses.some(x=>x.cs===selector&&x.eip===0x7001&&x.raw===0xb000&&x.value===0x34));assert.ok(settled.accesses.some(x=>x.cs===selector&&x.eip===0x700b&&x.raw===0xb002&&x.value===0x78));assert.equal(settled.accesses.some(x=>x.cs===selector&&x.raw>=0x7000&&x.raw<0x8000),false);assert.equal(settled.accesses.some(x=>x.cs===selector&&x.raw>=0x9000&&x.raw<0xa000),false);
  if(process.env.BW_NONIDENTITY_PAGING_CONTROL_OUTPUT)writeFileSync(process.env.BW_NONIDENTITY_PAGING_CONTROL_OUTPUT,JSON.stringify({schema:'bw.nonidentity-paging.js-source-control.v1',scope:'Private fixed Bochs-model JS source only; no native paging build/admission/guest',romSha256:pagingProfile.romSha256,frames,cuts,settled},(_,v)=>v instanceof Uint8Array?[...v]:v)+'\n',{flag:'wx'});
  console.log(JSON.stringify({scope:'tiny actual JS paging source control only',q:end.q,cuts,stores:end.stores.length,updates:end.updates.length,ramSha256:settled.ramSha256}));
 }finally{o.close();}
});
