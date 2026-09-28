// Opt-in Node --import observer for the JavaScript instructions left by the
// native dispatcher. It records bytes returned by the guest's own fetches;
// it neither decodes ahead nor reads or writes guest memory separately.
import fs from 'node:fs';
import {ExperimentalI80386} from '../src/experimental/i80386.js';

const first = new Map();
const group = new Map();
const groupMode = new Map();
const second0f = new Map();
const modrm = new Map();
let protected32Retired = 0;
let active = null;
const oldFetch8 = ExperimentalI80386.prototype._fetch8;
ExperimentalI80386.prototype._fetch8 = function () {
  const byte = oldFetch8.call(this);
  if (active?.cpu === this && active.bytes.length < 8) active.bytes.push(byte);
  return byte;
};
const oldStepInstruction = ExperimentalI80386.prototype._stepInstruction;
ExperimentalI80386.prototype._stepInstruction = function () {
  const count = this.cycles;
  const eligible = this.protectedMode && !this.virtual8086 &&
    this.segmentCaches[1]?.default32;
  const previous = active;
  if (eligible) active = {cpu: this, bytes: []};
  try {
    return oldStepInstruction.call(this);
  } finally {
    if (eligible) {
      const bytes = active.bytes;
      active = previous;
      if (this.cycles > count && bytes.length) {
        protected32Retired++;
        let index = 0;
        while (index < bytes.length && [0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65,
          0x66, 0x67, 0xf0, 0xf2, 0xf3].includes(bytes[index])) index++;
        const opcode = bytes[index];
        if (opcode !== undefined) {
          const key = opcode.toString(16).padStart(2, '0');
          first.set(key, (first.get(key) ?? 0) + 1);
          if ([0x89, 0x8b, 0x8d, 0x01, 0xa4, 0xa5].includes(opcode)) {
            const form = opcode === 0xa4 || opcode === 0xa5
              ? `${key}:${bytes.slice(0,index).some(b => b === 0xf3 || b === 0xf2) ? 'repeat' : 'single'}`
              : `${key}:m${bytes[index + 1] === undefined ? '?' : bytes[index + 1] >>> 6}`;
            modrm.set(form, (modrm.get(form) ?? 0) + 1);
          }
          if (opcode === 0x0f && bytes[index + 1] !== undefined) {
            const sub = bytes[index + 1].toString(16).padStart(2, '0');
            second0f.set(sub, (second0f.get(sub) ?? 0) + 1);
          }
          if ([0xf6, 0xf7, 0xff, 0x81, 0x83, 0xc1].includes(opcode) &&
              bytes[index + 1] !== undefined) {
            const ext = (bytes[index + 1] >> 3) & 7;
            const form = `${key}/${ext}`;
            group.set(form, (group.get(form) ?? 0) + 1);
            const modeForm = `${form}:m${bytes[index + 1] >>> 6}`;
            groupMode.set(modeForm, (groupMode.get(modeForm) ?? 0) + 1);
          }
        }
      }
    }
  }
};
process.on('exit', () => {
  const sort = map => [...map].sort((a, b) => b[1] - a[1]);
  const output = process.env.I80386_FALLBACK_HISTOGRAM || 'fallback-histogram.json';
  fs.writeFileSync(output,
    JSON.stringify({protected32Retired, first: sort(first), group: sort(group),
      groupMode: sort(groupMode),
      modrm: sort(modrm),
      second0f: sort(second0f)}, null, 2) + '\n');
});
