# bw-board ROADMAP — completed & closed work (history)

Shipped milestones, closed/declined decisions, and reference surveys, moved out of
ROADMAP.md so the roadmap holds only scoped OPEN tasks. Detail preserved as the record.

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


### E3.2 BJT: Early effect + reverse-active — `src/mna.js` — DONE (both halves)
Reverse-active landed first, as full Ebers-Moll with a reverse beta in
`ebersMollCompanion` — so this item's original problem statement ("currently B-E
diode + gm VCCS, no Early, no reverse") stopped describing the tree before the Early
half was written. The Early effect landed second: one factor `(1 - Vbc/VAF)` on the
transport current, Ib untouched, `VAF` absent meaning INFINITE so a card that does
not declare it is bit-identical to the tree before it existed. Both crossings moved
with it — bw-circuit-ui's importer carries VAF onto the part and its exporter states
`Vaf=` in the deck, because a parameter the engine reads and the deck omits is the
authored-beta defect again.

Measured rather than asserted: 700 ADI2005 v2 decks declare VAF on a BJT and all 700
now agree with ngspice; the "BJT Emitter Follower" family that motivated it went from
15.7 mV out to 0.245 mV, and a removal test proved VAF was the whole of that error
while IKF and RC were irrelevant to it. See `spec-updates/bjt-early-reverse.md`,
which also names what was deliberately left: VAR (no deck measured declares it) and
the IKF/IKR knee (worth 0.245 mV here). The roadmap's analytic oracle — a
common-emitter gain against gm·(RC ∥ ro) — is only now *possible*, since `ro` was
infinite before, and is the right next unit test.


### E3.4 Coupled inductors / transformer — DONE
New part kind `transformer` (or `k` coupling on two inductors): standard MNA
mutual-inductance companion stamps. Currently unrepresentable, and it blocks every
mains/isolation/boost lesson. File `spec-updates/coupled-inductors.md`. Oracle:
ideal 2:1 turns ratio voltage/current transfer within tolerance; energy conservation
check across a transient.


### E3.6 Behavioral honesty upgrades — DONE
- `optocoupler`: LED side gets a real junction (reuse diode stamp via `ctx`), output
  scaled by a CTR param (default 1.0) instead of on/off.
- `lm393`/`lm339`: optional hysteresis param (default 0 — datasheet-honest).
- `light_bulb`: PTC filament (R grows with dissipated power, one-pole thermal state in
  `update()`) — inrush becomes demonstrable.
Each with a hand-computed oracle in the same commit.

---


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


