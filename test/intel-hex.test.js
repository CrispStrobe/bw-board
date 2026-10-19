/**
 * Intel HEX parser — oracle tests with hand-written hex records.
 *
 * Every expected value is derived by hand from the hex encoding, not from
 * running the parser first. The point: these are an oracle, not a snapshot.
 *
 * Intel HEX record format refresher:
 *   :LLAAAATT[DD...]CC
 *   Checksum CC = two's complement of (sum of all preceding bytes) mod 256.
 *
 * AVR flash is word-addressed, little-endian: bytes at addresses 0x0000 and
 * 0x0001 form word[0] = byte[0] | (byte[1] << 8).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseIntelHex } from '../src/intel-hex.js';

describe('parseIntelHex', () => {
  // ─── Single data record ──────────────────────────────────────────────

  it('parses a single 4-byte data record into 2 words (little-endian)', () => {
    // Record: 4 bytes at address 0x0000: 0x0C 0x94 0x34 0x00
    // Checksum: -(0x04 + 0x00 + 0x00 + 0x00 + 0x0C + 0x94 + 0x34 + 0x00) mod 256
    //         = -(0xD8) mod 256 = 0x28
    // Word[0] = 0x0C | (0x94 << 8) = 0x940C  (rjmp-style reset vector)
    // Word[1] = 0x34 | (0x00 << 8) = 0x0034
    const hex = [
      ':040000000C94340028',
      ':00000001FF',
    ].join('\n');

    const words = parseIntelHex(hex, 16); // tiny flash for test
    assert.equal(words[0], 0x940C);
    assert.equal(words[1], 0x0034);
    // Rest should be zero
    for (let i = 2; i < words.length; i++) {
      assert.equal(words[i], 0, `word[${i}] should be 0`);
    }
  });

  // ─── Non-zero base address ───────────────────────────────────────────

  it('places bytes at the correct offset for non-zero address', () => {
    // 2 bytes at address 0x0004: 0xAB 0xCD
    // Checksum: -(0x02 + 0x00 + 0x04 + 0x00 + 0xAB + 0xCD) mod 256
    //         = -(0x17E) mod 256 = 0x82
    // Word[2] = 0xAB | (0xCD << 8) = 0xCDAB
    const hex = [
      ':02000400ABCD82',
      ':00000001FF',
    ].join('\n');

    const words = parseIntelHex(hex, 16);
    assert.equal(words[0], 0);
    assert.equal(words[1], 0);
    assert.equal(words[2], 0xCDAB);
  });

  // ─── Multiple records ────────────────────────────────────────────────

  it('concatenates multiple data records', () => {
    // Record 1: 2 bytes at 0x0000: 0x11 0x22
    //   sum = 0x02+0x00+0x00+0x00+0x11+0x22 = 0x35, CC = 0xCB
    //   Word[0] = 0x2211
    // Record 2: 2 bytes at 0x0002: 0x33 0x44
    //   sum = 0x02+0x00+0x02+0x00+0x33+0x44 = 0x7B, CC = 0x85
    //   Word[1] = 0x4433
    const hex = [
      ':0200000011220000CB',   // first fix below
      ':0200020033440000',     // placeholder, fix checksums
      ':00000001FF',
    ].join('\n');

    // Let me recompute properly:
    // Nope, let me just be precise. Hand-compute each.
    // Actually let me redo this cleanly.
    const hex2 = buildHex([
      { addr: 0x0000, data: [0x11, 0x22] },
      { addr: 0x0002, data: [0x33, 0x44] },
    ]);

    const words = parseIntelHex(hex2, 16);
    assert.equal(words[0], 0x2211);
    assert.equal(words[1], 0x4433);
  });

  // ─── Odd-length record (single byte fills half a word) ───────────────

  it('handles a 1-byte record (fills low byte only)', () => {
    // 1 byte at 0x0000: 0xFF
    // Word[0] = 0xFF | (0x00 << 8) = 0x00FF
    const hex = buildHex([{ addr: 0x0000, data: [0xFF] }]);
    const words = parseIntelHex(hex, 4);
    assert.equal(words[0], 0x00FF);
  });

  it('handles a 1-byte record at odd address (fills high byte only)', () => {
    // 1 byte at 0x0001: 0xAA
    // Word[0] = 0x00 | (0xAA << 8) = 0xAA00
    const hex = buildHex([{ addr: 0x0001, data: [0xAA] }]);
    const words = parseIntelHex(hex, 4);
    assert.equal(words[0], 0xAA00);
  });

  // ─── Extended segment address (type 02) ──────────────────────────────

  it('applies extended segment address (type 02)', () => {
    // Type 02: segment base 0x1000, so base address = 0x1000 << 4 = 0x10000
    // Then data record at offset 0x0000 → absolute address 0x10000
    const flashBytes = 0x20000; // 128 KB for this test
    // ext segment record: len=02 addr=0000 type=02 data=10,00
    //   sum = 02+00+00+02+10+00 = 0x14, CC = (-0x14)&0xFF = 0xEC ✓
    // data record: len=02 addr=0000 type=00 data=55,AA
    //   sum = 02+00+00+00+55+AA = 0x101, CC = (-0x101)&0xFF = 0xFF
    const hex = [
      ':020000021000EC',
      ':020000005500AAFF',  // wrong — let me use buildHex for the data part
      ':00000001FF',
    ].join('\n');

    // Actually just compute: 02+00+00+00+55+AA = 0x101. CC = 0xFF.
    // But that string ':020000005500AAFF' has 4 data chars too many. Fix:
    const hex2 = ':020000021000EC\n' +
      buildHexDataRecord(0x0000, [0x55, 0xAA]) + '\n' +
      ':00000001FF';

    const words = parseIntelHex(hex2, flashBytes);
    const wordIdx = 0x10000 / 2;
    assert.equal(words[wordIdx], 0xAA55);
  });

  // ─── Extended linear address (type 04) ───────────────────────────────

  it('applies extended linear address (type 04)', () => {
    // Type 04: upper 16 bits = 0x0001 → base = 0x00010000
    //   sum = 02+00+00+04+00+01 = 0x07, CC = (-7)&0xFF = 0xF9 ✓
    const flashBytes = 0x20000;
    const hex = ':020000040001F9\n' +
      buildHexDataRecord(0x0000, [0xEE, 0xFF]) + '\n' +
      ':00000001FF';

    const words = parseIntelHex(hex, flashBytes);
    const wordIdx = 0x10000 / 2;
    assert.equal(words[wordIdx], 0xFFEE);
  });

  // ─── Checksum validation ─────────────────────────────────────────────

  it('rejects a record with a bad checksum', () => {
    const hex = ':0200000011220000CC\n:00000001FF'; // CC should be CB
    // Actually let me be precise. The correct checksum for 02 00 00 00 11 22:
    // sum = 2+0+0+0+0x11+0x22 = 0x35. CC = (-0x35) & 0xFF = 0xCB.
    // So CC=0xCC is wrong.
    const badHex = ':020000001122CC\n:00000001FF';
    assert.throws(() => parseIntelHex(badHex, 16), /checksum/i);
  });

  // ─── Malformed input ─────────────────────────────────────────────────

  it('rejects a line without : prefix', () => {
    assert.throws(() => parseIntelHex('020000001122CB\n:00000001FF', 16), /prefix|':'/);
  });

  it('rejects a truncated record', () => {
    assert.throws(() => parseIntelHex(':0200\n', 16), /short/i);
  });

  // ─── Empty / EOF-only ────────────────────────────────────────────────

  it('returns zeroed flash for EOF-only input', () => {
    const words = parseIntelHex(':00000001FF\n', 16);
    assert.equal(words.length, 8);
    for (let i = 0; i < words.length; i++) assert.equal(words[i], 0);
  });

  // ─── Address overflow ────────────────────────────────────────────────

  it('throws on address exceeding flash size', () => {
    // 2 bytes at address 0x0010 into a 16-byte flash → overflow
    const hex = buildHex([{ addr: 0x0010, data: [0x01, 0x02] }]);
    assert.throws(() => parseIntelHex(hex, 16), /exceeds|overflow/i);
  });

  // ─── Case insensitivity ──────────────────────────────────────────────

  it('accepts lowercase hex digits', () => {
    const hex = ':020000001122cb\n:00000001ff';
    const words = parseIntelHex(hex, 16);
    assert.equal(words[0], 0x2211);
  });

  // ─── Real-world pattern: AVR reset vector ────────────────────────────

  it('decodes a typical AVR reset vector correctly', () => {
    // A typical ATmega328P reset vector produced by avr-gcc:
    //   :100000000C9434000C9451000C9451000C94510095
    // 16 bytes at 0x0000 (8 words of interrupt vector table).
    // Verify checksum: sum of all bytes =
    //   0x10+0x00+0x00+0x00 + 0x0C+0x94+0x34+0x00 + 0x0C+0x94+0x51+0x00
    //   + 0x0C+0x94+0x51+0x00 + 0x0C+0x94+0x51+0x00 + 0x95
    // = 0x10 + 0x00 + 0xD8 + 0xF5 + 0xF5 + 0xF5 + 0x95 ... let me compute:
    //   0x10=16, 0xD8=216, three 0xF5=245 each, so 16+0+0+0+216+245+245+245
    //   But I need each byte separately:
    //   0x10+0+0+0 + 0x0C+0x94+0x34+0 + 0x0C+0x94+0x51+0 + 0x0C+0x94+0x51+0 + 0x0C+0x94+0x51+0
    //   = 16 + 12+148+52+0 + 12+148+81+0 + 12+148+81+0 + 12+148+81+0
    //   = 16 + 212 + 241 + 241 + 241 = 951 = 0x3B7
    //   CC = (-0x3B7) & 0xFF = (-951) & 0xFF. 951 mod 256 = 951-3*256 = 951-768 = 183 = 0xB7
    //   CC = 256-183 = 73 = 0x49? No... two's complement: (-183)&0xFF = 256-183 = 73 = 0x49
    //   But the record says 0x95. Let me just use the helper.
    //
    // Actually, let me just build it properly:
    const hex = buildHex([{
      addr: 0x0000,
      data: [0x0C, 0x94, 0x34, 0x00, 0x0C, 0x94, 0x51, 0x00,
             0x0C, 0x94, 0x51, 0x00, 0x0C, 0x94, 0x51, 0x00],
    }]);

    const words = parseIntelHex(hex, 64);
    // Word[0] = 0x0C | (0x94 << 8) = 0x940C  (JMP to 0x0034)
    assert.equal(words[0], 0x940C);
    // Word[1] = 0x34 | (0x00 << 8) = 0x0034
    assert.equal(words[1], 0x0034);
    // Word[2] = 0x0C | (0x94 << 8) = 0x940C  (JMP to 0x0051)
    assert.equal(words[2], 0x940C);
    // Word[3] = 0x51 | (0x00 << 8) = 0x0051
    assert.equal(words[3], 0x0051);
    // Words 4-7 repeat the 0x0051 pattern
    assert.equal(words[4], 0x940C);
    assert.equal(words[5], 0x0051);
    assert.equal(words[6], 0x940C);
    assert.equal(words[7], 0x0051);
  });

  // ─── Blank lines and whitespace ──────────────────────────────────────

  it('ignores blank lines between records', () => {
    const hex = '\n' + buildHex([{ addr: 0x0000, data: [0x42, 0x43] }]) + '\n\n';
    const words = parseIntelHex(hex, 8);
    assert.equal(words[0], 0x4342);
  });

  // ─── Windows line endings ────────────────────────────────────────────

  it('handles \\r\\n line endings', () => {
    const hex = buildHex([{ addr: 0x0000, data: [0xDE, 0xAD] }]).replace(/\n/g, '\r\n');
    const words = parseIntelHex(hex, 8);
    assert.equal(words[0], 0xADDE);
  });

  // ─── Default flash size ──────────────────────────────────────────────

  it('defaults to 32 KB (ATmega328P) flash', () => {
    const hex = buildHex([{ addr: 0x0000, data: [0x01, 0x02] }]);
    const words = parseIntelHex(hex);
    assert.equal(words.length, 0x4000); // 32768 / 2 = 16384 words
  });
});

// ─── Test helper: build valid Intel HEX from data specs ──────────────────

/**
 * Build a valid Intel HEX string from an array of { addr, data } records.
 * Computes correct checksums. Used only in tests so the oracle values
 * (asserted above) are derived by hand, not by this function.
 */
function buildHex(records) {
  const lines = [];
  for (const { addr, data } of records) {
    const len = data.length;
    const addrHi = (addr >> 8) & 0xFF;
    const addrLo = addr & 0xFF;
    let sum = len + addrHi + addrLo + 0x00; // type 00
    let dataHex = '';
    for (const b of data) {
      dataHex += byte(b);
      sum += b;
    }
    const cc = (-sum) & 0xFF;
    lines.push(`:${byte(len)}${byte(addrHi)}${byte(addrLo)}00${dataHex}${byte(cc)}`);
  }
  lines.push(':00000001FF');
  return lines.join('\n');
}

/** Build a single data record (type 00) with correct checksum. */
function buildHexDataRecord(addr, data) {
  const len = data.length;
  const addrHi = (addr >> 8) & 0xFF;
  const addrLo = addr & 0xFF;
  let sum = len + addrHi + addrLo + 0x00;
  let dataHex = '';
  for (const b of data) {
    dataHex += byte(b);
    sum += b;
  }
  const cc = (-sum) & 0xFF;
  return `:${byte(len)}${byte(addrHi)}${byte(addrLo)}00${dataHex}${byte(cc)}`;
}

function byte(n) {
  return n.toString(16).toUpperCase().padStart(2, '0');
}
