/**
 * Intel HEX → Uint16Array loader for AVR flash.
 *
 * Intel HEX (INHX8M / I8HEX) record format:
 *   :LLAAAATT[DD...]CC
 *   LL   = byte count
 *   AAAA = 16-bit address
 *   TT   = record type (00 = data, 01 = EOF, 02 = ext segment, 04 = ext linear)
 *   DD   = data bytes
 *   CC   = two's-complement checksum (sum of all bytes including CC ≡ 0 mod 256)
 *
 * AVR flash is word-addressed (16-bit words). avr-gcc/avr-objcopy emits
 * byte-addressed Intel HEX with little-endian byte pairs: low byte at even
 * address, high byte at odd. This loader reassembles them into a Uint16Array
 * where index i holds the instruction word at flash word address i.
 *
 * Extended address records (types 02 and 04) are supported for completeness
 * but ATmega328P's 32 KB flash never needs them.
 *
 * @module
 */

/**
 * Parse an Intel HEX string into a Uint16Array of AVR flash words.
 *
 * @param {string} hex - Intel HEX content (multi-line, ':' prefix per line)
 * @param {number} [flashBytes=0x8000] - flash size in bytes (default 32 KB = ATmega328P)
 * @returns {Uint16Array} word-addressed flash image (length = flashBytes / 2)
 * @throws {Error} on checksum failure, malformed records, or address overflow
 */
export function parseIntelHex(hex, flashBytes = 0x8000) {
  const bytes = new Uint8Array(flashBytes);
  let baseAddress = 0; // from extended address records
  let maxAddr = 0;

  for (const raw of hex.split('\n')) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line[0] !== ':') {
      throw new Error(`Intel HEX: expected ':' prefix, got "${line.slice(0, 10)}"`);
    }

    // Minimum valid record: :LLAAAATTCC = 11 chars
    if (line.length < 11) {
      throw new Error(`Intel HEX: record too short: "${line}"`);
    }

    const len  = parseByte(line, 1);
    const addr = (parseByte(line, 3) << 8) | parseByte(line, 5);
    const type = parseByte(line, 7);

    // Expected total hex chars: 1 (':') + 2*(len + 5)
    const expected = 1 + 2 * (len + 5);
    if (line.length < expected) {
      throw new Error(`Intel HEX: record length mismatch (declared ${len} data bytes, got ${line.length} chars)`);
    }

    // Verify checksum: sum of all bytes (len, addr hi, addr lo, type, data, checksum) ≡ 0 mod 256
    let sum = 0;
    for (let i = 0; i < len + 5; i++) {
      sum += parseByte(line, 1 + i * 2);
    }
    if ((sum & 0xFF) !== 0) {
      throw new Error(`Intel HEX: checksum error on line "${line.slice(0, 20)}…" (sum=${sum & 0xFF})`);
    }

    if (type === 0x00) {
      // Data record
      const fullAddr = baseAddress + addr;
      for (let i = 0; i < len; i++) {
        const a = fullAddr + i;
        if (a >= flashBytes) {
          throw new Error(`Intel HEX: address 0x${a.toString(16)} exceeds flash size (${flashBytes} bytes)`);
        }
        bytes[a] = parseByte(line, 9 + i * 2);
        if (a + 1 > maxAddr) maxAddr = a + 1;
      }
    } else if (type === 0x01) {
      // EOF
      break;
    } else if (type === 0x02) {
      // Extended segment address: data is a 16-bit segment base, shifted left 4
      if (len !== 2) throw new Error('Intel HEX: type 02 record must have 2 data bytes');
      baseAddress = ((parseByte(line, 9) << 8) | parseByte(line, 11)) << 4;
    } else if (type === 0x04) {
      // Extended linear address: data is upper 16 bits of a 32-bit base
      if (len !== 2) throw new Error('Intel HEX: type 04 record must have 2 data bytes');
      baseAddress = ((parseByte(line, 9) << 8) | parseByte(line, 11)) << 16;
    }
    // Types 03 (start segment) and 05 (start linear) are ignored — AVR
    // always starts at word address 0.
  }

  // Reassemble little-endian byte pairs into 16-bit words
  const wordCount = flashBytes / 2;
  const words = new Uint16Array(wordCount);
  for (let i = 0; i < wordCount; i++) {
    words[i] = bytes[i * 2] | (bytes[i * 2 + 1] << 8);
  }
  return words;
}

/**
 * Parse two hex characters at position `pos` (0-based in the string, where
 * the string includes the leading ':'). pos is the char index of the first
 * hex digit.
 */
function parseByte(line, pos) {
  const hi = hexVal(line.charCodeAt(pos));
  const lo = hexVal(line.charCodeAt(pos + 1));
  if (hi < 0 || lo < 0) {
    throw new Error(`Intel HEX: invalid hex chars at position ${pos}: "${line.slice(pos, pos + 2)}"`);
  }
  return (hi << 4) | lo;
}

function hexVal(c) {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;       // '0'–'9'
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;   // 'A'–'F'
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;   // 'a'–'f'
  return -1;
}
