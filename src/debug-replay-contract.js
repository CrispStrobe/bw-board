/**
 * Boundary D: the input-replay surface a debug target may implement.
 *
 * WHY THIS EXISTS, AND WHY IT IS A DECLARATION RATHER THAN A DESIGN. Four
 * targets in a downstream consumer already implement this surface —
 * `emu8051-adapter`, `i8086-debug`, `m6502-debug` and `z80-debug` — and three
 * drivers already consume it. It is a convention those four happen to share, not
 * an interface anything declares, and this module is the declaration. Nothing
 * here is new behaviour.
 *
 * THE SURFACE IS TWO SEPARATE CAPABILITIES, NOT ONE. A target may implement
 * either without the other, and the first version of this module was wrong to
 * require both — see the correction note at the end.
 *
 *   applyReplayInput(fact) -> outcome                        [the APPLY half]
 *     Apply a previously recorded fact. Returns an OUTCOME (below). Never
 *     throws for an input it merely does not support; that is a refusal.
 *     All four downstream implementations have this one.
 *
 *   onDebugInput(listener) -> unsubscribe                    [the RECORD half]
 *     Register a listener for host-input FACTS as they are observed. Each fact
 *     is `{time, producer, payload}`. Deduplication is the target's business —
 *     a fact is emitted when the value the machine receives actually changes.
 *     This is the name the RECORDER requires: downstream's
 *     `subscribeDebugTargetInputs` returns null for a target without it, so a
 *     target using any other name is simply not recorded.
 *
 * A REFUSAL IS A RETURN VALUE, NOT AN EXCEPTION. This is the point of the
 * module and the one thing an implementer must not get wrong. A target that
 * cannot apply a fact says so and the driver decides what to do; a target that
 * throws makes every caller wrap it, and callers that wrap it stop
 * distinguishing "this input is not supported" from "the emulator broke".
 *
 * WHY `replayOutcome` EXISTS: THREE SHAPES ARE ALREADY IN THE WILD. Measured
 * across the four existing implementations, `applyReplayInput` returns:
 *
 *   {accepted: true} / {accepted: false, code, reason}   emu8051, i8086
 *   true                                                  m6502, z80 (success)
 *   {refused, code}                                       m6502, z80 (failure)
 *
 * The downstream driver absorbs all three in a private helper, which is exactly
 * what makes the disagreement invisible — a shim that succeeds is a shim nobody
 * removes. `replayOutcome` is that normalisation, declared here instead, so the
 * shapes converge in the open. NEW implementations should return
 * `replayAccepted()` / `replayRefused()`; the legacy shapes keep working and
 * normalise identically, which is what makes adopting this a no-op commit for
 * the four that exist.
 *
 * `undefined` IS A REFUSAL, DELIBERATELY. A method that falls off the end
 * returns `undefined`, and treating that as success would accept every input a
 * target forgot to handle. It is reported as "returned no result" so the message
 * names the defect rather than the input.
 */

/** The accepted outcome. */
export const replayAccepted = () => ({accepted: true});

/**
 * A refusal, with a machine-readable code and a sentence a person can act on.
 *
 * @param {string} code stable identifier, e.g. 'unsupported-replay-input'
 * @param {string} reason what was refused and why
 * @returns {{accepted: false, code: string, reason: string}}
 */
export const replayRefused = (code, reason) => ({accepted: false, code, reason});

/**
 * Normalise any of the three shapes above into one outcome.
 *
 * @param {*} value whatever `applyReplayInput` returned
 * @param {string} [label] what was being attempted, for the message
 * @returns {{accepted: boolean, code?: string, reason?: string}}
 */
export function replayOutcome(value, label = 'replay input') {
  // A promise is not a shape, it is a contract violation: the drivers apply
  // inputs inside a synchronous replay loop and cannot await one.
  if (value && typeof value.then === 'function') {
    return replayRefused('async-replay-outcome', `${label} must be synchronous`);
  }
  if (value === undefined) {
    return replayRefused('no-replay-outcome', `${label} returned no result`);
  }
  if (value === false) {
    return replayRefused('replay-input-refused', `${label} was refused`);
  }
  if (value === true) return replayAccepted();
  if (value && typeof value === 'object') {
    if (value.accepted === false || value.refused) {
      return replayRefused(value.code || 'replay-input-refused',
        value.reason || value.refused || `${label} was refused`);
    }
    if (value.accepted === true) return replayAccepted();
  }
  // Anything else — a number, a string, an object with neither field — is not a
  // shape this contract knows. Accepting it would be guessing about a target's
  // intent, which is the failure the whole module is written against.
  return replayRefused('unknown-replay-outcome',
    `${label} returned ${typeof value}, which is not a replay outcome`);
}

