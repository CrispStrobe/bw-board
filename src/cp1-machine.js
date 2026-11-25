// SPDX-License-Identifier: MIT
// Independently authored from Intel/Kosmos hardware documentation.
// See docs/CP1-HARDWARE.md for wiring, provenance, and accuracy boundaries.

import { MCS48 } from './mcs48.js';
import { Intel8155 } from './i8155.js';
import { identifyCp1Rom } from './cp1-rom-profiles.js';

export const CP1_CLOCK_HZ = 6000000;
export const CP1_OSCILLATORS_PER_CYCLE = 15;
export const CP1_KEY_ROWS = Object.freeze([
  Object.freeze(['CAS', 'CLR', 'PC', 'ACC']),
  Object.freeze(['CAL', 'STEP', 'STP', 'RUN']),
  Object.freeze(['8', '9', 'OUT', 'INP']),
  Object.freeze(['4', '5', '6', '7']),
  Object.freeze(['0', '1', '2', '3']),
]);
const KEY_LOCATIONS = new Map();
CP1_KEY_ROWS.forEach((keys, row) => keys.forEach((key, visualColumn) => {
  // The four schematic traces reverse their visual order before CPU pins 21..24.
  // Thus CAS/0 is P20, CLR/1 is P21, PC/2 is P22, and ACC/3 is P23.
  KEY_LOCATIONS.set(key, { row, bit: visualColumn });
}));

function integer(value, min, max, name) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function finite(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`${name} must be from ${min} to ${max}`);
  return value;
}

function externalPort(port) {
  const value = typeof port === 'string' ? Number(port.replace(/^P/i, '')) : port;
  return integer(value, 1, 5, 'CP1 external port');
}

function keyName(key) {
  const name = String(key).trim().toUpperCase();
  if (!KEY_LOCATIONS.has(name)) throw new RangeError(`Unknown CP1 key: ${key}`);
  return name;
}

export class Cp1Machine {
  constructor(options = {}) {
    this.romProfile = Object.freeze(identifyCp1Rom(options.rom));
    this._rom = options.rom.slice();
    this.clockHz = finite(options.clockHz ?? CP1_CLOCK_HZ, 1, 100000000, 'CP1 crystal frequency');
    this.machineHz = this.clockHz / CP1_OSCILLATORS_PER_CYCLE;
    this.expansion = !!options.expansion;
    this.maxInstructionsPerAdvance = integer(options.maxInstructionsPerAdvance ?? 1000000, 1, 10000000, 'Instruction budget');
    this.displayWindowMs = finite(options.displayWindowMs ?? 40, 1, 1000, 'Display integration window');
    this._displayWindowCycles = this.displayWindowMs * this.machineHz / 1000;
    this._cycles = 0;
    this._stepping = false;
    this._advancing = false;
    this._keys = new Set();
    this._portListeners = new Set();
    this._pinListeners = new Set();
    this._executionListeners = new Set();
    this._publishedPins = new Map();
    this.onPortInputRead = options.onPortInputRead ?? null;
    if (options.onPortChange) this._portListeners.add(options.onPortChange);
    if (options.onPinChange) this._pinListeners.add(options.onPinChange);
    this._inputs = Array.from({ length: 6 }, () => ({ value: 0xff, drivenMask: 0 }));
    this._inputs[5].value = 0x3f;
    this._p1 = 0xff;
    this._p2 = 0xff;
    this.bus = 0xff;
    this.busContentionMask = 0;
    this.busContentionCount = 0;
    this._displayIntervals = [];
    this._displaySince = 0;
    this._displayEpoch = 0;
    this._displayDrive = { segments: 0, rows: 0 };
    this.base = new Intel8155({
      readPort: port => port === 'b' ? this._inputValue(2) : 0xff,
      onPortChange: port => this._chipPortChanged(false, port),
    });
    this.expansionChip = this.expansion ? new Intel8155({
      readPort: port => this._inputValue(port === 'a' ? 4 : port === 'b' ? 3 : 5),
      onPortChange: port => this._chipPortChanged(true, port),
    }) : null;
    this.cpu = new MCS48({
      rom: this._rom,
      readPort: port => this._readCpuPort(port),
      writePort: (port, value) => this._writeCpuPort(port, value),
      readExternal: address => this.readExternal(address),
      writeExternal: (address, value) => this.writeExternal(address, value),
      readBus: () => this.readBus(),
      writeBus: value => { this.bus = value & 0xff; },
      readExpander: port => port === 4 ? this.sampleKeyColumns() : 0x0f,
      // CP1 has no 8243. MOVD P4 reads the actual P2 keypad wires.
      writeExpander: () => {},
      readTest: () => 1,
      readInterrupt: () => false,
      onCycles: count => { this._cycles += count; },
    });
    this.capabilities = Object.freeze({
      cpu: 'NMOS Intel 8049, instruction-level timing',
      ramCells: this.capacity,
      cp3: this.expansion,
      keypad: '20 logical contacts; ten numeric contacts have physical duplicates',
      display: 'six multiplexed digits; simulated-time segment duty',
      cassetteTransport: false,
      analogEffects: false,
      strobed8155Ports: false,
      timer8155Connected: false,
      busContention: 'reported; deterministic low-dominant digital resolution',
      floatingInputs: 'reported; deterministic high sample when undriven',
    });
    this.reset();
  }

