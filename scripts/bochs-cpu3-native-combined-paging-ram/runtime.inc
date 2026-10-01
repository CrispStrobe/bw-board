/* Included once at the end of cpu.cc in the separately prepared CPU3 tree. */
#include "iodev/iodev.h"
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

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
static FILE *bw_rpc_input;
static FILE *bw_rpc_output;
static uint64_t bw_rpc_next_seq;
static uint64_t bw_rpc_request_count;
static uint64_t bw_rpc_reply_count;
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
  fprintf(stderr,"BWS12\t%s\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x"
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
  if (!strcmp(tag,"POST_STATE")) fprintf(stderr,"\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64,bw_ticks,bw_successful_quanta,++bw_ordinal);
  fputc('\n',stderr);
}

void bw_slice_fail(const char *kind)
{
  if (!strcmp(kind,"Bochs-RAM-read-fallback")) ++bw_fallback_ram_reads;
  if (!strcmp(kind,"Bochs-RAM-write-fallback")) ++bw_fallback_ram_writes;
  if (!strcmp(kind,"Bochs-direct-pointer-fallback")) ++bw_fallback_direct_pointers;
  if (!strcmp(kind,"Bochs-PIO-fallback")) ++bw_fallback_pio;
  if (!strcmp(kind,"Bochs-timer-fallback")) ++bw_fallback_timer;
  fprintf(stderr, "BWS12\tFAIL\t%s\n", kind);
  fflush(stderr);
  abort();
}

static void bw_rpc_open(void)
{
  // The proof runner supplies dedicated pipes: fd 3 host->native, fd 4
  // native->host. Bochs' own stdout/stderr can never be mistaken for RPC.
  bw_rpc_input=fdopen(3,"r");
  bw_rpc_output=fdopen(4,"w");
  if (!bw_rpc_input || !bw_rpc_output) bw_slice_fail("rpc-pipes");
  setvbuf(bw_rpc_output,0,_IOLBF,0);
}

static void bw_rpc_line(char *line, size_t capacity)
{
  if (!bw_rpc_input || !fgets(line,(int)capacity,bw_rpc_input))
    bw_slice_fail("rpc-eof");
  char *newline=strchr(line,'\n');
  if (!newline || newline[1]) bw_slice_fail("rpc-line-bound");
  *newline=0;
  for(const unsigned char *p=(const unsigned char*)line;*p;++p)if(*p!=9&&(*p<32||*p>126))bw_slice_fail("rpc-ascii");
}

static unsigned bw_split_tabs(char *line, char **fields, unsigned capacity)
{
  if (!line || !*line || !capacity) bw_slice_fail("rpc-fields");
  unsigned count=1;
  fields[0]=line;
  for (char *at=line;*at;++at) {
    if (*at!='\t') continue;
    if (count==capacity) bw_slice_fail("rpc-fields");
    *at=0;
    fields[count++]=at+1;
  }
  for (unsigned i=0;i<count;++i)
    if (!*fields[i]) bw_slice_fail("rpc-fields");
  return count;
}

static uint64_t bw_decimal(const char *digits)
{
  if (!digits || !*digits) bw_slice_fail("rpc-decimal");
  if (digits[0]=='0' && digits[1]) bw_slice_fail("rpc-leading-zero");
  uint64_t value=0;
  for (const char *at=digits;*at;++at) {
    if (*at<'0' || *at>'9') bw_slice_fail("rpc-decimal");
    const unsigned digit=(unsigned)(*at-'0');
    if (value>(UINT64_MAX-digit)/10) bw_slice_fail("rpc-overflow");
    value=value*10+digit;
  }
  return value;
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
  if (post) fprintf(stderr,"\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64,bw_ticks,bw_successful_quanta,++bw_ordinal);
  fputc('\n',stderr);
}
static void bw_emit_extra(BX_CPU_C *cpu,bool post) {
  const bx_segment_reg_t &cs=cpu->sregs[BX_SEG_REG_CS];
  fprintf(stderr,"BWS12\t%s_EXTRA\t%08x\t%08x\t%04x\t%04x\t%04x\t%u\t%u\t%u\t%08x\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u\t%08x\t%08x",
    post?"POST":"RESET",cpu->dr6.val32,cpu->dr7.val32,
    cpu->sregs[BX_SEG_REG_ES].selector.value,cpu->sregs[BX_SEG_REG_FS].selector.value,cpu->sregs[BX_SEG_REG_GS].selector.value,
    cs.selector.index,cs.selector.ti,cs.selector.rpl,cs.cache.valid,cs.cache.p,cs.cache.dpl,cs.cache.segment,cs.cache.type,
    (unsigned)cs.cache.u.segment.base,cs.cache.u.segment.limit_scaled,cs.cache.u.segment.g,cs.cache.u.segment.d_b,
    cs.cache.u.segment.avl,cpu->pending_event,cpu->event_mask);
  bw_state_tail(post);
  for(unsigned i=0;i<6;++i) {
    const bx_segment_reg_t &r=cpu->sregs[i];
    fprintf(stderr,"BWS12\t%s_SEG\t%u\t%04x\t%u\t%u\t%u\t%08x\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u",
      post?"POST":"RESET",i,r.selector.value,r.selector.index,r.selector.ti,r.selector.rpl,r.cache.valid,
      r.cache.p,r.cache.dpl,r.cache.segment,r.cache.type,(unsigned)r.cache.u.segment.base,
      r.cache.u.segment.limit_scaled,r.cache.u.segment.g,r.cache.u.segment.d_b,r.cache.u.segment.avl);
    bw_state_tail(post);
  }
  for(unsigned i=6;i<8;++i){const bx_segment_reg_t &r=i==6?cpu->ldtr:cpu->tr;
    fprintf(stderr,"BWS12\t%s_SYS\t%u\t%04x\t%u\t%u\t%u\t%08x\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u",post?"POST":"RESET",i,r.selector.value,r.selector.index,r.selector.ti,r.selector.rpl,r.cache.valid,r.cache.p,r.cache.dpl,r.cache.segment,r.cache.type,(unsigned)r.cache.u.segment.base,r.cache.u.segment.limit_scaled,r.cache.u.segment.g,r.cache.u.segment.d_b,r.cache.u.segment.avl);
    bw_state_tail(post);
  }
  fprintf(stderr,"BWS12\t%s_DR\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x",
    post?"POST":"RESET",(unsigned)cpu->dr[0],(unsigned)cpu->dr[1],(unsigned)cpu->dr[2],(unsigned)cpu->dr[3],cpu->dr6.val32,cpu->dr7.val32);
  bw_state_tail(post);
}
static uint32_t bw_hex32(const char *value,unsigned digits) {
  if(strlen(value)!=digits||digits>8)bw_slice_fail("rpc-hex");
  uint32_t result=0;
  for(unsigned i=0;i<digits;++i){char c=value[i];
    if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')))bw_slice_fail("rpc-hex");
    result=(result<<4)|(c<='9'?c-'0':c-'a'+10);
  }return result;
}
static void bw_hex_bytes(const char *value,uint8_t *data,unsigned length) {
  if(strlen(value)!=2*length)bw_slice_fail("rpc-byte-length");
  for(unsigned i=0;i<length;++i){char pair[3]={value[i*2],value[i*2+1],0};data[i]=(uint8_t)bw_hex32(pair,2);}
}
static unsigned bw_board_a20=1;static uint32_t bw_mapping_epoch=0;
static const char *bw_bridge_tlb_reason=0,*bw_current_boundary="-";
static uint32_t bw_current_code_page=UINT32_MAX;
void bw_slice_note_tlb_flush(void){if(!bw_slice_active)return;fprintf(stderr,"BWS12\tTLB_OBSERVED\t%s\t%s\t%u\t%u\t1\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",bw_bridge_tlb_reason?"bridge":"cpu",bw_bridge_tlb_reason?bw_bridge_tlb_reason:"implicit",bw_mapping_epoch,bw_board_a20,bw_ticks,bw_successful_quanta,++bw_ordinal,bw_current_boundary);}
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
static uint64_t bw_request(const char *kind,unsigned a,unsigned b,unsigned c,const char *payload) {
  if(!bw_rpc_output||!bw_rpc_input||!bw_in_resume)bw_slice_fail("rpc-outside-resume");
  uint64_t seq=++bw_rpc_next_seq;
  fprintf(bw_rpc_output,"BWR12\tREQ\t%" PRIu64 "\t%s\t%u\t%u\t%u\t%s\t%" PRIu64 "\t%" PRIu64 "\n",seq,kind,a,b,c,payload,bw_ticks,bw_successful_quanta);
  if(fflush(bw_rpc_output))bw_slice_fail("rpc-send");
  fprintf(stderr,"BWS12\tRPC_REQ\t%" PRIu64 "\t%s\t%u\t%u\t%u\t%s\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",seq,kind,a,b,c,payload,bw_ticks,bw_successful_quanta,++bw_ordinal);
  ++bw_rpc_request_count;return seq;
}
static unsigned bw_rpc_request(const char *kind,unsigned a,unsigned b,unsigned c) {
  uint64_t seq=bw_request(kind,a,b,c,"-");char line[256];bw_rpc_line(line,sizeof(line));char *f[5];
  if(bw_split_tabs(line,f,5)!=5||strcmp(f[0],"BWR12")||strcmp(f[1],"REP")||bw_decimal(f[2])!=seq||strcmp(f[3],"OK"))bw_slice_fail("rpc-reply");
  uint64_t value=bw_decimal(f[4]);if(value>UINT32_MAX)bw_slice_fail("rpc-reply-range");++bw_rpc_reply_count;
  fprintf(stderr,"BWS12\tRPC_REP\t%" PRIu64 "\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",seq,(unsigned)value,bw_ticks,bw_successful_quanta,++bw_ordinal);return (unsigned)value;
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
  char payload[33]="-";if(write)for(unsigned i=0;i<length;++i)sprintf(payload+2*i,"%02x",data[i]);
  uint64_t seq=bw_request(write?"WRITE":"READ",raw,length,0,write?payload:"-");
  char line[256];bw_rpc_line(line,sizeof(line));char *f[11];
  if(bw_split_tabs(line,f,11)!=11||strcmp(f[0],"BWR12")||strcmp(f[1],"MEM")||bw_decimal(f[2])!=seq||strcmp(f[3],"OK"))bw_slice_fail("rpc-memory-reply");
  *decoded=bw_hex32(f[4],8);
  uint64_t receivedKind=bw_decimal(f[5]),effect=bw_decimal(f[6]);
  if(*decoded!=want||receivedKind!=kind||effect!=bw_expected_effect(kind,write))bw_slice_fail("host-memory-classification");
  uint8_t returned[16];bw_hex_bytes(f[7],returned,length);
  if(write&&kind==1&&memcmp(returned,data,length))bw_slice_fail("host-write-commit");
  if(kind==4)for(unsigned i=0;i<length;++i)if(returned[i]!=0xff)bw_slice_fail("host-open-bus-value");
  if(kind==2&&!bw_rom_observed(want,returned,length))bw_slice_fail("host-rom-observed-value");
  uint64_t generation=bw_decimal(f[8]),epoch=bw_decimal(f[9]);
  if(generation>UINT32_MAX||epoch!=bw_mapping_epoch||bw_decimal(f[10])!=bw_board_a20||bw_mapping_pending)bw_slice_fail("rpc-memory-generation");
  uint32_t &known=bw_generation_of(want);uint32_t expected=kind==1?known:0;
  if(write&&kind==1){if(known==UINT32_MAX)bw_slice_fail("generation-overflow");++expected;}
  if(generation!=expected)bw_slice_fail("rpc-memory-generation");
  if(write&&kind==1){
    if(bw_pending_write_count==32)bw_slice_fail("pending-write-bound");
    bw_pending_write &pending=bw_pending_writes[bw_pending_write_count++];pending.raw=raw;pending.decoded=want;
    pending.length=length;pending.generation=(uint32_t)generation;pending.why=bw_pagewalk_kind?bw_pagewalk_kind:bw_delivery_kind==1?5:bw_delivery_kind==2?6:0;memcpy(pending.bytes,returned,length);known=(uint32_t)generation;
  }
  if(!write)memcpy(data,returned,length);
  ++bw_rpc_reply_count;
  fprintf(stderr,"BWS12\tRPC_MEM\t%" PRIu64 "\t%08x\t%u\t%u\t%s\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%u\n",seq,*decoded,(unsigned)kind,(unsigned)effect,f[7],(unsigned)generation,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,bw_board_a20);
  for(unsigned i=0;i<length;++i){tags[i].kind=kind;tags[i].effect=(uint8_t)effect;}
  return 1;
}
static int bw_host_read(void *,uint32_t raw,uint8_t *data,uint32_t length,uint32_t *decoded,bw_cpu3_combined_paging_ram_byte_result *tags){return bw_host_memory(raw,data,length,decoded,tags,false);}
static int bw_host_write(void *,uint32_t raw,const uint8_t *data,uint32_t length,uint32_t *decoded,bw_cpu3_combined_paging_ram_byte_result *tags){return bw_host_memory(raw,const_cast<uint8_t*>(data),length,decoded,tags,true);}

static uint32_t bw_rotr(uint32_t x,unsigned n){return (x>>n)|(x<<(32-n));}
static void bw_page_sha(const uint8_t *bytes,char out[65]) {
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
  for(unsigned block=0;block<65;++block){uint32_t w[64];
    for(unsigned i=0;i<16;++i){w[i]=0;for(unsigned j=0;j<4;++j){unsigned at=block*64+i*4+j;uint8_t v=at<4096?bytes[at]:at==4096?0x80:at==4158?0x80:0;w[i]=(w[i]<<8)|v;}}
    for(unsigned i=16;i<64;++i){uint32_t a=w[i-15],b=w[i-2];w[i]=w[i-16]+(bw_rotr(a,7)^bw_rotr(a,18)^(a>>3))+w[i-7]+(bw_rotr(b,17)^bw_rotr(b,19)^(b>>10));}
    uint32_t a=h[0],b=h[1],c=h[2],d=h[3],e=h[4],f=h[5],g=h[6],hh=h[7];
    for(unsigned i=0;i<64;++i){uint32_t t1=hh+(bw_rotr(e,6)^bw_rotr(e,11)^bw_rotr(e,25))+((e&f)^(~e&g))+k[i]+w[i],t2=(bw_rotr(a,2)^bw_rotr(a,13)^bw_rotr(a,22))+((a&b)^(a&c)^(b&c));hh=g;g=f;f=e;e=d+t1;d=c;c=b;b=a;a=t1+t2;}
    h[0]+=a;h[1]+=b;h[2]+=c;h[3]+=d;h[4]+=e;h[5]+=f;h[6]+=g;h[7]+=hh;
  }for(unsigned i=0;i<8;++i)sprintf(out+i*8,"%08x",h[i]);
}
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
  uint64_t seq=bw_request("PAGE",raw,4096,0,"-");char line[256];bw_rpc_line(line,sizeof(line));char *f[9];
  if(bw_split_tabs(line,f,9)!=9||strcmp(f[0],"BWR12")||strcmp(f[1],"PAGE")||bw_decimal(f[2])!=seq)bw_slice_fail("rpc-page-reply");
  if(bw_hex32(f[3],8)!=want||bw_decimal(f[4])!=generation||bw_decimal(f[5])!=type||strlen(f[6])!=64||bw_decimal(f[7])!=bw_mapping_epoch||bw_decimal(f[8])!=bw_board_a20)bw_slice_fail("rpc-page-metadata");
  bw_coherent_page &page=bw_pages[bw_page_count];page.raw=raw;page.decoded=want;page.generation=generation;page.kind=type;page.epoch=bw_mapping_epoch;page.executed=false;strcpy(page.sha,f[6]);
  for(unsigned i=0;i<64;++i){bw_rpc_line(line,sizeof(line));char *d[5];
    if(bw_split_tabs(line,d,5)!=5||strcmp(d[0],"BWR12")||strcmp(d[1],"DATA")||bw_decimal(d[2])!=seq||bw_decimal(d[3])!=i)bw_slice_fail("rpc-page-chunk");
    bw_hex_bytes(d[4],page.bytes+i*64,64);fprintf(stderr,"BWS12\tPAGE_CHUNK\t%" PRIu64 "\t%u\t%s\n",seq,i,d[4]);}
  bw_rpc_line(line,sizeof(line));char *end[3];if(bw_split_tabs(line,end,3)!=3||strcmp(end[0],"BWR12")||strcmp(end[1],"END")||bw_decimal(end[2])!=seq)bw_slice_fail("rpc-page-end");
  char actual[65];bw_page_sha(page.bytes,actual);if(strcmp(actual,page.sha))bw_slice_fail("rpc-page-sha256");
  ++bw_page_count;++bw_rpc_reply_count;*decoded=want;*kind=type;
  fprintf(stderr,"BWS12\tRPC_PAGE\t%" PRIu64 "\t%08x\t%u\t%u\t%s\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%u\n",seq,want,generation,type,actual,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,bw_board_a20);
  return page.bytes;
}
static const char *bw_write_why(unsigned why){static const char *names[]={"data","pde-read","pte-read","pde-ad-write","pte-ad-write","fault-frame","irq-frame"};if(why>6)bw_slice_fail("write-reason");return names[why];}
static void bw_emit_boundary(const char *kind){
  const bool ad_only=!strcmp(kind,"prefetch-pagewalk");
  if(ad_only&&bw_mapping_pending)bw_slice_fail("pagewalk-mapping-pending");
  if(ad_only)for(unsigned w=0;w<bw_pending_write_count;++w)if(bw_pending_writes[w].why!=3&&bw_pending_writes[w].why!=4)bw_slice_fail("prefetch-non-pagewalk-write");
  unsigned aliases=0,stamps=0,prefetch=0,tlb=0,global=0;
  bw_current_boundary=kind;
  fprintf(stderr,"BWS12\tBOUNDARY\t%s\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",kind,bw_attempt_cs,bw_attempt_eip,bw_ticks,bw_successful_quanta,++bw_ordinal);
  for(unsigned w=0;w<bw_pending_write_count;++w){const bw_pending_write &pending=bw_pending_writes[w];char hex[33];
    for(unsigned j=0;j<pending.length;++j)sprintf(hex+2*j,"%02x",pending.bytes[j]);
    fprintf(stderr,"BWS12\tCOMMIT\t%08x\t%08x\t%u\t%s\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%s\n",pending.raw,pending.decoded,pending.length,hex,pending.generation,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind,bw_board_a20,bw_write_why(pending.why));
    for(unsigned i=0;i<bw_page_count;++i){bw_coherent_page &page=bw_pages[i];
      if(page.kind!=1||page.epoch!=bw_mapping_epoch||page.decoded!=(pending.decoded&~4095U))continue;
      if(ad_only)bw_slice_fail("executable-table-ad-write");
      const unsigned offset=pending.decoded&4095;memcpy(page.bytes+offset,pending.bytes,pending.length);page.generation=pending.generation;bw_page_sha(page.bytes,page.sha);++aliases;
      fprintf(stderr,"BWS12\tALIAS_UPDATE\t%08x\t%08x\t%u\t%u\t%u\t%u\t%s\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",page.raw,page.decoded,offset,pending.length,page.generation,page.epoch,page.sha,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);
      if(page.executed){unsigned before=(BX_CPU(0)->async_event&BX_ASYNC_EVENT_STOP_TRACE)!=0;pageWriteStampTable.decWriteStamp(page.raw+offset,pending.length);++stamps;
        fprintf(stderr,"BWS12\tSTAMP\t%08x\t%u\t%08x\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\n",page.raw+offset,pending.length,page.decoded,page.epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind,before,(unsigned)((BX_CPU(0)->async_event&BX_ASYNC_EVENT_STOP_TRACE)!=0));}
    }
  }
  const char *reason=ad_only?"pagewalk-publish":stamps?"executable-alias-write":"publish-only";
  if(stamps){unsigned before=BX_CPU(0)->eipPageWindowSize;BX_CPU(0)->invalidate_prefetch_q();prefetch=1;
    fprintf(stderr,"BWS12\tPREFETCH_INVALIDATE\texecutable-alias-write\t%u\t%u\t%08x\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t1\n",before,BX_CPU(0)->eipPageWindowSize,(unsigned)BX_CPU(0)->pAddrFetchPage,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);}
  if(bw_mapping_pending){if(strcmp(kind,"ordinary")||bw_pending_write_count)bw_slice_fail("mapping-boundary-kind");unsigned old=bw_board_a20;uint32_t epoch=bw_mapping_epoch;bw_board_a20=bw_next_a20;bw_mapping_epoch=bw_next_epoch;
    fprintf(stderr,"BWS12\tMAP_COMMIT\t%u\t%u\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",old,bw_board_a20,epoch,bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);
    flushICaches();global=1;bw_bridge_tlb_reason="mapping-transition";BX_CPU(0)->TLB_flush();bw_bridge_tlb_reason=0;tlb=1;
    fprintf(stderr,"BWS12\tTLB_INVALIDATE\tmapping-transition\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\n",bw_mapping_epoch,bw_ticks,bw_successful_quanta,++bw_ordinal,kind);reason="mapping-transition";bw_mapping_pending=false;
  }
  fprintf(stderr,"BWS12\tCOHERENCE\t%s\t%u\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\t%u\t%u\n",reason,bw_mapping_epoch,bw_board_a20,aliases,bw_ticks,bw_successful_quanta,++bw_ordinal,kind,stamps,prefetch,tlb,global);
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
    fprintf(stderr,"BWS12\tPROBE\tcallback-reentry\trejected\n");
    if (bw_cpu3_combined_paging_ram_set_irq_line(1) || bw_host_irq_line)
      bw_slice_fail("line-reentry-accepted");
    fprintf(stderr,"BWS12\tPROBE\tline-reentry\trejected\n");
  }
  if (count!=1) return 0;
  return bw_rpc_request("NATIVE_TICK",count,0,0)==0;
}

