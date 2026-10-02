/** Generate only a profiler NAPI derivative of the authenticated ABI2 bridge. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const originalNapiSha256='a131583191a71a4a675c66339440d5ce6b4ae1332d5b14bef10d7a8d47e36c40';
export const profileBuckets=Object.freeze(['native_resume_inclusive','resume_return_conversion','scalar_whole','memory_whole','page_whole','scalar_arguments_scopes','scalar_op_call','scalar_return_validation','scalar_mapping_call','scalar_mapping_fields','scalar_scope_close','scalar_native_tick','scalar_quantum','scalar_pio','scalar_ack']);
const instrumentation=String.raw`
enum np_bucket_id { NP_RESUME,NP_SNAPSHOT,NP_SCALAR,NP_MEMORY,NP_PAGE,NP_ARGS,NP_OP,NP_RETURN,NP_MAP_CALL,NP_MAP_FIELDS,NP_CLOSE,NP_TICK,NP_Q,NP_PIO,NP_ACK,NP_COUNT };
struct np_bucket { uint64_t calls=0,ns=0,max_ns=0; };
static np_bucket np_buckets[NP_COUNT];
static bool np_enabled=false,np_in_resume=false,np_overflow=false,np_emitted=false,np_clock_regression=false;
static uint64_t np_clock_reads=0,np_resume_success=0,np_callback_calls=0,np_callback_depth=0,np_max_depth=0,np_nested=0;
static void np_configure(){const char *value=std::getenv("BW_HOT_NAPI_PROFILE");np_enabled=value&&std::strcmp(value,"1")==0;}
static uint64_t np_now(){++np_clock_reads;return (uint64_t)std::chrono::duration_cast<std::chrono::nanoseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();}
static uint64_t np_elapsed(uint64_t end,uint64_t start){if(end<start){np_clock_regression=true;return 0;}return end-start;}
static void np_add(np_bucket_id id,uint64_t ns){np_bucket &b=np_buckets[id];if(b.calls==UINT64_MAX||ns>UINT64_MAX-b.ns){np_overflow=true;return;}++b.calls;b.ns+=ns;if(ns>b.max_ns)b.max_ns=ns;}
struct np_resume_timer {
 bool active;uint64_t start=0;
 np_resume_timer():active(np_enabled){if(active){start=np_now();np_in_resume=true;}}
 ~np_resume_timer(){if(active){const uint64_t end=np_now();np_in_resume=false;np_add(NP_RESUME,np_elapsed(end,start));}}
};
struct np_snapshot_timer {
 bool active;uint64_t start=0;
 np_snapshot_timer():active(np_enabled){if(active)start=np_now();}
 ~np_snapshot_timer(){if(active)np_add(NP_SNAPSHOT,np_elapsed(np_now(),start));}
};
struct np_callback_timer {
 bool active;np_bucket_id whole,part;uint64_t start=0,part_start=0;bool partition=false;uint32_t scalar_op=0;
 explicit np_callback_timer(np_bucket_id id,uint32_t op=0):active(np_in_resume),whole(id),part(NP_ARGS),scalar_op(op){if(active){start=part_start=np_now();++np_callback_calls;++np_callback_depth;if(np_callback_depth>np_max_depth)np_max_depth=np_callback_depth;if(np_callback_depth>1)++np_nested;partition=id==NP_SCALAR;}}
 void next(np_bucket_id id){if(active&&partition){const uint64_t end=np_now();np_add(part,np_elapsed(end,part_start));part=id;part_start=end;}}
 ~np_callback_timer(){if(active){const uint64_t end=np_now();if(partition)np_add(part,np_elapsed(end,part_start));np_add(whole,np_elapsed(end,start));if(whole==NP_SCALAR&&scalar_op>=1&&scalar_op<=4)np_add((np_bucket_id)(NP_TICK+scalar_op-1),np_elapsed(end,start));--np_callback_depth;}}
};
static bool np_emit(){
 if(!np_enabled)return true;
 if(np_emitted)return false;
 np_emitted=true;
 const char *names[]={"native_resume_inclusive","resume_return_conversion","scalar_whole","memory_whole","page_whole","scalar_arguments_scopes","scalar_op_call","scalar_return_validation","scalar_mapping_call","scalar_mapping_fields","scalar_scope_close","scalar_native_tick","scalar_quantum","scalar_pio","scalar_ack"};
 if(std::fprintf(stderr,"BWNP1\tHEADER\t1\tnanoseconds\tresume-only\n")<0)return false;
 if(std::fprintf(stderr,"BWNP1\tCONTROL\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%u\t%u\n",np_resume_success,np_callback_calls,np_max_depth,np_nested,np_clock_reads,np_callback_depth,np_overflow?1U:0U,np_clock_regression?1U:0U)<0)return false;
 for(unsigned i=0;i<NP_COUNT;++i)if(std::fprintf(stderr,"BWNP1\tBUCKET\t%s\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",names[i],np_buckets[i].calls,np_buckets[i].ns,np_buckets[i].max_ns)<0)return false;
 return std::fflush(stderr)==0;
}
`;
export function deriveProfiledNapi(){
 const bytes=readFileSync(new URL('../bochs-cpu3-native-direct-board-adapter/napi.cc',import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==originalNapiSha256)throw Error('original ABI2 NAPI source hash changed');
 let source=bytes.toString();const once=(from,to)=>{if(source.split(from).length!==2)throw Error('profiler NAPI seam changed: '+from.slice(0,90));source=source.replace(from,to);};
 once('#include <mutex>','#include <mutex>\n#include <chrono>\n#include <cstdlib>\n#include <cstdio>\n#include <cinttypes>');
 once('bool ok(napi_status s)',instrumentation+'\nbool ok(napi_status s)');
 once('int memory(void*,uint32_t raw,uint32_t len,const uint8_t *operand,uint8_t *observed,bw_direct_metadata *m){','int memory(void*,uint32_t raw,uint32_t len,const uint8_t *operand,uint8_t *observed,bw_direct_metadata *m){np_callback_timer profile(NP_MEMORY);');
 once('int page(void*,uint32_t raw,uint8_t *dst,bw_direct_page_metadata *m){','int page(void*,uint32_t raw,uint8_t *dst,bw_direct_page_metadata *m){np_callback_timer profile(NP_PAGE);');
 const begin=source.indexOf('int scalar('),end=source.indexOf('\nbw_direct_callbacks callbacks=',begin);if(begin<0||end<0)throw Error('scalar function bounds changed');
 const originalScalar=source.slice(begin,end);
 const profiledScalar=String.raw`int scalar(void*,uint32_t op,uint32_t a,uint32_t b,uint32_t c,uint32_t *value,uint32_t *a20,uint32_t *epoch){
 np_callback_timer profile(NP_SCALAR,op);
 napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;
 napi_value args[3]={number(a),number(b),number(c)},r,state;
 const char *name=op==1?"nativeTick":op==2?"quantum":op==3?"outPort":op==4?"acknowledgeIrq":nullptr;
 profile.next(NP_OP);bool success=name&&call(name,op==3?3:op==2?1:0,args,&r);
 profile.next(NP_RETURN);if(success)success=op==3?field(r,"value",value):u32(r,value);
 if(success){if(op==3){profile.next(NP_MAP_FIELDS);success=field(r,"mappingEpoch",epoch)&&field(r,"boardA20",a20);}else{profile.next(NP_MAP_CALL);success=call("mappingState",0,nullptr,&state);profile.next(NP_MAP_FIELDS);if(success)success=field(state,"mappingEpoch",epoch)&&field(state,"boardA20",a20);}}
 profile.next(NP_CLOSE);napi_close_handle_scope(env,scope);return success;
}`;
 once(originalScalar,profiledScalar);
 once('initialized=true;owner=std::this_thread::get_id();busy=true;','np_configure();initialized=true;owner=std::this_thread::get_id();busy=true;');
 once('closed=true;napi_delete_reference(env,board);board=nullptr;napi_value v;','closed=true;napi_delete_reference(env,board);board=nullptr;if(!np_emit())return fail("hot profiler diagnostic output failed");napi_value v;');
 once('busy=true;int success=bw_direct_resume(n,q,deadline,&result);busy=false;', 'busy=true;int success;{np_resume_timer profile;success=bw_direct_resume(n,q,deadline,&result);}busy=false;if(np_enabled&&success)++np_resume_success;');
 once('if(!success)return fail("native resume rejected");napi_value out=snapshot();','if(!success)return fail("native resume rejected");np_snapshot_timer profile_snapshot;napi_value out=snapshot();');
 return Buffer.from('/* Separate opt-in resume cost instrumentation; ABI2 exports unchanged. */\n'+source);
}
