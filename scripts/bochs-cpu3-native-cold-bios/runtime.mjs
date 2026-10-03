/** Cold BIOS C source preparation only: no initializer/build/guest is executed here. */
import {deriveColdBiosRepFragment} from './runtime-rep.mjs';
import {cHelpers} from './fetch-policy.mjs';
import {authenticateBiosRepPolicy} from './rep-policy.mjs';
import {replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const coldNativeProfile=Object.freeze({romSha256:'6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac',totalNativeTicks:400000,totalQuanta:400000,checkpointCs:0xf000,checkpointEip:0xe16,abiVersion:4,status:'SOURCE_ONLY_NO_BUILD_OR_GUEST'});
export function deriveColdBiosRuntime(){
 authenticateBiosRepPolicy();const base=deriveColdBiosRepFragment();let s=base.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939"))return 0;',`if(strcmp(sha,"${coldNativeProfile.romSha256}"))return 0;`,'unmodified cold BIOS initializer');
 const caps=[
 '    if(bw_slice_ticks>=bw_native_budget||bw_owned.n>=160000)bw_slice_fail("owned-N-cap");',
 '    if(bw_slice_quanta>=bw_quantum_budget||bw_owned.q>=150000||bw_owned.debt>=bw_owned.deadline)bw_slice_fail("owned-Q-cap-or-due");',
 '  if (bw_ticks>=160000 || count>160000-bw_ticks) bw_slice_fail("hot-native-total-before-callback");',
 '  if (!bw_slice_active || bw_successful_quanta>=150000 || kind>1 || bw_slice_quanta>=bw_quantum_budget ||',
 '  if (bw_ticks>=160000 || bw_successful_quanta>=150000) return 0;',
 '  const uint32_t hot_remaining_ticks=(uint32_t)(160000-bw_ticks);',
 '  const uint32_t hot_remaining_quanta=(uint32_t)(150000-bw_successful_quanta);'];
 for(const [i,line]of caps.entries())once(line,line.replaceAll('160000','400000').replaceAll('150000','400000'),'cold bounded total cap '+i);
 once('(port!=0x40&&port!=0x21&&port!=0xa1))bw_slice_fail("owned-IN8-admission");','(port!=0x71&&port!=0x64&&port!=0x60))bw_slice_fail("owned-IN8-admission");','cold actual byte reads');
 const outStart=s.indexOf('  static const char marker[]="RPGH001";');
 const outEnd=s.indexOf('  uint32_t reply=0,a20=0,epoch=0;',outStart);
 if(outStart<0||outEnd<0)throw Error('cold OUT admission seam');
 once(s.slice(outStart,outEnd),String.raw`  if(width!=1||value>255)return 0;
  const bool admitted=(port==0x0d||port==0xda||port==0xd4||port==0x71||port==0x40||port==0x80)?value==0:
    port==0xd6?value==0xc0:port==0x70?value==0x0f:port==0x43?value==0x34:
    port==0x402?true:port==0x64?(value==0xaa||value==0xab):false;
  if(!admitted)return 0;
  if(bw_mapping_pending)bw_slice_fail("pio-mapping-pending");
`,'cold OUT exact preeffect domains');
 once('  if (!bw_slice_active) { bx_devices.outp(port, value, width); return; }','  if (!bw_slice_active) { bx_devices.outp(port, value, width); return; }\n  if(port>UINT16_MAX)bw_slice_fail("cold-BIOS-OUT-port-overflow");','raw OUT port before callback narrowing');
 once('  if(port==0xe9)++bw_port_bytes_seen;','  if(port==0x402)++bw_port_bytes_seen;','actual debug byte accounting without marker');
 once('if(!vector||!bw_host_irq_line)return 0;if(bw_mapping_pending)','bw_slice_fail("cold-BIOS-no-ACK");if(!vector||!bw_host_irq_line)return 0;if(bw_mapping_pending)','ACK refusal before effect');
 once('  if(vector!=14||error!=2||bw_faults>=2||bw_delivery_kind)bw_slice_fail("unexpected-fault");','  bw_slice_fail("cold-BIOS-no-fault");','no native fault delivery');
 once('  if(bw_delivery_kind!=2||vector!=bw_last_irq_vector||bw_ticks!=bw_irq_ack_ticks||bw_successful_quanta!=bw_irq_ack_quanta)bw_slice_fail("host-irq-delivery");','  bw_slice_fail("cold-BIOS-no-IRQ-delivery");','no IRQ delivery while preserving line');
 once('  if (bw_slice_active) {\n    bw_halted = true;','  if (bw_slice_active) {\n    bw_slice_fail("cold-BIOS-unexpected-HLT");\n    bw_halted = true;','ordinary checkpoint never HLT success');
 once('if((type!=2&&(type!=1||(want!=0x7000&&want!=0x107000)))||(want&4095)||bw_cold_kind(want+4095)!=type)return 0;','if(type!=2||(want&4095)||bw_cold_kind(want+4095)!=type)return 0;','cold ROM execution only');
 once('void bw_slice_note_attempt(unsigned length){',cHelpers+'\nvoid bw_slice_note_attempt(unsigned length){','shared cold fetch predicates');
 const fetchStart=s.indexOf('  uint32_t raw=(uint32_t)(BX_CPU(0)->pAddrFetchPage+');
 const fetchEnd=s.indexOf('  bw_rep_allowed=false;',fetchStart);
 if(fetchStart<0||fetchEnd<0)throw Error('cold fetch seam');
 once(s.slice(fetchStart,fetchEnd),String.raw`  BX_CPU_C *cpu=BX_CPU(0);const bx_segment_reg_t &cs=cpu->sregs[BX_SEG_REG_CS];
  const uint64_t start=(uint64_t)cs.cache.u.segment.base+bw_attempt_eip;
  if(!bw_cold_fetch_domain(cs.selector.value,cs.cache.u.segment.d_b,(cpu->cr0.get32()&1),cpu->get_IF(),cs.cache.u.segment.base,bw_attempt_eip,length,start,bw_mapping_pending,bw_board_a20))bw_slice_fail("cold-BIOS-fetch-domain");
  uint32_t raw=(uint32_t)start;uint8_t instruction[15];bw_coherent_page *page=0;
  for(unsigned k=0;k<length;++k){const uint32_t address=raw+k;bw_coherent_page *current=0;
    for(unsigned j=0;j<bw_page_count;++j)if(bw_pages[j].raw==(address&~4095U)&&bw_pages[j].epoch==bw_mapping_epoch)current=&bw_pages[j];
    if(!current||!bw_cold_fetch_page(true,current->raw,address&~4095U,current->epoch,bw_mapping_epoch,current->kind,current->decoded,bw_decode(address&~4095U),current->bytes[address&4095],bw_direct_rom[bw_decode(address)&65535]))bw_slice_fail("cold-BIOS-fetch-page");
    if(!k)page=current;current->executed=true;instruction[k]=current->bytes[address&4095];
  }
  bw_current_code_page=UINT32_MAX;
`,'actual-length authenticated one/two page fetch');
 const noteStart=s.indexOf('void bw_slice_note_attempt(unsigned length)');const noteEnd=s.indexOf('\nbool bw_slice_ticks_reached',noteStart);
 const old=s.slice(noteStart,noteEnd);let next=old.replaceAll('page->bytes[(raw&4095)+i]','instruction[i]').replaceAll('page->bytes+(raw&4095)','instruction');
 once(old,next,'REP and canonical bytes use authenticated instruction tape');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==sha256(base.bytes))throw Error('cold BIOS runtime inverse');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits,profile:coldNativeProfile};
}
