# Spec-update: enable the Shockley diode path with junction limiting; NR fallback ladder

## Problem

`shockleyCompanion()` (exponential diode, VT·n ln-form conductance) is fully written
in `mna.js` and is dead code: `stampDiode`, `stampNPN`, `stampPNP` all call
`diodeCompanion(v, vf, rd)` with no opts, so `opts.shockley` is never true. The
shipped model is a piecewise-linear knee with hard-coded rd = 10 Ω — fine for LED
brightness lessons, wrong for anything sensitive to the exponential (log amps,
temperature effects, small-signal gm of a junction, realistic Vf vs current).
Separately, when NR fails today the engine reports non-convergence immediately —
honest, but there are standard continuation methods to try first.

## As built (2026-08-23) — deviations from the proposal, stated

1. **Shockley is OPT-IN (`params.model: 'shockley'`), not the default.**
   Measured on the canonical LED bench: Shockley shifts the current +3.9 %
   vs the knee (no series rd), and the closed-form walker still answers
   with the knee — a default flip makes nodeVoltage and branchCurrent
   disagree on the same bench and silently moves every LED/diode value in
   the shipped corpus. The flip is ROADMAP E1.3b: walker routing + corpus
   re-measurement together, coordinated with the examples owner. Opted-in
   parts route past the walker (`_needsMNA`), so one bench has one truth.
2. **Zener and BJT junctions stay PWL** this landing. The zener's
   three-region stamp and the BJT's region FSMs get their junction
   upgrades with E3.2 (bjt-early-reverse), where those models are redone
   whole rather than half-swapped.
3. **Ladder rung (b), source stepping, IS implemented** (every source,
   pin drive, device drive, and op-amp rail scales together through
   `srcScale`), because the cross-coupled-latch oracle defeats plain NR
   AND gmin stepping — its pathology is corner cycling at full drive, not
   a floating node.
4. **Two Newton corners found and removed while landing the latch oracle**
   (each measured as a period-2/3/4 limit cycle in an NR trace, each a
   discontinuity in the MOS stamp, not a ladder gap): the hard cutoff
   branch (fixed by fetlim for the gate variable PLUS a smoothed overdrive
   vov_s = ½(vov + √(vov²+δ²)), δ = 50 mV, so the square law has a
   continuous derivative through Vth), and the hard-wired 1 kΩ gds (a
   sub-threshold drain read as a 1k/10k divider; now tapered
   gds·(vov_s/(vov_s+δ))² + 1 nS, which IS the cutoff behaviour — the
   branch is gone).

## Proposal

1. **Turn Shockley on** for `diode`, `led`, `zener` (forward region), and the BJT
   B-E/B-C junctions, behind **pnjlim-style junction limiting** (the SPICE3
   limiting function: cap the per-iteration junction-voltage move to the critical
   voltage region instead of the current flat 0.5 V clamp). The raw (unlimited)
   delta still drives the convergence test — the existing rule stays.
2. **Per-part opt-out** `params.model: 'pwl'` keeps the knee model (and the
   closed-form fast path continues to use the knee — unchanged).
3. **Fallback ladder** when NR fails at the operating point:
   a. GMIN stepping: solve at GMIN·10^k, k = 6…0, each solution seeding the next.
   b. Source stepping: scale all independent sources 0→1 in adaptive fractions.
   c. Only then report `converged: false` (existing behaviour, now the terminal
      state of the ladder, with the warning naming which rungs were tried).
4. Is is derived from Vf@20 mA exactly as `shockleyCompanion` already does; expose
   `params.is`, `params.n` for parts that carry datasheet values.

## MNA impact

Companion-function switch + limiting function + the ladder driver around the NR
loop. No new rows. Region FSMs (zener breakdown, BJT regions) unchanged — limiting
composes with them. Should land after `sparse-lu-factor-reuse.md` (the ladder
multiplies solve count; with reuse each rung is cheap) but does not strictly
depend on it.

## Acceptance

1. 1N4148 model at 1 mA / 10 mA / 100 mA: Vf matches the Shockley closed form to
   < 1 mV (hand-computed, n and Is stated in the test).
2. Red LED (Vf 2.0 @ 20 mA) in the canonical 5 V / 1 kΩ bench: brightness within 2 %
   of the shipped PWL answer (the lesson must not visibly change).
3. Two diodes in series-opposition across a source: converges (classic pnjlim
   stress case; plain clamped NR oscillates).
4. A bistable latch that defeats plain NR converges via source stepping to a
   deterministic state (seed stated in the test).
5. ngspice differential oracles for diode/BJT circuits tighten from PWL tolerance
   to ≤ 2 %.
6. `params.model:'pwl'` reproduces today's numbers bit-for-bit.
