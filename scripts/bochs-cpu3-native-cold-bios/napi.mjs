/** ABI4 shape and immediate typed reply copy unchanged; new private cold port scope only. */
import {deriveOwnedIn8Napi} from '../bochs-cpu3-native-owned-in8/napi.mjs';
import {replacement,sha256,authenticated} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export function deriveColdBiosNapi(){
 const base=deriveOwnedIn8Napi();authenticated(base.bytes,'a677f47c66e70d7aae104266425884ec1de61858aa14b1c91fcf82ebdd931ab7','held ABI4 NAPI');
 const old='(a!=0x40&&a!=0x21&&a!=0xa1)',next='(a!=0x71&&a!=0x64&&a!=0x60)';
 const s=replacement(base.bytes.toString(),old,next,'cold byte IN port admission');
 if(sha256(replacement(s,next,old,'inverse cold IN'))!==sha256(base.bytes))throw Error('cold NAPI inverse');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits:[{old,next,label:'cold byte IN port admission'}]};
}