static int bw_host_quantum(void *, uint32_t kind, uint32_t *due)
{
  if (!due || kind>1) return 0;
  const unsigned reply=bw_rpc_request("QUANTUM",kind,0,0);
  if (reply>1) return 0;
  *due=reply;
  return 1;
}

static int bw_host_ack_irq(void *,uint8_t *vector){
  if(!vector||!bw_host_irq_line)return 0;unsigned supplied=bw_rpc_request("ACK",0,0,0);
  if(supplied!=0x20)return 0;*vector=(uint8_t)supplied;return 1;
}
static int bw_host_in(void *,uint16_t,uint32_t,uint32_t *){return 0;}
static int bw_host_out(void *,uint16_t port,uint32_t width,uint32_t value){
  static const char marker[]="RPGC001";
  if(width!=1||value>255||(port!=0xe9&&port!=0x20&&port!=0x21&&port!=0xa0&&port!=0xa1&&port!=0x40&&port!=0x43&&port!=0x60&&port!=0x64))return 0;
  if(port==0xe9&&(bw_port_bytes_seen>=7||value!=(unsigned char)marker[bw_port_bytes_seen]))return 0;
  if(bw_mapping_pending)bw_slice_fail("pio-mapping-pending");
  uint64_t seq=bw_request("PIO_OUT",port,width,value,"-");char line[256];bw_rpc_line(line,sizeof(line));char *f[7];
  if(bw_split_tabs(line,f,7)!=7||strcmp(f[0],"BWR12")||strcmp(f[1],"PIO")||bw_decimal(f[2])!=seq||strcmp(f[3],"OK")||bw_decimal(f[4]))bw_slice_fail("rpc-pio-reply");
  uint64_t a20=bw_decimal(f[5]),epoch=bw_decimal(f[6]);
  if(a20>1||epoch>UINT32_MAX||epoch!=bw_mapping_epoch+(a20!=bw_board_a20)||((a20!=bw_board_a20)&&port!=0x60)||((a20!=bw_board_a20)&&bw_mapping_epoch==UINT32_MAX))bw_slice_fail("rpc-pio-mapping");
  if(a20!=bw_board_a20){bw_mapping_pending=true;bw_next_a20=(unsigned)a20;bw_next_epoch=(uint32_t)epoch;}
  ++bw_rpc_reply_count;fprintf(stderr,"BWS12\tRPC_PIO\t%" PRIu64 "\t0\t%u\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",seq,(unsigned)a20,(unsigned)epoch,bw_ticks,bw_successful_quanta,++bw_ordinal);
  if(port==0xe9)++bw_port_bytes_seen;
  fprintf(stderr,"BWS12\tPORT\tout\t%04x\t%u\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",port,width,value,bw_ticks,++bw_ordinal);return 1;
}
extern "C" int bw_cpu3_combined_paging_ram_set_irq_line(int asserted){
  if(!bw_slice_active||bw_in_resume||(asserted!=0&&asserted!=1))return 0;
  bw_host_irq_line=asserted!=0;if(asserted)BX_CPU(0)->raise_INTR();else BX_CPU(0)->clear_INTR();
  fprintf(stderr,"BWS12\tIRQ_LINE\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",asserted,bw_ticks,bw_successful_quanta,++bw_ordinal);return 1;
}
unsigned bw_slice_ack_irq(void){
  uint8_t vector=0;if(bw_delivery_kind||bw_irq_deliveries||!bw_callbacks.ack_irq||!bw_callbacks.ack_irq(bw_callbacks.context,&vector))bw_slice_fail("host-irq-ack");
  bw_require_clean();bw_last_irq_vector=vector;bw_irq_ack_ticks=bw_ticks;bw_irq_ack_quanta=bw_successful_quanta;bw_delivery_kind=2;
  fprintf(stderr,"BWS12\tIRQ_ACK\t%02x\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",vector,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip(),bw_ticks,bw_successful_quanta,++bw_ordinal);return vector;
}
void bw_slice_note_irq(unsigned vector){
  if(bw_delivery_kind!=2||vector!=bw_last_irq_vector||bw_ticks!=bw_irq_ack_ticks||bw_successful_quanta!=bw_irq_ack_quanta)bw_slice_fail("host-irq-delivery");
  ++bw_irq_deliveries;bw_slice_irq_pending=true;
  fprintf(stderr,"BWS12\tIRQ_DELIVERED\t%02x\t%04x\t%08x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",vector,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip(),BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx,bw_ticks,bw_successful_quanta,++bw_ordinal);
  bw_emit_boundary("irq-delivery");bw_delivery_kind=0;
}
void bw_slice_note_fault(unsigned vector,unsigned error){
  if(!bw_slice_active)return;
  if(vector!=14||error!=2||bw_faults>=2||bw_delivery_kind)bw_slice_fail("unexpected-fault");
  ++bw_faults;bw_fault_vector=vector;bw_fault_error=error;bw_fault_cr2=BX_CPU(0)->cr2;
  bw_fault_begin_tick=bw_ticks;bw_fault_begin_quanta=bw_successful_quanta;bw_slice_fault_pending=true;bw_delivery_kind=1;
  fprintf(stderr,"BWS12\tFAULT_BEGIN\t%u\t%u\t%08x\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",vector,error,bw_fault_cr2,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,(unsigned)BX_CPU(0)->prev_rip,bw_ticks,bw_successful_quanta,++bw_ordinal);
}
void bw_slice_note_fault_delivered(void){
  if(bw_delivery_kind!=1||!bw_slice_fault_pending||bw_ticks!=bw_fault_begin_tick+1||bw_successful_quanta!=bw_fault_begin_quanta)bw_slice_fail("fault-delivery-clock");
  fprintf(stderr,"BWS12\tFAULT_DELIVERED\t%u\t%u\t%08x\t%04x\t%08x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",bw_fault_vector,bw_fault_error,bw_fault_cr2,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip(),BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx,bw_ticks,bw_successful_quanta,++bw_ordinal);
  bw_emit_boundary("fault-delivery");bw_delivery_kind=0;
}