  get cycles() { return this._cycles; }
  get tMs() { return this._cycles * 1000 / this.machineHz; }
  get capacity() { return this.expansion ? 256 : 128; }
  get rom() { return this._rom.slice(); }

  addPortListener(callback) {
    if (typeof callback !== 'function') throw new TypeError('Port listener must be a function');
    this._portListeners.add(callback);
    return () => this._portListeners.delete(callback);
  }

  addPinListener(callback) {
    if (typeof callback !== 'function') throw new TypeError('Pin listener must be a function');
    this._pinListeners.add(callback);
    return () => this._pinListeners.delete(callback);
  }

  /** Passive notifications; every advance route still executes this one CPU. */
  addExecutionListener(callback) {
    if (typeof callback !== 'function') throw new TypeError('Execution listener must be a function');
    this._executionListeners.add(callback);
    return () => this._executionListeners.delete(callback);
  }

  _notifyExecution(kind) {
    if (!this._executionListeners.size) return;
    const event = Object.freeze({kind});
    for (const callback of [...this._executionListeners]) callback(event);
  }

  _assertIdle(action) {
    if (this._stepping || this._advancing) throw new Error(`Cannot ${action} while the CP1 is advancing`);
  }

  /** Electrical reset: RAM and elapsed simulation time survive. */
  reset() {
    this._assertIdle('reset');
    this.base.reset();
    this.expansionChip?.reset();
    this.bus = 0xff;
    this.busContentionMask = 0;
    this.cpu.reset();
    this._updateDisplayDrive();
    this.publishPins();
    this._notifyExecution('reset');
    return this;
  }

  /** Power-on RAM is deterministic zero here; elapsed time remains monotonic. */
  powerCycle({ ramFill = 0, releaseKeys = true } = {}) {
    this._assertIdle('power cycle');
    integer(ramFill, 0, 255, 'Power-on RAM fill');
    this.base.powerCycle(ramFill);
    this.expansionChip?.powerCycle(ramFill);
    if (releaseKeys) this.releaseKeys();
    this._displayIntervals = [];
    this._displaySince = this._displayEpoch = this._cycles;
    this._displayDrive = { segments: 0, rows: 0 };
    this.bus = 0xff;
    this.busContentionMask = this.busContentionCount = 0;
    this.cpu.reset({ cold: true });
    this.publishPins();
    this._notifyExecution('power-cycle');
    return this;
  }

  /** A new ROM starts with a cold CPU and fresh RAM; no historic image is bundled. */
  loadRom(bytes) {
    this._assertIdle('replace ROM');
    const profile = identifyCp1Rom(bytes);
    const copy = bytes.slice();
    this.cpu.loadRom(copy);
    this._rom = copy;
    this.romProfile = Object.freeze(profile);
    this.powerCycle();
    return { ...profile };
  }

