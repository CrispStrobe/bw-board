// Bounded 16-bit code block over host-proved physical read addresses.
#include <stdint.h>

enum { NOP=0, MOV_IMM16=1, MOV_REG16=2, CMP_REG16=3,
       LOAD8=4, LOAD16=5, JZ=6, JNZ=7, CMP_MEM8=8, XOR_REG16=9 };
enum { DONE=0, EVENT=1, UNSUPPORTED=2, BOUNDARY=3 };
enum { CF=1, PF=4, AF=16, ZF=64, SF=128, OF=2048 };
typedef struct { uint32_t regs[8], eip, eflags, cycles; } State;
typedef struct {
  uint32_t op, dst, src, length, base, index, disp,
    expected_offset, physical0, physical1, target, target_limit;
} Instruction;
static State state;
static Instruction program[64];
static uint32_t ram_ptr, ram_capacity;

uint32_t code16_wasm_version(void) { return 2; }
uint32_t code16_wasm_state_ptr(void) { return (uint32_t)(uintptr_t)&state; }
uint32_t code16_wasm_program_ptr(void) { return (uint32_t)(uintptr_t)program; }
uint32_t code16_wasm_capacity(void) { return 64; }
uint32_t code16_wasm_bind_ram(uint32_t pointer, uint32_t capacity) {
  if (!pointer || !capacity || pointer >= (uint32_t)(uintptr_t)&state ||
      capacity > (uint32_t)(uintptr_t)&state - pointer) return 0;
  ram_ptr = pointer; ram_capacity = capacity;
  return 1;
}
static uint32_t parity(uint32_t value) {
  value ^= value >> 4;
  return (0x9669u >> (value & 15u)) & 1u;
}
static void cmp16(uint32_t left, uint32_t right) {
  left &= 0xffffu; right &= 0xffffu;
  const uint32_t result = (left - right) & 0xffffu;
  state.eflags &= ~(CF | PF | AF | ZF | SF | OF);
  if (left < right) state.eflags |= CF;
  if ((left ^ right ^ result) & 16u) state.eflags |= AF;
  if (!result) state.eflags |= ZF;
  if (result & 0x8000u) state.eflags |= SF;
  if (parity(result & 255u)) state.eflags |= PF;
  if ((left ^ right) & (left ^ result) & 0x8000u) state.eflags |= OF;
}
static void cmp8(uint32_t left, uint32_t right) {
  left &= 255u; right &= 255u;
  const uint32_t result = (left - right) & 255u;
  state.eflags &= ~(CF | PF | AF | ZF | SF | OF);
  if (left < right) state.eflags |= CF;
  if ((left ^ right ^ result) & 16u) state.eflags |= AF;
  if (!result) state.eflags |= ZF;
  if (result & 128u) state.eflags |= SF;
  if (parity(result)) state.eflags |= PF;
  if ((left ^ right) & (left ^ result) & 128u) state.eflags |= OF;
}
static uint32_t read8(uint32_t index) {
  const uint32_t shift = index < 4u ? 0u : 8u;
  return (state.regs[index & 3u] >> shift) & 255u;
}
static void write16(uint32_t index, uint32_t value) {
  state.regs[index] = (state.regs[index] & 0xffff0000u) | (value & 0xffffu);
}
static void xor16(uint32_t dst, uint32_t src) {
  const uint32_t result = (state.regs[dst] ^ state.regs[src]) & 0xffffu;
  write16(dst, result);
  state.eflags &= ~(CF | PF | AF | ZF | SF | OF);
  if (!result) state.eflags |= ZF;
  if (result & 0x8000u) state.eflags |= SF;
  if (parity(result & 255u)) state.eflags |= PF;
}
static void write8(uint32_t index, uint32_t value) {
  const uint32_t reg = index & 3u;
  const uint32_t shift = index < 4u ? 0u : 8u;
  state.regs[reg] = (state.regs[reg] & ~(255u << shift)) |
    ((value & 255u) << shift);
}

// A boundary exit commits completed instructions only. The host runs the
// ordinary interpreter at state.eip for the refused instruction.
uint32_t code16_wasm_run(uint32_t count, uint32_t budget) {
  if (count > 64u || budget > 64u) return UNSUPPORTED << 24;
  uint32_t completed = 0;
  for (uint32_t pc = 0; pc < count; pc++) {
    if (completed >= budget) return (EVENT << 24) | completed;
    const Instruction ins = program[pc];
    if (!ins.length || ins.length > 15u || ins.dst > 7u || ins.src > 7u ||
        ins.op > XOR_REG16) return (BOUNDARY << 24) | completed;
    if (ins.op == LOAD8 || ins.op == LOAD16 || ins.op == CMP_MEM8) {
      if (ins.base > 8u || ins.index > 8u ||
          ins.physical0 >= ram_capacity ||
          (ins.op == LOAD16 && ins.physical1 >= ram_capacity))
        return (BOUNDARY << 24) | completed;
      uint32_t off = ins.disp;
      if (ins.base < 8u) off += state.regs[ins.base] & 0xffffu;
      if (ins.index < 8u) off += state.regs[ins.index] & 0xffffu;
      if ((off & 0xffffu) != ins.expected_offset)
        return (BOUNDARY << 24) | completed;
      const uint8_t *ram = (const uint8_t *)(uintptr_t)ram_ptr;
      const uint32_t value = ram[ins.physical0] |
        (ins.op == LOAD16 ? (uint32_t)ram[ins.physical1] << 8u : 0u);
      if (ins.op == LOAD8) write8(ins.dst, value);
      else if (ins.op == LOAD16) write16(ins.dst, value);
      else cmp8(read8(ins.dst), value);
    } else if (ins.op == MOV_IMM16) write16(ins.dst, ins.disp);
    else if (ins.op == MOV_REG16) write16(ins.dst, state.regs[ins.src]);
    else if (ins.op == CMP_REG16) cmp16(state.regs[ins.dst], state.regs[ins.src]);
    else if (ins.op == XOR_REG16) xor16(ins.dst, ins.src);
    else if (ins.op == JZ || ins.op == JNZ) {
      const uint32_t taken = ins.op == JZ ? !!(state.eflags & ZF) : !(state.eflags & ZF);
      if (taken) {
        if (ins.target > ins.target_limit)
          return (BOUNDARY << 24) | completed;
        state.eip = ins.target;
      } else state.eip += ins.length;
      state.cycles++; completed++;
      return (DONE << 24) | completed;
    }
    state.eip += ins.length;
    state.cycles++; completed++;
  }
  return (DONE << 24) | completed;
}
