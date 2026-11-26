// SPDX-License-Identifier: MIT
// MOS KIM-4 slots and the Pico memory card share the CPU address bus.
const sizes = {'kim-2': 0x1000, 'kim-3': 0x2000, 'kim-3b': 0x2000, 'kim-5': 0x1800};
const RAM = 1;
const ROM = 2;

export function createKim1Backplane(slots) {
  if (!Array.isArray(slots) || slots.length > 6) throw new Error('KIM-4 supports up to six expansion modules.');
  const data = new Uint8Array(65536);
  const type = new Uint8Array(65536);
  for (const {kind, address, image} of slots) {
    if (!Object.hasOwn(sizes, kind)) throw new Error('Choose a KIM-2, KIM-3, KIM-3B or KIM-5 module.');
    const size = sizes[kind];
    const rom = kind === 'kim-5';
    if (rom ? address !== 0xe000 || !(image instanceof Uint8Array) || image.length !== size :
      !Number.isInteger(address) || address < 0x2000 || address % size !== 0 || address + size > 0xfffa) {
      throw new Error(rom ? 'KIM-5 requires a 6144-byte ROM at $E000.' :
        'Align the RAM address to the module size and keep clear of KIM-1 memory and vectors.');
    }
    if (type.subarray(address, address + size).some(Boolean)) throw new Error('KIM-4 expansion modules overlap.');
    type.fill(rom ? ROM : RAM, address, address + size);
    if (rom) data.set(image, address);
  }
  return {data, type};
}

/** memcfg raw is 65536 pairs of data and attributes. CE is active low; RW is bit 1. */
export function createKim1MemoryCard(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== 131072) {
    throw new Error('A full memcfg raw memory map must be 131072 bytes.');
  }
  const data = new Uint8Array(65536);
  const type = new Uint8Array(65536);
  for (let address = 0; address < 65536; address++) {
    const flags = bytes[address * 2 + 1];
    if (flags & 0xfc) throw new Error('Unexpected flags in the memcfg memory map.');
    data[address] = bytes[address * 2];
    type[address] = (flags & 1) ? 0 : (flags & 2) ? RAM : ROM;
  }
  return {data, type};
}

export function exportKim1MemoryCard({data, type}) {
  const bytes = new Uint8Array(131072);
  for (let address = 0; address < 65536; address++) {
    bytes[address * 2] = data[address];
    bytes[address * 2 + 1] = type[address] === RAM ? 2 : type[address] === ROM ? 0 : 1;
  }
  return bytes;
}

export function kim1ExpansionAt(state, address) {
  if (state.memoryCard?.type[address]) return state.memoryCard;
  if (state.k1008?.type[address]) return state.k1008;
  if (state.backplane?.type[address]) return state.backplane;
  return null;
}

export function kim1ExpansionWritable(device, address) {
  return device.type[address] === RAM;
}

/** MTU K-1008 uses an 8 KiB bus window, with 8000 bytes scanned LSB first. */
export function createKim1Video(address) {
  if (!Number.isInteger(address) || address < 0x2000 || address > 0xe000 || address % 0x2000) {
    throw new Error('K-1008 requires an 8 KiB-aligned address from $2000 to $E000.');
  }
  const type = new Uint8Array(65536);
  type.fill(RAM, address, Math.min(address + 8192, 0xfffa));
  return {address, type, data: new Uint8Array(65536)};
}
