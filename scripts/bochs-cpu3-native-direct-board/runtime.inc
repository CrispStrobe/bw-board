/* Included once at the end of cpu.cc in the separately prepared CPU3 tree. */
#include "iodev/iodev.h"
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <atomic>
#include <thread>
static bool bw_direct_capture=false;
static bw_direct_callbacks bw_direct_host;
static uint8_t bw_direct_rom[65536];
static std::atomic<unsigned> bw_direct_lifetime(0);
static std::thread::id bw_direct_thread;
#define BW_TRACE(...) do { if(bw_direct_capture) fprintf(stderr,__VA_ARGS__); } while(0)

bool bw_slice_active = false;
bool bw_slice_port_pending = false;
bool bw_slice_rep_incomplete = false;
bool bw_slice_fault_pending = false;
bool bw_slice_irq_pending = false;

static uint8_t bw_pagewalk_kind = 0;
static bw_cpu3_combined_paging_ram_host_callbacks bw_callbacks;
static uint32_t bw_native_budget;
static uint32_t bw_requested_native_budget;
static uint32_t bw_quantum_budget;
static uint32_t bw_requested_quantum_budget;
static uint64_t bw_deadline;
static bool bw_deadline_due;
static bool bw_device_due;
static uint32_t bw_slice_ticks;
static uint32_t bw_slice_quanta;
static uint64_t bw_ticks;
static uint64_t bw_successful_quanta;
static uint64_t bw_attempts;
static uint16_t bw_attempt_cs;
static uint32_t bw_attempt_eip;
static bool bw_rep_allowed;
static unsigned bw_delivery_kind;
static uint64_t bw_fault_begin_tick,bw_fault_begin_quanta,bw_irq_ack_ticks,bw_irq_ack_quanta;
static uint64_t bw_completed;
static uint64_t bw_rep_iterations;
static uint64_t bw_rep_partial;
static uint32_t bw_rep_success_this_attempt;
static uint64_t bw_faults;
static unsigned bw_fault_vector;
static unsigned bw_fault_error;
static uint32_t bw_fault_cr2;
static uint64_t bw_ports;
static uint64_t bw_ordinal;
static bool bw_port_committed_this_slice;
static bool bw_halted;
static bool bw_host_irq_line;
static bool bw_in_resume;
static bool bw_reentry_probed;
static uint8_t bw_last_irq_vector;
static uint64_t bw_irq_deliveries;
static uint64_t bw_halt_idle_cuts;
static uint64_t bw_physical_reads;
static uint64_t bw_physical_writes;
static uint64_t bw_execute_pages;
static uint64_t bw_tick_callbacks;
static uint64_t bw_quantum_callbacks;
static uint64_t bw_fallback_ram_reads;
static uint64_t bw_fallback_ram_writes;
static uint64_t bw_fallback_direct_pointers;
static uint64_t bw_fallback_pio;
static uint64_t bw_fallback_timer;
static unsigned bw_port_bytes_seen;

