/** ABI4 remains byte-for-byte except its status/data IN preeffect port guard. */
import {deriveOwnedIn8Napi} from '../bochs-cpu3-native-owned-in8/napi.mjs';
import {replacement,sha256,authenticated} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export function deriveOwned8042Napi(){
 const base=deriveOwnedIn8Napi(),old='(a!=0x40&&a!=0x21&&a!=0xa1)',next='(a!=0x40&&a!=0x21&&a!=0xa1&&a!=0x60&&a!=0x64)';
 authenticated(base.bytes,'a677f47c66e70d7aae104266425884ec1de61858aa14b1c91fcf82ebdd931ab7','held owned IN8 NAPI');
 const s=replacement(base.bytes.toString(),old,next,'8042 IN8 preeffect guard');
 if(sha256(replacement(s,next,old,'inverse 8042 NAPI guard'))!==sha256(base.bytes))throw Error('8042 NAPI inverse mismatch');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits:[{old,next,label:'8042 IN8 preeffect guard'}]};
}
