// Admission only: a scalar data access paired with an already admitted 16-bit
// code window. No bus access, page walk, fault, data copy, or guest execution.
import {isI80386Code16WindowValid} from './i80386-code16-window.js';

const PAGE_BYTES = 4096;
const SEGMENTS = ['es', 'cs', 'ss', 'ds', 'fs', 'gs'];
const CACHE_FIELDS = ['base', 'limit', 'null', 'present', 'code', 'readable',
  'writable', 'expandDown', 'default32'];

function inspect(machine, codeWindow, segment, offset, width, access) {
  if (!isI80386Code16WindowValid(codeWindow) ||
      codeWindow.machine !== machine ||
      !Number.isInteger(segment) || segment < 0 || segment >= SEGMENTS.length ||
      !Number.isInteger(offset) || offset < 0 || offset > 0xffff ||
      ![1, 2, 4].includes(width) || !['read', 'write'].includes(access)) return null;
  const cpu = machine.cpu;
  const cache = cpu.segmentCaches?.[segment];
  const end = offset + width - 1;
  if (!cache || cache.null || !cache.present ||
      !Number.isInteger(cache.base) || cache.base < 0 || cache.base > 0xffffffff ||
      !Number.isInteger(cache.limit) || cache.limit < 0 || cache.limit > 0xffffffff ||
      end > 0xffffffff ||
      (cache.expandDown
        ? offset <= cache.limit || end > (cache.default32 ? 0xffffffff : 0xffff)
        : end > cache.limit)) return null;
  if (cpu.protectedMode && !cpu.virtual8086 &&
      (access === 'write' ? !cache.writable : cache.code && !cache.readable))
    return null;
  // The AT board flushes the TLB on every gated write, even with paging off.
  // A future direct store cannot silently omit that invalidation.
  if (access === 'write' && machine._a20Configured && !machine._a20Enabled)
    return null;
  const linear = (cache.base + offset) >>> 0;
  // A wrapped linear span is legal to the interpreter, but intentionally out
  // of this bounded proof. Page crossing below 4 GiB is covered bytewise.
  if (linear + width - 1 > 0xffffffff) return null;
  const physicalAddresses = [];
  const pageProofs = [];
  for (let i = 0; i < width; i++) {
    const address = linear + i;
    const linearPage = address >>> 12;
    let page = pageProofs.at(-1);
    if (!page || page.linearPage !== linearPage) {
      let translation = null;
      let physicalBase = (address & ~0xfff) >>> 0;
      if (cpu.cr0 & 0x80000000) {
        if (!cpu._translationCacheEnabled) return null;
        translation = cpu._translations?.[linearPage & 511];
        if (!translation || translation.generation !== cpu._translationGeneration ||
            translation.page !== linearPage || translation.cr3 !== cpu.cr3 ||
            translation.cr4 !== cpu.cr4 ||
            (cpu.currentPrivilegeLevel === 3 && !translation.userPage) ||
            (access === 'write' && (!translation.dirty ||
              (cpu.currentPrivilegeLevel === 3 && !translation.writable)))) return null;
        physicalBase = translation.physicalBase >>> 0;
        if (physicalBase & 0xfff) return null;
      }
      const gatedBase = machine._a20Configured && !machine._a20Enabled
        ? (physicalBase & ~0x100000) >>> 0 : physicalBase;
      if (gatedBase >= 0xffff0000 ||
          (access === 'write' && (cpu._translationTablePages?.has(physicalBase >>> 12) ||
            cpu._translationTablePages?.has(gatedBase >>> 12)))) return null;
      const kind = machine._page?.[gatedBase >>> 12];
      if (machine.mem?.length !== machine.memoryBytes ||
          (access === 'write' ? kind !== 1 : kind !== 1 && kind !== 2)) return null;
      page = {linearPage, translation, physicalBase, gatedBase, kind};
      pageProofs.push(page);
    }
    const decoded = page.gatedBase + (address & 0xfff);
    if (decoded >= machine.memoryBytes ||
        // The bus checks these overlays before the RAM/ROM page map. Refuse
        // the whole range even when an overlay is currently inactive.
        (decoded >= 0xa0000 && decoded < 0xc0000) ||
        (decoded >= 0x9fc00 && decoded < 0x9fd50) ||
        (decoded >= 0xfee00000 && decoded < 0xfee01000) ||
        (decoded >= 0xfec00000 && decoded < 0xfec00020) ||
        (access === 'write' && decoded >= codeWindow.physicalAddress &&
          decoded < codeWindow.physicalAddress + codeWindow.length)) return null;
    physicalAddresses.push(decoded);
  }
  return {cpu, cache, linear, physicalAddresses, pageProofs};
}

/** Prove that one 1/2/4-byte data access can use direct memory at this instant. */
export function prevalidateI80386Code16DataWindow(
  machine, codeWindow, segment, offset, width, access
) {
  const proof = inspect(machine, codeWindow, segment, offset, width, access);
  if (!proof) return null;
  return Object.freeze({machine, cpu: proof.cpu, codeWindow, segment, offset, width,
    access, mem: machine.mem, pageMap: machine._page, cache: proof.cache,
    selector: proof.cpu[SEGMENTS[segment]],
    cacheFields: Object.freeze(CACHE_FIELDS.map(field => proof.cache[field])),
    a20Configured: machine._a20Configured, a20Enabled: machine._a20Enabled,
    cr0: proof.cpu.cr0, cr3: proof.cpu.cr3, cr4: proof.cpu.cr4,
    generation: proof.cpu._translationGeneration,
    tablePages: proof.cpu._translationTablePages,
    linear: proof.linear,
    physicalAddresses: Object.freeze(proof.physicalAddresses),
    pages: Object.freeze(proof.pageProofs.map(page => Object.freeze(page)))});
}

/** Recheck the entire proof immediately before a future direct data access. */
export function isI80386Code16DataWindowValid(window) {
  if (!window) return false;
  const {machine, codeWindow, segment, offset, width, access} = window;
  const proof = inspect(machine, codeWindow, segment, offset, width, access);
  if (!proof || machine.cpu !== window.cpu || machine.mem !== window.mem ||
      machine._page !== window.pageMap || proof.cache !== window.cache ||
      proof.cpu[SEGMENTS[segment]] !== window.selector ||
      CACHE_FIELDS.some((field, i) => proof.cache[field] !== window.cacheFields[i]) ||
      machine._a20Configured !== window.a20Configured ||
      machine._a20Enabled !== window.a20Enabled ||
      proof.cpu.cr0 !== window.cr0 || proof.cpu.cr3 !== window.cr3 ||
      proof.cpu.cr4 !== window.cr4 ||
      proof.cpu._translationGeneration !== window.generation ||
      proof.cpu._translationTablePages !== window.tablePages ||
      proof.linear !== window.linear ||
      proof.physicalAddresses.length !== window.physicalAddresses.length ||
      proof.physicalAddresses.some((address, i) => address !== window.physicalAddresses[i]) ||
      proof.pageProofs.length !== window.pages.length) return false;
  return proof.pageProofs.every((page, i) =>
    Object.keys(page).every(field => page[field] === window.pages[i][field]));
}
