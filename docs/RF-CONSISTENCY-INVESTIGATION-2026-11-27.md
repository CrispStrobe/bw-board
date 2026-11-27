# RF consistency investigation — unqualified checkpoint

This branch is an investigation checkpoint, **not an approved supplier pin**.
It starts at Board master `d21d6d8b819263eb08231134b7556efa82289a90`.
No existing radio tolerance, oracle, or supplier fixture has been changed.

## Demonstrated defect

The previous nonlinear correction scaled every port with one scalar and
equated only their combined norm. For two disconnected channels obeying
`C dX_q/dt + g(|X_q|) X_q = J_q`, with `C = 1 nF` and
`g(A) = 100 nS exp(A / 25.85 mV)`, an unrelated decay from 200 mV moved an
exact 50 mV equilibrium to 38.028482494 mV in a 16.384 us step. The equilibrium
is exact when integrated alone or with the nonlinear correction disabled.
The regular step controller accepted that corrupted step.

The added test solves each scalar backward-Euler/BDF2 equation independently
by bisection. It covers an exact equilibrium, separate changing channels,
carrier-phase and ordering invariance, nonlinear capacitance history, and a
negative control whose consistent root lies outside the permitted step.

## Current experiment

The candidate solves a bounded vector of port amplitudes. Nonlinear law
blocks are declared by the radio assembly, then combined with nonzero
linear port response into independent components. No coupling threshold
drops weak physical connections. Components retain their own start stamps
when their root lies outside the permitted interval, so such a component
cannot suppress an unrelated valid correction.

All five new focused tests pass. The mixed-law test first failed the initial
vector candidate because one component's fallback discarded the other's
valid correction; the partitioned version corrects that defect. The existing
VHF Colpitts swing, frequency, continuity and substep-cost guard also passes.

## Qualification blockers

The first vector candidate, before the component partition, completed the
six radio suites (`radio-envelope-bands`, `radio-front-end`, `radio-mixing`,
`radio-currents`, `radio-fm-impulse`, `radio-skywave`) with **58/65 cases passing**.
Failures include a Meissner peak of 46.26 V against its existing <12 V limit,
quench collapse, the 1-ulp physical stability check, a keyed transmitter,
harmonic output, collector current, and an exact deterministic trajectory.
The unchanged baseline passes the collector-current test that this candidate
fails. These failures are not approved oracle updates. The partitioned
candidate has not repeated the whole six-suite qualification.

The original supplier fixture (Board `de8083c5a894a49c9fa4c6f0fb6f8866e2d758c0`,
CUI `ee2b4127a88f1b308f8d749cae4d7c1db1deae9e`) reproduced the reported
1170.56856 Hz speaker crossing count in the 2–5 ms window. Read-only phasor
history shows an LO that bursts to volts then collapses to microvolts while
transmitter RF remains around 0.1–0.2 V. The later 5–8 ms window is also
nonstationary. The first vector candidate still bursts and gives about
1505 Hz in the original window. Neither measurement supports weakening the
5830 +/-600 Hz whistle assertion or merely moving its observation window.

The next experiment will isolate cross-device norm coupling while preserving
the reviewed correction within a single device's coupled junction ports.
Upstream qualification and physical/negative controls remain required before
any supplier fixture adoption.

## Focused reproduction

```sh
node --test test/rf-band-consistency.test.mjs
node --test --test-name-pattern='VHF Colpitts oscillator holds its swing' test/radio-envelope-bands.test.mjs
node --test test/radio-currents.test.mjs
```

The first two commands pass on this checkpoint. The current-vector
collector-current regression remains a blocker, not a passing claim.
