// SPDX-License-Identifier: MIT
/**
 * Independent KIM-1 teaching monitor and unexpanded machine. No original ROM,
 * translated monitor listing, or third-party KIM emulator is included.
 * CPU execution is NMOS 6502; monitor keys are higher-level simulator actions.
 * See docs/KIM1.md for the supported map, clock, and compatibility boundary.
 */
import {NMOS6502} from './nmos6502.js';
import {readKim1Records} from './kim1-tape.js';
import {createBrickwrightKim1Roms} from './kim1-rom.generated.js';
import {createKim1FrontPanel, queueKim1FrontKey, setKim1Tty, sendKim1Tty,
  stepKim1FrontPanel, pollKim1Tty, kim1FrontSegments, kim1FrontText} from './kim1-peripherals.js';

const hex = (n, width) => n.toString(16).toUpperCase().padStart(width, '0');
const addressOK = n => Number.isInteger(n) && n >= 0 && n <= 65535;
const cores = new WeakMap();
const hardwareInstructions = new WeakMap();
const nextBusCycle = Symbol();
const cpuKeys = ['a', 'x', 'y', 's', 'p', 'pc', 'cycles'];
export const KIM1_DEFAULT_PROGRAM = '0200: EA 4C 00 02';
export const KIM1_DEMOS = Object.freeze({
  counter: Object.freeze({name: 'Output counter', program: '0200: A9 FF 8D 01 17 A9 00 8D 00 17 EE 00 17 4C 0A 02'}),
  echo: Object.freeze({name: 'Input to output', program: '0200: A9 FF 8D 01 17 A9 00 8D 03 17 AD 02 17 29 BF 8D\n0210: 00 17 4C 0A 02'})
});

export function kim1CanonicalAddress(address) { return address & 0x1fff; }
const isRam = a => a < 0x400 || (a >= 0x1780 && a < 0x1800);

const expandedRam = a => (a >= 0x400 && a < 0x1700) || (a >= 0x2000 && a < 0xfffa);
const expandedHeader = '; KIM-1 expanded RAM';
const entryHeader = '; KIM-1 entry ';
const mappedAddress = (address, expanded) => expanded && address < 0xfffa ? address : kim1CanonicalAddress(address);

