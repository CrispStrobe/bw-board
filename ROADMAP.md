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

## Status (2026-08-23, end of day) — do not redo landed work

LANDED on master: E0 (50c3bf7), E1.1 sparse LU + reuse (d9136cc..e2da40f),
E1.2 adaptive transient (011639f), E1.3/E1.4 opt-in Shockley + ladder
(8ca1504) + series-rs (35cf233), E2.1 true AC (c49ff5f), boundary-B
setDeviceControl (0f1f29e), E3.1 op-amp macromodel + E3.5a vcvs/vccs
(fea58ed), plus four defect fixes found by the examples owner's
instruments: loaded-wiper KCL routing (40db90f), advance-pattern
invariance / solver-owned motor winding / C1 PWL knee (2ac81e6), walker
coverage fall-through (0a3e9c0), shared-terminal net coalescing
(2235de5). OPEN: E1.3b default flip (owner pedagogy ruling — the
crossover table is in sb3-creator test/measurements/E13B-SHOCKLEY-DELTA.md),
E1.5, E2.2/E2.3, E3.2–E3.4, E3.5b (cccs/ccvs), E3.6, E4, E5 below.

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

### E4.1a Gate propagation delay rides E4.1 — the 74* curriculum unlock
Once scheduled events exist, `devices/logic-gates.js` (and the
chip-composer 74HC family) gain `tpd` (default a few ns, per-part
override): ring oscillators whose period is Σtpd, hazard/glitch demos a
fixpoint model provably cannot show, honest flip-flop setup/hold lessons.
This is the single engine item that most widens the 74*/retro example
space — sequence it accordingly. Oracles as in E4.1.

### E4.2 Logic-analyzer channels — engine side
Digital channels on the existing scope-tap contract (boundary B v2 §5): sampled at
edge events (cheap once E4.1 exists), stored as (t, level) transitions rather than
(min,max) pairs. Small spec addendum to `spec-updates/scope-tap.md`. UI lands in
bw-circuit-ui X2.5.

---

## E5 — Retro & TTL example-space enablers (scoped 2026-08-23, owner-requested)

Context, so the scope is understood: the retro tier is a layered stack —
instruction-level CPU cores (w65c02/z80/m6507) booting real ROMs; ~34
register-level bus-peripheral models clean-room from datasheets (W65C22
VIA, W65C51/MC6850 ACIA, TMS9918 VDP with the four-sprites-per-line
rule, MC6845, M6532, AY-3-8912, NS16C550, ZX ULA, PS/2, SD-SPI,
memories as real byte arrays); the bus extractor deriving the machine
FROM THE DRAWN WIRING by evaluating every select condition at all 65536
addresses, refusing bus contention and open vectors with addresses
named; and chip-qualified Norton drives carrying pin levels into the
MNA. Wiring differently genuinely changes the machine — or produces a
named refusal. The corpus uses a fraction of this (~14 of 236 examples
touch the tier). New EXAMPLE WAVES are the examples owner's lane and
gated by lite PLAN.md Milestone 0's review-debt rule; the items below
are the ENGINE work that widens the space those waves can draw on.

### E5.1 Extractor SELECT vocabulary — `src/m6502-extract.js` (+ z80 twin)
The decode evaluator knew five select shapes (62256, 28C256, W65C22,
W65C51, TMS9918). Each addition is one SELECT-table entry + RS_PINS/
CHIP_DECL rows + an extraction fixture.
**MC6850, NS16C550, M6532 DONE:** (NS16C550: DIP-40 pin surface +
SELECT entry — the machine ran 'uart16550' from declarations already,
the drawn decode now reaches it; the pre-existing bw-parts sidecar
carried an 8250-flavored pin table and was replaced, record in
bw-parts 4b62cbd. M6532: two-select window with RS0B pinned to A7 —
the RAM/register partition the core encodes as address bit 7 — plus
the 'riot' machine kind; RAM r/w + DDRA + 256-byte mirror oracles.)
**MC6850 detail (first slice):** SELECT entry (cs0·cs1 high, /cs2 low, E
is timing like PHI2), rs on A0, span 2; m6502-machine grew the
'acia6850' instantiation (same MC6850 core the z80 machines run); the
extractor now emits the MEASURED decode window as `span`, so registers
mirror through it like silicon. Fixture: the 6850 in the canonical
decode's $4000 hole beside the W65C51, floating-select refusal,
window-collision contention named at $5000, and a machine-level tx/rx +
mirror oracle.
Remaining candidates, BOTH needing extractor SHAPE work first, not
just table rows: AY-3-8912 (BDIR/BC1 two-phase latch select) and
UM245R (directional RD/WR strobes off the decode, the z80 twin's
dir:'read' shape — and the 6502 machine has no um245r chip kind yet). Acceptance per chip: a
hand-wired decode fixture extracts the right window; a deliberately
contending decode is refused with the address named. Not gated (no
mna.js).

