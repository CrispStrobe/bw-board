/**
 * Independent architectural expectation for guest.S. This module never imports
 * a CPU model; it derives every observed byte from the 80386 rules the guest
 * exercises (Intel 80386 PRM: descriptor accessed bit on segment-register load,
 * TSS busy bit, VM86 interrupt frame, task-switch save/back-link, NT on nesting).
 */
import {LOAD_ADDRESS} from './build.mjs';

const ascii = s => [...s].map(c => c.charCodeAt(0));
const le32 = v => [v & 255, v >>> 8 & 255, v >>> 16 & 255, v >>> 24 & 255];
const put32 = (buf, off, v) => buf.set(le32(v >>> 0), off);
const put16 = (buf, off, v) => buf.set([v & 255, v >>> 8 & 255], off);

export const GDT_BYTES = 64;
export const TSS_BYTES = 0x68;
// Selectors whose access byte the guest observes, and which event sets it.
export const DESCRIPTOR_EVENTS = Object.freeze({
  P0: {0x08: 0x01, 0x10: 0x01, 0x18: 0x02},       // ljmp CS, data loads, LTR busy
  H40: {0x28: 0x01},                               // INT-gate CS load from VM86
  T41: {0x20: 0x02, 0x30: 0x01, 0x38: 0x01},       // task gate: busy, CS, data
});

export function expectedStream({image, symbols}, {omitAccessedOn = []} = {}) {
  const gdtOffset = symbols.gdt - LOAD_ADDRESS;
  const gdt = Uint8Array.from(image.subarray(gdtOffset, gdtOffset + GDT_BYTES));
  const omit = new Set(omitAccessedOn);
  const applyEvents = phase => {
    for (const [selector, bit] of Object.entries(DESCRIPTOR_EVENTS[phase])) {
      if (bit === 1 && omit.has(Number(selector))) continue;
      gdt[Number(selector) + 5] |= bit;
    }
  };
  const tss1 = new Uint8Array(TSS_BYTES), tss2 = new Uint8Array(TSS_BYTES);
  put32(tss1, 0x04, 0x8000); put16(tss1, 0x08, 0x10); put16(tss1, 0x66, 0x68);
  put32(tss2, 0x20, symbols.task2);
  put32(tss2, 0x24, 2); put32(tss2, 0x28, 0xa5a50000); put32(tss2, 0x38, 0xa000);
  for (const off of [0x48, 0x50, 0x54, 0x58, 0x5c]) put16(tss2, off, 0x38);
  put16(tss2, 0x4c, 0x30); put16(tss2, 0x66, 0x68);
  const out = [...ascii('VMCC')];
  const tables = tag => out.push(...ascii(tag), ...gdt, ...tss1, ...tss2);

  applyEvents('P0');
  tables('P0__');

  applyEvents('H40');
  tables('H40_');
  const vmEflags = 0x00023002;                     // VM | IOPL3 | reserved bit 1
  const handlerEflags = vmEflags & ~(0x20000 | 0x10000 | 0x4000 | 0x100 | 0x200);
  const frameTop = 0x8000 - 9 * 4;                 // TSS1 ESP0 minus VM86 frame
  for (const v of [0, 0, 0, 0,                     // GS FS ES DS: nulled on VM86 exit
    handlerEflags,
    0x88888888, 0x77777777, 0x66666666, frameTop,  // PUSHAD: EDI ESI EBP ESP
    0x22222222, 0x44444444, 0x33333333, 0x11111234,
    symbols.vm86_after40, 0, vmEflags, 0xfe, 0x600, 0x400, 0x300, 0x500, 0x700])
    out.push(...le32(v));
  out.push(0xef, 0xbe, 0xfe, 0xca);                // VM86 stack push / DS store

  applyEvents('T41');
  // Outgoing VM86 state saved into TSS1; TSS2 receives only the back-link.
  put32(tss1, 0x20, symbols.vm86_after41); put32(tss1, 0x24, vmEflags);
  [0x11111234, 0x33333333, 0x44444444, 0x22225678, 0xfe, 0x66666666, 0x77777777, 0x88888888]
    .forEach((v, i) => put32(tss1, 0x28 + 4 * i, v));
  [0x400, 0, 0x600, 0x300, 0x500, 0x700].forEach((v, i) => put16(tss1, 0x48 + 4 * i, v));
  put16(tss2, 0x00, 0x18);
  tables('T41_');
  for (const v of [0x4002, 0, 0, 0, 0xa000, 0, 0, 0, 0xa5a50000]) out.push(...le32(v));
  out.push(...ascii('END!'));
  return Uint8Array.from(out);
}

/** Field map for discrepancy reports: [start, length, name]. */
export function layout() {
  const fields = [[0, 4, 'start']];
  let at = 4;
  const tables = phase => {
    fields.push([at, 4, `${phase}.tag`]); at += 4;
    for (let s = 0; s < GDT_BYTES; s += 8) { fields.push([at + s, 8, `${phase}.gdt[0x${s.toString(16)}]`]); }
    at += GDT_BYTES;
    fields.push([at, TSS_BYTES, `${phase}.tss1`]); at += TSS_BYTES;
    fields.push([at, TSS_BYTES, `${phase}.tss2`]); at += TSS_BYTES;
  };
  tables('P0'); tables('H40');
  fields.push([at, 88, 'H40.stack']); at += 88;
  fields.push([at, 4, 'H40.vm86-ram']); at += 4;
  tables('T41');
  fields.push([at, 36, 'T41.stack']); at += 36;
  fields.push([at, 4, 'end']); at += 4;
  return {fields, length: at};
}

export function firstDifference(expected, actual) {
  const {fields} = layout();
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) if (expected[i] !== actual[i]) {
    const field = fields.find(([s, l]) => i >= s && i < s + l);
    return {offset: i, field: field ? field[2] : 'beyond-layout', fieldOffset: field ? i - field[0] : null,
      expected: expected[i] ?? null, actual: actual[i] ?? null};
  }
  return null;
}

export function allDifferences(expected, actual) {
  const out = [];
  const n = Math.max(expected.length, actual.length);
  for (let i = 0; i < n; i++) if (expected[i] !== actual[i]) out.push(i);
  return out;
}
