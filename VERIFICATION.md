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

Five instances landed in one day, from three different hands, and it is the
spread — and where the fifth one was — that makes it worth a section rather
than a note:

| Where | What it looked like | What it was |
|---|---|---|
| Cross-CPU machine contract | A snapshot/restore lockstep test, green on the first run, its comment claiming it caught "a snapshot missing one chip's internal counter" | Deleting BOTH snapshot branches from `i8086-machine.js` left it green. The CPU executes whatever memory reads as and never touches a port, so no chip state ever reached the trace. |
| Two INT 10h scroll tests | Assertions about a scrolled window, passing for weeks | They stood on the trap page by writing `cpu.cs = 0xf000` by hand. Once the page moved they were asserting against a `service()` that had correctly declined to run — and only then went red. |
| Two DOS services | `INT 21h/3Eh` and `/41h` returning success | They returned success *unconditionally*, so closing a handle never opened and deleting a file that was not there both looked like they worked. |
| A µPD765 draft | Imported cleanly, exported its whole surface, answered invalid commands correctly | Its dispatch refused EVERY implemented command, because `undefined` is falsy. A smoke test would have passed it. |
| `NO_PERSISTENCE`, the exemption list in the machine contract | Shipped with a commit message and a note to another lane both stating that a chip gaining `getState()` would turn the suite red, so the row would have to be deleted | It would not have. The coverage assertion only fires for a chip with NO snapshot method; one that GAINED a method sailed past into the passing path, leaving the exemption standing forever. |

The fifth is the one to read twice. It is in the instrument built to catch
this pattern, it was found by that instrument's own author, and the part that
did not exist was precisely the mechanism offered as the reason it was safe to
RECORD a gap rather than fix it. It was not found by review: it was found
because a second lane asked whether three instruments doing the same thing
constituted a house pattern, and answering required checking that they did.


The shape is the same each time: **something that looks right because nothing
ever asked it to prove otherwise.** Note that four of the five were found by a
change from an unrelated direction — moving an address, deleting a branch to
see what noticed, being asked to generalise — and none by reading the tests.

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
