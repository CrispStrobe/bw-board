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

### E6.6 Tier C — PC/XT compatible (the expensive one)
8237 DMA, 6845/CGA (mc6845.js already exists), µPD765 FDC and disk images,
plus a BIOS and a DOS. Months, and a different product from "learn the 8086
on a breadboard" — it should be started only when tiers A and B are shipped
and a lesson actually needs it.

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
| jasaldivara/retro-dos-graphics | MIT | Shippable WITH ATTRIBUTION. 180 KB NASM across 28 files — CGA, joystick I/O, PC speaker, scrolling. Richest single corpus for Tier C peripheral testing. |
| FaizanAli7005/typing-balloon-game-asm | MIT | Shippable WITH ATTRIBUTION. 41 KB NASM, broad BIOS interrupt coverage (timer, keyboard, video, speaker). |
| milyas-io/Assembly-Breakout-Game | MIT | Shippable WITH ATTRIBUTION. 20 KB MASM/TASM, mode 13h graphics, collision, speaker. |
| Fahad1110136/Maze_Runner_Go | MIT | Shippable WITH ATTRIBUTION. Custom ISRs for INT 08h/09h, direct B800h video, timer chaining. |
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
| hotkeysoft/emulators — `8086/Hardware/Device8254`, `Device8259`, `Device8250` | MIT | Additional MIT PIT/PIC cross-check (C++). Has an 8250 UART, no 8251. |
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

---

## E7 The 8086 in the Circuit Designer — an example that is a MACHINE, not a demo

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
- EXTRACTOR IRQ GAP (this lane, new sub-task). `extract8086Machine` emits chips
  without `irq`, so a drawn PIT+PIC has no OUT0->IR0 and the BIOS's 18.2 Hz
  tick never fires. Fix: trace the PIT-OUT0 net to a PIC IR pin and emit
  `irq:n` (the honest fix, with a named refusal when miswired), rather than
  canning the wiring into the preset.

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

Cross-repo dependencies: bw-circuit-ui X1.1 (SPICE import) wants E3.5; X2.x runners
want E1.5; the AC UI wants E2.1. brickwright-lite re-vendors via `sync:bwboard` after
each landing.
