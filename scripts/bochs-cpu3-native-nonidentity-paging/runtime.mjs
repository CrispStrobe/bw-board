/** Narrow separate paging C derivative; preparation/build/execution remain pending. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveProtectedStackRuntime,policyHelpers as heldHelpers,stackDomainExpression as heldDomain} from '../bochs-cpu3-native-protected-stack/runtime.mjs';
import {nativePagingProfile,walkOwners,nativeOrdinaryReads,generationBeforeBoot} from './provider-profile.mjs';
import {pagingProfile,bootStores,entries,ramProgram,romInstructions,ramInstructions,afterPe,afterPg,afterCr3,farJumpIp,terminalEip} from './profile.mjs';
export const runtimeParentSha256='db9e773b36ab6e38636a47426db4434be17424a69d07c83e89ccf9c7f65603c3';
export const runtimeModuleSha256='d00a95fcde0a7af590acd59ce6a0018ffd437196e9c094172c0b4f0dba5e9806';
const nums=a=>a.map(String).join(',');
const positions=(rows,pe)=>rows.map(i=>`(eip==${i.ip}&&length==${i.bytes.length}&&pe==${pe(i)})`).join('||');
export const pagingDomainExpression=`!cs32&&!interrupts&&!mappingPending&&a20==1&&start==base+eip&&start<=4294967295&&((selector==0xf000&&((base==0xffff0000&&!pe&&eip==65520&&length==5)||(base==0xf0000&&(${positions(romInstructions,i=>i.ip>=afterPe?1:0)}))))||(selector==24&&base==0&&pe==1&&(${positions(ramInstructions,()=>1)})))`;
const table=Object.values(entries);
const walkCases=walkOwners.map((x,i)=>`if(liveCs==${x.liveCs}&&liveIp==${x.liveIp}${x.attempt?`&&cs==${x.attempt.cs}&&eip==${x.attempt.ip}`:''})return ${i+1};`).join('\n');
export const policyHelpers=`static unsigned bw_paging_boot=0;
static uint32_t bw_paging_values[5]={${nums(table.map(e=>e.value))}};
static const uint32_t bw_paging_address[5]={${nums(table.map(e=>e.raw))}};
static int bw_paging_entry(uint32_t raw){for(unsigned i=0;i<5;++i)if(raw==bw_paging_address[i])return (int)i;return -1;}
static unsigned bw_paging_owner(unsigned liveCs,uint32_t liveIp,unsigned cs,uint32_t eip){${walkCases}return 0;}
static bool bw_paging_walk(unsigned kind,uint32_t raw,unsigned length,unsigned liveCs,uint32_t liveIp,unsigned cs,uint32_t eip){
 if(length!=4||bw_paging_boot!=16)return false;unsigned phase=bw_paging_owner(liveCs,liveIp,cs,eip);if(!phase)return false;
 const uint32_t leaf=phase==1?0x23c0:phase==2?0x2000:phase==3?0x201c:0x2024;
 return (kind==1||kind==3)?raw==0x1000:(kind==2||kind==4)&&raw==leaf;
}
static uint32_t bw_paging_dword(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static bool bw_paging_ad(uint32_t raw,const uint8_t *data,unsigned length){
 const int i=bw_paging_entry(raw);if(i<0||length!=4)return false;const uint32_t before=bw_paging_values[i],after=bw_paging_dword(data);
 return after!=before&&(after==(before|0x20U)||(raw==0x2024&&before==0xb023&&after==0xb063));
}
static uint8_t bw_protected_ram_byte(unsigned offset,uint32_t generation){
 if(offset>=4096||generation!=4)bw_slice_fail("paging-code-generation");static const uint8_t bytes[16]={${nums(ramProgram)}};return offset<16?bytes[offset]:0;
}
static bool bw_paging_store(uint32_t raw,uint32_t want,unsigned length,const uint8_t *data,uint32_t generation,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length)return false;
 if(walk){if(!bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip)||(walk!=3&&walk!=4)||!bw_paging_ad(raw,data,length))return false;
  if(raw==0x2024&&(bw_paging_dword(data)&0x40U))return walk==4&&bw_paging_owner(liveCs,liveIp,cs,eip)==5;
  return true;
 }
 if(bw_paging_boot<16){
  static const uint32_t address[16]={${nums(bootStores.map(s=>s.raw))}},ip[16]={${nums(bootStores.map(s=>s.ip))}};static const unsigned before[16]={${nums(generationBeforeBoot)}};
  static const uint8_t bytes[16][4]={${bootStores.map(s=>`{${nums(s.bytes)}}`).join(',')}};const unsigned i=bw_paging_boot;
  return cs==0xf000&&eip==ip[i]&&raw==address[i]&&length==4&&generation==before[i]&&!memcmp(data,bytes[i],4);
 }
 return cs==24&&eip==0x7005&&raw==0xb002&&length==2&&generation==1&&data[0]==0x78&&data[1]==0x56&&bw_paging_values[3]==0xb063;
}
static void bw_paging_commit(uint32_t raw,const uint8_t *data,unsigned walk){if(walk){const int i=bw_paging_entry(raw);if(i<0)bw_slice_fail("paging-commit-entry");bw_paging_values[i]=bw_paging_dword(data);}else if(bw_paging_boot<16)++bw_paging_boot;}
static bool bw_paging_read(uint32_t raw,uint32_t want,unsigned length,unsigned kind,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length)return false;if(walk)return kind==1&&(walk==1||walk==2)&&bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip);
 ${nativeOrdinaryReads.map(r=>r.cs===24?`if(cs==${r.cs}&&eip==${r.ip}&&kind==${r.kind}&&raw==${r.raw}&&length==${r.length})return true;`:`if(cs==${r.cs}&&eip==${r.ip}&&kind==${r.kind}&&raw>=${r.raw}&&raw<${r.raw+r.length}&&length<=${r.raw+r.length}-raw)return true;`).join('\n')}
 return false;
}
static bool bw_paging_observed(uint32_t raw,const uint8_t *data,unsigned length,unsigned cs,uint32_t eip,unsigned walk){
 if(walk){const int i=bw_paging_entry(raw);return i>=0&&length==4&&bw_paging_dword(data)==bw_paging_values[i];}
 static const uint8_t segment[8]={255,255,0,0,0,0x93,0,0},code[8]={255,255,0,0,0,0x9b,0,0};
 if(cs==0xf000&&eip==${farJumpIp})return raw>=0x618&&raw<0x620&&length>0&&length<=0x620-raw&&!memcmp(data,code+raw-0x618,length);
 if(cs==0xf000&&eip==${nativeOrdinaryReads[1].ip})return raw>=0x610&&raw<0x618&&length>0&&length<=0x618-raw&&!memcmp(data,segment+raw-0x610,length);
 return length==2&&cs==24&&((eip==0x7001&&raw==0xb000&&data[0]==0x34&&data[1]==0x12)||(eip==0x700b&&raw==0xb002&&data[0]==0x78&&data[1]==0x56));
}
static bool bw_paging_reset_phase(unsigned cs,uint32_t eip,uint32_t cr0,uint32_t cr3){
 const uint32_t c=cs==24?0xfffffff1U:cs!=0xf000?0:eip==65520?0x7ffffff0U:eip>=${afterPg}?0xfffffff1U:eip>=${afterPe}?0x7ffffff1U:0x7ffffff0U;
 return c&&cr0==c&&cr3==(cs==24||(cs==0xf000&&eip!=65520&&eip>=${afterCr3})?0x1000U:0U);
}
static uint32_t bw_paging_physical(unsigned cs,uint64_t base,uint32_t eip){return cs==24?0xa000U+eip-0x7000U:(uint32_t)(base+eip);}
`;
export function transformNonidentityPagingRuntime(bytes){let s=authenticated(bytes,runtimeParentSha256,'qualified stack runtime');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once(`if(strcmp(sha,"6ddbe79cc2a982762e9bf9bb041a07b7f533c6df4a4ca99592cb92fdb6931cab"))return 0;`,`if(strcmp(sha,"${pagingProfile.romSha256}"))return 0;`,'distinct fixed nonidentity ROM');
 once(heldDomain,pagingDomainExpression,'fixed real/protected/paged instruction domain');once(heldHelpers,policyHelpers,'native owner/read/write/bit predicates before all callers');
 once('if(write){if(kind!=1||!bw_protected_store(raw,want,length,data,bw_generation_of(want),bw_attempt_cs,bw_attempt_eip))bw_slice_fail("protected-RAM-write-domain");}', 'if(write){if(kind!=1||!bw_paging_store(raw,want,length,data,bw_generation_of(want),bw_attempt_cs,bw_attempt_eip,bw_pagewalk_kind,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip()))bw_slice_fail("paging-write-domain");}','distinct boot/operand/native A-D write proof');
 once('else if(!bw_protected_read(raw,want,length,kind,bw_attempt_cs,bw_attempt_eip))bw_slice_fail("protected-RAM-read-domain");','else if(!bw_paging_read(raw,want,length,kind,bw_attempt_cs,bw_attempt_eip,bw_pagewalk_kind,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip()))bw_slice_fail("paging-read-domain");','live prefetch versus attempted operand read ownership');
 once('if(!write&&kind==1&&!bw_protected_observed(want,returned,length,bw_attempt_cs,bw_attempt_eip))bw_slice_fail("protected-GDT-read-bytes");','if(!write&&kind==1&&!bw_paging_observed(want,returned,length,bw_attempt_cs,bw_attempt_eip,bw_pagewalk_kind))bw_slice_fail("paging-observed-bytes");','actual returned page-table/GDT/data bytes');
 once('known=(uint32_t)generation;','known=(uint32_t)generation;bw_paging_commit(want,returned,bw_pagewalk_kind);','policy state commits only after successful authentic host write and generation');
 once('  if(write&&kind==1)bw_write_admission(want,length,bw_pagewalk_kind);','  if(bw_pagewalk_kind&&(BX_CPU(0)->cr0.get32()!=0xfffffff1U||(uint32_t)BX_CPU(0)->cr3!=0x1000U))bw_slice_fail("paging-walk-CR0-CR3");\n  if(write&&kind==1)bw_write_admission(want,length,bw_pagewalk_kind);','raw walk mode admission before authentic effect');
 once('(type!=2&&(type!=1||want!=0x7000))','(type!=2&&(type!=1||want!=0xa000))','one actual nonidentity physical executable page');
 once('(kind==1 && decoded==0x7000 && byte==bw_protected_ram_byte(offset,generation))','(kind==1 && decoded==0xa000 && byte==bw_protected_ram_byte(offset,generation))','physical code-byte lookup');
 once('  if(cpu->cr0.get32()&0x80000000U)bw_slice_fail("protected-RAM-no-paging");','  if(!bw_paging_reset_phase(cs.selector.value,bw_attempt_eip,cpu->cr0.get32(),(uint32_t)cpu->cr3))bw_slice_fail("paging-CR0-CR3-phase");','strict raw CR0/CR3 source phase; no normalization');
 once('  if(!bw_stack_shadow_phase(cs.selector.value,(uint32_t)cpu->get_eip(),cpu->interrupts_inhibited(BX_INHIBIT_INTERRUPTS),cpu->interrupts_inhibited(BX_INHIBIT_DEBUG)))bw_slice_fail("protected-stack-shadow-phase");','  if(cpu->interrupts_inhibited(BX_INHIBIT_INTERRUPTS)||cpu->interrupts_inhibited(BX_INHIBIT_DEBUG))bw_slice_fail("paging-no-shadow");','no MOV SS or native inhibit admission');
 once('  uint32_t raw=(uint32_t)start;uint8_t instruction[15];bw_coherent_page *page=0;',`  const uint32_t offset=(uint32_t)(bw_attempt_eip+cpu->eipPageBias);
  const uint64_t physical=(uint64_t)cpu->pAddrFetchPage+offset;
  if(offset>=4096||length>4096-offset||physical>UINT32_MAX||physical!=bw_paging_physical(cs.selector.value,cs.cache.u.segment.base,bw_attempt_eip))bw_slice_fail("paging-physical-fetch");
  uint32_t raw=(uint32_t)physical;uint8_t instruction[15];bw_coherent_page *page=0;`,'actual existing physical prefetch page; no second walk or identity guess');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'paging inverse '+e.label);assert.equal(sha256(inverse),runtimeParentSha256);
 return {bytes:Buffer.from(s),edits,baseSha256:runtimeParentSha256,profile:nativePagingProfile};
}
export function deriveNonidentityPagingRuntime(){authenticated(readFileSync(new URL('../bochs-cpu3-native-protected-stack/runtime.mjs',import.meta.url)),runtimeModuleSha256,'held stack runtime module');return transformNonidentityPagingRuntime(deriveProtectedStackRuntime().bytes);}
