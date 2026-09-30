/* Included once at the end of cpu.cc in the separately prepared CPU3 tree. */
#include <inttypes.h>
#include <limits.h>

bool bw_slice_active = false;
bool bw_slice_port_pending = false;
bool bw_slice_rep_incomplete = false;
bool bw_slice_fault_pending = false;

static unsigned char bw_ram[1024 * 1024];
static bw_cpu3_host_callbacks bw_callbacks;
static uint32_t bw_budget;
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
static unsigned bw_last_port;
static unsigned bw_last_value;
static unsigned bw_last_width;
static bool bw_port_committed_this_slice;
static bool bw_halted;
static uint64_t bw_physical_reads;
static uint64_t bw_physical_writes;
static uint64_t bw_execute_pages;
static uint64_t bw_tick_callbacks;

void bw_slice_fail(const char *kind)
{
  fprintf(stderr, "BWS3\tFAIL\t%s\n", kind);
  fflush(stderr);
  abort();
}

static bool bw_range_ok(unsigned long long address, unsigned length)
{
  return length && address < sizeof(bw_ram) &&
    length <= sizeof(bw_ram) - address &&
    ((address & 4095) + length <= 4096);
}

static int bw_host_read(void *, uint32_t address, uint8_t *data, uint32_t length)
{
  if (!bw_range_ok(address, length)) return 0;
  memcpy(data, bw_ram + address, length);
  return 1;
}

static int bw_host_write(void *, uint32_t address, const uint8_t *data,
                         uint32_t length)
{
  if (!bw_range_ok(address, length)) return 0;
  memcpy(bw_ram + address, data, length);
  // Host RAM replaces Bochs RAM, but decoded code still uses Bochs write stamps.
  pageWriteStampTable.decWriteStamp(address, length);
  fprintf(stderr, "BWS3\tWRITE\t%08x\t", address);
  for (uint32_t i = 0; i < length; ++i) fprintf(stderr, "%02x", data[i]);
  fprintf(stderr, "\t%" PRIu64 "\t%" PRIu64 "\n", bw_ticks, ++bw_ordinal);
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
  fprintf(stderr, "BWS3\tPORT\t%04x\t%u\t%08x\t%" PRIu64
    "\t%" PRIu64 "\n", port, width, value, bw_ticks, ++bw_ordinal);
  bw_last_port = port;
  bw_last_width = width;
  bw_last_value = value;
  return 1;
}

static int bw_host_tick(void *, uint32_t)
{
  return 1; // No hardware event is injected in this owned fixture.
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
  ++bw_tick_callbacks;
  bw_slice_ticks += count;
  bw_ticks += count;
}

void bw_slice_note_attempt(void)
{
  if (bw_slice_active) {
    bw_slice_rep_incomplete = false;
    ++bw_attempts;
  }
}
bool bw_slice_ticks_reached(void)
{
  return bw_slice_active && bw_slice_ticks >= bw_budget;
}
bool bw_slice_should_yield(void)
{
  return bw_slice_active &&
    (bw_slice_ticks >= bw_budget || bw_slice_port_pending || bw_halted);
}
void bw_slice_note_halt(void) { if (bw_slice_active) bw_halted = true; }
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
  ++bw_faults;
  bw_fault_vector = vector;
  bw_fault_error = error_code;
  bw_fault_tick = bw_ticks;
  bw_fault_ordinal = ++bw_ordinal;
  bw_slice_fault_pending = true;
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
  bw_slice_active = true;
  cpu->TLB_flush(); // Also invalidates the prefetch queue.
  cpu->iCache.flushICacheEntries();
  fprintf(stderr, "BWS3\tACTIVATE\t0000\t00007e00\t1048576\n");
}

static void bw_fill_result(bw_cpu3_slice_result *result, unsigned reason)
{
  result->reason = reason;
  result->requested_ticks = bw_budget;
  result->charged_ticks = bw_slice_ticks;
  result->attempts = bw_attempts;
  result->completed = bw_completed;
  result->rep_iterations = bw_rep_iterations;
  result->rep_partial = bw_rep_partial;
  result->faults = bw_faults;
  result->port_commits = bw_ports;
  result->cs = BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
  result->eip = BX_CPU(0)->get_eip();
  result->pending_fault = bw_slice_fault_pending ? 1 : 0;
  result->port_committed = bw_port_committed_this_slice ? 1 : 0;
}

