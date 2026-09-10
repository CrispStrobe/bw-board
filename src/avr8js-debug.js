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
  /**
   * ONE INSTRUMENT, SHARED WITH THE ORDINARY RUN.
   *
   * This target used to publish its own facts: its own `debugTime`, its own
   * retire shape, its own instruction window, its own single-listener
   * subscription. All of it was a second implementation of the contract
   * `instruction-debug-events.js` already holds for every other core here.
   *
   * THE FOLD IS A CAPABILITY GAIN, NOT DEDUPLICATION, and that is measured.
   * Before it, a debugger-driven AVR published 31,998 instruction retires and
   * ZERO memory accesses across a run — it never wrapped `readData`/`writeData`,
   * it only bridged the adapter's peripheral notifications. The adapter's own
   * instrument DOES wrap them, so a consumer watching an AVR board saw data
   * accesses while it ran freely and LOST them the moment a debugger attached.
   * Observability going backwards when you look closer is a defect in its own
   * right. Sharing the adapter's instrument is what fixes it.
   *
   * It also inherits the epoch this target never had: the module notices a tick
   * REGRESSION and names a new time domain, so a fact recorded after `reset()`
   * no longer reads as progress along the same timeline.
   */
  const debugEvents = adapter.debugEvents;
  const dropDebugSubscriptions = () => {
    for (const unsubscribe of debugSubscriptions) unsubscribe();
    debugSubscriptions = [];
  };
  const debugTime = (cycles = cpu.cycles) => ({
    ticks: BigInt(cycles), domain: 'avr-cycles', hz: adapter.clockHz ?? 16_000_000,
  });
  /** Unsubscribes for every listener attached through this target, so
   *  detach()/destroy() still isolate it from an adapter others also watch. */
  let debugSubscriptions = [];
  const unsubscribeDeviceAccess = adapter.onDeviceAccess?.((device) => {
    // The window logic that used to live here is the module's now: in an
    // instruction it joins that instruction's accesses and publishes before the
    // retire, outside one it goes out immediately. Both halves, one body.
    debugEvents.recordAccess({ kind: 'device', device });
  });

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

      // The bracket, injected: avr8js has no `cpu.step` to wrap, and the
      // adapter's ordinary-run loop calls the identical one. Same body, so a
      // debugger-driven run and a free run are indistinguishable in what they
      // publish — which is the whole point of the fold.
      debugEvents.aroundInstruction(() => {
        const cyclesBefore = cpu.cycles;
        avrInstruction(cpu);
        cpu.tick();
        return cpu.cycles - cyclesBefore;
      });
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
        runTo: [{kind: 'address', space: 'code', addressMin: 0,
          addressMax: cpu.progMem.length * 2 - 2, stopSides: ['before'], installation: 'sync'}],
        spaces: ['code', 'sram'],
        writable: ['sram'],
        sfrs: 'memory-mapped', // AVR I/O registers live in the data space
        haltPolicy: 'freeze-timers',
        timeFreezes: true,
        consumes: [],
        // 'memory' joined the day this target started sharing the adapter's
        // instrument: the accessor wrappers report every data read and write,
        // which a debugger-driven AVR never published before. A declaration
        // that lags what a target emits is the defect the conformance suite
        // exists to catch, so it moves in the same commit as the behaviour.
        events: ['instruction', 'device', 'memory'],
        extensions: { eventBreakpointBoundary: 'instruction-retire' },
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
        if (!Number.isSafeInteger(bp.addr) || bp.addr < 0 || bp.addr > cpu.progMem.length * 2 - 2) {
          return { unsupported: `code breakpoint addr must be in 0x0000..0x${
            (cpu.progMem.length * 2 - 2).toString(16)}` };
        }
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
        const len = bp.len ?? 1;
        if (!Number.isSafeInteger(bp.addr) || !Number.isSafeInteger(len) ||
            bp.addr < 0 || len < 1 || bp.addr + len > cpu.data.length) {
          return { unsupported:
            `write watchpoint range must be safe integers within data space (size ${cpu.data.length})` };
        }
        const handle = nextHandle++;
        bps.set(handle, { kind: 'write', addr: bp.addr });
        writeWatches.set(handle, { addr: bp.addr, len });
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

    /**
     * MANY LISTENERS NOW, WHERE THIS THREW ON THE SECOND.
     *
     * It used to hold exactly one and raise `the AVR debug event listener is
     * already attached` on any further attach — the only target here that did.
     * That is a RELAXATION and it is invisible to every existing consumer:
     * measured across all 20 repo origins on this box, exactly one production
     * site ever subscribes to a target's `onDebugEvent`
     * (`bw-debug/debug-runner.js`, through `subscribeDebugTargetEvents`), the
     * replay controllers subscribe to the runner's own stream instead, and no
     * caller catches the throw or uses a second attach to detect anything. The
     * unsubscribe contract that consumer DOES depend on is unchanged.
     */
    onDebugEvent(listener) {
      const unsubscribe = debugEvents.onDebugEvent(listener);
      debugSubscriptions.push(unsubscribe);
      return () => {
        debugSubscriptions = debugSubscriptions.filter(u => u !== unsubscribe);
        unsubscribe();
      };
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

    /** Drops every subscription this target made, so a detached target is
     *  silent even though the adapter's instrument keeps running for others. */
    detach() { detached = true; dropDebugSubscriptions(); unsubscribeDeviceAccess?.(); },
    destroy() { listeners = []; dropDebugSubscriptions(); unsubscribeDeviceAccess?.(); },
  };

  return target;
}
