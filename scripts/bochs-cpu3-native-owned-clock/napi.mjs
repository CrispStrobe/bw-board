import {derivePackedScalarNapi} from '../bochs-cpu3-native-hot-packed-scalar/napi.mjs';
import {authenticated,replacement,sha256} from './derive.mjs';
export const heldNapiSha256='b57a3cea1f5f5eea2092401f8dba3041eb0bc0d19551bf4273e66ad7372c60cb';
export function deriveOwnedNapi(){
 let s=authenticated(derivePackedScalarNapi(),heldNapiSha256,'H4 NAPI');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('napi_env env; napi_ref board;', 'const char *const cached_names[]={"readPhysical","writePhysical","admitExecutePage","packedScalar","clockTransfer"};\nnapi_ref cached[5]={};\nnapi_env env; napi_ref board;','cached functions');
 once('bool call(const char *name,size_t argc,napi_value *argv,napi_value *result){napi_value self,fn;return ok(napi_get_reference_value(env,board,&self))&&get(self,name,&fn)&&ok(napi_call_function(env,self,fn,argc,argv,result));}',String.raw`bool call(const char *name,size_t argc,napi_value *argv,napi_value *result){napi_value self,fn;unsigned i=0;for(;i<5;i++)if(!strcmp(name,cached_names[i]))break;return i<5&&cached[i]&&ok(napi_get_reference_value(env,board,&self))&&ok(napi_get_reference_value(env,cached[i],&fn))&&ok(napi_call_function(env,self,fn,argc,argv,result));}
void release_cached(){for(auto &ref:cached){if(ref)napi_delete_reference(env,ref);ref=nullptr;}}
bool capture_cached(napi_value self){for(unsigned i=0;i<5;i++){napi_value fn;napi_valuetype type;if(!get(self,cached_names[i],&fn)||!ok(napi_typeof(env,fn,&type))||type!=napi_function||!ok(napi_create_reference(env,fn,1,&cached[i]))){release_cached();return false;}}return true;}
int clock_transfer(void*,const uint32_t *words,uint32_t count,uint32_t reason,bw_owned_clock_state *out){
 if(count>900||!out||(count&&!words)||(count==0&&(reason!=BW_OWNED_INIT&&reason!=BW_OWNED_ENTRY&&reason!=BW_OWNED_POST_PIO)))return 0;
 for(uint32_t i=0;i<count;i++)if(words[i]<1||words[i]>3)return 0;
 napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;
 napi_value ab=nullptr,tape=nullptr,r=nullptr,reply_ab=nullptr;void *dst=nullptr;bool success=ok(napi_create_arraybuffer(env,count*4,&dst,&ab));
 if(success&&count)memcpy(dst,words,count*4);
 if(success)success=ok(napi_create_typedarray(env,napi_uint32_array,count,ab,0,&tape));
 napi_value args[2]={tape,number(reason)};
 if(success)success=call("clockTransfer",2,args,&r);
 napi_typedarray_type type;size_t length=0,offset=0,backing_length=0;void *data=nullptr,*backing=nullptr;bool ordinary=false,detached=true;uint32_t copied_words[7]={};
 if(success)success=ok(napi_get_typedarray_info(env,r,&type,&length,&data,&reply_ab,&offset))&&type==napi_uint32_array&&length==7&&offset==0&&data&&((uintptr_t)data%alignof(uint32_t))==0;
 if(success)success=ok(napi_is_arraybuffer(env,reply_ab,&ordinary))&&ordinary&&ok(napi_is_detached_arraybuffer(env,reply_ab,&detached))&&!detached;
 if(success)success=ok(napi_get_arraybuffer_info(env,reply_ab,&backing,&backing_length))&&backing==data&&backing_length==28;
 if(success){memcpy(copied_words,data,28);out->n=copied_words[0];out->q=copied_words[1];out->cycles=copied_words[2];out->debt=copied_words[3];out->deadline=copied_words[4];out->epoch=copied_words[5];out->a20=copied_words[6];}
 napi_close_handle_scope(env,scope);return success;
}`,'cached call and transfer');
 once('bw_direct_callbacks callbacks={nullptr,memory,page,scalar};','bw_direct_callbacks callbacks={sizeof(bw_direct_callbacks),3,nullptr,clock_transfer,memory,page,scalar};','ABI3 callbacks');
 once('initialized=true;owner=', 'if(!capture_cached(argv[2])){napi_delete_reference(env,board);board=nullptr;return fail("owned callback capture rejected");}initialized=true;owner=','capture before initialize');
 once('if(!result){closed=true;napi_delete_reference', 'if(!result){closed=true;release_cached();napi_delete_reference','failed create cleanup');
 once('closed=true;napi_delete_reference(env,board);board=nullptr;napi_value v;', 'closed=true;release_cached();napi_delete_reference(env,board);board=nullptr;napi_value v;','close cleanup');
 once('const char *callbackNames[]=', 'const char *clockNames[]={"transfers","commits","words"};napi_set_named_property(env,out,"clockTransfers",counters(s.clock_transfer_counts,clockNames,3));\nconst char *callbackNames[]=','physical transfer snapshot');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);if(sha256(inverse)!==heldNapiSha256)throw Error('owned NAPI inverse mismatch');
 return {bytes:Buffer.from(s),baseSha256:heldNapiSha256,edits};
}
