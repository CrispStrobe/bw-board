# Spec-update: GMIN is a junction quantity; the two-step refinement; the derived Newton budget

Three engine facts that were each established against ngspice at a bench built
to separate them, and each of which a reasonable person would get wrong from
first principles. Recorded together because they interact: the first decides
*where* a conductance goes, the second decides *when it is removed*, and the
third decides whether the solve has enough iterations to get there.

## 1. ngspice puts GMIN across pn junctions and NOTHING on a node diagonal

Proven at 1 TΩ rather than argued:

    R1 a b 1T                      no junction        V(a) = 5.000000 V exactly
    R1 a b 1T + one reverse diode  one junction       V(a) = 2.495000 V

and 2.495 is exactly `(5e-12 − 1e-14)/2e-12` — the divider a single 1e-12
junction conductance makes with the 1 TΩ. A node-diagonal GMIN would have moved
the first case too. It did not move it at all.

So `JUNCTION_GMIN = 1e-12` appears on **junction currents**, once per junction at
full strength:

    reverse:   i = -IS + GMIN*V            gj = GMIN
    forward:   i = IS*(expV - 1) + GMIN*V  gj = IS*expV/nVt + GMIN
    Ebers-Moll: ib += GMIN*(vbe + vbc)     ic -= GMIN*vbc
                gpi = gF/BF + GMIN         gmu = gR/BR + GMIN

**A floored conductance is not a parallel conductance**, and that distinction is
the whole reason the old code was wrong. The Newton stamp is `g, Ieq = i(V0) −
g·V0`, which makes a branch carry exactly `i(V0)` at convergence. So flooring a
reverse junction's *slope* at 1e-12 leaves a pure saturation-current source with
no conductance at all. Measured on a base behind a coupling capacitor: engine
0.009954 V against ngspice 0.276875 V.

The floor also landed on `gF`, which reaches the base only as `gF/BF`. That one
is a **Jacobian** error, not a wrong answer — a converged solution does not
depend on it — and it is therefore invisible in every node voltage. `GMIN` added
to `ib` differentiates to `GMIN` on `gpi`, undivided, and a mutation dividing it
by BF can only be caught by a derivative assertion.

**Do NOT lower the blanket node shunt to match.** That was tried and measured
worse; the node shunt is doing a different job (solvability of a floating
subnet), and the two are not substitutes.

## 2. The refinement is two steps, and the second one is conditional

After convergence at `.op` (not in transient):

1. Subtract GMIN from the diagonals where `A.get(i,i) − GMIN !== 0` and
   **re-solve the same assembly**. `A` and `b` survive the first solve because
   `solveAssembled` copies into CSC, so this is a second solve of a matrix
   already built, not a second Newton.
2. Only if that moved the answer by more than **1e-6**, run
   `runNewton(GMIN, 1, true)` with the selective shunt.

Both halves are load-bearing and the threshold is pinned from **both sides** in
`test/junction-gmin-not-node-gmin.test.mjs`.

**Iterating the refinement makes it worse.** Measured: 4.867521 → 4.840996,
because `runNewton` re-adds the shunt it was asked to remove. The obvious loop
is the wrong shape, and the measurement is in the file so nobody adds it back.

## 3. The Newton budget is derived from the rail span, not a constant

`MAX_NR_ITER` was 50. Junction limiting bounds per-iteration state movement at
`NR_MAX_STEP = 0.5 V`, so a deck whose sources span 200 V **cannot** reach its
own solution in 50 iterations no matter how well conditioned it is:

    const sourceSpan = /* max - min over every volts/emf/vcc param */;
    const MAX_NR_ITER = Math.max(50, Math.ceil(sourceSpan / NR_MAX_STEP) + 20);

**A steady walk is not an oscillation.** The tell is a residual falling by
*exactly* the clamp each iteration — that is a budget shortfall, and no
continuation method fixes it. Reading it as a convergence pathology sends you
after a ladder rung that already works. This one change converted ~60 corpus
decks that were being reported as non-convergent.

The fixture for it is a real topology (ADI row 526's two-stage op-amp),
deliberately: two earlier fixtures — a diode chain on ±200 V and a single
MOSFET on ±100 V — **survived every mutation**, because a simple circuit
reaches its answer inside 50 iterations even when the span says it should not.

## What holds each of these

    test/junction-gmin-not-node-gmin.test.mjs   the three separating states, an
                                                exact 3.75 V divider control, a
                                                finite-difference Jacobian check,
                                                the 1e-6 threshold from both sides
    test/newton-budget-from-rail-span.test.mjs  the two-stage op-amp fixture
    test/junction-headroom-bystander.test.mjs   bit-identical ONLY when the
                                                bystander has no junction; else
                                                bounded by JUNCTION_GMIN * VCC
    test/diode-operating-point.test.mjs         reverse current is -IS + GMIN*V,
                                                at a tolerance 200x tighter than
                                                the model gap it would hide
    test/mosfet-body-effect.test.mjs            both bulk wirings measured:
                                                bulk 0 -> 3.36e-19 V,
                                                bulk s  -> 4.999380 V
