/* H4 owned packed scalar protocol; unprofiled ABI2 exports unchanged. */
/* Synchronous Node bridge. Native owns persistent execute pages; JS spans are copied. */
#include <node_api.h>
#include <cstring>
#include <cmath>
#include <string>
#include <thread>
#include <mutex>
#include "../bochs-cpu3-native-direct-board/abi.h"
namespace {
const char *const cached_names[]={"readPhysical","writePhysical","admitExecutePage","packedScalar","clockTransfer","fusedMemory"};
napi_ref cached[6]={};
static uint64_t fusion_clock_entries[12]={},fusion_memory_entries[3]={};
napi_env env; napi_ref board; bool initialized=false,closed=false,busy=false;
std::thread::id owner;
// Recursive acquisition is detected by busy before touching the active env.
std::recursive_mutex invocation_mutex;
bool ok(napi_status s){return s==napi_ok;}
napi_value fail(const char *s){napi_throw_error(env,nullptr,s);return nullptr;}
napi_value number(uint32_t n){napi_value v;napi_create_uint32(env,n,&v);return v;}
bool get(napi_value o,const char *k,napi_value *v){return ok(napi_get_named_property(env,o,k,v));}
bool u32(napi_value v,uint32_t *n){double d;if(!ok(napi_get_value_double(env,v,&d))||!std::isfinite(d)||d<0||d>4294967295.0||d!=(uint32_t)d)return false;*n=(uint32_t)d;return true;}
bool field(napi_value o,const char *k,uint32_t *n){napi_value v;return get(o,k,&v)&&u32(v,n);}
bool bytes(napi_value v,uint8_t **p,size_t *n){napi_typedarray_type t;napi_value ab;size_t off;void *data;if(!ok(napi_get_typedarray_info(env,v,&t,n,&data,&ab,&off))||t!=napi_uint8_array)return false;bool ordinary=false,detached=true;if(!ok(napi_is_arraybuffer(env,ab,&ordinary))||!ordinary||!ok(napi_is_detached_arraybuffer(env,ab,&detached))||detached)return false;*p=(uint8_t*)data;return true;}
napi_value copied(const uint8_t *p,size_t n){napi_value ab,v;void *dst;if(!ok(napi_create_arraybuffer(env,n,&dst,&ab)))return nullptr;memcpy(dst,p,n);if(!ok(napi_create_typedarray(env,napi_uint8_array,n,ab,0,&v)))return nullptr;return v;}
bool call(const char *name,size_t argc,napi_value *argv,napi_value *result){napi_value self,fn;unsigned i=0;for(;i<6;i++)if(!strcmp(name,cached_names[i]))break;return i<6&&cached[i]&&ok(napi_get_reference_value(env,board,&self))&&ok(napi_get_reference_value(env,cached[i],&fn))&&ok(napi_call_function(env,self,fn,argc,argv,result));}
void release_cached(){for(auto &ref:cached){if(ref)napi_delete_reference(env,ref);ref=nullptr;}}
bool capture_cached(napi_value self){for(unsigned i=0;i<6;i++){napi_value fn;napi_valuetype type;if(!get(self,cached_names[i],&fn)||!ok(napi_typeof(env,fn,&type))||type!=napi_function||!ok(napi_create_reference(env,fn,1,&cached[i]))){release_cached();return false;}}return true;}
int clock_transfer(void*,const uint32_t *words,uint32_t count,uint32_t reason,bw_owned_clock_state *out){
 if(count>900||!out||(count&&!words)||(count==0&&(reason!=BW_OWNED_INIT&&reason!=BW_OWNED_ENTRY&&reason!=BW_OWNED_POST_PIO)))return 0;
 for(uint32_t i=0;i<count;i++)if(words[i]<1||words[i]>3)return 0;
 napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;
 napi_value ab=nullptr,tape=nullptr,r=nullptr,reply_ab=nullptr;void *dst=nullptr;bool success=ok(napi_create_arraybuffer(env,count*4,&dst,&ab));
 if(success&&count)memcpy(dst,words,count*4);
 if(success)success=ok(napi_create_typedarray(env,napi_uint32_array,count,ab,0,&tape));
 napi_value args[2]={tape,number(reason)};
 if(success){++fusion_clock_entries[reason<=11?reason:0];success=call("clockTransfer",2,args,&r);}
 napi_typedarray_type type;size_t length=0,offset=0,backing_length=0;void *data=nullptr,*backing=nullptr;bool ordinary=false,detached=true;uint32_t copied_words[7]={};
 if(success)success=ok(napi_get_typedarray_info(env,r,&type,&length,&data,&reply_ab,&offset))&&type==napi_uint32_array&&length==7&&offset==0&&data&&((uintptr_t)data%alignof(uint32_t))==0;
 if(success)success=ok(napi_is_arraybuffer(env,reply_ab,&ordinary))&&ordinary&&ok(napi_is_detached_arraybuffer(env,reply_ab,&detached))&&!detached;
 if(success)success=ok(napi_get_arraybuffer_info(env,reply_ab,&backing,&backing_length))&&backing==data&&backing_length==28;
 if(success){memcpy(copied_words,data,28);out->n=copied_words[0];out->q=copied_words[1];out->cycles=copied_words[2];out->debt=copied_words[3];out->deadline=copied_words[4];out->epoch=copied_words[5];out->a20=copied_words[6];}
 napi_close_handle_scope(env,scope);return success;
}
bool metadata(napi_value r,bw_direct_metadata *m){return field(r,"decoded",&m->decoded)&&field(r,"kind",&m->kind)&&field(r,"effect",&m->effect)&&field(r,"generation",&m->generation)&&field(r,"mappingEpoch",&m->mapping_epoch)&&field(r,"boardA20",&m->board_a20);}
int memory(void*,uint32_t raw,uint32_t len,const uint8_t *operand,uint8_t *observed,bw_direct_metadata *m){if(len==0||len>16)return 0;napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;napi_value args[2]={number(raw),operand?copied(operand,len):number(len)},r;uint8_t *p;size_t n;++fusion_memory_entries[operand?1:0];bool success=call(operand?"writePhysical":"readPhysical",2,args,&r);napi_value value;if(success)success=get(r,"bytes",&value)&&bytes(value,&p,&n)&&n==len;if(success){memcpy(observed,p,len);success=metadata(r,m);}napi_close_handle_scope(env,scope);return success;}
/* Only the authenticated private fusedMemory provider may satisfy this transport. */
static napi_value fusion_u32(const uint32_t *p,size_t n){
 napi_value ab,v;void *dst=nullptr;
 if(!p||!n||n>900||!ok(napi_create_arraybuffer(env,n*4,&dst,&ab)))return nullptr;
 memcpy(dst,p,n*4);
 if(!ok(napi_create_typedarray(env,napi_uint32_array,n,ab,0,&v)))return nullptr;
 return v;
}
extern "C" int bw_memory_fusion(const uint32_t *words,uint32_t count,const bw_owned_clock_state *expected,uint32_t raw,uint32_t len,const uint8_t *operand,uint8_t *observed,bw_direct_metadata *m,bw_owned_clock_state *out){
 if(!busy||std::this_thread::get_id()!=owner||!words||!count||count>900||!expected||!observed||!m||!out||!len||len>16)return 0;
 for(uint32_t i=0;i<count;i++)if(words[i]<1||words[i]>3)return 0;
 napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;
 const uint32_t e[7]={expected->n,expected->q,expected->cycles,expected->debt,expected->deadline,expected->epoch,expected->a20};
 napi_value tape=fusion_u32(words,count),want=fusion_u32(e,7),write=nullptr,r=nullptr,c=nullptr,memory_reply=nullptr;
 bool success=tape&&want;
 if(success){if(operand)write=copied(operand,len);else success=ok(napi_get_null(env,&write));}
 napi_value args[6]={tape,number(BW_OWNED_MEMORY),number(raw),number(len),write,want};
 if(success&&write){++fusion_memory_entries[2];success=call("fusedMemory",6,args,&r);}else success=false;
 napi_value ab=nullptr; napi_typedarray_type type;size_t n=0,off=0,backing_length=0;void *data=nullptr,*backing=nullptr;bool ordinary=false,detached=true;uint32_t reply[7]={};
 if(success)success=get(r,"clock",&c)&&ok(napi_get_typedarray_info(env,c,&type,&n,&data,&ab,&off))&&type==napi_uint32_array&&n==7&&off==0&&data&&((uintptr_t)data%alignof(uint32_t))==0;
 if(success)success=ok(napi_is_arraybuffer(env,ab,&ordinary))&&ordinary&&ok(napi_is_detached_arraybuffer(env,ab,&detached))&&!detached;
 if(success)success=ok(napi_get_arraybuffer_info(env,ab,&backing,&backing_length))&&backing==data&&backing_length==28;
 if(success){memcpy(reply,data,28);out->n=reply[0];out->q=reply[1];out->cycles=reply[2];out->debt=reply[3];out->deadline=reply[4];out->epoch=reply[5];out->a20=reply[6];}
 uint8_t *p=nullptr;size_t length=0;napi_value value=nullptr;
 if(success)success=get(r,"memory",&memory_reply)&&get(memory_reply,"bytes",&value)&&bytes(value,&p,&length)&&length==len;
 if(success){memcpy(observed,p,len);success=metadata(memory_reply,m);}
 napi_close_handle_scope(env,scope);return success;
}

int page(void*,uint32_t raw,uint8_t *dst,bw_direct_page_metadata *m){napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;napi_value arg=number(raw),r,v;uint8_t *p;size_t n;bool success=call("admitExecutePage",1,&arg,&r)&&get(r,"bytes",&v)&&bytes(v,&p,&n)&&n==4096;if(success)memcpy(dst,p,4096);if(success)success=field(r,"decoded",&m->decoded)&&field(r,"kind",&m->kind)&&field(r,"generation",&m->generation)&&field(r,"mappingEpoch",&m->mapping_epoch)&&field(r,"boardA20",&m->board_a20);size_t size=0;if(success)success=get(r,"sha256",&v)&&ok(napi_get_value_string_utf8(env,v,m->sha256,65,&size))&&size==64;if(success){for(size_t i=0;i<64;i++)if(!((m->sha256[i]>='0'&&m->sha256[i]<='9')||(m->sha256[i]>='a'&&m->sha256[i]<='f')))success=false;}napi_close_handle_scope(env,scope);return success;}
int scalar(void*,uint32_t op,uint32_t a,uint32_t b,uint32_t c,uint32_t *value,uint32_t *a20,uint32_t *epoch){
 if(op==BW_DIRECT_PIO_IN8&&(b!=1||(a!=0x71&&a!=0x64&&a!=0x60)||c!=0))return 0;
 napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;
 napi_value args[4]={number(op),number(a),number(b),number(c)},r,ab;
 napi_typedarray_type type;size_t length=0,offset=0,backing_length=0;void *data=nullptr,*backing=nullptr;
 bool ordinary=false,detached=true;uint32_t copied_words[3]={};
 bool success=op>=1&&op<=5&&call("packedScalar",4,args,&r);
 if(success)success=ok(napi_get_typedarray_info(env,r,&type,&length,&data,&ab,&offset))&&type==napi_uint32_array&&length==3&&offset==0&&data!=nullptr&&((uintptr_t)data%alignof(uint32_t))==0;
 if(success)success=ok(napi_is_arraybuffer(env,ab,&ordinary))&&ordinary&&ok(napi_is_detached_arraybuffer(env,ab,&detached))&&!detached;
 if(success)success=ok(napi_get_arraybuffer_info(env,ab,&backing,&backing_length))&&backing==data&&backing_length==12;
 if(success){memcpy(copied_words,data,sizeof copied_words);*value=copied_words[0];*epoch=copied_words[1];*a20=copied_words[2];}
 napi_close_handle_scope(env,scope);return success;
}
bw_direct_callbacks callbacks={sizeof(bw_direct_callbacks),4,nullptr,clock_transfer,memory,page,scalar};
bool allowed(){return initialized&&!closed&&!busy&&std::this_thread::get_id()==owner;}
bool copied_state(napi_value out,const char *name,const uint32_t *p,size_t n){napi_value ab,value;void *dst=nullptr;if(!p||!n||n>90||!ok(napi_create_arraybuffer(env,n*sizeof(uint32_t),&dst,&ab)))return false;memcpy(dst,p,n*sizeof(uint32_t));return ok(napi_create_typedarray(env,napi_uint32_array,n,ab,0,&value))&&ok(napi_set_named_property(env,out,name,value));}
napi_value counters(const uint64_t *values,const char *const *names,size_t count){napi_value out;napi_create_object(env,&out);for(size_t i=0;i<count;i++){napi_value value;napi_create_bigint_uint64(env,values[i],&value);napi_set_named_property(env,out,names[i],value);}return out;}
napi_value snapshot(){bw_direct_snapshot s={};if(!bw_direct_inspect(&s))return fail("native inspect rejected");napi_value out;napi_create_object(env,&out);if(!copied_state(out,"state",s.state,20)||!copied_state(out,"extra",s.extra,20)||!copied_state(out,"segments",&s.segments[0][0],90)||!copied_state(out,"system",&s.system[0][0],30)||!copied_state(out,"debug",s.debug,6))return fail("copied typed state export rejected");napi_value n,q;napi_create_bigint_uint64(env,s.native_ticks,&n);napi_create_bigint_uint64(env,s.successful_quanta,&q);napi_set_named_property(env,out,"nativeTicks",n);napi_set_named_property(env,out,"successfulQuanta",q);napi_set_named_property(env,out,"mappingEpoch",number(s.mapping_epoch));napi_set_named_property(env,out,"boardA20",number(s.board_a20));
const char *clockNames[]={"transfers","commits","words"};napi_set_named_property(env,out,"clockTransfers",counters(s.clock_transfer_counts,clockNames,3));
const char *reasonNames[]={"unknown","INIT","ENTRY","MEMORY","PAGE","PRE_PIO","POST_PIO","ACK","FAULT","IRQ","HLT","RETURN"};const char *memoryNames[]={"ordinaryRead","ordinaryWrite","fusedOuter"};napi_set_named_property(env,out,"bridgeClockEntryAttempts",counters(fusion_clock_entries,reasonNames,12));napi_set_named_property(env,out,"bridgeMemoryEntryAttempts",counters(fusion_memory_entries,memoryNames,3));
const char *callbackNames[]={"physicalReads","physicalWrites","executePages","nativeTickCallbacks","quantumCallbacks"};const char *fallbackNames[]={"bochsRamReads","bochsRamWrites","bochsDirectPointers","bochsPio","bochsTimer"};const char *executionNames[]={"attempts","completed","repIterations","repPartial","faults","portCommits","irqDeliveries","haltIdleCuts"};
napi_set_named_property(env,out,"callbacks",counters(s.callback_counts,callbackNames,5));napi_set_named_property(env,out,"fallback",counters(s.fallback_counts,fallbackNames,5));napi_set_named_property(env,out,"execution",counters(s.execution_counts,executionNames,8));return out;}
napi_value invoke(napi_env e,napi_callback_info info){std::unique_lock<std::recursive_mutex> lock(invocation_mutex,std::try_to_lock);if(!lock.owns_lock()||busy||(initialized&&std::this_thread::get_id()!=owner)){napi_throw_error(e,nullptr,"direct concurrent, thread or reentry rejected");return nullptr;}env=e;size_t argc=5;napi_value argv[5];void *data;napi_get_cb_info(env,info,&argc,argv,nullptr,&data);const char *op=(const char*)data;if(strcmp(op,"create")==0){if(initialized||argc!=4)return fail("one create lifetime requires config, ROM, board, capture");uint8_t *rom;size_t len;size_t size;bool capture;if(!bytes(argv[1],&rom,&len)||len!=65536||!ok(napi_get_value_string_utf8(env,argv[0],nullptr,0,&size))||size>16384||!ok(napi_get_value_bool(env,argv[3],&capture)))return fail("invalid create arguments");std::string config(size+1,'\0');napi_get_value_string_utf8(env,argv[0],config.data(),config.size(),&size);if(config.find('\0')!=size)return fail("configuration contains NUL");if(!ok(napi_create_reference(env,argv[2],1,&board)))return fail("board reference rejected");if(!capture_cached(argv[2])){napi_delete_reference(env,board);board=nullptr;return fail("owned callback capture rejected");}initialized=true;owner=std::this_thread::get_id();busy=true;int result=bw_direct_initialize(config.c_str(),rom,len,&callbacks,capture);busy=false;if(!result){closed=true;release_cached();napi_delete_reference(env,board);board=nullptr;return fail("native initialize rejected");}return snapshot();}if(!allowed())return fail("direct lifecycle, thread or reentry rejected");if(strcmp(op,"inspect")==0)return snapshot();if(strcmp(op,"setIRQ")==0){bool asserted;if(argc!=1||!ok(napi_get_value_bool(env,argv[0],&asserted)))return fail("IRQ requires boolean");if(!bw_direct_set_irq_line(asserted))return fail("native IRQ rejected");return snapshot();}if(strcmp(op,"close")==0){if(!bw_direct_close())return fail("native close rejected");closed=true;release_cached();napi_delete_reference(env,board);board=nullptr;napi_value v;napi_get_undefined(env,&v);return v;}uint32_t n,q;uint64_t deadline;bool lossless;if(argc!=3||!u32(argv[0],&n)||!u32(argv[1],&q)||n==0||q==0||n>600||q>300||!ok(napi_get_value_bigint_uint64(env,argv[2],&deadline,&lossless))||!lossless)return fail("invalid bounded resume");bw_cpu3_combined_paging_ram_slice_result result={};busy=true;int success=bw_direct_resume(n,q,deadline,&result);busy=false;if(!success)return fail("native resume rejected");napi_value out=snapshot();if(!out)return nullptr;napi_set_named_property(env,out,"sliceBytes",copied((uint8_t*)&result,sizeof result));napi_set_named_property(env,out,"reason",number(result.reason));napi_set_named_property(env,out,"activityState",number(result.activity_state));napi_set_named_property(env,out,"chargedNativeTicks",number(result.charged_native_ticks));napi_set_named_property(env,out,"chargedQuanta",number(result.charged_quanta));return out;}
napi_value init(napi_env e,napi_value exports){napi_value fusionProfile;if(!ok(napi_create_string_utf8(e,"bw.cold-native.memory-clock-fusion.v1",NAPI_AUTO_LENGTH,&fusionProfile))||!ok(napi_set_named_property(e,exports,"memoryFusionProfile",fusionProfile)))return nullptr;napi_value profile;if(!ok(napi_create_string_utf8(e,"bw.cold-native.copied-u32-state.v1",NAPI_AUTO_LENGTH,&profile))||!ok(napi_set_named_property(e,exports,"stateExportProfile",profile)))return nullptr;napi_value version;napi_create_uint32(e,BW_DIRECT_ABI_VERSION,&version);napi_set_named_property(e,exports,"abiVersion",version);for(const char *name:{"create","resume","setIRQ","inspect","close"}){napi_value fn;napi_create_function(e,name,NAPI_AUTO_LENGTH,invoke,(void*)name,&fn);napi_set_named_property(e,exports,name,fn);}return exports;}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
