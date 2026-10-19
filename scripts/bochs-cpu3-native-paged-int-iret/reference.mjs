/** Private finite JS source oracle. No native constructor/admission or caller hooks. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {ExperimentalI80386ATMachine} from '../../src/experimental/i80386-at-machine.js';
import {combinedBoardState} from '../bochs-cpu3-native-combined-paging-ram/host.mjs';
import {javascriptCpu} from '../bochs-cpu3-native-owned-8042-interface/reference.mjs';
import {initializeRamReset} from '../bochs-cpu3-native-ram-bootstrap/reference.mjs';
import {protectedCpuClass} from '../bochs-cpu3-native-protected-ram/cpu-profile.mjs';
import {regularBytes,sha,relativeImports} from '../bochs-cpu3-native-protected-stack/driver-auth.mjs';
import {coldBoardConfig,layout,selector,romInstructions,ramInstructions,bootStores,frameStores,adTransitions,fixedIntIretRom,intIretProfile,namedCuts,expectedCr0,expectedShadow,physicalFetch,validateStore,validateAdTransition,expectedPages,wordAt,dword,validateMilestone} from './profile.mjs';
export function intIretSourceIdentity(...args){
 assert.equal(args.length,0);const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),git=args=>execFileSync('git',args,{cwd:root,timeout:10000,maxBuffer:16<<20});
 assert.equal(git(['status','--porcelain']).toString().trim(),'','clean frozen INT/IRET source');const revision=git(['rev-parse','HEAD']).toString().trim(),hashes={};
 const visit=p=>{assert.ok(!p.startsWith('/')&&resolve(root,p).startsWith(root+'/'));if(hashes[p])return;const raw=regularBytes(resolve(root,p));hashes[p]=sha(raw);assert.equal(hashes[p],sha(git(['show',revision+':'+p])),'INT/IRET current/Git '+p);if(/\.(mjs|js)$/.test(p))for(const relative of relativeImports(raw))visit(resolve(root,dirname(p),relative).slice(root.length+1));};
 for(const p of ['scripts/bochs-cpu3-native-paged-int-iret/reference.mjs','scripts/bochs-cpu3-native-paged-int-iret/SOURCE.md','test/i80386-paged-int-iret-source.test.mjs','src/experimental/i80386.js','package.json','roms/free-at-bios/LICENSE'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export async function createPagedIntIretOracle(...args){
 assert.equal(args.length,0,'no caller board/ROM/gate/hooks');let q=0,active=false,closed=false,settled=false,owner=null,byteOffset=0,adOffset=0,fetchOffset=0,line=false;
 const stores=[],updates=[],accesses=[],deliveries=[];let lastAccesses=[];
 const Cpu=await protectedCpuClass();const m=new ExperimentalI80386ATMachine(JSON.parse(JSON.stringify(coldBoardConfig)),{onPortAccess:()=>{throw Error('finite INT/IRET profile forbids PIO');}});assert.equal(m.cpu.cycles,0);
 m.cpu=new Cpu({read:a=>m._read386(a),read32:a=>m._read386Ram32(a),fetch:a=>m._read386(a),fetchRam32:a=>m._fetch386Ram32(a),write:(a,v)=>m._write386(a,v),inPort:(p,w)=>m._in386(p,w),outPort:(p,v,w)=>m._out386(p,v,w)},{deliverFaults:true,translationCache:true,translationCacheWritesTrackedExternally:true,cpuProfile:'strict386'});
 const rom=fixedIntIretRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();initializeRamReset(m.cpu);assert.equal(m.cpu.cpuProfile,'strict386');
 for(const method of ['interrupt','_deliverFault'])m.cpu[method]=()=>{throw Error('finite INT/IRET profile forbids '+method);};
 const originalDeliver=m.cpu._deliver.bind(m.cpu);m.cpu._deliver=(vector,returnEip,errorCode=null,options={})=>{assert.ok(active&&owner);assert.deepEqual([owner.cs,owner.eip,vector,returnEip,errorCode,options],[selector,0x7003,0x30,0x7005,null,{software:true}]);assert.equal(deliveries.length,0);originalDeliver(vector,returnEip,errorCode,options);deliveries.push({q:q+1,vector,returnEip,errorCode,software:true,cs:m.cpu.cs,eip:m.cpu.eip,esp:m.cpu.esp,eflags:m.cpu.eflags});};
 const pages=()=>Object.fromEntries(Object.entries(layout).map(([k,at])=>[k,Uint8Array.from(m.mem.subarray(at,at+4096))]));
 const checkPages=()=>assert.deepEqual(pages(),expectedPages(stores,updates),'ten whole physical pages contain only owned boot/frame/A-D writes');checkPages();
 const originalWrite=m._write386.bind(m);m._write386=(raw,value)=>{
  assert.ok(active&&owner,'only actual owned instruction writes');assert.equal(m._decode386(raw),raw,'stable physical address/A20');
  if(m.cpu._pagingBitWrite){const e=adTransitions[updates.length];assert.ok(e);if(adOffset===0)validateAdTransition(updates.length,raw,wordAt(m.mem,e.raw),e.after,owner.cs,owner.eip);assert.equal(raw,e.raw+adOffset);assert.equal(value,dword(e.after)[adOffset]);originalWrite(raw,value);if(++adOffset===4){updates.push({...e,q:q+1});adOffset=0;}}
  else{const e=[...bootStores,...frameStores][stores.length];assert.ok(e,'no additional writes');assert.deepEqual([owner.cs,owner.eip,raw,value],[e.cs,e.ip,e.raw+byteOffset,e.bytes[byteOffset]]);assert.ok(byteOffset<e.bytes.length);originalWrite(raw,value);if(++byteOffset===e.bytes.length){validateStore(stores.length,e.raw,e.bytes,owner.cs,owner.eip);stores.push({...e,bytes:[...e.bytes],q:q+1});byteOffset=0;}}
 };
 const originalRead=m._read386.bind(m);m._read386=raw=>{const value=originalRead(raw);if(active)accesses.push({q:q+1,cs:owner.cs,eip:owner.eip,raw,value});return value;};
 const originalFetch=m.cpu.fetch;m.cpu.fetch=raw=>{assert.ok(active&&owner);assert.equal(raw,(owner.physical+fetchOffset)>>>0,'actual nonidentity/identityROM physical fetch');fetchOffset++;return originalFetch(raw);};
 const paused=()=>assert.ok(!active&&!closed),live=()=>{paused();assert.ok(!settled);};const name=()=>namedCuts.find(c=>c.cs===m.cpu.cs&&c.eip===m.cpu.eip)?.name??null;
 const snapshot=()=>({q,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),pages:pages(),stores:stores.map(s=>({...s,bytes:[...s.bytes]})),updates:updates.map(s=>({...s})),deliveries:deliveries.map(s=>({...s})),lastAccesses:lastAccesses.map(s=>({...s}))});
 return Object.freeze({checkpoint(){paused();return snapshot();},stage(){live();if(m._chipDebt>=m._chipDeadline)m._flushChips();const asserted=!!m._pic.intActive,changed=asserted!==line;line=asserted;return {asserted,changed};},
  step(){live();assert.notEqual(name(),'returned-from-IRET-before-HLT','ordinary preHLT stop');assert.ok(q<intIretProfile.maxQuanta);const c=m.cpu,cs=c.cs,eip=c.eip;assert.equal(c.cr0,expectedCr0(cs,eip));assert.equal(c.cr4,0);assert.equal(c.eflags,2);assert.deepEqual([c._interruptShadow,c._nmiShadow,c._debugShadow],expectedShadow(cs,eip));
   const physical=physicalFetch(cs,c.segmentCaches[1].base>>>0,eip),instruction=cs===selector?ramInstructions.find(i=>i.ip===eip):eip===0xfff0?{bytes:[0xea,0,1,0,0xf0]}:romInstructions.find(i=>i.ip===eip);
   const start=accesses.length,storeStart=stores.length;owner={cs,eip,physical};byteOffset=adOffset=fetchOffset=0;active=true;try{m.step();}finally{active=false;owner=null;}
   assert.equal(adOffset,0);assert.equal(byteOffset,0);assert.equal(fetchOffset,instruction.bytes.length);assert.equal(c._instructionBytes,instruction.bytes.length);const expected=[...bootStores,...frameStores].filter(e=>e.cs===cs&&e.ip===eip);assert.deepEqual(stores.slice(storeStart).map(e=>[e.raw,e.bytes]),expected.map(e=>[e.raw,e.bytes]));
   q++;lastAccesses=accesses.slice(start);checkPages();assert.equal(c.cr0,expectedCr0(c.cs,c.eip));assert.equal(c.cycles,q);assert.equal(m.cycles,4+6*q);assert.ok(!c.halted&&!c.shutdown);assert.equal(c.eflags,2);assert.equal(c.cr4,0);assert.deepEqual([c._interruptShadow,c._nmiShadow,c._debugShadow],expectedShadow(c.cs,c.eip));assert.ok(m._a20Enabled&&!m._cpuResetPending&&!m._fastA20Latch);return {q};},
  milestone(){paused();const n=name();if(n)validateMilestone(n,snapshot());return n;},
  settle(){live();assert.equal(name(),'returned-from-IRET-before-HLT');assert.equal(stores.length,bootStores.length+frameStores.length);assert.equal(updates.length,adTransitions.length);assert.equal(deliveries.length,1);validateMilestone(name(),snapshot());m._catchUpChips();settled=true;return {...snapshot(),accesses:accesses.map(a=>({...a})),ramSha256:createHash('sha256').update(m.mem).digest('hex')};},close(){paused();closed=true;},});
}
