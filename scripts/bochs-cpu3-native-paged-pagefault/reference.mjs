/** Private no-arg finite oracle: genuine faulting instruction, delivery, repair and retry. */
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
import {coldBoardConfig,layout,selector,vector,faultEip,terminalEip,handlerEip,romInstructions,ramInstructions,ordinaryStores,bootStores,frameStores,adTransitions,fixedPageFaultRom,pageFaultProfile,namedCuts,expectedCr0,expectedShadow,physicalFetch,validateStore,validateAdTransition,expectedPages,wordAt,dword,validateMilestone,validateLedger} from './profile.mjs';
export function pageFaultSourceIdentity(...args){
 assert.equal(args.length,0);const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),git=args=>execFileSync('git',args,{cwd:root,timeout:10000,maxBuffer:16<<20});
 assert.equal(git(['status','--porcelain']).toString().trim(),'','clean frozen PF source');const revision=git(['rev-parse','HEAD']).toString().trim(),hashes={};
 const visit=p=>{assert.ok(!p.startsWith('/')&&resolve(root,p).startsWith(root+'/'));if(hashes[p])return;const raw=regularBytes(resolve(root,p));hashes[p]=sha(raw);assert.equal(hashes[p],sha(git(['show',revision+':'+p])),'PF current/Git '+p);if(/\.(mjs|js)$/.test(p))for(const relative of relativeImports(raw))visit(resolve(root,dirname(p),relative).slice(root.length+1));};
 for(const p of ['scripts/bochs-cpu3-native-paged-pagefault/reference.mjs','scripts/bochs-cpu3-native-paged-pagefault/SOURCE.md','test/i80386-paged-pagefault-source.test.mjs','src/experimental/i80386.js','package.json','roms/free-at-bios/LICENSE'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export async function createPagedPageFaultOracle(...args){
 assert.equal(args.length,0,'no caller board/ROM/gate/fault/hooks');let q=0,attemptOrdinal=0,active=false,closed=false,settled=false,owner=null,byteOffset=0,adOffset=0,fetchOffset=0,line=false;
 const stores=[],updates=[],accesses=[],deliveries=[],attempts=[],reloads=[];let lastAccesses=[];
 const Cpu=await protectedCpuClass();const m=new ExperimentalI80386ATMachine(JSON.parse(JSON.stringify(coldBoardConfig)),{onPortAccess:()=>{throw Error('finite PF profile forbids PIO');}});assert.equal(m.cpu.cycles,0);
 m.cpu=new Cpu({read:a=>m._read386(a),read32:a=>m._read386Ram32(a),fetch:a=>m._read386(a),fetchRam32:a=>m._fetch386Ram32(a),write:(a,v)=>m._write386(a,v),inPort:(p,w)=>m._in386(p,w),outPort:(p,v,w)=>m._out386(p,v,w)},{deliverFaults:true,translationCache:true,translationCacheWritesTrackedExternally:true,cpuProfile:'strict386'});
 const rom=fixedPageFaultRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();initializeRamReset(m.cpu);assert.equal(m.cpu.cpuProfile,'strict386');
 m.cpu.interrupt=()=>{throw Error('finite PF profile forbids external interrupt');};
 const originalDeliver=m.cpu._deliver.bind(m.cpu),originalFault=m.cpu._deliverFault.bind(m.cpu);
 m.cpu._deliverFault=(fault,returnEip,options={})=>{assert.ok(active&&owner);assert.deepEqual([owner.cs,owner.eip,fault.vector,fault.errorCode,returnEip,m.cpu.cr2,options],[selector,faultEip,vector,2,faultEip,0x8000,{}]);assert.equal(deliveries.length,0,'one actual PF only');assert.equal(reloads.length,0);assert.deepEqual([...m.mem.subarray(layout.data,layout.data+4)],[0x78,0x56,0x9a,0xbc],'failed operand did not commit');return originalFault(fault,returnEip,options);};
 m.cpu._deliver=(v,returnEip,errorCode=null,options={})=>{assert.ok(active&&owner);assert.deepEqual([owner.cs,owner.eip,v,returnEip,errorCode,options],[selector,faultEip,vector,faultEip,2,{external:false,fault:true}]);assert.equal(deliveries.length,0);originalDeliver(v,returnEip,errorCode,options);assert.deepEqual([m.cpu.cs,m.cpu.eip,m.cpu.esp,m.cpu.eflags,m.cpu.cr2],[selector,handlerEip,0xdff8,2,0x8000]);deliveries.push({attemptOrdinal:attemptOrdinal+1,q,vector:v,returnEip,errorCode,fault:true,cr2:m.cpu.cr2,cs:m.cpu.cs,eip:m.cpu.eip,esp:m.cpu.esp,eflags:m.cpu.eflags});};
 const pages=()=>Object.fromEntries(Object.entries(layout).map(([k,at])=>[k,Uint8Array.from(m.mem.subarray(at,at+4096))]));
 const checkPages=()=>assert.deepEqual(pages(),expectedPages(stores,updates),'ten whole physical pages contain only owned ordinary and A/D writes');checkPages();
 const originalWrite=m._write386.bind(m);m._write386=(raw,value)=>{
  assert.ok(active&&owner,'only actual owned instruction writes');assert.equal(m._decode386(raw),raw,'stable physical address/A20');
  if(m.cpu._pagingBitWrite){const e=adTransitions[updates.length];assert.ok(e);if(adOffset===0)validateAdTransition(updates.length,raw,wordAt(m.mem,e.raw),e.after,owner.cs,owner.eip);assert.equal(raw,e.raw+adOffset);assert.equal(value,dword(e.after)[adOffset]);originalWrite(raw,value);if(++adOffset===4){updates.push({...e,attemptOrdinal:attemptOrdinal+1,q});adOffset=0;}}
  else{const e=ordinaryStores[stores.length];assert.ok(e,'no additional operand/frame writes');assert.deepEqual([owner.cs,owner.eip,raw,value],[e.cs,e.ip,e.raw+byteOffset,e.bytes[byteOffset]]);assert.ok(byteOffset<e.bytes.length);
   if(e.raw===0x2020&&e.cs===selector){assert.equal(deliveries.length,1);assert.equal(reloads.length,0);}
   if(e.raw===layout.data&&e.cs===selector){assert.equal(deliveries.length,1);assert.equal(reloads.length,1);assert.equal(owner.faultSerial,1);assert.equal(m.cpu.esp,0xe000);}
   originalWrite(raw,value);if(++byteOffset===e.bytes.length){validateStore(stores.length,e.raw,e.bytes,owner.cs,owner.eip);stores.push({...e,bytes:[...e.bytes],attemptOrdinal:attemptOrdinal+1,q});byteOffset=0;}}
 };
 const originalRead=m._read386.bind(m);m._read386=raw=>{const value=originalRead(raw);if(active)accesses.push({attemptOrdinal:attemptOrdinal+1,q,cs:owner.cs,eip:owner.eip,raw,value});return value;};
 const originalFetch=m.cpu.fetch;m.cpu.fetch=raw=>{assert.ok(active&&owner);assert.equal(raw,(owner.physical+fetchOffset)>>>0,'actual nonidentity/identityROM physical fetch');fetchOffset++;return originalFetch(raw);};
 const paused=()=>assert.ok(!active&&!closed),live=()=>{paused();assert.ok(!settled);};
 const name=()=>namedCuts.find(c=>c.cs===m.cpu.cs&&c.eip===m.cpu.eip&&(c.faultSerial===undefined||c.faultSerial===deliveries.length))?.name??null;
 const snapshot=()=>({q,attemptOrdinal,faultSerial:deliveries.length,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),pages:pages(),stores:stores.map(s=>({...s,bytes:[...s.bytes]})),updates:updates.map(s=>({...s})),deliveries:deliveries.map(s=>({...s})),reloads:reloads.map(s=>({...s})),attempts:attempts.map(s=>({...s})),lastAccesses:lastAccesses.map(s=>({...s}))});
 return Object.freeze({checkpoint(){paused();return snapshot();},stage(){live();if(m._chipDebt>=m._chipDeadline)m._flushChips();const asserted=!!m._pic.intActive,changed=asserted!==line;line=asserted;assert.equal(asserted,false,'no IRQ line in finite fixture');return {asserted,changed};},
  step(){live();assert.notEqual(name(),'readback-before-HLT','ordinary preHLT stop');assert.ok(attemptOrdinal<pageFaultProfile.maxAttempts&&q<pageFaultProfile.maxQuanta);const c=m.cpu,cs=c.cs,eip=c.eip,faultSerial=deliveries.length,isFault=cs===selector&&eip===faultEip&&faultSerial===0;
   assert.equal(c.cr0,expectedCr0(cs,eip));assert.equal(c.cr4,0);assert.equal(c.eflags,cs===selector&&eip===0x7032?0x86:2);assert.deepEqual([c._interruptShadow,c._nmiShadow,c._debugShadow],expectedShadow(cs,eip));
   const physical=physicalFetch(cs,c.segmentCaches[1].base>>>0,eip),instruction=cs===selector?ramInstructions.find(i=>i.ip===eip):eip===0xfff0?{bytes:[0xea,0,1,0,0xf0]}:romInstructions.find(i=>i.ip===eip);
   const start=accesses.length,storeStart=stores.length,qBefore=q,cyclesBefore=m.cycles,translationsBefore=c._translationGeneration;owner={cs,eip,physical,faultSerial};byteOffset=adOffset=fetchOffset=0;active=true;let result;try{result=m.step();}finally{active=false;owner=null;}
   assert.equal(adOffset,0);assert.equal(byteOffset,0);assert.equal(fetchOffset,instruction.bytes.length);assert.equal(c._instructionBytes,instruction.bytes.length);
   const expected=cs===selector&&eip===faultEip?isFault?frameStores:[ordinaryStores.at(-1)]:ordinaryStores.filter(e=>e.cs===cs&&e.ip===eip);assert.deepEqual(stores.slice(storeStart).map(e=>[e.raw,e.bytes]),expected.map(e=>[e.raw,e.bytes]));
   attemptOrdinal++;if(isFault){assert.equal(result,0);assert.equal(deliveries.length,1);assert.equal(c.cycles,q);assert.equal(m.cycles,cyclesBefore);assert.equal(c.cr2,0x8000);assert.equal(stores.length,bootStores.length+4);assert.deepEqual([...m.mem.subarray(layout.data,layout.data+4)],[0x78,0x56,0x9a,0xbc]);}
   else{assert.equal(result,6);q++;assert.equal(c.cycles,q);assert.equal(m.cycles,cyclesBefore+6);}
   if(cs===selector&&eip===0x702c){assert.equal(reloads.length,0);assert.equal(c.cr3,0x1000);assert.notEqual(c._translationGeneration,translationsBefore,'genuine unchanged CR3 reload invalidates cache');reloads.push({attemptOrdinal,q,cr3:c.cr3,translationGenerationBefore:translationsBefore,translationGenerationAfter:c._translationGeneration});}
   attempts.push({attemptOrdinal,cs,eip,qBefore,qAfter:q,completed:q-qBefore,faultDelivered:isFault,result,boardCyclesBefore:cyclesBefore,boardCyclesAfter:m.cycles,returnedCs:c.cs,returnedEip:c.eip});lastAccesses=accesses.slice(start);checkPages();validateLedger(snapshot());assert.equal(c.cr0,expectedCr0(c.cs,c.eip));assert.equal(m.cycles,4+6*q);assert.ok(!c.halted&&!c.shutdown);assert.equal(c.eflags,c.cs===selector&&c.eip===0x7032?0x86:2);assert.equal(c.cr4,0);assert.deepEqual([c._interruptShadow,c._nmiShadow,c._debugShadow],expectedShadow(c.cs,c.eip));assert.ok(m._a20Enabled&&!m._cpuResetPending&&!m._fastA20Latch);return {attemptOrdinal,q,completed:q-qBefore,faultDelivered:isFault,result};},
  milestone(){paused();const n=name();if(n)validateMilestone(n,snapshot());return n;},
  settle(){live();assert.equal(name(),'readback-before-HLT');assert.equal(stores.length,ordinaryStores.length);assert.equal(updates.length,adTransitions.length);assert.equal(deliveries.length,1);assert.equal(reloads.length,1);assert.equal(attempts.filter(a=>a.faultDelivered).length,1);assert.equal(attempts.filter(a=>a.cs===selector&&a.eip===faultEip).length,2);validateMilestone(name(),snapshot());m._catchUpChips();settled=true;return {...snapshot(),accesses:accesses.map(a=>({...a})),ramSha256:createHash('sha256').update(m.mem).digest('hex')};},close(){paused();closed=true;},});
}