extern "C" int bw_cpu3_resume(uint32_t max_ticks,
  const bw_cpu3_host_callbacks *callbacks, bw_cpu3_slice_result *result)
{
  if (result) memset(result, 0, sizeof(*result));
  if (!result || !bw_slice_active || !max_ticks || !callbacks ||
      !callbacks->read_physical || !callbacks->write_physical ||
      !callbacks->execute_page || !callbacks->port_in ||
      !callbacks->port_out || !callbacks->tick) return 0;
  bw_callbacks = *callbacks;
  bw_budget = max_ticks;
  bw_slice_ticks = 0;
  bw_port_committed_this_slice = false;
  bw_slice_fault_pending = false;
  bw_halted = false;
  BX_CPU(0)->cpu_loop();
  const unsigned reason = bw_slice_fault_pending ? BW_CPU3_SLICE_FAULT :
    bw_halted ? BW_CPU3_SLICE_HALT :
    bw_slice_port_pending ? BW_CPU3_SLICE_PORT : BW_CPU3_SLICE_BUDGET;
  bw_fill_result(result, reason);
  bw_slice_port_pending = false;
  return 1;
}

void bw_slice_driver(void)
{
  const char *raw = getenv("BW_CPU3_SLICE_BUDGET");
  const uint32_t budget = !raw || !strcmp(raw,"continuous") ? UINT32_MAX :
    (uint32_t) strtoul(raw, 0, 10);
  if (budget != 1 && budget != 2 && budget != 257 && budget != UINT32_MAX)
    bw_slice_fail("driver-budget");
  for (unsigned slice = 0; slice < 100000; ++slice) {
    const unsigned entry_cs = BX_CPU(0)->sregs[BX_SEG_REG_CS].selector.value;
    const unsigned entry_eip = BX_CPU(0)->get_eip();
    bw_cpu3_slice_result result;
    if (!bw_cpu3_resume(budget, &bw_callbacks, &result)) bw_slice_fail("resume");
    fprintf(stderr, "BWS3\tSLICE\t%u\t%u\t%u\t%u\t%08x\t%u\t%08x"
      "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
      "\t%" PRIu64 "\t%" PRIu64 "\t%u\t%u\n",
      budget,result.charged_ticks,result.reason,entry_cs,entry_eip,
      result.cs,result.eip,result.attempts,result.completed,
      result.rep_iterations,result.rep_partial,result.faults,
      result.port_commits,result.pending_fault,result.port_committed);
    if (result.reason == BW_CPU3_SLICE_FAULT) {
      const uint32_t *frame = (const uint32_t *)(bw_ram + 0x6ff0);
      fprintf(stderr,"BWS3\tFAULT\t%u\t%u\t%08x\t%08x\t%08x\t%08x\t%08x"
        "\t%08x\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\n", bw_fault_vector,bw_fault_error,
        (unsigned) BX_CPU(0)->cr2,frame[0],frame[1],frame[2],frame[3],
        result.eip,bw_fault_tick,bw_ticks,bw_fault_ordinal);
    }
    if (bw_ports == 7) {
      fprintf(stderr,"BWS3\tFINAL\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\t%" PRIu64 "\t%08x\t%08x\t%08x\t%08x\n",
        bw_ticks,bw_attempts,bw_completed,bw_rep_iterations,bw_faults,
        bw_ports,*(uint32_t *)(bw_ram+0x9000),*(uint32_t *)(bw_ram+0xa014),
        *(uint32_t *)(bw_ram+0x5000),*(uint32_t *)(bw_ram+0x0520));
      BX_CPU_C *cpu = BX_CPU(0);
      fprintf(stderr,"BWS3\tSTATE\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x"
        "\t%08x\t%08x\t%08x\t%08x\t%08x\t%04x\t%04x\t%04x"
        "\t%08x\t%04x\t%08x\t%04x\n",
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
      fprintf(stderr,"BWS3\tCALLBACKS\t%" PRIu64 "\t%" PRIu64
        "\t%" PRIu64 "\t%" PRIu64 "\n",bw_physical_reads,
        bw_physical_writes,bw_execute_pages,bw_tick_callbacks);
      fflush(stderr);
      return;
    }
    if (result.reason == BW_CPU3_SLICE_HALT) bw_slice_fail("unexpected-halt");
  }
  bw_slice_fail("slice-limit");
}
