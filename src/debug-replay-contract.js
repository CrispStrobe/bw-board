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
 *     A LISTENER'S RETURN VALUE IS IGNORED, always. The veto is NOT a return
 *     value on this hook — it is a separate hook, `onDebugInputAdmission`, so a
 *     recorder that only wants facts cannot accidentally veto by returning one,
 *     and a target need not ask which meaning a return carries.
 *
 *   onDebugInputAdmission(admitter) -> unsubscribe           [the ASK half]
 *     Register an admitter consulted BEFORE the input reaches the machine. It
 *     returns `{accepted: boolean}` — validated by `assertAdmissionVerdict`,
 *     which THROWS on anything looser, because a loose return here silently
 *     refuses every input (see that function). A refused ASK writes nothing: no
 *     fact, no dedup seed, no machine mutation, so a log never contains an input
 *     the machine did not take. A target that has this hook declares
 *     `capabilities().extensions.inputAdmission === 'may-refuse'`; see
 *     `canVetoDebugInput`. A target without it applies every input (fire and
 *     forget), which is the majority.
 *
 * A FACT IS STAMPED AT ARRIVAL — before apply, and the ASK and the TELL share
 * that one stamp. Not a style choice: an admitter refuses on the input's TIME,
 * and the recorded fact is what a replay re-presents to it, so the recorded time
 * must be the time the admitter read. If the ASK decided on the arrival time and
 * the TELL wrote the post-apply time, the log would hold a timestamp no admitter
 * ever approved, and replaying it would ask a different question than the run
 * answered — a log you cannot re-ask is a log you cannot replay through the veto.
 * It is also ONE convention for every producer: before the ASK existed an event
 * stamped on the FAR side of its own apply and a level on the near side,
 * indistinguishable except on an input whose apply costs cycles (an NMI), where
 * it read as a property of that producer rather than a second convention.
 * Arrival-time makes the log say one thing about time, and puts an input fact
 * before the facts its effect produces rather than after them.
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
 * Validate an ADMISSION verdict from an `onDebugInputAdmission` admitter, STRICTLY.
 *
 * The admission hook is the ASK half (below): a target calls its admitters BEFORE
 * applying a host input and does not apply it if one refuses. Unlike
 * `replayOutcome`, which normalises three legacy shapes because four
 * implementations predate this module, an admitter is NEW surface and a loose
 * return is a defect rather than a dialect. The failure it prevents is specific
 * and silent: `onDebugInput` and `onDebugInputAdmission` differ by one word and
 * both take a function, so a TELL-shaped listener registered on the ASK hook
 * returns `undefined` — and if `undefined` were read as a refusal, every input
 * would be silently declined, the recorder would record nothing, and the replay
 * would be perfectly self-consistent with itself. A confident null with the
 * volume turned up. So anything that is not an object with a boolean `accepted`
 * THROWS, naming the admitter; nothing loose is accepted, not bare `true`.
 *
 * @param {*} verdict whatever the admitter returned
 * @param {string} label identifies the admitter in the message
 * @returns {{accepted: boolean}} the verdict, when valid
 */
