# Spec-update: the conductance no-op class — 178 declarations that stamped nothing

## Problem

`ctx.conductance(tA, tB, g)` resolves both terminals to nets and hands them
to `stampTwoTerminal`, whose first line is the air-leg guard:

```js
if (!netA || !netB) return;
```

The guard is right and it is load-bearing — `src/mna.js` records why it exists
(a 1 kΩ with one leg unconnected was being stamped as a resistor TO GROUND, and
a MAX4466 board read 2.5 V on a bias node where an independent solver said 5 V).
But it means a call written

```js
ctx.conductance('clk', null, 1 / R_INPUT);
```

has `tB` falsy, so `netB` is `undefined`, so the guard returns before a single
matrix entry is touched. **The call cannot ever stamp anything.** The same is
true of a literal `undefined` third argument to `stampTwoTerminal` itself.

`scripts/conductance-census.mjs` counts the class exactly, at this tree:

```
no-op sites: 178 across 41 files
live (two real legs) sites: 101
```

A previous count of "122 across 30 files" was a grep that only matched a
**quoted-literal** first argument; the census reproduces that number exactly
(124 across 31 at this tip) and shows what it missed — calls whose terminal is
a loop variable (`ctx.conductance(t, null, …)`) or a template literal
(`` ctx.conductance(`d${i}`, null, …) ``), and the three sites in `src/mna.js`
that call `stampTwoTerminal` directly and so cannot match a `conductance(` grep
at all.

This is not automatically a defect. An ideal high-Z input is arguably the MORE
accurate model at this tier, and it is what makes the D18 oracle the clean
textbook 46.4545. But 178 declarations that do nothing are 178 places where the
code says something untrue about itself, and each one is either a lie to delete
or a piece of physics to implement. Adjudicating them one class at a time is
the point of this document.

## The three verdicts

- **(a) INTENDED-IDEAL** — the no-op is the right physics. The dead call is
  DELETED so the code stops claiming otherwise.
- **(b) MISSING-PHYSICS** — the stamp should exist. It is rewritten with its
  real second node and lands with a hand-computed oracle.
- **(c) DEFER** — named, with the reason, and left alone.

The dangerous verdict is (b) applied broadly, because it moves corpus values.
The default is (a).

## Family table

| # | family | sites | g | verdict |
| --- | --- | --- | --- | --- |
| F1 | logic input loading (CMOS/TTL) | 149 | `1/R_INPUT` = 1 µS | (a) delete |
| F2 | analog high-Z input | 19 | `1/R_INPUT`, `1/10e6` | (a) delete |
| F3 | "stop this pin floating" pull-downs | 5 | `1/1e6`, `1/R_OPEN`, `1e-12` | (a) delete |
| F4 | RS-232 receiver input resistance | 2 | `1/R_RXIN` = 200 µS | **(b) implement** |
| F5 | 74HC595 builtin, `src/mna.js` | 3 | `1e-7` | (a) delete |
| — | **total** | **178** | | 176 deleted, 2 implemented |

### F1 — logic input loading (149 sites, verdict (a))

Every `ctx.conductance('<some digital pin>', null, 1 / R_INPUT)` across the
device registry, with `const R_INPUT = 1e6` defined identically in 43 files.
Clock, data, latch, chip-select, address, enable, mode and reset pins on the
74-series parts, the I²C and SPI sensors, the character LCDs, the shift
registers, the flip-flops, the counters.

**1 MΩ is not a CMOS input.** A 74HC input draws ±1 µA maximum over the whole
temperature range — that is ≥5 MΩ at 5 V worst case and typically nearer
50 MΩ; the real figure is gigaohms. So implementing these as written would not
make the model more true, it would make it *less* true by a factor of five to
a thousand, and it would do so in the one direction that shows up everywhere:
a 10 kΩ pull-up feeding a CMOS input would stop reading 5.000 V and start
reading 4.950 V, on every bench in the corpus at once.

It would also re-create, deliberately, the exact bug the air-leg guard was
written to kill — a resistor to ground that nothing asked for.

The ideal input is the right teaching-tier model and it is what the engine has
always actually computed. The declarations go.

