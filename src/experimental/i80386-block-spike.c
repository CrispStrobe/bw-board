// Copyright (c) 2026 Brickwright contributors. MIT license.
// Bounded execution-contract spike: prevalidated x86 IR over shared RAM.
#include <stdint.h>

enum { OP_NOP=0, OP_MOV=1, OP_CMP=2, OP_TEST=3,
       OP_JZ=4, OP_JNZ=5, OP_JMP=6, OP_LOAD_PHYS=7,
       OP_LOAD_WINDOW=8, OP_LEA32=9,
       OP_CMP_IMM=10, OP_MOV_IMM=11,
       OP_ADD_IMM=12, OP_OR_IMM=13, OP_AND_IMM=14,
       OP_SHL_IMM=15, OP_SHR_IMM=16, OP_REP_STOSD=17,
       OP_TEST_AL_IMM8=18, OP_OR_WINDOW=19, OP_REP_MOVSD=20,
       OP_UNSUPPORTED=254, OP_FAULT_BOUNDARY=255 };
enum { EXIT_DONE=0, EXIT_EVENT=1, EXIT_UNSUPPORTED=2, EXIT_FAULT_BOUNDARY=3 };
enum { CF=1, PF=4, AF=16, ZF=64, SF=128, OF=2048 };

typedef struct {
  uint32_t regs[8]; // EAX, ECX, EDX, EBX, ESP, EBP, ESI, EDI
  uint32_t eip, eflags, cycles;
} State;
typedef struct {
  uint32_t op, dst, src, width, length;
  uint32_t base, index, scale, disp, lo, hi;
} Instruction;

static State state;
static Instruction program[64];
static uint32_t ram_ptr, ram_capacity;

