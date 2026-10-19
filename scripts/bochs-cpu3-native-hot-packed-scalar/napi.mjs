/** Exact unprofiled ABI2 base, replacing only the scalar callback. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const originalNapiSha256='a131583191a71a4a675c66339440d5ce6b4ae1332d5b14bef10d7a8d47e36c40';
export function derivePackedScalarNapi(){
 const bytes=readFileSync(new URL('../bochs-cpu3-native-direct-board-adapter/napi.cc',import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!==originalNapiSha256)throw Error('original ABI2 NAPI source hash changed');
 let source=bytes.toString();const begin=source.indexOf('int scalar('),end=source.indexOf('\nbw_direct_callbacks callbacks=',begin);
 if(begin<0||end<0||source.indexOf('int scalar(',begin+1)>=0)throw Error('packed scalar function seam changed');
 const replacement=String.raw`int scalar(void*,uint32_t op,uint32_t a,uint32_t b,uint32_t c,uint32_t *value,uint32_t *a20,uint32_t *epoch){
 napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;
 napi_value args[4]={number(op),number(a),number(b),number(c)},r,ab;
 napi_typedarray_type type;size_t length=0,offset=0,backing_length=0;void *data=nullptr,*backing=nullptr;
 bool ordinary=false,detached=true;uint32_t copied_words[3]={};
 bool success=op>=1&&op<=4&&call("packedScalar",4,args,&r);
 if(success)success=ok(napi_get_typedarray_info(env,r,&type,&length,&data,&ab,&offset))&&type==napi_uint32_array&&length==3&&offset==0&&data!=nullptr&&((uintptr_t)data%alignof(uint32_t))==0;
 if(success)success=ok(napi_is_arraybuffer(env,ab,&ordinary))&&ordinary&&ok(napi_is_detached_arraybuffer(env,ab,&detached))&&!detached;
 if(success)success=ok(napi_get_arraybuffer_info(env,ab,&backing,&backing_length))&&backing==data&&backing_length==12;
 if(success){memcpy(copied_words,data,sizeof copied_words);*value=copied_words[0];*epoch=copied_words[1];*a20=copied_words[2];}
 napi_close_handle_scope(env,scope);return success;
}`;
 source=source.slice(0,begin)+replacement+source.slice(end);
 return Buffer.from('/* H4 owned packed scalar protocol; unprofiled ABI2 exports unchanged. */\n'+source);
}
