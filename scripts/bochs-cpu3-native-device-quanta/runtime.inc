/* Included once at the end of cpu.cc in the separately prepared CPU3 tree. */
#include "iodev/iodev.h"
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "bw_owned_rom.inc"

bool bw_slice_active = false;
bool bw_slice_port_pending = false;
bool bw_slice_rep_incomplete = false;
bool bw_slice_fault_pending = false;
bool bw_slice_irq_pending = false;

// The backing array is deliberately larger than the decoded RAM map. The
// holes and ROM below 1 MiB are never served from this array after handoff.
static unsigned char bw_ram[0x180000];
static uint8_t bw_mmio_register;
static uint64_t bw_mmio_reads;
static uint64_t bw_mmio_writes;
static uint64_t bw_rom_ignored_writes;
static uint64_t bw_unmapped_reads;
static uint64_t bw_unmapped_ignored_writes;
static uint8_t bw_port92_latch;
static uint8_t bw_pagewalk_kind;
static uint64_t bw_aliased_pde_reads;
static uint64_t bw_aliased_pte5_reads;
static uint64_t bw_aliased_pde_ad_writes;
static uint64_t bw_aliased_pte5_ad_writes;
static bw_cpu3_device_quanta_host_callbacks bw_callbacks;
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
static uint64_t bw_completed;
static uint64_t bw_rep_iterations;
static uint64_t bw_rep_partial;
static uint32_t bw_rep_success_this_attempt;
static uint64_t bw_faults;
static unsigned bw_fault_vector;
static unsigned bw_fault_error;
static uint32_t bw_fault_cr2;
static uint32_t bw_faulting_eip;
static uint16_t bw_faulting_cs;
static uint64_t bw_fault_begin_tick;
static uint64_t bw_fault_begin_quanta;
static uint64_t bw_fault_begin_ordinal;
static uint64_t bw_ports;
static uint64_t bw_ordinal;
static bool bw_port_committed_this_slice;
static bool bw_halted;
static bool bw_host_irq_line;
static bool bw_in_resume;
static bool bw_reentry_probed;
static uint8_t bw_last_irq_vector;
static uint16_t bw_irq_entry_cs;
static uint32_t bw_irq_entry_eip;
static uint64_t bw_irq_ack_ticks;
static uint64_t bw_irq_ack_quanta;
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
  fprintf(stderr,"BWS8\t%s\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x"
    "\t%08x\t%08x\t%08x\t%08x\t%08x\t%04x\t%04x\t%04x"
    "\t%08x\t%04x\t%08x\t%04x\n",tag,
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
}

