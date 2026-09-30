/* Included once at the end of cpu.cc in the separately prepared CPU3 tree. */
#include "iodev/iodev.h"
#include <inttypes.h>
#include <limits.h>

bool bw_slice_active = false;
bool bw_slice_port_pending = false;
bool bw_slice_rep_incomplete = false;
bool bw_slice_fault_pending = false;
bool bw_slice_irq_pending = false;

static unsigned char bw_ram[1024 * 1024];
static bw_cpu3_paged_events_host_callbacks bw_callbacks;
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
static unsigned bw_fault_vector;
static unsigned bw_fault_error;
static uint64_t bw_fault_ordinal;
static uint64_t bw_fault_tick;
static unsigned bw_fault_cr2;
static unsigned bw_faulting_cs;
static unsigned bw_faulting_eip;
static bool bw_retry_store_seen;
static uint64_t bw_retry_store_tick;
static uint64_t bw_retry_store_ordinal;
static unsigned bw_fault_store_attempts;
static unsigned bw_pf_handler_attempts;
static unsigned bw_reload_attempts;
static unsigned bw_iret_attempts;
static unsigned bw_shadow_attempts;
static unsigned bw_irq_handler_attempts;
static unsigned bw_last_port;
static unsigned bw_last_value;
static unsigned bw_last_width;
static bool bw_port_committed_this_slice;
static bool bw_halted;
static bool bw_host_irq_line;
static bool bw_in_resume;
static bool bw_reentry_probed;
static uint8_t bw_host_irq_vector;
static uint64_t bw_irq_deliveries;
static uint64_t bw_halt_idle_cuts;
static uint64_t bw_irq_ordinal;
static uint64_t bw_last_ack_ordinal;
static uint64_t bw_irq_tick;
static unsigned bw_irq_entry_cs;
static unsigned bw_irq_entry_eip;
static unsigned bw_irq_handler_cs;
static unsigned bw_irq_handler_eip;
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
  fprintf(stderr,"BWS5\t%s\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x"
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
  fprintf(stderr, "BWS5\tFAIL\t%s\n", kind);
  fflush(stderr);
  abort();
}

static bool bw_range_ok(unsigned long long address, unsigned length)
{
  return length && address < sizeof(bw_ram) &&
    length <= sizeof(bw_ram) - address &&
    ((address & 4095) + length <= 4096);
}

static uint32_t bw_read_le32(unsigned address)
{
  if (address > sizeof(bw_ram)-4) bw_slice_fail("snapshot-range");
  return (uint32_t)bw_ram[address] |
    ((uint32_t)bw_ram[address+1] << 8) |
    ((uint32_t)bw_ram[address+2] << 16) |
    ((uint32_t)bw_ram[address+3] << 24);
}

static int bw_host_read(void *, uint32_t address, uint8_t *data, uint32_t length)
{
  if (!bw_range_ok(address, length)) return 0;
  memcpy(data, bw_ram + address, length);
  if (address == 0xa014 && length == 4) {
    fprintf(stderr,"BWS5\tPTE5_READ\t%02x%02x%02x%02x\t%" PRIu64 "\t%" PRIu64 "\n",
      data[0],data[1],data[2],data[3],bw_ticks,++bw_ordinal);
  }
  return 1;
}

