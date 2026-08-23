# bw-board — engine roadmap (scoped 2026-08-23)

Actionable, fully-scoped work items from the 2026-08-23 engine survey. Each item names
its files, its approach, its acceptance oracle, and whether it is gated. **Every item
that touches `mna.js` requires a `spec-updates/` file plus hand-computed oracle tests
in the same commit** (the standing gate); the load-bearing specs are already filed and
referenced below. Standing rules from `PLAN.md` apply, especially: no competitor names
in committed content; never return a plausible number when the answer is "not
available"; non-convergence is reported, never hidden.

Phases are ordered by dependency. E0 is shippable immediately; E1 is the prerequisite
for E2–E4 being affordable.

---

## E0 — Correctness fixes in the current engine (days)

### E0.1 Battery double-stamp — `src/devices/power.js`
`registerDevice('battery')` stamps its source twice: `init()` sets
`state.drives.pos` (stamped generically as a Norton in `mna.js` `stampDevice`) AND
`stamp()` calls `ctx.thevenin('pos', volts, rInt)`. Two identical sources in parallel
halve the effective internal resistance. Fix: keep exactly one (the `ctx.thevenin`
call, since `stamp` is the documented place), delete the `drives` entry, and add a
regression oracle: a 9 V battery with `rInternal: 0.5` across a 1 Ω load must read
I = 9/1.5 = 6.000 A, not 9/1.25 = 7.2 A. No mna.js change; not gated.

### E0.2 Node-0-referenced drives — `src/mna.js` (GATED)
`state.drives` / `ctx.thevenin` always stamp `A[i][i] += g; b[i] += vTh·g` against
implicit ground. A device that drives a terminal *relative to its own return pin* is
unrepresentable, and a battery whose `neg` is not on the reference net is wrong.
Spec filed: `spec-updates/referenced-device-drives.md`. Depends on nothing; unblocks
correct battery/supply modelling off-ground.

### E0.3 Gates hard-code the rail — `src/devices/logic-gates.js:70`
`const vcc = 5.0; // TODO: read from ctx when available` — `ctx.vcc` IS available.
Replace the constant; thresholds (30 %/70 %) and output Thévenin scale with the real
rail. Oracle: a 3.3 V board with a gate input at 2.0 V must read logic high
(2.0 > 0.7·3.3 = 2.31 is FALSE — so logic *low*; the point is the answer changes vs
the 5 V constant, assert both thresholds at 3.3 V and 5 V). Not gated.

### E0.4 `solveMNA` mutates the caller's netlist — `src/mna.js` (GATED, folded)
The ground-merge (`nets.splice()` + `main.terminals.push()`) permanently rewrites the
board's `nets` on first solve. Make the merge a solver-local view. Folded into the
sparse-assembly rewrite (E1.1 spec) because the assembly pass rebuilds net indexing
anyway. If E1.1 is delayed, this may land alone under the same spec.

### E0.5 Stale headers
`mna.js` header still says "Used only for branchCurrent and resistance"; `board.js`
header still says "No MNA solver yet". Both predate `_needsMNA`. Align with reality.
Doc-only; not gated, but keep it out of any commit that also changes behaviour.

---

## E1 — Numerics: sparse, reuse, adaptive (the prerequisite phase)

### E1.1 Sparse LU + factorization reuse — `src/mna.js` (GATED)
Spec filed: `spec-updates/sparse-lu-factor-reuse.md`. Replace the dense
`Float64Array(dim²)` + fresh Gaussian elimination + per-NR-iteration `A.clone()` with
triplet assembly → CSC → LU with partial pivoting, symbolic pattern reused across NR
iterations and transient sub-steps, RHS-only re-solve for linear circuits. Also
subsumes: `findNet` linear-scan elimination (precomputed terminal→row map built once
per `setNetlist`) and E0.4. License guidance in §"Backends and licence policy" below —
KLU and everything CSparse-derived (including the sparse path inside mathjs) is LGPL
and MUST NOT be used, ported, or read; the permitted sources are named in the spec.

