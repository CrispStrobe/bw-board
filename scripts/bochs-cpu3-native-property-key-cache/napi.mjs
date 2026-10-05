import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const HELD_NAPI_SHA='052dfe2d8bbcf37b2abd621dbd78c5f2078026f34cb02fa1afd40ee1c9cb15ac';
export const PROPERTY_KEY_PROFILE='bw.cold-native.property-key-cache.v1';
const hash=b=>createHash('sha256').update(b).digest('hex');
export function derivePropertyKeyNapi(){
 const base=readFileSync(new URL('./held-napi.cc',import.meta.url));if(hash(base)!==HELD_NAPI_SHA)throw Error('held NAPI hash');
 let s=base.toString();const edits=[];
 const replace=(old,next,count,label)=>{if(s.split(old).length-1!==count)throw Error('seam '+label);s=s.split(old).join(next);edits.push({old,next,count,label});};
 replace('bool get(napi_value o,const char *k,napi_value *v){return ok(napi_get_named_property(env,o,k,v));}',readFileSync(new URL('./keys.inc',import.meta.url),'utf8')+'\nbool get(napi_value o,Key k,napi_value *v){napi_value key;return key_value(k,&key)&&ok(napi_get_property(env,o,key,v));}',1,'private container and real property lookup');
 const keys=JSON.parse(readFileSync(new URL('./keys.json',import.meta.url),'utf8'));
 replace('get(self,cached_names[i],&fn)','ok(napi_get_named_property(env,self,cached_names[i],&fn))',1,'held create-time callback getters');
 replace('field(napi_value o,const char *k,','field(napi_value o,Key k,',1,'fixed metadata key indices');
 replace('copied_state(napi_value out,const char *name,','copied_state(napi_value out,Key name,',1,'fixed snapshot key indices');
 replace('const char *const *names,size_t count','const Key *names,size_t count',1,'fixed counter indices');
 for(const key of keys){
  for(const head of ['get(r,','get(memory_reply,','field(r,','copied_state(out,','napi_set_named_property(env,out,']){
   const old=head+'"'+key+'"',count=s.split(old).length-1;if(count)replace(old,head+'Key::'+key,count,'index '+head+key);
  }
 }
 for(const name of ['clockNames','reasonNames','memoryNames','callbackNames','fallbackNames','executionNames']){
  const match=s.match(new RegExp(String.raw`const char \*${name}\[\]=\{([^}]+)\};`));
  if(!match)throw Error('counter inventory '+name);
  const values=JSON.parse('['+match[1]+']');if(values.some(v=>!keys.includes(v)))throw Error('counter key');
  replace(match[0],'const Key '+name+'[]={'+values.map(v=>'Key::'+v).join(',')+'};',1,'counter indices '+name);
 }
 // Leave export initialization unchanged; only snapshot/counter/resume setters use keys.
 const init=s.indexOf('napi_value init('), prefix=s.slice(0,init), count=prefix.split('napi_set_named_property(env,').length-1;
 replace('napi_set_named_property(env,','set_key(',count,'runtime snapshot setters');
 replace('if(!ok(napi_create_reference(env,argv[2],1,&board)))return fail("board reference rejected");','if(!prepare_keys(e))return fail("private property keys rejected");if(!ok(napi_create_reference(env,argv[2],1,&board))){release_keys();return fail("board reference rejected");}',1,'prepare before board effects');
 replace('if(!capture_cached(argv[2])){napi_delete_reference(env,board);','if(!capture_cached(argv[2])){release_keys();napi_delete_reference(env,board);',1,'capture failure releases keys');
 replace('closed=true;release_cached();','closed=true;release_cached();if(!release_keys())return fail("private key cleanup rejected");',2,'failed initialization and successful close');
 replace('if(!lock.owns_lock()||busy||','if((key_env&&e!=key_env)||!lock.owns_lock()||busy||',1,'environment guard before active env assignment');
 replace('napi_value init(napi_env e,napi_value exports){','napi_value init(napi_env e,napi_value exports){napi_value keyProfile;if(napi_create_string_utf8(e,"'+PROPERTY_KEY_PROFILE+'",NAPI_AUTO_LENGTH,&keyProfile)!=napi_ok||napi_set_named_property(e,exports,"propertyKeyProfile",keyProfile)!=napi_ok)return nullptr;',1,'separate profile');
 let inverse=s;for(const edit of [...edits].reverse()){if(inverse.split(edit.next).length-1!==edit.count)throw Error('inverse '+edit.label);inverse=inverse.split(edit.next).join(edit.old);}if(hash(inverse)!==HELD_NAPI_SHA)throw Error('full inverse');
 return {bytes:Buffer.from(s),baseSha256:HELD_NAPI_SHA,edits,propertyKeyProfile:PROPERTY_KEY_PROFILE};
}
