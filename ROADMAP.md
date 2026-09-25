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

## Open tasks (scoped index — detail in the sections below; done/closed work in `HISTORY.md`)

- E0.1 Battery double-stamp — `src/devices/power.js`
- E0.2 Node-0-referenced drives — `src/mna.js` (GATED)
- E0.3 Gates hard-code the rail — `src/devices/logic-gates.js:70`
- E0.4 `solveMNA` mutates the caller's netlist — `src/mna.js` (GATED, folded)
- E0.5 Stale headers
- E1.1 Sparse LU + factorization reuse — `src/mna.js` (GATED)
- E1.2 Adaptive transient with trapezoidal — `src/mna.js` + `src/board.js` (GATED)
- E1.3 Shockley diode path + junction limiting — `src/mna.js` (GATED)
- E1.3b Shockley default flip — coordinated, after E1.3
- E1.4 Convergence fallback ladder — `src/mna.js` (GATED)
- E1.5 Worker-safety audit — `src/index.js`, no behaviour change
- E2.1 True small-signal AC — `src/mna.js` + new `src/ac.js` (GATED)
- E3.1 Op-amp GBW + slew macromodel — `src/mna.js` opamp stamp (GATED)
- E3.3 MOSFET: body diode + gate capacitance — `src/mna.js` (GATED)
- E3.5 Controlled sources E/F/G/H — `src/mna.js` (GATED)
- E5.3 MCP23008 port expander — `src/devices/` (named gap, stc ROADMAP)
- E5.4 Generic NxM scanned matrix part — `src/devices/` (named gap)
- E5.0 The owner's 6502-build BOM — coverage matrix (2026-08-23)
- E5.5 Bus TIMING domain — long-horizon, do not start casually
- E6.2 Tier A — the breadboard machine (NEXT)
- E6.3 Tier A completion — interrupts and time
- E6.4 Tier B — the DOS-program tier (no hardware at all)
- E6.5 emu8086 compatibility — a separate, smaller lane
- E6.7 The ALE-latched address bus — a lesson, not debt
- E6.8.2 Symbols in the debugger — a producer and a consumer that were never connected
- E6.8.8b The MINIX floppy does not boot because a 2-sector read returns a bad SECOND sector (2026-09-05)
- E6.8.11 Adlib and SoundBlaster inside a BSD-3 bundle — how, specifically
- E6.8.11a The second audio contract — a design for all three tiers (owner-assigned 2026-09-04)
- E7.1 The display-demo set — one bare-metal example per display card (owner-requested, 2026-09-04)
- E7.2 The auto-added chip vocabulary — closing the block gap (2026-09-04, owner-requested)
- R1 `machine.reset()` freezes the rp2040 adapter instead of rebooting
- R2 The tracked demo ROMs are executed but never checked against their generators
- R3 The `'SF'` soft-float table is empty, and it is what stops Kaluma
- R4 The ROM stamps `BSD-3` into its own image, and this repo is MIT
- E8 RISC-V microarchitecture — timing models over the functional core (PARKED, owner 2026-09-25)

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

