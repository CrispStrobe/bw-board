// Owned, bounded Bochs CPU-level-3 fixture probe. This replaces only
// instrument/stubs/instrument.cc in a separate pinned Bochs build; the
// upstream stubs/instrument.h and its callback declarations remain intact.
#include <stdio.h>

#include "bochs.h"
#include "cpu/cpu.h"

static const char marker[] = "BHVK003";
static unsigned marker_pos = 0;
static unsigned events = 0;
static unsigned instruction = 0;
static bool armed = false;
static bool pending_checkpoint = false;
static bool stopped = false;
static const unsigned max_events = 100000;

static void event(const char *kind, unsigned long long a,
                  unsigned long long b, unsigned c, unsigned d, unsigned e)
{
  if (!armed || pending_checkpoint || stopped) return;
  if (++events > max_events) {
    fprintf(stderr, "BW386O1\tERROR\tevent-limit\n");
    stopped = true;
    return;
  }
  fprintf(stderr, "BW386O1\tEVENT\t%u\t%u\t%s\t%llx\t%llx\t%x\t%x\t%x\n",
          events, instruction, kind, a, b, c, d, e);
}

static void segment(const char *name, const bx_segment_reg_t *seg)
{
  const bx_descriptor_t *cache = &seg->cache;
  // An invalid cache has no architectural base/limit or attributes.
  fprintf(stderr, "BW386O1\tSEG\t%s\t%04x\t%x\t%x\t%x\t%x\t%x\t%x\t%x\t%x\t%x\n",
          name, (unsigned) seg->selector.value, cache->valid,
          cache->valid ? (unsigned) cache->u.segment.base : 0,
          cache->valid ? (unsigned) cache->u.segment.limit_scaled : 0,
          cache->valid ? (unsigned) cache->p : 0,
          cache->valid ? (unsigned) cache->dpl : 0,
          cache->valid ? (unsigned) cache->segment : 0,
          cache->valid ? (unsigned) cache->type : 0,
          cache->valid ? (unsigned) cache->u.segment.g : 0,
          cache->valid ? (unsigned) cache->u.segment.d_b : 0);
}

static void checkpoint(unsigned cpu_id)
{
  BX_CPU_C *cpu = BX_CPU(cpu_id);
  fprintf(stderr,
          "BW386O1\tSTATE\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x"
          "\t%08x\t%08x\t%08x\t%08x\t%08x\n",
          (unsigned) cpu->get_reg32(0), (unsigned) cpu->get_reg32(1),
          (unsigned) cpu->get_reg32(2), (unsigned) cpu->get_reg32(3),
          (unsigned) cpu->get_reg32(4), (unsigned) cpu->get_reg32(5),
          (unsigned) cpu->get_reg32(6), (unsigned) cpu->get_reg32(7),
          (unsigned) cpu->get_instruction_pointer(), (unsigned) cpu->read_eflags(),
          (unsigned) cpu->cr0.get32(), (unsigned) cpu->cr2, (unsigned) cpu->cr3);
  fprintf(stderr, "BW386O1\tDEBUG\t%08x\t%08x\t%08x\t%08x\t%08x\t%08x\n",
          (unsigned) cpu->dr[0], (unsigned) cpu->dr[1],
          (unsigned) cpu->dr[2], (unsigned) cpu->dr[3],
          (unsigned) cpu->dr6.get32(), (unsigned) cpu->dr7.get32());
  fprintf(stderr, "BW386O1\tTABLE\t%08x\t%04x\t%08x\t%04x\n",
          (unsigned) cpu->gdtr.base, (unsigned) cpu->gdtr.limit,
          (unsigned) cpu->idtr.base, (unsigned) cpu->idtr.limit);
  fprintf(stderr, "BW386O1\tSCHED\t%x\t%llu\t%llu\n",
          cpu->inhibit_mask, (unsigned long long) cpu->inhibit_icount,
          (unsigned long long) cpu->icount);
  segment("es", &cpu->sregs[BX_SEG_REG_ES]);
  segment("cs", &cpu->sregs[BX_SEG_REG_CS]);
  segment("ss", &cpu->sregs[BX_SEG_REG_SS]);
  segment("ds", &cpu->sregs[BX_SEG_REG_DS]);
  segment("fs", &cpu->sregs[BX_SEG_REG_FS]);
  segment("gs", &cpu->sregs[BX_SEG_REG_GS]);
  segment("ldtr", &cpu->ldtr);
  segment("tr", &cpu->tr);
  fprintf(stderr, "BW386O1\tEND\t%s\t%u\t%u\n", marker, instruction, events);
  fflush(stderr);
  stopped = true;
}

