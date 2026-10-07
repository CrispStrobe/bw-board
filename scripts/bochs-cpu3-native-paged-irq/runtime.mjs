/** Authenticated CPU3 runtime derivative for exactly one mapped IRQ0 delivery. */
import assert from 'node:assert/strict';
import {derivePagedIntIretRuntime,intDomainExpression,policyHelpers} from '../bochs-cpu3-native-paged-int-iret/runtime.mjs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {nativePagedIrqProfile,walkOwners,nativeOrdinaryReads,nativeFrameStores,generationBeforeBoot} from './provider-profile.mjs';
import {pagedIrqProfile,bootStores,markerStores,ramInstructions,ramProgram,entries,gate,afterSs,dsWriteIp,ssWriteIp,farJumpIp} from './profile.mjs';
export const parentSha256='44d6166807419eebc02f6e69f767e22fed21ead738b2a10e71d87791c364b796';
const nums=a=>a.map(String).join(',');
const between=(s,start,end,next,label)=>{const a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert.ok(a>=0&&b>a,label);const old=s.slice(a,b);return {old,next,output:replacement(s,old,next,label)};};
const ramDomain=ramInstructions.map(i=>`(eip==${i.ip}&&length==${i.bytes.length}&&pe==1)`).join('||');
const oldRam=intDomainExpression.slice(intDomainExpression.indexOf('(selector==24'));
const irqRam=`(selector==24&&base==0&&pe==1&&(interrupts==(eip==28673||eip==28674||eip==28677))&&(${ramDomain})))`;
export const irqDomainExpression=intDomainExpression.replace('!cs32&&!interrupts&&!mappingPending','!cs32&&!mappingPending').replace('(selector==0xf000&&','(selector==0xf000&&!interrupts&&').replace(oldRam,irqRam);
assert.notEqual(irqDomainExpression,intDomainExpression);
function buildHelpers(){let h=policyHelpers;
 const change=(old,next,label)=>{h=replacement(h,old,next,label);};
 const span=(start,end,next,label)=>{h=between(h,start,end,next,label).output;};
 change('static unsigned bw_paging_boot=0,bw_int_frame_words=0;', 'static unsigned bw_paging_boot=0,bw_int_frame_words=0,bw_irq_marker_words=0;', 'IRQ marker ledger');
 // Specific delivery owners precede generic code prefetch at the same IP.
 // During hardware delivery the last retired instruction still owns the
 // attempt ledger; its 7001 cut is distinct from the later 7002 CPU attempt.
 const allOwners=[...walkOwners.slice(0,2),
  ...walkOwners.filter(x=>x.phase.startsWith('IRQ-')||x.phase==='IRET-stack-CS'),
  ...walkOwners.filter(x=>x.phase.startsWith('code-prefetch-'))];
 assert.equal(allOwners.length,walkOwners.length);
 const owners=allOwners.map((x,i)=>`if(liveCs==${x.liveCs}&&liveIp==${x.liveIp}${x.attempt?`&&cs==${x.attempt.cs}&&eip==${x.attempt.ip}`:''}){return ${i+1};}`).join('\n');
 span('static unsigned bw_paging_owner(', 'static bool bw_int_leaf(',`static unsigned bw_paging_owner(unsigned liveCs,uint32_t liveIp,unsigned cs,uint32_t eip){${owners}\n return 0;}\n`, 'IRQ pagewalk owners');
 const leaves=allOwners.map((x,i)=>`if(phase==${i+1}){return ${x.leaves.map(raw=>`raw==${raw}`).join('||')};}`).join('\n');
 span('static bool bw_int_leaf(', 'static bool bw_paging_walk(',`static bool bw_int_leaf(unsigned phase,uint32_t raw){${leaves}\n return false;}\n`, 'IRQ pagewalk leaves');
 change('static const uint8_t bytes[20]={184,17,17,205,48,244,0,0,0,0,0,0,0,0,0,0,184,239,190,207};',`static const uint8_t bytes[20]={${nums(ramProgram)}};`,'fixed IRQ RAM instruction page');
 const boot=bootStores.length,codeGeneration=bootStores.filter(e=>(e.raw&~4095)===0xa000).length;
 assert.equal(boot,20);assert.equal(codeGeneration,5);
 const frameAddr=nums(nativeFrameStores.map(e=>e.raw));const frameBytes=nativeFrameStores.map(e=>`{${nums(e.bytes)}}`).join(',');
 const markAddr=nums(markerStores.map(e=>e.raw));const markBytes=markerStores.map(e=>`{${nums(e.bytes)}}`).join(',');
 const irqPhase=allOwners.findIndex(x=>x.phase==='IRQ-gate-stack')+1;
 const store=`static bool bw_paging_store(uint32_t raw,uint32_t want,unsigned length,const uint8_t *data,uint32_t generation,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length)return false;
 if(walk){if(!bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip)||(walk!=3&&walk!=4)||!bw_paging_ad(raw,data,length))return false;
  if(raw==0x2034)return walk==4&&(bw_paging_owner(liveCs,liveIp,cs,eip)==${irqPhase}||bw_delivery_kind==2);return true;}
 if(bw_paging_boot<${boot}){
  static const uint32_t address[${boot}]={${nums(bootStores.map(e=>e.raw))}},ip[${boot}]={${nums(bootStores.map(e=>e.ip))}};
  static const unsigned before[${boot}]={${nums(generationBeforeBoot)}};
  static const uint8_t bytes[${boot}][4]={${bootStores.map(e=>`{${nums(e.bytes)}}`).join(',')}};const unsigned i=bw_paging_boot;
  return cs==0xf000&&eip==ip[i]&&raw==address[i]&&length==4&&generation==before[i]&&!memcmp(data,bytes[i],4);}
 if(bw_delivery_kind==2&&bw_int_frame_words<3){
  static const uint32_t address[3]={${frameAddr}};static const uint8_t bytes[3][2]={${frameBytes}};
  return cs==24&&(eip==0x7001||eip==0x7002)&&liveCs==24&&(liveIp==0x7002||liveIp==0x700a)&&
   raw==address[bw_int_frame_words]&&length==2&&generation==bw_int_frame_words&&
   !memcmp(data,bytes[bw_int_frame_words],2)&&bw_paging_values[${Object.values(entries).findIndex(e=>e.raw===entries.stack.raw)}]==0xc063;}
 if(bw_irq_marker_words<2&&bw_int_frame_words==3){
  static const uint32_t address[2]={${markAddr}};static const uint8_t bytes[2][2]={${markBytes}};
  static const uint32_t ips[2]={${nums(markerStores.map(e=>e.ip))}};
  const unsigned i=bw_irq_marker_words;return cs==24&&eip==ips[i]&&
   raw==address[i]&&length==2&&generation==3+i&&!memcmp(data,bytes[i],2);}
 return false;
}
`;
 span('static bool bw_paging_store(', 'static void bw_paging_commit(',store,'IRQ boot/frame/marker store predicates');
 const commit=`static void bw_paging_commit(uint32_t raw,const uint8_t *data,unsigned walk){
 if(walk){const int i=bw_paging_entry(raw);if(i<0)bw_slice_fail("paged-IRQ-commit-entry");bw_paging_values[i]=bw_paging_dword(data);}
 else if(bw_paging_boot<${boot})++bw_paging_boot;
 else if(bw_delivery_kind==2&&bw_int_frame_words<3)++bw_int_frame_words;
 else if(bw_irq_marker_words<2)++bw_irq_marker_words;
 else bw_slice_fail("paged-IRQ-write-count");
}
`;
 span('static void bw_paging_commit(', 'static bool bw_paging_read(',commit,'IRQ commit counters');
 const ordinary=nativeOrdinaryReads.map(r=>`if(cs==${r.cs}&&eip==${r.ip}&&kind==${r.kind}&&raw>=${r.raw}&&raw<${r.raw+r.length}&&length<=${r.raw+r.length}-raw)return true;`).join('\n');
 const read=`static bool bw_paging_read(uint32_t raw,uint32_t want,unsigned length,unsigned kind,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length)return false;
 if(walk)return kind==1&&(walk==1||walk==2)&&bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip);
 if(bw_delivery_kind==2&&cs==24&&(eip==0x7001||eip==0x7002)&&liveCs==24&&
  ((raw>=0x3000&&raw<0x3008&&length<=0x3008-raw)||
   (raw>=0x618&&raw<0x620&&length<=0x620-raw)))return true;
 ${ordinary}
 return false;
}
`;
 span('static bool bw_paging_read(', 'static bool bw_paging_observed(',read,'IRQ owned physical reads');
 const observed=`static bool bw_paging_observed(uint32_t raw,const uint8_t *data,unsigned length,unsigned cs,uint32_t eip,unsigned walk){
 if(walk){const int i=bw_paging_entry(raw);return i>=0&&length==4&&bw_paging_dword(data)==bw_paging_values[i];}
 static const uint8_t segment[8]={255,255,0,0,0,0x93,0,0},code[8]={255,255,0,0,0,0x9b,0,0},gate[8]={${nums(gate.bytes)}},frame[6]={2,0x70,0x18,0,2,2};
 if(cs==0xf000&&(eip==${dsWriteIp}||eip==${ssWriteIp})&&raw>=0x610&&raw<0x618&&length>0&&length<=0x618-raw)return !memcmp(data,segment+raw-0x610,length);
 if((cs==0xf000&&eip==${farJumpIp}||cs==24&&(bw_delivery_kind==2||eip==0x7010))&&raw>=0x618&&raw<0x620&&length>0&&length<=0x620-raw)return !memcmp(data,code+raw-0x618,length);
 if(bw_delivery_kind==2&&raw>=0x3000&&raw<0x3008&&length>0&&length<=0x3008-raw)return !memcmp(data,gate+raw-0x3000,length);
 if(cs==24&&eip==0x7010&&bw_int_frame_words==3&&raw>=0xcffa&&raw<0xd000&&length>0&&length<=0xd000-raw)return !memcmp(data,frame+raw-0xcffa,length);
 return false;
}
`;
 span('static bool bw_paging_observed(', 'static bool bw_paging_reset_phase(',observed,'IRQ source readback bytes');
 change(`const bool expected=cs==0xf000&&eip==${afterSs};return interrupts==expected&&debug==expected;`, `const bool expected=cs==0xf000&&eip==${afterSs}||cs==24&&eip==0x7001;return interrupts==expected&&debug==(cs==0xf000&&eip==${afterSs});`, 'MOVSS and STI shadow');
 return h;
}
export const irqPolicyHelpers=buildHelpers();
export function derivePagedIrqRuntime(bytes=derivePagedIntIretRuntime().bytes){let s=authenticated(bytes,parentSha256,'qualified paged INT/IRET runtime');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once(`if(strcmp(sha,"b8b3525d4299ba14dc467144fc743a39f1c04d1a7d92ea3b34da6f4ee601cd30"))return 0;`,`if(strcmp(sha,"${pagedIrqProfile.romSha256}"))return 0;`,'new owned IRQ ROM');
 once(intDomainExpression,irqDomainExpression,'exact IF and opcode positions');
 once(policyHelpers,irqPolicyHelpers,'separate IRQ read/write/AD and marker policy');
 once('bw_slice_fail("cold-BIOS-no-ACK");if(!vector||!bw_host_irq_line)return 0;if(bw_mapping_pending)',
 'if(!vector||!bw_host_irq_line)return 0;if(bw_mapping_pending)',
 'remove inherited cold-profile ACK veto only in separate IRQ source');
 once('if(supplied!=0x20)return 0;*vector=(uint8_t)supplied;return 1;',
 'if(supplied!=0)return 0;*vector=(uint8_t)supplied;return 1;',
 'reset PIC vector zero in the exact source ACK bridge');
 once('unsigned bw_slice_ack_irq(void){\n  uint8_t vector=0;if(bw_delivery_kind||bw_irq_deliveries||!bw_callbacks.ack_irq||!bw_callbacks.ack_irq(bw_callbacks.context,&vector))bw_slice_fail("host-irq-ack");',
 'unsigned bw_slice_ack_irq(void){\n  BX_CPU_C *cpu=BX_CPU(0);if(!bw_host_irq_line||bw_delivery_kind||bw_irq_deliveries||bw_int_frame_words||bw_irq_marker_words||cpu->sregs[BX_SEG_REG_CS].selector.value!=24||cpu->get_eip()!=0x7002||!cpu->get_IF()||cpu->interrupts_inhibited(BX_INHIBIT_INTERRUPTS)||bw_ticks!=39||bw_successful_quanta!=39)bw_slice_fail("paged-IRQ-ack-preflight");\n  bw_require_clean();\n  uint8_t vector=0;if(!bw_callbacks.ack_irq||!bw_callbacks.ack_irq(bw_callbacks.context,&vector)||vector!=0)bw_slice_fail("paged-IRQ-ack-vector");',
 'admit exact source IRQ cut before effectful board PIC ACK');
 once('void bw_slice_note_irq(unsigned vector){\n  if(bw_in_resume)bw_owned_transfer(BW_OWNED_IRQ);\n  bw_slice_fail("cold-BIOS-no-IRQ-delivery");\n  ++bw_irq_deliveries;',
 'void bw_slice_note_irq(unsigned vector){\n  if(bw_delivery_kind!=2||vector!=bw_last_irq_vector||bw_ticks!=bw_irq_ack_ticks||bw_successful_quanta!=bw_irq_ack_quanta||bw_irq_deliveries||bw_int_frame_words!=3)bw_slice_fail("paged-IRQ-ack-frame-ledger");\n  if(bw_in_resume)bw_owned_transfer(BW_OWNED_IRQ);\n  ++bw_irq_deliveries;',
 'validate actual ACK/vector/NQ and all frame writes before observer');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'IRQ runtime inverse '+e.label);assert.equal(sha256(inverse),parentSha256);return {bytes:Buffer.from(s),edits,baseSha256:parentSha256,profile:nativePagedIrqProfile};}
