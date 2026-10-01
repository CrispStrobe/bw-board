import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveProfiledNapi,profileBuckets} from '../scripts/bochs-cpu3-native-hot-napi-profile/napi.mjs';
import {parseHotNapiProfile} from '../scripts/bochs-cpu3-native-hot-napi-profile/parse.mjs';
function diagnostic(){
 const counts={native_resume_inclusive:1,resume_return_conversion:1,scalar_whole:4,memory_whole:1,page_whole:1,scalar_arguments_scopes:4,scalar_op_call:4,scalar_return_validation:4,scalar_mapping_call:3,scalar_mapping_fields:4,scalar_scope_close:4,scalar_native_tick:1,scalar_quantum:1,scalar_pio:1,scalar_ack:1};
 const times={native_resume_inclusive:1000,resume_return_conversion:20,scalar_whole:400,memory_whole:100,page_whole:100,scalar_arguments_scopes:50,scalar_op_call:200,scalar_return_validation:40,scalar_mapping_call:70,scalar_mapping_fields:30,scalar_scope_close:10,scalar_native_tick:100,scalar_quantum:100,scalar_pio:100,scalar_ack:100};
 return ['BWNP1\tHEADER\t1\tnanoseconds\tresume-only','BWNP1\tCONTROL\t1\t6\t1\t0\t35\t0\t0\t0',...profileBuckets.map(name=>`BWNP1\tBUCKET\t${name}\t${counts[name]}\t${times[name]}\t${Math.floor(times[name]/counts[name])}`)];
}
test('diagnostic parser distinguishes inclusive time, exact partitions and non-nested residual',()=>{
 const result=parseHotNapiProfile(diagnostic(),{expectedCounts:{scalar_whole:4,scalar_mapping_call:3}});assert.equal(result.qualification,false);assert.equal(result.residualResumeNs,400n);assert.match(result.residualScope,/not pure Bochs/);
 const nested=diagnostic();nested[1]=nested[1].replace('\t1\t0\t35','\t2\t1\t35');assert.equal(parseHotNapiProfile(nested).residualResumeNs,null);
});
test('source derivative keeps byte ownership, thread guard and callback/property order',()=>{
 const source=deriveProfiledNapi().toString();assert.ok(source.includes('napi_is_detached_arraybuffer'));assert.ok(source.includes('napi_is_arraybuffer'));assert.ok(source.includes('std::try_to_lock'));assert.ok(source.includes('busy||(initialized&&std::this_thread::get_id()!=owner)'));
 assert.ok(source.indexOf('memcpy(observed,p,len)')<source.indexOf('success=metadata(r,m)'));const page=source.slice(source.indexOf('int page('),source.indexOf('int scalar('));assert.ok(page.indexOf('memcpy(dst,p,4096)')<page.indexOf('field(r,"decoded",&m->decoded)'));
 assert.match(source,/success=call\("mappingState",0,nullptr,&state\);profile.next\(NP_MAP_FIELDS\);if\(success\)success=field\(state,"mappingEpoch",epoch\)&&field\(state,"boardA20",a20\)/);
 assert.ok(source.includes('if(!np_enabled)return true'));assert.ok(source.includes('if(active)'));assert.ok(source.includes('if(end<start){np_clock_regression=true;return 0;}'));assert.ok(source.includes('np_resume_timer profile;success=bw_direct_resume'));assert.ok(source.includes('np_snapshot_timer profile_snapshot;napi_value out=snapshot()'));
});
for(const [name,change,reason] of [
 ['duplicate bucket',r=>r[3]=r[2],/exact unique bucket/],['reordered bucket',r=>[r[2],r[3]]=[r[3],r[2]],/exact unique bucket/],['missing record',r=>r.pop(),/complete profile/],['unknown record',r=>r[2]='BWNP1\tUNKNOWN',/unknown record/],['leading zero',r=>r[1]=r[1].replace('\t35','\t035'),/canonical uint64/],['uint64 overflow',r=>r[1]=r[1].replace('\t35','\t18446744073709551616'),/uint64 overflow/],['counter overflow flag',r=>r[1]=r[1].replace(/\t0\t0$/,'\t1\t0'),/overflow\/live callback/],['clock regression flag',r=>r[1]=r[1].replace(/\t0$/,'\t1'),/overflow\/live callback/],['wrong active clock census',r=>r[1]=r[1].replace('\t35','\t36'),/clock read census/],['unbalanced scalar phase',r=>r[7]=r[7].replace('\t50\t','\t51\t'),/scalar time partition/],['callback containment violation',r=>r[2]=r[2].replace('\t1000\t1000','\t500\t500'),/callback containment/],['failed resume counts',r=>r[1]=r[1].replace('\t1\t6','\t0\t6'),/successful resume\/snapshot/],
])test('diagnostic rejects '+name,()=>{const rows=diagnostic();change(rows);assert.throws(()=>parseHotNapiProfile(rows),reason);});