/**
 * Can this target APPLY a recorded fact?
 *
 * Separate from whether a given SESSION can be replayed — see `replaySupport`.
 * A driver uses this to refuse early with a message naming the target, instead
 * of failing at the first fact.
 *
 * @param {object} target
 * @returns {boolean}
 */
export const canApplyReplayInput = target =>
  !!target && typeof target.applyReplayInput === 'function';

/**
 * Can this target RECORD its host inputs?
 *
 * A separate question from applying, and a target may do either alone. One
 * downstream target applies facts it never records: they are produced by the
 * driver rather than observed by the target.
 *
 * @param {object} target
 * @returns {boolean}
 */
export const canRecordDebugInput = target =>
  !!target && typeof target.onDebugInput === 'function';

/**
 * The two halves, reported separately.
 *
 * @param {object} target
 * @returns {{applies: boolean, records: boolean}}
 */
export const replayCapabilities = target => ({
  applies: canApplyReplayInput(target),
  records: canRecordDebugInput(target)
});

/**
 * Can this target replay, and if not, why not — as a LIST.
 *
 * TWO KINDS OF REFUSAL SHARE ONE MECHANISM, AND THAT IS THE DESIGN. A single
 * boolean cannot carry both, because one is a fact about the TARGET and the
 * other a fact about the WIRING:
 *
 *   static, per target   — this emulator cannot serialise its in-flight state
 *                          at all (a WASM ABI that exposes no snapshot).
 *   dynamic, per session — it can, but a live board changes input nets outside
 *                          the debug target, so a restored run would silently
 *                          diverge from the recorded one.
 *
 * Reasons are therefore a list contributed from more than one place, and a
 * target with neither problem returns `{supported: true, reasons: []}`. A new
 * refusal kind is a new entry, not a new field.
 *
 * @param {object} target
 * @param {string[]} [reasons] caller-supplied reasons (topology, wiring, …)
 * @returns {{supported: boolean, reasons: string[]}}
 */
export function replaySupport(target, reasons = []) {
  const missing = [...reasons];
  // Only the APPLY half is required to replay. Recording is what produced the
  // facts; a target handed facts from elsewhere can still replay them.
  if (!canApplyReplayInput(target)) {
    missing.push('the target does not implement applyReplayInput');
  }
  return missing.length ? {supported: false, reasons: missing}
    : {supported: true, reasons: []};
}

/**
 * Turn an unsupported `replaySupport` result into a refusal outcome.
 *
 * @param {{supported: boolean, reasons: string[]}} support
 * @returns {{accepted: false, code: string, reason: string, details: object}}
 */
export const replaySupportRefusal = support => ({
  ...replayRefused('replay-unsupported', support.reasons.join('; ')),
  details: {reasons: [...support.reasons]}
});

/**
 * CORRECTION, recorded rather than silently applied.
 *
 * The first version of this module named the record half `onInput` and required
 * BOTH halves for a target to count as implementing the surface. Both were
 * wrong, and measuring the four downstream implementations is what showed it:
 *
 *   emu8051-adapter  applyReplayInput + onInput
 *   z80-debug        applyReplayInput + onDebugInput
 *   m6502-debug      applyReplayInput + onDebugInput
 *   i8086-debug      applyReplayInput only
 *
 * So requiring both would have refused three of the four, and the name it
 * required is the one the RECORDER does not consume: downstream's
 * `subscribeDebugTargetInputs` tests for `onDebugInput` and returns null
 * without it, which makes `emu8051-adapter.onInput` reachable only from that
 * target's own tests. The first version was written from one implementation's
 * vocabulary and generalised — the same error, one layer up, as counting one
 * word to find a subsystem.
 *
 * `onDebugInput` is therefore the declared name: it is the one with a consumer.
 * The odd target out is a divergence for the upstreaming to resolve, not a
 * second name for this module to bless.
 */
