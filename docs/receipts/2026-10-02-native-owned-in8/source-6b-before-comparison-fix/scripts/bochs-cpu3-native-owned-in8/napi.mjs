import {deriveOwnedNapi} from '../bochs-cpu3-native-owned-clock/napi.mjs';
import {replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export function deriveOwnedIn8Napi(){
 const base=deriveOwnedNapi();let s=base.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('sizeof(bw_direct_callbacks),3,nullptr','sizeof(bw_direct_callbacks),4,nullptr','ABI4 table');
 once(' napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;\n napi_value args[4]', ' if(op==BW_DIRECT_PIO_IN8&&(b!=1||(a!=0x40&&a!=0x21&&a!=0xa1)||c!=0))return 0;\n napi_handle_scope scope;if(!ok(napi_open_handle_scope(env,&scope)))return 0;\n napi_value args[4]','IN8 before callback guard');
 once('bool success=op>=1&&op<=4&&call','bool success=op>=1&&op<=5&&call','IN8 scalar enum');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==sha256(base.bytes))throw Error('IN8 NAPI inverse');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits};
}
