/** Exact new private factory derivative, retaining authentic lease/clock/generation effects. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveProtectedRamProvider} from '../bochs-cpu3-native-protected-ram/provider-derivation.mjs';
export const providerParentSha256='ba1c3c76e5a74dd65c9129527f23d7f744ff3f7955f624fff08034242218071e';
export const providerModuleSha256='2a5242b97b385efa3ba759228d7cc73d7ff96d82226182f774f537d7cd1c4ab6';
export function transformProtectedStackProvider(bytes){let s=authenticated(bytes,providerParentSha256,'qualified protected provider');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};const many=(old,next,count,label)=>{assert.equal(s.split(old).length-1,count,label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 many('SourceProtectedRamBoard','SourceProtectedStackBoard',2,'separate source board');once('createOwnedProtectedRamProvider','createOwnedProtectedStackProvider','separate fixed factory');
 once('this.ramBootStores=0;','this.ramBootStores=0;this.ramStoreIndex=0;','distinct boot/total store state');
 once('ram:{bootStores:this.ramBootStores,','ram:{storeCount:this.ramStoreIndex,bootStores:this.ramBootStores,','actual counters');
 once('gdt:Array.from(this.machine.mem.subarray(0,0x1000))','gdt:Array.from(this.machine.mem.subarray(0,0x1000)),stack:Array.from(this.machine.mem.subarray(0x8000,0x9000))','third copied host page');
 once('validateProtectedWrite(raw,bytes,this.ramBootStores,this.ramAdmitted)','validateProtectedWrite(raw,bytes,this.ramStoreIndex,this.ramAdmitted)','ordered complete store index');
 once('assert.equal(result.generation,(this.ramBootStores%2)+1);','assert.equal(result.generation,this.ramStoreIndex<4?this.ramStoreIndex+1:this.ramStoreIndex<11?this.ramStoreIndex-3:this.ramStoreIndex-10);','authentic per-page GDT4/code7/stack2 generations');
 once('this.ramBootStores=next;','this.ramStoreIndex=next;this.ramBootStores=Math.min(next,11);','retain exact boot count after stack effects');
 once("assert.equal(this.ramBootStores,4,'initialize before page admission');","assert.equal(this.ramBootStores,11,'initialize before page admission');",'all boot bytes before fetch');once('assert.equal(result.generation,2);this.ramAdmitted=true;','assert.equal(result.generation,7);this.ramAdmitted=true;','complete code generation');
 let inverse=s;for(const e of [...edits].reverse())if(e.count){assert.equal(inverse.split(e.next).length-1,e.count);inverse=inverse.split(e.next).join(e.old);}else inverse=replacement(inverse,e.next,e.old,'stack provider inverse '+e.label);assert.equal(sha256(inverse),providerParentSha256);return {bytes:Buffer.from(s),edits,baseSha256:providerParentSha256};}
export function deriveProtectedStackProvider(){authenticated(readFileSync(new URL('../bochs-cpu3-native-protected-ram/provider-derivation.mjs',import.meta.url)),providerModuleSha256,'held protected provider module');return transformProtectedStackProvider(deriveProtectedRamProvider().bytes);}
export async function createOwnedProtectedStackProvider(...args){assert.equal(args.length,0,'no caller ROM/config/hooks');const source=deriveProtectedStackProvider().bytes.toString().replace(/from (['"])([^'"]+)\1/g,(_,q,p)=>`from ${q}${new URL(p,import.meta.url).href}${q}`);const module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));return module.createOwnedProtectedStackProvider();}
