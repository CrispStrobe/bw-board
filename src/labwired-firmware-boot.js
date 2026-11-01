/**
 * Explicit ESP32-S3 reset-vector boot of a merged flash image.
 *
 * This is separate from the addressed ELF/UF2 route. The host admits the ROM
 * bytes against the identities below BEFORE calling the factory; this module
 * validates their shape and copies them, but does not authenticate a caller.
 * No ROM or firmware bytes are bundled here. The image layout is structural
 * validation, not a claim that arbitrary ESP-IDF/Arduino firmware is supported.
 */
import { LABWIRED_CATALOG } from './labwired-catalog.js';

export const ESP32S3_FLASH_BOOT_KIND = 'esp32s3-merged-flash';
export const ESP32S3_FLASH_BOOT_CONSOLES = Object.freeze(['uart0', 'usb_serial_jtag', 'both']);
export const ESP32S3_FLASH_CAPACITY = 16 * 1024 * 1024;
export const ESP32S3_FLASH_BOOT_ROM_SOURCE = Object.freeze({
  repository: 'CrispStrobe/labwired-core',
  commit: '3b655aef4085082152129c84849d4e2ad5004a7f',
});
const rom = (filename, bytes, sha256) => {
  const sourcePath = `crates/core/roms/esp32s3/${filename}`;
  return Object.freeze({ filename, bytes, sha256, sourcePath,
    url: `https://raw.githubusercontent.com/${ESP32S3_FLASH_BOOT_ROM_SOURCE.repository}/` +
      `${ESP32S3_FLASH_BOOT_ROM_SOURCE.commit}/${sourcePath}` });
};
export const ESP32S3_FLASH_BOOT_ROMS = Object.freeze({
  irom: rom('esp32s3_rom.bin', 393216, '9f2ba6ac2b66ced6e3b31a333d7a299aca1fa4b88bbe56f71d4856bd16e8bc51'),
  drom: rom('esp32s3_drom.bin', 131072, 'cc7abaafec6589b801d9f5df098197f264dda9d979e5885900015e332eae616d'),
});

const fail = message => { throw new Error(`ESP32-S3 merged flash: ${message}`); };
const u16 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset + at, 2).getUint16(0, true);
const u32 = (bytes, at) => new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0, true);

/** Check an Espressif image header and every segment against its containing region. */
function imageAt (bytes, offset, limit, label) {
  const end = Math.min(limit, bytes.length);
  if (offset + 24 > end) fail(`${label} image header is truncated`);
  if (bytes[offset] !== 0xe9) fail(`${label} has no Espressif image header`);
  if (u16(bytes, offset + 12) !== 9) fail(`${label} is not an ESP32-S3 image (chip id 9)`);
  const count = bytes[offset + 1];
  if (count < 1 || count > 16) fail(`${label} has an invalid segment count`);
  // The high nibble is the flash capacity: 0..4 encode 1, 2, 4, 8, 16 MiB.
  if ((bytes[offset + 3] >>> 4) > 4) fail(`${label} requires flash beyond the 16 MiB profile`);
  if (bytes[offset + 23] > 1) fail(`${label} has an invalid appended-hash flag`);
  let at = offset + 24;
  let checksum = 0xef;
  for (let i = 0; i < count; i++) {
    if (at + 8 > end) fail(`${label} segment ${i} header is truncated`);
    const size = u32(bytes, at + 4);
    at += 8;
    if (size > end - at) fail(`${label} segment ${i} exceeds the image or partition bounds`);
    for (let j = at; j < at + size; j++) checksum ^= bytes[j];
    at += size;
  }
  // Checksum is the last byte of the next 16-byte boundary, with at least
  // one byte of padding. The optional SHA-256 follows it; hashing firmware
  // is left to the uploader/bootloader rather than introducing a JS SHA shim.
  const checksumAt = offset + Math.ceil((at - offset + 1) / 16) * 16 - 1;
  if (checksumAt >= end) fail(`${label} checksum is truncated`);
  if (bytes[checksumAt] !== checksum) fail(`${label} segment checksum does not match`);
  const imageEnd = checksumAt + 1 + (bytes[offset + 23] === 1 ? 32 : 0);
  if (imageEnd > end) fail(`${label} appended hash is truncated`);
  return { offset, end: imageEnd, segments: count };
}

/**
 * Validate a merged image rooted at flash offset zero. The partition table
 * offset is explicit (default 0x8000); app offsets come from its entries.
 * Empty OTA slots may lie beyond a trimmed image, but at least one populated
 * app must have a complete S3 image. Encrypted images are not admitted here.
 */
