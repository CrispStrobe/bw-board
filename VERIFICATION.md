# What this engine actually verifies

**Nothing in this engine has been validated against real silicon.** Silicon is
the only source independent of every document we have read. Two emulators
agreeing, or a model matching ngspice, is evidence — it is not hardware.

This document classifies claims per the canonical taxonomy in
`stc/docs/EVIDENCE-CATEGORIES.md` (Cat 1: independent-source, Cat 2:
same-source, Cat 3: single-implementation). The classification matters:
same-source agreement catches transcription slips but **cannot catch a
shared misreading of the source**.

## 1. Verified against a datasheet or measurement

These numbers have a citation. They are as good as the source.

| Claim | Source |
|-------|--------|
| Quasi-bidir pin sources ~230 µA (actual 150–250 µA) | STC12 datasheet §4.1 port mode tables |
| Push-pull sink ~20 mA | STC12 datasheet §4.1 + §4.8 |
| Chip total: "had better drive lower than 120 mA" | STC12 datasheet §4.1 intro (guidance, not absolute max) |
| R_STRONG = 25 Ω | Derived: 5V / 200mA (10 pins × 20mA absolute max) |
| R_QUASI_PULLUP = 21700 Ω | Derived: 5V / 230µA |
| R_INPUT_PULLUP = 35000 Ω | AVR datasheet: 20–50 kΩ range, midpoint |
| LED Vf ≈ 2.0 V (default) | Standard red LED forward voltage (typ) |
| 555 timer thresholds 1/3 and 2/3 VCC | NE555 datasheet (original Signetics, all subsequent) |
| LM7805 dropout 1.5 V | LM7805 datasheet (TI/ON Semi) |
| LD1117V33 dropout 1.1 V | LD1117 datasheet (STMicro) |
| TMP36: 10 mV/°C + 500 mV offset | TMP36 datasheet (Analog Devices) |
| TIP120 Vbe ≈ 1.4 V (2× junction) | TIP120 datasheet (Darlington pair) |
| 74HC CMOS thresholds: 30%/70% VCC | 74HC family datasheet (VIL/VIH specifications) |
| Per-port 80 mA | 8051 family guidance (NOT in STC12 datasheet) |

## 2a. Independent-source agreement (STRONG)

Two implementations whose information came from **different places** — a
different upstream codebase, an independent reference solver, or a physical
measurement. This is the strongest cross-check short of hardware.

| Claim | Evidence | Why independent |
|-------|----------|----------------|
| 347-image corpus: zero genuine disagreements between emu8051-stc and ucsim-stc | ucsim-stc `c6e3cea` | **Different upstream projects** — emu8051 (jcmvbkbc/emu8051) and ucsim (sdcc.sourceforge.net/ucsim) are forks written by different people years apart. Agreement here is closer to hardware verification than any other evidence in this project. |
| 70 ngspice golden circuits agree (stated tolerances per test) | `test/golden/ngspice_*.json` | **Independent reference solver** — ngspice is a mature open-source SPICE implementation with decades of validation. Our MNA solver was not derived from it. |
| LED brightness: emu8051 PCA → adapter → board = **0.07248**, analytic = **0.07246** (0.03%) | `test/brightness-emu8051.test.js` | **Cross-boundary check** — emu8051's PCA model (C, stc12.c:543) and bw-board's brightness integrator (JS, board.js) were written independently by different agents. The adapter bug (all edges at time zero) was found by this check — self-consistency could not have found it. |

## 2b. Same-source agreement (catches transcription, NOT misreadings)

Two implementations both derived from **the same document** or from each
other. Catches arithmetic errors, transcription slips, and drift. Genuinely
useful. **Cannot catch a misreading of the source.** The four-codebase
polarity agreement is the clearest example: all four read the same vendor
animation tables.

