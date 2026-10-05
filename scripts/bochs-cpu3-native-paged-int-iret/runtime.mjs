/** Exact native paging derivative; source-only, no materialized/build authority. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveNonidentityPagingRuntime,pagingDomainExpression as heldDomain,policyHelpers as heldHelpers} from '../bochs-cpu3-native-nonidentity-paging/runtime.mjs';
import {nativeIntIretProfile,walkOwners,nativeOrdinaryReads,generationBeforeBoot,nativeFrameStores} from './provider-profile.mjs';
import {intIretProfile,bootStores,entries,gate,ramProgram,romInstructions,ramInstructions,afterPe,afterPg,afterCr3,afterSs,farJumpIp,dsWriteIp,ssWriteIp} from './profile.mjs';
export const runtimeParentSha256='ff7230c902deafa60d1192f2b5f0e3b4ea51d8f1010375cafc42e25fed3fc8f4';
export const runtimeModuleSha256='62bff730fd3f204eb5a5ef67259327eefe8faa4b31b5240bdb012e1fba06744d';
const nums=a=>a.map(String).join(','),positions=(rows,pe)=>rows.map(i=>`(eip==${i.ip}&&length==${i.bytes.length}&&pe==${pe(i)})`).join('||');
export const intDomainExpression=`!cs32&&!interrupts&&!mappingPending&&a20==1&&start==base+eip&&start<=4294967295&&((selector==0xf000&&((base==0xffff0000&&!pe&&eip==65520&&length==5)||(base==0xf0000&&(${positions(romInstructions,i=>i.ip>=afterPe?1:0)}))))||(selector==24&&base==0&&pe==1&&(${positions(ramInstructions,()=>1)})))`;
const table=Object.values(entries),boot=bootStores.length,codeGeneration=bootStores.filter(s=>(s.raw&~4095)===0xa000).length;
const owners=walkOwners.map((x,i)=>`if(liveCs==${x.liveCs}&&liveIp==${x.liveIp}${x.attempt?`&&cs==${x.attempt.cs}&&eip==${x.attempt.ip}`:''}){return ${i+1};}`).join('\n');
const leaves=walkOwners.map((x,i)=>`if(phase==${i+1}){return ${x.leaves.map(raw=>`raw==${raw}`).join('||')};}`).join('\n');
const intPhase=walkOwners.findIndex(x=>x.phase==='INT-gate-stack')+1;
export const policyHelpers=`static unsigned bw_paging_boot=0,bw_int_frame_words=0;
static uint32_t bw_paging_values[${table.length}]={${nums(table.map(e=>e.value))}};
static const uint32_t bw_paging_address[${table.length}]={${nums(table.map(e=>e.raw))}};
static int bw_paging_entry(uint32_t raw){for(unsigned i=0;i<${table.length};++i){if(raw==bw_paging_address[i]){return (int)i;}}return -1;}
static unsigned bw_paging_owner(unsigned liveCs,uint32_t liveIp,unsigned cs,uint32_t eip){${owners}
 return 0;}
static bool bw_int_leaf(unsigned phase,uint32_t raw){${leaves}
 return false;}
static bool bw_paging_walk(unsigned kind,uint32_t raw,unsigned length,unsigned liveCs,uint32_t liveIp,unsigned cs,uint32_t eip){
 if(length!=4||bw_paging_boot!=${boot}){return false;}
 unsigned phase=bw_paging_owner(liveCs,liveIp,cs,eip);if(!phase){return false;}
 return (kind==1||kind==3)?raw==0x1000:(kind==2||kind==4)&&bw_int_leaf(phase,raw);
}
static uint32_t bw_paging_dword(const uint8_t *p){return (uint32_t)p[0]|(uint32_t)p[1]<<8|(uint32_t)p[2]<<16|(uint32_t)p[3]<<24;}
static bool bw_paging_ad(uint32_t raw,const uint8_t *data,unsigned length){
 const int i=bw_paging_entry(raw);if(i<0||length!=4){return false;}const uint32_t before=bw_paging_values[i],after=bw_paging_dword(data);
 return raw==0x2034?before==0xc003&&after==0xc063:after!=before&&after==(before|0x20U);
}
static uint8_t bw_protected_ram_byte(unsigned offset,uint32_t generation){
 if(offset>=4096||generation!=${codeGeneration}){bw_slice_fail("paged-INT-code-generation");}
 static const uint8_t bytes[${ramProgram.length}]={${nums(ramProgram)}};return offset<${ramProgram.length}?bytes[offset]:0;
}
static bool bw_paging_store(uint32_t raw,uint32_t want,unsigned length,const uint8_t *data,uint32_t generation,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length){return false;}
 if(walk){if(!bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip)||(walk!=3&&walk!=4)||!bw_paging_ad(raw,data,length)){return false;}
  if(raw==0x2034){return walk==4&&bw_paging_owner(liveCs,liveIp,cs,eip)==${intPhase};}return true;
 }
 if(bw_paging_boot<${boot}){
  static const uint32_t address[${boot}]={${nums(bootStores.map(s=>s.raw))}},ip[${boot}]={${nums(bootStores.map(s=>s.ip))}};static const unsigned before[${boot}]={${nums(generationBeforeBoot)}};
  static const uint8_t bytes[${boot}][4]={${bootStores.map(s=>`{${nums(s.bytes)}}`).join(',')}};const unsigned i=bw_paging_boot;
  return cs==0xf000&&eip==ip[i]&&raw==address[i]&&length==4&&generation==before[i]&&!memcmp(data,bytes[i],4);
 }
 if(bw_int_frame_words>=3){return false;}
 static const uint32_t address[3]={${nums(nativeFrameStores.map(e=>e.raw))}};
 static const uint8_t bytes[3][2]={${nativeFrameStores.map(e=>`{${nums(e.bytes)}}`).join(',')}};
 return cs==24&&eip==0x7003&&liveCs==24&&liveIp==0x7005&&raw==address[bw_int_frame_words]&&length==2&&generation==bw_int_frame_words&&!memcmp(data,bytes[bw_int_frame_words],2)&&bw_paging_values[${table.findIndex(e=>e.raw===entries.stack.raw)}]==0xc063;
}
static void bw_paging_commit(uint32_t raw,const uint8_t *data,unsigned walk){
 if(walk){const int i=bw_paging_entry(raw);if(i<0){bw_slice_fail("paged-INT-commit-entry");}bw_paging_values[i]=bw_paging_dword(data);}
 else if(bw_paging_boot<${boot}){++bw_paging_boot;}else{if(bw_int_frame_words>=3){bw_slice_fail("paged-INT-frame-count");}++bw_int_frame_words;}
}
static bool bw_paging_read(uint32_t raw,uint32_t want,unsigned length,unsigned kind,unsigned cs,uint32_t eip,unsigned walk,unsigned liveCs,uint32_t liveIp){
 if(raw!=want||!length){return false;}
 if(walk){return kind==1&&(walk==1||walk==2)&&bw_paging_walk(walk,raw,length,liveCs,liveIp,cs,eip);}
 if(cs==24&&((eip==0x7003&&(liveCs!=24||liveIp!=0x7005))||(eip==0x7013&&(liveCs!=24||liveIp!=0x7014)))){return false;}
 ${nativeOrdinaryReads.map(r=>`if(cs==${r.cs}&&eip==${r.ip}&&kind==${r.kind}&&raw>=${r.raw}&&raw<${r.raw+r.length}&&length<=${r.raw+r.length}-raw){return true;}`).join('\n')}
 return false;
}
static bool bw_paging_observed(uint32_t raw,const uint8_t *data,unsigned length,unsigned cs,uint32_t eip,unsigned walk){
 if(walk){const int i=bw_paging_entry(raw);return i>=0&&length==4&&bw_paging_dword(data)==bw_paging_values[i];}
 static const uint8_t segment[8]={255,255,0,0,0,0x93,0,0},code[8]={255,255,0,0,0,0x9b,0,0},gate[8]={${nums(gate.bytes)}},frame[6]={5,0x70,0x18,0,2,0};
 if(cs==0xf000&&(eip==${dsWriteIp}||eip==${ssWriteIp})){return raw>=0x610&&raw<0x618&&length>0&&length<=0x618-raw&&!memcmp(data,segment+raw-0x610,length);}
 if((cs==0xf000&&eip==${farJumpIp})||(cs==24&&(eip==0x7003||eip==0x7013))){
  if(raw>=0x618&&raw<0x620&&length>0&&length<=0x620-raw){return !memcmp(data,code+raw-0x618,length);}
 }
 if(cs==24&&eip==0x7003&&raw>=0x3180&&raw<0x3188&&length>0&&length<=0x3188-raw){return !memcmp(data,gate+raw-0x3180,length);}
 return cs==24&&eip==0x7013&&bw_int_frame_words==3&&raw>=0xcffa&&raw<0xd000&&length>0&&length<=0xd000-raw&&!memcmp(data,frame+raw-0xcffa,length);
}
static bool bw_paging_reset_phase(unsigned cs,uint32_t eip,uint32_t cr0,uint32_t cr3){
 const uint32_t c=cs==24?0xfffffff1U:cs!=0xf000?0:eip==65520?0x7ffffff0U:eip>=${afterPg}?0xfffffff1U:eip>=${afterPe}?0x7ffffff1U:0x7ffffff0U;
 return c&&cr0==c&&cr3==(cs==24||(cs==0xf000&&eip!=65520&&eip>=${afterCr3})?0x1000U:0U);
}
static bool bw_int_shadow(unsigned cs,uint32_t eip,bool interrupts,bool debug){const bool expected=cs==0xf000&&eip==${afterSs};return interrupts==expected&&debug==expected;}
static uint32_t bw_paging_physical(unsigned cs,uint64_t base,uint32_t eip){return cs==24?0xa000U+eip-0x7000U:(uint32_t)(base+eip);}
`;
export function transformPagedIntIretRuntime(bytes){let s=authenticated(bytes,runtimeParentSha256,'qualified native paging runtime');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"7be28f0fabe164ab69d362b5e14b86181d8588e227bbc314f9204501101add35"))return 0;',`if(strcmp(sha,"${intIretProfile.romSha256}"))return 0;`,'new owned INT/IRET ROM');
 once(heldDomain,intDomainExpression,'exact new real/protected/paged opcode positions');once(heldHelpers,policyHelpers,'INT/IRET owner/read/write/nativeAD/frame predicates before all callers');
 once('  if(cpu->interrupts_inhibited(BX_INHIBIT_INTERRUPTS)||cpu->interrupts_inhibited(BX_INHIBIT_DEBUG))bw_slice_fail("paging-no-shadow");','  if(!bw_int_shadow(cs.selector.value,(uint32_t)cpu->get_eip(),cpu->interrupts_inhibited(BX_INHIBIT_INTERRUPTS),cpu->interrupts_inhibited(BX_INHIBIT_DEBUG)))bw_slice_fail("paged-INT-shadow-phase");','only actual ROM MOVSP consumes native MOVSS inhibit');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'INT runtime inverse '+e.label);assert.equal(sha256(inverse),runtimeParentSha256);return {bytes:Buffer.from(s),edits,baseSha256:runtimeParentSha256,profile:nativeIntIretProfile};
}
export function derivePagedIntIretRuntime(){authenticated(readFileSync(new URL('../bochs-cpu3-native-nonidentity-paging/runtime.mjs',import.meta.url)),runtimeModuleSha256,'held paging runtime module');return transformPagedIntIretRuntime(deriveNonidentityPagingRuntime().bytes);}
