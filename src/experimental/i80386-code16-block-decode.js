import {isI80386Code16WindowValid} from './i80386-code16-window.js';

const PREFIXES = new Set([0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65,
  0x66, 0x67, 0xf0, 0xf2, 0xf3]);
const signed8 = value => (value << 24) >> 24;
const signed16 = value => (value << 16) >> 16;

/** Decode only a byte-proven, single-page 16-bit CS span; never run guest code. */
export function decodeI80386Code16Block(window, maxInstructions = 64) {
  if (!Number.isInteger(maxInstructions) || maxInstructions < 1 || maxInstructions > 64)
    throw new RangeError('code16 block budget must be 1 through 64');
  if (!isI80386Code16WindowValid(window))
    return {instructions: [], reason: 'invalid-window', nextOffset: window?.offset ?? null};
  const bytes = window.bytes;
  const instructions = [];
  let at = 0;
  let reason = 'window-end';
  while (at < bytes.length && instructions.length < maxInstructions) {
    const start = at, op = bytes[at];
    if (PREFIXES.has(op)) { reason = 'prefix'; break; }
    let length = 1, kind, dst, src, immediate, target, fallthrough;
    let terminal = false;
    if (op === 0x90) kind = 'nop';
    else if (op >= 0x40 && op <= 0x47) { kind = 'inc16'; dst = op & 7; }
    else if (op >= 0x48 && op <= 0x4f) { kind = 'dec16'; dst = op & 7; }
    else if (op >= 0x50 && op <= 0x57) { kind = 'push16'; src = op & 7; }
    else if (op >= 0x58 && op <= 0x5f) { kind = 'pop16'; dst = op & 7; }
    else if (op >= 0xb8 && op <= 0xbf) {
      kind = 'mov-imm16'; dst = op & 7; length = 3;
      if (at + length <= bytes.length) immediate = bytes[at + 1] | (bytes[at + 2] << 8);
    } else if ([0x89, 0x8b, 0x31, 0x33, 0x01, 0x03, 0x29, 0x2b,
      0x39, 0x3b].includes(op)) {
      length = 2;
      if (at + length > bytes.length) { reason = 'incomplete'; break; }
      const modrm = bytes[at + 1];
      if ((modrm & 0xc0) !== 0xc0) { reason = 'memory-operand'; break; }
      const reg = (modrm >>> 3) & 7, rm = modrm & 7;
      kind = ({0x89:'mov16',0x8b:'mov16',0x31:'xor16',0x33:'xor16',
        0x01:'add16',0x03:'add16',0x29:'sub16',0x2b:'sub16',
        0x39:'cmp16',0x3b:'cmp16'})[op];
      [dst, src] = (op & 2) ? [reg, rm] : [rm, reg];
    } else if (op === 0x74 || op === 0x75 || op === 0xeb) {
      length = 2; terminal = true;
      kind = op === 0x74 ? 'jz-rel8' : op === 0x75 ? 'jnz-rel8' : 'jmp-rel8';
      if (at + length <= bytes.length)
        target = (window.offset + at + length + signed8(bytes[at + 1])) & 0xffff;
    } else if (op === 0xe8 || op === 0xe9) {
      length = 3; terminal = true;
      kind = op === 0xe8 ? 'call-rel16' : 'jmp-rel16';
      if (at + length <= bytes.length)
        target = (window.offset + at + length + signed16(bytes[at + 1] | (bytes[at + 2] << 8))) & 0xffff;
    } else if (op === 0xc3) { kind = 'ret16'; terminal = true; }
    else { reason = 'unsupported-opcode'; break; }
    if (at + length > bytes.length) { reason = 'incomplete'; break; }
    const offset = window.offset + at;
    fallthrough = offset + length;
    instructions.push(Object.freeze({kind, offset, length, bytes: Object.freeze(bytes.slice(at, at + length)),
      ...(dst === undefined ? {} : {dst}), ...(src === undefined ? {} : {src}),
      ...(immediate === undefined ? {} : {immediate}),
      ...(target === undefined ? {} : {target}),
      ...(terminal ? {fallthrough, terminal: true} : {})}));
    at += length;
    if (terminal) { reason = 'control-flow'; break; }
  }
  if (instructions.length === maxInstructions && reason !== 'control-flow') reason = 'budget';
  return Object.freeze({instructions: Object.freeze(instructions), reason,
    nextOffset: window.offset + at});
}
