/** Exact derivative of qualified cold source, requiring a new native build. */
import {readFileSync} from 'node:fs';
import {deriveColdBiosRuntime} from '../bochs-cpu3-native-cold-bios/runtime.mjs';
import {domainExpression,pageExpression} from '../bochs-cpu3-native-cold-bios/fetch-policy.mjs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {ramBootstrapProfile,fetchDomainExpression} from './profile.mjs';
export const qualifiedColdRuntimeSha256='6fdf5fccf797777acce655be2609cf58fb498d18ad6d0dd78fdef8e38a505643';
export const runtimeSourcePins=Object.freeze({'runtime.mjs':'4577806b3a1cea0e1fb02df73843576fb5a2e0aec616a64a3d015c28f57e600a','fetch-policy.mjs':'59c28bc3e5a29d27a06599094f9a7f7c152c081499a46b2df19d278099ae4369'});
export function authenticateRuntimeInputs(){for(const [p,h]of Object.entries(runtimeSourcePins))authenticated(readFileSync(new URL('../bochs-cpu3-native-cold-bios/'+p,import.meta.url)),h,'qualified cold source '+p);}
export function transformRamBootstrapRuntime(bytes){
 let s=authenticated(bytes,qualifiedColdRuntimeSha256,'qualified compiled cold runtime');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"6481181809b58a9f805346a7ecf9bebdaf5b322c32825fb49ee89da51552c4ac"))return 0;',`if(strcmp(sha,"${ramBootstrapProfile.romSha256}"))return 0;`,'new fixed ROM initializer');
 if(s.split('400000').length-1!==9)throw Error('RAM bootstrap exact total-cap seams');
 for(const [i,line]of [
 '    if(bw_slice_ticks>=bw_native_budget||bw_owned.n>=400000)bw_slice_fail("owned-N-cap");',
 '    if(bw_slice_quanta>=bw_quantum_budget||bw_owned.q>=400000||bw_owned.debt>=bw_owned.deadline)bw_slice_fail("owned-Q-cap-or-due");',
 '  if (bw_ticks>=400000 || count>400000-bw_ticks) bw_slice_fail("hot-native-total-before-callback");',
 '  if (!bw_slice_active || bw_successful_quanta>=400000 || kind>1 || bw_slice_quanta>=bw_quantum_budget ||',
 '  if (bw_ticks>=400000 || bw_successful_quanta>=400000) return 0;',
 '  const uint32_t hot_remaining_ticks=(uint32_t)(400000-bw_ticks);',
 '  const uint32_t hot_remaining_quanta=(uint32_t)(400000-bw_successful_quanta);'].entries())once(line,line.replaceAll('400000','512'),'fixture maximum '+i);
 once('if(type!=2||(want&4095)||bw_cold_kind(want+4095)!=type)return 0;','if((type!=2&&(type!=1||want!=0x7000))||(want&4095)||bw_cold_kind(want+4095)!=type)return 0;','one RAM execute page');
 once(domainExpression,fetchDomainExpression,'exact reset/ROM/RAM instruction domain');
 const ramByte=String.raw`static uint8_t bw_ram_bootstrap_byte(unsigned offset,uint32_t generation){
  if(offset>=4096||(generation!=4&&generation!=5))bw_slice_fail("RAM-bootstrap-code-generation");
  static const uint8_t bytes[8]={0xb8,1,0,0xea,0x40,0,0,0xf0};return offset==1?(generation==4?1:2):offset<8?bytes[offset]:0;
}
`;
 once('static bool bw_rom_observed(uint32_t address,const uint8_t *bytes,unsigned length);',ramByte+'static bool bw_rom_observed(uint32_t address,const uint8_t *bytes,unsigned length);','source-owned RAM code byte proof before callers');
 once('unsigned byte,unsigned expectedByte){return '+pageExpression+';}','unsigned byte,unsigned expectedByte,uint32_t generation,uint32_t expectedGeneration,unsigned offset){return found && rawPage==expectedRawPage && epoch==expectedEpoch && decoded==expectedDecoded && generation==expectedGeneration && ((kind==2 && byte==expectedByte) || (kind==1 && decoded==0x7000 && byte==bw_ram_bootstrap_byte(offset,generation)));}','RAM generation/owned bytes plus original ROM byte proof');
 once('current->bytes[address&4095],bw_direct_rom[bw_decode(address)&65535]))','current->bytes[address&4095],bw_direct_rom[bw_decode(address)&65535],current->generation,current->kind==1?bw_generation_of(current->decoded):0,address&4095))','fetch validates current generation and instruction bytes');
 once('  if(type==2&&memcmp(page.bytes,bw_direct_rom+(want&65535),4096))bw_slice_fail("direct-free-ROM-page");','  if(type==2&&memcmp(page.bytes,bw_direct_rom+(want&65535),4096))bw_slice_fail("direct-free-ROM-page");\n  if(type==1)for(unsigned i=0;i<4096;++i)if(page.bytes[i]!=bw_ram_bootstrap_byte(i,generation))bw_slice_fail("RAM-bootstrap-owned-page");','full owned RAM page before native admission');
 const writeGuard=String.raw`  if(write&&kind==1){
    const uint32_t g=bw_generation_of(want);static const uint8_t boot[4][2]={{0xb8,1},{0,0xea},{0x40,0},{0,0xf0}};
    if(g<4){if(raw!=want||want!=0x7000+g*2||length!=2||memcmp(data,boot[g],2)||bw_attempt_cs!=0xf000||bw_attempt_eip!=6+g*6)bw_slice_fail("RAM-bootstrap-initial-write");}
    else if(g!=4||raw!=0x7001||want!=0x7001||length!=2||data[0]!=2||data[1]!=0||bw_attempt_cs!=0xf000||bw_attempt_eip!=0x45)bw_slice_fail("RAM-bootstrap-patch-write");
  }
`;
 once('  if(write&&kind==1)bw_write_admission(want,length,bw_pagewalk_kind);',writeGuard+'  if(write&&kind==1)bw_write_admission(want,length,bw_pagewalk_kind);','only exact ROM initialization or off-page patch before effects');
 once('  bw_current_code_page=UINT32_MAX;\n  bw_rep_allowed=false;','  bw_current_code_page=page->kind==1?page->decoded:UINT32_MAX;\n  bw_rep_allowed=false;','restore actual current RAM instruction ownership');
 const out='  const bool admitted=(port==0x0d||port==0xda||port==0xd4||port==0x71||port==0x40||port==0x80)?value==0:\n    port==0xd6?value==0xc0:port==0x70?value==0x0f:port==0x43?value==0x34:\n    port==0x402?true:port==0x64?(value==0xaa||value==0xab):false;';
 once(out,'  const bool admitted=false;','no PIO output');
 once('(port!=0x71&&port!=0x64&&port!=0x60))bw_slice_fail("owned-IN8-admission");','true)bw_slice_fail("owned-IN8-admission");','no PIO input');
 let inverse=s;for(const e of [...edits].reverse()){
  inverse=replacement(inverse,e.next,e.old,'RAM inverse '+e.label);
 }
 if(sha256(inverse)!==qualifiedColdRuntimeSha256)throw Error('RAM runtime inverse');
 return {bytes:Buffer.from(s),baseSha256:qualifiedColdRuntimeSha256,edits,profile:ramBootstrapProfile};
}
export function deriveRamBootstrapRuntime(){authenticateRuntimeInputs();return transformRamBootstrapRuntime(deriveColdBiosRuntime().bytes);}
