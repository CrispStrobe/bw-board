# Spec-update (DESIGN): seeded, opt-in measurement noise (D22)

Status: **design only.** Nothing in this file is implemented. It is filed so
that whoever implements it inherits the constraints rather than rediscovering
them, and so the reason the engine is silent today is on the record.

## Problem

`docs/WAVE-OPEN-DEFECTS.md` D22: "The simulated potentiometer is bit-exact:
twelve reads of a still knob give ADC count 380 every time, standard deviation
exactly 0." The lesson `signals-noise` is taught on `arduino-03-smoothing`,
whose program is a genuine ten-sample moving average, and asks the learner to
observe the spread that averaging removes. There is no spread. Re-measured
2026-08-29 through lite's own gate: `[...new Set(counts)]` is `[380]` and the
sample standard deviation is `0`, exactly as the sentinel says.

The engine is right to be bit-exact by default. **The engine is deterministic
BY PINNED TEST**, and a large part of this project's verification — the
EXPECTED corpus (2635 claims), the device-KCL residuals, the lesson numeric
contract — rests on identical solves producing identical numbers. `PLAN.md`
states the constraint in one line: "Adding noise to a sensor makes every gate
that quotes a reading flaky. It needs a seeded, per-part, opt-in noise model,
not a global one."

## The five properties any implementation must have

1. **Absent by default.** A bench that declares nothing is bit-identical to
   today, entry for entry. This is mutation-provable: run the whole corpus
   differential (see "Verifying it" below) and require zero moved values.
2. **Same seed ⇒ same trace.** Two runs, two processes, two machines: the same
   numbers. This is what makes a noisy bench still gate-able.
3. **A reading depends on WHEN, not on HOW OFTEN it was read.** This is the
   property that kills the obvious implementation. `nodeVoltage` and
   `readAnalog` are called an unbounded and *incidental* number of times per
   timestep — once per settle round, once per UI probe, once per scope channel,
   once per corpus instrument. A stateful PRNG advanced per draw makes the
   value depend on all of that, so attaching a probe would change the physics.
   The noise sample must be a pure function of (part, seed, sample index).
4. **Per-part.** One bench must be able to have a noisy sensor and a quiet
   reference on the same board.
5. **The two solvers must agree.** A potentiometer's position is read in TWO
   places — `stampPotentiometer` in `src/mna.js` (GATED) and `_solvePot` in
   `src/board.js` (the closed-form walker) — and `_needsMNA` routes a bench to
   one or the other. If only one of them sees the noise, the same bench has two
   truths, which is the defect D23 was.

## Adopted design

### The generator: counter-based, not stateful

```
n(partId, seed, k) :   a Gaussian sample, mean 0, sd 1
    h  = splitmix64( fnv1a64(partId) ^ seed ^ (k * GOLDEN64) )
    u1 = (h        >>> 11) / 2^53          # two uniforms out of one 64-bit word
    u2 = (h_next   >>> 11) / 2^53          # h_next = splitmix64(h)
    return sqrt(-2 ln u1) * cos(2π u2)     # Box–Muller
```

No mutable state exists anywhere. `n` may be called in any order, any number
of times, from any process, and answers the same. Property 3 is satisfied by
construction rather than by discipline, which matters because the discipline
would have to hold across every future call site.

`k` is the **sample index**, not the timestamp:

```
k = floor(tNs / intervalNs),   intervalNs = 1e9 / bandwidthHz
```

so a bench that reads faster than the declared bandwidth sees the same sample
twice — which is what a band-limited noise source does, and what makes a
lesson about *sampling* noise honest. Two reads at the same simulated instant
are necessarily equal.

### The declaration

```js
{ id: 'pot1', kind: 'potentiometer',
  params: { ohms: 10000, position: 0.371,
            noise: { sigma: 0.002, bandwidthHz: 1000 } } }
```

