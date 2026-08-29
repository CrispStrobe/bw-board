# Spec-update: op-amp output limiting — finite Rout and a short-circuit current limit (D20)

## Problem

The solver `opamp` is an ideal VCVS with rails. Rails bound its output
VOLTAGE and nothing bounds its output CURRENT, so the part delivers
whatever the load asks for. Measured on this tree at `999eb66`, a
unity-gain follower fed 2.5 V into a 1 Ω load:

```
V(out) = 2.499998 V      I(out) = 2.499998 A
```

2.5 amps out of an 8-pin DIP. `docs/WAVE-OPEN-DEFECTS.md` files this as
**D20**, and `signals-loading` is the lesson that asks the learner to
"identify where follower output limits replace divider error" — on a bench
where no such regime exists. A model that can source 2.5 A teaches the
same wrong electronics the pre-rail model taught when it could output
900 V, and the rails were added for exactly that reason.

Secondly, the ideal row has no output resistance at all, so a follower's
output impedance is exactly zero at every frequency. `params.model:'macro'`
(`spec-updates/opamp-macromodel.md`) already puts a real 100 Ω `Rout`
behind its buffer; the ideal row could not express one.

## Adopted

Two parameters on `opamp` (and, opt-in, on `vcvs`, which shares the row
machinery and the region FSM):

| param | default | meaning |
| --- | --- | --- |
| `rout` | `0` | output resistance in ohms, in series with the ideal source |
| `iShort` | `0.040` on `opamp`, absent on `vcvs` | output short-circuit current, amps |

`iShort` explicitly set to `0` (or a negative number) disables the limit and
restores the unlimited ideal source, for a bench that wants one and says so.

### Finite output resistance

The row already owns a branch-current variable, so `rout` costs one matrix
entry. The branch variable `i` is positive INTO the output pin (this is the
sign the solver has always used; `branchCurrent('U1','out')` reports it, and
it read **−2.5** for the 2.5 A the follower was sourcing). With the ideal
source behind `rout`:

```
V(out) = V_ideal + rout·i          ⇒  row:  V(out) − rout·i − gain·(V(inp) − V(inn)) = 0
V(out) = rail   + rout·i           ⇒  row:  V(out) − rout·i = rail        (saturated)
```

`rout = 0` is the default and reduces both rows to exactly today's, entry for
entry — so a bench that does not ask for output resistance is bit-identical.

### Output current limit — a third and fourth region on the existing FSM

`opampRegions` already carries `linear | high | low` and is settled by the
Newton loop. It gains `ilim+` and `ilim-`. In those two the row stops
constraining a voltage and constrains the branch **current**:

```
ilim+ :  i = +iShort        (the part sinking flat out)
ilim- :  i = −iShort        (the part sourcing flat out)
```

That is what a real output stage in current limit does: the feedback loop is
lost, and the output collapses to whatever the limited current makes across
the load. It is the same shape as the `vccs` `iMax` clamp the macromodel
already uses for slew, and the same shape as `vsource`'s `iLimit` CC mode —
except that this one is a row swap rather than a voltage estimate, so it is
exact rather than iterated toward.

**Transitions.** Per Newton iteration, with `vTarget = clamp(gain·(V+ − V−),
railLow, railHigh)` — the output the part is TRYING to hold:

- from `linear`/`high`/`low`, and only if the rail FSM left the region alone
  on this pass (one iteration never changes two things about one part):
  `i > iShort → ilim+`, `i < −iShort → ilim-`;
- from `ilim+` (sinking, so `V(out) > vTarget` while the limit binds):
  leave to `linear` when `V(out) ≤ vTarget`;
- from `ilim-` (sourcing, so `V(out) < vTarget`): leave when `V(out) ≥ vTarget`.

The exit tests are "the limit no longer binds", stated in the only variable
that is observable while it does bind. They cannot cycle against the entry
test on a passive load: entering the limit REDUCES the delivered current, so
the output moves further from `vTarget`, never back across it.

**Source stepping.** `iShort` scales by `srcScale` exactly as the rails do.
In a linear network every current scales with the sources, so a full-height
limit against tenth-height sources would make the continuation visit regions
the full-height solve never enters — the same failure the rails were scaled
to avoid.

### Why the default moves, when the Shockley and macro defaults did not

`spec-updates/shockley-junction-limiting.md` and
`spec-updates/opamp-macromodel.md` both landed their machinery OPT-IN,
because in both cases the shipped default was *a defensible simplification*
and the more detailed model was *more expensive or differently accurate*.
Neither is true here. There is no reading of a datasheet under which an
LM358 sources 2.5 A, and the limit costs nothing when it does not bind.

The default is **40 mA**, the LM358/TL07x-class short-circuit output current.
It changes a solved value only on a bench that was already asking the op-amp
for more than 40 mA — i.e. only where the defect was.

## Acceptance (hand oracles, same commit)

1. **The defect itself.** Unity-gain follower, 2.5 V in, 1 Ω load:
   V(out) = 0.040 V and I = 40 mA exactly, not 2.5 V / 2.5 A.
2. **The regime boundary is where the arithmetic says.** With 2.5 V in, the
   limit binds below R = 2.5/0.040 = 62.5 Ω. At 100 Ω the follower still
   holds 2.5000 V (25 mA); at 50 Ω it delivers 40 mA into 50 Ω = 2.000 V;
   at 25 Ω, 1.000 V. Below 62.5 Ω the output is `iShort · R`, a straight
   line through the origin — which is the "output limits replace divider
   error" regime `signals-loading` asks the learner to find.
3. **Sinking limits too, and at the same number.** The follower driven to
   0 V with its output tied to a 5 V rail through 10 Ω sinks 40 mA, so
   V(out) = 5 − 0.040·10 = 4.600 V.
4. **Rails still clamp, and compose.** An open-loop op-amp with a 1 V
   differential input still sits at railHigh into a light load.
5. **Finite Rout, measured OPEN loop.** `rout` has to be measured where the
   loop cannot hide it: a follower divides its own output resistance by the
   loop gain, and a 100 Ω `rout` inside a ×1e6 loop still reads
   2.4999972 V into 900 Ω. Open loop (`gain: 1`, `inn` grounded, `inp` at
   2.5 V), `rout: 100` into 900 Ω gives 2.5 × 900/1000 = **2.250 V**, and
   2.5 × 100/200 = **1.250 V** into 100 Ω. That the follower is unmoved is
   itself the oracle for the closed-loop case.
6. **No declaration → unchanged.** `iShort: 0` restores 2.5 V into 1 Ω
   (2.5 A) bit-for-bit, and `rout` absent leaves every existing op-amp bench
   at the value it had.
7. **Determinism.** Two identical solves of a current-limited bench agree
   bit-for-bit, and the region the FSM settles on does not depend on which
   solve ran first.
8. **`rout` reaches the AC stamp too.** `src/ac.js` builds its own
   small-signal rows; a parameter the DC row honours and the AC row drops
   would be a two-truths bug of exactly the kind this repo keeps paying for.
   Open loop, gain 1, `rout: 100` into 900 Ω: |H| = 0.900, and 1.000 without.

## Stated limitation

**`iShort` does not participate in the AC small-signal stamp.** Small-signal
AC linearises about the operating point, and an output pinned at its
short-circuit current is small-signal DEAD — the correct AC row would be the
one `src/ac.js` already uses for a railed `vcvs`. That is not implemented here,
and it is not a regression: the AC op-amp row does not model the RAILS either
(only the `vcvs` row does), so a saturated op-amp already reports ideal AC
gain. Both belong to the same follow-up, which should do the op-amp's rails
and its current limit together rather than half of one.
