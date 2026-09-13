# Three junction findings, and why two of them were unreachable before the third

lego-ac, 2026-09-13, branch `lane/parts-library-kinds`. Companion to
`E13B-CALIBRATION-REDERIVED.md`, which covers the vf convention. This one covers
what giving `rs` and `rd` a single home exposed underneath.

Reproduce anything here with the scripts named in each section; every number is
measured, none is argued.

## 1. The rs/rd unification was NOT complete when I said it was. Zener was split.

`junctionOpts` (exponential path) read `classDefaults(kind).rs`.
`junctionRd` (piecewise path) had its own ternary:

    part?.params?.rd ?? (part?.kind === 'diode' ? SILICON_RD : JUNCTION_RD)

That is correct for `led` and correct for `diode` and **wrong for `zener`**: a
zener is silicon, `classDefaults('zener').rs` is 0.568, and the ternary's
else-branch handed it 10. An 18x split between the model we solve and the model
we export, for one kind out of three.

Two of three kinds agreeing is exactly what a two-kind check reports as full
agreement, and that is what the old gate did — it pinned one CONSTANT
(`SILICON_RD`) against one CARD (`1N4148`).

`junctionRd` now reads the same table. **If your exporter carries its own zener
bulk resistance, it is wrong by 18x.** Read `junctionRd`, do not copy a number.

## 2. `junctionRd` read only one of the two spellings, so a card's own bulk was half-invisible.

It read `params.rd`. Cards store `rs`. So `1N4001`'s `rs: 0.045` — a real 1 A
rectifier's bulk — reached the exponential path and was **invisible to the
piecewise path**, which silently fell back to the class default. `LED_RED` hid
this by carrying both spellings with the same number.

Now `params.rd ?? params.rs ?? classDefaults(kind).rs`, the same
accept-either-spelling shape as `mosK`.

## 3. The PWL knee's blend band was an absolute voltage. It ate silicon's calibration.

`PWL_KNEE_EPS = 0.025` V, a flat C1 blend half-width around the knee. But the
knee has a natural voltage scale — a part sits `i_rated * rd` above its knee at
rated current:

    LED     0.020 * 10    = 0.2 V      = 8x the band   -> far out on the linear segment
    1N4148  0.020 * 0.568 = 0.01136 V  = 0.45x the band -> INSIDE it

So silicon never reached its linear segment at its own rated current, and the
smoothing ate the `vf` calibration. 5 V through 150 R is the rated bias **by
definition of vf**, and it read:

    20.0176 mA instead of 20.0000, effective bulk 0.4356 instead of 0.568

Now `eps = min(0.025, 0.5 * i_rated * rd)`. LED operating points are
bit-identical (min picks 0.025 unchanged); silicon is exact.

**This defect was unreachable while every junction shared rd = 10** — at that
value no kind could get near the band at its rated point. Per-kind rd is what
exposed it. A fix uncovering a defect that the thing it fixed had been hiding.

## Oracle notes worth having

- **ngspice decks need BOTH `.options temp=X tnom=X`.** `temp` alone leaves a
  flat +0.686 mV at every current, because ngspice rescales `IS` from its
  `TNOM=27` default to the requested temperature via the bandgap law. A 0.173 K
  gap becomes a constant voltage offset. With `tnom` pinned to
  `temp=26.826800` (which is what `VT_25C = 0.02585` actually is), our spot
  currents match ngspice to **2e-7 V over four decades** of current. I had
  previously recorded the ngspice floor as "VT_25C vs 300.15 K" — same root
  cause, but the fix is `tnom`, and with it the floor is not 0.04 %, it is zero.
- **The bw-circuit-ui PR #21 bench is now oracle-exact**: ours 1.748000 V
  against ngspice 1.748004 on the same deck (was 1.879795, off by 130.8 mV).
- A constant offset across decades of current is neither `n` (would scale with
  ln i) nor `rs` (would scale with i). Read the shape of the residue column
  before attributing it.

## What the residue between the two paths now is

With rs == rd the series term is identical at every current, so the entire
remaining piecewise-vs-exponential gap is **shape** — a straight line against a
logarithm. LED, vf 2.0, 5 V rail:

      R      i_pwl mA   i_shk mA   gap %
    100      29.09091   28.93469    0.537
    150      20.00000   20.00000    0.000   <- rated bias, by construction
    470       6.66667    6.77165    1.575
   1000       3.16832    3.25200    2.641
   2200       1.44861    1.50247    3.718
  10000       0.32071    0.33864    5.591

Zero at the rated bias, monotone away from it in both directions. That shape is
the proof nothing else is left: a residual rs/rd split would grow with CURRENT
and be non-zero at 150 R; a residual vf split would be a roughly constant
offset. `test/junction-rs-divergence.test.mjs` now asserts that shape rather
than ratcheting a number toward zero — and asserts the gap is NOT zero, because
zero would mean the exponential path had stopped being exponential.