### E5.2 Address-permutation support — DONE
DONE 2026-08-23: the extractor detects the permutation per RAM/ROM
chip (perm[i] = the CPU line chip pin a<i> rides), carries it as
regions[].perm, and the machine applies it in _read/_write. RAM
permutes transparently (readback oracle) AND the model is proven real:
the byte the CPU wrote at $0008 physically lands in cell $0020. A
permuted ROM scrambles its linearly-programmed image exactly as the
silicon would (asserted byte-for-byte). Refusals stay for wiring no
permutation can describe: a data/address cross-wire, a line above the
window, two pins on one line. Register selects stay strict. The MAP
grammar cannot express perm — honest, since only drawn wiring can
produce one.

### E5.3 MCP23008 port expander — `src/devices/` (named gap, stc ROADMAP)
I2C GPIO expander to the same standard as pcf8574 (which exists):
register model (IODIR/GPIO/OLAT + address pins), i2c-slave engine hookup,
drives per boundary B. Acceptance: bit-banged I2C from a scripted MCU
sets an output pin that lights an LED through the solver; input path
reads a button. Not gated.

### E5.4 Generic NxM scanned matrix part — `src/devices/` (named gap)
The 16x8 retro-console matrix and the LED-cube are special-cased;
lessons want arbitrary row/column scanned matrices with duty-correct
brightness (1/rows). One parameterised part (rows, cols, polarity),
sharing the led-perception duty integration. Acceptance: an 8x8 scanned
at 1/8 duty reads brightness 0.125·(i/i_rated) per lit cell; a
charlieplexed fixture refuses with a reason rather than guessing.
Not gated.

### E5.0 The owner's 6502-build BOM — coverage matrix (2026-08-23)
The owner's actual parts order (W65C02S build, Mouser) is the concrete
target: everything on it simulated and example-covered, in the end.
Verified against the engine line by line:

| BOM part | model | notes |
|---|---|---|
| W65C02S | ✅ | CPU core + extractor + machine + debugger |
| AS6C62256 (62256) | ✅ | real byte array, /CS /OE /WE, floating-strobe hazard modeled |
| AT28C256 EEPROM | ✅ write incl. | write-cycle time / page mode / SDP unmodeled — note only |
| W65C22 VIA | ✅ | timers count phi2 |
| **W65C51N ACIA** | ✅ **as the N silicon** | the infamous TDRE bug (bit 4 stuck) is what the model implements — matches the ordered part; a `params.datasheetTdre` variant is a later nicety |
| NE555 | ✅ | timer_555 |
| 74HC373 | ✅ **E5.6 done** | transparent latch in chip-composer, with the not-a-'374 oracle (data during LE-high propagates); sidecars landed (bw-parts 9d9fef8, bw-circuit-ui 90161eb), both families |
| 74HC595 | ✅ | FSM + oracle |
| 74HC(T)04/14/00/32/08/138/245 | ✅ | **E5.7 done**: 74hct* kinds + params.family:'hct' give TTL-fixed 0.8/2.0 V (1.4 V center for the mid-rail models); aliases for hct00/04/08/14/32/138/245 |
| ATmega88PA | ✅ **E5.8 done** | chip entry with the family's ONE-word vector table (half the 328P addresses), 8 KB/1 KB bounds; blink + UART hand-assembled oracles; oversize image refused with the size named |
| DIP oscillator cans (1.8432 MHz, 1 MHz) | ✅ **E5.9 done** | `osc_can` (OE/GND/OUT/VCC, params.freq) drives its square via E4.1 wakes so dividers count real edges; '93-chain f/16 oracle; sidecar landed (osc_can, DIP-14 corner leads) |
| MAX232 | ✅ **E5.10 done** | devices/max232.js: ±8 V inverting drivers behind 300 Ω, receivers with 1.3 V threshold + real 5 kΩ load (fail-safe high), pump rails probeable; loopback oracle |
| 330 Ω bussed SIP network | ✅ **E5.11 done** | rnet_sip (params pins/ohms/topology): pure stamp device; oracles include the bussed-misuse measurement (path through the common pin) |
| 10-seg LED bars | ✅ | bargraph |
| caps/resistors/trimmer/switches/DIP-switch/battery holders/headers/USB breakout | ✅ | battery holders = battery with volts param; USB-C breakout is bench furniture |

