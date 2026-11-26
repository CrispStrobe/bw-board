// SPDX-License-Identifier: MIT
/**
 * Independently authored CARDIAC instruction model. Decimal words are not bytes.
 * See docs/CARDIAC.md for the original sources and the explicit v1 conventions.
 * Plain state plus explicit steps: no DOM, timers, circuit solver or dependencies.
 */

export const CARDIAC_MODEL = 'brickwright-cardiac-v1';
export const CARDIAC_MEMORY_SIZE = 100;
export const CARDIAC_IO_LIMIT = 10000;
export const CARDIAC_OPCODES = Object.freeze([
  'INP', 'CLA', 'ADD', 'TAC', 'SFT', 'OUT', 'STO', 'SUB', 'JMP', 'HRS'
]);

const listeners = new WeakMap();
const integer = (v, min, max) => Number.isSafeInteger(v) && v >= min && v <= max;
const clone = value => value === null ? null : JSON.parse(JSON.stringify(value));
const signedRemainder = (v, base) => v % base || 0; // canonicalise negative zero
const addressText = address => String(address).padStart(2, '0');

function requireAddress(value) {
  if (!integer(value, 0, 99)) throw new RangeError('CARDIAC addresses are decimal integers from 00 to 99.');
  return value;
}

function requireWord(value) {
  if (!integer(value, -999, 999)) throw new RangeError('CARDIAC words and input cards must be integers from -999 to 999.');
  return value || 0;
}

function requireBudget(value) {
  if (!integer(value, 0, 1000000)) throw new RangeError('CARDIAC instruction budget must be an integer from 0 to 1000000.');
  return value;
}

export function formatCardiacWord(value, digits = 3) {
  if (digits !== 3 && digits !== 4) throw new RangeError('CARDIAC display width is three digits, or four for the accumulator.');
  if (!integer(value, digits === 4 ? -9999 : -999, digits === 4 ? 9999 : 999)) {
    throw new RangeError('Value does not fit the requested CARDIAC word.');
  }
  return `${value < 0 ? '-' : ''}${String(Math.abs(value)).padStart(digits, '0')}`;
}

