/**
 * Shared INPUT-ADMISSION machinery for the boundary-D debug bridges (z80, m6502,
 * and any core whose target records host inputs for replay).
 *
 * WHY THIS IS ONE MODULE. z80-debug.js and m6502-debug.js each carried a copy of
 * the same admission flow — the injectable input-fact clock, the era gate, the
 * ASK/TELL split, the dedup read/seed. They were built identical, but a rule that
 * lives in two files drifts: the soundness pass of 2026-09-11 fixed A (a validity
 * bound present on the replay path and missing on the live one) and B (a
 * checkpoint gate whose reason and enforcement had two homes) by applying the
 * IDENTICAL fix to both bridges, twice. One implementation makes that class of
 * drift impossible — the same reason instruction-debug-events.js is one module
 * for the EVENT side. This is the INPUT side of that same seam.
 *
 * The two kinds of fact still share a domain BASE and not an epoch counter with
 * the event module — see the seam note in each bridge; this module owns the INPUT
 * epoch only.
 *
 * @module
 */
import { assertAdmissionVerdict } from './debug-replay-contract.js';

/**
 * @param {object} opts
 * @param {{cycles: number, clockHz: number}} opts.machine the machine whose clock stamps input facts
 * @param {{unloggedBoardInputs?: () => boolean}} [opts.adapter] the adapter, for the uncaptured-input gate
 * @param {string} opts.domainBase the input-fact clock's domain, e.g. 'z80-cycles'
 * @param {(producer: string, payload: object) => string} opts.signatureOf what "the same input" means, per producer
 * @param {string} opts.admitLabel names this target in a bad-verdict TypeError
 * @param {string} opts.uncapturedInputReason the replay/checkpoint refusal text when a board samples unlogged inputs
 * @param {() => {ticks: number|bigint, domain: string, hz: number}} [opts.injectedClock] an integration's own clock
 */
