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

import { replayAccepted, replayRefused, assertAdmissionVerdict } from './debug-replay-contract.js';
import { installInstructionDebugEvents } from './instruction-debug-events.js';

export function createM6502DebugTarget(adapter, opts = {}) {
  const machine = adapter.machine;
  const cpu = machine.cpu;
  const cpuId = opts.cpuId || 'm6502';
  const symbols = opts.symbols ?? null;

  /**
   * THE SHARED EVENT MODULE — instruction retires, memory accesses, and a
   * monotonic event clock. avr8js, i8086 and z80 publish these facts through
   * this module; this target and z80 were the last two not to. No `port: true`:
   * the 6502's I/O is memory-mapped, so it has no separate port space to wrap.
   *
   * ITS CLOCK AND THIS TARGET'S SHARE A DOMAIN BASE AND NOT AN EPOCH COUNTER.
   * Both read `machine.cycles` and both stamp `m6502-cycles`, so an ordinary
   * event fact and an ordinary debugTime() agree. After a rewind they diverge in
   * the SUFFIX — this target counts `-rewind-N` on its input facts, the module
   * `-reset-N` on its events, and neither observes the other's bump. A seam, not
   * a defect today: nothing moves `machine.cycles` backwards except a checkpoint
   * restore, which opens this target's epoch, and the two kinds of fact are
   * never compared against each other. (The base is `m6502-cycles`, matching the
   * input-fact base, so no cross-timeline mismatch — see z80-debug for the trap
   * a different base would open.)
   */
  const debugEvents = installInstructionDebugEvents({
    cpu, machine, cpuId, timeDomain: 'm6502-cycles',
    // 'rewind', because m6502-machine.reset() ADVANCES the clock (+7) — the only
    // backward move is loadState/restore. Aligns event facts with this target's
    // INPUT facts, which already stamp `-rewind-` (eventDomain).
    rewindLabel: 'rewind',
    clock: () => machine.cycles,
    captureRegisters: () => ({pc: cpu.pc, a: cpu.a, x: cpu.x, y: cpu.y, sp: cpu.s, p: cpu.p}),
    captureInstruction: address => ({address, ...disasm6502(a => machine.mem[a & 0xffff], address)})
  });

  // ONE PREDICATE for uncaptured board input, read by replayRefusalReasons AND
  // the checkpoint gate (recording, checkpointRefusal, captureCheckpoint,
  // restoreCheckpoint) so the reason and the enforcement cannot disagree. A board
  // sampling input nets does so OUTSIDE the target, so those inputs are not in the
  // log and a checkpoint over them replays into a divergence: refuse, do not merely
  // mention it. The gate used to live on the machine (checkpointSupport() read
  // machine._unloggedBoardInputs); the adapter sync onto unloggedBoardInputs()
  // retired that flag, so it has to read the accessor HERE or the gate goes dead.
  const UNCAPTURED_INPUT_REASON = 'live board input-net sampling is not logged';
  const hasUncapturedInputState = () => adapter?.unloggedBoardInputs?.() === true;

  // ONE VALIDITY CHECK, read by the FACE method (setButtons, live) and by
  // applyReplayInput (replay), so the live path cannot accept a mask replay will
  // refuse — an un-replayable input recorded is the inverse of the guarantee.
  const validButtonMask = mask => Number.isSafeInteger(mask);

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

  // ─── The replay surface ─────────────────────────────────────────────
  // Declared in debug-replay-contract.js. This is the z80 target's mechanism
  // COPIED rather than re-derived — deliberately, because re-deriving is where a
  // confident sentence about coverage comes back.
  //
  // The stamp is the machine's own clock: {ticks: machine.cycles, domain,
  // hz: machine.clockHz}, the two operands tMs is divided from.
  //
  // A REWIND IS DETECTED, and this machine has exactly one path that causes one:
  // m6502-machine.js:806 is `this.cycles = s.cycles` inside loadState. Measured
  // rather than assumed, by grepping `cycles` in the file that DECLARES it: the
  // only other assignment is `= 0` in the constructor, and reset() at line 510
  // does `this.cycles += 7` — it ADVANCES by the real 6502 reset sequence's cost
  // rather than rewinding. So unlike the 8051 no reset trigger is needed here,
  // and unlike a naive reading a restore still rewinds.
  //
  // NOR IS A RESET TRIGGER NEEDED FOR THE DEDUP MAP. m6502-machine.js:510 resets
  // the CPU and advances the chips; it does not reset them, so a VIA that was
  // holding a button level still holds it afterwards. The map stays true.
  //
  // WHAT DETECTION CANNOT SEE, the same boundary as the z80: a restore followed
  // by running PAST the old high-water mark with no input in between is
  // monotonic from this side and indistinguishable from ordinary progress.
  // Closing that needs a machine-side signal on loadState.
  const observedInputs = new Map();
  let inputListeners = [];
  let admitters = [];
  let inputTimeEpoch = 0;
  let lastTicks = null;

  /**
   * The input-fact clock's domain name, READ without advancing the clock, used
   * by captureCheckpoint() and debugTime(). The module (events) keeps its own
   * epoch on the same `m6502-cycles` base — see the seam note at the top.
   */
  const eventDomain = () =>
    inputTimeEpoch ? `m6502-cycles-rewind-${inputTimeEpoch}` : 'm6502-cycles';

  /**
   * THE CLOCK IS INJECTABLE, AND THE EPOCH IS DERIVED RATHER THAN OWNED.
   *
   * `opts.debugTime` lets an integrator hand this target the clock the rest of
   * that integration already uses. It matters because a consumer downstream
   * gives this target's checkpoints and instruction events a SHARED epoch, and
   * a record half carrying its own would put one machine on two timelines: a
   * checkpoint stamped in one era and an input stamped in another at the same
   * instant, with a replayer comparing domains by equality seeing two runs.
   *
   * The default is this target's own clock below, so a standalone target
   * behaves exactly as before.
   *
   * A CONSEQUENCE WORTH NAMING: with a clock injected, the domain string is a
   * property of the INTEGRATION, not of this target. A test here asserting
   * `m6502-cycles-rewind-N` is describing the DEFAULT wiring; the same code
   * wired to a shared clock will legitimately stamp something else. That is not
   * a bug — a domain names a timeline, and an integration's timeline is the one
   * its checkpoints are on.
   */
  const ownClock = () => {
    const ticks = machine.cycles;
    // The only rewind this machine has is loadState (m6502-machine.js:806).
    if (lastTicks !== null && ticks < lastTicks) inputTimeEpoch++;
    lastTicks = ticks;
    return {
      ticks,
      domain: eventDomain(),
      hz: machine.clockHz
    };
  };
  const clock = typeof opts.debugTime === 'function' ? opts.debugTime : ownClock;

  let lastDomain = null;

  /**
   * Take the stamp, and CLEAR THE DEDUP MAP WHENEVER THE ERA CHANGES.
   *
   * The map must not survive a rewind: it would hold levels from an abandoned
   * timeline, and the first genuine change afterwards whose value happened to
   * match one would be dropped without trace.
   *
   * The signal is the DOMAIN STRING, not a tick regression, and that is the
   * whole point of the design. An injected clock may know about a rewind this
   * target cannot see — downstream's is bumped explicitly by `restoreCheckpoint`
   * — so watching the domain inherits every trigger the clock has instead of
   * only the one this target could detect for itself. It is also why the era
   * gate lives HERE rather than inside `ownClock`: an injected clock is not
   * ours to put a side effect in.
   *
   * WHAT REMAINS UNCOVERED, stated rather than hidden: a clock whose own
   * detection is deferred — downstream's bumps on the next `cpu.step` — leaves a
   * window where a rewind has happened and the domain has not moved yet. An
   * input arriving inside it is stamped on the old era. Narrower than detecting
   * nothing, and the same window the integration's other events already sit in.
   */
  const stamp = () => {
    const time = clock();
    if (lastDomain !== null && time.domain !== lastDomain) observedInputs.clear();
    lastDomain = time.domain;
    return time;
  };

  /**
   * Emit a fact, but only when the value has CHANGED.
   *
   * For LEVELS only — a button mask that is set twice is one state, so the
   * second call is not a fact. Events use `publishEvent`.
   *
   * The stamp is taken FIRST, before the dedup gate: a suppressed input must
   * still be able to notice that the era moved under it.
   */
  // The payload is the record; the signature is the comparison. m6502's only
  // level is buttons, and its machine reads the bits it wants (PA0..3), so the
  // record is the RAW value and the signature is identity — there is no keys
  // producer here to make order-independent, and no mask to apply (masking the
  // seed against a raw record is the z80 defect this convergence removes).
  const signatureOf = (producer, payload) => JSON.stringify(payload);

  const admit = input => {
    for (const a of admitters) {
      if (!assertAdmissionVerdict(a(input), 'm6502-debug onDebugInputAdmission').accepted) return false;
    }
    return true;
  };

  /**
   * A LEVEL input, in the order the eight rules fix: one stamp (era gate first),
   * the dedup read, the ASK before apply, apply, seed ON ACCEPTANCE, then TELL
   * reusing the stamp. A refused ASK writes nothing; a deduped repeat is applied
   * silently, because a held level must keep reaching the machine.
   */
  const level = (producer, key, payload, apply) => {
    const time = stamp();
    const signature = signatureOf(producer, payload);
    if (observedInputs.get(key) === signature) return apply();       // deduped: applied silently
    const input = {time, producer, payload};
    if (!admit(input)) return false;                                 // refused ASK writes nothing
    const result = apply();
    if (result === false) return result;                            // only a fact the machine TOOK is a fact
    observedInputs.set(key, signature);                             // seed on acceptance
    emit(producer, payload, time);                                  // TELL, reusing the stamp (emit copies per listener)
    return result;
  };

  // Events (serial, nmi) record with NO dedup — the same byte twice is two bytes.
  // Each event path (the serial wrapper below, and nmi) takes its own stamp, ASKs,
  // and calls `emit` on acceptance; the old publishEvent helper is gone.

  /**
   * SERIAL IS RECORDED AT THE ADAPTER, which is where the bypass was.
   *
   * This target used to record inside its own `sendSerial`, and said so: "a
   * caller holding the adapter can still call adapter.sendSerial directly and
   * will not be recorded". A downstream consumer had already closed that by
   * wrapping the adapter's method at construction, and this is that approach
   * brought back upstream — the adapter is the one place every caller passes
   * through.
   *
   * ONE DELIBERATE DIFFERENCE FROM THE DOWNSTREAM VERSION. It publishes BEFORE
   * calling the real method, because its listeners can VETO an input and a veto
   * has to happen before the byte reaches the machine. This one publishes
   * AFTER, and only when a chip took the byte, because it has no veto and does
   * have the rule that only a fact the machine TOOK is a fact — a logged byte
   * nothing received would replay a character that never arrived.
   *
   * TWO TARGETS OVER ONE ADAPTER NEED TWO DIFFERENT FUNCTIONS, and this was
   * measured rather than reasoned about — the first version of this wrap got it
   * wrong. `previous` is whatever `adapter.sendSerial` was at construction, so
   * wrapping CHAINS and each target records a live byte once. `rootSendSerial`
   * is the adapter'strue original, carried forward on the wrapper, and it is what
   * REPLAY uses — routing a replay through `previous` would publish the
   * replayed byte into the other target's log, which is what the first version
   * did (measured: replaying into the second target added a fact to the first).
   */
  const previousSendSerial = typeof adapter?.sendSerial === 'function'
    ? adapter.sendSerial.bind(adapter) : null;
  const rawSendSerial = adapter?.sendSerial?.rootDebugSendSerial ?? previousSendSerial;
  if (previousSendSerial) {
    const wrapped = byte => {
      const value = byte & 0xff;
      // An EVENT: the ASK comes before the byte reaches the machine (a veto must),
      // then TELL unconditionally on acceptance; the dedup map is never touched.
      const time = stamp();
      const input = {time, producer: 'm6502.serial', payload: {byte: value}};
      if (!admit(input)) return false;
      const accepted = previousSendSerial(value);
      if (accepted) emit('m6502.serial', {byte: value}, time);
      return accepted;
    };
    wrapped.rootDebugSendSerial = rawSendSerial;
    adapter.sendSerial = wrapped;
  }

  function emit(producer, payload, time) {
    const fact = {time, producer, payload: {...payload}};
    // Each listener gets its own copy: a recorder that stored the object and a
    // listener that mutated it would corrupt the log in place.
    for (const listener of inputListeners) {
      listener({...fact, time: {...fact.time}, payload: {...fact.payload}});
    }
  }

  return {
    capabilities() {
      // Tolerate a hollow {machine:{cpu:{}}} — several callers build this target
      // over a bare machine, and capabilities()/canVetoDebugInput must answer
      // without throwing. A machine with no checkpoint support records nothing.
      const checkpointStatus = typeof machine.checkpointSupport === 'function'
        ? machine.checkpointSupport()
        : { supported: false, reasons: ['this machine has no checkpoint support'] };
      // ONE list: the machine's own reasons AND uncaptured board input, so
      // recording, checkpointRefusal and captureCheckpoint() cannot disagree.
      const checkpointRefusalReasons = [
        ...(checkpointStatus.supported ? [] : checkpointStatus.reasons),
        ...(hasUncapturedInputState() ? [UNCAPTURED_INPUT_REASON] : [])
      ];
      return {
        steps: [...(symbols ? ['insn', 'block'] : ['insn']), 'over', 'out'],
        breakpoints: [...(symbols ? ['code', 'yield'] : ['code']), 'write'],
        runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0xffff,
          stopSides: ['before'], installation: 'sync'}],
        timeFreezes: true,
        consumes: [],
        // What the shared event module now publishes. No 'port': the 6502's I/O
        // is memory-mapped, so a store to a VIA register is a `memory` fact.
        events: ['instruction', 'memory'],
        spaces: {mem: {read: true, write: true, passiveRead: false}},
        fidelity: {instruction: 'recorded', memory: 'reconstructed', cycle: 'unsupported'},
        recording: checkpointRefusalReasons.length ? [] : ['checkpoint', 'restore'],
        // Two audio contracts (E6.8.11a). 'tone' is what the hardware is
        // CONFIGURED to produce and 'samples' is what it SOUNDS like;
        // 'samples' is advertised only when a chip on this machine can
        // really render them, for the same reason `steps` does not list
        // anything the core cannot do.
        audio: machine.canRenderAudio && machine.canRenderAudio()
          ? ['tone', 'samples']
          : ['tone'],
        extensions: {
          // Declares the ASK hook, read by canVetoDebugInput(target). One of the
          // first two targets to declare it (with z80-debug) — the consumer
          // convergence the ledger named: upstreaming the contract did not retire
          // it, converging the consumers did.
          inputAdmission: 'may-refuse',
          // Memory facts are published before the same machine.step() publishes
          // its recorded retire, so the runner may defer their actions safely.
          eventBreakpointBoundary: 'instruction-retire',
          ...(checkpointRefusalReasons.length ? {checkpointRefusal: checkpointRefusalReasons} : {}),
          inputReplay: ['m6502.buttons', 'm6502.nmi', ...(rawSendSerial ? ['m6502.serial'] : [])],
          inputRefusals: [
            'live board input-net changes bypass the target and disable checkpoint recording',
            'ROM/media loading is configuration, not a replayable runtime input'
          ]
        },
      };
    },

    /** Per-voice {hz, on, vol}; always an array, empty when nothing sounds. */
    audio() {
      return typeof machine.audioTone === 'function' ? machine.audioTone() : [];
    },

    /**
     * Drain rendered samples into `dest`. Returns frames of REAL audio; the
     * rest of `dest` is silence the bus counted as an underrun rather than
     * stretching what it had.
     */
    readAudio(dest, frames) {
      if (!machine.canRenderAudio || !machine.canRenderAudio()) return 0;
      return machine.audio.read(dest, frames);
    },

    state() { return runState; },

    /**
     * The EVENT half, mirroring onDebugInput below: instruction/access/idle
     * facts from the shared module. Delegated rather than reimplemented — a
     * second publisher of the same facts is how two vocabularies for one thing
     * begin.
     */
    onDebugEvent: debugEvents.onDebugEvent,

    /**
     * The event clock, READ without advancing it. On the same `m6502-cycles`
     * base as an input fact's stamp, so a consumer comparing a checkpoint
     * against a debug input fact gets one clock. (The module's own event epoch
     * may carry a different suffix after a rewind — the seam noted at the top.)
     */
    debugTime() {
      return { ticks: machine.cycles, domain: eventDomain(), hz: machine.clockHz };
    },

    /**
     * A checkpoint of the machine, stamped with this target's event clock — the
     * debug clock, not the machine's base time, so a consumer comparing it
     * against a debug fact gets one clock, not two.
     */
    captureCheckpoint() {
      // A snapshot over unlogged board inputs restores a machine that looks right
      // and is not — refuse rather than hand back a checkpoint replayRefusalReasons()
      // has already disowned.
      if (hasUncapturedInputState()) {
        return { code: 'INCOMPLETE_CHECKPOINT_STATE', refused: UNCAPTURED_INPUT_REASON };
      }
      const checkpoint = machine.captureCheckpoint();
      if (!checkpoint.refused) {
        checkpoint.time = { ticks: machine.cycles, domain: eventDomain(), hz: machine.clockHz };
      }
      return checkpoint;
    },

    /**
     * Restore, and OPEN A FRESH EPOCH on success. A restore is a branch in
     * history, not permission to run the clock backwards: renaming the domain
     * stops two facts from different timelines being read as one that jumped,
     * and the era gate (stamp()) then clears the dedup map on the next input.
     * `ownClock`'s own rewind detection cannot see a restore that lands ABOVE
     * the last stamped tick, which is why the bump is explicit here. The module's
     * own event epoch is left to its detection: the accepted seam.
     */
    restoreCheckpoint(checkpoint) {
      if (hasUncapturedInputState()) {
        return { code: 'INCOMPLETE_CHECKPOINT_STATE',
          refused: 'cannot restore over a live board input source sampled outside the machine' };
      }
      const result = machine.restoreCheckpoint(checkpoint);
      if (!result) { inputTimeEpoch++; lastTicks = machine.cycles; }
      return result;
    },

    /** Execute one complete instruction for checked history replay. */
    replayInstruction() {
      const support = machine.checkpointSupport();
      if (!support.supported) return {accepted: false, code: 'unsupported-replay',
        reason: support.reasons.join('; ')};
      if (cpu.stopped || cpu.waiting) return {accepted: false, code: 'halted-without-instruction',
        reason: 'the stopped or waiting 6502 cannot retire an instruction without a recorded wake input'};
      const before = machine.cycles;
      let cycles;
      watchHit = null;
      try {
        cycles = machine.step();
      } finally {
        // Replay reconstructs history; it must not arm a future live halt.
        watchHit = null;
      }
      if (!(cycles > 0)) return {accepted: false, code: 'instruction-not-retired',
        reason: 'the 6502 did not retire an instruction'};
      return {accepted: true, boundary: 'instruction', cycles: machine.cycles - before};
    },

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

    /** Normalise a code address and advance it in the 6502's 16-bit space. */
    nextCodeAddress(addr, length) {
      if (!Number.isSafeInteger(addr) || addr < 0 ||
          !Number.isSafeInteger(length) || length < 0) {
        return { unsupported: 'code address progression requires non-negative safe integers' };
      }
      return ((addr & 0xffff) + (length & 0xffff)) & 0xffff;
    },

    onHalt(cb) {
      haltListeners.push(cb);
      // The session treats the return value as an unsubscribe and
      // CALLS it on destroy — push()'s return (the new length) made
      // every bench teardown throw 'h is not a function'.
      return () => {
        const i = haltListeners.indexOf(cb);
        if (i >= 0) haltListeners.splice(i, 1);
      };
    },

    setBreakpoint(spec) {
      if (spec.kind === 'code') {
        // ENFORCE the ceiling capabilities().runTo declares (addressMax 0xffff).
        // Without it an out-of-range address is accepted and stored: it cannot
        // match a 16-bit pc, so it is a handle for a breakpoint that never fires —
        // accepted but dead, and one mask away from the z80's wrong-place halt.
        if (!Number.isSafeInteger(spec.addr) || spec.addr < 0 || spec.addr > 0xffff) {
          return { unsupported: 'code breakpoint addr must be in 0x0000..0xffff' };
        }
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
      if (kind === 'cycle') {
        return { unsupported:
          "this 6502 core has no cycle step. W65C02.step() fetches an opcode and runs it to " +
          "completion, returning the instruction's cycle count — there is no sub-instruction " +
          "state to stop in, so a cycle step here would be an instruction step with a " +
          "different label. Step one instruction; regs().cycles reports what it cost." };
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
      // Refuse a mask the REPLAY path would refuse (validButtonMask), so a live
      // input that cannot be replayed is not applied and recorded. Same predicate,
      // both paths — see the m6502.buttons branch in applyReplayInput.
      if (typeof machine.setButtons !== 'function' || !validButtonMask(mask)) return false;
      // RAW — the machine reads PA0..3 and ignores the rest; the log records what
      // the host sent, and the signature is that raw value on both live and replay.
      return level('m6502.buttons', 'buttons', {mask}, () => machine.setButtons(mask));
    },

    /**
     * A non-maskable interrupt, driven by the HOST rather than by the board.
     *
     * THE RECORD HALF FOR `m6502.nmi`, which did not exist: the apply switch
     * could replay an NMI fact and nothing on this target could produce one. A
     * driver pulsing NMI got no log entry, and the session then could not be
     * replayed through the interrupt it took — the apply half without the
     * record half, for one producer, inside a target where every other producer
     * had both.
     *
     * PUBLISHED AFTER the machine takes it, not before. A downstream copy does
     * the opposite, and deliberately: publishing first is what lets its
     * listeners VETO an input. This target has no veto and does have the rule
     * that only a fact the machine TOOK is a fact. Same feature, opposite
     * ordering, and the ordering is the part that is a decision.
     *
     * There is no gate on the machine's return value, and that is not an
     * oversight: an NMI is non-maskable and `M6502Machine.nmi()` returns true
     * unconditionally. A conditional that cannot be false is worse than none —
     * it reads as a check and tests nothing.
     *
     * @returns {boolean} whether the machine had an NMI entry point at all
     */
    nmi() {
      if (typeof machine?.nmi !== 'function') return false;
      // An EVENT: ASK before the interrupt reaches the machine, then TELL; never
      // touches the dedup map. A refused ASK means the input does not happen —
      // "if it cannot be recorded, it does not happen" — so the machine is not
      // pulsed. NMI is non-maskable at the machine, but whether it is RECORDED is
      // the admitter's to refuse.
      const time = stamp();
      const input = {time, producer: 'm6502.nmi', payload: {}};
      if (!admit(input)) return true;
      machine.nmi();
      emit('m6502.nmi', {}, time);
      return true;
    },

    /**
     * The RECORD half: subscribe to host-input facts as they are observed.
     * Named `onDebugInput` because that is the name the recorder consumes.
     *
     * @param {(fact: {time: object, producer: string, payload: object}) => void} listener
     * @returns {() => void} unsubscribe
     */
    /**
     * SESSION-SCOPED REASONS THIS TARGET CANNOT REPLAY, collected by
     * `replaySupport`. Empty when there are none.
     *
     * A LIVE BOARD IS THE CASE, and it is the one the contract module named in
     * the abstract months before anyone measured it: a board changes input nets
     * OUTSIDE the debug target, so a restored run silently diverges from the
     * recorded one. The record half here covers this target's own entry points
     * -- the adapter's `syncInputs` is a different class of input and nothing
     * logs it.
     *
     * Until now this target would record such a session, accept a replay, and
     * reproduce a run whose board inputs were never in the log, with nothing
     * saying so. A downstream consumer has declared it for months, as a
     * CHECKPOINT refusal; there is no checkpoint API here, and `replaySupport`
     * is the slot that does exist.
     *
     * NOT A CLAIM THAT RECORDING THEM IS NEXT. Logging every polled pin is what
     * the 8051's deduplication exists to survive, and it is a design question.
     * This converts a silent wrong answer into a stated refusal.
     *
     * @returns {string[]}
     */
    replayRefusalReasons() {
      return hasUncapturedInputState()
        ? [UNCAPTURED_INPUT_REASON]
        : [];
    },

    onDebugInput(listener) {
      if (typeof listener !== 'function') throw new TypeError('debug input listener must be a function');
      inputListeners.push(listener);
      return () => { inputListeners = inputListeners.filter(l => l !== listener); };
    },

    /**
     * The ASK half: register an admitter consulted BEFORE an input reaches the
     * machine. It returns {accepted: boolean}; a refusal stops the input, records
     * nothing, and seeds nothing. Separate from onDebugInput so a recorder that
     * only wants facts cannot veto by returning one. See debug-replay-contract.js.
     */
    onDebugInputAdmission(admitter) {
      if (typeof admitter !== 'function') throw new TypeError('debug input admitter must be a function');
      admitters.push(admitter);
      return () => { admitters = admitters.filter(a => a !== admitter); };
    },

    /**
     * Send a byte to the machine's serial receiver, RECORDING it on the way.
     *
     * Delegates to `adapter.sendSerial` — the debug target had no serial entry
     * point before this, and the record half needs one: a byte that reaches the
     * machine without passing through here is not in the log. THAT BYPASS IS
     * REAL AND STATED: a caller holding the adapter can still call
     * `adapter.sendSerial` directly and will not be recorded. Closing it
     * properly means recording inside the adapter, which is where the 8051 does
     * it; this target's record machinery lives here because `onDebugInput` does.
     *
     * @param {number} byte
     * @returns {boolean} whether a receiver took it
     */
    sendSerial(byte) {
      // Delegates to the WRAPPED adapter method, which is what records now.
      // This method publishes nothing of its own: doing both would log every
      // byte twice for a caller who came through the target rather than round
      // it.
      //
      // Callers construct this target over a bare `{machine}` —
      // `code-address-progression.test.mjs:32` builds `{machine: {cpu: {}}}` —
      // so `adapter` is frequently an object with nothing on it.
      if (typeof adapter?.sendSerial !== 'function') return false;
      return adapter.sendSerial(byte & 0xff);
    },

    /**
     * The APPLY half. Every failure is a return value, never a throw.
     *
     * Three producers, all three with a measured path in a fully built target —
     * and every one of them GUARDED, because a target built over a bare
     * `{machine}` has neither an adapter nor a CPU and a refusal is what the
     * contract requires there, not a TypeError. Measured
     * rather than assumed, because the first draft of this method refused two of
     * them by name on the strength of a sentence about what the machine lacks:
     *
     *   m6502.buttons  machine.setButtons        m6502-machine.js
     *   m6502.serial   adapter.sendSerial        m6502-adapter.js:156
     *   m6502.nmi      machine.nmi()             m6502-machine.js
     *
     * The nmi row said something else until the machine grew an entry point:
     * "the machine has no `nmi()` of its own, but it is not the machine's to
     * have". Half right. It did not have one, and it should — `cpu.nmi()`
     * charges the seven-cycle interrupt sequence to the CPU's counter and to
     * nothing else, so machine time and the peripherals were never advanced
     * through it. The comment is kept in this form rather than deleted because
     * "X is not X's to have" is the shape of a conclusion drawn from an
     * absence.
     *
     * A CAVEAT ON REPLAYED NMI, stated rather than guarded. A config with
     * `simplevga {nmi: true}` generates its own NMIs from vsync. Those are
     * MACHINE events, not host input, so nothing records them and replay
     * regenerates them — but a driver that recorded an NMI from somewhere else
     * and replays it into such a config adds one the original run did not have.
     *
     * @param {{producer: string, payload: object}} input a recorded fact
     * @returns {{accepted: boolean, code?: string, reason?: string}}
     */
    applyReplayInput(input) {
      const payload = input?.payload;
      switch (input?.producer) {
        case 'm6502.buttons': {
          if (!validButtonMask(payload?.mask)) {
            return replayRefused('invalid-replay-input', 'm6502.buttons needs a safe-integer mask');
          }
          // Passed through UNMASKED. The machine reads bits 0..3 and ignores the
          // rest (m6502-machine.js:606), so masking here would change nothing the
          // machine sees while making the seed disagree with the raw value a live
          // call records — and the next live call with that raw value would then
          // read as a change that never happened.
          const mask = payload.mask;
          // THE ERA GATE RUNS BEFORE THE SEED, and the order is load-bearing.
          // Measured on the landed version: replaying an input immediately
          // after a rewind RE-RECORDED it, because the seed went into the map
          // and the publish path then cleared the map before the dedup gate
          // read it. A second replay pass therefore produced a log longer than
          // the run — in the one moment replay actually happens, just after a
          // restore. Stamping first consumes the era change, so the seed
          // survives to do its job.
          stamp();
          // Replay applies DIRECTLY, never through the face setButtons (which now
          // ASKs, and replay must not — R3). Era gate first, then apply, then seed
          // with the RAW value through the ONE signatureOf the live path uses, so a
          // later live input of the same value dedups against it.
          if (typeof machine.setButtons !== 'function' || machine.setButtons(mask) === false) {
            return replayRefused('no-input-path', 'this machine has no VIA to receive a button mask');
          }
          observedInputs.set('buttons', signatureOf('m6502.buttons', {mask}));
          return replayAccepted();
        }
        case 'm6502.serial': {
          if (!Number.isInteger(payload?.byte) || payload.byte < 0 || payload.byte > 0xff) {
            return replayRefused('invalid-replay-input', 'm6502.serial needs a byte in 0..255');
          }
          if (!rawSendSerial) {
            return replayRefused('no-input-path',
              'this target was built without an adapter, and the serial input path '
              + 'lives there (m6502-adapter.js:156)');
          }
          // The UNWRAPPED method: the wrapper records, and a replayed byte
          // re-entering the log would double every byte on a second pass.
          return rawSendSerial(payload.byte)
            ? replayAccepted()
            : replayRefused('no-input-path',
              'no chip in this config accepts a received byte');
        }
        case 'm6502.nmi':
          // `machine.nmi()`, not `cpu.nmi()`. The CPU's entry point charges the
          // seven-cycle interrupt sequence to its own counter and to nothing
          // else, so `machine.cycles` does not move, the peripherals are not
          // advanced through that bus time, and the stamp on the next recorded
          // fact reads as though the interrupt were free. The machine's method
          // does all three. It exists here as of this change; it had existed
          // downstream for months.
          if (typeof machine?.nmi !== 'function') {
            return replayRefused('no-input-path',
              'this machine has no NMI entry point');
          }
          machine.nmi();
          return replayAccepted();
        default:
          return replayRefused('unsupported-replay-input',
            `no replay path for producer ${input?.producer ?? '(none)'}`);
      }
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