export function validateEsp32S3MergedFlash (firmware, { partitionTableOffset = 0x8000 } = {}) {
  if (!(firmware instanceof Uint8Array) || firmware.length === 0) {
    fail('firmware must be non-empty Uint8Array bytes');
  }
  if (firmware.length > ESP32S3_FLASH_CAPACITY) fail('image exceeds the 16 MiB profile');
  if (!Number.isSafeInteger(partitionTableOffset) || partitionTableOffset < 0x1000 ||
      partitionTableOffset % 0x1000 !== 0 || partitionTableOffset + 0x1000 > ESP32S3_FLASH_CAPACITY) {
    fail('partitionTableOffset must name an aligned flash sector within the 16 MiB profile');
  }
  if (firmware.length < partitionTableOffset + 0x1000) {
    fail('merged image needs a complete partition-table sector; an app-only .bin is not a merged image');
  }
  const bootloader = imageAt(firmware, 0, partitionTableOffset, 'bootloader');
  const partitions = [];
  const apps = [];
  let terminated = false;
  // Espressif reserves 0xC00 bytes of a 4 KiB sector for partition entries.
  for (let at = partitionTableOffset; at < partitionTableOffset + 0xc00; at += 32) {
    const magic = u16(firmware, at);
    if (magic === 0xffff || magic === 0xebeb) { terminated = true; break; }
    if (magic !== 0x50aa) fail('partition table has an invalid entry signature');
    const type = firmware[at + 2];
    const subtype = firmware[at + 3];
    const offset = u32(firmware, at + 4);
    const size = u32(firmware, at + 8);
    const end = offset + size;
    if (!size || offset % 0x1000 !== 0 || size % 0x1000 !== 0 ||
        offset < bootloader.end || end > ESP32S3_FLASH_CAPACITY ||
        (offset < partitionTableOffset + 0x1000 && end > partitionTableOffset)) {
      fail('partition has invalid bounds, alignment, or overlaps boot data');
    }
    if (partitions.some(p => p.offset < end && offset < p.end)) fail('partitions overlap');
    partitions.push({ type, subtype, offset, size, end });
    if (type === 0) {
      if (offset % 0x10000 !== 0) fail('app partition is not aligned to 64 KiB');
      if (offset >= firmware.length || firmware[offset] === 0xff) continue;
      apps.push(imageAt(firmware, offset, end, 'application'));
    }
  }
  if (!terminated) fail('partition table has no terminator');
  if (!partitions.length) fail('partition table contains no partitions');
  if (!apps.length) fail('merged image contains no populated ESP32-S3 app partition');
  return Object.freeze({ flashBytes: firmware.length, flashCapacity: ESP32S3_FLASH_CAPACITY,
    partitionTableOffset, bootloaderEnd: bootloader.end,
    appOffsets: Object.freeze(apps.map(app => app.offset)) });
}

/**
 * Adapter-owned admission. An explicit profile cannot replace a circuit,
 * another chip, or a software assembly. Its isolated private byte copies are
 * used on every reset; caller mutation cannot change the next boot.
 */
export function prepareLabwiredFirmwareBoot (opts) {
  const p = opts.firmwareBoot;
  if (!p || typeof p !== 'object' || Array.isArray(p) || p.kind !== ESP32S3_FLASH_BOOT_KIND) {
    fail(`firmwareBoot.kind must be '${ESP32S3_FLASH_BOOT_KIND}'`);
  }
  const fields = ['kind', 'irom', 'drom', 'console', 'partitionTableOffset'];
  if (Object.keys(p).some(k => !fields.includes(k))) fail('firmwareBoot contains an unsupported field');
  const competing = ['board', 'chip', 'chipKind', 'mcuId', 'labwiredBoard', 'boardVariant',
    'softwareProfile', 'chipYaml', 'systemYaml', 'pins', 'clockHz', 'firmwareAddress',
    'extraSegments', 'blobs', 'chipPath', 'arduinoEsp32', 'softdeviceS110', 'labAir', 'boardMatrix'];
  if (competing.some(k => opts[k] != null)) fail('firmwareBoot cannot replace a circuit or competing configuration');
  if (!ESP32S3_FLASH_BOOT_CONSOLES.includes(p.console)) {
    fail(`console must be one of: ${ESP32S3_FLASH_BOOT_CONSOLES.join(', ')}`);
  }
  for (const [key, identity] of Object.entries(ESP32S3_FLASH_BOOT_ROMS)) {
    if (!(p[key] instanceof Uint8Array) || p[key].length !== identity.bytes) {
      fail(`${key} must contain the admitted ${identity.bytes}-byte ESP32-S3 ROM`);
    }
  }
  const checked = validateEsp32S3MergedFlash(opts.firmware, { partitionTableOffset: p.partitionTableOffset });
  const chip = LABWIRED_CATALOG.esp32s3;
  const name = opts.name ?? 'bw-esp32s3-flash';
  if (typeof name !== 'string' || !name) fail('name must be a non-empty string');
  const systemYaml = `name: ${JSON.stringify(name)}\nchip: "./esp32s3.yaml"\n` +
    (p.console === 'both' ? '' : `debug_uart: ${JSON.stringify(p.console)}\n`) +
    'external_devices: []\nboard_io: []\n';
  return {
    chipYaml: chip.chipYaml, systemYaml, clockHz: chip.clockHz,
    firmware: new Uint8Array(),
    blobs: Object.freeze({
      esp32s3_flash: Uint8Array.from(opts.firmware),
      esp32s3_irom: Uint8Array.from(p.irom),
      esp32s3_drom: Uint8Array.from(p.drom),
    }),
    metadata: Object.freeze({ kind: p.kind, console: p.console, ...checked }),
  };
}
