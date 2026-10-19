import {readFileSync} from 'node:fs';
import {deriveHotRuntime} from '../bochs-cpu3-native-hot-direct/runtime.mjs';
import {authenticated,replacement,sha256} from './derive.mjs';
export const heldRuntimeSha256='89acf83dda501a097550e0465b4db2351229a991e51cbf8439d43bad77d4a42a';
export function deriveOwnedRuntime(){
 const base=deriveHotRuntime();let s=authenticated(base,heldRuntimeSha256,'H4 runtime');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('static unsigned bw_next_a20;static uint32_t bw_next_epoch;','static unsigned bw_next_a20;static uint32_t bw_next_epoch;\n'+readFileSync(new URL('./clock.inc',import.meta.url),'utf8'),'static clock storage');
 once('  return bw_direct_scalar(BW_DIRECT_TICK,count,0,0)==0;','  bw_owned_append(BW_OWNED_N1);return 1;','N append');
 once('  const unsigned reply=bw_direct_scalar(BW_DIRECT_QUANTUM,kind,0,0);','  bw_owned_append(kind?BW_OWNED_QREP:BW_OWNED_Q0);\n  const unsigned reply=bw_owned.debt>=bw_owned.deadline;','Q append');
 once('  if(!bw_direct_host.memory(', '  if(bw_mapping_pending)bw_slice_fail("owned-memory-mapping-pending");bw_owned_transfer(BW_OWNED_MEMORY);\n  if(!bw_direct_host.memory(','memory flush');
 once('  if(!bw_direct_host.page(', '  if(bw_mapping_pending)bw_slice_fail("owned-PAGE-mapping-pending");bw_owned_transfer(BW_OWNED_PAGE);\n  if(!bw_direct_host.page(','PAGE flush');
 once('  if(!vector||!bw_host_irq_line)return 0;unsigned supplied=', '  if(!vector||!bw_host_irq_line)return 0;if(bw_mapping_pending)bw_slice_fail("owned-ACK-mapping-pending");bw_owned_transfer(BW_OWNED_ACK);unsigned supplied=','ACK flush');
 once('  if(!bw_direct_host.scalar(bw_direct_host.context,BW_DIRECT_PIO_OUT,','  bw_owned_transfer(BW_OWNED_PRE_PIO);\n  if(!bw_direct_host.scalar(bw_direct_host.context,BW_DIRECT_PIO_OUT,','PIO flush');
 once('  if(port==0xe9)++bw_port_bytes_seen;', '  bw_owned_query_phase=BW_OWNED_POST_PIO;bw_owned_transfer(BW_OWNED_POST_PIO,true);\n  if(port==0xe9)++bw_port_bytes_seen;','PIO rearm');
 once('!max_successful_quanta || max_successful_quanta>300 || !callbacks ||','max_native_ticks>600 || !max_successful_quanta || max_successful_quanta>300 || !callbacks ||','C entry cap');
 once('  bw_in_resume = true;\n  if (bw_native_budget)', '  bw_owned_empty();bw_in_resume = true;\n  bw_owned_query_phase=BW_OWNED_ENTRY;bw_owned_transfer(BW_OWNED_ENTRY,true);\n  if (bw_native_budget)','ENTRY query');
 once('  bw_in_resume = false;\n  bw_deadline_due', '  bw_owned_transfer(BW_OWNED_RETURN);\n  bw_in_resume = false;\n  bw_deadline_due','RETURN flush');
 once('!callbacks->page||!callbacks->scalar||(capture', '!callbacks->page||!callbacks->scalar||!callbacks->clock_transfer||callbacks->size!=sizeof(*callbacks)||callbacks->version!=3||(capture','ABI3 table');
 once('  bw_direct_lifetime.store(2);return 1;','  bw_owned_query_phase=BW_OWNED_INIT;bw_owned_transfer(BW_OWNED_INIT,true);\n  bw_direct_lifetime.store(2);return 1;','INIT query');
 once('  bw_host_irq_line=asserted!=0;', '  bw_owned_empty();bw_host_irq_line=asserted!=0;','paused IRQ');
 once('  if(!out||!bw_direct_paused_thread())return 0;memset', '  if(!out||!bw_direct_paused_thread())return 0;bw_owned_empty();memset','paused inspect');
 once('  if(!bw_direct_paused_thread()||bw_in_resume)return 0;','  if(!bw_direct_paused_thread()||bw_in_resume)return 0;bw_owned_empty();','paused close');
 once('reason="mapping-transition";bw_mapping_pending=false;', 'reason="mapping-transition";bw_mapping_pending=false;bw_owned.epoch=bw_mapping_epoch;bw_owned.a20=bw_board_a20;','published mapping mirror');
 once('  out->native_ticks=bw_ticks;', '  out->clock_transfer_counts[0]=bw_owned_calls;out->clock_transfer_counts[1]=bw_owned_commits;out->clock_transfer_counts[2]=bw_owned_words;\n  out->native_ticks=bw_ticks;','physical transfer counters');
 // Native-only trace boundaries keep their original ordering and ordinal.
 for(const [name,reason] of [['bw_slice_note_irq','BW_OWNED_IRQ'],['bw_slice_note_fault','BW_OWNED_FAULT'],['bw_slice_note_fault_delivered','BW_OWNED_FAULT'],['bw_slice_note_halt','BW_OWNED_HLT']]){
  const start=s.indexOf('void '+name+'('),brace=s.indexOf('{',start);if(start<0||brace<0)throw Error('owned fence seam '+name);
  const anchor=s.slice(start,brace+1);once(anchor,anchor+'\n  if(bw_in_resume)bw_owned_transfer('+reason+');',name);
 }
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);if(sha256(inverse)!==heldRuntimeSha256)throw Error('owned runtime inverse mismatch');
 return {bytes:Buffer.from(s),baseSha256:heldRuntimeSha256,edits};
}
