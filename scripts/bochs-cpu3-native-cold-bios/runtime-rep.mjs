/** Non-runnable REP admission fragment. Initializer/ports/budgets/stop still belong to held IN8. */
import {deriveOwnedIn8Runtime} from '../bochs-cpu3-native-owned-in8/runtime.mjs';
import {replacement,sha256,authenticated} from '../bochs-cpu3-native-owned-clock/derive.mjs';
import {repSites,authenticateBiosRepPolicy} from './rep-policy.mjs';
export function deriveColdBiosRepFragment(){
 authenticateBiosRepPolicy();const base=deriveOwnedIn8Runtime();authenticated(base.bytes,'8b1aa9d03e8f4112e504ab16cb977649faae5ce3b04848a327b0c8b9d21f6ae5','held IN8 repeat engine');let s=base.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 const rows=repSites.map(r=>`    {0x${r.eip.toString(16)},${r.width},${r.count},0x${r.destination.toString(16)},0x${r.value.toString(16)}U,${r.bytes.length},{${r.bytes.join(',')}}}`).join(',\n');
 const helper=String.raw`
struct bw_bios_rep_site {uint32_t eip,width,count,destination,value,length;uint8_t bytes[3];};
static const bw_bios_rep_site bw_bios_rep_sites[4]={
${rows}
};
static const bw_bios_rep_site *bw_bios_rep_state(){
  BX_CPU_C *cpu=BX_CPU(0);const bx_segment_reg_t &cs=cpu->sregs[BX_SEG_REG_CS],&es=cpu->sregs[BX_SEG_REG_ES];
  if(bw_attempt_cs!=0xf000||cs.selector.value!=0xf000||cs.cache.u.segment.base!=0xf0000||cs.cache.u.segment.d_b||
     es.selector.value||es.cache.u.segment.base||es.cache.u.segment.d_b||(cpu->cr0.get32()&1)||(cpu->read_eflags()&0x400))return 0;
  const uint32_t cx=cpu->gen_reg[BX_32BIT_REG_ECX].word.rx,di=cpu->gen_reg[BX_32BIT_REG_EDI].word.rx,eax=cpu->gen_reg[BX_32BIT_REG_EAX].dword.erx;
  for(unsigned i=0;i<4;++i){const bw_bios_rep_site &r=bw_bios_rep_sites[i];if(bw_attempt_eip!=r.eip)continue;
    if(!cx||cx>r.count||di!=r.destination+(r.count-cx)*r.width||(r.width==2?(eax&65535):eax)!=r.value)return 0;
    return &r;
  }return 0;
}
`;
 once('static bool bw_rep_allowed;','static bool bw_rep_allowed;'+helper,'exact BIOS REP state table');
 once('if(bw_rep_allowed&&(op!=0xab||!operand32||prefixes!=1||BX_CPU(0)->sregs[BX_SEG_REG_CS].cache.u.segment.d_b))bw_slice_fail("unsupported-rep");','if(bw_rep_allowed&&(op!=0xab||prefixes!=1||BX_CPU(0)->sregs[BX_SEG_REG_CS].cache.u.segment.d_b))bw_slice_fail("unsupported-rep");','word and dword parsed only before exact site admission');
 once('  if(bw_rep_allowed&&(length!=3||page->bytes[(raw&4095)+2]!=0xab||\n      !((page->bytes[raw&4095]==0xf3&&page->bytes[(raw&4095)+1]==0x66)||(page->bytes[raw&4095]==0x66&&page->bytes[(raw&4095)+1]==0xf3))||bw_attempt_cs!=8))bw_slice_fail("unsupported-rep");',String.raw`  if(bw_rep_allowed){const bw_bios_rep_site *r=bw_bios_rep_state();
    if(!r||length!=r->length||operand32!=(r->width==4)||page->kind!=2||memcmp(page->bytes+(raw&4095),r->bytes,length))bw_slice_fail("cold-BIOS-REP-admission");
  }`,'exact four ROM instruction encodings and live state');
 once('  if(bw_slice_active&&!bw_rep_allowed)bw_slice_fail("unsupported-rep");','  if(bw_slice_active&&(!bw_rep_allowed||!bw_bios_rep_state()))bw_slice_fail("cold-BIOS-REP-element-state");','state rechecked before every store element');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);if(sha256(inverse)!==sha256(base.bytes))throw Error('cold REP fragment inverse');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits,status:'SOURCE_FRAGMENT_NOT_RUNNABLE_BIOS_ADMISSION'};
}
