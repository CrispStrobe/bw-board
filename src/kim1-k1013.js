// SPDX-License-Identifier: MIT
// MTU K-1013 interconnect for the existing 765: separate DMA address and IRQ status.
import {UPD765} from './upd765.js';

const geometry = {cylinders: 77, heads: 1, sectors: 26, bytesPerSector: 256, sectorBase: 0};
const diskBytes = geometry.cylinders * geometry.sectors * geometry.bytesPerSector;

function decodeImageDisk(image) {
  const result = new Uint8Array(diskBytes);
  const sectorBytes = geometry.bytesPerSector;
  const tracks = new Set();
  let cursor = image.indexOf(0x1a) + 1;
  const fail = () => { throw new Error('Expected a 77-track, single-sided ImageDisk file with 26 × 256-byte sectors.'); };
  if (cursor === 0) fail();
  while (cursor < image.length) {
    const [mode, track, head, count, size] = image.subarray(cursor, cursor + 5);
    cursor += 5;
    if (mode > 5 || track >= geometry.cylinders || head !== 0 || count !== geometry.sectors ||
        size !== 1 || tracks.has(track)) fail();
    tracks.add(track);
    const ids = image.subarray(cursor, cursor + count);
    if (ids.length !== count || new Set(ids).size !== count || ids.some(id => id >= count)) fail();
    cursor += count;
    for (const id of ids) {
      const type = image[cursor++];
      const offset = (track * count + id) * sectorBytes;
      if (type === 1 && cursor + sectorBytes <= image.length) {
        result.set(image.subarray(cursor, cursor + sectorBytes), offset);
        cursor += sectorBytes;
      } else if (type === 2 && cursor < image.length) {
        result.fill(image[cursor++], offset, offset + sectorBytes);
      } else fail();
    }
  }
  if (tracks.size !== geometry.cylinders) fail();
  return result;
}

export class Kim1K1013 {
  constructor({read, write}) {
    this.chip = new UPD765({onDmaRequest: (direction, byte) => {
      if (this.pointer >= this.limit || this.toMemory !== (direction === 'write')) return null;
      const address = this.pointer++;
      if (direction === 'read') return read(address);
      write(address, byte);
      return true;
    }});
    this.reset();
  }

  reset() {
    this.chip.reset();
    // Fixed reset/interrupt enables. The PC's motor and DMA gate register is absent.
    this.chip.dor = 0xfc;
    this.dma = 0;
    this.pointer = this.limit = 0;
    this.toMemory = false;
  }

  mount(drive, image) {
    if (!Number.isInteger(drive) || drive < 0 || drive > 3) throw new Error('K-1013 has drives 0 through 3.');
    if (image === null) { this.chip.eject(drive); return; }
    if (!(image instanceof Uint8Array)) throw new Error('Choose a K-1013 raw or ImageDisk disk image.');
    const imd = image[0] === 73 && image[1] === 77 && image[2] === 68 && image[3] === 32;
    const bytes = imd ? decodeImageDisk(image) : image.slice();
    if (bytes.length !== diskBytes) throw new Error('K-1013 raw disks must have 77 tracks × 26 sectors × 256 bytes.');
    this.chip.insert(drive, bytes, geometry);
  }

  has(address) { return [0xffe8, 0xffea, 0xffee, 0xffef].includes(address); }

  read(address, acknowledge) {
    if (address === 0xffe8) return (this.chip.irq ? 0 : 128) | Number(this.toMemory);
    if (address === 0xffea) return this.dma;
    if (address === 0xffee) return this.chip.read(4);
    if (acknowledge) return this.chip.read(5);
    return this.chip.phase === 'result' ? this.chip.resultBuf[this.chip.resultIdx] ?? 255 : 255;
  }

  write(address, value) {
    if (address === 0xffe8) this.toMemory = !!(value & 1);
    if (address === 0xffea) {
      this.dma = value;
      const base = (value & 128) ? 0xe000 : 0xc000;
      this.pointer = base + (value & 127) * 64;
      this.limit = base + 0x2000;
    }
    if (address === 0xffef) this.chip.write(5, value);
  }
}
