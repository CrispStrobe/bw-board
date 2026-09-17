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

/** A safe-integer button mask — the bound the replay path enforces, so the FACE
 *  method (setButtons) must enforce it too, or a live input the machine records
 *  is one its own replay refuses. */
export const validButtonMask = mask => Number.isSafeInteger(mask);
