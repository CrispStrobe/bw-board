/** Distinct ABI5 same-DSO N-API derivation; retained compact progress and typed state. */
import {readFileSync} from 'node:fs';
import {deriveCompactProgressNapi} from '../bochs-cpu3-native-compact-progress/napi.mjs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const HELD_NAPI_SHA='e2dd44b17846cd20163d38b78fae4f7cf86b33806f06eb73b976fd4a828d0e68';
export function deriveDirectRamNapi(){
 const base=deriveCompactProgressNapi();let s=authenticated(base.bytes,HELD_NAPI_SHA,'compact cold NAPI');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('#include <mutex>\n#include "../bochs-cpu3-native-direct-board/abi.h"',
  '#include <mutex>\n#include <array>\n#include <memory>\n#include <vector>\n#include <stdexcept>\n#include "../bochs-cpu3-native-direct-board/abi.h"\n#include "../bochs-cpu3-native-cold-direct-ram/bridge.h"',
  'same-DSO owner header and fixed storage');
 once('const char *const cached_names[]={"readPhysical","writePhysical","admitExecutePage","packedScalar","clockTransfer","fusedMemory"};',
  'const char *const cached_names[]={"admitExecutePage","packedScalar","clockTransfer","reconcileFull","reconcilePaused"};','retain nonmemory callbacks only');
 once('napi_ref cached[6]={};','napi_ref cached[5]={};','exact callback refs');
 once('napi_value number(uint32_t n){napi_value v;napi_create_uint32(env,n,&v);return v;}',
  'napi_value number(uint32_t n){napi_value v=nullptr;return ok(napi_create_uint32(env,n,&v))?v:nullptr;}',
  'checked result construction after native effects');
 once('for(;i<6;i++)','for(;i<5;i++)','cached lookup bound');once('return i<6&&','return i<5&&','cached return bound');
 once('for(unsigned i=0;i<6;i++){napi_value fn','for(unsigned i=0;i<5;i++){napi_value fn','callback capture bound');
 once('int clock_transfer(void*,',readFileSync(new URL('./owner.inc',import.meta.url),'utf8')+'\nint clock_transfer(void*,','same-DSO owner and scoped reconciliation');
 once('success=call("clockTransfer",2,args,&r);','success=direct_call_clock(args,&r,words,count,reason);','clock callback scope');
 const obsoleteStart=s.indexOf('bool metadata(napi_value r,bw_direct_metadata *m)');
 const obsoleteEnd=s.indexOf('int page(void*,',obsoleteStart);
 if(obsoleteStart<0||obsoleteEnd<0)throw Error('direct RAM obsolete JS/fused memory span');
 once(s.slice(obsoleteStart,obsoleteEnd),'','remove all JS physical/fused memory callback transport');
 once('call("admitExecutePage",1,&arg,&r)','direct_call_page(&arg,&r,raw)','page callback scope');
 once('call("packedScalar",4,args,&r)','direct_call_scalar(args,&r,op,a,b,c)','scalar callback scope');
 const returned='napi_close_handle_scope(env,scope);return success;';
 const guarded='const bool scope_ok=ok(napi_close_handle_scope(env,scope));if(!success||!scope_ok){direct_poison();return 0;}return 1;';
 if(s.split(returned).length!==4)throw Error('exact three retained callback return seams');
 s=s.replaceAll(returned,guarded);edits.push({old:returned,next:guarded,label:'fail-stop on post-ACK callback decode/return failure',count:3});
 once('bw_direct_callbacks callbacks={sizeof(bw_direct_callbacks),4,nullptr,clock_transfer,memory,page,scalar};',
  'bw_direct_callbacks callbacks={sizeof(bw_direct_callbacks),BW_COLD_DIRECT_RAM_ABI_VERSION,nullptr,clock_transfer,nullptr,page,scalar};',
  'ABI5 no JS memory callback');
 once('if(!lock.owns_lock()||busy||(initialized&&std::this_thread::get_id()!=owner)){napi_throw_error(e,nullptr,"direct concurrent, thread or reentry rejected");return nullptr;}',
  'if(!lock.owns_lock()||busy||direct_creating||(initialized&&(e!=env||std::this_thread::get_id()!=owner))){if(direct_creating)direct_create_violation=true;if((busy||direct_creating)&&e==env)direct_poison();napi_throw_error(e,nullptr,"direct concurrent, thread or reentry rejected");return nullptr;}',
  'process-global CPU3 environment and thread gate');
 once('if(initialized||argc!=4)return fail("one create lifetime requires config, ROM, board, capture");uint8_t *rom;',
  'if(initialized||argc!=4)return fail("one create lifetime requires config, ROM, board, capture");struct CreateGuard{CreateGuard(){direct_create_violation=false;direct_creating=true;}~CreateGuard(){direct_creating=false;}} create_guard;uint8_t *rom;',
  'reject recursive create before borrowed argument and callback properties');
 once('if(config.find(\'\\0\')!=size)return fail("configuration contains NUL");if(!ok(napi_create_reference(env,argv[2],1,&board)))',
  'if(config.find(\'\\0\')!=size)return fail("configuration contains NUL");std::array<uint8_t,65536> direct_rom_copy;memcpy(direct_rom_copy.data(),rom,65536);rom=direct_rom_copy.data();if(!ok(napi_create_reference(env,argv[2],1,&board)))',
  'copy borrowed ROM before any callback property getters');
 once('if(!capture_cached(argv[2])){napi_delete_reference(env,board);board=nullptr;return fail("owned callback capture rejected");}',
  'if(!capture_cached(argv[2])||!direct_bind(argv[2],rom)||direct_create_violation){direct_poison();direct_owner.reset();direct_release_refs();direct_owner_env=nullptr;release_cached();napi_delete_reference(env,board);board=nullptr;return fail("ABI5 direct owner/callback binding rejected");}',
  'unique copied RAM/ROM and strong backing refs before CPU bootstrap');
 once('if(!result){closed=true;release_cached();napi_delete_reference(env,board);board=nullptr;return fail("native initialize rejected");}',
  'if(!result){closed=true;direct_poison();direct_owner.reset();direct_release_refs();direct_owner_env=nullptr;release_cached();napi_delete_reference(env,board);board=nullptr;return fail("native initialize rejected");}',
  'failed CPU bootstrap terminal owner cleanup');
 once('if(!bw_direct_close())return fail("native close rejected");closed=true;release_cached();',
  'if(!bw_direct_close())return fail("native close rejected");if(!direct_close())return fail("direct owner close rejected");closed=true;release_cached();',
  'CPU then owner close with zero pending extent');
 once('return progress_return(result);','napi_value out=progress_return(result);if(!out)direct_poison();return out;',
  'fail-stop after compact resume return construction');
 once('napi_value out;napi_create_object(env,&out);for(size_t i=0;i<count;i++){napi_value value;napi_create_bigint_uint64(env,values[i],&value);napi_set_named_property(env,out,names[i],value);}return out;',
  'napi_value out=nullptr;if(!ok(napi_create_object(env,&out)))return nullptr;for(size_t i=0;i<count;i++){napi_value value=nullptr;if(!ok(napi_create_bigint_uint64(env,values[i],&value))||!ok(napi_set_named_property(env,out,names[i],value)))return nullptr;}return out;',
  'checked counter construction');
 once('napi_value out;napi_create_object(env,&out);if(!copied_state(out,"state",',
  'napi_value out=nullptr;if(!ok(napi_create_object(env,&out)))return nullptr;if(!copied_state(out,"state",',
  'checked snapshot object after effects');
 once('napi_value n,q;napi_create_bigint_uint64(env,s.native_ticks,&n);napi_create_bigint_uint64(env,s.successful_quanta,&q);napi_set_named_property(env,out,"nativeTicks",n);napi_set_named_property(env,out,"successfulQuanta",q);napi_set_named_property(env,out,"mappingEpoch",number(s.mapping_epoch));napi_set_named_property(env,out,"boardA20",number(s.board_a20));',
  'napi_value n=nullptr,q=nullptr,epoch=number(s.mapping_epoch),a20=number(s.board_a20);if(!epoch||!a20||!ok(napi_create_bigint_uint64(env,s.native_ticks,&n))||!ok(napi_create_bigint_uint64(env,s.successful_quanta,&q))||!ok(napi_set_named_property(env,out,"nativeTicks",n))||!ok(napi_set_named_property(env,out,"successfulQuanta",q))||!ok(napi_set_named_property(env,out,"mappingEpoch",epoch))||!ok(napi_set_named_property(env,out,"boardA20",a20)))return nullptr;',
  'checked snapshot ledgers');
 once('napi_set_named_property(env,out,"clockTransfers",counters(s.clock_transfer_counts,clockNames,3));',
  'napi_value clockCounters=counters(s.clock_transfer_counts,clockNames,3);if(!clockCounters||!ok(napi_set_named_property(env,out,"clockTransfers",clockCounters)))return nullptr;',
  'checked clock counters');
 once('napi_set_named_property(env,out,"bridgeClockEntryAttempts",counters(fusion_clock_entries,reasonNames,12));napi_set_named_property(env,out,"bridgeMemoryEntryAttempts",counters(fusion_memory_entries,memoryNames,3));',
  'napi_value bridgeClock=counters(fusion_clock_entries,reasonNames,12),bridgeMemory=counters(fusion_memory_entries,memoryNames,3);if(!bridgeClock||!bridgeMemory||!ok(napi_set_named_property(env,out,"bridgeClockEntryAttempts",bridgeClock))||!ok(napi_set_named_property(env,out,"bridgeMemoryEntryAttempts",bridgeMemory)))return nullptr;',
  'checked bridge counters');
 once('napi_set_named_property(env,out,"callbacks",counters(s.callback_counts,callbackNames,5));napi_set_named_property(env,out,"fallback",counters(s.fallback_counts,fallbackNames,5));napi_set_named_property(env,out,"execution",counters(s.execution_counts,executionNames,8));return out;',
  'napi_value callbacks=counters(s.callback_counts,callbackNames,5),fallback=counters(s.fallback_counts,fallbackNames,5),execution=counters(s.execution_counts,executionNames,8);if(!callbacks||!fallback||!execution||!ok(napi_set_named_property(env,out,"callbacks",callbacks))||!ok(napi_set_named_property(env,out,"fallback",fallback))||!ok(napi_set_named_property(env,out,"execution",execution)))return nullptr;return out;',
  'checked callback, fallback, and execution counters');
 once('napi_value out=snapshot();if(!out)return nullptr;',
  'napi_value out=snapshot();if(!out){direct_poison();return nullptr;}',
  'fail-stop after ordinary resume snapshot construction');
 once('if(strcmp(op,"inspect")==0)return snapshot();',
  'if(strcmp(op,"inspect")==0){napi_value inspected=snapshot();if(!inspected)direct_poison();return inspected;}',
  'fail-stop on inspect snapshot construction');
 {const old='return snapshot();',next='napi_value out=snapshot();if(!out)direct_poison();return out;';
  if(s.split(old).length!==3)throw Error('exact create/IRQ snapshot seams');
  s=s.replaceAll(old,next);edits.push({old,next,label:'fail-stop on create and IRQ snapshot construction',count:2});}
 once('napi_set_named_property(env,out,"sliceBytes",copied((uint8_t*)&result,sizeof result));napi_set_named_property(env,out,"reason",number(result.reason));napi_set_named_property(env,out,"activityState",number(result.activity_state));napi_set_named_property(env,out,"chargedNativeTicks",number(result.charged_native_ticks));napi_set_named_property(env,out,"chargedQuanta",number(result.charged_quanta));return out;',
  'napi_value slice=copied((uint8_t*)&result,sizeof result),reason=number(result.reason),activity=number(result.activity_state),ticks=number(result.charged_native_ticks),quanta=number(result.charged_quanta);if(!slice||!reason||!activity||!ticks||!quanta||!ok(napi_set_named_property(env,out,"sliceBytes",slice))||!ok(napi_set_named_property(env,out,"reason",reason))||!ok(napi_set_named_property(env,out,"activityState",activity))||!ok(napi_set_named_property(env,out,"chargedNativeTicks",ticks))||!ok(napi_set_named_property(env,out,"chargedQuanta",quanta))){direct_poison();return nullptr;}return out;',
  'fail-stop on ordinary resume scalar/slice return construction');
 once('napi_value init(napi_env e,napi_value exports){',
  'napi_value init(napi_env e,napi_value exports){if(!ok(napi_add_env_cleanup_hook(e,direct_cleanup,e)))return nullptr;',
  'terminal env cleanup hook');
 once('napi_value fusionProfile;if(!ok(napi_create_string_utf8(e,"bw.cold-native.memory-clock-fusion.v1",NAPI_AUTO_LENGTH,&fusionProfile))||!ok(napi_set_named_property(e,exports,"memoryFusionProfile",fusionProfile)))return nullptr;',
  'napi_value directProfile;if(!ok(napi_create_string_utf8(e,BW_COLD_DIRECT_RAM_PROFILE,NAPI_AUTO_LENGTH,&directProfile))||!ok(napi_set_named_property(e,exports,"directRamProfile",directProfile)))return nullptr;',
  'distinct direct profile export');
 once('napi_create_uint32(e,BW_DIRECT_ABI_VERSION,&version)',
  'napi_create_uint32(e,BW_COLD_DIRECT_RAM_ABI_VERSION,&version)',
  'truthful ABI5 export');
 once('return exports;}\n}\nNAPI_MODULE',
  'for(const char *name:{"directDrain","directCommit","directPage","directFailStop"}){napi_value fn;if(!ok(napi_create_function(e,name,NAPI_AUTO_LENGTH,direct_invoke,(void*)name,&fn))||!ok(napi_set_named_property(e,exports,name,fn)))return nullptr;}napi_value pending;if(!ok(napi_create_function(e,"directPending",NAPI_AUTO_LENGTH,direct_paused_pending,nullptr,&pending))||!ok(napi_set_named_property(e,exports,"directPending",pending)))return nullptr;napi_value paused;if(!ok(napi_create_function(e,"directPaused",NAPI_AUTO_LENGTH,direct_paused_reconcile,nullptr,&paused))||!ok(napi_set_named_property(e,exports,"directPaused",paused)))return nullptr;napi_value status;if(!ok(napi_create_function(e,"directStatus",NAPI_AUTO_LENGTH,direct_status,nullptr,&status))||!ok(napi_set_named_property(e,exports,"directStatus",status)))return nullptr;return exports;}\n}\nNAPI_MODULE',
  'scoped owner reconciliation exports');
 let inverse=s;for(const e of [...edits].reverse())inverse=e.count?
  (()=>{if(inverse.split(e.next).length!==e.count+1)throw Error('inverse '+e.label);return inverse.replaceAll(e.next,e.old);})():e.next===''?
  replacement(inverse,'int page(void*,',e.old+'int page(void*,','inverse '+e.label):
  replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==HELD_NAPI_SHA)throw Error('direct RAM NAPI inverse');
 return {bytes:Buffer.from(s),baseSha256:HELD_NAPI_SHA,edits};
}
