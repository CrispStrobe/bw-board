/**
 * Boundary-D debug target for M6502Machine — the 6502 breadboard computer
 * becomes a breakable, steppable, inspectable program.
 *
 * Like avr8js-debug.js, this module owns the stepping loop: a breakpoint
 * check wraps each machine.step() call. The adapter provides boundary-A
 * (pin edges), this module provides boundary-D (debugger control).
 *
 * @module
 */

/**
 * @param {import('./m6502-adapter.js').createM6502Adapter} adapter
 * @param {object} [opts]
 * @param {object} [opts.symbols] — { scheduler: { tasks: [...] } }
 */
import { disasm6502 } from './w65c02-disasm.js';

export function createM6502DebugTarget(adapter, opts = {}) {
  const machine = adapter.machine;
  const cpu = machine.cpu;
  const symbols = opts.symbols ?? null;

  let runState = 'halted'; // 'halted' | 'running'
  let pendingStep = null;  // { kind: 'insn'|'block'|'over'|'out', ... }
  const haltListeners = [];
  const breakpoints = new Map();
  let nextBpId = 1;

  function halt(info) {
    runState = 'halted';
    for (const cb of haltListeners) cb(info);
  }

  // Write watchpoints trap TRUE writes (any store to a watched address,
  // same-value included) by wrapping the core's write callback — the
  // same semantics emu8051's _emu_dbg_set_bp_write gives. The wrap is
  // installed only while at least one watch exists, so the fast path
  // stays untouched.
  const writeWatches = new Map(); // id → { addr, len }
  let watchHit = null;
  let origWrite = null;
  function syncWriteTrap() {
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
  }

  return {
    capabilities() {
      return {
        steps: [...(symbols ? ['insn', 'block'] : ['insn']), 'over', 'out'],
        breakpoints: [...(symbols ? ['code', 'yield'] : ['code']), 'write'],
        timeFreezes: true,
        consumes: [],
      };
    },

    state() { return runState; },

    regs() {
      return {
        pc: cpu.pc,
        a: cpu.a,
        x: cpu.x,
        y: cpu.y,
        sp: cpu.s,
        p: cpu.p,
        cycles: machine.cycles,
      };
    },

    /** Live disassembly at addr (vector-length-ground table; reads the
     *  machine's memory, so POKEd code disassembles too). Returns
     *  { text, bytes, length } — parity-plus with emu8051's disasm(). */
    disasm(addr) {
      return disasm6502((a) => machine.mem[a & 0xffff], addr & 0xffff);
    },

    onHalt(cb) { haltListeners.push(cb); },

    setBreakpoint(spec) {
      if (spec.kind === 'code') {
        if (spec.addr == null) return { unsupported: 'addr required' };
        const id = nextBpId++;
        breakpoints.set(id, { kind: 'code', addr: spec.addr });
        return id;
      }
      if (spec.kind === 'yield') {
        if (!symbols) return { unsupported: 'no symbols for yield breakpoints' };
        const task = symbols.scheduler?.tasks?.find(t => t.name === spec.task);
        if (!task) return { unsupported: `unknown task: ${spec.task}` };
        const y = task.yields?.find(yy => yy.state === spec.state);
        if (!y) return { unsupported: `unknown yield state ${spec.state}` };
        const id = nextBpId++;
        breakpoints.set(id, { kind: 'yield', addr: y.addr, task: spec.task, state: spec.state });
        return id;
      }
      if (spec.kind === 'write') {
        if (spec.addr == null) return { unsupported: 'addr required' };
        const id = nextBpId++;
        writeWatches.set(id, { addr: spec.addr & 0xffff, len: spec.len ?? 1 });
        syncWriteTrap();
        return id;
      }
      return { unsupported: `unknown breakpoint kind: ${spec.kind}` };
    },

    clearBreakpoint(id) {
      breakpoints.delete(id);
      if (writeWatches.delete(id)) syncWriteTrap();
    },

    run() { runState = 'running'; pendingStep = null; },

    /** The session's pause verb — same contract as a breakpoint hit. */
    halt() { halt({ cause: 'pause' }); },

    /** Reboot through the reset vector at $FFFC. */
    reset() { pendingStep = null; machine.reset(); runState = 'halted'; },

    halt() { halt({ cause: 'user' }); },

    step(kind, count = 1) {
      if (kind === 'insn') {
        runState = 'running';
        pendingStep = { kind: 'insn', remaining: count };
        return undefined;
      }
      if (kind === 'block') {
        if (!symbols) return { unsupported: 'block step requires symbols' };
        runState = 'running';
        pendingStep = { kind: 'block' };
        return undefined;
      }
      if (kind === 'over') {
        // Depth-wait only when the NEXT opcode is call-class (JSR/BRK);
        // anything else is a plain instruction step — a lone PHA must
        // not turn step-over into run-until-someday.
        const op = machine.mem[cpu.pc & 0xffff];
        if (op !== 0x20 && op !== 0x00) {
          runState = 'running';
          pendingStep = { kind: 'insn', remaining: 1 };
          return undefined;
        }
        runState = 'running';
        pendingStep = { kind: 'over', sp0: cpu.s, entered: false };
        return undefined;
      }
      if (kind === 'out') {
        // Run until the current frame returns: RTS/RTI pops lift the
        // (descending) stack pointer above where it stands now.
        runState = 'running';
        pendingStep = { kind: 'out', sp0: cpu.s };
        return undefined;
      }
      return { unsupported: `step kind '${kind}' not supported` };
    },

    /** Spend up to budgetNs of simulated time. Returns 'halted' or 'budget'. */
    runFor(budgetNs) {
      if (runState !== 'running') return 'halted';
      const budgetMs = budgetNs / 1e6;
      const deadline = machine.tMs + budgetMs;

      while (machine.tMs < deadline) {
        // Check breakpoints BEFORE executing
        for (const [id, bp] of breakpoints) {
          if (bp.addr === cpu.pc) {
            const tasks = this.position();
            halt({ cause: 'breakpoint', bp: id, bpKind: bp.kind, tasks });
            return 'halted';
          }
        }

        // Check pending step completion BEFORE executing
        if (pendingStep) {
          if (pendingStep.kind === 'insn') {
            if (pendingStep.remaining <= 0) {
              halt({ cause: 'step' });
              return 'halted';
            }
          }
          if (pendingStep.kind === 'block') {
            // Check if we're at a yield address
            const pos = this.position();
            if (pos.length > 0 && pendingStep.started) {
              halt({ cause: 'step', tasks: pos });
              return 'halted';
            }
            pendingStep.started = true;
          }
          if (pendingStep.kind === 'over' && pendingStep.entered && cpu.s >= pendingStep.sp0) {
            halt({ cause: 'step' });
            return 'halted';
          }
          if (pendingStep.kind === 'out' && cpu.s > pendingStep.sp0) {
            halt({ cause: 'step' });
            return 'halted';
          }
        }

        const n = machine.step();
        if (n === 0) {
          // STP — machine stopped
          halt({ cause: 'stopped' });
          return 'halted';
        }

        if (watchHit) {
          const hit = watchHit;
          watchHit = null;
          halt({ cause: 'watchpoint', ...hit });
          return 'halted';
        }

        if (pendingStep?.kind === 'insn') {
          pendingStep.remaining--;
        }
        if (pendingStep?.kind === 'over') pendingStep.entered = true;
      }

      return runState === 'halted' ? 'halted' : 'budget';
    },

    /**
     * The machine's video output, when the config declared a TMS9918
     * (CHIP vdp = TMS9918 AT $addr): the last VBLANK's frame as RGBA
     * for a canvas face, plus mode and frame counter so a poller can
     * skip unchanged frames. null when the machine has no VDP — the
     * UI shows no screen rather than a black lie.
     */
    /**
     * Face-input contract, write side: the face (VdpScreen with
     * keyboard focus, on-screen buttons) reports the pressed-button
     * mask; the machine maps it onto the snake hookup (active-low
     * PA0..3). Returns false when the machine has no VIA to receive it.
     */
    setButtons(mask) {
      return typeof machine.setButtons === 'function' ? machine.setButtons(mask) : false;
    },

    video() {
      // Any chip implementing the common videoFrame() contract counts —
      // TMS9918, simplevga, and whatever video hardware comes next.
      for (const chip of Object.values(machine.chips || {})) {
        if (typeof chip.videoFrame === 'function') return chip.videoFrame();
      }
      return null;
    },

    position() {
      if (!symbols?.scheduler?.tasks) return [];
      const result = [];
      for (const task of symbols.scheduler.tasks) {
        if (!task.yields) continue;
        // Check state variable if present
        if (task.state) {
          const addr = task.state.addr;
          const size = task.state.size ?? 1;
          let val = 0;
          for (let i = size - 1; i >= 0; i--) val = (val << 8) | machine.mem[addr + i];
          const y = task.yields.find(yy => yy.state === val);
          if (y) result.push({ task: task.name, state: val });
        }
      }
      return result;
    },

    timeNs() { return adapter.timeNs(); },

    readMem(space, addr, len) {
      if (space !== 'mem') return { unsupported: `no space '${space}' on 6502` };
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = machine.mem[(addr + i) & 0xffff];
      return out;
    },

    writeMem(space, addr, data) {
      if (space !== 'mem') return { refused: `no space '${space}' on 6502` };
      for (let i = 0; i < data.length; i++) machine.mem[(addr + i) & 0xffff] = data[i];
      return undefined;
    },
  };
}
