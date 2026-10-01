import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {hotNativeProfile as p} from './profile.mjs';
export function deriveHotRuntime(){
 const bytes=readFileSync(new URL('../bochs-cpu3-native-direct-board/runtime.inc',import.meta.url));
 if(createHash('sha256').update(bytes).digest('hex')!=='1c0e7b6f58016e875a4e8d53e4dc0427ef519f7b0c64797bdff750089bd8f9c4')throw Error('pinned direct runtime changed');
 let s=bytes.toString();const once=(a,b)=>{if(s.split(a).length!==2)throw Error('hot runtime derivation seam changed');s=s.replace(a,b);};
 once('bw_successful_quanta>=300',`bw_successful_quanta>=${p.totalQuanta}`);
 once('  if (!count || count > bw_native_budget - bw_slice_ticks)',`  if (bw_ticks>=${p.totalNativeTicks} || count>${p.totalNativeTicks}-bw_ticks) bw_slice_fail("hot-native-total-before-callback");\n  if (!count || count > bw_native_budget - bw_slice_ticks)`);
 once('608930336bd6ea9bc7a49ae02d823f54c46786a2359b335c0c1ccee55f7bb938',p.romSha256);
 once('static const char marker[]="RPGC001";',`static const char marker[]="${p.marker}";`);
 return Buffer.from('/* Separate hot profile, fixed ROM and explicit total caps. */\n'+s);
}