Example COVERAGE is the second axis and the examples owner's lane
(lite ROADMAP §3.5 item 8): even fully-modeled BOM parts are thinly
exampled today.

### E5.6 74HC373 transparent latch — DONE (engine half)
The '374 (edge-triggered) exists; the '373 (transparent, LE level-
gated) does not, and the BOM orders a '373. One chip-composer entry +
sidecar pinout + oracle: outputs FOLLOW D while LE is high, latch on
the falling edge, tri-state on /OE — and a test asserting it is NOT a
'374 (data change during LE-high propagates). Not gated.

### E5.7 HCT input thresholds — DONE
HC thresholds are 30 %/70 % of VCC; HCT is TTL-fixed (VIL 0.8 V,
VIH 2.0 V) regardless of rail — the reason HCT parts are on this BOM at
all (5 V system mixing MCU drive levels). `params.family: 'hct'` (or
kind aliases 74hct*) switches the thresholds. Oracle: a 3.6 V input at
VCC 5 reads high for HCT and high for HC, but 2.2 V reads high ONLY for
HCT. Not gated.

### E5.8 ATmega88PA chip config — DONE
Same family as the 328P with 8 KB flash / 1 KB SRAM and near-identical
register file. Verify what the 168P example variants actually run on,
add the mega88PA entry, and give it a board fixture. Acceptance: blink +
UART fixture runs on the mega88PA config with the right memory bounds
(an image over 8 KB refuses with the size named). Not gated.

### E5.9 DIP oscillator can — DONE (engine half)
A powered clock module is not a crystal: OE/VCC/GND/OUT, drives a
square wave at params.freq. The machine tier's clock stays adapter-
driven (stated in the crystal's own doc); the part serves bench
lessons (frequency counters, dividers via '93/'161) and the drawn-
wiring story. Model: a square vsource behind 50 Ω when powered, high-Z
when not. Oracle: a '93 divider chain off a 1 MHz can reads f/16 on a
scope channel. Not gated.

### E5.10 MAX232 — DONE
Dual RS-232 driver/receiver: inverting buffers with ±charge-pump rails
approximated as ±8 V drive behind 300 Ω, receivers with TTL-out
inversion and RS-232 thresholds; the four charge-pump capacitor pins
load as 1 µF each so the canonical wiring draws correctly. The serial
DATA path already exists (ACIA onTx hooks); this part makes the drawn
level-shifting honest. Oracle: TTL 5 V in → RS-232 ≈ −8 V out and back.
Not gated.

### E5.11 Bussed resistor network (SIP) — DONE (engine; sidecar pending)
One part, params {pins, ohms, topology: 'bussed' | 'isolated'}: pin 1
common + N resistors (bussed) or N isolated pairs. Teaching point: the
common-pin topology itself (a bussed network CANNOT be used where
isolated resistors are needed — LED bar current sharing). Expansion into
hidden resistors (composite precedent) keeps the solver untouched.
Oracle: 9-pin bussed 330 Ω from a rail lights 8 bargraph segments at
the hand-computed per-segment current. Not gated.

### E5.5 Bus TIMING domain — long-horizon, do not start casually
The extractor models the ADDRESS domain; RWB/PHI2/data are checked for
presence, not timing. A timing domain (setup/hold at the bus, wait
states, /CSR-vs-/CSW write gating the TMS9918 note already names) is
real work with E4's event queue as its substrate. Record-only until E4
lands and a lesson actually needs it — the refusal-with-reason posture
is the honest interim.

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
