/**
 * A DebugTarget over labwired-wasm — the heavy tier's debugger.
 *
 * The front end branches on `capabilities()`, never on which silicon is
 * underneath, and STM32-PATH.md's rule for this file is the one from the
 * factory header: an interface that hides unequal capability "produces a front
 * end that lies to the user the moment it is pointed at real hardware". So what
 * labwired's wasm surface genuinely offers is declared, and what it does not is
 * refused by name rather than faked.
 *
 * WHAT IT OFFERS, AND WHY EACH ONE
 * --------------------------------
 *   steps: ['insn']        `step_single()` is exact. 'block' is NOT offered:
 *                          rp2040js implements it from a symbol table's yield
 *                          set, and nothing equivalent exists here yet.
 *   breakpoints: ['code']  Not native. Implemented the same way the avr8js and
 *                          rp2040js targets implement theirs — single-step and
 *                          compare the PC — which is why `runFor` gets slower
 *                          when any breakpoint is armed, and why that is said
 *                          out loud rather than discovered.
 *   spaces: ['code','sram'] `read_memory(addr, len)` is address-space-flat, so
 *                          both names read the same bus. Declaring one name
 *                          would make the front end hide a pane that works.
 *   writable: []           The wasm surface exposes no memory WRITE. Not a
 *                          limitation of this file, and not one to paper over:
 *                          a front end that offers an edit which silently does
 *                          nothing is worse than one that greys it out.
 *   haltPolicy: 'freeze-timers'  Honest here for the same reason as the AVR and
 *                          RP2040 targets: engine time advances only inside
 *                          this module's loop, so a halted target freezes
 *                          program time, peripherals and pin state together.
 *                          `skewNs` is 0n — no wall clock runs on without us.
 *
 * THUMB BIT. ARM PCs are byte addresses, but bit 0 of a code address carries
 * the Thumb execution-state flag and is never part of the address. It is masked
 * at the compare site, and an odd breakpoint address is refused rather than
 * quietly never matching.
 *
 * @module
 */

/** Engine cycles per pump slice when nothing is armed — big enough that the
 *  wasm boundary is not the bottleneck, small enough to stay responsive. */
const FREE_RUN_CHUNK = 200_000;

/**
 * @param {object} opts
 * @param {object} opts.adapter a labwired boundary-A adapter (createLabwiredAdapter)
 * @param {object} [opts.symbols] reserved; no symbol-driven feature is offered yet
 * @returns {object} DebugTarget
 */