### E3.3 MOSFET: body diode + gate capacitance — `src/mna.js` (GATED)
Level-1 with Meyer capacitances and the body diode (reuses E1.3's junction stamp).
Replaces the hard-wired gds = 0.001. Enough for gate-driver, flyback, and
synchronous-rectifier lessons; BSIM is explicitly out of scope. File
`spec-updates/mos-level1.md`. Oracle: body-diode freewheeling current in an
inductive-kick circuit; gate-charge plateau visible on the scope.

### E3.5 Controlled sources E/F/G/H — `src/mna.js` (GATED)
VCVS/CCCS/VCCS/CCVS as first-class part kinds. The opamp VCVS row machinery
generalizes; CCCS/CCVS need a branch-current row (same mechanism as vsource rows).
Prerequisite for the SPICE-netlist importer (bw-circuit-ui X1.1) to cover real decks.
File `spec-updates/controlled-sources.md`. Oracles: each source type against the
textbook two-port answer.

## E4 — Mixed-signal timing

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

### E5.5 Bus TIMING domain — long-horizon, do not start casually
The extractor models the ADDRESS domain; RWB/PHI2/data are checked for
presence, not timing. A timing domain (setup/hold at the bus, wait
states, /CSR-vs-/CSW write gating the TMS9918 note already names) is
real work with E4's event queue as its substrate. Record-only until E4
lands and a lesson actually needs it — the refusal-with-reason posture
is the honest interim.

---

## E6 — The 8086 tier (scoped 2026-09-03, owner-requested)

> **80286 — separate, experimental, WIP (codex sessions), default-off.** There
> are two explicit paths. The fast functional real-mode path is
> `src/i8086.js` with `variant:'80286'`; CI blocks on 200 vectors from every one
> of the 326 pinned SingleStepTests/80286 opcode files. A separate hosted
> qualification runs the full pinned corpus and retains source-hashed artifacts;
> its result is not claimed here before that workflow completes. The WIRED /
> Harris path in `src/experimental/harris-80c286-*` executes through its phase
> bus and resolved pins, while its historical full-corpus reports exercise a
> test-only semantic-memory adapter. Those reports do not grade timing or the
> physical board, and their source hashes delimit exactly which revisions they
> support. Neither path establishes protected mode, cycle accuracy, a speed
> number, or a shipped complete 80286. Reproduction commands, historical
> receipts, scope, and the hosted workflow receipts are indexed in
> `docs/SST286-RUNNER.md`; verify them before building on this work.

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

#### E6.8.2 Symbols in the debugger — a producer and a consumer that were never connected

`i8086-asm.js:393` builds `this.symbols`, a Map. `i8086-disasm.js` accepts
`{ labels: Map<number,string> }`. **Nothing joins them** — `labels` appears
zero times in `i8086-debug.js` and zero times in the host's
`debug-runner.js`. So a learner who wrote `delay_loop:` reads `jmp 002Bh`.

PCjs loads symbol tables and names its breakpoints. This is the highest
value-per-line item on the list — an existing producer wired to an existing
consumer — and it also buys breakpoint-by-name for free.

#### E6.8.8b The MINIX floppy does not boot because a 2-sector read returns a bad SECOND sector (2026-09-05)

`fd1440-minix.img` never reaches a kernel banner. Root cause, measured:

**A 2-sector INT 13h read (AL=2) returns a corrupt or failed second sector.**
`scripts/probe-int13-reads.mjs` watches the loader's own calls and compares
each destination against the raw image:

```
  fd1440-minix.img   121 calls   23 wrong status   21 wrong DATA
  fd1440-fat.img     230 calls    1 wrong status    1 wrong DATA
```

Every data failure is at byte 512 or 513 -- the START OF THE SECOND SECTOR --
and every failing request is AL=2 for a pair that REACHES SECTOR 9. (This
entry first said "an odd starting sector", which fitted the sample -- s9, s11,
s13, s15, s17 -- and was a coincidence of it: s1, s3, s5 and s7 are odd too
and read correctly. The predicate is the track end, not parity.)

```
  c0 h0 s9  n2   DATA WRONG at byte 513: got 41 want 81
  c5 h0 s11 n2   DATA WRONG at byte 512: got c7 want 75
  c5 h0 s13 n2   DATA WRONG at byte 512: got c7 want 00
  c4 h1 s11 n2   AH=20  (DSK_CTRLFAIL -- the controller said something
                         `fd_xfer` did not expect)
```

The first sector of each pair is always correct. `got c7` recurring is fill,
not disk content. NOTE the one benign entry: `c0 h0 s36 n1 -> AH=4` on the FAT
image is CORRECT -- sector 36 does not exist on an 18-sector track and the
loader is probing geometry.

**WHY IT KILLS THIS IMAGE AND NOT THE OTHER.** Both are affected; the FAT
image trips it once and survives, the MINIX image trips it 21 times while
loading `/linux`. The kernel therefore lands in memory with every second
sector wrong, execution runs off the end of the real code into a zero-filled
region and slides through it as `ADD [BX+SI],AL` (opcode 00 00 -- the exact
failure `scripts/build-bios.mjs`'s own header warns about), those stores smear
the data segment, and the stack descends unbounded: sp falls 61d3 -> 5a05 ->
... -> 1df9 -> 0 and wraps. cs, ds and ss are all 19fc by then.

**THE VISIBLE SYMPTOM IS 16 MILLION INSTRUCTIONS DOWNSTREAM AND IS A DECOY.**
What is easy to find is a walk at cs=685:054e..059e (`cmp bx,3D04` / `mov
bx,[bx+2]` / loop) that never reaches its sentinel because its head cell at
ds:3D04 was overwritten. Two hours went into that loop and its "corrupt free
list" before the read path was checked. Recorded because the next person will
find the same loop first: the cheap question is not where it stalls, it is
whether the bytes being executed are the bytes on the disk.

**FOUND, AND IT WAS IN THE PLACE THIS ENTRY FIRST RULED OUT.** The paragraph
that stood here said `rom/bios.asm` was "a plausible suspect and is probably
not it", and named `src/upd765.js` and the 8237 as the two candidates. That
was wrong. The FDC and the DMA controller are both behaving correctly.

**`rom/bios.asm`'s diskette parameter table declared EOT=9 -- a 360K table --
and the media are 1.44M with eighteen sectors per track.** EOT is the last
sector the controller will transfer before it decides the track has ended;
the driver sets MT, so at EOT it switches to the other head. Hence, exactly:

```
  requested  c5 h0 s9 + s10
  delivered  c5 h0 s9, then c5 h1 s1   <- first sector of the NEXT HEAD
             CF clear, AH=00: the controller did what it was told
```

and a request starting past sector 9 on head 1 has no head left to switch to,
so it terminates abnormally: `AH=20`, 512 of 1024 bytes moved, TC never
asserted. Every observation fits, including why sectors 1..7 were fine and 9
and up were not, and why the FDC's own counters reported nothing -- there was
nothing to report.

The ROM's own limitations list said so all along, in the header: "any drive
that is not 360K ... the geometry comes from the diskette parameter table, so
a different format is a table away -- but the table is not chosen by probing
the medium". A documented limitation met an undocumented consequence.

**FIXED, MEDIA-AWARE (2026-09-05).** The constant was the wrong fix and the
suite said so: EOT=18 everywhere makes the MINIX image boot AND breaks 360K,
because `test/bios-fdc.test.mjs:245` reads nine sectors from head 0 sector 6
of a 360K disk and REQUIRES the run past the end of the track and the head
switch at EOT=9. Three tests failed on the constant. EOT is a property of the
inserted medium, not a number that happened to be too small.

So the ROM now probes and publishes a table per disk. Four parts:

1. **The driver reads the table THROUGH INT 1Eh** rather than `cs:[dpt+N]`.
   It read the ROM's own copy at ELEVEN sites while the table header claimed
   that a program hooking INT 1Eh "really does change what the controller is
   told" -- POST wrote the vector once and nothing ever read it back, so that
   documented contract was false. It is true now, and that is a fix in its own
   right: a guest can correct us.
2. **Three tables** -- 360K, 1.2M, 1.44M -- differing in EOT and the two gap
   lengths.
3. **`d_media` probes once**, with VERIFY rather than READ: the 8237 runs in
   verify mode and drives no bus cycle, so no scratch buffer is named anywhere
   in low memory and a wrong guess cannot corrupt one. Sector 18, then 15,
   then 9, all attempted with the 1.44M table published, because EOT must be
   high enough to NAME sector 18 before the controller will look for it.
   AH=00h clears the detected type, so a reset is how software asks again.
4. **AH=08h answers the detected geometry and does NOT probe** -- it stays
   configuration rather than controller traffic, and reports what the BIOS
   currently believes, which is 360K until a transfer has looked.

**WHERE THE PROBE HAD TO GO, which the suite decided rather than I did.** It
was first called from the dispatcher, before `d_read`. That programmed the
8237 for a request `fd_xfer` was about to refuse for crossing a 64K page, and
the boundary test in `test/bios-fdc.test.mjs` watches the channel's count
register precisely to pin that a refusal costs nothing to undo. So the probe
sits after the LAST refusal, inside `fd_xfer`, behind a `MEDIA_PROBING`
sentinel that stops the recursion -- `d_media` calls the transfer path and the
transfer path now calls `d_media`.

```
  measured on both ELKS images, scripts/probe-int13-reads.mjs
    before   MINIX 121 reads / 21 wrong DATA     FAT 230 reads / 1 wrong DATA
    after    MINIX 127 reads /  0 wrong DATA     FAT 230 reads / 0 wrong DATA
```

The remaining non-zero statuses are `c0 h0 s36 n1 -> AH=4`, which is CORRECT:
sector 36 does not exist on an 18-sector track and the loader is probing.

`test/bios-media-detect.test.mjs` pins it, and its reach was verified rather
than assumed: against the single-table ROM it fails 5 of 7, including the
regression case -- two sectors from sector 9 come back as 9 and 10, not 9 and
head 1 sector 1 -- and the INT 1Eh contract. The two that pass are the two
whose behaviour is deliberately unchanged. **The 1.2M table is DECLARED, NOT
MEASURED:** no image in this tier is 1.2M, so that detection branch has never
read a disk, and the test says so in its own name.

**WHAT THE MINIX IMAGE DOES NOW.** The kernel boots and probes correctly:

```
  ELKS 0.9.1 (61520 text, 31856 ftext, 10240 data, 8112 bss, 47182 heap)
  fd0: probed, probably has 80 cylinders, 2 heads, and 18 sectors
  FAT: Unsupported format
  VFS: Insert root floppy and press ENTER
```

It does NOT mount root, and that is a different problem: the kernel tries its
FAT driver on a MINIX filesystem and rejects it. Nothing above claims MINIX
boots to a root mount -- it claims the read path is correct, which is what was
measured.

**STILL WRONG — AND THE OBVIOUS DESCRIPTION OF IT IS FALSE, checked
2026-09-07 before starting the work.** This entry, and my own messages to
lego-ac, said "the CMOS drive type still says 360K". **There is no CMOS.**

```
  RTC / CMOS chip in src/i8086-machine.js   none — no such chip kind exists
  in the PCXT8086 preset                    pic, pit, ppi, spk, dma, fdc, cga
  ROM references to ports 70h/71h           none
```

An IBM PC/XT had no CMOS at all; it arrived with the AT. So ELKS's line reads
the way it does for a different reason than the one recorded here:

```
  df: CMOS df0 is unknown (15)df0 is 360k/PC (1), df1 is unknown (15)
```

`unknown (15)` is ELKS reading an ABSENT CMOS and getting 0Fh, and
`360k/PC (1)` is its own FALLBACK when the CMOS says nothing. There is no byte
in this machine saying 360K, so there is no byte to correct.

**The equipment word cannot say it either.** `EQUIP_WORD equ 0021h` encodes
"a diskette drive is present", the video mode, and the drive COUNT in bits
6-7. It has no drive-TYPE field. That half of the task is not small, it is
impossible as stated.

**And 3F7h is the same shape.** The ROM already documents it at `d_type`: the
XT card this ROM is written for does not decode 3F7h at all, and `src/upd765.js`
models the AT behaviour and says so.

**DECIDED 2026-09-07: THIS TIER STAYS AN XT, AND THE ITEM IS CLOSED.** The
remaining mismatch was never three bugs; it was one machine-definition
question, and the owner has answered it. All three items — a CMOS drive-type
byte, a drive-type field in the equipment word, a decoded 3F7h — are AT-class
features, and this preset is deliberately a PC/XT. **The ROM already declares
that correctly**: the model byte at FFFF:000E is `0FEh`, "PC/XT class", which
is what the machine is.

The precedent is E6.8.4l's, and the reasoning is the same one word for word:
this is not *hard, deferred*, it is **no demand, not started**. Nothing is
broken. Transfers are correct because E6.8.8b made the driver PROBE the medium
rather than trust a table; ELKS's own probe finds 80 cylinders, 2 heads and 18
sectors; brickwright-lite's two ROM gates pin exactly that. The only thing that
would change is a diagnostic line ELKS prints from a fallback, and lego-ac has
dropped the acceptance line that rested on it.

**If it is ever reopened, the route is a SECOND PRESET and not this one.**
Adding a CMOS/RTC at 70h/71h and decoding 3F7h inside `PCXT8086` would make a
preset named for an XT stop being one, and every consumer of it would silently
change machine. A `PCAT8086` alongside it is the honest shape, and it wants a
workload that needs AT hardware before anyone builds it — the same bar the BIU
failed to clear.

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

**HOW IT GETS GRADED. THE TWO CONTRACTS MUST AGREE** — if `audioTone()` says
440 Hz, the stream from `renderAudio()` must measure 440 Hz. That is a
cross-check between two independently written paths inside one chip, the
discipline §8 of the core plan already records for the CGA pixel layout:
*"written twice and cross-checked… sharing the code would have been less work
and would have caught nothing."* No external oracle needed.

**AND THE FIRST DRAFT OF THAT TEST COULD NOT FAIL, which is worth recording
because the idea survived and the method did not.** It said "count zero
crossings, or run a Goertzel filter at the claimed frequency". `lego-47`
caught the second half: **a Goertzel AT the claimed frequency reports energy
at 440 Hz for any signal containing a 440 Hz component** — including one that
is mostly 880 Hz with a weak fundamental, one where 440 is buried in noise,
or a square wave whose third harmonic dominates. It answers *is there some 440
here*, when the question is *is 440 what this IS*. A check that reports
presence where the claim is identity.

That matters because of the drift that actually happens: **off by an octave,
from a divisor counted per-edge instead of per-cycle.** A bare Goertzel at 440
passes that silently. So the method is two things, and both are required:

- **Zero crossings over a whole number of periods**, which yields a
  FREQUENCY rather than a score and disagrees loudly at 880.
- **Goertzel at the claimed frequency AND at its neighbours** — 2f, f/2, and
  a couple of unrelated bins — with the claimed bin required to be the
  STRONGEST, not merely present. That is the difference between a detector
  and a confirmation.

For an OPL specifically, `ymfm` (BSD-3) is available as a second oracle on
top of both.

**KNOWN WART, FIXED UNDER THIS AND NOT INHERITED BY IT.** `audioTone()`
returns an OBJECT from the speaker and the ULA and an ARRAY from the AY. **A
contract with two shapes is not a contract**: every future producer has to
guess which one it may return, and the guess will be wrong about half the
time. This is also the cheapest moment it will ever be — there is exactly one
consumer, `updateBuzzerAudio(id, tone)`, and it is being touched anyway.

An array always, with a single-voice device returning one element. Named
migration, not a silent change. **And ASSERT THE ARITY, not just the shape**
(`lego-47`): a device declaring one voice must return exactly one element,
because "an array" is satisfied by an empty one, and an empty array is how a
silent chip and a broken chip look identical.

**ORDER — revised on `lego-47`'s argument, which is better than the one it
replaced.** The first draft put the speaker and the AY first, because they
exist and would exercise the contract immediately, and left the 6502 tier
last. That is right for the speaker and wrong as a plan: **a contract
validated only against producers that already exist is shaped by them.** The
6502 tier having nothing is not a reason to defer it — it is the only honest
shape test available, because whatever is written there is written *against*
the contract rather than migrated onto it.

0. **The bus itself — `src/audio-bus.js`, DONE 2026-09-04.** One mixer and one
   ring for all three tiers, because three copies would diverge and a
   contract is only worth having if the thing consuming it is one thing.
   Nothing in it knows what a CPU is. Two behaviours are COUNTED rather than
   swallowed, in the style of the DOS layer's refusal histogram: an
   **underrun** pads with silence and counts the frames it invented (padding
   is unavoidable, hiding it is not), and a **clip** is clamped and counted,
   so "the mix is distorting" is a number to assert on rather than a noise to
   notice. A third case is a decision rather than a count: an emulator
   running AHEAD of the host **drops** the excess rather than overwriting
   unread audio, because sound nobody will hear in time is worse played late.
1. **The speaker — DONE 2026-09-04.** Simplest possible producer: one voice, a
   square wave from a divisor, and it proves the tone half and the agreement
   test together.
2. **A 6502-tier producer — the shape test.** Built from the contract
   outward, by a tier with no audio history. If it forces a change, we learn
   that after two implementations rather than after four.
3. **The AY.** Multi-voice, plus the array migration below — the hardest, and
   it benefits from two prior users.
4. **The SB DSP — DONE 2026-09-04** (`src/sb-dsp.js`). It was nearly free
   exactly as predicted: the DSP pulls one byte per sample period through the
   SAME 8237 the floppy uses and raises a real 8259 line at end-of-block, and
   both were already proven by `dos-boot-fdc`. Reset handshake, time
   constant, speaker gate, direct DAC, single-cycle and auto-init transfer,
   pause/continue, version. **It is also the first producer with NO TONE** —
   `audioTone()` returns `[]`, because a PCM device has a sample RATE and not
   a pitch, which is the case the arity rule was sharpened for and the proof
   that the two contracts are genuinely independent rather than one being
   derived from the other.
5. **The OPL — DONE 2026-09-04** (`src/ym3812.js`), **and the ymfm chain is
   NOT vendored after all.** The decision is recorded in that file's header
   and it reverses this entry's assumption: ymfm is C++ and this engine is
   JavaScript, so a "vendoring" would be a TRANSLATION — a derivative work
   just as a copy is. The property §E6's table calls *the only reason the tier
   can ship inside a BSD-3 bundle* is lost either way, and a careful
   translation costs about what writing it costs. So the OPL2 is clean-room
   from the YM3812 datasheet and **ymfm stays an ORACLE rather than a source**,
   which is the role this tier has always preferred and the more valuable of
   the two. DMXOPL's patch set and LittleMUS's sequencer are unaffected: both
   are data and MIT, and neither is a translation of anything.

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
   **The example set grew to NINE self-booting firmwares (2026-09-04):** the
   UART shell, the five display cards (CGA text/graphics, VGA, Hercules, EGA —
   all rendering), the timer, the keyboard, and **DESKDEMO8086** — the capstone,
   which runs the timer (IRQ0) and keyboard (IRQ1) at once and is the first thing
   to exercise the 8259 with two live IRQ lines composed (priority + two EOIs),
   the same path the DOS boot depends on.

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
   using cpu.interrupt(9) direct). **CLOSED (2026-09-04): host mapping landed
   (lego-47) — browser key -> set-1 scancode -> keyIn -> 8255 -> IRQ1 on hardware
   boards, ASCII into the DOS key queue on the PIC-less ASM bench; the KBDDEMO
   loader entry is wired (bw-circuit-ui `13bbd54`).** The Circuit Designer 8086
   example now has both widgets live — the display cards (five, all rendering)
   for output and the keyboard for input — plus the UART shell, the timer, and
   GUI binary-loading. Eight example firmwares.

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

#### What is NOT done, and what I would do next

1. **No pseudocode verb.** A learner reaches the card from the ASM tab, by
   writing to its registers — which is the lesson for a NIC in a way it is not
   for an LED. A `send`/`on receive` pair in pseudocode would need a decision
   about what a "message" is that does not exist yet.
2. **No driver ships, and none can.** The DOS networking stack anyone would
   reach for — Crynwr packet drivers, mTCP — is GPL. Writing to the NIC
   directly is the intended path.
3. **PORT CONFLICTS ARE NOT DETECTED.** The ADC0809 sits at 300h and an
   NE2000's first jumper setting is also 300h. A board declaring both gets no
   warning, and the symptom would be two chips answering one address. Presets
   should use **320h** for the card. Worth a machine-level check that two chips
   do not claim overlapping blocks — it is cheap and it is exactly the class of
   silent wrongness this tier keeps finding.
4. **v86 has an NE2000 and we CANNOT currently diff against it — an absence,
   not a skip.** `V86_ORACLE_DIR` is unset and the libv86/wasm binaries are
   not on this box, so `scripts/oracle-v86.mjs` has nothing to run. **This
   card therefore rests on the datasheet and nothing else** — tier 3 by the
   VERIFICATION.md ladder, where the 8254 and 16550 are tier 2a because a
   second implementation agreed with them.

   Recorded this way round on purpose. "We have not got to it yet" and "the
   oracle is not installed" read the same in a plan and are different in a
   review: the second is a dependency somebody can satisfy in ten minutes,
   and the first invites the reader to assume it was considered and deferred.
   `oracle-census.mjs` already lists v86 with `obtain:` instructions; running
   them is all that stands between this chip and a second opinion.

5. **THE FULL SUITE EXITS 1 ON MASTER, and it is not this chip.**
   `ac-small-signal` ("AC: honesty and speed") fails under load and passes in
   isolation — 3832 tests, 3799 pass, 1 fail. It has been patched twice for
   exactly this symptom and the ruling is to QUARANTINE it rather than raise
   the budget a third time, with the cost written beside it: a quarantined
   test means a real numerics regression lands silently. Assigned, not done.

   Recorded here rather than left implicit because **a red master for a known
   reason is still a red master** — it degrades the signal for every repo that
   vendors this one, and "we know about that one" is exactly how a second
   failure hides behind the first.

6. **NO PORT-CONFLICT CHECK EXISTED, AND NOW ONE DOES.** Two chips claiming
   one I/O window used to resolve silently to whichever was declared last —
   a board that ran and read the wrong device. `I8086Machine` now refuses,
   naming both chips and both decoded windows. Checked per bus, since an I/O
   window and a memory window at the same number are different places.

#### Three bugs found by running it, two of them in the TEST

Recorded because they are the kind that read as chip faults:

- **PSTART and PSTOP are WRITE-ONLY on page 0** — reading register 1 gives
  CLDA0, not the ring bottom. The harness read them back, got zero, and
  computed a negative frame length. A real driver keeps its own copy.
- **CR `0x21` and `0x22` both abort a remote DMA, but `0x21` carries CR_STOP.**
  The harness used the tidy-looking one between accesses and the card went
  deaf between frames with nothing to show why.
- **Remote DMA moved two bytes per access in word mode.** DCR bit 0 says the
  HOST moves 16 bits per instruction, and on an 8086 `IN AX, DX` is two byte
  reads — so the width belongs in the CPU, not the chip. A four-byte header
  came back as bytes 0, 2, 4, 6.

Verified with `audit-clean-checkout`, which caught the test file before it was
tracked — the tool working on its first real use by someone other than its
author.

### E7.2 The auto-added chip vocabulary — closing the block gap (2026-09-04, owner-requested)

The goal the owner set: **full circuits control on the 8086, as Nano, Pico and
STC already have** — plus games and sound. The gap is not emulation. Measured
against the STC block vocabulary with the parser's own syntax (the first
measurement used guessed syntax, was silently dropped, and reported a false
"empty script" — see VERIFICATION.md on probes that fail to run):

