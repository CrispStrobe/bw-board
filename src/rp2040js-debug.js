/**
 * Boundary-D debug target for rp2040js — the Pico becomes a breakable,
 * steppable, position-reporting program through the SAME interface the
 * emu8051 and avr8js targets implement (DEBUG-CONTROL-MODEL). The session
 * layer branches on capabilities(), never on which silicon is underneath.
 *
 * ## What is different here, and what is not
 *
 * Like avr8js, rp2040js is a stepping loop THIS module owns: a breakpoint
 * is an address comparison before each instruction, and "halted" is this
 * module not calling executeInstruction() any more. UNLIKE the AVR there
 * is no PC unit trap — ARM PCs are byte addresses, the same unit every
 * toolchain prints. The one ARM-ism: bit 0 of a code address is the Thumb
 * execution-state flag, never part of the address, so it is masked at the
 * compare site and odd breakpoint addresses are refused.
 *
 * ## Halt policy
 *
 * `freeze-timers`, honest for the same reason as the AVR target: the
 * simulation clock advances only inside this module's execute loop, so a
 * halted target freezes program time, peripheral alarms and pin state all
 * at once. `skewNs` is 0n — no wall clock runs on without us.
 *
 * ## Position (Level 1)
 *
 * Same contract as both siblings: the generated scheduler keeps one
 * `<task>_state` variable per task; the symbol table says where each lives
 * (absolute SRAM addresses on ARM) and which code address each
 * `(task, state)` yield sits at. Which toolchain will PRODUCE that table
 * for the Pico (bare-metal C vs MicroPython) is still open on the roadmap;
 * the target speaks the schema, not the toolchain.
 *
 * @module
 */

const RAM_START = 0x20000000;

/** Halt-cause detail passed to onHalt listeners; shape mirrors the siblings. */
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
 * @param {ReturnType<import('./rp2040js-adapter.js').createRp2040jsAdapter>} adapter
 * @param {object} [opts]
 * @param {object} [opts.symbols] — scheduler symbol table (same schema the
 *   8051/AVR paths use); variable addresses are ABSOLUTE (SRAM lives at
 *   0x20000000), yield addresses are byte code addresses.
 */
