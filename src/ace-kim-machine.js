// SPDX-License-Identifier: MIT
// ACE KIM keypad card with 65C02, parallel LCD, and optional serial console.
// Address decode follows the ACE KIM backplane and keypad card schematics.
import {W65C02} from './w65c02.js';
import {W65C51} from './w65c51.js';
import {createHD44780, hd44780ReadBF, hd44780Write8} from './devices/hd44780.js';

export class AceKimMachine {
  constructor({bios, monitor}) {
    if (bios?.length !== 32768 || monitor?.length !== 8192) {
      throw new Error('ACE KIM needs a 32 KiB BIOS and an 8 KiB KC Monitor.');
    }
    this.bios = Uint8Array.from(bios);
    this.monitor = Uint8Array.from(monitor);
    this.ram = new Uint8Array(32768);
    this.cpu = new W65C02({read: address => this.read(address), write: (address, value) => this.write(address, value)});
    this.reset();
  }

  reset() {
    this.lcd = createHD44780();
    this.serial = new W65C51();
    this.outputs = new Uint8Array(2);
    this.directions = new Uint8Array(2);
    this.controls = new Uint8Array(2);
    this.keyCode = 0;
    this.keyPending = false;
    this.cpu.reset();
  }

  get timeNs() { return BigInt(this.cpu.cycles) * 1000n; }

  pins(port, input) {
    return (this.outputs[port] & this.directions[port]) | (input & ~this.directions[port]);
  }

  read(address) {
    if (address < 0x8000) return this.ram[address];
    if (address >= 0x9000 && address < 0x9400) return this.serial.read(address & 3);
    if (address < 0xa000) return 0x98;
    if (address < 0xc000) return this.bios[address - 0x8000];
    if (address >= 0xe000) return this.monitor[address - 0xe000];
    const register = address & 3;
    const port = register >> 1;
    if (register & 1) return this.controls[port] | (!port && this.keyPending ? 128 : 0);
    if (!(this.controls[port] & 4)) return this.directions[port];
    const a = this.pins(0, 0xe0 | this.keyCode);
    if (!port) {
      this.keyPending = false;
      return a;
    }
    const {busy, ac} = hd44780ReadBF(this.lcd, this.timeNs);
    const input = (a & 0xc0) === 0xc0 ? (a & 32 ? 0 : (busy ? 128 : 0) | ac) : 255;
    return this.pins(1, input);
  }

  write(address, value) {
    if (address < 0x8000) { this.ram[address] = value; return; }
    if (address >= 0x9000 && address < 0x9400) { this.serial.write(address & 3, value); return; }
    if (address < 0xc000 || address >= 0xe000) return;
    const before = this.pins(0, 0xe0 | this.keyCode);
    const register = address & 3;
    const port = register >> 1;
    if (register & 1) this.controls[port] = value & 63;
    else if (this.controls[port] & 4) this.outputs[port] = value;
    else this.directions[port] = value;
    const after = this.pins(0, 0xe0 | this.keyCode);
    if ((before & 128) && !(after & 0xc0)) {
      hd44780Write8(this.lcd, (after >> 5) & 1, this.outputs[1] & this.directions[1], this.timeNs);
    }
  }

  pressKey(code) {
    if (!Number.isInteger(code) || code < 0 || code > 31) throw new Error('Invalid ACE KIM keypad code.');
    this.keyCode = code;
    this.keyPending = true;
  }

  run(instructions) {
    for (let step = 0; step < instructions; step++) {
      if (this.keyPending && (this.controls[0] & 1)) this.cpu.irq();
      this.cpu.step();
    }
  }
}