static int bw_host_write(void *, uint32_t address, const uint8_t *data,
                         uint32_t length)
{
  if (!bw_range_ok(address, length)) return 0;
  memcpy(bw_ram + address, data, length);
  // Host RAM replaces Bochs RAM, but decoded code still uses Bochs write stamps.
  pageWriteStampTable.decWriteStamp(address, length);
  fprintf(stderr, "BWS5\tWRITE\t%08x\t", address);
  for (uint32_t i = 0; i < length; ++i) fprintf(stderr, "%02x", data[i]);
  fprintf(stderr, "\t%" PRIu64 "\t%" PRIu64 "\n", bw_ticks, ++bw_ordinal);
  if (address == 0x5000 && length == 4 &&
      data[0] == 0x44 && data[1] == 0x33 &&
      data[2] == 0x22 && data[3] == 0x11 && bw_faults == 1) {
    if (bw_fault_store_attempts != 2 || bw_pf_handler_attempts != 1 ||
        bw_reload_attempts != 1 || bw_iret_attempts != 1 ||
        bw_retry_store_seen)
      bw_slice_fail("data5-before-fault-retry");
    bw_retry_store_seen = true;
    bw_retry_store_tick = bw_ticks;
    bw_retry_store_ordinal = bw_ordinal;
  }
  return 1;
}

static const uint8_t *bw_host_execute(void *, uint32_t page)
{
  if (page >= sizeof(bw_ram) || (page & 4095)) return 0;
  return bw_ram + page;
}

static int bw_host_in(void *, uint16_t, uint32_t, uint32_t *)
{
  return 0; // This fixture has no IN instruction after activation.
}

static int bw_host_out(void *, uint16_t port, uint32_t width, uint32_t value)
{
  if (port != 0xe9 || width != 1) return 0;
  static const char expected[] = "BPEV001";
  if (bw_port_bytes_seen >= 7 || value != (unsigned char)expected[bw_port_bytes_seen])
    return 0;
  ++bw_port_bytes_seen;
  fprintf(stderr, "BWS5\tPORT\t%04x\t%u\t%08x\t%" PRIu64
    "\t%" PRIu64 "\n", port, width, value, bw_ticks, ++bw_ordinal);
  bw_last_port = port;
  bw_last_width = width;
  bw_last_value = value;
  return 1;
}

static int bw_host_tick(void *, uint32_t)
{
  if (!bw_reentry_probed) {
    bw_cpu3_paged_events_slice_result rejected;
    if (bw_cpu3_paged_events_set_irq_line(1,0x20) ||
        bw_cpu3_paged_events_resume(1,UINT64_MAX,&bw_callbacks,&rejected) ||
        rejected.reason || rejected.charged_ticks)
      bw_slice_fail("callback-reentry-accepted");
    bw_reentry_probed=true;
    fprintf(stderr,"BWS5\tPROBE\tcallback-reentry\trejected\n");
  }
  return 1; // Native time charge only; external action follows a deadline cut.
}

static int bw_host_ack_irq(void *, uint8_t *vector)
{
  if (!bw_host_irq_line || !vector) return 0;
  *vector=bw_host_irq_vector;
  return 1;
}

extern "C" int bw_cpu3_paged_events_set_irq_line(int asserted, uint8_t vector)
{
  if (!bw_slice_active || bw_in_resume ||
      (asserted != 0 && asserted != 1)) return 0;
  bw_host_irq_line=asserted != 0;
  if (asserted) {
    bw_host_irq_vector=vector;
    BX_CPU(0)->raise_INTR();
  } else {
    BX_CPU(0)->clear_INTR();
  }
  fprintf(stderr,"BWS5\tIRQ_LINE\t%u\t%02x\t%" PRIu64 "\t%" PRIu64 "\n",
    asserted,bw_host_irq_vector,bw_ticks,++bw_ordinal);
  return 1;
}

unsigned bw_slice_ack_irq(void)
{
  uint8_t vector=0;
  if (bw_irq_deliveries == 0 && (!bw_retry_store_seen || bw_faults != 1 ||
      bw_fault_store_attempts != 2 || bw_pf_handler_attempts != 1 ||
      bw_reload_attempts != 1 || bw_iret_attempts != 1 ||
      bw_shadow_attempts != 1 || bw_ram[0x0530] != 1 ||
      bw_read_le32(0xa014) != 0x5063 ||
      bw_read_le32(0x0520) != 0x5000 ||
      bw_read_le32(0x5000) != 0x11223344))
    bw_slice_fail("irq-before-fault-retry");
  if (!bw_slice_active || !bw_host_irq_line || !bw_callbacks.ack_irq ||
      !bw_callbacks.ack_irq(bw_callbacks.context,&vector) ||
      vector != bw_host_irq_vector) bw_slice_fail("host-irq-ack");
  bw_irq_entry_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
  bw_irq_entry_eip=BX_CPU(0)->get_eip();
  bw_last_ack_ordinal = ++bw_ordinal;
  fprintf(stderr,"BWS5\tIRQ_ACK\t%02x\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",
    vector,bw_irq_entry_cs,bw_irq_entry_eip,bw_ticks,bw_last_ack_ordinal);
  return vector;
}

