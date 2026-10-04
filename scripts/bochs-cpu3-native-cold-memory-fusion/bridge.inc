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
 if(success)success=write&&call("fusedMemory",6,args,&r);
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