| Claim | Evidence | Shared source | What would move it to 2a |
|-------|----------|---------------|--------------------------|
| Servo pulse width: emu8051 1500.0 µs, ucsim 1499.6 µs at 90° (0.4 µs spread) | `test/servo-e2e.test.js`, `cce2192` | Both emulators' PCA dispatch was fixed **after exchanging findings** (IE.6=ELVD, vector=0x3B) within the same hour. They converged, they did not arrive independently. The **derived value** (1500 µs = FOSC/12 counts × period) is the real anchor — arithmetic fixed before either emulator ran. | A frequency counter on the real CEX0 pin |
| Cube polarity: active-HIGH assumed by all four codebases | bw-board, bw-circuit-ui, emu8051-stc trace, sb3-creator kernel | **Same vendor animation tables** — all four derived from the same tables, so a shared misreading produces identical agreement | A photograph of a lit LED at `(FE, 01)` on real hardware. Pre-registered prediction: one LED lights. |
| Cube brightness: bw-board and bw-circuit-ui agree on 64 voxel values | `test/golden/cube-trace.js` | Both derive from the same duty model (12.5% = 1/8 scan lines) | A current measurement on a real cube during a known scan pattern |
| PCA PWM rate: 7.2K edges/sec | bw-board perf budget + ucsim-stc PCA model | Both derived from `SYSclk/12/256` = same datasheet arithmetic | A frequency counter on the real CEX0 pin |
| Closed-form RC matches MNA transient (±5%) | `test/cross-validate-transient.test.js` | Both are our own code, using the same physics | An oscilloscope on a real RC circuit |
| 555 astable period within 3% of analytic | 214ms vs 207.9ms | Both use the same 0.693×RC formula | An oscilloscope on a real 555 circuit |
| 55 Python-computed oracle values match | `test/golden/oracles.json` | Python oracles and JS solver both implement the same equations | — |
| Serial codec: 5 implementations agree on wire format | emu8051-stc bridge test | All five read `live-proto.h` | A logic analyser on the real UART |
| Determinism: bit-identical waveform twice | `test/determinism.test.js` | Same code, same inputs | (Internal consistency, not a cross-check) |

## 2c. Single-implementation assertion (weakest)

One model, no cross-check. Honest and weakest.

| Claim | Evidence |
|-------|----------|
| Boundary A conformance: 10/10 against real emu8051-stc WASM | `test/conformance-real-wasm.test.js` — tests that the adapter satisfies the contract, not that the contract matches hardware |

## 2d. The 8086/8088 tier, claim by claim (added 2026-09-04)

The tier is young and its evidence is unusually uneven — some of the strongest
in this repo beside some of the weakest — so it is tabulated in one place
rather than inferred from which grinder happens to exist.

**Read the TIER column, not the percentage.** A 100% at tier 2c is one
implementation agreeing with itself.

| Claim | Tier | Evidence | What would raise it |
|---|---|---|---|
| `i8086.js` architectural state | **2a** | 646,000/646,000, SingleStepTests 8086, hardware-generated on an Intel P80C86A-2 | nothing — this is the ceiling |
| `i8086-disasm.js` text **and** length | **2a** | 646,000/646,000 against the suite's own disassembly strings, 3 documented exclusions | — |
| 80186 added opcodes | **2a** | 132,532/132,532, SingleStepTests **v20** | a real 80186 suite, which does not exist |
| 80186 shift-count masking | **2c** | `test/i8086-186.test.mjs` only | **nothing can raise this.** The V20 does NOT mask, so the oracle actively disagrees; 39,898 vectors are excluded by name |
| 80186 reg=6 as SHL | **2b** | v20 agrees, and period 186 docs call the field reserved | an 80186 suite |
| Trap flag (TF) | **3** | behavioural tests + period binaries | **no vector in 646,000 sets TF.** DEBUG.COM's `t` is the acceptance and is owed |
| Cycle counts | **2a, 36.5%** | SingleStepTests 8088 v2 bus traces | the remaining error is in T-states invisible to the m-cycle count — see ROADMAP E6.8.4d |
| Bus access **order** | **2a** | 152,000/152,000 | — |
| Queue ops F/S/E | **2a** | 152,000/152,000 | — |
| 8254 PIT | **2a (partial)** | v86 differential: ours is datasheet-complete where v86 lacks read-back | `dbalsom/arduino_8253` — a reference emulator built against a REAL chip, MIT, and unused |
| NS16C550 UART | **2a** | v86 differential, scratch register byte-for-byte | broaden the probe set |
| 8259 PIC, 8237 DMA | **2b** | datasheet + our own tests; MartyPC read as reference | MAME's BSD-3 device files |
| 8251 USART | **2b** | datasheet + one MIT demo's init sequence | MAME `i8251.cpp`, the only permissive spec-grade reference |
| uPD765 FDC + DMA | **2a** | MS-DOS 2.0 boots down TWO independent paths (INT 13h service layer vs real FDC over DMA) with byte-identical screens — that differential found the DMA pump moving zero bytes while reporting success | — |
| CGA renderer | **2b** | pixel layout written twice and cross-checked | — |
| Audio: tone vs samples | **2b** | the two contracts must agree; caught an octave error in the OPL on its first run | ymfm as a second oracle for the OPL |
| `i8086-asm.js` | **2a** | 510/525 MASM corpus; MASM refuses 14 of the 15 rejects | — |
| Extractor refusals | **2c** | our own tests | — |

