// SPDX-License-Identifier: MIT
/** CP1 debugger over the shared machine. No CP1 instruction interpreter lives here. */
import { disasmMCS48 } from './mcs48-disasm.js';
import { createCp1SemanticObserver } from './cp1-semantics.js';

const address = (value, limit) => Number.isSafeInteger(value) && value >= 0 && value < limit;
const range = (addr, length, limit) => limit > 0 && Number.isSafeInteger(addr) &&
  Number.isSafeInteger(length) && addr >= 0 && addr <= limit && length >= 0 && length <= limit - addr;

export function createCp1DebugTarget(adapter, options = {}) {
  const machine = adapter.machine;
  const cpu = machine.cpu;
  let running = false;
  let remaining = null;
  let destroyed = false;
  let nextId = 1;
  let skipBreakpoint = null;
  let haltedPc = null;
  let skipCp1Breakpoint = null;
  let haltedCp1Boundary = null;
  let cp1Step = null;
  const breakpoints = new Map();
  const cp1Breakpoints = new Map();
  const listeners = new Set();
  const eventListeners = new Set();
  const eventsThisStep = [];
  const semantic = createCp1SemanticObserver(machine, {profiles: options.semanticProfiles});
  const maxCp1Instructions = options.maxCp1Instructions ?? 1000000;
  if (!Number.isSafeInteger(maxCp1Instructions) || maxCp1Instructions < 1 || maxCp1Instructions > 10000000) {
    semantic.destroy();
    throw new RangeError('CP1 semantic instruction budget must be an integer in 1..10000000');
  }
  const timeNs = () => adapter.timeNs?.() ?? BigInt(Math.round(machine.tMs * 1e6));
  const stepSummary = () => cp1Step ? {...cp1Step,
    cycles: cp1Step.endCycles === null ? machine.cycles - cp1Step.startCycles : cp1Step.endCycles - cp1Step.startCycles} : null;
  const semanticState = () => ({...semantic.snapshot(), step: stepSummary()});
  const cancelCp1Step = reason => {
    if (cp1Step?.status === 'pending') {
      cp1Step.status = 'cancelled'; cp1Step.reason = reason; cp1Step.endCycles = machine.cycles;
    }
  };
  const unsubscribeEvents = semantic.onEvent(event => {
    eventsThisStep.push(event);
    if (eventsThisStep.length > 4) eventsThisStep.shift();
    for (const listener of [...eventListeners]) listener(event);
  });
  function halt(info) {
    haltedPc = cpu.pc;
    const state = semantic.controlState();
    haltedCp1Boundary = state.atCommandBoundary ? state.boundaryId : null;
    running = false;
    remaining = null;
    const why = {pc: cpu.pc, tasks: [], tNs: timeNs(), skewNs: 0n,
      ...(state.available ? {cp1: semanticState()} : {}), ...info};
    for (const listener of [...listeners]) listener(why);
  }
  function finishCp1Step(reason) {
    cp1Step.status = reason === 'complete' ? 'complete' : reason.endsWith('budget') ? 'limit' : 'stopped';
    cp1Step.reason = reason;
    cp1Step.endCycles = machine.cycles;
    halt({cause: reason === 'complete' ? 'step' : reason.endsWith('budget') ? 'step-limit' : `cp1-${reason}`,
      stepKind: 'cp1', cp1Step: stepSummary()});
  }
  const target = {
    kind: 'cp1', adapter, machine,
    capabilities() {
      const qualified = semantic.controlState().available;
      return {
        steps: qualified ? ['insn', 'cp1'] : ['insn'], breakpoints: qualified ? ['code', 'cp1'] : ['code'], timeFreezes: true,
        runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0x7ff,
          stopSides: ['before'], installation: 'sync'}],
        consumes: [], events: qualified ? ['cp1.command', 'cp1.halt', 'cp1.error'] : [], recording: [], audio: [],
        spaces: {
          code: {read: true, write: false, passiveRead: true},
          idata: {read: true, write: false, passiveRead: true},
          program: {read: true, write: true, passiveRead: true}
        },
        fidelity: {instruction: 'unsupported', memory: 'unsupported', cycle: 'unsupported'},
        extensions: {
          cp1Panel: true,
          instructionUnit: '8049 instruction',
          cp1Step: qualified
            ? 'Completes observed CP1 commands on the same CPU; monitor-idle uses the original STEP or RUN key.'
            : 'Use the original STEP key; semantic CP1 breakpoints require a qualified ROM profile.',
          cp1Semantic: {available: qualified, maxInstructions: maxCp1Instructions,
            stepKind: 'cp1', breakpointKind: 'cp1', breakpointSpace: 'program',
            addressUnit: 'cell', addressMin: 0, addressMax: machine.capacity - 1},
          checkpointRefusal: ['Machine snapshots are available; debugger event replay is not qualified.']
        }
      };
    },
    state: () => destroyed ? 'detached' : running ? 'running' : 'halted',
    regs: () => ({pc: cpu.pc, a: cpu.a, psw: cpu.psw, p1: cpu.p1, p2: cpu.p2, cycles: cpu.cycles,
      timer: cpu.timer, f1: cpu.f1, bank: cpu.registerBank, sp: cpu.stackPointer,
      r: Array.from({length: 8}, (_, index) => cpu.getRegister(index)), cp1: semanticState()}),
    position: () => [],
    timeNs,
    snapshot: () => ({...machine.snapshot(), cp1: semanticState()}),
    semanticState,
    disasm(addr) {
      if (!address(addr, 0x800)) return {unsupported: '8049 code addresses must be integers in 0..2047'};
      return disasmMCS48(cpu.rom, addr, {memoryBank: cpu.memoryBank, interruptInProgress: cpu.interruptInProgress});
    },
    nextCodeAddress(addr, length) {
      if (!address(addr, 0x800) || !Number.isSafeInteger(length) || length < 0) {
        return {unsupported: '8049 code addresses must be integers in 0..2047'};
      }
      return (addr + length) & 0x7ff;
    },
    onHalt(listener) {
      if (typeof listener !== 'function') throw new TypeError('Halt listener must be a function');
      if (!destroyed) listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onEvent(listener) {
      if (typeof listener !== 'function') throw new TypeError('CP1 event listener must be a function');
      if (!destroyed) eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    setBreakpoint(spec) {
      if (destroyed) return {unsupported: 'CP1 debug target has been destroyed'};
      if (spec?.kind === 'cp1') {
        if (!semantic.controlState().available) return {unsupported: 'CP1 command breakpoints require a qualified exact-ROM profile'};
        if (!address(spec.addr, machine.capacity) ||
            (spec.space !== undefined && spec.space !== 'program') ||
            (spec.stopSide !== undefined && spec.stopSide !== 'before')) {
          return {unsupported: `CP1 breakpoints use installed program-cell addresses 0..${machine.capacity - 1}, before execution`};
        }
        const id = nextId++;
        cp1Breakpoints.set(id, spec.addr);
        return id;
      }
      if (spec?.kind !== 'code' || !address(spec.addr, 0x800) ||
          (spec.space !== undefined && spec.space !== 'code') ||
          (spec.stopSide !== undefined && spec.stopSide !== 'before')) {
        return {unsupported: 'CP1 supports 8049 code breakpoints at ROM addresses 0..2047'};
      }
      const id = nextId++;
      breakpoints.set(id, spec.addr);
      return id;
    },
    clearBreakpoint(id) { breakpoints.delete(id); cp1Breakpoints.delete(id); },
    run() {
      if (destroyed) return {refused: 'CP1 debug target has been destroyed'};
      skipBreakpoint = haltedPc === cpu.pc ? haltedPc : null;
      const state = semantic.controlState();
      skipCp1Breakpoint = state.atCommandBoundary && state.boundaryId === haltedCp1Boundary ? haltedCp1Boundary : null;
      haltedPc = null;
      haltedCp1Boundary = null;
      cancelCp1Step('run');
      running = true;
      remaining = null;
    },
    halt() { machine.releaseKeys(); cancelCp1Step('user'); if (running) halt({cause: 'user'}); },
    reset() {
      if (destroyed) return {refused: 'CP1 debug target has been destroyed'};
      running = false;
      remaining = null;
      skipBreakpoint = null;
      haltedPc = null;
      skipCp1Breakpoint = haltedCp1Boundary = null;
      cp1Step = null;
      machine.releaseKeys();
      if (adapter.reset) adapter.reset(); else machine.reset();
    },
    step(kind, count = 1, stepOptions = {}) {
      if (destroyed) return {unsupported: 'CP1 debug target has been destroyed'};
      if (kind !== 'insn' && kind !== 'cp1') return {unsupported: 'Step 8049 instructions with insn or qualified CP1 commands with cp1'};
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) {
        return {unsupported: 'instruction count must be an integer in 1..1000000'};
      }
      const state = semantic.controlState();
      if (kind === 'cp1') {
        if (!state.available) return {unsupported: 'CP1 command stepping requires a qualified exact-ROM profile; use the original STEP key'};
        if (state.execution === 'halted' || state.execution === 'error') {
          return {unsupported: 'CP1 is in its monitor. Use the original STEP key, or set a CP1 breakpoint and press RUN before command stepping.'};
        }
        const budget = stepOptions?.maxInstructions ?? maxCp1Instructions;
        if (!Number.isSafeInteger(budget) || budget < 1 || budget > 10000000) {
          return {unsupported: 'CP1 semantic instruction budget must be an integer in 1..10000000'};
        }
        cp1Step = {status: 'pending', reason: null, requested: count, completed: 0,
          instructions: 0, cpuSteps: 0, interrupts: 0, maxInstructions: budget,
          startCycles: machine.cycles, endCycles: null, epoch: state.epoch};
        remaining = null;
      } else { cancelCp1Step('instruction-step'); remaining = count; }
      skipBreakpoint = cpu.pc;
      skipCp1Breakpoint = state.atCommandBoundary ? state.boundaryId : null;
      haltedPc = null;
      haltedCp1Boundary = null;
      running = true;
    },
    runFor(budgetNs) {
      if (!running || destroyed) return 'idle';
      if (typeof budgetNs !== 'number' || !Number.isFinite(budgetNs) || budgetNs < 0) {
        throw new RangeError('CP1 run budget must be a finite nonnegative number of nanoseconds');
      }
      // Bound one call. The DebugSession owns pacing and can request another slice.
      const deadline = machine.tMs + Math.min(budgetNs / 1e6, 100);
      let sliceSteps = 0;
      while (running && machine.tMs < deadline && sliceSteps < machine.maxInstructionsPerAdvance) {
        const semanticControl = semantic.controlState();
        if (cp1Step?.status === 'pending' && (!semanticControl.available || semanticControl.epoch !== cp1Step.epoch)) {
          finishCp1Step(semanticControl.available ? 'state-changed' : 'profile-changed'); return 'halted';
        }
        if (semanticControl.available && semanticControl.atCommandBoundary && semanticControl.boundaryId !== skipCp1Breakpoint) {
          for (const [id, pc] of cp1Breakpoints) {
            if (pc === semanticControl.pc) {
              cancelCp1Step('breakpoint');
              halt({cause: 'breakpoint', bp: id, bpKind: 'cp1', cp1Pc: pc}); return 'halted';
            }
          }
        }
        if (skipBreakpoint !== cpu.pc) {
          for (const [id, pc] of breakpoints) {
            if (pc === cpu.pc) { cancelCp1Step('breakpoint'); halt({cause: 'breakpoint', bp: id, bpKind: 'code'}); return 'halted'; }
          }
        }
        skipBreakpoint = null;
        eventsThisStep.length = 0;
        try {
          // The adapter is the board-time boundary, including instructions with no I/O.
          if (adapter.step) adapter.step(); else machine.step();
        } catch (error) {
          cancelCp1Step('fault');
          halt({cause: 'fault', fault: {name: error.name, message: error.message,
            ...(error.address === undefined ? {} : {address: error.address}),
            ...(error.opcode === undefined ? {} : {opcode: error.opcode})}});
          return 'halted';
        }
        sliceSteps++;
        if (!running) return 'halted';
        if (cp1Step?.status === 'pending') {
          cp1Step.cpuSteps++;
          if (cpu.lastStep?.kind === 'interrupt') cp1Step.interrupts++; else cp1Step.instructions++;
          for (const event of eventsThisStep) if (event.kind === 'command') cp1Step.completed++;
          const terminal = eventsThisStep.find(event => event.kind === 'error' || event.kind === 'halt');
          if (terminal) { finishCp1Step(terminal.kind); return 'halted'; }
          if (cp1Step.completed >= cp1Step.requested) { finishCp1Step('complete'); return 'halted'; }
          if (cp1Step.instructions >= cp1Step.maxInstructions || cp1Step.cpuSteps >= cp1Step.maxInstructions * 2 + 1) {
            finishCp1Step('instruction-budget'); return 'halted';
          }
        }
        // An accepted interrupt consumes two cycles but has not retired an opcode.
        if (remaining !== null && cpu.lastStep?.kind !== 'interrupt' && --remaining === 0) {
          halt({cause: 'step'}); return 'halted';
        }
      }
      return 'budget';
    },
    readMem(space, addr, len) {
      const limit = space === 'code' ? 2048 : space === 'idata' ? 128 :
        space === 'program' ? (machine.expansion ? 512 : 256) : 0;
      if (!range(addr, len, limit)) {
        return {unsupported: `invalid CP1 ${space} memory range`};
      }
      if (space === 'code') return cpu.rom.slice(addr, addr + len);
      if (space === 'idata') return cpu.ram.slice(addr, addr + len);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        const offset = addr + i;
        const cell = machine.readCell(offset >>> 1);
        bytes[i] = offset & 1 ? cell.operand : cell.opcode;
      }
      return bytes;
    },
    writeMem(space, addr, data) {
      const limit = machine.expansion ? 512 : 256;
      if (destroyed) return {refused: 'CP1 debug target has been destroyed'};
      if (running) return {refused: 'pause the emulator before editing CP1 program memory'};
      if (space !== 'program' || !(data instanceof Uint8Array) || !range(addr, data.length, limit)) {
        return {refused: 'only in-range CP1 program bytes can be edited'};
      }
      if (!data.length) return;
      // Build complete cells first, preserving untouched halves of odd byte ranges.
      // loadProgram validates the whole batch before it changes either 8155 RAM.
      const start = addr >>> 1;
      const end = Math.ceil((addr + data.length) / 2);
      const cells = Array.from({length: end - start}, (_, i) => ({...machine.readCell(start + i)}));
      for (let i = 0; i < data.length; i++) {
        const offset = addr + i;
        const cell = cells[(offset >>> 1) - start];
        if (offset & 1) cell.operand = data[i]; else cell.opcode = data[i];
      }
      machine.loadProgram(cells, {start});
    },
    setKey(key, down, contact = 0) {
      if (destroyed) return {refused: 'CP1 debug target has been destroyed'};
      machine.setKey(key, down, contact);
    },
    releaseKeys() { machine.releaseKeys(); },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      running = false;
      remaining = null;
      skipBreakpoint = haltedPc = null;
      skipCp1Breakpoint = haltedCp1Boundary = null;
      cancelCp1Step('destroyed');
      machine.releaseKeys();
      listeners.clear();
      eventListeners.clear();
      breakpoints.clear();
      cp1Breakpoints.clear();
      unsubscribeEvents();
      semantic.destroy();
      adapter.detachBoard?.();
    }
  };
  return target;
}
