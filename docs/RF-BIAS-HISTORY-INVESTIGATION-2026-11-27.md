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
