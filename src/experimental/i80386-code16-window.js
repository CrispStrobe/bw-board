// Side-effect-free proof for a bounded 16-bit CS fetch span. This does not
// execute instructions. A future runner must revalidate before every run and
// check its starting EIP and stop/revalidate after an in-run write that may
// overlap the captured bytes. Validation alone does not bind EIP.
const PAGE_BYTES = 4096;
const CS = 1;

function modeOf(cpu) {
  if (cpu.virtual8086) return 'vm86';
  if (!cpu.protectedMode) return 'real';
  return cpu._retainedRealCs ? null : 'protected16';
}

function inspect(machine, offset, length) {
  const cpu = machine?.cpu;
  if (machine?.variant !== '80386' || !cpu ||
      !Number.isInteger(offset) || offset < 0 || offset > 0xffffffff ||
      !Number.isInteger(length) || length < 1 || length > PAGE_BYTES) return null;
  const mode = modeOf(cpu);
  const cs = cpu.segmentCaches?.[CS];
  const end = offset + length - 1;
  if (!mode || !cs || cs.null || !cs.present || !cs.code ||
      cs.default32 || cs.expandDown || !Number.isInteger(cs.base) ||
      !Number.isInteger(cs.limit) || end > cs.limit || end > 0xffffffff)
    return null;
  // _linear(CS, offset) wraps its sum to 32 bits. The entire requested span
  // must remain within the same linear page so one TLB entry proves it all.
  const linear = (cs.base + offset) >>> 0;
  if ((linear & 0xfff) + length > PAGE_BYTES) return null;
  const linearPage = linear >>> 12;
  let translation = null;
  let physicalPage = (linear & ~0xfff) >>> 0;
  if (cpu.cr0 & 0x80000000) {
    if (!cpu._translationCacheEnabled) return null;
    translation = cpu._translations?.[linearPage & 511];
    if (!translation || translation.generation !== cpu._translationGeneration ||
        translation.page !== linearPage || translation.cr3 !== cpu.cr3 ||
        translation.cr4 !== cpu.cr4 ||
        (cpu.currentPrivilegeLevel === 3 && !translation.userPage)) return null;
    physicalPage = translation.physicalBase >>> 0;
    if (physicalPage & 0xfff) return null;
  }
  // Mirror the board's A20 gate. The reset high alias is deliberately refused:
  // it is a different decode domain and does not name machine.mem directly.
  const gatedPage = (machine._a20Configured && !machine._a20Enabled)
    ? (physicalPage & ~0x100000) >>> 0 : physicalPage;
  if (gatedPage >= 0xffff0000) return null;
  const address = gatedPage + (linear & 0xfff);
  const last = address + length - 1;
  if (last >= machine.memoryBytes || machine.mem?.length !== machine.memoryBytes ||
      (machine._page?.[gatedPage >>> 12] !== 1 &&
       machine._page?.[gatedPage >>> 12] !== 2)) return null;
  // _read386 consults these device overlays before the RAM/ROM page map.
  // Reject their full address ranges even while an overlay is inactive.
  if ((address < 0xc0000 && last >= 0xa0000) ||
      (address < 0x9fd50 && last >= 0x9fc00) ||
      (address < 0xfee01000 && last >= 0xfee00000) ||
      (address < 0xfec00020 && last >= 0xfec00000)) return null;
  return {cpu, cs, mode, linearPage, translation, physicalPage,
    address, pageKind: machine._page[gatedPage >>> 12]};
}

/** Prove the full requested fetch span, then read its first byte without a copy. */
export function peekI80386Code16WindowFirstByte(machine, offset, length) {
  const proof = inspect(machine, offset, length);
  return proof ? machine.mem[proof.address] : null;
}

/** Admit only a requested, single-page 16-bit CS span whose bytes equal fetch. */
export function prevalidateI80386Code16Window(machine, offset, length) {
  const proof = inspect(machine, offset, length);
  if (!proof) return null;
  const bytes = Object.freeze(Array.from(machine.mem.subarray(proof.address,
    proof.address + length)));
  return Object.freeze({machine, cpu: proof.cpu, offset, length, bytes, mem: machine.mem,
    pageMap: machine._page, cs: proof.cs, csBase: proof.cs.base,
    csLimit: proof.cs.limit, mode: proof.mode, selector: proof.cpu.cs,
    a20Configured: machine._a20Configured, a20Enabled: machine._a20Enabled,
    eflagsVM: proof.cpu.eflags & 0x20000, cr0: proof.cpu.cr0,
    cr3: proof.cpu.cr3, cr4: proof.cpu.cr4,
    generation: proof.cpu._translationGeneration,
    linearPage: proof.linearPage, translation: proof.translation,
    physicalPage: proof.physicalPage, physicalAddress: proof.address,
    pageKind: proof.pageKind});
}

/** Guard every captured byte immediately before use; no bus access or fault. */
export function isI80386Code16WindowValid(window) {
  if (!window) return false;
  const {machine, offset, length} = window;
  const proof = inspect(machine, offset, length);
  if (!proof || machine.cpu !== window.cpu ||
      machine.mem !== window.mem || machine._page !== window.pageMap ||
      machine._a20Configured !== window.a20Configured ||
      machine._a20Enabled !== window.a20Enabled ||
      proof.cpu.segmentCaches[CS] !== window.cs ||
      proof.cs.base !== window.csBase || proof.cs.limit !== window.csLimit ||
      proof.mode !== window.mode || proof.cpu.cs !== window.selector ||
      (proof.cpu.eflags & 0x20000) !== window.eflagsVM ||
      proof.cpu.cr0 !== window.cr0 || proof.cpu.cr3 !== window.cr3 ||
      proof.cpu.cr4 !== window.cr4 ||
      proof.cpu._translationGeneration !== window.generation ||
      proof.linearPage !== window.linearPage ||
      proof.translation !== window.translation ||
      proof.physicalPage !== window.physicalPage ||
      proof.address !== window.physicalAddress ||
      proof.pageKind !== window.pageKind) return false;
  for (let i = 0; i < length; i++)
    if (machine.mem[proof.address + i] !== window.bytes[i]) return false;
  return true;
}
