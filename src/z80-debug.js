/**
 * Boundary-D debug target for Z80Machine — the Searle-shape breadboard
 * (and the CP/M machine) becomes breakable, steppable, inspectable.
 * Mirrors m6502-debug.js: this module owns the stepping loop with a
 * breakpoint check around each machine.step(). No symbols/yield concept
 * yet — raw Z80 programs (BASIC interpreters, CP/M) are address-level.
 *
 * @module
 */
import { disasmZ80 } from './z80-disasm.js';
import { loadSNA, SNA_SIZE } from './zx-sna.js';

/** @param {{ machine: import('./z80-machine.js').Z80Machine }} adapter */
export function createZ80DebugTarget(adapter) {
  const machine = adapter.machine;
  const cpu = machine.cpu;

  let runState = 'halted';
  let pendingStep = null;
  const haltListeners = [];
  const breakpoints = new Map();
  let nextBpId = 1;
  const halt = (info) => { runState = 'halted'; for (const cb of haltListeners) cb(info); };

  // Write watchpoints trap TRUE writes by wrapping the core's write
  // callback (installed only while a watch exists) — emu8051 parity.
  // The trap sits ABOVE the machine's ROM filter, so a store aimed at
  // ROM still fires: the program wrote, even if memory refused.
  const writeWatches = new Map(); // id → { addr, len }
  let watchHit = null;
  let origWrite = null;
  const syncWriteTrap = () => {
    if (writeWatches.size && !origWrite) {
      origWrite = cpu.write;
      cpu.write = (a, v) => {
        const aa = a & 0xffff;
        for (const [id, w] of writeWatches) {
          if (aa >= w.addr && aa < w.addr + w.len) watchHit = { bp: id, addr: aa, value: v & 0xff };
        }
        return origWrite(a, v);
      };
    } else if (!writeWatches.size && origWrite) {
      cpu.write = origWrite;
      origWrite = null;
    }
  };

  // Call-class opcodes for step-over: CALL nn, CALL cc,nn, and RST n.
  const isCallClass = (op) => op === 0xcd || (op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7;

  return {
    capabilities() {
      return { steps: ['insn', 'over', 'out'], breakpoints: ['code', 'write'], timeFreezes: true, consumes: [] };
    },

    state() { return runState; },

    regs() {
      return {
        pc: cpu.pc, sp: cpu.sp,
        a: cpu.a, f: cpu.f, bc: cpu.bc, de: cpu.de, hl: cpu.hl,
        ix: cpu.ix, iy: cpu.iy, i: cpu.i, r: cpu.r,
        af_: cpu.af_, bc_: cpu.bc_, de_: cpu.de_, hl_: cpu.hl_,
        iff1: cpu.iff1, im: cpu.im, cycles: machine.cycles,
      };
    },

    /** Live disassembly (vector-length-ground; reads machine memory). */
    disasm(addr) {
      return disasmZ80((a) => machine.mem[a & 0xffff], addr & 0xffff);
    },

    onHalt(cb) { haltListeners.push(cb); },

    setBreakpoint(spec) {
      if (spec.kind === 'write') {
        if (spec.addr == null) return { unsupported: 'addr required' };
        const id = nextBpId++;
        writeWatches.set(id, { addr: spec.addr & 0xffff, len: spec.len ?? 1 });
        syncWriteTrap();
        return id;
      }
      if (spec.kind !== 'code') return { unsupported: `unknown breakpoint kind: ${spec.kind}` };
      if (spec.addr == null) return { unsupported: 'addr required' };
      const id = nextBpId++;
      breakpoints.set(id, { kind: 'code', addr: spec.addr & 0xffff });
      return id;
    },

    clearBreakpoint(id) {
      breakpoints.delete(id);
      if (writeWatches.delete(id)) syncWriteTrap();
    },

    run() { runState = 'running'; pendingStep = null; },

    step(kind, count = 1) {
      if (kind === 'insn') {
        runState = 'running';
        pendingStep = { kind: 'insn', remaining: count };
        return undefined;
      }
      if (kind === 'over') {
        // Depth-wait only when the next opcode is call-class; a PUSH
        // must not turn step-over into run-until-someday. A false
        // conditional CALL never deepens, so the depth check falls
        // through to a single-step naturally.
        if (!isCallClass(machine.mem[cpu.pc & 0xffff])) {
          runState = 'running';
          pendingStep = { kind: 'insn', remaining: 1 };
          return undefined;
        }
        runState = 'running';
        pendingStep = { kind: 'over', sp0: cpu.sp, entered: false };
        return undefined;
      }
      if (kind === 'out') {
        runState = 'running';
        pendingStep = { kind: 'out', sp0: cpu.sp };
        return undefined;
      }
      return { unsupported: `step kind '${kind}' not supported` };
    },

    /** Spend up to budgetNs of simulated time. Returns 'halted' or 'budget'. */
    runFor(budgetNs) {
      if (runState !== 'running') return 'halted';
      const deadline = machine.tMs + budgetNs / 1e6;
      while (machine.tMs < deadline) {
        for (const [id, bp] of breakpoints) {
          if (bp.addr === cpu.pc) { halt({ cause: 'breakpoint', bp: id }); return 'halted'; }
        }
        if (pendingStep) {
          if (pendingStep.kind === 'insn' && pendingStep.remaining <= 0) { halt({ cause: 'step' }); return 'halted'; }
          if (pendingStep.kind === 'over' && pendingStep.entered
            && ((cpu.sp - pendingStep.sp0) & 0x8000) === 0) { halt({ cause: 'step' }); return 'halted'; }
          if (pendingStep.kind === 'out'
            && cpu.sp !== pendingStep.sp0 && ((cpu.sp - pendingStep.sp0) & 0x8000) === 0) {
            halt({ cause: 'step' }); return 'halted';
          }
        }
        machine.step();
        if (watchHit) {
          const hit = watchHit;
          watchHit = null;
          halt({ cause: 'watchpoint', ...hit });
          return 'halted';
        }
        if (pendingStep?.kind === 'insn') pendingStep.remaining--;
        if (pendingStep?.kind === 'over') pendingStep.entered = true;
      }
      return runState === 'halted' ? 'halted' : 'budget';
    },

    timeNs() { return BigInt(Math.round(machine.tMs * 1e6)); },

    /**
     * Face-input contract, Spectrum flavor: key NAMES, not a button
     * mask — the ULA scans a real 8x5 matrix and the face's keyboard
     * focus routing passes held key names straight through. Returns
     * false when the machine has no ULA to receive them.
     */
    setKeys(names) {
      if (!machine.ula || typeof machine.ula.setKeys !== 'function') return false;
      machine.ula.setKeys(names);
      return true;
    },

    video() {
      // The ULA is the Spectrum's video chip; otherwise any chip
      // implementing the common videoFrame() contract counts (MC6845
      // and friends arrive on this same surface).
      if (machine.ula && typeof machine.ula.videoFrame === 'function') return machine.ula.videoFrame();
      for (const chip of Object.values(machine.chips || {})) {
        if (typeof chip.videoFrame === 'function') return chip.videoFrame();
      }
      return null;
    },

    /** Audio-face contract: the beeper's current {hz, on}, or null. */
    audio() {
      if (machine.ula && typeof machine.ula.audioTone === 'function') return machine.ula.audioTone();
      return null;
    },

    /** Insert a .TAP for the ROM fast-load trap; false without support. */
    insertTape(tapBuf) {
      if (typeof machine.insertTape !== 'function') return false;
      machine.insertTape(tapBuf);
      return true;
    },

    /** Load a 48K .SNA snapshot — the face's drag-a-snapshot-in path.
     *  Returns false on machines without a ULA (not a Spectrum). */
    loadSnapshot(buf) {
      if (!machine.ula || buf.length < SNA_SIZE) return false;
      loadSNA(machine, buf);
      return true;
    },

    readMem(space, addr, len) {
      if (space !== 'mem') return { unsupported: `no space '${space}' on z80` };
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = machine.mem[(addr + i) & 0xffff];
      return out;
    },

    writeMem(space, addr, data) {
      if (space !== 'mem') return { refused: `no space '${space}' on z80` };
      for (let i = 0; i < data.length; i++) machine.mem[(addr + i) & 0xffff] = data[i] & 0xff;
      return undefined;
    },
  };
}

export default createZ80DebugTarget;