## Backends and licence policy (verified against primary sources, 2026-08-23; rows below the spice-ts one added 2026-09-12)

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
| eecircuit-engine (the optional `simulator: 'ngspice-wasm'` backend behind spice-ts) | ngspice WASM build | Same ruling as the ngspice WASM row: **NOT bundleable** (numparam). Do not pull it in transitively through spice-ts. |
| thevenin (Rust crate `cramt/thevenin`, v0.5.0 2026-07, created 2026-03) | BSD-3-Clause | Equations/structure reference and a **second oracle** beside ngspice: ngspice-dialect netlists, `.control` scripts, BSIM/VBIC/Gummel-Poon, wasm32 target. Too young to depend on; not an engine candidate (no MCU pin coupling, no device layer, no boundary contracts). |
| sindr (Rust crates `sindr` + `sindr-devices`, 0.1.0-alpha.6, created 2026-05) | MIT OR Apache-2.0 | Reference only. Alpha; backward-Euler transient; narrower than `mna.js` already is. |
| WRspice (wrcad/xictools) | Apache-2.0 | Oracle only. Desktop C++ suite aimed at superconducting design, no WASM route; adds nothing over ngspice as an oracle. |
| JoSIM | MIT | Not applicable: RCSJ Josephson-junction model, transient-only. |
| SpiceSharp (C#) | MIT | Equation/structure reference and oracle only; its BSIM add-on repo has NO licence file — do not touch that repo. |
| Berkeley BSIM | UC-permissive (BSD-like + "no charging for the UC code") | OK if ever needed; explicitly out of scope for E3. |
| Open-PDK model cards (sky130, gf180mcu, SG13G2) | Apache-2.0 | OK. |
| digitaljs + yosys2digitaljs (BSD-2), Yosys/YoWASP (ISC) | permissive | Available for a future HDL tier; not needed for E4. |
| GPL simulators/engines (any) | GPL | Oracle only, never in the dependency graph, never read for implementation. |

Every adapted-code landing updates `THIRD-PARTY.md` in the same commit.

Ruling, restated 2026-09-12 after the question "should the app use thevenin / sindr / spice-ts / WRspice / libngspice / JoSIM": **no**. The engine stays ours; every row above is an oracle or an equation source, never a dependency. What a lesson can't model goes through E3.x and a `spec-updates/` file, not through an engine swap.


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
| `dbalsom/arduino_8253` | **CONFLICTED — repo LICENSE says MIT; EVERY source file says GPL-3.0-or-later** (verified 2026-09-04, including `pit_emulator.h` itself; GitHub's own detector reports `NOASSERTION`) | **RULING REVERSED. Was "MIT — read + adapt with attribution", which was wrong and would have walked GPL-3 code into a BSD-3 bundle.** The more specific statement is the one attached to the code, so treat the emulator as GPL-3: ORACLE-ONLY, never adapted, never ported. **And it is not the oracle we thought.** It ships NO CAPTURED DATA — no traces, no fixtures, nothing diffable offline; the "corpus" is C++ that executes live against a real chip on the author's own bench and prints PASS/FAIL to a serial monitor. Its emulator does NOT implement the read-back command (a bare `// Do readback command` with no body), which is the one 8254-specific behaviour we would most want graded. It targets the **8253** (`PIT_8254 false`, `kModel8253`), and gate behaviour is wired to channel 2 only, so channels 0 and 1 were never checked against silicon. Getting a hardware-backed PIT oracle from this means BUILDING THE RIG. See E6.8.4e. |
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
| MAME (current upstream) — `src/devices/machine/{i8251,pit8253,pic8259}.cpp` | **BSD-3-Clause — CONFIRMED on the current revision 2026-09-04**: `i8251.cpp` opens `// license:BSD-3-Clause` / `// copyright-holders:smf, Robbbert` (MAME-the-project is GPL-2.0; these device files are individually BSD-3) | **PERMISSIVE — the spec-grade 8251 reference we were missing.** Readable and adaptable WITH the BSD-3 notice. Also permissive PIT/PIC cross-checks. Verify the header on the exact revision you read; the relicensing landed ~2015-16. |
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


#### E6.8.1 The 80186/80188 instruction set — DONE. `{variant:'80186'}`, graded 132,532/132,532 SingleStepTests v20 vectors; the shift-count masking and reg=6 aliasing the suite can't grade are pinned in `test/i8086-186.test.mjs` (byte + word forms, 2026-09-17)

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


#### E6.8.3 Breakpoints on I/O ports and on interrupt vectors — DONE (both halves). Debugger half landed: `i8086-debug.js` declares `breakpoints: ['code','write','port','int']`, `setBreakpoint({kind:'port'|'int'})` with dir/vector/source filtering + hook-chaining + `clearBreakpoint`; 9 tests in `test/i8086-event-breakpoints.test.mjs`. Machine half was 2026-09-04, `00ed9f9`

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

**RE-MEASURED THE SAME DAY, at `lego-47`'s challenge — the machine had grown
under the number this whole reframing rests on.** A DOS-layer timer tick,
`setInput`, `keyIn` and the CRTC all landed after the figures above, and
E6.8.4a's page table landed too. Five fresh runs:

```
workload     MIPS   × real XT   range        was
core         5.21      14.50×   11.6-15.2    8.70×
machine      1.59       4.40×    3.3- 5.5    2.90×
boot         0.60       1.50×    1.4- 2.1    1.00×
```

Everything looks faster and almost none of it is us. **`core` touches no
machine code at all, so it is a pure box-load proxy** — and it moved 1.67×,
which is the box getting quieter, not the emulator getting better.
Normalised against it:

```
machine/core   0.333 -> 0.303 -> 0.284    still falling
boot/core      0.115 -> 0.103 -> 0.176    recovered, and then some
```

**A third measurement point (2026-09-04, after `setInput`, `outputPoints` and
the pin lowering) splits what looked like one trend into two.** The machine
layer keeps ratcheting down relative to the CPU it wraps — 0.333, 0.303,
0.284 — which is E6.8.4a's standing concern behaving exactly as predicted.
But `boot/core` went the other way and is now better than it has ever been.
Something in the boot path got substantially faster while the general machine
path got slower, and the absolutes would have shown neither: on this run the
box was quiet enough that every raw figure rose. **The `vs core` column
earned itself on its first use.**

In real-time terms the boot workload is now **3.4x** rather than 1.0x, so a
cycle-stepped core at 5x costs lands at 0.68x — slow but arguably usable —
and at 20x lands at 0.17x. The debugging-mode framing still holds; the margin
is less stark than when it was chosen.

**So relative to the CPU, the machine layer got about 10% WORSE, not better —
even with the page table in.** The new per-step work (timer tick, input
polling, CRTC) ate the 1.65× that E6.8.4a bought on `_read` and a little more
besides. That is not an argument against the page table; it is the clearest
possible argument FOR E6.8.4a as a standing concern rather than a one-off
task, because the machine layer grows every time somebody adds a device and
nobody is watching the total.

**The reframing survives, on the new numbers.** A real DOS boot at 1.5× real
time still leaves a 5× cycle-stepped core at 0.3×, and a 20× one at 0.075×.
Cycle accuracy is still a debugging mode rather than a running mode, and the
conclusion does not depend on which day the box was quiet.

Owed and not done: the same three numbers from the browser bundle. §5 of the
core plan warns the Node figure does not transfer, and every number here is
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


#### E6.8.4b The prefetch-queue shortcut does not exist — a negative result, measured (2026-09-04)

I proposed a smaller first step towards E6.8.4: model the prefetch QUEUE
alone, without a BIU, and grade it against the `queue` field the 8086 vectors
already carry — no new clone, an instrument already in CI, and a behaviour a
program can SEE (self-modifying code executing the stale byte). `lego-47`
endorsed it partly on that basis. **It was wrong, and it is wrong in both of
the two ways it could have been right.**

**1. `final.queue` is not deterministic without cycle modelling.** Grouping 60
sampled opcode files by initial queue length, only 16 had a single possible
final length. Controlling properly — for initial queue length, instruction
byte count, AND whether control flow branched — brings it to 28 of 60. The
remaining 32 are genuinely cycle-dependent: `xor bp, bx`, from *identical*
controlled conditions, produces final queue lengths of **1, 3 and 5**. That is
bus timing, and nothing an instruction-stepped core knows can predict it.

**2. `initial.queue` never disagrees with memory, so it cannot grade a
stale-byte model either.** Checked across 12,000 vectors from 40 opcode files:
**zero** cases where the queue holds a byte different from the memory at
CS:IP. The suite contains no self-modifying-code captures, so the queue field
is redundant with memory — a core that fetches straight from RAM, as ours
does, already reproduces it, and grading against it would grade nothing.

**So the shortcut is not a smaller version of E6.8.4; it is the same job.** A
prefetch queue whose only justification is a behaviour we cannot grade fails
this tier's standing rule — no grinder, no landing — and it would land as a
claim rather than a measurement.

**This strengthens rather than weakens the original constraint.** E6.8.4 has
always said it lands only when `SingleStepTests/8088`'s bus traces can grade
it. That was right, and the fifteen minutes spent testing the shortcut cost
much less than the day spent building it would have. **The finding is that
the 8088 suite is not a preference, it is the prerequisite** — its bus traces
are the only thing that can adjudicate the 32-of-60 cases above.

Recorded rather than quietly dropped because the idea is attractive enough
that someone will have it again.


#### E6.8.4c The oracle is in and the baseline is measured (2026-09-04, owner-chose (a))

The owner overruled `lego-47`'s recommendation to leave cycle work alone, on
the grounds that **(a) is the only route ending in a graded model, and this
tier's whole standing is that it does not ship ungraded claims.** So the
constraint stands unrelaxed: *no grinder, no landing*, and the grinder came
first.

**The oracle.** `SingleStepTests/8088` (MIT), 2.0 GB whole, taken with the
same blobless-sparse idiom `ci.yml` already uses. Its **v2** format carries,
per CPU cycle: the ALE pin, the address latch, segment status, the i8288's
memory and I/O status lines, the data bus, the bus m-cycle type, the T-state,
and — the field that makes a BIU gradeable at all — the **queue operation**,
F (first byte of an instruction or prefix), S (subsequent), E (flushed), with
the byte read out. That is ground truth for exactly the 32-of-60 cases
E6.8.4b showed nothing else can adjudicate.

**`scripts/grind-i8088-cycles.mjs` scores four things, not one**, so progress
is measurable per session the way `grind-i8086.mjs`'s was: `count`, `bus`,
`queue`, `tstate`. Only `count` is implemented; the other three print NOT-YET
rather than being omitted, because an absent score reads like a passing one.

**A METHODOLOGY TRAP, FALLEN INTO AND FIXED BEFORE IT BECAME A NUMBER.** The
first version measured an instruction as "first `F` to end of trace" when no
second `F` appeared. That is a LOWER BOUND dressed as a measurement — the
README is explicit that an instruction ends when the *next* one's first byte
leaves the queue, and "there is no indication from the CPU when an instruction
ends, only when a new one begins." It is not a rare case: **half the traces
have no second F, and for `inc ax` it is all ten thousand.** The first
baseline read 10.6% exact and was mostly grading truncation; `40` scored 0.0%
for that reason and not for any reason about the core. Those vectors are now
excluded and COUNTED.

**THE MEASUREMENT WAS WRONG THREE TIMES BEFORE IT WAS RIGHT, and each wrong
version produced a full baseline.** `lego-47` is why it was caught: *"before
you conclude anything about the model, calibrate the MEASUREMENT against
instructions whose timing is documented and uncontroversial. All-positive with
a tight median is exactly the signature of a definitional offset rather than a
modelling error."* It was.

1. *First F to end of trace* — a lower bound dressed as a measurement. Half
   the traces have no second F; for `inc ax` it is all ten thousand. Reported
   10.6% exact while mostly grading truncation.
2. *First F to second F* — wrong because the README's sentence continues: a
   First Byte *"may be an optional instruction PREFIX, in which case there
   will be multiple First Byte statuses"*. On `cs nop` the two F markers are
   the prefix and the opcode, **two cycles apart, both the same instruction**.
   The tell was a span distribution of exactly `{2, 4}` on `nop`.
3. *Byte-counted* — made every vector ungradeable, and that WAS the answer:
   the traces do not contain the next instruction at all. **The suite has
   already bounded each trace, so the count is simply `cycles.length`.**

Checked against documented timings rather than assumed a fourth time: `inc ax`
(2 clocks) measures 2, `nop` (3) measures 3, one prefix adds 2.

**AND THE COUNT IS BIMODAL, WHICH IS THE WHOLE ARGUMENT FOR A BIU.** `inc ax`
is 2 **or** 4; `nop` is 3 or 4. An instruction that ended with the next byte
already queued takes the documented best case; one that had to fetch it takes
longer. **A fixed cycle table can only ever match the best-case half, by
construction** — and `nop` scores exactly 50.0%, which is that prediction
landing on the nose.

**THE BASELINE, and the first movement of it:**

```
                    baseline    after the INC/DEC fix
exact                 20.8%          37.5%
within +/-1           62.4%          45.7%
within +/-4           74.1%          74.1%
error median            -1             -3     range -15 .. -1
```

We UNDERCOUNT, which is what was predicted all along once the measurement was
right: an 8088's eight-bit bus adds cycles we do not model.

**The instrument found a real defect on its first correct run.** `INC r16` and
`DEC r16` returned 3 clocks; Intel's table gives 2 for the 16-bit REGISTER
form and 3 for the 8-bit one, and the suite's `40` file is 5,000 traces of
exactly 2 and 5,000 of exactly 4. We matched neither and scored 0 of 10,000.
Fixed, and that file now scores exactly 50.0% — the best-case half, like
`nop`. 646,000/646,000 unaffected: the 8086 grinder does not compare cycles,
which is precisely why this one had to exist.


#### E6.8.4d Three of four scores, and where the fourth stops (2026-09-04)

`src/i8088-biu.js` — the BIU as a SCHEDULER rather than a second CPU. The core
stays instruction-stepped and records what it asked the bus for; this turns
that ORDER into TIME. Cycle mode therefore never forks the instruction path.

```
bus sequence   152,000/152,000   100.0%   data accesses in order
queue ops      152,000/152,000   100.0%   F, S and E, 55,015 with a flush
cycle count     55,455/152,000    36.5%   was 17.2% from the raw table
T-state align                     NOT YET
```

Sixteen opcode files: read-modify-write, `xchg` with memory, `pop` to memory,
`movsw`, `mul`, indirect `call`, `ret`, `INT`, conditional and unconditional
branches, port I/O. 646,000/646,000 unchanged throughout.

**THE MODEL WAS MEASURED, NOT DERIVED.** Fitting the residual against queue
depth, instruction length and access count on 4,000 vectors of
`add r/m16, r16`:

```
queue 4, no data      residual 0        the EU table is exactly right
queue 0, len 2        residual 5        = max(EU, 8) - EU
queue 0, len 3        residual 7        = max(EU, 12) - EU
queue 4, 4 accesses   residual 8 or 9   not overlapped AT ALL
```

**Fetches overlap with execution; data accesses do not.** That asymmetry is
the finding, and the reason is that Intel's published timings already assume
the 8086's SIXTEEN-bit bus — on an 8088 every word costs an extra bus cycle
the EU sits through, because it is waiting for the datum it asked for.

```
cycles = max(euCycles, fetchBytes * 4) + dataAccesses * 2
```

**THE "BIMODALITY" WAS NOT BIMODAL, AND I WAS WRONG ABOUT WHY.** This entry
first concluded that the 8-or-9 residual needed queue occupancy over time,
because no function of (queue depth, length, access count) separated the two.
Holding those three fixed and varying only the EU time shows it is EXACTLY
determined:

```
eu 23 -> +9   eu 25 -> +9   eu 26 -> +8   eu 27 -> +9   eu 28 -> +8
totals   32          34          34          36          36
```

**Every total is even.** The odd sums round up; the even ones do not move. It
was a parity effect — the CPU landing on a bus-cycle boundary rather than
between one — and the variable I had not held fixed was the one that mattered.
Applying it unconditionally *dropped* the score to 26.1%, because a
register-only instruction keeps its odd length: there is no transfer for it to
synchronise to.

Three refinements, each measured against the last rather than argued:

```
max(eu, fetches*4)                                   31.2%
   + data accesses ADD rather than overlap           34.5%
   + parity, gated on there being a transfer         34.3%
   + one bus cycle when the queue could not refill   35.9%
   + bus-as-bottleneck instead of a flat penalty     36.5%
```

**WHAT IS STILL OPEN, measured down to the cycle rather than guessed at.**
Grouping every vector of `add r/m16, r16` by (queue depth, length, data
accesses, EU time), **38 of 40 groups are fully determined** — one total
cycle count each. So the model's inputs are almost sufficient and the gap is
in the formula, not in missing state.

The largest failing group is `q 0, len 5, 4 accesses`, which is **44 cycles
regardless of EU time** (24, 27, 29 and 30 all give 44): the bus binds, not
the EU. Counting its trace directly:

```
CODE 6   MEMR 2   MEMW 2   = 10 bus m-cycles = 40 cycles, and 44 total
```

**Six CODE cycles for a five-byte instruction.** The sixth is the refill the
model already knows about — but it belongs INSIDE the bus-cycle count rather
than being added after it, which is why the arithmetic came out four short.
The last four cycles are idle T-states the model does not represent at all.

**BOTH WERE TRIED AND ONE MADE IT WORSE.** Moving the refill INSIDE the
bus-cycle count — which the m-cycle count says is where it belongs — dropped
the score from 36.5% to **31.9%**, because it is right for the five-byte case
and wrong for the three-byte one. Reverted. The post-hoc form stays until
something explains both.

The idle cycles were then measured rather than guessed. Tabulating
(m-cycles, Ti, total) by queue depth and length:

```
(q 0, len 5)   m=10  Ti=2  total=44     4*m = 40, slack 4
(q 0, len 3)   m= 9  Ti=2  total=40     slack 4
(q 4, len 2)   m= 1  Ti=2  total= 3     slack -1
(q 4, len 3)   m= 7  Ti=7  total=34     slack 6
```

**`total` is not `4 × m-cycles + Ti`** — (q 0, len 5) gives 40 + 2 = 42
against an actual 44 — so there are T-states the m-cycle count does not
explain, most likely wait states inside a transfer. **The slack is not
constant and not a function of the four variables already in the model**,
which is the first residual in this entry that has genuinely resisted being
held fixed.

So this is where the transaction-level model stops, and the stopping point is
now evidenced rather than asserted: **36.5% exact, with the remaining error
concentrated in T-states that are not visible in the m-cycle count at all.**
Anything further needs the trace's own T-state column, which is to say a
cycle-by-cycle simulation. That conclusion has been premature twice in this
entry; it is offered a third time with the table above as the reason rather
than an inability to find one.

**What this bought that is not a fidelity claim:** the `INT n` ordering defect
(E6.8.4c) and the `INC/DEC r16` timing error, neither of which the
646,000-vector suite can see, because it compares final state and both are
invisible there.


#### E6.8.4e The ceiling of the closed-form model is 83.4%, and 95% needs the simulator (measured 2026-09-04)

The owner asked why the cycle score stalls at 36.5% and whether it can reach
95%. Both halves now have a number instead of an opinion.

**Group every vector by the five things the model actually knows** — queue
depth, instruction length, data-access count, EU cycles, and whether the
instruction flushed — across 24,000 vectors and sixteen opcode files:

```
451 groups        383 fully determined (one cycle count each)     84.9%
                  20,020 of 24,000 vectors sit in those groups    83.4%
```

**So 83.4% is the INFORMATION CEILING of any closed-form model over those five
inputs**, and the current 36.5% is roughly 47 points below its own ceiling.
That gap is a formula problem and needs no new state — which is a much better
position than "needs a simulator", and it is the first time this entry has
been able to say which of the two it is.

Adding the OPCODE to the key raises determinism only to 90.4%, and that route
is declined: a per-opcode table is a lookup rather than a model, it would
score well on the sixteen files it was fitted to and say nothing about the
three hundred it was not, and this tier's whole argument is that its numbers
generalise.

**Above 83.4% the five inputs are provably insufficient** — two vectors with
identical (q, len, data, eu, flush) genuinely take different numbers of
cycles, because the difference is where the BIU happened to fit a prefetch.
That is the cycle-by-cycle simulation, and it is now a measured requirement
rather than a third assertion.

**Route to >95%, in order:** close the 47 points to the ceiling with a better
closed form (no new machinery), then build the cycle-stepped BIU for the rest.
`dbalsom/martypc` (MIT) is the reference implementation to read for the second
half — its author wrote the very suite being graded against, and it is the
only permissive cycle-accurate 8088 in existence.


#### E6.8.4l The BIU is not blocked — it is UNWANTED, on the record (2026-09-05)

The BIU has been "the next step" in two roadmaps. E6.8.4j established that it
does not lift the q=1,2,3 ceiling (the oracle samples only q=0 and q=4, so no
amount of machinery invents the intermediate depths). What was still missing
was a reason to build it anyway — a consumer needing intermediate queue depths.

**Asked, and answered: there is none.** brickwright-lite (lego-ac), the only
downstream consumer of this table, on 2026-09-05:

> No use in lite needs q=1,2,3. The matrix's 8086 cells are sim-only and their
> tier rests on the corpus oracles and now ELKS; the cycle table at q=0 and
> q=4 with 98.0 percent held-out is already more than the Code tab exposes to
> a learner. Do not start the BIU work for our sake.

So the position is not "hard, deferred" but **"no demand, not started"** — a
different claim, and a stronger reason to leave it alone. 98.0% held-out with
queue / 50.0% without is where this stops until someone names a use. If it is
ever started it must be for bw-board's own reasons, stated at the time; lego-ac
asked to be told if that happens, because lite's tier note would then follow.


#### E6.8.4f What a correct cycle model needs, read off MartyPC (2026-09-04)

> **READ E6.8.4j BEFORE STARTING ANY OF THIS.** The five-state BIU machine
> described below has been the assumed next step in two roadmaps, including
> this one, and **it does not lift the ceiling that currently limits cycle
> accuracy.** It replaces the queue *recurrence* by computing the queue
> directly — but the cycle tables contain no entries at queue depths 1, 2 or 3
> (the oracle samples only 0 and 4), so the lookup misses exactly as often
> afterwards. Building it first buys nothing measurable. The unblock is an
> oracle that samples intermediate queue depths; see E6.8.4j.
>
> This entry remains correct about WHAT a cycle-exact model needs. It is wrong
> only about the order, and that is the expensive half.


`dbalsom/martypc` is MIT and our licence table already clears it as *readable
as a reference implementation, not vendored*. Read for STRUCTURE — what state
the hardware requires — rather than transcribed. Its author also wrote the
8088 suite being graded against, which makes it the closest thing to a
specification that exists.

**IT CONFIRMS E6.8.4e STRUCTURALLY.** Its prefetch decision is taken *per
T-state* and turns on whether the EU has claimed the bus **at that moment**
(`bus_pending != EuEarly`). That is exactly the occupancy-over-time an access
trace cannot carry, so the 83.4% ceiling is not a limitation of our fitting —
it is the information boundary of the input, confirmed from the reference.

**THE MECHANISM I WAS MISSING: QUEUE POLICY LENGTH.** The BIU does not simply
fetch whenever there is room. It *delays* a fetch by three cycles when the
queue is at a "policy length" during a code fetch. On an 8088 — one-byte
fetches, four-byte queue — that length is `size - 1`, i.e. **3 bytes**.

That is the bimodality. Whether a given instruction ended up one cycle longer
depends on whether the queue happened to sit at 3 when the BIU looked, and no
function of (queue-at-start, length, data count, EU cycles) can recover it
because the queue depth *changes during the instruction*.

**The state a correct model needs, in full:**

| State | What it carries |
|---|---|
| queue length, per T-state | the policy-length test |
| fetch state | Idle / **Delayed(n)** / PausedFull / Suspended / Halted |
| address-cycle sub-state | Ta / Tr / Td — a fetch can only *begin* at Td |
| bus pending | whether the EU has claimed the bus this m-cycle |
| bus status latch | whether the current transfer is a code fetch |

Five pieces of state and one delay rule. **That is a specification, not a
research problem**, and it is a much smaller thing than "write a
cycle-accurate CPU" — the EU timing we already have, graded at 646,000
vectors; only the bus scheduler is missing.

**AND THE FIVE STATES ARE NECESSARY BUT NOT SUFFICIENT — corrected before it
became a plan.** The paragraph here first said "nothing about this needs
microcode-level emulation". Checking rather than asserting: MartyPC advances
time with `cycles_i(cycles, instr)` — a MICROCODE INSTRUCTION LIST — and its
BIU comments describe SUSP and FLUSH as *microcode routines*. Its EU yields
the bus at microcode-defined points, which is how the scheduler knows WHEN the
EU claims it.

Ours does not have that. **Our EU timing is a single integer per instruction**
(`return 25;`), graded at 646,000 vectors for its total but carrying no
schedule of when within those 25 cycles each access is issued. The measured
consequence is visible directly: the CODE-fetch count is NOT determined by
(queue, length, data) — `q 4, len 2, no data` yields **1, 2 or 3** code
fetches for identical inputs — because how many prefetches fit depends on
where the EU's own bus claims fall.

So the honest decomposition of the owner's ">95%" is:

```
36.5% -> 83.4%   a better closed form            no new machinery
83.4% -> >95%    BIU state machine (5 states)
                 PLUS per-opcode EU micro-timing  <- the real cost
```

The second line is not "write a bus scheduler". It is "give every opcode a
cycle SCHEDULE rather than a cycle COUNT", which is the microcode-level work
this entry has twice said was not needed. It is a real and legitimate project;
it is not a refinement of what exists, and saying so now is cheaper than
discovering it three days in.


#### E6.8.4g The schedule is DERIVABLE from the oracle — 95.5% measured, and the ">95%" is reached (2026-09-04)

E6.8.4f closed by saying the last leg needs "per-opcode EU micro-timing", and
called that the real cost. **That was right about the requirement and wrong
about the price.** The schedules do not have to be authored from microcode
listings — they can be *read off the oracle*, because they are far more
regular than the raw cycle totals suggest.

`scripts/pilot-i8088-schedule.mjs`. Every instruction that touches memory or
I/O decomposes into three parts:

```
total = anchor + span + tail
```

| Part | What it is | How it behaves |
|---|---|---|
| `anchor` | T-state at which the FIRST data access begins | queue **and addressing mode** |
| `span`   | offset of the last access relative to the first | per (opcode, mode) |
| `tail`   | T-states after the last access begins | **per-opcode CONSTANT** |

**`tail` is a constant, not a distribution.** Measured across all 10,000
vectors of every opcode where it is defined: `01`→3, `33`→7, `87`→3, `8F`→3,
`FF.2`→3. Not "usually 3". Every single vector.

**And the anchor is the documented EA table, not BIU noise.** Keying it on the
modrm `mod`/`rm` field alone moves anchor accuracy from ~55% to **100.0%** on
held-out vectors, for every modrm opcode tried:

```
        anchor key (q,len,n)   + modrm mod/rm
01               55.6%            100.0%
33               56.5%            100.0%
87               55.3%            100.0%
8F               49.9%            100.0%
FF.2             67.5%            100.0%
```

That is the 8086 effective-address table from the datasheet — disp-only 6,
base-or-index 5, base+index 7/8, +disp 9/11/12 — showing up in silicon
measurements. **Tier-1 evidence explaining a term I had been treating as
unpredictable scheduler behaviour.**

**Result, on held-out vectors (70/30 within each opcode):**

```
01    73.9%   40   100.0%   90   100.0%   C3   100.0%   EC   100.0%
33   100.0%   74    99.9%   A5    66.3%   CD   100.0%   F7.4  97.0%
87   100.0%   8F    73.3%   E9   100.0%   E6   100.0%   EB   100.0%
                                                        FF.2  93.7%
OVERALL  95.5%   (43,533 / 45,600)      <- from 36.5%
```

Three findings made the difference, in order of size:

1. **modrm in the anchor key** (the EA table). The single biggest term.
2. **Branch-taken as ONE BIT, not the flag word.** Keying on
   `flags & 0x8d5` scored *worse* than not keying on flags at all — it
   fragments the table until every key is unique. One bit (did control
   transfer — our core already tracks it as `_tookBranch`) took `74` to
   99.9% and `E9`/`EB` to 100%.
3. **Operand-dependent latency, declared per opcode.** `F7.4` (MUL) sat at
   17.4% because the datasheet states it as a *range* (118–133 clocks), so no
   per-opcode constant can fit it. The microcode loops over **AX**, adding on
   each 1 bit: keying on `popcount(ax)` took MUL to **97.0%**. Note it is
   popcount of `AX`, the implicit operand — popcount of the *source* operand
   scores 15.7%, i.e. nothing. Same family: `F7.5`, `F6.4`, `F6.5`.

**What still misses, and why — mechanism confirmed, not guessed.** `01`
(73.9%) and `8F` (73.3%) miss by exactly ±1 cycle. It is not address parity
(both spans occur equally at both parities). It is the prefetch:

```
01:  span=20  <->  2 code fetches, 0 idle
     span=19  <->  1 code fetch + 3 Ti,  or  0 fetches + 7 Ti
8F:  span=18  <->  1 code fetch + 2 Ti
     span=17  <->  0 fetches + 5 Ti
```

Whether the BIU squeezes one more prefetch into the EU's gap — E6.8.4f's
policy-length rule, exactly. That residual **is** the BIU state machine, and
it is now quantified at ~4.5% rather than assumed.

**THE HONEST CAVEAT, because this number is easy to over-read.** 95.5% is
held-out *vectors*, with per-opcode calibration. Leave-one-out on *opcodes*
scores **34.2%** — and that is the finding, not a failure. The per-opcode EU
prologue cannot be inferred from other opcodes: `C3`, `CD`, `E6`, `EC` each
score 100% calibrated and 0% held-out. **So E6.8.4f's conclusion survives —
per-opcode data is required — but the cost collapses**, because the data is
derived by script from vectors we can download, not authored by hand from
microcode listings.

**Revised decomposition of the owner's ">95%":**

```
36.5% -> 95.5%   derive schedules from the oracle    DONE, measured
95.5% -> ~100%   BIU state machine (E6.8.4f's five states)  the last 4.5%
```

**Licence: clear, and checked before relying on it.** `SingleStepTests/8088`
is **MIT** (verified 2026-09-04 by reading `HEAD:LICENSE` — the local sparse
clone had not fetched it, so its absence on disk meant nothing). Tables
derived from it may ship in a BSD-3 bundle **provided the MIT copyright
notice travels with them**. That is an attribution obligation on the derived
tables, not just on the checkout, and it must be honoured at the point the
tables land in `src/`.

**VALIDATED ON THE FULL SUITE — 95.6% over 323 opcodes (2026-09-04).** The
95.5% above was sixteen opcodes that happened to be on disk, which is a
selection nobody chose. Fetched the rest (302 files, **677 MB** — the
"~1.5 GB" estimate was high) and re-ran streaming, one opcode resident at a
time.

**First honest result: 92.8%**, not 95.5%. The sixteen were the easy ones, as
predicted before the run. Two mechanical fixes brought it back:

```
                                   before   after
D2.x / D3.x  shift/rotate by CL      ~3%    ~99.4%    (16 opcodes)
99           CWD                     49.3%  100.0%
                                   -------  -------
FULL SUITE                           92.8%   95.6%   (862,304 / 902,100)
```

**The shift fix is the interesting one, because the first attempt was the
wrong SHAPE, not the wrong feature.** Keying on CL categorically scores 57% —
better than 3%, so it looks like progress — because it fragments the table
across 64 CL values until each key holds a handful of vectors. The datasheet
gives shift-by-CL as `8+4n`, and measurement confirms it exactly (cl=0 → 8,
every +2 of CL adds +8). It needs a **linear correction**: subtract `4*CL`
before fitting, add it back when predicting. 3% → 99.4%.

**Two kinds of operand dependence, and conflating them costs 40 points:**

| Kind | Shape | Example |
|---|---|---|
| categorical | operand selects a different constant | MUL: `popcount(ax)` |
| **linear** | operand adds proportional cycles | **shift by CL: `4*CL`** |

The linear term also lands in **`span`**, not `tail`, for a read-modify-write
form — the shift loop runs *between* the read and the write.

**Per-opcode distribution over the full suite:**

```
exactly 100%   217        >=90%     3
      >=99%     50        >=75%    11
      >=95%      6         <75%    36
```

**267 of 323 opcodes are at or above 99%.**

**Where the remaining 36 sit, and they are two distinct problems:**

1. **Division is a genuine boundary, not a missing feature.** `F7.7`/`F6.7`
   (IDIV) 16%, `F7.6`/`F6.6` (DIV) 60–64%, `D4`/`D5` (AAM/AAD) 38–54%. Ten
   candidate features were searched — sign, bit-length, popcount, magnitude of
   `DX:AX`, quotient bit-length — and **none beats ~60%**. The 8086 divide
   microcode loops on the quotient as it is computed bit by bit; that is a
   simulation, not a closed form. Recorded as searched-and-refused so the next
   person does not repeat the search. IMUL is partly tractable
   (`popcount(|AX|)` plus sign: 9.8% → 47.5%) because the signed forms negate
   to magnitude and then run the unsigned loop.
2. **The 72–73% cluster is the BIU, and it is the SAME ~4.5% as before.**
   `00`, `08`, `10`, `21`, `28`, `8F`, `FF.3`, `FF.6` — all read-modify-write
   forms, all missing by exactly ±1, all the prefetch-in-the-gap question.
   String ops (`A4`–`A7`, `AE`, `AF`, 61–71%) are the same plus REP counts.

**So the target is met on the full instruction set, and the remaining work is
two named things rather than an open question:** the BIU state machine of
E6.8.4f (worth ~4%), and a divide microcode loop (worth ~1%).

**DONE (2026-09-04): `src/i8088-cycles.js`, 323 opcodes, 738 KB.**
`scripts/gen-i8088-cycle-tables.mjs` emits it; `scripts/check-i8088-cycles.mjs`
scores it back against the oracle; `test/i8088-cycles.test.mjs` checks what can
be checked WITHOUT the oracle.

```
IN-SAMPLE   95.82%   (2,881,204 / 3,007,000), 0 missing keys
HELD-OUT    95.6%    (pilot, 70/30 within each opcode)
```

The in-sample number validates that generation and lookup agree; it is **not**
evidence the model generalises, since the shipped table is fitted on those same
vectors. **The 0.2-point gap between the two is the interesting part**: 50,618
keys fitted on 3M vectors scoring the same held-out as in-sample is not
overfitting.

**Named `i8088`, deliberately breaking the tier's `i8086` convention** — the
vectors are from an AMD D8088 (8-bit bus, 4-byte queue), and the 8086's 16-bit
bus and 6-byte queue will differ with no oracle to say by how much.
`i8088-cycles.js` existing while `i8086-cycles.js` does not is a gap marker
readable at a glance.

**Three things this had to get right, none of them the table itself:**

1. **The absent-oracle path refuses rather than passes.** Both scripts exit 2
   with *"nothing was regenerated / nothing was checked — this is NOT a pass"*,
   kept distinct from exit 1 for real drift. A 677 MB dependency that quietly
   no-ops is the shape that turned bw-board master red today.
2. **A check that runs in CI at all.** The regeneration check cannot, so
   `test/i8088-cycles.test.mjs` asserts the hermetic properties instead: shape,
   every anchor key having the span/tail key that completes it (14k+
   cross-checks — a missing one mispredicts silently at run time rather than
   erroring), a real 40-character vector sha rather than `unknown`, and the MIT
   notice present and untruncated. It asserts nothing about accuracy, because
   accuracy needs the oracle.
3. **The MIT notice lives IN THE GENERATED FILE.** The obligation is on the
   artefact, not the checkout: a derived table shipped in a BSD-3 bundle with
   its notice left behind in a repo nobody distributes is how attribution gets
   lost.

**A size reduction is measured and available but NOT taken.** A factored
encoding — shared EA table + `base(q,len,n)` + an exception list — is **0.29x
the size with no accuracy loss** (463 stored entries against 1600, on 16
opcodes). The per-mode EA offsets are *identical* across `01`, `33` and `87`,
so the term genuinely is shared; factoring it *without* the exception list
costs 100.0% → 80.9%, which is why the naive version looks attractive and is
not. Shipping the simple full table first beats landing a cleverer encoding
before anything works, and the exception count doubles as a legible measure of
how much of the timing the structure explains (81.6%).


**And one process note worth keeping.** The full-suite run was nearly reported
as having produced nothing: the background task reported "completed" while
`node` was still running, because the completion signal belonged to the
wrapper shell that had exited after its `sleep`, not to the job. Same shape as
the licence trap in this entry and the sparse-checkout trap in E6.8.4e:
**a check reports on what it watched, never on what you meant it to watch.**



#### E6.8.4h The shipped format was the wrong one, and the queue loop closes (2026-09-05)

Two measurements, one uncomfortable and one that changes what is buildable.

**1. THE ANCHOR+SPAN+TAIL DECOMPOSITION OF E6.8.4g SHOULD NOT HAVE SHIPPED.**
Controlled comparison, identical data and identical 70/30 splits, 902,100
held-out vectors:

```
A) anchor + span + tail   (shipped)   95.59%   49,962 keys
B) direct total lookup                98.00%   38,136 keys
```

**Better and 24% smaller.** The reason is plain in hindsight: the decomposition
makes THREE modal estimates and needs all three correct; the direct form makes
one.

The decomposition was not wasted — it is what REVEALED the structure. The
per-opcode constant tail, the datasheet EA table turning up in silicon traces,
the categorical/linear distinction: all of that came from taking the timing
apart, and it is why the feature set is right. **But an analysis tool and a
shipped artefact are different jobs, and the first was mistakenly shipped as
the second.** Regenerated as `i8088-cycles/2`.

**2. THE QUEUE RECURRENCE IS GRADEABLE, WHICH I HAD WRITTEN OFF.** E6.8.4g
closed by noting the tables are keyed on prefetch queue length while our core
models no queue (`i8086.js` says so explicitly). Measured, that gap is not
marginal:

```
cycle table WITH queue      98.0%
cycle table WITHOUT queue   50.0%     <- supplying a constant
```

**48 points.** So the queue must be carried, and I had assumed carrying it was
unverifiable without a sequential oracle we do not have.

**Wrong: `final.queue` is recorded in every one of the 3,007,000 vectors.** The
recurrence STEP is therefore directly gradeable, and it is nearly free:

```
q,len,tot,flush             99.81%    <- next queue length
q,len,n,m,tot,flush         98.62%    <- MORE features, WORSE
naive q-len+floor(tot/4)    33.22%    <- the obvious closed form
```

So the loop closes: **predict cycles from the queue (98.00%), predict the next
queue from the cycles (99.81%), carry forward.** Both tables derive from the
oracle. Cycle-accurate timing is now reachable from inside a running machine
rather than only from the grading harness.

Two details worth keeping. The **naive arithmetic model scores 33%**, so this
had to be a table for the same reason the cycle model did. And the **richer key
scored worse** — the fragmentation trap that cost 40 points on shift-by-CL,
caught this time by measurement rather than by luck.

**DESYNCHRONISATION IS THE REAL HAZARD**, and `src/i8088-timing.js` handles it
explicitly. A missed prediction does not cost one instruction: the queue stops
being known, so every LATER prediction is computed from a wrong queue and is
**silently wrong rather than absent** — strictly worse than a miss. So
`CycleEstimator` marks itself desynced and returns `null` until it can recover,
and there is exactly one event after which the queue is known regardless of
history: **a taken branch flushes it.** Not a heuristic — it is what the
hardware does. The estimator also STARTS desynced rather than assuming an
initial queue, because guessing there would make every early prediction quietly
wrong.

**One test bound was wrong and the test caught its author.** The new structural
test first asserted cycle values `< 400` and failed on 1,979 entries — all
string opcodes, because the suite masks CX to 7 bits and a `REP CMPSW` at
CX=127 legitimately costs ~3,800 cycles. The bound was invented rather than
derived. It now asserts the STRUCTURE — only the ten REP-capable opcodes
(`A4`-`A7`, `AA`-`AF`) may exceed 400 — which still catches the generator bug a
merely wider bound would miss, and is verified by planting a 1,000-cycle value
on `NOP` and watching it go red.

**The generator-version drift check fired on its own author, as designed.**
`i8088-cycles/1` -> `/2` forced the regeneration rather than allowing a stale
table to sit beside an edited generator.


#### E6.8.4i Cycle-accurate timing is wired into the machine, opt-in, ~6x (2026-09-05)

`machine.enableI8088CycleTiming()`. Charges instructions from the measured
tables instead of the core's flat per-instruction estimate.

```
default          ~330 ns/step
cycle-accurate  ~1774 ns/step      5.3x quiet, 6.0-6.1x at load 19
coverage         100% on a branching loop   <- SEE E6.8.4j: this figure is
                                               a property of that workload,
                                               not of the tables. A real DOS
                                               boot gives 54.39%.
```

**IT STARTED AT 100x AND THE CAUSE WAS NOT WHERE IT LOOKED.** Profiling rather
than guessing:

```
TABLES[op] property access        33 ns
T.t[key] direct lookup            27 ns
predictCycles()                  557 ns
predictNextQueue()               234 ns
CycleEstimator.step()          8,016 ns   <- ten times its own contents
```

The estimator called `predictCycles(op, {...s, queue: this.queue})`. **An
options object spread per instruction, with a nested `regs` object and a shape
varying by call site, cost 8 microseconds against 0.8 for the two lookups it
was arranging.** Replacing the options object with primitive arguments took
100x to 16x; precomputing the 256 + 2048 opcode key strings (the old code ran
`toString(16).toUpperCase().padStart()` per instruction) took 16x to ~6x.

**THE FIRST INTEGRATION SCORED 0% COVERAGE AND RAISED NO ERROR**, which is the
finding worth keeping. The generator keys on `bytes[p+1]` -- the byte after
prefixes and opcode -- for EVERY opcode, so for `33 C0` it is a genuine modrm
and for `B8 00 00` it is half an immediate. The run-time lookup passed `null`
for every non-group opcode, missed on all of them, and fell back silently.
Everything "worked": no exception, plausible cycle counts, a green suite. Only
the coverage counter showed it. **A fallback path that is correct makes a total
failure of the primary path invisible** -- which is exactly why
`cycleTimingStats()` exists and why the tests assert coverage rather than
merely that a number came back.

**Three refusals, all deliberate:**

1. **The 80186 throws.** The tables are from an AMD D8088; the 186 changed
   instruction timings and the queue and has no oracle. A silent fallback
   would read as support for a variant never measured.
2. **A machine that never branches predicts NOTHING.** With no taken branch
   the queue is never known, so coverage is 0% and `desynced` stays true.
   Correct: a plausible number from an assumed queue would be worse than none.
3. **`cycleTimingStats()` returns `null` when disabled**, not a zeroed record
   that reads as "measured, and nothing happened".

**The 8086 caveat is not refused and must not be forgotten.** An 8086 has a
16-bit bus and a six-byte queue against the 8088's 8-bit bus and four-byte
queue. Enabling this on an 8086 config gives 8088 timings: closer than the flat
estimate, and not the same thing as correct. No 8086 oracle exists to say by
how much.


#### E6.8.4j The oracle samples only TWO queue states, and that caps the whole approach (2026-09-05)

**Correcting E6.8.4i, which reported "100% coverage" from a workload that could
not have shown otherwise.**

E6.8.4i measured coverage on a five-instruction loop and got 100%. On a **real
MS-DOS 2.0 boot** — 400,000 instructions, string moves, far calls, disk through
the service layer, a timer interrupt throughout — it is **54.39%**.

The toy loop sat at **queue = 0 for all 600 steps measured**. It never left the
single state it happened to start in, so its coverage figure was a property of
the workload rather than of the tables. *A score without its split is not a
claim*, applied to my own new feature and caught only because the real workload
was run.

**THE CAUSE IS IN THE ORACLE, NOT THE CODE, AND IT IS A HARD LIMIT.**

```
queue values the cycle table accepts as INPUT:   q=0 (19,340 keys)   q=4 (19,350 keys)
queue values the recurrence PRODUCES as OUTPUT:  0, 1, 2, 3
```

The SingleStepTests 8088 suite states it plainly: *"Half of provided
instructions will execute from a full instruction queue."* Half at empty, half
at full, and **nothing in between**. So the queue recurrence — 99.81% accurate
at predicting the next queue length — produces `1`, `2` and `3`, for which
**no cycle entry exists at all**. Most instructions output `q=3`, and the very
next lookup misses.

**So the two tables have inconsistent domains: the recurrence's outputs are not
valid inputs to the cycle table.** That is not a bug in either table. Each is
accurate over what was measured; the composition is what steps outside it.

**THE DESYNC CASCADE MULTIPLIES IT 265x:**

```
primary misses     685    <- the table genuinely had no entry
desync misses  181,739    <- consequence: the queue is unknown until the next taken branch
amplification    265.3x
```

**685 unmeasured instructions cost 181,739.** One miss makes the queue unknown,
and recovery needs a taken branch — on this workload, 265 instructions later on
average. The tables cover **99.83%** of instructions actually looked up; the
coverage number is almost entirely an amplification artefact, and reporting a
single `fellBack` total hid which of the two problems this was. `cycleTimingStats()`
now splits them.

**WHAT WOULD ACTUALLY RAISE IT, and what would not:**

- **A BIU state machine (E6.8.4f) would NOT be enough.** It computes the queue
  directly rather than by table, which removes the recurrence — but the cycle
  table still has no entries at `q=1,2,3`, so the lookup misses just the same.
  This is worth stating because the five-state model has been the assumed next
  step twice, and it does not clear this.
- **An oracle sampling intermediate queue states would — and READING martypc
  changed what that costs and who can do it (2026-09-05).** The earlier text
  here said extending it is "a real project rather than a refinement". Half
  right, and wrong about which half is hard.

  **The software change is small.** Sources read (MIT, reference only, not
  vendored):

  ```
  crates/bin/martypc_headless/src/cpu_test/gen_tests.rs         :393
  crates/lib/marty_core/src/arduino8088_validator/remote_cpu.rs :50, :1090
  ```

  The two-state limitation is *a boolean*: `let prefetch =
  config.tests.test_gen_prefetch;`, with the older per-test alternation still
  visible one line above as `//let prefetch = (test_num - 1) & 0x01 == 0;`.
  When set, the generator pads the instruction bytes with NOPs up to
  `cpu.get_type().queue_size()` and calls `set_queue_contents` — i.e. it
  targets **exactly full**, and the truncation logic for shorter targets is
  already in the same block.

  Priming is **already data-driven**, not hard-coded logic:
  `prefetch_pgm_bytes(cpu_type)` returns a `&'static [u8]`, and for Intel it is
  `[0xAA, 0xAA, 0xAA, 0xAA]` — four `STOSB`, one-byte instructions slow enough
  that the BIU fills the queue while they run. Selecting that array by *target
  depth* instead of by CPU type is a signature change plus three new byte
  sequences.

  **THE BLOCKER IS HARDWARE, NOT CODE, AND THAT IS THE FINDING.** The generator
  drives a REAL 8088 through the Arduino8088 rig over a serial port —
  `ArduinoValidator::new(cpu_type, trace, port: Option<String>, baud)`. Vector
  generation is hardware-in-the-loop; it is not a simulation that can be
  re-run with different settings on this box. **No rig, no vectors, however
  small the diff.**

  So the honest options are: **ask upstream to generate a queue-depth-swept
  suite** (the change is small enough to be a reasonable request, and the
  commented-out alternation shows the author has already thought in these
  terms), or **build the rig**, or **accept the ceiling**. What is NOT
  available is "we extend martypc ourselves", which is what the previous
  wording implied.
- **Snapping `q=1,2,3` to the nearest measured state would not be an answer.**
  It converts an absent measurement into a plausible number, which is the exact
  thing the null contract exists to prevent. Refused.

**Current behaviour is honest and stays:** an unmeasured state falls back to the
core's own cycle count, `cycleTimingStats()` reports true coverage split by
cause, and nothing guesses.

**UPDATED after the REP fix of E6.8.4k: coverage on a real boot is 82.34%**
(329,294 predicted, 70,647 fallen back), with the desync amplification halved
from 265x to 105x.

**That is NOT a controlled before/after, and saying so matters more than the
number.** The two runs do not execute the same instructions. Evidence from the
runs themselves: the same 400,000 steps charged **5,470,583** core cycles before
the fix and **3,840,132** after — *fewer* cycles from a change that makes string
operations cost *more*, which is only possible if fewer string operations ran.
The trace diverged.

**The plausible mechanism, stated as a hypothesis rather than a finding:**
correct cycle accounting paces the timer interrupt correctly, more interrupts
mean more control transfers, more transfers mean more queue flushes, and a
flush is the only event that resynchronises the estimator. If that is right,
**table coverage depends on interrupt cadence, which depended on the cycle
accounting being right** — a feedback loop between the thing being measured and
the measurement. It has not been isolated and should not be quoted as
established.


#### E6.8.4k REP string ops charged a FLAT cycle count for a loop of up to 127 (fixed 2026-09-05)

Found by asking whether the cycle tables are worth enabling at all — 54%
coverage only helps if those instructions were meaningfully mischarged. Grading
the CORE against silicon answered a different question than the one asked.

```
case 0xae: case 0xaf: this._repeat(() => this._scas(op & 1), true); return 15;
```

`_repeat` runs **every iteration** inside that one `step()` — `while (this.cx
!== 0)` — and the caller returned a constant. **`REP MOVSW` with CX=127
performed 127 copies and charged 18 cycles.**

**Graded over 386,200 vectors, before and after:**

```
                       before    after
core exactly right      19.35%   19.66%
mean |error|            19.43     8.02   cycles
mean signed error      -18.36    -6.95
core/real cycle ratio   0.5566   0.8322
```

**Ten opcodes, 4.3% of instructions, produced 69% of the core's total cycle
error.** The aggregate had looked like broad miscalibration; excluding those
ten gave 5.99 mean error and a 0.8276 ratio, and after the fix the whole core
sits at 0.8322 — i.e. **the entire gap between 0.5566 and the rest of the core
was this one bug wearing a global disguise.** Splitting the measurement was what
distinguished "the core is 1.8x too fast" from "the core has one defect in
string ops"; those have different fixes and the aggregate cannot tell them
apart.

**THE PER-ITERATION FIGURES ARE TIER 2a, NOT A DATASHEET TRANSCRIPTION.** They
were fitted from the 8088 vectors (`cycles = base + per * iterations`, two
widely separated points) and only then compared with the published timings:

```
measured on 8088   MOVSB 17  CMPSB 22  STOSB 10  LODSB 13  SCASB 15
8086 datasheet     MOVSB 17  CMPSB 22  STOSB 10  LODSB 13  SCASB 15
```

Every byte form agrees exactly. Every WORD form measured higher — MOVSW 25,
CMPSW 30, STOSW 14, LODSW 17, SCASW 19 — and each is its 8086 value **plus 4
cycles per extra bus cycle**: +8 where the instruction touches two memory
operands, +4 where one. That is the documented 8088 8-bit-bus penalty,
**reproduced from measurement rather than assumed.**

**So the core takes the 8086 column, and the residual error on WORD string ops
is evidence the fix is RIGHT rather than incomplete.** After the fix the worst
remaining opcodes are `A5`, `A7`, `AD`, `AB`, `AF` — every one a word form, off
by exactly the 8088 bus penalty. The five byte forms dropped out of the worst
twelve entirely. **If this 8086 core matched the 8088 oracle on word string
ops, that would mean it was wrong about being an 8086.**

The 186's `INS`/`OUTS` had the identical flat-count bug and are fixed the same
way, but with published 186 timings and NOT vector-graded — no 186 oracle
exists, and that is stated at the site rather than left to look measured.

**What remains is not this bug.** A 0.83 ratio means the core still undercharges
~17%, and that is the prefetch and bus reality an instruction-stepped core
cannot reproduce — precisely what E6.8.4g–j's tables address, and precisely why
they are worth having despite the 54% coverage ceiling of E6.8.4j.


#### E6.8.4a The machine layer costs more than the CPU — DONE 2026-09-17. Profiled (`--prof`): `_advanceChips`, run every instruction, was 30% of the machine workload — more than the CPU core — while the interrupt poll (the other flagged candidate) did not sample at all (its answer is the cached `_intActive` flag; a measured red herring). Fixed by DEADLINE-BATCHED chip advance (`_chipDebt`/`_chipDeadline`/`_flushChips`, reusing the `nextWake` horizon), correctness-equivalent (790/0 across the i8086+chip+checkpoint+video suites) and re-profiled to ~0; bench machine/core ratio 0.31→0.79. A follow-up CORE-DISPATCH experiment (function-pointer table vs the dense `switch`) was measured off-box on a fresh CI runner (interleaved, noise floor ±3.4%): table 0.6% SLOWER, inside the floor — no win, the switch stays. (Original text below.)

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


#### E6.8.8 A real OS as the acceptance target — ELKS BOOTS AND MOUNTS ITS ROOT (2026-09-05)

**ELKS v0.9.1 boots on this machine, probes the hardware, and mounts its root
filesystem.**

```
bw-board 8086 BIOS v0.1
640K OK
df: CMOS df0 is unknown (15)df0 is 360k/PC (1)
boot: BIOS drive 0, root device /dev/fd0 (0320)
PC/XT class cpu 2, syscaps 0, 640K base ram, 16 tasks, 64 files, 96 inodes
ELKS 0.9.1 (61520 text, 31856 ftext, 10240 data, 8112 bss, 47182 heap)
fd0: probed, probably has 80 cylinders, 2 heads, and 18 sectors
FAT: total 1440k, fat12 format
VFS: Mounted root device /dev/fd0 (0320) msdos filesystem.
Unable to open /dev/console (error -2)
panic: No init or sh found
```

It panics on a missing userland — `fd1440-fat.img` is a boot disk with no
`/bin/init` — and everything before that line is a real OS driving real
emulated hardware: our BIOS ROM, the uPD765 FDC, the 8237 DMA controller and
the 8259 all working together. Timings: banner at 1.31M instructions, root
mounted at 2.36M, panic at 2.62M, about eight seconds.

**THE FIRST VERSION OF THIS ENTRY WAS WRONG, AND THE WAY IT WAS WRONG IS THE
LESSON.** It reported that the kernel "executes across 263 distinct code pages
without producing console output" and left "where it goes next" open, as a
characterised mystery. It was not a mystery. **I booted it on `DOSBOX8086`,
which has no 8259** — `_serviceInterrupts` returns immediately at
`if (!this._pic)`, so no hardware interrupt can ever be delivered. Measured:
**zero IRQs across eight million instructions with IF set the whole time.**

A kernel waiting for a timer tick that cannot arrive looks exactly like a
kernel doing steady work: 263 pages, evenly spread, never halting. Every
diagnostic I ran described the spin accurately and none of them asked whether
the machine could interrupt at all. **The page-count evidence was real and the
conclusion drawn from it was an artefact of the board.**

On `PCXT8086` — `pic1, pit1, ppi1, dma1, fdc1, cga1, spk` — it simply boots.

**What the test asserts now is the CAUSE rather than the symptom:** the root
mount (which needs FDC, DMA, PIC and BIOS to have all worked), plus that both
interrupt sources actually fire — >10 timer interrupts on vector 8 and at
least one FDC interrupt on 0x0e. A page count cannot distinguish work from
waiting; an interrupt count can.

**Still open, and now a narrower question.** `fd1440-minix.img` loads `/linux`
from the MINIX filesystem, enters ELKS Setup, and stalls there with timer
interrupts still arriving and no further FDC activity — while the FAT image
gets all the way to a root mount. Two images, one board, different failure
points: the MINIX loader path is doing something the FAT path does not.

**Licence unchanged: GPL-2, run and never vendored**, `ciAvailable: false`.


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


### E7.3 NE2000 Ethernet — ON MASTER 2026-09-04 (owner-asked)

**Merged to `origin/master` at `1f35c09`.** Fast-forward, verified before the
push rather than after: 64 tests green, `audit-clean-checkout` clean on the
NE2000 test, and both ancestry links confirmed by sha rather than by reading a
remote ref twice — that ref moved under two sessions twice in the same hour.

`src/ne2000.js` + `test/ne2000.test.mjs`, machine kind `ne2000`, 32 ports.

**Clean-room from the DP8390D datasheet.** Every readable implementation is
GPL or LGPL — QEMU, Bochs, DOSBox-X, PCem, 86Box, VirtualBox. The one
permissive implementation is v86's (BSD-2) and this fleet has designated v86
**oracle-only**: run it, diff against it, never read it into our own code.
Same rule that produced `ym3812.js` and `sb-dsp.js`, and the same rule that
made `arduino_8253` an oracle after its GPL-3 headers were found.

**THE DESIGN DECISION IS WHAT IT IS ATTACHED TO, not the register file.** A
browser has no raw sockets and this bench must run offline, so the card is not
on a network — it is on a LINK. Two ship:

- `LoopbackLink` — the card hears its own transmissions, which is what a real
  card's self-test does, and is enough to bring a driver up and prove the ring,
  the filter and the interrupt path with one machine.
- `HubLink` — joins two or more emulated machines. **A repeater, not a switch,
  deliberately**: everyone hears everything and the MAC filter is what makes a
  frame yours. A switch would do the filtering in the wire and hide the lesson.

**A bridge to a real network is NOT built and should not be added casually.**
It is a product decision with safety questions attached — what a learner's
machine can reach, and what can reach it — and it belongs to the owner rather
than to whoever next opens this file.

**Modelled:** the command register and its paging; the receive ring (PSTART,
PSTOP, BNRY, CURR, and the four-byte header the NIC writes itself); remote DMA
both ways with RDC; the interrupt status and mask; the MAC and multicast
filters; promiscuous mode; and the PROM that identifies a 16-bit card.

**NOT modelled, said rather than faked:** collisions, carrier sense, FIFO
thresholds, TCR loopback modes 1–3, and the tally counters, which return zero
because nothing here can lose a packet on a wire. If a lesson ever needs a
lossy link, that is the place to add it — a link that drops a configurable
fraction would make the counters mean something and is a good exercise.

**A full ring DROPS and sets OVW rather than overwriting.** Overwriting a
frame the host has not read is a corruption a driver cannot diagnose; a
dropped frame with a flag is something it can see.

