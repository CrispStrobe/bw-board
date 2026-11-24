// SPDX-License-Identifier: MIT
// Independently authored NMOS Intel 8049 core. No emulator implementation was used.
// Primary-source provenance and timing limits: docs/MCS48-IMPLEMENTATION.md.

import { MCS48_OPCODES, nextMCS48Address } from './mcs48-disasm.js';

const CARRY = 0x80;
const AUX_CARRY = 0x40;
const FLAG0 = 0x20;
const REGISTER_BANK = 0x10;
const PSW_FIXED = 0x08;
const PROGRAM_SIZE = 4096;
const RAM_SIZE = 128;
const noOperation = () => {};

function integer(value, minimum, maximum, name) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer in ${minimum}..${maximum}`);
  }
  return value;
}

function boolean(value, name) {
  if (typeof value !== 'boolean') throw new TypeError(`${name} must be a boolean`);
  return value;
}

function bytes(value, length, name) {
  if (!(Array.isArray(value) || value instanceof Uint8Array) || value.length !== length) {
    throw new TypeError(`${name} must contain exactly ${length} bytes`);
  }
  const copy = new Uint8Array(length);
  for (let i = 0; i < length; i++) copy[i] = integer(value[i], 0, 255, `${name}[${i}]`);
  return copy;
}

const stateIntegers = {
  pc: 0xfff, a: 255, psw: 255, p1: 255, p2: 255, bus: 255, timer: 255,
  timerPrescaler: 31, memoryBank: 1, lastT1: 1, cycles: Number.MAX_SAFE_INTEGER,
};
const stateBooleans = [
  'f1', 'timerFlag', 'timerInterruptPending', 'externalInterruptEnabled',
  'timerInterruptEnabled', 'interruptInProgress', 'clockOutputEnabled',
  'busOutputEnabled', 'interruptPin',
];

/** Validate and copy all snapshot data before a live CPU is changed. */
export function validateMCS48State(state) {
  if (!state || typeof state !== 'object' || state.type !== 'MCS48' || state.version !== 1) {
    throw new TypeError('Unsupported MCS-48 snapshot');
  }
  const result = { type: 'MCS48', version: 1 };
  for (const [name, maximum] of Object.entries(stateIntegers)) {
    result[name] = integer(state[name], 0, maximum, `state.${name}`);
  }
  if (!(result.psw & PSW_FIXED)) throw new RangeError('state.psw bit 3 must be one');
  for (const name of stateBooleans) result[name] = boolean(state[name], `state.${name}`);
  if (!['stopped', 'timer', 'counter'].includes(state.timerMode)) {
    throw new RangeError('state.timerMode must be stopped, timer, or counter');
  }
  if (!['trap', 'nop'].includes(state.illegalOpcodeMode)) {
    throw new RangeError('state.illegalOpcodeMode must be trap or nop');
  }
  if (result.timerInterruptPending && !result.timerInterruptEnabled) {
    throw new RangeError('A disabled timer interrupt cannot have a pending request');
  }
  if (result.interruptInProgress && (result.pc & 0x800)) {
    throw new RangeError('An interrupt service routine must remain in program bank zero');
  }
  result.timerMode = state.timerMode;
  result.illegalOpcodeMode = state.illegalOpcodeMode;
  result.rom = bytes(state.rom, PROGRAM_SIZE, 'state.rom');
  result.ram = bytes(state.ram, RAM_SIZE, 'state.ram');
  result.expanderLatches = bytes(state.expanderLatches, 4, 'state.expanderLatches');
  result.testPins = bytes(state.testPins, 2, 'state.testPins');
  for (const value of result.expanderLatches) {
    if (value > 15) throw new RangeError('Expander latches must be four-bit values');
  }
  for (const value of result.testPins) {
    if (value > 1) throw new RangeError('Test pin levels must be zero or one');
  }
  return result;
}

export class MCS48IllegalOpcodeError extends Error {
  constructor(opcode, address) {
    super(`Undefined NMOS MCS-48 opcode 0x${opcode.toString(16).padStart(2, '0')} at 0x${address.toString(16).padStart(3, '0')}`);
    this.name = 'MCS48IllegalOpcodeError';
    this.opcode = opcode;
    this.address = address;
  }
}

/**
 * Instruction-level NMOS 8049: 128-byte internal RAM, two register banks,
 * 2 KiB resident program region and a 4 KiB expanded program address space.
 * One machine cycle is 15 oscillator periods. This is not an electrical model.
 */
export class MCS48 {
  constructor(options = {}) {
    this.rom = new Uint8Array(PROGRAM_SIZE).fill(0xff);
    this.ram = new Uint8Array(RAM_SIZE);
    this.expanderLatches = new Uint8Array(4).fill(15);
    this.testPins = new Uint8Array([1, 1]);
    this.a = 0;
    this.psw = PSW_FIXED;
    this.timer = 0;
    this.interruptPin = false;
    this.cycles = 0;
    this._stepping = false;
    this.illegalOpcodeMode = options.illegalOpcodeMode ?? 'trap';
    if (!['trap', 'nop'].includes(this.illegalOpcodeMode)) {
      throw new RangeError('illegalOpcodeMode must be trap or nop');
    }
    const hookNames = [
      'readPort', 'writePort', 'readExternal', 'writeExternal', 'readBus', 'writeBus',
      'readTest', 'readInterrupt', 'readExpander', 'writeExpander', 'readProgram',
      'writeProg', 'clockOutput', 'onCycles',
    ];
    this.hooks = {};
    for (const name of hookNames) {
      if (options[name] !== undefined && typeof options[name] !== 'function') {
        throw new TypeError(`${name} must be a function`);
      }
      this.hooks[name] = options[name];
    }
    this.reset({ cold: true, notify: false });
    if (options.rom !== undefined) this.loadRom(options.rom);
  }

  get psw() { return this._psw; }
  set psw(value) { this._psw = (value & 0xf7) | PSW_FIXED; }
  get carry() { return (this.psw >>> 7) & 1; }
  get auxiliaryCarry() { return (this.psw >>> 6) & 1; }
  get registerBank() { return (this.psw >>> 4) & 1; }
  get stackPointer() { return this.psw & 7; }
  get oscillatorPeriods() { return this.cycles * 15; }

  /** RESET preserves A, C, AC, RAM and T. cold initializes these unspecified power-on values to zero. */
  reset({ cold = false, resetCycles = true, notify = true } = {}) {
    if (this._stepping) throw new Error('Cannot reset MCS-48 during step()');
    if (cold) {
      this.ram.fill(0);
      this.a = 0;
      this.timer = 0;
      this.psw = PSW_FIXED;
      this.expanderLatches.fill(15);
    } else this.psw = (this.psw & (CARRY | AUX_CARRY)) | PSW_FIXED;
    this.pc = 0;
    this.memoryBank = 0;
    this.f1 = false;
    this.p1 = 0xff;
    this.p2 = 0xff;
    this.bus = 0xff;
    this.busOutputEnabled = false;
    this.externalInterruptEnabled = false;
    this.timerInterruptEnabled = false;
    this.interruptInProgress = false;
    this.timerInterruptPending = false;
    this.timerFlag = false;
    this.timerMode = 'stopped';
    this.timerPrescaler = 0;
    this.lastT1 = this.testPins[1];
    this.clockOutputEnabled = false;
    if (resetCycles) this.cycles = 0;
    this.lastStep = null;
    if (notify) {
      (this.hooks.writePort ?? noOperation)(1, 0xff, this);
      (this.hooks.writePort ?? noOperation)(2, 0xff, this);
      (this.hooks.clockOutput ?? noOperation)(false, this);
    }
    return this;
  }

  /** Load up to 4 KiB. The first 2 KiB represent the resident 8049 ROM. */
  loadRom(source, { offset = 0, clear = true } = {}) {
    if (this._stepping) throw new Error('Cannot replace ROM during step()');
    if (source instanceof ArrayBuffer) source = new Uint8Array(source);
    if (!(Array.isArray(source) || source instanceof Uint8Array)) {
      throw new TypeError('ROM must be a byte array or ArrayBuffer');
    }
    integer(offset, 0, PROGRAM_SIZE, 'ROM offset');
    if (source.length > PROGRAM_SIZE - offset) throw new RangeError('ROM exceeds the 4 KiB program address space');
    const copy = bytes(source, source.length, 'ROM');
    if (clear) this.rom.fill(0xff);
    this.rom.set(copy, offset);
    return this;
  }

  readProgram(address) {
    const at = address & 0xfff;
    const external = this.hooks.readProgram?.(at, this);
    return external === undefined ? this.rom[at] : external & 0xff;
  }

  getRegister(index) {
    integer(index, 0, 7, 'Register index');
    return this.ram[(this.registerBank ? 24 : 0) + index];
  }

  setRegister(index, value) {
    integer(index, 0, 7, 'Register index');
    this.ram[(this.registerBank ? 24 : 0) + index] = integer(value, 0, 255, 'Register value');
  }

  setTest(index, level) {
    integer(index, 0, 1, 'Test pin index');
    this.testPins[index] = integer(Number(level), 0, 1, 'Test pin level');
  }

  /** Asserted=true represents physical /INT low. */
  setInterrupt(asserted) { this.interruptPin = boolean(asserted, 'Interrupt assertion'); }

  _test(index) { return (this.hooks.readTest?.(index, this) ?? this.testPins[index]) ? 1 : 0; }
  _interruptAsserted() { return !!(this.hooks.readInterrupt?.(this) ?? this.interruptPin); }
  _indirect(index) { return this.getRegister(index) & 0x7f; }

  _fetch() {
    const value = this.readProgram(this.pc);
    this.pc = nextMCS48Address(this.pc);
    return value;
  }

  _push() {
    const slot = 8 + 2 * this.stackPointer;
    this.ram[slot] = this.pc & 0xff;
    this.ram[slot + 1] = ((this.pc >>> 8) & 0x0f) | (this.psw & 0xf0);
    this.psw = (this.psw & 0xf0) | ((this.stackPointer + 1) & 7);
  }

  _return(restoreStatus) {
    const sp = (this.stackPointer - 1) & 7;
    const slot = 8 + 2 * sp;
    const savedHigh = this.ram[slot + 1];
    this.pc = ((savedHigh & 15) << 8) | this.ram[slot];
    if (restoreStatus) {
      this.psw = (savedHigh & 0xf0) | sp;
      this.interruptInProgress = false;
    } else {
      this.psw = (this.psw & 0xf0) | sp;
      if (this.interruptInProgress) this.pc &= 0x7ff;
    }
  }

  _branch(taken) {
    // PC is already past the opcode, but not past the destination byte.
    const page = this.pc & 0xf00;
    const low = this._fetch();
    if (taken) this.pc = page | low;
  }

  _add(value, carry = 0) {
    const sum = this.a + value + carry;
    const half = (this.a & 15) + (value & 15) + carry;
    this.psw = (this.psw & 0x3f) | (sum > 255 ? CARRY : 0) | (half > 15 ? AUX_CARRY : 0);
    this.a = sum & 255;
  }

  _decimalAdjust() {
    let carry = this.carry;
    if ((this.a & 15) > 9 || this.auxiliaryCarry) {
      const adjusted = this.a + 6;
      if (adjusted > 255) carry = 1;
      this.a = adjusted & 255;
    }
    if ((this.a & 0xf0) > 0x90 || carry) {
      this.a = (this.a + 0x60) & 255;
      carry = 1;
    }
    this.psw = (this.psw & ~CARRY) | (carry ? CARRY : 0);
  }

  _readPort(port) {
    const latch = port === 1 ? this.p1 : this.p2;
    return latch & (this.hooks.readPort?.(port, this) ?? 0xff);
  }

  _writePort(port, value) {
    const byte = value & 255;
    if (port === 1) this.p1 = byte;
    else this.p2 = byte;
    this.hooks.writePort?.(port, byte, this);
  }

  _writeBus(value) {
    this.bus = value & 255;
    this.busOutputEnabled = true;
    this.hooks.writeBus?.(this.bus, this);
  }

  _releaseBus() {
    // MOVX destroys the static BUS latch; its discarded value is unspecified on silicon.
    this.bus = 0xff;
    this.busOutputEnabled = false;
  }

  _expander(port, operation) {
    const index = port - 4;
    const operationCode = { read: 0, write: 4, or: 8, and: 12 }[operation];
    this._writePort(2, (this.p2 & 0xf0) | operationCode | index);
    this.hooks.writeProg?.(0, this);
    if (operation === 'read') {
      this._writePort(2, this.p2 | 15);
      this.a = (this.hooks.readExpander?.(port, this) ?? 15) & 15;
    } else {
      const nibble = this.a & 15;
      this._writePort(2, (this.p2 & 0xf0) | nibble);
      const old = this.expanderLatches[index];
      const value = operation === 'or' ? old | nibble : operation === 'and' ? old & nibble : nibble;
      this.expanderLatches[index] = value;
      this.hooks.writeExpander?.(port, value, operation, nibble, this);
    }
    this.hooks.writeProg?.(1, this);
  }

  _timerIncrement() {
    this.timer = (this.timer + 1) & 255;
    if (this.timer === 0) {
      this.timerFlag = true;
      if (this.timerInterruptEnabled) this.timerInterruptPending = true;
    }
  }

  _consumeCycles(count) {
    for (let cycle = 0; cycle < count; cycle++) {
      this.cycles++;
      this.hooks.onCycles?.(1, this);
      if (this.timerMode === 'timer') {
        this.timerPrescaler = (this.timerPrescaler + 1) & 31;
        if (this.timerPrescaler === 0) this._timerIncrement();
      } else if (this.timerMode === 'counter') {
        const level = this._test(1);
        if (this.lastT1 === 1 && level === 0) this._timerIncrement();
        this.lastT1 = level;
      }
    }
  }

  /** Execute either one instruction or a two-cycle interrupt entry; return machine cycles. */
  step() {
    if (this._stepping) throw new Error('MCS-48 step() is not reentrant');
    if (!Number.isSafeInteger(this.cycles) || this.cycles > Number.MAX_SAFE_INTEGER - 2) {
      throw new RangeError('MCS-48 machine-cycle count exceeds exact integer range');
    }
    this._stepping = true;
    try {
      if (!this.interruptInProgress) {
        const external = this.externalInterruptEnabled && this._interruptAsserted();
        const timer = this.timerInterruptEnabled && this.timerInterruptPending;
        if (external || timer) {
          const address = this.pc;
          this._push();
          this.interruptInProgress = true;
          this.pc = external ? 3 : 7;
          if (!external) this.timerInterruptPending = false;
          this._consumeCycles(2);
          this.lastStep = { kind: 'interrupt', source: external ? 'external' : 'timer', address, vector: this.pc, cycles: 2 };
          return 2;
        }
      }

      const address = this.pc;
      const opcode = this.readProgram(address);
      const info = MCS48_OPCODES[opcode];
      if (!info.legal && this.illegalOpcodeMode === 'trap') {
        throw new MCS48IllegalOpcodeError(opcode, address);
      }
      this.pc = nextMCS48Address(this.pc);
      let afterCycles;
      const r = opcode & 7;
      const indirect = opcode & 1;

      if (!info.legal) {
        // Explicit opt-in compatibility policy, never presented as a silicon opcode.
      } else if ((opcode & 0x1f) === 0x04 || (opcode & 0x1f) === 0x14) {
        const low = this._fetch();
        if (opcode & 0x10) this._push();
        this.pc = ((this.interruptInProgress ? 0 : this.memoryBank) << 11) | ((opcode & 0xe0) << 3) | low;
      } else if ((opcode & 0x1f) === 0x12) {
        this._branch(!!(this.a & (1 << (opcode >>> 5))));
      } else if ((opcode & 0xf8) === 0x18) this.setRegister(r, (this.getRegister(r) + 1) & 255);
      else if ((opcode & 0xf8) === 0x28) {
        const value = this.getRegister(r);
        this.setRegister(r, this.a);
        this.a = value;
      } else if ((opcode & 0xf8) === 0x48) this.a |= this.getRegister(r);
      else if ((opcode & 0xf8) === 0x58) this.a &= this.getRegister(r);
      else if ((opcode & 0xf8) === 0x68) this._add(this.getRegister(r));
      else if ((opcode & 0xf8) === 0x78) this._add(this.getRegister(r), this.carry);
      else if ((opcode & 0xf8) === 0xa8) this.setRegister(r, this.a);
      else if ((opcode & 0xf8) === 0xb8) this.setRegister(r, this._fetch());
      else if ((opcode & 0xf8) === 0xc8) this.setRegister(r, (this.getRegister(r) - 1) & 255);
      else if ((opcode & 0xf8) === 0xd8) this.a ^= this.getRegister(r);
      else if ((opcode & 0xf8) === 0xe8) {
        const value = (this.getRegister(r) - 1) & 255;
        this.setRegister(r, value);
        this._branch(value !== 0);
      } else if ((opcode & 0xf8) === 0xf8) this.a = this.getRegister(r);
      else switch (opcode) {
        case 0x00: break;
        case 0x02: this._writeBus(this.a); break;
        case 0x03: this._add(this._fetch()); break;
        case 0x05: this.externalInterruptEnabled = true; break;
        case 0x07: this.a = (this.a - 1) & 255; break;
        case 0x08: this.a = (this.hooks.readBus?.(this) ?? 255) & 255; this._releaseBus(); break;
        case 0x09: case 0x0a: this.a = this._readPort(opcode & 3); break;
        case 0x0c: case 0x0d: case 0x0e: case 0x0f: this._expander(4 + (opcode & 3), 'read'); break;
        case 0x10: case 0x11: {
          const at = this._indirect(indirect);
          this.ram[at] = (this.ram[at] + 1) & 255;
          break;
        }
        case 0x13: this._add(this._fetch(), this.carry); break;
        case 0x15: this.externalInterruptEnabled = false; break;
        case 0x16: { const flag = this.timerFlag; this.timerFlag = false; this._branch(flag); break; }
        case 0x17: this.a = (this.a + 1) & 255; break;
        case 0x20: case 0x21: {
          const at = this._indirect(indirect);
          const value = this.ram[at];
          this.ram[at] = this.a;
          this.a = value;
          break;
        }
        case 0x23: this.a = this._fetch(); break;
        case 0x25: this.timerInterruptEnabled = true; break;
        case 0x26: this._branch(this._test(0) === 0); break;
        case 0x27: this.a = 0; break;
        case 0x30: case 0x31: {
          const at = this._indirect(indirect);
          const value = this.ram[at];
          this.ram[at] = (value & 0xf0) | (this.a & 15);
          this.a = (this.a & 0xf0) | (value & 15);
          break;
        }
        case 0x35: this.timerInterruptEnabled = false; this.timerInterruptPending = false; break;
        case 0x36: this._branch(this._test(0) === 1); break;
        case 0x37: this.a ^= 255; break;
        case 0x39: case 0x3a: this._writePort(opcode & 3, this.a); break;
        case 0x3c: case 0x3d: case 0x3e: case 0x3f: this._expander(4 + (opcode & 3), 'write'); break;
        case 0x40: case 0x41: this.a |= this.ram[this._indirect(indirect)]; break;
        case 0x42: this.a = this.timer; break;
        case 0x43: this.a |= this._fetch(); break;
        case 0x45:
          afterCycles = () => { this.lastT1 = this._test(1); this.timerMode = 'counter'; };
          break;
        case 0x46: this._branch(this._test(1) === 0); break;
        case 0x47: this.a = ((this.a << 4) | (this.a >>> 4)) & 255; break;
        case 0x50: case 0x51: this.a &= this.ram[this._indirect(indirect)]; break;
        case 0x53: this.a &= this._fetch(); break;
        case 0x55:
          afterCycles = () => { this.timerPrescaler = 0; this.timerMode = 'timer'; };
          break;
        case 0x56: this._branch(this._test(1) === 1); break;
        case 0x57: this._decimalAdjust(); break;
        case 0x60: case 0x61: this._add(this.ram[this._indirect(indirect)]); break;
        case 0x62: this.timer = this.a; break;
        case 0x65: afterCycles = () => { this.timerMode = 'stopped'; }; break;
        case 0x67: {
          const low = this.a & 1;
          this.a = (this.a >>> 1) | (this.carry << 7);
          this.psw = (this.psw & ~CARRY) | (low << 7);
          break;
        }
        case 0x70: case 0x71: this._add(this.ram[this._indirect(indirect)], this.carry); break;
        case 0x75: this.clockOutputEnabled = true; this.hooks.clockOutput?.(true, this); break;
        case 0x76: this._branch(this.f1); break;
        case 0x77: this.a = (this.a >>> 1) | ((this.a & 1) << 7); break;
        case 0x80: case 0x81:
          this.a = (this.hooks.readExternal?.(this.getRegister(indirect), this) ?? 255) & 255;
          this._releaseBus();
          break;
        case 0x83: this._return(false); break;
        case 0x85: this.psw &= ~FLAG0; break;
        case 0x86: this._branch(this._interruptAsserted()); break;
        case 0x88: this._writeBus(this.bus | this._fetch()); break;
        case 0x89: this._writePort(1, this.p1 | this._fetch()); break;
        case 0x8a: this._writePort(2, this.p2 | this._fetch()); break;
        case 0x8c: case 0x8d: case 0x8e: case 0x8f: this._expander(4 + (opcode & 3), 'or'); break;
        case 0x90: case 0x91:
          this.hooks.writeExternal?.(this.getRegister(indirect), this.a, this);
          this._releaseBus();
          break;
        case 0x93: this._return(true); break;
        case 0x95: this.psw ^= FLAG0; break;
        case 0x96: this._branch(this.a !== 0); break;
        case 0x97: this.psw &= ~CARRY; break;
        case 0x98: this._writeBus(this.bus & this._fetch()); break;
        case 0x99: this._writePort(1, this.p1 & this._fetch()); break;
        case 0x9a: this._writePort(2, this.p2 & this._fetch()); break;
        case 0x9c: case 0x9d: case 0x9e: case 0x9f: this._expander(4 + (opcode & 3), 'and'); break;
        case 0xa0: case 0xa1: this.ram[this._indirect(indirect)] = this.a; break;
        case 0xa3: this.a = this.readProgram((this.pc & 0xf00) | this.a); break;
        case 0xa5: this.f1 = false; break;
        case 0xa7: this.psw ^= CARRY; break;
        case 0xb0: case 0xb1: {
          const at = this._indirect(indirect);
          this.ram[at] = this._fetch();
          break;
        }
        case 0xb3: this.pc = (this.pc & 0xf00) | this.readProgram((this.pc & 0xf00) | this.a); break;
        case 0xb5: this.f1 = !this.f1; break;
        case 0xb6: this._branch(!!(this.psw & FLAG0)); break;
        case 0xc5: this.psw &= ~REGISTER_BANK; break;
        case 0xc6: this._branch(this.a === 0); break;
        case 0xc7: this.a = this.psw; break;
        case 0xd0: case 0xd1: this.a ^= this.ram[this._indirect(indirect)]; break;
        case 0xd3: this.a ^= this._fetch(); break;
        case 0xd5: this.psw |= REGISTER_BANK; break;
        case 0xd7: this.psw = this.a; break;
        case 0xe3: this.a = this.readProgram((this.pc & 0x800) | 0x300 | this.a); break;
        case 0xe5: this.memoryBank = 0; break;
        case 0xe6: this._branch(this.carry === 0); break;
        case 0xe7: this.a = ((this.a << 1) | (this.a >>> 7)) & 255; break;
        case 0xf0: case 0xf1: this.a = this.ram[this._indirect(indirect)]; break;
        case 0xf5: this.memoryBank = 1; break;
        case 0xf6: this._branch(this.carry === 1); break;
        case 0xf7: {
          const high = this.a & 0x80;
          this.a = ((this.a << 1) | this.carry) & 255;
          this.psw = (this.psw & ~CARRY) | high;
          break;
        }
        default: throw new Error(`Unimplemented documented MCS-48 opcode ${opcode}`);
      }
      this._consumeCycles(info.cycles);
      afterCycles?.();
      this.lastStep = { kind: 'instruction', address, opcode, cycles: info.cycles, legal: info.legal };
      return info.cycles;
    } finally {
      this._stepping = false;
    }
  }

  saveState() {
    if (this._stepping) throw new Error('Take MCS-48 snapshots between instructions');
    const state = { type: 'MCS48', version: 1 };
    for (const name of Object.keys(stateIntegers)) state[name] = this[name];
    for (const name of stateBooleans) state[name] = this[name];
    state.timerMode = this.timerMode;
    state.illegalOpcodeMode = this.illegalOpcodeMode;
    state.rom = Array.from(this.rom);
    state.ram = Array.from(this.ram);
    state.expanderLatches = Array.from(this.expanderLatches);
    state.testPins = Array.from(this.testPins);
    return state;
  }

  static validateState(state) { return validateMCS48State(state); }

  /** Does not call pin callbacks: board snapshots must restore peripheral state separately. */
  loadState(state) {
    if (this._stepping) throw new Error('Cannot restore MCS-48 during step()');
    const validated = validateMCS48State(state);
    for (const name of Object.keys(stateIntegers)) this[name] = validated[name];
    for (const name of stateBooleans) this[name] = validated[name];
    this.timerMode = validated.timerMode;
    this.illegalOpcodeMode = validated.illegalOpcodeMode;
    this.rom.set(validated.rom);
    this.ram.set(validated.ram);
    this.expanderLatches.set(validated.expanderLatches);
    this.testPins.set(validated.testPins);
    this.lastStep = null;
    return this;
  }
}

export default MCS48;