export function createRp2040jsDebugTarget(adapter, opts = {}) {
  const { rp2040, core } = adapter;
  const clock = rp2040.clock;
  const cycleNanos = 1e9 / adapter.clockHz;

  let running = false;
  let detached = false;
  /** Instructions left in a pending step('insn'); null = not insn-stepping. */
  let insnRemaining = null;
  /** True while a step('block') runs to the next yield address. */
  let blockStep = false;
  /** PC we just halted at: one instruction of grace on resume, or a
   *  breakpoint would re-fire forever without ever executing. */
  let resumeGuard = null;
  let listeners = [];

  // ─── breakpoints ────────────────────────────────────────────────────
  let nextHandle = 1;
  /** handle → { kind, addr } */
  const bps = new Map();
  /** addr → handle, the hot-loop lookup */
  const bpAt = new Map();

  // ─── symbols ────────────────────────────────────────────────────────
  let symbols = null;
  const taskIndex = new Map();   // name → task record
  const yieldAddr = new Map();   // `${task}/${state}` → code addr
  const yieldSet = new Set();    // all yield addrs, for block stepping

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
          yieldAddr.set(`${task.name}/${y.state}`, y.addr & ~1);
          yieldSet.add(y.addr & ~1);
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
    for (let i = size - 1; i >= 0; i--) v = (v << 8) | rp2040.readUint8(sym.addr + i);
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

  // ─── the run loop core ──────────────────────────────────────────────

  function announce(cause, hit) {
    const why = makeWhy(target, cause, hit);
    for (const cb of listeners) cb(why);
    return why;
  }

  /**
   * Execute instructions until a stop condition or the time budget.
   * Returns 'halted' | 'budget'. Owns ALL mutation of running/stepping
   * state, so run()/step()/runFor() stay thin.
   */
  function execute(untilNanos) {
    while (clock.nanos < untilNanos) {
      if (core.waiting) {
        // Asleep: no instruction executes, so no breakpoint can hit.
        // Jump to the next alarm, or to the budget's end when nothing is
        // scheduled (nanosToNextAlarm is 0 then — see the adapter).
        const toAlarm = clock.nanosToNextAlarm;
        const dt = toAlarm > 0 ? Math.min(toAlarm, untilNanos - clock.nanos)
          : untilNanos - clock.nanos;
        clock.tick(dt);
        continue;
      }

      const pc = core.PC & ~1; // bit 0 is the Thumb flag, not address

      if (pc !== resumeGuard) {
        const handle = bpAt.get(pc);
        if (handle !== undefined) {
          running = false;
          insnRemaining = null;
          blockStep = false;
          resumeGuard = pc;
          syncBoard();
          announce('breakpoint', { handle, kind: bps.get(handle).kind });
          return 'halted';
        }
        if (blockStep && yieldSet.has(pc)) {
          running = false;
          blockStep = false;
          resumeGuard = pc;
          syncBoard();
          announce('step');
          return 'halted';
        }
      }

      const cycles = core.executeInstruction();
      clock.tick(cycles * cycleNanos);
      resumeGuard = null; // one instruction executed: breakpoints re-arm

      if (insnRemaining !== null && --insnRemaining <= 0) {
        running = false;
        insnRemaining = null;
        resumeGuard = core.PC & ~1;
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

  const sramEnd = RAM_START + rp2040.sram.length;

  // ─── the target ─────────────────────────────────────────────────────

  const target = {
    capabilities() {
      return {
        // 'over'/'out' need call-depth tracking; declared absent rather
        // than pretended (the capability matrix exists for exactly this).
        steps: ['insn', 'block'],
        breakpoints: ['code', 'yield'],
        // ARM has ONE flat address space; these are named windows onto it
        // (addresses are absolute in both).
        spaces: ['code', 'sram'],
        writable: ['sram'],
        sfrs: 'memory-mapped',
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
      running = true;
    },

    halt() {
      if (!running) return;
      running = false;
      insnRemaining = null;
      blockStep = false;
      syncBoard();
      announce('pause');
    },

    step(kind, count = 1) {
      if (kind === 'insn') {
        insnRemaining = count;
        blockStep = false;
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
        running = true;
        return undefined;
      }
      return { unsupported: `no such step kind: ${kind}` };
    },

    setBreakpoint(bp) {
      if (!bp || typeof bp !== 'object') return { unsupported: 'not a breakpoint' };
      if (bp.kind === 'code') {
        if (typeof bp.addr !== 'number') return { unsupported: 'code breakpoint needs addr' };
        if ((bp.addr & 1) !== 0) {
          return { unsupported:
            `Thumb code addresses are halfword-aligned; bit 0 is the ` +
            `execution-state flag, not part of the address: ${bp.addr}` };
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
      return { unsupported: `no such breakpoint kind: ${bp.kind}` };
    },

    clearBreakpoint(handle) {
      const bp = bps.get(handle);
      if (!bp) return;
      bps.delete(handle);
      bpAt.clear();
      for (const [h, b] of bps) bpAt.set(b.addr, h);
    },

    readMem(space, addr, len) {
      if (space !== 'sram' && space !== 'code') {
        return { unsupported: `no such address space: ${space}` };
      }
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = rp2040.readUint8(addr + i);
      return out;
    },

    writeMem(space, addr, data) {
      if (space !== 'sram') return { refused: `space not writable: ${space}` };
      if (addr < RAM_START || addr + data.length > sramEnd) {
        return { refused:
          `write outside SRAM (0x${RAM_START.toString(16)}..0x${sramEnd.toString(16)})` };
      }
      for (let i = 0; i < data.length; i++) rp2040.writeUint8(addr + i, data[i]);
      return undefined;
    },

    regs() {
      return {
        pc: core.PC & ~1,
        sp: core.SP,
        lr: core.LR,
        xpsr: core.APSR,
        r: Array.from(core.registers.slice(0, 13)),
        cycles: core.cycles,
      };
    },

    onHalt(cb) {
      listeners.push(cb);
      return () => { listeners = listeners.filter((f) => f !== cb); };
    },

    reset() {
      // NOT core.reset() bare: that fetches PC from a vector table this
      // no-bootrom setup does not have (see the adapter's resetToProgram).
      adapter.resetToProgram();
      running = false;
      insnRemaining = null;
      blockStep = false;
      resumeGuard = null;
      syncBoard();
    },

    runFor(budgetNs) {
      if (detached || !running) return 'idle';
      // The debug loop bypasses adapter.advanceNs, so the board's input
      // levels are re-read here — once per pump slice, same cadence as a
      // free run. A button works identically under the debugger.
      if (adapter.syncInputs) adapter.syncInputs();
      return execute(clock.nanos + budgetNs);
    },

    // ─── beyond the interface (same extras the siblings ship) ──────────

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
