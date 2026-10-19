/**
 * An S110 APPLICATION region out of an Intel HEX image, as an ELF.
 *
 * A micro:bit V1 / Calliope mini `.hex` (MakeCode, CODAL/DAL) carries the
 * Nordic SoftDevice at 0x0..0x18000, the application from 0x18000 and often a
 * UICR record at 0x1000_1000. labwired emulates the SoftDevice at API level
 * (crates/nrf-softdevice-hle) and never loads a Nordic byte, so only the
 * application window is kept; everything outside it is dropped here, before
 * anything reaches the engine.
 *
 * Records honoured: 00 data, 01 EOF, 02 extended segment, 04 extended linear,
 * 03/05 start addresses (ignored: the entry is the application's reset
 * vector). Anything else -- e.g. the micro:bit V2 universal-hex block records
 * 0A..0C -- is refused by name rather than half-read.
 * @module
 */

import { armSegmentsToElf } from './uf2-to-elf.js';

export const S110_APP_BASE = 0x18000;
export const NRF51_FLASH_END = 0x40000;

/**
 * Intel HEX text -> address-ordered contiguous segments.
 * @param {string} text
 * @returns {{addr: number, data: Uint8Array}[]}
 */
export function hexToSegments (text) {
  const bytes = new Map();
  let base = 0;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line[0] !== ':') throw new Error(`Intel HEX: expected ':' at "${line.slice(0, 12)}"`);
    const b = [];
    for (let i = 1; i + 1 < line.length; i += 2) b.push(parseInt(line.slice(i, i + 2), 16));
    if (b.some(Number.isNaN) || b.length < 5) throw new Error(`Intel HEX: malformed record "${line.slice(0, 20)}"`);
    const [len, hi, lo, type] = b;
    if (b.length !== len + 5) throw new Error(`Intel HEX: record length mismatch at "${line.slice(0, 20)}"`);
    if ((b.reduce((s, x) => s + x, 0) & 0xff) !== 0) throw new Error(`Intel HEX: checksum error at "${line.slice(0, 20)}"`);
    const data = b.slice(4, 4 + len);
    if (type === 0x00) {
      const at = base + ((hi << 8) | lo);
      data.forEach((v, i) => bytes.set(at + i, v));
    } else if (type === 0x01) {
      break;
    } else if (type === 0x02) {
      base = ((data[0] << 8) | data[1]) << 4;
    } else if (type === 0x04) {
      base = ((data[0] << 8) | data[1]) * 0x10000;
    } else if (type === 0x03 || type === 0x05) {
      // start address: the application's reset vector is the entry instead
    } else {
      throw new Error(`Intel HEX: record type 0x${type.toString(16).padStart(2, '0')} is not a plain ` +
        'Intel HEX record (a micro:bit V2 universal hex, perhaps) -- use a micro:bit V1 / Calliope .hex');
    }
  }
  const addrs = [...bytes.keys()].sort((a, b) => a - b);
  const segments = [];
  for (const a of addrs) {
    const last = segments[segments.length - 1];
    if (last && last.addr + last.bytes.length === a) last.bytes.push(bytes.get(a));
    else segments.push({ addr: a, bytes: [bytes.get(a)] });
  }
  return segments.map(s => ({ addr: s.addr, data: Uint8Array.from(s.bytes) }));
}

/**
 * The application window of an nRF51 S110 image, as an ARM ELF whose entry is
 * the application's own reset vector (word 1 at 0x18000).
 * @param {string} text Intel HEX
 * @returns {{elf: Uint8Array, dropped: number}} dropped: bytes outside the window
 */
export function s110AppRegionElf (text) {
  const all = hexToSegments(text);
  let dropped = 0;
  const kept = [];
  for (const s of all) {
    const lo = Math.max(s.addr, S110_APP_BASE);
    const hi = Math.min(s.addr + s.data.length, NRF51_FLASH_END);
    dropped += s.data.length - Math.max(0, hi - lo);
    if (hi > lo) kept.push({ addr: lo, data: s.data.subarray(lo - s.addr, hi - s.addr) });
  }
  if (!kept.length || kept[0].addr !== S110_APP_BASE || kept[0].data.length < 8) {
    throw new Error('no S110 application at 0x18000 in this hex (is it a micro:bit V1 / Calliope image?)');
  }
  const v = kept[0].data;
  const entry = (v[4] | (v[5] << 8) | (v[6] << 16) | (v[7] << 24)) >>> 0;
  return { elf: armSegmentsToElf(kept, entry), dropped };
}
