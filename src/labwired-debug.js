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
 * the Thumb execution-state flag and is never part of the address. On an ARM
 * chip it is masked at the compare site, and an odd breakpoint address is
 * refused rather than quietly never matching. ARM ONLY: Xtensa's 16/24-bit
 * instructions sit at odd addresses, so there the PC is used as-is (the
 * adapter reports the chip's `arch`).
 *
 * @module
 */

/** Engine cycles per pump slice when nothing is armed — big enough that the
 *  wasm boundary is not the bottleneck, small enough to stay responsive. */
import { plain } from './labwired-adapter.js';

const FREE_RUN_CHUNK = 200_000;
const CODE_ADDRESS_MAX = 0xfffffffe;

const isCodeAddress = addr => Number.isSafeInteger(addr) &&
  addr >= 0 && addr <= CODE_ADDRESS_MAX;

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
  let nextBreakpointHandle = 1;
  /** Opaque handle -> code address. Clearing owns an installation, not an address. */
  const breakpoints = new Map();
  /** Code breakpoints, Thumb bit already masked off. */
  const codeBps = new Set();

  const sim = () => adapter.sim;
  // Bit 0 of an ARM code address is the Thumb flag, never part of it. Xtensa
  // has 16- and 24-bit instructions, so an odd PC is an ordinary address there,
  // and masking it would move every breakpoint and every reported PC. AVR and
  // RISC-V PCs are even anyway; masking is ARM's rule, so it is ARM's alone.
  const thumb = (adapter.arch ?? 'arm') === 'arm';
  const codeAddr = a => (thumb ? (a & ~1) : a) >>> 0;
  const pc = () => sim().get_pc() >>> 0;

  /**
   * The engine's Cortex-M fault verdict (why and where the firmware faulted,
   * `summary` is one sentence), or null — also null on an engine or core that
   * has none. Non-draining on the engine side, so it is safe to ask per slice.
   */
  const readFault = () => {
    if (typeof sim().fault_verdict !== 'function') return null;
    try {
      const json = sim().fault_verdict();
      return json ? JSON.parse(json) : null;
    } catch (e) {
      return null;
    }
  };
  /** Latched once the first fault halts the run, so Continue does not stop again at once. */
  let faultSeen = false;
  /** Halt on the FIRST fault, the way a hardware debugger stops on HardFault. */
  const haltOnNewFault = () => {
    if (faultSeen) return false;
    const verdict = readFault();
    if (!verdict) return false;
    faultSeen = true;
    halted('fault', { summary: verdict.summary, verdict });
    return true;
  };

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
      if (!isCodeAddress(bp.addr)) {
        return { unsupported: 'code breakpoint addr must be in 0x00000000..0xfffffffe' };
      }
      if (thumb && (bp.addr & 1) !== 0) {
        return { unsupported: `Thumb code address ${bp.addr.toString(16)} is odd. Bit 0 is the ` +
          'execution-state flag, not part of the address — a breakpoint set on it could never match.' };
      }
      const handle = nextBreakpointHandle++;
      const addr = bp.addr >>> 0;
      breakpoints.set(handle, addr);
      codeBps.add(addr);
      return handle;
    },

    clearBreakpoint (handle) {
      const addr = breakpoints.get(handle);
      if (addr === undefined) return undefined;
      breakpoints.delete(handle);
      // Separate installations at one address have separate identities. Keep
      // watching until the final owner is cleared.
      if (![...breakpoints.values()].includes(addr)) codeBps.delete(addr);
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

    /**
     * The decoded instruction AT THE PROGRAM COUNTER, and nowhere else.
     *
     * `get_disassembly()` takes no address — it decodes wherever the core is
     * standing — so this can only answer honestly for the current PC. Asked
     * about any other address it returns '', because the alternative is to hand
     * back the PC's instruction labelled as some other address: plausible,
     * confidently wrong, and exactly the class of answer this tier exists to
     * avoid. The trace calls it with the halt PC, which is the case that works.
     *
     * The string is the engine's own Rust debug form (`Branch { offset: -4 }`),
     * not assembler text. Left as-is rather than reformatted into something
     * that merely LOOKS like `b .`: a hand-rolled pretty-printer here would be
     * inventing mnemonics the engine never claimed.
     *
     * This matters more here than on the other tiers. A raw flash image carries
     * no symbols, so the instruction is the only thing a reader has.
     * @param {number} addr the address being asked about.
     * @returns {string} the decode, or '' when it is not the current PC.
     */
    disasm (addr) {
      if (detached) return '';
      if (codeAddr(addr) !== codeAddr(pc())) return '';
      try {
        return sim().get_disassembly() || '';
      } catch (e) {
        return '';
      }
    },

    /**
     * Every register the ENGINE names, under the engine's own names.
     *
     * This used to read the first 16 registers and label index 13 `sp` and 14
     * `lr` — ARM anatomy applied to every core. On labwired's AVR (R0..R31, SP,
     * SREG, PC) that showed R13 and R14 as `sp`/`lr` and dropped R16 upward,
     * SP and SREG; a RISC-V core would have shown x13 as `sp`. The core already
     * says what it has (`get_register_names()`, index i is register i), so the
     * list is its list: ARM gives r0..r12 sp lr, AVR r0..r31 sp sreg, RISC-V
     * x0..x31, Xtensa a0..a15, each lower-cased.
     *
     * Named keys, not an `r` array: bw-debug's inspect() reads an `r` array as
     * the 8051 shape and goes looking for `sfr`/`iram` spaces this target does
     * not have. `pc` stays the target's own (get_pc, the one breakpoints and
     * run-to compare), not the core's PC register slot.
     */
    regs () {
      const out = { pc: codeAddr(pc()), cycles: Number(adapter.timeNs() * clockHzBig / NS_PER_S) };
      let names;
      try { names = sim().get_register_names(); } catch (e) { return out; }
      if (!Array.isArray(names)) return out;
      names.forEach((name, i) => {
        const key = String(name).toLowerCase();
        if (key === 'pc' || key in out) return;
        try { out[key] = sim().get_register(i) >>> 0; } catch (e) { /* unreadable: omitted, not zero */ }
      });
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
      faultSeen = false;
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
        return haltOnNewFault() ? 'halted' : 'running';
      }

      for (let i = 0; i < budgetCycles; i++) {
        sim().step_single();
        const here = codeAddr(pc());
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
      return haltOnNewFault() ? 'halted' : 'running';
    },

    /**
     * What the engine knows that the run itself does not show:
     *   fault         the Cortex-M fault verdict (see readFault), or null;
     *   fidelityGaps  instructions it could not decode and addresses nothing
     *                 claimed — each one a silent no-op that looks exactly like
     *                 firmware running correctly. [] when there are none.
     * Optional on a DebugTarget; a host asks with `typeof target.diagnostics`.
     */
    diagnostics () {
      let fidelityGaps = [];
      if (typeof sim().fidelity_gaps === 'function') {
        try { fidelityGaps = plain(sim().fidelity_gaps()) || []; } catch (e) { fidelityGaps = []; }
      }
      return { fault: readFault(), fidelityGaps: Array.isArray(fidelityGaps) ? fidelityGaps : [] };
    },

    // The runner calls this UNGUARDED — board.advanceTo(target.timeNs()) on
    // every pump, and again for every register snapshot. Leaving it off the
    // target made a fully working engine crash the moment it started running,
    // and the crash named a symbol (`timeNs`) that exists on the adapter, so
    // it read like an engine fault rather than a missing delegation. Same
    // one-line bridge the avr8js and rp2040js targets use.
    timeNs () { return adapter.timeNs(); },

    bwMs () { return undefined; },

    detach () { detached = true; running = false; },

    destroy () {
      detached = true;
      running = false;
      listeners = [];
      breakpoints.clear();
      codeBps.clear();
    },
  };

  return target;
}

export default createLabwiredDebugTarget;
