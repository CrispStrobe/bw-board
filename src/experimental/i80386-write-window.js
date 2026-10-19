// Side-effect-free admission of one ES page for a future native RAM writer.
// The caller must still bound every store to [lo, hi) and stop at event exits.
// Never walk an uncached mapping here: _translate can fault or set A/D bits.
import {prevalidateI80386ReadWindow, isI80386ReadWindowValid} from
  './i80386-read-window.js';

const PAGE_BYTES = 4096;
const FIRST_FAST_RAM = 0x100000;
const ES = 0;

export function prevalidateI80386WriteWindow(machine, offset) {
  const cpu = machine?.cpu;
  if (machine?.variant !== '80386' || !cpu?._translationCacheEnabled ||
      !Number.isInteger(offset) || offset < 0 || offset > 0xffffffff ||
      !(cpu.cr0 & 0x80000000) || !cpu.protectedMode || cpu.virtual8086 ||
      (machine._a20Configured && !machine._a20Enabled)) return null;

  const linearPage = (offset & ~0xfff) >>> 0;
  const es = cpu.segmentCaches?.[ES];
  if (!es || es.null || !es.present || es.code || !es.writable ||
      es.base !== 0 || es.expandDown ||
      es.limit < linearPage + PAGE_BYTES - 1) return null;

  const page = linearPage >>> 12;
  const translation = cpu._translations?.[page & 511];
  if (!translation || translation.generation !== cpu._translationGeneration ||
      translation.page !== page || translation.cr3 !== cpu.cr3 ||
      translation.cr4 !== cpu.cr4 || !translation.writable || !translation.dirty ||
      (cpu.currentPrivilegeLevel === 3 && !translation.userPage)) return null;

  const physicalPage = translation.physicalBase >>> 0;
  if ((physicalPage & 0xfff) || physicalPage < FIRST_FAST_RAM ||
      physicalPage + PAGE_BYTES > machine.memoryBytes ||
      machine._page?.[physicalPage >>> 12] !== 1 ||
      cpu._translationTablePages?.has(physicalPage >>> 12)) return null;

  // A native store to the executing page could change decoded instructions.
  // Require its existing translation; discovering it must not walk page tables.
  const codeWindow = prevalidateI80386ReadWindow(machine, cpu.eip >>> 0, 1);
  if (!codeWindow || codeWindow.physicalPage === physicalPage) return null;

  return Object.freeze({machine, cpu, es, translation, codeWindow, linearPage,
    physicalPage, lo:physicalPage, hi:physicalPage + PAGE_BYTES,
    delta:(physicalPage - linearPage) >>> 0, cr0:cpu.cr0, cr3:cpu.cr3,
    cr4:cpu.cr4, generation:cpu._translationGeneration,
    memory:machine.mem, pageMap:machine._page});
}

export function isI80386WriteWindowValid(window) {
  if (!window) return false;
  const {machine, cpu, es, translation, codeWindow, linearPage, physicalPage} = window;
  return machine?.cpu === cpu && machine.variant === '80386' &&
    machine.mem === window.memory && machine._page === window.pageMap &&
    (!machine._a20Configured || machine._a20Enabled) &&
    cpu._translationCacheEnabled && cpu.protectedMode && !cpu.virtual8086 &&
    (cpu.cr0 & 0x80000000) !== 0 && cpu.cr0 === window.cr0 &&
    cpu.cr3 === window.cr3 && cpu.cr4 === window.cr4 &&
    cpu._translationGeneration === window.generation &&
    cpu.segmentCaches[ES] === es && es.base === 0 && !es.null &&
    es.present && !es.code && es.writable && !es.expandDown &&
    es.limit >= linearPage + PAGE_BYTES - 1 &&
    translation.generation === window.generation &&
    translation.page === (linearPage >>> 12) &&
    translation.cr3 === cpu.cr3 && translation.cr4 === cpu.cr4 &&
    translation.writable && translation.dirty &&
    (cpu.currentPrivilegeLevel !== 3 || translation.userPage) &&
    translation.physicalBase === physicalPage &&
    cpu._translations[(linearPage >>> 12) & 511] === translation &&
    physicalPage >= FIRST_FAST_RAM &&
    physicalPage + PAGE_BYTES <= machine.memoryBytes &&
    machine._page?.[physicalPage >>> 12] === 1 &&
    !cpu._translationTablePages?.has(physicalPage >>> 12) &&
    isI80386ReadWindowValid(codeWindow) &&
    ((cpu.eip >>> 12) === (codeWindow.linearPage >>> 12)) &&
    codeWindow.physicalPage !== physicalPage;
}