export function createLabwiredDebugTarget (opts) {
  const { adapter } = opts;
  if (!adapter || !adapter.sim) throw new Error('labwired debug target requires opts.adapter');

  const clockHzBig = BigInt(adapter.clockHz || 48_000_000);
  const NS_PER_S = 1_000_000_000n;

  let running = false;
  let detached = false;
  let insnRemaining = null;
  let listeners = [];
  /** Code breakpoints, Thumb bit already masked off. */
  const codeBps = new Set();

  const sim = () => adapter.sim;
  const pc = () => sim().get_pc() >>> 0;

  const halted = (reason, detail) => {
    running = false;
    insnRemaining = null;
    for (const cb of listeners) {
      try { cb({ reason, ...detail }); } catch (e) { /* a listener must not stop the halt */ }
    }
  };

  const target = {
    capabilities () {
      return {
        steps: ['insn'],
        breakpoints: ['code'],
        spaces: ['code', 'sram'],
        writable: [],
        sfrs: 'memory-mapped',
        haltPolicy: 'freeze-timers',
        timeFreezes: true,
        consumes: [],
      };
    },

    state () {
      if (detached) return 'detached';
      return running ? 'running' : 'halted';
    },

    run () { insnRemaining = null; running = true; },

    halt () { if (running) halted('user'); },

    step (kind, count = 1) {
      if (kind !== 'insn') {
        return { unsupported: `labwired offers single-instruction stepping only; ` +
          `'${kind}' would need a symbol-driven yield set, which this target does not have.` };
      }
      insnRemaining = count;
      running = true;
      return undefined;
    },

    setBreakpoint (bp) {
      if (!bp || typeof bp !== 'object') return { unsupported: 'not a breakpoint' };
      if (bp.kind !== 'code') {
        return { unsupported: `labwired offers code breakpoints only; '${bp.kind}' is not ` +
          'available (there is no write-watch on this bus, and no yield set).' };
      }
      if (typeof bp.addr !== 'number') return { unsupported: 'code breakpoint needs addr' };
      if ((bp.addr & 1) !== 0) {
        return { unsupported: `Thumb code address ${bp.addr.toString(16)} is odd. Bit 0 is the ` +
          'execution-state flag, not part of the address — a breakpoint set on it could never match.' };
      }
      codeBps.add(bp.addr >>> 0);
      return undefined;
    },

    clearBreakpoint (bp) {
      if (bp && typeof bp.addr === 'number') codeBps.delete((bp.addr & ~1) >>> 0);
      return undefined;
    },

    readMem (space, addr, len) {
      if (space !== 'sram' && space !== 'code') {
        return { unsupported: `no such address space: ${space}` };
      }
      try {
        return Uint8Array.from(sim().read_memory(addr >>> 0, len >>> 0));
      } catch (e) {
        return { unsupported: `read_memory(${addr}, ${len}) failed: ${e.message || e}` };
      }
    },

    writeMem () {
      return { unsupported: 'labwired-wasm exposes no memory write; this pane is read-only ' +
        'rather than silently ineffective.' };
    },

    regs () {
      const out = { pc: pc() & ~1, cycles: Number(adapter.timeNs() * clockHzBig / NS_PER_S) };
      try {
        const names = sim().get_register_names();
        const list = Array.isArray(names) ? names : [];
        const r = [];
        for (let i = 0; i < list.length && i < 16; i++) {
          try { r.push(sim().get_register(i) >>> 0); } catch { r.push(0); }
        }
        if (r.length) {
          out.r = r.slice(0, 13);
          if (r.length > 13) out.sp = r[13];
          if (r.length > 14) out.lr = r[14];
        }
        out.names = list;
      } catch (e) {
        // A register view that cannot be read is empty, not a thrown debugger.
      }
      return out;
    },

    onHalt (cb) {
      listeners.push(cb);
      return () => { listeners = listeners.filter((f) => f !== cb); };
    },

    reset () {
      if (adapter.resetToProgram) adapter.resetToProgram();
      running = false;
      insnRemaining = null;
    },

    runFor (budgetNs) {
      if (detached || !running) return 'idle';

      const budgetCycles = Number((BigInt(budgetNs) * clockHzBig) / NS_PER_S);
      if (budgetCycles <= 0) return 'running';

      // Single-instruction stepping, and breakpoint checking, both need the PC
      // between instructions — so they share one slow path. Everything else
      // runs in batches, which is the only way the wasm boundary stays cheap.
      const mustWatch = insnRemaining !== null || codeBps.size > 0;

      if (!mustWatch) {
        let left = budgetCycles;
        while (left > 0) {
          const chunk = Math.min(left, FREE_RUN_CHUNK);
          sim().step_batch(chunk);
          left -= chunk;
        }
        adapter.pump();
        return 'running';
      }

      for (let i = 0; i < budgetCycles; i++) {
        sim().step_single();
        const here = pc() & ~1;
        if (codeBps.has(here)) {
          adapter.pump();
          halted('breakpoint', { addr: here });
          return 'halted';
        }
        if (insnRemaining !== null && --insnRemaining <= 0) {
          adapter.pump();
          halted('step');
          return 'halted';
        }
      }
      adapter.pump();
      return 'running';
    },

    bwMs () { return undefined; },

    detach () { detached = true; running = false; },

    destroy () { detached = true; running = false; listeners = []; codeBps.clear(); },
  };

  return target;
}

export default createLabwiredDebugTarget;
