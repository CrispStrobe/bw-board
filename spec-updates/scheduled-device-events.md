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
