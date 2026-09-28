// Standalone proof of a nonterminal branch side exit in a bounded native trace.
// No production dispatcher calls this module; it has no guest memory accesses.
#include <stdint.h>

enum { OP_NOP = 0, OP_JNZ = 1 };
enum { EXIT_DONE = 0, EXIT_EVENT = 1, EXIT_SIDE = 2, EXIT_UNSUPPORTED = 3 };
enum { ZF = 64 };

typedef struct {
  uint32_t regs[8];
  uint32_t eip, eflags, cycles;
} State;
typedef struct {
  uint32_t op, length, target, reserved;
} Instruction;

static State state;
static Instruction program[4];

uint32_t trace_spike_version(void) { return 1; }
uint32_t trace_spike_state_ptr(void) { return (uint32_t)(uintptr_t)&state; }
uint32_t trace_spike_program_ptr(void) { return (uint32_t)(uintptr_t)program; }

// Result: reason in bits 31..24, retired instructions in bits 23..0.
uint32_t trace_spike_run(uint32_t count, uint32_t budget) {
  if (count > 4 || budget > 64) return EXIT_UNSUPPORTED << 24;
  uint32_t completed = 0;
  for (uint32_t pc = 0; pc < count;) {
    if (completed >= budget) return (EXIT_EVENT << 24) | completed;
    const Instruction ins = program[pc];
    if (ins.op == OP_NOP && ins.length == 1) {
      state.eip++;
      pc++;
    } else if (ins.op == OP_JNZ && ins.length == 2) {
      if (!(state.eflags & ZF)) {
        state.eip = ins.target;
        state.cycles++;
        completed++;
        return (EXIT_SIDE << 24) | completed;
      }
      state.eip += 2;
      pc++;
    } else return (EXIT_UNSUPPORTED << 24) | completed;
    state.cycles++;
    completed++;
  }
  return (EXIT_DONE << 24) | completed;
}
