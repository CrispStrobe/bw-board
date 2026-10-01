/** Separate combined transform over byte-pinned REP/PF/PIT derivation. */
import {readFileSync} from 'node:fs';
import {patchPinnedSource as rep,revision,sha256,upstreamHashes} from '../bochs-cpu3-native-rep-pf-pit/patch.mjs';
if(sha256(readFileSync(new URL('../bochs-cpu3-native-rep-pf-pit/patch.mjs',import.meta.url)))!=='fd5ce0da16e6873a2c6dcc530e7e76dc66e597b74553de8febef9d32d620a013')throw Error('frozen combined derivation changed');
export {revision,sha256,upstreamHashes};
export function patchPinnedSource(path,bytes){
 const transformed=rep(path,bytes);
 if(path!=='bochs/cpu/paging.cc')return transformed;
 const text=transformed.toString();
 const needle='  BX_CPU_THIS_PTR iCache.breakLinks();\n}\n\n#if BX_CPU_LEVEL >= 6\nvoid BX_CPU_C::TLB_flushNonGlobal';
 if(text.split(needle).length!==2)throw Error('combined TLB completion seam changed');
 return Buffer.from(text.replace(needle,'  BX_CPU_THIS_PTR iCache.breakLinks();\n  if (bw_slice_active) bw_slice_note_tlb_flush();\n}\n\n#if BX_CPU_LEVEL >= 6\nvoid BX_CPU_C::TLB_flushNonGlobal'));
}
