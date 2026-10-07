// Included only in the derived CPU3 N-API translation unit. No second DSO.
using bw_cold_direct_ram::Bridge;
using bw_cold_direct_ram::BoardView;
using bw_cold_direct_ram::BoundaryRequest;
using bw_cold_direct_ram::MemoryRequest;
using bw_cold_direct_ram::Batch;
using bw_cold_direct_ram::Entry;
static std::unique_ptr<Bridge> direct_owner;
static napi_ref direct_ram_ref=nullptr,direct_ram_buffer_ref=nullptr,direct_gen_ref=nullptr,direct_gen_buffer_ref=nullptr;
static napi_env direct_owner_env=nullptr;
static uint64_t direct_memory_reads=0,direct_memory_writes=0,direct_reconciles=0;
enum class DirectScope:uint8_t {none,clock,page,scalar,full,paused};
static DirectScope direct_scope=DirectScope::none;
static bool direct_scope_committed=false;
static bool direct_page_consumed=false;
static bool direct_method_active=false;
static bool direct_creating=false;
static bool direct_create_violation=false;
static std::optional<bw_cold_direct_ram::Prepared> direct_prepared;
static const uint32_t *direct_words=nullptr;
static uint32_t direct_count=0,direct_reason=0,direct_page_raw=0,direct_op=0,direct_port=0,direct_width=0,direct_value=0;

static void direct_poison()noexcept{if(direct_owner)direct_owner->fail_stop();}
static void direct_release_refs(){
 for(napi_ref *p:{&direct_ram_ref,&direct_ram_buffer_ref,&direct_gen_ref,&direct_gen_buffer_ref}){
  if(*p&&direct_owner_env)napi_delete_reference(direct_owner_env,*p);
  *p=nullptr;
 }
}
static bool direct_array(napi_value value,napi_typedarray_type expected,size_t length,napi_value *buffer,void **data){
 napi_typedarray_type type;size_t count=0,offset=0,extent=0;void *pointer=nullptr,*backing=nullptr;
 bool ordinary=false,detached=true;
 if(!ok(napi_get_typedarray_info(env,value,&type,&count,&pointer,buffer,&offset))||type!=expected||count!=length||offset||!pointer||
    !ok(napi_is_arraybuffer(env,*buffer,&ordinary))||!ordinary||
    !ok(napi_is_detached_arraybuffer(env,*buffer,&detached))||detached||
    !ok(napi_get_arraybuffer_info(env,*buffer,&backing,&extent))||backing!=pointer||
    extent!=length*(expected==napi_uint32_array?4u:1u))return false;
 if(expected==napi_uint32_array&&uintptr_t(pointer)%alignof(uint32_t))return false;
 *data=pointer;return true;
}
static bool direct_same(napi_value a,napi_value b){bool equal=false;return ok(napi_strict_equals(env,a,b,&equal))&&equal;}
static bool direct_view(BoardView *out){
 if(!direct_owner||env!=direct_owner_env||!out)return false;
 napi_value self,ram,gen,ram_buffer,gen_buffer,held_ram,held_gen,held_ram_buffer,held_gen_buffer;
 void *bytes=nullptr,*generations=nullptr;
 if(!ok(napi_get_reference_value(env,board,&self))||!get(self,"directRam",&ram)||!get(self,"directGenerations",&gen)||
    !ok(napi_get_reference_value(env,direct_ram_ref,&held_ram))||!ok(napi_get_reference_value(env,direct_gen_ref,&held_gen))||
    !direct_same(ram,held_ram)||!direct_same(gen,held_gen)||
    !direct_array(ram,napi_uint8_array,BW_COLD_DIRECT_RAM_BOARD_BYTES,&ram_buffer,&bytes)||
    !direct_array(gen,napi_uint32_array,BW_COLD_DIRECT_RAM_RAM_BYTES/4096,&gen_buffer,&generations)||
    !ok(napi_get_reference_value(env,direct_ram_buffer_ref,&held_ram_buffer))||
    !ok(napi_get_reference_value(env,direct_gen_buffer_ref,&held_gen_buffer))||
    !direct_same(ram_buffer,held_ram_buffer)||!direct_same(gen_buffer,held_gen_buffer))return false;
 *out={direct_owner->session_identity(),&direct_ram_ref,&direct_ram_buffer_ref,&direct_gen_ref,&direct_gen_buffer_ref,
  static_cast<uint8_t*>(bytes),BW_COLD_DIRECT_RAM_BOARD_BYTES,static_cast<uint32_t*>(generations),BW_COLD_DIRECT_RAM_RAM_BYTES/4096,true,false,false};
 return true;
}
static bool direct_bind(napi_value self,const uint8_t *rom){
 if(direct_owner||direct_owner_env||!rom)return false;
 napi_value ram,gen,ram_buffer,gen_buffer;void *bytes=nullptr,*generations=nullptr;
 if(!get(self,"directRam",&ram)||!get(self,"directGenerations",&gen)||
    !direct_array(ram,napi_uint8_array,BW_COLD_DIRECT_RAM_BOARD_BYTES,&ram_buffer,&bytes)||
    !direct_array(gen,napi_uint32_array,BW_COLD_DIRECT_RAM_RAM_BYTES/4096,&gen_buffer,&generations))return false;
 direct_owner_env=env;
 if(!ok(napi_create_reference(env,ram,1,&direct_ram_ref))||!ok(napi_create_reference(env,ram_buffer,1,&direct_ram_buffer_ref))||
    !ok(napi_create_reference(env,gen,1,&direct_gen_ref))||!ok(napi_create_reference(env,gen_buffer,1,&direct_gen_buffer_ref))){direct_release_refs();direct_owner_env=nullptr;return false;}
 try{
  std::vector<uint8_t> initial(static_cast<uint8_t*>(bytes),static_cast<uint8_t*>(bytes)+BW_COLD_DIRECT_RAM_RAM_BYTES);
  direct_owner=std::make_unique<Bridge>(initial,std::vector<uint8_t>(rom,rom+BW_COLD_DIRECT_RAM_ROM_BYTES));
  BoardView view{};if(!direct_view(&view))throw std::runtime_error("direct RAM initial view");
  direct_owner->bind_initial_view(view);return true;
 }catch(...){direct_owner.reset();direct_release_refs();direct_owner_env=nullptr;return false;}
}
static bool direct_scope_allowed(){
 return direct_owner&&env==direct_owner_env&&initialized&&!closed&&std::this_thread::get_id()==owner&&
  busy&&direct_scope!=DirectScope::none;
}
static bool direct_enter(DirectScope kind){if(direct_scope!=DirectScope::none||direct_prepared){direct_poison();return false;}direct_scope=kind;direct_scope_committed=false;direct_page_consumed=false;return true;}
static bool direct_leave(){const bool committed=direct_scope_committed&&(direct_scope!=DirectScope::page||direct_page_consumed)&&direct_owner&&!direct_owner->failed();direct_scope=DirectScope::none;direct_scope_committed=false;direct_page_consumed=false;
 direct_prepared.reset();
 direct_words=nullptr;direct_count=direct_reason=direct_page_raw=direct_op=direct_port=direct_width=direct_value=0;
 if(!committed)direct_poison();
 return committed;}
