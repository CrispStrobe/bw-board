// SPDX-License-Identifier: MIT
/**
 * Original behavioral implementation of the documented Microtronic learner ISA.
 * This is NOT a TMS1600 emulator or a reconstruction of Busch's monitor ROM.
 * Source: Busch 2090 manual, printed pp. 43 and 72–76. See
 * docs/MICROTRONIC.md for attribution, simulator choices and unsupported PGMs.
 * The state is plain data. Circuit-file persistence stores the user program;
 * resumable execution checkpoints are outside this first integration.
 */

const HEX = '0123456789ABCDEF';
const byte = value => Number.isInteger(value) && value >= 0 && value <= 255;
const hex2 = value => value.toString(16).toUpperCase().padStart(2, '0');
const hex3 = value => value.toString(16).toUpperCase().padStart(3, '0');

export const MICROTRONIC_DEMOS = Object.freeze({
  counter: Object.freeze({name: 'Output counter', program: '100\nFE0\n510\nC01'}),
  echo: Object.freeze({name: 'Input to output', program: 'FD0\nFE0\nC00'})
});

/** Parse atomically; absent locations contain HALT, never accidental code. */
export function parseMicrotronicProgram(source) {
  const program = Array(256).fill(0xF00);
  if (Array.isArray(source)) {
    if (!source.length || source.length > 256) throw new Error('Use 1–256 Microtronic words.');
    source.forEach((word, address) => {
      const value = typeof word === 'string' && /^[0-9a-f]{3}$/i.test(word) ? parseInt(word, 16) : word;
      if (!Number.isInteger(value) || value < 0 || value > 0xFFF) {
        throw new Error(`Invalid 12-bit word at ${hex2(address)}.`);
      }
      program[address] = value;
    });
    return program;
  }
  if (typeof source !== 'string') throw new Error('Program must contain three-digit hexadecimal words.');
  let address = 0;
  const assigned = new Set();
  source.split(/\r?\n/).forEach((raw, line) => {
    let text = raw.replace(/[;#].*$/, '').trim();
    if (!text) return;
    const label = text.match(/^([0-9a-f]{1,2})\s*:\s*/i);
    if (label) {
      address = parseInt(label[1], 16);
      text = text.slice(label[0].length).trim();
    }
    if (!text) return;
    for (const word of text.split(/\s+/)) {
      if (!/^[0-9a-f]{3}$/i.test(word)) throw new Error(`Line ${line + 1}: "${word}" is not a three-digit hexadecimal word.`);
      if (address > 255) throw new Error('The Microtronic has 256 program addresses (00–FF).');
      if (assigned.has(address)) throw new Error(`Program address ${hex2(address)} is assigned twice.`);
      assigned.add(address);
      program[address++] = parseInt(word, 16);
    }
  });
  if (!assigned.size) throw new Error('Enter at least one three-digit hexadecimal word.');
  return program;
}

export function formatMicrotronicProgram(program) {
  let end = 255;
  while (end > 0 && program[end] === 0xF00) end--;
  return program.slice(0, end + 1).map((word, address) => `${hex2(address)}: ${hex3(word)}`).join('\n');
}

export function createMicrotronicMachine(source = 'F00') {
  const program = parseMicrotronicProgram(source);
  const state = {
    model: 'documented-behavior', program, programSource: formatMicrotronicProgram(program),
    registers: Array(16).fill(0), storage: Array(16).fill(0),
    pc: 0, input: 0, output: 0, carry: false, zero: true,
    running: false, error: null, waitingForKey: null, returnAddress: null,
    display: '00 F00', displaySpec: null, mode: 'halt', entry: '', registerIndex: 0,
    breakpoint: null, breakpointResume: false, lastBreakpoint: null,
    timeSeconds: 0, timeRunning: false, clockInputHigh: false,
    randomCounter: 0x209, executed: 0, addressEntryArmed: true, clearPressCount: 0
  };
  refreshMicrotronicDisplay(state);
  return state;
}

/** Reset controls/registers/time while retaining all 256 user words. */
export function resetMicrotronicMachine(state) {
  const program = state.program;
  const fresh = createMicrotronicMachine(program);
  for (const [key, value] of Object.entries(fresh)) state[key] = value;
  refreshMicrotronicDisplay(state);
}

function result(state, index, value, carry) {
  state.registers[index] = value & 15;
  state.zero = state.registers[index] === 0;
  if (carry !== undefined) state.carry = !!carry;
}

function fail(state, message) {
  state.error = message;
  state.running = false;
  state.waitingForKey = null;
  state.mode = 'halt';
}

function decimalValue(registers, count) {
  let value = 0;
  for (let i = count - 1; i >= 0; i--) {
    if (registers[i] > 9) return null;
    value = value * 10 + registers[i];
  }
  return value;
}

function decimalResult(registers, count, value) {
  for (let i = 0; i < count; i++) {
    registers[i] = value % 10;
    value = Math.floor(value / 10);
  }
}

function arithmeticError(state) {
  state.registers.fill(14, 0, 6);
  state.carry = true;
  state.zero = false;
}

function special(state, low) {
  const r = state.registers, s = state.storage;
  switch (low) {
    case 0x01: break; // NOP
    case 0x02: state.displaySpec = {blank: true}; break;
    case 0x03: { // HXDZ: D is the least significant digit.
      const value = r[13] + 16 * r[14] + 256 * r[15];
      const decimal = value > 999 ? 0 : value;
      r[13] = decimal % 10; r[14] = Math.floor(decimal / 10) % 10; r[15] = Math.floor(decimal / 100);
      state.carry = false; state.zero = value > 999;
      break;
    }
    case 0x04: {
      if (r.slice(13).some(value => value > 9)) {
        fail(state, 'DZHX requires decimal digits 0–9; undocumented invalid-digit conversion is not modeled.');
        break;
      }
      const value = r[13] + 10 * r[14] + 100 * r[15];
      r[13] = value & 15; r[14] = (value >>> 4) & 15; r[15] = (value >>> 8) & 15;
      state.carry = false; state.zero = false;
      break;
    }
    case 0x05: // A deterministic teaching PRNG, not the original free-running counter.
      state.randomCounter = (state.randomCounter * 109 + 89) & 0xFFF;
      r[13] = state.randomCounter & 15; r[14] = (state.randomCounter >>> 4) & 15; r[15] = state.randomCounter >>> 8;
      break;
    case 0x06: {
      const sec = state.timeSeconds % 60;
      const min = Math.floor(state.timeSeconds / 60) % 60;
      const hour = Math.floor(state.timeSeconds / 3600);
      r[10] = sec % 10; r[11] = Math.floor(sec / 10);
      r[12] = min % 10; r[13] = Math.floor(min / 10);
      r[14] = hour % 10; r[15] = Math.floor(hour / 10);
      break;
    }
    case 0x07:
      if (state.returnAddress === null) fail(state, 'RET has no CALL return address.');
      else state.pc = state.returnAddress;
      break;
    case 0x08: r.fill(0); state.carry = false; state.zero = true; break;
    case 0x09: state.carry = true; break;
    case 0x0A: state.carry = false; break;
    case 0x0B: {
      const a = decimalValue(r, 6), b = decimalValue(s, 6);
      if (a === null || b === null || a * b > 999999) arithmeticError(state);
      else { decimalResult(r, 6, a * b); state.carry = false; state.zero = false; }
      break;
    }
    case 0x0C: {
      const divisor = decimalValue(r, 4), dividend = decimalValue(s, 4);
      if (!divisor || !dividend || r[4] || r[5] || s[4] || s[5]) arithmeticError(state);
      else {
        decimalResult(r, 4, Math.floor(dividend / divisor));
        decimalResult(s, 4, dividend % divisor);
        state.carry = false; state.zero = dividend % divisor !== 0;
      }
      break;
    }
    case 0x0D: for (let i = 0; i < 8; i++) [r[i], s[i]] = [s[i], r[i]]; break;
    case 0x0E: for (let i = 8; i < 16; i++) [r[i], s[i]] = [s[i], r[i]]; break;
    case 0x0F: for (let i = 0; i < 8; i++) [r[i], r[i + 8]] = [r[i + 8], r[i]]; break;
    default: fail(state, `Unsupported Microtronic instruction F${hex2(low)}.`);
  }
}

/** Execute one documented word. Continuous HALT holds its address; STEP advances it. */
export function stepMicrotronicMachine(state, {singleStep = true} = {}) {
  if (state.waitingForKey !== null || state.error) return false;
  if (!singleStep && state.breakpoint === state.pc && !state.breakpointResume) {
    state.running = false; state.mode = 'halt'; state.lastBreakpoint = state.pc;
    refreshMicrotronicDisplay(state);
    return false;
  }
  state.breakpointResume = false;
  const address = state.pc, word = state.program[address];
  const op = word >>> 8, source = (word >>> 4) & 15, dest = word & 15, low = word & 255;
  const r = state.registers;
  state.pc = (address + 1) & 255;
  state.executed++;
  switch (op) {
    case 0x0: result(state, dest, r[source]); break;
    case 0x1: result(state, dest, source); break;
    case 0x2: result(state, dest, r[dest] & r[source], false); break;
    case 0x3: result(state, dest, r[dest] & source, false); break;
    case 0x4: { const value = r[dest] + r[source]; result(state, dest, value, value > 15); break; }
    case 0x5: { const value = r[dest] + source; result(state, dest, value, value > 15); break; }
    case 0x6: { const value = r[dest] - r[source]; result(state, dest, value, value < 0); break; }
    case 0x7: { const value = r[dest] - source; result(state, dest, value, value < 0); break; }
    case 0x8: state.carry = r[source] < r[dest]; state.zero = r[source] === r[dest]; break;
    case 0x9: state.carry = source < r[dest]; state.zero = source === r[dest]; break;
    case 0xA: result(state, dest, r[dest] | r[source], false); break;
    case 0xB: state.returnAddress = state.pc; state.pc = low; break;
    case 0xC: state.pc = low; break;
    case 0xD: if (state.carry) state.pc = low; break;
    case 0xE: if (state.zero) state.pc = low; break;
    case 0xF:
      if (source === 0 && dest === 0) {
        state.running = false; state.mode = 'halt';
        if (!singleStep) state.pc = address;
      } else if (source === 0) special(state, low);
      else if (source <= 6) state.displaySpec = {count: source, start: dest};
      else if (source === 7) state.storage[dest] = r[dest];
      else if (source === 8) result(state, dest, ~r[dest], false);
      else if (source === 9) { const old = r[dest]; result(state, dest, old >>> 1, old & 1); }
      else if (source === 10) { const old = r[dest]; result(state, dest, old << 1, old & 8); }
      else if (source === 11) { const value = r[dest] + Number(state.carry); result(state, dest, value, value > 15); }
      else if (source === 12) { const value = r[dest] - Number(state.carry); result(state, dest, value, value < 0); }
      else if (source === 13) result(state, dest, state.input, false);
      else if (source === 14) { state.output = r[dest]; state.carry = false; state.zero = state.output === 0; }
      else { state.waitingForKey = dest; state.pc = address; }
      break;
    default: fail(state, `Invalid Microtronic instruction ${hex3(word)}.`);
  }
  if (singleStep) { state.running = false; state.mode = 'halt'; }
  refreshMicrotronicDisplay(state);
  return true;
}

/** Input 4 receives the time signal only through the actual drawn circuit. */
export function observeMicrotronicInputs(state, input) {
  state.input = input & 15;
  const high = !!(state.input & 8);
  if (high && !state.clockInputHigh && state.timeRunning) state.timeSeconds = (state.timeSeconds + 1) % 86400;
  state.clockInputHigh = high;
  refreshMicrotronicDisplay(state);
}

export function refreshMicrotronicDisplay(state) {
  if (state.mode === 'clock') {
    const hh = String(Math.floor(state.timeSeconds / 3600)).padStart(2, '0');
    const mm = String(Math.floor(state.timeSeconds / 60) % 60).padStart(2, '0');
    const ss = String(state.timeSeconds % 60).padStart(2, '0');
    state.display = hh + mm + ss;
  } else if (state.mode === 'time-entry') state.display = state.entry.padEnd(4, '-') + '00';
  else if (state.mode === 'register') state.display = `r${HEX[state.registerIndex]}   ${HEX[state.registers[state.registerIndex]]}`;
  else if (['address', 'breakpoint', 'register-select', 'pgm'].includes(state.mode)) state.display = state.entry.padEnd(6, '-');
  else if (state.mode === 'program') state.display = `${hex2(state.pc)} ${state.entry.padEnd(3, '-')}`;
  else if (state.running && state.displaySpec) {
    state.display = state.displaySpec.blank ? '      ' : Array.from({length: state.displaySpec.count}, (_, i) =>
      HEX[state.registers[(state.displaySpec.start + state.displaySpec.count - i - 1) & 15]]).join('').padStart(6, ' ');
  } else state.display = `${hex2(state.pc)} ${hex3(state.program[state.pc])}`;
  return state.display;
}

function commitProgramEdit(state) {
  if (state.entry.length !== 3) throw new Error('Enter three hexadecimal digits before NEXT.');
  state.program[state.pc] = parseInt(state.entry, 16);
  state.programSource = formatMicrotronicProgram(state.program);
  state.pc = (state.pc + 1) & 255;
  state.entry = '';
  state.mode = 'halt';
  state.addressEntryArmed = false;
}

/** Front-panel intent. Each supplied hex key is one new keypress, never a held key. */
export function keyMicrotronicMachine(state, key) {
  key = String(key).trim().toUpperCase();
  if (key === 'STP') key = 'STEP';
  if (key === 'C/CE' || key === 'CE') key = 'CCE';
  const clearedWord = state.clearPressCount >= 2;
  if (key !== 'CCE') state.clearPressCount = 0;
  if (/^[0-9A-F]$/.test(key)) {
    const value = parseInt(key, 16);
    if (state.waitingForKey !== null) {
      result(state, state.waitingForKey, value, false);
      state.waitingForKey = null; state.pc = (state.pc + 1) & 255;
    } else if (state.running) return false;
    else if (state.mode === 'address' || state.mode === 'breakpoint') {
      state.entry += key;
      if (state.entry.length === 2) {
        if (state.mode === 'address') { state.pc = parseInt(state.entry, 16); state.addressEntryArmed = false; }
        else state.breakpoint = parseInt(state.entry, 16) || null;
        state.entry = ''; state.mode = 'halt';
      }
    } else if (state.mode === 'register-select') {
      state.registerIndex = value; state.mode = 'register';
    } else if (state.mode === 'register') state.registers[state.registerIndex] = value;
    else if (state.mode === 'pgm') {
      state.entry = '';
      if (value === 3) state.mode = 'time-entry';
      else if (value === 4) state.mode = 'clock';
      else if (value === 5 || value === 6) {
        state.program.fill(value === 5 ? 0x000 : 0xF01);
        state.programSource = formatMicrotronicProgram(state.program);
        state.pc = 0; state.mode = 'halt';
      } else fail(state, `PGM ${key} is not implemented in this behavioral model. Use an authored program instead.`);
    } else if (state.mode === 'time-entry') {
      if (value > 9) throw new Error('Enter decimal hours and minutes (HHMM).');
      const entry = state.entry + key;
      if (entry.length === 4) {
        const h = Number(entry.slice(0, 2)), m = Number(entry.slice(2));
        if (h > 23 || m > 59) throw new Error('Time must be from 00:00 through 23:59.');
        state.timeSeconds = h * 3600 + m * 60; state.timeRunning = true;
        state.mode = 'clock'; state.entry = '';
      } else state.entry = entry;
    } else {
      if (state.mode !== 'program' || clearedWord) state.entry = '';
      if (state.entry.length >= 3) throw new Error('Press NEXT to store this word, or C/CE to correct it.');
      state.mode = 'program'; state.entry += key;
    }
    refreshMicrotronicDisplay(state);
    return true;
  }
  switch (key) {
    case 'RESET': resetMicrotronicMachine(state); break;
    case 'HALT': state.running = false; state.waitingForKey = null; state.mode = 'halt'; state.entry = ''; state.error = null; state.addressEntryArmed = true; break;
    case 'RUN':
      if (state.error) throw new Error(state.error);
      state.breakpointResume = state.lastBreakpoint === state.pc;
      state.lastBreakpoint = null; state.running = true; state.mode = 'run'; state.entry = '';
      break;
    case 'STEP': state.running = false; state.mode = 'halt'; stepMicrotronicMachine(state); break;
    case 'NEXT':
      if (state.running) return false;
      if (state.mode === 'program') commitProgramEdit(state);
      else if (state.addressEntryArmed) { state.mode = 'address'; state.entry = ''; }
      else state.pc = (state.pc + 1) & 255;
      break;
    case 'REG': case 'BKP': case 'PGM':
      if (state.running) return false;
      state.mode = key === 'REG' ? 'register-select' : key === 'BKP' ? 'breakpoint' : 'pgm'; state.entry = '';
      break;
    case 'CCE':
      if (state.running) return false;
      state.clearPressCount++;
      if (state.mode === 'program' && state.entry && state.clearPressCount === 1) state.entry = state.entry.slice(0, -1);
      else state.entry = state.mode === 'program' ? '000' : '';
      break;
    default: return false;
  }
  refreshMicrotronicDisplay(state);
  return true;
}

export function controlMicrotronicMachine(state, verb, value) {
  switch (verb) {
    case 'loadProgram': {
      const parsed = parseMicrotronicProgram(value); // validate before changing anything
      Object.assign(state, createMicrotronicMachine(parsed));
      refreshMicrotronicDisplay(state);
      return true;
    }
    case 'setPc':
      if (!byte(value)) throw new Error('Program address must be an integer from 0 through 255.');
      state.pc = value; state.running = false; state.waitingForKey = null; state.mode = 'halt'; state.error = null; state.addressEntryArmed = false;
      refreshMicrotronicDisplay(state); return true;
    case 'run':
      if (value !== undefined && value !== null) {
        if (!byte(value)) throw new Error('Run address must be an integer from 0 through 255.');
        state.pc = value; state.waitingForKey = null;
      }
      return keyMicrotronicMachine(state, 'RUN');
    case 'halt': return keyMicrotronicMachine(state, 'HALT');
    case 'step': return keyMicrotronicMachine(state, 'STEP');
    case 'reset': return keyMicrotronicMachine(state, 'RESET');
    case 'key': return keyMicrotronicMachine(state, value);
    default: return false;
  }
}
