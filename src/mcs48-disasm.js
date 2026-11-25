// SPDX-License-Identifier: MIT
// Original implementation from Intel's MCS-48 manuals. See docs/MCS48-IMPLEMENTATION.md.

/** Increment the counting part of the NMOS MCS-48 PC; A11 does not carry. */
export function nextMCS48Address(address) {
  return (address & 0x800) | ((address + 1) & 0x7ff);
}

const descriptors = Array.from({ length: 256 }, (_, opcode) => ({
  opcode, mnemonic: 'DB', operands: '', length: 1, cycles: 1, legal: false,
}));

function instruction(opcode, mnemonic, operands = '', length = 1, cycles = 1) {
  descriptors[opcode] = { opcode, mnemonic, operands, length, cycles, legal: true };
}

// The patterns describe the documented NMOS 8048/8049 set, not UPI-41 or CMOS extensions.
for (let r = 0; r < 8; r++) {
  instruction(0x18 + r, 'INC', `R${r}`);
  instruction(0x28 + r, 'XCH', `A,R${r}`);
  instruction(0x48 + r, 'ORL', `A,R${r}`);
  instruction(0x58 + r, 'ANL', `A,R${r}`);
  instruction(0x68 + r, 'ADD', `A,R${r}`);
  instruction(0x78 + r, 'ADDC', `A,R${r}`);
  instruction(0xa8 + r, 'MOV', `R${r},A`);
  instruction(0xb8 + r, 'MOV', `R${r},#{imm}`, 2, 2);
  instruction(0xc8 + r, 'DEC', `R${r}`);
  instruction(0xd8 + r, 'XRL', `A,R${r}`);
  instruction(0xe8 + r, 'DJNZ', `R${r},{page}`, 2, 2);
  instruction(0xf8 + r, 'MOV', `A,R${r}`);
  instruction(0x04 + r * 0x20, 'JMP', '{absolute}', 2, 2);
  instruction(0x14 + r * 0x20, 'CALL', '{absolute}', 2, 2);
  instruction(0x12 + r * 0x20, `JB${r}`, '{page}', 2, 2);
}
for (let r = 0; r < 2; r++) {
  instruction(0x10 + r, 'INC', `@R${r}`);
  instruction(0x20 + r, 'XCH', `A,@R${r}`);
  instruction(0x30 + r, 'XCHD', `A,@R${r}`);
  instruction(0x40 + r, 'ORL', `A,@R${r}`);
  instruction(0x50 + r, 'ANL', `A,@R${r}`);
  instruction(0x60 + r, 'ADD', `A,@R${r}`);
  instruction(0x70 + r, 'ADDC', `A,@R${r}`);
  instruction(0x80 + r, 'MOVX', `A,@R${r}`, 1, 2);
  instruction(0x90 + r, 'MOVX', `@R${r},A`, 1, 2);
  instruction(0xa0 + r, 'MOV', `@R${r},A`);
  instruction(0xb0 + r, 'MOV', `@R${r},#{imm}`, 2, 2);
  instruction(0xd0 + r, 'XRL', `A,@R${r}`);
  instruction(0xf0 + r, 'MOV', `A,@R${r}`);
}
for (let p = 0; p < 4; p++) {
  instruction(0x0c + p, 'MOVD', `A,P${p + 4}`, 1, 2);
  instruction(0x3c + p, 'MOVD', `P${p + 4},A`, 1, 2);
  instruction(0x8c + p, 'ORLD', `P${p + 4},A`, 1, 2);
  instruction(0x9c + p, 'ANLD', `P${p + 4},A`, 1, 2);
}
for (const [opcode, mnemonic, operands = '', length = 1, cycles = 1] of [
  [0x00, 'NOP'], [0x02, 'OUTL', 'BUS,A', 1, 2],
  [0x03, 'ADD', 'A,#{imm}', 2, 2], [0x05, 'EN', 'I'], [0x07, 'DEC', 'A'],
  [0x08, 'INS', 'A,BUS', 1, 2], [0x09, 'IN', 'A,P1', 1, 2], [0x0a, 'IN', 'A,P2', 1, 2],
  [0x13, 'ADDC', 'A,#{imm}', 2, 2], [0x15, 'DIS', 'I'],
  [0x16, 'JTF', '{page}', 2, 2], [0x17, 'INC', 'A'],
  [0x23, 'MOV', 'A,#{imm}', 2, 2], [0x25, 'EN', 'TCNTI'],
  [0x26, 'JNT0', '{page}', 2, 2], [0x27, 'CLR', 'A'],
  [0x35, 'DIS', 'TCNTI'], [0x36, 'JT0', '{page}', 2, 2], [0x37, 'CPL', 'A'],
  [0x39, 'OUTL', 'P1,A', 1, 2], [0x3a, 'OUTL', 'P2,A', 1, 2],
  [0x42, 'MOV', 'A,T'], [0x43, 'ORL', 'A,#{imm}', 2, 2], [0x45, 'STRT', 'CNT'],
  [0x46, 'JNT1', '{page}', 2, 2], [0x47, 'SWAP', 'A'],
  [0x53, 'ANL', 'A,#{imm}', 2, 2], [0x55, 'STRT', 'T'],
  [0x56, 'JT1', '{page}', 2, 2], [0x57, 'DA', 'A'],
  [0x62, 'MOV', 'T,A'], [0x65, 'STOP', 'TCNT'], [0x67, 'RRC', 'A'],
  [0x75, 'ENT0', 'CLK'], [0x76, 'JF1', '{page}', 2, 2], [0x77, 'RR', 'A'],
  [0x83, 'RET', '', 1, 2], [0x85, 'CLR', 'F0'], [0x86, 'JNI', '{page}', 2, 2],
  [0x88, 'ORL', 'BUS,#{imm}', 2, 2], [0x89, 'ORL', 'P1,#{imm}', 2, 2],
  [0x8a, 'ORL', 'P2,#{imm}', 2, 2], [0x93, 'RETR', '', 1, 2],
  [0x95, 'CPL', 'F0'], [0x96, 'JNZ', '{page}', 2, 2], [0x97, 'CLR', 'C'],
  [0x98, 'ANL', 'BUS,#{imm}', 2, 2], [0x99, 'ANL', 'P1,#{imm}', 2, 2],
  [0x9a, 'ANL', 'P2,#{imm}', 2, 2], [0xa3, 'MOVP', 'A,@A', 1, 2],
  [0xa5, 'CLR', 'F1'], [0xa7, 'CPL', 'C'], [0xb3, 'JMPP', '@A', 1, 2],
  [0xb5, 'CPL', 'F1'], [0xb6, 'JF0', '{page}', 2, 2], [0xc5, 'SEL', 'RB0'],
  [0xc6, 'JZ', '{page}', 2, 2], [0xc7, 'MOV', 'A,PSW'],
  [0xd3, 'XRL', 'A,#{imm}', 2, 2], [0xd5, 'SEL', 'RB1'], [0xd7, 'MOV', 'PSW,A'],
  [0xe3, 'MOVP3', 'A,@A', 1, 2], [0xe5, 'SEL', 'MB0'],
  [0xe6, 'JNC', '{page}', 2, 2], [0xe7, 'RL', 'A'],
  [0xf5, 'SEL', 'MB1'], [0xf6, 'JC', '{page}', 2, 2], [0xf7, 'RLC', 'A'],
]) instruction(opcode, mnemonic, operands, length, cycles);

