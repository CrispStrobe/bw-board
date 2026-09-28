// Opt-in, bounded 80386 dynamic-memory slow-exit contract. Not a board backend.
// The host mirrors only existing CPU TLB translations, validates them before
// every call, and proves code/segment/event safety. A TLB miss exits before
// the faultable instruction so the ordinary JS CPU handles the page walk.
#include <stdint.h>

enum { OP_LOAD32=1, OP_STORE32=2 };
enum { EXIT_DONE=0, EXIT_EVENT=1, EXIT_SLOW=2, EXIT_UNSUPPORTED=3 };
enum { TLB_USER=1, TLB_WRITABLE=2, TLB_DIRTY=4, TLB_STORE_OK=8 };

typedef struct { uint32_t regs[8], eip, eflags, cycles; } State;
typedef struct { uint32_t op, reg, base, disp, length; } Instruction;
typedef struct {
  uint32_t valid, page, physical, generation, cr3, cr4, flags;
} Translation;
static State state;
static Instruction program[16];
static Translation tlb[64];
static uint32_t ram_ptr, ram_capacity;

uint32_t dynamic_memory_version(void) { return 1; }
uint32_t dynamic_memory_state_ptr(void) { return (uint32_t)(uintptr_t)&state; }
uint32_t dynamic_memory_program_ptr(void) { return (uint32_t)(uintptr_t)program; }
uint32_t dynamic_memory_capacity(void) { return 16; }
uint32_t dynamic_memory_bind_ram(uint32_t pointer, uint32_t capacity) {
  if (!pointer || capacity!=(1u<<24) || pointer >= (uint32_t)(uintptr_t)&state ||
      capacity > (uint32_t)(uintptr_t)&state - pointer) return 0;
  ram_ptr=pointer; ram_capacity=capacity;
  return 1;
}
void dynamic_memory_clear_tlb(void) {
  for (uint32_t i=0;i<64;i++) tlb[i].valid=0;
}
void dynamic_memory_invalidate(uint32_t page) {
  Translation *entry=&tlb[page & 63u];
  if (entry->valid && entry->page==page) entry->valid=0;
}
void dynamic_memory_mirror(uint32_t page, uint32_t physical,
                           uint32_t generation, uint32_t cr3,
                           uint32_t cr4, uint32_t flags) {
  Translation *entry=&tlb[page & 63u];
  entry->valid=1; entry->page=page; entry->physical=physical;
  entry->generation=generation; entry->cr3=cr3; entry->cr4=cr4;
  entry->flags=flags;
}

// Reason in bits 31..24; completed instructions in bits 23..0.
uint32_t dynamic_memory_run(uint32_t count, uint32_t budget,
                            uint32_t generation, uint32_t cr3,
                            uint32_t cr4, uint32_t user) {
  if (count>16 || budget>16) return EXIT_UNSUPPORTED << 24;
  uint32_t completed=0;
  for (uint32_t pc=0;pc<count;pc++) {
    if (completed>=budget) return (EXIT_EVENT << 24)|completed;
    const Instruction ins=program[pc];
    if ((ins.op!=OP_LOAD32 && ins.op!=OP_STORE32) ||
        ins.reg>=8 || ins.base>=8 || ins.length!=2)
      return (EXIT_UNSUPPORTED << 24)|completed;
    const uint32_t linear=state.regs[ins.base]+ins.disp;
    if ((linear & 4095u)>4092u) return (EXIT_SLOW << 24)|completed;
    const uint32_t page=linear>>12;
    const Translation entry=tlb[page & 63u];
    if (!entry.valid || entry.page!=page || entry.generation!=generation ||
        entry.cr3!=cr3 || entry.cr4!=cr4 ||
        (user && !(entry.flags & TLB_USER)) ||
        (ins.op==OP_STORE32 &&
         (entry.flags & (TLB_WRITABLE|TLB_DIRTY|TLB_STORE_OK)) !=
           (TLB_WRITABLE|TLB_DIRTY|TLB_STORE_OK)))
      return (EXIT_SLOW << 24)|completed;
    const uint32_t physical=entry.physical+(linear & 4095u);
    if (entry.physical<0x100000u || entry.physical>ram_capacity-4096u ||
        physical<entry.physical || physical+4u>entry.physical+4096u)
      return (EXIT_SLOW << 24)|completed;
    uint8_t *ram=(uint8_t *)(uintptr_t)(ram_ptr+physical);
    if (ins.op==OP_LOAD32) {
      uint32_t value=0;
      for (uint32_t i=0;i<4;i++) value|=(uint32_t)ram[i]<<(8u*i);
      state.regs[ins.reg]=value;
    } else {
      const uint32_t value=state.regs[ins.reg];
      for (uint32_t i=0;i<4;i++) ram[i]=(uint8_t)(value>>(8u*i));
    }
    state.eip+=ins.length;
    state.cycles++;
    completed++;
  }
  return completed;
}
