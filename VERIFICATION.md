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
| **Op-amp slew rate** | Op-amp output changes instantly within rail limits | Fast signals are perfectly reproduced (unrealistically) |
| **Power dissipation / magic smoke** | No thermal limits | A 1/4W resistor dissipating 10W is fine in sim |
| **Propagation delay in logic gates** | Gates respond in zero time | Glitches from race conditions are invisible |
| **MOSFET gate charge** | Instant switching | Real gate drive speed not modelled |
| **Diode reverse recovery** | Instant off | Switching losses invisible |
| **Mutual inductance / transformers** | Not modelled | No coupled coils or transformers |
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
