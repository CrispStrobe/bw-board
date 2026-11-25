// SPDX-License-Identifier: MIT
/**
 * Independent KIM-1 teaching monitor and unexpanded machine. No original ROM,
 * translated monitor listing, or third-party KIM emulator is included.
 * CPU execution is NMOS 6502; monitor keys are higher-level simulator actions.
 * See docs/KIM1.md for the supported map, clock, and compatibility boundary.
 */
import {NMOS6502} from './nmos6502.js';

const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');
const addressOK = n => Number.isInteger(n) && n >= 0 && n <= 65535;
const cores = new WeakMap();
const cpuKeys = ['a', 'x', 'y', 's', 'p', 'pc', 'cycles'];
export const KIM1_DEFAULT_PROGRAM = '0200: EA 4C 00 02';
export const KIM1_DEMOS = Object.freeze({
  counter: Object.freeze({name: 'Output counter', program: '0200: A9 FF 8D 01 17 A9 00 8D 00 17 EE 00 17 4C 0A 02'}),
  echo: Object.freeze({name: 'Input to output', program: '0200: A9 FF 8D 01 17 A9 00 8D 03 17 AD 02 17 29 BF 8D\n0210: 00 17 4C 0A 02'})
});

export function kim1CanonicalAddress(address) { return address & 0x1fff; }
const isRam = a => a < 0x400 || (a >= 0x1780 && a < 0x1800);

