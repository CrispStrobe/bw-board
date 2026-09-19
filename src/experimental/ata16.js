const STATUS_ERR = 0x01;
const STATUS_DRQ = 0x08;
const STATUS_DRDY = 0x40;

/**
 * Bounded synchronous ATA task-file device for the experimental 386 AT.
 * It models sector PIO and the native 16-bit data register, not command timing.
 */
export class ExperimentalATA16 {
  constructor(image, {cylinders, heads, sectors}, {onIRQ = null} = {}) {
    if (!(image instanceof Uint8Array)) throw new Error('ATA image must be a Uint8Array');
    for (const [name, value] of Object.entries({cylinders, heads, sectors}))
      if (!Number.isInteger(value) || value < 1) throw new Error(`ATA ${name} must be positive`);
    if (image.length !== cylinders * heads * sectors * 512)
      throw new Error('ATA image size does not match geometry');
    this.image = image.slice();
    this.geometry = {cylinders, heads, sectors};
    this.onIRQ = onIRQ;
    this.reset();
  }

  reset() {
    this.error = 0;
    this.features = 0;
    this.sectorCount = 1;
    this.sectorNumber = 1;
    this.cylinderLow = 0;
    this.cylinderHigh = 0;
    this.driveHead = 0xa0;
    this.status = STATUS_DRDY;
    this.command = 0;
    this.control = 0;
    this.buffer = null;
    this.wordIndex = 0;
    this.direction = null;
    this._irq = false;
  }

  _setIRQ(level) {
    const next = !!level;
    if (next === this._irq) return;
    this._irq = next;
    this.onIRQ?.(next);
  }

  _lba() {
    if (this.driveHead & 0x40)
      return (((this.driveHead & 0x0f) << 24) | (this.cylinderHigh << 16) |
        (this.cylinderLow << 8) | this.sectorNumber) >>> 0;
    const cylinder = this.cylinderLow | this.cylinderHigh << 8;
    const head = this.driveHead & 0x0f;
    if (head >= this.geometry.heads || this.sectorNumber < 1 ||
        this.sectorNumber > this.geometry.sectors) return -1;
    return (cylinder * this.geometry.heads + head) * this.geometry.sectors +
      this.sectorNumber - 1;
  }

  _fail(error = 0x04) {
    this.error = error;
    this.status = STATUS_DRDY | STATUS_ERR;
    this.buffer = null;
    this.direction = null;
    this._setIRQ(true);
  }

  _loadReadSector() {
    const lba = this._lba();
    if (lba < 0 || lba * 512 >= this.image.length) return this._fail(0x10);
    this.buffer = this.image.slice(lba * 512, lba * 512 + 512);
    this.wordIndex = 0;
    this.direction = 'read';
    this.status = STATUS_DRDY | STATUS_DRQ;
    this._setIRQ(true);
  }

  _prepareWriteSector() {
    const lba = this._lba();
    if (lba < 0 || lba * 512 >= this.image.length) return this._fail(0x10);
    this.buffer = new Uint8Array(512);
    this.wordIndex = 0;
    this.direction = 'write';
    this.status = STATUS_DRDY | STATUS_DRQ;
  }

  _advanceAddress() {
    const remaining = this.sectorCount === 0 ? 256 : this.sectorCount;
    this.sectorCount = (remaining - 1) & 0xff;
    if (remaining === 1) return false;
    if (this.driveHead & 0x40) {
      const next = (this._lba() + 1) >>> 0;
      this.sectorNumber = next & 0xff;
      this.cylinderLow = next >>> 8 & 0xff;
      this.cylinderHigh = next >>> 16 & 0xff;
      this.driveHead = this.driveHead & 0xf0 | next >>> 24 & 0x0f;
    } else if (++this.sectorNumber > this.geometry.sectors) {
      this.sectorNumber = 1;
      if ((this.driveHead & 0x0f) + 1 < this.geometry.heads)
        this.driveHead++;
      else {
        this.driveHead &= 0xf0;
        const cylinder = (this.cylinderLow | this.cylinderHigh << 8) + 1;
        this.cylinderLow = cylinder & 0xff;
        this.cylinderHigh = cylinder >>> 8 & 0xff;
      }
    }
    return true;
  }

  _identify() {
    const words = new Uint16Array(256);
    words[0] = 0x0040;
    words[1] = this.geometry.cylinders;
    words[3] = this.geometry.heads;
    words[6] = this.geometry.sectors;
    const sectors = this.image.length / 512;
    words[60] = sectors & 0xffff;
    words[61] = sectors >>> 16;
    this.buffer = new Uint8Array(512);
    for (let index = 0; index < words.length; index++) {
      this.buffer[index * 2] = words[index] & 0xff;
      this.buffer[index * 2 + 1] = words[index] >>> 8;
    }
    this.wordIndex = 0;
    this.direction = 'read';
    this.status = STATUS_DRDY | STATUS_DRQ;
    this._setIRQ(true);
  }

  writeCommand(command) {
    this.command = command & 0xff;
    this.error = 0;
    this._setIRQ(false);
    if (this.command === 0x20) this._loadReadSector();
    else if (this.command === 0x30) this._prepareWriteSector();
    else if (this.command === 0xec) this._identify();
    else this._fail();
  }

  readData16() {
    if (this.direction !== 'read' || !(this.status & STATUS_DRQ)) return 0xffff;
    const byte = this.wordIndex * 2;
    const value = this.buffer[byte] | this.buffer[byte + 1] << 8;
    if (++this.wordIndex === 256) {
      if (this.command === 0x20 && this._advanceAddress()) this._loadReadSector();
      else {
        this.buffer = null;
        this.direction = null;
        this.status = STATUS_DRDY;
      }
    }
    return value;
  }

  writeData16(value) {
    if (this.direction !== 'write' || !(this.status & STATUS_DRQ)) return;
    const byte = this.wordIndex * 2;
    this.buffer[byte] = value & 0xff;
    this.buffer[byte + 1] = value >>> 8 & 0xff;
    if (++this.wordIndex !== 256) return;
    const lba = this._lba();
    this.image.set(this.buffer, lba * 512);
    if (this._advanceAddress()) this._prepareWriteSector();
    else {
      this.buffer = null;
      this.direction = null;
      this.status = STATUS_DRDY;
      this._setIRQ(true);
    }
  }

  readRegister(register, {alternate = false} = {}) {
    if (alternate) return this.status;
    if (register === 1) return this.error;
    if (register === 2) return this.sectorCount;
    if (register === 3) return this.sectorNumber;
    if (register === 4) return this.cylinderLow;
    if (register === 5) return this.cylinderHigh;
    if (register === 6) return this.driveHead;
    if (register === 7) {
      const value = this.status;
      this._setIRQ(false);
      return value;
    }
    return 0xff;
  }

  writeRegister(register, value, {control = false} = {}) {
    const byte = value & 0xff;
    if (control) {
      const old = this.control;
      this.control = byte;
      if ((old & 4) && !(byte & 4)) this.reset();
      return;
    }
    if (register === 1) this.features = byte;
    else if (register === 2) this.sectorCount = byte;
    else if (register === 3) this.sectorNumber = byte;
    else if (register === 4) this.cylinderLow = byte;
    else if (register === 5) this.cylinderHigh = byte;
    else if (register === 6) this.driveHead = byte;
    else if (register === 7) this.writeCommand(byte);
  }

  mediaBytes() { return this.image.slice(); }
}

export default ExperimentalATA16;
