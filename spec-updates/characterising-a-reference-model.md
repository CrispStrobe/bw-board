# Characterising a reference model, and four traps that cost a day

Five device-model gaps were closed against ngspice in one sitting — Early
effect, MOS subthreshold, the zener breakdown knee, the selective shunt's rule,
and GMIN's placement. What made them tractable was a method, and what made them
slow was four specific mistakes. Both are worth writing down, because the next
model gap will be approached the same way.

## The method: measure the reference, fit, then confirm a consequence separately

For each model the sequence was identical, and no step is skippable:

1. **Sweep the reference over the region in question**, with a bench built to
   isolate one device. Not the corpus deck — a two-element bench whose answer is
   the device's own I–V.
2. **Invert the relation so no solver is needed.** Every one of these turned out
   to be explicit in one direction: `Vov_eff = Ksub·ln(1+exp(Vov/Ksub))` for
   subthreshold, `|V| = BV + nVt·ln(I/IBV) + I·RS` for the zener knee. Fitting
   the explicit form removes the possibility that a fit residual is really a
   solver residual — which is exactly what a first attempt at the zener produced
   (7,939 % "error" at 4.2 V, entirely a diverging fixed-point iteration).
3. **Confirm a SEPARATE consequence of the fitted form.** The subthreshold fit
   was believed because its *slope law* (`Ksub·ln(10)/2` V/decade) held at four
   different parameter values, each measured in its own window — not because the
   curve matched at 25 points. A fit that matches one curve and nothing else is
   a curve, not a model.
4. **Then measure the corpus, row by row.** Not the total.

Results this produced: subthreshold 0.000 % over the usable range; the zener
knee 0.186 mV over five decades; Early effect 82 decks; the shunt rule exact on
all three nodes of the deck that motivated it.

## Trap 1: a coincidence that agrees with the reference

The zener stamp first read `rz` — the piecewise slope — where SPICE's series
resistance arrives as `rs`. They are different quantities that happen to share
a default of 5 Ω, and the corpus card states `RS=5`, so **the wrong field agreed
with ngspice on exactly the decks that motivated the work.**

Only a sweep separated them: ngspice moves 3.240815 → 3.266091 V across
RS = 0…50 while a reader stuck on `rz` returns 3.243367 for all of them. When a
new model matches on its first try, vary the parameter that should move it.

## Trap 2: a floored conductance is not a parallel conductance

`JUNCTION_GMIN` was added to the zener breakdown's returned *slope* and did
nothing whatsoever. The Newton stamp is `iEq = i(V0) − g·V0`, so the branch
carries exactly `i(V0)` at convergence **whatever `g` is** — putting GMIN in the
slope and then building `iEq` from that same slope cancels it term for term.

This is stated in as many words beside `JUNCTION_GMIN`'s own definition, and it
was still walked into, because the mistake *looks* like the right line of code.
GMIN belongs in the diagonal and not in the Norton source. It cost two corpus
decks, and finding them is what exposed it.

## Trap 3: a Jacobian error is invisible in every voltage

The same identity that makes trap 2 possible means a wrong conductance costs
iterations and not accuracy. Two mutations passed every voltage assertion in
their suites:

* dropping `RS` from the zener's `dI/d|V|`
* omitting the chain-rule term `ict·dEarly` from the Early effect's `gcR`

Both are only visible to a **finite-difference check against the stamped
current**, and both now have one. A device-model suite that asserts only
voltages cannot see half of what it stamps.

## Trap 4: the net hides the trade

The shunt fix's first version read `+1` on Si7li. Row by row it was **+3 and
−2**, and those two losses were trap 2. Every corpus comparison here is a
row-level diff reporting gained and lost separately, because a net number is the
one statistic that can conceal a regression behind a win.

## And one that is not a trap: a zero corpus delta is still a fix

Four of the defects closed here measured **zero** on the comparable set — the
decks that would exercise them are blocked upstream by element coverage. They
landed anyway, labelled as correctness with the measurement stated. Dressing a
zero up as progress is how a refusal gets added to move a number, which was
measured and rejected three times in the same sitting (+2/−76, +3/−129, +4/−80).