export function createInputAdmission({
  machine, adapter, domainBase, signatureOf, admitLabel, uncapturedInputReason, injectedClock,
}) {
  const observedInputs = new Map();
  let inputListeners = [];
  let admitters = [];
  let inputTimeEpoch = 0;
  let lastTicks = null;
  let lastDomain = null;

  /**
   * The input-fact clock's domain name, READ without advancing the clock.
   * captureCheckpoint() and debugTime() stamp with it, and a reader comparing two
   * facts must be able to tell an epoch apart.
   */
  const eventDomain = () =>
    inputTimeEpoch ? `${domainBase}-rewind-${inputTimeEpoch}` : domainBase;

  /**
   * THE CLOCK IS INJECTABLE, AND THE EPOCH IS DERIVED RATHER THAN OWNED.
   *
   * An integrator can hand this target the clock the rest of that integration
   * already uses (opts.debugTime), so a downstream consumer gives this target's
   * checkpoints and instruction events a SHARED epoch; a record half carrying its
   * own would put one machine on two timelines, with a replayer comparing domains
   * by equality seeing two runs where there is one. The default is this target's
   * own clock below, so a standalone target behaves exactly as before. With a
   * clock injected the domain string is a property of the INTEGRATION, not this
   * target — a test asserting `<base>-rewind-N` describes the DEFAULT wiring.
   */
  const ownClock = () => {
    const ticks = machine.cycles;
    // The only rewind these machines have is loadState (cycles = s.cycles).
    if (lastTicks !== null && ticks < lastTicks) inputTimeEpoch++;
    lastTicks = ticks;
    return { ticks, domain: eventDomain(), hz: machine.clockHz };
  };
  const clock = typeof injectedClock === 'function' ? injectedClock : ownClock;

  /**
   * Take the stamp, and CLEAR THE DEDUP MAP WHENEVER THE ERA CHANGES.
   *
   * The map must not survive a rewind: hold 'a', snapshot, run on, press 'b',
   * restore, then press 'b' again in the restored era — a genuine a→b transition
   * DROPPED, because the map still remembered 'b' from the timeline that no longer
   * exists. The signal is the DOMAIN STRING, not a tick regression: an injected
   * clock may know about a rewind this target cannot see (a downstream one bumped
   * explicitly by restoreCheckpoint), so watching the domain inherits every
   * trigger the clock has. That is also why the era gate lives HERE and not inside
   * ownClock — an injected clock is not ours to put a side effect in.
   *
   * UNCOVERED, stated not hidden: a clock whose own detection is deferred leaves a
   * window where a rewind has happened and the domain has not moved yet; an input
   * arriving inside it is stamped on the old era. Narrower than detecting nothing.
   */
  const stamp = () => {
    const time = clock();
    if (lastDomain !== null && time.domain !== lastDomain) observedInputs.clear();
    lastDomain = time.domain;
    return time;
  };

  /**
   * THE ASK. Every admitter must accept, or the input does not happen. A verdict
   * that is not {accepted: boolean} throws (assertAdmissionVerdict) rather than
   * being read as a silent refusal.
   */
  const admit = input => {
    for (const a of admitters) {
      if (!assertAdmissionVerdict(a(input), admitLabel).accepted) return false;
    }
    return true;
  };

  /**
   * TELL every input listener, each getting its OWN copy of the fact, time
   * included: a listener that stored a fact and mutated it would otherwise corrupt
   * the log for the next listener. The ASK and the TELL share one stamp (the
   * incrementing clock makes a second stamp show as different ticks), so the
   * copies are deep-equal, not identical, and callers assert value not reference.
   */
  const tell = input => {
    for (const listener of inputListeners) {
      listener({ ...input, time: { ...input.time }, payload: { ...input.payload } });
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
   * @param {object} payload the recorded value
   * @param {() => (boolean|undefined)} apply returns false only if the machine refused
   */
  const level = (producer, key, payload, apply) => {
    const time = stamp();
    const signature = signatureOf(producer, payload);
    if (observedInputs.get(key) === signature) return apply();   // deduped: applied silently
    const input = { time, producer, payload: { ...payload } };
    if (!admit(input)) return false;                             // refused ASK writes nothing
    const result = apply();
    if (result === false) return result;                         // machine refused: only a fact it TOOK is a fact
    observedInputs.set(key, signature);                          // seed on acceptance
    tell(input);
    return result;
  };

  /**
   * REPLAY seeds the dedup map DIRECTLY (never through the ASK/TELL of `level`),
   * through the ONE `signatureOf` the live path uses, so a later live input of the
   * same value dedups against the replayed one. The caller runs the era gate
   * (`stamp`) BEFORE it applies to the machine and seeds AFTER — the map write is
   * pure, the era gate is a separate call, matching the live order.
   */
  const seed = (key, producer, payload) => observedInputs.set(key, signatureOf(producer, payload));

  /** A restore is a BRANCH in history: open a fresh input epoch so a fact after it
   *  names a different timeline. ownClock's own detection cannot see a restore
   *  that lands ABOVE the last stamped tick, which is why the bump is explicit. */
  const openEpochOnRestore = () => {
    inputTimeEpoch++;
    lastTicks = machine.cycles;
  };

  /**
   * ONE PREDICATE for uncaptured board input, read by replayRefusalReasons AND the
   * checkpoint gate so the reason and the enforcement cannot disagree. A board
   * sampling input nets does so OUTSIDE the target, so those inputs are not in the
   * log and a checkpoint over them replays into a divergence: refuse, do not merely
   * mention it. (The gate once read the machine's `_unloggedBoardInputs`; the
   * adapter sync onto unloggedBoardInputs() retired that flag, so it reads the
   * accessor here.)
   */
  const hasUncapturedInputState = () => adapter?.unloggedBoardInputs?.() === true;

  const onDebugInput = listener => {
    if (typeof listener !== 'function') throw new TypeError('debug input listener must be a function');
    inputListeners.push(listener);
    return () => { inputListeners = inputListeners.filter(l => l !== listener); };
  };
  const onDebugInputAdmission = admitter => {
    if (typeof admitter !== 'function') throw new TypeError('debug input admitter must be a function');
    admitters.push(admitter);
    return () => { admitters = admitters.filter(a => a !== admitter); };
  };

  return {
    eventDomain, stamp, admit, tell, level, seed, openEpochOnRestore,
    hasUncapturedInputState, uncapturedInputReason, onDebugInput, onDebugInputAdmission,
  };
}

/**
 * Shared CHECKPOINT/REPLAY methods for the boundary-D bridges. The same drift the
 * input side had lived here too: debugTime/captureCheckpoint/restoreCheckpoint were
 * byte-identical copies in z80-debug.js and m6502-debug.js, and the checkpoint
 * refusal gate (B, above) had to be fixed in both. Only replayInstruction genuinely
 * differs per CPU, and only in three places — the halt predicate and two reason
 * strings — so those are parameters and the skeleton is shared.
 *
 * These read the SAME `admission` the input side owns, so a checkpoint and a debug
 * input fact carry one event clock (admission.eventDomain), and the uncaptured-input
 * gate (admission.hasUncapturedInputState / uncapturedInputReason) has one home for
 * both the replay-refusal reasons and the checkpoint refusal.
 *
 * @param {object} opts
 * @param {{cycles:number, clockHz:number, captureCheckpoint:Function, restoreCheckpoint:Function, checkpointSupport:Function, step:Function}} opts.machine
 * @param {{eventDomain:Function, hasUncapturedInputState:Function, uncapturedInputReason:string, openEpochOnRestore:Function}} opts.admission the return of createInputAdmission
 * @param {() => boolean} opts.isHalted whether the CPU cannot retire an instruction without a recorded wake input
 * @param {string} opts.haltReason the refusal text when isHalted()
 * @param {string} opts.notRetiredReason the refusal text when a step retires no instruction
 * @param {() => void} opts.resetWatch clears the bridge's live watch latch (replay must not arm a future halt)
 */
export function createCheckpointMethods({
  machine, admission, isHalted, haltReason, notRetiredReason, resetWatch,
}) {
  return {
    /**
     * The machine's clock, reported as this target's EVENT clock (the debug clock,
     * not the machine's base time), so a consumer comparing it against a debug fact
     * gets one clock, not two.
     */
    debugTime() {
      return { ticks: machine.cycles, domain: admission.eventDomain(), hz: machine.clockHz };
    },

    /**
     * A checkpoint of the machine, stamped with the event clock. A snapshot over
     * unlogged board inputs restores a machine that looks right and is not — the
     * inputs it was sampling are not in the log — so refuse rather than hand back a
     * checkpoint replayRefusalReasons() has already disowned.
     */
    captureCheckpoint() {
      if (admission.hasUncapturedInputState()) {
        return { code: 'INCOMPLETE_CHECKPOINT_STATE', refused: admission.uncapturedInputReason };
      }
      const checkpoint = machine.captureCheckpoint();
      if (!checkpoint.refused) {
        checkpoint.time = { ticks: machine.cycles, domain: admission.eventDomain(), hz: machine.clockHz };
      }
      return checkpoint;
    },

    /**
     * Restore, and OPEN A FRESH EPOCH on success. A restore is a branch in history,
     * not permission to run the clock backwards: renaming the domain stops two facts
     * from different timelines being read as one that jumped, and the era gate then
     * clears the dedup map on the next input because the domain string has changed.
     * (openEpochOnRestore lives on the admission because ownClock's own rewind
     * detection cannot see a restore that lands ABOVE the last stamped tick.)
     */
    restoreCheckpoint(checkpoint) {
      if (admission.hasUncapturedInputState()) {
        return { code: 'INCOMPLETE_CHECKPOINT_STATE',
          refused: 'cannot restore over a live board input source sampled outside the machine' };
      }
      const result = machine.restoreCheckpoint(checkpoint);
      if (!result) { admission.openEpochOnRestore(); }
      return result;
    },

    /** Execute one complete instruction for checked history replay. */
    replayInstruction() {
      const support = machine.checkpointSupport();
      if (!support.supported) return {accepted: false, code: 'unsupported-replay',
        reason: support.reasons.join('; ')};
      if (isHalted()) return {accepted: false, code: 'halted-without-instruction',
        reason: haltReason};
      const before = machine.cycles;
      let cycles;
      resetWatch();
      try {
        cycles = machine.step();
      } finally {
        // Replay reconstructs history; it must not arm a future live halt.
        resetWatch();
      }
      if (!(cycles > 0)) return {accepted: false, code: 'instruction-not-retired',
        reason: notRetiredReason};
      return {accepted: true, boundary: 'instruction', cycles: machine.cycles - before};
    },
  };
}

/** A safe-integer button mask — the bound the replay path enforces, so the FACE
 *  method (setButtons) must enforce it too, or a live input the machine records
 *  is one its own replay refuses. */
export const validButtonMask = mask => Number.isSafeInteger(mask);