| Block | opcode | 8086 before | after |
|---|---|---|---|
| `turn on <pin>` / `read` / `toggle` | `stc12_setpin` etc. | lowers (8255) | lowers |
| `PIN pot = P1.n ANALOG` + `read pot` | `stc12_read` analog | refused | **lowers** — ADC0809 at 300h (`9ed0a5062`, i8086) |
| `set <pin> to <expr> hz` | `stc12_settone` | refused | **contract proved** (`0c7fb5f`), lowering pending |
| `set <pin> to <value>` | `stc12_writepin` | refused | **lowers as a digital LEVEL** — not a DAC. See below. |
| `wait until <cond>` | `control_wait_until` | refused | **lowers** to a poll on the pin (`a5a658c37`, i8086) |
| `set <pin> to <n> percent` | `stc12_setpwm` | refused | REFUSES, deliberately — see below |
| `WHEN <pin> pressed` | `stc12_whenpin` | refused | needs the PIC + scheduler |
| `PART x = SEG7/KEYPAD4X4 on Pn` | parts | refused | KEYPAD4X4 lowers (`6a2afdd97`, i8086) |

**THE DAC HAS NO CALLER, AND THIS ENTRY HAS BEEN WRONG IN BOTH DIRECTIONS.**
Recorded here because the shape of the error matters more than the conclusion:

1. This lane first said "no caller for a DAC" and deferred it. Correct, but
   held for a bad reason — the probe used `write <expr> to <pin>`, which is not
   the syntax and matched nothing. A gap asserted from a probe that never ran.
2. On finding the real spelling, `set <pin> to <value>`, both this lane and
   i8086 concluded it was the DAC's caller, and the DAC0832 was built.
