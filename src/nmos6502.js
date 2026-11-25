// SPDX-License-Identifier: MIT
/**
 * Documented-opcode NMOS 6502, reusing this project's MIT W65C02 instruction
 * plumbing. This is an architectural, instruction-stepped core, not a bus
 * waveform model. No third-party emulator source or firmware was used.
 */
import {W65C02} from './w65c02.js';

const C = 1, Z = 2, I = 4, D = 8, B = 16, U = 32, V = 64, N = 128;
export const NMOS6502_OPCODES = Object.freeze((`
00 01 05 06 08 09 0A 0D 0E
10 11 15 16 18 19 1D 1E
20 21 24 25 26 28 29 2A 2C 2D 2E
30 31 35 36 38 39 3D 3E
40 41 45 46 48 49 4A 4C 4D 4E
50 51 55 56 58 59 5D 5E
60 61 65 66 68 69 6A 6C 6D 6E
70 71 75 76 78 79 7D 7E
81 84 85 86 88 8A 8C 8D 8E
90 91 94 95 96 98 99 9A 9D
A0 A1 A2 A4 A5 A6 A8 A9 AA AC AD AE
B0 B1 B4 B5 B6 B8 B9 BA BC BD BE
C0 C1 C4 C5 C6 C8 C9 CA CC CD CE
D0 D1 D5 D6 D8 D9 DD DE
E0 E1 E4 E5 E6 E8 E9 EA EC ED EE
F0 F1 F5 F6 F8 F9 FD FE`).trim().split(/\s+/).map(x => parseInt(x, 16)));
const documented = new Set(NMOS6502_OPCODES);

export class NMOS6502 extends W65C02 {
  reset() {
    this.pc = this.read(0xfffc) | (this.read(0xfffd) << 8);
    this.p = (this.p | I | U) & ~B; // NMOS reset does not clear decimal mode.
    this.s = (this.s - 3) & 255;
    this.stopped = this.waiting = false;
    this.cycles += 7;
  }

  _interrupt(vector, isBrk) {
    this._push(this.pc >>> 8); this._push(this.pc & 255);
    this._push((this.p & ~B) | U | (isBrk ? B : 0));
    this.p = (this.p | I | U) & ~B; // Unlike CMOS, interrupts preserve D.
    this.pc = this.read(vector) | (this.read(vector + 1) << 8);
    return 7;
  }

  _adc(m) {
    if (!(this.p & D)) return super._adc(m);
    const a = this.a, carry = this.p & C ? 1 : 0;
    const binary = a + m + carry;
    let low = (a & 15) + (m & 15) + carry;
    if (low >= 10) low = ((low + 6) & 15) + 16;
    let decimal = (a & 240) + (m & 240) + low;
    // NMOS Z is the binary result; N/V precede the high decimal correction.
    this._flag(Z, (binary & 255) === 0);
    this._flag(N, (decimal & N) !== 0);
    this._flag(V, (~(a ^ m) & (a ^ decimal) & N) !== 0);
    if (decimal >= 160) decimal += 96;
    this._flag(C, decimal > 255);
    this.a = decimal & 255;
  }

  _sbc(m) {
    if (!(this.p & D)) return super._sbc(m);
    const a = this.a, borrow = this.p & C ? 0 : 1;
    const binary = a - m - borrow;
    this._flag(C, binary >= 0);
    this._flag(V, ((a ^ m) & (a ^ binary) & N) !== 0);
    this._nz(binary & 255);
    let low = (a & 15) - (m & 15) - borrow;
    if (low < 0) low = ((low - 6) & 15) - 16;
    let decimal = (a & 240) - (m & 240) + low;
    if (decimal < 0) decimal -= 96;
    this.a = decimal & 255;
  }

  _rmw(address, fn, cycles) {
    const old = this.read(address);
    this.write(address, old); // NMOS read-modify-write performs both writes.
    this.write(address, fn.call(this, old));
    return cycles;
  }

  _exec(op) {
    if (!documented.has(op)) {
      this.pc = (this.pc - 1) & 65535;
      throw new Error(`Unsupported NMOS 6502 opcode $${op.toString(16).toUpperCase().padStart(2, '0')} at $${this.pc.toString(16).toUpperCase().padStart(4, '0')}; undocumented/CMOS instructions are not modeled.`);
    }
    if (op === 0x6c) {
      const address = this._fetch16();
      const highAddress = (address & 0xff00) | ((address + 1) & 255);
      this.pc = this.read(address) | (this.read(highAddress) << 8);
      return 5;
    }
    if (op === 0x20) {
      // JSR reads the high operand after the stack writes. Code in page one
      // can overlap those writes, so fetching both bytes first is incorrect.
      const low = this._fetch(), ret = this.pc;
      this._push(ret >>> 8); this._push(ret & 255);
      this.pc = low | (this._fetch() << 8);
      return 6;
    }
    if ([0x1e, 0x3e, 0x5e, 0x7e].includes(op)) {
      const operation = {0x1e: this._asl, 0x3e: this._rol, 0x5e: this._lsr, 0x7e: this._ror}[op];
      return this._rmw(this._absx(), operation, 7);
    }
    return super._exec(op);
  }
}

export default NMOS6502;
