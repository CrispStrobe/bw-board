// Pure, bounded description of byte-proven code16 instruction forms. This is
// diagnostic only: unknown lengths stay unknown, and no guest state is read.
const SEGMENTS = new Set([0x26, 0x2e, 0x36, 0x3e, 0x64, 0x65]);
const PREFIXES = new Set([...SEGMENTS, 0x66, 0x67, 0xf0, 0xf2, 0xf3]);
const MODRM = new Set([0x62, 0x63, 0x69, 0x6b, 0x80, 0x81, 0x82, 0x83,
  0x84, 0x85, 0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f,
  0xc0, 0xc1, 0xc4, 0xc5, 0xc6, 0xc7, 0xd0, 0xd1, 0xd2, 0xd3,
  0xf6, 0xf7, 0xfe, 0xff]);
const GROUP = new Set([0x80, 0x81, 0x82, 0x83, 0x8f, 0xc0, 0xc1,
  0xc6, 0xc7, 0xf6, 0xf7, 0xfe, 0xff]);
const MODRM_0F = new Set([0x00, 0x01, 0x02, 0x03, 0x20, 0x21, 0x22, 0x23,
  0xa3, 0xab, 0xb2, 0xb3, 0xb4, 0xb5, 0xb6, 0xb7, 0xba, 0xbb, 0xbc,
  0xbd, 0xbe, 0xbf]);
const hex = byte => byte.toString(16).padStart(2, '0');

function addressTail(bytes, at, modrm, address32) {
  const mod = modrm >>> 6, rm = modrm & 7;
  if (mod === 3) return 0;
  let tail = 0;
  if (address32) {
    let base = rm;
    if (rm === 4) {
      if (at >= bytes.length) return null;
      base = bytes[at] & 7; tail++;
    }
    if (mod === 0 && base === 5) tail += 4;
    else if (mod === 1) tail++;
    else if (mod === 2) tail += 4;
  } else if (mod === 0 && rm === 6) tail += 2;
  else if (mod === 1) tail++;
  else if (mod === 2) tail += 2;
  return tail;
}

/** Return a form and exact length only when this limited grammar proves it. */
export function decodeI80386Code16ObservedForm(bytes, offset = 0) {
  if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes))
    throw new TypeError('code bytes must be an array');
  if (!Number.isInteger(offset) || offset < 0 || offset > bytes.length)
    throw new RangeError('invalid code offset');
  const prefixes = [];
  let at = offset, operand32 = false, address32 = false;
  while (at < bytes.length && PREFIXES.has(bytes[at])) {
    const prefix = bytes[at++]; prefixes.push(prefix);
    if (prefix === 0x66) operand32 = true;
    if (prefix === 0x67) address32 = true;
    if (at - offset >= 15) return {key: 'prefix-limit', length: null,
      reason: 'prefix-limit'};
  }
  if (at >= bytes.length) return {key: 'incomplete-prefix', length: null,
    reason: 'incomplete'};
  const op = bytes[at++];
  let opKey = hex(op), second = null;
  if (op === 0x0f) {
    if (at >= bytes.length) return {key: `${opKey}:incomplete`, length: null,
      reason: 'incomplete'};
    second = bytes[at++]; opKey += hex(second);
  }
  let modrm = null, form = 'plain';
  const hasModrm = op === 0x0f ? MODRM_0F.has(second) :
    MODRM.has(op) || (op <= 0x3b && (op & 7) <= 3) ||
    (op >= 0xd8 && op <= 0xdf);
  if (hasModrm) {
    if (at >= bytes.length) return {key: `${opKey}:incomplete-modrm`,
      length: null, reason: 'incomplete'};
    modrm = bytes[at++];
    form = modrm >= 0xc0 ? 'reg' : 'mem';
    if (GROUP.has(op) || op === 0x8c || op === 0x8e ||
        (op === 0x0f && second === 0xba))
      form += `/${(modrm >>> 3) & 7}`;
    const tail = addressTail(bytes, at, modrm, address32);
    if (tail === null || at + tail > bytes.length)
      return {key: `${opKey}:${form}:incomplete-ea`, length: null,
        reason: 'incomplete'};
    at += tail;
  }
  const width = operand32 ? 4 : 2, addressWidth = address32 ? 4 : 2;
  let immediate = null;
  if (op === 0x0f) {
    if (second >= 0x80 && second <= 0x8f) immediate = width;
    else if (second === 0xba) immediate = 1;
    else if (MODRM_0F.has(second) || second === 0x06 ||
        (second >= 0xc8 && second <= 0xcf)) immediate = 0;
  } else if ((op < 0x40 && (op & 7) >= 4 && (op & 7) <= 5) ||
      op === 0xa8 || op === 0xa9)
    immediate = (op & 1) ? width : 1;
  else if (op >= 0xb0 && op <= 0xb7) immediate = 1;
  else if (op >= 0xb8 && op <= 0xbf) immediate = width;
  else if (op >= 0x70 && op <= 0x7f) immediate = 1;
  else if (op >= 0xa0 && op <= 0xa3) immediate = addressWidth;
  else if (op === 0x68 || op === 0xe8 || op === 0xe9) immediate = width;
  else if (op === 0x6a || op === 0x6b || op === 0x80 || op === 0x82 ||
      op === 0x83 || op === 0xc0 || op === 0xc1 || op === 0xc6 ||
      op === 0xcd || op === 0xd4 || op === 0xd5 || op === 0xe0 ||
      op === 0xe1 || op === 0xe2 || op === 0xe3 || op === 0xeb)
    immediate = 1;
  else if (op === 0x69 || op === 0x81 || op === 0xc7 || op === 0xf7 &&
      ((modrm >>> 3) & 7) === 0) immediate = width;
  else if (op === 0xf6 && ((modrm >>> 3) & 7) === 0) immediate = 1;
  else if (op === 0x9a || op === 0xea) immediate = width + 2;
  else if (op === 0xc2 || op === 0xca) immediate = 2;
  else if (op === 0xc8) immediate = 3;
  else if (op >= 0xe4 && op <= 0xe7) immediate = 1;
  else if (hasModrm || op === 0x90 || op >= 0x40 && op <= 0x5f ||
      op >= 0x6c && op <= 0x6f || op >= 0x91 && op <= 0x9f ||
      op >= 0xa4 && op <= 0xa7 || op >= 0xaa && op <= 0xaf ||
      op === 0xc3 || op === 0xcb || op === 0xcc || op === 0xce ||
      op === 0xcf || op >= 0xf4 && op <= 0xfd) immediate = 0;
  const key = `${prefixes.map(hex).join('.') || '-'}:${opKey}:${form}:`+
    `o${operand32 ? 32 : 16}:a${address32 ? 32 : 16}`;
  if (immediate === null) return {key, length: null, reason: 'unknown-length'};
  if (at + immediate > bytes.length || at + immediate - offset > 15)
    return {key, length: null, reason: 'incomplete'};
  return {key, length: at + immediate - offset, reason: 'known-length'};
}
