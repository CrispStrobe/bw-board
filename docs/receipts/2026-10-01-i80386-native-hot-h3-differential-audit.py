import pathlib,hashlib,json,difflib
P=pathlib.Path(__file__).parent;a=(P/'h2-generated.cc').read_text();b=(P/'h3-generated.cc').read_text();checks=0
def require(x,label):
 global checks
 assert x,label;checks+=1
header='/* H3 per-resume key handles only; getters and methods remain dynamic. */\n';require(b.startswith(header),'candidate marker'); restored=b[len(header):]
start=restored.index('\n// Handles belong to a parent scope');end=restored.index('\nbool u32(',start)
require('pk_active&&pk_scalar_active' in restored[start:end],'scalar-only reuse');require('napi_get_property(env,o,pk_active[i],v)' in restored[start:end],'dynamic property lookup');require('pk_active=values;valid=true;' in restored[start:end],'publish only complete keys');require('if(pk_active==values)pk_active=nullptr;if(scope)napi_close_handle_scope' in restored[start:end],'clear before close')
restored=restored[:start]+'bool get(napi_value o,const char *k,napi_value *v){return ok(napi_get_named_property(env,o,k,v));}'+restored[end:]
# The cache insertion follows the original copied(number) helper location, not get's original newline.
restored=restored.replace('}\nbool get(', '}\nbool get(',1)
restored=restored.replace('pk_scalar_scope property_lookup;np_callback_timer profile(NP_SCALAR,op);','np_callback_timer profile(NP_SCALAR,op);',1)
new='int success;{pk_resume_scope property_keys;if(!property_keys.valid)return fail("resume property-key scope rejected");busy=true;{np_resume_timer profile;success=bw_direct_resume(n,q,deadline,&result);}}'
require(restored.count(new)==1,'one resume scope');restored=restored.replace(new,'busy=true;int success;{np_resume_timer profile;success=bw_direct_resume(n,q,deadline,&result);}',1)
# Cache insertion replaces get() with a leading newline; strip that inserted newline only.
restored=restored.replace('return v;}\nbool get(', 'return v;}\nbool get(',1)
require(restored==a,'exact H2 bytes after removing only key reuse delta')
(P/'generated.diff').write_text(''.join(difflib.unified_diff(a.splitlines(True),b.splitlines(True),fromfile='H2',tofile='H3')))
sha=lambda s:hashlib.sha256(s.encode()).hexdigest()
(P/'source-differential-audit.json').write_text(json.dumps({'status':'H3_EXACT_SOURCE_DIFFERENTIAL_PASS_NO_RUNTIME_CLAIM','checks':checks,'h2Sha256':sha(a),'h3Sha256':sha(b),'preserved':'all H2 bytes after reversing only scope/key/get/scalar marker additions','scope':'only eight scalar string handles; dynamic methods/getters remain; parent closes before returned snapshot'},indent=2)+'\n')
print('PASS',checks)
