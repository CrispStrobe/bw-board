// SPDX-License-Identifier: MIT
/** Decimal, word-addressed debugging over the shared CARDIAC machine. */
import {createCardiacAdapter} from './cardiac-adapter.js';
import {decodeCardiacWord, formatCardiacWord, onCardiacEvent} from './cardiac-machine.js';

const address = a => Number.isSafeInteger(a) && a >= 0 && a < 100;
const range = (a, n) => Number.isSafeInteger(a) && Number.isSafeInteger(n) && a >= 0 && a <= 100 && n >= 0 && n <= 100 - a;

export function createCardiacDebugTarget(adapterOrOptions = {}, options = {}) {
  const adapter = typeof adapterOrOptions.advanceUntil === 'function' ? adapterOrOptions : createCardiacAdapter(adapterOrOptions);
  let destroyed = false, remaining = null, nextId = 1;
  const breakpoints = new Map(), haltListeners = new Set(), eventListeners = new Set();
  const unsubscribe = onCardiacEvent(adapter.machine, event => {
    for (const listener of [...eventListeners]) listener(event);
  });
  function halt(cause, extra = {}) {
    adapter.control('pause'); remaining = null;
    const why = {pc: adapter.machine.pc, tasks: [], tNs: adapter.timeNs(), skewNs: 0n, cause, ...extra};
    for (const listener of [...haltListeners]) listener(why);
  }
  function terminalReason() {
    const m = adapter.machine;
    if (m.error) return ['fault', {fault: {name: 'CardiacMachineError', message: m.error}}];
    if (m.halted) return ['cardiac-halt', {}];
    if (m.lastBreakpoint !== null) return ['breakpoint', {
      bp: [...breakpoints].find(([, a]) => a === m.lastBreakpoint)?.[0] ?? null,
      bpKind: 'code', cardiacAddress: m.lastBreakpoint
    }];
    if (m.waiting) return ['input-wait', {}];
    return null;
  }
  const target = {
    kind: 'cardiac', adapter,
    get machine() { return adapter.machine; },
    capabilities() {
      return {
        steps: ['insn'], breakpoints: ['code'], timeFreezes: true,
        runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 99,
          stopSides: ['before'], installation: 'sync'}],
        consumes: [], events: ['cardiac.instruction', 'cardiac.input-wait'], recording: [], audio: [],
        spaces: {code: {read: true, write: true, passiveRead: true},
          program: {read: true, write: true, passiveRead: true}},
        fidelity: {instruction: 'unsupported', memory: 'unsupported', cycle: 'unsupported'},
        extensions: {cardiacPanel: true, instructionUnit: 'CARDIAC instruction',
          addressUnit: 'decimal word', wordMin: -999, wordMax: 999, radix: 10,
          model: 'brickwright-cardiac-v1', circuitIO: !!adapter.board,
          checkpointRefusal: ['Machine checkpoints are supported; circuit waveform replay is not qualified.']}
      };
    },
    state: () => destroyed ? 'detached' : adapter.machine.running ? 'running' : 'halted',
    halted: () => !adapter.machine.running,
    regs() {
      const m = adapter.machine;
      return {pc: m.pc, acc: m.acc, ir: m.ir, steps: m.steps, waiting: m.waiting, halted: m.halted, status: m.status};
    },
    position: () => [],
    timeNs: () => adapter.timeNs(),
    snapshot: () => adapter.snapshot(),
    control(verb, value) {
      if (destroyed) return false;
      if (['loadProgram', 'reset', 'restore', 'step', 'pause', 'halt', 'setPc'].includes(verb)) remaining = null;
      return adapter.control(verb, value);
    },
    loadProgram: image => target.control('loadProgram', image),
    onHalt(listener) {
      if (typeof listener !== 'function') throw new TypeError('CARDIAC halt listener must be a function.');
      if (!destroyed) haltListeners.add(listener);
      return () => haltListeners.delete(listener);
    },
    onEvent(listener) {
      if (typeof listener !== 'function') throw new TypeError('CARDIAC event listener must be a function.');
      if (!destroyed) eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    run() {
      if (destroyed) return {refused: 'CARDIAC debug target has been destroyed.'};
      remaining = null;
      if (!adapter.control('run')) return {refused: 'CARDIAC could not start.'};
    },
    halt() { if (!destroyed) halt('user'); },
    reset() { if (!destroyed) { remaining = null; adapter.reset(); } },
    step(kind, count = 1) {
      if (destroyed) return {unsupported: 'CARDIAC debug target has been destroyed.'};
      if (kind !== 'insn') return {unsupported: 'CARDIAC steps use insn: one decimal instruction.'};
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) return {unsupported: 'CARDIAC instruction count must be 1..1000000.'};
      // Arm only. DebugSession receives completion while pumping, not here.
      if (!adapter.control('run', {ignoreBreakpoint: true})) return {unsupported: 'CARDIAC could not start.'};
      remaining = count;
    },
    runFor(budgetNs) {
      if (destroyed || !adapter.machine.running) return 'idle';
      if (typeof budgetNs !== 'number' || !Number.isFinite(budgetNs) || budgetNs < 0) throw new RangeError('CARDIAC run budget must be finite nonnegative nanoseconds.');
      if (budgetNs === 0) return 'budget';
      const deadline = adapter.timeNs() + BigInt(Math.floor(Math.min(budgetNs, 100000000)));
      let batches = 0;
      while (adapter.machine.running && adapter.timeNs() < deadline && batches++ < 10000) {
        try {
          const before = terminalReason();
          if (before) { halt(...before); return 'halted'; }
          const result = adapter.advanceUntil(deadline);
          if (remaining !== null) remaining -= result.executed;
          const reason = terminalReason();
          if (reason) { halt(...reason); return 'halted'; }
          if (remaining !== null && remaining <= 0) { halt('step'); return 'halted'; }
        } catch (error) {
          halt('fault', {fault: {name: error.name, message: error.message}});
          return 'halted';
        }
      }
      return 'budget';
    },
    setBreakpoint(spec) {
      if (destroyed || spec?.kind !== 'code' || !address(spec.addr) ||
          (spec.space !== undefined && spec.space !== 'code' && spec.space !== 'program') ||
          (spec.stopSide !== undefined && spec.stopSide !== 'before')) {
        return {unsupported: 'CARDIAC code breakpoints use decimal word addresses 00..99 before execution.'};
      }
      const id = nextId++;
      adapter.control('setBreakpoint', spec.addr); breakpoints.set(id, spec.addr);
      return id;
    },
    clearBreakpoint(id) {
      const a = breakpoints.get(id); breakpoints.delete(id);
      if (a !== undefined && ![...breakpoints.values()].includes(a)) adapter.control('clearBreakpoint', a);
    },
    disasm(addr) {
      if (!address(addr)) return {unsupported: 'CARDIAC addresses are decimal integers 00..99.'};
      const decoded = decodeCardiacWord(adapter.machine.memory[addr]);
      const operand = decoded.opcode === 4 ? `${decoded.left} ${decoded.right}` : decoded.operand === null ? '' : String(decoded.operand).padStart(2, '0');
      return {addr, address: addr, length: 1, word: decoded.word, words: [decoded.word],
        mnemonic: decoded.mnemonic, operand, text: `${decoded.mnemonic}${operand ? ' ' + operand : ''}`,
        formattedWord: formatCardiacWord(decoded.word), addressUnit: 'decimal word',
        ...([3, 8, 9].includes(decoded.opcode) ? {target: decoded.operand} : {})};
    },
    nextCodeAddress(addr, length = 1) {
      if (!address(addr) || !Number.isSafeInteger(length) || length < 0) return {unsupported: 'CARDIAC address/word length is invalid.'};
      return (addr + length) % 100;
    },
    readMem(space, addr, length) {
      if (!['code', 'program'].includes(space) || !range(addr, length)) return {unsupported: 'CARDIAC memory reads use 100 signed decimal words.'};
      return Int16Array.from(adapter.machine.memory.slice(addr, addr + length));
    },
    writeMem(space, addr, data) {
      if (destroyed || adapter.machine.running) return {refused: 'Pause CARDIAC before editing memory.'};
      if (!['code', 'program'].includes(space) || !(Array.isArray(data) || data instanceof Int16Array) || !range(addr, data.length) ||
          Array.from(data).some(v => !Number.isSafeInteger(v) || v < -999 || v > 999) ||
          (addr === 0 && data.length && data[0] !== 1)) return {refused: 'CARDIAC edits require signed decimal words; cell 00 is fixed at 001.'};
      // Validate the complete edit before applying any word.
      for (let i = 0; i < data.length; i++) adapter.control('writeWord', {address: addr + i, value: data[i]});
    },
    destroy() {
      if (destroyed) return;
      adapter.destroy(); destroyed = true; remaining = null;
      unsubscribe(); haltListeners.clear(); eventListeners.clear(); breakpoints.clear();
    }
  };
  return target;
}
