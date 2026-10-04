/** Distinct fixed private native provider; preserves held lease/clock/coherence machinery. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveProtectedStackProvider} from '../bochs-cpu3-native-protected-stack/provider-derivation.mjs';
export const providerParentSha256='eb8a07e5712b876d1ea3d232223a84d4d18a4b02f4087e509ebe63da4c8a5b38';
export const providerModuleSha256='cb985dde558276b48032d1f1a70b7f37a24c685f505f3173d93775f40c348540';
const memoryMethods=String.raw` span(raw,width,options){
  if(options?.execute){assert.equal(width,4096);assert.ok(Number.isSafeInteger(raw)&&raw>=0&&raw<=0xffffffff&&(raw&4095)===0);
   if(raw===0xa000){for(let i=0;i<4096;i+=16){const s=super.span(raw+i,16);assert.equal(s.decoded,raw+i);assert.equal(s.kind,1);}return {decoded:raw,kind:1};}
   assert.ok(raw>=0xf0000&&raw<=0xff000||raw>=0xffff0000||raw>=0xff0000&&raw<=0xfff000,'fixed ROM or physical A000 only');
  }
  return super.span(raw,width,options);
 }
 readPhysical(raw,width){
  assert.ok(this.running&&!this.active&&!this.closed,'read lifecycle before arguments');validatePagingRead(raw,width);const r=super.readPhysical(raw,width);
  assert.equal(r.decoded,raw);assert.equal(r.effect,0);assert.equal(r.mappingEpoch,0);assert.equal(r.boardA20,1);
  if(Object.hasOwn(this.pagingState.tableValues,raw)){assert.equal(width,4);assert.equal(wordAt(r.bytes,0),this.pagingState.tableValues[raw]);}
  if(raw===0xb000){assert.deepEqual(Array.from(r.bytes),[0x34,0x12]);this.pagingState.dataRead=true;}
  if(raw===0xb002){assert.equal(this.pagingState.dataWritten,true);assert.deepEqual(Array.from(r.bytes),[0x78,0x56]);}
  this.pagingReads.push({raw,bytes:Array.from(r.bytes),generation:r.generation,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta});return r;
 }
 writePhysical(raw,bytes){
  assert.ok(this.running&&!this.active&&!this.closed,'write lifecycle before arguments');const next=validatePagingWrite(raw,bytes,this.pagingState),operand=Uint8Array.from(bytes),before=this._generation(raw),r=super.writePhysical(raw,operand);
  assert.equal(r.kind,1);assert.equal(r.decoded,raw);assert.equal(r.effect,1);assert.equal(r.mappingEpoch,0);assert.equal(r.boardA20,1);assert.deepEqual(r.bytes,operand);assert.equal(r.generation,before+1);
  this.pagingState.boot=next.nextBoot;if(next.kind==='ad')this.pagingState.tableValues[raw]=next.after;if(next.kind==='data')this.pagingState.dataWritten=true;
  this.ramBootStores=this.pagingState.boot;this.ramStoreIndex++;this.ramWrites.push({kind:next.kind,raw,bytes:Array.from(operand),before:next.before,after:next.after,generation:r.generation,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,cycles:this.machine.cycles});return r;
 }
`;
const pageMethod=String.raw` admitExecutePage(raw){assert.ok(this.running&&!this.active&&!this.closed,'owned page lifecycle');const span=this.span(raw,4096,{execute:true});
  assert.ok(span.kind===1?raw===0xa000&&span.decoded===0xa000:span.kind===2&&((span.decoded>=0xf0000&&span.decoded+4096<=0x100000)||(span.decoded>=0xff0000&&span.decoded+4096<=0x1000000)),'physical A000 or fixed ROM only');
  if(span.kind===1){assert.equal(this.pagingState.boot,16);assert.deepEqual(this.machine.mem.subarray(0xa000,0xb000),expectedRamPage());}
  const r=super.admitExecutePage(raw);if(span.kind===1){assert.equal(r.generation,4);this.ramAdmitted=this.pagingState.admitted=true;}return r;
 }`;
export function transformNonidentityPagingProvider(bytes){let s=authenticated(bytes,providerParentSha256,'qualified stack provider');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};const many=(old,next,count,label)=>{assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 many('SourceProtectedStackBoard','SourceNonidentityPagingBoard',2,'separate fixed board');once('createOwnedProtectedStackProvider','createOwnedNonidentityPagingProvider','separate noarg factory');
 once('validateProtectedWrite,validateProtectedRead,expectedRamPage','validatePagingWrite,validatePagingRead,expectedRamPage,bootStores,layout,entries,wordAt','owned nonidentity policy imports');
 once('this.ramBootStores=0;this.ramStoreIndex=0;','this.ramBootStores=0;this.ramStoreIndex=0;this.pagingState={boot:0,admitted:false,dataRead:false,dataWritten:false,tableValues:Object.fromEntries(Object.values(entries).map(e=>[e.raw,e.value]))};this.pagingReads=[];','independent native callback state');
 const oldInspect=s.match(/^ inspect\(\)\{.*\}$/m);assert.ok(oldInspect,'one-line held inspect');
 once(oldInspect[0]," inspect(){return {...super.inspect(),cold:{phase:this.controllerPhase,statusReads:this.statusReads,dataReads:this.dataReads,debugBytes:[...this.debugBytes],portEventCount:this.portEvents.length},ram:{bootStores:this.ramBootStores,storeCount:this.ramStoreIndex,admitted:this.ramAdmitted,writes:this.ramWrites.map(e=>({...e,bytes:[...e.bytes]})),reads:this.pagingReads.map(e=>({...e,bytes:[...e.bytes]})),pages:Object.fromEntries(Object.entries(layout).map(([k,raw])=>[k,Array.from(this.machine.mem.subarray(raw,raw+4096))]))}};}",'detached actual seven pages/native callbacks');
 const start=s.indexOf(' readPhysical(raw,width){'),end=s.indexOf(' nativeTick(){',start);assert.ok(start>=0&&end>start);once(s.slice(start,end),memoryMethods,'authentic native memory/execute-address protocol');
 const p=s.indexOf(' admitExecutePage(raw){'),q=s.indexOf('\n acknowledgeIrq(){',p);assert.ok(p>=0&&q>p);once(s.slice(p,q),pageMethod,'physical source-owned code admission');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'paging provider inverse '+e.label);assert.equal(sha256(inverse),providerParentSha256);return {bytes:Buffer.from(s),edits,baseSha256:providerParentSha256};
}
export function deriveNonidentityPagingProvider(){authenticated(readFileSync(new URL('../bochs-cpu3-native-protected-stack/provider-derivation.mjs',import.meta.url)),providerModuleSha256,'held stack provider module');return transformNonidentityPagingProvider(deriveProtectedStackProvider().bytes);}
export async function createOwnedNonidentityPagingProvider(...args){assert.equal(args.length,0,'no caller ROM/config/hooks');const text=deriveNonidentityPagingProvider().bytes.toString().replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,import.meta.url).href}${q}`);return (await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))).createOwnedNonidentityPagingProvider();}