  _readCpuPort(port) {
    if (port === 1) {
      if (this.onPortInputRead) this.onPortInputRead(1, this);
      return this._inputValue(1);
    }
    if (port === 2) return 0xf0 | this.sampleKeyColumns();
    return 0xff;
  }

  _writeCpuPort(port, value) {
    if (port === 1) {
      this._p1 = value & 0xff;
      this._publishPort(1);
    } else if (port === 2) {
      this._p2 = value & 0xff;
      this.base.setReset(!!(this._p2 & 0x40));
      this.expansionChip?.setReset(!!(this._p2 & 0x40));
      this._updateDisplayDrive();
    }
  }

  /** Diagnostic electrical latch access; firmware normally performs these writes. */
  writeCpuPort(port, value) {
    integer(port, 1, 2, '8049 port');
    integer(value, 0, 255, '8049 port latch');
    this.cpu[port === 1 ? 'p1' : 'p2'] = value;
    this._writeCpuPort(port, value);
  }

  readCpuPort(port) {
    integer(port, 1, 2, '8049 port');
    return this._readCpuPort(port) & (port === 1 ? this._p1 : this._p2);
  }

  /** Capture address, IO/M, and both independent active-low selects at ALE. */
  latchBusAddress(address) {
    integer(address, 0, 255, 'CP1 external bus address');
    const ioMode = !!(this._p2 & 0x80);
    this.base.latchAddress(address, ioMode, !(this._p2 & 0x10));
    this.expansionChip?.latchAddress(address, ioMode, !(this._p2 & 0x20));
  }

  _selectedReaders() {
    return [this.base, this.expansionChip].filter(chip => chip?.selectedLatch && !chip.resetAsserted);
  }

  readBus() {
    const chips = this._selectedReaders();
    // Inputs are sampled at their CPU read boundary, never by read-only snapshots.
    for (const chip of chips) {
      if (!chip.ioLatch) continue;
      const register = chip.addressLatch & 7;
      const port = chip === this.base ? (register === 2 ? 2 : null)
        : register === 1 ? 4 : register === 2 ? 3 : register === 3 ? 5 : null;
      if (port !== null && this.onPortInputRead) this.onPortInputRead(port, this);
    }
    let value = 0xff, ones = 0, zeros = 0;
    for (const chip of chips) {
      const byte = chip.readLatched();
      value &= byte;
      ones |= byte;
      zeros |= (~byte) & 0xff;
    }
    this.busContentionMask = ones & zeros;
    if (this.busContentionMask) this.busContentionCount++;
    this.bus = value;
    return value;
  }

  readExternal(address) {
    this.latchBusAddress(address);
    return this.readBus();
  }

  writeExternal(address, value) {
    integer(value, 0, 255, 'CP1 external bus data');
    this.latchBusAddress(address);
    this.bus = value;
    this.busContentionMask = 0;
    // Both selected chips receive /WR; an if/else here would miswire the bus.
    this.base.writeLatched(value);
    this.expansionChip?.writeLatched(value);
  }

  setKey(key, pressed, contact = 0) {
    const name = keyName(key);
    integer(contact, 0, /^\d$/.test(name) ? 1 : 0, 'Physical key contact');
    const id = `${name}:${contact}`;
    if (pressed) this._keys.add(id);
    else this._keys.delete(id);
  }

  releaseKeys() { this._keys.clear(); }

  get pressedKeys() {
    return [...new Set([...this._keys].map(id => id.split(':')[0]))];
  }

  sampleKeyColumns() {
    if (!this.base.isOutput('c') || this.base.resetAsserted) return 0;
    const rows = (~this.base.output.c) & 0x3f;
    let columns = 0;
    for (const id of this._keys) {
      const { row, bit } = KEY_LOCATIONS.get(id.split(':')[0]);
      if (rows & (1 << row)) columns |= 1 << bit;
    }
    // The original board has 1 kohm pull-DOWNS, with selected PNP rows high.
    return columns;
  }

