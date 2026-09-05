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
| 80186 shift-count masking | **2c → 2b available** | `test/i8086-186.test.mjs` | **AN ORACLE EXISTS AFTER ALL, and I asserted twice that none could.** `borris84/dectalk-dtc03` — an NVDA screen-reader driver that runs original DECtalk firmware — carries `native/i8018x.c`, a from-scratch **MIT** 80186 core. Verified by reading it: `count &= 0x1F;  /* 80186 masks the count; the 8086 does not */`, and `case 4: /* SHL */ case 6:` for the reg=6 aliasing. Its header records validation against SingleStepTests 8088 at 2,752,117 pass / 0 fail / 91,883 skip, itemised — including **28,113 masking** and **28,000 reg=6** skips, the same two divergences we exclude from the v20 suite. Different suite, same reasoning, independent author. That is category **2b** (both read Intel's documentation) and possibly stronger. Not yet run: their numbers are a comment claim, not CI-enforced |
| 80186 reg=6 as SHL | **2b** | v20 agrees, and period 186 docs call the field reserved | an 80186 suite |
| Trap flag (TF) | **3** | behavioural tests + period binaries | **no vector in 646,000 sets TF.** DEBUG.COM's `t` is the acceptance and is owed |
| Cycle counts | **2a, 36.5%** | SingleStepTests 8088 v2 bus traces | the remaining error is in T-states invisible to the m-cycle count — see ROADMAP E6.8.4d |
| Bus access **order** | **2a** | 152,000/152,000 | — |
| Queue ops F/S/E | **2a** | 152,000/152,000 | — |
| 8254 PIT | **2a (partial)** | v86 differential: ours is datasheet-complete where v86 lacks read-back | **NOT `arduino_8253`** — surveyed 2026-09-04 and it does not do what the roadmap claimed: no captured data, read-back unimplemented, targets the 8253, and its emulator is GPL-3 despite an MIT repo licence. A hardware-backed PIT oracle means BUILDING THE RIG. MAME's `pit8253.cpp` (BSD-3, confirmed) is the realistic next step |
| NS16C550 UART | **2a** | v86 differential, scratch register byte-for-byte | broaden the probe set |
| 8259 PIC, 8237 DMA | **2b** | datasheet + our own tests; MartyPC read as reference | MAME's BSD-3 device files |
| 8251 USART | **2b** | datasheet + one MIT demo's init sequence | MAME `i8251.cpp` — **BSD-3 confirmed on the current revision** (`// license:BSD-3-Clause`, copyright smf/Robbbert). The only permissive spec-grade 8251 reference, and it is real |
| uPD765 FDC + DMA | **2a** | MS-DOS 2.0 boots down TWO independent paths (INT 13h service layer vs real FDC over DMA) with byte-identical screens — that differential found the DMA pump moving zero bytes while reporting success | — |
| CGA renderer | **2b** | pixel layout written twice and cross-checked | — |
| Audio: tone vs samples | **2b** | the two contracts must agree; caught an octave error in the OPL on its first run | ymfm as a second oracle for the OPL |
| `i8086-asm.js` | **2a** | 510/525 MASM corpus; MASM refuses 14 of the 15 rejects | — |
| Extractor refusals | **2c** | our own tests | — |

**TWO 80186 DIVERGENCES WE DO NOT MODEL AT ALL, found by reading that second
implementation's SKIP LIST rather than its code.** This is what a second
implementation buys that a test suite does not — it had to enumerate every
place the 186 differs from the 8088 in order to explain its own skips, and two
of them are news:

| Divergence | Their count | Ours |
|---|---|---|
| A divide exception pushes the address **of** the faulting instruction; the 8086 pushes the address after it | 25,453 | **not modelled** — `_fault(0)` pushes the post-instruction address |
| `FF /7` aliases PUSH on the 8088; the 80186 **traps it as illegal** | 10,000 | **not modelled** — our `GRP5` table has `'push', 'push'` |

Both are gradeable against the 8088 suite we already have (as *deliberate*
failures on those opcodes, which is how their runner treats them). Neither is
in the ROADMAP as work because neither was known until 2026-09-04.

**The two gaps worth naming as gaps — with one correction to how the first was
stated.** The 186 masking is at 2c because no oracle has been FOUND, not
because none can exist. Writing "cannot be raised by any existing artefact"
was an assertion where a search was called for: `emu86` was sitting in our own
licence table described as the reference for exactly these instructions, and
checking it took four minutes. It turned out not to mask either — so the
conclusion survives this test — but the difference between "checked and no"
and "asserted no" is the whole subject of this document.
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

**A constant measured at one operating point is a symptom.** Found 2026-09-04,
in a test written the same morning by the person writing this rule:
`test/adc0809.test.mjs` asserted `convCycles === 500`, with a comment directly
above it explaining the derivation — *"64 clocks; at 640 kHz against a 5 MHz
CPU that is 500 cycles"*. The **source** was right and scales properly. The
**test** pinned the arithmetic's answer at one CPU clock and never the
arithmetic, so replacing the whole derivation with a literal `500` left it
green: a 10 MHz machine then converted in 50 µs, where a real ADC0809 takes
100 µs whatever processor sits beside it.

The invariant is *"a conversion takes ~100 µs"*, and it is now asserted at
three clocks including the XT's awkward 4.772727 MHz. The tell was in plain
sight: **a comment that explains where a number came from is describing an
invariant the test next to it is not checking.**

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
| `node --test test/…` in a sparse worktree | `# pass 123 # fail 0` | six tests never ran; the files they import were not checked out |
| `npm test \| tail -15` reported by its exit code | "suite green, exit 0" | `tail`'s status. The suite had a failing test throughout. **This is row 1 of this same table, recurring.** |
| the corpus report read through `tail -12` | "four programs no longer assemble under MASM" | **fourteen** programs, and the list is the `--longJumps` PROMOTION list — the MASM line is its footnote. The `tail` cut the header that says so. |

The last one is worth its own paragraph, because it is the only one on this
list that reports a **passing** result. A `git sparse-checkout` in a worktree
excluded `src/components/`, so a test file importing from it could not load.
Node reported `1..47` and `# fail 0` — a clean suite — while the true count was
53. **A test that cannot load does not fail; it is absent, and absent tests do
not appear in a pass count.** It surfaced only because one of the six left an
async handle open and Node complained after the test ended; had it failed
tidily, the suite would have been green and six tests would have been silently
gone. Two of the worktrees in this tree are sparse.

**The pipe row is on this table twice, and the second time was the author of
the first.** `timeout 900 npm test 2>&1 | tail -15` was run three times in one
session and reported green each time; the exit code belonged to `tail`.
`(exit 7) | tail -1` returns 0 — it takes one line to demonstrate and it was
already written down. Knowing a trap is not the same as being immune to it,
because the trap is invisible at the call site: the pipe was added to keep the
output short, which is a formatting decision, and it silently became a
correctness one. Redirect to a file and check `$?` on the bare command, or set
`pipefail`; do not read an exit status through a pipe.

What it hid: `getTargetKinds` returned 11 kinds against a test expecting 10,
because a merged commit made the 8086 pickable without updating the count.
Small, and it had been reported as green three times.

**The last row is the worst of them, because it propagated a wrong MEANING and
not just a wrong count.** The block is fifteen lines and opens with

    14 program(s) needed OUT-OF-RANGE CONDITIONALS PROMOTED (21 jumps),
    and would be refused without --longJumps:

`tail -12` removes exactly that header and leaves the last four entries plus
the closing sentence *"These no longer assemble under real MASM"* — which reads
perfectly as a complete four-item list with an explanation. Nothing looks
truncated. It was reported onward to another session in that form, who read the
same block at a different tail depth, got five, and asked why the counts
differed; only then did anyone read the header.

**When a report begins with a count, read the count.** `14 program(s) ... (21
jumps)` was in the output the whole time, and `tail` is precisely the tool that
removes a header. A truncation that lands mid-list is obvious; one that lands
just after a header is invisible, because what remains is well-formed.

The countermeasure is to know the expected count. `# pass 130` means something
only against a number you had before; a suite that reports only "0 failures" is
reporting on the tests it managed to find.

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

### Rule: presence and ordering tests cannot see a rate

`test/i8086-timer-tick.test.mjs` is a whole file about the timer interrupt.
Its three assertions are `ticks > 0`, `ticks >= 3` and `ticks === 0`. Every one
passes while **the 18.2 Hz BIOS tick runs at 76.35 Hz** — measured, over 9.0
simulated seconds, 4.193× fast.

The cause is one line: `_advanceChips` calls `chip.advance(n)` with `n` in CPU
cycles, and `src/i8254.js` has no clock of its own, so a PIT that should run
from a 1.193 MHz crystal runs at the CPU's 5 MHz. The fix pattern was already
three lines above it in the same function, written for the OPL: *"runs on its
OWN 3.58 MHz crystal … advanced in MILLISECONDS of emulated time rather than in
machine cycles"*.

**Why no test caught it, and this is the general point: ORDER DOES NOT CHANGE
WHEN EVERY DELAY SCALES BY THE SAME FACTOR.** A suite that asserts *that* an
event happened, *that* it happened more than once, and *that* it did not happen
when unhooked, is invariant under a uniform time-base error. It is not a weak
suite; it is a suite about a different axis. No amount of re-reading it would
have revealed the defect — only a second, independent measurement did, and it
came from another lane hitting it from the inside on an unrelated feature.

The audit that followed is the reassuring half, and it was made exhaustive
rather than left at a spot check. Of the nine time-driven chips an
`I8086Machine` can construct, **the 8254 was the only one** that mistook
machine cycles for its own clock:

| chip | how it gets its time base |
|---|---|
| CGA, EGA, Hercules, VGA | take `clockHz` and derive the frame period (`clockHz / FRAME_HZ`) |
| SB DSP | takes `clockHz`, `perSample = clockHz / rate` |
| YM3812 (OPL) | `advanceMs` — its own 3.58 MHz crystal |
| ADC0809 | converts its 640 kHz conversion time to CPU cycles at construction |
| µPD765 | `advance(_cycles) { }` — **no time model, and the header says so** |
| **8254** | **counted machine cycles as 1.193 MHz ticks** |

The µPD765 row is worth its own note: a chip that models no time at all is not
a defect, because it is declared. The defect is a chip that models time
*implicitly*, in the wrong units, while nothing in its documentation names a
clock — which was exactly the 8254's state, and a reliable tell across all
nine.

What to take from it:

- **An assertion about a count is not an assertion about a rate.** If a
  quantity has units, pin the units.
- **A uniform scaling error is invisible to every relative check.** Ratios,
  orderings and interleavings all survive it. Only an absolute measurement
  against an independent reference finds it.
- **Suspect the chip whose documentation does not mention its own clock.** Here
  that was a reliable tell across eleven peripherals.

### Rule: a test value can be too coarse to detect the error it tests for

A green assertion is evidence only if the value it asserts could have come out
differently. Measured, 2026-09-04, in this tier:

The PC-speaker test asserted that a program requesting **440 Hz** produced
440 Hz. It did. Then a deliberate off-by-one was planted in the divisor the
speaker reads from 8254 counter 2 — the exact arithmetic the test exists to
check — and **the test stayed green**. 1193182/2712, /2713 and /2714 all round
to 440, so at that frequency the assertion could not distinguish a correct
divisor from a wrong one. The test was checking that a tone came out, and
reporting that as checking the pitch.

The fix was not a better assertion on 440 Hz; no assertion on 440 Hz can work.
It was a **second frequency chosen for sensitivity**: 4000 Hz has divisor 298,
where one count moves the answer 13 Hz. The planted error now fails it.

What generalises:

- **Sensitivity is a property of the test VALUE, not of the assertion.**
  `assert.equal` is exact; 440 was not. Picking the value a learner would type
  is good for a demo and is not automatically good for a test.
- **Round numbers are the ones most likely to be insensitive**, because they
  are round in the units the human chose and arbitrary in the units the
  hardware works in. 440 Hz is a musical fact; 2712 is the machine's.
- **Mutation is what exposes this, and only if the mutation is confirmed to
  land.** The first three mutation attempts in this session included one whose
  `sed` never matched and one that broke the file's syntax — the latter turned
  every test red, which reads exactly like a successful red-proof. A file that
  fails to parse is not a mutated file. Assert the edit landed AND that the
  module still loads.

The near relative already in this document is "a probe that fails to run looks
exactly like a probe that found nothing". This is its inverse: a probe that
runs, passes, and was never able to fail.

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

### Rule: a tool can fail in the mode it was built to detect

The sharpest instance this project has produced, found 2026-09-04 by the
coverage lane and recorded here at their request.

`scripts/audit-clean-checkout.mjs` exists because a test read a fixture from a
sibling git worktree that exists only on one machine: it passed for its author,
passed for its reviewer, and could never have passed in CI. The audit reproduces
CI's condition by `git archive HEAD`ing into a temp directory, so anything the
tracked tree does not contain is simply absent.

**Its first version symlinked only the root `node_modules`.** Nested ones were
missing in the archive, so tests that resolved a dependency through them failed
there and passed at home — **which is the exact signature the audit reports as
"this test depends on files git does not have".** A tool built to catch
environment-dependent failures was producing them, and reporting its own defect
in the vocabulary of the defect it was hunting. Fixed by symlinking every
`node_modules` (bw-board `463590f`); the false positives cleared.

**THE TELL THAT SEPARATES THE TWO KINDS, and it costs nothing** (lego-47,
2026-09-04, sharper than the re-run habit below):

> **A missing fixture fails the green case and the red mutation case
> together; a real change moves one.**

Re-running only tells you a failure was unstable. Mutating tells you which
*kind* it was, in one shot: break the thing the test is supposed to catch and
see whether the result changes. If red and green give the same failure, the
test never reached your code and the failure is environmental.

**Two further habits, and the second is the one that generalises:**

1. **Re-run a failure before believing its diagnosis.** That alone separated the
   real case from the false ones here, and separately caught a 1000 ms
   wall-clock budget test failing under load being reported as a missing
   fixture.
2. **A fixed explanation attached to a variable outcome is not a diagnosis.**
   The audit prints *"they depend on files git does not have, or on paths
   outside the repository"* for **every** failure, while establishing only
   *that* a test failed in the archive — never *why*. It is a category
   presented as a finding. A tool should either establish its stated cause or
   describe the observation and name the likely cause as likely.

The same shape, one level down, is the reason a detector must be tried against
a known-bad input before its "0 findings" is believed: an earlier attempt at
this audit wrapped `fs` to record resolved paths and reported **0 findings
against the very file it was written to catch**, because the target does
`import { statSync } from 'node:fs'` and an ESM named import binds the function
directly — patching the module object intercepts nothing.

### Rule: going green is not evidence that a widened assertion still asserts anything

lego-47's, 2026-09-05, and it is the counterpart to the rule below.

A source-text assertion pinned an exact one-liner. A refactor inserted a log
call, splitting the line, and the gate went red **while the behaviour was
unchanged** — the replay still replayed. Another required a specific
`useCallback` signature and failed when a parameter gained a default. Two false
reds from one commit, neither tracking anything real.

**A false red is worse than a false green, not milder.** A false green hides a
defect that already exists. A false red **manufactures** one, teaches everyone
the gate cries wolf, and the next real failure gets the same shrug that was
correct twice before. *A red everyone has learned to dismiss is how a real one
hides.*

**And the repair produced the failure it was repairing.** The fix widened the
assertion to "the condition, then the `setState`, within 200 characters". It
went green — and **stayed green after the line it exists to protect was
deleted**, because the file has four `machineBooted: true` sites and the window
matched a different pair. For a few minutes a false red had been replaced by a
vacuous pass, in a commit about vacuous passes.

**The only check that separates a loosened assertion from a hollow one is to
delete what it protects and confirm it goes red.** Going green proves the
assertion no longer objects; it proves nothing about whether it can. The
correct shape here was structural — same block, `if (…) {` with no closing
brace before the assertion — rather than any character window.

**This is why every widening in this repository is red-proved**, and why the
same discipline is applied to the widening itself and not only to the original
gate. Three instances the same week, all caught only by injection:

- a `< 400` cycle bound that failed on 1,979 legitimate `REP` entries — the
  bound was invented, not derived;
- a null-guarded comparison (`if (a !== null && b !== null)`) where **both were
  null**, so the test passed having compared nothing;
- a detector wrapping `fs` that reported 0 findings against the very file it
  was written to catch, because an ESM named import binds the function directly.

### Rule: a large improvement is not evidence of the right model

Measured on the 8088 cycle model, 2026-09-04. Shift/rotate-by-CL scored 3%.
Keying the model on CL took it to **57%** — a nineteen-fold improvement, and
exactly the kind of number that ends an investigation.

It was the wrong model. CL is a *linear* term (the datasheet gives shift-by-CL
as `8+4n`, and measurement confirms 4 cycles per count exactly), but keying on
it treats it as *categorical*, fragmenting the table across 64 CL values until
each key holds a handful of samples. Subtracting `4*CL` before fitting and
adding it back at prediction gives **99.4%**. The 19× improvement was
concealing a further 42 points.

The same shape appeared twice more the same day:

- Keying a branch on the flag word `flags & 0x8d5` scored **worse than using no
  flag feature at all**, for the same reason: it fragments until every key is
  unique. One bit — did control transfer — was correct. **One bit beat thirteen.**
- MUL keyed on the popcount of the *source* operand scored 15.7%, i.e. nothing,
  which read as "this feature does not exist". The microcode loops over the
  *implicit* operand: `popcount(AX)` scores 97%.

**So: an improvement confirms that a term matters. It does not confirm the term
has the right SHAPE, and it does not bound what a better shape would give.**
Before accepting a large gain as the answer, ask what the datasheet says the
relationship *is* — proportional, categorical, or conditional — and check that
the model expresses that shape. A fitted lookup will absorb a linear
relationship badly rather than fail loudly.

The sibling failure is a fit that is *too* good: per-opcode calibration scored
95.5% on held-out vectors and **34.2%** when held out by opcode. Neither number
is wrong; they answer different questions. Always state which split a score
came from.

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
