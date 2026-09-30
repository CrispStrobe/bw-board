/* Included once at the end of cpu.cc in the separately prepared CPU3 tree. */
#include "iodev/iodev.h"
#include <inttypes.h>
#include <limits.h>
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
static bw_cpu3_memory_map_host_callbacks bw_callbacks;
static uint32_t bw_budget;
static uint32_t bw_requested_budget;
static uint64_t bw_deadline;
static bool bw_deadline_due;
static uint32_t bw_slice_ticks;
static uint64_t bw_ticks;
static uint64_t bw_attempts;
static uint64_t bw_completed;
static uint64_t bw_rep_iterations;
static uint64_t bw_rep_partial;
static uint64_t bw_faults;
static uint64_t bw_ports;
static uint64_t bw_ordinal;
static bool bw_port_committed_this_slice;
static bool bw_halted;
static bool bw_host_irq_line;
static bool bw_in_resume;
static bool bw_reentry_probed;
static uint8_t bw_host_irq_vector;
static uint64_t bw_irq_deliveries;
static uint64_t bw_halt_idle_cuts;
static uint64_t bw_physical_reads;
static uint64_t bw_physical_writes;
static uint64_t bw_execute_pages;
static uint64_t bw_tick_callbacks;
static uint64_t bw_fallback_ram_reads;
static uint64_t bw_fallback_ram_writes;
static uint64_t bw_fallback_direct_pointers;
static uint64_t bw_fallback_pio;
static uint64_t bw_fallback_timer;
static unsigned bw_port_bytes_seen;

