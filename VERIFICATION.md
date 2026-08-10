# What this engine actually verifies

**Nothing in this engine has been validated against real silicon.** Two emulators
agreeing, or a model matching ngspice, is evidence — it is not hardware. This
document separates the claims by their evidence level so a future reader knows
what to trust and what to check first on a bench.

## 1. Verified against a datasheet or measurement

These numbers have a citation. They are as good as the source.

| Claim | Source |
|-------|--------|
| Quasi-bidir pin sources ~230 µA | STC12 datasheet §4.6: "weak pull-up current ~230 µA at VCC=5V" |
| Push-pull sink/source ~20 mA | STC12 datasheet §4.6: "sink/source 20 mA per pin" |
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

## 2. Verified against another model (cross-implementation agreement)

Two independent implementations agree. This is real evidence of internal
consistency, but it is NOT the same as matching hardware.

| Claim | Evidence |
|-------|----------|
| Closed-form RC matches MNA transient (±5%) | `test/cross-validate-transient.test.js`: analytic V(t)=VCC*(1-e^(-t/RC)) vs board integration |
| 555 astable period within 3% of analytic formula | Measured 214ms vs theoretical 207.9ms |
| 70 ngspice golden circuits agree (stated tolerances per test) | `test/golden/ngspice_*.json` — independent SPICE reference solver |
| 55 Python-computed oracle values match | `test/golden/oracles.json` |
| Cube brightness: bw-board and bw-circuit-ui accumulator agree on 64 voxel values | `test/golden/cube-trace.js` |
| Boundary A conformance: 10/10 against real emu8051-stc WASM | `test/conformance-real-wasm.test.js` |
| Serial codec: 5 implementations agree on wire format | Verified by emu8051-stc's bridge test (`test_monitor_bwboard.mjs`) |
| Determinism: same netlist + same program = bit-identical waveform | `test/determinism.test.js` |
| PCA PWM rate: 7.2K edges/sec (SYSclk/12/256 = 3600 Hz = 7200 edges) | Independently measured by bw-board (perf budget) and ucsim-stc (PCA model), same arithmetic by separate routes |
| LED brightness at 50% PCA duty: emu8051 → adapter → board = **0.07248**, analytic = **0.07246** (0.03% difference) | `test/brightness-emu8051.test.js`: real emulated PCA edges through the push-mode adapter into the brightness integrator. The adapter bug (all edges at time zero) was found by this check — self-consistency could not have found it. |

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
discovered after a bench session costs hours of debugging "why doesn't my real
circuit match the simulation?" Every entry in section 4 is a possible answer to
that question, pre-written.
