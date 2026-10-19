/** Separate fixed-ROM 8042 native profile; source derivation, never builds or runs. */
import {deriveOwnedIn8Runtime} from '../bochs-cpu3-native-owned-in8/runtime.mjs';
import {replacement,sha256,authenticated} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {selfTestRomSha256,selfTestRomLayout} from './profile.mjs';
export const native8042Profile=Object.freeze({kind:'free-8042-self-test-native-v1',romSha256:'b8274e345a5585d2226f982003d1479004cf7f2fb296003caf45e73b3775018f',totalNativeTicks:512,totalQuanta:512,successHltOffset:0x32,marker:'K',expectedWitness:Object.freeze([0x55,0xff]),expectedFaults:0,expectedIrqDeliveries:0,abiVersion:4});
export function deriveOwned8042Runtime(){
 if(selfTestRomSha256!==native8042Profile.romSha256||selfTestRomLayout.successHlt!==0xf0032)throw Error('8042 fixed ROM/profile mismatch');
 const base=deriveOwnedIn8Runtime();authenticated(base.bytes,'8b1aa9d03e8f4112e504ab16cb977649faae5ce3b04848a327b0c8b9d21f6ae5','held owned IN8 runtime');let s=base.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939"))return 0;',`if(strcmp(sha,"${native8042Profile.romSha256}"))return 0;`,'8042 initializer ROM admission');
 once('(port!=0x40&&port!=0x21&&port!=0xa1))bw_slice_fail("owned-IN8-admission");','(port!=0x40&&port!=0x21&&port!=0xa1&&port!=0x60&&port!=0x64))bw_slice_fail("owned-IN8-admission");','8042 IN8 status/data admission');
 once('if(port==0x64&&value!=0xd1)return 0;','if(port==0x64&&value!=0xd1&&value!=0xaa)return 0;','8042 byte self-test command admission');
 once('static const char marker[]="RPGH001";','static const char marker[]="K";','8042 success marker');
 once('bw_port_bytes_seen>=7','bw_port_bytes_seen>=1','8042 exactly one success marker');
 const caps=[
  '    if(bw_slice_ticks>=bw_native_budget||bw_owned.n>=160000)bw_slice_fail("owned-N-cap");',
  '    if(bw_slice_quanta>=bw_quantum_budget||bw_owned.q>=150000||bw_owned.debt>=bw_owned.deadline)bw_slice_fail("owned-Q-cap-or-due");',
  '  if (bw_ticks>=160000 || count>160000-bw_ticks) bw_slice_fail("hot-native-total-before-callback");',
  '  if (!bw_slice_active || bw_successful_quanta>=150000 || kind>1 || bw_slice_quanta>=bw_quantum_budget ||',
  '  if (bw_ticks>=160000 || bw_successful_quanta>=150000) return 0;',
  '  const uint32_t hot_remaining_ticks=(uint32_t)(160000-bw_ticks);',
  '  const uint32_t hot_remaining_quanta=(uint32_t)(150000-bw_successful_quanta);'];
 for(const [i,line]of caps.entries())once(line,line.replaceAll('160000','512').replaceAll('150000','512'),'8042 bounded total cap '+i);
 once('if((type!=2&&(type!=1||(want!=0x7000&&want!=0x107000)))||(want&4095)||bw_cold_kind(want+4095)!=type)return 0;','if(type!=2||(want&4095)||bw_cold_kind(want+4095)!=type)return 0;','8042 ROM-only execution admission');
 once('if(op==0xf3){bw_rep_allowed=true;++prefixes;continue;}','if(op==0xf3)bw_slice_fail("8042-no-REP");','8042 fixed ROM forbids REP prefix');
 once('if(!vector||!bw_host_irq_line)return 0;if(bw_mapping_pending)', 'if(!vector||!bw_host_irq_line)return 0;bw_slice_fail("8042-no-ACK");if(bw_mapping_pending)','8042 no IRQ acknowledgement');
 once('if(!bw_slice_active||bw_in_resume||(asserted!=0&&asserted!=1))return 0;','if(!bw_slice_active||bw_in_resume||asserted!=0)return 0;','8042 only deasserted IRQ line');
 once('  if(vector!=14||error!=2||bw_faults>=2||bw_delivery_kind)bw_slice_fail("unexpected-fault");','  bw_slice_fail("8042-no-fault");','8042 no native faults');
 once('  if(bw_delivery_kind!=2||vector!=bw_last_irq_vector||bw_ticks!=bw_irq_ack_ticks||bw_successful_quanta!=bw_irq_ack_quanta)bw_slice_fail("host-irq-delivery");','  bw_slice_fail("8042-no-IRQ-delivery");','8042 no native IRQ delivery');
 once('  if (bw_slice_active) {\n    bw_halted = true;',String.raw`  if (bw_slice_active) {
    if(bw_port_bytes_seen!=1||bw_faults||bw_irq_deliveries||bw_host_irq_line||bw_mapping_pending||
       bw_mapping_epoch||!bw_board_a20||BX_CPU(0)->get_IF()||
       BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value!=0xf000||BX_CPU(0)->get_eip()!=0x33)
      bw_slice_fail("8042-terminal-HLT-profile");
    bw_halted = true;`,'8042 success-only terminal HLT after held clock flush');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==sha256(base.bytes))throw Error('8042 runtime inverse mismatch');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits,profile:native8042Profile};
}
