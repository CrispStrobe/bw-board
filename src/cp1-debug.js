// SPDX-License-Identifier: MIT
/** CP1 debugger over the shared machine. No CP1 instruction interpreter lives here. */
import { disasmMCS48 } from './mcs48-disasm.js';

const address = (value, limit) => Number.isSafeInteger(value) && value >= 0 && value < limit;
const range = (addr, length, limit) => limit > 0 && Number.isSafeInteger(addr) &&
  Number.isSafeInteger(length) && addr >= 0 && addr <= limit && length >= 0 && length <= limit - addr;

export function createCp1DebugTarget(adapter) {
  const machine = adapter.machine;
  const cpu = machine.cpu;
  let running = false;
  let remaining = null;
  let destroyed = false;
  let nextId = 1;
  let skipBreakpoint = null;
  let haltedPc = null;
  const breakpoints = new Map();
  const listeners = new Set();
  const timeNs = () => adapter.timeNs?.() ?? BigInt(Math.round(machine.tMs * 1e6));
  function halt(info) {
    haltedPc = cpu.pc;
    running = false;
    remaining = null;
    const why = {pc: cpu.pc, tasks: [], tNs: timeNs(), skewNs: 0n, ...info};
    for (const listener of [...listeners]) listener(why);
  }
  const target = {
    kind: 'cp1', adapter, machine,
    capabilities() {
      return {
        steps: ['insn'], breakpoints: ['code'], timeFreezes: true,
        runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0x7ff,
          stopSides: ['before'], installation: 'sync'}],
        consumes: [], events: [], recording: [], audio: [],
        spaces: {
          code: {read: true, write: false, passiveRead: true},
          idata: {read: true, write: false, passiveRead: true},
          program: {read: true, write: true, passiveRead: true}
        },
        fidelity: {instruction: 'unsupported', memory: 'unsupported', cycle: 'unsupported'},
        extensions: {
          cp1Panel: true,
          instructionUnit: '8049 instruction',
          cp1Step: 'Use the original STEP key; semantic CP1 breakpoints require a qualified ROM profile.',
          checkpointRefusal: ['Machine snapshots are available; debugger event replay is not qualified.']
        }
      };
    },
    state: () => destroyed ? 'detached' : running ? 'running' : 'halted',
    regs: () => ({pc: cpu.pc, a: cpu.a, psw: cpu.psw, p1: cpu.p1, p2: cpu.p2, cycles: cpu.cycles,
      timer: cpu.timer, f1: cpu.f1, bank: cpu.registerBank, sp: cpu.stackPointer,
      r: Array.from({length: 8}, (_, index) => cpu.getRegister(index))}),
    position: () => [],
    timeNs,
    snapshot: () => machine.snapshot(),
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
    setBreakpoint(spec) {
      if (destroyed) return {unsupported: 'CP1 debug target has been destroyed'};
      if (spec?.kind !== 'code' || !address(spec.addr, 0x800) ||
          (spec.space !== undefined && spec.space !== 'code') ||
          (spec.stopSide !== undefined && spec.stopSide !== 'before')) {
        return {unsupported: 'CP1 supports 8049 code breakpoints at ROM addresses 0..2047'};
      }
      const id = nextId++;
      breakpoints.set(id, spec.addr);
      return id;
    },
    clearBreakpoint(id) { breakpoints.delete(id); },
    run() {
      if (destroyed) return {refused: 'CP1 debug target has been destroyed'};
      skipBreakpoint = haltedPc === cpu.pc ? haltedPc : null;
      haltedPc = null;
      running = true;
      remaining = null;
    },
    halt() { machine.releaseKeys(); if (running) halt({cause: 'user'}); },
    reset() {
      if (destroyed) return {refused: 'CP1 debug target has been destroyed'};
      running = false;
      remaining = null;
      skipBreakpoint = null;
      haltedPc = null;
      machine.releaseKeys();
      if (adapter.reset) adapter.reset(); else machine.reset();
    },
    step(kind, count = 1) {
      if (destroyed) return {unsupported: 'CP1 debug target has been destroyed'};
      if (kind !== 'insn') return {unsupported: 'Step 8049 instructions with insn; use the CP1 STEP key for a CP1 program step'};
      if (!Number.isSafeInteger(count) || count < 1 || count > 1000000) {
        return {unsupported: 'instruction count must be an integer in 1..1000000'};
      }
      remaining = count;
      skipBreakpoint = cpu.pc;
      haltedPc = null;
      running = true;
    },
    runFor(budgetNs) {
      if (!running || destroyed) return 'idle';
      if (typeof budgetNs !== 'number' || !Number.isFinite(budgetNs) || budgetNs < 0) {
        throw new RangeError('CP1 run budget must be a finite nonnegative number of nanoseconds');
      }
      // Bound one call. The DebugSession owns pacing and can request another slice.
      const deadline = machine.tMs + Math.min(budgetNs / 1e6, 100);
      while (machine.tMs < deadline) {
        if (skipBreakpoint !== cpu.pc) {
          for (const [id, pc] of breakpoints) {
            if (pc === cpu.pc) { halt({cause: 'breakpoint', bp: id, bpKind: 'code'}); return 'halted'; }
          }
        }
        skipBreakpoint = null;
        try {
          // The adapter is the board-time boundary, including instructions with no I/O.
          if (adapter.step) adapter.step(); else machine.step();
        } catch (error) {
          halt({cause: 'fault', fault: {name: error.name, message: error.message,
            ...(error.address === undefined ? {} : {address: error.address}),
            ...(error.opcode === undefined ? {} : {opcode: error.opcode})}});
          return 'halted';
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
      machine.releaseKeys();
      listeners.clear();
      breakpoints.clear();
      adapter.detachBoard?.();
    }
  };
  return target;
}