void bw_slice_fail(const char *kind)
{
  if (!strcmp(kind,"Bochs-RAM-read-fallback")) ++bw_fallback_ram_reads;
  if (!strcmp(kind,"Bochs-RAM-write-fallback")) ++bw_fallback_ram_writes;
  if (!strcmp(kind,"Bochs-direct-pointer-fallback")) ++bw_fallback_direct_pointers;
  if (!strcmp(kind,"Bochs-PIO-fallback")) ++bw_fallback_pio;
  if (!strcmp(kind,"Bochs-timer-fallback")) ++bw_fallback_timer;
  fprintf(stderr, "BWS8\tFAIL\t%s\n", kind);
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

static unsigned bw_rpc_request(const char *kind, unsigned arg0,
                               unsigned arg1, unsigned arg2)
{
  if (!bw_rpc_output || !bw_rpc_input || !bw_in_resume)
    bw_slice_fail("rpc-outside-resume");
  const uint64_t seq=++bw_rpc_next_seq;
  fprintf(bw_rpc_output,"BWR8\tREQ\t%" PRIu64 "\t%s\t%u\t%u\t%u\t%" PRIu64
    "\t%" PRIu64 "\n",seq,kind,arg0,arg1,arg2,bw_ticks,bw_successful_quanta);
  if (fflush(bw_rpc_output)) bw_slice_fail("rpc-send");
  fprintf(stderr,"BWS8\tRPC_REQ\t%" PRIu64 "\t%s\t%u\t%u\t%u\t%" PRIu64
    "\t%" PRIu64 "\t%" PRIu64 "\n",seq,kind,arg0,arg1,arg2,bw_ticks,
    bw_successful_quanta,++bw_ordinal);
  ++bw_rpc_request_count;
  char line[256];
  bw_rpc_line(line,sizeof(line));
  char *fields[5];
  if (bw_split_tabs(line,fields,5)!=5 || strcmp(fields[0],"BWR8") ||
      strcmp(fields[1],"REP") || strcmp(fields[3],"OK") ||
      bw_decimal(fields[2])!=seq)
    bw_slice_fail("rpc-reply");
  const uint64_t parsed=bw_decimal(fields[4]);
  if (parsed>UINT32_MAX) bw_slice_fail("rpc-reply-range");
  const unsigned value=(unsigned)parsed;
  ++bw_rpc_reply_count;
  fprintf(stderr,"BWS8\tRPC_REP\t%" PRIu64 "\t%u\t%" PRIu64 "\t%" PRIu64
    "\t%" PRIu64 "\n",seq,value,bw_ticks,bw_successful_quanta,++bw_ordinal);
  return value;
}

static bool bw_raw_span_ok(unsigned long long address, unsigned length)
{
  return length && length <= 16 && address <= UINT32_MAX &&
    length <= UINT32_MAX - address + 1ULL &&
    ((address & 4095) + length <= 4096);
}

static uint8_t bw_map_kind(uint32_t address)
{
  if (address <= 0x9ffff ||
      (address >= 0x100000 && address <= 0x17ffff))
    return BW_CPU3_DEVICE_QUANTA_RAM;
  if (address == 0xa0000) return BW_CPU3_DEVICE_QUANTA_MMIO;
  if (address >= 0xf0000 && address <= 0xfffff)
    return BW_CPU3_DEVICE_QUANTA_ROM;
  return BW_CPU3_DEVICE_QUANTA_UNMAPPED;
}

static const char *bw_kind_name(uint8_t kind)
{
  switch (kind) {
    case BW_CPU3_DEVICE_QUANTA_RAM: return "ram";
    case BW_CPU3_DEVICE_QUANTA_ROM: return "rom";
    case BW_CPU3_DEVICE_QUANTA_MMIO: return "mmio";
    case BW_CPU3_DEVICE_QUANTA_UNMAPPED: return "unmapped";
  }
  bw_slice_fail("host-map-kind");
  return "invalid";
}

static const char *bw_effect_name(uint8_t effect)
{
  switch (effect) {
    case BW_CPU3_DEVICE_QUANTA_RAM_READ: return "ram-read";
    case BW_CPU3_DEVICE_QUANTA_RAM_COMMIT: return "ram-commit";
    case BW_CPU3_DEVICE_QUANTA_ROM_READ: return "rom-read";
    case BW_CPU3_DEVICE_QUANTA_ROM_IGNORED: return "rom-ignored";
    case BW_CPU3_DEVICE_QUANTA_MMIO_READ: return "mmio-read";
    case BW_CPU3_DEVICE_QUANTA_MMIO_WRITE: return "mmio-write";
    case BW_CPU3_DEVICE_QUANTA_OPEN_BUS: return "open-bus";
    case BW_CPU3_DEVICE_QUANTA_UNMAPPED_IGNORED: return "unmapped-ignored";
  }
  bw_slice_fail("host-map-effect");
  return "invalid";
}

static uint8_t bw_expected_effect(uint8_t kind, bool write)
{
  switch (kind) {
    case BW_CPU3_DEVICE_QUANTA_RAM:
      return write ? BW_CPU3_DEVICE_QUANTA_RAM_COMMIT : BW_CPU3_DEVICE_QUANTA_RAM_READ;
    case BW_CPU3_DEVICE_QUANTA_ROM:
      return write ? BW_CPU3_DEVICE_QUANTA_ROM_IGNORED : BW_CPU3_DEVICE_QUANTA_ROM_READ;
    case BW_CPU3_DEVICE_QUANTA_MMIO:
      return write ? BW_CPU3_DEVICE_QUANTA_MMIO_WRITE : BW_CPU3_DEVICE_QUANTA_MMIO_READ;
    case BW_CPU3_DEVICE_QUANTA_UNMAPPED:
      return write ? BW_CPU3_DEVICE_QUANTA_UNMAPPED_IGNORED : BW_CPU3_DEVICE_QUANTA_OPEN_BUS;
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

static bool bw_mapped_span_ok(uint32_t raw, uint32_t effective,
                              uint32_t length)
{
  if (!bw_raw_span_ok(raw,length)) return false;
  for (uint32_t i=0;i<length;++i) {
    if (A20ADDR((bx_phy_address)raw+i) != (bx_phy_address)effective+i ||
        effective+i >= sizeof(bw_ram)) return false;
  }
  return true;
}

static uint32_t bw_read_le32(unsigned address)
{
  if (address > sizeof(bw_ram)-4) bw_slice_fail("snapshot-range");
  return (uint32_t)bw_ram[address] |
    ((uint32_t)bw_ram[address+1] << 8) |
    ((uint32_t)bw_ram[address+2] << 16) |
    ((uint32_t)bw_ram[address+3] << 24);
}

static int bw_host_read(void *, uint32_t raw, uint32_t effective,
                        uint8_t *data, uint32_t length,
                        bw_cpu3_device_quanta_byte_result *tags)
{
  if (!data || !tags || !bw_mapped_span_ok(raw,effective,length)) return 0;
  for (uint32_t i=0;i<length;++i) tags[i].kind=bw_map_kind(effective+i);
  for (uint32_t i=0;i<length;++i) {
    const uint32_t address=effective+i;
    switch (tags[i].kind) {
      case BW_CPU3_DEVICE_QUANTA_RAM:
        data[i]=bw_ram[address]; tags[i].effect=BW_CPU3_DEVICE_QUANTA_RAM_READ; break;
      case BW_CPU3_DEVICE_QUANTA_ROM:
        data[i]=bw_owned_rom[address-0xf0000];
        tags[i].effect=BW_CPU3_DEVICE_QUANTA_ROM_READ; break;
      case BW_CPU3_DEVICE_QUANTA_MMIO:
        data[i]=bw_mmio_register; ++bw_mmio_reads;
        tags[i].effect=BW_CPU3_DEVICE_QUANTA_MMIO_READ; break;
      case BW_CPU3_DEVICE_QUANTA_UNMAPPED:
        data[i]=0xff; ++bw_unmapped_reads;
        tags[i].effect=BW_CPU3_DEVICE_QUANTA_OPEN_BUS; break;
      default: return 0;
    }
  }
  return 1;
}

static int bw_host_write(void *, uint32_t raw, uint32_t effective,
                         const uint8_t *data, uint32_t length,
                         bw_cpu3_device_quanta_byte_result *tags)
{
  if (!data || !tags || !bw_mapped_span_ok(raw,effective,length)) return 0;
  for (uint32_t i=0;i<length;++i) tags[i].kind=bw_map_kind(effective+i);
  for (uint32_t i=0;i<length;++i) {
    const uint32_t address=effective+i;
    switch (tags[i].kind) {
      case BW_CPU3_DEVICE_QUANTA_RAM:
        bw_ram[address]=data[i];
        // The host owns RAM; Bochs still needs this stamp for decoded code.
        pageWriteStampTable.decWriteStamp(address,1);
        tags[i].effect=BW_CPU3_DEVICE_QUANTA_RAM_COMMIT; break;
      case BW_CPU3_DEVICE_QUANTA_ROM:
        ++bw_rom_ignored_writes;
        tags[i].effect=BW_CPU3_DEVICE_QUANTA_ROM_IGNORED; break;
      case BW_CPU3_DEVICE_QUANTA_MMIO:
        bw_mmio_register=data[i]; ++bw_mmio_writes;
        tags[i].effect=BW_CPU3_DEVICE_QUANTA_MMIO_WRITE; break;
      case BW_CPU3_DEVICE_QUANTA_UNMAPPED:
        ++bw_unmapped_ignored_writes;
        tags[i].effect=BW_CPU3_DEVICE_QUANTA_UNMAPPED_IGNORED; break;
      default: return 0;
    }
  }
  return 1;
}

static const uint8_t *bw_host_execute(void *, uint32_t raw_page,
                                      uint32_t effective_page, uint8_t *kind)
{
  if (!kind || (raw_page & 4095) || (effective_page & 4095) ||
      effective_page > sizeof(bw_ram)-4096 ||
      A20ADDR(raw_page)!=effective_page ||
      A20ADDR((bx_phy_address)raw_page+4095)!=
        (bx_phy_address)effective_page+4095) return 0;
  for (uint32_t i=0;i<4096;++i)
    if (bw_map_kind(effective_page+i)!=BW_CPU3_DEVICE_QUANTA_RAM) return 0;
  *kind=BW_CPU3_DEVICE_QUANTA_RAM;
  return bw_ram + effective_page;
}

static int bw_host_in(void *, uint16_t port, uint32_t width, uint32_t *value)
{
  if (!value || width!=1) return 0;
  if (port==0x92) *value=bw_port92_latch;
  else if (port==0x20 || port==0x21 || port==0x40 || port==0x43)
    *value=bw_rpc_request("PIO_IN",port,width,0);
  else return 0;
  if (*value>0xff) return 0;
  fprintf(stderr,"BWS8\tPORT\tin\t%04x\t%u\t%08x\t%" PRIu64
    "\t%" PRIu64 "\n",port,width,*value,bw_ticks,++bw_ordinal);
  return 1;
}

static int bw_host_out(void *, uint16_t port, uint32_t width, uint32_t value)
{
  if (width != 1 || value>0xff) return 0;
  if (port==0x92) {
    // This fixture fixes the 8042 A20 source low. Reject reset/unknown bits.
    if (value & ~2U) return 0;
    const unsigned old=bx_pc_system.get_enable_a20() ? 1 : 0;
    bw_port92_latch=(uint8_t)value;
    const unsigned next=(value & 2) ? 1 : 0;
    if (old!=next) bx_pc_system.set_enable_a20(next!=0);
    fprintf(stderr,"BWS8\tA20\t%u\t%u\t%02x\t%" PRIu64
      "\t%" PRIu64 "\n",old,next,value,bw_ticks,++bw_ordinal);
  } else if (port==0x20 || port==0x21 || port==0x40 || port==0x43 ||
             port==0xe9) {
    if (port==0xe9) {
      static const char marker[]="BQNT001";
      if (bw_port_bytes_seen>=7 || value!=(unsigned char)marker[bw_port_bytes_seen])
        return 0;
    }
    if (bw_rpc_request("PIO_OUT",port,width,value)) return 0;
    if (port==0xe9) ++bw_port_bytes_seen;
  } else return 0;
  fprintf(stderr,"BWS8\tPORT\tout\t%04x\t%u\t%08x\t%" PRIu64
    "\t%" PRIu64 "\n",port,width,value,bw_ticks,++bw_ordinal);
  return 1;
}

static int bw_host_tick(void *, uint32_t count)
{
  if (!bw_reentry_probed) {
    bw_cpu3_device_quanta_slice_result rejected;
    if (bw_cpu3_device_quanta_resume(1,1,UINT64_MAX,&bw_callbacks,&rejected) ||
        rejected.reason || rejected.charged_native_ticks || rejected.charged_quanta)
      bw_slice_fail("callback-reentry-accepted");
    bw_reentry_probed=true;
    fprintf(stderr,"BWS8\tPROBE\tcallback-reentry\trejected\n");
    if (bw_cpu3_device_quanta_set_irq_line(1) || bw_host_irq_line)
      bw_slice_fail("line-reentry-accepted");
    fprintf(stderr,"BWS8\tPROBE\tline-reentry\trejected\n");
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

static int bw_host_ack_irq(void *, uint8_t *vector)
{
  if (!vector || !bw_host_irq_line) return 0;
  const unsigned supplied=bw_rpc_request("ACK",0,0,0);
  if (supplied>0xff) return 0;
  *vector=(uint8_t)supplied;
  return 1;
}

extern "C" int bw_cpu3_device_quanta_set_irq_line(int asserted)
{
  if (!bw_slice_active || bw_in_resume || (asserted!=0 && asserted!=1))
    return 0;
  bw_host_irq_line=asserted!=0;
  if (bw_host_irq_line) BX_CPU(0)->raise_INTR();
  else BX_CPU(0)->clear_INTR();
  fprintf(stderr,"BWS8\tIRQ_LINE\t%u\t%" PRIu64 "\t%" PRIu64 "\n",
    asserted,bw_ticks,++bw_ordinal);
  return 1;
}

unsigned bw_slice_ack_irq(void)
{
  uint8_t vector=0;
  if (!bw_host_irq_line || bw_faults!=2 || bw_rep_iterations!=1029 ||
      bw_ram[0x0530]!=1 || bw_ram[0x0534]!=0 ||
      BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value!=8 ||
      BX_CPU(0)->get_eip()!=0x7ff9 || !bw_callbacks.ack_irq ||
      !bw_callbacks.ack_irq(bw_callbacks.context,&vector))
    bw_slice_fail("host-irq-ack");
  if (vector!=0x20) bw_slice_fail("host-irq-vector");
  bw_last_irq_vector=vector;
  bw_irq_entry_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
  bw_irq_entry_eip=BX_CPU(0)->get_eip();
  bw_irq_ack_ticks=bw_ticks;
  bw_irq_ack_quanta=bw_successful_quanta;
  fprintf(stderr,"BWS8\tIRQ_ACK\t%02x\t%04x\t%08x\t%" PRIu64
    "\t%" PRIu64 "\n",vector,
    bw_irq_entry_cs,bw_irq_entry_eip,bw_irq_ack_ticks,++bw_ordinal);
  return vector;
}

void bw_slice_note_irq(unsigned vector)
{
  if (!bw_host_irq_line || vector!=bw_last_irq_vector ||
      bw_irq_deliveries!=0 || bw_faults!=2 ||
      bw_ticks!=bw_irq_ack_ticks ||
      bw_successful_quanta!=bw_irq_ack_quanta)
    bw_slice_fail("host-irq-delivery");
  const unsigned sp=BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx & 0xffff;
  if (sp!=0x8ff4 || BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value!=8 ||
      BX_CPU(0)->get_eip()!=0x809f || bw_read_le32(sp)!=0x7ff9 ||
      (bw_read_le32(sp+4)&0xffff)!=8 ||
      (bw_read_le32(sp+8)&0x00037fd7)!=0x246)
    bw_slice_fail("owned-irq-frame");
  ++bw_irq_deliveries;
  bw_slice_irq_pending=true;
  fprintf(stderr,"BWS8\tIRQ_DELIVERED\t%02x\t%04x\t%08x\t%04x"
    "\t%08x\t%04x\t%08x\t%08x\t%08x\t%" PRIu64 "\t%" PRIu64
    "\n",
    vector,bw_irq_entry_cs,bw_irq_entry_eip,
    BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,
    BX_CPU(0)->get_eip(),sp,bw_read_le32(sp),bw_read_le32(sp+4),
    bw_read_le32(sp+8),bw_ticks,++bw_ordinal);
}

void bw_slice_read(unsigned long long address, unsigned length, void *data)
{
  const uint32_t effective=(uint32_t)A20ADDR(address);
  bw_cpu3_device_quanta_byte_result tags[16];
  if (!bw_slice_active || !bw_callbacks.read_physical ||
      !bw_raw_span_ok(address, length) ||
      !bw_callbacks.read_physical(bw_callbacks.context, (uint32_t)address,
                                  effective,(uint8_t *)data,length,tags))
    bw_slice_fail("host-physical-read");
  ++bw_physical_reads;
  for (unsigned i=0;i<length;++i)
    if (tags[i].kind!=bw_map_kind(effective+i) ||
        tags[i].effect!=bw_expected_effect(tags[i].kind,false))
      bw_slice_fail("host-read-classification");
  if (bw_pagewalk_kind==1 && address==0x110000 && effective==0x10000 &&
      length==4) ++bw_aliased_pde_reads;
  if (bw_pagewalk_kind==2 && address==0x111014 && effective==0x11014 &&
      length==4) ++bw_aliased_pte5_reads;
  for (unsigned i=0;i<length;++i)
    fprintf(stderr,"BWS8\tMEM\tR\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\n",
      (unsigned)address+i,effective+i,bw_kind_name(tags[i].kind),
      ((const uint8_t *)data)[i],bw_effect_name(tags[i].effect),bw_ticks,
      ++bw_ordinal,bw_pagewalk_name());
}

void bw_slice_write(unsigned long long address, unsigned length,
                    const void *data)
{
  const uint32_t effective=(uint32_t)A20ADDR(address);
  bw_cpu3_device_quanta_byte_result tags[16];
  if (!bw_slice_active || !bw_callbacks.write_physical ||
      !bw_raw_span_ok(address, length) ||
      !bw_callbacks.write_physical(bw_callbacks.context, (uint32_t)address,
                                   effective,(const uint8_t *)data,length,tags))
    bw_slice_fail("host-physical-write");
  ++bw_physical_writes;
  for (unsigned i=0;i<length;++i)
    if (tags[i].kind!=bw_map_kind(effective+i) ||
        tags[i].effect!=bw_expected_effect(tags[i].kind,true))
      bw_slice_fail("host-write-classification");
  if (bw_pagewalk_kind==3 && address==0x110000 && effective==0x10000 &&
      length==4) ++bw_aliased_pde_ad_writes;
  if (bw_pagewalk_kind==4 && address==0x111014 && effective==0x11014 &&
      length==4) ++bw_aliased_pte5_ad_writes;
  for (unsigned i=0;i<length;++i)
    fprintf(stderr,"BWS8\tMEM\tW\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\n",
      (unsigned)address+i,effective+i,bw_kind_name(tags[i].kind),
      ((const uint8_t *)data)[i],bw_effect_name(tags[i].effect),bw_ticks,
      ++bw_ordinal,bw_pagewalk_name());
}

const unsigned char *bw_slice_execute_page(unsigned long long address)
{
  const uint32_t effective=(uint32_t)A20ADDR(address);
  uint8_t kind=0;
  if (!bw_slice_active || !bw_callbacks.execute_page ||
      address > UINT32_MAX || (address & 4095))
    bw_slice_fail("unsafe-execute-page");
  const uint8_t *page = bw_callbacks.execute_page(bw_callbacks.context,
                                                  (uint32_t)address,effective,
                                                  &kind);
  if (!page || kind!=BW_CPU3_DEVICE_QUANTA_RAM)
    bw_slice_fail("unsafe-execute-page");
  ++bw_execute_pages;
  fprintf(stderr,"BWS8\tEXEC\t%08x\t%08x\tram\t%" PRIu64 "\t%" PRIu64 "\n",
    (unsigned)address,effective,bw_ticks,++bw_ordinal);
  return page;
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
  fprintf(stderr,"BWS8\tNATIVE_TICK\t%u\t%" PRIu64 "\t%" PRIu64
    "\t%" PRIu64 "\t%" PRIu64 "\n",
    count,before,bw_ticks,bw_successful_quanta,++bw_ordinal);
}

static void bw_slice_charge_quantum(uint32_t kind)
{
  if (!bw_slice_active || kind>1 || bw_slice_quanta>=bw_quantum_budget ||
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
  fprintf(stderr,"BWS8\tQUANTUM\t%u\t%04x\t%08x\t%08x\t%04x\t%08x\t%" PRIu64
    "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",kind,bw_attempt_cs,
    bw_attempt_eip,BX_CPU(0)->gen_reg[BX_32BIT_REG_ECX].dword.erx,
    BX_CPU(0)->gen_reg[BX_32BIT_REG_ECX].word.rx,
    BX_CPU(0)->gen_reg[BX_32BIT_REG_EDI].dword.erx,
    before,bw_successful_quanta,bw_ticks,++bw_ordinal);
}

void bw_slice_note_attempt(void)
{
  if (bw_slice_active) {
    bw_slice_rep_incomplete = false;
    bw_rep_success_this_attempt = 0;
    ++bw_attempts;
    bw_attempt_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
    bw_attempt_eip=BX_CPU(0)->get_eip();
    fprintf(stderr,"BWS8\tATTEMPT\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64
      "\t%" PRIu64 "\n",bw_attempt_cs,bw_attempt_eip,bw_ticks,
      bw_successful_quanta,++bw_ordinal);
  }
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
    fprintf(stderr,"BWS8\tHALT_IDLE\t%" PRIu64 "\t%04x\t%08x\t%u\t%u\t%08x\t%" PRIu64 "\n",
      bw_ticks,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,
      BX_CPU(0)->get_eip(),BX_CPU(0)->get_IF(),
      BX_CPU(0)->activity_state,BX_CPU(0)->pending_event,++bw_ordinal);
  }
}
void bw_slice_rep_pre_iteration(void)
{
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
  ++bw_rep_success_this_attempt;
  bw_slice_charge_quantum(1);
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
  if (bw_slice_port_pending) {
    ++bw_ports;
    bw_port_committed_this_slice = true;
  }
}
void bw_slice_note_fault(unsigned vector, unsigned error_code)
{
  if (!bw_slice_active) return;
  const uint16_t cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
  const uint32_t eip=(uint32_t)BX_CPU(0)->prev_rip;
  const uint32_t cr2=(uint32_t)BX_CPU(0)->cr2;
  if (vector!=14 || error_code!=2 || cs!=8 || !bw_host_irq_line ||
      !((bw_faults==0 && eip==0x7f0c && cr2==0x5000 &&
         bw_rep_iterations==1024) ||
        (bw_faults==1 && eip==0x7f84 && cr2==0x6000 &&
         bw_rep_iterations==1028)))
    bw_slice_fail("unexpected-fault");
  ++bw_faults;
  bw_fault_vector=vector;
  bw_fault_error=error_code;
  bw_fault_cr2=cr2;
  bw_faulting_cs=cs;
  bw_faulting_eip=eip;
  bw_fault_begin_tick=bw_ticks;
  bw_fault_begin_quanta=bw_successful_quanta;
  bw_fault_begin_ordinal=++bw_ordinal;
  bw_slice_fault_pending=true;
  fprintf(stderr,"BWS8\tFAULT_BEGIN\t%u\t%u\t%08x\t%04x\t%08x\t%" PRIu64
    "\t%" PRIu64 "\t%" PRIu64 "\n",vector,error_code,cr2,cs,eip,
    bw_fault_begin_tick,bw_fault_begin_quanta,bw_fault_begin_ordinal);
}

void bw_slice_note_fault_delivered(void)
{
  if (!bw_slice_active || !bw_slice_fault_pending ||
      bw_ticks!=bw_fault_begin_tick+1 ||
      bw_successful_quanta!=bw_fault_begin_quanta)
    bw_slice_fail("fault-delivery-clock");
  BX_CPU_C *cpu=BX_CPU(0);
  const uint32_t sp=cpu->gen_reg[BX_32BIT_REG_ESP].dword.erx & 0xffff;
  if (sp!=0x8ff0 || cpu->sregs[BX_SEG_REG_CS].selector.value!=8 ||
      cpu->get_eip()!=0x8026 || bw_read_le32(sp)!=2 ||
      bw_read_le32(sp+4)!=bw_faulting_eip ||
      (bw_read_le32(sp+8)&0xffff)!=8)
    bw_slice_fail("owned-fault-frame");
  fprintf(stderr,"BWS8\tFAULT_DELIVERED\t%" PRIu64 "\t%" PRIu64
    "\t%" PRIu64 "\t%" PRIu64 "\t%04x\t%08x\t%08x\t%08x\t%08x\t%08x"
    "\t%08x\t%" PRIu64 "\n",bw_fault_begin_ordinal,
    bw_fault_begin_tick,bw_ticks,bw_successful_quanta,
    cpu->sregs[BX_SEG_REG_CS].selector.value,cpu->get_eip(),sp,
    bw_read_le32(sp),bw_read_le32(sp+4),bw_read_le32(sp+8),
    bw_read_le32(sp+12),++bw_ordinal);
}

void bw_slice_activate(BX_CPU_C *cpu)
{
  if (bw_slice_active) bw_slice_fail("duplicate-activation");
  if (cpu->sregs[BX_SEG_REG_CS].selector.value != 0 ||
      cpu->get_eip() != 0x7e00) bw_slice_fail("activation-boundary");
  for (unsigned page = 0; page < sizeof(bw_ram); page += 4096)
    if (bw_map_kind(page)==BW_CPU3_DEVICE_QUANTA_RAM)
      memcpy(bw_ram + page, BX_MEM(0)->get_vector(page), 4096);
  bw_callbacks.context = 0;
  bw_callbacks.read_physical = bw_host_read;
  bw_callbacks.write_physical = bw_host_write;
  bw_callbacks.execute_page = bw_host_execute;
  bw_callbacks.port_in = bw_host_in;
  bw_callbacks.port_out = bw_host_out;
  bw_callbacks.native_tick = bw_host_tick;
  bw_callbacks.successful_quantum = bw_host_quantum;
  bw_callbacks.ack_irq = bw_host_ack_irq;
  if (bw_cpu3_device_quanta_set_irq_line(1))
    bw_slice_fail("irq-before-activation-accepted");
  fprintf(stderr,"BWS8\tPROBE\tirq-before-activation\trejected\n");
  bw_cpu3_device_quanta_slice_result before_activation;
  if (bw_cpu3_device_quanta_resume(1,1,UINT64_MAX,&bw_callbacks,&before_activation) ||
      before_activation.reason || before_activation.charged_native_ticks ||
      before_activation.charged_quanta)
    bw_slice_fail("resume-before-activation-accepted");
  fprintf(stderr,"BWS8\tPROBE\tresume-before-activation\trejected\n");
  bw_emit_state("SEEDSTATE",cpu);
  for (unsigned page = 0; page < sizeof(bw_ram)/4096; ++page) {
    if (bw_map_kind(page*4096)!=BW_CPU3_DEVICE_QUANTA_RAM) continue;
    fprintf(stderr,"BWS8\tSEEDPAGE\t%u\t",page);
    for (unsigned j = 0; j < 4096; ++j)
      fprintf(stderr,"%02x",bw_ram[page*4096+j]);
    fputc('\n',stderr);
  }
  const unsigned inherited_pending=cpu->pending_event;
  const unsigned inherited_mask=cpu->event_mask;
  const unsigned inherited_if=cpu->get_IF();
  // Explicit post-BIOS ownership transfer. The bootstrap PIC may retain a
  // pending edge; the host takes over this one line at the activation cut.
  if (inherited_pending & BX_EVENT_PENDING_INTR) cpu->clear_INTR();
  fprintf(stderr,"BWS8\tIRQ_HANDOFF\t%08x\t%08x\t%u\t%08x\n",
    inherited_pending,inherited_mask,inherited_if,cpu->pending_event);
  const unsigned inherited_a20=bx_pc_system.get_enable_a20() ? 1 : 0;
  bw_port92_latch=inherited_a20 ? 2 : 0; // 8042 source is fixed low in this fixture.
  fprintf(stderr,"BWS8\tA20_HANDOFF\t%u\t%02x\t8042-low\n",
    inherited_a20,bw_port92_latch);
  fprintf(stderr,"BWS8\tROM_ID\t%s\t65536\n",bw_owned_rom_sha256);
  fprintf(stderr,"BWS8\tMAP_ID\tram00000-9ffff,mmio-a0000,rom-f0000-fffff,ram-100000-17ffff,openbus-rest\n");
  bw_slice_active = true;
  cpu->TLB_flush(); // Also invalidates the prefetch queue.
  cpu->iCache.flushICacheEntries();
  // Exactly 160 low + 128 extended RAM pages were copied. The 0x180000
  // backing capacity also contains holes and is not a copied-byte count.
  fprintf(stderr, "BWS8\tACTIVATE\t0000\t00007e00\t1179648\t%u\n",
    inherited_a20);
}

static void bw_fill_result(bw_cpu3_device_quanta_slice_result *result, unsigned reason)
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

extern "C" int bw_cpu3_device_quanta_resume(uint32_t max_native_ticks,
  uint32_t max_successful_quanta, uint64_t native_deadline,
  const bw_cpu3_device_quanta_host_callbacks *callbacks, bw_cpu3_device_quanta_slice_result *result)
{
  if (result) memset(result, 0, sizeof(*result));
  if (!result || !bw_slice_active || bw_in_resume || !max_native_ticks ||
      !max_successful_quanta || !callbacks ||
      !callbacks->read_physical || !callbacks->write_physical ||
      !callbacks->execute_page || !callbacks->port_in ||
      !callbacks->port_out || !callbacks->native_tick ||
      !callbacks->successful_quantum || !callbacks->ack_irq ||
      native_deadline < bw_ticks) return 0;
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
  const unsigned reason = bw_slice_fault_pending ? BW_CPU3_DEVICE_QUANTA_SLICE_FAULT :
    bw_slice_irq_pending ? BW_CPU3_DEVICE_QUANTA_SLICE_IRQ_DELIVERED :
    bw_halted ? BW_CPU3_DEVICE_QUANTA_SLICE_HALT :
    bw_slice_port_pending ? BW_CPU3_DEVICE_QUANTA_SLICE_PORT :
    bw_deadline_due ? BW_CPU3_DEVICE_QUANTA_SLICE_EVENT_DUE : BW_CPU3_DEVICE_QUANTA_SLICE_BUDGET;
  bw_fill_result(result, reason);
  bw_slice_port_pending = false;
  return 1;
}

void bw_slice_driver(void)
{
  const char *probe=getenv("BW_CPU3_DEVICE_QUANTA_PROBE");
  if (probe) {
    unsigned char byte=0;
    if (!strcmp(probe,"out-of-range-physical")) bw_slice_read(0x200000,1,&byte);
    else if (!strcmp(probe,"unsupported-span-width")) bw_slice_read(0,17,&byte);
    else if (!strcmp(probe,"unexpected-pio")) bw_slice_port_out(0x80,0,1);
    else if (!strcmp(probe,"unsafe-execute-rom")) bw_slice_execute_page(0xf0000);
    else if (!strcmp(probe,"unsafe-execute-mmio")) bw_slice_execute_page(0xa0000);
    else if (!strcmp(probe,"unsafe-execute-unmapped")) bw_slice_execute_page(0xd0000);
    else if (!strcmp(probe,"bochs-ram-read")) BX_MEM(0)->readPhysicalPage(BX_CPU(0),0,1,&byte);
    else if (!strcmp(probe,"bochs-ram-write")) BX_MEM(0)->writePhysicalPage(BX_CPU(0),0,1,&byte);
    else if (!strcmp(probe,"bochs-direct-pointer")) BX_MEM(0)->getHostMemAddr(BX_CPU(0),0,BX_READ);
    else if (!strcmp(probe,"bochs-pio")) bx_devices.outp(0x80,0,1);
    else if (!strcmp(probe,"bochs-timer")) bx_pc_system.bw_probe_countdown_fallback();
    else bw_slice_fail("unknown-probe");
    bw_slice_fail("probe-was-not-rejected");
  }

  bw_cpu3_device_quanta_slice_result invalid;
  if (bw_cpu3_device_quanta_resume(0,1,UINT64_MAX,&bw_callbacks,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("zero-native-budget-accepted");
  fprintf(stderr,"BWS8\tPROBE\tzero-native-budget\trejected\n");
  if (bw_cpu3_device_quanta_resume(1,0,UINT64_MAX,&bw_callbacks,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("zero-quantum-budget-accepted");
  fprintf(stderr,"BWS8\tPROBE\tzero-quantum-budget\trejected\n");
  if (bw_cpu3_device_quanta_resume(1,1,UINT64_MAX,0,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("null-callbacks-accepted");
  fprintf(stderr,"BWS8\tPROBE\tnull-callbacks\trejected\n");
  bw_cpu3_device_quanta_host_callbacks incomplete=bw_callbacks;
  incomplete.native_tick=0;
  if (bw_cpu3_device_quanta_resume(1,1,UINT64_MAX,&incomplete,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("incomplete-callbacks-accepted");
  fprintf(stderr,"BWS8\tPROBE\tincomplete-native-tick\trejected\n");
  incomplete=bw_callbacks;
  incomplete.successful_quantum=0;
  if (bw_cpu3_device_quanta_resume(1,1,UINT64_MAX,&incomplete,&invalid) ||
      invalid.reason || invalid.charged_native_ticks || invalid.charged_quanta)
    bw_slice_fail("incomplete-callbacks-accepted");
  fprintf(stderr,"BWS8\tPROBE\tincomplete-quantum\trejected\n");
  if (!bw_cpu3_device_quanta_resume(1,1,bw_ticks,&bw_callbacks,&invalid) ||
      invalid.reason!=BW_CPU3_DEVICE_QUANTA_SLICE_EVENT_DUE ||
      invalid.charged_native_ticks || invalid.charged_quanta ||
      invalid.effective_native_ticks || !invalid.event_due)
    bw_slice_fail("due-now-contract");
  fprintf(stderr,"BWS8\tPROBE\tdue-now\tzero-work\n");
  if (bw_cpu3_device_quanta_set_irq_line(2))
    bw_slice_fail("invalid-irq-line-accepted");
  fprintf(stderr,"BWS8\tPROBE\tinvalid-irq-line\trejected\n");

  bw_rpc_open();
  fprintf(bw_rpc_output,"BWR8\tREADY\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",
    BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,
    BX_CPU(0)->get_eip(),bw_ticks,bw_successful_quanta);
  if (fflush(bw_rpc_output)) bw_slice_fail("rpc-ready");
  fprintf(stderr,"BWS8\tREADY\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",
    BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,
    BX_CPU(0)->get_eip(),bw_ticks,bw_successful_quanta);
  uint64_t last_command=0;
  bool active_edge_cut=false;
  bool first_line_asserted=false;
  bool irq_delivery_cut=false;
  bool zero_terminal_halt=false;
  bool stale_deadline_probed=false;
  unsigned fault_cuts=0;
  for (unsigned command_count=0;command_count<100000;++command_count) {
    char line[256];
    bw_rpc_line(line,sizeof(line));
    char *fields[7];
    if (bw_split_tabs(line,fields,7)!=7 || strcmp(fields[0],"BWR8") ||
        strcmp(fields[1],"CMD")) bw_slice_fail("rpc-command");
    const uint64_t sequence=bw_decimal(fields[2]);
    const char *verb=fields[3];
    const uint64_t arg0=bw_decimal(fields[4]);
    const uint64_t arg1=bw_decimal(fields[5]);
    const uint64_t deadline=bw_decimal(fields[6]);
    if (sequence!=last_command+1) bw_slice_fail("rpc-command-sequence");
    last_command=sequence;
    fprintf(stderr,"BWS8\tCMD\t%" PRIu64 "\t%s\t%" PRIu64 "\t%" PRIu64
      "\t%" PRIu64 "\t%" PRIu64 "\n",last_command,verb,arg0,arg1,
      deadline,++bw_ordinal);
    if (!strcmp(verb,"LINE")) {
      if (arg0>1 || arg1 || deadline ||
          (arg0==1 && (!active_edge_cut || first_line_asserted || bw_faults)) ||
          (arg0==0 && (!irq_delivery_cut || !bw_host_irq_line)) ||
          !bw_cpu3_device_quanta_set_irq_line((int)arg0))
        bw_slice_fail("rpc-line-command");
      if (arg0==1) first_line_asserted=true;
      fprintf(bw_rpc_output,"BWR8\tDONE\t%" PRIu64 "\tLINE\t%u\t%" PRIu64
        "\t%" PRIu64 "\n",last_command,(unsigned)arg0,bw_ticks,
        bw_successful_quanta);
    } else if (!strcmp(verb,"RUN")) {
      if (!arg0 || arg0>UINT32_MAX || !arg1 || arg1>UINT32_MAX ||
          deadline!=UINT64_MAX) bw_slice_fail("rpc-run-budget");
      const unsigned entry_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
      const unsigned entry_eip=BX_CPU(0)->get_eip();
      const unsigned entry_if=BX_CPU(0)->get_IF();
      const unsigned entry_activity=BX_CPU(0)->activity_state;
      const unsigned entry_pending=BX_CPU(0)->pending_event;
      const uint64_t before_ticks=bw_ticks;
      const uint64_t before_quanta=bw_successful_quanta;
      bw_cpu3_device_quanta_slice_result result;
      if (!bw_cpu3_device_quanta_resume((uint32_t)arg0,(uint32_t)arg1,
          deadline,&bw_callbacks,&result)) bw_slice_fail("rpc-run-resume");
      if (bw_ticks!=result.total_native_ticks ||
          bw_successful_quanta!=result.total_successful_quanta ||
          result.charged_native_ticks!=bw_ticks-before_ticks ||
          result.charged_quanta!=bw_successful_quanta-before_quanta ||
          result.charged_native_ticks>result.effective_native_ticks ||
          result.charged_quanta>result.requested_quanta ||
          bw_ticks!=bw_successful_quanta+bw_faults)
        bw_slice_fail("separate-clock-ledger");
      fprintf(stderr,"BWS8\tSLICE\t%" PRIu64 "\t%u\t%u\t%u\t%u\t%u\t%u",
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
      fprintf(bw_rpc_output,"BWR8\tDONE\t%" PRIu64 "\tRUN\t%u\t%u\t%u"
        "\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%u\t%u\t%u\n",
        last_command,result.reason,result.charged_native_ticks,
        result.charged_quanta,result.cs,result.eip,bw_ticks,bw_successful_quanta,
        result.attempts,result.completed,result.rep_iterations,result.faults,
        result.if_flag,result.activity_state,result.irq_delivered);
      if (result.reason==BW_CPU3_DEVICE_QUANTA_SLICE_EVENT_DUE) {
        if (active_edge_cut || bw_faults || bw_rep_iterations==0 ||
            bw_rep_iterations>=1024 || result.cs!=8 || result.eip!=0x7f0c ||
            result.if_flag || result.charged_quanta==0 ||
            result.charged_native_ticks==0)
          bw_slice_fail("active-pit-cut-contract");
        active_edge_cut=true;
      } else if (result.reason==BW_CPU3_DEVICE_QUANTA_SLICE_FAULT) {
        ++fault_cuts;
        if (!active_edge_cut || !first_line_asserted || !result.pending_fault ||
            !result.pending_irq || fault_cuts>2 ||
            result.fault_vector!=14 || result.fault_error!=2 ||
            result.fault_cr2!=(fault_cuts==1?0x5000:0x6000) ||
            result.cs!=8 || result.eip!=0x8026 ||
            result.charged_native_ticks==0)
          bw_slice_fail("owned-fault-cut-contract");
      } else if (result.reason==BW_CPU3_DEVICE_QUANTA_SLICE_IRQ_DELIVERED) {
        if (fault_cuts!=2 || irq_delivery_cut || !result.irq_delivered ||
            result.cs!=8 || result.eip!=0x809f)
          bw_slice_fail("owned-irq-cut-contract");
        irq_delivery_cut=true;
      } else if (result.reason==BW_CPU3_DEVICE_QUANTA_SLICE_HALT) {
        if (!irq_delivery_cut || result.cs!=8 || result.eip!=0x801e ||
            result.if_flag || result.pending_irq)
          bw_slice_fail("terminal-halt-contract");
        if (!result.charged_native_ticks && !result.charged_quanta)
          zero_terminal_halt=true;
      } else if (result.reason!=BW_CPU3_DEVICE_QUANTA_SLICE_BUDGET &&
                 result.reason!=BW_CPU3_DEVICE_QUANTA_SLICE_PORT)
        bw_slice_fail("unexpected-slice-reason");
      if (!stale_deadline_probed && bw_ticks>0) {
        bw_cpu3_device_quanta_slice_result rejected;
        if (bw_cpu3_device_quanta_resume(1,1,bw_ticks-1,&bw_callbacks,&rejected) ||
            rejected.reason || rejected.charged_native_ticks ||
            rejected.charged_quanta)
          bw_slice_fail("stale-deadline-accepted");
        fprintf(stderr,"BWS8\tPROBE\tstale-deadline\trejected\n");
        stale_deadline_probed=true;
      }
    } else if (!strcmp(verb,"STOP")) {
      if (arg0 || arg1 || deadline || !active_edge_cut ||
          !first_line_asserted || !irq_delivery_cut || !zero_terminal_halt ||
          fault_cuts!=2 || bw_faults!=2 || bw_rep_iterations!=1029 ||
          bw_port_bytes_seen!=7 || bw_host_irq_line ||
          bw_ticks!=bw_successful_quanta+2 ||
          bw_rpc_request_count!=bw_rpc_reply_count ||
          BX_CPU(0)->get_IF() ||
          BX_CPU(0)->activity_state!=BX_CPU_C::BX_ACTIVITY_STATE_HLT ||
          BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value!=8 ||
          BX_CPU(0)->get_eip()!=0x801e)
        bw_slice_fail("rpc-stop-contract");
      const uint32_t pde0=bw_read_le32(0x9000);
      const uint32_t pte5=bw_read_le32(0xa014);
      const uint32_t pte6=bw_read_le32(0xa018);
      const uint32_t copiedEip=bw_read_le32(0x0540);
      const uint32_t copiedCs=bw_read_le32(0x0544);
      const uint32_t copiedFlags=bw_read_le32(0x0548);
      const uint32_t stackEip=bw_read_le32(0x8ff4);
      const uint32_t stackCs=bw_read_le32(0x8ff8);
      const uint32_t stackFlags=bw_read_le32(0x8ffc);
      if (pde0!=0x0000a023 || pte5!=0x00005063 || pte6!=0x00006063 ||
          bw_read_le32(0x4000)!=0x11223344 ||
          bw_read_le32(0x4ffc)!=0x11223344 ||
          bw_read_le32(0x5000)!=0x11223344 ||
          bw_read_le32(0x500c)!=0x11223344 ||
          bw_read_le32(0x6000)!=0x55667788 ||
          bw_read_le32(0x6004)!=0x99aabbcc ||
          bw_read_le32(0x0520)!=0x5000 || bw_read_le32(0x0528)!=0x6000 ||
          bw_ram[0x0524]!=2 || bw_ram[0x0530]!=1 || bw_ram[0x0534]!=1 ||
          copiedEip!=0x7ff9 || stackEip!=copiedEip ||
          (copiedCs&0xffff)!=8 || stackCs!=copiedCs ||
          (copiedFlags&0x00037fd7)!=0x246 || stackFlags!=copiedFlags)
        bw_slice_fail("final-quantum-ram-contract");
      fprintf(stderr,"BWS8\tRAM_FINAL\t%08x\t%08x\t%08x\t%08x\t%08x"
        "\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%02x\t%02x\t%02x"
        "\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%u\n",
        pde0,pte5,pte6,bw_read_le32(0x4000),bw_read_le32(0x4ffc),
        bw_read_le32(0x5000),bw_read_le32(0x500c),bw_read_le32(0x6000),
        bw_read_le32(0x6004),bw_read_le32(0x0520),bw_read_le32(0x0528),
        (unsigned)bw_ram[0x0524],(unsigned)bw_ram[0x0530],
        (unsigned)bw_ram[0x0534],copiedEip,copiedCs,copiedFlags,
        stackEip,stackCs,stackFlags,bw_port_bytes_seen);
      bw_emit_state("STATE",BX_CPU(0));
      fprintf(stderr,"BWS8\tFINAL\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",bw_ticks,bw_successful_quanta,
        bw_attempts,bw_completed,bw_rep_iterations,bw_rep_partial,bw_faults,
        bw_ports,bw_irq_deliveries,bw_halt_idle_cuts,bw_rpc_request_count,
        bw_rpc_reply_count,bw_tick_callbacks,bw_quantum_callbacks);
      fprintf(stderr,"BWS8\tCALLBACKS\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",
        bw_physical_reads,bw_physical_writes,bw_execute_pages,
        bw_tick_callbacks,bw_quantum_callbacks);
      fprintf(stderr,"BWS8\tFALLBACK\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",
        bw_fallback_ram_reads,bw_fallback_ram_writes,
        bw_fallback_direct_pointers,bw_fallback_pio,bw_fallback_timer);
      fprintf(bw_rpc_output,"BWR8\tDONE\t%" PRIu64 "\tSTOP\t0\t%" PRIu64
        "\t%" PRIu64 "\n",last_command,bw_ticks,bw_successful_quanta);
      if (fflush(bw_rpc_output)) bw_slice_fail("rpc-stop-send");
      bw_slice_active=false;
      fprintf(stderr,"BWS8\tDEACTIVATE\tproof-complete\n");
      return;
    } else bw_slice_fail("rpc-unknown-command");
    if (fflush(bw_rpc_output)) bw_slice_fail("rpc-command-send");
  }
  bw_slice_fail("rpc-command-limit");
}