  _inputValue(port) {
    const mask = port === 5 ? 0x3f : 0xff;
    const input = this._inputs[port];
    return ((input.value & input.drivenMask) | (~input.drivenMask & mask)) & mask;
  }

  setPortInput(port, value, drivenMask) {
    const number = externalPort(port);
    if (number >= 3 && !this.expansion) throw new RangeError('Ports 3–5 require the CP3 expansion');
    const mask = number === 5 ? 0x3f : 0xff;
    integer(value, 0, mask, `Port ${number} input`);
    integer(drivenMask ?? mask, 0, mask, `Port ${number} driven mask`);
    this._inputs[number] = { value, drivenMask: drivenMask ?? mask };
    this._publishPort(number);
  }

  getPortState(port) {
    const number = externalPort(port);
    if (number >= 3 && !this.expansion) return { available: false, width: number === 5 ? 6 : 8 };
    const mask = number === 5 ? 0x3f : 0xff;
    const input = this._inputValue(number);
    const outside = this._inputs[number];
    if (number === 1) return {
      available: true, width: 8, value: this._p1 & input, latch: this._p1,
      input, externalDrivenMask: outside.drivenMask, direction: 'quasi',
      drivenMask: (~this._p1) & 0xff, pullupMask: this._p1,
      floatingMask: 0, contentionMask: (~this._p1) & outside.drivenMask & outside.value,
    };
    const chip = number === 2 ? this.base : this.expansionChip;
    const letter = number === 2 || number === 3 ? 'b' : number === 4 ? 'a' : 'c';
    const state = chip.getPortState(letter);
    return {
      available: true, ...state, input, externalDrivenMask: outside.drivenMask,
      floatingMask: state.direction === 'input' ? (~outside.drivenMask) & mask : 0,
      contentionMask: state.drivenMask & outside.drivenMask & (state.latch ^ outside.value),
    };
  }

  getPortStates() {
    return Object.fromEntries([1, 2, 3, 4, 5].map(port => [`P${port}`, this.getPortState(port)]));
  }

  _chipPortChanged(expansion, port) {
    if (!expansion && (port === 'a' || port === 'c')) this._updateDisplayDrive();
    else this._publishPort(expansion ? (port === 'a' ? 4 : port === 'b' ? 3 : 5) : 2);
  }

  _publishPort(port, force = false) {
    const state = this.getPortState(port);
    if (!state.available) return;
    for (const callback of this._portListeners) callback(port, { ...state }, this.tMs);
    const mode = state.direction === 'quasi' ? 'quasi' : state.direction === 'output' ? 'pushpull' : 'input';
    for (let bit = 0; bit < state.width; bit++) {
      const pin = `P${port}.${bit}`;
      const high = mode === 'input' ? false : !!(state.latch & (1 << bit));
      const signature = `${mode}:${high}`;
      if (!force && this._publishedPins.get(pin) === signature) continue;
      this._publishedPins.set(pin, signature);
      for (const callback of this._pinListeners) callback(pin, mode, high, this.tMs);
    }
  }

  publishPins() {
    for (let port = 1; port <= (this.expansion ? 5 : 2); port++) this._publishPort(port, true);
  }

  _updateDisplayDrive() {
    if (!this.base) return;
    const segments = this.base.isOutput('a') && !this.base.resetAsserted ? this.base.output.a & 0x7f : 0;
    const rows = this.base.isOutput('c') && !this.base.resetAsserted ? (~this.base.output.c) & 0x3f : 0;
    if (segments === this._displayDrive.segments && rows === this._displayDrive.rows) return;
    if (this._cycles > this._displaySince) {
      this._displayIntervals.push({ start: this._displaySince, end: this._cycles, ...this._displayDrive });
    }
    this._displaySince = this._cycles;
    this._displayDrive = { segments, rows };
    const cutoff = this._cycles - this._displayWindowCycles;
    while (this._displayIntervals.length && this._displayIntervals[0].end <= cutoff) this._displayIntervals.shift();
  }