static void bw_emit_state(const char *tag, BX_CPU_C *cpu)
{
  fprintf(stderr,"BWS6\t%s\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x"
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
  fprintf(stderr, "BWS6\tFAIL\t%s\n", kind);
  fflush(stderr);
  abort();
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
    return BW_CPU3_MEMORY_MAP_RAM;
  if (address == 0xa0000) return BW_CPU3_MEMORY_MAP_MMIO;
  if (address >= 0xf0000 && address <= 0xfffff)
    return BW_CPU3_MEMORY_MAP_ROM;
  return BW_CPU3_MEMORY_MAP_UNMAPPED;
}

static const char *bw_kind_name(uint8_t kind)
{
  switch (kind) {
    case BW_CPU3_MEMORY_MAP_RAM: return "ram";
    case BW_CPU3_MEMORY_MAP_ROM: return "rom";
    case BW_CPU3_MEMORY_MAP_MMIO: return "mmio";
    case BW_CPU3_MEMORY_MAP_UNMAPPED: return "unmapped";
  }
  bw_slice_fail("host-map-kind");
  return "invalid";
}

static const char *bw_effect_name(uint8_t effect)
{
  switch (effect) {
    case BW_CPU3_MEMORY_MAP_RAM_READ: return "ram-read";
    case BW_CPU3_MEMORY_MAP_RAM_COMMIT: return "ram-commit";
    case BW_CPU3_MEMORY_MAP_ROM_READ: return "rom-read";
    case BW_CPU3_MEMORY_MAP_ROM_IGNORED: return "rom-ignored";
    case BW_CPU3_MEMORY_MAP_MMIO_READ: return "mmio-read";
    case BW_CPU3_MEMORY_MAP_MMIO_WRITE: return "mmio-write";
    case BW_CPU3_MEMORY_MAP_OPEN_BUS: return "open-bus";
    case BW_CPU3_MEMORY_MAP_UNMAPPED_IGNORED: return "unmapped-ignored";
  }
  bw_slice_fail("host-map-effect");
  return "invalid";
}

static uint8_t bw_expected_effect(uint8_t kind, bool write)
{
  switch (kind) {
    case BW_CPU3_MEMORY_MAP_RAM:
      return write ? BW_CPU3_MEMORY_MAP_RAM_COMMIT : BW_CPU3_MEMORY_MAP_RAM_READ;
    case BW_CPU3_MEMORY_MAP_ROM:
      return write ? BW_CPU3_MEMORY_MAP_ROM_IGNORED : BW_CPU3_MEMORY_MAP_ROM_READ;
    case BW_CPU3_MEMORY_MAP_MMIO:
      return write ? BW_CPU3_MEMORY_MAP_MMIO_WRITE : BW_CPU3_MEMORY_MAP_MMIO_READ;
    case BW_CPU3_MEMORY_MAP_UNMAPPED:
      return write ? BW_CPU3_MEMORY_MAP_UNMAPPED_IGNORED : BW_CPU3_MEMORY_MAP_OPEN_BUS;
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
                        bw_cpu3_memory_map_byte_result *tags)
{
  if (!data || !tags || !bw_mapped_span_ok(raw,effective,length)) return 0;
  for (uint32_t i=0;i<length;++i) tags[i].kind=bw_map_kind(effective+i);
  for (uint32_t i=0;i<length;++i) {
    const uint32_t address=effective+i;
    switch (tags[i].kind) {
      case BW_CPU3_MEMORY_MAP_RAM:
        data[i]=bw_ram[address]; tags[i].effect=BW_CPU3_MEMORY_MAP_RAM_READ; break;
      case BW_CPU3_MEMORY_MAP_ROM:
        data[i]=bw_owned_rom[address-0xf0000];
        tags[i].effect=BW_CPU3_MEMORY_MAP_ROM_READ; break;
      case BW_CPU3_MEMORY_MAP_MMIO:
        data[i]=bw_mmio_register; ++bw_mmio_reads;
        tags[i].effect=BW_CPU3_MEMORY_MAP_MMIO_READ; break;
      case BW_CPU3_MEMORY_MAP_UNMAPPED:
        data[i]=0xff; ++bw_unmapped_reads;
        tags[i].effect=BW_CPU3_MEMORY_MAP_OPEN_BUS; break;
      default: return 0;
    }
  }
  return 1;
}

static int bw_host_write(void *, uint32_t raw, uint32_t effective,
                         const uint8_t *data, uint32_t length,
                         bw_cpu3_memory_map_byte_result *tags)
{
  if (!data || !tags || !bw_mapped_span_ok(raw,effective,length)) return 0;
  for (uint32_t i=0;i<length;++i) tags[i].kind=bw_map_kind(effective+i);
  for (uint32_t i=0;i<length;++i) {
    const uint32_t address=effective+i;
    switch (tags[i].kind) {
      case BW_CPU3_MEMORY_MAP_RAM:
        bw_ram[address]=data[i];
        // The host owns RAM; Bochs still needs this stamp for decoded code.
        pageWriteStampTable.decWriteStamp(address,1);
        tags[i].effect=BW_CPU3_MEMORY_MAP_RAM_COMMIT; break;
      case BW_CPU3_MEMORY_MAP_ROM:
        ++bw_rom_ignored_writes;
        tags[i].effect=BW_CPU3_MEMORY_MAP_ROM_IGNORED; break;
      case BW_CPU3_MEMORY_MAP_MMIO:
        bw_mmio_register=data[i]; ++bw_mmio_writes;
        tags[i].effect=BW_CPU3_MEMORY_MAP_MMIO_WRITE; break;
      case BW_CPU3_MEMORY_MAP_UNMAPPED:
        ++bw_unmapped_ignored_writes;
        tags[i].effect=BW_CPU3_MEMORY_MAP_UNMAPPED_IGNORED; break;
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
    if (bw_map_kind(effective_page+i)!=BW_CPU3_MEMORY_MAP_RAM) return 0;
  *kind=BW_CPU3_MEMORY_MAP_RAM;
  return bw_ram + effective_page;
}

static int bw_host_in(void *, uint16_t port, uint32_t width, uint32_t *value)
{
  if (port!=0x92 || width!=1 || !value) return 0;
  *value=bw_port92_latch;
  fprintf(stderr,"BWS6\tPORT\tin\t%04x\t%u\t%08x\t%" PRIu64
    "\t%" PRIu64 "\n",port,width,*value,bw_ticks,++bw_ordinal);
  return 1;
}

static int bw_host_out(void *, uint16_t port, uint32_t width, uint32_t value)
{
  if (width != 1) return 0;
  if (port==0x92) {
    // This fixture fixes the 8042 A20 source low. Reject reset/unknown bits.
    if (value & ~2U) return 0;
    const unsigned old=bx_pc_system.get_enable_a20() ? 1 : 0;
    bw_port92_latch=(uint8_t)value;
    const unsigned next=(value & 2) ? 1 : 0;
    if (old!=next) bx_pc_system.set_enable_a20(next!=0);
    fprintf(stderr,"BWS6\tA20\t%u\t%u\t%02x\t%" PRIu64
      "\t%" PRIu64 "\n",old,next,value,bw_ticks,++bw_ordinal);
  } else if (port==0xe9) {
    static const char expected[]="BMAP001";
    if (bw_port_bytes_seen>=7 || value!=(unsigned char)expected[bw_port_bytes_seen])
      return 0;
    ++bw_port_bytes_seen;
  } else return 0;
  fprintf(stderr,"BWS6\tPORT\tout\t%04x\t%u\t%08x\t%" PRIu64
    "\t%" PRIu64 "\n",port,width,value,bw_ticks,++bw_ordinal);
  return 1;
}

static int bw_host_tick(void *, uint32_t)
{
  if (!bw_reentry_probed) {
    bw_cpu3_memory_map_slice_result rejected;
    if (bw_cpu3_memory_map_resume(1,UINT64_MAX,&bw_callbacks,&rejected) ||
        rejected.reason || rejected.charged_ticks)
      bw_slice_fail("callback-reentry-accepted");
    bw_reentry_probed=true;
    fprintf(stderr,"BWS6\tPROBE\tcallback-reentry\trejected\n");
  }
  return 1; // Native time charge only; external action follows a deadline cut.
}

static int bw_host_ack_irq(void *, uint8_t *vector)
{
  (void)vector;
  return 0; // The owned memory fixture has no host IRQ source.
}

unsigned bw_slice_ack_irq(void)
{
  bw_slice_fail("unexpected-host-irq");
  return 0;
}

void bw_slice_note_irq(unsigned vector)
{
  (void)vector;
  bw_slice_fail("unexpected-host-irq");
}

void bw_slice_read(unsigned long long address, unsigned length, void *data)
{
  const uint32_t effective=(uint32_t)A20ADDR(address);
  bw_cpu3_memory_map_byte_result tags[16];
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
    fprintf(stderr,"BWS6\tMEM\tR\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\n",
      (unsigned)address+i,effective+i,bw_kind_name(tags[i].kind),
      ((const uint8_t *)data)[i],bw_effect_name(tags[i].effect),bw_ticks,
      ++bw_ordinal,bw_pagewalk_name());
}

void bw_slice_write(unsigned long long address, unsigned length,
                    const void *data)
{
  const uint32_t effective=(uint32_t)A20ADDR(address);
  bw_cpu3_memory_map_byte_result tags[16];
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
    fprintf(stderr,"BWS6\tMEM\tW\t%08x\t%08x\t%s\t%02x\t%s\t%" PRIu64 "\t%" PRIu64 "\t%s\n",
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
  if (!page || kind!=BW_CPU3_MEMORY_MAP_RAM)
    bw_slice_fail("unsafe-execute-page");
  ++bw_execute_pages;
  fprintf(stderr,"BWS6\tEXEC\t%08x\t%08x\tram\t%" PRIu64 "\t%" PRIu64 "\n",
    (unsigned)address,effective,bw_ticks,++bw_ordinal);
  return page;
}

unsigned bw_slice_port_in(unsigned port, unsigned width)
{
  if (!bw_slice_active) return bx_devices.inp(port, width);
  uint32_t value = 0;
  if (!bw_callbacks.port_in || !bw_callbacks.port_in(bw_callbacks.context,
      port, width, &value)) bw_slice_fail("host-port-in");
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
  if (!count || count > bw_budget - bw_slice_ticks) bw_slice_fail("tick-budget");
  if (!bw_callbacks.tick || !bw_callbacks.tick(bw_callbacks.context, count))
    bw_slice_fail("host-tick");
  const uint64_t before=bw_ticks;
  ++bw_tick_callbacks;
  bw_slice_ticks += count;
  bw_ticks += count;
  fprintf(stderr,"BWS6\tTICK\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",
    count,before,bw_ticks,++bw_ordinal);
}

void bw_slice_note_attempt(void)
{
  if (bw_slice_active) {
    bw_slice_rep_incomplete = false;
    ++bw_attempts;
    const unsigned cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
    const unsigned eip=BX_CPU(0)->get_eip();
    if ((cs==0 && (eip==0x7e00 || eip==0x7e27 || eip==0x7e56 ||
                   eip==0x7e7b || eip==0x7e92 || eip==0x7eaa ||
                   eip==0x7ec2 || eip==0x7ee3)) ||
        (cs==8 && (eip==0x7f36 || eip==0x7f45 || eip==0x7f86 ||
                   eip==0x7f96 || eip==0x7fc6 || eip==0x7ff4))) {
      fprintf(stderr,"BWS6\tATTEMPT\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",
        cs,eip,bw_ticks,++bw_ordinal);
    }
  }
}
bool bw_slice_ticks_reached(void)
{
  return bw_slice_active && bw_slice_ticks >= bw_budget;
}
bool bw_slice_should_yield(void)
{
  return bw_slice_active &&
    (bw_slice_ticks >= bw_budget || bw_slice_port_pending || bw_halted ||
     bw_slice_irq_pending);
}
void bw_slice_note_halt(void)
{
  if (bw_slice_active) {
    bw_halted = true;
    ++bw_halt_idle_cuts;
    fprintf(stderr,"BWS6\tHALT_IDLE\t%" PRIu64 "\t%04x\t%08x\t%u\t%u\t%08x\t%" PRIu64 "\n",
      bw_ticks,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,
      BX_CPU(0)->get_eip(),BX_CPU(0)->get_IF(),
      BX_CPU(0)->activity_state,BX_CPU(0)->pending_event,++bw_ordinal);
  }
}
void bw_slice_rep_pre_iteration(void)
{
  // Normal cut occurs after the preceding iteration, before its intermediate
  // tick. Reaching this guard means a subsequent iteration would overrun.
  if (bw_slice_active && bw_slice_ticks >= bw_budget)
    bw_slice_fail("rep-over-deadline");
}
void bw_slice_note_rep_iteration(void)
{
  if (bw_slice_active) ++bw_rep_iterations;
}
bool bw_slice_rep_budget_exhausted(void)
{
  if (!bw_slice_active || bw_slice_ticks + 1 < bw_budget) return false;
  bw_slice_rep_incomplete = true;
  return true;
}
void bw_slice_note_completed(void)
{
  if (!bw_slice_active) return;
  if (bw_slice_rep_incomplete) ++bw_rep_partial;
  else ++bw_completed;
  if (bw_slice_port_pending) {
    ++bw_ports;
    bw_port_committed_this_slice = true;
  }
}
void bw_slice_note_fault(unsigned vector, unsigned error_code)
{
  if (bw_slice_active) {
    fprintf(stderr,"BWS6\tUNEXPECTED_FAULT\t%u\t%u\t%04x\t%08x\t%" PRIu64 "\n",
      vector,error_code,BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,
      (unsigned)BX_CPU(0)->prev_rip,bw_ticks);
    bw_slice_fail("unexpected-fault");
  }
}

void bw_slice_activate(BX_CPU_C *cpu)
{
  if (bw_slice_active) bw_slice_fail("duplicate-activation");
  if (cpu->sregs[BX_SEG_REG_CS].selector.value != 0 ||
      cpu->get_eip() != 0x7e00) bw_slice_fail("activation-boundary");
  for (unsigned page = 0; page < sizeof(bw_ram); page += 4096)
    if (bw_map_kind(page)==BW_CPU3_MEMORY_MAP_RAM)
      memcpy(bw_ram + page, BX_MEM(0)->get_vector(page), 4096);
  bw_callbacks.context = 0;
  bw_callbacks.read_physical = bw_host_read;
  bw_callbacks.write_physical = bw_host_write;
  bw_callbacks.execute_page = bw_host_execute;
  bw_callbacks.port_in = bw_host_in;
  bw_callbacks.port_out = bw_host_out;
  bw_callbacks.tick = bw_host_tick;
  bw_callbacks.ack_irq = bw_host_ack_irq;
  bw_cpu3_memory_map_slice_result before_activation;
  if (bw_cpu3_memory_map_resume(1, UINT64_MAX, &bw_callbacks, &before_activation) ||
      before_activation.reason || before_activation.charged_ticks)
    bw_slice_fail("resume-before-activation-accepted");
  fprintf(stderr,"BWS6\tPROBE\tresume-before-activation\trejected\n");
  bw_emit_state("SEEDSTATE",cpu);
  for (unsigned page = 0; page < sizeof(bw_ram)/4096; ++page) {
    if (bw_map_kind(page*4096)!=BW_CPU3_MEMORY_MAP_RAM) continue;
    fprintf(stderr,"BWS6\tSEEDPAGE\t%u\t",page);
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
  fprintf(stderr,"BWS6\tIRQ_HANDOFF\t%08x\t%08x\t%u\t%08x\n",
    inherited_pending,inherited_mask,inherited_if,cpu->pending_event);
  const unsigned inherited_a20=bx_pc_system.get_enable_a20() ? 1 : 0;
  bw_port92_latch=inherited_a20 ? 2 : 0; // 8042 source is fixed low in this fixture.
  fprintf(stderr,"BWS6\tA20_HANDOFF\t%u\t%02x\t8042-low\n",
    inherited_a20,bw_port92_latch);
  fprintf(stderr,"BWS6\tROM_ID\t%s\t65536\n",bw_owned_rom_sha256);
  fprintf(stderr,"BWS6\tMAP_ID\tram00000-9ffff,mmio-a0000,rom-f0000-fffff,ram-100000-17ffff,openbus-rest\n");
  bw_slice_active = true;
  cpu->TLB_flush(); // Also invalidates the prefetch queue.
  cpu->iCache.flushICacheEntries();
  // Exactly 160 low + 128 extended RAM pages were copied. The 0x180000
  // backing capacity also contains holes and is not a copied-byte count.
  fprintf(stderr, "BWS6\tACTIVATE\t0000\t00007e00\t1179648\t%u\n",
    inherited_a20);
}

static void bw_fill_result(bw_cpu3_memory_map_slice_result *result, unsigned reason)
{
  result->reason = reason;
  result->requested_ticks = bw_requested_budget;
  result->effective_ticks = bw_budget;
  result->charged_ticks = bw_slice_ticks;
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
  result->port_committed = bw_port_committed_this_slice ? 1 : 0;
  result->event_due = bw_deadline_due ? 1 : 0;
  result->pending_irq = bw_host_irq_line ? 1 : 0;
  result->irq_delivered = bw_slice_irq_pending ? 1 : 0;
  result->irq_vector = bw_slice_irq_pending ? bw_host_irq_vector : 0;
  result->if_flag = BX_CPU(0)->get_IF();
  result->activity_state = BX_CPU(0)->activity_state;
  result->pending_event = BX_CPU(0)->pending_event;
}

extern "C" int bw_cpu3_memory_map_resume(uint32_t max_ticks, uint64_t next_event_tick,
  const bw_cpu3_memory_map_host_callbacks *callbacks, bw_cpu3_memory_map_slice_result *result)
{
  if (result) memset(result, 0, sizeof(*result));
  if (!result || !bw_slice_active || bw_in_resume || !max_ticks || !callbacks ||
      !callbacks->read_physical || !callbacks->write_physical ||
      !callbacks->execute_page || !callbacks->port_in ||
      !callbacks->port_out || !callbacks->tick ||
      !callbacks->ack_irq || next_event_tick < bw_ticks) return 0;
  bw_callbacks = *callbacks;
  bw_requested_budget = max_ticks;
  bw_deadline = next_event_tick;
  const uint64_t until_event = next_event_tick - bw_ticks;
  bw_budget = until_event < max_ticks ? (uint32_t)until_event : max_ticks;
  bw_slice_ticks = 0;
  bw_port_committed_this_slice = false;
  bw_slice_fault_pending = false;
  bw_slice_irq_pending = false;
  bw_halted = false;
  bw_deadline_due = bw_budget == 0;
  bw_in_resume = true;
  if (bw_budget) BX_CPU(0)->cpu_loop();
  bw_in_resume = false;
  bw_deadline_due = next_event_tick != UINT64_MAX && bw_ticks == next_event_tick;
  const unsigned reason = bw_slice_fault_pending ? BW_CPU3_MEMORY_MAP_SLICE_FAULT :
    bw_slice_irq_pending ? BW_CPU3_MEMORY_MAP_SLICE_IRQ_DELIVERED :
    bw_halted ? BW_CPU3_MEMORY_MAP_SLICE_HALT :
    bw_slice_port_pending ? BW_CPU3_MEMORY_MAP_SLICE_PORT :
    bw_deadline_due ? BW_CPU3_MEMORY_MAP_SLICE_EVENT_DUE : BW_CPU3_MEMORY_MAP_SLICE_BUDGET;
  bw_fill_result(result, reason);
  bw_slice_port_pending = false;
  return 1;
}

void bw_slice_driver(void)
{
  const char *raw=getenv("BW_CPU3_MEMORY_MAP_BUDGET");
  const uint32_t budget=!raw || !strcmp(raw,"continuous") ? UINT32_MAX :
    (uint32_t)strtoul(raw,0,10);
  if (budget!=1 && budget!=2 && budget!=257 && budget!=UINT32_MAX)
    bw_slice_fail("driver-budget");
  const char *probe=getenv("BW_CPU3_MEMORY_MAP_PROBE");
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
  bw_cpu3_memory_map_slice_result invalid;
  if (bw_cpu3_memory_map_resume(0,UINT64_MAX,&bw_callbacks,&invalid) ||
      invalid.reason || invalid.charged_ticks) bw_slice_fail("zero-budget-accepted");
  fprintf(stderr,"BWS6\tPROBE\tzero-budget\trejected\n");
  if (bw_cpu3_memory_map_resume(1,UINT64_MAX,0,&invalid) ||
      invalid.reason || invalid.charged_ticks) bw_slice_fail("null-callbacks-accepted");
  fprintf(stderr,"BWS6\tPROBE\tnull-callbacks\trejected\n");
  bw_cpu3_memory_map_host_callbacks incomplete=bw_callbacks;
  incomplete.read_physical=0;
  if (bw_cpu3_memory_map_resume(1,UINT64_MAX,&incomplete,&invalid) ||
      invalid.reason || invalid.charged_ticks) bw_slice_fail("incomplete-callbacks-accepted");
  fprintf(stderr,"BWS6\tPROBE\tincomplete-callbacks\trejected\n");
  if (!bw_cpu3_memory_map_resume(1,bw_ticks,&bw_callbacks,&invalid) ||
      invalid.reason!=BW_CPU3_MEMORY_MAP_SLICE_EVENT_DUE || invalid.charged_ticks ||
      invalid.effective_ticks || !invalid.event_due)
    bw_slice_fail("due-now-contract");
  fprintf(stderr,"BWS6\tPROBE\tdue-now\tzero-tick\n");

  for (unsigned slice=0;slice<100000;++slice) {
    const unsigned entry_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
    const unsigned entry_eip=BX_CPU(0)->get_eip();
    const unsigned entry_if=BX_CPU(0)->get_IF();
    const unsigned entry_activity=BX_CPU(0)->activity_state;
    const unsigned entry_pending=BX_CPU(0)->pending_event;
    const uint64_t before_ticks=bw_ticks;
    bw_cpu3_memory_map_slice_result result;
    if (!bw_cpu3_memory_map_resume(budget,UINT64_MAX,&bw_callbacks,&result))
      bw_slice_fail("resume");
    fprintf(stderr,"BWS6\tSLICE\t%u\t%u\t%u\t%u\t%04x\t%08x\t%04x\t%08x"
      "\t%" PRIu64 "\t%" PRIu64
      "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
      "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
      "\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u\t%u\t%u\t%u\n",
      result.requested_ticks,result.effective_ticks,result.charged_ticks,
      result.reason,entry_cs,entry_eip,result.cs,result.eip,before_ticks,bw_ticks,
      result.attempts,result.completed,result.rep_iterations,result.rep_partial,
      result.faults,result.port_commits,result.irq_deliveries,result.halt_idle_cuts,
      entry_if,result.if_flag,entry_activity,result.activity_state,
      entry_pending,result.pending_event,result.event_due,result.pending_irq,
      result.irq_delivered,result.irq_vector,result.pending_fault,
      result.port_committed);
    if (result.reason==BW_CPU3_MEMORY_MAP_SLICE_FAULT ||
        result.reason==BW_CPU3_MEMORY_MAP_SLICE_IRQ_DELIVERED ||
        result.reason==BW_CPU3_MEMORY_MAP_SLICE_HALT ||
        bw_faults || bw_irq_deliveries || bw_halt_idle_cuts)
      bw_slice_fail("unexpected-guest-event");
    if (bw_port_bytes_seen==7) {
      if (!result.port_committed || result.cs!=8 || result.eip!=0x8010 ||
          bw_ports!=12 || bw_mmio_reads!=1 || bw_mmio_writes!=1 ||
          bw_rom_ignored_writes!=1 || bw_unmapped_reads!=1 ||
          bw_unmapped_ignored_writes!=1 ||
          bw_ram[0x500]!=0x52 || bw_ram[0x100500]!=0xa7 ||
          bw_ram[0x560]!=bw_owned_rom[0xfff0] ||
          bw_ram[0x563]!=bw_owned_rom[0xfff0] ||
          bw_ram[0x561]!=0x5a || bw_ram[0x562]!=0xff ||
          bw_mmio_register!=0x5a ||
          bw_read_le32(0x10000)!=0x00111023 ||
          bw_read_le32(0x11014)!=0x00005063 ||
          bw_read_le32(0x110000)!=0x00b02002 ||
          bw_read_le32(0x111014)!=0x00505002 ||
          bw_read_le32(0x5000)!=0x11223344 ||
          !bw_aliased_pde_reads || !bw_aliased_pte5_reads ||
          !bw_aliased_pde_ad_writes || !bw_aliased_pte5_ad_writes ||
          !bx_pc_system.get_enable_a20() || bw_port92_latch!=2)
        bw_slice_fail("final-memory-map-contract");
      fprintf(stderr,"BWS6\tPAGEWALK_PROOF\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\n",bw_aliased_pde_reads,
        bw_aliased_pte5_reads,bw_aliased_pde_ad_writes,
        bw_aliased_pte5_ad_writes);
      fprintf(stderr,"BWS6\tFINAL\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%02x\t%02x\t%02x\t%02x\t%02x\t%02x"
        "\t%02x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64
        "\t%08x\t%08x\t%08x\t%08x\t%08x\t%u\t%02x\n",
        bw_ticks,bw_attempts,bw_completed,bw_ports,
        (unsigned)bw_ram[0x500],(unsigned)bw_ram[0x100500],
        (unsigned)bw_ram[0x560],(unsigned)bw_ram[0x563],
        (unsigned)bw_ram[0x561],(unsigned)bw_ram[0x562],
        (unsigned)bw_mmio_register,bw_mmio_reads,bw_mmio_writes,
        bw_rom_ignored_writes,bw_unmapped_reads,bw_unmapped_ignored_writes,
        bw_read_le32(0x10000),bw_read_le32(0x11014),
        bw_read_le32(0x110000),bw_read_le32(0x111014),
        bw_read_le32(0x5000),bx_pc_system.get_enable_a20()?1:0,
        (unsigned)bw_port92_latch);
      bw_emit_state("STATE",BX_CPU(0));
      fprintf(stderr,"BWS6\tCALLBACKS\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\n",bw_physical_reads,
        bw_physical_writes,bw_execute_pages,bw_tick_callbacks);
      fprintf(stderr,"BWS6\tFALLBACK\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\n",bw_fallback_ram_reads,
        bw_fallback_ram_writes,bw_fallback_direct_pointers,
        bw_fallback_pio,bw_fallback_timer);
      fflush(stderr);
      bw_slice_active=false;
      fprintf(stderr,"BWS6\tDEACTIVATE\tproof-complete\n");
      return;
    }
  }
  bw_slice_fail("slice-limit");
}