**The two gaps worth naming as gaps.** The 186 masking cannot be raised above
2c by any existing artefact — that is a property of the world, not a to-do.
The trap flag sits at tier 3 with a named acceptance test that has not been
run. Everything else in the table has a path.

## 3. Asserted but unverified (engineering assumptions)

These numbers are plausible and internally consistent, but no source is cited.
They are the first things to check on a bench.

| Claim | Basis | Risk if wrong |
|-------|-------|---------------|
| Relay coil R = 200 Ω, pull-in 3.7 V, drop-out 1.5 V | Typical 5V relay (SRD-05VDC) | Relay timing in sim ≠ real |
| Motor winding R = 10 Ω, kV = 0.01 V/(rad/s) | Order-of-magnitude for small DC motors | Speed/current predictions off |
| Servo slew rate 300°/s | Typical hobby servo (SG90 spec: 60°/0.1s = 600°/s; we're conservative) | Angle arrives late in sim |
| 74HC output impedance 50 Ω | Order-of-magnitude for CMOS push-pull | Fan-out voltage predictions |
| Buzzer staleness threshold 100 ms | Arbitrary — chosen so a stopped PWM goes silent | Could be too short for slow tones |
| LDR log-interpolation between rDark/rLight | Approximation of CdS cell characteristic | Non-monotonic in reality at extremes |
| NTC exponential interpolation | Simplified Steinhart-Hart | Accurate ±5% over a limited range |
| Encoder quadrature at 1ms sub-step resolution | Limited by advanceTo sub-step interval | Misses edges faster than 1kHz |
| Piezo capacitance ~20 nF | Typical for small piezo discs | Impedance at audio frequencies |

## 4. Known not modelled

These are limitations, stated so nobody discovers them on a bench.

| What | Why | Consequence |
|------|-----|-------------|
| **Baud rate** | Emulator delivers UART bytes immediately (documented in emu8051-stc UART-ENTRY-POINTS.md) | A monitor that passes in emulation may be silent on silicon due to BRT mismatch |
| **Temperature** | All models assume 25°C | Threshold voltages, resistances, and forward drops drift with temperature |
| **Component tolerance** | All values are nominal (no ±5%, ±10%) | Two circuits with "the same" resistors behave identically in sim, not on a bench |
| **Parasitic capacitance/inductance** | Wires and PCB traces have no parasitics | High-frequency behavior (>1 MHz) is not meaningful |
| **Thermal runaway** | No thermal model for transistors or power devices | A transistor that would destroy itself on a bench runs fine in sim |
| **Capacitor ESR** | Ideal capacitors (no series resistance) | Affects switching regulator behavior and decoupling |
| **Inductor core saturation** | Linear inductance only | Real inductors saturate and the inductance collapses |
| **Op-amp slew rate** | The DEFAULT ideal op-amp changes instantly within rail limits; `params.model: 'macro'` (spec-updates/opamp-macromodel.md) does model GBW and slew | Fast signals are perfectly reproduced unless the bench opts in |
| **Digital input loading** | Logic and high-Z analog inputs draw NOTHING — no input resistance, no leakage, no pin capacitance (spec-updates/ideal-high-z-inputs.md). 178 declarations claimed a 1 MΩ load and none of them ever stamped; the ideal input was adjudicated the right teaching-tier model rather than the number being repaired | A pull-up feeding a logic input reads the full rail. A real 74HC input's ±1 µA leakage, and the divider error it causes with a multi-megohm pull-up, are invisible |
| **Power dissipation / magic smoke** | No thermal limits | A 1/4W resistor dissipating 10W is fine in sim |
| **Propagation delay in logic gates** | Gates respond in zero time | Glitches from race conditions are invisible |
| **MOSFET gate charge** | Instant switching | Real gate drive speed not modelled |
| **Diode reverse recovery** | Instant off | Switching losses invisible |
| **Transmission-line and core-saturation effects in transformers** | Coupled inductors and transformers ARE modelled (E3.4, spec-updates/coupled-inductors.md); leakage beyond the coupling coefficient and core saturation are not | An ideal-enough transformer, but not a real core |
| **Transmission line effects** | Not modelled | No reflections or impedance matching |

## The principle

A limitation stated where it can be seen costs nothing. The same limitation
discovered after a bench session costs hours. Every entry in section 4 is a
possible answer to "why doesn't my real circuit match the simulation?"

Agreement between models is evidence. Agreement between models that read
the same document is weaker evidence. Silicon is the only test that is
independent of every document we have read.

## Rule: category 2 cannot discharge a prediction

A pre-registered prediction (BENCH-SESSION.md) is itself category 2 — it
was derived from the same models and the same datasheet as the engine.
Re-deriving the same number in an emulator checks that we transcribed
consistently, not that the chip behaves that way. Only a category 1
measurement (real silicon, scope trace, photograph) can discharge a
prediction. This is the polarity observation applied to the bench list:
four codebases agreeing from the same source cannot confirm each other,
and neither can a prediction confirm itself through the model that made it.

## Empirical case: a category 2 check that passed while one side was wrong

On 2026-08-10 the limitation above stopped being an argument and became a
record. See `stc/docs/EVIDENCE-CATEGORIES.md` § "The case that made this
concrete" (`3a72635`).

bw-circuit-ui cross-checked terminal definitions against bw-parts' 115
sidecars. It passed. bw-parts' MCU sidecar carried the generic 8051 pinout
with wrong pin names (pin 10 = `rxd` instead of `P3.0`, pins 29–31 =
`psen`/`ale`/`ea` instead of `P4.4`/`P4.5`/`P4.6` GPIOs — signals the
STC12 does not have). The cross-check excluded MCU as "deliberately
different", so the one part carrying a real error was the one part not
compared. Category 2 agreement was perfect while one side was wrong.

What found it: bw-parts checking its own sidecar against `docs/PINOUT.md`
and the datasheet — a source, not another agent. Three lessons:

1. Category 2 agreement can be perfect while one side is wrong.
2. Every exclusion in a cross-check is an unchecked claim.
3. Going to the source is not ceremony — it was the only thing that worked.

## Rule: assert the property, not the symptom

Testing for the absence of the specific wrong thing catches only the wrong
thing you already thought of. Asserting what something IS catches the whole
class of errors, including the one nobody imagined.

In this engine:
- `getWarnings()` documents all five warning types it can emit. The UI
  asserts against the published list, not against the absence of a specific
  unknown type. A new warning type that is not in the list fails the
  contract rather than being silently dropped by a filter.
- The current-ratings classification test asserts that every `null` kind is
  in the explicit `CIRCUIT_DEPENDENT` set — not that "resistor is not null".
  A new kind returning `null` by accident fails the test.
- The non-convergence check asserts that `converged` is tracked and surfaced,
  not that a specific circuit doesn't produce NaN. Any circuit that diverges
  gets a warning, not just the ones someone thought to test.

The MCU pin-map case made this concrete: asserting "PSEN is absent" would
pass a sidecar with every pin shifted by one, or P0 ascending, or `rxd`
where `P3.0` belongs. Asserting "pin 32 IS P0.7 and P0 runs descending"
catches all of those. Three agents found this rule independently in the
same evening; it is a property of good tests, not a style preference.

## Rule: a property nothing drives is a property nothing tests

The rule above is about what a test ASSERTS. This one is about what a test
REACHES, and it is the more dangerous of the two, because a test that asserts
the right property over a code path nothing exercised is indistinguishable
from a passing test. It is green, it is specific, its name says what it
checks, and it checks nothing.

Six instances landed in a day, from three different hands, and it is the
spread — and where the last two were — that makes it worth a section rather
than a note:

| Where | What it looked like | What it was |
|---|---|---|
| Cross-CPU machine contract | A snapshot/restore lockstep test, green on the first run, its comment claiming it caught "a snapshot missing one chip's internal counter" | Deleting BOTH snapshot branches from `i8086-machine.js` left it green. The CPU executes whatever memory reads as and never touches a port, so no chip state ever reached the trace. |
| Two INT 10h scroll tests | Assertions about a scrolled window, passing for weeks | They stood on the trap page by writing `cpu.cs = 0xf000` by hand. Once the page moved they were asserting against a `service()` that had correctly declined to run — and only then went red. |
| Two DOS services | `INT 21h/3Eh` and `/41h` returning success | They returned success *unconditionally*, so closing a handle never opened and deleting a file that was not there both looked like they worked. |
| A µPD765 draft | Imported cleanly, exported its whole surface, answered invalid commands correctly | Its dispatch refused EVERY implemented command, because `undefined` is falsy. A smoke test would have passed it. |
| `NO_PERSISTENCE`, the exemption list in the machine contract | Shipped with a commit message and a note to another lane both stating that a chip gaining `getState()` would turn the suite red, so the row would have to be deleted | It would not have. The coverage assertion only fires for a chip with NO snapshot method; one that GAINED a method sailed past into the passing path, leaving the exemption standing forever. |
| The 6551's "the snapshot COPIES the queue rather than sharing it" assertion | A specific claim about aliasing, in a test written to close a real gap | It ran through the machine's snapshot, which serialises via `JSON.stringify` — and JSON copies everything, so the assertion could not fail however the chip behaved. Mutation proved it: replacing `this.rx.slice()` with `this.rx` left it green. |

The fifth is the one to read twice. It is in the instrument built to catch
this pattern, it was found by that instrument's own author, and the part that
did not exist was precisely the mechanism offered as the reason it was safe to
RECORD a gap rather than fix it. It was not found by review: it was found
because a second lane asked whether three instruments doing the same thing
constituted a house pattern, and answering required checking that they did.


The shape is the same each time: **something that looks right because nothing
ever asked it to prove otherwise.** Note that five of the six were found by a
change from an unrelated direction — moving an address, deleting a branch to
see what noticed, being asked to generalise, mutating a chip to check that an
assertion could fire — and none by reading the tests.

The last two are worth reading together. Both are assertions that were CORRECT
about their property and placed where the property could not vary: the
exemption check ran only on the branch where nothing had healed, and the
aliasing check ran only downstream of a serialiser that copies
unconditionally. Neither is a wrong assertion; both are right assertions on a
dead path. **Counting across both lanes, two of the eight instances seen so
far are "the test supplied, or neutralised, the very thing it was checking"** —
which is the most useful number on this page, because it says where to look
first.

What follows in practice:

- **Prefer structural coverage to hoping execution drives it.** The machine
  contract now asserts that every chip on a machine either round-trips or is
  NAMED as one that cannot, instead of hoping the instruction stream touches a
  port. That assertion found two chips — `NS16C550` and `W65C51` — whose state
  is silently dropped from every snapshot, which the lockstep test could never
  have reached however long it ran.
- **Delete the thing the test depends on and check it goes red.** Not the
  behaviour under test — the *path to it*. A test that survives having its
  subject removed did not have one.
- **A gate that has been green for a long time is where to look**, for the
  same reason a long-red one is: nobody re-reads either.
- **The pass that audits claims is itself where claims get made.** The
  over-matching guard in `grind-i8086-disasm.mjs` was written specifically to
  catch an exclusion key that matched too much, and in its first version could
  not fire — inside the block that was replacing a key for exactly that
  defect. Only mutating it found that.

### The near relative: a test that supplies what production forgets

The rule above catches a property with NO driver. This one has a driver — the
test is it — and that is why it needs a section of its own rather than a sixth
row in the table.

**The case.** The floppy DMA pump moves zero bytes and reports complete
success: normal termination, `CF=0`, `AH=00h`, a full result phase, an
interrupt raised, and the destination buffer untouched. `I8237.transfer()`
serves only a channel whose `requesting()` is true; that needs `dreqLevel`;
`dreqLevel` is written in exactly one place, `dreq()` (`src/i8237.js:260`,
`:458`); and no production path calls it — `grep dreq src/*.js` outside the
chip returns nothing. Reproduced against the chip alone, programming a channel
exactly as a floppy read programs it — flip-flop cleared, mode `46h`, address,
count 511, unmasked:

    WITHOUT dreq: moved = 0   bytes landed = 0
    WITH    dreq: moved = 1   bytes landed = 1

**The tell, and the reason it is a different species.** All three tests in
`test/i8086-dma-pump.test.mjs` call `dma.dreq(n, true)` FROM THE TEST. The
suite is green, and it is green because the setup block performs the step the
production caller omits. The test is not failing to exercise the code; **it is
standing in for the missing part of it**, which is exactly why it reads as
exemplary rather than as thin.

Every check in the section above fails to catch this. Delete the feature and
the test goes red, as it should — so mutation passes it. Ask "does anything
drive this property?" and the answer is yes. The pump would survive every one
of those questions while being pure ceremony, as it currently is.

**The question that does catch it: does anything OUTSIDE the test establish
this precondition?** A test that sets up a state no production caller ever sets
up is a test of a machine that does not exist. In practice:

- For each line of a test's SETUP, name the production code that performs the
  same step. If there is none, the test has invented the machine it is testing.
- The setup block is the half nobody re-reads. Both this and the µPD765 draft
  arrived from there rather than from an assertion, and reviewers' attention
  goes to assertions.
- A green test around a feature that has never been exercised END TO END is
  worth less than it looks. This one was found by asking what the caller does,
  not by reading either the test or the chip.
- **For duplicated CONFIG, import beats asserting equality.** Three copies of
  one XT machine config existed across tests and the shipped preset, and had
  drifted far enough that CGA writes to `B800:0000` landed in unmapped space on
  the board users actually load. The fix was to delete the copies and import
  the shipped one: an equality assertion would have left two hand-maintained
  copies in place and fired only once the second was already wrong. Contrast
  the machine-layer case, where a contract TEST is right because the three
  implementations are genuinely different code that must agree on behaviour —
  not one value that should exist once.

**FIXED IN `1c3a145`**, and verified the way this file asks for: not by
reading, but by breaking it again. With the fix, the FDC suites are 34 pass /
0 fail; with the two `dreq()` calls removed, 15 pass / 19 FAIL. A species
entry has no "fixed" state to read, so an entry that began as a live bug says
where it was closed — otherwise the write-up outlives the defect and the next
reader files it again.

**AND THE SECOND HALF IS WORSE THAN THE FIRST.** The lane's own FDC tests
carried DREQ shims — in `test/bios-fdc.test.mjs` and `test/dos-boot-fdc.test.mjs`,
each documented, deliberate, idempotent, and commented as harmless once the pump
was fixed. Every word of that was true, and it was exactly the problem: an
idempotent shim keeps the suite green whether or not production works, so an
MS-DOS boot test would have gone on booting after a revert of the very code it
exists to prove. Deleted in `d531056`, and the 19 failures above are the
evidence they are gone.

**The shim was written by the lane that then found the bug.** That is the
strongest available form of the point, and it is why "does anything outside
the test establish this precondition" has to be asked of one's own setup
blocks first. A helper added in good faith, with a comment explaining why it
is safe, is indistinguishable at review time from one that is load-bearing.

Credit where it is due: this was found and diagnosed by the support-chip lane,
who also insisted it be written as a separate species rather than folded in.
It was reproduced independently here before being recorded, per the section
above — reading got two things wrong on the day this file was written.

### Rule: a verdict rests on a count and an artefact, never on words

Two lanes arrived at this from opposite directions on the same day, which is
why it is a rule rather than a preference.

**From the failure side.** `test/sap1-digital-parity.test.mjs` decided whether
an external simulator agreed with a truth table by asking
`out.includes('passed')`. Measured, with one correct row and one wrong row in
the same element, that simulator prints:

    unnamed: passed
    unnamed: failed (50%)
    ... Tests have failed.

so the substring is present for a run that FAILED. What had been protecting the
gate was the tool exiting non-zero — an undocumented coupling the check was
silently riding on. Harmless until the tool exits 0 with a mixed result, and
invisible until someone reads the helper.

**From the success side.** `scripts/oracle-masm.mjs` decides whether MASM
succeeded from two independent signals, neither of them a word: **a number the
tool itself prints** (the severe-error tally) **and the existence of the output
artefact** (`T.OBJ`). Its regex for pulling diagnostics out of the transcript is
used only for the REPORT — if MASM changed its error format tomorrow the report
would go quiet and the verdict would not move. And the unreadable case falls
safe by construction: no tally means `severe = -1`, and `-1 !== 0` is a
failure, so a transcript the code cannot parse is treated as a refusal rather
than a pass.

The rule:

- **Words are the report. A count and an artefact are the verdict.** A tool's
  prose is a UI that changes between versions; the number it prints and the
  file it produces are the things it is actually claiming.
- **Never let one expression be both.** `out.includes('passed')` was doing
  double duty, which is exactly what hid the problem: it read like a verdict
  and behaved like a report.
- **Make the unparseable case fail.** If the verdict cannot be extracted, that
  is a refusal, not a pass. `severe = -1` on a missing tally is the shape.
- Substring matching cannot tell a partial success from a total one, any more
  than it can tell an escaped quote from a live one — which is the same lesson
  the disassembler's exclusion key learned, in a different file, from a
  different direction.

### Rule: an average over a skewed distribution hides a cliff

The corpus harness died at V8's 900 MB heap limit and the diagnosis went
astray for a day on one measurement that was CORRECT.

Peak RSS was sampled at N=50 (71 MB) and N=150 (117 MB), giving ~0.45 MB per
program — from which "roughly constant per program, therefore a retained
object graph" was written into a commit message. The arithmetic was right. The
inference was wrong, and it was wrong because **the sample stopped one program
short of the cliff**: the runaway sits between n=150 and n=175.

What the distribution actually looks like, measured across all 525: total
captured output **6.9 MB**, of which **two programs produce 98.4%** — 3.95 MB
and 2.84 MB — and every other program contributes a few KB.

**`525 × 0.45 MB` and `2 × 40 MB` produce the same average and want completely
different fixes.** One says hunt a referrer; the other says cap a string. A day
went into the first.

- **A per-unit average asserts that the units are alike.** When they are not,
  it reports a gentle slope and hides a cliff, and it does so most convincingly
  when the sample happens to miss the outliers.
- **Look at the distribution before dividing.** A max and a top-few list cost
  nothing and would have shown this immediately; the mean cost a day.
- **A confident mechanism inferred from a linear fit is a sampling artefact
  until the tail is checked.** "Roughly constant per program" was the whole
  basis for "retained object graph", and it was an artefact of where the
  sampling stopped.
- The corroborating detail is worth keeping: slimming the retained reports
  recovered 5%, which read as "close, keep going" and was really "reports are
  genuine garbage, and garbage was never the problem".

The proof that settled it was not a better average but a different
measurement: forcing GC every 25 programs and printing post-GC `heapUsed`,
which stayed flat at 5.4 → 6.3 MB while RSS climbed 60 → 83 MB. Nothing was
retained at all.

### Rule: a probe that fails to run looks exactly like a probe that found nothing

Seven measurements in one day produced a confident wrong answer, all from
different tools, and every one of them either **read a plausible number out of
the wrong field** or **returned a green from a check that never executed**:

| The probe | What it reported | What was true |
|---|---|---|
| `cmd \| tail; rc=$?` | exit 0 | `$?` was `tail`'s status, not the command's |
| `find -newermt '-3 hours'` | zero files changed anywhere | that syntax misparses and matches nothing |
| `awk '{print $NF}'` over `git worktree list` | a duplicate branch in all three repos | it was counting `HEAD)` from detached worktrees |
| `ps -eo pid,etime,rss \| awk '{print $1/1024}'` | 3142 MB resident | a PID divided by 1024 |
| assembling `lock` and `byte [bx]` | two encoder defects | a prefix disassembled alone, and NASM syntax where MASM wants `byte ptr` |
| `sed 's/old/new/'` used as a mutation | mutation caught, control green | the pattern never matched; the edit never landed |
| `bash -c '... $IN ...' IN=value` | a 20-minute run with an input stream | `IN=value` set `$0`, so `--type` got an empty string |

**The shape is always the same: the failed measurement and the successful one
render identically.** That is the same defect this file catalogues in code —
the broken thing and the working thing looking alike — arriving through the
instruments instead.

**A MUTATION PROOF NEEDS ITS EDIT ASSERTED, and this is the important
consequence.** Mutating a source file with `sed` and then observing the suite
is only evidence if the mutation applied — and `sed` silently no-ops on a
pattern that does not match. The addressing-mode sweep in
`test/i8086-asm-encoder-sweep.test.mjs` was "proved" that way and the proof was
void: the table is keyed `'bx,di'` and the pattern said `'bx+di'`.

So, two-sided:

- **Assert that the edit landed. Never infer it from the suite.** An anchor
  assertion is one line and cannot silently pass:

      old = "...the exact text..."
      assert old in s                  # throws before anything is written
      s = s.replace(old, new, 1)

  `grep -c` on the mutated text, or a checked non-zero `sed` exit, do the same
  job. (Adopted here from the other lane, which had been using the anchor form
  to avoid mangling files with regex and found it guards this as well.)
- **A mutation proof that ends in a GREEN proves nothing without that check.**
  One that ends in a RED is self-proving: a red is only reachable if the
  mutation applied. Preferring the red-ending shape is a free habit, and it is
  why "mutate, expect the test to still pass, confirm the check is not
  over-tight" is the dangerous variant to write.

And the general practice, which is cheaper than any of the above:

- **Give a probe a positive control**, something whose answer you already know.
  The `find` bug survived until a directory known to have changed reported
  zero. The PID-as-RSS bug survived seconds because 3 GB was not absurd.
- **Prefer a probe that quotes to one that counts.** A count can be produced by
  the wrong field; a quoted fragment names what it read. That lesson is already
  in this tree from a different direction — `htmlLen=61` was a fact, and "the
  frontend is empty" was an inference laid on top of it.

### Rule: a corpus is evidence only about the constructs it contains

Three of the strongest numbers in this tier are corpus agreements — 470 of 525
programs byte-identical against an independent implementation, 414 files
compared against MASM with zero cases where it accepted and we refused. They
are real evidence and they are narrower than they sound.

The MASM oracle found a defect in our missing-ASSUME rule that the 470 could
never have found. Not because the comparison was weak, but because **the
corpus never writes the construct**: the defect needs a variable in the CODE
segment of a program whose DS points elsewhere, and a `.model small` textbook
program puts its variables in `.data` and points DS at `@data`. Every program
in that corpus does the ordinary thing, so every one of them is silent about
the case that breaks.

Note also how easy the WRONG explanation was to reach. The first write-up said
the corpus misses it "because every program in it is a `.COM`" — plausible,
and false: 498 of the 525 use `.model` and only 12 have `ORG 100h`. A wrong
reason for a right conclusion survives review comfortably, because the
conclusion checks out.

So:

- **A large corpus that is UNIFORM is uniformly silent.** Size is not
  coverage; variety is. 525 programs written to one textbook's house style are
  closer to one test than to 525.
- **State what a corpus agreement is evidence FOR**, which is the slice of the
  language or the hardware those inputs actually exercise — never the whole
  surface.
- **Keep a probe suite beside the corpus.** The corpus tells you the common
  path works; hand-written probes are the only way to reach the constructs
  nobody happened to write. They are not substitutes, and the defect above was
  found by the probe.

## House pattern: an exemption must be able to stop being true

Every instrument in this tier that grades results has an exemption list — a
place to record "this one disagrees and here is why", so a known, adjudicated
difference does not have to be re-litigated on every run. Three of them
arrived independently at the same second half of that idea, which is what
makes it a pattern rather than three coincidences:

| Instrument | Its list | What it does when a row heals |
|---|---|---|
| `scripts/grind-i8086-disasm.mjs` | three vectors where the suite's own `name` contradicts its own `bytes` | prints `HEALED — the suite now agrees, drop this row` |
| `scripts/run-i8086-corpus.mjs` | `KNOWN_DISAGREEMENTS`, programs whose output differs from the reference simulator for adjudicated reasons | prints `HEALED — <name> now agrees; drop its row` |
| `test/machine-contract.test.mjs` | `NO_PERSISTENCE`, chips a machine snapshot silently drops | goes **RED** by name — a test cannot print a note nobody reads |

The rule the three share: **a row must be able to fail, and its failure must
be the row doing its job.** An exemption that cannot notice the thing it
excuses has been fixed is indistinguishable from one that is still needed, and
it will outlive the reason it was written by years — which is worse than
having no exemption at all, because it silently suppresses a real result.

Two practical points, both learned the hard way here:

- **Key the row on the thing being excused, not on a digest of it.** The
  disassembler's exclusions were keyed on the suite's `test_hash`, which
  exists in only one of the two encodings the suite ships; on the other
  encoding the rows excused nothing at all and the vectors would have gone red
  for the wrong reason. The key is now the instruction BYTES, which is what
  the excuse is actually about, and the wrong `name` is recorded beside it as
  data so a re-rendered name still reports HEALED.
- **Check that the healing detector detects.** `NO_PERSISTENCE` was landed
  with a commit message and a note to another lane both claiming that a chip
  gaining a snapshot method would turn the suite red. It would not have: the
  coverage assertion only fires for a chip with NO such method, so a chip that
  gained one sailed past into the passing path and left the exemption standing
  forever. The mechanism offered as the reason it was safe to RECORD a gap
  rather than fix it was the one part of it that did not exist. It was found
  only because a second lane asked whether the three instruments should be a
  house pattern, and writing this section required checking that they were.
