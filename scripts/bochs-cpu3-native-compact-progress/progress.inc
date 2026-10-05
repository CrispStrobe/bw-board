// Separate compact export; held snapshot and resume remain unchanged.
napi_value progress_return(const bw_cpu3_combined_paging_ram_slice_result &result){
 bw_direct_snapshot s={};if(!bw_direct_inspect(&s))return fail("native progress inspect rejected");
 napi_value out,value;if(!ok(napi_create_object(env,&out)))return fail("progress object rejected");
 napi_value bytes=copied((uint8_t*)&result,sizeof result);if(!bytes||!ok(napi_set_named_property(env,out,"sliceBytes",bytes)))return fail("progress slice copy rejected");
 if(!ok(napi_create_bigint_uint64(env,s.native_ticks,&value))||!ok(napi_set_named_property(env,out,"nativeTicks",value))||!ok(napi_create_bigint_uint64(env,s.successful_quanta,&value))||!ok(napi_set_named_property(env,out,"successfulQuanta",value)))return fail("progress ledger rejected");
 const char *names[]={"reason","activityState","chargedNativeTicks","chargedQuanta","mappingEpoch","boardA20"};
 const uint32_t values[]={result.reason,result.activity_state,result.charged_native_ticks,result.charged_quanta,s.mapping_epoch,s.board_a20};
 for(size_t i=0;i<6;i++)if(!ok(napi_create_uint32(env,values[i],&value))||!ok(napi_set_named_property(env,out,names[i],value)))return fail("progress scalar rejected");
 return out;
}
napi_value resume_progress(size_t argc,napi_value *argv){
 uint32_t n,q;uint64_t deadline;bool lossless;if(argc!=3||!u32(argv[0],&n)||!u32(argv[1],&q)||n==0||q==0||n>600||q>300||!ok(napi_get_value_bigint_uint64(env,argv[2],&deadline,&lossless))||!lossless)return fail("invalid bounded resume");bw_cpu3_combined_paging_ram_slice_result result={};busy=true;int success=bw_direct_resume(n,q,deadline,&result);busy=false;if(!success)return fail("native resume rejected");
 return progress_return(result);
}