void bw_slice_note_irq(unsigned vector)
{
  if (!bw_slice_active || !bw_host_irq_line || vector != bw_host_irq_vector)
    bw_slice_fail("host-irq-delivery");
  ++bw_irq_deliveries;
  bw_irq_tick=bw_ticks;
  bw_irq_ordinal=++bw_ordinal;
  bw_irq_handler_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
  bw_irq_handler_eip=BX_CPU(0)->get_eip();
  bw_slice_irq_pending=true;
  const unsigned sp=BX_CPU(0)->gen_reg[BX_32BIT_REG_ESP].dword.erx & 0xffff;
  fprintf(stderr,"BWS5\tIRQ_DELIVERED\t%02x\t%04x\t%08x\t%04x\t%08x\t%04x\t%08x\t%08x\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",
    vector,bw_irq_entry_cs,bw_irq_entry_eip,bw_irq_handler_cs,
    bw_irq_handler_eip,sp,bw_read_le32(sp),bw_read_le32(sp+4),
    bw_read_le32(sp+8),bw_irq_tick,bw_irq_ordinal);
}

void bw_slice_read(unsigned long long address, unsigned length, void *data)
{
  if (!bw_slice_active || !bw_callbacks.read_physical ||
      !bw_range_ok(address, length) ||
      !bw_callbacks.read_physical(bw_callbacks.context, (uint32_t) address,
                                  (uint8_t *) data, length))
    bw_slice_fail("host-physical-read");
  ++bw_physical_reads;
}

void bw_slice_write(unsigned long long address, unsigned length,
                    const void *data)
{
  if (!bw_slice_active || !bw_callbacks.write_physical ||
      !bw_range_ok(address, length) ||
      !bw_callbacks.write_physical(bw_callbacks.context, (uint32_t) address,
                                   (const uint8_t *) data, length))
    bw_slice_fail("host-physical-write");
  ++bw_physical_writes;
}

const unsigned char *bw_slice_execute_page(unsigned long long address)
{
  if (!bw_slice_active || !bw_callbacks.execute_page ||
      address >= sizeof(bw_ram) || (address & 4095))
    bw_slice_fail("host-execute-page");
  const uint8_t *page = bw_callbacks.execute_page(bw_callbacks.context,
                                                  (uint32_t) address);
  if (!page) bw_slice_fail("host-execute-page");
  ++bw_execute_pages;
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
  fprintf(stderr,"BWS5\tTICK\t%u\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",
    count,before,bw_ticks,++bw_ordinal);
}