void bx_instr_init_env(void) {}
void bx_instr_exit_env(void) {}
void bx_instr_initialize(unsigned cpu) {}
void bx_instr_exit(unsigned cpu) {}
void bx_instr_reset(unsigned cpu, unsigned type)
{
  armed = pending_checkpoint = stopped = false;
  marker_pos = events = instruction = 0;
}
void bx_instr_hlt(unsigned cpu) {}
void bx_instr_mwait(unsigned cpu, bx_phy_address addr, unsigned len, Bit32u flags) {}
void bx_instr_debug_promt() {}
void bx_instr_debug_cmd(const char *cmd) {}
void bx_instr_cnear_branch_taken(unsigned cpu, bx_address old_eip, bx_address new_eip) {}
void bx_instr_cnear_branch_not_taken(unsigned cpu, bx_address old_eip) {}
void bx_instr_ucnear_branch(unsigned cpu, unsigned what, bx_address old_eip, bx_address new_eip) {}
void bx_instr_far_branch(unsigned cpu, unsigned what, Bit16u old_cs, bx_address old_eip, Bit16u new_cs, bx_address new_eip) {}
void bx_instr_opcode(unsigned cpu, bxInstruction_c *i, const Bit8u *opcode, unsigned len, bool is32, bool is64) {}
void bx_instr_tlb_cntrl(unsigned cpu, unsigned what, bx_phy_address value) {}
void bx_instr_clflush(unsigned cpu, bx_address linear, bx_phy_address physical) {}
void bx_instr_cache_cntrl(unsigned cpu, unsigned what) {}
void bx_instr_prefetch_hint(unsigned cpu, unsigned what, unsigned seg, bx_address offset) {}
void bx_instr_repeat_iteration(unsigned cpu, bxInstruction_c *i) {}
void bx_instr_wrmsr(unsigned cpu, unsigned addr, Bit64u value) {}
void bx_instr_vmexit(unsigned cpu, Bit32u reason, Bit64u qualification) {}

void bx_instr_before_execution(unsigned cpu, bxInstruction_c *i)
{
  if (cpu != 0 || stopped) return;
  if (pending_checkpoint) { checkpoint(cpu); return; }
  if (!armed) return;
  ++instruction;
  BX_CPU_C *c = BX_CPU(cpu);
  event("instruction", c->sregs[BX_SEG_REG_CS].selector.value,
        c->get_instruction_pointer(), 0, 0, 0);
}
void bx_instr_after_execution(unsigned cpu, bxInstruction_c *i) {}
void bx_instr_interrupt(unsigned cpu, unsigned vector)
{
  if (cpu == 0) event("interrupt", vector, 0, 0, 0, 0);
}
void bx_instr_exception(unsigned cpu, unsigned vector, unsigned error_code)
{
  if (cpu == 0) event("exception", vector, error_code, 0, 0, 0);
}
void bx_instr_hwinterrupt(unsigned cpu, unsigned vector, Bit16u cs, bx_address eip)
{
  if (cpu == 0) event("hardware-interrupt", vector, eip, cs, 0, 0);
}
void bx_instr_lin_access(unsigned cpu, bx_address lin, bx_phy_address phy,
                         unsigned len, unsigned memtype, unsigned rw)
{
  if (cpu == 0) event("linear-access", lin, phy, len, memtype, rw);
}
void bx_instr_phy_access(unsigned cpu, bx_address phy,
                         unsigned len, unsigned memtype, unsigned rw)
{
  if (cpu == 0) event("physical-access", phy, 0, len, memtype, rw);
}
void bx_instr_inp(Bit16u addr, unsigned len) {}
void bx_instr_inp2(Bit16u addr, unsigned len, unsigned val)
{
  event("port-read", addr, val, len, 0, 0);
}
void bx_instr_outp(Bit16u addr, unsigned len, unsigned val)
{
  if (!armed) {
    BX_CPU_C *cpu = BX_CPU(0);
    if (addr != 0xe9 || len != 1 || (val & 255) != 'B' ||
        cpu->sregs[BX_SEG_REG_CS].selector.value != 0 ||
        cpu->cr0.get_PE() || cpu->get_instruction_pointer() < 0x7e00 ||
        cpu->get_instruction_pointer() >= 0x8600) return;
    armed = true;
    marker_pos = 1;
    fprintf(stderr, "BW386O1\tBEGIN\tvm-task\tBHVK003\n");
    event("port-write", addr, val, len, 0, 0);
    return;
  }
  event("port-write", addr, val, len, 0, 0);
  if (addr != 0xe9 || len != 1 || stopped) return;
  if (marker_pos >= sizeof(marker)-1 || (val & 255) != (unsigned char) marker[marker_pos]) {
    if (marker_pos != 1 || (val & 255) != 'B') {
      fprintf(stderr, "BW386O1\tERROR\tmarker-mismatch\n");
      stopped = true;
    }
    return;
  }
  if (++marker_pos == sizeof(marker)-1) pending_checkpoint = true;
}