void bw_slice_read(unsigned long long raw,unsigned length,void *data){
  bw_cpu3_combined_paging_ram_byte_result tags[16];uint32_t decoded=0;
  if(!bw_slice_active||!bw_raw_span_ok(raw,length)||!bw_callbacks.read_physical(bw_callbacks.context,(uint32_t)raw,(uint8_t*)data,length,&decoded,tags))bw_slice_fail("host-physical-read");
  ++bw_physical_reads;
  for(unsigned i=0;i<length;++i)fprintf(stderr,"BWS12\tMEM\tR\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\n",(unsigned)raw+i,decoded+i,bw_kind_name(tags[i].kind),((uint8_t*)data)[i],bw_effect_name(tags[i].effect),bw_ticks,++bw_ordinal,(bw_pagewalk_kind?bw_pagewalk_name():bw_delivery_kind==1?"fault-frame":bw_delivery_kind==2?"irq-frame":"data"),bw_mapping_epoch,bw_board_a20);
}
void bw_slice_write(unsigned long long raw,unsigned length,const void *data){
  bw_cpu3_combined_paging_ram_byte_result tags[16];uint32_t decoded=0;
  if(!bw_slice_active||!bw_raw_span_ok(raw,length)||!bw_callbacks.write_physical(bw_callbacks.context,(uint32_t)raw,(const uint8_t*)data,length,&decoded,tags))bw_slice_fail("host-physical-write");
  ++bw_physical_writes;
  for(unsigned i=0;i<length;++i){
    fprintf(stderr,"BWS12\tMEM\tW\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\t%u\t%u\n",(unsigned)raw+i,decoded+i,bw_kind_name(tags[i].kind),((const uint8_t*)data)[i],bw_effect_name(tags[i].effect),bw_ticks,++bw_ordinal,(bw_pagewalk_kind?bw_pagewalk_name():bw_delivery_kind==1?"fault-frame":bw_delivery_kind==2?"irq-frame":"data"),bw_mapping_epoch,bw_board_a20);}
}
const unsigned char *bw_slice_execute_page(unsigned long long raw){
  uint32_t decoded=0;uint8_t kind=0;
  if(!bw_slice_active||raw>UINT32_MAX||(raw&4095))bw_slice_fail("unsafe-execute-page");
  const uint8_t *page=bw_callbacks.execute_page(bw_callbacks.context,(uint32_t)raw,&decoded,&kind);
  if(!page||(kind!=1&&kind!=2))bw_slice_fail("unsafe-execute-page");++bw_execute_pages;
  for(unsigned i=0;i<bw_page_count;++i)if(page==bw_pages[i].bytes){fprintf(stderr,"BWS12\tEXEC\t%08x\t%08x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%u\t%s\t%u\t%u\t1\n",(unsigned)raw,decoded,bw_kind_name(kind),bw_ticks,++bw_ordinal,bw_pages[i].generation,bw_pages[i].sha,bw_pages[i].epoch,bw_board_a20);return page;}
  bw_slice_fail("execute-provider-pointer");return 0;
}
void bw_slice_note_prefetch(unsigned long long raw){
  if(!bw_slice_active)return;if(raw>UINT32_MAX)bw_slice_fail("prefetch-overflow");
  fprintf(stderr,"BWS12\tPREFETCH\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%u\t%u\n",(unsigned)raw,bw_ticks,bw_successful_quanta,++bw_ordinal,bw_mapping_epoch,bw_board_a20);
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
  fprintf(stderr,"BWS12\tNATIVE_TICK\t%u\t%" PRIu64 "\t%" PRIu64
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
  fprintf(stderr,"BWS12\tQUANTUM\t%u\t%04x\t%08x\t%08x\t%04x\t%08x\t%" PRIu64
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
  fprintf(stderr,"BWS12\tATTEMPT\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%08x\t%u\t",bw_attempt_cs,bw_attempt_eip,bw_ticks,bw_successful_quanta,++bw_ordinal,raw,length);
  for(unsigned i=0;i<length;++i)fprintf(stderr,"%02x",page->bytes[(raw&4095)+i]);fprintf(stderr,"\t%08x\t%s\t%u\t%u\t%u\t1\n",page->decoded+(raw&4095),bw_kind_name(page->kind),page->generation,page->epoch,bw_board_a20);
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
    fprintf(stderr,"BWS12\tHALT_IDLE\t%" PRIu64 "\t%04x\t%08x\t%u\t%u\t%08x\t%" PRIu64 "\n",
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
  fprintf(stderr,"BWS12\tPROBE\tresume-before-activation\trejected\n");
  if(bw_cpu3_combined_paging_ram_set_irq_line(1))bw_slice_fail("irq-before-activation-accepted");
  fprintf(stderr,"BWS12\tPROBE\tirq-before-activation\trejected\n");
  if(cpu->sregs[BX_SEG_REG_CS].selector.value!=0xf000||cpu->get_eip()!=0xfff0||cpu->sregs[BX_SEG_REG_CS].cache.u.segment.base!=0xffff0000||!bx_pc_system.get_enable_a20()||bw_attempts||bw_ticks||bw_successful_quanta)bw_slice_fail("cold-reset-boundary");
  bw_emit_state("RESET",cpu);bw_emit_extra(cpu,false);
  bw_callbacks.context=0;bw_callbacks.read_physical=bw_host_read;bw_callbacks.write_physical=bw_host_write;bw_callbacks.execute_page=bw_host_execute;
  bw_callbacks.port_in=bw_host_in;bw_callbacks.port_out=bw_host_out;bw_callbacks.native_tick=bw_host_tick;bw_callbacks.successful_quantum=bw_host_quantum;bw_callbacks.ack_irq=bw_host_ack_irq;
  bw_slice_active=true;bw_bridge_tlb_reason="activation";cpu->TLB_flush();bw_bridge_tlb_reason=0;cpu->iCache.flushICacheEntries();
  fprintf(stderr,"BWS12\tACTIVATE\tf000\t0000fff0\t0\t1\n");
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

void bw_slice_driver(void){
  const char *probe=getenv("BW_CPU3_COMBINED_PAGING_RAM_PROBE");
  if(probe){uint8_t byte=0;
    if(!strcmp(probe,"unsupported-span-width"))bw_slice_read(0,17,&byte);
    else if(!strcmp(probe,"physical-overflow"))bw_slice_read(0x100000000ULL,1,&byte);
    else if(!strcmp(probe,"admitted-unexecuted-code-write")){bw_pages[0].kind=1;bw_pages[0].decoded=0x7000;bw_pages[0].epoch=0;bw_pages[0].executed=false;bw_page_count=1;bw_slice_write(0x7000,1,&byte);}
    else if(!strcmp(probe,"current-code-write")){bw_current_code_page=0x7000;bw_slice_write(0x7000,1,&byte);}
    else if(!strcmp(probe,"executable-table-ad-write")){bw_pages[0].kind=1;bw_pages[0].decoded=0x7000;bw_page_count=1;bw_pagewalk_kind=4;bw_slice_write(0x7000,1,&byte);}
    else if(!strcmp(probe,"pio-port92")){bw_slice_port_out(0x92,2,1);}
    else if(!strcmp(probe,"mapping-boundary-kind")){bw_mapping_pending=true;bw_emit_boundary("rep-element");}
    else if(!strcmp(probe,"execute-pending-write")){bw_pending_write_count=1;bw_slice_execute_page(0);}
    else if(!strcmp(probe,"native-a20-off")){bx_pc_system.set_enable_a20(false);bw_slice_execute_page(0);}
    else if(!strcmp(probe,"stale-cache-generation")){bw_pages[0].raw=0xf0000;bw_pages[0].decoded=0xf0000;bw_pages[0].kind=2;bw_pages[0].epoch=0;bw_pages[0].generation=1;bw_page_count=1;uint32_t decoded;uint8_t kind;bw_host_execute(0,0xf0000,&decoded,&kind);}
    else if(!strcmp(probe,"write-stage-bound")){bw_pending_write_count=32;bw_slice_write(0,1,&byte);}
    else if(!strcmp(probe,"write-generation-overflow")){bw_generation_of(0)=UINT32_MAX;bw_slice_write(0,1,&byte);}
    else if(!strcmp(probe,"prefetch-non-pagewalk-write")){bw_pending_write_count=1;bw_pending_writes[0].why=0;bw_emit_boundary("prefetch-pagewalk");}
    else if(!strcmp(probe,"unsafe-execute-ram"))bw_slice_execute_page(0);
    else if(!strcmp(probe,"unsupported-rep")){bw_rep_allowed=false;bw_slice_rep_pre_iteration();}
    else if(!strcmp(probe,"unsafe-execute-mmio"))bw_slice_execute_page(0xa0000);
    else if(!strcmp(probe,"unsafe-execute-unmapped"))bw_slice_execute_page(0xc0000);
    else if(!strcmp(probe,"unexpected-pio"))bw_slice_port_out(0x80,0,1);
    else if(!strcmp(probe,"bochs-ram-read"))BX_MEM(0)->readPhysicalPage(BX_CPU(0),0,1,&byte);
    else if(!strcmp(probe,"bochs-ram-write"))BX_MEM(0)->writePhysicalPage(BX_CPU(0),0,1,&byte);
    else if(!strcmp(probe,"bochs-direct-pointer"))BX_MEM(0)->getHostMemAddr(BX_CPU(0),0,BX_READ);
    else if(!strcmp(probe,"bochs-pio"))bx_devices.outp(0x80,0,1);
    else if(!strcmp(probe,"bochs-timer"))bx_pc_system.bw_probe_countdown_fallback();
    else if(!strcmp(probe,"unknown-trap"))bw_slice_note_fault(6,0);
    else bw_slice_fail("unknown-probe");bw_slice_fail("probe-was-not-rejected");
  }
  bw_cpu3_combined_paging_ram_slice_result invalid;
  if (bw_cpu3_combined_paging_ram_resume(0,1,UINT64_MAX,&bw_callbacks,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("zero-native-budget-accepted");
  fprintf(stderr,"BWS12\tPROBE\tzero-native-budget\trejected\n");
  if (bw_cpu3_combined_paging_ram_resume(1,0,UINT64_MAX,&bw_callbacks,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("zero-quantum-budget-accepted");
  fprintf(stderr,"BWS12\tPROBE\tzero-quantum-budget\trejected\n");
  if (bw_cpu3_combined_paging_ram_resume(1,1,UINT64_MAX,0,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("null-callbacks-accepted");
  fprintf(stderr,"BWS12\tPROBE\tnull-callbacks\trejected\n");
  bw_cpu3_combined_paging_ram_host_callbacks incomplete=bw_callbacks;
  incomplete.native_tick=0;
  if (bw_cpu3_combined_paging_ram_resume(1,1,UINT64_MAX,&incomplete,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("incomplete-callbacks-accepted");
  fprintf(stderr,"BWS12\tPROBE\tincomplete-native-tick\trejected\n");
  incomplete=bw_callbacks;
  incomplete.successful_quantum=0;
  if (bw_cpu3_combined_paging_ram_resume(1,1,UINT64_MAX,&incomplete,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("incomplete-callbacks-accepted");
  fprintf(stderr,"BWS12\tPROBE\tincomplete-quantum\trejected\n");
  if (!bw_cpu3_combined_paging_ram_resume(1,1,bw_ticks,&bw_callbacks,&invalid) ||
      invalid.reason!=BW_CPU3_COMBINED_PAGING_RAM_SLICE_EVENT_DUE ||
      invalid.charged_native_ticks || invalid.charged_quanta ||
      invalid.effective_native_ticks || !invalid.event_due)
    bw_slice_fail("due-now-contract");
  fprintf(stderr,"BWS12\tPROBE\tdue-now\tzero-work\n");
  if (bw_cpu3_combined_paging_ram_set_irq_line(2))
    bw_slice_fail("invalid-irq-line-accepted");
  fprintf(stderr,"BWS12\tPROBE\tinvalid-irq-line\trejected\n");


  bw_rpc_open();fprintf(bw_rpc_output,"BWR12\tREADY\tf000\t0000fff0\t0\t0\n");fflush(bw_rpc_output);
  fprintf(stderr,"BWS12\tREADY\tf000\t0000fff0\t0\t0\n");
  uint64_t last_command=0;bool zero_terminal_halt=false;
  for(unsigned command_count=0;command_count<10000;++command_count){
    char line[256];bw_rpc_line(line,sizeof(line));char *fields[7];
    if(bw_split_tabs(line,fields,7)!=7||strcmp(fields[0],"BWR12")||strcmp(fields[1],"CMD"))bw_slice_fail("rpc-command");
    uint64_t sequence=bw_decimal(fields[2]),arg0=bw_decimal(fields[4]),arg1=bw_decimal(fields[5]),deadline=bw_decimal(fields[6]);const char *verb=fields[3];
    if(sequence!=last_command+1)bw_slice_fail("rpc-command-sequence");last_command=sequence;
    fprintf(stderr,"BWS12\tCMD\t%" PRIu64 "\t%s\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",sequence,verb,arg0,arg1,deadline,++bw_ordinal);
    if(!strcmp(verb,"LINE")){
      if(arg0>1||arg1||deadline||!bw_cpu3_combined_paging_ram_set_irq_line((int)arg0))bw_slice_fail("rpc-line-command");
      fprintf(bw_rpc_output,"BWR12\tDONE\t%" PRIu64 "\tLINE\t%u\t%" PRIu64 "\t%" PRIu64 "\n",sequence,(unsigned)arg0,bw_ticks,bw_successful_quanta);
    }else if(!strcmp(verb,"RUN")){
      if(!arg0||arg0>UINT32_MAX||!arg1||arg1>300||deadline!=UINT64_MAX||zero_terminal_halt)bw_slice_fail("rpc-run-budget");
      const unsigned entry_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
      const unsigned entry_eip=BX_CPU(0)->get_eip();
      const unsigned entry_if=BX_CPU(0)->get_IF();
      const unsigned entry_activity=BX_CPU(0)->activity_state;
      const unsigned entry_pending=BX_CPU(0)->pending_event;
      const uint64_t before_ticks=bw_ticks;
      const uint64_t before_quanta=bw_successful_quanta;
      bw_cpu3_combined_paging_ram_slice_result result;
      if (!bw_cpu3_combined_paging_ram_resume((uint32_t)arg0,(uint32_t)arg1,
          deadline,&bw_callbacks,&result)) bw_slice_fail("rpc-run-resume");
      if (bw_ticks!=result.total_native_ticks ||
          bw_successful_quanta!=result.total_successful_quanta ||
          result.charged_native_ticks!=bw_ticks-before_ticks ||
          result.charged_quanta!=bw_successful_quanta-before_quanta ||
          result.charged_native_ticks>result.effective_native_ticks ||
          result.charged_quanta>result.requested_quanta ||
          bw_ticks!=bw_successful_quanta+bw_faults)
        bw_slice_fail("separate-clock-ledger");
      fprintf(stderr,"BWS12\tSLICE\t%" PRIu64 "\t%u\t%u\t%u\t%u\t%u\t%u",
        last_command,result.requested_native_ticks,
        result.effective_native_ticks,result.charged_native_ticks,
        result.requested_quanta,result.charged_quanta,result.reason);
      fprintf(stderr,"\t%04x\t%08x\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64,entry_cs,entry_eip,result.cs,result.eip,
        before_ticks,bw_ticks,before_quanta,bw_successful_quanta);
      fprintf(stderr,"\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64,
        result.attempts,result.completed,result.rep_iterations,result.rep_partial,
        result.faults,result.port_commits,result.irq_deliveries,result.halt_idle_cuts);
      fprintf(stderr,"\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u\t%u"
        "\t%u\t%u\t%u\t%08x\t%u\n",entry_if,result.if_flag,
        entry_activity,result.activity_state,entry_pending,result.pending_event,
        result.event_due,result.pending_irq,result.irq_delivered,
        result.irq_vector,result.pending_fault,result.fault_vector,
        result.fault_error,result.fault_cr2,result.port_committed);
      fprintf(bw_rpc_output,"BWR12\tDONE\t%" PRIu64 "\tRUN\t%u\t%u\t%u"
        "\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%u\t%u\t%u\n",
        last_command,result.reason,result.charged_native_ticks,
        result.charged_quanta,result.cs,result.eip,bw_ticks,bw_successful_quanta,
        result.attempts,result.completed,result.rep_iterations,result.faults,
        result.if_flag,result.activity_state,result.irq_delivered);

      if(result.reason==BW_CPU3_COMBINED_PAGING_RAM_SLICE_HALT){
        if(result.cs!=8||result.if_flag||result.pending_irq||bw_port_bytes_seen!=7)bw_slice_fail("terminal-halt-contract");
        if(!result.charged_native_ticks&&!result.charged_quanta)zero_terminal_halt=true;
      }else if(result.reason!=BW_CPU3_COMBINED_PAGING_RAM_SLICE_BUDGET&&result.reason!=BW_CPU3_COMBINED_PAGING_RAM_SLICE_PORT&&result.reason!=BW_CPU3_COMBINED_PAGING_RAM_SLICE_FAULT&&result.reason!=BW_CPU3_COMBINED_PAGING_RAM_SLICE_IRQ_DELIVERED&&result.reason!=BW_CPU3_COMBINED_PAGING_RAM_SLICE_EVENT_DUE)bw_slice_fail("unexpected-slice-reason");
    }else if(!strcmp(verb,"STOP")){
      bw_require_clean();
      if(arg0||arg1||deadline||!zero_terminal_halt||bw_port_bytes_seen!=7||bw_ticks!=bw_successful_quanta+bw_faults||bw_successful_quanta!=192||bw_faults!=2||bw_rep_iterations!=5||bw_irq_deliveries!=1||bw_host_irq_line||bw_board_a20!=1||bw_mapping_epoch!=2||bw_mapping_pending||bw_pending_write_count||bw_rpc_request_count!=bw_rpc_reply_count)bw_slice_fail("rpc-stop-contract");
      bw_emit_state("STATE",BX_CPU(0));
      fprintf(stderr,"BWS12\tFINAL\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",bw_ticks,bw_successful_quanta,
        bw_attempts,bw_completed,bw_rep_iterations,bw_rep_partial,bw_faults,
        bw_ports,bw_irq_deliveries,bw_halt_idle_cuts,bw_rpc_request_count,
        bw_rpc_reply_count,bw_tick_callbacks,bw_quantum_callbacks);
      fprintf(stderr,"BWS12\tCALLBACKS\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",
        bw_physical_reads,bw_physical_writes,bw_execute_pages,
        bw_tick_callbacks,bw_quantum_callbacks);
      fprintf(stderr,"BWS12\tFALLBACK\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",
        bw_fallback_ram_reads,bw_fallback_ram_writes,
        bw_fallback_direct_pointers,bw_fallback_pio,bw_fallback_timer);
      fprintf(bw_rpc_output,"BWR12\tDONE\t%" PRIu64 "\tSTOP\t0\t%" PRIu64
        "\t%" PRIu64 "\n",last_command,bw_ticks,bw_successful_quanta);
      if (fflush(bw_rpc_output)) bw_slice_fail("rpc-stop-send");
      bw_slice_active=false;
      fprintf(stderr,"BWS12\tDEACTIVATE\tproof-complete\n");
      return;

    }else bw_slice_fail("rpc-unknown-command");
    if(fflush(bw_rpc_output))bw_slice_fail("rpc-command-send");
  }bw_slice_fail("rpc-command-limit");
}
