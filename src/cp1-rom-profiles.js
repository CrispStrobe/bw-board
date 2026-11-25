// SPDX-License-Identifier: MIT
/** ROM identification metadata only. No historical firmware bytes are distributed. */
import {CP1_INDEPENDENT_MONITOR_ROM} from './cp1-monitor-profile.generated.js';
import {CP1_INDEPENDENT_MONITOR_ROM as CP1_CP2_MONITOR_ROM} from './cp1-monitor-cp2-profile.generated.js';

export const CP1_ROM_BYTES = 2048;
export const CP1_ROM_PROFILES = Object.freeze([
  Object.freeze({ id: 'cp1-mask-b', name: 'Kosmos CP1 mask ROM B', bytes: 2048, sha1: 'c987b79a7b90fcbd58b66a69e95913f2655a1f0d' }),
  Object.freeze({ id: 'cp1-2716', name: 'Kosmos CP1 2716 firmware', bytes: 2048, sha1: 'ff4befcf82a664950186d3af1843fdef70d2209f' }),
  CP1_INDEPENDENT_MONITOR_ROM,
  CP1_CP2_MONITOR_ROM,
]);

/** Synchronous browser-compatible SHA-1 for identity, never for authentication. */
export function sha1Bytes(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('ROM must be a Uint8Array');
  const size = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(size);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  const bitLength = bytes.length * 8;
  view.setUint32(size - 8, Math.floor(bitLength / 0x100000000), false);
  view.setUint32(size - 4, bitLength >>> 0, false);
  const words = new Uint32Array(80);
  const rotate = (value, count) => (value << count) | (value >>> (32 - count));
  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;
  for (let offset = 0; offset < size; offset += 64) {
    for (let i = 0; i < 16; i++) words[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 80; i++) words[i] = rotate(words[i - 3] ^ words[i - 8] ^ words[i - 14] ^ words[i - 16], 1);
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20) { f = (b & c) | (~b & d); k = 0x5a827999; }
      else if (i < 40) { f = b ^ c ^ d; k = 0x6ed9eba1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8f1bbcdc; }
      else { f = b ^ c ^ d; k = 0xca62c1d6; }
      const next = (rotate(a, 5) + f + e + k + words[i]) >>> 0;
      e = d; d = c; c = rotate(b, 30) >>> 0; b = a; a = next;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(value => value.toString(16).padStart(8, '0')).join('');
}

export function identifyCp1Rom(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== CP1_ROM_BYTES) {
    throw new TypeError('Kosmos CP1 requires a user-supplied, exactly 2048-byte 8049 ROM image');
  }
  const sha1 = sha1Bytes(bytes);
  const profile = CP1_ROM_PROFILES.find(entry => entry.sha1 === sha1);
  return profile ? { ...profile, known: true } : {
    id: 'unknown', name: 'User-supplied 8049 firmware', bytes: bytes.length, sha1, known: false,
  };
}