uint32_t block_spike_version(void) { return 11; }
uint32_t block_spike_state_ptr(void) { return (uint32_t)(uintptr_t)&state; }
uint32_t block_spike_program_ptr(void) { return (uint32_t)(uintptr_t)program; }
uint32_t block_spike_capacity(void) { return 64; }
uint32_t block_spike_bind_ram(uint32_t pointer, uint32_t capacity) {
  // The host owns translation, RAM/device classification and permission
  // checks. The native kernel only accepts a region below its private state.
  if (pointer == 0 || capacity == 0 || pointer >= (uint32_t)(uintptr_t)&state ||
      capacity > (uint32_t)(uintptr_t)&state - pointer) return 0;
  ram_ptr = pointer; ram_capacity = capacity;
  return 1;
}

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
static uint32_t read_ram(uint32_t address, uint32_t bytes) {
  const uint8_t *p = (const uint8_t *)(uintptr_t)(ram_ptr + address);
  uint32_t value = 0;
  for (uint32_t i = 0; i < bytes; i++) value |= (uint32_t)p[i] << (8u * i);
  return value;
}
static void write_ram32(uint32_t address, uint32_t value) {
  uint8_t *p = (uint8_t *)(uintptr_t)(ram_ptr + address);
  for (uint32_t i = 0; i < 4; i++) p[i] = (uint8_t)(value >> (8u * i));
}
static void logic_flags(uint32_t value, uint32_t width) {
  const uint32_t mask = width == 8 ? 0xffu : width == 16 ? 0xffffu : 0xffffffffu;
  const uint32_t sign = width == 8 ? 0x80u : width == 16 ? 0x8000u : 0x80000000u;
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
static uint32_t add_flags(uint32_t left, uint32_t right, uint32_t width) {
  const uint32_t mask = width == 16 ? 0xffffu : 0xffffffffu;
  const uint32_t sign = width == 16 ? 0x8000u : 0x80000000u;
  left &= mask; right &= mask;
  const uint32_t result = (left + right) & mask;
  state.eflags &= ~(CF | PF | AF | ZF | SF | OF);
  if ((uint64_t)left + right > mask) state.eflags |= CF;
  if ((left ^ right ^ result) & 0x10u) state.eflags |= AF;
  if (!result) state.eflags |= ZF;
  if (result & sign) state.eflags |= SF;
  if (even_parity(result & 0xffu)) state.eflags |= PF;
  if ((~(left ^ right) & (left ^ result) & sign) != 0) state.eflags |= OF;
  return result;
}
static uint32_t shift_flags(uint32_t original, uint32_t count,
                            uint32_t width, uint32_t left) {
  count &= 31u;
  if (!count) return original;
  const uint32_t mask = width == 16 ? 0xffffu : 0xffffffffu;
  const uint32_t sign = width == 16 ? 0x8000u : 0x80000000u;
  uint32_t result, carry;
  original &= mask;
  if (left) {
    carry = count <= width ? (original >> (width - count)) & 1u : 0;
    result = (uint32_t)((uint64_t)original << count) & mask;
  } else {
    carry = count <= width ? (original >> (count - 1u)) & 1u : 0;
    result = count >= width ? 0 : original >> count;
  }
  state.eflags &= ~(CF | PF | ZF | SF | OF);
  if (carry) state.eflags |= CF;
  if (!result) state.eflags |= ZF;
  if (result & sign) state.eflags |= SF;
  if (even_parity(result & 0xffu)) state.eflags |= PF;
  if (count == 1u && (left ? (!!(result & sign) != !!carry) : !!(original & sign)))
    state.eflags |= OF;
  return result;
}

// Return reason in bits 31..24 and completed guest instructions in 23..0.
// The caller must validate code bytes, paging, CS bounds, and code-page
// versions before filling this IR. RAM accesses are permitted only in physical
// windows whose mapping and permissions the host has already proved safe.
uint32_t block_spike_run(uint32_t start, uint32_t end, uint32_t event_budget) {
  if (start > end || end > 64) return EXIT_UNSUPPORTED << 24;
  uint32_t completed = 0;
  for (uint32_t pc = start; pc < end;) {
    if (completed >= event_budget) return (EXIT_EVENT << 24) | completed;
    const Instruction ins = program[pc];
    if (ins.op == OP_FAULT_BOUNDARY)
      return (EXIT_FAULT_BOUNDARY << 24) | completed;
    if (ins.op == OP_REP_STOSD) {
      const uint32_t offset = state.regs[7];
      const uint32_t address = offset + ins.disp;
      if (ins.length != 2 || ins.width != 32 || ins.lo >= ins.hi ||
          ins.hi > ram_capacity || (offset & ~4095u) != ins.base ||
          (offset & 4095u) > 4092u || address < ins.lo ||
          address >= ins.hi || 4u > ins.hi - address)
        return (EXIT_FAULT_BOUNDARY << 24) | completed;
      if (!state.regs[1]) return (EXIT_UNSUPPORTED << 24) | completed;
      write_ram32(address, state.regs[0]);
      state.regs[7] += (state.eflags & 0x400u) ? -4u : 4u;
      state.regs[1]--;
      if (!state.regs[1]) { state.eip += ins.length; pc++; }
      state.cycles++;
      completed++;
      continue;
    }
    if (ins.op == OP_REP_MOVSD) {
      // Destination: base/disp/lo/hi. Source: dst/src/index/scale.
      // Both accesses must fit their proved pages before either is performed.
      const uint32_t source_offset = state.regs[6];
      const uint32_t destination_offset = state.regs[7];
      const uint32_t source_address = source_offset + ins.src;
      const uint32_t destination_address = destination_offset + ins.disp;
      if (ins.length != 2 || ins.width != 32 || !state.regs[1] ||
          ins.index >= ins.scale || ins.scale > ram_capacity ||
          (source_offset & ~4095u) != ins.dst ||
          (source_offset & 4095u) > 4092u ||
          source_address < ins.index || source_address >= ins.scale ||
          4u > ins.scale - source_address ||
          ins.lo >= ins.hi || ins.hi > ram_capacity ||
          (destination_offset & ~4095u) != ins.base ||
          (destination_offset & 4095u) > 4092u ||
          destination_address < ins.lo || destination_address >= ins.hi ||
          4u > ins.hi - destination_address)
        return (EXIT_FAULT_BOUNDARY << 24) | completed;
      const uint32_t value = read_ram(source_address, 4);
      write_ram32(destination_address, value);
      const uint32_t delta = (state.eflags & 0x400u) ? -4u : 4u;
      state.regs[6] += delta;
      state.regs[7] += delta;
      state.regs[1]--;
      if (!state.regs[1]) { state.eip += ins.length; pc++; }
      state.cycles++;
      completed++;
      continue;
    }
    if (ins.op == OP_TEST_AL_IMM8) {
      if (ins.length != 2 || ins.width != 8 || ins.dst != 0 || ins.src > 255u)
        return (EXIT_UNSUPPORTED << 24) | completed;
      logic_flags(state.regs[0] & ins.src, 8);
      state.eip += 2;
      state.cycles++;
      completed++;
      pc++;
      continue;
    }
    const uint32_t branch = ins.op >= OP_JZ && ins.op <= OP_JMP;
    const uint32_t load = ins.op == OP_LOAD_PHYS;
    const uint32_t window_load = ins.op == OP_LOAD_WINDOW || ins.op == OP_OR_WINDOW;
    const uint32_t ea = window_load || ins.op == OP_LEA32;
    const uint32_t immediate = ins.op >= OP_CMP_IMM && ins.op <= OP_SHR_IMM;
    if (ins.op > OP_OR_WINDOW ||
        (branch ? (ins.dst < start || ins.dst > end ||
          (ins.dst == end && pc != end - 1)) :
          (ins.dst >= 8 || (ins.width != 16 && ins.width != 32) ||
            (immediate ? 0 :
              ea ? (ins.base > 8 || ins.index > 8 || ins.scale > 3) :
              (load ? (ram_capacity < ins.width / 8u ||
                ins.src > ram_capacity - ins.width / 8u) : ins.src >= 8)))) ||
        ins.length == 0 || ins.length > 15)
      return (EXIT_UNSUPPORTED << 24) | completed;
    uint32_t address = 0;
    if (ea) {
      const uint32_t base = ins.base < 8 ? state.regs[ins.base] : 0;
      const uint32_t index = ins.index < 8 ? state.regs[ins.index] : 0;
      address = base + (index << ins.scale) + ins.disp;
      if (window_load &&
          (ins.lo >= ins.hi || ins.hi > ram_capacity ||
            address < ins.lo || address >= ins.hi ||
            ins.width / 8u > ins.hi - address))
        return (EXIT_UNSUPPORTED << 24) | completed;
    }
    if (branch) {
      const uint32_t taken = ins.op == OP_JMP ||
        (ins.op == OP_JZ ? !!(state.eflags & ZF) : !(state.eflags & ZF));
      if (taken) { state.eip = ins.src; pc = ins.dst; }
      else { state.eip += ins.length; pc++; }
    } else {
      const uint32_t dst = read_reg(ins.dst, ins.width);
      const uint32_t src = immediate ? ins.src :
        load ? read_ram(ins.src, ins.width / 8u) :
        window_load ? read_ram(address, ins.width / 8u) :
        ea ? address : read_reg(ins.src, ins.width);
      if (ins.op == OP_MOV || ins.op == OP_MOV_IMM)
        write_reg(ins.dst, ins.width, src);
      else if (ins.op == OP_OR_WINDOW) {
        const uint32_t result = dst | src;
        logic_flags(result, ins.width);
        write_reg(ins.dst, ins.width, result);
      }
      else if (load || ea) write_reg(ins.dst, ins.width, src);
      else if (ins.op == OP_CMP || ins.op == OP_CMP_IMM)
        cmp_flags(dst, src, ins.width);
      else if (ins.op == OP_TEST) logic_flags(dst & src, ins.width);
      else if (ins.op == OP_ADD_IMM)
        write_reg(ins.dst, ins.width, add_flags(dst, src, ins.width));
      else if (ins.op == OP_OR_IMM || ins.op == OP_AND_IMM) {
        const uint32_t result = ins.op == OP_OR_IMM ? dst | src : dst & src;
        logic_flags(result, ins.width);
        write_reg(ins.dst, ins.width, result);
      } else if (ins.op == OP_SHL_IMM || ins.op == OP_SHR_IMM)
        write_reg(ins.dst, ins.width,
          shift_flags(dst, src, ins.width, ins.op == OP_SHL_IMM));
      state.eip += ins.length;
      pc++;
    }
    state.cycles++;
    completed++;
  }
  return completed;
}