/** Addressed hex, MOS paper tape, or Intel HEX. Validate the entire image before loading. */
export function parseKim1Program(source) {
  if (typeof source !== 'string') throw new Error('Use addressed hexadecimal bytes, for example 0200: A9 01.');
  const imported = readKim1Records(source);
  const image = {};
  const expanded = imported ? imported.records.some(({address, bytes}) =>
    bytes.some((_, offset) => expandedRam(address + offset))) : source.split(/\r?\n/).some(line => line.trim() === expandedHeader);
  const put = (address, value, line) => {
    if (!addressOK(address)) throw new Error(`Line ${line}: program exceeds the 16-bit address space.`);
    const canonical = mappedAddress(address, expanded);
    if (!isRam(canonical) && !(expanded && expandedRam(canonical))) throw new Error(`Line ${line}: $${hex(address, 4)} is not writable KIM-1 RAM.`);
    if (Object.hasOwn(image, canonical)) throw new Error(`Line ${line}: RAM $${hex(canonical, 4)} is assigned twice (including aliases).`);
    image[canonical] = value;
  };
  let entry = imported?.entry;
  if (imported) {
    for (const {address, bytes, line} of imported.records) bytes.forEach((byte, offset) => put(address + offset, byte, line));
  } else {
    for (const [line, raw] of source.split(/\r?\n/).entries()) {
      if (raw.trim().startsWith(entryHeader)) {
        const value = raw.trim().slice(entryHeader.length);
        if (!/^[0-9a-f]{4}$/i.test(value) || entry !== undefined) throw new Error(`Line ${line + 1}: invalid or duplicate entry address.`);
        entry = parseInt(value, 16);
      }
      const text = raw.replace(/[;#].*$/, '').trim();
      if (!text) continue;
      const match = /^([0-9a-f]{4}):\s*(.+)$/i.exec(text);
      if (!match) throw new Error(`Line ${line + 1}: expected AAAA: BB CC (four-digit address, two-digit bytes).`);
      let address = parseInt(match[1], 16);
      for (const token of match[2].trim().split(/\s+/)) {
        if (!/^[0-9a-f]{2}$/i.test(token)) throw new Error(`Line ${line + 1}: "${token}" is not a two-digit hexadecimal byte.`);
        put(address++, parseInt(token, 16), line + 1);
      }
    }
  }
  const addresses = Object.keys(image).map(Number).sort((a, b) => a - b);
  if (!addresses.length) throw new Error('Enter at least one addressed hexadecimal byte.');
  if (entry !== undefined && (!addressOK(entry) || !Object.hasOwn(image, mappedAddress(entry, expanded)))) {
    throw new Error('The program entry address does not identify a loaded byte.');
  }
  return {image, start: entry ?? addresses[0], expanded};
}

export function formatKim1Program(value) {
  const image = value.image ?? value;
  const addresses = Object.keys(image).map(Number).sort((a, b) => a - b);
  const lines = [];
  if (value.expanded) lines.push(expandedHeader);
  if (value.start !== undefined && value.start !== addresses[0]) lines.push(entryHeader + hex(value.start, 4));
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
  const a = mappedAddress(address, state.expansion);
  if (a < 0x400) return state.ram[a];
  if (state.expansion && expandedRam(a)) return state.expansion[a];
  if (a >= 0x1780 && a < 0x1800) return state.riotRam[a - 0x1780];
  if (a >= 0x1700 && a < 0x1780) return readRegister(state.riots[a >= 0x1740 ? 1 : 0], a & 15, acknowledge);
  if (state.roms && a >= 0x1800) return state.roms[a >= 0x1c00 ? 1 : 0][a & 1023];
  return null;
}

export function peekKim1Byte(state, address) { return accessRead(state, address, false); }
export function readKim1Byte(state, address, {strict = true} = {}) {
  const value = accessRead(state, address, true);
  if (value !== null || !strict) return value;
  const a = mappedAddress(address, state.expansion);
  throw new Error(a >= 0x1800 ? `Original KIM-1 ROM at $${hex(address & 65535, 4)} is unavailable; ROM monitor routines are not emulated.` :
    `Unmapped KIM-1 read at $${hex(address & 65535, 4)}; expansion memory is not installed.`);
}

export function writeKim1Byte(state, address, value, {authored = false} = {}) {
  const a = mappedAddress(address, state.expansion);
  value &= 255;
  if (a < 0x400) state.ram[a] = value;
  else if (state.expansion && expandedRam(a)) state.expansion[a] = value;
  else if (a >= 0x1780 && a < 0x1800) state.riotRam[a - 0x1780] = value;
  else if (a >= 0x1700 && a < 0x1780) writeRegister(state.riots[a >= 0x1740 ? 1 : 0], a & 15, value);
  else throw new Error(`$${hex(address & 65535, 4)} is not writable ${authored ? 'program RAM' : 'KIM-1 memory'}.`);
  if (authored && (isRam(a) || (state.expansion && expandedRam(a)))) {
    state.image[a] = value;
    state.programSource = formatKim1Program({image: state.image, start: state.startAddress, expanded: !!state.expansion});
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

function syncCpu(state, core) {
  for (const key of cpuKeys) state.cpu[key] = core[key];
}

function physicalRead(state, address) {
  const a = mappedAddress(address, state.expansion);
  if (a >= 0x1740 && a < 0x1780 && (a & 7) === 0) pollKim1Tty(state.frontPanel, state.riots[1]);
  const value = readKim1Byte(state, address, {strict: false});
  if (value !== null) state.busLatch = value;
  return state.busLatch;
}

function physicalWrite(state, address, value) {
  const a = mappedAddress(address, state.expansion);
  state.busLatch = value;
  if (a < 0x400 || (state.expansion && expandedRam(a)) || (a >= 0x1700 && a < 0x1800)) {
    writeKim1Byte(state, address, value);
  }
}

function coreFor(state) {
  let core = cores.get(state);
  if (!core) {
    core = new NMOS6502({
      read: a => state.roms ? physicalRead(state, a) : readKim1Byte(state, a),
      dummyRead: a => state.roms ? physicalRead(state, a) : readKim1Byte(state, a, {strict: false}) ?? 0xff,
      write: (a, v) => state.roms ? physicalWrite(state, a, v) : writeKim1Byte(state, a, v)
    });
    cores.set(state, core);
  }
  for (const key of cpuKeys) core[key] = state.cpu[key];
  return core;
}

export function createKim1Machine(source = KIM1_DEFAULT_PROGRAM) {
  const parsed = parseKim1Program(source);
  const state = {
    model: 'independent-monitor-nmos6502', roms: null, romSource: null, frontPanel: null, segments: null, ttyOutput: '', busLatch: 255,
    pendingNmi: false, pendingReset: false, ram: new Uint8Array(1024), riotRam: new Uint8Array(128),
    expansion: parsed.expanded ? new Uint8Array(65536) : null,
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
  if (state.roms) {
    const tty = state.frontPanel.tty, baud = 1_000_000 / state.frontPanel.bitCycles;
    hardwareInstructions.delete(state);
    state.frontPanel = createKim1FrontPanel();
    setKim1Tty(state.frontPanel, {enabled: tty, baud});
    if (tty) sendKim1Tty(state.frontPanel, '\x7f');
    state.busLatch = 255;
    state.running = state.pendingReset = true;
    state.pendingNmi = false; state.error = null;
    state.lastStop = 'reset'; state.executed = state.lastCycles = 0;
    refreshKim1Display(state);
    return;
  }
  state.address = state.stoppedAddress = state.startAddress;
  state.running = false; state.error = null; state.mode = 'address';
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
  if (state.roms) {
    state.segments = kim1FrontSegments(state.frontPanel);
    state.ttyOutput = state.frontPanel.received;
    state.display = kim1FrontText(state.segments);
    return state.display;
  }
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

export function mountKim1Roms(state, images, romSource = 'imported') {
  if (!Array.isArray(images) || images.length !== 2 || images.some(image =>
    !(image instanceof Uint8Array) || image.length !== 1024)) {
    throw new Error('Supply the 1,024-byte 6530-003 and 6530-002 ROM images, in that order.');
  }
  state.roms = images.map(image => new Uint8Array(image));
  state.romSource = romSource;
  state.frontPanel = createKim1FrontPanel();
  resetKim1Machine(state);
}

function stepRomInstruction(state, core) {
  if (state.pendingReset) {
    state.pendingReset = false;
    core.reset();
    return 7;
  }
  if (state.pendingNmi) {
    state.pendingNmi = false;
    core.nmi();
    return 7;
  }
  const oldPc = mappedAddress(core.pc, state.expansion);
  const opcode = peekKim1Byte(state, core.pc);
  const cycles = core.step();
  if (state.singleStep && (oldPc < 0x1800 || oldPc >= 0x2000) && opcode !== 0) state.pendingNmi = true;
  return cycles;
}

export function clockKim1Hardware(state) {
  if (!state.roms || state.error || !state.running) return;
  const core = coreFor(state);
  let instruction = hardwareInstructions.get(state);
  if (!instruction) {
    const operation = state.pendingReset ? 'reset' : state.pendingNmi ? 'nmi' : 'step';
    if (operation === 'reset') state.pendingReset = false;
    if (operation === 'nmi') state.pendingNmi = false;
    instruction = {operation, reads: [], count: 0, pc: core.pc, opcode: peekKim1Byte(state, core.pc)};
    hardwareInstructions.set(state, instruction);
  }
  stepKim1FrontPanel(state.frontPanel, state.riots[1], 1);
  let cycle = 0;
  const read = core.read, dummyRead = core.dummyRead, write = core.write;
  const busCycle = (operation, address, byte) => {
    const index = cycle++;
    if (index < instruction.count) return instruction.reads[index];
    if (index > instruction.count) throw nextBusCycle;
    const value = operation(address, byte);
    instruction.reads[index] = value;
    return value;
  };
  core.read = address => busCycle(read, address);
  core.dummyRead = address => busCycle(dummyRead, address);
  core.write = (address, byte) => busCycle(write, address, byte);
  try {
    core[instruction.operation]();
    const elapsed = core.cycles - state.cpu.cycles;
    if (elapsed !== cycle) throw new Error('KIM-1 CPU instruction has an incomplete bus sequence.');
    syncCpu(state, core);
    state.lastCycles = elapsed;
    state.executed++;
    const pc = mappedAddress(instruction.pc, state.expansion);
    if (instruction.operation === 'step' && state.singleStep &&
      (pc < 0x1800 || pc >= 0x2000) && instruction.opcode !== 0) state.pendingNmi = true;
    hardwareInstructions.delete(state);
  } catch (error) {
    if (error === nextBusCycle) instruction.count++;
    else {
      state.error = String(error.message);
      state.running = false;
      hardwareInstructions.delete(state);
    }
  } finally {
    core.read = read; core.dummyRead = dummyRead; core.write = write;
  }
  refreshKim1Display(state);
}

function stepRomWithPeripherals(state, core, advanceTimers) {
  const read = core.read, dummyRead = core.dummyRead, write = core.write;
  const tick = () => {
    if (advanceTimers) for (const riot of state.riots) advanceTimer(riot.timer, 1);
    stepKim1FrontPanel(state.frontPanel, state.riots[1], 1);
  };
  core.read = address => { tick(); return read(address); };
  core.dummyRead = address => { tick(); return dummyRead(address); };
  core.write = (address, byte) => { tick(); write(address, byte); };
  let cycles = 0;
  try {
    cycles = stepRomInstruction(state, core);
    state.executed++;
  } catch (error) {
    state.error = String(error.message); state.running = false;
  } finally {
    core.read = read; core.dummyRead = dummyRead; core.write = write;
  }
  syncCpu(state, core);
  state.lastCycles = cycles;
  refreshKim1Display(state);
  return cycles;
}

/**
 * Execute one instruction. Board drives elapsed timer cycles separately;
 * direct STEP supplies the instruction's cycles to the peripheral clocks.
 */
export function stepKim1Machine(state, {singleStep = true, advanceTimers = true} = {}) {
  if (state.error) return 0;
  const core = coreFor(state);
  if (state.roms) return stepRomWithPeripherals(state, core, advanceTimers);
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
  syncCpu(state, core);
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
  if (state.roms) {
    if (key === 'RESET' || key === 'RS') resetKim1Machine(state);
    else if (key === 'HALT' || key === 'ST') { state.pendingNmi = true; state.running = true; }
    else if (key === 'SST') state.singleStep = !state.singleStep;
    else if (!queueKim1FrontKey(state.frontPanel, key)) return false;
    return true;
  }
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
  if (verb === 'useBrickwrightRom') { mountKim1Roms(state, createBrickwrightKim1Roms(), 'brickwright'); return true; }
  if (verb === 'loadRoms') { mountKim1Roms(state, value); return true; }
  if (verb === 'useTeachingMonitor') {
    hardwareInstructions.delete(state);
    state.roms = state.romSource = state.frontPanel = state.segments = null;
    state.ttyOutput = '';
    resetKim1Machine(state);
    return true;
  }
  if (verb === 'setTty' && state.roms) {
    setKim1Tty(state.frontPanel, value);
    resetKim1Machine(state);
    return true;
  }
  if (verb === 'sendTty' && state.roms) { sendKim1Tty(state.frontPanel, value); return true; }
  if (verb === 'clearTty' && state.roms) { state.frontPanel.received = state.ttyOutput = ''; return true; }
  if (verb === 'loadProgram') {
    const fresh = createKim1Machine(value); // complete validation before mutation
    if (state.roms) {
      // Host tape import installs memory while the monitor and its registers stay live.
      state.expansion ??= fresh.expansion;
      for (const [address, byte] of Object.entries(fresh.image)) writeKim1Byte(state, Number(address), byte);
      state.image = fresh.image;
      state.startAddress = state.address = fresh.startAddress;
      state.programSource = formatKim1Program({image: fresh.image, start: fresh.startAddress, expanded: !!state.expansion});
      refreshKim1Display(state);
      return true;
    }
    fresh.singleStep = state.singleStep; // Loading RAM cannot move the physical SST switch.
    Object.assign(state, fresh);
    cores.delete(state);
    return true;
  }
  if (state.roms && (verb === 'run' || verb === 'step' || verb === 'setPc')) {
    throw new Error('Use the hardware keypad and SST switch while a KIM-1 ROM is mounted.');
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