3. **It is not.** `set <pin> to <expr>` writes a computed *level*, not a
   voltage. The parser says so (*"a level is a level, exactly like `set
   high`"*), and `trace-oracle.js` — the reference semantics every back end is
   measured against — lowers it as `num(VALUE) ? 1 : 0`. Every other back end
   emits `if (VALUE) high else low` and none scales anything. Lowering it to a
   DAC would put 128/255 of Vref on a pin the program asked to be driven HIGH:
   it would run, look plausible, and mean something else.

So `writepin` lowers as a digital level (i8086, `a5a658c37`), and **the
DAC0832 at 310h has no pseudocode caller today.** The chip is correct and
`analogInputs()`/`analogOutputs()` are used by the ADC regardless, but wiring
the DAC to anything needs a *declaration* that means "this pin carries an
output voltage" — `ANALOG` currently means the input side. That is a language
decision to be made deliberately, not retrofitted to justify a chip that
already exists.

The lesson, and it is a verification one: **a corrected error is not
automatically a corrected conclusion.** The correction here (finding the real
syntax) was right, and the inference drawn from it was wrong, and the second
error was harder to see than the first because it arrived wearing the
credibility of a fix. Two sessions agreed on it within one exchange.

**A tone needed NO new chip.** `DOSBOX8086_XT` already carries the 8255, the
8254 and the PC speaker. P2 maps to port B, so **P2.0 and P2.1 literally are
the timer-2 gate and the speaker data line** — a tone on those pins is the real
PC mechanism, not a substitution, and a tone on any other pin must refuse by
name rather than silently ignore the pin the learner declared.

**And a tone shares a byte with the pins, which is a contract and not a
detail.** An 8255 output port is written whole, so a tone and a lit LED are two
bits of one latch. Measured, both orders, from assembled programs:

- raw `OUT 61h` then a pin write → **the tone stops** (the pin shadow has the
  gate bits clear).
- a pin write then raw `OUT 61h` → the tone survives but **the shadow now
  disagrees with the port**: the LED is dark and the program believes it is
  lit. This is the worse failure, because nothing reports it.
- the tone routed through `BW_PORTB` → both orders give tone **and** LED, and
  the shadow matches the port.

So `settone` MUST use the same shadow byte as the pin writes.

**`stc_pwm_fade` is not a `setpwm` example.** It is hand-rolled PWM — `set led
to 0` / `set led to 1` in a tight loop — so it runs on the level lowering and
needs no hardware. No shipped example uses `stc12_setpwm` at all. The reseat
gate's row for it had been wrong twice over: it quoted the non-existent syntax
AND diagnosed missing hardware.

**MEASURED 2026-09-04: a scheduled PWM task resolves ~20 levels, and the limit
is QUANTISATION, not jitter.** With the preemptive scheduler landed, this
stopped being an estimate. A PWM script (`turn on / wait / turn off / wait`)
alongside a second script that never waits, sampled cycle-weighted:

| asked | measured | | adjacent steps |
|---|---|---|---|
| 5 % | 9.06 % | 20 levels, 9/20 | 45.43 % |
| 25 % | 27.25 % | 10/20 | 49.97 % |
| 50 % | 49.97 % | 11/20 | 54.53 % |
| 75 % | 72.71 % | 12/20 | 59.98 % |
| 95 % | 90.88 % | | monotonic, ~5 pt steps |

**At 100 levels adjacent steps collapse.** Asking 50 %, 51 %, 52 %, 53 % all
produce **49.97 %** — four levels, one value. Every measured period is a
multiple of ~0.477 ms, which is the scheduler's tick: a 0.1 ms difference
rounds away, a 0.5 ms difference does not. So ~21 ticks fit in a 10 ms period
and that is the resolution, arrived at by the clock rather than by choice.

**Jitter is NOT the limit, which is the surprising half.** The prediction was
that preemption inside the on-phase would smear the duty. Measured over 655
periods: **sd = 0.002 ms, range 10.486-10.492 ms.** Six microseconds. The
scheduler is far steadier than either lane expected, and the ceiling is
deterministic quantisation — which means the resolution can be STATED exactly
rather than hedged.

**The error is a linear compression toward 50 %, not noise**: gain ~0.91,
symmetric about mid-scale, so a fade stays monotonic and loses a little travel
at both ends. Combined with the eye's roughly logarithmic response, that argues
for spacing the 20 levels non-linearly, which costs nothing.

**Conclusion: `setpwm` can have an honest lowering at ~20 levels, and nobody
needs the PIC for smoothness.** The PIC remains priced and available
(byte-identical over 525 corpus programs) for a lesson that genuinely wants an
ISR.

**THE DAC0832 STAYS WITHOUT A PSEUDOCODE CALLER, BY DECISION (i8086,
2026-09-04).** `ANALOG` could be made bidirectional — read gives the ADC, write
gives the DAC — with no grammar change. It is refused because **on an 8051
`ANALOG` is input-only**: P1 has ADC channels and the part has no DAC. A
bidirectional `ANALOG` here would reseat onto an STC and silently lose half its
meaning, which is the class this tier exists to refuse. So the DAC is reachable
from the ASM tab and not from pseudocode, and that is a legitimate home rather
than a waste: a learner writing `OUT 310h, AL` by hand is doing the lesson the
chip is for. A pseudocode caller would need a new direction token that every
other back end refuses by name — a real language change, to be made deliberately
and not to justify a chip that already exists.

**`setpwm` REFUSES, and that is the considered answer.** A DAC would give the
same visible LED brightness by a different mechanism, so a scope, a motor or an
RC filter would disagree with the lamp — a substitution whose warning a learner
cannot act on. Genuine PWM on an 8255 pin is software PWM driven from the IRQ0
tick, which is real work and not yet done. Until it is, a refusal by name is
honest and a green example bought with a substitution is not. (Ruling: i8086,
2026-09-04; this lane concurred and dropped its DAC-for-PWM proposal.)

**Ports.** The XT prototype-card block 300h–31Fh is where a learner's board
goes. 300h–308h is the ADC; **310h–313h is the DAC**; the window is four ports
rather than one because the 0832's two latches are its actual feature.

**The DAC is write-only and its full scale is Vref × 255/256.** Reading returns
open bus, not the last value written — a model that echoed the write back would
teach that a DAC can be read. Code 255 gives 4.980 V and nothing gives 5.000 V.

**A new reporter pair, `analogOutputs()` / `analogInputs()`,** separate from
`outputPoints()`/`inputPoints()` rather than folded into them: a voltage has no
per-bit direction and no pin latch, and returning two shapes from one method
would hand callers a contract they had to type-test — the thing `audioTone()`
already refuses to do by always returning an array. An empty list means NO
analog output, which is not the same as an output sitting at zero.

**THE PIC, PRICED (2026-09-04).** `setpwm` done honestly and `WHEN <pin>
pressed` both want interrupt delivery, and `DOSBOX8086_XT` has no 8259 and no
`irq` key on its PIT. The machine already implements the whole path — 8259,
PIT OUT0, IVT, IF, EOI — so what is missing is two lines of config, not an
implementation, and `test/i8086-isr-pwm.test.mjs` proves it: IRQ0 arrives,
PWM from the tick hits 0/25/50/75/100 % within one point, and the main loop
keeps running (~13 800 iterations at every duty), which is the property a busy
loop cannot have.

The cost was MEASURED before proposing the change, not after. `--pic` on
`run-i8086-corpus.mjs` builds the candidate preset; both arms over the 525
programs:

    baseline (--xt)        517 EXITED, 8 LOOPING, peak RSS 179 MB
    candidate (--xt --pic) 517 EXITED, 8 LOOPING, peak RSS 179 MB
    diff of the two reports: IDENTICAL

So the only observable difference is the one predicted from the port map: 20h-21h
stop being open bus, `IN 20h` goes `0xFF` -> `0x00`, and **no corpus program
depends on it**. The `--pic` flag stays an experiment and the shipped preset is
unchanged; the decision is now evidenced rather than argued, and i8086 has a
third option in flight (a scheduled coroutine task, no PIC) that may make it
unnecessary.

MEASURE DUTY BY TIME, NOT BY INSTRUCTIONS. The ISR runs the same instruction
count every tick whatever the duty and the pin holds its previous value while
it does, so an instruction-weighted average is biased low: 25/50/75 read as
24.0/48.6/74.1 by instruction and 24.7/49.5/74.9 by cycle. An LED integrates
over time.

**Still open:** the `settone` and `writepin` lowerings themselves (i8086 owns
`pseudocode-8086.js`); software PWM from the tick; `whenpin`, which needs a PIC
`DOSBOX8086_XT` deliberately omits; and the remaining `PART` vocabulary.

---

## E8 — RISC-V microarchitecture: timing models over the functional core (PARKED)

**Status: PARKED by the owner on 2026-09-25 ("for some time later; atm we have enough on
the table").** It was scoped after a survey of the reference simulators (Spike, rv32emu,
TinyEMU, gem5). Nothing here is started. **Prerequisite:** the oracle and performance
lane that was opened the same day must have landed:
- Spike lockstep and riscv-arch-test as a CI gate on `src/riscv32.js`;
- measured MIPS against rv32emu and TinyEMU;
- the Linux-boot verdict.

Re-measure that lane's numbers before starting this one.

**Why.** Brickwright is about learning internals. Today the RISC-V core is
*instruction-accurate*:
- RV32IMAC with M/S/U and Sv32;
- CLINT, PLIC, UART and virtio;
- it boots xv6, FreeRTOS, RT-Thread and Zephyr.

It says nothing about *how* a CPU executes an instruction. The PicoRV32 soft-core on
lite's FPGA tab shows real RTL, but that is one fixed, multi-cycle, non-pipelined design.
The cycle-level simulator surveyed here (gem5) covers exactly this missing layer:
- pipelines, hazards and forwarding;
- branch prediction;
- caches and coherence;
- per-component statistics.

We take its **design ideas**, not its code. It is C++/Python, has no wasm build and runs
far too slow for a browser.

### E8.1 Functional/timing split: pluggable CPU models
The functional core stays the single source of truth for semantics. A timing model
observes the retired-instruction stream and charges cycles. It is trace-driven first;
execute-in-execute is needed only if a lesson needs wrong-path effects.

The models:
- **Atomic:** the current model, 1 instruction per step, fastest.
- **In-order 5-stage:** IF/ID/EX/MEM/WB, with RAW hazards, load-use stalls, a forwarding
  on/off switch, and branch resolution in EX with a configurable penalty.
- **Later, optional:** a small out-of-order model (rename, ROB, issue queue) as a
  lesson, not a performance model.

**Acceptance:**
- Switching models never changes architectural results. The oracle gate from the
  prerequisite lane runs under every model.
- Cycle counts for hand-analysed kernels match a hand-derived table, for example a
  load-use chain with forwarding off costs exactly N stalls.

### E8.2 Caches and memory hierarchy
Configurable L1 I and D caches: size, associativity, line size, and LRU/FIFO/random
replacement, all write-back and write-allocate. A fixed-latency memory sits below.
Optionally an L2.

**Acceptance:**
- Miss counts on strided and blocked matrix kernels match closed-form expectations.
- Cross-check against the reference cycle-level simulator run offline on the same
  program and configuration.

### E8.3 Branch predictors
Static not-taken, bimodal (2-bit counters), gshare, and a BTB. Report the misprediction
rate and its cycle cost per branch site.

### E8.4 Statistics framework
Named counters, for example `cpu.ipc`, `dcache.misses`, `bp.mispredicts` and
`pipe.stall.loaduse`, following the reference simulator's stats design. They can be
reset or dumped over a region of interest, exposed on the debug-target adapter, and
shown in lite next to the pipeline view.

### E8.5 Fast-forward, then switch
Run to a region of interest on the atomic model (for example boot to shell), then
switch to the detailed model: checkpoint the architectural state and warm the caches.
The same mechanism keeps an OS-scale lesson interactive.

### E8.6 The lite half
- A pipeline diagram: the classic stage × cycle grid, with stalls and forwards marked.
- Cache and predictor panels.
- Model and configuration pickers on the RISC-V target.

This is lessons material: "why forwarding matters", "why this loop order is 10× slower".

### Oracles and licence notes
- The reference cycle-level simulator is BSD-licensed. Use it offline as an
  oracle only: pinned build, committed fixtures, never vendored.
- Spike (BSD-3) remains the architectural oracle.
- Don't expect cycle-exact agreement with any real core. The claim is agreement
  with our own stated model and with the oracle under a matched configuration.
  Report deviations rather than tuning them away.

## Reported gaps, not yet triaged

Gaps recorded at the moment they are found — some measured in a DOWNSTREAM
repo against code this one owns, some here. A gap that lives only in a chat
session and a branch note evaporates when both end. Each says who measured it
and whether anyone here has reproduced it.

### R1 `machine.reset()` freezes the rp2040 adapter instead of rebooting

**THE REBOOT HALF IS FIXED 2026-09-17. ONE DoD CLAUSE REMAINS UNTESTED BY ME —
read the scope below before recording this as closed.**

`replaceSoC(previous, opts)` in `src/rp2040js-adapter.js` consumes the reset
request the watchdog hook was already surfacing: it copies flash out, builds a
fresh SoC, and boots the preserved image. Measured end to end by
`scripts/probe-pico-reset.mjs`, which now also does the HOST half the adapter
cannot — re-attaching a `USBCDC` to the new `usbCtrl`:

```
machine.reset() -> park          1,240,679 absolute; onResetRequest fired once
replaceSoC() + host rebind
re-enumerate USB                 done at 1,644,989
second REPL prompt ">>>"         REACHED
banner                           not seen -- dropped before DTR, as expected
```

Probe exit status is now 0. rp2040 suites 99/99, census 14/14.

**THE BOUNDARY, decided rather than assumed.** The adapter's comment assigns
the replacement to "a browser or runner". The split landed here is: the
flash-preserving reconstruction is generic and lives in this repo; the USB/GPIO
rebinding stays with the host, which owns those objects and which the adapter
cannot reach. That is the smallest split that makes the reusable half reusable
without pretending the host-specific half is generic.

**WHAT IS STILL UNTESTED, and it is a DoD clause:** bullet 1 asks for a test
that deploys a `main.py` driving GP25 through `deployMainPy`, calls
`machine.reset()`, and asserts **`main.py` then runs** so GP25 toggles. I proved
the machine REBOOTS to a live prompt. I did NOT drive `deployMainPy`, and I did
NOT assert a deployed program runs after the reboot. Flash survives the
replacement (asserted in `test/rp2040-soc-replacement.test.mjs`), so there is
reason to expect it — but expecting is not measuring, and that clause belongs to
whoever closes this entry.

**ONE INSTRUMENT CORRECTION WORTH KEEPING.** The first run of the fixed probe
printed "R1 NOT FIXED" about a SoC that had already re-enumerated USB, because
it waited for MicroPython's BANNER. `mp_hal_stdout_tx_strn` drops every byte
until CDC reports DTR, so on a machine that enumerates later the banner is
simply gone — a warning lite's own `probe-pico-micropython.mjs` carries in its
comments. The first boot in that same probe never trusted the banner; it
knocked and waited for `>>>`. **Using a weaker instrument for the second
reading than the first** is what produced a false negative about my own fix.



**Reported by lego-ac (brickwright-lite, N3c), 2026-09-06. REPRODUCED AND
TRIAGED HERE 2026-09-06; whole-SoC adoption remains open.**

On lite's vendored copy of `src/rp2040js-adapter.js` at bw-board 88bbdcf78,
MicroPython's `machine.reset()` after `deployMainPy` freezes rp2040js at
**2,191,927 steps** across eight drive slices rather than rebooting. `main.py`
therefore never runs and GP25 is never driven. The same program's body, run
live through the raw REPL, toggles GP25 as expected — so the program is fine
and the reset path is not.

Their reading is that the watchdog or SIO reset path is unmodelled in the
adapter. That is a hypothesis, not a measurement, and it is the first thing to
check rather than to assume.

**Triage result.** The independent deploy replay reaches 2,184,488 instructions
and then returns idle for eight successive 1.5M-instruction budgets, with no
GP25 drive. A direct write of `TRIGGER` to `WATCHDOG.CTRL` is red before the
adapter change: rp2040js invokes its default warning callback and leaves the
host to perform the reset. Installing a narrow callback that clears WFE/core
state and jumps back through boot2 does produce a second MicroPython banner,
but `main.py` does not run because peripheral/controller state survives. A
fresh adapter booted from the exact post-deploy flash drives GP25 high at
instruction 853,283. That isolates the remaining work to whole-SoC replacement
and host USB/GPIO rebinding; flash persistence, file deployment and boot2 are
already proven.

The first upstream seam is now explicit: `onResetRequest` and
`takeResetRequest()` surface one named watchdog request and stop the old SoC at
the instruction boundary. The consuming runner must construct a new adapter
from the preserved flash and reconnect USB/GPIO. This avoids pretending that a
partial list of rp2040js private fields is a hardware reset.

**Why it matters here rather than there:** `src/rp2040js-adapter.js` is this
repo's file; lite consumes it. A learner program that calls `machine.reset()`
would freeze the simulator.

**CORRECTED 2026-09-17 — LITE'S CONTAINMENT IS NOT WHAT THIS ENTRY SAID.** It
read "lite currently uses live exec for its sim Run and refuses by name if the
program text calls `machine.reset()`". The live-exec half is right; the refusal
is not. There is no text-level refusal. Verified in lite at `origin/main`:

* `overlay/scratch-gui/src/lib/bw-matrix/capabilities.js` ~265 — the sim tier
  offers `py` and drives it LIVE over `createPicoRepl`, and its comment says it
  "does NOT install-and-reboot in the sim — machine.reset() does not reboot the
  emulator yet (finding N3c-1)... that half stays silicon-only".
* `overlay/scratch-gui/src/lib/pico-sim-run.js` ~235 — "Its final
  `machine.reset()` asks the host to replace the complete SoC".

So the containment is a CAPABILITY-MATRIX decision — install-and-reboot is
simply not offered on the sim tier — not a guard that inspects a learner's
program and rejects it. That is a materially different thing: it withholds a
route rather than refusing a user's code, and it is cheaper to keep. Reported by
brickwright-lite-96, who checked lite's source rather than accept my
description of it; I had been repeating this entry's wording, including to them.
Also corrected above: lite CONSUMES this file as a package now, it does not
vendor it.

**Where the evidence is:** `docs/PICO-SIM-RUN-FINDINGS.md` on branch
`lane/n3c-pico-micropython-run` in brickwright-lite, with the probe and the
step count. Start by reproducing it against this repo's own adapter before
touching anything — the step count is precise enough to be a real anchor, and
a reproduction here is what turns a reported gap into a triaged one.

**2026-09-17 — THE FIRST CLAUSE'S MECHANISM NOW EXISTS (`a20cdfa`), AND R1 IS
STILL OPEN.** The DoD below asks for "PC back through the bootrom". Until now
the bootrom's reset vector was `b .`, so no reset could satisfy that clause
whatever the adapter did: `core.reset()` simply hung and every caller assigned
PC by hand. The ROM's reset handler now reads the first word of flash, installs
the boot SP, and enters the image at `FLASH_BASE` — so a plain `core.reset()`
reboots a loaded image, proved in `test/rp2040-bootrom-reset.test.mjs` (an
erased device still spins rather than sliding through `0xffff`, and that guard
is mutation-verified).

**CORRECTED SAME DAY — IT IS NOT ON THIS DEFECT'S CURRENT PATH AT ALL.** I
wrote that it "supplies the first clause". Read the adapter: `machine.reset()`
reaches `watchdog.onWatchdogTrigger`, which writes 0 to CTRL, records a
`resetRequest`, sets `core.waiting = true` and hands the event to the host. It
never calls `core.reset()` and never fetches the reset vector. The only
`core.reset()` in the adapter is inside `resetToProgram()`, which overwrites PC
on the next line. **So no current code path enters through the ROM's reset
handler, and the adapter bypasses it deliberately** — its comment says a real
reboot must replace the whole SoC.

What the handler actually provides is an OPTION that did not exist before: a
whole-SoC replacement can now let the new SoC boot through the vector instead
of hand-assigning PC, which is the shape "PC back through the bootrom" asks
for. Whether R1's implementation takes that route is undecided and not mine to
decide.

I over-claimed in the direction of justifying work I had just stopped
objecting to — having withdrawn a dissent, I overshot into crediting the change
with more than it does. And I tried to settle it with a 15-minute emulator run
on a thrashing box, which was killed at its timeout, when two `grep`s over the
adapter answered it in seconds. **The cheap structural read should have come
before the expensive dynamic one.**

**The triage above already says what remains:** a narrow reset callback previously produced a second MicroPython
banner and `main.py` still did not run, because peripheral and controller state
survives. The remaining work is unchanged — whole-SoC replacement with host
USB/GPIO rebinding, through `onResetRequest`/`takeResetRequest()`. Do not read
this note as movement on that.

Recorded here because I built that handler while arguing it had no consumer,
and R1 — in this file, which I maintain — is the consumer. One `grep` would
have found it.

**2026-09-17 — REPRODUCIBLE ON DEMAND: `scripts/probe-pico-reset.mjs`.** It
boots the pinned MicroPython, reaches the REPL, calls `machine.reset()` and
reports what happens instead of a reboot. Exit status is the verdict — non-zero
while R1 stands — so it is the RED-before/green-after instrument the DoD asks
for rather than something a reader has to interpret. Deterministic: identical
counts across three runs.

```
REPL prompt ">>>"          852,524      onResetRequest  fired exactly once
import machine           1,120,686        {cause:"watchdog",
machine.reset() -> park  1,240,679         entryPC:0x10000000,
                                           entrySP:0x20042000}
core.waiting  true       PC 0x1002ec7c    takeResetRequest() returns it
second banner  no
```

**THE SEAM WORKS; WHAT IS MISSING IS A CONSUMER — and that is a sharper
statement than "it freezes".** `machine.reset()` does reach
`watchdog.onWatchdogTrigger`, it does fire `onResetRequest` with a named cause
and the entry the program was booted at, and `takeResetRequest()` does return
it. The core then parks deliberately, and nothing constructs the replacement
SoC. A broken mechanism and an unconsumed one need different fixes.

Quote the ABSOLUTE count, 1,240,679, when anchoring against this. Two readings
of the same run quoted 388,155 and 119,993 instructions and both were correct —
measured from the REPL prompt and from `import machine` respectively. The probe
now prints the absolute figure alongside the relative one for that reason.

**2026-09-17 — DIAGNOSED. IT WAS NEVER CAPACITY; IT WAS A GUARD I DROPPED.**
Measured on this box while it was thrashing (swap 33 MB free, load 42):

```
MicroPython v1.22.2 enumerate  ->  642,528 instructions,  657 ms
REPL prompt ">>>" reached      ->  852,524 instructions,  745 ms
```

Under a second. The box was never the constraint and my "blocked on capacity"
note was wrong in every part.

**The real cause.** I copied the run loop out of
`scripts/probe-sf-unaligned.mjs` and dropped one line — the idle cap:

```js
state.idleNanos += dt;
if (state.idleNanos > idleCapNanos) return 'idle';   // <- omitted
continue;
```

Without it, a PARKED core loops forever: `continue` skips the `steps++`, so
`while (steps < limit)` can never terminate while the core is waiting with no
alarm pending. It advances simulated time and never the counter the budget is
measured in.

**And the parked core is R1's own defect.** `machine.reset()` reaches the
adapter's `onWatchdogTrigger`, which sets `core.waiting = true` deliberately
and hands the reset to the host. So the harness hung at precisely the moment
the defect fires — the freeze under investigation was mistaken for the box.

**What this gives whoever takes R1:** MicroPython boots to a REPL in under a
second here, so iterate freely; no CI infrastructure is needed to escape a
limit that does not exist. Any harness driving this must cap idle time, because
the thing being tested parks the core by design and an uncapped loop cannot
tell "parked" from "busy".

The two superseded notes follow, kept because the retractions are the useful
part.

**SUPERSEDED — I claimed capacity was the blocker and did not establish it.** A Kaluma probe on this same box,
the same afternoon, reaches a REPL prompt at 3,370,335 instructions and
completes comfortably — repeatedly. That is the same class of workload, so
"the box cannot run a ~2M-instruction boot" is contradicted by my own runs.

What the killed run actually shows is that it did not finish inside 900 s. It
does NOT show why. My probe's `done()` conditions total ~103M instructions of
budget if none of them match — it waits for `>>>` to appear on CDC, and if that
never matched (MicroPython drops stdout until DTR, and its prompt may not be
the string I grepped for) it would burn ~63M instructions after enumeration on
budgets alone. That is a plausible harness fault, not a box fault, and I cannot
separate the two because I piped the run through `tail`, which discarded every
line of progress output when it was killed.

**So the honest status is: UNDIAGNOSED.** Whoever picks this up should NOT
start by building CI infrastructure to escape a capacity limit that may not be
the problem. Start by running the probe without a `tail` pipe and watching
where it stops — a `done()` that never matches and a box too slow look
identical from outside and are one print statement apart.

The original note follows, kept because the retraction is the useful part:

**THE REMAINING WORK IS BLOCKED ON BOX CAPACITY, NOT ON KNOWLEDGE, and that is
measured rather than assumed.** Every iteration of the
whole-SoC work needs a MicroPython boot to a REPL, which is ~2.2M instructions
before the reset is even reached. Attempted on this box: killed at its own
900 s timeout while still burning 91% CPU, with the machine at swap 12254/12287
MB used, 33 MB free, load average 42.5 and twenty Claude sessions resident.
Nothing was captured. One iteration does not fit, let alone the several that a
replace-the-SoC-and-rebind-USB/GPIO loop needs.

**A route exists if someone wants it.** The firmware is deliberately not in the
repo and this repo's probes never fetch, which is what keeps a reading
independent of the network — but CI is a different context, and Lite's N11a
already has the pattern: a sha-pinned fetch verified by content hash BEFORE
extraction, declared in its fetch-pinning census, cached by the sha alone. The
same shape would let the R1 loop run in Actions instead of competing with
twenty sessions for a thrashing box.

The local UF2 exists meanwhile at
`brickwright-lite/artifacts/pico-micropython/RPI_PICO-20240222-v1.22.2.uf2`,
which is the version this entry's triage used.

**DEFINITION OF DONE**, agreed with lego-ac 2026-09-06, because they move
lite's Pico Run seam to install-and-reboot the moment this lands and the
sim/silicon difference collapses. Their criteria, recorded as given:

- a bw-board test that boots the MicroPython UF2 via `bootFromFlash`, deploys
  a `main.py` driving GP25 through the raw REPL's `deployMainPy` path, calls
  `machine.reset()`, and asserts the machine REBOOTS — PC back through the
  bootrom, banner again — and that `main.py` then runs, so GP25 toggles
- the frozen-step probe reproduces RED before the fix and green after, with
  the reset path NAMED (watchdog or SIO reset in the adapter, whichever it
  turns out to be) rather than fixed by coincidence
- a census or VERIFICATION row saying what oracle the reboot claim rests on
- suite green

The second bullet is the one that matters and it is the shape this tier keeps
relearning: a test that passes after a change proves nothing until it has
failed before it. Reproduce the freeze here FIRST.

**Priority:** lego-ac states this is not urgent and that the CMOS/equipment-word
/3F7h geometry work stays ahead of it if the owner says so. That ordering is
the owner's call, not a peer's and not this file's; both are queued and neither
is started.

### R2 The tracked demo ROMs are executed but never checked against their generators

**GUARDED 2026-09-07 by `test/rom-demos-match-generators.test.mjs`.** Each of
the ten generators is rebuilt into a THROWAWAY temp directory and compared
against the tracked file; a mismatch names the byte, the generator and the
command to run. `--out <dir>` was added to all ten builders for exactly this,
and the header says why: a gate that regenerated into `rom/` would overwrite
the evidence with the thing it was comparing against and pass from its second
run onward. An eleventh test asserts the generator list has not drifted from
`rom/*.bin`, so a demo added without a line there is caught rather than
silently unguarded.

Reach verified rather than assumed: perturbing one opcode in
`build-blink-demo.mjs` without regenerating turns it red at byte 9 naming both
files, and dropping a demo from the list turns the drift test red. Both green
again when restored.

**Original finding, 2026-09-06 — all ten were in sync when it was written, so
this was closed before anything broke rather than after.**

**PROMPTED BY brickwright-lite-ea's FINDING, not lego-be's.** This entry first
credited the relay instead of the measurement, which is the same error one
level up from the one it describes, and lego-be corrected it. ea's provenance
gate established that lite's shipped `i8086-bios.bin` had been assembled from
`bios.asm` at bw-board **5584c3f — the FIRST BIOS commit** — while SEVEN
further `bios.asm` commits had landed inside the pinned sha. lite shipped a
BIOS from before the floppy stack existed, for two days, with every gate green.
ea then measured three points in lite's vendored machine — 5584c3f, 88bbdcf78,
9a770c8 — taking INT 13h from `AH=20h` to `cf=0` and EOT from 9 to 18 on a
1.44M medium. That is E6.8.8b's bug reproduced from the far side of a pin this
repo never touched.

**THE SPECIES, framed as lego-be argues and they are right:** this is not a
weaker cousin of "nothing executes it". It is the SUBSTITUTION species with a
build artefact as the proxy, which makes it a different family.

```
  the test's set   {the tracked bytes}
  the goal's set   {what the generator produces today}
```

Those coincide only while nobody edits the generator, and they coincide BY
ACCIDENT rather than by construction. Edit `scripts/build-blink-demo.mjs` and
the test stays green, because it never touched the generator: it measured the
artefact and reported on the source. That is "I measured the model instead of
the thing it models" with `.bin` where `busTrace` was — LANES 13, again.

**AND IT HAS NO SURFACE.** "Nothing executes it" is findable by grep, and a
greppable failure eventually gets grepped. This one presents as a passing test
on a real artefact that really is executed — `test/i8086-blink-demo.test.mjs`
reads `rom/blink-demo.bin` and boots it. It looks exactly like coverage until a
generator changes, and on that day it presents as THE CHANGE NOT WORKING rather
than as the check being wrong, which sends the reader to the wrong file.

**For the BIOS itself: clean, structurally rather than by luck.** `rom/bios.bin`
is gitignored and untracked, so there is no shipped binary that can go stale;
every consumer builds from `rom/bios.asm` through `buildBios()` and the tests
execute what they just built. That is why lite could rebuild the media-aware
ROM from source at a pinned sha at all — and it is the fix ea's finding implies
for a vendored artefact generally.

**THE GUARD, AND THE TRAP IN FRONT OF IT.** A test that writes into `rom/` to
check `rom/` passes on its second run no matter what: it overwrites the
evidence with the thing it was supposed to compare against, so the first run is
the only real one and every run after is self-confirming. Someone will write
exactly that, because it is the shortest thing that appears to work. The shape
that works: give the builders an `--out` option (only `build-bios.mjs` has one),
build each into a temp dir, compare against the tracked file, and fail naming
BOTH the artefact and the generator that no longer produces it.

**And state its limit in the same breath:** it proves the tracked bytes are the
CURRENT build. It never proves the generator is right. A wrong generator
faithfully reproduced still passes.

**RECORDED DOWNSTREAM as the twenty-fourth species in brickwright-lite's
`docs/GATES-THAT-CANNOT-FAIL.md` (lego-ac, 2026-09-06), and lite has the same
latent instance:** its `i8086-bios.bin` is executed by the boot gate and hashed
by the provenance gate, but correspondence to `rom/bios.asm` is checked only
when `BW_BOARD_DIR` names a checkout — which CI does not have, because the
SOURCE is not vendored. Their cure is to vendor `rom/bios.asm` as text beside
the assembler they already vendor, and let CI assemble and compare, so the
manifest's source sha becomes something CI re-derives rather than records.

That cure works against this repo without any change here, and the reason is
worth stating because it constrains what this builder may do later:
`build-bios.mjs` returns `assemble(source, {format:'com'}).bytes` UNCHANGED —
`verifyRom()` only checks the reset vector and the 64K size, and the source
pads itself. **So the image is a pure function of `rom/bios.asm` and
`src/i8086-asm.js`.** Any post-processing added here would silently break a
downstream reproduction that has no way to know it was added.

One consequence generalises past this file: when an artefact is a function of N
vendored inputs, the guard proves correspondence but NOT WHICH INPUT BROKE IT.
A bare "bytes differ" sends the reader to the ROM source when the assembler is
what moved, and the failure message is the only place that distinction can live.

### R3 The `'SF'` soft-float table is empty, and it is what stops Kaluma

**RESOLVED 2026-09-10 (`64354e8`), AND THE NAMED CAUSE BELOW IS WRONG. The
original text is kept because the retraction is the useful part.**

`2.5+1.0` now evaluates to `3.5` in Kaluma's REPL, measured end to end by
`scripts/probe-sf-unaligned.mjs`. The cause was one byte in the header, not an
empty table:

* **`'SF'` is answered, and always was once the table landed.** Every
  `rom_table_lookup` during boot SUCCEEDS — `'SF'` returns `0x0a88`, a valid
  pointer. The claim below that it is "the one unanswered code" described the
  ROM as it stood on 2026-09-06 and was carried forward past the fix.
* **The null pointer is not a missed lookup.** pico-sdk reads the bootrom
  version with `*(uint8_t *)0x13`; Kaluma branches on it (`cmp r5,#1` at flash
  `0x1002096c`) and fills all 32 shim slots only when it reads 1. This ROM put
  `'M','u',0x01` at `0x10..0x12` and left `0x13` at ZERO, believing the `0x01`
  to be the version — it is the magic's third byte. Reading 0 took the short
  leg, which fills slot 18 and leaves 31 **double**-precision pointers null.
  The register file at the jump (`r1=0x40040000`, `r3=0x3ff00000` — the high
  words of 2.5 and 1.0) is what identified it as double, not single.
* **Nothing writes the shim table at `0x2002f808` except the crt0 zero-fill.**
  A write trap is what separated "the initialiser never ran" from "it ran and
  wrote zeros"; reading could not have settled it.
* **Both observed symptoms are this one defect.** Version too low answers `0`;
  version too high (2 or 3, measured) makes Kaluma take its V2 leg, look for
  the `'DF'` double table this ROM does not publish, and return NO value — the
  echo lego-ac's `--eval` reading hit at pin `1f809683e` and reported as a
  third outcome.
* **Why no test caught it:** the test asserted `rom[0x12] === 1` and labelled
  it `'version'`. It checked the magic's third byte twice and the version byte
  not at all. An assertion carrying the same wrong belief as the code cannot
  fail by construction.

**THE GPIO HALF IS ALSO MEASURED, 2026-09-11 (`9031682`), AND IT IS NARROWER
THAN "R3 IS CLOSED".** This entry also recorded Kaluma's first GPIO call
hanging. Driven through the REPL at master, it does not:

```
pinMode(25,1)                                      -> undefined, and RETURNS
(pinMode(25,1),digitalWrite(25,1),digitalRead(25))
    GPIO25 transitions logged during the expression
    final value=1  outputEnable=true
    0 jumps to address zero
```

The claim is about the PAD, not the return value — `scripts/probe-sf-unaligned.mjs
--pin N` attaches a listener, because an API call that returns proves only that
it returned. Reporting this off `undefined` was available and would have been
wrong in the direction where a green reads as a capability.

`digitalRead` returning 0 while the pad is driven high is **this probe**, not
the ROM: no board is attached, so `syncInputs()` never runs and the input
register keeps its power-on value. Demonstrated rather than argued — with
`--input-high` the read returns 1, so it tracks the register.

**CLOSED 2026-09-17, AND THE SENTENCE ABOVE WAS WRONG ABOUT WHY IT WAS OPEN.**
It read: "`--blink` itself, which LOADS A PROGRAM rather than typing lines... a
different entry path that can reach lookups the REPL never issues". That is not
what `--blink` does. Read at lite `origin/main`, `scripts/probe-pico-kaluma.mjs`
sends

    pinMode(25, OUTPUT); digitalWrite(25, HIGH);\r

down the REPL transport and watches `rp2040.gpio[25]` with a listener — the same
entry path and the same observation as this repo's `--pin` flag. There was never
a second path. I invented the distinction, wrote it into a merged claim row, and
told two peers to plan around it; it cost a lane that turned out to be a reading
of somebody else's script.

Measured with that exact line at `c0073ef`:

```
GPIO25            -> 1, outputEnable=true      (the MCU drove the LED)
rom_table_lookup  14 codes asked, 14 answered, none returning 0, none spinning
0x1000463f        never appears
jumps to address 0                              0
```

`0x1000463f` is the caller lite's comment names as passing "a garbage
table/code" into `rom_table_lookup` at `0x100`. It does not occur. The busy-loop
was the version byte at `0x13` all along: with it zero, the double-precision
shim table stayed null, and the first GPIO call went through a null pointer into
the ROM's zeros. Both halves of R3 were one byte.

**The pre-registered falsifying condition did not fire.** The claim row said a
`--blink` run that spins, or any code returning 0, would kill the
null-double-shim hypothesis. Neither happened. But the hypothesis survives on a
weaker footing than it looks: `--blink` and the REPL are the same path, so this
run re-measured what was already measured rather than testing it independently.
A second entry path into the bootrom — a loaded program, which is what I
wrongly thought `--blink` was — remains genuinely unmeasured.

**Consequence for Lite's N11 row, surfaced not edited** (lite's registry is not
this repo's, and `/root/sol_lane_coordination` is the docs landing owner): its
Pico C image "jumps at the boot vector, never touches the incomplete bootrom —
dodges the Kaluma `rom_table_lookup` wall". The wall is gone, so that PREMISE is
dead. The sentence survives as an ISOLATION argument — a compiled-C differential
should not depend on this ROM, or oracle and subject share a failure mode — and
that is a different reason which rules out different Door 2 designs.

The soft-float work below stands on its own and is not retracted — the table
is real, graded, and reached. It simply was not what R3 turned on.

**Reported by lego-ac (brickwright-lite N5), 2026-09-06. THE CAUSE IS
CONFIRMED HERE by reading `src/rp2040-bootrom.js`, which already documents it;
the Kaluma measurements are theirs and have not been re-run in this repo.**

Kaluma 1.2.1 — the Apache-2.0 JavaScript runtime for the RP2040 — boots behind
the clean-room bootrom to a REPL in 1,175,086 instructions and runs JS live,
and its first GPIO call hangs. Named cause: the only data-table lookup during
boot is `rom_table_lookup(table=0x20c, code=0x4653 'SF')`, the single-precision
soft-float table (datasheet §2.8.3.1.2). Kaluma routes JS Numbers through
`pico_float`, caches a null-derived operator pointer at `0x2003163c`, and calls
it via `blx r3` at `0x10020760`; the `rom_table_lookup` spin an earlier finding
saw is DOWNSTREAM of that call.

**The proof needs no disassembler and is the part to keep:** `2.5+1.0`
evaluates to **0** in Kaluma's REPL, while `1+1` and `40+2` are right. Integer
arithmetic never enters the float path; the moment it does, the answer is the
null pointer's.

**What this repo already says, and why it corroborates rather than merely
agrees.** `src/rp2040-bootrom.js` has documented `'SF'` as the one unanswered
code since it was written: booting asks for FOURTEEN distinct codes, thirteen
are answered, the fourteenth is `'SF'`. It also records the trap — *a MISSED
lookup returns 0 and the SDK calls it, because there is no null check at most
call sites, so address 0 gets executed as Thumb.* That is why an empty or
all-zero table only MOVES the crash: a clean miss becomes a jump to 0.
MicroPython reaches its REPL regardless because it never asks.

**LICENCE, and it is the reason this is work rather than a patch.** The header
already states it: *mufplib is exactly the part that is not free.* So the table
cannot be adopted from Raspberry Pi's ROM or from any GPL implementation. The
datasheet describes an INTERFACE — a table of function pointers with defined
signatures — and satisfying it with our own IEEE-754 single-precision
arithmetic is the same standard the rest of this file already meets. This is a
real implementation task, not a stub: it is the largest item in this section.

**THE FOUR ARITHMETIC OPERATORS ARE IMPLEMENTED AND GRADED, 2026-09-07.**
`fadd`, `fsub`, `fmul`, `fdiv` and `int2float`. The stop moved four times; it
did not disappear.

```
  index  operator     status
  0      fadd         6,437 vector pairs agree with Math.fround
  1      fsub         6,455 agree
  2      fmul         6,213 agree
  3      fdiv         6,159 agree
  6      fsqrt        5,999 agree            (2026-09-10)
  7      float2int    2,527 agree            (2026-09-10)
  9      float2uint   1,008 agree            (2026-09-10)
  11     int2float    4,025 agree
  8      float2fix    1,488 agree            (2026-09-10)
  10     float2ufix     710 agree            (2026-09-10)
  12     fix2float    2,514 agree            (2026-09-10)
  13     uint2float   3,013 agree            (2026-09-10)
  14     ufix2float   2,507 agree            (2026-09-10)
  19     fexp         worst 1 ulp / 5,543     (2026-09-10)
  20     fln          worst 2 ulp / 9,912     (2026-09-10)
  15     fcos         worst 2 ulp             (2026-09-10)
  16     fsin         worst 2 ulp             (2026-09-10)
  17     ftan         worst 3 ulp             (2026-09-10)
  4,5,18 deprecated slots — quiet-NaN stub, PERMANENTLY, named in the test
```

**AND NOTHING CALLS IT. Measured 2026-09-17 at `b8faec5`, and recorded here
because it bears directly on whether any further work on this table is worth
doing.** Across a full Kaluma 1.2.1 boot AND the expression `2.5+1.0`, the only
bootrom code the guest reaches is `clz32` (244 calls), `rom_table_lookup`, and
the flash no-ops. **Not one of the eighteen implemented SF operators is ever
invoked.** Kaluma looks up `'SF'`, receives a valid table pointer, and never
calls an entry: JerryScript's numbers are doubles, and its double shims are its
own flash routines at `0x10021e39` and friends, filled into a RAM table by the
version-byte branch. The single-precision table is simply not on that path.

So the honest status of this table is three things at once, and dropping any of
them misstates it:

* **CORRECT** — every operator graded against `Math.fround`, bit-exact where
  that is the right standard and inside a stated ULP bound where it is not.
* **CALLABLE** — `test/rp2040-bootrom-guest-abi.test.mjs` has a guest program
  perform the documented lookup and reach every conversion, so a consumer that
  wanted it could use it.
* **UNCALLED** — by the only firmware that has ever booted on this ROM.

It is not wasted: a non-null table is precisely what stopped the null-deref that
was ROADMAP R3, and the datasheet ABI is what a pico-sdk C program compiled for
float would use. But **the obvious follow-on — Payne-Hanek, to lift the
trigonometric domain limit at 2^16 — is speculative until a consumer exists**,
and nobody should inherit "finish the SF table" as a goal without first naming
who calls it. That is the whole reason this paragraph sits above the status
rather than below it.

**THE TABLE IS COMPLETE: 18 OF 21, AND THE OTHER 3 HAVE NO OPERATION.**
Indices 4, 5 and 18 are the datasheet's deprecated slots, so the stub list has
stopped shrinking rather than emptied. The five transcendentals are graded
against a ULP bound rather than bit-exactly, because JavaScript computes them
in double and rounds down; the bound is 4, CHOSEN, and the measured worst is 3.

`fcos`, `fsin` and `ftan` share one range reduction and one pair of
polynomials — cos(x) is sin at quadrant q+1, so adding to the QUADRANT rather
than to x costs nothing, and tan is the quotient. **Declared deviation: the
domain stops at |x| = 2^16 and returns a quiet NaN past it.** pi/2 is split
into four float32 chunks whose sum reproduces the double exactly, and the
leading chunk's eight significant bits keep k*HI an exact product only while k
fits in sixteen. Beyond that the reduction degrades with no signal, so it
refuses instead; going further needs Payne-Hanek and a multi-word 2/pi table.

Two defects worth keeping, both found by measuring rather than reading. A
`poolBase()` sitting between a CMP and its Bcc retargeted the branch: Thumb-1
has no flag-preserving MOV immediate, `lsls` left Z clear, so every positive
argument took the wrong rounding bias and the reduction returned x unchanged
(21,250,770 ulp at fround(pi)). And the harness fed the oracle unrounded
doubles while the ROM saw fround(x) — near a zero of sine those are different
numbers with different answers, and it read 1.5e9 ulp until the input was
rounded first. That is the FOURTH time that same oracle bug has appeared in
this file's history.

**THE FIXED-POINT CONVERSIONS ARE THE INTEGER ONES WITH A SHIFTED EXPONENT.**
`fix2float(m, n)` is `int2float(m)` with the exponent reduced by n, and
`float2fix(v, n)` is `float2int` with it raised by n before the range check —
the significand and its rounding are identical, and only the scale differs.
Implementing them that way rather than separately is why all four landed
without a rounding bug: there was no new rounding to get wrong.

**SECOND INCREMENT, 2026-09-10: sqrt and the integer conversions.** `fsqrt` is
digit-by-digit rather than Newton, and the reason is the same one that made
`fdiv` work: two bits of radicand per bit of root leaves an EXACT REMAINDER,
and the remainder is what separates a root that terminates from one that does
not. Newton converges faster and cannot tell those apart at the rounding edge.
The exponent is forced even first, folding the odd bit into the significand as
a doubling, so the root is 25 bits with bit 24 set in both cases and there is
one shape to pack rather than two.

**The conversions truncate, they do not round** — that is C's rule, so 2.5 goes
to 2 and -2.5 to -2, and those two cases catch an implementation that rounded.

**MORE DECLARED DEVIATIONS, and they have their own test.** `float2int` of
anything with |x| >= 2^31, `float2uint` of a negative or of anything >= 2^32,
and either of NaN or infinity, are all UNDEFINED in C. They return 0 rather
than inventing a saturation the datasheet does not specify, and the test pins
that 0 by name so "agrees with JavaScript" is never read as total.

**2.5 + 1.0 = 3.5** — the case lego-ac used to prove the float path was dead.

All three are hand-written Thumb-1, round-to-nearest-ties-to-even, graded
against `Math.fround` over a deterministic vector sweep plus hand-picked cases:
infinities, NaNs, signed zeros, `Inf + -Inf`, overflow to infinity, exact
cancellation, and the ties that separate a correct rounder from a plausible
one (`int2float(16777217)` rounds DOWN and `16777219` rounds UP, both because
the surviving mantissa must be even).

**DECLARED DEVIATION: subnormals are flushed to zero.** Stated, and pinned by
its own test so "agrees with JavaScript" is never read as total. The oracle
tests skip subnormal inputs and results deliberately; a separate test asserts
what actually happens instead.

**THE TOOLING THAT MADE IT POSSIBLE, and the reason it was needed.** `asm()`,
a label-resolving Thumb emitter, was added first. The file's own header already
records why: "the first version of memcpy here copied correct bytes and never
terminated — a branch offset counted from the wrong place landed inside the
loop body". That was twelve instructions; `fadd` is 143 with branches that
cross each other. Out-of-range branches throw rather than truncate.

**TWO BUGS THE ORACLE CAUGHT, both worth keeping:**

- 14 disagreements at `16777217` were the TEST's, not the ROM's: the harness
  fed the oracle an unrounded double while the ROM only ever sees float32, so
  the two were adding different numbers. Fixed by rounding the oracle's inputs
  first — the ROM had been right.
- A flushed subnormal was returned with its original bit pattern rather than as
  a true zero, contradicting the flush-to-zero this code declares. Caught by
  the deviation test, which existed precisely to pin the thing being declared.

**A THIRD, IN THE TESTS THEMSELVES:** the "an SF entry returns rather than
hanging" test called index 0, and when `fadd` became real it quietly started
timing that instead of the stub it is named for. Repointed at index 2. A test
that silently changes what it measures is this session's recurring failure in
miniature.

**MEASURED 2026-09-07 AGAINST KALUMA'S OWN UF2, and it corrects two written
claims.** The probe boots `kaluma-rp2-pico-1.2.1.uf2` on this repo's bootrom
and watches `rom_table_lookup` directly:

```
  'SF' asked once, at step 155,382  ->  answered 0x3a0
  0x3a0 IS the table we publish. Non-null, correct, delivered.
  [0x2003163c] = 0x143  -- the 'L3' lookup's answer, not an SF entry, not null
```

**THE TABLE IS FOUND.** The earlier reasoning here — that an unconditional-NaN
stub cannot produce 0, therefore the table is never reached — had a true
premise and a false conclusion, and it was argued from the stub's behaviour to
a path nobody had observed. LANES 13 again, committed while writing about it.

**And the "null-derived operator pointer cached at 0x2003163c" step of the N5
chain does not survive measurement**: that word holds the answer to a
DIFFERENT ROM lookup ('L3'), and it is not null. Whatever produces 0, it is
not that.

**A SECOND ROM-TABLE FINDING, 2026-09-10, and it is the other half of the
Kaluma story.** lego-ac reports the `--blink` path busy-looping in
`rom_table_lookup` itself, at 0x100, entered from 0x1000463f with a garbage
table and code. Read against the routine: **the scan was unbounded.** It walked
four bytes at a time until it read a zero halfword, with nothing to stop it —
so a bad table pointer is not a slow lookup, it is a HANG, and `adds r0, #4`
wraps r0 around 32 bits rather than terminating.

A function whose contract is "returns 0 when the code is not present" could not
honour that for a bad table. It is bounded at 255 pairs now — 1020 bytes, far
past the SDK's largest table at about fifteen entries — so a legitimate call
cannot reach the bound and a bad one gets the documented miss.

**THIS DOES NOT EXPLAIN WHY THE POINTER IS GARBAGE**, and the caller's bad
argument is still open. What it does is convert an undiagnosable hang into a
defined 0, which is exactly where the SF table went: the value of the change is
that the next person sees a miss instead of a machine that stopped.

**NOT ESTABLISHED, and stated so nobody builds on it:** no SF entry is entered
in 2.5M instructions — but the probe never drives the REPL, so that is a fact
about BOOT. `2.5+1.0` is only evaluated when JS runs. Reading it as "the
arithmetic never calls the table" would repeat the same error one step out.
The decisive run drives the REPL against this sha, where three outcomes are
now distinguishable: 3.5 (works), NaN (a still-stubbed operator), 0
(delivered and still wrong, with much less left to hide).

**HOW THE TWO HARD ONES WERE DONE.** `fmul` needs a 24×24→48-bit product on a
core whose multiply keeps only the low 32 bits, so it is four 12-bit partial
products reassembled with an explicit carry — and the first version treated
`ah*bh` as the HIGH WORD rather than the coefficient of 2^24, which returned
exactly twice the right answer. `1*1 = 2` showed it; `3*5` would not have.
`fdiv` has no divide instruction to use, so the quotient is produced one bit
per iteration by shift-compare-subtract, with the FINAL REMAINDER as the sticky
bit — that remainder is the only thing distinguishing a quotient that
terminates exactly from one that does not, and it is what breaks the tie.

**THE SF TABLE IS ELIMINATED AS THE CAUSE OF KALUMA'S ZERO (2026-09-07).**
lego-be re-ran the REPL probe on a tree carrying all four operators (the
vendored bootrom grew 22,009 → 50,440 bytes) and `2.5+1.0` STILL answers 0.
Under the three-way key that is decisive: **not NaN**, so not a stubbed entry;
the table is found, graded and reachable; the answer is unchanged. Whatever
produces the zero, it is not this table.

The chain is worth keeping as a shape, because every step was wrong in a
different way and each was retired by measurement rather than argument:

```
  lego-be   0 and not NaN                     right, and the useful fact
  me        "therefore not reached"           wrong -- inference from a
                                              component to a path
  me        direct lookup read: 'SF' -> 0x3a0 retires "not reached"
  lego-be   all four operators, still 0       retires the table itself
```

**WHERE TO LOOK NEXT, from this repo's own boot trace.** Kaluma makes fourteen
`rom_table_lookup` calls and they are exactly the SDK's standard startup set —
`P3` popcount32, `L3` clz32, `T3` ctz32, `R3` reverse32, `MS`/`MC`/`S4`/`C4`
the memory routines, `IF`/`EX`/`FC` the flash routines, and `SF`. **`SD`, the
soft-DOUBLE table, is never asked for.** So the double routines are not coming
from ROM, and the single-precision table we supply is the only float path this
build takes from us.

That makes the next measurement specific rather than exploratory: instrument
the SF entry-hit counter DURING a REPL evaluation, not during boot. If `fadd`
is never entered while `2.5+1.0` is evaluated, the expression is not reaching
the ROM float path at all and the zero belongs to the interpreter or the
formatter — and `1.5+1.5` printing `3` while `2.5+1.0` prints `0` would
separate those two in one line. This repo's probe boots and stops; the harness
that drives the REPL is lite's.

**REMAINING: NOTHING.** This paragraph read "`fsqrt`, the float↔fix/uint
conversions, and the transcendentals ... all are still the stub" until
2026-09-10; every operator it named is now implemented and graded. Only the
three deprecated slots are still the stub, and they have no operation to
implement.

What landed: `'SF'` now resolves to a real 21-entry table at the datasheet's
layout (§2.8.3, indices 0..16 cross-checked against two independent sources
that agree; 21+ are V2/RP2350 and are not emitted). Every entry points at one
stub that returns a quiet NaN, `7FC00000h`, and RETURNS. `ROM_DATA.SOFT_FLOAT`
is exported so callers and tests name the code rather than `0x4653`.

What that buys is NOT a float unit. It is that a caller reaches a routine
instead of dereferencing null: **a hang becomes a defined, recognisable wrong
answer**, and any NaN out of an operation on finite inputs came from here. The
previous reasoning — that answering `'SF'` with zeros would turn a clean miss
into a jump to 0 — was right about ZEROS and wrong about the conclusion. The
fix is a table whose entries are not zero.

`test/rp2040-bootrom.test.mjs` pins it, including one test that asserts
**2.5+1.0 is NOT 3.5**. That is deliberate: implementing `fadd` must BREAK that
test, so whoever does it has to come and record which operator now works rather
than leave a stale claim standing. Reach verified by zeroing the entries — 3 of
the 4 new tests go red naming the defect.

**WHY IT STOPS HERE, stated so the next person does not rediscover it.** The
remaining work is IEEE-754 single-precision add, multiply and divide
hand-written in Thumb-1, on a core with no FPU, no divide instruction and no
CLZ, each agreeing with an oracle at the rounding edge. That is the real task
and it is a large one.

**AND THE EASY ROUTE IS A TRAP.** `rp2040js` exposes `onBreak`, so the
operators could be implemented in the host and called out to through a
breakpoint. That would be far less work and much worse, because the DoD's test
is agreement with JavaScript's `Math` — and a JavaScript implementation tested
against JavaScript's `Math` measures itself. It would pass completely and prove
nothing. LANES 13, in the one place where taking the shortcut would also
destroy the evidence that the shortcut was taken.

**DEFINITION OF DONE**, from lego-ac, recorded as given:

- a real clean-room single-precision soft-float table behind `'SF'`, covering
  at least the operators Kaluma's number path calls — an empty or zero table
  only moves the crash
- the datasheet section cited at the implementation
- tests that each implemented operator agrees with JavaScript's `Math` on a
  vector set including the IEEE edge cases we choose to support, and that
  REFUSES BY NAME on the ones we do not
- then lite's `node scripts/probe-pico-kaluma.mjs --eval` shows `3.5` and
  `--blink` drives GP25 high, and the JS-on-Pico matrix cell flips

The third bullet is the one that keeps this honest: partial IEEE support is
fine and pretending to total support is not, so the refusal list is part of the
deliverable rather than an omission from it.

**Evidence:** `docs/PICO-KALUMA-BOOT.md` on brickwright-lite main, probe
`scripts/probe-pico-kaluma.mjs`, UF2 pinned by sha256. Nothing in lite waits
on it.

### R4 The ROM stamps `BSD-3` into its own image, and this repo is MIT

**Found here, 2026-09-07, while verifying lite's gates. NOT FIXED — the
resolution is the owner's call and it changes ROM BYTES, so it must ride with
the next geometry change rather than land alone.**

```
  bw-board          LICENSE + package.json   MIT
  brickwright-lite  LICENSE + package.json   BSD-3-Clause
```

Two places in `rom/bios.asm` say BSD-3 about this repo:

- line 14, in the licence rationale: *"every open-source PC BIOS is GPL-3
  (GLaBIOS, skiselev/8088_bios); **this project ships under BSD-3**, so
  adopting one is not available"*
- line 477, `rom_note`: a string **inside the assembled image** reading
  *"BSD-3, written from the documented interface. No BIOS code copied."*

The ARGUMENT is unaffected — GPL-3 is incompatible with MIT and BSD-3 alike,
so "adopting one is not available" holds either way, and the clean-room claim
stands. What is wrong is the licence NAMED, and the second instance is a
licence notice compiled into a distributed binary rather than a comment.

The likely history is that both sentences describe the downstream product:
lite IS BSD-3, and the ROM is vendored into its bundle. But MIT code included
in a BSD-3 bundle stays MIT; it does not become BSD-3 by being shipped there,
so stamping BSD-3 on an artefact this repo produces is inaccurate wherever it
ends up.

**Two resolutions, and choosing is the owner's, not this file's:** correct the
text to MIT, or deliberately license the ROM BSD-3 with a per-file header
saying so. They are different decisions with different consequences and both
are defensible; what is not defensible is the current state, where the repo
LICENSE and the artefact disagree.

**WHY IT WAITS.** Changing `rom_note` changes the assembled bytes, and lite now
RUNS the shipped ROM in two gates (verified against lite `origin/main`,
2026-09-07): `test/i8086-bios-boots.test.mjs` asserts the no-media screen text
and EOT 9 / 18 through INT 1Eh, and `test/i8086-bios-source-provenance.test.mjs`
re-assembles the vendored `rom/bios.asm` with lite's own assembler and compares
bytes — and asserts the manifest's source licence is `MIT`, which is CORRECT
and is the check that makes the discrepancy visible. Any byte change forces a
re-vendor, so this should land in the same commit as the CMOS/equipment-word
/3F7h work rather than costing lite a second pin bump for a string.

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

8. **E8** — PARKED (owner, 2026-09-25). Starts only after the RISC-V oracle and
   performance lane lands; order inside it is E8.1 → E8.4 → E8.2 → E8.3 → E8.5 → E8.6.

Cross-repo dependencies: bw-circuit-ui X1.1 (SPICE import) wants E3.5; X2.x runners
want E1.5; the AC UI wants E2.1. brickwright-lite re-vendors via `sync:bwboard` after
each landing.
