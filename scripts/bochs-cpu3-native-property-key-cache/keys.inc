// Private keys only: values and callback functions are never cached here.
static napi_ref key_container=nullptr;
static napi_env key_env=nullptr;
static bool key_cleanup_registered=false;
static bool key_cleanup_failed=false;
enum class Key:uint32_t{bytes,decoded,kind,effect,generation,mappingEpoch,boardA20,sha256,clock,memory,state,extra,segments,system,debug,nativeTicks,successfulQuanta,clockTransfers,bridgeClockEntryAttempts,bridgeMemoryEntryAttempts,callbacks,fallback,execution,sliceBytes,reason,activityState,chargedNativeTicks,chargedQuanta,transfers,commits,words,unknown,INIT,ENTRY,MEMORY,PAGE,PRE_PIO,POST_PIO,ACK,FAULT,IRQ,HLT,RETURN,ordinaryRead,ordinaryWrite,fusedOuter,physicalReads,physicalWrites,executePages,nativeTickCallbacks,quantumCallbacks,bochsRamReads,bochsRamWrites,bochsDirectPointers,bochsPio,bochsTimer,attempts,completed,repIterations,repPartial,faults,portCommits,irqDeliveries,haltIdleCuts,count};
static const char *const property_keys[]={"bytes","decoded","kind","effect","generation","mappingEpoch","boardA20","sha256","clock","memory","state","extra","segments","system","debug","nativeTicks","successfulQuanta","clockTransfers","bridgeClockEntryAttempts","bridgeMemoryEntryAttempts","callbacks","fallback","execution","sliceBytes","reason","activityState","chargedNativeTicks","chargedQuanta","transfers","commits","words","unknown","INIT","ENTRY","MEMORY","PAGE","PRE_PIO","POST_PIO","ACK","FAULT","IRQ","HLT","RETURN","ordinaryRead","ordinaryWrite","fusedOuter","physicalReads","physicalWrites","executePages","nativeTickCallbacks","quantumCallbacks","bochsRamReads","bochsRamWrites","bochsDirectPointers","bochsPio","bochsTimer","attempts","completed","repIterations","repPartial","faults","portCommits","irqDeliveries","haltIdleCuts"};
static void cleanup_keys(void*);
static bool release_keys(){
 if(key_cleanup_registered){
  if(!ok(napi_remove_env_cleanup_hook(key_env,cleanup_keys,nullptr))){key_cleanup_failed=true;return false;}
  key_cleanup_registered=false;
 }
 if(key_container){
  if(!ok(napi_delete_reference(key_env,key_container))){key_cleanup_failed=true;return false;}
  key_container=nullptr;
 }
 key_env=nullptr;return true;
}
static void cleanup_keys(void*){key_cleanup_registered=false;if(!release_keys())key_cleanup_failed=true;}
static bool prepare_keys(napi_env e){
 if(key_container||key_env||key_cleanup_failed)return false;
 napi_value a,k;key_env=e;
 if(!ok(napi_create_array_with_length(e,sizeof(property_keys)/sizeof(*property_keys),&a))){release_keys();return false;}
 for(uint32_t i=0;i<sizeof(property_keys)/sizeof(*property_keys);i++){
  if(!ok(napi_create_string_utf8(e,property_keys[i],NAPI_AUTO_LENGTH,&k))){release_keys();return false;}
  const std::string index=std::to_string(i);napi_property_descriptor slot={index.c_str(),nullptr,nullptr,nullptr,nullptr,k,napi_default,nullptr};
  if(!ok(napi_define_properties(e,a,1,&slot))){release_keys();return false;}
 }
 if(!ok(napi_create_reference(e,a,1,&key_container))){release_keys();return false;}
 if(!ok(napi_add_env_cleanup_hook(e,cleanup_keys,nullptr))){release_keys();return false;}
 key_cleanup_registered=true;return true;
}
static bool key_value(Key index,napi_value *key){
 if(env!=key_env||!key_container||static_cast<uint32_t>(index)>=static_cast<uint32_t>(Key::count))return false;
 napi_value a;return ok(napi_get_reference_value(env,key_container,&a))&&ok(napi_get_element(env,a,static_cast<uint32_t>(index),key));
}
static napi_status set_key(napi_value out,Key index,napi_value value){napi_value key;if(!key_value(index,&key))return napi_generic_failure;return napi_set_property(env,out,key,value);}
