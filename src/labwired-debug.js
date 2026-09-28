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
import { logicalTimeDomain } from './instruction-debug-events.js';
import { readElfFunctionSymbols, symbolizer } from './elf-symbols.js';

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
  // Function names from the user's own ELF (firmware-only), when it has a
  // symbol table: `main+0x12` beside a PC is what makes a raw run readable.
  const symbolAt = symbolizer(opts.elf ? readElfFunctionSymbols(opts.elf, { thumb }) : []);
  const nameOf = (a) => {
    const hit = symbolAt(a);
    return hit ? (hit.offset ? `${hit.name}+0x${hit.offset.toString(16)}` : hit.name) : null;
  };
  const codeAddr = a => (thumb ? (a & ~1) : a) >>> 0;
  const pc = () => sim().get_pc() >>> 0;

  /** A register by the engine's own name ('SP', 'LR'), or null. */
  const regNamed = (name) => {
    try {
      const names = sim().get_register_names();
      const i = Array.isArray(names) ? names.indexOf(name) : -1;
      return i < 0 ? null : sim().get_register(i) >>> 0;
    } catch (e) {
      return null;
    }
  };
  const halfword = (addr) => {
    try {
      const b = sim().read_memory(addr >>> 0, 2);
      return b && b.length === 2 ? (b[0] | (b[1] << 8)) : null;
    } catch (e) {
      return null;
    }
  };
  /**
   * The return address if the instruction at `at` is a Thumb call, else null.
   * BL (32-bit: 11110… then 11x1…) returns to at+4; BLX Rm (16-bit
   * 0100 0111 1xxx x000) to at+2. Same decode rp2040js-debug uses, plus BLX.
   */
  const callReturn = (at) => {
    const hw1 = halfword(at);
    if (hw1 === null) return null;
    if ((hw1 & 0xff87) === 0x4780) return at + 2;
    if ((hw1 & 0xf800) === 0xf000) {
      const hw2 = halfword(at + 2);
      if (hw2 !== null && (hw2 & 0xd000) === 0xd000) return at + 4;
    }
    return null;
  };
  /** Step-over / step-out in flight: { kind, returnPc, sp0 }. */
  let depthStep = null;

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

  // ── Reverse (opt-in recording) ───────────────────────────────────────
  //
  // bw-debug's reverse step restores the nearest checkpoint and replays one
  // instruction at a time, comparing each replayed retire event with the
  // recorded one. That needs a retire event per instruction, which on this
  // engine means single-stepping across the wasm boundary — far slower than
  // batched running. So it is OPT-IN (`setRecording(true)`), and only where
  // save points work (firmware-only): a checkpoint IS an engine snapshot.
  //
  // TICKS ARE RETIRED INSTRUCTIONS, and the domain says so. The engine has no
  // per-instruction cycle count to read, and this target already treats one
  // instruction as one cycle for program time; naming the clock
  // `labwired-instructions` keeps anyone from reading these ticks as cycles.
  // A restore opens a new epoch (`-rewind-<n>`): the timeline branched, and
  // bw-debug requires ticks never to fall within one domain.
  const DOMAIN = 'labwired-instructions';
  let recording = false;
  let retired = 0;
  let epoch = 0;
  const domain = () => (epoch ? `${DOMAIN}-rewind-${epoch}` : DOMAIN);
  const clockHz = Number(clockHzBig);
  let eventListeners = [];
  let inputListeners = [];
  /** One instruction, and — while recording — its retire event. */
  const stepOne = () => {
    const pcBefore = codeAddr(pc());
    sim().step_single();
    if (!recording) return;
    retired += 1;
    const ev = {
      cpuId: 0, kind: 'instruction', phase: 'retire', fidelity: 'recorded',
      time: { ticks: retired, domain: domain(), hz: clockHz },
      pcBefore, pcAfter: codeAddr(pc()),
    };
    for (const cb of eventListeners) {
      try { cb(ev); } catch (e) { /* a listener must not stop the run */ }
    }
  };

  /**
   * Tell every listener why the run stopped, in the halt shape every other
   * target uses (avr8js/emu8051/riscv32: `cause`, `pc`, `bp`, `bpKind`, `tNs`,
   * `skewNs`). This target used to send `{ reason, addr }` only, so bw-debug —
   * which reads `why.cause` and maps `why.bp` back to the UI breakpoint that
   * fired — could not tell which breakpoint hit or record the cause in its
   * trace. `reason` stays as an alias. A user halt is `pause`, as elsewhere.
   */
  const halted = (reason, detail = {}) => {
    running = false;
    insnRemaining = null;
    depthStep = null;
    const cause = reason === 'user' ? 'pause' : reason;
    let bp;
    if (cause === 'breakpoint') {
      for (const [handle, addr] of breakpoints) if (addr === detail.addr) { bp = handle; break; }
    }
    const why = {
      cause, reason, pc: codeAddr(pc()),
      bp, bpKind: bp !== undefined ? 'code' : undefined,
      tNs: adapter.timeNs(), skewNs: 0n,
      ...detail,
    };
    for (const cb of listeners) {
      try { cb(why); } catch (e) { /* a listener must not stop the halt */ }
    }
  };

  const target = {
    capabilities () {
      return {
        // over/out on ARM only: they read the Thumb call encodings and SP/LR.
        steps: thumb ? ['insn', 'over', 'out'] : ['insn'],
        breakpoints: ['code'],
        // Run-to is one temporary code breakpoint, installed synchronously —
        // bw-debug's run-to coordinator owns it; nothing target-side to add.
        runTo: [{ kind: 'address', space: 'code', addressMin: 0, addressMax: CODE_ADDRESS_MAX,
          stopSides: ['before'], installation: 'sync' }],
        spaces: ['code', 'sram'],
        writable: [],
        sfrs: 'memory-mapped',
        haltPolicy: 'freeze-timers',
        timeFreezes: true,
        consumes: [],
        // Reverse only while opted in (see setRecording): a checkpoint is an
        // engine snapshot, and a retire event needs single-stepping.
        recording: recording ? ['checkpoint', 'restore'] : [],
        extensions: recording ? { eventBreakpointBoundary: 'instruction-retire' } : {},
      };
    },

    /**
     * Opt in to reverse. Refused, by name, where save points are refused (a
     * bench cannot rewind its circuit). While on, every instruction is
     * single-stepped so it can be announced — the run is much slower.
     * @returns {undefined|{unsupported:string}}
     */
    setRecording (on) {
      if (on) {
        const why = target.snapshotUnavailable();
        if (why) return { unsupported: why };
      }
      recording = !!on;
      return undefined;
    },
    isRecording () { return recording; },

    onDebugEvent (cb) {
      eventListeners.push(cb);
      return () => { eventListeners = eventListeners.filter(f => f !== cb); };
    },

    debugTime () { return { ticks: retired, domain: domain(), hz: clockHz }; },

    /** A checkpoint: an engine snapshot plus this target's retire count. Plain data. */
    captureCheckpoint () {
      if (!recording) return { refused: 'recording is off' };
      const saved = target.saveSnapshot('checkpoint');
      if (!saved || saved.unsupported) return { refused: saved ? saved.unsupported : 'snapshot failed' };
      return { snapshotId: saved.id, retired, time: target.debugTime() };
    },

    /** Restore a checkpoint and open a fresh epoch. undefined on success. */
    restoreCheckpoint (cp) {
      if (!cp || typeof cp.snapshotId !== 'number') return { refused: 'not a labwired checkpoint' };
      const r = target.restoreSnapshot(cp.snapshotId);
      if (r && r.unsupported) return { refused: r.unsupported };
      retired = cp.retired;
      epoch += 1;
      return undefined;
    },

    /** Retire exactly one instruction, announcing it exactly as a live run does. */
    replayInstruction () {
      if (!recording) return { accepted: false, code: 'not-recording', reason: 'recording is off' };
      if (detached) return { accepted: false, code: 'detached', reason: 'the target is detached' };
      stepOne();
      return { accepted: true, boundary: 'instruction', cycles: 1 };
    },

    // ── Inputs: the serial console is this tier's one host input ──────────
    //
    // A byte typed into the console changes what the firmware does, so a
    // replay that skipped it would diverge without anyone noticing. Every byte
    // therefore goes through feedSerial(), which announces it as a fact on the
    // instruction clock before the engine sees it, and applyReplayInput() puts
    // the same byte back during a replay. With a CIRCUIT attached the board
    // drives this chip's pins outside that log, so a replay is refused and the
    // refusal names the board.

    // `onDebugInput(` / `applyReplayInput(` are spelled without this file's
    // usual space ON PURPOSE: test/replay-surface-conformance.test.mjs finds
    // implementers by that exact text, and this target must be in its table.
    onDebugInput(cb) {
      inputListeners.push(cb);
      return () => { inputListeners = inputListeners.filter(f => f !== cb); };
    },

    /** Type one byte into the firmware's UART, recording it as an input fact. */
    feedSerial (byte) {
      const b = byte & 0xff;
      const fact = { producer: 'labwired.uart', payload: { byte: b }, time: target.debugTime() };
      for (const cb of inputListeners) {
        try { cb(fact); } catch (e) { /* a TELL listener cannot stop the input */ }
      }
      adapter.feedSerial(b);
      return true;
    },

    /** Why this session cannot be replayed, if it cannot. See replaySupport(). */
    replayRefusalReasons () {
      return adapter.firmwareOnly ? []
        : ['a circuit board drives this chip\'s inputs outside the replay log'];
    },

    /** Put a recorded input back: the same byte into the same UART. */
    applyReplayInput(fact) {
      if (!adapter.firmwareOnly) {
        return { accepted: false, code: 'board-inputs-unlogged',
          reason: 'a circuit board drives this chip\'s inputs outside the replay log' };
      }
      const byte = fact && fact.producer === 'labwired.uart' && fact.payload ? fact.payload.byte : undefined;
      if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
        return { accepted: false, code: 'invalid-input',
          reason: `not a labwired.uart byte fact: ${fact && fact.producer}` };
      }
      adapter.feedSerial(byte);
      return { accepted: true };
    },

    /**
     * Run forward to the exact instruction count at which a recorded input was
     * delivered. Coded refusals, nothing coerced (see m6502-debug.js for why
     * ticks are parsed with BigInt).
     */
    replayToInputBoundary (boundary) {
      let requested;
      try { requested = BigInt(boundary?.ticks); } catch {
        return { accepted: false, code: 'invalid-input-boundary', reason: 'recorded input boundary ticks must be an integer' };
      }
      if (logicalTimeDomain(boundary?.domain) !== DOMAIN || requested < 0n) {
        return { accepted: false, code: 'invalid-input-boundary', reason: 'recorded input boundary is outside the labwired instruction clock' };
      }
      if (requested < BigInt(retired)) {
        return { accepted: false, code: 'input-boundary-passed', reason: 'already past the recorded input boundary' };
      }
      if (!recording) return { accepted: false, code: 'not-recording', reason: 'recording is off' };
      while (BigInt(retired) < requested) stepOne();
      return { accepted: true, boundary: 'input', time: target.debugTime() };
    },

    state () {
      if (detached) return 'detached';
      return running ? 'running' : 'halted';
    },

    run () { insnRemaining = null; running = true; },

    halt () { if (running) halted('user'); },

    step (kind, count = 1) {
      if ((kind === 'over' || kind === 'out') && thumb) {
        const here = codeAddr(pc());
        if (kind === 'over') {
          const ret = callReturn(here);
          // Not a call: step over IS step into — one instruction.
          if (ret === null) { insnRemaining = 1; depthStep = null; running = true; return undefined; }
          depthStep = { kind: 'over', returnPc: ret };
        } else {
          // LR catches a leaf's BX lr; an SP rise catches a stacked return
          // after a nested BL replaced LR. Both heuristics, as on rp2040js: an
          // early stop is preferable to never stopping.
          const lr = regNamed('LR');
          const sp = regNamed('SP');
          if (lr === null || sp === null) {
            return { unsupported: 'step out needs the SP and LR registers, which this core does not name' };
          }
          depthStep = { kind: 'out', returnPc: codeAddr(lr), sp0: sp };
        }
        insnRemaining = null;
        running = true;
        return undefined;
      }
      if (kind === 'over' || kind === 'out') {
        return { unsupported: `step ${kind} is implemented for ARM (Thumb) chips only; ` +
          'this core would need its own call/return decode' };
      }
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
      let text;
      try {
        text = sim().get_disassembly() || '';
      } catch (e) {
        return '';
      }
      const where = nameOf(codeAddr(addr));
      return where && text ? `<${where}> ${text}` : text;
    },

    /** The function containing `addr` in the user's ELF, `{name, offset}`, or null. */
    symbolize (addr) { return symbolAt(codeAddr(addr)); },

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
      depthStep = null;
      faultSeen = false;
      // A reset rebuilds the engine: its snapshots (and so every checkpoint)
      // are gone, and the timeline restarts — a new epoch, not ticks falling.
      retired = 0;
      epoch += 1;
    },

    runFor (budgetNs) {
      if (detached || !running) return 'idle';

      const budgetCycles = Number((BigInt(budgetNs) * clockHzBig) / NS_PER_S);
      if (budgetCycles <= 0) return 'running';

      // Single-instruction stepping, and breakpoint checking, both need the PC
      // between instructions — so they share one slow path. Everything else
      // runs in batches, which is the only way the wasm boundary stays cheap.
      const mustWatch = insnRemaining !== null || codeBps.size > 0 || recording || depthStep !== null;

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
        stepOne();
        const here = codeAddr(pc());
        if (codeBps.has(here)) {
          adapter.pump();
          halted('breakpoint', { addr: here });
          return 'halted';
        }
        if (depthStep) {
          const done = here === depthStep.returnPc ||
            (depthStep.kind === 'out' && (regNamed('SP') ?? 0) > depthStep.sp0);
          if (done) {
            depthStep = null;
            adapter.pump();
            halted('step');
            return 'halted';
          }
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
     * Why save points are unavailable here, or null when they work.
     *
     * The engine's snapshots are a journal: a restore builds a fresh machine
     * from the same inputs and replays the recorded calls, and refuses when
     * the replay does not reproduce the saved state. With a CIRCUIT attached
     * that is only half a rewind — the board simulation moves forward in time
     * only, so the firmware would go back while the pins, voltages and parts
     * stayed where they were. Offered, therefore, on a firmware-only target;
     * on a bench it is refused by name rather than half-done.
     * @returns {string|null}
     */
    snapshotUnavailable () {
      if (detached) return 'the target is detached';
      if (!adapter.firmwareOnly) {
        return 'save points need the firmware-only mode: the circuit cannot be rewound with the firmware';
      }
      if (typeof sim().snapshot_save !== 'function') return 'this engine build has no snapshots';
      try {
        const why = typeof sim().snapshot_unavailable_reason === 'function'
          ? sim().snapshot_unavailable_reason() : null;
        return why || null;
      } catch (e) {
        return `snapshots unavailable: ${e.message || e}`;
      }
    },

    /** Save the current point. @returns {{id,label,cycles}|{unsupported:string}} */
    saveSnapshot (label) {
      const why = target.snapshotUnavailable();
      if (why) return { unsupported: why };
      try {
        return JSON.parse(sim().snapshot_save(label ?? null));
      } catch (e) {
        return { unsupported: `snapshot_save failed: ${e.message || e}` };
      }
    },

    /** Saved points, oldest first. [] when unavailable. */
    listSnapshots () {
      if (target.snapshotUnavailable()) return [];
      try { return JSON.parse(sim().snapshot_list()) || []; } catch (e) { return []; }
    },

    /**
     * Return to save point `id`. Halts first (a restore mid-run would race the
     * pump), then republishes what the engine now says — its time went back.
     * @returns {undefined|{unsupported:string}}
     */
    restoreSnapshot (id) {
      const why = target.snapshotUnavailable();
      if (why) return { unsupported: why };
      if (running) halted('user');
      try {
        sim().snapshot_restore(id >>> 0);
      } catch (e) {
        // The engine refuses, machine untouched, when the replay diverges.
        return { unsupported: `restore refused: ${e.message || e}` };
      }
      faultSeen = false;
      adapter.pump();
      return undefined;
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
      eventListeners = [];
      inputListeners = [];
      breakpoints.clear();
      codeBps.clear();
    },
  };

  return target;
}

export default createLabwiredDebugTarget;
