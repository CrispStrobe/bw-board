/** V2 event adapter, layered over the frozen v1 source transform. */
import {patchPinnedSource as patchV1,revision,sha256,upstreamHashes} from '../bochs-cpu3-native-slice/patch.mjs';
export {revision,sha256,upstreamHashes};

function once(source,from,to) {
  if (source.split(from).length!==2) throw new Error(`event patch context: ${from.slice(0,80)}`);
  return source.replace(from,to);
}
function all(source,from,to,count) {
  if (source.split(from).length-1!==count) throw new Error(`event patch count: ${from.slice(0,80)}`);
  return source.split(from).join(to);
}

export function patchPinnedSource(path,bytes) {
  let source=patchV1(path,bytes).toString('utf8');
  if(path==='bochs/cpu/cpu.cc') {
    source=once(source,
      '      if (handleAsyncEvent()) {\n        // If request to return to caller ASAP.\n        return;\n      }',
      '      if (handleAsyncEvent()) {\n        // Idle return or external stop, before a handler instruction.\n        return;\n      }\n      if (bw_slice_active && bw_slice_irq_pending) {\n        BX_CPU_THIS_PTR prev_rip = RIP;\n        BX_CPU_THIS_PTR speculative_rsp = 0;\n        return; // external IRQ delivered; handler has not executed\n      }');
    source=once(source,
      '    if (bw_slice_active && bw_slice_ticks_reached()) return;',
      '    if (bw_slice_active && bw_slice_ticks_reached()) return;');
    const first=source.indexOf('void BX_CPP_AttrRegparmN(2) BX_CPU_C::repeat(');
    const end=source.indexOf('\n// boundaries of consideration:',first);
    if(first<0 || end<0) throw new Error('repeat region missing');
    let region=source.slice(first,end);
    region=all(region,'    while(1) {\n',
      '    while(1) {\n      bw_slice_rep_pre_iteration();\n',9);
    source=source.slice(0,first)+region+source.slice(end);
    source=once(source,'#include "bw_slice_runtime.inc"',
      '#include "bw_slice_runtime.inc"');
  }
  if(path==='bochs/cpu/event.cc') {
    source=once(source,
      '  if (bw_slice_active) { bw_slice_note_halt(); return 1; }\n','');
    source=once(source,
      '    BX_TICKN(10); // when in HLT run time faster for single CPU',
      '    if (bw_slice_active) { bw_slice_note_halt(); return 1; }\n    BX_TICKN(10); // when in HLT run time faster for single CPU');
    source=once(source,
      '  if (bw_slice_active) bw_slice_fail("Bochs-PIC-fallback");\n','');
    source=once(source,
      '    vector = DEV_pic_iac(); // may set INTR with next interrupt',
      '    vector = bw_slice_active ? bw_slice_ack_irq() : DEV_pic_iac();');
    const acknowledgeStart=source.indexOf('void BX_CPU_C::InterruptAcknowledge(void)');
    const acknowledgeEnd=source.indexOf('\n#if BX_SUPPORT_SVM\nvoid BX_CPU_C::VirtualInterruptAcknowledge',acknowledgeStart);
    if(acknowledgeStart<0 || acknowledgeEnd<0) throw new Error('acknowledge region missing');
    const acknowledged=once(source.slice(acknowledgeStart,acknowledgeEnd),
      '  interrupt(vector, BX_EXTERNAL_INTERRUPT, 0, 0);\n\n  BX_CPU_THIS_PTR prev_rip = RIP;',
      '  interrupt(vector, BX_EXTERNAL_INTERRUPT, 0, 0);\n  if (bw_slice_active) bw_slice_note_irq(vector);\n\n  BX_CPU_THIS_PTR prev_rip = RIP;');
    source=source.slice(0,acknowledgeStart)+acknowledged+source.slice(acknowledgeEnd);
  }
  return Buffer.from(source);
}
