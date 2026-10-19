/** Owned source derivation retains the original clock tape/lease, not a copied harness. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const providerParentSha256='19bb6335c40feeacf12be2dc19d5bd7abbc90ffcb26580785f1ffda98332e107';
export function transformProtectedRamProvider(bytes){
 let s=authenticated(bytes,providerParentSha256,'qualified cold provider');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 const many=(old,next,count,label)=>{assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 once("from './board-profile.mjs';","from './provider-profile.mjs';",'new fixed private profile');
 once('coldInAllowed}', 'coldInAllowed,validateProtectedWrite,validateProtectedRead,expectedRamPage}', 'owned RAM write/page predicates');
 many('SourceColdBiosBoard','SourceProtectedRamBoard',2,'separate source board');
 once('createOwnedColdBiosProvider','createOwnedProtectedRamProvider','separate fixed factory');
 many('coldBoardProfile.totalNativeTicks','coldBoardProfile.maxNativeTicks',2,'N cap is not measured total');
 many('coldBoardProfile.totalQuanta','coldBoardProfile.maxQuanta',2,'Q cap is not measured total');
 once('this.dataReads=0;','this.dataReads=0;this.ramBootStores=0;this.ramAdmitted=false;this.ramWrites=[];','private fixture state');
 const inspect="inspect(){return {...super.inspect(),cold:{phase:this.controllerPhase,statusReads:this.statusReads,dataReads:this.dataReads,debugBytes:[...this.debugBytes],portEventCount:this.portEvents.length}};}";
 once(inspect,inspect.replace('}};}','},ram:{bootStores:this.ramBootStores,admitted:this.ramAdmitted,writes:this.ramWrites.map(e=>({...e,bytes:[...e.bytes]})),code:Array.from(this.machine.mem.subarray(0x7000,0x8000)),gdt:Array.from(this.machine.mem.subarray(0,0x1000))}};}'),'detached RAM effect evidence');
 const write=String.raw` readPhysical(raw,width){
  assert.ok(this.running&&!this.active&&!this.closed,'read lifecycle before arguments');validateProtectedRead(raw,width);return super.readPhysical(raw,width);
 }
 writePhysical(raw,bytes){
  assert.ok(this.running&&!this.active&&!this.closed,'write lifecycle before arguments');
  const next=validateProtectedWrite(raw,bytes,this.ramBootStores,this.ramAdmitted),operand=Uint8Array.from(bytes),result=super.writePhysical(raw,operand);
  assert.equal(result.kind,1);assert.equal(result.decoded,raw);assert.equal(result.effect,1);assert.equal(result.mappingEpoch,0);assert.equal(result.boardA20,1);
  assert.deepEqual(result.bytes,operand);assert.equal(result.generation,(this.ramBootStores%2)+1);
  this.ramBootStores=next;this.ramWrites.push({raw,bytes:Array.from(operand),generation:result.generation,nativeTicks:this.nativeTicks,successfulQuanta:this.successfulQuanta,cycles:this.machine.cycles});return result;
 }
`;
 once(' nativeTick(){',write+' nativeTick(){','exact ordinary host write protocol');
 const page="admitExecutePage(raw){assert.ok(this.running&&!this.active&&!this.closed,'ROM page lifecycle');const span=this.span(raw,4096,{execute:true});assert.ok(span.kind===2&&((span.decoded>=0xf0000&&span.decoded+4096<=0x100000)||(span.decoded>=0xff0000&&span.decoded+4096<=0x1000000)),'cold ROM-only execution');return super.admitExecutePage(raw);}";
 once(page,String.raw`admitExecutePage(raw){assert.ok(this.running&&!this.active&&!this.closed,'owned page lifecycle');const span=this.span(raw,4096,{execute:true});
  assert.ok(span.kind===1?raw===0x7000&&span.decoded===0x7000:span.kind===2&&((span.decoded>=0xf0000&&span.decoded+4096<=0x100000)||(span.decoded>=0xff0000&&span.decoded+4096<=0x1000000)),'one RAM page or fixed ROM');
  if(span.kind===1){assert.equal(this.ramBootStores,4,'initialize before page admission');assert.deepEqual(this.machine.mem.subarray(0x7000,0x8000),expectedRamPage(),'source-owned code/backing before copy');}
  const result=super.admitExecutePage(raw);if(span.kind===1){assert.equal(result.generation,2);this.ramAdmitted=true;}return result;
 }`,'one initialized ordinary RAM page');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'provider inverse '+e.label);
 assert.equal(sha256(inverse),providerParentSha256,'provider exact inverse');return {bytes:Buffer.from(s),baseSha256:providerParentSha256,edits};
}
export function deriveProtectedRamProvider(){return transformProtectedRamProvider(readFileSync(new URL('../bochs-cpu3-native-cold-bios/board-provider.mjs',import.meta.url)));}
/** Source-only factory. Only owned import URLs are resolved; no input source or hooks. */
export async function createOwnedProtectedRamProvider(...args){
 assert.equal(args.length,0,'no caller ROM/config/hooks');const source=deriveProtectedRamProvider().bytes.toString();
 const resolved=source.replace(/from (['"])([^'"]+)\1/g,(_,quote,path)=>`from ${quote}${new URL(path,import.meta.url).href}${quote}`);
 const module=await import('data:text/javascript;base64,'+Buffer.from(resolved).toString('base64'));return module.createOwnedProtectedRamProvider();
}
