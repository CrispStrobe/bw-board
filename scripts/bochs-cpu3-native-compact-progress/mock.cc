// Generated helper execution under manufactured NAPI/core, not an addon build.
#include <cassert>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <map>
#include <string>
#include <vector>
#include <memory>
struct Value{enum Kind{Number,BigInt,Object,Bytes}kind;double number=0;uint64_t bigint=0;bool lossless=true;std::map<std::string,Value*> props;std::vector<uint8_t> bytes;};
using napi_value=Value*;int env=0;bool busy=false;std::vector<std::unique_ptr<Value>> arena;int calls=0,fail_at=0,resumes=0,inspects=0;bool native_success=true,inspect_success=true;std::string error;
napi_value make(Value::Kind k){arena.emplace_back(new Value{});arena.back()->kind=k;return arena.back().get();}
napi_value num(double d){auto v=make(Value::Number);v->number=d;return v;}napi_value big(uint64_t d,bool loss=true){auto v=make(Value::BigInt);v->bigint=d;v->lossless=loss;return v;}
int status(){return ++calls==fail_at?1:0;}bool ok(int s){return s==0;}napi_value fail(const char *s){error=s;return nullptr;}
int napi_get_value_double(int,napi_value v,double *d){if(!v||v->kind!=Value::Number)return 1;*d=v->number;return status();}
int napi_get_value_bigint_uint64(int,napi_value v,uint64_t *d,bool *loss){if(!v||v->kind!=Value::BigInt)return 1;*d=v->bigint;*loss=v->lossless;return status();}
int napi_create_object(int,napi_value *v){if(int s=status())return s;*v=make(Value::Object);return 0;}
int napi_create_bigint_uint64(int,uint64_t x,napi_value *v){if(int s=status())return s;*v=big(x);return 0;}
int napi_create_uint32(int,uint32_t x,napi_value *v){if(int s=status())return s;*v=num(x);return 0;}
int napi_set_named_property(int,napi_value o,const char*k,napi_value v){if(int s=status())return s;o->props[k]=v;return 0;}
napi_value copied(const uint8_t*p,size_t n){if(status())return nullptr;auto v=make(Value::Bytes);v->bytes.assign(p,p+n);return v;}
struct bw_cpu3_combined_paging_ram_slice_result{uint32_t reason,activity_state,charged_native_ticks,charged_quanta;uint8_t opaque[16];};
struct bw_direct_snapshot{uint64_t native_ticks,successful_quanta;uint32_t mapping_epoch,board_a20;};
bw_cpu3_combined_paging_ram_slice_result genuine={9,2,600,300,{1,2,3,255}};bw_direct_snapshot ledger={UINT64_MAX,UINT64_MAX-1,UINT32_MAX,1};
int bw_direct_resume(uint32_t n,uint32_t q,uint64_t d,bw_cpu3_combined_paging_ram_slice_result*r){assert(busy);++resumes;assert(n==600&&q==300&&d==UINT64_MAX);*r=genuine;return native_success;}
int bw_direct_inspect(bw_direct_snapshot*s){assert(!busy);++inspects;*s=ledger;return inspect_success;}
#include "parser.inc"
#include "progress.inc"
void reset(){calls=fail_at=resumes=inspects=0;busy=false;native_success=inspect_success=true;error.clear();}
int main(){
 napi_value args[]={num(600),num(300),big(UINT64_MAX)};reset();auto out=resume_progress(3,args);assert(out&&resumes==1&&inspects==1&&!busy&&out->props.size()==9);assert(out->props["nativeTicks"]->bigint==UINT64_MAX&&out->props["successfulQuanta"]->bigint==UINT64_MAX-1);assert(out->props["mappingEpoch"]->number==UINT32_MAX);
 auto saved=out->props["sliceBytes"]->bytes;assert(saved.size()==sizeof genuine&&memcmp(saved.data(),&genuine,sizeof genuine)==0);genuine.opaque[0]=88;assert(out->props["sliceBytes"]->bytes==saved);auto second=resume_progress(3,args);assert(second->props["sliceBytes"]!=out->props["sliceBytes"]&&out->props["sliceBytes"]->bytes==saved);genuine.opaque[0]=1;
 for(double bad:{0.,-1.,601.,1.5,double(INFINITY),double(NAN)}){reset();napi_value a[]={num(bad),args[1],args[2]};assert(!resume_progress(3,a)&&resumes==0&&inspects==0&&error=="invalid bounded resume");}
 for(double bad:{0.,-1.,301.,1.5}){reset();napi_value a[]={args[0],num(bad),args[2]};assert(!resume_progress(3,a)&&resumes==0);}
 reset();assert(!resume_progress(2,args)&&resumes==0);reset();napi_value wrong[]={args[0],args[1],num(1)};assert(!resume_progress(3,wrong)&&resumes==0);reset();wrong[2]=big(0,false);assert(!resume_progress(3,wrong)&&resumes==0);
 reset();native_success=false;assert(!resume_progress(3,args)&&resumes==1&&inspects==0&&!busy&&error=="native resume rejected");reset();inspect_success=false;assert(!resume_progress(3,args)&&inspects==1&&error=="native progress inspect rejected");
 reset();assert(progress_return(genuine));int total=calls;for(int i=1;i<=total;i++){reset();fail_at=i;assert(!progress_return(genuine)&&!error.empty());}
}