### E1.2 Adaptive transient with trapezoidal — `src/mna.js` + `src/board.js` (GATED)
Spec filed: `spec-updates/adaptive-transient.md`. Replace the fixed 100 µs
backward-Euler sub-step (hard cap 200 per `advanceTo`, an admitted accuracy limit)
with LTE-controlled step selection and trapezoidal companions (BE retained for the
first step after a discontinuity). Device `update()` cadence and the one-sub-step
switching resolution are part of the spec.

### E1.3 Shockley diode path + junction limiting — `src/mna.js` (GATED)
Spec filed: `spec-updates/shockley-junction-limiting.md`. `shockleyCompanion()` is
already written and is dead code — no caller passes `opts.shockley`. Turn it on for
`diode`/`led`/BJT junctions behind pnjlim-style limiting so NR stays stable; keep the
piecewise-linear knee as the closed-form fast path's model and as a per-part opt-out.

### E1.3b Shockley default flip — coordinated, after E1.3
E1.3 landed Shockley OPT-IN (`params.model:'shockley'`): the measured
canonical-bench shift is +3.9 % and the walker still answers the knee, so a
silent default flip is two-truths-on-one-bench plus unannounced corpus
drift. The flip is one coordinated change: route all junction benches past
the walker (or teach the walker the exponential), flip the default, and
re-measure the shipped corpus WITH the examples owner in the same landing.
Blocked on: corpus re-measurement scheduling. Not on code.

