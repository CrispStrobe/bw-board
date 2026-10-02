/** H3 retains H2 instrumentation; only property-name string handles are reused. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deriveProfiledNapi} from '../bochs-cpu3-native-hot-napi-profile/napi.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const h2GeneratorSha256='46ce13b5b1f4f137f9caebfc643ca990763a984bb80409a47d14526951111f85';
export const h2GeneratedNapiSha256='eed8d0692f6158562a0ab2dc4cd64f52f08045ad45c45cf607b797a3d5cf1896';
export const propertyKeys=Object.freeze(['nativeTick','quantum','outPort','acknowledgeIrq','mappingState','value','mappingEpoch','boardA20']);
export function derivePropertyKeyNapi(){
 if(sha(readFileSync(new URL('../bochs-cpu3-native-hot-napi-profile/napi.mjs',import.meta.url)))!==h2GeneratorSha256)throw Error('H2 generator source changed');
 let source=deriveProfiledNapi().toString();if(sha(source)!==h2GeneratedNapiSha256)throw Error('H2 generated NAPI changed');
 const once=(from,to)=>{if(source.split(from).length!==2)throw Error('property-key seam changed: '+from.slice(0,80));source=source.replace(from,to);};
 const cache=String.raw`
// Handles belong to a parent scope of the current resume, never to another invocation.
static const char *const pk_names[]={KEYS};
static napi_value *pk_active=nullptr;
static bool pk_scalar_active=false;
struct pk_resume_scope {
 napi_handle_scope scope=nullptr;napi_value values[8]={};bool valid=false;
 pk_resume_scope(){
  if(pk_active||napi_open_handle_scope(env,&scope)!=napi_ok)return;
  for(size_t i=0;i<8;++i)if(napi_create_string_utf8(env,pk_names[i],NAPI_AUTO_LENGTH,&values[i])!=napi_ok)return;
  pk_active=values;valid=true;
 }
 ~pk_resume_scope(){if(pk_active==values)pk_active=nullptr;if(scope)napi_close_handle_scope(env,scope);}
 pk_resume_scope(const pk_resume_scope&)=delete;pk_resume_scope& operator=(const pk_resume_scope&)=delete;
};
struct pk_scalar_scope {bool previous;pk_scalar_scope():previous(pk_scalar_active){pk_scalar_active=true;}~pk_scalar_scope(){pk_scalar_active=previous;}};
`.replace('KEYS',propertyKeys.map(k=>JSON.stringify(k)).join(','));
 once('bool get(napi_value o,const char *k,napi_value *v){return ok(napi_get_named_property(env,o,k,v));}',cache+`\nbool get(napi_value o,const char *k,napi_value *v){if(pk_active&&pk_scalar_active){for(size_t i=0;i<8;++i)if(std::strcmp(k,pk_names[i])==0)return ok(napi_get_property(env,o,pk_active[i],v));}return ok(napi_get_named_property(env,o,k,v));}`);
 once('np_callback_timer profile(NP_SCALAR,op);','pk_scalar_scope property_lookup;np_callback_timer profile(NP_SCALAR,op);');
 once('busy=true;int success;{np_resume_timer profile;success=bw_direct_resume(n,q,deadline,&result);}', 'int success;{pk_resume_scope property_keys;if(!property_keys.valid)return fail("resume property-key scope rejected");busy=true;{np_resume_timer profile;success=bw_direct_resume(n,q,deadline,&result);}}');
 return Buffer.from('/* H3 per-resume key handles only; getters and methods remain dynamic. */\n'+source);
}
