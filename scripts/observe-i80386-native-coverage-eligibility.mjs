// Opt-in xv6 native-dispatch admission probe. Run with `node --import`.
// It reads only bytes from a previously cached code page and cached TLB/page
// metadata. It never walks a page table, fetches CPU bytes, or changes guest
// memory. Counts are upper bounds: actual blocks also need enough contiguous
// decoded instructions, a valid current program, and remaining event budget.
import {ExperimentalI80386ATMachine} from '../src/experimental/i80386-at-machine.js';
import {prevalidateI80386ReadWindow} from '../src/experimental/i80386-read-window.js';
import {prevalidateI80386WriteWindow} from '../src/experimental/i80386-write-window.js';

const regs = ['eax', 'ecx', 'edx', 'ebx', 'esp', 'ebp', 'esi', 'edi'];
const counts = {protected32: 0, codeWindow: 0, store89: 0,
  storePlain: 0, storeDecoded: 0, storeReady: 0,
  a4: 0, a4Ready: 0, nearJnz: 0, nearJnzPageSafe: 0};

// Mirrors the proposed general ES/SS/DS write-page admission. The actual
// product helper only admits ES; this probe has no writable emulator changes.
function writeReady(machine, offset, segment, codePhysicalPage) {
  const cpu = machine.cpu;
  const cache = cpu.segmentCaches[segment];
  const page = offset >>> 12;
  const linearPage = (offset & ~4095) >>> 0;
  if (!cache || cache.null || !cache.present || cache.code ||
      !cache.writable || cache.base !== 0 || cache.expandDown ||
      cache.limit < linearPage + 4095 ||
      (machine._a20Configured && !machine._a20Enabled)) return false;
  const translation = cpu._translations[page & 511];
  if (!translation || translation.generation !== cpu._translationGeneration ||
      translation.page !== page || translation.cr3 !== cpu.cr3 ||
      translation.cr4 !== cpu.cr4 || !translation.writable ||
      !translation.dirty ||
      (cpu.currentPrivilegeLevel === 3 && !translation.userPage)) return false;
  const physical = translation.physicalBase >>> 0;
  return !(physical & 4095) && physical >= 0x100000 &&
    physical + 4096 <= machine.memoryBytes &&
    machine._page?.[physical >>> 12] === 1 &&
    !cpu._translationTablePages?.has(physical >>> 12) &&
    physical !== codePhysicalPage;
}

function observe(machine) {
  const cpu = machine.cpu;
  if (!cpu.protectedMode || cpu.virtual8086 ||
      !cpu.segmentCaches[1]?.default32) return;
  counts.protected32++;
  const code = prevalidateI80386ReadWindow(machine, cpu.eip >>> 0, 1);
  if (!code) return;
  counts.codeWindow++;
  const mem = machine.mem;
  const at = code.physicalPage + (cpu.eip - code.linearPage);
  const end = code.physicalPage + 4096;
  const op = mem[at];
  if (op === 0xa4) {
    counts.a4++;
    if (prevalidateI80386ReadWindow(machine, cpu.esi >>> 0, 3) &&
        prevalidateI80386WriteWindow(machine, cpu.edi >>> 0))
      counts.a4Ready++;
  }
  if (op === 0x0f && at + 5 < end && mem[at + 1] === 0x85) {
    counts.nearJnz++;
    counts.nearJnzPageSafe++;
  }
  if (op !== 0x89) return;
  counts.store89++;
  if (at + 1 >= end) return;
  counts.storePlain++;
  let p = at + 1;
  const modrm = mem[p++], mod = modrm >>> 6, rm = modrm & 7;
  if (mod === 3) return;
  let base = rm, index = 8, scale = 0, displacement = 0, segment = 3;
  if (rm === 4) {
    if (p >= end) return;
    const sib = mem[p++];
    scale = sib >>> 6;
    index = (sib >>> 3) & 7;
    base = sib & 7;
    if (index === 4) index = 8;
  }
  const noBase = mod === 0 && base === 5;
  if (noBase) base = 8;
  else if (base === 4 || base === 5) segment = 2;
  if (noBase || mod === 2) {
    if (p + 3 >= end) return;
    for (let i = 0; i < 4; i++)
      displacement = (displacement | (mem[p++] << (8 * i))) >>> 0;
  } else if (mod === 1) {
    if (p >= end) return;
    displacement = (mem[p++] << 24) >> 24;
  }
  counts.storeDecoded++;
  const offset = ((base < 8 ? cpu[regs[base]] : 0) +
    (index < 8 ? (cpu[regs[index]] << scale) : 0) + displacement) >>> 0;
  if ((offset & 4095) <= 4092 &&
      writeReady(machine, offset, segment, code.physicalPage))
    counts.storeReady++;
}

const originalStep = ExperimentalI80386ATMachine.prototype.step;
ExperimentalI80386ATMachine.prototype.step = function () {
  observe(this);
  return originalStep.call(this);
};
process.on('exit', () => console.error('ELIGIBILITY', JSON.stringify(counts)));