/** Validate an entire image before changing a machine. Unassigned cells are zero. */
export function parseCardiacProgram(source = {words: [], entry: 0}) {
  let words, entry;
  if (typeof source === 'string') {
    words = [];
    let next = 1;
    source.split(/\r?\n/).forEach((raw, line) => {
      const text = raw.replace(/(?:;|#|\/\/).*$/, '').trim();
      if (!text) return;
      const start = text.match(/^@\s*(\d{1,2})$/);
      if (start) { entry = Number(start[1]); return; }
      const row = text.match(/^(?:(\d{1,2})\s*:\s*)?([+-]?\d{1,3})$/);
      if (!row) throw new SyntaxError(`Line ${line + 1}: use a decimal word, NN: word, or @entry. Assemble mnemonics first.`);
      const address = row[1] === undefined ? next : Number(row[1]);
      words.push({address, value: Number(row[2])});
      next = address + 1;
    });
  } else if (Array.isArray(source)) {
    words = source.map((item, index) => typeof item === 'number' ? {address: index + 1, value: item} : item);
  } else if (source && typeof source === 'object') {
    words = source.words;
    entry = source.entry;
  } else throw new TypeError('A CARDIAC program is {words: [{address, value}], entry}.');
  if (!Array.isArray(words) || words.length > 100) throw new RangeError('A CARDIAC image contains at most 100 addressed words.');
  const assigned = new Set();
  const checked = words.map(item => {
    if (!item || typeof item !== 'object') throw new TypeError('Each CARDIAC program word needs an address and value.');
    const address = requireAddress(item.address), value = requireWord(item.value);
    if (assigned.has(address)) throw new Error(`CARDIAC address ${addressText(address)} is assigned twice.`);
    if (address === 0 && value !== 1) throw new Error('CARDIAC cell 00 is fixed at 001.');
    assigned.add(address);
    return {address, value};
  });
  entry = requireAddress(entry ?? checked[0]?.address ?? 0);
  checked.sort((a, b) => a.address - b.address);
  return {words: checked, entry};
}

export function formatCardiacProgram(source) {
  const program = parseCardiacProgram(source);
  return [`@${addressText(program.entry)}`, ...program.words.map(({address, value}) =>
    `${addressText(address)}: ${formatCardiacWord(value)}`)].join('\n');
}

export function decodeCardiacWord(word) {
  requireWord(word);
  if (word < 0) return {word, opcode: null, mnemonic: 'SKIP', operand: null};
  const opcode = Math.floor(word / 100), operand = word % 100;
  return {word, opcode, mnemonic: CARDIAC_OPCODES[opcode], operand,
    ...(opcode === 4 ? {left: Math.floor(operand / 10), right: operand % 10} : {})};
}

function memoryFor(program) {
  const memory = Array(100).fill(0);
  memory[0] = 1;
  memory[99] = 800;
  for (const {address, value} of program.words) memory[address] = value;
  return memory;
}

function refresh(machine) {
  machine.status = machine.error ? 'error' : machine.waiting ? 'waiting-input' : machine.halted ? 'halted' :
    machine.lastBreakpoint !== null ? 'breakpoint' : machine.running ? 'running' : 'paused';
}

function emit(machine, event) {
  for (const listener of listeners.get(machine) ?? []) listener(clone(event));
}

export function onCardiacEvent(machine, listener) {
  if (typeof listener !== 'function') throw new TypeError('A CARDIAC event listener must be a function.');
  if (!listeners.has(machine)) listeners.set(machine, new Set());
  listeners.get(machine).add(listener);
  return () => listeners.get(machine)?.delete(listener);
}

export function createCardiacMachine(source = {words: [], entry: 0}) {
  const program = parseCardiacProgram(source);
  return {
    model: CARDIAC_MODEL, program, memory: memoryFor(program),
    pc: program.entry, acc: 0, ir: null, steps: 0,
    running: false, waiting: false, halted: false, status: 'paused', error: null,
    inputQueue: [], inputSources: [], output: [], lastOutput: null,
    breakpoints: [], lastBreakpoint: null, breakpointResume: null,
    lastEvent: null, lastInstruction: null
  };
}

/** No queued card is consumed unless an INP completes. The append is atomic. */
export function enqueueCardiacInput(machine, value, {source = 'manual'} = {}) {
  if (source !== 'manual' && source !== 'circuit') throw new Error('CARDIAC input source must be manual or circuit.');
  const cards = (Array.isArray(value) ? value : [value]).map(requireWord);
  if (machine.inputQueue.length + cards.length > CARDIAC_IO_LIMIT) throw new RangeError(`CARDIAC input is limited to ${CARDIAC_IO_LIMIT} queued cards.`);
  machine.inputQueue.push(...cards);
  machine.inputSources.push(...cards.map(() => source));
  if (cards.length) machine.waiting = false;
  refresh(machine);
  emit(machine, {type: 'input-queued', cards, source});
  return cards.length;
}

/**
 * Retire one instruction, or return null at a halt, breakpoint, or empty input.
 * An explicit manual step ignores breakpoints; the Board scheduler passes false.
 */
export function stepCardiacMachine(machine, {ignoreBreakpoint = true} = {}) {
  if (machine.halted || machine.error) return null;
  const address = requireAddress(machine.pc);
  if (!integer(machine.acc, -9999, 9999)) throw new RangeError('CARDIAC accumulator must fit four signed decimal digits.');
  if (!integer(machine.steps, 0, Number.MAX_SAFE_INTEGER - 1)) throw new RangeError('CARDIAC instruction count cannot be incremented safely.');
  const decoded = decodeCardiacWord(machine.memory[address]);
  if (!ignoreBreakpoint && machine.breakpoints.includes(address) && machine.breakpointResume !== address) {
    machine.running = false;
    machine.waiting = false;
    machine.lastBreakpoint = address;
    machine.lastEvent = {type: 'breakpoint', address, word: decoded.word, steps: machine.steps};
    refresh(machine); emit(machine, machine.lastEvent);
    return null;
  }
  if (decoded.opcode === 0 && machine.inputQueue.length === 0) {
    const wasWaiting = machine.waiting;
    machine.waiting = true;
    machine.lastEvent = {type: 'input-wait', address, word: decoded.word, mnemonic: 'INP', operand: decoded.operand, steps: machine.steps};
    refresh(machine);
    if (!wasWaiting) emit(machine, machine.lastEvent);
    return null;
  }
  if (decoded.opcode === 5 && machine.output.length >= CARDIAC_IO_LIMIT) {
    machine.error = `Output tray reached ${CARDIAC_IO_LIMIT} cards. Clear the tray to continue; no output was discarded.`;
    machine.running = false;
    refresh(machine); emit(machine, {type: 'error', message: machine.error});
    return null;
  }
  const nextPc = (address + 1) % 100;
  const event = {
    type: 'instruction', address, ...decoded, steps: machine.steps + 1,
    pcBefore: address, pcAfter: nextPc, accBefore: machine.acc, accAfter: machine.acc,
    reads: [], writes: [], input: null, inputSource: null, output: null, branchTaken: null, notes: [],
    events: [{type: 'fetch', address, value: decoded.word}, {type: 'pc', from: address, to: nextPc}]
  };
  const read = a => {
    const value = requireWord(machine.memory[a]);
    event.reads.push({address: a, value}); event.events.push({type: 'memory-read', address: a, value});
    return value;
  };
  const write = (a, value) => {
    if (a === 0) {
      event.notes.push('Cell 00 is fixed at 001; the write is ignored.');
      event.events.push({type: 'write-ignored', address: 0, value});
      return;
    }
    const change = {address: a, before: machine.memory[a], after: value};
    machine.memory[a] = value;
    event.writes.push(change); event.events.push({type: 'memory-write', ...change});
  };
  machine.waiting = false;
  machine.lastBreakpoint = null;
  machine.breakpointResume = null;
  machine.ir = decoded.word;
  machine.pc = nextPc;
  const a = decoded.operand;
  switch (decoded.opcode) {
    case 0: {
      event.input = machine.inputQueue.shift();
      event.inputSource = machine.inputSources.shift() ?? 'manual';
      event.events.push({type: 'input', value: event.input, source: event.inputSource});
      write(a, event.input);
      break;
    }
    case 1: machine.acc = read(a); break;
    case 2: machine.acc = signedRemainder(machine.acc + read(a), 10000); break;
    case 3:
      event.branchTaken = machine.acc < 0;
      if (event.branchTaken) machine.pc = a;
      event.events.push({type: 'branch', taken: event.branchTaken, target: a});
      break;
    case 4: {
      // At most 9999 * 10^9: exact integer arithmetic within JS's safe range.
      const shifted = signedRemainder(machine.acc * 10 ** decoded.left, 10000);
      machine.acc = Math.trunc(shifted / 10 ** decoded.right) || 0;
      event.events.push({type: 'decimal-shift', left: decoded.left, right: decoded.right, intermediate: shifted});
      break;
    }
    case 5:
      event.output = read(a); machine.output.push(event.output); machine.lastOutput = event.output;
      event.events.push({type: 'output', value: event.output});
      break;
    case 6: write(a, signedRemainder(machine.acc, 1000)); break;
    case 7: machine.acc = signedRemainder(machine.acc - read(a), 10000); break;
    case 8:
      write(99, 800 + nextPc);
      machine.pc = a; event.branchTaken = true;
      event.events.push({type: 'branch', taken: true, target: a});
      break;
    case 9:
      machine.pc = a; machine.halted = true; machine.running = false;
      event.events.push({type: 'halt', resetPc: a});
      break;
    default:
      event.notes.push('Negative instruction skipped by the Brickwright CARDIAC v1 compatibility policy.');
      event.events.push({type: 'negative-instruction', value: decoded.word});
  }
  machine.steps++;
  event.pcAfter = machine.pc; event.accAfter = machine.acc;
  if (machine.acc !== event.accBefore) event.events.push({type: 'accumulator', from: event.accBefore, to: machine.acc});
  machine.lastEvent = event; machine.lastInstruction = event;
  refresh(machine); emit(machine, event);
  return event;
}

/** Execute a bounded batch. HRS and an empty reader remain distinct outcomes. */
export function runCardiacMachine(machine, {maxSteps = 1000} = {}) {
  requireBudget(maxSteps);
  const before = machine.steps;
  if (!machine.halted && !machine.error) machine.running = true;
  while (machine.running && machine.steps - before < maxSteps) {
    if (!stepCardiacMachine(machine, {ignoreBreakpoint: false})) break;
  }
  refresh(machine);
  const reason = machine.error ? 'error' : machine.waiting ? 'input' : machine.halted ? 'halted' :
    machine.lastBreakpoint !== null ? 'breakpoint' : 'budget';
  return {reason, executed: machine.steps - before, lastEvent: clone(machine.lastEvent)};
}

export function resetCardiacMachine(machine) {
  const breakpoints = [...machine.breakpoints];
  const fresh = createCardiacMachine(machine.program);
  Object.assign(machine, fresh, {breakpoints});
  emit(machine, {type: 'reset'});
  return machine;
}

/** Detached JSON checkpoint: it includes changed code, queued inputs and outputs. */
export function snapshotCardiacMachine(machine) {
  const keys = Object.keys(createCardiacMachine());
  return clone(Object.fromEntries(keys.map(key => [key, machine[key]])));
}

/** Validate all execution-relevant fields before applying a checkpoint. */
export function restoreCardiacMachine(machine, snapshot) {
  if (!snapshot || snapshot.model !== CARDIAC_MODEL) throw new Error('Unsupported CARDIAC checkpoint model.');
  const next = createCardiacMachine(snapshot.program);
  if (!Array.isArray(snapshot.memory) || snapshot.memory.length !== 100) throw new Error('CARDIAC checkpoint must contain 100 memory words.');
  next.memory = snapshot.memory.map(requireWord);
  if (next.memory[0] !== 1) throw new Error('CARDIAC checkpoint cell 00 must be 001.');
  next.pc = requireAddress(snapshot.pc);
  if (!integer(snapshot.acc, -9999, 9999) || !integer(snapshot.steps, 0, Number.MAX_SAFE_INTEGER)) throw new Error('Invalid CARDIAC checkpoint accumulator or instruction count.');
  next.acc = snapshot.acc || 0; next.steps = snapshot.steps;
  next.ir = snapshot.ir === null ? null : requireWord(snapshot.ir);
  for (const key of ['running', 'waiting', 'halted']) {
    if (typeof snapshot[key] !== 'boolean') throw new Error(`Invalid CARDIAC checkpoint ${key}.`);
    next[key] = snapshot[key];
  }
  if (next.halted && (next.running || next.waiting)) throw new Error('A halted CARDIAC checkpoint cannot also be running or waiting.');
  for (const key of ['inputQueue', 'output']) {
    if (!Array.isArray(snapshot[key]) || snapshot[key].length > CARDIAC_IO_LIMIT) throw new Error(`Invalid CARDIAC checkpoint ${key}.`);
    next[key] = snapshot[key].map(requireWord);
  }
  if (!Array.isArray(snapshot.inputSources) || snapshot.inputSources.length !== next.inputQueue.length ||
      snapshot.inputSources.some(v => v !== 'manual' && v !== 'circuit')) throw new Error('Invalid CARDIAC input provenance.');
  next.inputSources = [...snapshot.inputSources];
  next.lastOutput = snapshot.lastOutput === null ? null : requireWord(snapshot.lastOutput);
  if (next.waiting && next.inputQueue.length) throw new Error('A waiting CARDIAC checkpoint cannot already contain input cards.');
  if (!Array.isArray(snapshot.breakpoints) || snapshot.breakpoints.length > 100) throw new Error('Invalid CARDIAC breakpoints.');
  next.breakpoints = [...new Set(snapshot.breakpoints.map(requireAddress))].sort((a, b) => a - b);
  for (const key of ['lastBreakpoint', 'breakpointResume']) next[key] = snapshot[key] === null ? null : requireAddress(snapshot[key]);
  if (snapshot.error !== null && typeof snapshot.error !== 'string') throw new Error('Invalid CARDIAC error field.');
  next.error = snapshot.error;
  if (next.error && next.running) throw new Error('A CARDIAC checkpoint with an error cannot be running.');
  next.lastEvent = clone(snapshot.lastEvent);
  next.lastInstruction = clone(snapshot.lastInstruction);
  refresh(next);
  Object.assign(machine, next);
  emit(machine, {type: 'restored'});
  return machine;
}

/** Shared intent boundary for standalone UI, debugger and Board device. */
export function controlCardiacMachine(machine, verb, value) {
  switch (verb) {
    case 'loadProgram': {
      const fresh = createCardiacMachine(value); // atomic validation before mutation
      Object.assign(machine, fresh);
      emit(machine, {type: 'program-loaded', program: clone(fresh.program)});
      break;
    }
    case 'enqueueInput': enqueueCardiacInput(machine, value); break;
    case 'run':
      if (machine.error) throw new Error(machine.error);
      machine.breakpointResume = value?.ignoreBreakpoint || machine.lastBreakpoint === machine.pc ? machine.pc : null;
      machine.lastBreakpoint = null; machine.halted = false; machine.running = true;
      break;
    case 'pause': case 'halt': machine.running = false; break;
    case 'step':
      machine.running = false; machine.halted = false;
      stepCardiacMachine(machine, {ignoreBreakpoint: true});
      break;
    case 'reset': resetCardiacMachine(machine); break;
    case 'setPc':
      requireAddress(value);
      machine.pc = value; machine.running = false; machine.halted = false; machine.waiting = false;
      machine.lastBreakpoint = machine.breakpointResume = null;
      break;
    case 'writeWord': {
      const address = requireAddress(value?.address), word = requireWord(value?.value);
      if (machine.running) throw new Error('Pause CARDIAC before editing live memory.');
      if (address === 0 && word !== 1) throw new Error('CARDIAC cell 00 is fixed at 001.');
      machine.memory[address] = word;
      machine.waiting = false;
      emit(machine, {type: 'memory-edited', address, value: word});
      break;
    }
    case 'setAccumulator':
      if (machine.running) throw new Error('Pause CARDIAC before editing the accumulator.');
      if (!integer(value, -9999, 9999)) throw new RangeError('CARDIAC accumulator is -9999..9999.');
      machine.acc = value || 0;
      break;
    case 'setBreakpoint': case 'clearBreakpoint': case 'toggleBreakpoint': {
      const address = requireAddress(typeof value === 'object' ? value?.address : value);
      const enabled = verb === 'clearBreakpoint' ? false : verb === 'toggleBreakpoint' ? !machine.breakpoints.includes(address) :
        typeof value === 'object' ? value.enabled !== false : true;
      machine.breakpoints = machine.breakpoints.filter(a => a !== address);
      if (enabled) machine.breakpoints.push(address);
      machine.breakpoints.sort((a, b) => a - b);
      break;
    }
    case 'clearOutput': machine.output = []; machine.error = null; break;
    case 'restore': restoreCardiacMachine(machine, value); break;
    default: return false;
  }
  refresh(machine);
  return true;
}
