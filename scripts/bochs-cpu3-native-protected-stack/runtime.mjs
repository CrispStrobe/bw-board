/** New fixed stack native policy source. Requires a separate preparation/build. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveProtectedRamRuntime,protectedDomainExpression as heldDomain,policyHelpers as heldHelpers} from '../bochs-cpu3-native-protected-ram/runtime.mjs';
import {protectedStackProfile,romInstructions,ramInstructions,ramProgram,stores,farJumpIp,afterLgdt,codeDescriptor,dataDescriptor} from './profile.mjs';
export const runtimeParentSha256='9aaed6e6bee8b053ab8c2fbbebb4185631aa44462b41fb650abf79d70ae2cd94';
export const runtimeModuleSha256='a7158bcca2572422efa2743551fe1e5a70f90d09b2278345d41aaca7b87aad7b';
export const shadowSources=Object.freeze({artifact:11283630476,dataXfer16Sha256:'3f589baa88393b8a70138e7b664a8f21d603aa20d7109826e4d37d2e4456ed79',dataXferLines:'103-131',eventSha256:'3f1603ed7e9b668cda9264821af0e03439577a617ba63cea69e95122b6cd2b12',eventLines:'387-401',scope:'Native inhibit predicate at instruction admission, not a fabricated ABI snapshot field'});
const positions=(instructions,pe)=>instructions.map(i=>`(eip==${i.ip}&&length==${i.bytes.length}${pe(i)})`).join('||');
export const stackDomainExpression=`!cs32&&!interrupts&&!mappingPending&&a20==1&&start==base+eip&&start<=4294967295&&((selector==0xf000&&((base==0xffff0000&&!pe&&eip==65520&&length==5)||(base==0xf0000&&(${positions(romInstructions,i=>`&&pe==${i.ip===farJumpIp?1:0}`)}))))||(selector==24&&base==0&&pe==1&&(${positions(ramInstructions,()=>'' )})))`;
const list=v=>v.map(n=>String(n)).join(',');
const generationBefore=stores.map((s,i)=>s.raw<4096?i:s.raw<0x8000?i-4:i-11);
export const policyHelpers=`static uint8_t bw_protected_ram_byte(unsigned offset,uint32_t generation){
  if(offset>=4096||generation!=7)bw_slice_fail("protected-stack-code-generation");
  static const uint8_t bytes[26]={${list(ramProgram)}};return offset<26?bytes[offset]:0;
}
static bool bw_protected_store(uint32_t raw,uint32_t want,unsigned length,const uint8_t *data,uint32_t generation,unsigned cs,uint32_t eip){
  static const uint32_t address[13]={${list(stores.map(s=>s.raw))}},ip[13]={${list(stores.map(s=>s.ip))}};
  static const unsigned width[13]={${list(stores.map(s=>s.bytes.length))}},before[13]={${list(generationBefore)}},owner[13]={${list(stores.map(s=>s.cs))}};
  static const uint8_t bytes[13][4]={${stores.map(s=>`{${list(s.bytes)}}`).join(',')}};
  for(unsigned i=0;i<13;++i)if(raw==address[i]&&want==raw&&length==width[i]&&generation==before[i]&&cs==owner[i]&&eip==ip[i])return !memcmp(data,bytes[i],length);
  return false;
}
static bool bw_protected_read(uint32_t raw,uint32_t want,unsigned length,unsigned kind,unsigned cs,uint32_t eip){
  if(raw!=want||!length)return false;
  if(kind==2)return cs==0xf000&&eip==${afterLgdt-6}&&want>=0xf0180&&want<0xf0186&&length<=0xf0186-want;
  if(kind!=1)return false;
  if(cs==0xf000&&eip==${farJumpIp})return want>=0x618&&want<0x620&&length<=0x620-want;
  if(cs!=24)return false;
  if(eip==0x7003||eip==0x7005)return want>=0x610&&want<0x618&&length<=0x618-want;
  return (eip==0x700e||eip==0x7019)&&want==0x8ffe&&length==2;
}
static bool bw_protected_observed(uint32_t want,const uint8_t *data,unsigned length,unsigned cs,uint32_t eip){
  if(!length)return false;
  static const uint8_t code[8]={${list(codeDescriptor)}},segments[8]={${list(dataDescriptor)}};
  if(cs==0xf000&&eip==${farJumpIp})return want>=0x618&&want<0x620&&length<=0x620-want&&!memcmp(data,code+want-0x618,length);
  if(cs==24&&(eip==0x7003||eip==0x7005))return want>=0x610&&want<0x618&&length<=0x618-want&&!memcmp(data,segments+want-0x610,length);
  if(cs!=24||want!=0x8ffe||length!=2)return false;
  return eip==0x700e?data[0]==0x34&&data[1]==0x12:eip==0x7019&&data[0]==0x12&&data[1]==0x70;
}
static bool bw_stack_shadow_phase(unsigned cs,uint32_t eip,bool inhibitedInterrupts,bool inhibitedDebug){
  const bool expected=cs==24&&eip==0x7007;return inhibitedInterrupts==expected&&inhibitedDebug==expected;
}
`;
export function transformProtectedStackRuntime(bytes){let s=authenticated(bytes,runtimeParentSha256,'qualified protected RAM runtime');const edits=[];const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"b4e163a3c72cb9986b748cfc92635b6aa11b2f9414a19d4e5c70d27137e9fc83"))return 0;',`if(strcmp(sha,"${protectedStackProfile.romSha256}"))return 0;`,'distinct fixed DS/SS ROM');
 once(heldDomain,stackDomainExpression,'exact stack instruction domain');once(heldHelpers,policyHelpers,'fixed descriptor/stack/page/shadow predicates before every caller');
 once('if(!write&&kind==1&&!bw_protected_descriptor(want,returned,length))','if(!write&&kind==1&&!bw_protected_observed(want,returned,length,bw_attempt_cs,bw_attempt_eip))','returned descriptor and actual stack operands');
 const pg='  if(cpu->cr0.get32()&0x80000000U)bw_slice_fail("protected-RAM-no-paging");';
 once(pg,pg+'\n  if(!bw_stack_shadow_phase(cs.selector.value,(uint32_t)cpu->get_eip(),cpu->interrupts_inhibited(BX_INHIBIT_INTERRUPTS),cpu->interrupts_inhibited(BX_INHIBIT_DEBUG)))bw_slice_fail("protected-stack-shadow-phase");','native source-backed MOV SS one-instruction inhibit phase');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'stack inverse '+e.label);assert.equal(sha256(inverse),runtimeParentSha256);return {bytes:Buffer.from(s),edits,baseSha256:runtimeParentSha256,profile:protectedStackProfile};}
export function deriveProtectedStackRuntime(){authenticated(readFileSync(new URL('../bochs-cpu3-native-protected-ram/runtime.mjs',import.meta.url)),runtimeModuleSha256,'held protected runtime module');return transformProtectedStackRuntime(deriveProtectedRamRuntime().bytes);}
