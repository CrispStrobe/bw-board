# Spec-update: BJT Early effect (E3.2, Early half)

ROADMAP E3.2 asks for two things in one item — the Early effect and the
reverse-active region — and requires this file before either starts. The
reverse-active half **is already built and landed**: `ebersMollCompanion` is
full Ebers-Moll with a reverse beta, so E3.2's own problem statement ("currently
B-E diode + gm VCCS, no Early, no reverse") describes a tree that no longer
exists. This landing adds the Early effect. What is left of E3.2 afterwards is
named at the bottom, so the roadmap item can be closed or re-scoped honestly
rather than left looking untouched.

## Problem

`ebersMollCompanion` had no output conductance. Collector current was a function
of Vbe alone, so Ic was flat in Vce and `ro` was infinite — the one
device parameter a common-emitter stage's gain is most sensitive to.

The corpus said the same thing with a number. ADI2005 release v2 had 101 real
numeric disagreements against ngspice, and 81 sat on a BJT node (59 base, 17
emitter, 5 collector). All 59 base-node ones were a single circuit family, "BJT
Emitter Follower", with one model card:

    .MODEL Q2N2222 NPN (IS=1e-14 BF=200 VAF=100 IKF=0.3 RC=0.3
                        CJC=8p CJE=25p TF=0.5n)
    V1 VCC 0 DC 5.0 / RB1 VCC BASE 22Meg / RE1 EMIT 0 12k
    Q1 VCC BASE EMIT Q2N2222 / .op

    ngspice V(BASE) 1.022540      before 1.006830      delta 15.7 mV

**VAF was the whole of it, by removal rather than by argument.** Deleting VAF
from the card made the two engines agree. Deleting IKF instead (a 0.3 A knee
against a 35 µA emitter current) left the same 15.7 mV; deleting RC instead (0.3
Ω carrying nothing) likewise; the capacitances cannot matter at `.op`. So this
family's error was one term, and the other four parameters in the card were
irrelevant to it — which is worth recording, because "the card has five
parameters we do not implement" invites implementing five.

## As built

**One factor, on the transport current only.**

    early = 1 - Vbc/VAF
    ict   = iF - iR
    Ic    = ict*early - iR/BR - GMIN*Vbc
    Ib    = iF/BF + iR/BR + GMIN*(Vbe + Vbc)        unchanged

This is ngspice's own form reduced to the parameters we carry: its base-charge
factor is `q1 = 1/(1 - Vbc/VAF - Vbe/VAR)` with the transport current
`(iF - iR)/qb`, and with no reverse Early voltage and no high-current knee that
is exactly `(iF - iR)*(1 - Vbc/VAF)`.

**Ib is untouched, and that is the design, not an omission.** Early raises the
collector current at a *fixed* base current — the same statement as β rising
with Vce. An implementation that scales Ib by the same factor cancels most of
the effect while still looking like the feature, so there is an assertion for it
(`test/bjt-early-effect.test.mjs`, third test) and a mutation that reds it.

**Absent means infinite.** `ebersMollParams` reads `params.vaf`, then the class
card, then `Infinity`; a declared zero or negative also becomes `Infinity`,
which is what SPICE means by VAF=0. `Infinity` makes `early` exactly 1 and
`dEarly` exactly 0, so a card that does not declare VAF is **bit-identical** to
the tree before this existed — nine digits, asserted against numbers read off
commit `4dc3426`, not a tolerance. A tolerance cannot tell "unchanged" from
"changed by less than the tolerance", and every shipped circuit is this case.

**The Jacobian carries the factor's own derivative.**

    d Ic/d Vbe = gF*early
    d Ic/d Vbc = -gR*early + ict*dEarly - gR/BR - GMIN      dEarly = -1/VAF

The `ict*dEarly` term is the one a chain rule leaves out, and dropping it is
invisible in every converged node voltage — it costs iterations, not accuracy.
It therefore gets a finite-difference assertion at four bias points rather than
a voltage comparison, the same treatment `JUNCTION_GMIN`'s undivided appearance
on `gpi` needed for the same reason.

## Measured

| | |
|---|---|
| ADI v2 decks declaring VAF on a BJT | **700** |
| agreeing, engine with the term | **700**, 0 numeric disagreements |
| agreeing, same tree with the term forced off | see the commit message |
| the emitter-follower family's residual | 1.022295 vs ngspice 1.022540 (**0.245 mV**, from 15.7 mV) |
| a card without VAF | bit-identical to `4dc3426` |

The residual 0.245 mV is the knee (IKF) and `q2`, which are not implemented and
are not worth implementing for this: they are 1.6 % of the error VAF carried.

## The two crossings, both of which had to move

A model parameter the engine reads is worthless — worse, actively misleading —
unless the deck states it too. This is the authored-beta defect
(`spice-export-authored-beta`) with a different field name, so both sides landed
together in bw-circuit-ui:

* **import** `mapModel(Q)` carries `VAF` onto the part, only alongside a stated
  `IS` (no Is means no Ebers-Moll, and VAF on a piecewise knee has nothing to
  multiply).
* **export** a part carrying `vaf` gets a per-part `.model Q_<refdes>` with
  `Vaf=` appended, and says why in a trailing comment. No library card declares
  VAF today, so no shipped deck gains the field.

## What is left of E3.2

The reverse-active region is done. The Early effect is done. Remaining, and
deliberately not taken here:

* **VAR, the reverse Early voltage.** The full `q1` denominator. No corpus deck
  measured so far declares VAR, so there is nothing to measure it against — it
  should wait for a deck that does.
* **IKF/IKR high-current roll-off** (`q2`, the `(1+√(1+4q2))/2` factor). Worth
  0.245 mV on the family above. The decks that would actually exercise it are
  power stages running near the knee, and none of them is in a release that
  currently reaches the comparison.
* The roadmap's stated oracle for E3.2 — a common-emitter stage's gain against
  the analytic `gm*(RC ∥ ro)` — is now *possible* for the first time, because
  `ro` was infinite before this. It is not in this landing's tests: the 700-deck
  corpus measurement is the stronger evidence, and an analytic check would be
  the better *unit* test to add next.
