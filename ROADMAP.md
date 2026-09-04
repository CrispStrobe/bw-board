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

LANDED on master (updated 2026-08-24): E0 (50c3bf7), E1.1 sparse LU +
reuse (d9136cc..e2da40f), E1.2 adaptive transient (011639f), E1.3/E1.4
opt-in Shockley + ladder (8ca1504) + series-rs (35cf233), E1.5 worker
safety + E4.1/E4.1a scheduled events + gate tpd + the step-controller
floor fix (6be91c2), E2.1 true AC (c49ff5f), E2.2 bench temperature +
E2.3 tolerance + E4.2 logic-analyzer channels (6fa2893), boundary-B
setDeviceControl (0f1f29e), E3.1 op-amp macromodel + E3.5a vcvs/vccs
(fea58ed), E3.6 honesty upgrades incl. the comparator-init latent fix
(88e9668), ALL of E5 — E5.6-E5.11 + E5.8 (ea81407..2f9f0af), E5.1's
five extractor chips MC6850/NS16C550/M6532/AY-3-8912/UM245R with the
rwb evaluation axis (0ec8558..0060b80), E5.2 address permutation
(5b2eecd) — plus four defect fixes found by the examples owner's
instruments: loaded-wiper KCL routing (40db90f), advance-pattern
invariance / solver-owned motor winding / C1 PWL knee (2ac81e6), walker
coverage fall-through (0a3e9c0), shared-terminal net coalescing
(2235de5).

ALSO LANDED (2026-08-29): the conductance no-op class
(`spec-updates/ideal-high-z-inputs.md`, f20ee99) — 178 declarations
across 41 files that could never stamp, because `ctx.conductance(t,
null, g)` fails `stampTwoTerminal`'s air-leg guard. 176 adjudicated
INTENDED-IDEAL and deleted (the ideal high-Z input is the model; 1 MΩ
is not a CMOS input, and GMIN already keeps every pin a real node), 2
implemented as MISSING-PHYSICS (the MAX232 receiver's datasheet 5 kΩ),
3 more named and deferred. Ratcheted at 0 by
`test/conductance-noop-ratchet.test.mjs`, mutation-proved. And E2.1a,
the AC operating-region follow-up (`ac-operating-region.md`, 33b9fe9).

OWNER RULINGS (2026-08-24), closing the open questions:
- E1.3b is RULED: PWL stays the default, Shockley stays opt-in. The
  curriculum operates below the ~8 mA crossover, where PWL sits closer
  to the datasheet Vf the lessons quote; a course that contradicts the
  datasheet it just taught loses more than it gains. Revisit only via a
  deliberate "real diode curve" lesson that opts in.
- E3.4 transformer is NEXT (it unblocks the power-supply lesson arc);
  E3.2 BJT Early/reverse and E3.3 MOS body diode + Meyer caps are
  DEFERRED until a lesson would show the difference. Same standing
  mna.js gate when they come up.
- The filament bulb's inrush stays OPT-IN (params.filament) until an
  inrush lesson exists to opt in deliberately.

OPEN after the rulings: E3.2/E3.3 (deferred by ruling), E3.5b cccs/ccvs (deferred by
spec-updates/controlled-sources.md until the SPICE importer consumes
them), AY 8910/8913 pin surfaces (when a board needs them).

ADDED 2026-08-29 — the lite defect wave D18/D20/D23 (+D22 design), landed
as `999eb66..3e58fd7`:
- **D18** — the `lm358` device model is FIXED, not retired. E3.1 above says
  the macromodel "also retires the damped-integrator lm358 device model";
  it did not, and the model was still halting on a 1 mV output step, so a
  ×46.4545 stage realised 31.04. It is now a secant iteration on the input
  error and realises the design gain at every input. Retiring it in favour
  of a solver `opamp` parameterisation remains open and is now OPTIONAL
  rather than corrective.
- **D20** — `spec-updates/opamp-output-limit.md`: the solver op-amp gains
  `rout` (default 0) and `iShort` (default 40 mA), the latter as two new
  regions on the existing rail FSM. This is the E3.1 output slice; GBW and
  slew stay where E3.1 put them, behind `model: 'macro'`.
- **D23** — the closed-form walker's first-solve capacitor semantics now
  match the MNA path's (stored state honoured, unseeded = uncharged, an
  ideal source on both plates wins).
- **D22** — `spec-updates/seeded-measurement-noise.md`, DESIGN ONLY. The
  engine half and an example opting in must land together.
