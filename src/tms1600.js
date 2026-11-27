// SPDX-License-Identifier: MIT
// TI TMS 1000 Programmer's Reference (sections II, VI–VIII, XIV) and
// TI MicroSystems Designers Handbook (2-5). Standard instruction decode.

export const TMS1600_ROM_SIZE = 4096;
export const TMS1600_RAM_SIZE = 128;
export const TMS1600_RESET_ADDRESS = 0x3c0;

export function nextTms1600Word(word) {
  const feedback = word === 0x1f || (word !== 0x3f && ((word >> 5) & 1) === ((word >> 4) & 1));
  return ((word << 1) | Number(feedback)) & 63;
}

export function reverseTms1600Bits(value, width) {
  let reversed = 0;
  for (let i = 0; i < width; i++) {
    reversed = (reversed << 1) | (value & 1);
    value >>= 1;
  }
  return reversed;
}

/**
 * Instruction-level TMS1600 with a standard decode and caller-supplied output
 * PLA. ROM is ordered by physical address, including each page's LFSR words.
 * The host supplies the resolved K nibble and observes the O and R latches.
 */
export class Tms1600 {
  constructor(rom, {readK = () => 0, writePins = () => {}, outputPla} = {}) {
    if (!(rom instanceof Uint8Array) || rom.length !== TMS1600_ROM_SIZE) {
      throw new TypeError('TMS1600 needs a 4096-byte ROM');
    }
    if (outputPla !== undefined && (!(outputPla instanceof Uint8Array) || outputPla.length !== 32)) {
      throw new TypeError('TMS1600 needs 32 output PLA entries');
    }
    this.rom = Uint8Array.from(rom);
    this.outputPla = Uint8Array.from(outputPla ?? Array.from({length: 32}, (_, code) => code));
    this.readK = readK;
    this.writePins = writePins;
    this.ram = new Uint8Array(TMS1600_RAM_SIZE);
    this.stack = [];
    this.reset();
  }

  get address() {
    return (this.chapter << 10) | (this.page << 6) | this.word;
  }

  reset() {
    this.chapter = this.chapterBuffer = this.word = 0;
    this.page = this.pageBuffer = 15;
    this.a = this.x = this.y = 0;
    this.status = true;
    this.statusLatch = false;
    this.o = this.r = 0;
    this.instructions = 0;
    this.stack.length = 0;
    this.writePins(this.o, this.r);
  }

  _transfer(opcode, previousStatus) {
    if (!previousStatus) {
      if (opcode >= 0xc0) {
        this.pageBuffer = this.page;
        this.chapterBuffer = this.chapter;
      }
      return;
    }
    if (opcode >= 0xc0 && this.stack.length < 3) this.stack.push(this.address);
    this.page = this.pageBuffer;
    this.chapter = this.chapterBuffer;
    this.word = opcode & 63;
  }

  _return() {
    if (this.stack.length === 0) return;
    const address = this.stack.pop();
    this.chapter = this.chapterBuffer = address >> 10;
    this.page = this.pageBuffer = (address >> 6) & 15;
    this.word = address & 63;
  }

  _accumulate(result) {
    this.a = result & 15;
    this.status = result > 15;
  }

  _offsetY(delta) {
    const result = this.y + delta;
    this.y = result & 15;
    this.status = delta > 0 ? result > 15 : result >= 0;
  }

  _rOutput(set) {
    if (this.x >= 4) return;
    const bit = 1 << this.y;
    this.r = set ? this.r | bit : this.r & ~bit;
    this.writePins(this.o, this.r);
  }

  step() {
    const opcode = this.rom[this.address];
    const previousStatus = this.status;
    this.status = true;
    this.word = nextTms1600Word(this.word);
    this.instructions++;

    if (opcode >= 0x80) this._transfer(opcode, previousStatus);
    else this._execute(opcode);

    return opcode;
  }

  _execute(opcode) {
    const address = (this.x << 4) | this.y;
    const m = this.ram[address];
    const immediate = reverseTms1600Bits(opcode & 15, 4);
    switch (opcode >> 4) {
      case 0x0:
      case 0x2:
      case 0x3:
        this._registerInstruction(opcode, address, m);
        break;
      case 0x1: this.pageBuffer = immediate; break;
      case 0x4: this.y = immediate; break;
      case 0x5: this.status = this.y !== immediate; break;
      case 0x6:
        this.ram[address] = immediate;
        this.y = (this.y + 1) & 15;
        break;
      case 0x7:
        if (opcode === 0x7f) this.a = 0;
        else this._accumulate(this.a + immediate + 1);
        break;
    }
  }

  _registerInstruction(opcode, address, m) {
    if (opcode >= 0x28 && opcode <= 0x2f) {
      this.x = reverseTms1600Bits(opcode & 7, 3);
      return;
    }
    if (opcode >= 0x30 && opcode <= 0x3b) {
      const bit = 1 << reverseTms1600Bits(opcode & 3, 2);
      if (opcode < 0x34) this.ram[address] = m | bit;
      else if (opcode < 0x38) this.ram[address] = m & ~bit;
      else this.status = (m & bit) !== 0;
      return;
    }
    switch (opcode) {
      case 0x00: this.status = m !== this.a; break;             // MNEA
      case 0x01: this.status = this.a <= m; break;              // ALEM
      case 0x02: this.statusLatch = this.status = this.y !== this.a; break;
      case 0x03: this.ram[address] = this.a; this.a = m; break;  // XMA
      case 0x04: this._offsetY(-1); break;
      case 0x05: this._offsetY(1); break;
      case 0x06: this._accumulate(this.a + m); break;
      case 0x07: this.a = (m - 1) & 15; break;
      case 0x08: this.a = this.readK(this.o, this.r) & 15; break;
      case 0x09: this.x ^= 4; break;
      case 0x0a:
        this.o = this.outputPla[(Number(this.statusLatch) << 4) | this.a];
        this.writePins(this.o, this.r);
        break;
      case 0x0b: this.chapterBuffer = this.pageBuffer & 3; break; // TPC
      case 0x0c: this._rOutput(false); break;
      case 0x0d: this._rOutput(true); break;
      case 0x0e: this.status = (this.readK(this.o, this.r) & 15) !== 0; break;
      case 0x0f: this._return(); break;
      case 0x20: this.y = this.a; break;
      case 0x21: this.a = m; break;
      case 0x22: this.y = m; break;
      case 0x23: this.a = this.y; break;
      case 0x24: this.ram[address] = this.a; this._offsetY(-1); break;
      case 0x25: this.ram[address] = this.a; this._offsetY(1); break;
      case 0x26: this.ram[address] = this.a; this.a = 0; break;
      case 0x27: this.ram[address] = this.a; break;
      case 0x3c: this._accumulate(m + (15 ^ this.a) + 1); break;
      case 0x3d: this._accumulate((15 ^ this.a) + 1); break;
      case 0x3e: this._accumulate(m + 1); break;
      case 0x3f: this.status = m !== 0; break;
    }
  }
}
