/** Candidate only: copied typed state slots, unchanged C ABI4. Requires a new DSO and worker. */
import {deriveColdBiosNapi} from '../bochs-cpu3-native-cold-bios/napi.mjs';
import {replacement,sha256,authenticated} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const STATE_EXPORT_PROFILE='bw.cold-native.copied-u32-state.v1';
export const STATE_SLOT_LENGTHS=Object.freeze({state:20,extra:20,segments:90,system:30,debug:6});
export function deriveTypedStateNapi(){
 const base=deriveColdBiosNapi();authenticated(base.bytes,'e4f4e55d139971ba073aa0ff422a6f6f1206587b80fccc88e5f6aba10f8cf1a7','genuine compiled7632 NAPI');let s=base.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('napi_value array(const uint32_t *p,size_t n){napi_value out;napi_create_array_with_length(env,n,&out);for(size_t i=0;i<n;i++)napi_set_element(env,out,i,number(p[i]));return out;}',
 'bool copied_state(napi_value out,const char *name,const uint32_t *p,size_t n){napi_value ab,value;void *dst=nullptr;if(!p||!n||n>90||!ok(napi_create_arraybuffer(env,n*sizeof(uint32_t),&dst,&ab)))return false;memcpy(dst,p,n*sizeof(uint32_t));return ok(napi_create_typedarray(env,napi_uint32_array,n,ab,0,&value))&&ok(napi_set_named_property(env,out,name,value));}',
 'copied Uint32Array allocation and property failure checks');
 const old='napi_set_named_property(env,out,"state",array(s.state,20));napi_set_named_property(env,out,"extra",array(s.extra,20));napi_set_named_property(env,out,"segments",array(&s.segments[0][0],90));napi_set_named_property(env,out,"system",array(&s.system[0][0],30));napi_set_named_property(env,out,"debug",array(s.debug,6));';
 const next='if(!copied_state(out,"state",s.state,20)||!copied_state(out,"extra",s.extra,20)||!copied_state(out,"segments",&s.segments[0][0],90)||!copied_state(out,"system",&s.system[0][0],30)||!copied_state(out,"debug",s.debug,6))return fail("copied typed state export rejected");';
 once(old,next,'five fixed slots preserve all 166 words');
 once('napi_value init(napi_env e,napi_value exports){napi_value version;',
 'napi_value init(napi_env e,napi_value exports){napi_value profile;if(!ok(napi_create_string_utf8(e,"'+STATE_EXPORT_PROFILE+'",NAPI_AUTO_LENGTH,&profile))||!ok(napi_set_named_property(e,exports,"stateExportProfile",profile)))return nullptr;napi_value version;',
 'distinct JS state export profile; C ABI unchanged');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==sha256(base.bytes))throw Error('typed state NAPI inverse');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),stateExportProfile:STATE_EXPORT_PROFILE,edits};
}
