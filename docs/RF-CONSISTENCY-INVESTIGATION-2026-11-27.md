# RF device consistency repair — qualification evidence

The engine candidate has passed the focused RF qualification below. Hosted
upstream qualification and exact supplier adoption remain separate gates.
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

All seven new focused tests pass. They include a mixed-law negative (one
independent root lies outside its allowed change) and a coupled passive
network whose exact KCL root is manufactured independently of the solver.
The coupled witness runs with 0, 1 pS and 10 uS coupling and swapped ordering.
A seventh manufactured KCL root covers a coupled multiport/scalar pair and
exposes an inner/outer precision mismatch. Inner bisection on coupled
components must resolve the residual demanded by their outer iteration;
otherwise repeated false refusals restart backward Euler and create detector
jitter. Coupled inner roots now use 1e-9 precision. The isolated-device
arithmetic and all outer, physical and performance thresholds are unchanged.
The existing exact single-Meissner trajectory/step-count golden is unchanged
and passes, as do its headroom, quench and 1-ulp controls and the VHF swing,
frequency, continuity and substep-cost guard.

## Qualification results and remaining scope

The first vector candidate completed the six radio suites with 58/65 cases
passing and failed headroom, quench collapse, physical stability, current
and trajectory checks. It was checkpointed as unqualified and superseded.

The final precision candidate completes the six existing radio suites
(`radio-envelope-bands`, `radio-front-end`, `radio-mixing`, `radio-currents`,
`radio-fm-impulse`, `radio-skywave`) and seven new consistency regressions with
**72/72 cases passing**, including the original single-device trajectory,
headroom, quench, 1-ulp, VHF stability and cost guards.

The earlier block checkpoint failed the keyed-transmitter cost guard at
3243 transient solves/ms. Runtime instrumentation found 344 false
inconsistent trials in two milliseconds. Correct inner precision eliminates
those refusals and restores 1126.5 solves/ms, below the unchanged <1800 limit.
Band work is 976.5 substeps/ms. No outer tolerance or physical bound changed.

The original supplier fixture (Board `de8083c5a894a49c9fa4c6f0fb6f8866e2d758c0`,
CUI `ee2b4127a88f1b308f8d749cae4d7c1db1deae9e`) reproduced the reported
1170.56856 Hz speaker crossing count in the 2–5 ms window. Read-only phasor
history shows an LO that bursts to volts then collapses to microvolts while
transmitter RF remains around 0.1–0.2 V. The later 5–8 ms window is also
nonstationary. The first vector candidate still burst and gave about 1505 Hz. The first
block candidate restored a steady LO but its false step refusals still
jittered the phase. The precision repair removes that defect.

A separate diagnostic reference disables consistency correction and bounds
the RF step at 128 ns and 64 ns. After 8 ms of power-on settling, the 3 ms
measurement window gives these carrier phase-difference frequencies:

| Condition | 128 ns reference | 64 ns reference | Production candidate |
| --- | ---: | ---: | ---: |
| 9 V, tuning 0.3 | 3862.157 Hz | 3862.205 Hz | 3861.532 Hz |
| 9 V, transmitter tuning 0.302 | 6200.687 Hz | 6200.815 Hz | 6197.565 Hz |
| 6 V, tuning 0.3 | 4947.543 Hz | 4947.621 Hz | 4946.737 Hz |

These are physical reference measurements, not replacements for the old
speaker-crossing count. The settled mixer output and speaker carry matching
complete-period tones. The production source SHA-256 for this qualification
is `cbd8e11bcc1b8c037ab97f5ed323604b920d38c145778b9206cc6e3feab3819f`
(`src/rf-bands.js`); the reference disables the changed correction path.

Re-running the historical Board `b094eb22` reproduces approximately 5853 Hz
of speaker crossings, but its mixer current crosses approximately 16388 Hz,
its RF phase is nonstationary, and transmitter base bias is -31.8 V at 5 ms.
The historical 5830 Hz datum is therefore retained as **nonqualifying
transient evidence**, not adopted as a settled RF-beat oracle. The supplier's
measurement and learner text need a separately reviewed correction grounded
in the two fine references, settled phase/audio agreement and negative
controls. This engine checkpoint does not silently restamp that oracle.

Removing the transmitter-to-mixer coupling capacitor leaves the LO running
and suppresses mixer audio; the remaining speaker voltage is a decaying
power-on offset, not a tone. A far transmitter tuning of 0.6 is a separate
**unqualified wide-range case**: the fine explicit reference fails transient
convergence near 2.984 ms. No general wide-range tuning qualification is
claimed, and this case is not converted into a passing silence assertion.

## Focused reproduction

```sh
node --test test/rf-band-consistency.test.mjs
node --test --test-name-pattern='VHF Colpitts oscillator holds its swing' test/radio-envelope-bands.test.mjs
node --test test/radio-currents.test.mjs
```

All three commands pass on this checkpoint. Hosted upstream qualification,
the evidence-based supplier oracle repair, and exact fixture adoption remain
to be completed. The separate far-range case remains unqualified.