/** Immutable byte length and machine-cycle information for all 256 opcode slots. */
export const MCS48_OPCODES = Object.freeze(descriptors.map(Object.freeze));

function hex(value, digits) {
  return `0x${value.toString(16).toUpperCase().padStart(digits, '0')}`;
}

/**
 * Decode one NMOS 8049 instruction without mutating the CPU.
 * source is a byte array or (address) => byte. memoryBank is the SEL MB latch;
 * absent execution context, the current address's bank is used for JMP/CALL.
 */
export function disassembleMCS48(source, address = 0, options = {}) {
  if (!Number.isInteger(address) || address < 0 || address > 0xfff) {
    throw new RangeError('MCS-48 disassembly address must be in 0..4095');
  }
  const read = typeof source === 'function' ? source : (at) => source[at] ?? 0xff;
  const opcode = read(address) & 0xff;
  const info = MCS48_OPCODES[opcode];
  const next = nextMCS48Address(address);
  const operand = info.length === 2 ? read(next) & 0xff : 0;
  const bytes = info.length === 2 ? [opcode, operand] : [opcode];
  const bank = options.interruptInProgress ? 0 : (options.memoryBank ?? (address >>> 11));
  const pageTarget = (next & 0xf00) | operand;
  const absoluteTarget = ((bank & 1) << 11) | ((opcode & 0xe0) << 3) | operand;
  const operands = info.legal ? info.operands
    .replace('{imm}', hex(operand, 2))
    .replace('{page}', hex(pageTarget, 3))
    .replace('{absolute}', hex(absoluteTarget, 3)) : hex(opcode, 2);
  return {
    address, bytes, length: info.length, mnemonic: info.mnemonic, operands,
    text: `${info.mnemonic}${operands ? ` ${operands}` : ''}`,
    cycles: info.cycles, legal: info.legal,
    ...(info.operands.includes('{page}') ? { target: pageTarget } : {}),
    ...(info.operands.includes('{absolute}') ? { target: absoluteTarget } : {}),
  };
}

/** Decode a fixed number of instructions, following the hardware PC wrap rule. */
export function disassembleMCS48Range(source, address = 0, count = 16, options = {}) {
  if (!Number.isInteger(count) || count < 0 || count > 4096) {
    throw new RangeError('MCS-48 disassembly count must be in 0..4096');
  }
  const result = [];
  for (let i = 0; i < count; i++) {
    const row = disassembleMCS48(source, address, options);
    result.push(row);
    for (let byte = 0; byte < row.length; byte++) address = nextMCS48Address(address);
  }
  return result;
}

export const disasmMCS48 = disassembleMCS48;
