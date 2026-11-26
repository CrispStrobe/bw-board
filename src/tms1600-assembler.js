// SPDX-License-Identifier: MIT
import {nextTms1600Word, reverseTms1600Bits, TMS1600_ROM_SIZE} from './tms1600.js';

const fixed = Object.freeze({
  MNEA: 0x00, ALEM: 0x01, YNEA: 0x02, XMA: 0x03, DYN: 0x04, IYC: 0x05, AMAAC: 0x06,
  OMAN: 0x07, TKA: 0x08, COMX: 0x09, TDO: 0x0a, TPC: 0x0b, RSTR: 0x0c, SETR: 0x0d,
  KNEZ: 0x0e, RETN: 0x0f, TAY: 0x20, TMA: 0x21, TMY: 0x22, TYA: 0x23, TAMDYN: 0x24,
  TAMIYC: 0x25, TAMZA: 0x26, TAM: 0x27, SAMAN: 0x3c, CPAIZ: 0x3d, IMAC: 0x3e,
  MNEZ: 0x3f, CLA: 0x7f
});
const immediate = Object.freeze({
  LDP: [0x10, 4], LDX: [0x28, 3], SBIT: [0x30, 2], RBIT: [0x34, 2], TBIT1: [0x38, 2],
  TCY: [0x40, 4], YNEC: [0x50, 4], TCMIY: [0x60, 4], AC1AC: [0x70, 4]
});

function checkInteger(value, limit, name) {
  if (!Number.isInteger(value) || value < 0 || value >= limit) {
    throw new RangeError(`${name} must be in 0..${limit - 1}`);
  }
  return value;
}

/**
 * Assemble a fixed-size physical-address ROM. Each section has
 * {chapter, page, code}, with optional physical {word} (default zero).
 * code entries use 'label:', 'CLA', ['TCY', 3], or ['BR', 'label'].
 * PAGE and CHAPTER operands accept a label and extract its respective field.
 */
export function assembleTms1600(sections) {
  const rom = new Uint8Array(TMS1600_ROM_SIZE);
  const labels = new Map();
  const instructions = new Map();
  for (const {chapter, page, word: first = 0, code} of sections) {
    const base = (checkInteger(chapter, 4, 'Chapter') << 10) | (checkInteger(page, 16, 'Page') << 6);
    let word = checkInteger(first, 64, 'Word');
    for (const line of code) {
      const address = base | word;
      if (typeof line === 'string' && line.endsWith(':')) {
        const label = line.slice(0, -1);
        if (!label || labels.has(label)) throw new Error(`Invalid or duplicate TMS1600 label: ${label}`);
        labels.set(label, address);
        continue;
      }
      if (instructions.has(address)) throw new Error(`Overlapping TMS1600 code at ${address.toString(16)}`);
      instructions.set(address, typeof line === 'string' ? [line] : line);
      word = nextTms1600Word(word);
    }
  }
  for (const [address, [mnemonic, operand]] of instructions) {
    rom[address] = encode(mnemonic, operand, address, labels);
  }
  return {rom, symbols: Object.fromEntries(labels)};
}

function encode(mnemonic, operand, address, labels) {
  if (Object.hasOwn(fixed, mnemonic)) {
    if (operand !== undefined) throw new Error(`${mnemonic} takes no operand`);
    return fixed[mnemonic];
  }
  if (mnemonic === 'BR' || mnemonic === 'CALL') {
    const target = labels.get(operand);
    if (typeof operand === 'string' && target === undefined) throw new Error(`Unknown TMS1600 label: ${operand}`);
    return (mnemonic === 'BR' ? 0x80 : 0xc0) |
      (target === undefined ? checkInteger(operand, 64, mnemonic) : target & 63);
  }
  if (Object.hasOwn(immediate, mnemonic)) {
    const [opcode, width] = immediate[mnemonic];
    if (mnemonic === 'AC1AC' && operand === 15) throw new RangeError('AC1AC 15 encodes CLA');
    return opcode | reverseTms1600Bits(checkInteger(operand, 2 ** width, mnemonic), width);
  }
  if (mnemonic === 'PAGE' || mnemonic === 'CHAPTER') {
    const target = labels.get(operand);
    if (target === undefined) throw new Error(`Unknown TMS1600 label: ${operand}`);
    const value = mnemonic === 'PAGE' ? (target >> 6) & 15 : target >> 10;
    return 0x10 | reverseTms1600Bits(value, 4);
  }
  throw new Error(`Unknown TMS1600 instruction ${mnemonic} at ${address.toString(16)}`);
}
