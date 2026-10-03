/** Separate interface-test profile, exactly reversible to the self-test native profile. */
import {deriveOwned8042Runtime} from '../bochs-cpu3-native-owned-8042/runtime.mjs';
import {replacement,sha256,authenticated} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {selfTestRomSha256,selfTestRomLayout} from './profile.mjs';
export function deriveOwned8042InterfaceRuntime(){
 const base=deriveOwned8042Runtime();authenticated(base.bytes,'8389bcb4383e1f0bd7acb3d46fd9c6bfec731d59aa733f042db6524fd72fd69e','held self-test native runtime');let s=base.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once(`if(strcmp(sha,"${base.profile.romSha256}"))return 0;`,`if(strcmp(sha,"${selfTestRomSha256}"))return 0;`,'interface fixed ROM admission');
 once('if(port==0x64&&value!=0xd1&&value!=0xaa)return 0;','if(port==0x64&&value!=0xd1&&value!=0xaa&&value!=0xab)return 0;','interface byte AB preeffect admission');
 once('static const char marker[]="K";','static const char marker[]="I";','interface success marker');
 once('BX_CPU(0)->get_eip()!=0x33)',`BX_CPU(0)->get_eip()!=0x${(selfTestRomLayout.successHlt-0xf0000+1).toString(16)})`,'interface success HLT boundary');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==sha256(base.bytes))throw Error('interface native inverse');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits,profile:{...base.profile,kind:'free-8042-interface-test-native-v1',romSha256:selfTestRomSha256,successHltOffset:selfTestRomLayout.successHlt-0xf0000,marker:'I',expectedWitness:[0x55,0x00]}};
}
