import {readFileSync} from 'node:fs';
import {deriveColdBiosRuntime} from '../bochs-cpu3-native-cold-bios/runtime.mjs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export const HELD_RUNTIME_SHA='6fdf5fccf797777acce655be2609cf58fb498d18ad6d0dd78fdef8e38a505643';
export function deriveMemoryFusionRuntime(){
 const base=deriveColdBiosRuntime();let s=authenticated(base.bytes,HELD_RUNTIME_SHA,'genuine typed cold runtime');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('static void bw_owned_transfer(uint32_t reason,bool query=false){',readFileSync(new URL('./preflight.inc',import.meta.url),'utf8')+String.raw`extern "C" int bw_memory_fusion(const uint32_t *,uint32_t,const bw_owned_clock_state *,uint32_t,uint32_t,const uint8_t *,uint8_t *,bw_direct_metadata *,bw_owned_clock_state *);
static bool bw_fusion_reply_pending=false;
static bw_owned_clock_state bw_fusion_reply={};
static void bw_owned_transfer(uint32_t reason,bool query=false){`,'private fusion reply storage and transport');
 once('  if(!bw_direct_host.clock_transfer(bw_direct_host.context,bw_owned_tape,bw_owned_count,reason,&r))bw_slice_fail("owned-transfer-callback");',String.raw`  if(bw_fusion_reply_pending){
    if(query||reason!=BW_OWNED_MEMORY)bw_slice_fail("fusion-reply-phase");
    r=bw_fusion_reply;
  }else if(!bw_direct_host.clock_transfer(bw_direct_host.context,bw_owned_tape,bw_owned_count,reason,&r))bw_slice_fail("owned-transfer-callback");`,'reuse complete held native seven-word validation');
 once('  if(reason==BW_OWNED_INIT)bw_owned_initialized=true;', '  if(reason==BW_OWNED_INIT)bw_owned_initialized=true;\n  if(bw_fusion_reply_pending)bw_fusion_reply_pending=false;','clear private reply only after accepted commit');
 once('  if(bw_mapping_pending)bw_slice_fail("owned-memory-mapping-pending");bw_owned_transfer(BW_OWNED_MEMORY);\n  if(!bw_direct_host.memory(bw_direct_host.context,raw,length,write?data:0,returned,&result))bw_slice_fail("direct-memory-callback");',String.raw`  if(bw_mapping_pending)bw_slice_fail("owned-memory-mapping-pending");
  if(bw_owned_count){
    if(!bw_fusion_preflight(bw_direct_host.clock_transfer!=nullptr,bw_in_resume,bw_owned_initialized,bw_fusion_reply_pending,bw_owned.n,bw_ticks,bw_owned.q,bw_successful_quanta))bw_slice_fail("fusion-native-preflight");
    bw_owned_clock_state expected=bw_owned;
    expected.epoch=bw_mapping_epoch;expected.a20=bw_board_a20;
    if(!bw_memory_fusion(bw_owned_tape,bw_owned_count,&expected,raw,length,write?data:0,returned,&result,&bw_fusion_reply))bw_slice_fail("fusion-memory-callback");
    bw_fusion_reply_pending=true;
    bw_owned_transfer(BW_OWNED_MEMORY);
  }else{
    bw_owned_transfer(BW_OWNED_MEMORY);
    if(!bw_direct_host.memory(bw_direct_host.context,raw,length,write?data:0,returned,&result))bw_slice_fail("direct-memory-callback");
  }`,'only nonempty MEMORY tape fuses; existing post-memory guards retained');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==HELD_RUNTIME_SHA)throw Error('fusion runtime inverse');
 return {bytes:Buffer.from(s),baseSha256:HELD_RUNTIME_SHA,edits};
}