static void bw_emit_state(const char *tag, BX_CPU_C *cpu)
{
  BW_TRACE("BWSD1\t%s\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x"
    "\t%08x\t%08x\t%08x\t%08x\t%08x\t%04x\t%04x\t%04x"
    "\t%08x\t%04x\t%08x\t%04x",tag,
    cpu->gen_reg[BX_32BIT_REG_EAX].dword.erx,
    cpu->gen_reg[BX_32BIT_REG_ECX].dword.erx,
    cpu->gen_reg[BX_32BIT_REG_EDX].dword.erx,
    cpu->gen_reg[BX_32BIT_REG_EBX].dword.erx,
    cpu->gen_reg[BX_32BIT_REG_ESP].dword.erx,
    cpu->gen_reg[BX_32BIT_REG_EBP].dword.erx,
    cpu->gen_reg[BX_32BIT_REG_ESI].dword.erx,
    cpu->gen_reg[BX_32BIT_REG_EDI].dword.erx,
    cpu->get_eip(),cpu->read_eflags(),cpu->cr0.get32(),
    (unsigned)cpu->cr2,(unsigned)cpu->cr3,
    cpu->sregs[BX_SEG_REG_CS].selector.value,
    cpu->sregs[BX_SEG_REG_DS].selector.value,
    cpu->sregs[BX_SEG_REG_SS].selector.value,
    (unsigned)cpu->gdtr.base,cpu->gdtr.limit,
    (unsigned)cpu->idtr.base,cpu->idtr.limit);
  if (!strcmp(tag,"POST_STATE")) BW_TRACE("\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64,bw_ticks,bw_successful_quanta,++bw_ordinal);
  if(bw_direct_capture)fputc('\n',stderr);
}

void bw_slice_fail(const char *kind)
{
  if (!strcmp(kind,"Bochs-RAM-read-fallback")) ++bw_fallback_ram_reads;
  if (!strcmp(kind,"Bochs-RAM-write-fallback")) ++bw_fallback_ram_writes;
  if (!strcmp(kind,"Bochs-direct-pointer-fallback")) ++bw_fallback_direct_pointers;
  if (!strcmp(kind,"Bochs-PIO-fallback")) ++bw_fallback_pio;
  if (!strcmp(kind,"Bochs-timer-fallback")) ++bw_fallback_timer;
  fprintf(stderr, "BWSD1\tFAIL\t%s\n", kind);
  fflush(stderr);
  abort();
}

static const char *bw_kind_name(uint8_t kind)
{
  switch (kind) {
    case BW_CPU3_COMBINED_PAGING_RAM_RAM: return "ram";
    case BW_CPU3_COMBINED_PAGING_RAM_ROM: return "rom";
    case BW_CPU3_COMBINED_PAGING_RAM_MMIO: return "mmio";
    case BW_CPU3_COMBINED_PAGING_RAM_UNMAPPED: return "unmapped";
  }
  bw_slice_fail("host-map-kind");
  return "invalid";
}

static const char *bw_effect_name(uint8_t effect)
{
  switch (effect) {
    case BW_CPU3_COMBINED_PAGING_RAM_RAM_READ: return "ram-read";
    case BW_CPU3_COMBINED_PAGING_RAM_RAM_COMMIT: return "ram-commit";
    case BW_CPU3_COMBINED_PAGING_RAM_ROM_READ: return "rom-read";
    case BW_CPU3_COMBINED_PAGING_RAM_ROM_IGNORED: return "rom-ignored";
    case BW_CPU3_COMBINED_PAGING_RAM_MMIO_READ: return "mmio-read";
    case BW_CPU3_COMBINED_PAGING_RAM_MMIO_WRITE: return "mmio-write";
    case BW_CPU3_COMBINED_PAGING_RAM_OPEN_BUS: return "open-bus";
    case BW_CPU3_COMBINED_PAGING_RAM_UNMAPPED_IGNORED: return "unmapped-ignored";
  }
  bw_slice_fail("host-map-effect");
  return "invalid";
}

static uint8_t bw_expected_effect(uint8_t kind, bool write)
{
  switch (kind) {
    case BW_CPU3_COMBINED_PAGING_RAM_RAM:
      return write ? BW_CPU3_COMBINED_PAGING_RAM_RAM_COMMIT : BW_CPU3_COMBINED_PAGING_RAM_RAM_READ;
    case BW_CPU3_COMBINED_PAGING_RAM_ROM:
      return write ? BW_CPU3_COMBINED_PAGING_RAM_ROM_IGNORED : BW_CPU3_COMBINED_PAGING_RAM_ROM_READ;
    case BW_CPU3_COMBINED_PAGING_RAM_MMIO:
      return write ? BW_CPU3_COMBINED_PAGING_RAM_MMIO_WRITE : BW_CPU3_COMBINED_PAGING_RAM_MMIO_READ;
    case BW_CPU3_COMBINED_PAGING_RAM_UNMAPPED:
      return write ? BW_CPU3_COMBINED_PAGING_RAM_UNMAPPED_IGNORED : BW_CPU3_COMBINED_PAGING_RAM_OPEN_BUS;
  }
  bw_slice_fail("host-map-kind");
  return 0;
}

static const char *bw_pagewalk_name(void)
{
  switch (bw_pagewalk_kind) {
    case 0: return "ordinary";
    case 1: return "pde-read";
    case 2: return "pte-read";
    case 3: return "pde-ad-write";
    case 4: return "pte-ad-write";
  }
  bw_slice_fail("pagewalk-kind");
  return "invalid";
}

void bw_slice_pagewalk_set(unsigned kind)
{
  if (!bw_slice_active || kind > 4 ||
      (kind && bw_pagewalk_kind) || (!kind && !bw_pagewalk_kind))
    bw_slice_fail("pagewalk-scope");
  bw_pagewalk_kind=(uint8_t)kind;
}


static void bw_state_tail(bool post) {
  if (post) BW_TRACE("\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64,bw_ticks,bw_successful_quanta,++bw_ordinal);
  if(bw_direct_capture)fputc('\n',stderr);
}
static void bw_emit_extra(BX_CPU_C *cpu,bool post) {
  const bx_segment_reg_t &cs=cpu->sregs[BX_SEG_REG_CS];
  BW_TRACE("BWSD1\t%s_EXTRA\t%08x\t%08x\t%04x\t%04x\t%04x\t%u\t%u\t%u\t%08x\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u\t%08x\t%08x",
    post?"POST":"RESET",cpu->dr6.val32,cpu->dr7.val32,
    cpu->sregs[BX_SEG_REG_ES].selector.value,cpu->sregs[BX_SEG_REG_FS].selector.value,cpu->sregs[BX_SEG_REG_GS].selector.value,
    cs.selector.index,cs.selector.ti,cs.selector.rpl,cs.cache.valid,cs.cache.p,cs.cache.dpl,cs.cache.segment,cs.cache.type,
    (unsigned)cs.cache.u.segment.base,cs.cache.u.segment.limit_scaled,cs.cache.u.segment.g,cs.cache.u.segment.d_b,
    cs.cache.u.segment.avl,cpu->pending_event,cpu->event_mask);
  bw_state_tail(post);
  for(unsigned i=0;i<6;++i) {
    const bx_segment_reg_t &r=cpu->sregs[i];
    BW_TRACE("BWSD1\t%s_SEG\t%u\t%04x\t%u\t%u\t%u\t%08x\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u",
      post?"POST":"RESET",i,r.selector.value,r.selector.index,r.selector.ti,r.selector.rpl,r.cache.valid,
      r.cache.p,r.cache.dpl,r.cache.segment,r.cache.type,(unsigned)r.cache.u.segment.base,
      r.cache.u.segment.limit_scaled,r.cache.u.segment.g,r.cache.u.segment.d_b,r.cache.u.segment.avl);
    bw_state_tail(post);
  }
  for(unsigned i=6;i<8;++i){const bx_segment_reg_t &r=i==6?cpu->ldtr:cpu->tr;
    BW_TRACE("BWSD1\t%s_SYS\t%u\t%04x\t%u\t%u\t%u\t%08x\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u",post?"POST":"RESET",i,r.selector.value,r.selector.index,r.selector.ti,r.selector.rpl,r.cache.valid,r.cache.p,r.cache.dpl,r.cache.segment,r.cache.type,(unsigned)r.cache.u.segment.base,r.cache.u.segment.limit_scaled,r.cache.u.segment.g,r.cache.u.segment.d_b,r.cache.u.segment.avl);
    bw_state_tail(post);
  }
  BW_TRACE("BWSD1\t%s_DR\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x",
    post?"POST":"RESET",(unsigned)cpu->dr[0],(unsigned)cpu->dr[1],(unsigned)cpu->dr[2],(unsigned)cpu->dr[3],cpu->dr6.val32,cpu->dr7.val32);
  bw_state_tail(post);
}
static unsigned bw_board_a20=1;static uint32_t bw_mapping_epoch=0;
static const char *bw_bridge_tlb_reason=0,*bw_current_boundary="-";
static uint32_t bw_current_code_page=UINT32_MAX;
void bw_slice_note_tlb_flush(void){if(!bw_slice_active)return;BW_TRACE("BWSD1\tTLB_OBSERVED\t%s\t%s\t%u\t%u\t1\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",bw_bridge_tlb_reason?"bridge":"cpu",bw_bridge_tlb_reason?bw_bridge_tlb_reason:"implicit",bw_mapping_epoch,bw_board_a20,bw_ticks,bw_successful_quanta,++bw_ordinal,bw_current_boundary);}
static void bw_write_admission(uint32_t decoded,unsigned length,unsigned why);
struct bw_generation {uint32_t decoded,generation;};
static bw_generation bw_generations[64];static unsigned bw_generation_count;
static uint32_t &bw_generation_of(uint32_t decoded){
  decoded&=~4095U;for(unsigned i=0;i<bw_generation_count;++i)if(bw_generations[i].decoded==decoded)return bw_generations[i].generation;
  if(bw_generation_count==64)bw_slice_fail("generation-table-bound");
  bw_generations[bw_generation_count].decoded=decoded;bw_generations[bw_generation_count].generation=0;
  return bw_generations[bw_generation_count++].generation;
}
struct bw_pending_write {uint32_t raw,decoded,length,generation;uint8_t bytes[16];uint8_t why;};
static bw_pending_write bw_pending_writes[32];static unsigned bw_pending_write_count;
static bool bw_mapping_pending=false;static unsigned bw_next_a20;static uint32_t bw_next_epoch;
static uint32_t bw_decode(uint32_t raw) {if(!bw_board_a20)raw&=~0x100000U;return raw>=0xffff0000?0xff0000+(raw-0xffff0000):raw;}
static void bw_emit_boundary(const char *kind);
static void bw_require_clean(void){if(bw_pending_write_count||bw_mapping_pending)bw_slice_fail("coherence-pending-boundary");if(!bx_pc_system.get_enable_a20())bw_slice_fail("native-a20-mask");}
static uint8_t bw_cold_kind(uint32_t address) {
  if(address<=0x9ffff||(address>=0x100000&&address<=0x17ffff))return 1;
  if((address>=0xf0000&&address<=0xfffff)||(address>=0xff0000&&address<=0xffffff))return 2;
  if(address>=0xa0000&&address<=0xbffff)return 3;
  return 4;
}
static bool bw_raw_span_ok(unsigned long long raw,unsigned length) {
  return length&&length<=16&&raw<=UINT32_MAX&&length<=UINT32_MAX-raw+1ULL&&(raw&4095)+length<=4096;
}
static unsigned bw_direct_scalar(uint32_t operation,unsigned a,unsigned b,unsigned c) {
  if(!bw_in_resume||!bw_direct_host.scalar)bw_slice_fail("direct-outside-resume");
  // Actual PIO mapping has changed on the board; native publication waits for
  // this completed ordinary instruction. Reject any other work before effects.
  if(bw_mapping_pending&&(operation!=BW_DIRECT_QUANTUM||a!=0||b||c))bw_slice_fail("direct-scalar-pending-mapping");
  const uint32_t expectedA20=bw_mapping_pending?bw_next_a20:bw_board_a20;
  const uint32_t expectedEpoch=bw_mapping_pending?bw_next_epoch:bw_mapping_epoch;
  uint32_t value=0,a20=0,epoch=0;
  if(!bw_direct_host.scalar(bw_direct_host.context,operation,a,b,c,&value,&a20,&epoch))bw_slice_fail("direct-scalar-callback");
  if(a20!=expectedA20||epoch!=expectedEpoch)bw_slice_fail("direct-scalar-mapping");
  return value;
}
static bool bw_rom_observed(uint32_t address,const uint8_t *bytes,unsigned length);
static int bw_host_memory(uint32_t raw,uint8_t *data,unsigned length,uint32_t *decoded,bw_cpu3_combined_paging_ram_byte_result *tags,bool write) {
  if(!data||!decoded||!tags||!bw_raw_span_ok(raw,length))return 0;
  uint32_t want=bw_decode(raw);uint8_t kind=bw_cold_kind(want);
  if(kind==3||!bw_raw_span_ok(want,length))return 0;
  for(unsigned i=0;i<length;++i)if(bw_decode(raw+i)!=want+i||bw_cold_kind(want+i)!=kind)return 0;
  if(bw_mapping_pending)bw_slice_fail("memory-mapping-pending");
  if(write&&kind==1&&(bw_pending_write_count==32||bw_generation_of(want)==UINT32_MAX))bw_slice_fail("write-stage-precondition");
  if(write&&kind==1)bw_write_admission(want,length,bw_pagewalk_kind);
  uint8_t returned[16];bw_direct_metadata result={};
  if(!bw_direct_host.memory(bw_direct_host.context,raw,length,write?data:0,returned,&result))bw_slice_fail("direct-memory-callback");
  *decoded=result.decoded;
  uint32_t effect=result.effect,generation=result.generation,epoch=result.mapping_epoch;
  if(*decoded!=want||result.kind!=kind||effect!=(write?(kind==1?1:kind==2?2:3):0))bw_slice_fail("host-memory-classification");
  if(write&&kind==1&&memcmp(returned,data,length))bw_slice_fail("host-write-commit");
  if(kind==4)for(unsigned i=0;i<length;++i)if(returned[i]!=0xff)bw_slice_fail("host-open-bus-value");
  if(kind==2&&!bw_rom_observed(want,returned,length))bw_slice_fail("host-rom-observed-value");
  if(epoch!=bw_mapping_epoch||result.board_a20!=bw_board_a20||bw_mapping_pending)bw_slice_fail("direct-memory-generation");
  uint32_t &known=bw_generation_of(want);uint32_t expected=kind==1?known:0;
  if(write&&kind==1){if(known==UINT32_MAX)bw_slice_fail("generation-overflow");++expected;}
  if(generation!=expected)bw_slice_fail("rpc-memory-generation");
  if(write&&kind==1){
    if(bw_pending_write_count==32)bw_slice_fail("pending-write-bound");
    bw_pending_write &pending=bw_pending_writes[bw_pending_write_count++];pending.raw=raw;pending.decoded=want;
    pending.length=length;pending.generation=(uint32_t)generation;pending.why=bw_pagewalk_kind?bw_pagewalk_kind:bw_delivery_kind==1?5:bw_delivery_kind==2?6:0;memcpy(pending.bytes,returned,length);known=(uint32_t)generation;
  }
  if(!write)memcpy(data,returned,length);
  for(unsigned i=0;i<length;++i){tags[i].kind=kind;tags[i].effect=bw_expected_effect(kind,write);}
  return 1;
}
static int bw_host_read(void *,uint32_t raw,uint8_t *data,uint32_t length,uint32_t *decoded,bw_cpu3_combined_paging_ram_byte_result *tags){return bw_host_memory(raw,data,length,decoded,tags,false);}
static int bw_host_write(void *,uint32_t raw,const uint8_t *data,uint32_t length,uint32_t *decoded,bw_cpu3_combined_paging_ram_byte_result *tags){return bw_host_memory(raw,const_cast<uint8_t*>(data),length,decoded,tags,true);}

static uint32_t bw_rotr(uint32_t x,unsigned n){return (x>>n)|(x<<(32-n));}
static void bw_hash_bytes(const uint8_t *bytes,unsigned length,char out[65]) {
  static const uint32_t k[64]={
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
  uint32_t h[8]={0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19};
  const unsigned padded=((length+9+63)/64)*64;
  for(unsigned block=0;block<padded/64;++block){uint32_t w[64];
    for(unsigned i=0;i<16;++i){w[i]=0;for(unsigned j=0;j<4;++j){unsigned at=block*64+i*4+j;uint8_t v=at<length?bytes[at]:at==length?0x80:at>=padded-8?(uint8_t)(((uint64_t)length*8)>>(8*(padded-1-at))):0;w[i]=(w[i]<<8)|v;}}
    for(unsigned i=16;i<64;++i){uint32_t a=w[i-15],b=w[i-2];w[i]=w[i-16]+(bw_rotr(a,7)^bw_rotr(a,18)^(a>>3))+w[i-7]+(bw_rotr(b,17)^bw_rotr(b,19)^(b>>10));}
    uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for(unsigned i=0;i<64;++i){uint32_t t1=hh+(bw_rotr(e,6)^bw_rotr(e,11)^bw_rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i],t2=(bw_rotr(a,2)^bw_rotr(a,13)^bw_rotr(a,22))+((a&b)^(a&c)^(b&c));hh=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;}
    h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=hh;
  }for(unsigned i=0;i<8;++i)sprintf(out+i*8,"%08x",h[i]);
}
static void bw_page_sha(const uint8_t *bytes,char out[65]) {bw_hash_bytes(bytes,4096,out);}
struct bw_coherent_page {uint32_t raw,decoded,generation,epoch;uint8_t kind;bool executed;char sha[65];unsigned char bytes[4096] __attribute__((aligned(4096)));};
static bw_coherent_page bw_pages[64];static unsigned bw_page_count;
static void bw_write_admission(uint32_t decoded,unsigned length,unsigned why){
  const uint32_t base=decoded&~4095U;
  if(base==bw_current_code_page)bw_slice_fail("current-code-write");
  for(unsigned i=0;i<bw_page_count;++i)if(bw_pages[i].kind==1&&bw_pages[i].epoch==bw_mapping_epoch&&bw_pages[i].decoded==base&&!bw_pages[i].executed)bw_slice_fail("admitted-unexecuted-code-write");
  if(why==3||why==4)for(unsigned i=0;i<bw_page_count;++i)
    if(bw_pages[i].kind==1&&bw_pages[i].decoded==base)bw_slice_fail("executable-table-ad-write");
  (void)length;
}
static bool bw_rom_observed(uint32_t address,const uint8_t *bytes,unsigned length){
  for(unsigned i=0;i<bw_page_count;++i)if(bw_pages[i].epoch==bw_mapping_epoch&&bw_pages[i].kind==2&&bw_pages[i].decoded==(address&~4095U))return memcmp(bw_pages[i].bytes+(address&4095),bytes,length)==0;
  return false;
}
static const uint8_t *bw_host_execute(void *,uint32_t raw,uint32_t *decoded,uint8_t *kind) {
  bw_require_clean();if((raw&4095)||!decoded||!kind)return 0;
  uint32_t want=bw_decode(raw);uint8_t type=bw_cold_kind(want);
  if((type!=2&&(type!=1||(want!=0x7000&&want!=0x107000)))||(want&4095)||bw_cold_kind(want+4095)!=type)return 0;
  uint32_t generation=type==1?bw_generation_of(want):0;
  for(unsigned i=0;i<bw_page_count;++i)if(bw_pages[i].raw==raw&&bw_pages[i].epoch==bw_mapping_epoch){
    if(bw_pages[i].generation!=generation||bw_pages[i].decoded!=want||bw_pages[i].kind!=type)bw_slice_fail("execute-cache-generation");
    *decoded=want;*kind=type;return bw_pages[i].bytes;}
  if(bw_page_count==64)bw_slice_fail("execute-cache-bound");
  bw_coherent_page &page=bw_pages[bw_page_count];bw_direct_page_metadata result={};
  if(!bw_direct_host.page(bw_direct_host.context,raw,page.bytes,&result))bw_slice_fail("direct-page-callback");
  if(result.decoded!=want||result.generation!=generation||result.kind!=type||result.mapping_epoch!=bw_mapping_epoch||result.board_a20!=bw_board_a20||result.sha256[64])bw_slice_fail("direct-page-metadata");
  if(type==2&&memcmp(page.bytes,bw_direct_rom+(want&65535),4096))bw_slice_fail("direct-free-ROM-page");
  char actual[65];bw_page_sha(page.bytes,actual);if(memcmp(actual,result.sha256,65))bw_slice_fail("direct-page-sha256");
  page.raw=raw;page.decoded=want;page.generation=generation;page.kind=type;page.epoch=bw_mapping_epoch;page.executed=false;memcpy(page.sha,actual,65);
  ++bw_page_count;*decoded=want;*kind=type;
  return page.bytes;
}
static const char *bw_write_why(unsigned why){static const char *names[]={"data","pde-read","pte-read","pde-ad-write","pte-ad-write","fault-frame","irq-frame"};if(why>6)bw_slice_fail("write-reason");return names[why];}
static void bw_emit_boundary(const char *kind){
  const bool ad_only=!strcmp(kind,"prefetch-pagewalk");
  if(ad_only&&bw_mapping_pending)bw_slice_fail("pagewalk-mapping-pending");
  if(ad_only)for(unsigned w=0;w<bw_pending_write_count;++w)if(bw_pending_writes[w].why!=3&&bw_pending_writes[w].why!=4)bw_slice_fail("prefetch-non-pagewalk-write");
  unsigned aliases=0,stamps=0,prefetch=0,tlb=0,global=0;
  bw_current_boundary=kind;
  BW_TRACE("BWSD1\tBOUNDARY\t%s\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",kind,bw_attempt_cs,bw_attempt_eip,bw_ticks,bw_successful_quanta,++bw_ordinal);
  for(unsigned w=0;w<bw_pending_write_count;++w){const bw_pending_write &pending=bw_pending_writes[w];char hex[33];
    for(unsigned j=0;j<pending.length;++j)sprintf(hex+2*j,"%02x",pending.bytes[j]);
    BW_TRACE("BWSD1\tCOMMIT\t%08x\t%08x\t%u\t%s\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%s\n",pending.raw,pending.decoded,pending.length,hex,pending.generation,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind,bw_board_a20,bw_write_why(pending.why));
    for(unsigned i=0;i<bw_page_count;++i){bw_coherent_page &page=bw_pages[i];
      if(page.kind!=1||page.epoch!=bw_mapping_epoch||page.decoded!=(pending.decoded&~4095U))continue;
      if(ad_only)bw_slice_fail("executable-table-ad-write");
      const unsigned offset=pending.decoded&4095;memcpy(page.bytes+offset,pending.bytes,pending.length);page.generation=pending.generation;bw_page_sha(page.bytes,page.sha);++aliases;
      BW_TRACE("BWSD1\tALIAS_UPDATE\t%08x\t%08x\t%u\t%u\t%u\t%u\t%s\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",page.raw,page.decoded,offset,pending.length,page.generation,page.epoch,page.sha,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);
      if(page.executed){unsigned before=(BX_CPU(0)->async_event&BX_ASYNC_EVENT_STOP_TRACE)!=0;pageWriteStampTable.decWriteStamp(page.raw+offset,pending.length);++stamps;
        BW_TRACE("BWSD1\tSTAMP\t%08x\t%u\t%08x\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\n",page.raw+offset,pending.length,page.decoded,page.epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind,before,(unsigned)((BX_CPU(0)->async_event&BX_ASYNC_EVENT_STOP_TRACE)!=0));}
    }
  }
  const char *reason=ad_only?"pagewalk-publish":stamps?"executable-alias-write":"publish-only";
  if(stamps){unsigned before=BX_CPU(0)->eipPageWindowSize;BX_CPU(0)->invalidate_prefetch_q();prefetch=1;
    BW_TRACE("BWSD1\tPREFETCH_INVALIDATE\texecutable-alias-write\t%u\t%u\t%08x\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t1\n",before,BX_CPU(0)->eipPageWindowSize,(unsigned)BX_CPU(0)->pAddrFetchPage,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);}
  if(bw_mapping_pending){if(strcmp(kind,"ordinary")||bw_pending_write_count)bw_slice_fail("mapping-boundary-kind");unsigned old=bw_board_a20;uint32_t epoch=bw_mapping_epoch;bw_board_a20=bw_next_a20;bw_mapping_epoch=bw_next_epoch;
    BW_TRACE("BWSD1\tMAP_COMMIT\t%u\t%u\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",old,bw_board_a20,epoch,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);
    flushICaches();global=1;bw_bridge_tlb_reason="mapping-transition";BX_CPU(0)->TLB_flush();bw_bridge_tlb_reason=0;tlb=1;
    BW_TRACE("BWSD1\tTLB_INVALIDATE\tmapping-transition\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);reason="mapping-transition";bw_mapping_pending=false;
  }
  BW_TRACE("BWSD1\tCOHERENCE\t%s\t%u\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\t%u\t%u\n",reason,bw_mapping_epoch,bw_board_a20,aliases,bw_ticks,bw_successful_quanta,++bw_ordinal,kind,stamps,prefetch,tlb,global);
  bw_pending_write_count=0;bw_current_code_page=UINT32_MAX;bw_current_boundary="-";
  bw_emit_state("POST_STATE",BX_CPU(0));bw_emit_extra(BX_CPU(0),true);
}
static int bw_host_tick(void *, uint32_t count)
{
  if (!bw_reentry_probed) {
    bw_cpu3_combined_paging_ram_slice_result rejected;
    if (bw_cpu3_combined_paging_ram_resume(1,1,UINT64_MAX,&bw_callbacks,&rejected) ||
        rejected.reason || rejected.charged_native_ticks || rejected.charged_quanta)
      bw_slice_fail("callback-reentry-accepted");
    bw_reentry_probed=true;
    BW_TRACE("BWSD1\tPROBE\tcallback-reentry\trejected\n");
    if (bw_cpu3_combined_paging_ram_set_irq_line(1) || bw_host_irq_line)
      bw_slice_fail("line-reentry-accepted");
    BW_TRACE("BWSD1\tPROBE\tline-reentry\trejected\n");
  }
  if (count!=1) return 0;
  return bw_direct_scalar(BW_DIRECT_TICK,count,0,0)==0;
}

static int bw_host_quantum(void *, uint32_t kind, uint32_t *due)
{
  if (!due || kind>1) return 0;
  const unsigned reply=bw_direct_scalar(BW_DIRECT_QUANTUM,kind,0,0);
  if (reply>1) return 0;
  *due=reply;
  return 1;
}

static int bw_host_ack_irq(void *,uint8_t *vector){
  if(!vector||!bw_host_irq_line)return 0;unsigned supplied=bw_direct_scalar(BW_DIRECT_ACK,0,0,0);
  if(supplied!=0x20)return 0;*vector=(uint8_t)supplied;return 1;
}
static int bw_host_in(void *,uint16_t,uint32_t,uint32_t *){return 0;}
static int bw_host_out(void *,uint16_t port,uint32_t width,uint32_t value){
  static const char marker[]="RPGC001";
  if(width!=1||value>255||(port!=0xe9&&port!=0x20&&port!=0x21&&port!=0xa0&&port!=0xa1&&port!=0x40&&port!=0x43&&port!=0x60&&port!=0x64))return 0;
  if(port==0xe9&&(bw_port_bytes_seen>=7||value!=(unsigned char)marker[bw_port_bytes_seen]))return 0;
  if(bw_mapping_pending)bw_slice_fail("pio-mapping-pending");
  if(port==0x64&&value!=0xd1)return 0;
  if(port==0x60&&value!=1&&value!=3)return 0;
  uint32_t reply=0,a20=0,epoch=0;
  if(!bw_direct_host.scalar(bw_direct_host.context,BW_DIRECT_PIO_OUT,port,width,value,&reply,&a20,&epoch)||reply)bw_slice_fail("direct-pio-callback");
  if(a20>1||epoch!=bw_mapping_epoch+(a20!=bw_board_a20)||((a20!=bw_board_a20)&&port!=0x60)||((a20!=bw_board_a20)&&bw_mapping_epoch==UINT32_MAX))bw_slice_fail("direct-pio-mapping");
  if(a20!=bw_board_a20){bw_mapping_pending=true;bw_next_a20=a20;bw_next_epoch=epoch;}
  if(port==0xe9)++bw_port_bytes_seen;
  BW_TRACE("BWSD1\tPORT\tout\t%04x\t%u\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",port,width,value,bw_ticks,++bw_ordinal);return 1;
}
extern "C" int bw_cpu3_combined_paging_ram_set_irq_line(int asserted){
  if(!bw_slice_active||bw_in_resume||(asserted!=0&&asserted!=1))return 0;
  bw_host_irq_line=asserted!=0;if(asserted)BX_CPU(0)->raise_INTR();else BX_CPU(0)->clear_INTR();
  BW_TRACE("BWSD1\tIRQ_LINE\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",asserted,bw_ticks,bw_successful_quanta,++bw_ordinal);return 1;
}
unsigned bw_slice_ack_irq(void){
  uint8_t vector=0;if(bw_delivery_kind||bw_irq_deliveries||!bw_callbacks.ack_irq||!bw_callbacks.ack_irq(bw_callbacks.context,&vector))bw_slice_fail("host-irq-ack");
  bw_require_clean();bw_last_irq_vector=vector;bw_irq_ack_ticks=bw_ticks;bw_irq_ack_quanta=bw_successful_quanta;bw_delivery_kind=2;
  BW_TRACE("BWSD1\tIRQ_ACK\t%02x\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",vector,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip(),bw_ticks,bw_successful_quanta,++bw_ordinal);return vector;
}
void bw_slice_note_irq(unsigned vector){
  if(bw_delivery_kind!=2||vector!=bw_last_irq_vector||bw_ticks!=bw_irq_ack_ticks||bw_successful_quanta!=bw_irq_ack_quanta)bw_slice_fail("host-irq-delivery");
  ++bw_irq_deliveries;bw_slice_irq_pending=true;
  BW_TRACE("BWSD1\tIRQ_DELIVERED\t%02x\t%04x\t%08x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",vector,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip(),BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx,bw_ticks,bw_successful_quanta,++bw_ordinal);
  bw_emit_boundary("irq-delivery");bw_delivery_kind=0;
}
void bw_slice_note_fault(unsigned vector,unsigned error){
  if(!bw_slice_active)return;
  if(vector!=14||error!=2||bw_faults>=2||bw_delivery_kind)bw_slice_fail("unexpected-fault");
  ++bw_faults;bw_fault_vector=vector;bw_fault_error=error;bw_fault_cr2=BX_CPU(0)->cr2;
  bw_fault_begin_tick=bw_ticks;bw_fault_begin_quanta=bw_successful_quanta;bw_slice_fault_pending=true;bw_delivery_kind=1;
  BW_TRACE("BWSD1\tFAULT_BEGIN\t%u\t%u\t%08x\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",vector,error,bw_fault_cr2,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,(unsigned)BX_CPU(0)->prev_rip,bw_ticks,bw_successful_quanta,++bw_ordinal);
}
void bw_slice_note_fault_delivered(void){
  if(bw_delivery_kind!=1||!bw_slice_fault_pending||bw_ticks!=bw_fault_begin_tick+1||bw_successful_quanta!=bw_fault_begin_quanta)bw_slice_fail("fault-delivery-clock");
  BW_TRACE("BWSD1\tFAULT_DELIVERED\t%u\t%u\t%08x\t%04x\t%08x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",bw_fault_vector,bw_fault_error,bw_fault_cr2,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip(),BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx,bw_ticks,bw_successful_quanta,++bw_ordinal);
  bw_emit_boundary("fault-delivery");bw_delivery_kind=0;
}

void bw_slice_read(unsigned long long raw,unsigned length,void *data){
  bw_cpu3_combined_paging_ram_byte_result tags[16];uint32_t decoded=0;
  if(!bw_slice_active||!bw_raw_span_ok(raw,length)||!bw_callbacks.read_physical(bw_callbacks.context,(uint32_t)raw,(uint8_t*)data,length,&decoded,tags))bw_slice_fail("host-physical-read");
  ++bw_physical_reads;
  for(unsigned i=0;i<length;++i)BW_TRACE("BWSD1\tMEM\tR\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\n",(unsigned)raw+i,decoded+i,bw_kind_name(tags[i].kind),((uint8_t*)data)[i],bw_effect_name(tags[i].effect),bw_ticks,++bw_ordinal,(bw_pagewalk_kind?bw_pagewalk_name():bw_delivery_kind==1?"fault-frame":bw_delivery_kind==2?"irq-frame":"data"),bw_mapping_epoch,bw_board_a20);
}
void bw_slice_write(unsigned long long raw,unsigned length,const void *data){
  bw_cpu3_combined_paging_ram_byte_result tags[16];uint32_t decoded=0;
  if(!bw_slice_active||!bw_raw_span_ok(raw,length)||!bw_callbacks.write_physical(bw_callbacks.context,(uint32_t)raw,(const uint8_t*)data,length,&decoded,tags))bw_slice_fail("host-physical-write");
  ++bw_physical_writes;
  for(unsigned i=0;i<length;++i){
    BW_TRACE("BWSD1\tMEM\tW\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\n",(unsigned)raw+i,decoded+i,bw_kind_name(tags[i].kind),((const uint8_t*)data)[i],bw_effect_name(tags[i].effect),bw_ticks,++bw_ordinal,(bw_pagewalk_kind?bw_pagewalk_name():bw_delivery_kind==1?"fault-frame":bw_delivery_kind==2?"irq-frame":"data"),bw_mapping_epoch,bw_board_a20);}
}
const unsigned char *bw_slice_execute_page(unsigned long long raw){
  uint32_t decoded=0;uint8_t kind=0;
  if(!bw_slice_active||raw>UINT32_MAX||(raw&4095))bw_slice_fail("unsafe-execute-page");
  const uint8_t *page=bw_callbacks.execute_page(bw_callbacks.context,(uint32_t)raw,&decoded,&kind);
  if(!page||(kind!=1&&kind!=2))bw_slice_fail("unsafe-execute-page");++bw_execute_pages;
  for(unsigned i=0;i<bw_page_count;++i)if(page==bw_pages[i].bytes){BW_TRACE("BWSD1\tEXEC\t%08x\t%08x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%u\t%s\t%u\t%u\t1\n",(unsigned)raw,decoded,bw_kind_name(kind),bw_ticks,++bw_ordinal,bw_pages[i].generation,bw_pages[i].sha,bw_pages[i].epoch,bw_board_a20);return page;}
  bw_slice_fail("execute-provider-pointer");return 0;
}
void bw_slice_note_prefetch(unsigned long long raw){
  if(!bw_slice_active)return;if(raw>UINT32_MAX)bw_slice_fail("prefetch-overflow");
  BW_TRACE("BWSD1\tPREFETCH\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%u\t%u\n",(unsigned)raw,bw_ticks,bw_successful_quanta,++bw_ordinal,bw_mapping_epoch,bw_board_a20);
  if(bw_pending_write_count)bw_emit_boundary("prefetch-pagewalk");
}
unsigned bw_slice_port_in(unsigned port, unsigned width)
{
  if (!bw_slice_active) return bx_devices.inp(port, width);
  uint32_t value = 0;
  if (!bw_callbacks.port_in || !bw_callbacks.port_in(bw_callbacks.context,
      port, width, &value)) bw_slice_fail("host-port-in");
  bw_slice_port_pending = true; // Yield after the IN instruction commits.
  return value;
}

void bw_slice_port_out(unsigned port, unsigned value, unsigned width)
{
  if (!bw_slice_active) { bx_devices.outp(port, value, width); return; }
  if (!bw_callbacks.port_out || !bw_callbacks.port_out(bw_callbacks.context,
      port, width, value)) bw_slice_fail("host-port-out");
  bw_slice_port_pending = true; // Yield only after outer instruction commit.
}

void bw_slice_tick(unsigned count)
{
  if (!bw_slice_active) bw_slice_fail("tick-before-activation");
  if (!count || count > bw_native_budget - bw_slice_ticks)
    bw_slice_fail("native-tick-budget");
  if (!bw_callbacks.native_tick ||
      !bw_callbacks.native_tick(bw_callbacks.context, count))
    bw_slice_fail("host-tick");
  const uint64_t before=bw_ticks;
  ++bw_tick_callbacks;
  bw_slice_ticks += count;
  bw_ticks += count;
  BW_TRACE("BWSD1\tNATIVE_TICK\t%u\t%" PRIu64 "\t%" PRIu64
    "\t%" PRIu64 "\t%" PRIu64 "\n",
    count,before,bw_ticks,bw_successful_quanta,++bw_ordinal);
}

static void bw_slice_charge_quantum(uint32_t kind)
{
  if (!bw_slice_active || bw_successful_quanta>=300 || kind>1 || bw_slice_quanta>=bw_quantum_budget ||
      !bw_callbacks.successful_quantum)
    bw_slice_fail("successful-quantum-budget");
  const uint64_t before=bw_successful_quanta;
  uint32_t due=0;
  if (!bw_callbacks.successful_quantum(bw_callbacks.context,kind,&due) || due>1)
    bw_slice_fail("host-successful-quantum");
  ++bw_quantum_callbacks;
  ++bw_slice_quanta;
  ++bw_successful_quanta;
  if (due) bw_device_due=true;
  BW_TRACE("BWSD1\tQUANTUM\t%u\t%04x\t%08x\t%08x\t%04x\t%08x\t%" PRIu64
    "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",kind,bw_attempt_cs,
    bw_attempt_eip,BX_CPU(0)->gen_reg[BX_32BIT_REG_ECX].dword.erx,
    BX_CPU(0)->gen_reg[BX_32BIT_REG_ECX].word.rx,
    BX_CPU(0)->gen_reg[BX_32BIT_REG_EDI].dword.erx,
    before,bw_successful_quanta,bw_ticks,++bw_ordinal);
}

void bw_slice_note_attempt(unsigned length){
  if(!bw_slice_active)return;bw_require_clean();if(!length||length>15)bw_slice_fail("unsupported-instruction-state");
  bw_slice_rep_incomplete=false;bw_rep_success_this_attempt=0;++bw_attempts;
  bw_attempt_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;bw_attempt_eip=BX_CPU(0)->get_eip();
  uint32_t raw=(uint32_t)(BX_CPU(0)->pAddrFetchPage+((BX_CPU(0)->sregs[BX_SEG_REG_CS].cache.u.segment.base+bw_attempt_eip)&4095));
  if((raw&4095)+length>4096)bw_slice_fail("instruction-page-cross");
  bw_coherent_page *page=0;for(unsigned i=0;i<bw_page_count;++i)if(bw_pages[i].raw==(raw&~4095U)&&bw_pages[i].epoch==bw_mapping_epoch)page=&bw_pages[i];
  if(!page)bw_slice_fail("instruction-page-missing");
  bw_current_code_page=page->kind==1?page->decoded:UINT32_MAX;page->executed=true;
  if(page->kind==1&&!((length==3&&page->bytes[raw&4095]==0xbb)||(length==1&&page->bytes[raw&4095]==0xcb)))bw_slice_fail("unsupported-ram-instruction");
  bw_rep_allowed=false;unsigned prefixes=0;bool operand32=false;
  for(unsigned i=0;i<length;++i){uint8_t op=page->bytes[(raw&4095)+i];
    if(op==0xf2)bw_slice_fail("unsupported-rep");
    if(op==0xf3){bw_rep_allowed=true;++prefixes;continue;}
    if(op==0x66){operand32=true;continue;}
    if(bw_rep_allowed&&(op!=0xab||!operand32||prefixes!=1||BX_CPU(0)->sregs[BX_SEG_REG_CS].cache.u.segment.d_b))bw_slice_fail("unsupported-rep");
    if(op!=0x66&&op!=0x67&&op!=0x26&&op!=0x2e&&op!=0x36&&op!=0x3e&&op!=0x64&&op!=0x65&&op!=0xf0)break;
  }
  if(bw_rep_allowed&&(length!=3||page->bytes[(raw&4095)+2]!=0xab||
      !((page->bytes[raw&4095]==0xf3&&page->bytes[(raw&4095)+1]==0x66)||(page->bytes[raw&4095]==0x66&&page->bytes[(raw&4095)+1]==0xf3))||bw_attempt_cs!=8))bw_slice_fail("unsupported-rep");
  BW_TRACE("BWSD1\tATTEMPT\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%08x\t%u\t",bw_attempt_cs,bw_attempt_eip,bw_ticks,bw_successful_quanta,++bw_ordinal,raw,length);
  for(unsigned i=0;i<length;++i)BW_TRACE("%02x",page->bytes[(raw&4095)+i]);BW_TRACE("\t%08x\t%s\t%u\t%u\t%u\t1\n",page->decoded+(raw&4095),bw_kind_name(page->kind),page->generation,page->epoch,bw_board_a20);
}
bool bw_slice_ticks_reached(void)
{
  return bw_slice_active &&
    (bw_slice_ticks >= bw_native_budget || bw_slice_quanta >= bw_quantum_budget);
}
bool bw_slice_should_yield(void)
{
  return bw_slice_active &&
    (bw_slice_ticks >= bw_native_budget ||
     bw_slice_quanta >= bw_quantum_budget || bw_slice_port_pending ||
     bw_halted || bw_slice_irq_pending || bw_device_due);
}
void bw_slice_note_halt(void)
{
  if (bw_slice_active) {
    bw_halted = true;
    ++bw_halt_idle_cuts;
    BW_TRACE("BWSD1\tHALT_IDLE\t%" PRIu64 "\t%04x\t%08x\t%u\t%u\t%08x\t%" PRIu64 "\n",
      bw_ticks,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,
      BX_CPU(0)->get_eip(),BX_CPU(0)->get_IF(),
      BX_CPU(0)->activity_state,BX_CPU(0)->pending_event,++bw_ordinal);
  }
}
void bw_slice_rep_pre_iteration(void)
{
  if(bw_slice_active&&!bw_rep_allowed)bw_slice_fail("unsupported-rep");
  // Normal cut occurs after the preceding iteration, before its intermediate
  // tick. Reaching this guard means a subsequent iteration would overrun.
  if (bw_slice_active && (bw_slice_ticks >= bw_native_budget ||
      bw_slice_quanta >= bw_quantum_budget || bw_device_due ||
      bw_slice_port_pending))
    bw_slice_fail("rep-over-deadline");
}
void bw_slice_note_rep_iteration(void)
{
  if (bw_slice_active) ++bw_rep_iterations;
}
void bw_slice_note_successful_rep_iteration(void)
{
  if (!bw_slice_active) return;
  if(!bw_rep_allowed)bw_slice_fail("unsupported-rep");
  ++bw_rep_success_this_attempt;
  bw_slice_charge_quantum(1);
  bw_emit_boundary("rep-element");
}
bool bw_slice_rep_budget_exhausted(void)
{
  if (!bw_slice_active || (!bw_device_due && !bw_slice_port_pending &&
      bw_slice_quanta < bw_quantum_budget &&
      bw_slice_ticks + 1 < bw_native_budget)) return false;
  bw_slice_rep_incomplete = true;
  return true;
}
void bw_slice_note_completed(void)
{
  if (!bw_slice_active) return;
  if (bw_slice_rep_incomplete) ++bw_rep_partial;
  else ++bw_completed;
  if (!bw_slice_rep_incomplete && !bw_rep_success_this_attempt)
    bw_slice_charge_quantum(0); // ordinary instruction or zero-count REP
  if(!bw_rep_success_this_attempt)bw_emit_boundary("ordinary");
  else bw_require_clean();
  if (bw_slice_port_pending) {
    ++bw_ports;
    bw_port_committed_this_slice = true;
  }
}
void bw_slice_activate(BX_CPU_C *cpu){
  if(bw_slice_active)bw_slice_fail("duplicate-activation");
  bw_cpu3_combined_paging_ram_slice_result invalid;
  if(bw_cpu3_combined_paging_ram_resume(1,1,UINT64_MAX,0,&invalid)||invalid.reason||invalid.charged_native_ticks||invalid.charged_quanta)bw_slice_fail("resume-before-activation-accepted");
  BW_TRACE("BWSD1\tPROBE\tresume-before-activation\trejected\n");
  if(bw_cpu3_combined_paging_ram_set_irq_line(1))bw_slice_fail("irq-before-activation-accepted");
  BW_TRACE("BWSD1\tPROBE\tirq-before-activation\trejected\n");
  if(cpu->sregs[BX_SEG_REG_CS].selector.value!=0xf000||cpu->get_eip()!=0xfff0||cpu->sregs[BX_SEG_REG_CS].cache.u.segment.base!=0xffff0000||!bx_pc_system.get_enable_a20()||bw_attempts||bw_ticks||bw_successful_quanta)bw_slice_fail("cold-reset-boundary");
  bw_emit_state("RESET",cpu);bw_emit_extra(cpu,false);
  bw_callbacks.context=0;bw_callbacks.read_physical=bw_host_read;bw_callbacks.write_physical=bw_host_write;bw_callbacks.execute_page=bw_host_execute;
  bw_callbacks.port_in=bw_host_in;bw_callbacks.port_out=bw_host_out;bw_callbacks.native_tick=bw_host_tick;bw_callbacks.successful_quantum=bw_host_quantum;bw_callbacks.ack_irq=bw_host_ack_irq;
  bw_slice_active=true;bw_bridge_tlb_reason="activation";cpu->TLB_flush();bw_bridge_tlb_reason=0;cpu->iCache.flushICacheEntries();
  BW_TRACE("BWSD1\tACTIVATE\tf000\t0000fff0\t0\t1\n");
}
static void bw_fill_result(bw_cpu3_combined_paging_ram_slice_result *result, unsigned reason)
{
  result->reason = reason;
  result->requested_native_ticks = bw_requested_native_budget;
  result->effective_native_ticks = bw_native_budget;
  result->charged_native_ticks = bw_slice_ticks;
  result->requested_quanta = bw_requested_quantum_budget;
  result->charged_quanta = bw_slice_quanta;
  result->total_native_ticks = bw_ticks;
  result->total_successful_quanta = bw_successful_quanta;
  result->attempts = bw_attempts;
  result->completed = bw_completed;
  result->rep_iterations = bw_rep_iterations;
  result->rep_partial = bw_rep_partial;
  result->faults = bw_faults;
  result->port_commits = bw_ports;
  result->irq_deliveries = bw_irq_deliveries;
  result->halt_idle_cuts = bw_halt_idle_cuts;
  result->cs = BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
  result->eip = BX_CPU(0)->get_eip();
  result->pending_fault = bw_slice_fault_pending ? 1 : 0;
  result->fault_vector = bw_slice_fault_pending ? bw_fault_vector : 0;
  result->fault_error = bw_slice_fault_pending ? bw_fault_error : 0;
  result->fault_cr2 = bw_slice_fault_pending ? bw_fault_cr2 : 0;
  result->port_committed = bw_port_committed_this_slice ? 1 : 0;
  result->event_due = bw_deadline_due ? 1 : 0;
  result->pending_irq = bw_host_irq_line ? 1 : 0;
  result->irq_delivered = bw_slice_irq_pending ? 1 : 0;
  result->irq_vector = bw_slice_irq_pending ? bw_last_irq_vector : 0;
  result->if_flag = BX_CPU(0)->get_IF();
  result->activity_state = BX_CPU(0)->activity_state;
  result->pending_event = BX_CPU(0)->pending_event;
}

extern "C" int bw_cpu3_combined_paging_ram_resume(uint32_t max_native_ticks,
  uint32_t max_successful_quanta, uint64_t native_deadline,
  const bw_cpu3_combined_paging_ram_host_callbacks *callbacks, bw_cpu3_combined_paging_ram_slice_result *result)
{
  if (result) memset(result, 0, sizeof(*result));
  if (!result || !bw_slice_active || bw_in_resume || !max_native_ticks ||
      !max_successful_quanta || max_successful_quanta>300 || !callbacks ||
      !callbacks->read_physical || !callbacks->write_physical ||
      !callbacks->execute_page || !callbacks->port_in ||
      !callbacks->port_out || !callbacks->native_tick ||
      !callbacks->successful_quantum || !callbacks->ack_irq ||
      native_deadline < bw_ticks) return 0;
  bw_require_clean();
  bw_callbacks = *callbacks;
  bw_requested_native_budget = max_native_ticks;
  bw_requested_quantum_budget = max_successful_quanta;
  bw_quantum_budget=max_successful_quanta;
  bw_deadline = native_deadline;
  const uint64_t until_event = native_deadline - bw_ticks;
  bw_native_budget = until_event < max_native_ticks ?
    (uint32_t)until_event : max_native_ticks;
  bw_slice_ticks = 0;
  bw_slice_quanta = 0;
  bw_port_committed_this_slice = false;
  bw_slice_fault_pending = false;
  bw_slice_irq_pending = false;
  bw_halted = false;
  bw_device_due = false;
  bw_deadline_due = bw_native_budget == 0;
  bw_in_resume = true;
  if (bw_native_budget) BX_CPU(0)->cpu_loop();
  bw_in_resume = false;
  bw_deadline_due = bw_device_due ||
    (native_deadline != UINT64_MAX && bw_ticks == native_deadline);
  const unsigned reason = bw_slice_fault_pending ? BW_CPU3_COMBINED_PAGING_RAM_SLICE_FAULT :
    bw_slice_irq_pending ? BW_CPU3_COMBINED_PAGING_RAM_SLICE_IRQ_DELIVERED :
    bw_halted ? BW_CPU3_COMBINED_PAGING_RAM_SLICE_HALT :
    bw_slice_port_pending ? BW_CPU3_COMBINED_PAGING_RAM_SLICE_PORT :
    bw_deadline_due ? BW_CPU3_COMBINED_PAGING_RAM_SLICE_EVENT_DUE : BW_CPU3_COMBINED_PAGING_RAM_SLICE_BUDGET;
  bw_fill_result(result, reason);
  bw_slice_port_pending = false;
  return 1;
}


/* No initializer quit-context survives this function. Bochs globals have a
   single terminal lifetime; close deliberately does not promise reinit. */
extern "C" int bw_direct_bootstrap(const char *configuration);
static bool bw_direct_paused_thread(void) {
  return bw_direct_lifetime.load()==2&&std::this_thread::get_id()==bw_direct_thread;
}
extern "C" int bw_direct_initialize(const char *configuration,const uint8_t *rom,uint32_t length,const bw_direct_callbacks *callbacks,int capture) {
  if(!configuration||!*configuration||!rom||length!=65536||!callbacks||!callbacks->memory||!callbacks->page||!callbacks->scalar||(capture!=0&&capture!=1))return 0;
  char sha[65];bw_hash_bytes(rom,length,sha);
  if(strcmp(sha,"608930336bd6ea9bc7a49ae02d823f54c46786a2359b335c0c1ccee55f7bb938"))return 0;
  unsigned fresh=0;if(!bw_direct_lifetime.compare_exchange_strong(fresh,1))return 0;
  bw_direct_thread=std::this_thread::get_id();bw_direct_capture=capture!=0;bw_direct_host=*callbacks;memcpy(bw_direct_rom,rom,65536);
  if(!bw_direct_bootstrap(configuration)){bw_direct_lifetime.store(4);memset(&bw_direct_host,0,sizeof(bw_direct_host));return 0;}
  bw_direct_lifetime.store(2);return 1;
}
extern "C" int bw_direct_resume(uint32_t ticks,uint32_t quanta,uint64_t deadline,bw_cpu3_combined_paging_ram_slice_result *result) {
  if(result)memset(result,0,sizeof(*result));
  if(!result||!bw_direct_paused_thread()||!ticks||ticks>600||!quanta||quanta>300)return 0;
  bw_direct_lifetime.store(3);
  int ok=bw_cpu3_combined_paging_ram_resume(ticks,quanta,deadline,&bw_callbacks,result);
  bw_direct_lifetime.store(2);return ok;
}
extern "C" int bw_direct_set_irq_line(int asserted) {
  return bw_direct_paused_thread()?bw_cpu3_combined_paging_ram_set_irq_line(asserted):0;
}
static void bw_direct_segment(uint32_t *out,unsigned index,const bx_segment_reg_t &r) {
  const uint32_t v[15]={index,r.selector.value,r.selector.index,r.selector.ti,r.selector.rpl,r.cache.valid,r.cache.p,r.cache.dpl,r.cache.segment,r.cache.type,(uint32_t)r.cache.u.segment.base,r.cache.u.segment.limit_scaled,r.cache.u.segment.g,r.cache.u.segment.d_b,r.cache.u.segment.avl};memcpy(out,v,sizeof(v));
}
extern "C" int bw_direct_inspect(bw_direct_snapshot *out) {
  if(!out||!bw_direct_paused_thread())return 0;memset(out,0,sizeof(*out));BX_CPU_C *cpu=BX_CPU(0);
  for(unsigned i=0;i<8;i++)out->state[i]=cpu->gen_reg[i].dword.erx;
  const uint32_t tail[12]={cpu->get_eip(),cpu->read_eflags(),cpu->cr0.get32(),(uint32_t)cpu->cr2,(uint32_t)cpu->cr3,cpu->sregs[BX_SEG_REG_CS].selector.value,cpu->sregs[BX_SEG_REG_DS].selector.value,cpu->sregs[BX_SEG_REG_SS].selector.value,(uint32_t)cpu->gdtr.base,cpu->gdtr.limit,(uint32_t)cpu->idtr.base,cpu->idtr.limit};memcpy(out->state+8,tail,sizeof(tail));
  const bx_segment_reg_t &cs=cpu->sregs[BX_SEG_REG_CS];
  const uint32_t extra[20]={cpu->dr6.val32,cpu->dr7.val32,cpu->sregs[BX_SEG_REG_ES].selector.value,cpu->sregs[BX_SEG_REG_FS].selector.value,cpu->sregs[BX_SEG_REG_GS].selector.value,cs.selector.index,cs.selector.ti,cs.selector.rpl,cs.cache.valid,cs.cache.p,cs.cache.dpl,cs.cache.segment,cs.cache.type,(uint32_t)cs.cache.u.segment.base,cs.cache.u.segment.limit_scaled,cs.cache.u.segment.g,cs.cache.u.segment.d_b,cs.cache.u.segment.avl,cpu->pending_event,cpu->event_mask};memcpy(out->extra,extra,sizeof(extra));
  for(unsigned i=0;i<6;i++)bw_direct_segment(out->segments[i],i,cpu->sregs[i]);bw_direct_segment(out->system[0],6,cpu->ldtr);bw_direct_segment(out->system[1],7,cpu->tr);
  for(unsigned i=0;i<4;i++)out->debug[i]=(uint32_t)cpu->dr[i];out->debug[4]=cpu->dr6.val32;out->debug[5]=cpu->dr7.val32;
  const uint64_t callbacks[5]={bw_physical_reads,bw_physical_writes,bw_execute_pages,bw_tick_callbacks,bw_quantum_callbacks};
  const uint64_t fallbacks[5]={bw_fallback_ram_reads,bw_fallback_ram_writes,bw_fallback_direct_pointers,bw_fallback_pio,bw_fallback_timer};
  const uint64_t execution[8]={bw_attempts,bw_completed,bw_rep_iterations,bw_rep_partial,bw_faults,bw_ports,bw_irq_deliveries,bw_halt_idle_cuts};
  memcpy(out->callback_counts,callbacks,sizeof(callbacks));memcpy(out->fallback_counts,fallbacks,sizeof(fallbacks));memcpy(out->execution_counts,execution,sizeof(execution));
  out->native_ticks=bw_ticks;out->successful_quanta=bw_successful_quanta;out->mapping_epoch=bw_mapping_epoch;out->board_a20=bw_board_a20;out->active=bw_slice_active;return 1;
}
extern "C" int bw_direct_close(void) {
  if(!bw_direct_paused_thread()||bw_in_resume)return 0;
  bw_emit_state("STATE",BX_CPU(0));
  BW_TRACE("BWSD1\tCALLBACKS\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",bw_physical_reads,bw_physical_writes,bw_execute_pages,bw_tick_callbacks,bw_quantum_callbacks);
  BW_TRACE("BWSD1\tFALLBACK\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",bw_fallback_ram_reads,bw_fallback_ram_writes,bw_fallback_direct_pointers,bw_fallback_pio,bw_fallback_timer);
  BW_TRACE("BWSD1\tDEACTIVATE\tdirect-close\n");
  bw_slice_active=false;bw_host_irq_line=false;BX_CPU(0)->clear_INTR();memset(&bw_callbacks,0,sizeof(bw_callbacks));memset(&bw_direct_host,0,sizeof(bw_direct_host));bw_direct_lifetime.store(4);return 1;
}