/** Every data line is an exact four-digit address and two-digit hex bytes. */
export function parseKim1Program(source) {
  if (typeof source !== 'string') throw new Error('Use addressed hexadecimal bytes, for example 0200: A9 01.');
  const image = {};
  for (const [line, raw] of source.split(/\r?\n/).entries()) {
    const text = raw.replace(/[;#].*$/, '').trim();
    if (!text) continue;
    const match = /^([0-9a-f]{4}):\s*(.+)$/i.exec(text);
    if (!match) throw new Error(`Line ${line + 1}: expected AAAA: BB CC (four-digit address, two-digit bytes).`);
    let address = parseInt(match[1], 16);
    for (const token of match[2].trim().split(/\s+/)) {
      if (!/^[0-9a-f]{2}$/i.test(token)) throw new Error(`Line ${line + 1}: "${token}" is not a two-digit hexadecimal byte.`);
      if (address > 65535) throw new Error(`Line ${line + 1}: program exceeds the 16-bit address space.`);
      const canonical = kim1CanonicalAddress(address);
      if (!isRam(canonical)) throw new Error(`Line ${line + 1}: $${hex(address, 4)} is not writable KIM-1 RAM.`);
      if (Object.hasOwn(image, canonical)) throw new Error(`Line ${line + 1}: RAM $${hex(canonical, 4)} is assigned twice (including aliases).`);
      image[canonical] = parseInt(token, 16);
      address++;
    }
  }
  const addresses = Object.keys(image).map(Number).sort((a, b) => a - b);
  if (!addresses.length) throw new Error('Enter at least one addressed hexadecimal byte.');
  return {image, start: addresses[0]};
}

export function formatKim1Program(value) {
  const image = value.image ?? value;
  const addresses = Object.keys(image).map(Number).sort((a, b) => a - b);
  const lines = [];
  let group = [];
  for (const address of addresses) {
    if (group.length && (address !== group.at(-1) + 1 || group.length === 16)) {
      lines.push(`${hex(group[0], 4)}: ${group.map(a => hex(image[a], 2)).join(' ')}`);
      group = [];
    }
    group.push(address);
  }
  if (group.length) lines.push(`${hex(group[0], 4)}: ${group.map(a => hex(image[a], 2)).join(' ')}`);
  return lines.join('\n');
}

function newRiot() {
  return {pa: 0, pb: 0, ddra: 0, ddrb: 0, inputA: 0, inputB: 0,
    timer: {active: false, count: 0, divider: 1, phase: 1, expired: false, irqEnabled: false}};
}

function timerLoad(timer, value, divider, irqEnabled) {
  Object.assign(timer, {active: true, count: value, divider, phase: 1, expired: false, irqEnabled});
}

/** The first decrement follows one cycle; underflow is N*divider+1 cycles. */
function advanceTimer(timer, cycles) {
  if (!timer.active || cycles <= 0) return;
  const first = timer.phase, divider = timer.divider;
  timer.phase = cycles < first ? first - cycles : divider - ((cycles - first) % divider);
  if (timer.expired) { timer.count = (timer.count - (cycles & 255)) & 255; return; }
  if (cycles < first) return;
  const decrements = 1 + Math.floor((cycles - first) / divider);
  if (decrements <= timer.count) timer.count -= decrements;
  else {
    const afterUnderflow = cycles - first - timer.count * divider;
    timer.count = (255 - (afterUnderflow & 255)) & 255;
    timer.expired = true;
  }
}

export function advanceKim1Cycles(state, cycles) {
  if (!Number.isSafeInteger(cycles) || cycles < 0) throw new Error('KIM-1 cycle advance must be a non-negative safe integer.');
  for (const riot of state.riots) advanceTimer(riot.timer, cycles);
  refreshKim1Display(state);
}

/** Cycles until a timer can change PB7, or null when no expiry is pending. */
export function kim1TimerDeadlineCycles(state) {
  const waits = state.riots.map(r => r.timer).filter(t => t.active && !t.expired)
    .map(t => t.phase + t.count * t.divider);
  return waits.length ? Math.min(...waits) : null;
}

function portValue(riot, port) {
  const ddr = riot[port === 'a' ? 'ddra' : 'ddrb'];
  let value = (riot[port === 'a' ? 'pa' : 'pb'] & ddr) | (riot[port === 'a' ? 'inputA' : 'inputB'] & ~ddr);
  if (port === 'b' && riot.timer.irqEnabled && riot.timer.expired) value &= 127;
  return value & 255;
}

function readRegister(riot, reg, acknowledge) {
  reg &= 15;
  if (!(reg & 4)) {
    if ((reg & 3) === 0) return portValue(riot, 'a');
    if ((reg & 3) === 1) return riot.ddra;
    if ((reg & 3) === 2) return portValue(riot, 'b');
    return riot.ddrb;
  }
  const timer = riot.timer;
  if (reg & 1) return timer.expired ? 128 : 0;
  const count = timer.count;
  if (acknowledge) {
    timer.irqEnabled = !!(reg & 8);
    timer.expired = false; // Restore programmed rate; the prescaler keeps its phase.
  }
  return count;
}

function writeRegister(riot, reg, value) {
  reg &= 15;
  if (!(reg & 4)) {
    riot[['pa', 'ddra', 'pb', 'ddrb'][reg & 3]] = value;
    return;
  }
  timerLoad(riot.timer, value, [1, 8, 64, 1024][reg & 3], !!(reg & 8));
}

function accessRead(state, address, acknowledge) {
  const a = kim1CanonicalAddress(address);
  if (a < 0x400) return state.ram[a];
  if (a >= 0x1780 && a < 0x1800) return state.riotRam[a - 0x1780];
  if (a >= 0x1700 && a < 0x1780) return readRegister(state.riots[a >= 0x1740 ? 1 : 0], a & 15, acknowledge);
  return null;
}

export function peekKim1Byte(state, address) { return accessRead(state, address, false); }
export function readKim1Byte(state, address, {strict = true} = {}) {
  const value = accessRead(state, address, true);
  if (value !== null || !strict) return value;
  const a = kim1CanonicalAddress(address);
  throw new Error(a >= 0x1800 ? `Original KIM-1 ROM at $${hex(address & 65535, 4)} is unavailable; ROM monitor routines are not emulated.` :
    `Unmapped KIM-1 read at $${hex(address & 65535, 4)}; expansion memory is not installed.`);
}

export function writeKim1Byte(state, address, value, {authored = false} = {}) {
  const a = kim1CanonicalAddress(address);
  value &= 255;
  if (a < 0x400) state.ram[a] = value;
  else if (a >= 0x1780 && a < 0x1800) state.riotRam[a - 0x1780] = value;
  else if (a >= 0x1700 && a < 0x1780) writeRegister(state.riots[a >= 0x1740 ? 1 : 0], a & 15, value);
  else throw new Error(`$${hex(address & 65535, 4)} is not writable ${authored ? 'program RAM' : 'KIM-1 memory'}.`);
  if (authored && isRam(a)) {
    state.image[a] = value;
    state.programSource = formatKim1Program(state.image);
  }
}

function saveRegisters(state) {
  const c = state.cpu;
  state.ram.set([c.pc & 255, c.pc >>> 8, c.p | 32, c.s, c.a, c.y, c.x], 0xef);
}
function restoreRegisters(state) {
  const r = state.ram, c = state.cpu;
  c.a = r[0xf3]; c.x = r[0xf5]; c.y = r[0xf4]; c.s = r[0xf2]; c.p = (r[0xf1] | 32) & ~16;
}

function coreFor(state) {
  let core = cores.get(state);
  if (!core) {
    core = new NMOS6502({read: a => readKim1Byte(state, a), write: (a, v) => writeKim1Byte(state, a, v)});
    cores.set(state, core);
  }
  for (const key of cpuKeys) core[key] = state.cpu[key];
  return core;
}

export function createKim1Machine(source = KIM1_DEFAULT_PROGRAM) {
  const parsed = parseKim1Program(source);
  const state = {
    model: 'independent-monitor-nmos6502', ram: new Uint8Array(1024), riotRam: new Uint8Array(128),
    image: parsed.image, programSource: formatKim1Program(parsed), startAddress: parsed.start,
    cpu: {a: 0, x: 0, y: 0, s: 0xfd, p: 0x24, pc: parsed.start, cycles: 0},
    riots: [newRiot(), newRiot()], address: parsed.start, pc: parsed.start,
    display: '', mode: 'address', running: false, singleStep: false, error: null,
    stoppedAddress: parsed.start, executed: 0, lastCycles: 0, lastStop: 'reset',
    portA: 0, portB: 0, ddrA: 0, ddrB: 0, memoryAvailable: true
  };
  for (const [address, value] of Object.entries(parsed.image)) writeKim1Byte(state, Number(address), value);
  saveRegisters(state);
  refreshKim1Display(state);
  return state;
}

/** Simulator reset enters the independent monitor, preserving non-workspace RAM. */
export function resetKim1Machine(state) {
  state.cpu = {a: 0, x: 0, y: 0, s: 0xfd, p: 0x24, pc: state.startAddress, cycles: 0};
  state.riots = [newRiot(), newRiot()];
  state.address = state.stoppedAddress = state.startAddress;
  state.running = false; state.singleStep = false; state.error = null; state.mode = 'address';
  state.executed = state.lastCycles = 0; state.lastStop = 'reset';
  saveRegisters(state); refreshKim1Display(state);
}

export function observeKim1Inputs(state, portA, portB) {
  state.riots[0].inputA = portA & 255;
  state.riots[0].inputB = portB & 0xbf; // PB6 is reserved for board selection, not a terminal.
  refreshKim1Display(state);
}

export function refreshKim1Display(state) {
  state.pc = state.cpu.pc;
  const riot = state.riots[0];
  state.portA = portValue(riot, 'a'); state.portB = portValue(riot, 'b');
  state.ddrA = riot.ddra; state.ddrB = riot.ddrb;
  const value = peekKim1Byte(state, state.address);
  state.memoryAvailable = value !== null;
  state.display = hex(state.address & 65535, 4) + (value === null ? '--' : hex(value, 2));
  return state.display;
}

function enterMonitor(state, reason) {
  state.running = false; state.mode = 'address';
  state.address = state.stoppedAddress = state.cpu.pc;
  state.lastStop = reason;
  saveRegisters(state);
  refreshKim1Display(state);
}

/**
 * Execute one instruction. Board drives elapsed timer cycles separately;
 * direct STEP supplies the instruction's cycles to the peripheral clocks.
 */
export function stepKim1Machine(state, {singleStep = true, advanceTimers = true} = {}) {
  if (state.error) return 0;
  const core = coreFor(state);
  let cycles = 0, brk = false;
  try {
    if (peekKim1Byte(state, core.pc) === 0) {
      // BRK is a declared host-monitor trap. The actual CPU core still has a
      // normal vector-based BRK for standalone users/tests. No fake ROM bytes.
      const next = (core.pc + 2) & 65535, userSp = core.s;
      core._push(next >>> 8); core._push(next & 255); core._push(core.p | 0x30);
      core.pc = next; core.s = userSp; core.cycles += 7;
      cycles = 7; brk = true;
    } else cycles = core.step();
    state.executed++;
  } catch (error) {
    state.error = String(error.message);
  }
  for (const key of cpuKeys) state.cpu[key] = core[key];
  state.lastCycles = cycles;
  if (advanceTimers) advanceKim1Cycles(state, cycles);
  if (singleStep || brk || state.error) enterMonitor(state, state.error ? 'error' : brk ? 'BRK (independent monitor)' : 'step');
  else refreshKim1Display(state);
  return cycles;
}

function runFromPanel(state, forceStep = false, options = {}) {
  state.error = null;
  restoreRegisters(state);
  state.cpu.pc = state.address;
  state.running = !forceStep && !state.singleStep;
  state.mode = state.running ? 'run' : 'address';
  if (!state.running) stepKim1Machine(state, options);
  refreshKim1Display(state);
}

export function keyKim1Machine(state, key, options = {}) {
  key = String(key).trim().toUpperCase();
  if (['RESET', 'RS'].includes(key)) { resetKim1Machine(state); return true; }
  if (['HALT', 'ST'].includes(key)) { state.error = null; enterMonitor(state, 'ST'); return true; }
  if (key === 'SST') { state.singleStep = !state.singleStep; return true; }
  if (key === 'GO') { runFromPanel(state, false, options); return true; }
  if (state.running) return false;
  if (/^[0-9A-F]$/.test(key)) {
    const digit = parseInt(key, 16);
    if (state.mode === 'data') {
      const old = peekKim1Byte(state, state.address);
      if (old === null) throw new Error('Select writable RAM or an I/O register before entering data.');
      writeKim1Byte(state, state.address, ((old << 4) | digit) & 255, {authored: true});
    } else state.address = ((state.address << 4) | digit) & 65535;
    state.error = null;
  } else if (key === 'AD') state.mode = 'address';
  else if (key === 'DA') state.mode = 'data';
  else if (key === '+') state.address = (state.address + 1) & 65535;
  else if (key === 'PC') { state.address = state.stoppedAddress; state.mode = 'address'; }
  else return false;
  refreshKim1Display(state);
  return true;
}

export function controlKim1Machine(state, verb, value, options = {}) {
  if (verb === 'loadProgram') {
    const fresh = createKim1Machine(value); // complete validation before mutation
    Object.assign(state, fresh);
    cores.delete(state);
    return true;
  }
  if (verb === 'setPc' || verb === 'run') {
    if (value !== undefined && value !== null) {
      if (!addressOK(value)) throw new Error('KIM-1 address must be an integer from 0 through 65535.');
      state.address = value;
    }
    if (verb === 'run') runFromPanel(state, false, options);
    else { state.cpu.pc = state.address; state.error = null; enterMonitor(state, 'setPc'); }
    return true;
  }
  if (verb === 'setSst') {
    if (typeof value !== 'boolean') throw new Error('SST must be true or false.');
    state.singleStep = value; return true;
  }
  if (verb === 'key') return keyKim1Machine(state, value, options);
  if (verb === 'step') { runFromPanel(state, true, options); return true; }
  if (verb === 'halt') return keyKim1Machine(state, 'ST');
  if (verb === 'reset') return keyKim1Machine(state, 'RS');
  return false;
}
