/** Authenticated ABI5 source derivation. This is a distinct CPU3 addon profile. */
import {deriveMemoryFusionRuntime} from '../bochs-cpu3-native-cold-memory-fusion/runtime.mjs';
import {authenticated,replacement,sha256} from '../bochs-cpu3-native-owned-clock/derive.mjs';

export const HELD_RUNTIME_SHA='c313c842c4b405e859191b05f4e2f4b9bc535b7a581c2fa2fd17f016fd67e445';
export function deriveDirectRamRuntime(){
 const base=deriveMemoryFusionRuntime();let s=authenticated(base.bytes,HELD_RUNTIME_SHA,'fusion cold runtime');const edits=[];
 const once=(old,next,label)=>{s=replacement(s,old,next,label);edits.push({old,next,label});};
 once('static bw_owned_clock_state bw_owned={0,0,4,0,6000,0,1};',String.raw`static bw_owned_clock_state bw_owned={0,0,4,0,6000,0,1};
extern "C" int bw_cold_direct_ram_source_clock(bw_cold_direct_ram_clock_ledger *out){
 if(!out)return 0;
 if(bw_owned.n!=bw_ticks||bw_owned.q!=bw_successful_quanta){
  fprintf(stderr,"BW_DIRECT5_SOURCE_CLOCK_MISMATCH owner=%llu,%llu source=%llu,%llu\n",
   (unsigned long long)bw_owned.n,(unsigned long long)bw_owned.q,
   (unsigned long long)bw_ticks,(unsigned long long)bw_successful_quanta);
  return 0;
 }
 out->n=bw_owned.n;out->q=bw_owned.q;out->debt=bw_owned.debt;out->deadline=bw_owned.deadline;
 out->mapping_epoch=bw_mapping_epoch;out->board_a20=bw_board_a20;out->in_resume=bw_in_resume?1:0;return 1;
}`,'source-authenticated clock snapshot for same-DSO observer');
 once('static bool bw_rom_observed(uint32_t address,const uint8_t *bytes,unsigned length);',String.raw`
extern "C" int bw_cold_direct_ram_memory(uint32_t,uint32_t,const uint8_t *,const bw_cold_direct_ram_source_ledger *,bw_cold_direct_ram_memory_reply *);
extern "C" int bw_cold_direct_ram_reconcile_full(void);
extern "C" int bw_cold_direct_ram_watermarks(uint64_t *,uint64_t *);
static uint64_t bw_cold_direct_effect=1;
static bool bw_rom_observed(uint32_t address,const uint8_t *bytes,unsigned length);`,'same-DSO owner memory and source effect ledger');
 const oldMemoryStart=s.indexOf('  if(bw_mapping_pending)bw_slice_fail("owned-memory-mapping-pending");\n  if(bw_owned_count){');
 const oldMemoryEnd=s.indexOf('  *decoded=result.decoded;',oldMemoryStart);
 if(oldMemoryStart<0||oldMemoryEnd<0)throw Error('direct RAM exact fusion memory seam');
 once(s.slice(oldMemoryStart,oldMemoryEnd),String.raw`  if(bw_mapping_pending)bw_slice_fail("direct-RAM-memory-mapping-pending");bw_owned_transfer(BW_OWNED_MEMORY);
  if(write&&bw_cold_direct_effect==UINT64_MAX)bw_slice_fail("direct-RAM-effect-overflow");
  bw_cold_direct_ram_source_ledger source={};source.n=bw_owned.n;source.q=bw_owned.q;
  source.effect=write?bw_cold_direct_effect:0;source.generation_before=kind==1?bw_generation_of(want):0;
  source.pending_writes=bw_pending_write_count;source.mapping_epoch=bw_mapping_epoch;source.board_a20=bw_board_a20;
  if(!bw_cold_direct_ram_watermarks(&source.owner_committed_sequence,&source.owner_acknowledged_sequence))bw_slice_fail("direct-RAM-watermarks");
  bw_cold_direct_ram_memory_reply reply={};
  if(!bw_cold_direct_ram_memory(raw,length,write?data:0,&source,&reply))bw_slice_fail("direct-RAM-memory");
  if(reply.status==BW_COLD_DIRECT_RAM_PRE_EFFECT_RETRY){
    uint64_t committed=0,acknowledged=0;
    if(!write||kind!=1||reply.effect!=source.effect||reply.n!=source.n||reply.q!=source.q||
       reply.sequence!=source.owner_committed_sequence||
       !bw_cold_direct_ram_watermarks(&committed,&acknowledged)||
       committed!=source.owner_committed_sequence||acknowledged!=source.owner_acknowledged_sequence)
      bw_slice_fail("direct-RAM-malformed-pre-effect-retry");
    if(!write||!bw_cold_direct_ram_reconcile_full())bw_slice_fail("direct-RAM-full-reconcile");
    if(!bw_cold_direct_ram_watermarks(&source.owner_committed_sequence,&source.owner_acknowledged_sequence))bw_slice_fail("direct-RAM-retry-watermarks");
    if(!bw_cold_direct_ram_memory(raw,length,data,&source,&reply)||reply.status!=BW_COLD_DIRECT_RAM_ACCEPTED)bw_slice_fail("direct-RAM-exact-retry");
  }
  if(reply.status!=BW_COLD_DIRECT_RAM_ACCEPTED)bw_slice_fail("direct-RAM-committed-code-fence-outside-ROM-profile");
  uint64_t committed=0,acknowledged=0;
  if(reply.effect!=source.effect||reply.n!=source.n||reply.q!=source.q||
     !bw_cold_direct_ram_watermarks(&committed,&acknowledged)||
     committed!=source.owner_committed_sequence+(write&&kind==1?1:0)||
     acknowledged!=source.owner_acknowledged_sequence||reply.sequence!=committed)
    bw_slice_fail("direct-RAM-malformed-post-effect-reply");
  result.decoded=reply.decoded;result.kind=reply.kind;result.effect=reply.effect_kind;
  result.generation=reply.generation;result.mapping_epoch=reply.mapping_epoch;result.board_a20=reply.board_a20;
  memcpy(returned,reply.observed,length);
  `,'same-DSO memory after retained clock transfer, exact pre-effect retry');
 once('  for(unsigned i=0;i<length;++i){tags[i].kind=kind;tags[i].effect=bw_expected_effect(kind,write);}',
  '  if(write)++bw_cold_direct_effect;\n  for(unsigned i=0;i<length;++i){tags[i].kind=kind;tags[i].effect=bw_expected_effect(kind,write);}',
  'advance source effect only after complete post-owner validation');
 once('!callbacks||!callbacks->memory||!callbacks->page||!callbacks->scalar||!callbacks->clock_transfer||callbacks->size!=sizeof(*callbacks)||callbacks->version!=4',
  '!callbacks||callbacks->memory||!callbacks->page||!callbacks->scalar||!callbacks->clock_transfer||callbacks->size!=sizeof(*callbacks)||callbacks->version!=BW_COLD_DIRECT_RAM_ABI_VERSION',
  'ABI5 direct-only admission with no JS memory callback');
 let inverse=s;for(const e of [...edits].reverse())inverse=replacement(inverse,e.next,e.old,'inverse '+e.label);
 if(sha256(inverse)!==HELD_RUNTIME_SHA)throw Error('direct RAM runtime inverse');
 return {bytes:Buffer.from(s),baseSha256:HELD_RUNTIME_SHA,edits};
}
