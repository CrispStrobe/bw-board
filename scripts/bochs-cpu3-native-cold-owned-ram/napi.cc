#include <node_api.h>
#include <memory>
#include <string>
#include <cmath>
#include <utility>
#include <new>
#include "owned-ram.h"
using namespace bw_cold_owned_ram;
namespace {
struct Owner {
 Session session;
 Shadow shadow;
 Owner(const std::vector<uint8_t>&ram,const std::vector<uint8_t>&rom):session(ram,rom),shadow(session.make_shadow()){}
};
struct EnvState {std::unique_ptr<Owner> owner;};
void dispose(napi_env,void *data,void *){delete static_cast<EnvState*>(data);}
napi_value error(napi_env env,const char *message){napi_throw_error(env,nullptr,message);return nullptr;}
bool ok(napi_status status){return status==napi_ok;}
EnvState *state(napi_env env){void *data=nullptr;return ok(napi_get_instance_data(env,&data))?static_cast<EnvState*>(data):nullptr;}
Owner *current(napi_env env){EnvState *slot=state(env);return slot?slot->owner.get():nullptr;}
bool args(napi_env env,napi_callback_info info,size_t count,napi_value *values){size_t received=count;return ok(napi_get_cb_info(env,info,&received,values,nullptr,nullptr))&&received==count;}
bool u32(napi_env env,napi_value value,uint32_t &out){double number;if(!ok(napi_get_value_double(env,value,&number))||!std::isfinite(number)||number<0||number>UINT32_MAX||number!=std::floor(number))return false;out=uint32_t(number);return true;}
bool bytes(napi_env env,napi_value value,const uint8_t *&data,size_t &length){
 napi_typedarray_type type;napi_value buffer;void *raw;size_t offset;
 if(!ok(napi_get_typedarray_info(env,value,&type,&length,&raw,&buffer,&offset))||type!=napi_uint8_array)return false;
 bool ordinary=false,detached=true;
 if(!ok(napi_is_arraybuffer(env,buffer,&ordinary))||!ordinary||!ok(napi_is_detached_arraybuffer(env,buffer,&detached))||detached)return false;
 data=static_cast<const uint8_t*>(raw);return true;
}
napi_value number(napi_env env,uint32_t value){napi_value out;return ok(napi_create_uint32(env,value,&out))?out:nullptr;}
napi_value array(napi_env env,const uint8_t *data,size_t length){
 napi_value buffer,out;void *dst;
 if(!ok(napi_create_arraybuffer(env,length,&dst,&buffer)))return nullptr;
 memcpy(dst,data,length);
 return ok(napi_create_typedarray(env,napi_uint8_array,length,buffer,0,&out))?out:nullptr;
}
bool set(napi_env env,napi_value object,const char *name,napi_value value){return value&&ok(napi_set_named_property(env,object,name,value));}
napi_value memory_reply(napi_env env,Owner &instance,uint32_t raw,const uint8_t *data,uint32_t length,bool write,Fence fence=Fence::none){
 const uint32_t decoded=Session::decode(raw);const Kind kind=Session::classify(decoded);
 napi_value out;if(!ok(napi_create_object(env,&out)))return nullptr;
 const uint32_t effect=write?(kind==Kind::ram?1:kind==Kind::rom?2:3):0;
 const uint32_t generation=kind==Kind::ram?instance.session.generation_at(decoded):0;
 if(!set(env,out,"bytes",array(env,data,length))||!set(env,out,"decoded",number(env,decoded))||
    !set(env,out,"kind",number(env,uint32_t(kind)))||!set(env,out,"effect",number(env,effect))||
    !set(env,out,"generation",number(env,generation))||!set(env,out,"mappingEpoch",number(env,0))||
    !set(env,out,"boardA20",number(env,1))||!set(env,out,"fence",number(env,uint32_t(fence))))return nullptr;
 return out;
}
napi_value create(napi_env env,napi_callback_info info){
 EnvState *slot=state(env);if(!slot)return error(env,"owned RAM environment absent");
 if(slot->owner)return error(env,"one owned RAM session per environment lifetime");
 napi_value values[2];if(!args(env,info,2,values))return error(env,"create requires RAM and ROM");
 const uint8_t *ram,*rom;size_t ram_length,rom_length;
 if(!bytes(env,values[0],ram,ram_length)||ram_length!=ram_extent||!bytes(env,values[1],rom,rom_length)||rom_length!=rom_extent)return error(env,"fixed copied RAM/ROM inputs");
 try{slot->owner.reset(new Owner(std::vector<uint8_t>(ram,ram+ram_length),std::vector<uint8_t>(rom,rom+rom_length)));}
 catch(const std::exception&e){return error(env,e.what());}
 napi_value result;return ok(napi_get_undefined(env,&result))?result:nullptr;
}
napi_value read(napi_env env,napi_callback_info info){
 Owner *instance=current(env);if(!instance)return error(env,"owned RAM session absent");
 napi_value values[2];uint32_t raw,length;
 if(!args(env,info,2,values)||!u32(env,values[0],raw)||!u32(env,values[1],length))return error(env,"read raw/length");
 try{auto data=instance->session.read(raw,length);return memory_reply(env,*instance,raw,data.data(),length,false);}
 catch(const std::exception&e){return error(env,e.what());}
}
napi_value write(napi_env env,napi_callback_info info){
 Owner *instance=current(env);if(!instance)return error(env,"owned RAM session absent");
 napi_value values[4];uint32_t raw,n,q;const uint8_t *data;size_t length;
 if(!args(env,info,4,values)||!u32(env,values[0],raw)||!bytes(env,values[1],data,length)||!u32(env,values[2],n)||!u32(env,values[3],q)||length==0||length>16)return error(env,"write raw/bytes/N/Q");
 try{
  const auto result=instance->session.write(raw,std::vector<uint8_t>(data,data+length),instance->session.next_effect(),n,q);
  if(result.fence==Fence::pre_effect_journal_full){napi_value out;if(!ok(napi_create_object(env,&out))||!set(env,out,"fence",number(env,uint32_t(result.fence))))return nullptr;return out;}
  if(result.fence==Fence::post_effect_code_write)return memory_reply(env,*instance,raw,data,uint32_t(length),true,result.fence);
  auto observed=instance->session.read(raw,uint32_t(length));return memory_reply(env,*instance,raw,observed.data(),uint32_t(length),true,result.fence);
 }catch(const std::exception&e){return error(env,e.what());}
}
napi_value drain(napi_env env,napi_callback_info info){
 Owner *instance=current(env);if(!instance)return error(env,"owned RAM session absent");
 napi_value ignored[1];if(!args(env,info,0,ignored))return error(env,"drain arguments");
 try{const Batch batch=instance->session.drain();napi_value out;if(!ok(napi_create_array_with_length(env,batch.entries.size(),&out)))return nullptr;
  for(uint32_t i=0;i<batch.entries.size();++i){const Entry &entry=batch.entries[i];napi_value item;if(!ok(napi_create_object(env,&item))||
   !set(env,item,"address",number(env,entry.address))||!set(env,item,"generation",number(env,entry.generation))||
   !set(env,item,"before",array(env,entry.before.data(),entry.length))||!set(env,item,"after",array(env,entry.after.data(),entry.length))||
   !ok(napi_set_element(env,out,i,item)))return nullptr;}
  return out;
 }catch(const std::exception&e){return error(env,e.what());}
}
napi_value acknowledge(napi_env env,napi_callback_info info){
 Owner *instance=current(env);if(!instance)return error(env,"owned RAM session absent");
 napi_value ignored[1];if(!args(env,info,0,ignored))return error(env,"ack arguments");
 try{instance->session.before_observer(instance->shadow,[](const Shadow&){});return number(env,uint32_t(instance->session.acknowledged()));}
 catch(const std::exception&e){return error(env,e.what());}
}
napi_value page(napi_env env,napi_callback_info info){
 Owner *instance=current(env);if(!instance)return error(env,"owned RAM session absent");
 napi_value values[1];uint32_t raw;if(!args(env,info,1,values)||!u32(env,values[0],raw))return error(env,"page raw");
 try{if(Session::classify(Session::decode(raw))!=Kind::rom)return error(env,"first owned fixture executes ROM only");
  auto data=instance->session.execute_page(raw);return array(env,data.data(),data.size());
 }catch(const std::exception&e){return error(env,e.what());}
}
napi_value close(napi_env env,napi_callback_info info){
 Owner *instance=current(env);if(!instance)return error(env,"owned RAM session absent");
 napi_value ignored[1];if(!args(env,info,0,ignored))return error(env,"close arguments");
 try{instance->session.close(instance->shadow);napi_value out;return ok(napi_get_undefined(env,&out))?out:nullptr;}
 catch(const std::exception&e){return error(env,e.what());}
}
napi_value init(napi_env env,napi_value exports){
 auto *slot=new(std::nothrow) EnvState;
 if(!slot)return error(env,"owned RAM environment allocation");
 if(!ok(napi_set_instance_data(env,slot,dispose,nullptr))){delete slot;return error(env,"owned RAM environment registration");}
 for(const auto &entry:{std::pair<const char*,napi_callback>{"create",create},{"read",read},{"write",write},{"drain",drain},{"acknowledge",acknowledge},{"page",page},{"close",close}}){
  napi_value function;if(!ok(napi_create_function(env,entry.first,NAPI_AUTO_LENGTH,entry.second,nullptr,&function))||!set(env,exports,entry.first,function))return nullptr;
 }
 napi_value profile;if(!ok(napi_create_string_utf8(env,"bw.cold-native.owned-ram-rom-exec.v1",NAPI_AUTO_LENGTH,&profile))||!set(env,exports,"profile",profile))return nullptr;
 return exports;
}
}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