  /** Raw electrical masks plus finite-window integrated segment duty, without advancing time. */
  getDisplay() {
    const end = this._cycles;
    const start = Math.max(this._displayEpoch, end - this._displayWindowCycles);
    const duration = end - start;
    const hardwareDuty = Array.from({ length: 6 }, () => Array(8).fill(0));
    const integrate = interval => {
      const weight = Math.max(0, Math.min(end, interval.end) - Math.max(start, interval.start));
      if (!weight || !duration) return;
      for (let digit = 0; digit < 6; digit++) {
        if (!(interval.rows & (1 << digit))) continue;
        const mask = interval.segments | (digit === 3 ? 0x80 : 0);
        for (let bit = 0; bit < 8; bit++) if (mask & (1 << bit)) hardwareDuty[digit][bit] += weight / duration;
      }
    };
    for (const interval of this._displayIntervals) integrate(interval);
    integrate({ start: this._displaySince, end, ...this._displayDrive });
    const hardwareRawDigits = Array.from({ length: 6 }, (_, digit) =>
      this._displayDrive.rows & (1 << digit) ? this._displayDrive.segments | (digit === 3 ? 0x80 : 0) : 0);
    const hardwareDigits = hardwareDuty.map((duties, digit) => {
      if (!duration) return hardwareRawDigits[digit];
      const threshold = Math.max(0.002, Math.max(...duties) * 0.2);
      return duties.reduce((mask, duty, bit) => duty >= threshold ? mask | (1 << bit) : mask, 0);
    });
    const hardwareActiveDigits = Array.from({ length: 6 }, (_, digit) => !!(this._displayDrive.rows & (1 << digit)));
    return {
      digits: hardwareDigits.slice().reverse(), duty: hardwareDuty.slice().reverse().map(row => row.slice()),
      rawDigits: hardwareRawDigits.slice().reverse(), activeDigits: hardwareActiveDigits.slice().reverse(),
      hardwareDigits, hardwareDuty, hardwareRawDigits, hardwareActiveDigits,
      segmentMask: this._displayDrive.segments, digitSelectMask: (~this._displayDrive.rows) & 0x3f,
      windowMs: duration * 1000 / this.machineHz,
      configuredWindowMs: this.displayWindowMs, fixedSeparatorIndex: 2,
      segmentOrder: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'separator'],
    };
  }

  _cellAddress(index) {
    integer(index, 0, this.capacity - 1, 'CP1 cell address');
    return { chip: index < 128 ? this.base : this.expansionChip, offset: (index & 127) * 2 };
  }

  readCell(index) {
    const { chip, offset } = this._cellAddress(index);
    return { opcode: chip.ram[offset], operand: chip.ram[offset + 1] };
  }

  writeCell(index, opcode, operand) {
    const { chip, offset } = this._cellAddress(index);
    if (opcode && typeof opcode === 'object') ({ opcode, operand } = opcode);
    integer(opcode, 0, 255, 'CP1 cell opcode');
    integer(operand, 0, 255, 'CP1 cell operand');
    chip.ram[offset] = opcode;
    chip.ram[offset + 1] = operand;
    this._notifyExecution('program-edit');
  }

  /** Load cells atomically after full validation; this never executes a CP1 instruction. */
  loadProgram(program, { start = 0, clear = false } = {}) {
    this._assertIdle('load a program');
    integer(start, 0, this.capacity - 1, 'Program start');
    if (!Array.isArray(program)) throw new TypeError('CP1 program must be an array of {opcode, operand} cells');
    if (program.length > this.capacity - start) throw new RangeError('Program exceeds installed CP1 memory');
    const cells = program.map((cell, offset) => ({
      opcode: integer(cell?.opcode, 0, 255, `Program cell ${start + offset} opcode`),
      operand: integer(cell?.operand, 0, 255, `Program cell ${start + offset} operand`),
    }));
    if (clear) {
      this.base.ram.fill(0);
      this.expansionChip?.ram.fill(0);
    }
    cells.forEach((cell, index) => {
      const {chip, offset} = this._cellAddress(start + index);
      chip.ram[offset] = cell.opcode;
      chip.ram[offset + 1] = cell.operand;
    });
    if (clear || cells.length) this._notifyExecution('program-edit');
    return { start, count: cells.length, capacity: this.capacity };
  }

  step() {
    if (this._stepping) throw new Error('CP1 step() cannot be re-entered');
    if (this._cycles > Number.MAX_SAFE_INTEGER - 2) throw new RangeError('CP1 cycle counter exhausted');
    this._stepping = true;
    try {
      this._notifyExecution('before-step');
      const cycles = this.cpu.step();
      this._notifyExecution('step');
      return cycles;
    }
    finally { this._stepping = false; }
  }

  advanceCycles(cycles, { maxInstructions = this.maxInstructionsPerAdvance } = {}) {
    this._assertIdle('advance');
    integer(cycles, 0, Number.MAX_SAFE_INTEGER - this._cycles, 'CP1 cycle budget');
    integer(maxInstructions, 1, 10000000, 'Instruction budget');
    const start = this._cycles;
    const target = start + cycles;
    let instructions = 0;
    this._advancing = true;
    try {
      while (this._cycles < target && instructions < maxInstructions) { this.step(); instructions++; }
    } finally { this._advancing = false; }
    return { cycles: this._cycles - start, instructions, reached: this._cycles >= target, targetCycles: target };
  }

  advanceToMs(targetMs, options = {}) {
    finite(targetMs, 0, Number.MAX_SAFE_INTEGER * 1000 / this.machineHz, 'CP1 target time');
    const target = Math.ceil(targetMs * this.machineHz / 1000);
    return this.advanceCycles(Math.max(0, target - this._cycles), options);
  }

  snapshot({ includeMemory = true } = {}) {
    const cpu = this.cpu;
    const result = {
      type: 'KosmosCP1', tMs: this.tMs, cycles: this._cycles, expansion: this.expansion,
      capacity: this.capacity, rom: { ...this.romProfile }, display: this.getDisplay(),
      ports: this.getPortStates(), keys: this.pressedKeys,
      cpu: { pc: cpu.pc, a: cpu.a, psw: cpu.psw, cycles: cpu.cycles, p1: cpu.p1, p2: cpu.p2, timer: cpu.timer, f1: cpu.f1 },
      bus: { value: this.bus, contentionMask: this.busContentionMask, contentionCount: this.busContentionCount },
      capabilities: { ...this.capabilities },
    };
    if (includeMemory) result.cells = Array.from({ length: this.capacity }, (_, index) => this.readCell(index));
    return result;
  }

  saveState() {
    this._assertIdle('save state');
    return {
      type: 'KosmosCP1', version: 1, romSha1: this.romProfile.sha1, clockHz: this.clockHz,
      expansion: this.expansion, cycles: this._cycles, cpu: this.cpu.saveState(),
      base: this.base.saveState(), expansionChip: this.expansionChip?.saveState() ?? null,
      inputs: this._inputs.map(input => ({ ...input })), keys: [...this._keys],
      bus: this.bus, busContentionMask: this.busContentionMask, busContentionCount: this.busContentionCount,
      display: {
        windowMs: this.displayWindowMs, epoch: this._displayEpoch, since: this._displaySince,
        drive: { ...this._displayDrive }, intervals: this._displayIntervals.map(interval => ({ ...interval })),
      },
    };
  }

  /** All components validate in isolation before any live state is replaced. */
  loadState(state) {
    this._assertIdle('restore state');
    if (!state || state.type !== 'KosmosCP1' || state.version !== 1) throw new TypeError('Unsupported Kosmos CP1 state');
    if (state.romSha1 !== this.romProfile.sha1) throw new Error('CP1 state ROM identity does not match the loaded ROM');
    if (state.expansion !== this.expansion) throw new Error('CP1 state CP3 topology does not match this machine');
    if (state.clockHz !== this.clockHz) throw new Error('CP1 state crystal frequency does not match this machine');
    const cycles = integer(state.cycles, 0, Number.MAX_SAFE_INTEGER, 'CP1 state cycles');
    const cpu = MCS48.validateState(state.cpu);
    for (let i = 0; i < cpu.rom.length; i++) {
      if (cpu.rom[i] !== (i < 2048 ? this._rom[i] : 0xff)) throw new Error('CP1 state contains different ROM bytes');
    }
    const base = new Intel8155(); base.loadState(state.base, { notify: false });
    let expansionChip = null;
    if (this.expansion) { expansionChip = new Intel8155(); expansionChip.loadState(state.expansionChip, { notify: false }); }
    else if (state.expansionChip !== null) throw new Error('Unexpected CP3 state');
    if (base.resetAsserted !== !!(cpu.p2 & 0x40) || (expansionChip && expansionChip.resetAsserted !== !!(cpu.p2 & 0x40))) {
      throw new Error('CP1 state reset wiring is inconsistent');
    }
    if (!Array.isArray(state.inputs) || state.inputs.length !== 6) throw new TypeError('Invalid CP1 input state');
    const inputs = state.inputs.map((input, port) => ({
      value: integer(input?.value, 0, port === 5 ? 0x3f : 0xff, 'CP1 input value'),
      drivenMask: integer(input?.drivenMask, 0, port === 5 ? 0x3f : 0xff, 'CP1 input driven mask'),
    }));
    if (!Array.isArray(state.keys) || state.keys.length > 30) throw new TypeError('Invalid CP1 key state');
    const keys = new Set(state.keys.map(id => {
      if (typeof id !== 'string' || !/^([^:]+):[01]$/.test(id)) throw new TypeError('Invalid CP1 physical key');
      const [name, contact] = id.split(':');
      if (keyName(name) !== name || (!/^\d$/.test(name) && contact !== '0')) throw new TypeError('Invalid CP1 physical key');
      return id;
    }));
    if (keys.size !== state.keys.length) throw new TypeError('Duplicate CP1 key state');
    const bus = integer(state.bus, 0, 255, 'CP1 state bus');
    const busContentionMask = integer(state.busContentionMask, 0, 255, 'CP1 bus contention mask');
    const busContentionCount = integer(state.busContentionCount, 0, Number.MAX_SAFE_INTEGER, 'CP1 bus contention count');
    const display = state.display;
    if (!display || display.windowMs !== this.displayWindowMs) throw new Error('CP1 display integration window does not match');
    const epoch = integer(display.epoch, 0, cycles, 'Display epoch');
    const since = integer(display.since, epoch, cycles, 'Display drive start');
    const readDrive = drive => ({ segments: integer(drive?.segments, 0, 0x7f, 'Display segments'), rows: integer(drive?.rows, 0, 0x3f, 'Display rows') });
    const drive = readDrive(display.drive);
    const expectedSegments = base.isOutput('a') && !base.resetAsserted ? base.output.a & 0x7f : 0;
    const expectedRows = base.isOutput('c') && !base.resetAsserted ? (~base.output.c) & 0x3f : 0;
    if (drive.segments !== expectedSegments || drive.rows !== expectedRows) throw new Error('CP1 display state does not match the 8155 pins');
    if (!Array.isArray(display.intervals) || display.intervals.length > 1000000) throw new TypeError('Invalid CP1 display intervals');
    let previousEnd = epoch;
    const intervals = display.intervals.map(interval => {
      const start = integer(interval?.start, previousEnd, since, 'Display interval start');
      const end = integer(interval?.end, start + 1, since, 'Display interval end');
      previousEnd = end;
      return { start, end, ...readDrive(interval) };
    });
    this.cpu.loadState(cpu);
    this.base.loadState(base.saveState(), { notify: false });
    if (expansionChip) this.expansionChip.loadState(expansionChip.saveState(), { notify: false });
    this._cycles = cycles;
    this._p1 = cpu.p1; this._p2 = cpu.p2;
    this._inputs = inputs; this._keys = keys;
    this.bus = bus; this.busContentionMask = busContentionMask; this.busContentionCount = busContentionCount;
    this._displayEpoch = epoch; this._displaySince = since;
    this._displayDrive = drive; this._displayIntervals = intervals;
    this.publishPins();
    this._notifyExecution('restore');
    return this;
  }
}

export const KosmosCP1 = Cp1Machine;
export default Cp1Machine;
