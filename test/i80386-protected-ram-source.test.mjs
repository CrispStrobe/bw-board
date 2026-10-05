import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {instructions,stores,descriptor,fixedProtectedRamRom,protectedRamProfile,expectedRamPage,expectedGdtPage,fetchDomain,validateStore,validateMilestone} from '../scripts/bochs-cpu3-native-protected-ram/profile.mjs';
import {deriveProtectedCpu,cpuSourceSha256,bochsCr0Write} from '../scripts/bochs-cpu3-native-protected-ram/cpu-profile.mjs';
import {createProtectedRamOracle} from '../scripts/bochs-cpu3-native-protected-ram/reference.mjs';
test('fixed ROM encodes exact contiguous LGDT/PE/far jump and ordinary RAM MOV',()=>{
 const rom=fixedProtectedRamRom();assert.equal(rom.length,65536);assert.deepEqual([...rom.subarray(0xfff0,0xfff5)],[0xea,0,1,0,0xf0]);
 let next=0x100;for(const i of instructions){assert.equal(i.ip,next);assert.deepEqual([...rom.subarray(i.ip,i.ip+i.bytes.length)],i.bytes);next+=i.bytes.length;}assert.equal(next,0x138);
 assert.deepEqual([...rom.subarray(0x124,0x12a)],[0x2e,0x0f,1,0x16,0x80,1]);assert.deepEqual([...rom.subarray(0x180,0x186)],[0x1f,0,0,6,0,0]);
 assert.deepEqual([...rom.subarray(0x130,0x138)],[0x0f,0x22,0xc0,0xea,0,0x70,0x18,0]);assert.deepEqual([...expectedRamPage().subarray(0,4)],[0xb8,0x34,0x12,0xf4]);
 assert.equal(createHash('sha256').update(rom).digest('hex'),protectedRamProfile.romSha256);assert.throws(()=>fixedProtectedRamRom({rom}));
});
test('GDT layout and copied page bytes are fixed and detached',()=>{
 const g=expectedGdtPage();assert.equal(g.length,4096);assert.deepEqual([...g.subarray(0x618,0x620)],descriptor);assert.equal(descriptor[5]&1,1,'already accessed descriptor');assert.ok(g.subarray(0,0x618).every(v=>v===0));
 const p=expectedRamPage();p[0]=0;assert.equal(expectedRamPage()[0],0xb8);assert.equal(expectedRamPage().subarray(4).some(v=>v!==0),false);
});
test('fetch admission binds real/protected transition and denies paging or wrong code',()=>{
 const ram={selector:0x18,base:0,eip:0x7000,length:3,pe:1,cs32:0,interrupts:0,paging:0,mappingPending:0,a20:1};assert.equal(fetchDomain(ram),true);
 for(const [key,value]of [['selector',8],['base',0xf0000],['eip',0x7003],['length',4],['pe',0],['cs32',1],['interrupts',1],['paging',1],['mappingPending',1],['a20',0]])assert.equal(fetchDomain({...ram,[key]:value}),false,key);
 const transition={...ram,selector:0xf000,base:0xf0000,eip:0x133,length:5};assert.equal(fetchDomain(transition),true);assert.equal(fetchDomain({...transition,pe:0}),false);
 assert.equal(fetchDomain({...transition,eip:0x130,length:3,pe:0}),true);assert.equal(fetchDomain({...transition,eip:0x130,length:3}),false);
});
test('only exact ROM-owned GDT/program initialization effects are admitted',()=>{
 for(const [i,s]of stores.entries()){assert.equal(validateStore(s.raw,Uint8Array.from(s.bytes),i,0xf000,s.ip),i+1);
  for(const args of [[s.raw+1,Uint8Array.from(s.bytes),i,0xf000,s.ip],[s.raw,Uint8Array.from(s.bytes),i,0x18,s.ip],[s.raw,Uint8Array.from(s.bytes),i,0xf000,s.ip+1],[s.raw,Uint8Array.from([...s.bytes].map((v,k)=>k? v:v^1)),i,0xf000,s.ip]])assert.throws(()=>validateStore(...args));
 }assert.throws(()=>validateStore(0x7000,Uint8Array.of(0),4,0xf000,0x118));
});
test('CR0 profile is one exact authenticated source seam with byte-exact inverse',()=>{
 const b=readFileSync(new URL('../src/experimental/i80386.js',import.meta.url)),d=deriveProtectedCpu(b);assert.equal(d.edits.length,1);assert.equal(d.baseSha256,cpuSourceSha256);
 const [{old,next}]=d.edits;assert.deepEqual(Buffer.from(d.bytes.toString().replace(next,old)),b);assert.throws(()=>deriveProtectedCpu(Buffer.concat([b,Buffer.from('\n')])));
 for(const value of [0,1,0x10,0x11,0x7ffffff1,0x80000001])assert.equal(bochsCr0Write(value),(value|0x7ffffff0)>>>0);assert.throws(()=>bochsCr0Write(-1));assert.throws(()=>bochsCr0Write(0x100000000));
});
test('fixed private oracle constructor exposes detached reset/stage copies',async()=>{
 await assert.rejects(createProtectedRamOracle({hooks:{}}));const o=await createProtectedRamOracle();try{const reset=o.checkpoint();assert.equal(reset.q,0);assert.equal(reset.cpu.cycles,0);assert.equal(reset.cpu.cr0,0x7ffffff0);assert.equal(reset.cpu.edx,0);assert.equal(reset.cpu.segmentCaches[1].base,0xffff0000);
  assert.equal(o.milestone(),'reset');assert.deepEqual(o.stage(),{asserted:false,changed:false});assert.deepEqual(o.checkpoint(),reset);reset.ramPage[0]=123;assert.equal(o.checkpoint().ramPage[0],0);assert.throws(()=>o.settle());
 }finally{o.close();}assert.throws(()=>o.checkpoint());
});
test('manufactured milestone controls separately prove GDT PE far-jump and AX state',()=>{
 const s={cpu:{cs:0x18,eip:0x7003,cr0:0x7ffffff1,eflags:2,halted:false,eax:0x1234,gdtr:{base:0x600,limit:0x1f},segmentCaches:{1:{base:0,limit:0xffff,default32:false,code:true,readable:true,writable:false,access:0x9b,address:0x618,dpl:0,conforming:false,present:true}}},ramPage:expectedRamPage(),gdtPage:expectedGdtPage()};assert.equal(validateMilestone('after-RAM-MOV',s),'after-RAM-MOV');
 for(const change of [{cs:0},{eip:0x7000},{cr0:0x7ffffff0},{cr0:0xffffffF1},{eflags:0x202},{eax:1},{gdtr:{base:0x600,limit:0x17}}])assert.throws(()=>validateMilestone('after-RAM-MOV',{...s,cpu:{...s.cpu,...change}}));
 const page=Uint8Array.from(s.ramPage);page[4095]=1;assert.throws(()=>validateMilestone('after-RAM-MOV',{...s,ramPage:page}));assert.throws(()=>validateMilestone('unknown',s));
 const gdt=Uint8Array.from(s.gdtPage);gdt[0x61e]=0x80;assert.throws(()=>validateMilestone('after-RAM-MOV',{...s,gdtPage:gdt}));
 for(const change of [{access:0x9a},{dpl:3},{default32:true},{readable:false},{conforming:true}])assert.throws(()=>validateMilestone('after-RAM-MOV',{...s,cpu:{...s.cpu,segmentCaches:{1:{...s.cpu.segmentCaches[1],...change}}}}));
});
test('tiny actual JS oracle proves LGDT PE far jump RAM AX and exactly four stores',async()=>{
 const o=await createProtectedRamOracle();try{const cuts=[],steps=[];for(let i=0;i<64;i++){
  const snapshot=o.checkpoint();steps.push(snapshot);const name=o.milestone();if(name)cuts.push({name,q:snapshot.q});if(name==='after-RAM-MOV')break;o.stage();o.step();
 }assert.deepEqual(cuts.map(c=>c.name),['reset','after-LGDT','PE-enabled','entered-protected-RAM','after-RAM-MOV']);
 const end=o.checkpoint();assert.equal(end.q,1+instructions.length+1);assert.deepEqual(end.stores.map(w=>[w.raw,...w.bytes,w.ip]),stores.map(w=>[w.raw,...w.bytes,w.ip]));
 assert.equal(end.stores.length,4);assert.equal(end.cpu.eax&65535,0x1234);assert.equal(end.cpu.cr0,0x7ffffff1);assert.deepEqual(end.gdtPage,expectedGdtPage());assert.deepEqual(end.ramPage,expectedRamPage());assert.throws(()=>o.step());
 const settled=o.settle();assert.equal(settled.board.debt,0);assert.match(settled.ramSha256,/^[0-9a-f]{64}$/);assert.deepEqual(settled.cpu,end.cpu);
 if(process.env.BW_PROTECTED_RAM_CONTROL_OUTPUT)writeFileSync(process.env.BW_PROTECTED_RAM_CONTROL_OUTPUT,JSON.stringify({schema:'bw.protected-ram.js-source-control.v1',scope:'Tiny actual JS source-oracle control, not native execution',romSha256:protectedRamProfile.romSha256,steps,cuts,settled},(_,v)=>v instanceof Uint8Array?Array.from(v):v,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({scope:'tiny actual JS source-oracle control, no native execution',q:end.q,cuts,stores:end.stores,ramSha256:settled.ramSha256}));
 }finally{o.close();}
});
