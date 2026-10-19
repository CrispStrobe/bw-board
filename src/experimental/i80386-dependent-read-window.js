// Admission-only proof for two dependent flat protected32 RAM reads. This
// never walks guest page tables or calls the bus: an uncached or unsafe page
// is a refusal, leaving fault/A/D ordering to the ordinary interpreter. A
// cached read may target a page-table page; this grants no write admission.
import {prevalidateI80386ReadWindow, isI80386ReadWindowValid} from
  './i80386-read-window.js';

const CS = 1, DS = 3;
const DESCRIPTOR_FIELDS = ['base', 'limit', 'default32', 'present', 'code',
  'readable', 'writable', 'null', 'expandDown', 'type', 'dpl', 'rpl',
  'conforming', 'access', 'address', 'descriptorAddress'];
const TRANSLATION_FIELDS = ['generation', 'page', 'cr3', 'cr4',
  'physicalBase', 'userPage', 'writable', 'dirty'];

function snapshot(object, fields) {
  return Object.freeze(fields.map(field => object?.[field]));
}

function unchanged(object, fields, values) {
  return fields.every((field, index) => Object.is(object?.[field], values[index]));
}

function descriptorDpl(cache) {
  const explicit = cache?.dpl;
  const access = cache?.access;
  const fromAccess = Number.isInteger(access) && access >= 0 && access <= 255 ?
    (access >>> 5) & 3 : null;
  if (explicit === undefined) return fromAccess;
  if (!Number.isInteger(explicit) || explicit < 0 || explicit > 3 ||
      (fromAccess !== null && explicit !== fromAccess)) return null;
  return explicit;
}

function scalarAddress(offset, width) {
  return Number.isInteger(offset) && offset >= 0 && offset <= 0xffffffff &&
    (width === 1 || width === 2 || width === 4) &&
    offset + width - 1 <= 0xffffffff &&
    (offset & 0xfff) + width <= 4096;
}

function physicalAddress(window, offset) {
  return window.physicalPage + (offset & 0xfff);
}

function ramValue(memory, address, width) {
  let value = 0;
  for (let i = 0; i < width; i++) value |= memory[address + i] << (8 * i);
  return value >>> 0;
}

function plainWindow(machine, offset, width, segment) {
  if (!scalarAddress(offset, width)) return null;
  const window = prevalidateI80386ReadWindow(machine, offset, segment);
  if (!window || !isI80386ReadWindowValid(window) ||
      machine._page?.[window.physicalPage >>> 12] !== 1) return null;
  const physical = physicalAddress(window, offset);
  if (physical + width > machine.mem?.length) return null;
  return window;
}

export function prevalidateI80386DependentRead(machine, firstOffset, firstWidth,
    deriveSecondOffset, secondWidth = 4) {
  const cpu = machine?.cpu;
  if (machine?.variant !== '80386' || !cpu?.segmentCaches?.[CS]?.default32 ||
      !cpu.protectedMode || cpu.virtual8086 || cpu._retainedRealCs ||
      typeof deriveSecondOffset !== 'function' ||
      !(machine.mem instanceof Uint8Array) ||
      !scalarAddress(firstOffset, firstWidth) ||
      !scalarAddress(cpu.eip, 1)) return null;
  const cs = cpu.segmentCaches[CS], ds = cpu.segmentCaches[DS];
  const csDpl = descriptorDpl(cs), dsDpl = descriptorDpl(ds);
  if (csDpl === null ||
      (cs.conforming ? csDpl > cpu.currentPrivilegeLevel :
        csDpl !== cpu.currentPrivilegeLevel) ||
      !ds || ds.code || dsDpl === null ||
      Math.max(cpu.currentPrivilegeLevel, cpu.ds & 3) > dsDpl) return null;
  const code = plainWindow(machine, cpu.eip, 1, CS);
  const first = plainWindow(machine, firstOffset, firstWidth, DS);
  if (!code || !first || code.physicalPage === first.physicalPage) return null;
  const firstValue = ramValue(machine.mem,
    physicalAddress(first, firstOffset), firstWidth);
  // The callback must be pure and may inspect only this scalar value. It is
  // trusted caller code; this helper does not police closure side effects.
  const secondOffset = deriveSecondOffset(firstValue);
  const second = plainWindow(machine, secondOffset, secondWidth, DS);
  if (!second || second.physicalPage === code.physicalPage ||
      second.physicalPage === first.physicalPage) return null;
  const proof = Object.freeze({machine, cpu, code, first, second,
    readOnly:true,
    firstOffset, firstWidth, firstValue, secondOffset, secondWidth,
    csSelector:cpu.cs, dsSelector:cpu.ds,
    privilege:cpu.currentPrivilegeLevel, cs, ds,
    translationCacheEnabled:cpu._translationCacheEnabled,
    retainedRealCs:cpu._retainedRealCs,
    csFields:snapshot(cs, DESCRIPTOR_FIELDS),
    dsFields:snapshot(ds, DESCRIPTOR_FIELDS),
    translations:cpu._translations, tablePages:cpu._translationTablePages,
    pageMap:machine._page, memory:machine.mem,
    a20Configured:machine._a20Configured,
    a20Enabled:machine._a20Enabled,
    translationFields:Object.freeze([code, first, second].map(window =>
      snapshot(window.translation, TRANSLATION_FIELDS)))});
  return isI80386DependentReadValid(proof) ? proof : null;
}

export function isI80386DependentReadValid(proof) {
  if (!proof) return false;
  const {machine, cpu, code, first, second} = proof;
  if (machine?.cpu !== cpu || machine.variant !== '80386' ||
      machine.mem !== proof.memory || machine._page !== proof.pageMap ||
      cpu._translations !== proof.translations ||
      cpu._translationTablePages !== proof.tablePages ||
      machine._a20Configured !== proof.a20Configured ||
      machine._a20Enabled !== proof.a20Enabled ||
      (cpu.eip >>> 12) !== (code.linearPage >>> 12) ||
      cpu.cs !== proof.csSelector ||
      cpu.ds !== proof.dsSelector ||
      cpu.currentPrivilegeLevel !== proof.privilege ||
      !cpu._translationCacheEnabled ||
      cpu._translationCacheEnabled !== proof.translationCacheEnabled ||
      cpu._retainedRealCs !== proof.retainedRealCs ||
      !cpu.protectedMode || cpu.virtual8086 ||
      cpu.segmentCaches[CS] !== proof.cs ||
      cpu.segmentCaches[DS] !== proof.ds ||
      !unchanged(proof.cs, DESCRIPTOR_FIELDS, proof.csFields) ||
      !unchanged(proof.ds, DESCRIPTOR_FIELDS, proof.dsFields) ||
      ![code, first, second].every((window, index) =>
        isI80386ReadWindowValid(window) &&
        unchanged(window.translation, TRANSLATION_FIELDS,
          proof.translationFields[index]) &&
        machine._page?.[window.physicalPage >>> 12] === 1))
    return false;
  return ramValue(machine.mem, physicalAddress(first, proof.firstOffset),
    proof.firstWidth) === proof.firstValue;
}
