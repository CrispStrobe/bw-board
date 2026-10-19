import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {deriveColdBiosNapi} from '../scripts/bochs-cpu3-native-cold-bios/napi.mjs';
import {deriveTypedStateNapi,STATE_SLOT_LENGTHS,STATE_EXPORT_PROFILE} from '../scripts/bochs-cpu3-native-cold-bios-typed-state/napi.mjs';
import {replacement,sha256} from '../scripts/bochs-cpu3-native-owned-clock/derive.mjs';

test('exact inverse preserves held NAPI except three declared seams',()=>{
 const base=deriveColdBiosNapi(),derived=deriveTypedStateNapi();let inverse=derived.bytes.toString();
 assert.equal(derived.edits.length,3);for(const e of [...derived.edits].reverse())inverse=replacement(inverse,e.next,e.old,e.label);
 assert.equal(sha256(inverse),sha256(base.bytes));assert.equal(Object.values(STATE_SLOT_LENGTHS).reduce((a,b)=>a+b),166);
 assert.ok(derived.bytes.toString().includes(STATE_EXPORT_PROFILE));
 assert.ok(derived.bytes.toString().includes('if(!copied_state(out,"state",s.state,20)||!copied_state(out,"extra",s.extra,20)||!copied_state(out,"segments",&s.segments[0][0],90)||!copied_state(out,"system",&s.system[0][0],30)||!copied_state(out,"debug",s.debug,6))return fail("copied typed state export rejected");'));
 assert.ok(derived.bytes.toString().includes('sizeof(bw_direct_callbacks),4,nullptr'));
});

test('exact generated copied_state helper preserves all slots and independent ownership',()=>{
 const source=deriveTypedStateNapi().bytes.toString();
 const helper=source.match(/bool copied_state\(napi_value out[^\n]+/)[0];
 const harness=`#include <cassert>
#include <cstdint>
#include <cstring>
#include <map>
#include <memory>
#include <string>
#include <vector>
struct Value { std::vector<uint32_t> words; std::shared_ptr<Value> backing; std::map<std::string,std::shared_ptr<Value>> fields; size_t length=0; int type=0; };
using napi_value=std::shared_ptr<Value>;using napi_status=int;constexpr int napi_uint32_array=7;int env=0,fail_stage=0;bool ok(int s){return s==0;}
int napi_create_arraybuffer(int,size_t bytes,void **dst,napi_value *out){if(fail_stage==1)return 1;*out=std::make_shared<Value>();(*out)->words.resize(bytes/4);*dst=(*out)->words.data();return 0;}
int napi_create_typedarray(int,int type,size_t n,napi_value ab,size_t offset,napi_value *out){if(fail_stage==2)return 1;assert(offset==0);*out=std::make_shared<Value>();(*out)->backing=ab;(*out)->type=type;(*out)->length=n;return 0;}
int napi_set_named_property(int,napi_value out,const char *name,napi_value value){if(fail_stage==3)return 1;out->fields[name]=value;return 0;}
${helper}
int main(){
 auto first=std::make_shared<Value>(),second=std::make_shared<Value>();
 const char *names[]={"state","extra","segments","system","debug"};size_t sizes[]={20,20,90,30,6};
 uint32_t seed=0;for(int slot=0;slot<5;slot++){std::vector<uint32_t> src(sizes[slot]);for(size_t i=0;i<src.size();i++)src[i]=(seed++*2654435761u)^0xffffffffu;
 auto saved=src;assert(copied_state(first,names[slot],src.data(),src.size()));auto a=first->fields.at(names[slot]);assert(a->type==napi_uint32_array&&a->length==sizes[slot]);assert(a->backing->words==saved);
 src.assign(src.size(),0);assert(a->backing->words==saved);assert(copied_state(second,names[slot],src.data(),src.size()));auto b=second->fields.at(names[slot]);assert(a->backing!=b->backing);b->backing->words[0]=123;assert(a->backing->words==saved);
 }assert(seed==166);uint32_t word=0;for(int stage=1;stage<=3;stage++){fail_stage=stage;auto out=std::make_shared<Value>();assert(!copied_state(out,"state",&word,1));assert(out->fields.empty());}fail_stage=0;assert(!copied_state(first,"bad",nullptr,1));assert(!copied_state(first,"bad",&word,0));assert(!copied_state(first,"bad",&word,91));
}
`;
 const dir=mkdtempSync(join(tmpdir(),'cold-typed-state-source-'));
 try {writeFileSync(join(dir,'mock.cc'),harness);const c=spawnSync('/usr/bin/g++',['-std=c++17','-O2',join(dir,'mock.cc'),'-o',join(dir,'mock')],{encoding:'utf8',timeout:10000,maxBuffer:1024*1024});if(process.env.TYPED_STATE_CONTROL_RECEIPTS){const o=process.env.TYPED_STATE_CONTROL_RECEIPTS;writeFileSync(join(o,'compiler.stdout'),c.stdout??'');writeFileSync(join(o,'compiler.stderr'),c.stderr??'');writeFileSync(join(o,'compiler-exit.json'),JSON.stringify({status:c.status,signal:c.signal,error:c.error?.message??null}));writeFileSync(join(o,'mock.cc'),harness);}assert.equal(c.status,0,c.stderr);const r=spawnSync(join(dir,'mock'),[],{encoding:'utf8',timeout:3000,maxBuffer:1024*1024});if(process.env.TYPED_STATE_CONTROL_RECEIPTS){const o=process.env.TYPED_STATE_CONTROL_RECEIPTS;writeFileSync(join(o,'mock.stdout'),r.stdout??'');writeFileSync(join(o,'mock.stderr'),r.stderr??'');writeFileSync(join(o,'mock-exit.json'),JSON.stringify({status:r.status,signal:r.signal,error:r.error?.message??null}));}assert.equal(r.status,0,r.stderr);}
 finally {rmSync(dir,{recursive:true,force:true});}
});
