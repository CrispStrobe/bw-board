// Pure 16-bit ModR/M memory descriptor. It neither fetches guest bytes nor
// captures register values; resolve it against the CPU immediately at access.
import {prevalidateI80386Code16DataWindow,
  isI80386Code16DataWindowValid} from './i80386-code16-data-window.js';

const DS = 3;
const SS = 2;
const TERMS = [
  ['bx', 'si'], ['bx', 'di'], ['bp', 'si'], ['bp', 'di'],
  ['si'], ['di'], ['bp'], ['bx'],
];

/** Decode one mod 00/01/10 memory operand from caller-owned instruction bytes. */
export function decodeI80386Code16EA(bytes, {
  address32 = false, segmentOverride = null,
} = {}) {
  if (address32 !== false ||
      (segmentOverride !== null &&
        (!Number.isInteger(segmentOverride) || segmentOverride < 0 || segmentOverride > 5)) ||
      !bytes || !Number.isInteger(bytes.length) || bytes.length < 1) return null;
  const byte = i => Number.isInteger(bytes[i]) && bytes[i] >= 0 && bytes[i] <= 255
    ? bytes[i] : null;
  const modrm = byte(0);
  if (modrm === null) return null;
  const mod = modrm >>> 6, reg = (modrm >>> 3) & 7, rm = modrm & 7;
  if (mod === 3) return null;
  const length = mod === 0 && rm !== 6 ? 1 : mod === 1 ? 2 : 3;
  if (bytes.length < length) return null;
  for (let i = 1; i < length; i++) if (byte(i) === null) return null;
  const direct = mod === 0 && rm === 6;
  const terms = direct ? [] : TERMS[rm];
  const displacement = direct ? (byte(1) | (byte(2) << 8))
    : mod === 1 ? ((byte(1) << 24) >> 24)
      : mod === 2 ? ((byte(1) | (byte(2) << 8)) << 16) >> 16 : 0;
  const defaultSegment = !direct && (rm === 2 || rm === 3 || rm === 6) ? SS : DS;
  return Object.freeze({mod, reg, rm, isReg: false, usesEsp: false,
    length, terms: Object.freeze([...terms]), displacement, defaultSegment,
    segmentOverride});
}

/** Apply current 16-bit BX/BP/SI/DI values; a changed register changes off. */
export function resolveI80386Code16EA(descriptor, cpu) {
  if (!descriptor || !cpu || !Array.isArray(descriptor.terms) ||
      !Number.isInteger(descriptor.displacement) ||
      !Number.isInteger(descriptor.defaultSegment)) return null;
  let off = descriptor.displacement;
  for (const name of descriptor.terms) {
    if (!['bx', 'bp', 'si', 'di'].includes(name) ||
        !Number.isInteger(cpu[name])) return null;
    off += cpu[name] & 0xffff;
  }
  return Object.freeze({reg: descriptor.reg, rm: descriptor.rm, isReg: false,
    usesEsp: false, seg: descriptor.segmentOverride ?? descriptor.defaultSegment,
    off: off & 0xffff});
}

/** Pair a live EA with the published data-window proof; no guest access. */
export function prevalidateI80386Code16EADataWindow(
  machine, codeWindow, descriptor, width, access
) {
  const ea = resolveI80386Code16EA(descriptor, machine?.cpu);
  if (!ea) return null;
  const dataWindow = prevalidateI80386Code16DataWindow(
    machine, codeWindow, ea.seg, ea.off, width, access);
  return dataWindow ? Object.freeze({machine, cpu: machine.cpu, descriptor,
    ea, dataWindow}) : null;
}

/** Refuse if registers changed or either code/data proof became stale. */
export function isI80386Code16EADataWindowValid(window) {
  if (!window || window.machine?.cpu !== window.cpu ||
      !isI80386Code16DataWindowValid(window.dataWindow)) return false;
  const ea = resolveI80386Code16EA(window.descriptor, window.cpu);
  return !!ea && ea.seg === window.ea.seg && ea.off === window.ea.off &&
    ea.reg === window.ea.reg && ea.rm === window.ea.rm;
}
