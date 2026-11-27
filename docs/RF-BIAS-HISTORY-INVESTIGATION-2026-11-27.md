# RF bias history repair — unqualified checkpoint

This checkpoint identifies and repairs one history-contract defect. It is
**not qualified for adoption**: the existing keyed-transmitter work limit
still fails. No circuit, physical assertion, tolerance, refusal limit, or
work ceiling is changed here.

## Demonstrated defect

Base: `b47e7e09ed873b33ca2fd912b21e136decc5e677`.
`RadioFrontEnd.onAccepted()` updates the operating point and says obsolete
RF look-ahead is discarded. The old `RfBand.prune()` only discarded past
entries; it retained both the rejected trial's future and its final `X/t`.
Several accepted bias updates could therefore leave the same old-bias RF
future in place. Board's full-step/two-half-step error estimate also uses
that common RF forcing and does not independently measure this coupling
error.

A read-only 2 ms startup of the original supplier Meissner circuit measured
an active old-bias future as long as 70.106 microseconds, against the band's
1.024 microsecond inner-loop step and 33.039 microsecond tank time constant.
At accepted time 368.418 microseconds, RF remained at 438.524 microseconds
through subsequent accepted bias updates. The maximum future over the full
startup was 121.057 microseconds.

## Narrow candidate and independent controls

The candidate retains the accepted interpolation bracket and its one extra
Catmull–Rom neighbour, discards any more distant future, and restores the
exact retained complex grid state. It neither interpolates `X` onto the
transient grid nor adds a global outer-step ceiling. Impulses contained
only in discarded state become eligible for their replacement integration;
already retained impulses remain consumed.

`test/radio-bias-history.test.mjs` has **4/4 passing** controls. The same
tests with the original `prune()` body give **1 pass / 3 failures**:

- Rejected future must not survive acceptance; retained grid state and
  complex phase are unchanged.
- A complex RC envelope follows a switched conductance. The independent
  continuous solution is 0.0837432 V; the old future reports 0.223142 V.
  Refining the retained grid improves agreement. The allowance accounts
  explicitly for two interpolation intervals, BDF2's half-interval
  derivative-history delay at the switch, and its start error.
- An impulse lost with discarded future must be eligible again, without
  duplicating an impulse already in retained state.
- An acceptance with no surplus future leaves continuation state untouched.

## Outstanding gates and limits

The unchanged keyed-transmitter control measures **2436 solves/ms** with
this first repair, above its existing **1800 solves/ms** ceiling. Its
amplitude assertions pass. The deterministic single-oscillator fingerprint
also moves from 949 to 1042 solves; its old fingerprint is preserved while
the algorithm remains under investigation. A justified fingerprint update
would require final repeatability evidence and does not authorize changing
any physical or cost limit.

The 2 ms supplier startup regains quiet RF segments with this repair, but
that short attribution probe is not a settled waveform or frequency
qualification. A public 1 microsecond outer cap also changes the original
circuit from steady RF to bursts, at substantially higher work. Finer outer
steps have not established coupled convergence; one finer run refused RF
runaway. Inner-grid-only refinement never established outer-coupling
convergence. The supplier's historical 820 Hz expectation remains
unqualified, and no replacement is adopted by this checkpoint.

The remaining work is bounded: preserve the direct history controls, remove
unnecessary continuation work without hiding bias changes, pass the keyed
cost gate and existing physical controls, then establish the coupled
supplier behavior independently. This checkpoint makes no merge claim.

## Follow-up measurements (second agent, same day) — still unqualified

The repair itself is unchanged. A fifth control,
`the RC-envelope witness separates the switched-bias solution from the
stale-history one`, checks the band against both closed forms
(e^-2.48 = 0.0837432 V switched, e^-1.5 = 0.2231302 V stale): the repaired
prune passes; the original prune body fails it (0.2231309 V).

### The keyed-transmitter cost is path-dependent, not recomputation

Measured on the keyed fixture (`test/fixtures/rf-remote-netlist.json`,
11–13 ms, local macOS arm64, Node 26):

| Variant | solves/ms | band substeps/ms | band k |
| --- | ---: | ---: | --- |
| original prune (master) | 1126–1237 | 977 | 10 |
| repaired prune | 2436–2463 | 2225 | 9 |
| repaired prune only for discards > 20 µs ahead | 2338 | 1953 | 9 |
| repaired prune until 10.1 ms, original prune after (0 discards in window) | 2296 | 1953 | 9 |
| original prune until 10.1 ms, repaired prune after (102 discards in window) | 1042 | 1062 | 10 |

The extra work is therefore not re-integration of discarded futures. Five
early discards (one at keying, 10.005/10.02 ms) change the startup path.
On that path `_kForBias` sees the band unstable during build-up
(`_tUnstable` = 10.043 ms); on master's path it never does
(`_tUnstable` = -Infinity). Detection engages the loop clamp
(`_loopK` = 9) for `ACTIVE_HOLD_SEC`, as designed. At k = 9 this
class-C band carries a sustained 4-substep (≈2 µs) magnitude ripple of
about 0.3 % on the 5.9 V collector port (k = 8: decays within a few
substeps; k = 10: smaller, irregular). The emitter node follows that ripple,
and the transient controller's error estimate on it (`n5`) halves the outer
step. Forcing the clamp on master's path gives 2396 solves/ms; disabling it
on the expensive path gives 1257; forcing k = 8 gives 185–220. With outer
steps capped at 1 µs and 0.25 µs, original and repaired prunes produce the
same emitter trace (±1.2 mV, no wander), so the wander is numerical.
The existing 1800 solves/ms ceiling was measured on the path where the
instability was never detected.

`LOOP_STEPS` 64 (k = 8 here) passes the keyed gate (185 solves/ms) and every
other `radio-envelope-bands` case except the fingerprint (1843 solves). It
was **not adopted**: it raises the Meissner noise start from 1.9 s to 44 s and
the short-wave oscillator from 8 s to 37 s locally, and no convergence
argument fixes 64 rather than another value.

### The runaway control becomes ~1000x slower

`an RF band that runs away is refused` takes 0.64 s on master and about
600 s with the repair (local, loaded machine). On master the overdriven
(ratio 1.074) transmitter never starts: its bands sit at k = 14 with
20–30 µs of old-bias future retained after every accepted step. With the
repair it starts, runs away, is refused, and the remaining bands then force
very small outer steps; the outcome also depends on the advance chunking
(refusal at 0.0263 ms with 5 µs advances, 0.0355 ms with 50 µs advances).

### Meissner supplier scenario (sb3 `lab-meissner-squegg`)

Repair plus `LOOP_STEPS` 64, sb3 test unchanged: steady 8.8947 V (passes),
reversed silent (passes), squegging RF 2.3e-5–10.25 V (quiet bound passes),
detector 1.90–4.43 V, but the earphone tone is 2197 Hz against the
asserted 820 ± 250 Hz. A separate burst count over 6–9 ms gives 2151 Hz at
the default step and 1980 Hz with a 1 µs outer cap; 0.5 µs and 0.25 µs caps
refuse an RF runaway at 0.78 ms and 0.29 ms (the same early runaway the
sb3 receipt records at 62.5 ns). The repair alone (default `LOOP_STEPS`)
measures 2160 Hz. No converged tone exists, so the 820 Hz assertion is
neither confirmed nor replaceable from this evidence.

### Status

Not qualified for merge: the keyed cost gate and the fingerprint fail, and
the runaway control's run time is not acceptable. Each of these follows from
the repair removing a masking effect (missed instability detection, an
oscillator that never started), not from loosened behaviour in the repair.
