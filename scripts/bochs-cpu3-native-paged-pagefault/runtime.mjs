/** Exact distinct PF runtime derivative; never installed over old fault-refusing profiles. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {derivePagedIntIretRuntime,intDomainExpression as heldDomain,policyHelpers as heldHelpers} from '../bochs-cpu3-native-paged-int-iret/runtime.mjs';
import {nativePageFaultProfile,walkOwners,nativeOrdinaryReads,generationBeforeBoot,nativeFrameStores} from './provider-profile.mjs';
import {pageFaultProfile,bootStores,entries,gate,ramProgram,romInstructions,ramInstructions,afterPe,afterPg,afterCr3,afterSs,farJumpIp,dsWriteIp,ssWriteIp} from './profile.mjs';
export const runtimeParentSha256='44d6166807419eebc02f6e69f767e22fed21ead738b2a10e71d87791c364b796';
export const runtimeModuleSha256='fd0c289171e1ff08f1978d3fd687954e9706c052870f89abefc53c080e4e1ea1';
const nums=a=>a.map(String).join(','),positions=(a,pe)=>a.map(i=>`(eip==${i.ip}&&length==${i.bytes.length}&&pe==${pe(i)})`).join('||');
export const faultDomainExpression=`!cs32&&!interrupts&&!mappingPending&&a20==1&&start==base+eip&&start<=4294967295&&((selector==0xf000&&((base==0xffff0000&&!pe&&eip==65520&&length==5)||(base==0xf0000&&(${positions(romInstructions,i=>i.ip>=afterPe?1:0)}))))||(selector==24&&base==0&&pe==1&&(${positions(ramInstructions,()=>1)})))`;
const table=Object.values(entries),boot=bootStores.length,codeGen=bootStores.filter(s=>(s.raw&~4095)===0xa000).length;
const phase=name=>walkOwners.findIndex(x=>x.phase===name)+1;
const owners=walkOwners.map((x,i)=>`if(liveCs==${x.liveCs}&&liveIp==${x.liveIp}&&bw_delivery_kind==${x.delivery}${x.attempt?`&&cs==${x.attempt.cs}&&eip==${x.attempt.ip}`:''}){return ${i+1};}`).join('\n');
const leaves=walkOwners.map((x,i)=>`if(phase==${i+1}){return ${x.leaves.map(raw=>`raw==${raw}`).join('||')};}`).join('\n');
export const policyHelpers=`static unsigned bw_paging_boot=0,bw_pf_frame_words=0,bw_pf_stage=0,bw_pf_repaired=0,bw_pf_retry=0,bw_pf_reload=0;
static uint32_t bw_paging_values[${table.length}]={${nums(table.map(e=>e.value))}};
static const uint32_t bw_paging_address[${table.length}]={${nums(table.map(e=>e.raw))}};
static int bw_paging_entry(uint32_t raw){for(unsigned i=0;i<${table.length};++i){if(raw==bw_paging_address[i]){return (int)i;}}return -1;}
static unsigned bw_paging_owner(unsigned liveCs,uint32_t liveIp,unsigned cs,uint32_t eip){${owners}\n return 0;}
static bool bw_pf_leaf(unsigned phase,uint32_t raw){${leaves}\n return false;}
static bool bw_paging_walk(unsigned kind,uint32_t raw,unsigned length,unsigned liveCs,uint32_t liveIp,unsigned cs,uint32_t eip){
 if(length!=4||bw_paging_boot!=${boot}){return false;}const unsigned phase=bw_paging_owner(liveCs,liveIp,cs,eip);if(!phase){return false;}
 return (kind==1||kind==3)?raw==0x1000:(kind==2||kind==4)&&bw_pf_leaf(phase,raw);
}
static uint32_t bw_paging_dword(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static bool bw_paging_ad(uint32_t raw,const uint8_t *data,unsigned length){
 const int i=bw_paging_entry(raw);if(i<0||length!=4){return false;}const uint32_t before=bw_paging_values[i],after=bw_paging_dword(data);
 if(!(before&1)){return false;}const bool dirty=raw==0x2034||raw==0x2008||raw==0x2020;return after!=before&&after==(before|(dirty?0x60U:0x20U));
}
static uint8_t bw_protected_ram_byte(unsigned offset,uint32_t generation){if(offset>=4096||generation!=${codeGen}){bw_slice_fail("PF-code-generation");}static const uint8_t bytes[${ramProgram.length}]={${nums(ramProgram)}};return offset<${ramProgram.length}?bytes[offset]:0;}
static unsigned bw_pf_table_generation(void){unsigned count=${bootStores.filter(s=>(s.raw&~4095)===0x2000).length}+bw_pf_repaired;for(unsigned i=0;i<${table.length};++i){if(bw_paging_address[i]!=0x1000&&(bw_paging_values[i]&0x20U)){++count;}}return count;}
static bool bw_paging_store(uint32_t raw,uint32_t want,unsigned length,const uint8_t *data,uint32_t generation,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length){return false;}
 if(walk){if(!bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip)||(walk!=3&&walk!=4)||!bw_paging_ad(raw,data,length)){return false;}
  if(raw==0x2034){return walk==4&&bw_delivery_kind==1&&bw_pf_stage==1&&bw_paging_owner(liveCs,liveIp,cs,eip)==${phase('fault-delivery')};}
  if(raw==0x2008){return walk==4&&bw_pf_stage==2&&bw_paging_owner(liveCs,liveIp,cs,eip)==${phase('handler-PTE-repair')};}
  if(raw==0x2020){return walk==4&&bw_pf_stage==7&&bw_pf_reload==1&&bw_pf_repaired==1&&bw_paging_owner(liveCs,liveIp,cs,eip)==${phase('fault-or-retry-write')};}
  return true;
 }
 if(bw_paging_boot<${boot}){static const uint32_t address[${boot}]={${nums(bootStores.map(s=>s.raw))}},ip[${boot}]={${nums(bootStores.map(s=>s.ip))}};static const unsigned before[${boot}]={${nums(generationBeforeBoot)}};
  static const uint8_t bytes[${boot}][4]={${bootStores.map(s=>`{${nums(s.bytes)}}`).join(',')}};const unsigned i=bw_paging_boot;return cs==0xf000&&eip==ip[i]&&raw==address[i]&&length==4&&generation==before[i]&&!memcmp(data,bytes[i],4);}
 if(bw_delivery_kind==1&&bw_pf_stage==1){static const uint32_t address[4]={${nums(nativeFrameStores.map(e=>e.raw))}};static const uint8_t bytes[4][2]={${nativeFrameStores.map(e=>`{${nums(e.bytes)}}`).join(',')}};
  return bw_pf_frame_words<4&&cs==24&&eip==0x7003&&liveCs==24&&liveIp==0x7003&&raw==address[bw_pf_frame_words]&&length==2&&generation==bw_pf_frame_words&&!memcmp(data,bytes[bw_pf_frame_words],2)&&bw_paging_values[${table.findIndex(e=>e.raw===entries.stack.raw)}]==0xc063;}
 if(cs==24&&eip==0x7020&&liveCs==24&&liveIp==0x7029){return bw_pf_stage==2&&bw_pf_frame_words==4&&!bw_pf_repaired&&raw==0x2020&&length==4&&generation==bw_pf_table_generation()&&bw_paging_values[${table.findIndex(e=>e.raw===entries.table.raw)}]==0x2063&&bw_paging_dword(data)==0xb003;}
 return cs==24&&eip==0x7003&&liveCs==24&&liveIp==0x7006&&bw_pf_stage==7&&bw_pf_reload==1&&bw_pf_repaired==1&&!bw_pf_retry&&raw==0xb000&&length==2&&generation==1&&data[0]==0x34&&data[1]==0x12&&bw_paging_values[${table.findIndex(e=>e.raw===entries.data.raw)}]==0xb063;
}
static void bw_paging_commit(uint32_t raw,const uint8_t *data,unsigned walk){
 if(walk){const int i=bw_paging_entry(raw);if(i<0){bw_slice_fail("PF-commit-entry");}bw_paging_values[i]=bw_paging_dword(data);}
 else if(bw_paging_boot<${boot}){++bw_paging_boot;}else if(bw_delivery_kind==1){if(bw_pf_frame_words>=4){bw_slice_fail("PF-frame-count");}++bw_pf_frame_words;}
 else if(raw==0x2020&&!bw_pf_repaired){bw_pf_repaired=1;bw_paging_values[${table.findIndex(e=>e.raw===entries.data.raw)}]=0xb003;}else if(raw==0xb000&&!bw_pf_retry){bw_pf_retry=1;}else{bw_slice_fail("PF-ordinary-commit-phase");}
}
static bool bw_paging_read(uint32_t raw,uint32_t want,unsigned length,unsigned kind,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length){return false;}if(walk){return kind==1&&(walk==1||walk==2)&&bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip);}
 if(cs==24&&eip==0x7003&&!(bw_delivery_kind==1&&bw_pf_stage==1&&liveCs==24&&liveIp==0x7003)){return false;}
 if(cs==24&&eip==0x7032&&!(bw_pf_stage==6&&liveCs==24&&liveIp==0x7033)){return false;}
 if(cs==24&&eip==0x7006&&!(bw_pf_stage==8&&liveCs==24&&liveIp==0x700a)){return false;}
 ${nativeOrdinaryReads.map(r=>`if(cs==${r.cs}&&eip==${r.ip}&&kind==${r.kind}&&raw>=${r.raw}&&raw<${r.raw+r.length}&&length<=${r.raw+r.length}-raw){return true;}`).join('\n')}return false;
}
static bool bw_paging_observed(uint32_t raw,const uint8_t *data,unsigned length,unsigned cs,uint32_t eip,unsigned walk){
 if(walk){const int i=bw_paging_entry(raw);return i>=0&&length==4&&bw_paging_dword(data)==bw_paging_values[i];}
 static const uint8_t segment[8]={255,255,0,0,0,0x93,0,0},code[8]={255,255,0,0,0,0x9b,0,0},gate[8]={${nums(gate.bytes)}},frame[6]={3,0x70,24,0,2,0};
 if(cs==0xf000&&(eip==${dsWriteIp}||eip==${ssWriteIp})){return raw>=0x610&&raw<0x618&&length>0&&length<=0x618-raw&&!memcmp(data,segment+raw-0x610,length);}
 if((cs==0xf000&&eip==${farJumpIp})||(cs==24&&(eip==0x7003||eip==0x7032))){if(raw>=0x618&&raw<0x620&&length>0&&length<=0x620-raw){return !memcmp(data,code+raw-0x618,length);}}
 if(cs==24&&eip==0x7003&&raw>=0x3070&&raw<0x3078&&length>0&&length<=0x3078-raw){return !memcmp(data,gate+raw-0x3070,length);}
 if(cs==24&&eip==0x7032&&bw_pf_frame_words==4&&raw>=0xcffa&&raw<0xd000&&length>0&&length<=0xd000-raw){return !memcmp(data,frame+raw-0xcffa,length);}
 return cs==24&&eip==0x7006&&bw_pf_retry==1&&raw>=0xb000&&raw<0xb002&&length>0&&length<=0xb002-raw&&data[0]==(raw==0xb000?0x34:0x12)&&(length==1||data[1]==0x12);
}
static bool bw_paging_reset_phase(unsigned cs,uint32_t eip,uint32_t cr0,uint32_t cr3){const uint32_t c=cs==24?0xfffffff1U:cs!=0xf000?0:eip==65520?0x7ffffff0U:eip>=${afterPg}?0xfffffff1U:eip>=${afterPe}?0x7ffffff1U:0x7ffffff0U;return c&&cr0==c&&cr3==(cs==24||(cs==0xf000&&eip!=65520&&eip>=${afterCr3})?0x1000U:0U);}
static bool bw_int_shadow(unsigned cs,uint32_t eip,bool interrupts,bool debug){const bool expected=cs==0xf000&&eip==${afterSs};return interrupts==expected&&debug==expected;}
static uint32_t bw_paging_physical(unsigned cs,uint64_t base,uint32_t eip){return cs==24?0xa000U+eip-0x7000U:(uint32_t)(base+eip);}
static void bw_pf_observe_tlb(void){if(!bw_bridge_tlb_reason&&bw_in_resume&&bw_attempt_cs==24&&bw_attempt_eip==0x702c){if(bw_pf_stage!=4||bw_pf_reload||BX_CPU(0)->cr3!=0x1000){bw_slice_fail("PF-real-CR3-reload");}++bw_pf_reload;}}
static bool bw_pf_fault_allowed(unsigned vector,unsigned error){return bw_in_resume&&bw_paging_boot==${boot}&&bw_pf_stage==0&&bw_faults==0&&bw_pf_frame_words==0&&!bw_pf_repaired&&!bw_pf_retry&&vector==14&&error==2&&BX_CPU(0)->cr2==0x8000&&bw_attempt_cs==24&&bw_attempt_eip==0x7003&&BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value==24&&BX_CPU(0)->prev_rip==0x7003&&BX_CPU(0)->get_eip()==0x7006&&BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx==0xe000&&!BX_CPU(0)->get_IF();}
static void bw_pf_completed(void){
 if(bw_attempt_cs!=24){if(bw_pf_stage){bw_slice_fail("PF-returned-to-ROM");}return;}
 if(bw_attempt_eip==0x7000){if(bw_pf_stage||BX_CPU(0)->get_eip()!=0x7003){bw_slice_fail("PF-first-RAM-MOV");}return;}
 static const uint32_t owner[7]={0x7020,0x7029,0x702c,0x702f,0x7032,0x7003,0x7006},after[7]={0x7029,0x702c,0x702f,0x7032,0x7003,0x7006,0x700a};
 if(bw_pf_stage<2||bw_pf_stage>8||bw_attempt_eip!=owner[bw_pf_stage-2]||BX_CPU(0)->get_eip()!=after[bw_pf_stage-2]){bw_slice_fail("PF-completed-owner-phase");}
 if((bw_pf_stage==2&&!bw_pf_repaired)||(bw_pf_stage==4&&bw_pf_reload!=1)||(bw_pf_stage==7&&bw_pf_retry!=1)){bw_slice_fail("PF-completed-effect-phase");}++bw_pf_stage;
}
`;
export function transformPagedPageFaultRuntime(bytes){let s=authenticated(bytes,runtimeParentSha256,'held qualified fault-refusing INT runtime');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"b8b3525d4299ba14dc467144fc743a39f1c04d1a7d92ea3b34da6f4ee601cd30"))return 0;',`if(strcmp(sha,"${pageFaultProfile.romSha256}"))return 0;`,'distinct owned PF ROM');
 once(heldDomain,faultDomainExpression,'only fixed PF ROM/RAM opcodes');once(heldHelpers,policyHelpers,'PF read/write/walk/delivery owner predicates before callers');
 once('  bw_slice_fail("cold-BIOS-no-fault");','  if(!bw_pf_fault_allowed(vector,error))bw_slice_fail("fixed-PF-owner-vector-error-CR2");\n  bw_pf_stage=1;','one actual narrowly owned fault before delivery');
 once('  bw_emit_boundary("fault-delivery");bw_delivery_kind=0;','  if(bw_pf_stage!=1||bw_faults!=1||bw_pf_frame_words!=4||BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value!=24||BX_CPU(0)->get_eip()!=0x7020||BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx!=0xdff8||BX_CPU(0)->read_eflags()!=2)bw_slice_fail("fixed-PF-delivered-frame-state");\n  bw_pf_stage=2;\n  bw_emit_boundary("fault-delivery");bw_delivery_kind=0;','real delivered handler/frame and original N1Q0 guard retained');
 once('  if (bw_slice_rep_incomplete) ++bw_rep_partial;','  bw_pf_completed();\n  if (bw_slice_rep_incomplete) ++bw_rep_partial;','retired fixed handler/retry sequence; failed attempt never completes');
 const tlb='void bw_slice_note_tlb_flush(void){if(!bw_slice_active)return;';
 once('void bw_slice_note_tlb_flush(void){','static void bw_pf_observe_tlb(void);\nvoid bw_slice_note_tlb_flush(void){','PF observer forward declaration before inherited TLB hook');
 once(tlb,tlb+'bw_pf_observe_tlb();','observe genuine CPU CR3 flush once, not synthetic invalidation');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'PF runtime inverse '+e.label);assert.equal(sha256(inverse),runtimeParentSha256);return {bytes:Buffer.from(s),edits,baseSha256:runtimeParentSha256,profile:nativePageFaultProfile};
}
export function derivePagedPageFaultRuntime(){authenticated(readFileSync(new URL('../bochs-cpu3-native-paged-int-iret/runtime.mjs',import.meta.url)),runtimeModuleSha256,'held INT runtime module');return transformPagedPageFaultRuntime(derivePagedIntIretRuntime().bytes);}