export const assertAdmissionVerdict = (verdict, label) => {
    if (!verdict || typeof verdict !== 'object' || typeof verdict.accepted !== 'boolean') {
        const seen = verdict === null ? 'null'
            : typeof verdict === 'object' ? JSON.stringify(verdict)
                : `${typeof verdict} ${String(verdict)}`;
        throw new TypeError(
            `admission verdict from ${label} must be an object with a boolean \`accepted\`, got ${seen} — `
            + 'a loose return on the ASK hook (onDebugInputAdmission) would silently refuse every input');
    }
    return verdict;
};

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
 * Does this target let a RECORD listener REFUSE an input?
 *
 * WHY THIS EXISTS. The module said nothing about what a listener's return value
 * meant, and two different answers were already in the wild. Measured across
 * the implementations:
 *
 *   fire-and-forget   the return is discarded; the input reaches the machine
 *                     whatever the listener says. Every target in this tree.
 *   veto              a listener returning `false` or `{accepted: false}` stops
 *                     the input reaching the machine at all — "if it cannot be
 *                     recorded, it does not happen". Two targets in a
 *                     downstream consumer.
 *
 * A recorder's listener that RETURNS something — and the one in the wild does,
 * `input => !status().active || appendInput(input)` — is therefore honoured by
 * some targets and silently discarded by others, with no way to ask which. Same
 * code, two meanings, no signal. That is the hole; the predicate is the signal.
 *
 * IT IS NOT A REQUIREMENT AND CANNOT BECOME ONE. A veto needs a moment BEFORE
 * the input reaches the machine, and not every target has one: `emu8051-adapter`
 * publishes its facts at the instant the emulated core READS a pin, so its facts
 * are observations of a read already in flight. Refusing there would mean
 * declining to answer a read the CPU has issued, which is not an operation.
 *
 * ONCE A TRADE, NO LONGER. The first version of this recorded that a veto and a
 * clean log were mutually exclusive: making a veto possible meant publishing
 * BEFORE applying, and that is also what let a log contain an input the machine
 * then refused — a button press on a board with no VIA logged, and replaying
 * that log aborting on the refusal. The two-hook shape retires the trade. The
 * veto is now the ASK half (`onDebugInputAdmission`), a DRY RUN consulted before
 * apply that records nothing when it refuses; the fact is the TELL half
 * (`onDebugInput`), emitted AFTER the machine accepts. So a target can have both
 * a veto and a log in which every entry is an input the machine took — the veto
 * no longer costs the clean log. This still reports what a target DOES, not what
 * it should: a fire-and-forget target has no ASK hook and is not lying about one.
 *
 * THIS PREDICATE INVOKES THE TARGET, and its siblings do not. `canApplyReplayInput`
 * and `canRecordDebugInput` ask a STRUCTURAL question — is there a method — that
 * inspection answers. Whether a return value is honoured is BEHAVIOURAL and
 * inspection cannot see it, so it has to be declared and the declaration has to
 * be read. A `capabilities()` that throws answers false rather than propagating,
 * because a predicate that throws would break the one rule this module exists to
 * state.
 *
 * @param {object} target
 * @returns {boolean}
 */
export function canVetoDebugInput(target) {
  if (!canRecordDebugInput(target) || typeof target.capabilities !== 'function') return false;
  try {
    return target.capabilities()?.extensions?.inputAdmission === 'may-refuse';
  } catch {
    return false;
  }
}

/**
 * The capabilities, reported separately.
 *
 * @param {object} target
 * @returns {{applies: boolean, records: boolean, vetoes: boolean}}
 */
export const replayCapabilities = target => ({
  applies: canApplyReplayInput(target),
  records: canRecordDebugInput(target),
  vetoes: canVetoDebugInput(target)
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
  // THE TARGET CONTRIBUTES ITS OWN DYNAMIC REASONS, and this is what makes the
  // list more than a formality. The doc above names the case: a live board
  // changes input nets OUTSIDE the debug target, so a restored run diverges
  // from the recorded one. Only the target knows whether it is in that state,
  // and a caller cannot be expected to ask — the whole failure this closes is
  // a driver offering a replay nobody told it was unsafe.
  //
  // Optional, and absence is not a refusal: a target that does not implement it
  // is one with no session-scoped reason to give.
  if (typeof target?.replayRefusalReasons === 'function') {
    try {
      for (const reason of target.replayRefusalReasons() ?? []) {
        if (typeof reason === 'string' && reason) missing.push(reason);
      }
    } catch {
      // A target that throws while being asked is not thereby supported: the
      // one rule this module states is that a refusal is a return value, and a
      // question that cannot be answered is not an answer of yes.
      missing.push('the target failed while reporting its replay refusal reasons');
    }
  }
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
