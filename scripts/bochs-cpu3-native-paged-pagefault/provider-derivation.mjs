/** Exact new private fault-aware provider; no construction on import. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {derivePagedIntIretProvider} from '../bochs-cpu3-native-paged-int-iret/provider-derivation.mjs';
import {bootStores,ramProgram} from './profile.mjs';
export const providerParentSha256='afc02de595449021f64cfa74cb0004ae71028e57596195769563439b5d0f005f';
export const providerModuleSha256='4907972858f7c9c7ed0ff630ec0334e4606184448707a6d1e1e1cdc0c7942376';
const memoryMethods=String.raw` span(raw,width,options){
  if(options?.execute){assert.equal(width,4096);assert.ok(Number.isSafeInteger(raw)&&raw>=0&&raw<=0xffffffff&&(raw&4095)===0);
   if(raw===0xa000){for(let i=0;i<4096;i+=16){const s=super.span(raw+i,16);assert.equal(s.decoded,raw+i);assert.equal(s.kind,1);}return {decoded:raw,kind:1};}
   assert.ok(raw>=0xf0000&&raw<=0xff000||raw>=0xffff0000||raw>=0xff0000&&raw<=0xfff000,'owned ROM or physical A000 only');}
  return super.span(raw,width,options);
 }
 readPhysical(raw,width){
  assert.ok(this.running&&!this.active&&!this.closed,'read lifecycle before arguments');validatePageFaultRead(raw,width);const r=super.readPhysical(raw,width);
  assert.equal(r.decoded,raw);assert.equal(r.effect,0);assert.equal(r.mappingEpoch,0);assert.equal(r.boardA20,1);
  if(Object.hasOwn(this.pagingState.tableValues,raw)){assert.equal(width,4);assert.equal(wordAt(r.bytes,0),this.pagingState.tableValues[raw]);}
  if(raw>=0xcffa&&raw<0xd000){assert.equal(this.pagingState.frameWords,4);const expected=[3,0x70,24,0,2,0];assert.deepEqual([...r.bytes],expected.slice(raw-0xcffa,raw-0xcffa+width));}
  if(raw>=0xb000&&raw<0xb002){assert.equal(this.pagingState.dataWritten,true);assert.deepEqual([...r.bytes],[0x34,0x12].slice(raw-0xb000,raw-0xb000+width));}
  this.pagingReads.push({raw,bytes:Array.from(r.bytes),generation:r.generation,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta});return r;
 }
 writePhysical(raw,bytes){
  assert.ok(this.running&&!this.active&&!this.closed,'write lifecycle before arguments');const next=validatePageFaultWrite(raw,bytes,this.pagingState),operand=Uint8Array.from(bytes),before=this._generation(raw),r=super.writePhysical(raw,operand);
  assert.equal(r.kind,1);assert.equal(r.decoded,raw);assert.equal(r.effect,1);assert.equal(r.mappingEpoch,0);assert.equal(r.boardA20,1);assert.deepEqual(r.bytes,operand);assert.equal(r.generation,before+1);
  this.pagingState.boot=next.nextBoot;if(next.kind==='ad'||next.kind==='repair')this.pagingState.tableValues[raw]=next.after;if(next.kind==='frame')this.pagingState.frameWords=next.nextFrameWords;
  if(next.kind==='repair')this.pagingState.repaired=true;if(next.kind==='retry')this.pagingState.dataWritten=true;
  this.ramBootStores=this.pagingState.boot;this.ramStoreIndex++;this.ramWrites.push({kind:next.kind,raw,bytes:Array.from(operand),before:next.before,after:next.after,generation:r.generation,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,cycles:this.machine.cycles});return r;
 }
`;
export function transformPagedPageFaultProvider(bytes){let s=authenticated(bytes,providerParentSha256,'held fault-refusing INT provider');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};const many=(old,next,count,label)=>{assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 many('SourcePagedIntIretBoard','SourcePagedPageFaultBoard',2,'new private PF board');once('createOwnedPagedIntIretProvider','createOwnedPagedPageFaultProvider','new noarg PF factory');
 once('validateIntWrite,validateIntRead,expectedRamPage','validatePageFaultWrite,validatePageFaultRead,expectedRamPage','new exact PF frame/repair/retry guards');
 once('boot:0,admitted:false,frameWords:0,tableValues:','boot:0,admitted:false,frameWords:0,repaired:false,dataWritten:false,tableValues:','separate actual PF effects state');
 const a=s.indexOf(' span(raw,width,options){'),b=s.indexOf(' nativeTick(){',a);assert.ok(a>=0&&b>a);once(s.slice(a,b),memoryMethods,'native successful memory bytes; no synthetic fault frames');
 once('assert.equal(this.pagingState.boot,20);',`assert.equal(this.pagingState.boot,${bootStores.length});`,'all fixed boot stores before RAM fetch');once('assert.equal(r.generation,5);',`assert.equal(r.generation,${Math.ceil(ramProgram.length/4)});`,'exact full RAM code publication generation');
 once('frameWords:this.pagingState.frameWords,writes:','frameWords:this.pagingState.frameWords,repaired:this.pagingState.repaired,dataWritten:this.pagingState.dataWritten,writes:','actual frame/repair/retry copied progress');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'PF provider inverse '+e.label);assert.equal(sha256(inverse),providerParentSha256);return {bytes:Buffer.from(s),edits,baseSha256:providerParentSha256};
}
export function derivePagedPageFaultProvider(){authenticated(readFileSync(new URL('../bochs-cpu3-native-paged-int-iret/provider-derivation.mjs',import.meta.url)),providerModuleSha256,'held INT provider module');return transformPagedPageFaultProvider(derivePagedIntIretProvider().bytes);}
