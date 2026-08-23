# Spec-update: adaptive transient stepping with trapezoidal integration

## Problem

`_integrateTransientMNA` uses a fixed 100 µs backward-Euler sub-step, hard-capped at
200 sub-steps per `advanceTo`. The code states this honestly ("the cap is a stated
accuracy limit, not a hidden one") and invites the replacement ("Adaptive control can
replace this"). Consequences: a 10 kHz RC corner is sampled 1× per period-fraction
with first-order damping (BE is dissipative — oscillators decay artificially); a
long idle `advanceTo` silently grows h beyond 100 µs; fast events burn the full
200-step budget; device switching resolution is one fixed sub-step.

## Proposal

1. **Trapezoidal companions** for C and L alongside the existing BE ones
   (two-term history). BE is used for the first step after any discontinuity
   (source edge, switch/region flip, `setPin`, fired device event) to damp the
   trapezoidal ringing artifact; trapezoidal elsewhere.
2. **LTE step control**: local truncation error estimated from the standard
   BE/trapezoidal divided-difference formula per reactive element; accept the step
   if max LTE ≤ tol (reltol 1e-3, abstol 1e-6 V / 1e-9 A to start), else halve and
   retry; grow h by ≤ 2× on easy steps. h clamped to [10 ns, dtRemaining].
3. **Event-aligned steps**: the earliest of (device deadline, waveform-source edge,
   scheduled event) truncates h so edges are hit exactly, not straddled — this
   subsumes today's "one sub-step" switching resolution with "one adapted step",
   which near an edge is a small step.
4. The 200-step cap is replaced by a **time budget** per `advanceTo` (default the
   sim-time span requested); if the controller cannot finish within a hard iteration
   ceiling (guard against pathological circuits), it reports a warning exactly like
   today's overflow warning — never silently coarsens.
5. Device `update()` cadence: once per accepted step (unchanged contract), plus
   immediately at fired events.

## MNA impact

Companion-stamp changes + the stepping loop in `board.js`. Depends on
`sparse-lu-factor-reuse.md` for affordability (retry-halving refactors the matrix;
with reuse that is a numeric refactor, not a rebuild). Interacts with
`scheduled-device-events.md` (event queue provides the edge list in item 3).

## Acceptance

1. RC step response: max error vs analytic e^(−t/RC) < 0.1 % over 5τ (today's BE at
   100 µs is ~1–5 % depending on τ).
2. LC tank (1 mH, 1 µF, started charged): amplitude decay over 100 cycles < 1 %
   (BE-only fails this by design; this is the trapezoidal oracle).
3. 555 astable: frequency within 1 % of the RC formula (today ~3–5 %).
4. A 1 Hz circuit advanced 10 s idles in far fewer solves than today's 200-step
   cap-bound path (assert solve-count budget).
5. Waveform-source square edge at t=1.0000 ms is a solve point exactly (no straddle).
6. Full existing oracle suite green; scope traces show no NaN gaps introduced.