### E1.4 Convergence fallback ladder — `src/mna.js` (GATED)
When plain NR fails, do not report failure immediately: try GMIN stepping (raise GMIN,
converge, ratchet down), then source stepping (scale all sources 0→1). Only after the
ladder is exhausted report `converged: false` — the existing honest reporting stays
the terminal state. Covered in the same spec as E1.3 (§ "when limiting is not
enough"). Oracle: a bistable flip-flop circuit that defeats plain NR must converge
under source stepping to one of its two states deterministically (seed the state).

### E1.5 Worker-safety audit — `src/index.js`, no behaviour change
E2's Monte-Carlo/sweep runners construct offline `BoardImpl`s in Web Workers.
Verify the engine is importable in a worker (no `window`/DOM reads on any code path —
device modules included) and that `(parts, nets)` are structured-cloneable. Add a
node test that constructs a board inside a `worker_threads` worker. Not gated.

---

## E2 — Analyses

### E2.1 True small-signal AC — `src/mna.js` + new `src/ac.js` (GATED)
Spec filed: `spec-updates/ac-small-signal.md`. Linearize every nonlinear device at the
DC operating point, stamp complex admittances (jωC, 1/jωL, gm at the OP), solve
complex sparse MNA per frequency point. Replaces the time-domain sine-correlation
sweep (6 settle + 4 measure cycles per point) as the *engine* answer; the
time-domain path remains available as a cross-check oracle because the two must agree
for linear circuits. Depends on E1.1 (complex solve reuses the sparse kernel).
This is the single most visible capability gap against the commercial field; it also
makes op-amp frequency response meaningful once E3.1 lands.

### E2.2 Temperature as a bench parameter — `src/board.js` + device files
`setTemperature(celsius)` on the Board (default 25). Consumers: diode/LED Vf
(−2 mV/°C), BJT Vbe, NTC (already parameterised — route the bench temperature in as
the default control), TMP36 (reads it directly). Boundary-B addition → needs a short
spec-update (file it as `spec-updates/bench-temperature.md` when starting; contents:
API, default, which models consume it, and the rule that parts with an explicit
user-set control are NOT overridden). Oracle: TMP36 at 25 °C reads 0.750 V; a red LED
chain's current shifts by the hand-computed dVf.

### E2.3 Tolerance metadata passthrough — `src/mna.js` param handling (small)
Parts gain optional `params.tolerance` (fraction, e.g. 0.05). The ENGINE does not
randomize — it only stores and exposes the field; randomization happens in the
UI-side Monte-Carlo runner (bw-circuit-ui X2.3) which builds offline boards with
perturbed values. Engine work is only: don't strip unknown params (verify), document
the field in `CIRCUIT-EXTENSION.md`. Not gated if no stamp logic changes.

---

## E3 — Model depth (education-driven; each item independently shippable)

### E3.1 Op-amp GBW + slew macromodel — `src/mna.js` opamp stamp (GATED)
Replace/augment the ideal VCVS row with the standard single-pole macromodel: input
stage gm into an internal RC node (pole at GBW/A0), output buffer with Rout, slew as
a current clamp on the internal node, rails kept from the existing region FSM.
Defaults for the shipped parts: LM358-class GBW 1 MHz, slew 0.5 V/µs. This also
retires the damped-integrator `lm358` device model (`devices/analog-amps.js`) whose
header admits it has no frequency response — the registered device becomes a thin
parameterisation of the solver opamp. File `spec-updates/opamp-macromodel.md` before
starting (contents: the two-node macromodel, param names, how the region FSM
composes, and the AC-analysis stamps). Oracle: a unity-gain follower's −3 dB point at
GBW; an inverting ×10 amp at GBW/10 — both against the E2.1 AC sweep AND analytic.

### E3.2 BJT: Early effect + reverse-active — `src/mna.js` (GATED)
Extend the simplified Ebers-Moll (currently B-E diode + gm VCCS, no Early, no
reverse) with VA (output conductance gm·Vce/VA term) and the reverse-active region.
Equations from the BSD-licensed SPICE3f5 set. File
`spec-updates/bjt-early-reverse.md`. Oracle: a common-emitter stage's measured gain
vs the analytic gm·(RC ∥ ro); a saturated-then-reversed transistor test.

### E3.3 MOSFET: body diode + gate capacitance — `src/mna.js` (GATED)
Level-1 with Meyer capacitances and the body diode (reuses E1.3's junction stamp).
Replaces the hard-wired gds = 0.001. Enough for gate-driver, flyback, and
synchronous-rectifier lessons; BSIM is explicitly out of scope. File
`spec-updates/mos-level1.md`. Oracle: body-diode freewheeling current in an
inductive-kick circuit; gate-charge plateau visible on the scope.

### E3.4 Coupled inductors / transformer — `src/mna.js` (GATED)
New part kind `transformer` (or `k` coupling on two inductors): standard MNA
mutual-inductance companion stamps. Currently unrepresentable, and it blocks every
mains/isolation/boost lesson. File `spec-updates/coupled-inductors.md`. Oracle:
ideal 2:1 turns ratio voltage/current transfer within tolerance; energy conservation
check across a transient.

### E3.5 Controlled sources E/F/G/H — `src/mna.js` (GATED)
VCVS/CCCS/VCCS/CCVS as first-class part kinds. The opamp VCVS row machinery
generalizes; CCCS/CCVS need a branch-current row (same mechanism as vsource rows).
Prerequisite for the SPICE-netlist importer (bw-circuit-ui X1.1) to cover real decks.
File `spec-updates/controlled-sources.md`. Oracles: each source type against the
textbook two-port answer.

### E3.6 Behavioral honesty upgrades — device files, not gated
- `optocoupler`: LED side gets a real junction (reuse diode stamp via `ctx`), output
  scaled by a CTR param (default 1.0) instead of on/off.
- `lm393`/`lm339`: optional hysteresis param (default 0 — datasheet-honest).
- `light_bulb`: PTC filament (R grows with dissipated power, one-pole thermal state in
  `update()`) — inrush becomes demonstrable.
Each with a hand-computed oracle in the same commit.

---

## E4 — Mixed-signal timing

### E4.1 Scheduled device events (propagation delay) — `src/board.js` + `src/devices.js`
The logic-gates header says it plainly: "Propagation delay: not yet modelled (would
need scheduled events in the board loop)". Add a per-device event queue: `update()`
may return `{at: tNs, fire: fn}` scheduling instead of only a boolean; the board's
`_earliestDeviceDeadline` mechanism already exists and generalizes. Gates gain
`tpd` (default a few ns, visible at sim timescales when the user slows time).
Boundary-B contract change → file `spec-updates/scheduled-device-events.md` first
(contents: the return shape, ordering guarantees, interaction with E1.2's adaptive
steps, and the rule that a fired event forces a solve point). Oracles: a 3-inverter
ring oscillator whose period is 6·tpd; a glitch on a hazard circuit that the fixpoint
model provably cannot show.

### E4.2 Logic-analyzer channels — engine side
Digital channels on the existing scope-tap contract (boundary B v2 §5): sampled at
edge events (cheap once E4.1 exists), stored as (t, level) transitions rather than
(min,max) pairs. Small spec addendum to `spec-updates/scope-tap.md`. UI lands in
bw-circuit-ui X2.5.

---

## Backends and licence policy (verified against primary sources, 2026-08-23)

The engine stays ours. No permissive drop-in replacement carries our boundary
contracts, honesty rules, or MCU coupling. External engines serve as **oracles only**
(the ucsim precedent; 70 ngspice differential oracles already exist in `test/`).
For anyone touching E1.1/E2.1, the licence map:

| Source | Licence | Ruling |
|---|---|---|
| ngspice core, SPICE3f5 device equations | BSD-3 | Equations and constants may be used. **The shipped ngspice binary/WASM is NOT bundleable: `src/frontend/numparam` is LGPL-2.1+ and compiled into every build** — the MIT-labelled WASM wrappers on npm carry it inside. CI oracle only, unless someone excises numparam upstream (research track, not planned). |
| Kundert Sparse 1.3/1.4 | MIT-class ("any purpose, without fee") | OK — transliterate or compile. It is SPICE3's own solver. |
| SuiteSparse AMD/CAMD/COLAMD | BSD-3 | OK (ordering only). |
| SuiteSparse KLU, BTF, CSparse/CXSparse; mathjs's sparse LU (verbatim CSparse) | LGPL | **NO. Do not use, port, or read while implementing.** |
| Eigen SparseLU | MPL-2.0 (master; build `EIGEN_MPL2_ONLY`) | Acceptable at file level if a WASM route is ever preferred over JS; JS-native is the default plan. |
| SuperLU | BSD-3 | OK as a reference; exclude its non-free MC64 ILU path. |
| @spice-ts/core (pure-TS engine) | MIT | OK to adapt specific pieces (sparse LU, pnjlim, LTE step control) **with attribution in THIRD-PARTY.md**. Too young (2026-04, ~20 stars) to depend on as a package. |
| SpiceSharp (C#) | MIT | Equation/structure reference and oracle only; its BSIM add-on repo has NO licence file — do not touch that repo. |
| Berkeley BSIM | UC-permissive (BSD-like + "no charging for the UC code") | OK if ever needed; explicitly out of scope for E3. |
| Open-PDK model cards (sky130, gf180mcu, SG13G2) | Apache-2.0 | OK. |
| digitaljs + yosys2digitaljs (BSD-2), Yosys/YoWASP (ISC) | permissive | Available for a future HDL tier; not needed for E4. |
| GPL simulators/engines (any) | GPL | Oracle only, never in the dependency graph, never read for implementation. |

Every adapted-code landing updates `THIRD-PARTY.md` in the same commit.

---

## Sequencing

1. **E0** (all) — days; removes shipped wrong answers.
2. **E1.1 → E1.2 → E1.3/E1.4** — the numerics core, in that order (adaptive stepping
   and Shockley both want the cheap re-solve).
3. **E2.1** AC analysis — the visible leap; then E2.2/E2.3 cheaply.
4. **E3.1** op-amp macromodel (pairs with E2.1), then E3.4 transformer, E3.5
   controlled sources (unblocks the SPICE importer), E3.2/E3.3/E3.6 as lessons demand.
5. **E4** when the retro/TTL tier needs real timing.

Cross-repo dependencies: bw-circuit-ui X1.1 (SPICE import) wants E3.5; X2.x runners
want E1.5; the AC UI wants E2.1. brickwright-lite re-vendors via `sync:bwboard` after
each landing.
