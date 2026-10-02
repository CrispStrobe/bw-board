/** Fixed-ROM-only derivative. ABI4 IN8 code and clock/phase guards remain unchanged. */
import {deriveOwnedIn8Runtime} from '../bochs-cpu3-native-owned-in8/runtime.mjs';
import {replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export function deriveOwnedPicImrRuntime(){
 const base=deriveOwnedIn8Runtime(),old='if(strcmp(sha,"25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939"))return 0;',next='if(strcmp(sha,"8a7380f01bbc40985d377fe9764667749c36b05d45ee602b28c7e68556bd509f"))return 0;';
 const bytes=Buffer.from(replacement(base.bytes.toString(),old,next,'PIC IMR fixture ROM admission'));
 const inverse=Buffer.from(replacement(bytes.toString(),next,old,'inverse PIC IMR ROM admission'));
 if(sha256(inverse)!==sha256(base.bytes))throw Error('PIC IMR runtime inverse');
 return {bytes,baseSha256:sha256(base.bytes),edits:[{old,next,label:'PIC IMR fixture ROM admission'}]};
}
