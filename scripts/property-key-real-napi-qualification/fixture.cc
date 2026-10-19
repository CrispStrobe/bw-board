// Test addon only. No emulator/core/provider or CPU initialization is linked.
#include <node_api.h>
#include <cstdint>
#include <cstring>
#include <string>
#include <thread>
#include <mutex>
static napi_env env=nullptr;
static std::recursive_mutex invocation_mutex;
static std::thread::id owner;
static bool busy=false;
static bool ok(napi_status status){return status==napi_ok;}
// Materialized by reviewed fixed generator from the authenticated candidate;
// includes exact keys.inc plus exact get() wrapper. Never caller-supplied.
#include "generated-helper.inc"
static napi_value failure(napi_env e,const char* text){bool pending=false;napi_is_exception_pending(e,&pending);if(!pending)napi_throw_error(e,nullptr,text);return nullptr;}
static napi_value invoke(napi_env e,napi_callback_info info){
 std::unique_lock<std::recursive_mutex> lock(invocation_mutex,std::try_to_lock);
 if(!lock.owns_lock()||(key_env&&key_env!=e)||busy||(key_env&&std::this_thread::get_id()!=owner))return failure(e,"owned fixture env/thread/reentry refused");
 env=e;size_t argc=2;napi_value argv[2];void* data=nullptr;
 if(!ok(napi_get_cb_info(e,info,&argc,argv,nullptr,&data)))return failure(e,"fixture callback info");
 const char* op=static_cast<const char*>(data);
 if(!strcmp(op,"prepare")){if(!prepare_keys(e))return failure(e,"owned fixture prepare refused");owner=std::this_thread::get_id();napi_value v;napi_get_undefined(e,&v);return v;}
 if(!key_env||!key_container)return failure(e,"fixture keys unavailable");
 if(!strcmp(op,"release")){if(!release_keys())return failure(e,"owned fixture release refused");napi_value v;napi_get_undefined(e,&v);return v;}
 if(!strcmp(op,"readBytes")){if(argc!=1)return failure(e,"fixture read arity");napi_value result=nullptr;busy=true;bool success=get(argv[0],Key::bytes,&result);busy=false;return success?result:failure(e,"owned fixture property read rejected");}
 if(!strcmp(op,"writeState")){if(argc!=2)return failure(e,"fixture write arity");busy=true;napi_status status=set_key(argv[0],Key::state,argv[1]);busy=false;if(!ok(status))return failure(e,"owned fixture property write rejected");napi_value v;napi_get_undefined(e,&v);return v;}
 return failure(e,"unknown fixture operation");
}
static napi_value init(napi_env e,napi_value exports){for(const char* name:{"prepare","readBytes","writeState","release"}){napi_value fn;if(!ok(napi_create_function(e,name,NAPI_AUTO_LENGTH,invoke,(void*)name,&fn))||!ok(napi_set_named_property(e,exports,name,fn)))return nullptr;}return exports;}
NAPI_MODULE(NODE_GYP_MODULE_NAME,init)
