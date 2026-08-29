/**
 * Boundary-D debug target for avr8js — the ATmega328P becomes a breakable,
 * steppable, position-reporting program, through the SAME interface the
 * emu8051 target implements (DEBUG-CONTROL-MODEL). The session layer and the
 * runner branch on capabilities(), never on which silicon is underneath.
 *
 * ## What is easy here, and why
 *
 * emu8051 is WASM: halts arrive through registered C callbacks, memory reads
 * marshal across a heap boundary, and run control is a state machine on the
 * other side of `_emu_dbg_*`. avr8js is a JS stepping loop THIS module owns:
 * a breakpoint is an address comparison before each instruction, memory is a
 * typed array, and "halted" is simply this module not calling
 * `avrInstruction` any more. The easiest debugger target this project has —
 * which is exactly what made it worth specifying boundary D once, properly.
 *
 * ## PC units — the one real trap
 *
 * avr8js's `cpu.pc` counts WORDS; every toolchain (avr-nm, avr-objdump,
 * listings) prints BYTE addresses. This module speaks BYTES at its surface —
 * breakpoint addrs, `regs().pc`, symbol yield addrs — and converts at the
 * single comparison site. Mixing the two is silent order-of-2 breakage, so
 * the conversion never leaves this file.
 *
 * ## Halt policy
 *
 * `freeze-timers`, trivially honest: timers advance on `cpu.tick()`, ticks
 * happen only inside runFor/step, so a halted target freezes program time,
 * peripheral time and pin state all at once. `skewNs` is 0n for the same
 * reason the emulator's is — no wall clock runs on without us.
 *
 * ## Position (Level 1)
 *
 * Same contract as the 8051: the generated scheduler keeps one `<task>_state`
 * variable per task; the symbol table says where each lives in SRAM and which
 * code address each `(task, state)` yield sits at. `position()` reads the
 * variables (16-bit little-endian, 0xFFFF = ran to completion); yield
 * breakpoints resolve `(task, state)` → code address at set time.
 *
 * @module
 */

import { avrInstruction } from 'avr8js';

/** Halt-cause detail passed to onHalt listeners; shape mirrors emu8051-debug. */
function makeWhy(target, cause, hit) {
  return {
    cause,
    pc: target.regs().pc,
    bp: hit ? hit.handle : undefined,
    bpKind: hit ? hit.kind : undefined,
    tasks: target.position(),
    tNs: target.timeNs(),
    skewNs: 0n,
  };
}

/**
 * @param {ReturnType<import('./avr8js-adapter.js').createAvr8jsAdapter>} adapter
 * @param {object} [opts]
 * @param {object} [opts.symbols] — scheduler symbol table (same schema the
 *   8051 path uses: { scheduler: { bw_ms?: {addr}, tasks: [{ name,
 *   state: {addr, size?}, until?: {addr, size?}, yields: [{state, addr}] }] } };
 *   all addresses are DATA-SPACE for variables, BYTE code addresses for yields.
 */
