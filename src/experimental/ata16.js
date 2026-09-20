const STATUS_ERR = 0x01;
const STATUS_DRQ = 0x08;
const STATUS_DRDY = 0x40;
const STATUS_DSC = 0x10;
const STATUS_BSY = 0x80;
const STATUS_IDLE = STATUS_DRDY | STATUS_DSC;

/**
 * Bounded ATA task-file device for the experimental 386 AT. Multi-sector PIO
 * exposes an autonomous, deterministic inter-sector BSY phase. The default
 * functional delay is long enough that an intervening IBM-compatible chained
 * IRQ0 handler cannot make COMMANDI mistake the next DRQ for command
 * completion. It is not a claim about measured disk or rotational timing.
 * The device models native 16-bit PIO, not mechanical timing.
 */
export class ExperimentalATA16 {
  constructor(image, {cylinders, heads, sectors}, {
    onIRQ = null,
    intersectorDelayCycles = 2048,
  } = {}) {
    if (!(image instanceof Uint8Array)) throw new Error('ATA image must be a Uint8Array');
    for (const [name, value] of Object.entries({cylinders, heads, sectors}))
      if (!Number.isInteger(value) || value < 1) throw new Error(`ATA ${name} must be positive`);
    if (cylinders > 0x10000 || heads > 0x10 || sectors > 0xff)
      throw new Error('ATA geometry exceeds the CHS task-file fields');
    if (image.length !== cylinders * heads * sectors * 512)
      throw new Error('ATA image size does not match geometry');
    this.image = image.slice();
    this.geometry = {cylinders, heads, sectors};
    this.onIRQ = onIRQ;
    if (!Number.isInteger(intersectorDelayCycles) || intersectorDelayCycles < 1)
      throw new Error('ATA inter-sector delay must be a positive integer');
    this.intersectorDelayCycles = intersectorDelayCycles;
    this.reset();
  }

  reset() {
    const wasOutput = this._irqOutput ?? false;
    // ATA diagnostic code 01h: device 0 passed and device 1 is absent. ATA-3
    // defines this register value after power-on, reset, and diagnostics.
    this.error = 1;
    this.features = 0;
    this.sectorCount = 1;
    this.sectorNumber = 1;
    this.cylinderLow = 0;
    this.cylinderHigh = 0;
    this.driveHead = 0xa0;
    this.status = STATUS_IDLE;
    this.command = 0;
    this.control = 0;
    this.buffer = null;
    this.wordIndex = 0;
    this.direction = null;
    this._intersector = null;
    this._intersectorRemaining = 0;
    this._irqPending = false;
    this._irqOutput = false;
    if (wasOutput) this.onIRQ?.(false);
  }

  _updateIRQ() {
    const next = this._irqPending && !(this.control & 2) && !(this.driveHead & 0x10);
    if (next === this._irqOutput) return;
    this._irqOutput = next;
    this.onIRQ?.(next);
  }

