// Actual generated key-helper mock, not a Node addon or Bochs build.
#include <cassert>
#include <cstring>
#include <string>
#include <vector>
#include <map>
#include <stdexcept>
#include <cstdint>
using napi_env=void*;
struct Value{std::string text;std::vector<Value*> elements;std::map<std::string,Value*> props;};
using napi_value=Value*;using napi_ref=Value*;using napi_status=int;
constexpr int napi_ok=0,napi_generic_failure=1;constexpr size_t NAPI_AUTO_LENGTH=-1;
static napi_env env=(void*)1;static int calls=0,fail_at=0,deletes=0,adds=0,removes=0,gets=0,sets=0;
static bool throwing=false;static std::vector<Value*> allocations;
static const char *const cached_names[]={"readPhysical","writePhysical","admitExecutePage","packedScalar","clockTransfer","fusedMemory"};
static bool ok(int s){return s==0;}
static bool step(){return ++calls!=fail_at;}
static Value* value(){auto v=new Value;allocations.push_back(v);return v;}
static int napi_create_array_with_length(napi_env,size_t n,napi_value* out){if(!step())return 1;*out=value();(*out)->elements.resize(n);return 0;}
static int napi_create_string_utf8(napi_env,const char* s,size_t,napi_value* out){if(!step())return 1;*out=value();(*out)->text=s;return 0;}
constexpr int napi_default=0;
struct napi_property_descriptor{const char* utf8name;Value* name;void* method;void* getter;void* setter;Value* value;int attributes;void* data;};
static int inherited_index_calls=0;
static int napi_define_properties(napi_env,napi_value a,size_t n,const napi_property_descriptor* p){if(!step())return 1;assert(n==1&&p->attributes==napi_default);a->elements.at(std::stoul(p->utf8name))=p->value;return 0;}
static int napi_create_reference(napi_env,napi_value a,int,napi_ref* out){if(!step())return 1;*out=a;return 0;}
static int napi_delete_reference(napi_env,napi_ref){deletes++;return 0;}
static int napi_add_env_cleanup_hook(napi_env,void(*)(void*),void*){if(!step())return 1;adds++;return 0;}
static int napi_remove_env_cleanup_hook(napi_env,void(*)(void*),void*){removes++;return 0;}
static int napi_get_reference_value(napi_env,napi_ref a,napi_value* out){if(!step())return 1;*out=a;return 0;}
static int napi_get_element(napi_env,napi_value a,uint32_t i,napi_value* out){if(!step())return 1;*out=a->elements.at(i);return 0;}
static int lookup(napi_value o,const std::string& k,napi_value* out){gets++;if(throwing)return 1;*out=o->props[k];return 0;}
static int napi_get_named_property(napi_env,napi_value o,const char* k,napi_value* out){return lookup(o,k,out);}
static int napi_get_property(napi_env,napi_value o,napi_value k,napi_value* out){return lookup(o,k->text,out);}
static int napi_set_property(napi_env,napi_value o,napi_value k,napi_value v){sets++;if(throwing)return 1;o->props[k->text]=v;return 0;}
#include "generated-helper.inc"
int main(){
 assert(prepare_keys(env));assert(inherited_index_calls==0);auto o=value(),a=value(),b=value();o->props["bytes"]=a;napi_value r;
 assert(get(o,Key::bytes,&r)&&r==a);o->props["bytes"]=b;assert(get(o,Key::bytes,&r)&&r==b&&gets==2); // no value caching
 assert(set_key(o,Key::state,a)==0&&o->props["state"]==a);assert(set_key(o,Key::state,b)==0&&o->props["state"]==b&&sets==2);
 int before=gets;assert(!get(o,Key::count,&r)&&gets==before); // fixed inventory only
 throwing=true;assert(!get(o,Key::bytes,&r));assert(set_key(o,Key::state,a)!=0);throwing=false;
 auto saved=env;env=(void*)2;before=gets;assert(!get(o,Key::bytes,&r)&&gets==before);env=saved;
 release_keys();assert(deletes==1&&removes==1&&!key_container&&!key_env);release_keys();assert(deletes==1);
 assert(prepare_keys(env));cleanup_keys(nullptr);assert(deletes==2&&removes==1);release_keys();assert(deletes==2);
 // Every allocation/reference/hook step fails independently; no published container leaks.
 int steps=2*(sizeof(property_keys)/sizeof(*property_keys))+3;
 for(int i=1;i<=steps;i++){calls=0;fail_at=i;assert(!prepare_keys(env));assert(!key_container&&!key_env&&!key_cleanup_registered);}
 fail_at=0;calls=0;assert(prepare_keys(env));release_keys();
 for(auto v:allocations)delete v;
}