- `sigma` is in the part's own natural unit — **fraction of travel** for a
  potentiometer's wiper position, volts for a voltage-output sensor. Stating it
  in ADC counts would tie the model to a consumer's converter.
- `bandwidthHz` defaults to 1000.
- `seed`: a per-part seed may be declared; otherwise the board's
  `setNoiseSeed(n)` (default `0`) is used, so one call re-rolls a whole bench
  reproducibly and a lesson can say "try seed 7".

### Where it is injected

**On the part's control-to-physics mapping, not on the reading.** For the
potentiometer that is the wiper position:

```
positionEffective = clamp(position + sigma * n(id, seed, k), 0, 1)
```

and BOTH `stampPotentiometer` and `_solvePot` call one shared helper for it.
The solve is then exactly self-consistent — KCL holds to machine precision,
`branchCurrent` agrees with the stamp, the scope and the meter see the same
node — because nothing is injected *after* the solve. A noisy reading bolted
onto `readAnalog` would have been cheaper and would have broken that: the meter
and the solver would disagree by the noise, which is precisely the two-truths
shape this repo keeps paying for (D13, D19, D23).

Cost: one `if (!part.params.noise) …` early-out on the stamp path. Nothing is
added to `setPin`, `readPin` or `readAnalog`, so **the load-sensitive budgets
(setPin > 10K ops/sec, the 500 ms ladder) are untouched by construction** — the
right way to satisfy them, rather than by re-measuring afterwards.

### A note on the magnitude, for whoever sets a lesson's default

A 10-bit ADC on a 5 V rail has 1 LSB = 4.888 mV. `arduino-03-smoothing` reads a
10 kΩ pot straight into A0, so 1 LSB of reading is 1/1023 of travel ≈ 0.000978.
`sigma = 0.002` is therefore about **2 LSB**, which gives a visible ±6-count
spread and a ten-sample average that visibly shrinks it by √10 = 3.16 — the
exact thing `signals-noise` asks the learner to see. It is also the right order
for a real ATmega328P ADC on a breadboard supply.

## Verifying it

1. **Absent ⇒ unchanged.** The corpus differential used for D18/D20/D23 in this
   lane: solve all 310 sb3-creator benches through `Circuit.fromJSON` on both
   revisions and diff every node voltage and every branch current. Requirement:
   **zero** moved values, and 2635/2635 EXPECTED claims at the same verdict.
2. **Same seed ⇒ same trace, pinned exactly.** Because the generator is a pure
   hash, the test does not assert "a spread exists" — it pins the actual twelve
   integers. A test that only checks the standard deviation is non-zero passes
   for a broken generator that emits noise correlated with call count.
3. **Read count does not matter.** Read the same net once, then a thousand
   times, at the same `tNs`: identical. Then attach a scope channel and a probe
   and read again: still identical. This is the assertion that would have
   caught the stateful-PRNG design.
4. **Both solvers agree.** The same noisy bench built once with `vcc`/`gnd`
   symbols (walker) and once with a `vsource` (MNA) must give the same wiper
   voltage — the D23 cross-check, reused.
5. **Order independence.** Two boards built from the same netlist, advanced
   through different intermediate timestamps to the same final one, read the
   same value. `k` depends only on the final `tNs`, so this holds; the test
   states it because a future "advance the noise per step" optimisation would
   silently break it.
6. **A seed change is visible.** `setNoiseSeed(1)` gives a different pinned
   sequence from `setNoiseSeed(0)`, so the seed is really an input.

## Why it is not implemented in this lane

Its only consumer is an sb3-creator example (`arduino-03-smoothing` opting in),
and that repo owns its own benches. Shipping engine machinery with no caller is
the exact anti-pattern this project has already paid for once — the device
registry sat unloaded with 17 register functions and zero callers. The engine
half and the bench half should land together, in that order, in one
coordinated pair; **and the D22 sentinel in lite's Wave 6 gate does not flip
until the bench opts in**, so an engine-only landing would leave the defect
open while looking closed.

The mechanical part of that work is this document.
