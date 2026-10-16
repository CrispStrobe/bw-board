// MIT. Original records are admitted before any asset map is constructed.
import {DOS_PACKAGE_LIMITS as LIMITS, validateDosPackageNames} from '../../src/dos-package-policy.js';

const CRC_TABLE = Uint32Array.from({length: 256}, (_, value) => {
  for (let i = 0; i < 8; i++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
export function dosPackageCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}

/** STORED only, ASCII names, no extra fields/comments/descriptors or padding.
 * All local records must occur contiguously in central-directory order.
 * Input and returned assets are copied; no filesystem extraction occurs.
 */
export function readDosPackageZip(input) {
  if (!(input instanceof Uint8Array) || input.length < 22 || input.length > LIMITS.archiveBytes)
    throw new Error('ZIP input extent exceeds package bounds');
  const bytes = Uint8Array.from(input), view = new DataView(bytes.buffer);
  const need = (condition, message) => { if (!condition) throw new Error(message); };
  const u16 = offset => view.getUint16(offset, true), u32 = offset => view.getUint32(offset, true);
  const end = bytes.length - 22;
  need(u32(end) === 0x06054b50 && u16(end + 20) === 0, 'ZIP needs an exact uncommented EOCD');
  const count = u16(end + 10), centralBytes = u32(end + 12), centralStart = u32(end + 16);
  need(u16(end + 4) === 0 && u16(end + 6) === 0 && u16(end + 8) === count &&
    count > 0 && count <= LIMITS.entries, 'ZIP multidisk/entry count is unsupported');
  need(centralStart + centralBytes === end && centralStart <= end && centralBytes >= count * 46,
    'ZIP central directory extent is invalid');
  const records = []; let position = centralStart, localPosition = 0, total = 0;
  for (let i = 0; i < count; i++) {
    need(position + 46 <= end && u32(position) === 0x02014b50, 'ZIP central record is truncated');
    const madeBy = u16(position + 4), version = u16(position + 6), flags = u16(position + 8),
      method = u16(position + 10), crc = u32(position + 16), compressed = u32(position + 20),
      size = u32(position + 24), nameLength = u16(position + 28), extra = u16(position + 30),
      comment = u16(position + 32), disk = u16(position + 34), internal = u16(position + 36),
      external = u32(position + 38), local = u32(position + 42);
    need(version <= 20 && (flags === 0 || flags === 0x800) && method === 0 &&
      extra === 0 && comment === 0 && disk === 0 && internal === 0,
      'ZIP flags/codec/extras/attributes are unsupported');
    need(nameLength > 0 && nameLength <= LIMITS.pathBytes && position + 46 + nameLength <= end,
      'ZIP original name extent is invalid');
    const nameBytes = bytes.subarray(position + 46, position + 46 + nameLength);
    need(nameBytes.every(byte => byte >= 0x20 && byte <= 0x7e), 'ZIP original names must be ASCII');
    const name = String.fromCharCode(...nameBytes), directory = name.endsWith('/');
    need(!directory, 'ZIP directory records are unsupported; regular files only');
    const system = madeBy >>> 8, mode = external >>> 16, kind = mode & 0xf000;
    need((system === 0 || system === 3) && (external & 0xffff) === (directory ? 0x10 : 0) &&
      (mode === 0 || system === 3 && (kind === 0 || kind === 0x8000)),
      'ZIP links/special or inconsistent file attributes are unsupported');
    need(compressed === size && size <= LIMITS.fileBytes && (!directory || size === 0) &&
      size / Math.max(1, compressed) <= LIMITS.expansionRatio,
      'ZIP file/expansion bounds exceeded');
    total += size; need(total <= LIMITS.totalBytes, 'ZIP total bytes exceed package bounds');
    need(local === localPosition && local + 30 <= centralStart && u32(local) === 0x04034b50,
      'ZIP local topology is invalid');
    need(u16(local + 4) === version && u16(local + 6) === flags && u16(local + 8) === method &&
      u16(local + 10) === u16(position + 12) && u16(local + 12) === u16(position + 14) &&
      u32(local + 14) === crc && u32(local + 18) === compressed && u32(local + 22) === size &&
      u16(local + 26) === nameLength && u16(local + 28) === 0,
      'ZIP local/central fields disagree');
    const start = local + 30 + nameLength, finish = start + size;
    need(finish <= centralStart && nameBytes.every((byte, index) => bytes[local + 30 + index] === byte),
      'ZIP local name/data extent mismatch');
    records.push({name, directory, start, finish, crc});
    localPosition = finish; position += 46 + nameLength;
  }
  need(position === end && localPosition === centralStart, 'ZIP records must cover original extents exactly');
  validateDosPackageNames(records);
  for (const record of records)
    need(dosPackageCrc32(bytes.subarray(record.start, record.finish)) === record.crc, 'ZIP CRC mismatch');
  const assets = new Map(records.filter(record => !record.directory).map(record =>
    [record.name, bytes.subarray(record.start, record.finish)]));
  return Object.freeze({names: Object.freeze([...assets.keys()]),
    read(name) { if (!assets.has(name)) throw new Error('package asset is absent'); return assets.get(name).slice(); }});
}