void bw_slice_note_attempt(void)
{
  if (bw_slice_active) {
    bw_slice_rep_incomplete = false;
    ++bw_attempts;
    const unsigned cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
    const unsigned eip=BX_CPU(0)->get_eip();
    if (cs==8 && (eip==0x7ee8 || eip==0x7f58 || eip==0x7fa3 ||
                  eip==0x7fa9 || eip==0x7f17 || eip==0x7fab)) {
      if (eip==0x7ee8) ++bw_fault_store_attempts;
      else if (eip==0x7f58) ++bw_pf_handler_attempts;
      else if (eip==0x7fa3) ++bw_reload_attempts;
      else if (eip==0x7fa9) ++bw_iret_attempts;
      else if (eip==0x7f17) ++bw_shadow_attempts;
      else ++bw_irq_handler_attempts;
      fprintf(stderr,"BWS5\tATTEMPT\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",
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
    fprintf(stderr,"BWS5\tHALT_IDLE\t%" PRIu64 "\t%04x\t%08x\t%u\t%u\t%08x\t%" PRIu64 "\n",
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
  if (!bw_slice_active) return;
  if (bw_faults || bw_fault_store_attempts != 1)
    bw_slice_fail("unexpected-fault-attempt");
  ++bw_faults;
  bw_fault_vector = vector;
  bw_fault_error = error_code;
  bw_fault_tick = bw_ticks;
  bw_fault_ordinal = ++bw_ordinal;
  bw_fault_cr2 = (unsigned)BX_CPU(0)->cr2;
  bw_faulting_cs = BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
  bw_faulting_eip = BX_CPU(0)->prev_rip;
  bw_slice_fault_pending = true;
  fprintf(stderr,"BWS5\tFAULT_BEGIN\t%u\t%u\t%08x\t%04x\t%08x\t%" PRIu64 "\t%" PRIu64 "\n",
    vector,error_code,bw_fault_cr2,bw_faulting_cs,bw_faulting_eip,
    bw_fault_tick,bw_fault_ordinal);
}

void bw_slice_activate(BX_CPU_C *cpu)
{
  if (bw_slice_active) bw_slice_fail("duplicate-activation");
  if (cpu->sregs[BX_SEG_REG_CS].selector.value != 0 ||
      cpu->get_eip() != 0x7e00) bw_slice_fail("activation-boundary");
  for (unsigned page = 0; page < sizeof(bw_ram); page += 4096)
    memcpy(bw_ram + page, BX_MEM(0)->get_vector(page), 4096);
  bw_callbacks.context = 0;
  bw_callbacks.read_physical = bw_host_read;
  bw_callbacks.write_physical = bw_host_write;
  bw_callbacks.execute_page = bw_host_execute;
  bw_callbacks.port_in = bw_host_in;
  bw_callbacks.port_out = bw_host_out;
  bw_callbacks.tick = bw_host_tick;
  bw_callbacks.ack_irq = bw_host_ack_irq;
  if (bw_cpu3_paged_events_set_irq_line(1,0x20))
    bw_slice_fail("irq-before-activation-accepted");
  fprintf(stderr,"BWS5\tPROBE\tirq-before-activation\trejected\n");
  bw_cpu3_paged_events_slice_result before_activation;
  if (bw_cpu3_paged_events_resume(1, UINT64_MAX, &bw_callbacks, &before_activation) ||
      before_activation.reason || before_activation.charged_ticks)
    bw_slice_fail("resume-before-activation-accepted");
  fprintf(stderr,"BWS5\tPROBE\tresume-before-activation\trejected\n");
  bw_emit_state("SEEDSTATE",cpu);
  for (unsigned page = 0; page < 256; ++page) {
    fprintf(stderr,"BWS5\tSEEDPAGE\t%u\t",page);
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
  fprintf(stderr,"BWS5\tIRQ_HANDOFF\t%08x\t%08x\t%u\t%08x\n",
    inherited_pending,inherited_mask,inherited_if,cpu->pending_event);
  bw_slice_active = true;
  cpu->TLB_flush(); // Also invalidates the prefetch queue.
  cpu->iCache.flushICacheEntries();
  fprintf(stderr, "BWS5\tACTIVATE\t0000\t00007e00\t1048576\n");
}

static void bw_fill_result(bw_cpu3_paged_events_slice_result *result, unsigned reason)
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

extern "C" int bw_cpu3_paged_events_resume(uint32_t max_ticks, uint64_t next_event_tick,
  const bw_cpu3_paged_events_host_callbacks *callbacks, bw_cpu3_paged_events_slice_result *result)
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
  if (bw_slice_fault_pending) {
    if (bw_fault_vector != 14 || bw_fault_error != 2 ||
        bw_fault_cr2 != 0x5000 || (unsigned)BX_CPU(0)->cr2 != 0x5000)
      bw_slice_fail("fault-delivery-contract");
    fprintf(stderr,"BWS5\tFAULT_DELIVERED\t%u\t%u\t%08x"
      "\t%08x\t%08x\t%08x\t%08x\t%04x\t%08x\t%04x\t%08x"
      "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n",
      bw_fault_vector,bw_fault_error,(unsigned)BX_CPU(0)->cr2,
      bw_read_le32(0x6ff0),bw_read_le32(0x6ff4),
      bw_read_le32(0x6ff8),bw_read_le32(0x6ffc),
      bw_faulting_cs,bw_faulting_eip,
      BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value,BX_CPU(0)->get_eip(),
      bw_fault_tick,bw_ticks,bw_fault_ordinal,++bw_ordinal);
  }
  const unsigned reason = bw_slice_fault_pending ? BW_CPU3_PAGED_EVENTS_SLICE_FAULT :
    bw_slice_irq_pending ? BW_CPU3_PAGED_EVENTS_SLICE_IRQ_DELIVERED :
    bw_halted ? BW_CPU3_PAGED_EVENTS_SLICE_HALT :
    bw_slice_port_pending ? BW_CPU3_PAGED_EVENTS_SLICE_PORT :
    bw_deadline_due ? BW_CPU3_PAGED_EVENTS_SLICE_EVENT_DUE : BW_CPU3_PAGED_EVENTS_SLICE_BUDGET;
  bw_fill_result(result, reason);
  bw_slice_port_pending = false;
  return 1;
}

void bw_slice_driver(void)
{
  const char *raw=getenv("BW_CPU3_PAGED_EVENTS_BUDGET");
  const uint32_t budget=!raw || !strcmp(raw,"continuous") ? UINT32_MAX :
    (uint32_t)strtoul(raw,0,10);
  if (budget!=1 && budget!=2 && budget!=257 && budget!=UINT32_MAX)
    bw_slice_fail("driver-budget");
  const char *probe=getenv("BW_CPU3_PAGED_EVENTS_PROBE");
  if (probe) {
    unsigned char byte=0;
    if (!strcmp(probe,"out-of-range-physical")) bw_slice_read(sizeof(bw_ram),1,&byte);
    else if (!strcmp(probe,"unexpected-pio")) bw_slice_port_out(0x80,0,1);
    else if (!strcmp(probe,"bochs-ram-read")) BX_MEM(0)->readPhysicalPage(BX_CPU(0),0,1,&byte);
    else if (!strcmp(probe,"bochs-ram-write")) BX_MEM(0)->writePhysicalPage(BX_CPU(0),0,1,&byte);
    else if (!strcmp(probe,"bochs-direct-pointer")) BX_MEM(0)->getHostMemAddr(BX_CPU(0),0,BX_READ);
    else if (!strcmp(probe,"bochs-pio")) bx_devices.outp(0x80,0,1);
    else if (!strcmp(probe,"bochs-timer")) bx_pc_system.bw_probe_countdown_fallback();
    else bw_slice_fail("unknown-probe");
    bw_slice_fail("probe-was-not-rejected");
  }
  bw_cpu3_paged_events_slice_result invalid;
  if (bw_cpu3_paged_events_resume(0,UINT64_MAX,&bw_callbacks,&invalid) ||
      invalid.reason || invalid.charged_ticks) bw_slice_fail("zero-budget-accepted");
  fprintf(stderr,"BWS5\tPROBE\tzero-budget\trejected\n");
  if (bw_cpu3_paged_events_resume(1,UINT64_MAX,0,&invalid) ||
      invalid.reason || invalid.charged_ticks) bw_slice_fail("null-callbacks-accepted");
  fprintf(stderr,"BWS5\tPROBE\tnull-callbacks\trejected\n");
  bw_cpu3_paged_events_host_callbacks incomplete=bw_callbacks;
  incomplete.ack_irq=0;
  if (bw_cpu3_paged_events_resume(1,UINT64_MAX,&incomplete,&invalid) ||
      invalid.reason || invalid.charged_ticks) bw_slice_fail("incomplete-callbacks-accepted");
  fprintf(stderr,"BWS5\tPROBE\tincomplete-callbacks\trejected\n");
  if (bw_cpu3_paged_events_set_irq_line(2,0x20))
    bw_slice_fail("invalid-irq-line-accepted");
  fprintf(stderr,"BWS5\tPROBE\tinvalid-irq-line\trejected\n");
  if (!bw_cpu3_paged_events_resume(1,bw_ticks,&bw_callbacks,&invalid) ||
      invalid.reason!=BW_CPU3_PAGED_EVENTS_SLICE_EVENT_DUE || invalid.charged_ticks ||
      invalid.effective_ticks || !invalid.event_due)
    bw_slice_fail("due-now-contract");
  fprintf(stderr,"BWS5\tPROBE\tdue-now\tzero-tick\n");

  // Deadline -> pending IRQ under CLI -> recoverable #PF/retry -> STI shadow
  // acceptance -> first idle -> second wake -> terminal masked idle.
  unsigned phase=0;
  uint64_t deadline=256;
  uint64_t idle_first_ticks=0, idle_first_attempts=0;
  uint64_t idle_first_completed=0;
  unsigned idle_first_activity=0, idle_first_eip=0;
  for (unsigned slice=0; slice<100000; ++slice) {
    const unsigned entry_cs=BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
    const unsigned entry_eip=BX_CPU(0)->get_eip();
    const unsigned entry_if=BX_CPU(0)->get_IF();
    const unsigned entry_activity=BX_CPU(0)->activity_state;
    const unsigned entry_pending=BX_CPU(0)->pending_event;
    const uint64_t before_ticks=bw_ticks;
    bw_cpu3_paged_events_slice_result result;
    if (!bw_cpu3_paged_events_resume(budget,deadline,&bw_callbacks,&result))
      bw_slice_fail("resume");
    fprintf(stderr,"BWS5\tSLICE\t%u\t%u\t%u\t%u\t%04x\t%08x\t%04x\t%08x"
      "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
      "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
      "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
      "\t%u\t%u\t%u\t%u\t%08x\t%08x\t%u\t%u\t%u\t%u\t%u\t%u\n",
      result.requested_ticks,result.effective_ticks,result.charged_ticks,
      result.reason,entry_cs,entry_eip,result.cs,result.eip,before_ticks,bw_ticks,
      result.attempts,result.completed,result.rep_iterations,result.rep_partial,
      result.faults,result.port_commits,result.irq_deliveries,result.halt_idle_cuts,
      entry_if,result.if_flag,entry_activity,result.activity_state,
      entry_pending,result.pending_event,result.event_due,result.pending_irq,
      result.irq_delivered,result.irq_vector,result.pending_fault,
      result.port_committed);
    if (phase==0 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_EVENT_DUE) {
      if (bw_ticks!=256 || result.charged_ticks==0 || result.pending_irq)
        bw_slice_fail("deadline-cut-contract");
      if (bw_cpu3_paged_events_resume(1,bw_ticks-1,&bw_callbacks,&invalid) ||
          invalid.reason || invalid.charged_ticks)
        bw_slice_fail("stale-deadline-accepted");
      fprintf(stderr,"BWS5\tPROBE\tstale-deadline\trejected\n");
      deadline=UINT64_MAX;
      fprintf(stderr,"BWS5\tACTION\tdeadline-consumed\t%" PRIu64 "\t%" PRIu64 "\n",
        bw_ticks,++bw_ordinal);
      if (!bw_cpu3_paged_events_set_irq_line(1,0x20)) bw_slice_fail("first-irq-set");
      phase=1;
    } else if (phase==1 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_FAULT) {
      if (bw_faults!=1 || !result.pending_fault || !result.pending_irq ||
          bw_irq_deliveries || bw_retry_store_seen ||
          bw_fault_store_attempts!=1 || bw_pf_handler_attempts ||
          bw_reload_attempts || bw_iret_attempts ||
          result.cs!=8 || result.eip!=0x7f58 ||
          bw_fault_vector!=14 || bw_fault_error!=2 ||
          bw_fault_cr2!=0x5000 || bw_faulting_cs!=8 ||
          bw_faulting_eip!=0x7ee8 || bw_fault_tick+1!=bw_ticks ||
          bw_read_le32(0x6ff0)!=2 || bw_read_le32(0x6ff4)!=0x7ee8 ||
          (bw_read_le32(0x6ff8)&0xffff)!=8 ||
          (bw_read_le32(0x6ffc)&0x00037fd7)!=0x00010046)
        bw_slice_fail("owned-fault-cut-contract");
      phase=11;
    } else if (phase==11 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_IRQ_DELIVERED) {
      if (bw_faults!=1 || !bw_retry_store_seen ||
          bw_retry_store_ordinal>=bw_last_ack_ordinal ||
          bw_fault_store_attempts!=2 || bw_reload_attempts!=1 ||
          bw_iret_attempts!=1 || bw_shadow_attempts!=1 ||
          bw_irq_deliveries!=1 || bw_irq_entry_eip!=0x7f1c ||
          result.cs!=8 || result.eip!=0x7fab)
        bw_slice_fail("first-irq-contract");
      if (!bw_cpu3_paged_events_set_irq_line(0,0x20)) bw_slice_fail("first-irq-clear");
      phase=2;
    } else if (phase==2 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_HALT) {
      if (!result.if_flag || result.pending_irq)
        bw_slice_fail("first-halt-contract");
      idle_first_ticks=bw_ticks;
      idle_first_attempts=bw_attempts;
      idle_first_completed=bw_completed;
      idle_first_activity=result.activity_state;
      idle_first_eip=result.eip;
      phase=21;
    } else if (phase==21 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_HALT) {
      if (result.charged_ticks || !result.if_flag || result.pending_irq ||
          bw_ticks!=idle_first_ticks || bw_attempts!=idle_first_attempts ||
          bw_completed!=idle_first_completed ||
          result.activity_state!=idle_first_activity ||
          result.eip!=idle_first_eip)
        bw_slice_fail("first-zero-tick-idle-contract");
      if (!bw_cpu3_paged_events_set_irq_line(1,0x20)) bw_slice_fail("second-irq-set");
      phase=3;
    } else if (phase==3 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_IRQ_DELIVERED) {
      if (bw_irq_deliveries!=2 || bw_irq_entry_eip!=0x7f2b ||
          result.cs!=8 || result.eip!=0x7fab)
        bw_slice_fail("second-irq-contract");
      if (!bw_cpu3_paged_events_set_irq_line(0,0x20)) bw_slice_fail("second-irq-clear");
      phase=4;
    } else if (phase==4 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_HALT) {
      if (result.if_flag || bw_ports!=7 || result.pending_irq)
        bw_slice_fail("terminal-halt-contract");
      idle_first_ticks=bw_ticks;
      idle_first_attempts=bw_attempts;
      idle_first_completed=bw_completed;
      idle_first_activity=result.activity_state;
      idle_first_eip=result.eip;
      phase=41;
    } else if (phase==41 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_HALT) {
      if (result.charged_ticks || result.if_flag || result.pending_irq ||
          bw_ticks!=idle_first_ticks || bw_attempts!=idle_first_attempts ||
          bw_completed!=idle_first_completed ||
          result.activity_state!=idle_first_activity ||
          result.eip!=idle_first_eip)
        bw_slice_fail("terminal-zero-tick-idle-contract");
      if (!bw_cpu3_paged_events_set_irq_line(1,0x20)) bw_slice_fail("masked-irq-set");
      phase=5;
    } else if (phase==5 && result.reason==BW_CPU3_PAGED_EVENTS_SLICE_HALT) {
      if (result.charged_ticks || result.if_flag || !result.pending_irq ||
          bw_irq_deliveries!=2 || bw_faults!=1 || !bw_retry_store_seen ||
          result.cs!=8 || result.eip!=0x7f50)
        bw_slice_fail("masked-halt-contract");
      if (bw_fault_store_attempts!=2 || bw_pf_handler_attempts!=1 ||
          bw_reload_attempts!=1 || bw_iret_attempts!=1 ||
          bw_shadow_attempts!=1 || bw_irq_handler_attempts!=2 ||
          bw_read_le32(0x9000)!=0x0000a023 ||
          bw_read_le32(0xa014)!=0x00005063 ||
          bw_read_le32(0x5000)!=0x11223344 ||
          bw_read_le32(0x0520)!=0x5000 ||
          bw_ram[0x0524]!=1 || bw_ram[0x0530]!=1 ||
          bw_ram[0x0534]!=2 || bw_read_le32(0xb000)!=0 ||
          bw_read_le32(0xbffc)!=0 ||
          bw_read_le32(0x0540)!=0x7f1c ||
          (bw_read_le32(0x0544)&0xffff)!=8 ||
          (bw_read_le32(0x0548)&0x00037fd7)!=0x246 ||
          bw_read_le32(0x0550)!=0x7f2b ||
          (bw_read_le32(0x0554)&0xffff)!=8 ||
          (bw_read_le32(0x0558)&0x00037fd7)!=0x246)
        bw_slice_fail("final-paged-event-contract");
      if (!bw_cpu3_paged_events_set_irq_line(0,0x20)) bw_slice_fail("masked-irq-clear");
      fprintf(stderr,"BWS5\tFINAL\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%08x\t%08x\t%08x\t%08x\t%02x\t%02x"
        "\t%02x\t%08x\t%08x\t%08x\t%08x\t%08x"
        "\t%08x\t%08x\t%08x\n",
        bw_ticks,bw_attempts,bw_completed,bw_rep_iterations,bw_faults,
        bw_ports,bw_irq_deliveries,bw_halt_idle_cuts,
        bw_read_le32(0x9000),bw_read_le32(0xa014),
        bw_read_le32(0x5000),bw_read_le32(0x0520),
        (unsigned)bw_ram[0x0524],
        (unsigned)bw_ram[0x0530],(unsigned)bw_ram[0x0534],
        bw_read_le32(0xb000),bw_read_le32(0xbffc),
        bw_read_le32(0x0540),bw_read_le32(0x0544),bw_read_le32(0x0548),
        bw_read_le32(0x0550),bw_read_le32(0x0554),bw_read_le32(0x0558));
      bw_emit_state("STATE",BX_CPU(0));
      fprintf(stderr,"BWS5\tCALLBACKS\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\n",bw_physical_reads,
        bw_physical_writes,bw_execute_pages,bw_tick_callbacks);
      fprintf(stderr,"BWS5\tFALLBACK\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\n",bw_fallback_ram_reads,
        bw_fallback_ram_writes,bw_fallback_direct_pointers,
        bw_fallback_pio,bw_fallback_timer);
      fflush(stderr);
      bw_slice_active=false;
      fprintf(stderr,"BWS5\tDEACTIVATE\tproof-complete\n");
      return;
    }
    if (result.reason==BW_CPU3_PAGED_EVENTS_SLICE_FAULT && phase!=11)
      bw_slice_fail("unexpected-fault");
    if (phase==0 && bw_ticks>256) bw_slice_fail("deadline-overrun");
  }
  bw_slice_fail("slice-limit");
}