  _raiseIRQ() { this._irqPending = true; this._updateIRQ(); }
  _clearIRQ() { this._irqPending = false; this._updateIRQ(); }

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
    this.status = STATUS_IDLE | STATUS_ERR;
    this.buffer = null;
    this.direction = null;
    this._intersector = null;
    this._intersectorRemaining = 0;
    this._raiseIRQ();
  }

  _loadReadSector() {
    const lba = this._lba();
    if (lba < 0 || lba * 512 >= this.image.length) return this._fail(0x10);
    this.buffer = this.image.slice(lba * 512, lba * 512 + 512);
    this.wordIndex = 0;
    this.direction = 'read';
    this.status = STATUS_IDLE | STATUS_DRQ;
    this._raiseIRQ();
  }

  _beginIntersector(direction) {
    this.buffer = null;
    this.wordIndex = 0;
    this.direction = null;
    this._intersector = direction;
    this._intersectorRemaining = this.intersectorDelayCycles;
    this.status = STATUS_BSY;
  }

  _completeIntersector() {
    const direction = this._intersector;
    this._intersector = null;
    this._intersectorRemaining = 0;
    if (direction === 'read') this._loadReadSector();
    else if (direction === 'write') {
      this._prepareWriteSector();
      this._raiseIRQ();
    }
  }

  advance(cycles) {
    if (!this._intersector || cycles <= 0) return;
    this._intersectorRemaining -= cycles;
    if (this._intersectorRemaining <= 0) this._completeIntersector();
  }

  nextWake() {
    return this._intersector ? Math.max(0, this._intersectorRemaining) : Infinity;
  }

  _prepareWriteSector() {
    const lba = this._lba();
    if (lba < 0 || lba * 512 >= this.image.length) return this._fail(0x10);
    this.buffer = new Uint8Array(512);
    this.wordIndex = 0;
    this.direction = 'write';
    this.status = STATUS_IDLE | STATUS_DRQ;
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
    words[49] = 0x0200; // LBA is the only optional transfer capability advertised.
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
    this.status = STATUS_IDLE | STATUS_DRQ;
    this._raiseIRQ();
  }

  writeCommand(command) {
    if (this.control & 4) return;
    if (this.driveHead & 0x10) return;
    this.command = command & 0xff;
    this.error = 0;
    this._clearIRQ();
    // A newly accepted command replaces any unfinished PIO phase.  In
    // particular, non-data commands must not leave an old DRQ buffer live.
    this.buffer = null;
    this.wordIndex = 0;
    this.direction = null;
    this._intersector = null;
    this._intersectorRemaining = 0;
    this.status = STATUS_IDLE;
    if (this.command === 0x20 || this.command === 0x21) this._loadReadSector();
    else if (this.command === 0x30 || this.command === 0x31) this._prepareWriteSector();
    else if (this.command === 0xec) this._identify();
    else if (this.command === 0x10 || this.command === 0x11) {
      this.cylinderLow = 0;
      this.cylinderHigh = 0;
      this.sectorNumber = 1;
      this.status = STATUS_IDLE;
      this._raiseIRQ();
    } else if (this.command === 0x40 || this.command === 0x41) {
      let remaining = this.sectorCount === 0 ? 256 : this.sectorCount;
      while (remaining-- > 0) {
        const lba = this._lba();
        if (lba < 0 || lba * 512 >= this.image.length) return this._fail(0x10);
        if (remaining > 0) this._advanceAddress();
      }
      this.sectorCount = 0;
      this.status = STATUS_IDLE;
      this._raiseIRQ();
    } else if (this.command === 0x60 || this.command === 0x91) {
      if ((this.driveHead & 0x0f) + 1 !== this.geometry.heads ||
          this.sectorCount !== this.geometry.sectors) return this._fail();
      this.status = STATUS_IDLE;
      this._raiseIRQ();
    } else if (this.command === 0x70 || this.command === 0x71) {
      const lba = this._lba();
      if (lba < 0 || lba * 512 >= this.image.length) return this._fail(0x10);
      this.status = STATUS_IDLE;
      this._raiseIRQ();
    } else if (this.command === 0x90) {
      this.error = 1; // Device 0 passed; no Device 1 is attached.
      this.status = STATUS_IDLE;
      this._raiseIRQ();
    }
    else this._fail();
  }

  readData16() {
    if (this.control & 4) return 0xffff;
    if (this.driveHead & 0x10) return 0xffff;
    if (this.direction !== 'read' || !(this.status & STATUS_DRQ)) return 0xffff;
    const byte = this.wordIndex * 2;
    const value = this.buffer[byte] | this.buffer[byte + 1] << 8;
    if (++this.wordIndex === 256) {
      if ((this.command === 0x20 || this.command === 0x21) && this._advanceAddress())
        this._beginIntersector('read');
      else {
        this.buffer = null;
        this.direction = null;
        this.status = STATUS_IDLE;
      }
    }
    return value;
  }

  writeData16(value) {
    if (this.control & 4) return;
    if (this.driveHead & 0x10) return;
    if (this.direction !== 'write' || !(this.status & STATUS_DRQ)) return;
    const byte = this.wordIndex * 2;
    this.buffer[byte] = value & 0xff;
    this.buffer[byte + 1] = value >>> 8 & 0xff;
    if (++this.wordIndex !== 256) return;
    const lba = this._lba();
    this.image.set(this.buffer, lba * 512);
    if (this._advanceAddress()) {
      this._beginIntersector('write');
    }
    else {
      this.buffer = null;
      this.direction = null;
      this.status = STATUS_IDLE;
      this._raiseIRQ();
    }
  }

  readRegister(register, {alternate = false} = {}) {
    if (this.control & 4) return alternate || register === 7 ? this.status : 0;
    if (this.driveHead & 0x10) return 0;
    if (alternate) return this.status;
    if (register === 1) return this.error;
    if (register === 2) return this.sectorCount;
    if (register === 3) return this.sectorNumber;
    if (register === 4) return this.cylinderLow;
    if (register === 5) return this.cylinderHigh;
    if (register === 6) return this.driveHead;
    if (register === 7) {
      const value = this.status;
      this._clearIRQ();
      return value;
    }
    return 0xff;
  }

  writeRegister(register, value, {control = false} = {}) {
    const byte = value & 0xff;
    if (control) {
      const old = this.control;
      this.control = byte & 6;
      if (!(old & 4) && (this.control & 4)) {
        this.buffer = null;
        this.direction = null;
        this._intersector = null;
        this._intersectorRemaining = 0;
        this.status = 0x80;
        this._clearIRQ();
      } else if ((old & 4) && !(this.control & 4)) {
        const interruptMask = this.control & 2;
        this.reset();
        // ATA software-reset signature for device 0. The IBM 5170 fixed-disk
        // reset path requires register 1 to read 01h after SRST is released.
        this.control = interruptMask;
        this._updateIRQ();
      } else this._updateIRQ();
      return;
    }
    if (this.status & STATUS_BSY) return;
    if (this.control & 4) return;
    if (this.driveHead & 0x10 && register !== 6) return;
    if (register === 1) this.features = byte;
    else if (register === 2) this.sectorCount = byte;
    else if (register === 3) this.sectorNumber = byte;
    else if (register === 4) this.cylinderLow = byte;
    else if (register === 5) this.cylinderHigh = byte;
    else if (register === 6) {
      this.driveHead = byte;
      this._updateIRQ();
    }
    else if (register === 7) this.writeCommand(byte);
  }

  mediaBytes() { return this.image.slice(); }
}

export default ExperimentalATA16;
