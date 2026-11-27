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

The current candidate retains the reviewed scalar mode correction within
one nonlinear device's coupled ports (BJT BE/BC, MOS GS/DS, and mixer ports).
It gives separate devices separate scales. The linear response and declared
constitutive blocks identify connected components without discarding weak
coupling. Coupled device corrections are iterated and checked separately;
unresolved interaction asks the caller to retry a shorter step. An
out-of-range root keeps only its own device's original start stamps.

This is a scoped mode stabilization, not a claim of exact fully implicit
integration for every individual junction voltage. A discarded first
experiment used independent per-port amplitude boxes. A shadow step at the
same baseline Meissner state (158.977 us, k=8) demonstrated why that changed
the model: BE/BC began at [0.18131, 7.93637] V, the explicit end was
[0.21795, 8.66741] V, and the reviewed coupled-mode correction gave
[0.22297, 8.42563] V. Collector limiting legitimately needed BE to move
beyond its individual explicit box while the block norm decreased.

All six new focused tests pass. They include a mixed-law negative (one
independent root lies outside its allowed change) and a coupled passive
network whose exact KCL root is manufactured independently of the solver.
The coupled witness runs with 0, 1 pS and 10 uS coupling and swapped ordering.
The existing exact single-Meissner trajectory/step-count golden is unchanged
and passes, as do its headroom, quench and 1-ulp controls and the VHF swing,
frequency, continuity and substep-cost guard.

## Qualification blockers

The first vector candidate completed the six radio suites with 58/65 cases
passing and failed headroom, quench collapse, physical stability, current
and trajectory checks. It was checkpointed as unqualified and superseded.

The current device-block candidate completes the same six suites
(`radio-envelope-bands`, `radio-front-end`, `radio-mixing`, `radio-currents`,
`radio-fm-impulse`, `radio-skywave`) with **64/65 cases passing**. The remaining
failure is the keyed transmitter cost guard: 3243 transient solves per
simulated ms against the unchanged <1800 limit. Its RF amplitude and
steadiness assertions pass. No existing oracle has been changed.

The original supplier fixture (Board `de8083c5a894a49c9fa4c6f0fb6f8866e2d758c0`,
CUI `ee2b4127a88f1b308f8d749cae4d7c1db1deae9e`) reproduced the reported
1170.56856 Hz speaker crossing count in the 2–5 ms window. Read-only phasor
history shows an LO that bursts to volts then collapses to microvolts while
transmitter RF remains around 0.1–0.2 V. The later 5–8 ms window is also
nonstationary. The first vector candidate still burst and gave about 1505 Hz. The current
block candidate maintains a roughly 5.79 V LO at 5 ms, but the original
window's speaker crossing count is about 3177 Hz. The whistle is therefore
still unqualified. These observations do not support weakening the
5830 +/-600 Hz assertion or merely moving its observation window.

Next steps are to resolve the keyed-transmitter cost regression and inspect
the remaining mixer settling/phase behavior. Upstream qualification and
physical/negative controls remain required before any supplier adoption.

## Focused reproduction

```sh
node --test test/rf-band-consistency.test.mjs
node --test --test-name-pattern='VHF Colpitts oscillator holds its swing' test/radio-envelope-bands.test.mjs
node --test test/radio-currents.test.mjs
```

All three commands pass on this checkpoint. The full RF cost guard and the
supplier whistle remain blockers.
