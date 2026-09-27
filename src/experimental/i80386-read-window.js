// Read-only, page-bounded fast-path candidate for a future native 386 block.
// Reuse a translation already performed by the JavaScript CPU: walking an
// uncached page here could fault or modify guest page-table A/D bits early.
const PAGE_BYTES = 4096;
const FIRST_FAST_RAM = 0x100000;

export function prevalidateI80386ReadWindow(machine, linearAddress, segment = 3) {
  const cpu = machine?.cpu;
  if (machine?.variant !== '80386' || !cpu?._translationCacheEnabled ||
      !Number.isInteger(linearAddress) || linearAddress < 0 ||
      linearAddress > 0xffffffff || (segment !== 2 && segment !== 3) ||
      !(cpu.cr0 & 0x80000000) || !cpu.protectedMode || cpu.virtual8086 ||
      (machine._a20Configured && !machine._a20Enabled)) return null;
  const linearPage = (linearAddress & ~0xfff) >>> 0;
  const cache = cpu.segmentCaches[segment];
  if (!cache || cache.null || !cache.present || !cache.readable ||
      (segment === 2 && !cache.writable) ||
      cache.base !== 0 || cache.expandDown ||
      cache.limit < linearPage + PAGE_BYTES - 1) return null;
  const page = linearPage >>> 12;
  const translation = cpu._translations[page & 511];
  if (!translation || translation.generation !== cpu._translationGeneration ||
      translation.page !== page || translation.cr3 !== cpu.cr3 ||
      translation.cr4 !== cpu.cr4 ||
      (cpu.currentPrivilegeLevel === 3 && !translation.userPage)) return null;
  const physicalPage = translation.physicalBase >>> 0;
  if ((physicalPage & 0xfff) || physicalPage < FIRST_FAST_RAM ||
      physicalPage + PAGE_BYTES > machine.memoryBytes ||
      machine._page?.[physicalPage >>> 12] !== 1) return null;
  return Object.freeze({machine, cpu, segment, cache, translation, linearPage,
    physicalPage, lo: physicalPage, hi: physicalPage + PAGE_BYTES,
    delta: (physicalPage - linearPage) >>> 0, cr0: cpu.cr0,
    cr3: cpu.cr3, cr4: cpu.cr4, generation: cpu._translationGeneration});
}

export function isI80386ReadWindowValid(window) {
  if (!window) return false;
  const {machine, cpu, segment, cache, translation, linearPage, physicalPage} = window;
  return machine?.cpu === cpu && machine.variant === '80386' &&
    (!machine._a20Configured || machine._a20Enabled) &&
    cpu.cr0 === window.cr0 && cpu.cr3 === window.cr3 &&
    cpu.cr4 === window.cr4 && cpu._translationGeneration === window.generation &&
    cpu.segmentCaches[segment] === cache &&
    cache.base === 0 && cache.present && cache.readable && !cache.null &&
    (segment !== 2 || cache.writable) &&
    !cache.expandDown && cache.limit >= linearPage + PAGE_BYTES - 1 &&
    !cpu.virtual8086 && (cpu.currentPrivilegeLevel !== 3 || translation.userPage) &&
    translation.generation === window.generation &&
    translation.page === (linearPage >>> 12) &&
    translation.cr3 === cpu.cr3 && translation.cr4 === cpu.cr4 &&
    translation.physicalBase === physicalPage &&
    cpu._translations[(linearPage >>> 12) & 511] === translation &&
    physicalPage + PAGE_BYTES <= machine.memoryBytes &&
    machine._page?.[physicalPage >>> 12] === 1;
}
