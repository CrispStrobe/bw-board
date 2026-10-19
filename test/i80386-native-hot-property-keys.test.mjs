import test from 'node:test';
import assert from 'node:assert/strict';
import {derivePropertyKeyNapi,propertyKeys} from '../scripts/bochs-cpu3-native-hot-property-keys/napi.mjs';
import {deriveProfiledNapi} from '../scripts/bochs-cpu3-native-hot-napi-profile/napi.mjs';
const generated=derivePropertyKeyNapi().toString(),h2=deriveProfiledNapi().toString();
test('candidate authenticates H2 and restricts reuse to eight scalar names',()=>{
 assert.deepEqual(propertyKeys,['nativeTick','quantum','outPort','acknowledgeIrq','mappingState','value','mappingEpoch','boardA20']);
 assert.match(generated,/if\(pk_active&&pk_scalar_active\)/);assert.match(generated,/return ok\(napi_get_property\(env,o,pk_active\[i\],v\)\)/);
 assert.match(generated,/return ok\(napi_get_named_property\(env,o,k,v\)\)/);
});
test('key scope is complete before activation, clears before close, and ends before returned handles',()=>{
 assert.match(generated,/for\(size_t i=0;i<8;\+\+i\)if\(napi_create_string_utf8[^\n]+return;\n  pk_active=values;valid=true;/);
 assert.match(generated,/~pk_resume_scope\(\)\{if\(pk_active==values\)pk_active=nullptr;if\(scope\)napi_close_handle_scope/);
 assert.match(generated,/int success;\{pk_resume_scope property_keys;if\(!property_keys.valid\)return fail\("resume property-key scope rejected"\);busy=true;\{np_resume_timer profile;success=bw_direct_resume\(n,q,deadline,&result\);\}\}busy=false;/);
 assert.ok(generated.indexOf('}}busy=false;')<generated.indexOf('np_snapshot_timer profile_snapshot;napi_value out=snapshot();'));
});
test('memory/page ownership checks and getter order are byte-identical to H2',()=>{
 const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
 assert.equal(section(generated,'bool bytes(','int scalar('),section(h2,'bool bytes(','int scalar('));
 assert.equal(section(generated,'napi_value snapshot()','napi_value invoke('),section(h2,'napi_value snapshot()','napi_value invoke('));
 assert.equal(section(generated,'int scalar(','\nbw_direct_callbacks'),section(h2,'int scalar(','\nbw_direct_callbacks').replace('np_callback_timer profile(NP_SCALAR,op);','pk_scalar_scope property_lookup;np_callback_timer profile(NP_SCALAR,op);'));
});
test('thread/reentry/numeric/lifecycle and profiler bodies are preserved',()=>{
 for(const [a,b] of [['bool u32(','bool field('],['static void np_configure()','bool ok('],['napi_value init(','}\nNAPI_MODULE']]){
  const section=s=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));assert.equal(section(generated),section(h2));
 }
 assert.match(generated,/try_to_lock\);if\(!lock.owns_lock\(\)\|\|busy\|\|/);
 assert.match(generated,/pk_scalar_scope\(\):previous\(pk_scalar_active\)/);
});
// These exercise JavaScript key semantics, not compiled native callbacks or a guest.
test('reusing a string key never retains methods changed by a preceding getter',()=>{
 const keys=propertyKeys.map(String),events=[];let later=()=>events.push('old');
 const board={get quantum(){events.push('get quantum');later=()=>events.push('new');return()=>events.push('quantum');},get mappingState(){events.push('get mapping');return later;}};
 Reflect.get(board,keys[1]).call(board);Reflect.get(board,keys[4]).call(board);
 assert.deepEqual(events,['get quantum','quantum','get mapping','new']);
});
test('getter failures remain observable and do not pre-read later fields',()=>{
 const events=[],result={get mappingEpoch(){events.push('epoch');throw Error('hostile epoch');},get boardA20(){events.push('a20');return 1;}};
 assert.throws(()=>Reflect.get(result,'mappingEpoch'),/hostile epoch/);assert.deepEqual(events,['epoch']);
});
test('reused keys preserve receiver and prototype accessor lookup',()=>{
 const prototype={get quantum(){assert.equal(this,board);return function(){assert.equal(this,board);return 7;};}},board=Object.create(prototype);
 assert.equal(Reflect.get(board,propertyKeys[1]).call(board),7);
});
