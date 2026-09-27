// Copyright (c) 2026 Brickwright contributors. MIT license.
// Bounded execution-contract spike: prevalidated register-only x86 IR.
#include <stdint.h>

enum { OP_NOP=0, OP_MOV=1, OP_CMP=2, OP_TEST=3,
       OP_JZ=4, OP_JNZ=5, OP_JMP=6,
       OP_UNSUPPORTED=254, OP_FAULT_BOUNDARY=255 };
enum { EXIT_DONE=0, EXIT_EVENT=1, EXIT_UNSUPPORTED=2, EXIT_FAULT_BOUNDARY=3 };
enum { CF=1, PF=4, AF=16, ZF=64, SF=128, OF=2048 };

typedef struct {
  uint32_t regs[8]; // EAX, ECX, EDX, EBX, ESP, EBP, ESI, EDI
  uint32_t eip, eflags, cycles;
} State;
typedef struct { uint32_t op, dst, src, width, length; } Instruction;

static State state;
static Instruction program[64];

uint32_t block_spike_version(void) { return 2; }
uint32_t block_spike_state_ptr(void) { return (uint32_t)(uintptr_t)&state; }
uint32_t block_spike_program_ptr(void) { return (uint32_t)(uintptr_t)program; }
uint32_t block_spike_capacity(void) { return 64; }

static uint32_t even_parity(uint32_t value) {
  value ^= value >> 4;
  value &= 15;
  return (0x9669u >> value) & 1u;
}
static uint32_t read_reg(uint32_t index, uint32_t width) {
  const uint32_t value = state.regs[index];
  return width == 16 ? value & 0xffffu : value;
}
static void write_reg(uint32_t index, uint32_t width, uint32_t value) {
  state.regs[index] = width == 16
    ? (state.regs[index] & 0xffff0000u) | (value & 0xffffu) : value;
}
static void logic_flags(uint32_t value, uint32_t width) {
  const uint32_t mask = width == 16 ? 0xffffu : 0xffffffffu;
  const uint32_t sign = width == 16 ? 0x8000u : 0x80000000u;
  const uint32_t result = value & mask;
  state.eflags &= ~(CF | PF | AF | ZF | SF | OF);
  if (!result) state.eflags |= ZF;
  if (result & sign) state.eflags |= SF;
  if (even_parity(result & 0xffu)) state.eflags |= PF;
}
static void cmp_flags(uint32_t left, uint32_t right, uint32_t width) {
  const uint32_t mask = width == 16 ? 0xffffu : 0xffffffffu;
  const uint32_t sign = width == 16 ? 0x8000u : 0x80000000u;
  left &= mask; right &= mask;
  const uint32_t result = (left - right) & mask;
  state.eflags &= ~(CF | PF | AF | ZF | SF | OF);
  if (left < right) state.eflags |= CF;
  if ((left ^ right ^ result) & 0x10u) state.eflags |= AF;
  if (!result) state.eflags |= ZF;
  if (result & sign) state.eflags |= SF;
  if (even_parity(result & 0xffu)) state.eflags |= PF;
  if (((left ^ right) & (left ^ result) & sign) != 0) state.eflags |= OF;
}

// Return reason in bits 31..24 and completed guest instructions in 23..0.
// The caller must validate code bytes, paging, CS bounds, and code-page
// versions before filling this IR. This kernel never reads guest memory.
uint32_t block_spike_run(uint32_t start, uint32_t end, uint32_t event_budget) {
  if (start > end || end > 64) return EXIT_UNSUPPORTED << 24;
  uint32_t completed = 0;
  for (uint32_t pc = start; pc < end;) {
    if (completed >= event_budget) return (EXIT_EVENT << 24) | completed;
    const Instruction ins = program[pc];
    if (ins.op == OP_FAULT_BOUNDARY)
      return (EXIT_FAULT_BOUNDARY << 24) | completed;
    const uint32_t branch = ins.op >= OP_JZ && ins.op <= OP_JMP;
    if (ins.op > OP_JMP ||
        (branch ? (ins.dst < start || ins.dst >= end) :
          (ins.dst >= 8 || ins.src >= 8 || (ins.width != 16 && ins.width != 32))) ||
        ins.length == 0 || ins.length > 15)
      return (EXIT_UNSUPPORTED << 24) | completed;
    if (branch) {
      const uint32_t taken = ins.op == OP_JMP ||
        (ins.op == OP_JZ ? !!(state.eflags & ZF) : !(state.eflags & ZF));
      if (taken) { state.eip = ins.src; pc = ins.dst; }
      else { state.eip += ins.length; pc++; }
    } else {
      const uint32_t dst = read_reg(ins.dst, ins.width);
      const uint32_t src = read_reg(ins.src, ins.width);
      if (ins.op == OP_MOV) write_reg(ins.dst, ins.width, src);
      else if (ins.op == OP_CMP) cmp_flags(dst, src, ins.width);
      else if (ins.op == OP_TEST) logic_flags(dst & src, ins.width);
      state.eip += ins.length;
      pc++;
    }
    state.cycles++;
    completed++;
  }
  return completed;
}
