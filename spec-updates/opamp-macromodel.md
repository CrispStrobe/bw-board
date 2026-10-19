# Spec-update: op-amp GBW + slew macromodel (E3.1)

## Problem

The solver-level `opamp` is an ideal VCVS with rails: no bandwidth, no
slew, and its AC answer is flat to any frequency — so active-filter
lessons cannot be honest now that true small-signal AC exists (E2.1).
Separately, the `lm358` registered device is a damped integrator whose
header admits its settling is solver mechanics, not physics.

## Adopted: the standard single-pole macromodel, by NETLIST EXPANSION

Opt-in via `params.model: 'macro'` on an `opamp` part (the ideal row
stays the default — same discipline as the Shockley flip: machinery
first, measured; defaults move separately with the corpus owner).

`setNetlist` expands each macro op-amp into hidden parts on hidden nets
(the motor-winding precedent — solver-owned reactive elements, no
device-side companions):

```
inp ─┐
     G1 (vccs, gm = 2π·GBW·Cint, iMax = SR·Cint)
inn ─┘        │
              X ── C1 (capacitor, Cint) ── gnd
              │
              Rp (resistor, A0/gm) ── gnd
              │
              E1 (vcvs ×1, rails railLow/railHigh) ── Rout ── out
```

- Pole: fp = 1/(2π·Rp·Cint) = GBW/A0; A0·fp = GBW.
- Slew: the vccs iMax clamp — dv/dt(X) ≤ iMax/Cint = SR exactly.
- Rails: on the E1 buffer via the shared vcvs region FSM.
- C1 is a first-class solver capacitor: transient (adaptive trap) and AC
  (jωC) come free and CONSISTENT — no device-cadence companion anywhere.
- Requires a ground net (the hidden RC is ground-referenced, as in every
  textbook macromodel); a bench with no gnd part keeps the ideal row and
  says so in getWarnings.

Params + defaults (LM358-class): `a0` 1e5, `gbw` 1e6 Hz, `slew` 0.5 V/µs,
`cint` 30 pF, `rout` 100 Ω, rails as today.

## Acceptance (hand oracles, same commit)

1. AC, unity-gain follower: −3 dB at GBW (1 MHz) within the sweep's grid
   resolution; DC gain error ≈ 1/A0.
2. AC, inverting ×10 (Rf/Rin = 10): −3 dB at ≈ GBW/11 (noise gain), flat
   in the passband at 20.0 dB − 20·log10(1 + 11/A0).
3. Transient: large step into a follower slews at 0.5 V/µs ± the
   integrator tolerance (measure the ramp between 10 % and 90 %).
4. Rails still clamp (railed follower output sits at railHigh).
5. `model: 'macro'` absent → bit-identical to today's ideal row.