## Reproduction

    # spot currents against ngspice, four decades
    node test/measurements/repro/shockley-oracle.mjs

    # the shape column
    node test/measurements/repro/shape-gap.mjs

Both need `ngspice` on PATH (44 here) and print the deck they used.

## The species, for the ledger

- **A claim that outlived the thing it described.** `junctionOpts` carried
  ~40 lines of comment explaining that `rs` is "STILL 2, AND THAT IS A KNOWN
  DEFECT" — sitting directly on top of the line that reads `classDefaults`.
  Removed.
- **A sound check about the wrong subject.** The rated-bias invariant looped
  over `['led', 'diode']`, but its piecewise half called `chain(...)` without
  passing `kind`, so it measured an LED in both iterations. Wiring the kind
  through is what surfaced finding 3. The loop looked like two-kind coverage
  and was one-kind coverage run twice.
- **A two-member check reporting full agreement.** The old constants gate pinned
  `SILICON_RD` against `1N4148`, which is true of the two kinds it named and
  blind to the third. Enumerate the kinds, and assert through the FUNCTION the
  solver calls rather than against a constant.
- **A fix uncovering what it had been hiding.** Nothing could reach the knee
  blend band at its rated point while every kind shared `rd = 10`. Per-kind
  `rd` is what made finding 3 constructible at all.

---

# The ngspice IS clamp is a property of the diode model, not of ngspice

Recorded separately because it changes what the corpus programme can cover.

`golden-is-not-clamped.test.mjs` established that ngspice silently clamps a
diode's `IS` at 1e-28 — no warning on stdout, stderr, or in the raw file — and
that a golden recorded from such a deck describes a device nobody asked for. An
LED calibrated to drop `vf` at 20 mA has `Is = 0.02/exp((vf - 0.02*rs)/nVt)`, so
at n = 1.8 every LED above about 2.86 V is in that hole. Blue, white, UV, and
every high-`vf` part in the corpus.

**I concluded those parts must be left out. That conclusion was wrong.** The
clamp lives in the `D` model's parameter handling. A behavioural source has no
such clamp, and it makes ngspice's own Newton iteration and limiting solve our
exact device equation:

    B1 na nj I = <Is>*(exp(V(na,nj)/<nVt>)-1)
    Rs nj 0 <rs>

## The instrument was validated before it was believed

An unchecked instrument is not an oracle, and this one is easy to get subtly
wrong — the junction is between `na` and an internal node, with the bulk `rs`
below it, and getting that topology backwards still produces plausible numbers.
So it was run against a `vf = 2.0` part, which **both** forms can express, at
three operating points:

    vcc=3.3 R=1035   D=1549.3014 uA   B=1549.3014 uA   0.000000 %
    vcc=5.0 R=1035   D=3144.5720 uA   B=3144.5768 uA   0.000154 %
    vcc=5.0 R=470    D=6771.6170 uA   B=6771.6489 uA   0.000471 %

## What it then measured

The full colour column on a 3.3 V rail through 1 kOhm + the 25 Ohm pad, against
our engine:

    name      vf    ours         ngspice      i          rel %
    infrared  1.2   0.11111111   0.11595419   2319.08uA  4.1767
    red       1.8   0.08759903   0.08759902   1751.98uA  0.0000
    orange    2.0   0.07819254   0.07819254   1563.85uA  0.0000
    yellow    2.1   0.07350071   0.07350073   1470.01uA  0.0000
    green     2.2   0.06881777   0.06881776   1376.36uA  0.0000
    blue      3.2   0.02297462   0.02297454    459.49uA  0.0004
    white     3.4   0.01436790   0.01436790    287.36uA  0.0000
    UV        3.8   0.00101072   0.00101073     20.21uA  0.0015

Three of these — blue, white, UV — were previously unmeasurable. Every row
agrees to 0.0000 % except infrared, and infrared is the one colour the router
leaves on the piecewise walker (2.1 V of headroom, above `MNA_HEADROOM_V = 2.0`).
Its 4.18 % is the piecewise-vs-exponential shape gap, showing up exactly where
the routing policy says it should. **The routing threshold is visible in a
corpus column**, which is a useful thing to be able to see.

## Consequences

- Blue's golden is currently recorded AT the clamp (`IS=1e-28`) rather than at
  its true `Is`, for this reason. It can now be re-derived. Named, not done.
- `run_ngspice.py` still refuses clamped `IS` rather than emitting it. Switching
  the high-`vf` rows to the behavioural form is separate work.
- For the corpus sweep generally: "ngspice cannot represent this" should be
  re-checked against the behavioural form before a circuit is excluded. The
  exclusion list was built on the `D`-model limit.