Corpus impact of the whole wave, measured across all 310 sb3-creator
benches: ONE moved value (76-multimeter's LM358 stage — the defect), zero
EXPECTED-claim verdicts changed.

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

**E2.1a operating-region awareness — DONE.** `spec-updates/ac-operating-region.md`.
The AC op-amp row used to linearize about the DC bias while ignoring what that
bias WAS, so a stage at a rail reported |H| = 10 where the truth is 0, and a
current-limited follower reported 0.99999900. `solveMNA` now returns the
`opampRegions` it settles, `acSweep` takes it, and the row follows the region:
railed pins the output VOLTAGE, current-limited pins the branch CURRENT (`i = 0`),
which are different rows on any load that is not a resistor to AC ground. Each
sweep point carries `outOfLinear` naming the stage and its region, so a correct
zero is not a mystery. Closes the limitation `spec-updates/opamp-output-limit.md`
filed.

### E2.2 Temperature as a bench parameter — DONE
`setTemperature(celsius)` on the Board (default 25). Consumers: diode/LED Vf
(−2 mV/°C), BJT Vbe, NTC (already parameterised — route the bench temperature in as
the default control), TMP36 (reads it directly). Boundary-B addition → needs a short
spec-update (file it as `spec-updates/bench-temperature.md` when starting; contents:
API, default, which models consume it, and the rule that parts with an explicit
user-set control are NOT overridden). Oracle: TMP36 at 25 °C reads 0.750 V; a red LED
chain's current shifts by the hand-computed dVf.

### E2.3 Tolerance metadata passthrough — DONE (pinned by test; engine stays deterministic)
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

### E3.4 Coupled inductors / transformer — DONE
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

### E3.6 Behavioral honesty upgrades — DONE
- `optocoupler`: LED side gets a real junction (reuse diode stamp via `ctx`), output
  scaled by a CTR param (default 1.0) instead of on/off.
- `lm393`/`lm339`: optional hysteresis param (default 0 — datasheet-honest).
- `light_bulb`: PTC filament (R grows with dissipated power, one-pole thermal state in
  `update()`) — inrush becomes demonstrable.
Each with a hand-computed oracle in the same commit.

---

## E4 — Mixed-signal timing

### E4.1 Scheduled device events (propagation delay) — DONE (`6be91c2`; hazard oracle completed by the coordinator, 2026-08-30)
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

### E4.1a Gate propagation delay — DONE (rides `6be91c2`; the 74* curriculum unlock is OPEN for the examples owner)
Once scheduled events exist, `devices/logic-gates.js` (and the
chip-composer 74HC family) gain `tpd` (default a few ns, per-part
override): ring oscillators whose period is Σtpd, hazard/glitch demos a
fixpoint model provably cannot show, honest flip-flop setup/hold lessons.
This is the single engine item that most widens the 74*/retro example
space — sequence it accordingly. Oracles as in E4.1.

STATUS 2026-08-30: this section described work that had ALREADY LANDED
(`6be91c2`, 2026-08-23 — the spec, the canonical `_wakeNs` wake, gate
`tpdNs` with inertial sub-tpd cancellation, and four oracles incl. the
2·Σtpd ring). The roadmap was the stale artifact, found when the
coordinator sat down to author the contract this text asked for. What
was genuinely missing was the second oracle the text demands — "a glitch
on a hazard circuit that the fixpoint model provably cannot show" — now
in `test/scheduled-gate-tpd.test.mjs`: the static-1 hazard
Y = A·B + Ā·C with skewed tpds glitches low for exactly the path skew
(hand timeline in the test), and the same bench un-armed never dips.
The CONTENT unlock (ring-oscillator and hazard example benches for the
74* tier) remains open for the examples owner.

### E4.2 Logic-analyzer channels — DONE (engine side)
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

### E5.1 Extractor SELECT vocabulary — DONE (all five candidates)
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
**AY-3-8912 DONE** (spec first, then same-day implementation; the two
contract corrections the implementation surfaced are folded back into
the spec, marked ⟲): the evaluator gained an rwb axis, BDIR/BC1 are
CLASSIFIED over (addr, rwb) into latch/write/read sets, the two-address
shape is validated (interleaved period 2, latch even; read parity
RECORDED as readMask, not legislated), an AY read window overlapping
any other chip is bus contention with the address named, BDIR active
during a read cycle refuses with the fix named, and m6502-machine runs
'psg8912' over the AY38912 core. ay8912 DIP-28 pin surface added.
**UM245R DONE** — the second consumer of the rwb axis: /RD low during
read cycles and WR high during write cycles classify into one shared
window (read-only and write-only wirings noted, disagreeing windows
refused); /RD active during a write cycle or WR during a read refuses
with the address and the fix named. m6502-machine runs 'um245r' as a
one-address FIFO (read = next queued byte or 0xff — RXF/TXE are PINS
on this part, not registers; write = onSerial; feed via rxPush).
E5.1 is closed: MC6850, NS16C550, M6532, AY-3-8912, UM245R. Acceptance per chip: a
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
Not gated. **Amended 2026-08-29** (`spec-updates/ideal-high-z-inputs.md`): the
receiver's datasheet 5 kΩ input resistance was declared with no second terminal
and so never stamped, which left the drivers reporting an unloaded ±7.976 V —
a swing the part does not have, since ±8 V behind 300 Ω is calibrated for the
datasheet's 3 kΩ test load. Stamped against the part's own `gnd`, the loopback
bench reads the hand value −8000/1063 = −7.525870178 V.

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

## E6 — The 8086 tier (scoped 2026-09-03, owner-requested)

Context: the retro tier gains an x86 beside the W65C02 and the Z80. The
survey that preceded it is in brickwright-lite `docs/I8086-CORE-PLAN.md`
and its conclusion is load-bearing, so it is repeated here in one line:
nothing permissively licensed was adoptable as a CORE — MartyPC (MIT) and
PCjs (MIT) are whole machines, the two projects that look like the right
shape interpret assembly TEXT and never fetch an opcode byte, and the rest
of the field is GPL. What WAS adoptable is the oracle, and it turned out to
be a better one than either of the other two CPUs got.

**This is three machines, not one, and they are separable.** Tier A is a
breadboard computer in the shape this engine already builds. Tier B is a
service layer with no hardware in it at all. Tier C is a PC/XT. Each is
independently useful and only Tier C is expensive.

### E6 STATUS, measured 2026-09-03 (integration branch `feat/i8086-tier`)

```
Amey textbook corpus, 525 programs:
  498  EXITED    terminated cleanly AND produced output
   12  LOOPING   still running at the budget, and driving something
   15  THREW     assembly refused (MASM refuses 14 of them too)
    0  HUNG      0 SILENT      refused services: none

yousefkotp emu8086 coursework, 10 projects:
    8  LOOPING     2  THREW  (both are defects in that repo)
```

Built and green: the core and disassembler (both 646,000/646,000), 8255,
machine, adapter, debug target, 8259/8254/8251, the bus extractor with named
refusals, DIP parts in bw-parts (`41706a7`, pushed), DOS/BIOS services, an
8086/MASM assembler (510/525 accepted), a clean-room emu8086 device layer, a
CGA/VGA renderer, and `scripts/run-i8086-corpus.mjs`.

NEXT, and it is measured rather than chosen: with every DOS/BIOS service
implemented the harness's refusal histogram reports unclaimed I/O PORTS, and
the top entry is **port 97 -- 61h, the PC speaker gate on the XT's PPI port
B, 24 accesses across the corpus**. Both parts needed to close it (the 8255
and 8254 channel 2) already exist in this tier.

### E6 REVIEW — independent architecture pass (2026-09-03, session `sim3`)

A reviewer who did not build the tier re-ran the oracles rather than reading
the claims, and the four headline numbers all reproduce:

| Claim in this document | Re-measured |
| --- | --- |
| core 646,000/646,000 vectors | `323 files pass, 0 fail, 646000/646000 (100.000%)` |
| disassembler 646,000/646,000 on TEXT and length | `646000/646000, 3 excluded` — the three documented in §4b |
| the i8086 suite is green | `node --test test/i8086*.test.mjs` → 237 pass, 0 fail |
| 4.0 M instr/sec | 5.17 M on an independent mix; the quoted figure is conservative |

Seven findings. They are ordered by what they cost if left, not by size.

**R1 — CI CHECKS ZERO VECTORS, and a skip reads the same as a pass.** CLOSED `c5fabd5`. The
sampled grind in `test/i8086.test.mjs:186` is `{ skip: !existsSync(suite) }`,
and `~/code/8086-vectors` does not exist on a runner, so `646,000/646,000` is
a number from one developer's box on one day. The 525-program corpus is not in
the tree either, so `469 MATCH` decays the same way. This is precisely the
failure `.github/workflows/ci.yml` already carries a paragraph about, in the
emu8051-stc checkout: fifteen cross-repo tests skipped silently for weeks.

The fix is cheap and is already this repo's idiom. The suite ships a compact
binary form beside the JSON: `v1_binary/*.MOO.gz` is **94 MB for all 646,000
vectors**, against 174 MB for the JSON of a shallow clone. A pinned
`actions/checkout` of `SingleStepTests/8086` with `sparse-checkout: v1_binary`
is the same shape as the emu8051-stc step, and needs a MOO reader — the format
spec and MIT reference parsers (Rust, C++, Python, plus `moo2json.py`) are at
`dbalsom/moo`.

DONE, and three things came out of it worth keeping. The reader is proved
against the encoding it replaces — `test/moo.test.mjs` with `MOO_ALL=1` reports
*323 files, 646000 vectors agree*, field for field — because a reader that
quietly returned empty vectors would make the grind report 646,000/646,000
while examining nothing, which is the same bug as the skip one level down.
Both grinders now count out loud and exit non-zero, with zero vectors a named
failure, proved by mutation rather than by reading: one corrupted register in
one vector out of 646,000 gives 1999/2000 and exit 1. And the disassembler's
exclusion key had to be rewritten (RULE 5) — it was the suite's `test_hash`,
which exists only in the JSON, so a binary run would have excused nothing and
all three vectors would have gone red. An exclusion that evaporates when the
input format changes is not an exclusion; the key is now the BYTES, which is
what the excuse is about. **My first version of that rewrite was itself a gate
that could not fail**, and only the mutation found it: checking the name before
the bytes made a key that matched everything report HEALED for every vector,
because "the name is not the recorded one and our text matches it" is true of
every correctly disassembled instruction in the suite. Recorded because it
happened inside the block that was replacing a key for exactly that defect.

**R2 — THE TRAP FLAG IS ABSENT AND IS NOT DECLARED ABSENT.** CLOSED `8617b0d`. `i8086.js`'s
header names four deliberate omissions — the prefetch queue and BIU, the 8087
escape, INTR/NMI delivery, and the REP erratum. TF is not among them.
`_interrupt()` clears `IF|TF` correctly, but nothing ever raises INT 1 after an
instruction executed with TF set, so a program that installs its own
single-step tracer, or any DEBUG-style lesson, gets silence. Either implement
it or put it in the header: by this project's own rule a non-goal is stated
where the code is, not in a TODO.

IMPLEMENTED, with three ordering decisions that each change what a debugger
sees, and one of them was got wrong first. TF is sampled BEFORE the instruction
— sampling what it leaves would make a `POPF` that sets TF trap on itself, so a
tracer's first `t` steps its own flag-load. The segment-load shadow is read
AFTER: reading it at the sampling point let `mov ss, ax` trap on itself, at the
one instant SS is new and SP is old, which is the instant the shadow exists to
protect. And an `INT` executed with TF set traces INTO the handler, because the
alternative leaves a tracer with no trap after an INT at all and it loses the
program at its first DOS call — which is why `p` exists beside `t`.

**THE VECTORS ARE BLIND TO ALL OF IT, and that is now measured rather than
quoted.** The suite's README says the interrupt and trap flags are not
exercised; across all 646,000 vectors TF is set in the initial flags of exactly
zero and IF in exactly zero. The grind reads 646,000/646,000 with the trap
implemented and read 646,000/646,000 without it. Five behavioural tests carry
it instead.

**THE ACCEPTANCE RAN, AND ALL THREE PREDICTIONS HELD** — stated before they
were measured, and settled by a 1983 Microsoft binary rather than by our own
tests. `t` stops after exactly one instruction and displays registers. `t`
over an `INT 21h` steps INTO the handler, and the proof is better than a yes:
DEBUG reports `CS=D000 IP=0084` and disassembles `EBFE JMP 0084` — the trap
page after the move, slot `0x21 * 4`, with a period debugger drawing us a
picture of our own `jmp $` self-loop. And `t` across a `MOV SS` / `MOV SP`
pair executes BOTH and stops after the second, so the pair completed
atomically; without the deferral it would have stopped between them with SS
new and SP stale, showing a stack pointing into nowhere. The three ordering
decisions are vindicated by the software they were written for.

**R3 — `TRAP_SEG = 0xF000` IS WHERE A BIOS HAS TO LIVE, AND TIER C STOPPED
BEING HYPOTHETICAL WHILE THIS REVIEW WAS BEING WRITTEN.** `i8086-dos.js` maps
RAM at `0xF0000-0xF03FF` and fills it with `jmp $`. On a real PC/XT that is the
BIOS ROM. The review filed this as cheap-now-expensive-later; hours afterwards
the integration lane ran REAL MICROSOFT BINARIES from the MIT MS-DOS release —
the first third-party code this tier has executed that it did not assemble
itself — and got correct behaviour out of five of them:

```
v1.25 CHKDSK.COM   -> "Invalid parameter"            (parsed its command line)
v1.25 COMP.COM     -> "Cannot compare file to itself"
v1.25 SETCLOCK.COM -> " resident DATE/TIME processors loaded / Current date is ..."
v2.0  CHKDSK.COM   -> "Incorrect DOS version"        (it checks; we report 5.00)
v2.0  DEBUG.COM    -> its "-" prompt, looping on input
```

That set moved again within the hour, once the services the refusal histogram
named were implemented and the reported DOS version became configurable — MS-DOS
2.0's own CHKDSK refuses anything but 2.x, so a hardcoded 5.00 had made genuine
period binaries unrunnable for no reason. The stable set is now:

```
v1.25 CHKDSK.COM   parses its command line, reports "Invalid parameter"
v1.25 COMP.COM     refuses to compare a file to itself, prompts to continue
v1.25 SETCLOCK.COM loads its resident date/time processors and prints the date
v2.0  CHKDSK.COM   gets past the version check, reaches "Cannot CHDIR to root"
v2.0  DEBUG.COM    reaches its prompt, accepts `q`, terminates cleanly
```

So a BIOS ROM at F000 is a near-term need, not a someday. THE CONSTRAINT ON THE
FIX: `F0000-FFFFF` is entirely spoken for on a PC, so the trap page belongs
either in the `C0000-EFFFF` option-ROM gap or in a page below 640K that the
loader reserves — and whichever is chosen, the constant needs a comment saying
what it must not collide with, because the next reader will not know.

CLOSED `5f17c34`: `DEFAULT_TRAP_SEG = 0xd000`, the one 64K window an XT leaves
alone, with the memory map in the constant's comment and `trapSeg` as an
override for a machine that populates it. Nothing hardcodes the page any more —
`trapRegion(seg)` hands back the region and both DOS presets, `EMU8086BOX` and
five test machines call it. **The move found its own regression, which is the
argument for making it rather than parameterising around it:** two INT 10h
scroll tests stood on the trap by writing `cpu.cs = 0xf000` by hand, so once the
page moved they were asserting against a `service()` that had correctly declined
to run — green-looking assertions over a call that did nothing, the same species
as the two DOS services that once reported success unconditionally. The corpus
was re-run either side of the move and is identical verdict for verdict, which
was predicted before it was measured: no program knows where the trap is,
because they reach it through the vector table `install()` rewrites.

**R4 — THE ASSEMBLER IS THE LARGEST SURFACE WITH NO INDEPENDENT ORACLE.** CLOSED `cac105d`, by a better oracle than this finding asked for. 2,304
lines. Round-tripping through a disassembler that is ground against 646,000
hardware vectors is a strong check on ENCODING — and it says nothing about
directive SEMANTICS: `.MODEL` and group fixups, `EQU` against `=`, nested
`DUP`, macro expansion, `OFFSET`/`SEG`. CORRECTED BY THE LANE THAT BUILT IT, and the
correction is right: those semantics are not wholly unverified, because 470 of
the 525 corpus programs produce output BYTE-IDENTICAL to an independent
implementation, and a wrong `.MODEL` or a wrong `DUP` shows up as wrong output.
That is a semantic check. What it is not is a UNIT check — it covers the
directive shapes the corpus happens to use, in the combinations it happens to
use them, and its oracle dispatches on mnemonic strings rather than fetching
opcode bytes. A differential ENCODER is still worth having, and closes a
different gap: `nanochess/tinyasm` (BSD-2) is
an 8086 assembler small enough to read and port, and NASM can be diffed over
the syntax that overlaps. This matters now rather than later — the in-flight
`longJumps` promotion rewrites an out-of-range jump into a branch over a near
jump, which moves byte counts and therefore every later fixup, and that is
exactly the class a round-trip cannot see and a byte diff can.

CLOSED, AND THE ORACLE IS BETTER THAN THE ONE RECOMMENDED HERE. This finding
asked for `tinyasm` or NASM diffed over the overlapping syntax. What landed is
**MASM 1.10, LINK 2.00 and EXE2BIN — the actual period toolchain — running to
completion INSIDE Tier B**, with zero unsupported DOS services.
`scripts/oracle-masm.mjs` + `test/oracle-masm.test.mjs`.

That deserves stating plainly, because it is a milestone the tier did not set
out to reach: **the emulator became complete enough to host the oracle that
grades its own assembler.** Not a reimplementation to diff against, and not a
modern assembler with a different dialect — the program these sources were
written for, running on the machine we built.

Evidence: 414 files compared, 404 code segments byte-compared, 403 differing
only in named benign classes, and **zero cases where MASM accepted a program
and we refused it**.

AND IT FOUND A REAL DEFECT IN US, which is what separates an oracle from an
agreement ceremony. Two findings, in opposite directions:

- MASM is WRONG about `NOTHING EQU 0FFFFH` — the reserved word silently wins,
  and it costs a program its output.
- WE are wrong about the missing-ASSUME rule. MASM reaches for whichever
  segment register IS assumed and hard-refuses when none can serve; we did
  not. It is invisible wherever DS already reaches the symbol's segment — which
  is every program in this corpus.

**AND THE REASON FOR THAT IS THE INTERESTING PART, because the obvious
explanation is wrong.** The first version of this entry said the corpus runs
past the defect "because every program in it is a `.COM`". Measured, that is
false in both halves: of 525 sources, **498 use `.model`** and only **12 have
`ORG 100h`**, and `run-i8086-corpus.mjs` has a real `loadExe` path rather than
loading everything flat.

The corpus runs past the defect because **it never writes the construct**. A
`.model small` textbook program puts its variables in `.data` and points DS at
`@data`; the defect needs a variable in the CODE segment of a program whose DS
points elsewhere. So 470 byte-identical agreements are 470 pieces of evidence
about a case the defect cannot touch, and the defect was found by a
hand-written probe instead.

**That generalises, and it is the caution this entry most needs: a corpus is
evidence only about the constructs it CONTAINS, and a uniform corpus is
uniformly silent about everything else.** "414 files compared, zero refusals"
must not be read as "the encoder is correct over 414 files' worth of the
language" — it is correct over the slice of the language those files use. The
argument for keeping a probe suite beside the corpus is exactly this, and it
is why the corpus and the oracle are not substitutes for each other.

The second is being fixed. A differential encoder against `tinyasm` stays
available and drops in priority: it would have caught encoding drift, and this
catches semantics, which was the actual gap.

**R5 — THREE MACHINE LAYERS HAVE BECOME THREE COPIES.** `m6502`, `z80` and
`i8086` each carry machine + adapter + debug + extract, about 4,600 lines, and
the shapes have converged: `saveState()` walks the chip map identically in all
three, each declares its own `CPU_STATE` array, each has a wake horizon. Three
instances is where a coincidence stops being one. The recommendation is NOT a
refactor — it is to widen `test/adapter-contract.test.mjs` into a cross-CPU
conformance test, so a fix to one machine's save/restore or interrupt gating
cannot silently miss the other two.

**R6 — `pc-speaker.js` SHOULD STATE ITS ACCURACY TIER.** `i8086-cga.js` opens
by naming what it is (memory truth) and what is absent (6845 timing, snow,
composite artefact colour), which is why nobody will file a bug about it.
The speaker has no such paragraph, and it needs one: peripherals advance at
instruction granularity, so a `LOOP`-based delay driving PIT channel 2 carries
jitter a real 8253 does not have.

**R7 — TWO STALE CLAIMS IN THIS DOCUMENT AND ITS SIBLING.** The E6 STATUS block
above and `brickwright-lite/docs/I8086-CORE-PLAN.md` both say the bw-parts DIP
packages are "committed, NOT pushed". They are pushed, as `41706a7`.

### E6.1 8086 core + disassembler — DONE (2026-09-03)
`src/i8086.js` + `src/i8086-disasm.js`, ground against SingleStepTests/8086
(MIT, hardware-generated on an Intel P80C86A-2): **646,000/646,000 vectors
for the core, and 646,000/646,000 for the disassembler's TEXT as well as its
length** — the suite ships a disassembly string with every vector, which is a
higher standard than z80-disasm and w65c02-disasm are held to (their formats
are spot-checked by hand). Grinders: `scripts/grind-i8086.mjs`,
`scripts/grind-i8086-disasm.mjs`. Three behaviours contradict Intel's
published pseudocode and are documented where they are implemented.

**8088 comes free.** The ISA is identical; the differences are bus width, a
four-byte prefetch queue instead of six, and cycle timings — none of which an
instruction-stepped core models. `I8086` IS an 8088 except for cycle counts.
SingleStepTests/8088 (with bus data) and /v20 are also MIT if the tier ever
wants NEC V20 or cycle work.

**Measured speed: 4.0 M instructions/sec** on a representative mix (reg ALU,
memory read/write, taken branch, call/ret) — 12x a 5 MHz 8086, ~16x a
4.77 MHz XT. The CPU will not be the bottleneck at any tier; video timing
will be. Re-measure in the browser bundle before quoting it there.

### E6.2 Tier A — the breadboard machine (NEXT)
The direct analogue of EATER6502, chip for chip. slador.uk's 8088 breadboard
computer is exactly this shape (8088 + 8284 + 8254 + 8255 + 8259 + 74244 +
74138 + flash + text LCD), and the Proteus tutorials are its first lesson:
an 8255 port blinking an LED.

- `i8255.js` — 8255 PPI. Ports A/B/C, control word, mode 0, and the BSR
  bit-set/reset path. Modes 1 and 2 (strobed/bidirectional) are a stated
  non-goal until a lesson needs them, in the header, not in a TODO.
- `i8086-machine.js` — `{clockHz, regions, chips}` over a TWENTY-BIT space,
  the m6502-machine.js shape with the address width changed. Ports are a
  second decode space, which the 6502 does not have and the 8051 does.
- `i8086-adapter.js` — boundary-A pin bus, as m6502-adapter.js.
- `i8086-debug.js` — boundary-D target. Code breakpoints compare on the
  LINEAR address: two seg:off pairs can name one instruction and only the
  linear form cannot be fooled.
- `i8086-extract.js` + extractor SELECT entries (8255, 8251, 62256, 28C256)
  so a hand-wired 8086 on the drawn breadboard becomes a machine, or a named
  refusal, exactly as the 6502 does.
- Our own monitor ROM. Nobody else's: see the licence rulings below.

### E6.3 Tier A completion — interrupts and time
`i8259.js` (PIC) and `i8254.js` (PIT), plus INTR/NMI delivery in the machine
layer with the IF check and the one-instruction inhibition after a segment
register load. The core deliberately does not deliver interrupts itself.
Only after this does the 8086 erratum where an interrupt taken mid-REP loses
a segment override have anything to happen to.

### E6.4 Tier B — the DOS-program tier (no hardware at all)
The 8086 textbook corpus does not want a PC. Measured across the 525
programs of Amey-Thakur/8086-ASSEMBLY-LANGUAGE-PROGRAMS:

    int 21h  3109   of which AH=02h 1347, AH=09h 1064, AH=4Ch 451
                    -> 2862 of 3109 in three services
    int 10h    79   int 16h 26   int 1Ah 10   int 15h 8   int 33h 6
    502 of 525 files use .MODEL / PROC / MACRO

So the service layer is a few hundred lines and covers ~92% of the corpus
with three functions. **The gate is the ASSEMBLER, not the emulator**: these
are MASM sources and bw-asm does not speak those directives yet. Scope the
assembler honestly before promising the corpus.

### E6.5 emu8086 compatibility — a separate, smaller lane
yousefkotp/8086-Assembly-Projects is not DOS software. It is emu8086:
`#start=Traffic_Lights.exe#`, `out 4, ax` to a built-in traffic-light device,
`int 15h/AH=86h` delays, `include 'emu8086.inc'`. Running it means emulating
emu8086's virtual peripherals and RE-IMPLEMENTING its macro library — the
`.inc` carries no licence we can rely on. Lands after E6.4, and it is the
tier that makes "traffic light", "stepper", "thermometer" lessons possible.

### E6.7 The ALE-latched address bus — a lesson, not debt
The drawable 8086/8088 parts (bw-parts `i8086.json`/`i8088.json`) present a
**de-multiplexed** address bus: a0-a19 as direct terminals, the same clean-
address simplification the 6502 and Z80 parts make. The real 8086 does not
have those pins. It multiplexes AD0-AD15 with the low data bus and A16-A19
with status S3-S6, and the address is valid only while ALE (from the 8284)
is high; a real build latches it through a **74LS373 per byte lane**, with
`/BHE` selecting the high lane. `i8086-extract.js` currently reads the CPU's
a0-a19 directly, so it accepts the simplified part and cannot yet follow an
address through a '373.

This is deferred deliberately, with the LESSON attached: the multiplexed bus
is the single most interesting difference between an x86 breadboard and a
6502 one — a learner who built the 6502 never had to ask why an address
needs latching, because those chips just hold it. The right lesson starts
from a WORKING simplified machine and then introduces the latch the real
chip forces on you, rather than demanding the latch before anything runs.

Scope when taken: a `74ls373` part (transparent latch), and an extractor
change on the bw-board side to recognise AD0-AD15 + ALE feeding a '373 whose
outputs drive the address decode. It is an extractor change, not a part
change. Nothing in the current corpus needs it — a boot sector and a DOS
program never see the address pins.

### E6.6 Tier C — PC/XT compatible — LARGELY DONE (2026-09-04)

**This entry said "months, and a different product ... start only when tiers A
and B are shipped and a lesson actually needs it." It is left above in the git
history rather than quietly rewritten, because the estimate being wrong is the
interesting part: every piece it named as expensive turned out to be reachable
once the ORACLES were in place.** The 646,000-vector suite, MASM 1.10 running
inside our own emulator, and a genuine MS-DOS boot each removed a class of
"is this right?" question that would otherwise have been answered by argument.

Built, with evidence:

| Piece | State |
|---|---|
| 8237 DMA + XT page latch | `src/i8237.js`, chip kinds `dma`/`dmapage`, transfer pump, 64K wrap erratum modelled |
| µPD765 FDC | `src/upd765.js`, chip kind `fdc`, IRQ6 to the PIC, DMA channel 2 |
| 6845/CGA, Hercules, VGA | `src/cga-card.js`, `hercules-card.js`, `vga-card.js` |
| A BIOS | `rom/bios.asm` — ours, clean-room. POST, INT 10h/13h/16h/1Ah, a real DMA floppy driver |
| A DOS | MS-DOS 2.0 boots to `A>` and runs `DIR`. Boot sector, IO.SYS and FAT12 all built by us; only MSDOS.SYS/COMMAND.COM/SYSINIT.OBJ are Microsoft's (MIT) |

**Two independent disk paths reach the same nine boot landmarks with
byte-identical screens** — the emulator's INT 13h service layer, and the BIOS
driving a real µPD765 over the 8237. That differential immediately found a
defect neither path's own tests could: the DMA pump moved zero bytes while
reporting complete success.

Speed, measured rather than claimed (`scripts/bench-i8086.mjs`): a real
MS-DOS boot runs at **2.3x a 4.77 MHz IBM XT**, so real time has better than
half the budget spare.

STILL OPEN in Tier C: INT 10h graphics. Modes 4/5/6 set the mode byte and the
CGA mode register and nothing else, and AH=0Ch/0Dh (write/read pixel) do not
exist, so no program can draw. That is the one thing between here and running
the MIT game corpora, and it is in progress.

### Licence rulings for the 8086 tier (verified 2026-09-03, expanded 2026-09-03, support-chip oracles added 2026-09-03)

| Source | Licence | Ruling |
| --- | --- | --- |
| SingleStepTests 8086 / 8088 / v20 | MIT | ORACLE ONLY, never shipped. Same role as the 65x02 and Z80 suites. |
| microsoft/MS-DOS 1.25, 2.0, 4.0 | MIT | Usable. A genuine DOS is available if Tier C ever wants one. |
| Amey-Thakur asm corpus (the .asm files) | MIT, per file header | Shippable as examples WITH ATTRIBUTION. Note the same repo's simulator sources say `CC BY 4.0` in every header while its LICENSE says MIT — an unresolved conflict; take the .asm files, not the simulator. |
| GLaBIOS | GPL-3.0 | REFUSED. The best open BIOS is out of reach. |
| skiselev/8088_bios | GPL-3.0 | REFUSED. |
| GREENSHELLRAGE/8086-breadboard-computer | **no LICENSE file** | All rights reserved. The ARCHITECTURE may inspire (not copyrightable); the ROM binaries and .asm may not be copied. |
| emu8086.inc | unclear | REFUSED. Re-implement the macros. |
| MartyPC, PCjs | MIT | Readable as reference implementations; not vendored. Reading an MIT implementation ships no third-party code. |
| `mfld-fr/emu86` | **MIT** (2019-2025 MFLD.fr, verified 2026-09-04) | Readable and ADAPTABLE with attribution. An IA16 emulator covering 8086/8088/**80186/80188**, so it is the permissive reference for the 186 instructions of E6.8.1 — but `SingleStepTests/v20` is the ORACLE for them, and a suite beats a source. Also has three console backends (stdio/PTY/SDL2), which is the shape of a headless serial harness. |
| `dbalsom/XTCE-Blue` (fork of reenigne's XTCE) | MIT **wrapper**; the executed 8088 **microcode is Intel's** | **STRUCTURE readable, MICROCODE refused** — the identical trap to `nand2mario/z8086` below. A cycle-interruptible core is derivable from `SingleStepTests/8088`'s bus traces, which is both clean and a better oracle than transcription. Its CGA (ported from MartyPC, MIT) is an overscan-aware reference for E6.8.5. See E6.8.4. |
| `morphx666/x8086NetEmu` | MIT **wrapper**; its own README states the Adlib/SoundBlaster/CGA/VGA code is adapted from **fake86 (GPL-2.0)** and the group-2/MUL/DIV flags from **PCE (GPL)** | **STRUCTURE readable; THE AUDIO AND VIDEO ARE NOT.** Third instance of the rule below, and the clearest: a LICENSE cannot relicense what its author vendored. The 80186 gating, the save-state serialisation and the CRTC start-address wiring are the author's own and may be read. Do not read its audio — `ymfm` is licensed for that. |
| **`aaronsgiles/ymfm`** | **BSD-3-Clause** (verified 2026-09-04) | **USABLE OUTRIGHT — read, adapt, or VENDOR with its notice.** From-scratch Yamaha FM cores covering OPL/OPL2/OPL3, 252 KB, same licence as this bundle. The only clean door to Adlib; see E6.8.11. |
| `nukeykt/Nuked-OPL3` | LGPL-2.1 (verified 2026-09-04) | REFUSED. The most accurate OPL3 there is, and an LGPL core inside one bundled JS artefact carries relink obligations a BSD-3 distribution does not discharge. |
| `fake86` (Mike Chambers), DOSBox `dbopl`, PCE | GPL-2.0 (verified 2026-09-04) | REFUSED, including **through any MIT wrapper that vendored them**. |
| `MicroCoreLabs/Projects` | **NO LICENCE ANYWHERE** — no LICENSE at the root or in any 8086 subfolder; the API reports `license: null` (verified 2026-09-04) | All rights reserved. **Inspiration only, never a code source.** Its MCL86 microcode carries the same unestablished-provenance refusal as z8086 and XTCE-Blue. See E6.8.12. |
| `moesay/Elegant86` | GPL-3.0 | REFUSED, and not wanted — an ~8-instruction teaching assembler with no oracle. See E6.8.13. |
| jasaldivara/retro-dos-graphics | MIT | Shippable WITH ATTRIBUTION. 180 KB NASM across 28 files — CGA, joystick I/O, PC speaker, scrolling. Richest single corpus for Tier C peripheral testing. |
| FaizanAli7005/typing-balloon-game-asm | MIT | Shippable WITH ATTRIBUTION. 41 KB NASM, broad BIOS interrupt coverage (timer, keyboard, video, speaker). |
| milyas-io/Assembly-Breakout-Game | MIT | Shippable WITH ATTRIBUTION. 20 KB MASM/TASM, collision, speaker — but it uses **mode 13h, which is the one graphics mode this tier does NOT run today**, because no shipped config declares `kind: 'vga'`. CGA modes 4/5/6 do work, proven bare-metal without a BIOS (3D8h plus raw B800 writes render a 320x200 bitmap with correct bank interleave), so a mode-4/5/6 corpus is runnable now and this one is not. Do not schedule it as an early graphics example. |
| Fahad1110136/Maze_Runner_Go | MIT **at the root only** | Shippable WITH ATTRIBUTION — **BUT NOT THE WHOLE REPOSITORY.** Custom ISRs for INT 08h/09h, direct B800h video, timer chaining, and the `.asm` is fine. `Github Assembly Compiler/` BUNDLES DOSBOX AND NOTEPAD++, both GPL, inside the MIT tree. A root LICENSE does not relicense vendored third-party binaries, and this is the shape that is easiest to get wrong: the repository badge says MIT, the file you clone says MIT, and the subdirectory is copyleft. **Take the assembly sources; do not clone, vendor, redistribute or read that subdirectory.** Found by the integration lane while surveying corpora for the graphics work. |
| **The general form of that hazard** | n/a | A permissive LICENSE at a repository root says what the AUTHOR grants over THEIR work. It says nothing about code they vendored. Three entries in these tables are now instances of it — `Cardputer-Game-Station-Emulators` (MIT wrapper over non-commercial fMSX), `nand2mario/z8086` and `dbalsom/XTCE-Blue` and `dbalsom/x86_microcode` (permissive code over Intel's microcode), and this one (MIT over bundled GPL tools). **Before adopting from any repository, look at what is IN it, not only at what its LICENSE file says.** A vendored subdirectory is the usual carrier. |
| Azdahah/Snake-Game-8086-Assembly | MIT | Shippable WITH ATTRIBUTION. Clean, self-contained, keyboard + speaker + video memory. |
| rvalles/optromloader | MIT | Shippable WITH ATTRIBUTION. Pure 8086 fasm bootblock, no post-8086 instructions. Tier A material. |
| rsanguini/jogo-da-velha-assembly | MIT | Shippable WITH ATTRIBUTION. MODEL SMALL MASM, 30+ procedures, AI. Tier B material (text I/O only). |
| mirkonikic/boot_from_the_pdf | MIT | Shippable WITH ATTRIBUTION. Boot sector programs, decent opcode exercisers. |
| paramendula/playground | MIT | Shippable WITH ATTRIBUTION. NASM bootloader/kernel, archived/incomplete. |
| abdi219/COAL_MultiDigitArrayInputOutput | MIT | Shippable WITH ATTRIBUTION. Small, INT 21h only. Tier B material. |
| Gudhein3/mybios | MIT | Shippable WITH ATTRIBUTION. Trivially small (573 B skeleton). |
| jesus966/libcassette | MIT | C90 library for IBM 5150 cassette port, not assembly. Useful only for compiled output testing. |
| DOS-History/Paterson-Listings | MIT (names Microsoft Corp.) | **USE WITH CAUTION.** LICENSE names Microsoft as copyright holder and Scott Hanselman brokered the release, but no public Microsoft announcement found covering 86-DOS 1.00 specifically (MS-DOS 1.25+ is a different codebase). **REFUSE Bundles 9-10 (BASIC-86 Compiler runtime)** — a separate Microsoft product with no visible license grant. Usable as test corpus with attribution; do not vendor. |
| jeffreypalermo/Paterson-Listings-DOS | MIT (names Microsoft Corp.) | Fork of DOS-History/Paterson-Listings; same caveats. Added analysis docs are validly Palermo's. |
| ptsource/X86-DOS-OS-Builder | MIT (PTSource + Microsoft Corp.) | **SOUND for the MS-DOS 4.0 portions** — built on the officially MIT-released Microsoft codebase. PTSource's own tooling is validly theirs. |
| vgrichina/dos10 | MIT | **The JS assembler (scpasm.js) is CLEAN** — a reimplementation, no historical IP. The 86-DOS .asm source it builds inherits the Paterson-Listings caveat. |
| nand2mario/z8086 | Apache 2.0 (SystemVerilog); **microcode ROM is Intel's** | REFUSED as oracle. Ships `ucode.hex` — 512×21-bit words of Intel's original 8086 microcode extracted from a decapped chip. The SystemVerilog is Apache 2.0 but the microcode content is Intel's copyrighted work. Do not vendor, do not reference. SingleStepTests is the better oracle and is already in use. |
| Intel 8086 ISA (the instruction set itself) | n/a | **NO BARRIER.** Functional behavior is not copyrightable (*Lotus v. Borland* 1995, *Google v. Oracle* 2021). All 8086-era patents expired by the late 1990s. Intel's manual text is copyrighted but reading it and implementing behavior is standard practice. Precedent: QEMU, Bochs, DOSBox, 86Box, v86, MartyPC — decades of open-source 8086 emulators with zero Intel legal challenges. Do not copy Intel microcode ROM contents or paste manual text into source. |

Consequence: **every ROM in this tier is ours**, at every tier. That is a
cost, and it is also the reason the tier can ship at all.

#### Support-chip oracles: 8254 PIT, 8259 PIC, 8251 USART (added 2026-09-03)

The support chips (`i8254.js`, `i8259.js`, `i8251.js`) were written clean-room
from the Intel datasheets. What follows are the references used to CROSS-CHECK
them. The headline: the same author who produced our CPU oracle
(SingleStepTests) also covers the peripherals, and it is **MIT** — so for the
PIT and PIC we are not confined to the oracle-only carve-out; the structure may
be read and adapted with attribution.

| Source | Licence | Ruling |
| --- | --- | --- |
| dbalsom/arduino_8253 | MIT | **BEST PIT ORACLE.** Real-8253 Arduino interface **plus a reference emulator developed against the physical chip**; datasheet says the 8254 is investigable with the same rig (pin/function compatible). Diffing `i8254.js` against it is close to diffing against silicon. Read + adapt with attribution. |
| dbalsom/martypc — `crates/lib/marty_core/src/devices/{pit,pic,serial}.rs` | MIT | PIT "highly accurate"; PIC "mostly complete, **missing priority rotation and nested modes**" — exactly the scope `i8259.js` built and skipped. `serial.rs` is an **INS8250, not an 8251** — not a USART reference. Read as reference; not vendored. |
| `hotkeysoft/emulators` | MIT (confirmed 2026-09-04) | **This row was too narrow and is widened.** First listed only as an MIT cross-check for `Device8254`/`Device8259`/`Device8250` (it has an 8250, no 8251). It is a multi-machine C++ suite: 8086/8088/**80186/80286**, PC/XT, PC/AT, PCjr, Tandy 1000, **EGA on the real IBM EGA BIOS ROM**, four sound devices, and a **snapshot GUI**. Readable throughout; nothing vendorable (C++). See E6.8.14. |
| `folkertvanheusden/DotXT` | **NO FORMAL LICENCE.** README says "Released in the public domain"; there is no LICENSE file and the API reports `license: null` (verified 2026-09-04) | **READ ONLY, DO NOT VENDOR, DO NOT PARAPHRASE CLOSELY.** A bare sentence is not a dedication — CC0 and the Unlicense exist because unilateral public-domain release is unrecognised in much of the EU. Has MDA, XT-IDE and an RTC we lack; its own `todo` records DIV/IDIV and disassembler defects, so it is not the route to them. |
| `MichalPleban/cbm2-pc-emulator` | Apache-2.0 | Not an emulator at all — firmware bridging a REAL 8088 card to a REAL CBM-II. Nothing to take; recorded so it is not surveyed twice. See E6.8.14. |
| **`sneakernets/DMXOPL`** | **MIT** (verified via API 2026-09-04) | **USABLE AS DATA.** An OPL patch set in `.op2`/`.wopl`, no code. Answers E6.8.11's third problem — an OPL with no instruments makes no sound. Ship with the MIT notice and credit. **Owed diligence before shipping:** nobody has diffed its FM parameters against id's original GENMIDI lump; the author's "original work" statement is a self-report. |
| **`raffecat/LittleMUS`** | **MIT** (Andrew Towers, 2025) | **USABLE.** `musplayer.c/.h` is a MUS sequencer that is core-AGNOSTIC — it calls an externally supplied `adlib_write(reg, val)` and reads DMXOPL's `.op2` layout directly. `musdriver.c/.h` is written against Nuked-OPL3's struct names and would be rewritten against ymfm: an API mismatch, not a licence one. |
| `Raffaello/hyper-sonic-drivers` | Apache-2.0 **wrapper**; the tree vendors Nuked-OPL3 (LGPL-2.1), MAME `ymf262` (GPL-2.0-or-later), DOSBox `dbopl` (GPL-2.0), woody, ScummVM (GPL-3.0), MUNT (LGPL-2.1 via `vcpkg.json`), plus a Miles Design proprietary EULA doc | **REFUSED — the specimen instance of the rule below.** Four copyleft licences vendored verbatim under one permissive LICENSE, each still carrying its own SPDX header. The only clean thing in it is `hardware/opl/mame/ymfm/`, which IS `aaronsgiles/ymfm`. See E6.8.16. |
| `kawaii-Code/as88v2` | **Unlicense (public domain)** | Vendorable and still declined: a THIRD assembler dialect (Tanenbaum `as88` — `.SECT`, `!` comments, `(x)` dereference, a fake `SYS` opcode), self-described as an unstable subset, tested by asserting exit code zero. See E6.8.15. |
| `ccodere/instrcvt` | **No LICENSE**; custom 1995 freeware header forbidding re-release of modified source | REFUSED, and not needed. Not an instruction converter — a Sound Blaster/AdLib **instrument** format converter (`.SBI`/`.INS`). DMXOPL supplies the same need under MIT. |
| `DynartInteractive/DOS-Game-Engine` | MIT **at the top level only** — `UNITS/SBDSP.PAS`, `UNITS/PLAYHSC.PAS` and `UNITS/XMS.PAS` retain other authors' "all rights reserved" / "not to be distributed modified" / NEO-Software-permission notices verbatim, and `DATA/*.PCX` is carved out non-commercial | REFUSED for those files regardless of the LICENSE, and Turbo Pascal throughout, so our assembler could not ingest it anyway. Its inline `asm` fragments are LESSON TOPIC ideas only. See E6.8.15. |
| ajokela/retro-z80-emulator — `src/serial.rs` | MIT | **First MIT 8251 reference (Rust)** — but LOWER FIDELITY than ours: mode and command share one field, no mode→command sequence, no internal-reset rewind, no TxEN gating. It would mishandle the soft-reset init dance. Confirms our sequence model is necessary, not gold-plating. Sanity reference only. |
| SIrfanH/8086-mp-8251-usart-auto-complete-demo | MIT | **Shippable 8251 test material WITH ATTRIBUTION.** 8086 asm + Proteus circuit. Its init sequence (mode → 0x40 soft-reset → mode → enable) validated `i8251.js`, and its serial protocol is wired up as an end-to-end test (`test/i8086-devices.test.mjs`). |
| MAME (current upstream) — `src/devices/machine/{i8251,pit8253,pic8259}.cpp` | **BSD-3-Clause** (per each file's `// license:` header; MAME-the-project is GPL-2.0 but these device files are individually BSD-3) | **PERMISSIVE — the spec-grade 8251 reference we were missing.** Readable and adaptable WITH the BSD-3 notice. Also permissive PIT/PIC cross-checks. Verify the header on the exact revision you read; the relicensing landed ~2015-16. |
| MAMEHub (MisterTea) — `Sources/Emulator/.../i8251.h` | GPL-2.0 (2014 snapshot, PRE-relicense) | ORACLE-ONLY. This old fork predates MAME's BSD-3 relicensing, so THIS copy is GPL. Use current upstream mamedev/mame for the BSD-3 grant, not this. |
| geo-tp/Cardputer-Game-Station-Emulators (fMSX subtree) | wrapper says MIT; **upstream fMSX is Marat Fayzullin's non-commercial licence** | **REFUSED — licence-laundering trap.** The repo's MIT LICENSE does NOT override fMSX's upstream terms (free for non-commercial use only, no redistribution for profit). fMSX-derived 8251/8255 code is not usable regardless of the wrapper. |
| andrewthecodertx/rust-imsai-emulator | MIT | 8080/IMSAI, Rust. Permissive but peripheral to the 8086 support chips; note only if it grows an 8251. |
| leon-anavi/xmame-arm (`einstein.c`), johnsonjh/com-cpm, HardenedBSD vt100 port | GPL (xmame) / custom / n/a | ORACLE-ONLY or DOCUMENTATION. Tatung Einstein uses an 8251 but the source is GPL; the CP/M and vt100 items are behavioural/doc references, not adoptable. |
| QEMU `hw/intc/i8259.c` + `hw/timer/i8254.c`; Bochs (LGPL) | GPL-2.0 / LGPL | ORACLE-ONLY. Reach for only to resolve a behaviour the MIT sources leave ambiguous. |
| ecodolphin/i8254-Emulator | **no LICENSE** | ORACLE-ONLY, low value. All rights reserved: no copy, no ship, avoid reading structure. A UI applet, hard to automate; `arduino_8253` is strictly better. |
| doguknY/8086_Proteus_Simulations | **no LICENSE** | REFERENCE-FOR-WIRING-IDEAS ONLY. Binary Proteus `.pdsprj` for 8251/8254/8255/8259 — can't ship, can't load into the engine. Circuit topology isn't copyrightable, so independently redrawing a decode for `i8086-extract.js` test cases is fine; the files are not. |
| Hades USART 8251 web demo (tams.informatik.uni-hamburg.de) | courseware, unclear | DOCUMENTATION / BEHAVIOURAL reference only. Java applet; do not copy. |

Consequence for the support chips: the PIT and PIC have a hardware-backed MIT
oracle; the 8251 has no spec-grade MIT source, so its correctness rests on the
datasheet, the MIT SIrfanH demo (validated end-to-end), and MAME as an
oracle-only fallback.

#### Oracles, corpora and references added by the E6 review (2026-09-03)

The tables above were surveyed before the tier was built and missed one vein
entirely: the author of MartyPC — who also built the rig that GENERATED the
vector suite this tier is ground against — publishes a dozen further repositories,
and only two of them were cited. Licences below were read from the GitHub API on
2026-09-03; `NOASSERTION` means GitHub could not classify the LICENSE file and a
human must read it before anything is adopted.

**Raising the verification bar**

| Source | Licence | Ruling |
| --- | --- | --- |
| `dbalsom/moo` | MIT | **ADOPT THE FORMAT.** The chunked binary encoding of SingleStepTests, with a published spec and reference parsers in Rust, C++ and Python plus a `moo2json.py`. `SingleStepTests/8086` already ships `v1_binary/*.MOO.gz` — 94 MB for all 646,000 vectors against 174 MB of JSON. This is what makes R1's CI gate affordable. Write our own reader from the spec; nothing is vendored. |
| `dbalsom/marty_dasm` | NOASSERTION — read the file | A second disassembler for 8086/8088/V20/V30/286/386. An independent cross-check on the one surface where this tier already holds the highest standard in the tree. Reference only. |
| `dbalsom/arduinoX86` | NOASSERTION — read the file | **THE RIG THAT MADE OUR ORACLE**, covering 8088/8086/V20/V30/186/286. Relevant for exactly one open thing: the ELEVEN opcodes the suite does not ship (`0F` POP CS, the five prefixes, `9B` WAIT, `F4` HLT), which `i8086.js` honestly marks "implemented but unverified; there is nothing to verify them against". There is — this is it. Hardware, not a download; scope accordingly. |
| `SingleStepTests/8088`, `SingleStepTests/v20` | MIT (confirmed) | Already noted as available; recorded here with the consequence. 8088 ships BUS data. v20 matters to a live decision: `i8086-asm.js` expands `SHL AX, 4` because `C1` is `RET imm16` on an 8086 — on a V20 or 186 it is the real instruction, so any future V20 mode must switch that expansion OFF. |
| `dbalsom/XTCE-Blue` | MIT wrapper; **microcode is Intel's** | **ORACLE ONLY — the z8086 ruling applies unchanged.** A cycle-accurate microcode-based 8088 (fork of reenigne's XTCE, whose author first decoded the 8086 microcode). Its `microcode/` directory is that decode. The C++ is MIT and readable; the microcode content is Intel's copyrighted work. Do not vendor it, and do not let the MIT badge on the repository be mistaken for a grant over the ROM contents. |
| `dbalsom/x86_microcode` | Unlicense wrapper; **content is Intel's** | Listed **so nobody adopts it on the strength of the wrapper.** Same trap as z8086 and XTCE-Blue's microcode directory. |
| `copy/v86` | BSD-2 | **A WHOLE-PROGRAM DIFFERENTIAL ORACLE, which this tier does not otherwise have.** Unlike the two implementations §1 dismissed, v86 fetches opcode bytes, and it runs headless in Node. Per-instruction vectors cannot reach interrupt interaction or REP across a segment wrap; a trace diff can. It disagrees BY DESIGN on the undocumented behaviours our vectors pinned — masked shift counts, no SETMO, 386-era DAA — so it needs a written divergence list before it is trusted, and it is a second opinion on PROGRAMS, never on instructions. **ALREADY EXERCISED** by the support-chip lane, which stood it up headless in Node (prebuilt `libv86.mjs` + `v86.wasm`, its bochs/seabios BIOS) and diffed it against our chips on timing-independent behaviour: the 16550 scratch-register round-trip agrees byte for byte, and our `i8254` read-back STATUS matches the datasheet where **v86 does not implement read-back at all** (`src/pit.js:285`). So the first thing this oracle established is where OURS is more complete — which is the right way round to learn it, and the reason a divergence list is mandatory rather than tidy. |

**Closing gaps our own module headers declare open**

| Source | Licence | Ruling |
| --- | --- | --- |
| `dbalsom/cga_artifact_color` | MIT | THE RENDERER'S, not the card's — the card is port-only by design. `i8086-cga.js` names "NO COMPOSITE ARTEFACT COLOUR" as absent. This is that, in Rust, permissively licensed, decoding NTSC artefact colour from CGA output. Adapt WITH ATTRIBUTION when a mode-6 lesson wants it. |
| `dbalsom/CGACompatibilityTester` | **no LICENSE** | **RUN IT, DO NOT COPY IT.** A register + VISUAL conformance tester (Turbo Pascal + asm). It is a PROGRAM THAT RUNS ON THE EMULATED MACHINE, so executing it distributes nothing. It is a JOINT oracle and splits across the seam: the register and 3DAh-timing checks land on `cga-card.js`, the artefact and visual checks need the renderer, so it is only fully runnable once the pixel path is wired to the card. Schedule it accordingly rather than as a card-only gate. All rights reserved for any other purpose. |
| `dbalsom/fluxfox` + `fluxfox_fat` | MIT | Floppy image handling and a FAT implementation, in Rust. The missing piece for Tier C's µPD765 and disk images, and permissive. Port or reference; not a dependency. |
| `dbalsom/8087_zoom` | Unlicense | Only if the 8087 escape (`D8`-`DF`, currently reads its operand and stops) ever becomes real. |

**Material for the circuit side, which is what this project actually is**

| Source | Licence | Ruling |
| --- | --- | --- |
| `dbalsom/cga_sim` | NOASSERTION — read the file | A **gate-level digital-logic simulation of the IBM CGA card**. NOT an emulator item at all, and it should not be routed to this repo: a CGA as a netlist is a Brickwright CIRCUIT LESSON, the same category as the extractor's teaching refusals — a learner wires the actual card. Route it to whoever owns the lessons, and read the licence before it is adopted anywhere. |
| `dbalsom/CGA_Schematics` | none stated | IBM CGA redrawn in KiCad. Reference for a drawable card. |
| `dbalsom/graphics-gremlin` | CC-BY-SA-4.0 | Open-source retro ISA video card (FPGA CGA/MDA). Share-alike — reference and inspiration; do not mix into BSD-3 source. |
| `dbalsom/micro_8088` | GPL-3.0 | An XT-compatible processor board. REFUSED as source, same as GLaBIOS. The ARCHITECTURE may inspire a Tier A drawing; nothing may be copied. |

**Testing ground**

| Source | Licence | Ruling |
| --- | --- | --- |
| `nanochess/bootOS`, `nanochess/tinyasm` | BSD-2 (confirmed) | **Shippable WITH ATTRIBUTION.** `tinyasm` is an 8086 assembler small enough to read and port — R4's differential encoder. `bootOS` is a boot-sector operating system, direct material for `loadBoot()`. |
| `nanochess/Invaders`, `Pillman`, `fbird`, `bootle`, `Toledo-Atomchess`, `book8088` | **no LICENSE file** | **RUN LOCALLY, DO NOT VENDOR** — all rights reserved by this project's own standing rule, whatever the READMEs imply. They are 512-byte programs exercising INT 10h/16h/1Ah and direct B800h writes, and `loadBoot()` already exists, so they are the cheapest Tier A/C exercise available. `book8088` is the companion to Toledo's *Programming Boot Sector Games* — a ready-made lesson sequence. **THE CHEAPEST HIGH-VALUE ACTION IN THIS LANE IS TO ASK HIM FOR AN EXPLICIT GRANT**: he already licenses `bootOS` and `tinyasm` BSD-2, so an emailed yes converts the best small-program corpus in existence from "run it" to "ship it". |
| 8088 MPH, Area 5150 | demo scene, not licensed for reuse | **NAME THE CEILING RATHER THAN AIM AT IT.** These are the recognised gauntlet, and they need cycle-exact bus and DRAM-refresh behaviour that an instruction-stepped core does not model and should not. Writing down that this architecture deliberately cannot reach them is worth more than treating them as a goal. |

**Learning from**

| Source | Licence | Ruling |
| --- | --- | --- |
| `dbalsom/pc-emulation-book` | CC-BY-4.0 | An mdbook guide to emulating the IBM PC/XT, by the author of the most accurate one. If Tier C is ever started, start here. Quotable with attribution. |


---

### E6.8 What other 8086 projects do that we cannot (surveyed 2026-09-04, owner-requested)

§E6's survey asked one question — *is anything adoptable as a CORE* — and
answered no. This asks a different one: **what do the finished projects DO
that this tier cannot**, regardless of whether their code is adoptable. Three
were read first: `mfld-fr/emu86` (**MIT**, verified 2026-09-04 — 2019-2025
MFLD.fr), `jeffpar/pcjs` (MIT, already in the table), `dbalsom/XTCE-Blue`
(MIT, a fork of reenigne's XTCE by MartyPC's author). Three more were added
the same day at the owner's request and are §§E6.8.10-.12:
`morphx666/x8086NetEmu` (MIT wrapper, GPL-derived subsystems),
`moesay/Elegant86` (GPL-3.0, refused and not wanted) and
`MicroCoreLabs/Projects` (**no licence at all**).

**Read this as a gap list, not a verdict.** On core correctness we are ahead
of two of the three: 646,000/646,000 on architectural state AND on
disassembly text, with the undocumented behaviours (SETMO/SETMOC, SALC,
POP CS, the fitted DAA/DAS rule, `REP IDIV` negating the quotient), is a
standard neither emu86 nor PCjs is held to — neither has a vector oracle at
all. Only XTCE-Blue beats us, on the one axis §E6.1 deliberately declined.
Nothing below says the core is wrong. And nothing below is matched by the
three things only we have: the extractor that turns a hand-wired breadboard
into a machine or a NAMED refusal, the counted refusal histogram, and an
assembler in-tree.

**THE PREREQUISITE IS SATISFIED — this paragraph replaces the one that said
otherwise (corrected 2026-09-04, same day, by `lego-47`).** As first written,
this section opened by insisting that nothing here should start until the
646,000-vector grind ran in CI, because `docs/I8086-CORE-PLAN.md` says the
numbers are "measured, not maintained". **That was already false when it was
written.** `.github/workflows/ci.yml` carries a `vectors:` job that
sparse-checks out `SingleStepTests/8086` pinned at
`e71c68d215a6bb8c356bd4cb3842de3bef345ca9`, proves the checkout is really
there BEFORE trusting anything that reads it, and grinds all 646,000 — closed
by `sim3` as R1, its own comment opening *"which until now ran nowhere but a
developer's box."* Within the same hour sim3 closed the same hole for the
other two CPUs (G1): `1604/1604` for the Z80 and `2,540,000/2,540,000` for the
65c02, both as first-ever results, before writing the job. `scripts/
oracle-census.mjs` (branch `feat/i8086-review`) then makes "did this oracle
actually run" a gate rather than a hope.

So the ordering argument INVERTS. E6.8.1 is not blocked on a grader; it is
attractive *because* the grader now exists and `SingleStepTests/v20` is MIT
and covers the 186 set. **The lesson is the one this tier keeps relearning:
a roadmap item asserting a gap must be re-checked against the tree on the day
it is acted on, not on the day it was written.** Two of this section's nine
items were stale within twenty-four hours of drafting; the other six were
re-verified against `feat/i8086-tier` on 2026-09-04 and hold (evidence cited
in each).

---

#### E6.8.1 The 80186/80188 instruction set — cheapest real win, and it has an oracle

`i8086.js:679` decodes `0x60` as a `Jcc` alias. That is correct 8086 and is
exactly what a 186 is not. Missing: `PUSHA`/`POPA`, `PUSH imm`,
`IMUL r,rm,imm`, `INS`/`OUTS`, `BOUND`, `ENTER`/`LEAVE`, and `&31` shift-count
masking — which §3 note 8 of the core plan already documents as an 8086-vs-later
FACT, it simply is not selectable.

What makes this worth doing rather than deferring: **`SingleStepTests/v20` is
MIT and covers these**, because the NEC V20 implements the 186 set. The same
grinder that reached 646,000 grades the extension. Roughly fifteen opcodes
behind a machine-config `variant: '8086' | '80186'`, and it unlocks emu86's
entire target class (ELKS, the 80188 SBCs).

Not taken: the R8810 MCU, and the 80186's on-chip peripheral block (timers,
interrupt controller, chip-select unit). No lesson wants them.

#### E6.8.2 Symbols in the debugger — a producer and a consumer that were never connected

`i8086-asm.js:393` builds `this.symbols`, a Map. `i8086-disasm.js` accepts
`{ labels: Map<number,string> }`. **Nothing joins them** — `labels` appears
zero times in `i8086-debug.js` and zero times in the host's
`debug-runner.js`. So a learner who wrote `delay_loop:` reads `jmp 002Bh`.

PCjs loads symbol tables and names its breakpoints. This is the highest
value-per-line item on the list — an existing producer wired to an existing
consumer — and it also buys breakpoint-by-name for free.

#### E6.8.3 Breakpoints on I/O ports and on interrupt vectors — MACHINE HALF DONE (2026-09-04, `00ed9f9`)

Split by lane. **Machine half (this lane) DONE:** the machine fires
`hooks.onPortAccess(dir, port, value)` on every IN and OUT, decoded or not
('in' reports the byte the program read); zero cost when unset;
test/i8086-port-trap.test.mjs. **Debugger half (DOS/host lane):** extend
`i8086-debug.js` `breakpoints: ['code','write']` with `'port'`, set the hook,
match registered watches, break on hit — hook shape handed over. **INT half:**
proposed to lego-47 — either a one-line `onInterrupt(n)` hook at the core's
`_interrupt(n)` (i8086.js, core lane; catches software INT n, INT3, INTO and
exceptions), or debugger-side opcode inspection (CD/CC/CE) for the DOS-debugging
case; their surface, their call. Original framing follows.

`i8086-debug.js` reports `breakpoints: ['code', 'write']`. For a workbench
whose entire premise is *you wired this 8255 yourself*, "stop when anything
touches port 61h" is the breakpoint people actually want, and the second
decode space to hang it on already exists in `i8086-machine.js`.

This does NOT contradict the deliberate refusal at `i8086-debug.js:22`. That
refuses *dumping* the port space, because a port read is destructive and a
debugger that dumps it changes the machine it claims to observe. Trapping an
access the PROGRAM makes reads nothing extra. Same argument, opposite answer.

Add `'int'` alongside: break on `INT n` for a chosen n, which is how a DOS
program is debugged and what our trap page (`i8086-dos.js`) is already
positioned to see.

#### E6.8.4 Cycle-level execution — OWNER WANTS THIS (2026-09-04), as a user choice if it costs speed

The honest big gap, and our own framework already admits it: `i8086-debug.js`
refuses `step('cycle')` with a reason, while `m6502-debug.js`, `z80-debug.js`,
`avr8js-debug.js` and `rp2040js-debug.js` all support it. **The 8086 is the
one CPU in this tree where the cycle-step button is dark.** XTCE-Blue runs
8088 MPH and Area 5150 because its core is cycle-interruptible; we do not
model the prefetch queue or the BIU, and `i8086.js`'s header says so.

The owner's framing, recorded as given: *we want cycle level in the end if we
can — maybe as a user choice if it affects perf.* Four decisions follow.

**It is a machine CONFIG, not a second core and not a global switch.**
`timing: 'instruction' | 'cycle'` on the machine. The cycle machine's debug
target then reports `steps: [..., 'cycle']` and the instruction machine's does
not — so the dark button lights up exactly when the machine can honour it,
through the capability vocabulary that already exists rather than a new one.
A user choice that silently changes what a breakpoint means would be worse
than no choice.

**Build it only when it can be GRADED.** `SingleStepTests/8088` ships bus
traces per vector; that is the whole reason this is buildable to this tier's
standard instead of guessed at. §E6.1's cycle counts are explicitly NOT
vector-verified today because the 8086 suite's arrays are prefetch-inclusive
and mean nothing to an instruction-stepped core — which is the same fact read
from the other end: **model the BIU and those arrays become the grader.**
No grinder, no landing.

**MEASURED 2026-09-04, AND THE MEASUREMENT OVERTURNS THIS ITEM'S PREMISE.**
This paragraph used to argue that a cycle-stepped core would be fine: the
core runs at 5.17 M instr/sec, a 4.77 MHz XT needs 0.24 M, so even a 20×
slowdown "leaves headroom on a desktop". **That reasoning was wrong, and it
was wrong in the way this section keeps warning about — it compared the
BARE CORE against the requirement, when the bare core is not what runs
anything.** `scripts/bench-i8086.mjs` already existed and already reports the
right unit, which is emulated cycles per wall second against a real XT's
clock. Five runs, medians, on this box:

```
workload     MIPS   × real XT    range
core         3.16       8.70×    6.6 - 11.1     the decoder and ALU alone
machine      1.03       2.90×    2.4 -  3.1     + region decode, ports, chips
boot         0.40       1.00×    0.7 -  1.4     real MS-DOS 2.0 off a real FDC
```

**The realistic workload is already AT real time, with no headroom at all.**
Booting a real DOS through the full machine runs at 1.0×. So a cycle-stepped
core at the usual 5-20× cost gives:

```
   5× slower  ->  0.20× real time     5× SLOWER than 1981 hardware
  10× slower  ->  0.10× real time    10× slower
  20× slower  ->  0.05× real time    20× slower
```

There is no factor at which this is "a user choice about performance". And
this is a VPS, not the phone §5 warned about; the browser bundle is still
unmeasured and will be worse.

**So E6.8.4 is REFRAMED rather than abandoned, and the new shape is better.**
Cycle accuracy is **a debugging MODE, not a running mode.** Nobody plays Area
5150 in it. You switch a machine into cycle timing to inspect a few thousand
instructions where cycle truth is the question — a video trick, a timing
loop, a race — and you switch back. That makes the owner's "user choice"
concrete and small instead of a global speed/accuracy slider that would be
dishonest at every setting: the choice is per-machine and per-session, the
capability vocabulary already carries it (`capabilities().steps` gains
`'cycle'` on a cycle machine), and nothing has to pretend a 0.1× machine is
a machine you can use.

**AND A SIDE FINDING THAT OUTRANKS THE ITEM IT CAME FROM.** `core` is 3.16
MIPS and `machine` is 1.03: **the machine layer costs about two thirds of all
execution time**, more than the CPU it wraps. Before making the core slower,
that is where the time actually is — region decode on every memory access,
port decode, chip advance and an interrupt poll per instruction. An
optimisation pass there is cheaper than any part of E6.8.4, benefits every
workload rather than a debugging mode, and would buy back exactly the
headroom this item needs. **It should be scoped as its own entry and taken
first.**

Owed and not done: the same three numbers from the browser bundle. §5 of the
core plan warns the Node figure does not transfer, and every number above is
Node.

**LICENCE TRAP, and it is the same one §E6's table already answered.**
XTCE-Blue is MIT, but it executes **reenigne's decoded 8088 microcode** —
Intel's copyrighted ROM content, exactly the reason `nand2mario/z8086` is
REFUSED above for shipping `ucode.hex`. The MIT wrapper does not launder the
microcode any more than the fMSX wrapper laundered fMSX. **Read XTCE-Blue as
a reference implementation of cycle-interruptible STRUCTURE; do not adopt its
microcode, and do not build ours by transcribing it.** The BIU/prefetch
behaviour is derivable from the bus traces in the MIT test suite, which is
both legally clean and a better oracle. Add to the table on landing.

#### E6.8.4a The machine layer costs more than the CPU — measure, then reclaim it (NEW 2026-09-04, and it goes BEFORE E6.8.4)

Fell out of E6.8.4's benchmark rather than being looked for, which is why it
is worth its own entry: nobody had put the two workloads side by side.

```
core     3.16 MIPS    the decoder and the ALU, over flat memory
machine  1.03 MIPS    the same instructions through I8086Machine
```

**Roughly two thirds of execution time is spent outside the CPU.** Per
instruction the machine layer does region decode on every memory access (a
scan of the region list, for a 20-bit address), port decode on every IN/OUT,
a chip advance, and an interrupt poll. None of that is wrong; none of it has
ever been measured either.

Why it outranks the item it came from: it benefits **every** workload rather
than a debugging mode, it is ordinary optimisation rather than a new accuracy
tier, and it buys back precisely the headroom E6.8.4 needs. A machine layer
at half its cost turns the boot workload from 1.0× real time into something
with room to spend — and only then is "make the core 5× slower" a
conversation worth having.

**PROFILED 2026-09-04, and it refuted one of this entry's own candidates.**
`_read()` against a realistic XT config (two memory regions, no MMIO windows,
three I/O chips), 20 M accesses, measured against a raw `Uint8Array` index as
the ceiling:

```
machine._read()   as shipped              31.9 M ops/s     1.00x
  + length guard and indexed for-loops    36.2 M ops/s     1.13x
  + a 256-entry 4 KB page table           65.2 M ops/s     2.04x
raw mem[addr]     the ceiling            201   M ops/s     ~5x
```

**The loop MECHANICS are not the problem; the linear SCAN is.** Replacing
`for...of` with indexed loops and short-circuiting the empty-MMIO case — the
obvious cheap fix, and the one a reader of the candidate list would have
reached for first — buys 13%. A page table buys 2x. So the cheap fix is not
worth doing at all, and that is a finding rather than an opinion: it was
measured in the same harness in the same run, which is the only way the two
are comparable given the 30% run-to-run spread this box shows.

`_read` costs about 5x a raw array index, and a page table recovers about
half of that gap. The remaining half is the call itself and the bounds work,
which is the floor for anything that stays a method.

Still guesses, still unmeasured: the per-instruction chip advance (batch to a
deadline rather than every step) and the interrupt poll, which asks the PIC a
question whose answer rarely changes. **Profile those before touching them
too** — this entry exists because an unmeasured number overturned an item
everyone believed, and it has now overturned one of its own.

#### E6.8.5 CRTC-driven video timing — DONE (2026-09-04, `9fe3b9f`)

The CGA card is now driven by a real `MC6845` (the clean-room chip the Z80 tier
already ships): 3D4h/3D5h latch and read back, the START ADDRESS (R12:R13) and
CURSOR (R14:R15, R10, R11) are emitted via getVideoState, and the vertical-
retrace proportion is derived from the CRTC's own vertical registers
(total = (R4+1)*charH + R5, active = R6*charH), recomputed on every 3D5h write.
It powers on with the standard CGA 80x25 text programming, which reproduces the
262-total / 200-active frame the card used to hardcode — so an unprogrammed card
is byte-for-byte unchanged and no 3DAh-polling game is disturbed.
test/cga-crtc.test.mjs (6). Retrace stays FRAME-grained; a cycle-exact scanline
count is E6.8.4's cycle timing, which this pairs with.
HANDOVER: startAddr is a NEW renderer input the DOS/host lane must consume for a
page flip to change the picture (told lego-47; same explicit shape as the DAC
and the EGA planes). hsync stays derived — meaningful only cycle-exact (E6.8.4).

**REFINED 2026-09-04 by reading x8086NetEmu (§E6.8.10), and the refinement
splits this item in two.** Their `CGAAdapter.vb` wires the CRTC's **start-
address registers (0Ch/0Dh) and the cursor shape/position registers** into
rendering, so register-driven scrolling and custom cursors work — and their
**retrace bits are still computed from a time modulus**, exactly as ours are.
So the two halves of this item have very different prices:

- **Start address and cursor: cheap, and independently useful.** They are
  latched register values the renderer reads; no timing model is needed at
  all. A program that scrolls by moving the start address rather than by
  copying characters is common period code, and today we draw it not
  scrolling. **Take this half first** — it does not wait on E6.8.4.
- **Retrace and scanline counts: the expensive half**, and the one that
  actually needs cycles under it. Nobody in the survey has it except the
  cycle-accurate projects.

That an independently-written emulator landed on the same time-modulus
retrace we did is worth recording as evidence rather than coincidence: it is
the natural stopping point for an instruction-stepped design, and passing it
requires the BIU work, not more effort on the video side.

#### E6.8.6 A disk-image builder, and a DOS that boots — **DONE, and it was done before this section claimed it was not** (corrected 2026-09-04)

As first written this item said the four finished devices — `upd765.js`,
`i8237.js`, INT 13h, `loadBoot()` — had **no image to feed them**, with PCjs's
`/tools/diskimage` as the model. **They have one.**
`scripts/build-dos-image.mjs` builds a bootable MS-DOS 2.0 floppy: OUR boot
sector, OUR `dos/iosys.asm` (the full CON/AUX/PRN/CLOCK plus block driver
set), OUR FAT12, and a ~200-line Intel OMF linker written because SYSINIT
ships as a `.OBJ`. Only MSDOS.SYS, COMMAND.COM and SYSINIT.OBJ are
Microsoft's, from the MIT release the licence table already cleared. It boots
to `A>` and runs `DIR`.

**And it boots twice, down two independent paths** — through the emulator's
INT 13h service layer, and through the BIOS's own DMA floppy driver on a real
µPD765 + 8237 — with byte-identical screens. `test/dos-boot.test.mjs` and
`test/dos-boot-fdc.test.mjs`. That differential found a defect neither path's
own tests could reach: **the DMA pump moved zero bytes while reporting
complete success.** Which is the third time in this tier that two independent
implementations caught what one shared one could not (see §8 of the core plan,
and the CGA pixel-layout cross-check).

What genuinely remains from PCjs here is narrower than the original item
claimed: a builder that assembles an image from an arbitrary DIRECTORY of
files, rather than the one curated boot floppy. Useful for shipping lesson
media; not a blocker for anything.

#### E6.8.7 Save/restore, surfaced

`I8086Machine.saveState()` and `loadState()` exist (`i8086-machine.js:783`)
and the chips implement their halves. PCjs persists machine state across a
page reload; x8086NetEmu XML-serialises registers, flags, all of RAM, the
video mode and the mounted disk list. Ours is an engine method the UI does
not offer. **Engine-complete; a host-lane item** — and worth stating plainly
because a survey of x8086NetEmu initially recorded this as "we lack it
entirely", which is what happens when a gap list is written from the other
project's feature page rather than from our own tree. Rule 5 again.

#### E6.8.8 A real OS as the acceptance target

emu86 boots ELKS and runs MS-DOS 6.22. Our high-water mark is CHKDSK, COMP
and DEBUG from the MIT MS-DOS release — genuinely the first third-party code
this tier ran that it did not assemble itself, and still one service at a
time. ELKS under load exercises interrupts, the timer and the FDC together in
a way 525 textbook programs never will. Gated on E6.8.1 (it wants 186) and
E6.8.6 (it wants an image).

#### E6.8.9 Declined, with reasons

- **EGA, HDC, mouse, LPT** (PCjs). Real breadth; no lesson wants them. CGA +
  Hercules + VGA-13h covers the corpus.
- **A second disassembly syntax** (emu86 ships Intel AND AT&T). Our text is
  graded against the suite's string; a second syntax would be graded against
  nothing, which is a downgrade disguised as a feature.
- **The 80186 on-chip peripherals and the R8810.** See E6.8.1.

#### E6.8.10 x8086NetEmu — the closest thing to a peer, and where it stops

`morphx666/x8086NetEmu` (MIT wrapper, VB.NET, single author, actively
maintained) is the only project in this survey that is doing roughly what we
are doing: an 8088/8086/**80186** emulator with a `v20` flag gating the same
fifteen opcodes E6.8.1 just landed, validated against **the same TomHarte
suite we use**.

**Its harness is the interesting part, and it substantiates a claim §E6.8
made about ourselves.** `RunTests2` does not run clean: it SKIPS opcode `0F`
(POP CS), `F6.7`/`F7.7` (IDIV, "these opcodes seem to have bugs"), and all of
`60`-`6F` and `C0`/`C1`/`C8`/`C9` as "we do not support these opcodes" — the
undocumented aliases. It also IGNORES the flag results for the whole shift
group and for MUL/IMUL/DIV/IDIV. No pass rate is published. So the
undocumented-behaviour lead this section claims is not a matter of taste
between two projects that made different choices: it is the difference
between grinding those vectors and excluding them. Their prefetch queue
(`Helpers/Prefetch.vb`) is entirely commented out, so they do not model the
BIU either.

What they have that we do not, after checking each against our own tree
rather than against their feature list:

| | Verdict |
|---|---|
| **CRTC start-address + cursor registers wired to rendering** | **TAKE IT.** Folded into E6.8.5, which it splits into a cheap half and an expensive one. |
| **Save-state, serialised to a file** | Already ours at the engine level (`saveState`/`loadState`); the gap is the UI. See E6.8.7. |
| **Adlib / SoundBlaster** | Wanted, and **their copy is not the way in** — see E6.8.11. |
| **CMOS RTC (MC146818, ports 70h/71h)** | Not now. A PC/XT has no CMOS RTC; this is AT-class scope. |
| Host-folder-as-disk | Nothing to take: their own class throws `NotImplementedException`. |
| Serial | **We are ahead.** They special-case a bit-banged serial mouse; we have a real NS16C550 and an 8251. |
| Hard disk | **Parity.** No register-level HDC; it is an INT 13h hook over a disk image, which is what ours is. |
| Debugger | **Parity.** Step in/over/run and address breakpoints. No symbols, no port breakpoints, no cycle step — so E6.8.2 and E6.8.3 would put us ahead of it rather than level. |

#### E6.8.11 Adlib and SoundBlaster inside a BSD-3 bundle — how, specifically

The owner asked how this can be done at all under our licence regime. It
divides cleanly into two problems with two very different answers, and the
usual assumption — that FM synthesis is the licensed part and digital audio
is the free part — is **backwards for us**.

**The digital half is nearly free, because we already built its hard part.**
A Sound Blaster's DSP is a port/command state machine at 2x0h driven by
**8237 DMA channel 1 and an 8259 IRQ**, both of which exist here, are
vector-adjacent tested, and already move real bytes — `test/dos-boot-fdc.test.mjs`
proves the DMA pump against an independent path. The command set (time
constant, 8-bit single-cycle and auto-init playback, the DSP reset
handshake) is documented in Creative's own *Sound Blaster Hardware
Programming Guide*, which is a specification to implement from, not code to
copy. This is an `sb-dsp.js` in the shape of `upd765.js`: a register/command
state machine that hands blocks to the DMA controller.

**The FM half is where the licences bite, and there is exactly one clean
door.** Every widely-used OPL2/OPL3 core descends from a short list, and most
of that list is out of reach:

| Source | Licence | Ruling |
| --- | --- | --- |
| **`aaronsgiles/ymfm`** | **BSD-3-Clause** (verified 2026-09-04) | **THE ANSWER.** From-scratch BSD-licensed Yamaha FM cores — OPL/OPL2/OPL3 (YM3812, YMF262) among others, 252 KB. Same licence as this bundle. It may be **read, adapted, or vendored outright** with its notice, which is a thing almost nothing else in this table permits. |
| `nukeykt/Nuked-OPL3` | **LGPL-2.1** | REFUSED. The most accurate OPL3 emulation there is, and it cannot ship here: an LGPL core inside a single bundled JS artefact carries relink obligations a BSD-3 distribution does not discharge. |
| DOSBox `dbopl` | GPL-2.0 | REFUSED. |
| `fake86` (Mike Chambers) | **GPL-2.0** (verified 2026-09-04) | REFUSED — and see the note below, because this one is a trap that has already caught someone. |
| MAME `src/devices/sound/*` | per-file `// license:` headers, many **BSD-3** | Readable, and a cross-check on ymfm. Verify the header on the exact revision read. |

**The trap, and it is the rule of §"A licence covers what its author wrote"
in its purest form.** x8086NetEmu is MIT, and its own README states its
Adlib/SoundBlaster (and CGA/VGA) code is "adapted or inspired from" **fake86**,
which is GPL-2.0, and its group-2/MUL/DIV flag handling from **PCE**, also
GPL. So the audio code in an MIT repository is GPL-derived, the MIT LICENSE
does not and cannot relicense it, and reading it as our reference would import
exactly the obligation we refuse. **Do not read x8086NetEmu's audio.** Read
ymfm, which is licensed for it.

**AND AN OPL WITH NO PATCH SET MAKES NO SOUND** — which is a third problem,
separate from the core and from the DSP, and it is the one that usually gets
discovered last. A YM3812 is a bank of operators with no opinions; the
instruments live in data, and period data (id's GENMIDI lump, Creative's
`.SBI`/`.INS` files) is not ours to ship.

**A second sweep on 2026-09-04 closed all three, and the chain is complete:**

| Piece | Source | Licence | |
| --- | --- | --- | --- |
| the FM core | `aaronsgiles/ymfm` | **BSD-3-Clause** | vendorable with notice |
| the patch set | `sneakernets/DMXOPL` | **MIT** (verified via API) | data-only `.op2`/`.wopl`; README grants reuse for credit |
| a MUS sequencer | `raffecat/LittleMUS` | **MIT** | `musplayer.c/.h` is core-agnostic — it calls an externally supplied `adlib_write(reg, val)` and nothing else, and it eats exactly DMXOPL's `.op2` layout |
| the digital side | Creative's own programming guide | a specification | over our existing 8237 + 8259 |

So there IS a licence-clean path from a `.MUS` file to a speaker, assembled
from four independently permissive pieces, and none of it requires reading a
GPL source. `LittleMUS`'s other half (`musdriver.c/.h`) is written against
Nuked-OPL3's struct names and would be rewritten against ymfm — an API
mismatch, not a licence one, since MIT permits exactly that.

**One caveat recorded rather than smoothed over:** DMXOPL's author states the
patches are original work using the old ones "as a base for your own
derivative", and that is a self-report. Nobody has diffed the FM parameter
values against id Software's original GENMIDI lump, and nobody in this survey
could. If this is ever shipped, that diff is the due diligence, not the
author's sentence.

Ordering, if this is ever taken: **the DSP first, the FM second, the patch set
third.** The digital half needs no new licence decision and reuses two chips
already in the tree; the FM half is the bigger build; the patch set is a file.

**The real cost is neither of the above, and it is architectural.** Our audio
contract is `audioTone() -> {hz, on}` — `pc-speaker.js` says so in its own
header: *"No samples, no synthesis."* Every audio path in the retro tier
answers with a TONE DESCRIPTOR, not a sample stream, and that is why a UI
needs no new concept for a second CPU family. An OPL or a DSP cannot answer
in that shape; both produce samples. So this item is really "give the engine a
second audio contract, a sample-buffer one, alongside the tone one" — and
that decision affects the Z80 and 6502 tiers too, which is why it belongs in
the roadmap rather than in a commit. **Scope it as an engine-wide audio
change, not as a sound card.**

#### E6.8.11a The second audio contract — a design for all three tiers (owner-assigned 2026-09-04)

E6.8.11 said audio was blocked on a decision nobody owned. The owner has
settled that: **we own audio across all three tiers**, so this is the design.

**WHAT EXISTS TODAY, surveyed rather than remembered.** One contract,
`audioTone()`, with three producers and one consumer:

| | shape | |
| --- | --- | --- |
| `pc-speaker.js` | `{hz, on}` | 8254 counter 2 through 8255 port B |
| `zx-ula.js` | `{hz, on}` | the ZX beeper |
| `ay-3-8912.js` | `[{hz, on, vol}, …]` | three channels — **an array, not an object** |
| 6502 tier | *nothing* | no audio producer at all |

The consumer is `CircuitDesigner.jsx`: a `requestAnimationFrame` poll of
`debugState.audio()` into `updateBuzzerAudio()`, which drives a Web Audio
oscillator. So the installed base is **one oscillator polled at frame rate**,
and that is worth knowing before designing, because it means we are far less
constrained than "an existing audio system" would suggest.

**THE TWO CONTRACTS ANSWER DIFFERENT QUESTIONS, and that is the whole design.**
The instinct is to replace the tone contract with samples. That would be
wrong. `audioTone()` answers *what is the hardware CONFIGURED to produce* —
it is exact, it costs nothing, and it is what a teaching UI wants to show
("this counter is set to 440 Hz"). A sample stream answers *what does it
SOUND like*. Deriving the first from the second would make a breadboard
buzzer expensive and would lose the exactness. **Both stay, declared through
the same capability vocabulary `steps` and `breakpoints` already use:**

```
capabilities().audio -> ['tone']              a buzzer, a beeper
capabilities().audio -> ['tone', 'samples']   an OPL, an SB, an AY, a SID
```

**THE SAMPLE CONTRACT.** Pull-based, at the chip:

```js
/** Fill `dest` with `frames` mono samples in [-1,1] for the emulated time
 *  they represent. Returns frames written. The CHIP owns the rate
 *  conversion, because only it knows its own clock. */
renderAudio(dest /* Float32Array */, frames, sampleRate) -> number
```

Three decisions in that signature, each with a reason from this codebase
rather than from convention:

1. **PULL, NOT PUSH, AND EMULATED TIME, NOT WALL TIME — and E6.8.4's
   benchmark is why.** We measured this engine at **0.7×–1.4× real time on a
   real DOS boot**, jittering run to run. Any audio design that assumes
   emulated time tracks wall time will underrun and overrun audibly, on our
   own measured numbers. So a chip renders the audio for the emulated time it
   has actually executed, a ring buffer at the machine level absorbs the
   jitter, and the host drains it. This is a constraint we measured, not one
   we inherited.
2. **Mono `Float32Array` in [-1,1] as the lingua franca.** A PC has a speaker
   AND possibly an OPL AND an SB at once; a ZX has a beeper AND an AY. The
   mixer sums at the machine level. Stereo is a channel count added later, not
   now.
3. **Zero cost when nobody is listening.** `renderAudio` is called only when a
   sink is attached — the same rule `syncWriteTrap` and the E6.8.3 hooks
   follow, and the same lesson E6.8.4a just taught about per-instruction cost.

**HOW IT GETS GRADED, which is the part that makes this ours rather than
generic. THE TWO CONTRACTS MUST AGREE.** If `audioTone()` says 440 Hz, the
stream from `renderAudio()` must measure 440 Hz — count zero crossings, or run
a Goertzel filter at the claimed frequency. That is a cross-check between two
independently written paths inside one chip, which is the discipline §8 of the
core plan already records for the CGA pixel layout: *"the pixel layout is
written twice and cross-checked… sharing the code would have been less work
and would have caught nothing."* It catches the exact failure mode a sample
path invites — the tone math and the synthesis math drifting apart — and it
needs no external oracle. For an OPL specifically, `ymfm` (BSD-3) is available
as a second one.

**KNOWN WART, and it should be fixed under this rather than inherited by it:**
`audioTone()` returns an OBJECT from the speaker and the ULA and an ARRAY from
the AY, so every consumer already has to discriminate and the one that exists
does not. The fix is for the contract to be an array always, with a
single-voice device returning one element — but that breaks
`updateBuzzerAudio(id, tone)`, so it is a named migration and not a silent
change.

**ORDER.** The contract and the mixer first, with the speaker and the AY as
its first two producers and the tone/sample agreement test as its gate —
those are chips we already have, so the contract gets exercised before
anything new is built on it. The SB DSP next (E6.8.11: our 8237 and 8259 do
the work). The OPL after that, and only then does the ymfm/DMXOPL/LittleMUS
chain from E6.8.11 get vendored. **A 6502-tier producer is the proof the
contract is not 8086-shaped** — that tier has none today, so whatever is
added there is written against this contract from the start rather than
migrated onto it.

#### E6.8.12 MicroCoreLabs — not a feature diff, a set of directions

`MicroCoreLabs/Projects` (Ted Fried) has **no LICENSE file anywhere** — not at
the root, not in any 8086-adjacent subfolder, and the GitHub API reports
`license: null` (verified 2026-09-04). **All rights reserved: inspiration
only, never a code source, and nothing quoted from it.** With that stated,
four things in it are worth recording:

- **MCL86** is a microsequencer 8086/8088 with a genuinely separated
  `biu_max.v` / `biu_min.v` (Maximum and Minimum mode bus signalling — the
  real MN/MX pin distinction) and `eu.v`, driven by a ~417 KB microcode table.
  It is the most detailed available picture of **what a true BIU model has to
  track** — ALE, bus-cycle T-states, queue status — if E6.8.4 is ever taken.
  **Same caution as XTCE-Blue and z8086:** whether that microcode is
  Intel-derived could not be established, and under this tier's rules an
  unestablished provenance is a refusal, not a maybe.
- **MCL86jr / MCL86+ / MCLV20_Max** are FPGA boards that physically replace
  the 8088 in a real PC/XT or PCjr. Their README notes bug fixes found via
  the **MiSTer PCXT** core — which is a pointer worth following: a second
  independent cycle-accurate implementation is exactly the kind of
  cross-check that produced our own best findings.
- **XTMax** emulates RAM, ROM and peripherals live on a real ISA bus from a
  Teensy. Conceptually the hardware twin of our own bus extractor, and an
  argument that the extractor idea generalises past the breadboard.
- **Lockstep_QMR** runs redundant cores in continuous lockstep with automatic
  divergence detection. Not 8086 and not adoptable — but as a METHOD it is
  the natural step past a vector grinder: **run our core in lockstep against
  a second implementation and flag divergence live**, rather than only at
  vector time. That is the same instrument that found the DMA pump moving
  zero bytes, generalised. Worth its own item if the tier ever wants one.

#### E6.8.13 Elegant86 — checked, and correctly nothing

`moesay/Elegant86` (**GPL-3.0**, ~44 KB, C++/Qt5, self-declared WIP) is a
teaching assembler and execution visualiser whose assembler implements about
eight instructions — ADD, AND, JMP, MOV, POP, PUSH, SUB and a no-op group —
with no oracle of any kind. The owner's read of it as a completeness item was
right. Refused on licence regardless, and there is nothing in its scope this
tier does not already do more completely. Recorded so nobody surveys it twice.

#### E6.8.14 The second emulator sweep — hotkeysoft, DotXT, cbm2-pc (2026-09-04)

**`hotkeysoft/emulators` (MIT, C++) was already in the table and the entry was
far too narrow.** It was listed only as an MIT cross-check for its
`Device8254`/`Device8259`/`Device8250`. It is actually a multi-machine suite
covering 8086/8088/**80186/80286** across PC/XT, PC/AT, PCjr and Tandy 1000,
validated against the same TomHarte lineage we use (no published pass rate).
Four things in it we do not have:

- **EGA**, running the real IBM EGA BIOS ROM. A reference for the register
  model, not code and not a ROM we could ship. Roadmap only.
- **80286 far enough for POST, plus LOADALL.** Out of scope by §2, but the
  best available sighting of what "far enough" means.
- **A snapshot GUI** — browse, restore and annotate save states. This is
  precisely the layer E6.8.7 says we are missing on top of an engine that
  already has `saveState`/`loadState`. **Take the interaction pattern**, not
  the code; different stack entirely.
- **Sound: PC Speaker, SN76489, CMS/Game Blaster, Disney Sound Source.** More
  breadth than the Adlib/SB axis E6.8.11 scopes, and the same second-audio-
  contract problem gates all of it.

**`folkertvanheusden/DotXT` — read the licence before anything else.** The
README says *"This software is © Folkert van Heusden. Released in the public
domain."* There is **no LICENSE file, and the GitHub API reports
`license: null`** (verified 2026-09-04). A bare sentence is not a formal
dedication: CC0 and the Unlicense exist precisely because unilateral
public-domain release is not recognised in much of the EU. **Treat as
author-stated, unformalised — read only, do not vendor, do not paraphrase
closely.** On the merits it is behind us anyway: its own `todo` records ESC/FPU
unimplemented, DIV/IDIV interrupt and flag edge cases wrong, and disassembler
bugs, against our 646,000 + 132,532 with the undocumented behaviour included.
What it has that we lack — **MDA** (cheap, a port-mapped text card), **XT-IDE**
(medium, and it is what gets a machine past a floppy), an **RTC** (cheap),
and Adlib/MIDI (see E6.8.11) — is worth having; its implementation is not the
route to any of it.

**`MichalPleban/cbm2-pc-emulator` (Apache-2.0) is not an emulator and can be
dropped.** It is firmware for a *real, physical* 8088 expansion card in a
Commodore CBM-II, bridging two pieces of genuine silicon: the 8088 side
intercepts about forty INT 10h/13h/16h BIOS calls and hands them to a 6509
that drives real Commodore hardware — MDA text copied into CBM-II video RAM,
INT 08h/1Ch off real CIA timers, PC speaker tones synthesised on a SID. The
one conceptual parallel — translate INT-based BIOS calls into host-native
services — is what `i8086-dos.js` already does, in software and more directly.
Recorded so nobody surveys it twice.

#### E6.8.15 Tooling checked, and correctly declined (2026-09-04)

- **`kawaii-Code/as88v2`** — **Unlicense (public domain)**, Zig, a
  reimplementation of Tanenbaum's `as88` from *Structured Computer
  Organization*. Fully vendorable, and we still should not: the dialect is a
  THIRD one, neither MASM nor NASM (`.SECT .TEXT`, `!` comments, `(x)` for
  dereference, and a fake `SYS` instruction that is not an 8086 opcode at
  all), and its own README calls it "highly unstable... only a small subset of
  instructions". Its test suite asserts exit code zero. Ours is 510/525 of a
  MASM corpus plus 646,000 graded on text. **Take nothing.** The one idea worth
  noting is its `t88` tracer — registers, stack, source and command input in
  one view — which is a layout argument for E6.8.2/E6.8.3, not code.
- **`ccodere/instrcvt`** — **the hypothesis was wrong and the correction is
  useful.** It is not an instruction converter. It is a 1995 Turbo Pascal
  **instrument** converter, moving between `.SBI` (Sound Blaster Instrument),
  `.INS` (AdLib, 54-byte) and AdLib Sound Tracker patch formats — so it
  belongs to E6.8.11's third problem, not to the assembler at all. **No
  LICENSE file**; the source header carries a custom 1995 freeware notice that
  forbids re-release of modified source. **Refused**, and unnecessary: DMXOPL
  ships `.op2`/`.wopl` under MIT and LittleMUS reads `.op2` directly, so the
  `.SBI` path is not one we need.
- **`DynartInteractive/DOS-Game-Engine`** — MIT at the top level, and **the
  MIT does not reach three of its own files.** `UNITS/SBDSP.PAS`,
  `UNITS/PLAYHSC.PAS` and `UNITS/XMS.PAS` are near-identical to the copies in
  its own `VENDOR/` tree and **retain the original authors' notices verbatim**
  — "all rights reserved", "NOT to be distributed modified", and a NEO
  Software clause requiring written permission for commercial use — inside
  files a blanket MIT LICENSE claims. The `DATA/*.PCX` art is separately
  carved out as non-commercial. It is Turbo Pascal in any case, so our
  assembler could not ingest a line of it. **Take nothing**, and note the
  inline `asm` fragments (mode 13h set, INT 33h mouse polling, DMA critical
  sections) only as LESSON TOPICS — the Sound Blaster ones live in the tainted
  units specifically.

#### E6.8.16 The vendored-licence rule is not an occasional trap. It is the norm in this field's audio code.

When this rule was written (below) it had one instance. As of 2026-09-04 it
has four, and **three of them are audio**:

| Repo | Says | Actually contains |
| --- | --- | --- |
| `morphx666/x8086NetEmu` | MIT | Adlib/SB from **fake86 (GPL-2.0)**, group-2 flags from **PCE (GPL)** |
| `Raffaello/hyper-sonic-drivers` | Apache-2.0 | **Nuked-OPL3 (LGPL-2.1)**, **MAME `ymf262` (GPL-2.0-or-later)**, **DOSBox `dbopl` (GPL-2.0)**, woody (same DOSBox lineage), **ScummVM (GPL-3.0)**, **MUNT (LGPL-2.1)**, and a **Miles Design proprietary EULA** doc |
| `DynartInteractive/DOS-Game-Engine` | MIT | three units under 1995 freeware "all rights reserved / not to be distributed modified" terms |
| `dbalsom/XTCE-Blue` | MIT | reenigne's decoded **Intel microcode** |

`hyper-sonic-drivers` is the specimen worth keeping, because it is the trap at
full size: an Apache-2.0 LICENSE over a directory tree in which *four
different copyleft licences* are vendored verbatim, each still carrying its own
SPDX header. Nothing about the repository page shows it. **And the one clean
thing inside it is `hardware/opl/mame/ymfm/` — which is `aaronsgiles/ymfm`,
BSD-3, exactly the door E6.8.11 already found.** An independent search
arriving at the same single answer is the strongest evidence we have that the
answer is right.

Practical consequence, and it is a change of default: **for audio, assume a
permissive top-level licence is wrong until the tree is walked.** Read the
per-file SPDX headers, not the LICENSE file, and check the dependency
manifest — `hyper-sonic-drivers` pulls LGPL MUNT through `vcpkg.json`, where
no file header would ever show it.

#### A licence rule this survey forced, and it belongs above the table

**A repository's LICENSE covers what its author WROTE, not what they
VENDORED.** Three separate traps in this tier now share one shape: the fMSX
subtree under an MIT wrapper (refused above); XTCE-Blue's MIT wrapper over
Intel's microcode (E6.8.4); and `Maze_Runner_Go`, MIT and already listed as
shippable-with-attribution — whose `Github Assembly Compiler/` directory
bundles **DOSBox and Notepad++, both GPL**. The LICENSE does not cover them
and could not. Take the `.asm`, never the vendored tool directory.

The check is mechanical and should be run before any row is added: list the
repo's directories before reading its LICENSE, and treat any bundled binary
or third-party tree as unlicensed until separately established.

#### Order

Revised 2026-09-04 after the two corrections above. The prerequisite is met
and E6.8.6 is done, so both leave the queue:

**E6.8.1 is DONE** (2026-09-04): core 132,532/132,532 and disassembler
172,430/172,430 against SingleStepTests/v20, 8086 unchanged at 646,000/646,000
on both grinders, `vectors186:` in CI. The disassembler's `labels` support was
rebuilt from a text regex to positional substitution on the way, which is
E6.8.2's substrate rather than E6.8.2 itself.

**E6.8.2** (the join: `i8086-asm.js` builds `symbols`, `i8086-disasm.js` now
takes `labels` correctly, and the debug target passes nothing) → **E6.8.3**
(still `breakpoints: ['code','write']`) → **E6.8.5a**, the CRTC start-address
and cursor half, which E6.8.10 showed is independent of any timing work →
**E6.8.11's DSP half**, if audio is wanted, because it reuses the 8237 and
8259 and needs no licence decision → **E6.8.5b** (retrace, which needs cycles
under it) → **E6.8.4** (cycle timing, once its perf numbers exist) →
**E6.8.8** (the harsh oracle, last because it needs E6.8.1 and E6.8.6, and
now has both). E6.8.11's FM half and E6.8.12's lockstep idea are unscheduled:
both are engine-wide changes rather than 8086 items.

Until E6.8.4 lands, `i8086-debug.js`'s `step('cycle')` refusal should say what
it would TAKE, not only that it cannot — that refusal is currently the only
place a user meets the omission, and this tier's standard is that a refusal
teaches.

---

## E7 The 8086 in the Circuit Designer — an example that is a MACHINE, not a demo

**STATUS 2026-09-04 — steps 1-4 and 9 are DONE; the numbered plan below is left
intact because its dependency ORDER turned out to be the load-bearing part.**

| Step | State |
|---|---|
| 1 engine readiness | DONE |
| 2 bw-circuit-ui recognises the 8086 | DONE — support-chip lane, part + footprint + `extract8086Machine` |
| 3 host wiring in `debug-runner.js` | DONE — `attachI8086()`, kind normaliser, lite `b1c69eeb1` |
| 4 vendor the tier into lite | DONE — 20 modules, all imports resolve |
| 5 UART shell | DONE for a machine that HAS a UART; the XT BIOS deliberately has none (see below) |
| 6 display widget on `video()` | wired; **blocked on BIOS graphics** — nothing can draw a pixel yet |
| 7 keyboard widget | scancodes reach the 8255 through IRQ1; exercised by the FDC boot test |
| 8 GUI binary loading | in flight (program-list lane) |
| 9 boot from disk | DONE — MS-DOS 2.0 boots two independent ways, byte-identical |

**THE ORDER MATTERED AND IS WORTH KEEPING.** Step 3 before step 4 was not
bookkeeping: lite's `no-dead-overlay-modules` gate refuses modules nothing
imports, so vendoring first means arguing with the gate that exists to catch
exactly this. Doing it in the stated order meant the gate had a real question to
answer — and it answered one nobody had asked, naming `i8237.js` and `upd765.js`
as unreachable. They were unreachable EVERYWHERE: the machine's chip factory had
no `dma` or `fdc` kind, so no config in any repo could instantiate either, while
both chips' own suites stayed green.

**ONE ASSUMPTION IN THE ORIGINAL PLAN WAS WRONG.** It promised "a UART shell
exactly like the Z80 and 6502 tiers". Our XT BIOS has no UART — deliberately:
INT 14h is a stub and the equipment word reports no COM port, because the XT
config has no 8250. Output is the CGA text page at B800:0000. So the BIOS
example is a SCREEN-AND-KEYBOARD machine and `SerialConsole` does not attach to
it; a UART shell is a separate board example with its own monitor ROM
(SERIALSHELL8086, support-chip lane). Recorded because the plan's own wording
would otherwise have someone wiring a console to a machine that cannot speak.


The goal the owner set: drag an 8086 and its support chips onto the breadboard,
Build Machine, and get a UART shell exactly like the Z80 and 6502 tiers — with
keyboard/display widgets and GUI binary-loading — and, because a BIOS ROM of
our own exists, an 8086 that BOOTS ITSELF into that shell rather than being
hand-fed a program.

THE WHOLE REMAINING GAP IS WIRING, NOT EMULATION. bw-board already has the
complete tier — core (646k/646k), machine, adapter, `createDebugTarget('i8086')`,
`extract8086Machine`, every support chip, the CGA/Hercules/VGA cards, and the
drawable DIP parts in bw-parts. Nothing here needs a new emulator; it needs the
UI and the host to consume what exists. Three repos, and (per the owner) no
dedicated bw-circuit-ui agent — this lane drives the UI work and coordinates
only the lite vendoring with the DOS/host lane.

Steps, in dependency order. Each names the repo, the concrete files, and who
lands it.

1. **Engine readiness — bw-board. DONE / in flight.** Machine, adapter
   (`onSerial`/`sendSerial`), debug target (`regs`/`step`/`video`/`audio`),
   `extract8086Machine`, chips and cards all exist. The debug target's `video()`
   → `{width,height,rgba}` and `audio()` → `{hz,on}` wiring to the CGA/VGA
   renderer and the speaker is the DOS/host lane's in-flight video-surface work;
   our side (`getVideoState`, `machine.audioTone`) is done. Ship a Circuit-
   Designer EXAMPLE PRESET (see the CORRECTIONS block below — the BIOS ROM is
   a SCREEN-AND-KEYBOARD machine, not serial).
   **DONE (2026-09-04): both self-booting example presets shipped in
   `src/i8086-machine.js`, each with a ROM builder and an end-to-end test:**
   - **`SERIALSHELL8086`** — the UART-shell example (the Z80/6502 serial-
     monitor counterpart). `rom/serial-monitor.bin` (scripts/build-serial-
     monitor.mjs): 16550 at port 10h, banner + echo. Drives SerialConsole.
     test/i8086-serial-shell.test.mjs.
   - **`CGADEMO8086`** — the screen example. `rom/cga-demo.bin` (scripts/
     build-cga-demo.mjs): CGA text mode, writes a message into B800:0000.
     Drives VdpScreen. TEXT mode only (clear of the INT 10h graphics hole
     the DOS lane is filling). test/i8086-cga-demo.test.mjs.
   - **`TIMERDEMO8086`** — the interrupt example. `rom/timer-demo.bin`
     (scripts/build-timer-demo.mjs): hooks INT 8, programs PIC+PIT, paints a
     live counter into B800 on every tick. Exercises the WHOLE interrupt path
     (8254 OUT0 -> 8259 IR0 -> CPU INT 8 -> ISR -> B800 -> EOI) — the first
     end-to-end proof a running program takes and services a hardware
     interrupt here. Own-authored, adopting only the CONCEPT of the MIT
     "Learn Assembly the Hard Way" timer.asm (that repo is a student's
     mixed-provenance course dump — not vendored). test/i8086-timer-demo.test.mjs.
   - **`PCXT8086`** — the full XT board the BIOS ROM + MIT games run on;
     now maps the CGA text page (B8000-BFFFF) to match the DOS lane's XTDISK
     region map. This is the "boot the real BIOS" board, not a minimal demo.
   These are the machines step 2's Machine-Loader offers; the minimal two are
   pickable and demonstrable today, PCXT8086 once the host wires video/keyboard.

2. **bw-circuit-ui recognises and places the 8086.** Add `i8086` to
   `src/parts-data/` (JSON + SVG, reuse the bw-parts pinout), register the kind
   in `src/model/circuit.js` (controller list), `src/model/footprints.js`,
   `src/model/drc.js`, `src/components/BoardCanvas.jsx`; add an
   `extract8086Machine` branch to `src/model/machine-extract.js`; extend
   `hasRetroCpu` and the Machine-Loader in `src/components/CircuitDesigner.jsx`
   (preset with `romAt: 0xF0000` load address; see CORRECTIONS). THIS LANE.
   **DONE (2026-09-04, feat/i8086-ui): recognition landed at 9bff4d3 (parts-
   data JSON+SVG, circuit/footprints/machine-extract branches, BoardCanvas),
   and the Machine-Loader now offers the three 8086 board firmwares (afee1de).
   The one 8086-specific rule: an image maps to the TOP of the 1M space, so
   the loader carries `romAt = 0x100000 - length` on the bw-machine-media-load
   event (32K -> F8000h, a 64K BIOS -> F0000h) — step 3's host consumes it as
   the loadRom address.** Build green.

3. **Host wiring — brickwright-lite `debug-runner.js`.** An `i8086` branch that
   calls `createDebugTarget('i8086', {config, rom, romAt})`, subscribes
   `adapter.onSerial`, sets `runner.sendSerial`; inject `extract8086Machine` in
   `circuit-tab.jsx`; extend the CPU-detection regexes. THIS is the first real
   IMPORTER of the tier — it is what dissolves `no-dead-overlay-modules`.
   DOS/host lane, on our signal.

4. **Vendor the tier into lite.** `sync:bwboard --dir` pulls the `i8086-*.js` +
   `i8255/i8259/…` into the vendored bw-board (they are absent today). Triggered
   by step 3's importer. DOS/host lane.

5. **UART shell — falls out of step 3, no code.** `SerialConsole.jsx` is already
   machine-agnostic; once the runner subscribes the 8086 adapter's serial, the
   shell works, newline 0x0d like the others.

6. **Display widget on `video()`.** `VdpScreen.jsx` renders `{width,height,rgba}`
   unchanged; needs step 1's debug-target `video()` returning the CGA/VGA
   renderer's frame. DOS/host lane's renderer + this lane's cards.

7. **Keyboard widget.** `VdpScreen` already emits `setKeys`/`setButtons`; route
   8086 key input through the BIOS INT 16h/09h path (or an 8255 port). Decide
   the input seam with the BIOS.
   **SEAM DECIDED + HARDWARE LAYER DONE (2026-09-04, `81630bd`).** Decided WITH
   the BIOS lane: the HARDWARE path, not an INT 16h buffer — the widget then
   works on any board with a PPI + PIC (like SerialConsole works without a BIOS),
   and the BIOS's own INT 09h sits on the same hardware. `machine.keyIn(scancode)`
   latches the byte at the keyboard 8255's port A (0x60) and raises IRQ1; the
   ack is the port-B bit-7 strobe (rising edge drops IRQ1), matching the BIOS's
   int09 (bios.asm:734). KBDDEMO8086 + rom/keyboard-demo.bin prove it bare-metal
   (INT 09h -> read 0x60 -> ack -> set-1->ASCII -> echo -> own EOI); it is the
   first thing to drive the 8259 IRQ1 path for real (the DOS boot test had been
   using cpu.interrupt(9) direct). REMAINING (host lane): debug-runner maps
   VdpScreen key events -> set-1 scancodes -> `runner.keyIn`. The UI loader entry
   is HELD until that lands — a board you cannot type into is not an example.

8. **GUI binary-loading.** The file-upload path already accepts `.bin`; add the
   `i8086` loader branch (`romAt: 0xF0000` load address) and an example ROM under
   `static/roms/` (the BIOS ROM, or a small serial monitor). bw-circuit-ui.

9. **Boot from disk.** The 8237+µPD765 machine integration (this lane's queued
   one-green-commit — aux windows, transfer pump, TC wire, page-wrap tests) plus
   a bootable MS-DOS 2.0 image (DOS lane). The "run a real OS" milestone; it
   sits last because a serial-shell example needs neither.

Ownership: bw-board + bw-parts = this lane (done). bw-circuit-ui = this lane now
(no separate agent). brickwright-lite host + vendor = DOS/host lane, on our
importer signal. SerialConsole / VdpScreen / ArchitectureFace / AsmDebugPanel
are all reusable unchanged.

CORRECTIONS (from the DOS lane's BIOS ROM, 2026-09-03) — the plan above said
"UART shell"; the ROM changed the picture and these supersede it:

- TWO EXAMPLES, not one. The self-booting BIOS ROM (`rom/bios.bin`, 64K) has
  NO UART on purpose ("no 8250 in the XT config"): it is a SCREEN-AND-KEYBOARD
  machine — output via the debug target's `video()` (CGA text at B800:0000),
  input via the 8255 scancode port and INT 09h/16h. So its example board wants
  a CGA card + 8259 + 8254 + 8255 (all this lane's chips) and uses VdpScreen,
  not SerialConsole. The "UART shell like the other MCUs" the owner asked for
  becomes a SECOND, simpler example: a small serial-monitor ROM + a UART
  (ns16c550 or 8251) driving SerialConsole.
  **RESOLVED (2026-09-04): both example presets are built (see step 1). The
  serial example is `SERIALSHELL8086`; the screen example ships as the minimal
  `CGADEMO8086` (self-contained CGA-text demo, no BIOS) alongside the full
  `PCXT8086` board that the real BIOS ROM boots. So there are in fact THREE
  presets: two minimal self-booting demos (one per widget) and the full XT.**
- ROM PLACEMENT is a LOAD address, not the entry. The BIOS loads at 0xF0000
  (segment F000h); 0xFFFF0 is the reset vector INSIDE that image, not where it
  goes. `loadRom(bytes, at)` takes the load address, so `romAt: 0xF0000` with a
  rom region F0000-FFFFF. A 64K-high load looks identical to a dead machine.
- THE TRAP-PAGE DIVERGENCE. A drawn/BIOS machine is a HARDWARE machine (real
  8259/IVT, no trap page); only the no-hardware DOSBOX8086 gets the DOS
  trap region. The host's `createDebugTarget('i8086')` must NOT inject the trap
  page for a config that carries a ROM at F0000, or the BIOS fights it.
- EXTRACTOR IRQ GAP — DONE (this lane, 2026-09-04). `extract8086Machine` now
  traces the interrupt wiring: it finds the 8259, maps its ir0-ir7 nets, and
  follows a PIT OUT (counter 0/1/2), a serial chip's interrupt pin
  (acia6850 irqb / uart16550 intr / usart8251 rxrdy), or an FDC IRQ to an IR
  line, emitting `irq:n` (+ `irqChannel` for the PIT counter) with a note. A
  board with no such wire extracts WITHOUT irq — the honest result, a machine
  whose tick never fires because the user never drew the wire, not a canned
  preset that hides the omission. Verified: test/i8086-extract.test.mjs
  ('a PIT OUT0 wired to PIC IR0 extracts as irq:0', and the miswired-board
  companion). So a drawn PIT+PIC now boots the BIOS's 18.2 Hz tick.

### E7.1 The display-demo set — one bare-metal example per display card (owner-requested, 2026-09-04)

The owner wants the Display widget shown across the card family, not just CGA
text: "hercules ega and vga demos etc in the end." Each is a small, self-
booting, BIOS-free ROM that programs the card's mode register and writes its
framebuffer directly, so the widget shows a real picture from hardware alone —
the same shape as CGADEMO8086. Delivered one after another, in dependency
order. THIS LANE owns the firmware + preset + the card's mode/framebuffer
STATE and its test; the DOS/host renderer owns turning that state into pixels
(the seam is `videoFrame()` / `renderMode`, on `feat/i8086-tier`).

1. **CGA text — DONE.** CGADEMO8086 + rom/cga-demo.bin. 80x25 text at B800.
2. **CGA graphics — DONE (2026-09-04, `f70e5f3`).** rom/cga-gfx-demo.bin on the
   SAME CGADEMO8086 board: mode 4 (320x200x4) colour bars, both interleaved
   banks. Renderer `cga4` decode confirmed in-process by lego-47.
   test/i8086-cga-gfx-demo.test.mjs. Loader entry: bw-circuit-ui `f7bd2f2`.
3. **VGA mode 13h — DONE (2026-09-04, renders).** The second display board that
   actually draws. VGADEMO8086 (VGA block at 3C0h + the 64K framebuffer at
   A0000) `141dda6`; rom/vga-demo.bin `d837a15`; loader entry bw-circuit-ui
   `b27e102`. The firmware is MINIMAL-and-correct: it sets exactly the four bits
   lego-47's `modeFromVga` keys off — misc!=0, GR6 bit0 (graphics), SR4 bit3
   (chain-4), AR10h bit6 (8-bit colour) — ~6 writes and one 3C0h flip-flop
   sequence, then paints A0000 linearly (offset = y*320+x, no interleave) with
   200 colour bands. No DAC writes: an all-zero DAC makes the renderer use the
   real VGA power-on palette — correct colour for free. No CRTC: 320x200 is a
   constant in the renderer's mode table, not derived from R0-R18.
   test/i8086-vga-demo.test.mjs asserts the discriminator + the linear buffer.
   **PIXEL-VERIFIED (2026-09-04): lego-47 ran the ROM through video() — 320x200,
   row 6 = 170,85,0 (the IBM brown fix, which can only come from the renderer's
   default table since the firmware programs no DAC — so the no-DAC choice held
   end to end), 198 distinct row colours (200 bands, two genuine palette dupes:
   entry 16 restarts the gray ramp at black/white). CLOSED.** Note: the ROM
   spins rather than HLTs (correct for a demo that stays on screen).
4. **Hercules graphics — STATE DONE (`830af06`); decode landing, then loader
   entry (this lane) — 2026-09-04.** HERCDEMO8086 (HGC + the B000:0000 mono
   page) + rom/hercules-demo.bin (720x348 mono, 4-wide bars) + a state test
   pinning the FOUR-bank y-mod-4 layout. lego-47 has WRITTEN AND VERIFIED the
   renderer's four-bank decode ((1,1) lit proves bank 1 at +0x2000 and bit6->x=1;
   (0,4) proves the within-bank +90-byte stride) — landing with tests shortly,
   as pseudo-mode 0x100 (Hercules graphics has no INT 10h mode number; it is
   selected only by 3BFh/3B8h, which is why every HGC program is bare-metal).
   They also fixed a latent trap: modeFromHercules had returned 0x06, which is
   CGA 640x200 in the mode table — B8000h + two-bank parity — and would have
   drawn our B0000h/four-bank framebuffer at the wrong address with the wrong
   arithmetic: a coherent, plausible, entirely wrong picture.
   **CLOSED (2026-09-04, renders).** Decode pushed (feat/i8086-tier `0c08cf1`,
   pseudo-mode 0x100, 7 tests incl. the bottom scanline pinning bank size AND
   stride together); loader entry wired (bw-circuit-ui `5359b85`). lego-47 ran
   rom/hercules-demo.bin through the decode — my state test and their pixels met
   with nothing to reconcile. GRAPHICS ONLY: MDA text (80x25 at B0000h, non-CGA
   attributes) is still refused by name, so the firmware must not write text.
   Two fallback facts to know: an UNPROGRAMMED HGC card renders a plausible grey
   720x400 (the renderer falls back to 80x25 text at B8000h, which a Hercules-
   only machine does not map — open-bus reads), so the ROM must reach its
   3BFh/3B8h writes before the first frame (ours does, immediately).
5. **EGA — CLOSED (2026-09-04, renders).** Decode landed (feat/i8086-tier
   `381fc5b`); loader entry wired (bw-circuit-ui `0b1216b`). lego-47 verified
   rom/ega-demo.bin's ramp composes to 15,13,11,9,7,5,3,1 — plane order and bit
   order both right; mode 0Dh WITHOUT planes throws rather than drawing zeros
   (a black frame is indistinguishable from a program that drew nothing). The
   hardest of the set, and the whole display family (CGA text/graphics, VGA,
   Hercules, EGA) now renders. Details below.
   The hardest: a PLANAR
   framebuffer, not linear RAM. `src/ega-card.js` models the register banks
   (no DAC — EGA colour is the attribute palette) plus four bit planes, with
   map-mask write routing (SR2) and read-map-select (GR4). The machine gives an
   `ega` chip its 3C0-3DF register window AND a second mem-bus window at A0000
   forwarding to memRead/memWrite (the dmapage two-window pattern), so A0000 is
   NOT plain RAM — a write is routed by the map mask into the selected planes.
   EGADEMO8086 + rom/ega-demo.bin fill the four planes FF/AA/CC/F0 through the
   map mask; test/i8086-ega-demo.test.mjs pins the planar discriminator, the
   plane routing, the composed pixels, and that a map-mask-0 write reaches no
   plane. **DECODE CONTRACT for the DOS/host lane** (their half, not written
   yet): identify by graphics + NOT chain-4 (SR4 bit3 clear) + NOT 8-bit (AR10h
   bit6 clear); read `getVideoState().planes[0..3]` (each Uint8Array, plane p);
   for mode 0Dh (320x200x16) pixel (x,y) colour = for p in 0..3, bit (7 - x%8)
   of `planes[p][y*40 + (x>>3)]` as colour bit p; map that 4-bit colour through
   `getVideoState().attr[colour]` (6-bit RGBrgb). UI loader entry HELD until
   that decode lands — same discipline as Hercules. NOT gated on a lesson any
   more: the owner asked for the full set, so the card is built and waiting.

Each step ships a LOADER ENTRY only once its renderer decode is confirmed,
because a board that renders a cleared screen (or a refusal string) is not an
example. Firmware + card-state tests can land earlier — they verify this lane's
half of the seam and are ready to wire the moment the renderer catches up.

CONVENTION — the display demos SPIN after painting (they want to stay on
screen), so `cpu.halted` never becomes true for them; only the timer demo HLTs,
because it wants to be woken by the tick. A harness that waits for HLT will read
a display demo as a hang — step a fixed count instead. (This is why every
display-demo test steps a bounded number of instructions rather than looping
until halt.)

---

## Sequencing

1. **E0** (all) — days; removes shipped wrong answers.
2. **E1.1 → E1.2 → E1.3/E1.4** — the numerics core, in that order (adaptive stepping
   and Shockley both want the cheap re-solve).
3. **E2.1** AC analysis — the visible leap; then E2.2/E2.3 cheaply.
4. **E3.1** op-amp macromodel (pairs with E2.1), then E3.4 transformer, E3.5
   controlled sources (unblocks the SPICE importer), E3.2/E3.3/E3.6 as lessons demand.
5. **E4** when the retro/TTL tier needs real timing.
6. **E6.2 → E6.3** — the 8086 breadboard machine, then its interrupts. E6.4/E6.5
   are independent of both and gated on assembler scope, not on engine work; E6.6
   waits for a lesson that needs it.
7. **E6.8** — the comparative gap list (surveyed against emu86, PCjs and XTCE-Blue).
   Its own order is inside the section. Its original prerequisite — the vector
   suite running in CI — was ALREADY MET when the section was drafted (sim3's R1
   and G1), and E6.8.6 was already done; both corrections are recorded in place
   rather than quietly edited out. Remaining order: E6.8.2 → .3 → .1 → .5 → .4 → .8.
   E6.8.4 (cycle-level execution) is owner-requested and lands last of the eight.

Cross-repo dependencies: bw-circuit-ui X1.1 (SPICE import) wants E3.5; X2.x runners
want E1.5; the AC UI wants E2.1. brickwright-lite re-vendors via `sync:bwboard` after
each landing.