export function createAvr8jsDebugTarget(adapter, opts = {}) {
  const cpu = adapter.cpu;

  let running = false;
  let detached = false;
  /** Instructions left in a pending step('insn'); null = not insn-stepping. */
  let insnRemaining = null;
  /** True while a step('block') runs to the next yield address. */
  let blockStep = false;
  /** Step-over/out state: { kind: 'over'|'out', sp0, entered? } */
  let depthStep = null;
  /** Byte PC we just halted at: one instruction of grace on resume, or a
   *  breakpoint would re-fire forever without ever executing. */
  let resumeGuard = null;
  let listeners = [];

  // ─── write watchpoints ──────────────────────────────────────────────
  // avr8js exposes cpu.writeHooks[addr] — a per-address callback that
  // intercepts cpu.writeData(). We install a thin hook for each watched
  // address; on fire it records the hit and lets the write through.
  const writeWatches = new Map(); // id → { addr, len }
  let watchHit = null;
  const installedHooks = new Map(); // addr → original hook (or null)

  function syncWriteHooks() {
    // Collect all watched addresses
    const needed = new Set();
    for (const [, w] of writeWatches) {
      for (let a = w.addr; a < w.addr + w.len; a++) needed.add(a);
    }
    // Install hooks for new addresses
    for (const a of needed) {
      if (installedHooks.has(a)) continue;
      const orig = cpu.writeHooks[a] || null;
      installedHooks.set(a, orig);
      cpu.writeHooks[a] = (value, oldValue, addr, mask) => {
        for (const [id, w] of writeWatches) {
          if (addr >= w.addr && addr < w.addr + w.len) {
            watchHit = { bp: id, addr, value: value & 0xff };
          }
        }
        return orig ? orig(value, oldValue, addr, mask) : false;
      };
    }
    // Remove hooks for addresses no longer watched
    for (const [a, orig] of installedHooks) {
      if (!needed.has(a)) {
        cpu.writeHooks[a] = orig;
        installedHooks.delete(a);
      }
    }
  }

  // ─── breakpoints ────────────────────────────────────────────────────
  let nextHandle = 1;
  /** handle → { kind, addr } (addr in BYTES) */
  const bps = new Map();
  /** byte addr → handle, the hot-loop lookup */
  const bpAt = new Map();

  // ─── symbols ────────────────────────────────────────────────────────
  let symbols = null;
  const taskIndex = new Map();   // name → task record
  const yieldAddr = new Map();   // `${task}/${state}` → byte addr
  const yieldSet = new Set();    // all yield byte addrs, for block stepping

  function loadSymbols(table) {
    symbols = table;
    taskIndex.clear();
    yieldAddr.clear();
    yieldSet.clear();
    const sched = table && table.scheduler;
    if (!sched) return { tasks: 0, yields: 0 };
    let yields = 0;
    for (const task of sched.tasks || []) {
      taskIndex.set(task.name, task);
      for (const y of task.yields || []) {
        if (typeof y.addr === 'number') {
          yieldAddr.set(`${task.name}/${y.state}`, y.addr);
          yieldSet.add(y.addr);
          yields++;
        }
      }
    }
    return { tasks: taskIndex.size, yields };
  }
  if (opts.symbols) loadSymbols(opts.symbols);

  function readVar(sym, fallbackSize) {
    if (!sym || typeof sym.addr !== 'number') return undefined;
    const size = sym.size ?? fallbackSize;
    let v = 0;
    for (let i = size - 1; i >= 0; i--) v = (v << 8) | (cpu.data[sym.addr + i] ?? 0);
    return v >>> 0;
  }

  function positionOf() {
    if (!symbols) return undefined;
    const out = [];
    for (const [name, task] of taskIndex) {
      const state = readVar(task.state, 2);
      const entry = { task: name, state };
      if (state !== 0xFFFF) {
        const until = readVar(task.until, 2);
        if (until) entry.until = until;
      }
      out.push(entry);
    }
    return out;
  }

  /** AVR SP from the SPH:SPL registers (data[0x5E]:data[0x5D]). */
  function readSP() { return cpu.data[0x5d] | (cpu.data[0x5e] << 8); }

  /** Is the AVR opcode at word-address `wpc` a call-class instruction?
   *  CALL (0x940E/0x940F), RCALL (0xDxxx), ICALL (0x9509), EICALL (0x9519). */
  function isCallOpcode(wpc) {
    const op = cpu.progMem[wpc] ?? 0;
    if ((op & 0xf000) === 0xd000) return true;            // RCALL
    if ((op & 0xfe0e) === 0x940e) return true;             // CALL (32-bit)
    if (op === 0x9509 || op === 0x9519) return true;       // ICALL / EICALL
    return false;
  }

  // ─── the run loop core ──────────────────────────────────────────────

  function announce(cause, hit) {
    const why = makeWhy(target, cause, hit);
    for (const cb of listeners) cb(why);
    return why;
  }

  /**
   * Execute instructions until a stop condition or the cycle limit.
   * Returns 'halted' | 'budget'. Owns ALL mutation of running/stepping
   * state, so run()/step()/runFor() stay thin.
   */
  function execute(untilCycles) {
    while (cpu.cycles < untilCycles) {
      const bytePc = cpu.pc * 2; // the single unit-conversion site

      if (bytePc !== resumeGuard) {
        const handle = bpAt.get(bytePc);
        if (handle !== undefined) {
          running = false;
          insnRemaining = null;
          blockStep = false;
          resumeGuard = bytePc;
          syncBoard();
          announce('breakpoint', { handle, kind: bps.get(handle).kind });
          return 'halted';
        }
        if (blockStep && yieldSet.has(bytePc)) {
          running = false;
          blockStep = false;
          resumeGuard = bytePc;
          syncBoard();
          announce('step');
          return 'halted';
        }
      }

      avrInstruction(cpu);
      cpu.tick();
      resumeGuard = null; // one instruction executed: breakpoints re-arm

      // Write watchpoint fired during the instruction
      if (watchHit) {
        const hit = watchHit;
        watchHit = null;
        running = false;
        insnRemaining = null;
        blockStep = false;
        depthStep = null;
        resumeGuard = cpu.pc * 2;
        syncBoard();
        announce('watchpoint', { handle: hit.bp, kind: 'write' });
        for (const cb of listeners) cb({
          cause: 'watchpoint', bp: hit.bp, addr: hit.addr, value: hit.value,
          pc: cpu.pc * 2, tNs: adapter.timeNs(), skewNs: 0n,
        });
        return 'halted';
      }

      // Step-over: after entering the call, wait for SP to recover
      if (depthStep) {
        if (depthStep.kind === 'over') {
          if (!depthStep.entered) depthStep.entered = true;
          else if (readSP() >= depthStep.sp0) {
            running = false; depthStep = null;
            resumeGuard = cpu.pc * 2;
            syncBoard(); announce('step');
            return 'halted';
          }
        } else if (depthStep.kind === 'out') {
          if (readSP() > depthStep.sp0) {
            running = false; depthStep = null;
            resumeGuard = cpu.pc * 2;
            syncBoard(); announce('step');
            return 'halted';
          }
        }
      }

      if (insnRemaining !== null && --insnRemaining <= 0) {
        running = false;
        insnRemaining = null;
        resumeGuard = cpu.pc * 2;
        syncBoard();
        announce('step');
        return 'halted';
      }
    }
    syncBoard();
    return 'budget';
  }

  /** Board time follows program time even across halts — boundary A's
   *  "time first" rule, delegated to the adapter (advanceNs(0) = sync). */
  function syncBoard() {
    adapter.advanceNs(0);
  }

  // ─── the target ─────────────────────────────────────────────────────

  const target = {
    capabilities() {
      return {
        steps: ['insn', 'block', 'over', 'out'],
        breakpoints: ['code', 'yield', 'write'],
        spaces: ['code', 'sram'],
        writable: ['sram'],
        sfrs: 'memory-mapped', // AVR I/O registers live in the data space
        haltPolicy: 'freeze-timers',
        timeFreezes: true,
        consumes: [],
      };
    },

    state() {
      if (detached) return 'detached';
      return running ? 'running' : 'halted';
    },

    run() {
      insnRemaining = null;
      blockStep = false;
      depthStep = null;
      running = true;
    },

    halt() {
      if (!running) return;
      running = false;
      insnRemaining = null;
      blockStep = false;
      depthStep = null;
      syncBoard();
      announce('pause');
    },

    step(kind, count = 1) {
      if (kind === 'insn') {
        insnRemaining = count;
        blockStep = false;
        depthStep = null;
        running = true;
        return undefined;
      }
      if (kind === 'block') {
        if (yieldSet.size === 0) {
          return { unsupported: symbols
            ? 'the symbol table has no yield addresses'
            : 'block stepping needs a symbol table (setSymbols first)' };
        }
        blockStep = true;
        insnRemaining = null;
        depthStep = null;
        running = true;
        return undefined;
      }
      if (kind === 'over') {
        // Depth-wait only when the NEXT opcode is call-class; anything
        // else is a plain instruction step — a lone PUSH must not turn
        // step-over into run-until-someday.
        if (!isCallOpcode(cpu.pc)) {
          insnRemaining = 1;
          blockStep = false;
          depthStep = null;
          running = true;
          return undefined;
        }
        depthStep = { kind: 'over', sp0: readSP(), entered: false };
        insnRemaining = null;
        blockStep = false;
        running = true;
        return undefined;
      }
      if (kind === 'out') {
        depthStep = { kind: 'out', sp0: readSP() };
        insnRemaining = null;
        blockStep = false;
        running = true;
        return undefined;
      }
      if (kind === 'cycle') {
        return { unsupported:
          'avr8js has no cycle step. avrInstruction() executes a whole instruction and then ' +
          'advances cpu.cycles by what it cost — there is no sub-instruction state to stop in, ' +
          'so a cycle step here would be an instruction step with a different label. Step one ' +
          'instruction; regs().cycles reports what it cost.' };
      }
      return { unsupported: `no such step kind: ${kind}` };
    },

    setBreakpoint(bp) {
      if (!bp || typeof bp !== 'object') return { unsupported: 'not a breakpoint' };
      if (bp.kind === 'code') {
        if (typeof bp.addr !== 'number') return { unsupported: 'code breakpoint needs addr' };
        if ((bp.addr & 1) !== 0) {
          return { unsupported:
            `AVR code addresses are even (byte address of a word): ${bp.addr}` };
        }
        const handle = nextHandle++;
        bps.set(handle, { kind: 'code', addr: bp.addr });
        bpAt.set(bp.addr, handle);
        return handle;
      }
      if (bp.kind === 'yield') {
        const addr = yieldAddr.get(`${bp.task}/${bp.state}`);
        if (addr === undefined) {
          return { unsupported: symbols
            ? `no yield for ${bp.task}/${bp.state} in the symbol table`
            : 'yield breakpoints need a symbol table (setSymbols first)' };
        }
        const handle = nextHandle++;
        bps.set(handle, { kind: 'yield', addr });
        bpAt.set(addr, handle);
        return handle;
      }
      if (bp.kind === 'write') {
        if (typeof bp.addr !== 'number') return { unsupported: 'write watchpoint needs addr' };
        const handle = nextHandle++;
        bps.set(handle, { kind: 'write', addr: bp.addr });
        writeWatches.set(handle, { addr: bp.addr, len: bp.len ?? 1 });
        syncWriteHooks();
        return handle;
      }
      return { unsupported: `no such breakpoint kind: ${bp.kind}` };
    },

    clearBreakpoint(handle) {
      const bp = bps.get(handle);
      if (!bp) return;
      bps.delete(handle);
      if (writeWatches.delete(handle)) syncWriteHooks();
      bpAt.clear();
      for (const [h, b] of bps) bpAt.set(b.addr, h);
    },

    readMem(space, addr, len) {
      if (space === 'sram') {
        return cpu.data.slice(addr, addr + len);
      }
      if (space === 'code') {
        // progMem is word-addressed; expose bytes little-endian, the way
        // every AVR tool prints flash.
        const out = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          const byteAddr = addr + i;
          const word = cpu.progMem[byteAddr >> 1] ?? 0;
          out[i] = (byteAddr & 1) ? (word >> 8) & 0xff : word & 0xff;
        }
        return out;
      }
      return { unsupported: `no such address space: ${space}` };
    },

    writeMem(space, addr, data) {
      if (space !== 'sram') return { refused: `space not writable: ${space}` };
      for (let i = 0; i < data.length; i++) cpu.data[addr + i] = data[i];
      return undefined;
    },

    regs() {
      const sp = cpu.data[0x5d] | (cpu.data[0x5e] << 8);
      return {
        pc: cpu.pc * 2,          // BYTES, like every AVR tool
        sp,
        sreg: cpu.data[0x5f],
        r: Array.from(cpu.data.slice(0, 32)),
        cycles: cpu.cycles,
      };
    },

    onHalt(cb) {
      listeners.push(cb);
      return () => { listeners = listeners.filter((f) => f !== cb); };
    },

    reset() {
      cpu.reset();
      running = false;
      insnRemaining = null;
      blockStep = false;
      depthStep = null;
      resumeGuard = null;
      watchHit = null;
      syncBoard();
    },

    runFor(budgetNs) {
      if (detached || !running) return 'idle';
      // The debug loop bypasses adapter.advanceNs, so the board's input
      // levels are re-read here — once per pump slice, same cadence as a
      // free run. A button works identically under the debugger.
      if (adapter.syncInputs) adapter.syncInputs();
      const clockHz = adapter.clockHz ?? 16_000_000;
      const budgetCycles = Math.max(1, Math.round((budgetNs / 1e9) * clockHz));
      return execute(cpu.cycles + budgetCycles);
    },

    // ─── beyond the interface (same extras the emulator target ships) ──

    setSymbols: loadSymbols,
    position: positionOf,

    bwMs() {
      const sym = symbols && symbols.scheduler && symbols.scheduler.bw_ms;
      return sym ? readVar(sym, 4) : undefined;
    },

    timeNs: () => adapter.timeNs(),

    detach() { detached = true; },
    destroy() { listeners = []; },
  };

  return target;
}