### F2 — analog high-Z inputs (19 sites, verdict (a))

The LM358 / LM393 / LM339 comparator and op-amp inputs, the LM3915 `sig` and
`mode` pins, the 555 and 556 `threshold`/`trigger`/`reset` comparator inputs,
the INA219 `vin_p`/`vin_n` shunt sense pins, the HX711 `sck`, the TCS3200
select pins.

Same verdict, and here the code already argues for it in its own comment:

```js
// The SIG input is buffered on the real part — near-zero load.
ctx.conductance('sig', null, 1 / 10e6);
```

Two of these deserve to be named because getting them wrong would be worse
than merely inaccurate:

- **INA219 `vin_p`/`vin_n`.** These sit across a current-sense shunt of a
  fraction of an ohm. A 1 MΩ leg to *ground* from each is not a small error in
  the shunt reading, it is a different circuit — it grounds a floating
  high-side measurement.
- **The LM358 and the comparators.** The ideal input is precisely what makes
  D18's secant settle on the clean 46.4545 oracle. Loading those inputs would
  move a landed, hand-computed result to no benefit.

**The 555/556 divider is NOT in this class.** It was reported as part of it and
it is not: `ctx.conductance('vcc', 'control', 1 / R_DIVIDER)` and
`ctx.conductance('control', 'gnd', 1 / (R_DIVIDER * 2))` both name two real
terminals and both stamp. The internal 5k/5k/5k ladder has been live all along.
Only the three comparator-input declarations beside it were dead.

### F3 — "stop this pin floating" (5 sites, verdict (a))

Five sites are not about input impedance at all. They exist to keep a node from
floating, and each says so:

| site | comment |
| --- | --- |
| `board-kinds.js` `vin` | "external input, high-Z (a pull-down to stop it floating)" |
| `dallas-parts.js` `vcc1` | "an unwired VCC1 floats and the supply comparison below reads whatever the solver guessed" |
| `retro-dips.js` `crystal` a/b | "keeps each pin a real node rather than a floating one the solver has to guess at" |
| `max232.js` pump-cap pins | "Pump capacitor pins: real nodes, no invented behavior" |

