/** Private finite ordinary-JS paging oracle. No native admission. */
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
import {coldBoardConfig,layout,selector,terminalEip,romInstructions,ramInstructions,bootStores,dataStore,adTransitions,fixedPagingRom,pagingProfile,namedCuts,expectedCr0,physicalFetch,validateBootStore,validateAdTransition,expectedPages,wordAt,dword,validateMilestone} from './profile.mjs';
export function pagingSourceIdentity(...args){
 assert.equal(args.length,0);const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),git=args=>execFileSync('git',args,{cwd:root,timeout:10000,maxBuffer:16<<20});
 assert.equal(git(['status','--porcelain']).toString().trim(),'','clean frozen paging source');const revision=git(['rev-parse','HEAD']).toString().trim(),hashes={};
 const visit=p=>{assert.ok(!p.startsWith('/')&&resolve(root,p).startsWith(root+'/'));if(hashes[p])return;const raw=regularBytes(resolve(root,p));hashes[p]=sha(raw);assert.equal(hashes[p],sha(git(['show',revision+':'+p])),'paging current/Git '+p);if(/\.(mjs|js)$/.test(p))for(const relative of relativeImports(raw))visit(resolve(root,dirname(p),relative).slice(root.length+1));};
 for(const p of ['scripts/bochs-cpu3-native-nonidentity-paging/reference.mjs','scripts/bochs-cpu3-native-nonidentity-paging/SOURCE.md','test/i80386-nonidentity-paging-source.test.mjs','src/experimental/i80386.js','package.json','roms/free-at-bios/LICENSE'])visit(p);
 return {revision,hashes:Object.fromEntries(Object.entries(hashes).sort(([a],[b])=>a.localeCompare(b)))};
}
export async function createNonidentityPagingOracle(...args){
 assert.equal(args.length,0,'no caller machine, ROM, tables or hooks');let q=0,active=false,closed=false,settled=false,owner=null,byteOffset=0,adOffset=0,fetchOffset=0,line=false;
 const stores=[],updates=[],accesses=[];let lastAccesses=[];
 const Cpu=await protectedCpuClass();const m=new ExperimentalI80386ATMachine(JSON.parse(JSON.stringify(coldBoardConfig)),{onPortAccess:()=>{throw Error('finite paging profile forbids PIO');}});
 assert.equal(m.cpu.cycles,0);
 // The AT constructor's compatibility CPU has never executed. Install a
 // genuinely strict386 instance on the same private board before any step.
 m.cpu=new Cpu({read:a=>m._read386(a),read32:a=>m._read386Ram32(a),fetch:a=>m._read386(a),fetchRam32:a=>m._fetch386Ram32(a),write:(a,v)=>m._write386(a,v),inPort:(p,w)=>m._in386(p,w),outPort:(p,v,w)=>m._out386(p,v,w)},{deliverFaults:true,translationCache:true,translationCacheWritesTrackedExternally:true,cpuProfile:'strict386'});
 const rom=fixedPagingRom();m.loadRom(rom,0xf0000);m.loadRom(rom);m.reset();initializeRamReset(m.cpu);assert.equal(m.cpu.cpuProfile,'strict386');
 for(const method of ['interrupt','_deliverFault'])m.cpu[method]=()=>{throw Error('finite paging profile forbids '+method);};
 const pages=()=>Object.fromEntries(Object.entries(layout).map(([k,at])=>[k,Uint8Array.from(m.mem.subarray(at,at+4096))]));
 const checkPages=()=>assert.deepEqual(pages(),expectedPages(stores,updates),'seven entire physical pages contain only owned boot/data/A-D effects');checkPages();
 const originalWrite=m._write386.bind(m);m._write386=(raw,value)=>{
  assert.ok(active&&owner,'only actual owned instruction may write');assert.equal(m._decode386(raw),raw,'A20 and physical address stable');
  if(m.cpu._pagingBitWrite){const e=adTransitions[updates.length];assert.ok(e,'finite page-bit updates');
   if(adOffset===0)validateAdTransition(updates.length,raw,wordAt(m.mem,e.raw),e.after,owner.cs,owner.eip);
   assert.equal(raw,e.raw+adOffset);assert.equal(value,dword(e.after)[adOffset]);originalWrite(raw,value);adOffset++;
   if(adOffset===4){updates.push({...e,q:q+1});adOffset=0;}
  }else{const e=stores.length<bootStores.length?bootStores[stores.length]:dataStore;assert.ok(stores.length<=bootStores.length,'only one mapped data write');assert.deepEqual([owner.cs,owner.eip,raw,value],[e.cs,e.ip,e.raw+byteOffset,e.bytes[byteOffset]]);assert.ok(byteOffset<e.bytes.length);originalWrite(raw,value);byteOffset++;}
 };
 const originalRead=m._read386.bind(m);m._read386=raw=>{const value=originalRead(raw);if(active)accesses.push({q:q+1,cs:owner.cs,eip:owner.eip,raw,value});return value;};
 const originalFetch=m.cpu.fetch;m.cpu.fetch=raw=>{assert.ok(active&&owner);assert.equal(raw,(owner.physical+fetchOffset)>>>0,'actual physical code fetch, never poisoned identity alias');fetchOffset++;return originalFetch(raw);};
 const paused=()=>assert.ok(!active&&!closed),live=()=>{paused();assert.ok(!settled);};
 const name=()=>namedCuts.find(c=>c.cs===m.cpu.cs&&c.eip===m.cpu.eip)?.name??null;
 const snapshot=()=>({q,cpu:javascriptCpu(m.cpu),board:combinedBoardState(m),pages:pages(),stores:stores.map(s=>({...s,bytes:[...s.bytes]})),updates:updates.map(s=>({...s})),lastAccesses:lastAccesses.map(s=>({...s}))});
 return Object.freeze({
  checkpoint(){paused();return snapshot();},
  stage(){live();if(m._chipDebt>=m._chipDeadline)m._flushChips();const asserted=!!m._pic.intActive,changed=asserted!==line;line=asserted;return {asserted,changed};},
  step(){live();assert.notEqual(name(),'before-HLT','ordinary checkpoint before HLT');assert.ok(q<pagingProfile.maxQuanta);const c=m.cpu,cs=c.cs,eip=c.eip;
   assert.equal(c.cr0,expectedCr0(cs,eip));assert.equal(c.cr4,0);assert.equal(c.eflags,2);assert.deepEqual([c._interruptShadow,c._nmiShadow,c._debugShadow],[0,0,0]);
   const physical=physicalFetch(cs,c.segmentCaches[1].base>>>0,eip),instruction=cs===selector?ramInstructions.find(i=>i.ip===eip):eip===0xfff0?{bytes:[0xea,0,1,0,0xf0]}:romInstructions.find(i=>i.ip===eip);
   const start=accesses.length;owner={cs,eip,physical};byteOffset=adOffset=fetchOffset=0;active=true;try{m.step();}finally{active=false;owner=null;}
   assert.equal(adOffset,0);assert.equal(fetchOffset,instruction.bytes.length);assert.equal(c._instructionBytes,instruction.bytes.length);
   const e=stores.length<bootStores.length?bootStores[stores.length]:dataStore;
   if(cs===e.cs&&eip===e.ip){assert.equal(byteOffset,e.bytes.length);if(stores.length<bootStores.length)validateBootStore(e.raw,Uint8Array.from(e.bytes),stores.length,cs,eip);stores.push({...e,bytes:[...e.bytes],q:q+1});}else assert.equal(byteOffset,0,'no unowned data writes');
   q++;lastAccesses=accesses.slice(start);checkPages();assert.equal(c.cr0,expectedCr0(c.cs,c.eip));assert.equal(c.cycles,q);assert.equal(m.cycles,4+6*q);assert.ok(!c.halted&&!c.shutdown);assert.equal(c.eflags,2);assert.equal(c.cr4,0);assert.ok(m._a20Enabled&&!m._cpuResetPending&&!m._fastA20Latch);return {q};
  },
  milestone(){paused();const n=name();if(n)validateMilestone(n,snapshot());return n;},
  settle(){live();assert.equal(name(),'before-HLT');assert.equal(stores.length,bootStores.length+1);assert.equal(updates.length,6);validateMilestone(name(),snapshot());m._catchUpChips();settled=true;return {...snapshot(),accesses:accesses.map(a=>({...a})),ramSha256:createHash('sha256').update(m.mem).digest('hex')};},
  close(){paused();closed=true;},
 });
}
