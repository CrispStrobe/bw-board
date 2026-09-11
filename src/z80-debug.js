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
import { replayAccepted, replayRefused, assertAdmissionVerdict } from './debug-replay-contract.js';
import { loadSNA, SNA_SIZE } from './zx-sna.js';
import { loadZ80 } from './zx-z80file.js';
import { installInstructionDebugEvents } from './instruction-debug-events.js';

/** @param {{ machine: import('./z80-machine.js').Z80Machine }} adapter */
export function createZ80DebugTarget(adapter, opts = {}) {
  const machine = adapter.machine;
  const cpu = machine.cpu;
  const cpuId = opts.cpuId || 'z80';

  /**
   * THE SHARED EVENT MODULE — instruction retires, memory and port accesses,
   * and a monotonic event clock. avr8js, i8086 and m6502 publish these facts
   * through this module; this target and m6502 were the last two not to, and
   * hand-rolled nothing in their place — the events simply did not exist here.
   *
   * ITS CLOCK AND THIS TARGET'S SHARE A DOMAIN BASE AND NOT AN EPOCH COUNTER.
   * Both read `machine.cycles` and both stamp `z80-cycles`, so an ordinary
   * event fact and an ordinary debugTime() agree. After a rewind they diverge
   * in the SUFFIX — this target counts `-rewind-N` on its input facts, the
   * module `-reset-N` on its events, and neither observes the other's bump.
   * A seam, not a defect today: nothing moves `machine.cycles` backwards except
   * a checkpoint restore, which opens this target's epoch, and the two kinds of
   * fact are never compared against each other. Closing it means one clock
   * owning both and changing debugTime()'s return type — a separate decision,
   * deliberately not taken here. (The base is `z80-cycles`, NOT the `z80-tstates`
   * a downstream copy used: naming the event clock a different base from the
   * replay clock is the silent cross-timeline shape the injectable-clock note
   * below warns against — an input fact on one timeline, an event on another,
   * and a replayer comparing domains by equality seeing two runs where there is
   * one. Matching the base closes it.)
   */
  const debugEvents = installInstructionDebugEvents({
    cpu, machine, cpuId, timeDomain: 'z80-cycles', port: true,
    clock: () => machine.cycles,
    captureRegisters: () => ({pc: cpu.pc, sp: cpu.sp, a: cpu.a, f: cpu.f, bc: cpu.bc,
      de: cpu.de, hl: cpu.hl, ix: cpu.ix, iy: cpu.iy, i: cpu.i, r: cpu.r,
      af_: cpu.af_, bc_: cpu.bc_, de_: cpu.de_, hl_: cpu.hl_, iff1: cpu.iff1, im: cpu.im}),
    captureInstruction: address => {
      const read = machine.readBus ?? (a => machine.mem[a & 0xffff]);
      return {address, ...disasmZ80(a => read(a & 0xffff), address)};
    }
  });

  // ONE PREDICATE for uncaptured board input, read by replayRefusalReasons AND
  // the checkpoint gate (recording, checkpointRefusal, captureCheckpoint,
  // restoreCheckpoint) so the reason and the enforcement cannot disagree. A board
  // sampling input nets does so OUTSIDE the target, so those inputs are not in the
  // log and a checkpoint over them replays into a divergence: the target must
  // REFUSE to checkpoint, not merely mention it. This gate used to live on the
  // machine — checkpointSupport() read machine._unloggedBoardInputs — but the
  // adapter sync onto unloggedBoardInputs() retired that flag, so the gate has to
  // read the accessor HERE or it goes dead (the compensation-removal that let a
  // stated-un-replayable session still be handed a checkpoint).
  const UNCAPTURED_INPUT_REASON = 'live board buffer-input sampling is not logged';
  const hasUncapturedInputState = () => adapter?.unloggedBoardInputs?.() === true;

  // ONE VALIDITY CHECK per producer, read by the FACE method (live) and by
  // applyReplayInput (replay), so the live path cannot accept what replay will
  // refuse — an un-replayable input that happens and is recorded is the inverse
  // of the admission guarantee. The bound had drifted onto the replay path alone.
  const validButtonMask = mask => Number.isSafeInteger(mask);
  const validKeyNames = names => Array.isArray(names) && names.length <= 40
    && names.every(name => typeof name === 'string' && name.length <= 16);

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

  // ─── The RECORD half of the replay surface ──────────────────────────
  // Declared in debug-replay-contract.js. Facts are stamped from the machine's
  // OWN clock: `{ticks: machine.cycles, domain, hz: machine.clockHz}`. Those two
  // operands are what `z80-machine.js:270` divides into `tMs`, and taking them
  // undivided keeps the stamp integral — `tMs` is a lossy projection, and reading
  // it instead of its operands is what once made this look impossible.
  //
  // TICK TYPES DIFFER BETWEEN TARGETS AND THAT IS FINE. Here ticks are a Number
  // of CPU cycles at `machine.clockHz`; the 8051 adapter's are a BigInt of
  // nanoseconds at 1e9. The recorder accepts both. The DOMAIN string is what
  // stops two targets' stamps being compared to each other, so a third target
  // should copy the mechanism and not the units.
  //
  // THE EPOCH IS DETECTED, NOT ANNOUNCED — and an earlier version of this file
  // claimed no epoch was needed at all. That was false, and it was false because
  // the claim was checked against `zx-sna.js` and `zx-z80file.js`, the snapshot
  // FILE parsers, and not against the machine's own `loadState`:
  // `z80-machine.js:373` is `this.cycles = s.cycles`.
  //
  // A restore therefore moves the clock BACKWARDS, which is worse than the
  // 8051's reset: a reset restarts at zero going forward, a restore rewinds into
  // ticks this domain has already issued. Measured: facts at ticks 0, then
  // 100000, then 0 again, all in domain 'z80-cycles'. A downstream recorder
  // refuses exactly that — `recorder.js:261` raises INVALID_INPUT_ORDER, "Input
  // time decreased in domain" — and it fires in the workflow snapshots exist
  // for: record, restore a checkpoint, press a key.
  //
  // WHY DETECTION RATHER THAN A HOOK. This target never calls `loadState`; the
  // restore is driven by the caller, so there is no call site here to bump an
  // epoch at, the way the 8051 bumps one inside its own `reset()`. Watching the
  // clock needs no cooperation from the machine and covers every rewind path a
  // subsequent input can SEE. `m6502-machine.js:806` is the same assignment, so
  // this mechanism transfers verbatim rather than being re-derived.
  //
  // WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED. A rewind followed by running
  // PAST the old high-water mark, with no input in between, is invisible from
  // this side: ticks 100000, 100001, then restore to 100000 and run to 150000 —
  // the next fact stamps 150000, monotonic, same domain, and the log implies
  // 50000 cycles elapsed between two facts that sit on opposite sides of a
  // restore. No amount of watching the clock detects that; the machine would
  // have to say so. Closing it needs a machine-side signal on `loadState`, and
  // until there is one this is the boundary — every rewind an input can observe,
  // not every rewind.
  const observedInputs = new Map();
  let inputListeners = [];
  let admitters = [];
  let inputTimeEpoch = 0;
  let lastTicks = null;

  /**
   * The input-fact clock's domain name, READ without advancing the clock.
   * Named here because captureCheckpoint() and debugTime() stamp with it and a
   * reader comparing two facts must be able to tell an epoch apart. The module
   * (events) keeps its own epoch on the same `z80-cycles` base — see the seam
   * note at the top.
   */
  const eventDomain = () =>
    inputTimeEpoch ? `z80-cycles-rewind-${inputTimeEpoch}` : 'z80-cycles';

  /**
   * THE CLOCK IS INJECTABLE, AND THE EPOCH IS DERIVED RATHER THAN OWNED.
   *
   * `opts.debugTime` lets an integrator hand this target the clock the rest of
   * that integration already uses. A consumer downstream gives this target's
   * checkpoints and instruction events a SHARED epoch; a record half carrying
   * its own would put one machine on two timelines, with a replayer comparing
   * domains by equality seeing two runs where there is one. That hazard used to
   * be sharpest HERE, because the event clock was named `z80-tstates` while the
   * replay domain was `z80-cycles` — two names for one `machine.cycles`, so
   * nothing collided and nothing complained. The module now stamps `z80-cycles`
   * too (see the seam note above), so the base matches and that particular trap
   * is closed by construction; the injectable clock remains for an integration
   * that owns its own timeline.
   *
   * The default is this target's own clock below, so a standalone target
   * behaves exactly as before.
   *
   * A CONSEQUENCE WORTH NAMING: with a clock injected, the domain string is a
   * property of the INTEGRATION, not of this target. A test here asserting
   * `z80-cycles-rewind-N` is describing the DEFAULT wiring, not this target.
   */
  const ownClock = () => {
    const ticks = machine.cycles;
    // The only rewind this machine has is loadState (z80-machine.js:448).
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
   * The map must not survive a rewind. Constructed on the original version of
   * this code: hold 'a', snapshot, run on, press 'b', restore, then press 'b'
   * again in the restored era — a genuine a→b transition, DROPPED, because the
   * map still remembered 'b' from the timeline that no longer exists. Two
   * facts, one domain, the third gone without trace.
   *
   * The signal is the DOMAIN STRING, not a tick regression, and that is the
   * point. An injected clock may know about a rewind this target cannot see —
   * downstream's is bumped explicitly by `restoreCheckpoint` — so watching the
   * domain inherits every trigger the clock has rather than only the one this
   * target could detect for itself. It is also why the era gate lives HERE and
   * not inside `ownClock`: an injected clock is not ours to put a side effect
   * in.
   *
   * WHAT REMAINS UNCOVERED, stated rather than hidden: a clock whose own
   * detection is deferred — downstream's bumps on the next `cpu.step` — leaves
   * a window where a rewind has happened and the domain has not moved yet. An
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
   * @param {string} producer e.g. 'z80.keys'
   * @param {string} key the dedup key: what "the same input" means here
   * @param {object} payload the recorded value
   */
  /**
   * SERIAL IS RECORDED AT THE ADAPTER, which is where the bypass was.
   *
   * This target used to record inside its own `sendSerial` and said so: "a
   * caller holding the adapter can still call adapter.sendSerial directly and
   * will not be recorded. Closing that means recording inside the adapter."
   * A downstream consumer had already done exactly that, and this is that
   * approach brought back upstream — the adapter is the one place every caller
   * passes through.
   *
   * ONE DELIBERATE DIFFERENCE FROM THE DOWNSTREAM VERSION. It publishes BEFORE
   * calling the real method, because its listeners can VETO an input and a veto
   * must happen before the byte reaches the machine. This one publishes AFTER,
   * and only when a chip took the byte, because it has no veto and does have
   * the rule that only a fact the machine TOOK is a fact.
   *
   * TWO TARGETS OVER ONE ADAPTER NEED TWO DIFFERENT FUNCTIONS, measured rather
   * than reasoned about — the first version of this wrap got it wrong.
   * `previousSendSerial` is whatever `adapter.sendSerial` was at construction,
   * so wrapping CHAINS and each target records a live byte once.
   * `rawSendSerial` is the adapter's true original, carried forward on the
   * wrapper, and it is what REPLAY uses: routing a replay through the previous
   * wrapper publishes the replayed byte into the OTHER target's log, which is
   * what the first version did.
   */
  const previousSendSerial = typeof adapter?.sendSerial === 'function'
    ? adapter.sendSerial.bind(adapter) : null;
  const rawSendSerial = adapter?.sendSerial?.rootDebugSendSerial ?? previousSendSerial;
  if (previousSendSerial) {
    const wrapped = byte => {
      const value = byte & 0xff;
      // A serial byte is an EVENT: the ASK still comes before the byte reaches
      // the machine (a veto must), then TELL unconditionally on acceptance. The
      // dedup map is never touched — the same byte twice is two characters.
      const input = {time: stamp(), producer: 'z80.serial', payload: {byte: value}};
      if (!admit(input)) return false;
      const accepted = previousSendSerial(value) === true;
      if (accepted) tell(input);
      return accepted;
    };
    wrapped.rootDebugSendSerial = rawSendSerial;
    adapter.sendSerial = wrapped;
  }

  // THE PAYLOAD IS THE RECORD; THE SIGNATURE IS THE COMPARISON. One pure function,
  // used by the live record AND the replay seed on the payload each is about to
  // write, so the two cannot dedup differently. What it computes is the key that
  // decides "did the input CHANGE", which is not always the whole recorded value:
  //   buttons: identity — the RAW mask. The log says what the host sent; the
  //            machine narrows it (z80-machine.setButtons extracts its bits).
  //            The old replay path masked the seed `& 0x1f` against a raw live
  //            record — a replayed 0xFF seeded {"mask":31}, a live 0xFF signed
  //            {"mask":255}, they did not match, and a fact was recorded that
  //            never happened. R8 is that defect's regression test.
  //   keys:    order-INDEPENDENT — sort the names FOR THE SIGNATURE ONLY. The
  //            recorded payload keeps the face's order (honest), but the ULA ANDs
  //            a bit per name (zx-ula.js) so ['a','b'] and ['b','a'] are one
  //            machine state; the old signature was order-sensitive and recorded
  //            the reorder as a change that did not happen. R9 is its regression test.
  const signatureOf = (producer, payload) =>
    producer === 'z80.keys'
      ? JSON.stringify({names: [...payload.names].sort()})
      : JSON.stringify(payload);

  // THE ASK. Every admitter must accept, or the input does not happen. A verdict
  // that is not {accepted: boolean} throws (assertAdmissionVerdict) rather than
  // being read as a silent refusal.
  const admit = input => {
    for (const a of admitters) {
      if (!assertAdmissionVerdict(a(input), 'z80-debug onDebugInputAdmission').accepted) return false;
    }
    return true;
  };

  const tell = input => {
    // Each listener gets its own copy of the fact, TIME INCLUDED: a listener that
    // stored a fact and mutated it would otherwise corrupt the log for the next
    // listener (z80-replay-input.test.mjs:247). R5 is preserved by VALUE, not
    // reference — the ASK and the TELL share ONE stamp (the incrementing clock
    // makes a second stamp show as different ticks), and R5 asserts they are
    // deep-equal rather than identical, because these copies cannot be identical.
    for (const listener of inputListeners) {
      listener({...input, time: {...input.time}, payload: {...input.payload}});
    }
  };

  /**
   * A LEVEL input, in the order the eight rules fix: one stamp (era gate first),
   * the dedup read, the ASK before apply, apply, seed ON ACCEPTANCE, then TELL
   * reusing the ASK's stamp. A refused ASK writes nothing; a deduped repeat is
   * applied silently (neither asked nor told), because a held level must keep
   * reaching the machine without being recorded again.
   *
   * @param {string} producer e.g. 'z80.keys'
   * @param {string} key the dedup key
   * @param {object} payload the recorded (and, for buttons, masked) value
   * @param {() => (boolean|undefined)} apply returns false only if the machine refused
   */
  const level = (producer, key, payload, apply) => {
    const time = stamp();
    const signature = signatureOf(producer, payload);
    if (observedInputs.get(key) === signature) return apply();   // deduped: applied silently
    const input = {time, producer, payload: {...payload}};
    if (!admit(input)) return false;                             // refused ASK writes nothing
    const result = apply();
    if (result === false) return result;                         // machine refused: only a fact it TOOK is a fact
    observedInputs.set(key, signature);                          // seed on acceptance
    tell(input);
    return result;
  };

  // Call-class opcodes for step-over: CALL nn, CALL cc,nn, and RST n.
  const isCallClass = (op) => op === 0xcd || (op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7;

  // Serial (an EVENT) records with NO dedup, in the adapter wrapper above via
  // `tell` — the same byte typed twice is two characters. The old publishEvent
  // helper is gone: the wrapper is the one event path and inlines the ASK.

  return {
    capabilities() {
      // Tolerate a hollow {machine:{cpu:{}}} — several callers build this target
      // over a bare machine, and capabilities()/canVetoDebugInput must answer
      // without throwing. A machine with no checkpoint support simply records
      // nothing.
      const checkpointStatus = typeof machine.checkpointSupport === 'function'
        ? machine.checkpointSupport()
        : { supported: false, reasons: ['this machine has no checkpoint support'] };
      // The checkpoint is refused for the machine's own reasons AND for uncaptured
      // board input — ONE list, so `recording` and `checkpointRefusal` and
      // captureCheckpoint() cannot disagree about whether a checkpoint is sound.
      const checkpointRefusalReasons = [
        ...(checkpointStatus.supported ? [] : checkpointStatus.reasons),
        ...(hasUncapturedInputState() ? [UNCAPTURED_INPUT_REASON] : [])
      ];
      // extensions.inputAdmission === 'may-refuse' declares the ASK hook, which
      // canVetoDebugInput(target) reads (with m6502-debug, the first two to
      // declare it). events/spaces/fidelity describe what the shared event
      // module now publishes; runTo is backed by the code breakpoint the session
      // installs to stop at an address; recording appears only when a checkpoint
      // would actually be sound.
      return {
        steps: ['insn', 'over', 'out'], breakpoints: ['code', 'write'], timeFreezes: true,
        runTo: [{kind: 'address', space: 'code', addressMin: 0, addressMax: 0xffff,
          stopSides: ['before'], installation: 'sync'}],
        consumes: [], events: ['instruction', 'memory', 'port'],
        spaces: {mem: {read: true, write: true, passiveRead: true}},
        fidelity: {instruction: 'recorded', memory: 'reconstructed', port: 'reconstructed', cycle: 'unsupported'},
        recording: checkpointRefusalReasons.length ? [] : ['checkpoint', 'restore'],
        extensions: {
          inputAdmission: 'may-refuse',
          // Access facts are published before the same machine.step() publishes
          // its recorded retire, so the runner may defer their actions safely.
          eventBreakpointBoundary: 'instruction-retire',
          ...(checkpointRefusalReasons.length ? {checkpointRefusal: checkpointRefusalReasons} : {}),
          inputReplay: ['z80.buttons', 'z80.keys', ...(rawSendSerial ? ['z80.serial'] : [])],
          inputRefusals: [
            'tape insertion and snapshot/media loading are configuration changes, not replayable runtime inputs',
            'board-buffer input nets bypass the target and require a complete device codec'
          ]
        }
      };
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
     * The event clock, READ without advancing it. On the same `z80-cycles` base
     * as an input fact's stamp, so a consumer comparing a checkpoint against a
     * debug input fact gets one clock. (The module's own event epoch may carry a
     * different suffix after a rewind — the seam noted at the top.)
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
      // and is not — the inputs it was sampling are not in the log. Refuse rather
      // than hand back a checkpoint replayRefusalReasons() has already disowned.
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
     * and the era gate (stamp()) then clears the dedup map on the next input
     * because the domain string has changed. `ownClock`'s own rewind detection
     * cannot see a restore that lands ABOVE the last stamped tick — it reads as
     * ordinary forward motion — which is why the bump is explicit here. The
     * module's own event epoch is left to its detection: the accepted seam.
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
      if (cpu.halted) return {accepted: false, code: 'halted-without-instruction',
        reason: 'the halted Z80 cannot retire an instruction without a recorded interrupt input'};
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
        reason: 'the Z80 did not retire an instruction'};
      return {accepted: true, boundary: 'instruction', cycles: machine.cycles - before};
    },

    regs() {
      return {
        pc: cpu.pc, sp: cpu.sp,
        a: cpu.a, f: cpu.f, bc: cpu.bc, de: cpu.de, hl: cpu.hl,
        ix: cpu.ix, iy: cpu.iy, i: cpu.i, r: cpu.r,
        af_: cpu.af_, bc_: cpu.bc_, de_: cpu.de_, hl_: cpu.hl_,
        iff1: cpu.iff1, im: cpu.im, cycles: machine.cycles,
      };
    },

    /** Live disassembly (vector-length-ground; reads through the bus,
     *  so a 128K machine disassembles the PAGE the CPU actually sees). */
    disasm(addr) {
      const rd = machine.readBus ?? ((a) => machine.mem[a & 0xffff]);
      return disasmZ80((a) => rd(a & 0xffff), addr & 0xffff);
    },

    /** Normalise a code address and advance it in the Z80's 16-bit space. */
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

    /** The session's pause verb: stop executing NOW and tell the
     *  halt listeners why — same contract as a breakpoint hit. */
    halt() { halt({ cause: 'pause' }); },

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
      if (kind === 'cycle') {
        return { unsupported:
          "this Z80 core has no cycle step. Z80Machine.step() executes a whole instruction and " +
          "returns its T-state count — there is no sub-instruction state to stop in, so a cycle " +
          "step here would be an instruction step with a different label. Step one instruction; " +
          "regs().cycles reports what it cost." };
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

    /** Face-input contract, joystick side: the VdpScreen button mask
     *  onto the Kempston port. False without the interface. */
    setButtons(mask) {
      // Refuse a mask the REPLAY path would refuse (validButtonMask): a live input
      // that cannot be replayed must not be applied and recorded. Same predicate,
      // both paths — see applyReplayInput's buttons branch.
      if (typeof machine.setButtons !== 'function' || !validButtonMask(mask)) return false;
      // The recorded value is RAW — what the host sent. z80-machine.setButtons
      // narrows it to the Kempston bits; the log is not the machine's place to
      // narrow, and a masked record against a raw one is the defect R8 guards.
      return level('z80.buttons', 'buttons', {mask}, () => machine.setButtons(mask));
    },

    /**
     * Face-input contract, Spectrum flavor: key NAMES, not a button
     * mask — the ULA scans a real 8x5 matrix and the face's keyboard
     * focus routing passes held key names straight through. Returns
     * false when the machine has no ULA to receive them.
     */
    setKeys(names) {
      // Refuse a key set the REPLAY path would refuse (validKeyNames): the bound
      // is 40 keys of at most 16 chars — the ULA matrix is 8x5 — and a live set
      // that fails it must not be applied and recorded, or its own replay refuses
      // the fact it wrote. Same predicate, both paths — see applyReplayInput.
      if (!machine.ula || typeof machine.ula.setKeys !== 'function' || !validKeyNames(names)) return false;
      return level('z80.keys', 'keys', {names: [...names]}, () => { machine.ula.setKeys(names); return true; });
    },

    /**
     * A received serial byte, RECORDED on the way in.
     *
     * THIS METHOD IS THE CORRECTION. The first version of this surface refused
     * `z80.serial` by name, saying "this build has no serial input path for the
     * Z80 target". It has one: `z80-adapter.js:245`, whose own header line 14
     * calls it "sendSerial like every other serial-bearing adapter". The claim
     * was written after greping `z80-machine.js` — the file that declares the
     * clock — and not the adapter the target already holds a reference to. A
     * refusal naming a gap the build does not have is worse than an absent
     * method: an absent method is a TypeError somebody fixes, and a refusal is
     * a considered statement that the tier CANNOT do it, which a driver
     * believes.
     *
     * THE BYPASS IS NOW CLOSED, and this method no longer records. Recording
     * moved to the adapter wrapper above, so a caller reaching past this target
     * to `adapter.sendSerial` is logged too. Delegating rather than publishing
     * here is what stops a caller who DOES come through the target from being
     * logged twice.
     *
     * @param {number} byte
     * @returns {boolean} whether a chip took it
     */
    sendSerial(byte) {
      // Several callers build this target over a bare {machine}. The adapter is
      // where the serial path lives — including the CP/M mode's key queue,
      // which the target has no way to know about — so a missing adapter is a
      // refusal here rather than a chip scan reimplemented badly.
      if (typeof adapter?.sendSerial !== 'function') return false;
      return adapter.sendSerial(byte & 0xff) === true;
    },

    /**
     * The RECORD half: subscribe to host-input facts as they are observed.
     * Returns an unsubscribe function.
     *
     * Named `onDebugInput` because that is the name the recorder consumes —
     * `subscribeDebugTargetInputs` tests for it and skips a target without one.
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
      return hasUncapturedInputState() ? [UNCAPTURED_INPUT_REASON] : [];
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
     *
     * @param {(input: object) => {accepted: boolean}} admitter
     * @returns {() => void} unsubscribe
     */
    onDebugInputAdmission(admitter) {
      if (typeof admitter !== 'function') throw new TypeError('debug input admitter must be a function');
      admitters.push(admitter);
      return () => { admitters = admitters.filter(a => a !== admitter); };
    },

    /**
     * Apply a recorded host-input fact — the APPLY half of the replay surface
     * declared in debug-replay-contract.js.
     *
     * It routes through the same two methods the face uses, `setButtons` and
     * `setKeys`, rather than reaching into the machine again: a replayed input
     * taking a different path from a live one would replay something the
     * recording never captured.
     *
     * EVERY FAILURE IS A RETURN VALUE. A producer this build has no path for is
     * refused with a reason naming what is missing, not thrown — the driver
     * decides whether an unreplayable fact ends the session, and a throw would
     * be indistinguishable from the emulator breaking.
     *
     * `z80.serial` is refused HERE ON PURPOSE. A downstream copy of this target
     * routes it through an `adapter.sendSerial` this build does not have.
     * Refusing by name is the honest answer and it names the gap; accepting
     * silently would replay nothing and report success.
     *
     * @param {{producer: string, payload: object}} input a recorded fact
     * @returns {{accepted: boolean, code?: string, reason?: string}}
     */
    applyReplayInput(input) {
      const payload = input?.payload;
      if (input?.producer === 'z80.buttons') {
        if (!validButtonMask(payload?.mask)) {
          return replayRefused('invalid-replay-input', 'z80.buttons needs a safe-integer mask');
        }
        // Replay applies DIRECTLY to the machine, never through the face
        // setButtons: that method now ASKs, and replay must not ask or tell (R3).
        // THE ERA GATE RUNS FIRST — stamp() clears the dedup map on a domain
        // change, so a rewind is consumed before the seed — then the machine
        // takes the input, then the seed goes in with the RAW value through the
        // ONE signatureOf the live path uses, so a later live input of the same
        // value dedups against it. (The old path masked the seed & 0x1f against a
        // raw live record; a replayed 0xFF then failed to dedup a live 0xFF and
        // recorded a fact that never happened. R8 is that defect's regression test.)
        stamp();
        if (typeof machine.setButtons !== 'function' || machine.setButtons(payload.mask) === false) {
          return replayRefused('no-input-path', 'this machine has no joystick interface to receive a button mask');
        }
        observedInputs.set('buttons', signatureOf('z80.buttons', {mask: payload.mask}));
        return replayAccepted();
      }
      if (input?.producer === 'z80.keys') {
        const names = payload?.names;
        // Bounded on purpose (validKeyNames, the same predicate setKeys uses): a
        // recorded fact is untrusted by the time it is replayed, and the ULA
        // matrix is 8x5 — forty is every key at once, already impossible on real
        // hardware.
        if (!validKeyNames(names)) {
          return replayRefused('invalid-replay-input',
            'z80.keys needs at most 40 key names of at most 16 characters');
        }
        if (!machine.ula || typeof machine.ula.setKeys !== 'function') {
          return replayRefused('no-input-path', 'this machine has no ULA to receive key names');
        }
        // Direct apply + seed, era gate first — see the buttons branch above.
        stamp();
        machine.ula.setKeys([...names]);
        observedInputs.set('keys', signatureOf('z80.keys', {names: [...names]}));
        return replayAccepted();
      }
      if (input?.producer === 'z80.serial') {
        const byte = input?.payload?.byte;
        if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
          return replayRefused('invalid-replay-input', 'z80.serial needs a byte in 0..255');
        }
        // The adapter's UNWRAPPED method: the wrapper records, and a replayed
        // byte re-entering the log would double every byte on a second pass —
        // and on a second TARGET, if two share the adapter.
        if (!rawSendSerial) {
          return replayRefused('no-input-path',
            'this target was built without an adapter, and the serial input path '
            + 'lives there (z80-adapter.js:245)');
        }
        return rawSendSerial(byte) === true
          ? replayAccepted()
          : replayRefused('no-input-path', 'no chip in this build takes a received byte');
      }
      return replayRefused('unsupported-replay-input',
        `no replay path for producer ${input?.producer ?? '(none)'}`);
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
      // Per-voice, always an array (E6.8.11a); empty when this machine has
      // no ULA rather than null, so a caller can iterate without a guard.
      if (machine.ula && typeof machine.ula.audioTone === 'function') return machine.ula.audioTone();
      return [];
    },

    /** Insert a .TAP for the ROM fast-load trap; false without support. */
    insertTape(tapBuf) {
      if (typeof machine.insertTape !== 'function') return false;
      machine.insertTape(tapBuf);
      return true;
    },

    /** Load a 48K snapshot — the face's drag-a-file-in path. A 48K
     *  .SNA is exactly its fixed size; anything else is tried as .z80
     *  (all three header generations). Returns false on machines
     *  without a ULA or on formats that refuse (128K, junk). */
    loadSnapshot(buf) {
      if (!machine.ula) return false;
      try {
        if (buf.length === SNA_SIZE) loadSNA(machine, buf);
        else loadZ80(machine, buf);
        return true;
      } catch {
        return false;
      }
    },

    readMem(space, addr, len) {
      if (space !== 'mem') return { unsupported: `no space '${space}' on z80` };
      const rd = machine.readBus ?? ((a) => machine.mem[a & 0xffff]);
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = rd((addr + i) & 0xffff);
      return out;
    },

    writeMem(space, addr, data) {
      if (space !== 'mem') return { refused: `no space '${space}' on z80` };
      // A debugger patches what the CPU sees, ROM included — that is
      // the point of a poke. On 128K that means the mapped ROM slot
      // and the mapped page; on 48K, flat memory as always.
      const wr = machine._zx128
        ? (a, v) => {
          if (a < 0x4000) machine.roms[machine._bank.rom][a] = v;
          else machine.writeBus(a, v);
        }
        : (a, v) => { machine.mem[a & 0xffff] = v & 0xff; };
      for (let i = 0; i < data.length; i++) wr((addr + i) & 0xffff, data[i] & 0xff);
      return undefined;
    },
  };
}

export default createZ80DebugTarget;