**The solver already does this, unconditionally, for every node.** `src/mna.js`
adds `GMIN = 1e-12` from every node to the reference on every solve, for exactly
the stated reason ("keeps a floating net from making the matrix singular — which
used to be caught silently and returned a plausible, wrong all-zeros solution").
An unwired pin therefore solves to 0 V today, which is the outcome all four
comments depend on.

The crystal case is the sharpest: it asks for `1 / R_OPEN` with
`R_OPEN = 1e12`, i.e. a conductance of `1e-12` — **numerically identical to
GMIN**. The stand-in for the resonator's shunt C₀ is already there, by
construction, in the solver. Implementing the declaration would add `1e-12` to a
diagonal that already carries `1e-12`.

So these are deleted and each comment is rewritten to name GMIN as the thing
that actually delivers the behaviour, rather than a stamp that never ran.

### F4 — the MAX232 receiver input resistance (2 sites, verdict (b))

This is the one family where the code states a behaviour it does not deliver:

```js
// Receiver inputs really do load the line — it is how a
// disconnected RS-232 input idles low (mark) through the 5 k.
ctx.conductance('r1in', null, 1 / R_RXIN);   // R_RXIN = 5000
ctx.conductance('r2in', null, 1 / R_RXIN);
```

It qualifies on all four counts the (b) verdict asks for:

1. **It is a datasheet number.** RS-232 receiver input resistance is specified
   3 kΩ min / 5 kΩ typ / 7 kΩ max, and the constant is already named
   `R_RXIN = 5000  // datasheet receiver input resistance`.
2. **The model was built around the load existing.** `V_PUMP = 8` behind
   `R_DRIVER = 300` is not an open-circuit swing; those two numbers are chosen
   so that a driver working into a 3 kΩ RS-232 load reads
   `8 × 3000/3300 = 7.27 V`, the datasheet typical. With no load ever stamped,
   the part reports ±7.976 V — a swing the real device does not have, because
   the droop the model was calibrated for never happened.
3. **The load has a real second node.** The device declares `gnd`. The
   rewrite is `ctx.conductance('r1in', 'gnd', 1 / R_RXIN)` — no new terminal,
   no invented topology.
4. **A test's stated reason depends on it.** `test/max232.test.mjs` says
   "r1in left unwired entirely: the 5 k input load idles it at 0 V" and asserts
   the fail-safe. That test passes today, but for the wrong reason: the 5 k has
   never existed and GMIN is what idles the pin. The assertion is right, the
   explanation is fiction, and both are fixed here.

Note what (b) does NOT change: an **unwired** `r1in` is on no net, so `netA` is
falsy and the air-leg guard still declines the stamp. The fail-safe case behaves
identically — it is only its comment that was wrong.

### F5 — the 74HC595 builtin in `src/mna.js` (3 sites, verdict (a))

```js
// CMOS input: very high impedance to GND (doesn't load the pin)
if (dataNet) stampTwoTerminal(A, dataNet, undefined, 1e-7, nodeIndex);
```

The legacy `shift_register` case in the builtin switch, at 1e-7 S = 10 MΩ. The
comment's own parenthesis — "doesn't load the pin" — is the verdict. Deleted,
which makes the builtin agree with the registered `74hc595` device model in
`tier3-parts.js`, whose eight equivalent declarations are deleted by F1.

`src/mna.js` is a gated file; this change lands with this document and with the
oracle below in the same commit.

## Deferred, by name

Three real pieces of physics are visible from this census and are **not** done
here, because each is *new* behaviour rather than an unfulfilled declaration,
and adding new behaviour under the cover of a cleanup is how a corpus moves
without anyone deciding it should:

1. **MAX232 TTL input pull-ups.** `T1IN`/`T2IN` have an internal 400 kΩ pull-up
   to VCC on the real part, which is why a disconnected TTL input idles high and
   drives the line negative. The dead declaration was 1 MΩ to nothing, which is
   neither the right value nor the right node. Implementing the pull-up is a
   model change with its own corpus consequences.
2. **74C922 row pull-ups.** Same shape: the part has on-chip pull-ups on its
   `Y` (row) inputs; the dead declarations were plain 1 MΩ input loading.
3. **The LM3915 ladder.** The internal ten-step divider lives between `RHI` and
   `RLO`, and the model declares neither terminal — so there is nothing to
   stamp between. Modelling it means adding pins to the device, not fixing a
   call.

## Acceptance (hand oracles, same commit)

1. **The deletions move nothing, and this is provable rather than argued.**
   A call that fails the air-leg guard contributes no matrix entry, so
   deleting 176 of them is a source-level no-op. The corpus differential
   (every node voltage and every branch current, every bench, before vs
   after) must show **zero** changed values. Anything else means the census
   mis-identified a site.
2. **F4, the loaded RS-232 swing.** `test/max232.test.mjs`'s loopback bench —
   `t1out` wired to `r1in` with a 100 kΩ `RL` to ground — with TTL high in, so
   the driver holds `vTh = −8 V` behind `R_DRIVER = 300 Ω`:

   ```
   before:  V = −8 · (1/1e5) ... = −8000/1003 = −7.976071784 V
   after:   1/300 + 1/1e5 + 1/5000 = 1063/300000
            V = (−8/300) / (1063/300000) = −8000/1063 = −7.525870178 V
   ```

   The two share the arithmetic and differ only by the 5 kΩ leg: 450 mV of
   droop that a real receiver causes and this model was calibrated to show.
   Both are still past the receiver threshold, so no logic outcome moves.
3. **F4 does not disturb the open-input fail-safe.** With `r1in` on no net the
   guard still declines, `r1out` still idles HIGH, and the assertion that was
   passing for the wrong reason now passes for the stated one.
4. **The class only shrinks.** `test/conductance-noop-ratchet.test.mjs` pins
   the census count and fails if a new silent no-op is added.

## Ratchet

`scripts/conductance-census.mjs --count` is the class size. The ratchet test
asserts it is at or below the adjudicated ceiling. Lowering the ceiling is a
one-line edit; raising it requires adjudicating the new sites in this document
first.
