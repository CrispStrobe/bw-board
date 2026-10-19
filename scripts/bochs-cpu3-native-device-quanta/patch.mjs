/** Successful-work hook over the immutable CPU3 memory-map transform. */
import {patchPinnedSource as patchMemoryMap,revision,sha256,upstreamHashes}
  from '../bochs-cpu3-native-memory-map/patch.mjs';
export {revision,sha256,upstreamHashes};

export function patchPinnedSource(path,bytes) {
  let source=patchMemoryMap(path,bytes).toString('utf8');
  if(path==='bochs/cpu/cpu.cc'){
    const catchMarker='    if (bw_slice_active && bw_slice_fault_pending) {\n'
      +'      BX_CPU_THIS_PTR prev_rip = RIP;';
    if(source.split(catchMarker).length!==2)
      throw Error('pinned fault catch hook absent');
    source=source.replace(catchMarker,
      '    if (bw_slice_active && bw_slice_fault_pending) {\n'
      +'      bw_slice_note_fault_delivered();\n'
      +'      BX_CPU_THIS_PTR prev_rip = RIP;');
    const start=source.indexOf('void BX_CPP_AttrRegparmN(2) BX_CPU_C::repeat(');
    const end=source.indexOf('\n// boundaries of consideration:',start);
    if(start<0||end<0)throw Error('pinned REP region absent');
    let region=source.slice(start,end);
    // The older transform records the REP callback before the architectural
    // CX/ECX decrement. Keep that evidence, then notify successful functional
    // work after the decrement and before the early-return/async stop check.
    const decrement=/^([ \t]*)bw_slice_note_rep_iteration\(\);\n([ \t]*)(RCX --;|RCX = ECX - 1;|CX --;)$/gm;
    const matches=[...region.matchAll(decrement)];
    if(matches.length!==9)throw Error(`pinned REP decrement hooks: ${matches.length}`);
    region=region.replace(decrement,(_whole,noteIndent,countIndent,count)=>
      `${noteIndent}bw_slice_note_rep_iteration();\n${countIndent}${count}\n`
      +`${countIndent}bw_slice_note_successful_rep_iteration();`);
    source=source.slice(0,start)+region+source.slice(end);
  }
  return Buffer.from(source);
}