static bool direct_call_clock(napi_value *args,napi_value *reply,const uint32_t *words,uint32_t count,uint32_t reason){
 if(!direct_enter(DirectScope::clock))return false;
 direct_words=words;direct_count=count;direct_reason=reason;
 const bool result=call("clockTransfer",2,args,reply);const bool committed=direct_leave();if(!result)direct_poison();return result&&committed;
}
static bool direct_call_page(napi_value *arg,napi_value *reply,uint32_t raw){
 if(!direct_enter(DirectScope::page))return false;
 direct_page_raw=raw;
 const bool result=call("admitExecutePage",1,arg,reply);const bool committed=direct_leave();if(!result)direct_poison();return result&&committed;
}
static bool direct_call_scalar(napi_value *args,napi_value *reply,uint32_t op,uint32_t a,uint32_t b,uint32_t c){
 if(!direct_enter(DirectScope::scalar))return false;
 direct_op=op;direct_port=a;direct_width=b;direct_value=c;
 const bool result=call("packedScalar",4,args,reply);const bool committed=direct_leave();if(!result)direct_poison();return result&&committed;
}
static bool direct_request(BoundaryRequest *out){
 if(!direct_scope_allowed()||!out)return false;
 bw_cold_direct_ram_clock_ledger source={};if(!bw_cold_direct_ram_source_clock(&source)||source.mapping_epoch||source.board_a20!=1)return false;
 BoundaryRequest r{};
 if(direct_scope==DirectScope::clock){r.kind=direct_reason;r.phase=direct_reason==BW_COLD_DIRECT_RAM_INIT?BW_COLD_DIRECT_RAM_PAUSED:BW_COLD_DIRECT_RAM_RUNNING;r.tape=direct_words;r.tape_count=direct_count;}
 else if(direct_scope==DirectScope::page){r.kind=BW_COLD_DIRECT_RAM_PAGE;r.phase=BW_COLD_DIRECT_RAM_RUNNING;r.page_raw=direct_page_raw;}
 else if(direct_scope==DirectScope::scalar){
  r.kind=direct_op==BW_DIRECT_PIO_IN8?BW_COLD_DIRECT_RAM_PIO_IN:direct_op==BW_DIRECT_PIO_OUT?BW_COLD_DIRECT_RAM_PIO_OUT:BW_COLD_DIRECT_RAM_PIC_ACK_FORBIDDEN;
  r.phase=BW_COLD_DIRECT_RAM_RUNNING;r.port=direct_port;r.width=direct_width;r.value=direct_value;
 }else if(direct_scope==DirectScope::full){r.kind=BW_COLD_DIRECT_RAM_MEMORY;r.phase=BW_COLD_DIRECT_RAM_RUNNING;}
 else if(direct_scope==DirectScope::paused){r.kind=BW_COLD_DIRECT_RAM_PAUSED_OBSERVER;r.phase=BW_COLD_DIRECT_RAM_PAUSED;}
 else return false;
 if(bool(source.in_resume)!=(r.phase==BW_COLD_DIRECT_RAM_RUNNING))return false;
 r.n_before=direct_owner->n();r.q_before=direct_owner->q();r.n_after=source.n;r.q_after=source.q;
 uint32_t charges=0;for(uint32_t i=0;i<r.tape_count;++i)if(r.tape[i]!=1)++charges;
 if(source.debt<uint64_t(charges)*6)return false;
 r.debt_before=source.debt-charges*6;r.deadline=source.deadline;r.mapping_epoch=source.mapping_epoch;r.board_a20=source.board_a20;
 *out=r;return true;
}
static napi_value direct_js_drain(){
 if(direct_scope_committed||direct_prepared){direct_poison();return fail("direct RAM observer already prepared/committed");}
 BoundaryRequest request{};if(!direct_request(&request)){direct_poison();return fail("direct RAM copied observer admission");}
 direct_prepared=direct_owner->prepare(request);
 const Batch&batch=direct_prepared->batch;napi_value out;if(!ok(napi_create_array_with_length(env,batch.entries.size(),&out)))return nullptr;
 if(batch.acknowledged>UINT32_MAX||batch.through>UINT32_MAX)throw std::runtime_error("direct RAM journal JS watermark overflow");
 for(uint32_t i=0;i<batch.entries.size();++i){const Entry&e=batch.entries[i];napi_value item,before,after;
  if(e.sequence>UINT32_MAX||e.effect>UINT32_MAX||e.n>UINT32_MAX||e.q>UINT32_MAX)throw std::runtime_error("direct RAM journal JS ledger overflow");
  if(!ok(napi_create_object(env,&item)))return nullptr;
  // Use the existing copied() helper: no native journal pointer escapes.
  before=copied(e.before.data(),e.length);after=copied(e.after.data(),e.length);
  if(!before||!after||!ok(napi_set_named_property(env,item,"address",number(e.address)))||
     !ok(napi_set_named_property(env,item,"sequence",number(uint32_t(e.sequence))))||
     !ok(napi_set_named_property(env,item,"effect",number(uint32_t(e.effect))))||
     !ok(napi_set_named_property(env,item,"n",number(uint32_t(e.n))))||
     !ok(napi_set_named_property(env,item,"q",number(uint32_t(e.q))))||
     !ok(napi_set_named_property(env,item,"epoch",number(e.epoch)))||
     !ok(napi_set_named_property(env,item,"generation",number(e.generation)))||
     !ok(napi_set_named_property(env,item,"before",before))||!ok(napi_set_named_property(env,item,"after",after))||
     !ok(napi_set_element(env,out,i,item)))return nullptr;
 }
 if(!ok(napi_set_named_property(env,out,"acknowledged",number(uint32_t(batch.acknowledged))))||
    !ok(napi_set_named_property(env,out,"through",number(uint32_t(batch.through))))||
    !ok(napi_set_named_property(env,out,"epoch",number(batch.epoch))))return nullptr;
 napi_value identity=nullptr;if(!ok(napi_create_bigint_uint64(env,direct_owner->session_identity(),&identity))||
    !ok(napi_set_named_property(env,out,"sessionIdentity",identity)))return nullptr;
 napi_value ticket=nullptr;if(!ok(napi_create_bigint_uint64(env,direct_prepared->ticket,&ticket))||
    !ok(napi_set_named_property(env,out,"ticket",ticket)))return nullptr;
 return out;
}
static bool direct_batch_matches(napi_value copied_batch,const bw_cold_direct_ram::Prepared&prepared){
 const Batch&batch=prepared.batch;bool array=false;uint32_t count=0;
 if(!ok(napi_is_array(env,copied_batch,&array))||!array||!ok(napi_get_array_length(env,copied_batch,&count))||count!=batch.entries.size())return false;
 auto field_equal=[&](napi_value item,const char*name,uint32_t expected){napi_value value;uint32_t actual=0;return get(item,name,&value)&&u32(value,&actual)&&actual==expected;};
 if(!field_equal(copied_batch,"acknowledged",uint32_t(batch.acknowledged))||
    !field_equal(copied_batch,"through",uint32_t(batch.through))||!field_equal(copied_batch,"epoch",batch.epoch))return false;
 auto bigint_equal=[&](const char*name,uint64_t expected){napi_value value;uint64_t actual=0;bool lossless=false;
  return get(copied_batch,name,&value)&&ok(napi_get_value_bigint_uint64(env,value,&actual,&lossless))&&lossless&&actual==expected;};
 if(!bigint_equal("sessionIdentity",prepared.session_identity)||!bigint_equal("ticket",prepared.ticket))return false;
 for(uint32_t i=0;i<count;++i){const Entry&e=batch.entries[i];napi_value item,before,after,before_buffer,after_buffer;void *before_data=nullptr,*after_data=nullptr;
  if(!ok(napi_get_element(env,copied_batch,i,&item))||
     !field_equal(item,"address",e.address)||!field_equal(item,"sequence",uint32_t(e.sequence))||
     !field_equal(item,"effect",uint32_t(e.effect))||!field_equal(item,"n",uint32_t(e.n))||
     !field_equal(item,"q",uint32_t(e.q))||!field_equal(item,"epoch",e.epoch)||
     !field_equal(item,"generation",e.generation)||!get(item,"before",&before)||
     !direct_array(before,napi_uint8_array,e.length,&before_buffer,&before_data)||
     memcmp(before_data,e.before.data(),e.length)||!get(item,"after",&after)||
     !direct_array(after,napi_uint8_array,e.length,&after_buffer,&after_data)||
     memcmp(after_data,e.after.data(),e.length))return false;
 }
 return true;
}
static napi_value direct_js_commit(napi_value copied_batch){
 BoardView view{};
 if(direct_scope_committed||!direct_prepared||!direct_batch_matches(copied_batch,*direct_prepared)||!direct_view(&view)){direct_poison();return fail("direct RAM exact copied batch/board admission");}
 try{const auto receipt=direct_owner->commit(*direct_prepared,view);direct_prepared.reset();direct_scope_committed=true;++direct_reconciles;
  napi_value result=number(uint32_t(receipt.acknowledged));if(!result)direct_poison();return result;}
 catch(const std::exception&e){direct_poison();return fail(e.what());}
}
static napi_value direct_js_page(uint32_t raw){
 if(direct_scope!=DirectScope::page||!direct_scope_committed||direct_page_consumed||raw!=direct_page_raw){direct_poison();return fail("direct ROM page ticket scope");}
 try{const auto bytes=direct_owner->rom_execute_page(raw);direct_page_consumed=true;napi_value result=copied(bytes.data(),bytes.size());if(!result)direct_poison();return result;}
 catch(const std::exception&e){direct_poison();return fail(e.what());}
}
static napi_value direct_invoke(napi_env e,napi_callback_info info){
 std::unique_lock<std::recursive_mutex> lock(invocation_mutex,std::try_to_lock);
 if(!lock.owns_lock()||e!=direct_owner_env||!direct_scope_allowed()||direct_method_active){if(busy&&e==direct_owner_env)direct_poison();napi_throw_error(e,nullptr,"direct RAM owner scope");return nullptr;}
 struct MethodGuard{MethodGuard(){direct_method_active=true;}~MethodGuard(){direct_method_active=false;}} method_guard;
 size_t argc=1;napi_value argv[1];void *data=nullptr;if(!ok(napi_get_cb_info(e,info,&argc,argv,nullptr,&data)))return fail("direct RAM arguments");
 const char *name=static_cast<const char*>(data);
 try{
  if(!strcmp(name,"directDrain")){if(argc)return fail("direct drain arguments");return direct_js_drain();}
  if(!strcmp(name,"directCommit")){if(argc!=1)return fail("direct commit copied batch");return direct_js_commit(argv[0]);}
  if(!strcmp(name,"directPage")){uint32_t raw;if(argc!=1||!u32(argv[0],&raw))return fail("direct page arguments");return direct_js_page(raw);}
  if(!strcmp(name,"directFailStop")){direct_poison();napi_value value=nullptr;return ok(napi_get_undefined(env,&value))?value:nullptr;}
 }catch(const std::exception&e){direct_poison();return fail(e.what());}
 return fail("direct owner method");
}
static napi_value direct_paused_pending(napi_env e,napi_callback_info info){
 std::unique_lock<std::recursive_mutex> lock(invocation_mutex,std::try_to_lock);
 if(!lock.owns_lock()||e!=direct_owner_env||!initialized||closed||busy||direct_method_active||direct_scope!=DirectScope::none||
    std::this_thread::get_id()!=owner||!direct_owner){napi_throw_error(e,nullptr,"direct RAM paused read-only scope");return nullptr;}
 size_t argc=0;void *data=nullptr;if(!ok(napi_get_cb_info(e,info,&argc,nullptr,nullptr,&data))||argc)return fail("direct RAM pending arguments");
 try{return number(direct_owner->journal_size());}catch(const std::exception&error){direct_poison();return fail(error.what());}
}
static napi_value direct_paused_reconcile(napi_env e,napi_callback_info info){
 std::unique_lock<std::recursive_mutex> lock(invocation_mutex,std::try_to_lock);
 if(!lock.owns_lock()||e!=direct_owner_env||!initialized||closed||busy||direct_method_active||direct_scope!=DirectScope::none||
    std::this_thread::get_id()!=owner||!direct_owner){napi_throw_error(e,nullptr,"direct RAM paused observer scope");return nullptr;}
 size_t argc=0;void *data=nullptr;if(!ok(napi_get_cb_info(e,info,&argc,nullptr,nullptr,&data))||argc)return fail("direct RAM paused arguments");
 if(!direct_enter(DirectScope::paused))return fail("direct RAM paused reentry");
 busy=true;napi_value reply=nullptr;const bool result=call("reconcilePaused",0,nullptr,&reply);const bool committed=direct_leave();busy=false;
 if(!result||!committed){direct_poison();return fail("direct RAM paused reconciliation rejected");}
 napi_value value=nullptr;if(!ok(napi_get_undefined(env,&value))){direct_poison();return nullptr;}return value;
}
extern "C" int bw_cold_direct_ram_watermarks(uint64_t *committed,uint64_t *acknowledged){
 if(!direct_owner||!busy||!committed||!acknowledged||std::this_thread::get_id()!=owner)return 0;
 try{*committed=direct_owner->committed();*acknowledged=direct_owner->acknowledged();return 1;}catch(...){direct_poison();return 0;}
}
extern "C" int bw_cold_direct_ram_memory(uint32_t raw,uint32_t length,const uint8_t *operand,
 const bw_cold_direct_ram_source_ledger *source,bw_cold_direct_ram_memory_reply *reply){
 if(!direct_owner||!busy||direct_scope!=DirectScope::none||!source||!reply||std::this_thread::get_id()!=owner)return 0;
 try{*reply=direct_owner->memory(MemoryRequest{raw,length,operand,operand!=nullptr,*source});
  if(reply->status==BW_COLD_DIRECT_RAM_ACCEPTED){if(operand)++direct_memory_writes;else ++direct_memory_reads;}return 1;
 }catch(...){direct_poison();return 0;}
}
extern "C" int bw_cold_direct_ram_reconcile_full(void){
 if(!direct_owner||!busy||!direct_enter(DirectScope::full))return 0;
 napi_value ignored=nullptr;const bool result=call("reconcileFull",0,nullptr,&ignored);const bool committed=direct_leave();
 if(!result)direct_poison();
 return result&&committed?1:0;
}
static bool direct_close(){
 if(!direct_owner)return false;
 try{direct_owner->close();direct_owner.reset();direct_release_refs();direct_owner_env=nullptr;return true;}
 catch(...){direct_poison();return false;}
}
static void direct_cleanup(void *data){
 std::lock_guard<std::recursive_mutex> lock(invocation_mutex);
 if(data==direct_owner_env){direct_poison();closed=true;direct_owner.reset();direct_release_refs();direct_owner_env=nullptr;}
}
