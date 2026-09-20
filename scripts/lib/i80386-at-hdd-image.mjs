import {createHash} from 'node:crypto';

export const IBM_TYPE1_GEOMETRY = Object.freeze({cylinders: 306, heads: 4, sectors: 17});
export const HDD_ROUNDTRIP_TEXT = 'ASTRA-386-HDD\r\n';

const put16 = (bytes, offset, value) => {
  bytes[offset] = value & 0xff;
  bytes[offset + 1] = value >>> 8 & 0xff;
};
const put32 = (bytes, offset, value) => {
  put16(bytes, offset, value);
  put16(bytes, offset + 2, value >>> 16);
};

function bootSector() {
  const sector = new Uint8Array(512);
  sector.set([0xeb, 0x3c, 0x90]);
  sector.set(Buffer.from('ASTRA386'), 3);
  put16(sector, 11, 512);
  sector[13] = 1;
  put16(sector, 14, 1);
  sector[16] = 2;
  put16(sector, 17, 512);
  put16(sector, 19, 20807); // The final physical sector is outside the FAT volume.
  sector[21] = 0xf8;
  put16(sector, 22, 82);
  put16(sector, 24, 17);
  put16(sector, 26, 4);
  put32(sector, 28, 0);
  put32(sector, 32, 0);
  sector[36] = 0x80;
  sector[38] = 0x29;
  put32(sector, 39, 0x38651701);
  sector.set(Buffer.from('ASTRA HDD  '), 43);
  sector.set(Buffer.from('FAT16   '), 54);

  const code = [];
  const emit = (...values) => code.push(...values);
  emit(0x31, 0xc0, 0x8e, 0xd8, 0x8e, 0xc0, 0x8e, 0xd0, 0xbc, 0x00, 0x7c,
    0xfb, 0xfc); // STI; CLD.
  const zeroBuffer = () => emit(0x31, 0xc0, 0xbf, 0x00, 0x06, 0xb9, 0x00, 0x02,
    0xf3, 0xab); // Zero two sectors (1024 bytes) at 0000:0600.
  const poisonBuffer = () => emit(0xb8, 0xa5, 0xa5, 0xbf, 0x00, 0x06,
    0xb9, 0x00, 0x02, 0xf3, 0xab); // Detect an incomplete BIOS readback.
  zeroBuffer();
  const patternAddressPatch = code.length + 1;
  emit(0xbe, 0, 0, 0xbf, 0x00, 0x06, 0xb9, 0x08, 0x00, 0xf3, 0xa5);
  const transfer = operation => emit(0xb8, 0x02, operation, 0xbb, 0x00, 0x06,
    0xb9, 0x50, 0x31, 0xba, 0x80, 0x03, 0xcd, 0x13);
  transfer(0x03);
  const writeFailure = code.length + 1;
  emit(0x72, 0);
  poisonBuffer();
  transfer(0x02);
  const readFailure = code.length + 1;
  emit(0x72, 0, 0xbe, 0x00, 0x06);
  const comparePatternPatch = code.length + 1;
  emit(0xbf, 0, 0, 0xb9, 0x10, 0x00, 0xf3, 0xa6);
  const compareFailure = code.length + 1;
  emit(0x75, 0);
  emit(0xbe, 0x10, 0x06, 0xb9, 0xf0, 0x03); // Check the remaining 1008 bytes.
  const zeroTailLoop = code.length;
  emit(0xac, 0x08, 0xc0); // LODSB; OR AL,AL.
  const tailFailure = code.length + 1;
  emit(0x75, 0);
  const zeroTailLoopPatch = code.length + 1;
  emit(0xe2, 0);
  emit(0xb0, 0xa5, 0xe6, 0x80, 0xfa, 0xf4, 0xeb, 0xfd);
  const failure = code.length;
  emit(0xb0, 0xee, 0xe6, 0x80, 0xfa, 0xf4, 0xeb, 0xfd);
  const pattern = code.length;
  emit(...Buffer.from(HDD_ROUNDTRIP_TEXT));

  const origin = 0x7c00 + 62;
  put16(code, patternAddressPatch, origin + pattern);
  put16(code, comparePatternPatch, origin + pattern);
  code[zeroTailLoopPatch] = (zeroTailLoop - (zeroTailLoopPatch + 1)) & 0xff;
  for (const patch of [writeFailure, readFailure, compareFailure, tailFailure])
    code[patch] = (failure - (patch + 1)) & 0xff;
  if (62 + code.length > 510) throw new Error('owned HDD boot program exceeds one sector');
  sector.set(code, 62);
  sector[510] = 0x55;
  sector[511] = 0xaa;
  return sector;
}

export function createI80386AtFat16Image() {
  const {cylinders, heads, sectors} = IBM_TYPE1_GEOMETRY;
  const image = new Uint8Array(cylinders * heads * sectors * 512);
  image.set(bootSector());
  for (const fatStart of [1, 83]) {
    const offset = fatStart * 512;
    image.set([0xf8, 0xff, 0xff, 0xff], offset);
    // Cluster 2 holds the provenance file and ends here.
    image[offset + 4] = 0xff;
    image[offset + 5] = 0xff;
  }
  const root = (1 + 82 * 2) * 512;
  image.set(Buffer.from('ROUNDTRPTXT'), root);
  image[root + 11] = 0x20;
  put16(image, root + 26, 2);
  put32(image, root + 28, HDD_ROUNDTRIP_TEXT.length);
  const data = (1 + 82 * 2 + 32) * 512;
  image.set(Buffer.from(HDD_ROUNDTRIP_TEXT), data);
  return image;
}

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
