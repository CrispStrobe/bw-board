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
  let pendingStep = null;  // { kind: 'insn'|'block', remaining }
  const haltListeners = [];
  const breakpoints = new Map();
  let nextBpId = 1;

  function halt(info) {
    runState = 'halted';
    for (const cb of haltListeners) cb(info);
  }

  return {
    capabilities() {
      return {
        steps: symbols ? ['insn', 'block'] : ['insn'],
        breakpoints: symbols ? ['code', 'yield'] : ['code'],
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
      return { unsupported: `unknown breakpoint kind: ${spec.kind}` };
    },

    clearBreakpoint(id) { breakpoints.delete(id); },

    run() { runState = 'running'; pendingStep = null; },

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
        }

        const n = machine.step();
        if (n === 0) {
          // STP — machine stopped
          halt({ cause: 'stopped' });
          return 'halted';
        }

        if (pendingStep?.kind === 'insn') {
          pendingStep.remaining--;
        }
      }

      return runState === 'halted' ? 'halted' : 'budget';
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
