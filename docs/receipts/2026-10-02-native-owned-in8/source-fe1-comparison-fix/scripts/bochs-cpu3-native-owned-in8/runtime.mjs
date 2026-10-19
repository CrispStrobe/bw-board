import {deriveOwnedRuntime} from '../bochs-cpu3-native-owned-clock/runtime.mjs';
import {replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';
export function deriveOwnedIn8Runtime(){
 const base=deriveOwnedRuntime();let s=base.bytes.toString();const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('if(strcmp(sha,"0c020faecb76160cfc748ca909d498a69ae47dd19a365891ccb20b3b5186b631"))return 0;','if(strcmp(sha,"25c242668fb1e0cbf940a35045a5e1173d992232766a4cbdb6a369ef3929a939"))return 0;','fixed IN8 ROM admission');
 once('callbacks->version!=3','callbacks->version!=4','ABI4 admission');
 once('static int bw_host_in(void *,uint16_t,uint32_t,uint32_t *){return 0;}',String.raw`static int bw_host_in(void *,uint16_t port,uint32_t width,uint32_t *value){
  if(!value||!bw_in_resume||width!=1||(port!=0x40&&port!=0x21&&port!=0xa1))bw_slice_fail("owned-IN8-admission");
  if(bw_mapping_pending)bw_slice_fail("owned-IN8-mapping-pending");
  bw_owned_transfer(BW_OWNED_PRE_PIO);
  uint32_t byte=0,epoch=0,a20=0;
  if(!bw_direct_host.scalar(bw_direct_host.context,BW_DIRECT_PIO_IN8,port,width,0,&byte,&a20,&epoch))bw_slice_fail("owned-IN8-callback");
  if(byte>255||epoch!=bw_mapping_epoch||a20!=bw_board_a20)bw_slice_fail("owned-IN8-reply");
  bw_owned_query_phase=BW_OWNED_POST_PIO;bw_owned_transfer(BW_OWNED_POST_PIO,true);
  BW_TRACE("BWSD1\tPORT\tin\t%04x\t%u\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",port,width,byte,bw_ticks,++bw_ordinal);
  *value=byte;return 1;
}`,'IN8 local observer');
 once('  if (!bw_slice_active) return bx_devices.inp(port, width);','  if (!bw_slice_active) return bx_devices.inp(port, width);\n  if(port>UINT16_MAX)bw_slice_fail("owned-IN8-port-overflow");','raw port before callback narrowing');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==sha256(base.bytes))throw Error('IN8 runtime inverse');
 return {bytes:Buffer.from(s),baseSha256:sha256(base.bytes),edits};
}
