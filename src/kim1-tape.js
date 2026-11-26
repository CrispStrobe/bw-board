// SPDX-License-Identifier: MIT
// MOS KIM-1 User Manual, Appendix F. Intel HEX uses a separate byte checksum.
const bytePairs = text => text.match(/../g).map(pair => parseInt(pair, 16));
const checksum = bytes => bytes.reduce((total, byte) => total + byte, 0);

export function readKim1Records(source) {
  const lines = source.replace(/^\uFEFF/, '').replace(/^[\x00\x11\x13\x7F]+|[\x00\x11\x13\x7F]+$/gm, '')
    .split(/\r\n|\r|\n/).map(line => line.trim()).filter(Boolean);
  const first = lines[0] ?? '';
  const paperTape = /^;[0-9a-f]{6}/i.test(first);
  const intelHex = first.startsWith(':');
  if (!paperTape && !intelHex) return null;
  let done = false, base = 0, recordCount = 0, entry;
  const records = [];
  for (const [index, line] of lines.entries()) {
    const fail = message => { throw new Error(`Record ${index + 1}: ${message}`); };
    if (done) fail('unexpected data after the end record.');
    const prefix = paperTape ? ';' : ':';
    if (!line.startsWith(prefix) || !/^(?:[0-9a-f]{2}){5,}$/i.test(line.slice(1))) fail('invalid hexadecimal record.');
    const bytes = bytePairs(line.slice(1));
    const [count, high, low, type] = bytes;
    if (bytes.length !== count + 5) fail('byte count does not match the record length.');
    const address = (high << 8) | low;
    if (paperTape) {
      const [sumHigh, sumLow] = bytes.slice(-2);
      if ((checksum(bytes.slice(0, -2)) & 65535) !== ((sumHigh << 8) | sumLow)) fail('paper tape checksum mismatch.');
      if (count === 0) {
        if (address !== recordCount) fail('paper tape record count mismatch.');
        done = true;
      } else {
        records.push({address, bytes: bytes.slice(3, -2), line: index + 1});
        recordCount++;
      }
      continue;
    }
    if (checksum(bytes) & 255) fail('Intel HEX checksum mismatch.');
    const data = bytes.slice(4, -1);
    switch (type) {
      case 0: records.push({address: base + address, bytes: data, line: index + 1}); break;
      case 1:
        if (count !== 0 || address !== 0) fail('invalid end record.');
        done = true;
        break;
      case 2: case 4:
        if (count !== 2 || address !== 0) fail('invalid address-extension record.');
        base = ((data[0] << 8) | data[1]) * (type === 2 ? 16 : 65536);
        break;
      case 3: case 5:
        if (count !== 4 || address !== 0) fail('invalid start-address record.');
        entry = type === 3
          ? ((data[0] << 8) | data[1]) * 16 + ((data[2] << 8) | data[3])
          : data.reduce((result, byte) => result * 256 + byte, 0);
        break;
      default: fail('unsupported Intel HEX record type.');
    }
  }
  if (!done) throw new Error('The program is missing its end record.');
  return {records, entry};
}
