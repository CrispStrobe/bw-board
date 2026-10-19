/** Exact new native policy; no old DSO is admitted by this source. */
import {readFileSync} from 'node:fs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {deriveRamBootstrapRuntime} from '../bochs-cpu3-native-ram-bootstrap/runtime.mjs';
import {fetchDomainExpression as heldDomain} from '../bochs-cpu3-native-ram-bootstrap/profile.mjs';
import {protectedRamProfile,instructions} from './profile.mjs';
export const runtimeParentSha256='56d64c8664b1edaeadd28944484ec53df111357acada96a83fca11245629ca7e';
export const runtimeModuleSha256='d7b28771f49ae26cb906814670db8435b4d65929ba1f19a658ff7ada4fadc01e';
const romPositions=instructions.map(i=>`(eip==${i.ip} && length==${i.bytes.length} && pe==${i.ip===0x133?1:0})`).join(' || ');
export const protectedDomainExpression=`!cs32 && !interrupts && !mappingPending && a20==1 && start==base+eip && start<=4294967295 && ((selector==0xf000 && ((base==0xffff0000 && !pe && eip==65520 && length==5) || (base==0xf0000 && (${romPositions})))) || (selector==24 && base==0 && pe==1 && eip==28672 && length==3))`;
export const policyHelpers=String.raw`static uint8_t bw_protected_ram_byte(unsigned offset,uint32_t generation){
  if(offset>=4096||generation!=2)bw_slice_fail("protected-RAM-code-generation");
  static const uint8_t bytes[4]={0xb8,0x34,0x12,0xf4};return offset<4?bytes[offset]:0;
}
static bool bw_protected_store(uint32_t raw,uint32_t want,unsigned length,const uint8_t *data,uint32_t generation,unsigned cs,uint32_t eip){
  static const uint32_t address[4]={0x618,0x61c,0x7000,0x7002},ip[4]={0x106,0x10f,0x118,0x11e};
  static const unsigned width[4]={4,4,2,2},before[4]={0,1,0,1};
  static const uint8_t bytes[4][4]={{0xff,0xff,0,0},{0,0x9b,0,0},{0xb8,0x34,0,0},{0x12,0xf4,0,0}};
  for(unsigned i=0;i<4;++i)if(raw==address[i]&&want==raw&&length==width[i]&&generation==before[i]&&cs==0xf000&&eip==ip[i])return !memcmp(data,bytes[i],length);
  return false;
}
static bool bw_protected_read(uint32_t raw,uint32_t want,unsigned length,unsigned kind,unsigned cs,uint32_t eip){
  if(raw!=want||cs!=0xf000||!length)return false;
  return (kind==1&&eip==0x133&&want>=0x618&&want<0x620&&length<=0x620-want)||(kind==2&&eip==0x124&&want>=0xf0180&&want<0xf0186&&length<=0xf0186-want);
}
static bool bw_protected_descriptor(uint32_t want,const uint8_t *data,unsigned length){
  static const uint8_t bytes[8]={0xff,0xff,0,0,0,0x9b,0,0};
  return length>0&&want>=0x618&&want<0x620&&length<=0x620-want&&!memcmp(data,bytes+(want-0x618),length);
}
`;
export function transformProtectedRamRuntime(bytes){
 let s=authenticated(bytes,runtimeParentSha256,'held real-mode RAM generated runtime');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"25a56c59595f2ee7c084fc5d81d45e64a1ab4b02267a863f2297db0def9c426b"))return 0;',`if(strcmp(sha,"${protectedRamProfile.romSha256}"))return 0;`,'protected fixed ROM');
 once(heldDomain,protectedDomainExpression,'fixed real/protected instruction domain');
 const oldByte=String.raw`static uint8_t bw_ram_bootstrap_byte(unsigned offset,uint32_t generation){
  if(offset>=4096||(generation!=4&&generation!=5))bw_slice_fail("RAM-bootstrap-code-generation");
  static const uint8_t bytes[8]={0xb8,1,0,0xea,0x40,0,0,0xf0};return offset==1?(generation==4?1:2):offset<8?bytes[offset]:0;
}
`;
 once(oldByte,policyHelpers,'protected store/read/full-page predicates before all callers');
 const guard=String.raw`  if(write&&kind==1){
    const uint32_t g=bw_generation_of(want);static const uint8_t boot[4][2]={{0xb8,1},{0,0xea},{0x40,0},{0,0xf0}};
    if(g<4){if(raw!=want||want!=0x7000+g*2||length!=2||memcmp(data,boot[g],2)||bw_attempt_cs!=0xf000||bw_attempt_eip!=6+g*6)bw_slice_fail("RAM-bootstrap-initial-write");}
    else if(g!=4||raw!=0x7001||want!=0x7001||length!=2||data[0]!=2||data[1]!=0||bw_attempt_cs!=0xf000||bw_attempt_eip!=0x45)bw_slice_fail("RAM-bootstrap-patch-write");
  }
`;
 once(guard,`  if(write){if(kind!=1||!bw_protected_store(raw,want,length,data,bw_generation_of(want),bw_attempt_cs,bw_attempt_eip))bw_slice_fail("protected-RAM-write-domain");}
  else if(!bw_protected_read(raw,want,length,kind,bw_attempt_cs,bw_attempt_eip))bw_slice_fail("protected-RAM-read-domain");
`,'owned GDT/code stores and LGDT/descriptor reads before effects');
 once('  if(kind==2&&!bw_rom_observed(want,returned,length))bw_slice_fail("host-rom-observed-value");','  if(kind==2&&!bw_rom_observed(want,returned,length))bw_slice_fail("host-rom-observed-value");\n  if(!write&&kind==1&&!bw_protected_descriptor(want,returned,length))bw_slice_fail("protected-GDT-read-bytes");','GDT bytes after authentic host read');
 once('byte==bw_ram_bootstrap_byte(offset,generation)','byte==bw_protected_ram_byte(offset,generation)','protected fetch byte');
 once('page.bytes[i]!=bw_ram_bootstrap_byte(i,generation)','page.bytes[i]!=bw_protected_ram_byte(i,generation)','protected entire page');
 once('  if(!bw_cold_fetch_domain(cs.selector.value,','  if(cpu->cr0.get32()&0x80000000U)bw_slice_fail("protected-RAM-no-paging");\n  if(!bw_cold_fetch_domain(cs.selector.value,','PG refusal before instruction admission');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'protected inverse '+e.label);
 if(sha256(inverse)!==runtimeParentSha256)throw Error('protected runtime exact inverse');
 return {bytes:Buffer.from(s),edits,baseSha256:runtimeParentSha256,profile:protectedRamProfile};
}
export function deriveProtectedRamRuntime(){authenticated(readFileSync(new URL('../bochs-cpu3-native-ram-bootstrap/runtime.mjs',import.meta.url)),runtimeModuleSha256,'held RAM runtime module');return transformProtectedRamRuntime(deriveRamBootstrapRuntime().bytes);}
