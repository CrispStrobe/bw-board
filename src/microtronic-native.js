// SPDX-License-Identifier: MIT
import {Tms1600} from './tms1600.js';
import {formatMicrotronicProgram, parseMicrotronicProgram} from './microtronic-machine.js';
import {microtronicNativeMonitorLayout, microtronicNativeMonitorRom} from './microtronic-native-monitor.js';

const keys = new Map([
  ['RESET', 0], ['HALT', 1], ['NEXT', 2], ['CCE', 3], ['RUN', 4], ['STEP', 5], ['REG', 6], ['BKP', 7], ['PGM', 8]
]);
const digit = value => value.toString(16).toUpperCase();
const hex = value => digit(value).padStart(2, '0');
const idleKey = Object.freeze({kind: 0, value: 0});
const pollBudget = 65_536;

function keyCode(key) {
  const text = String(key).trim().toUpperCase();
  if (/^[0-9A-F]$/.test(text)) return {kind: 1, value: parseInt(text, 16)};
  const value = keys.get(text === 'C/CE' ? 'CCE' : text === 'STP' ? 'HALT' : text);
  return value === undefined ? null : {kind: 2, value};
}

/** The first native ROM uses this simulated pin interface, specified separately from the physical 2090 bus. */
export class MicrotronicNative {
  #cpu;
  #key = idleKey;
  #keyPolls = 0;
  #frames = 0;
  #r = 0;
  #address = 0;
  #displayPosition = 0;
  #displayBuffer = Array(6).fill(' ');
  #guestToken = false;
  #programDirty = false;

  constructor(source = 'F00') {
    this.model = 'tms1600';
    this.program = parseMicrotronicProgram(source);
    this.programSource = formatMicrotronicProgram(this.program);
    this.registers = Array(16).fill(0);
    this.storage = Array(16).fill(0);
    this.input = 0;
    this.#cpu = new Tms1600(microtronicNativeMonitorRom, {
      readK: (_o, r) => this.#readPins(r),
      writePins: (o, r) => this.#writePins(o, r)
    });
    this.reset();
  }

  #readPins(r) {
    if ((r & 0x8001) === 0x8001) return Number(this.#guestToken);
    if (r & 1) return this.#key.value;
    if (r & 2) {
      this.#keyPolls++;
      return this.#key.kind;
    }
    if (r & 4) return this.input;
    for (let i = 0; i < 3; i++) {
      if (r & (1 << (6 + i))) return (this.program[this.#address] >> (8 - 4 * i)) & 15;
    }
    return 0;
  }

  #writePins(o, r) {
    const rising = r & ~this.#r;
    this.#r = r;
    const nibble = o & 15;
    if (rising & (1 << 3)) this.output = nibble;
    if (rising & (1 << 4)) this.#address = (this.#address & 15) | (nibble << 4);
    if (rising & (1 << 5)) this.#address = (this.#address & 240) | nibble;
    if (r & (1 << 9)) {
      for (let i = 0; i < 3; i++) {
        if (!(rising & (1 << (6 + i)))) continue;
        const shift = 8 - 4 * i;
        const word = this.program[this.#address];
        this.program[this.#address] = (word & ~(15 << shift)) | (nibble << shift);
        this.#programDirty = true;
      }
    }
    if (rising & (1 << 10)) this.#displayPosition = nibble;
    if ((rising & (1 << 11)) && this.#displayPosition < 6) {
      this.#displayBuffer[this.#displayPosition] = o < 16 ? digit(o) : o === 17 ? '-' : ' ';
    }
    if (rising & (1 << 12)) {
      this.carry = Boolean(nibble & 1);
      this.zero = Boolean(nibble & 2);
    }
    if (rising & (1 << 13)) {
      this.error = nibble & 4 ? 'This command is unavailable in the native monitor.' : null;
      this.running = Boolean(nibble & 1);
      this.waitingForKey = nibble & 2 ? true : null;
    }
    if (rising & (1 << 14)) {
      this.display = this.#displayBuffer.join('');
      this.#frames++;
    }
    if ((rising & (1 << 15)) && !(r & 1)) {
      this.executed++;
      this.#guestToken = false;
    }
  }

  #until(done) {
    for (let i = 0; i < pollBudget; i++) {
      if (done()) return;
      this.#cpu.step();
    }
    if (done()) return;
    this.running = false;
    this.waitingForKey = null;
    this.error = 'TMS1600 monitor did not return to its control loop.';
    throw new Error(this.error);
  }

  #finishFrame() {
    const before = this.#frames;
    this.#until(() => this.#frames !== before);
    this.#snapshot();
  }

  #snapshot() {
    const {pcLow, pcHigh, working, memory} = microtronicNativeMonitorLayout;
    const ram = this.#cpu.ram;
    this.pc = (ram[pcHigh] << 4) | ram[pcLow];
    this.nativeAddress = this.#cpu.address;
    this.nativeInstructions = this.#cpu.instructions;
    for (let i = 0; i < 16; i++) {
      this.registers[i] = ram[working + i];
      this.storage[i] = ram[memory + i];
    }
    if (this.#programDirty) {
      this.programSource = formatMicrotronicProgram(this.program);
      this.#programDirty = false;
    }
  }

  reset() {
    this.#key = idleKey;
    this.#r = this.#address = this.#displayPosition = 0;
    this.#guestToken = false;
    this.#displayBuffer.fill(' ');
    this.display = '';
    this.output = this.executed = 0;
    this.running = this.carry = this.zero = false;
    this.error = this.waitingForKey = null;
    this.#cpu.ram.fill(0);
    this.#cpu.reset();
    this.#finishFrame();
  }

  press(text) {
    const key = keyCode(text);
    if (!key) return false;
    if (key.kind === 2 && key.value === 0) {
      this.reset();
      return true;
    }
    this.#key = key;
    try {
      const polls = this.#keyPolls;
      this.#until(() => this.#keyPolls > polls);
      this.#finishFrame();
    } finally {
      this.#key = idleKey;
    }
    const release = this.#keyPolls;
    this.#until(() => this.#keyPolls > release);
    if (key.kind === 2 && key.value === 5 && this.running) this.tick();
    return true;
  }

  sampleInputs(value) {
    if (value === this.input) return;
    this.input = value;
    this.#finishFrame();
  }

  tick() {
    if (!this.running || this.waitingForKey !== null || this.error) return;
    const before = this.executed;
    this.#guestToken = true;
    try {
      this.#until(() => this.executed !== before || this.waitingForKey !== null || !this.running);
      this.#finishFrame();
    } finally {
      this.#guestToken = false;
    }
  }

  control(verb, value) {
    if (verb === 'loadProgram') {
      this.program = parseMicrotronicProgram(value);
      this.#programDirty = true;
      this.reset();
      return true;
    }
    if (verb === 'setPc' || (verb === 'run' && value != null)) {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new Error('Program address must be an integer from 0 through 255.');
      }
      this.press('HALT');
      this.press('NEXT');
      for (const nibble of hex(value)) this.press(nibble);
      if (verb === 'setPc') return true;
    }
    if (verb === 'key') return this.press(value);
    if (['run', 'step', 'halt', 'reset'].includes(verb)) return this.press(verb);
    return false;
  }
}
