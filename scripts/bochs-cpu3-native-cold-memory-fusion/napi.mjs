import {readFileSync} from 'node:fs';
import {deriveTypedStateNapi} from '../bochs-cpu3-native-cold-bios-typed-state/napi.mjs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {MEMORY_FUSION_PROFILE} from './provider.mjs';
export const HELD_NAPI_SHA='8929ce31877a3f5a0617f56073c04ca2429bc55bb012b0929f38c24a04a637ab';
export function deriveMemoryFusionNapi(){
 const base=deriveTypedStateNapi();let s=authenticated(base.bytes,HELD_NAPI_SHA,'genuine typed cold NAPI');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('"packedScalar","clockTransfer"};','"packedScalar","clockTransfer","fusedMemory"};','new private callback');
 once('napi_ref cached[5]={};','napi_ref cached[6]={};\nstatic uint64_t fusion_clock_entries[12]={},fusion_memory_entries[3]={};','true outer entry counters separate from logical charges');
 once('i<5;i++','i<6;i++','cached lookup bound');once('return i<5&&','return i<6&&','cached return bound');once('i<5;i++){napi_value fn','i<6;i++){napi_value fn','callback capture bound');
 once('if(success)success=call("clockTransfer",2,args,&r);','if(success){++fusion_clock_entries[reason<=11?reason:0];success=call("clockTransfer",2,args,&r);}','actual clock entries by reason, including failed entries');
 const anchor='bool success=call(operand?"writePhysical":"readPhysical",2,args,&r);';
 once(anchor,'++fusion_memory_entries[operand?1:0];'+anchor,'ordinary read/write entries');
 const start='int page(void*,uint32_t raw,uint8_t *dst,bw_direct_page_metadata *m){';
 let helper=readFileSync(new URL('./bridge.inc',import.meta.url),'utf8');
 helper=helper.replace('if(success)success=write&&call("fusedMemory",6,args,&r);','if(success&&write){++fusion_memory_entries[2];success=call("fusedMemory",6,args,&r);}else success=false;');
 once(start,helper+'\n'+start,'private fused transport, copied expected ledger and replies');
 once('const char *callbackNames[]={','const char *reasonNames[]={"unknown","INIT","ENTRY","MEMORY","PAGE","PRE_PIO","POST_PIO","ACK","FAULT","IRQ","HLT","RETURN"};const char *memoryNames[]={"ordinaryRead","ordinaryWrite","fusedOuter"};napi_set_named_property(env,out,"bridgeClockEntryAttempts",counters(fusion_clock_entries,reasonNames,12));napi_set_named_property(env,out,"bridgeMemoryEntryAttempts",counters(fusion_memory_entries,memoryNames,3));\nconst char *callbackNames[]={','attempted outer bridge-entry evidence');
 once('napi_value init(napi_env e,napi_value exports){napi_value profile;','napi_value init(napi_env e,napi_value exports){napi_value fusionProfile;if(!ok(napi_create_string_utf8(e,"'+MEMORY_FUSION_PROFILE+'",NAPI_AUTO_LENGTH,&fusionProfile))||!ok(napi_set_named_property(e,exports,"memoryFusionProfile",fusionProfile)))return nullptr;napi_value profile;','new profile, held state export and ABI4 unchanged');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==HELD_NAPI_SHA)throw Error('fusion NAPI inverse');
 return {bytes:Buffer.from(s),baseSha256:HELD_NAPI_SHA,edits,memoryFusionProfile:MEMORY_FUSION_PROFILE};
}
