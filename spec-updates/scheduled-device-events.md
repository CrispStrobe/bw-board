# Spec-update: scheduled device events + gate propagation delay (E4.1/E4.1a)

## Problem

Devices settle by fixpoint: a gate that flips is seen by the network on
the next solve pass, and "propagation delay: not yet modelled" has been
the logic-gates header's standing admission. Without real tpd there are
no ring oscillators, no hazard/glitch demos, no honest flip-flop timing —
the heart of the 74* curriculum (ROADMAP E4.1a/E5).

## Adopted

1. **Canonical wake field.** A device model's `update()` may set
   `state._wakeNs` (BigInt, absolute sim time). `_earliestDeviceDeadline`
   honours it exactly like the existing ad-hoc deadlines
   (`_pendingState.deadlineNs`, `_echoEndNs`, `_nextEdgeNs`) — advanceTo
   truncates its sub-interval to the wake, so the event lands on a solve
   point, never inside a straddled step. The legacy fields keep working;
   new devices use `_wakeNs`.
2. **Gate tpd, OPT-IN.** `params.tpdNs` on any logic gate (and, by the
   chip-composer, any 74HC part) arms scheduled switching: a computed
   output change is NOT applied in place; it is recorded as
   `_pendingOut {level, atNs: now + tpdNs}` with `_wakeNs` set, and
   applied when time reaches it. **Inertial semantics**: if the inputs
   revert before `atNs`, the pending flip is cancelled — a pulse shorter
   than tpd does not propagate, which is the physical behaviour and the
   teaching point.
3. **Default stays immediate (tpd absent = today's fixpoint, bit-identical).**
   Same discipline as the Shockley and macromodel landings: machinery
   first behind a param, default flips only as a coordinated,
   corpus-measured change. An instantaneous `_solve()` (no time advance)
   also settles un-armed gates exactly as before.

## Acceptance (hand oracles, same commit)

1. Three-inverter ring, `tpdNs: 100` each: oscillates with period
   2·3·100 ns = 600 ns ± one solve point, measured by edge-counting a
   node over 6 µs of advanceTo.
2. Inertial cancel: a 40 ns input pulse into a `tpdNs: 100` inverter
   does not appear at its output; a 250 ns pulse does, delayed 100 ns.
3. `tpdNs` absent: the full existing gate suite is bit-identical
   (fixpoint settling within one solve event).
4. A gate chain mixing armed and un-armed parts settles: un-armed
   sections collapse in the fixpoint, armed hops take their tpd.

## Landed alongside: the step-controller floor self-trap (perf, measured)

Shrinking `H_SEED` to 1 ns exposed a controller defect that predates this
spec (present since the adaptive integrator): any iteration whose
`hEff <= 2*H_MIN` took the *seed* branch, and the seed branch never grows
`h`. Once the reject path drove `h` down to `H_MIN` (any switched
discontinuity with a diode knee does this — the charge-pump bench on its
first square edge), every later iteration re-entered the seed at `H_SEED`
and the integrator marched 1 ns steps forever. Measured: exactly 5 000
solves per 5 µs tick; the charge-pump test file alone took 95 minutes.

Fix (same commit):
1. Only `!trapReady` (a genuine discontinuity) takes the uncontrolled BE
   seed. A floor-sized step goes through the trapezoidal controller,
   which can grow it again.
2. An at-floor step (`hEff <= H_MIN`) is accepted even with `err > 1`:
   it cannot be refined further, and rejecting it would spin the
   controller in place until MAX_ATTEMPTS.

Oracle: the charge-pump file runs in seconds and still lands
`V(out) = 2·Vpk − 2·Vf` (8.649 V measured, 8.6 V hand value).
