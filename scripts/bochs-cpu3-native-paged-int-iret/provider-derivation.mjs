/** Exact reviewed provider derivative. New private factory, copied state only. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveNonidentityPagingProvider} from '../bochs-cpu3-native-nonidentity-paging/provider-derivation.mjs';
export const providerParentSha256='a362a5be1efc591c5bdf062c65fcf41288868436721bc10c805d852f45fcbb65';
export const providerModuleSha256='0c457d7991414e650df7e3ce3fca5bbf04ec3770a9ea58b4f0995918bcfbdf48';
const memoryMethods=String.raw` span(raw,width,options){
  if(options?.execute){assert.equal(width,4096);assert.ok(Number.isSafeInteger(raw)&&raw>=0&&raw<=0xffffffff&&(raw&4095)===0);
   if(raw===0xa000){for(let i=0;i<4096;i+=16){const s=super.span(raw+i,16);assert.equal(s.decoded,raw+i);assert.equal(s.kind,1);}return {decoded:raw,kind:1};}
   assert.ok(raw>=0xf0000&&raw<=0xff000||raw>=0xffff0000||raw>=0xff0000&&raw<=0xfff000,'fixed ROM or physical A000 only');
  }
  return super.span(raw,width,options);
 }
 readPhysical(raw,width){
  assert.ok(this.running&&!this.active&&!this.closed,'read lifecycle before arguments');validateIntRead(raw,width);const r=super.readPhysical(raw,width);
  assert.equal(r.decoded,raw);assert.equal(r.effect,0);assert.equal(r.mappingEpoch,0);assert.equal(r.boardA20,1);
  if(Object.hasOwn(this.pagingState.tableValues,raw)){assert.equal(width,4);assert.equal(wordAt(r.bytes,0),this.pagingState.tableValues[raw]);}
  if(raw>=0xcffa&&raw<0xd000){assert.equal(this.pagingState.frameWords,3);const expected=[5,0x70,0x18,0,2,0];assert.deepEqual([...r.bytes],expected.slice(raw-0xcffa,raw-0xcffa+width));}
  this.pagingReads.push({raw,bytes:Array.from(r.bytes),generation:r.generation,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta});return r;
 }
 writePhysical(raw,bytes){
  assert.ok(this.running&&!this.active&&!this.closed,'write lifecycle before arguments');const next=validateIntWrite(raw,bytes,this.pagingState),operand=Uint8Array.from(bytes),before=this._generation(raw),r=super.writePhysical(raw,operand);
  assert.equal(r.kind,1);assert.equal(r.decoded,raw);assert.equal(r.effect,1);assert.equal(r.mappingEpoch,0);assert.equal(r.boardA20,1);assert.deepEqual(r.bytes,operand);assert.equal(r.generation,before+1);
  this.pagingState.boot=next.nextBoot;if(next.kind==='ad')this.pagingState.tableValues[raw]=next.after;if(next.kind==='frame')this.pagingState.frameWords=next.nextFrameWords;
  this.ramBootStores=this.pagingState.boot;this.ramStoreIndex++;this.ramWrites.push({kind:next.kind,raw,bytes:Array.from(operand),before:next.before,after:next.after,generation:r.generation,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,cycles:this.machine.cycles});return r;
 }
`;
export function transformPagedIntIretProvider(bytes){let s=authenticated(bytes,providerParentSha256,'qualified nonidentity paging provider');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};const many=(old,next,count,label)=>{assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 many('SourceNonidentityPagingBoard','SourcePagedIntIretBoard',2,'new private board');once('createOwnedNonidentityPagingProvider','createOwnedPagedIntIretProvider','new noarg factory');
 once('validatePagingWrite,validatePagingRead,expectedRamPage','validateIntWrite,validateIntRead,expectedRamPage','new fixed frame/entry readwrite imports');
 once('boot:0,admitted:false,dataRead:false,dataWritten:false,tableValues:','boot:0,admitted:false,frameWords:0,tableValues:','separate native frame state; no JS tape assumption');
 const a=s.indexOf(' span(raw,width,options){'),b=s.indexOf(' nativeTick(){',a);assert.ok(a>=0&&b>a);once(s.slice(a,b),memoryMethods,'authentic copied native memory results and exact frame callbacks');
 once('assert.equal(this.pagingState.boot,16);','assert.equal(this.pagingState.boot,20);','exact new boot write count before code fetch');once('assert.equal(r.generation,4);','assert.equal(r.generation,5);','five code dword stores');
 once('admitted:this.ramAdmitted,writes:','admitted:this.ramAdmitted,frameWords:this.pagingState.frameWords,writes:','actual frame progress with ten copied physical pages');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'INT provider inverse '+e.label);assert.equal(sha256(inverse),providerParentSha256);return {bytes:Buffer.from(s),edits,baseSha256:providerParentSha256};
}
export function derivePagedIntIretProvider(){authenticated(readFileSync(new URL('../bochs-cpu3-native-nonidentity-paging/provider-derivation.mjs',import.meta.url)),providerModuleSha256,'held paging provider module');return transformPagedIntIretProvider(deriveNonidentityPagingProvider().bytes);}
export async function createOwnedPagedIntIretProvider(...args){assert.equal(args.length,0);const text=derivePagedIntIretProvider().bytes.toString().replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,import.meta.url).href}${q}`);return (await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))).createOwnedPagedIntIretProvider();}
