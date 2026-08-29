# Spec-update: the AC sweep honours the operating region it linearises about

## Problem

`spec-updates/opamp-output-limit.md` closes on a stated limitation, and this
document discharges it:

> **`iShort` does not participate in the AC small-signal stamp.** […] it is not
> a regression: the AC op-amp row does not model the RAILS either (only the
> `vcvs` row does), so a saturated op-amp already reports ideal AC gain. Both
> belong to the same follow-up, which should do the op-amp's rails and its
> current limit together rather than half of one.

`src/ac.js` opens by stating its own contract — "every nonlinear device is
linearized at the DC operating point", and "an AC answer computed from a
different model than the operating point is a plausible wrong Bode plot". The
`opamp` row breaks that contract. It stamps

```
V(out) − rout·i − gain·(V(inp) − V(inn)) = 0
```

unconditionally, at every operating point. So an op-amp sitting hard against a
rail, or pinned at its 40 mA short-circuit current, reports its full ideal
small-signal gain at every frequency — a clean, confident, entirely wrong Bode
plot for a stage that in reality cannot move its output at all.

The `vcvs` row in the same file already does the right thing for rails, from
the same operating-point voltages. Two rows in one file disagreeing about
whether saturation exists is the two-truths shape this engine keeps paying for.

## Adopted

### 1. The DC solve publishes the region it settled on

`solveMNA` already owns `opampRegions` — a `Map<partId, 'linear'|'high'|'low'|
'ilim+'|'ilim-'>` settled by the Newton loop, and the authority on which
region a part is in (it is what the DC stamp itself used). It was not returned.
It now is, on both return paths, alongside `nodeVoltages` and `branchCurrents`.

This is a pure addition — no solved value changes, no stamp changes, no
iteration changes. It is nonetheless a `src/mna.js` change, so it lands with
this document and with hand-computed oracles in the same commit.

Recomputing the region inside `ac.js` from `gain · vinOp` was the alternative
and it is rejected: it works for rails (it is what the `vcvs` row does today)
but it cannot see a current limit at all, because whether `iShort` binds is a
fact about the branch current, not about the input voltage. Passing the settled
region is also the only version that is *by construction* the same operating
point the DC solve found, which is what the module header asks for.

### 2. `acSweep` takes the region and stamps the matching row

`acSweep({ …, opRegions })`. Per part, three rows instead of one:

| region at the OP | what is true | AC row |
| --- | --- | --- |
| `linear` | the loop controls the output | `V(out) − rout·i − gain·(v⁺ − v⁻) = 0` (today's) |
| `high`, `low` | the output is clamped to a rail: a voltage that cannot move | `V(out) − rout·i = 0` |
| `ilim+`, `ilim-` | the output is a fixed current: a current that cannot move | `i = 0` |

**The rail row and the limit row are different rows, and the difference is the
whole point.** A railed output pins its *voltage*; a current-limited output
pins its *current* and lets its voltage float to wherever the load puts it.
Writing `V(out) = 0` for a current limit would be a plausible-looking wrong
answer in any bench whose load is not a plain resistor to AC ground. `i = 0` is
the small-signal statement that the output stage is delivering a constant
current — infinite output impedance, which is what a current limit is.

Applied to `vcvs` too, whose existing rail handling becomes the `opRegions`
lookup with its `gain · vinOp` recomputation kept as the fallback for a caller
that passes no regions (`acSweep` is public API via `src/index.js`).

### 3. The sweep SAYS so

A correct 0 where a user expected gain is still a mystery unless the sweep
explains itself. Each returned point carries

```js
{ hz, results, outOfLinear: [{ part: 'U1', region: 'high' }] }
```

`outOfLinear` is **absent** when every part is linear, so a bench that was fine
is byte-identical in shape as well as in value. It is present on every point
rather than once for the sweep because the operating point is a property of the
sweep, not of a frequency, and a consumer plotting one point should not have to
reach outside it to discover the answer is not a gain.

This is the "honest refusal" half of the follow-up, kept together with the
correct number rather than instead of it: the sweep reports the true
small-signal answer (zero) AND names the stage and the region that make it so.

## Acceptance (hand oracles, same commit)

The bench for 1–3 is an open-loop `opamp` with `gain: 10`, `railHigh: 3`,
`railLow: -3`, `inn` on ground, `out` loaded by 1 kΩ to ground, and the swept
`vsource` on `inp`. Open loop, so the gain is readable directly and no feedback
can hide the region.

1. **Linear is untouched.** Source DC 0.1 V → `gain · vin = 1.0 V`, inside the
   rails, region `linear`. `|H(out)| = 10.000` at every frequency, exactly as
   before this change, and `outOfLinear` is absent.
2. **The defect itself.** Source DC 1.0 V → `gain · vin = 10 V`, past
   `railHigh = 3`, region `high`, `V(out) = 3 V` at DC. Before: `|H(out)| =
   10.000` — the ideal gain of a stage that is welded to a rail. After:
   **`|H(out)| = 0`**, with `outOfLinear = [{ part, region: 'high' }]`.
3. **The rail row is a voltage clamp, and `rout` does not rescue it.** Same
   bench railed, `rout: 100`, load 900 Ω. The row is `V = rout·i` and the load
   gives `i = V/900`, so `V = 100·V/900 ⇒ V·(1 − 1/9) = 0 ⇒ V = 0`. A railed
   output is dead whatever its output resistance, which is the correct physics
   and a check that the two mechanisms compose rather than fight.
4. **The current limit, at D20's own oracle.** The follower from
   `spec-updates/opamp-output-limit.md` acceptance 1 — unity gain, `inp` at
   2.5 V, 1 Ω load, `iShort` at its 40 mA default — settles at
   `V(out) = 0.040 V`, region `ilim-`. Before: `|H(out)| ≈ 1.000`, the ideal
   follower response. After: the row is `i = 0`, the node's only other path is
   the 1 Ω to AC ground, so **`|H(out)| = 0`** and `outOfLinear` names
   `ilim-`.
5. **The limit row is a current clamp, distinguishably.** The same limited
   follower with its output ALSO tied to the swept node through 1 kΩ: with
   `i = 0` the output is a plain 1 kΩ / 1 Ω divider off the source,
   `|H| = 1/1001 = 9.990e-4`, not the `0` that a `V(out) = 0` row would give.
   This is the oracle that tells the two rows apart; a `V(out) = 0` shortcut
   passes 4 and fails this.
6. **`opampRegions` on the DC side changes nothing.** Every existing solve
   returns the node voltages and branch currents it returned before, bit for
   bit; the new key is additive.

## Stated limitation

The region is taken at the DC bias and held for the whole sweep, which is what
"small-signal about an operating point" means. A large-signal input that would
drive a linear stage into its rail part-way through a cycle is not modelled and
cannot be — that is a transient question, and `advanceTo` is where it is asked.
