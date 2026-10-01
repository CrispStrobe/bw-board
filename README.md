# bw-board

Circuit simulation engine for a learning-oriented breadboard designer.
Resolves pin drive states into node voltages, LED brightness, buzzer tones,
servo angles, motor speeds, and relay states — from pin-level physics, not
shortcuts.

Zero runtime dependencies. Runs in a browser or Node.js. MIT licensed.
5,400+ tests, 0 failures. 129+ part kinds. Three production CPU cores
(W65C02, Z80, and 8086/8088) plus an explicitly experimental 80286/80386 AT
profile.

## What is in this repo

**Core engine** (`src/board.js`, `src/mna.js`): closed-form solver for
resistive networks + MNA with Newton–Raphson for nonlinear elements (diodes,
transistors, op-amps, zener). Gaussian elimination with partial pivoting.
CV→CC power supply mode (vsource with `iLimit`). Scope channels with fixed
sim-time cadence and min/max decimation. `advanceTo` sub-steps through device
deadlines so timed transitions (relay switching, motor spin-up, servo travel)
fire at the correct simulated time, not just at the destination.

**111 part kinds** across built-in models (31) and a device registry (80):
- Passives: resistor, capacitor, inductor, diode, zener, LED, potentiometer,
  button, switch, buzzer, LDR, NTC, fuse
- Semiconductors: NPN, PNP, NMOS, PMOS, op-amp, TIP120
- 18 DIP logic ICs via chip-composer (74HC00/02/04/08/10/11/14/20/21/27/32/
  73/74/86/93/95/132, CD4511) — one table-driven helper, not 18 hand-written models
- Digital ICs: CD4017 decade counter, D/JK flip-flops, 74HC283 adder,
  74HC75 latch, PCF8574 I2C expander, Darlington driver
- Analog ICs: 555 timer, 556 dual, LM393/LM339 comparators
- Power: battery variants (9V/AA/coin), LM7805, LD1117V33, solar cell, USB-A
- Actuators: DC motor (back-EMF), motor with encoder (quadrature), servo
  (pulse-width decode from pin edges), stepper, solenoid, vibration motor,
  relay SPDT/DPDT, H-bridge (L293D)
- Sensors: TMP36, ultrasonic, PIR, tilt, flex, force, gas, phototransistor,
  photodiode, soil moisture, ambient light
- Display: NeoPixel (WS2812B NRZ decode from 800 kHz pin edges), bargraph,
  clock display, I2C LCD backpack
- Connectors: header, USB-A

**DebugTarget implementations** — emu8051 (with `emu_disasm`, verified
237/0 against an independent table), avr8js (first-class ATmega328P/2560 and
ATtiny85/88 targets; adapter profiles also cover ATmega88PA/32U4 and
ATtiny13/2313), rp2040js, eater6502, 8086/80286, the opt-in experimental 80386
AT target, and serial (real firmware over UART).
Factory at `src/debug-target-factory.js`. Disassembly panes for the
non-8051 targets are planned (live table disasm for owned cores,
service-side objdump listings for toolchain targets).

The ATtiny88 path is exercised as a board, not just as an instruction core.
The Blinkenrocket acceptance tests boot its real 8 MHz firmware, drive the
PB/PD 8x8 matrix and PC3/PC7 buttons, feed an encoded `"Hi"` waveform through
ADC6, and verify that the firmware writes the received pattern through TWI to
an external EEPROM (`test/avr-attiny88.test.js`,
`test/blinkenrocket-modem-e2e.test.mjs`). The same avr8js target exposes the
normal DebugTarget run control, instruction/block/over/out stepping,
breakpoints, SRAM write watchpoints, registers, code/SRAM memory, and
instruction/device/memory events; source/block positions additionally require
compiler symbols.

## The retro tier (2026-08)

**Three CPU cores, ours, verified end to end against ground truth:**
- `src/w65c02.js` — W65C02, 2,540,000/2,540,000 SingleStepTests vectors,
  both Klaus Dormann suites (52M instructions), 52.6M instructions in
  lockstep with vrEmu6502 (three documented, vector-adjudicated
  divergences). Grinder: `scripts/grind-w65c02.mjs`.
- `src/z80.js` — Z80, 1,604/1,604 vector files (1.6M vectors) including
  the undocumented machinery: X/Y flags, the Q latch, MEMPTR, R per M1,
  interrupted-repeat block-op rules derived from the vectors themselves.
  Grinder: `scripts/grind-z80.mjs`.
- `src/i8086.js` — 8086/8088, 646,000/646,000 SingleStepTests 8086 vectors,
  plus the 80186 variant graded against 132,532 SingleStepTests v20 vectors
  (`{variant:'80186'}`; shift-count masking and the reg=6 aliasing the suite
  can't grade are pinned in `test/i8086-186.test.mjs`). Opt-in cycle accuracy
  (`enableI8088CycleTiming`) charges instructions from a BIU scheduler
  (`src/i8088-biu.js`) graded against the SingleStepTests 8088 bus traces.
  Grinders: `scripts/grind-i8086.mjs`, `grind-i8086-v20.mjs`,
  `grind-i8088-cycles.mjs`.
- `src/experimental/i80386.js` and `src/experimental/i80386-at-machine.js` —
  an opt-in 386 protected-mode/AT path. It has real-mode, paging, descriptor,
  VM86, task, VGA, ATA and source-built guest evidence. It is not a claim of
  complete 386DX, x87, general software compatibility or hardware timing.
  The [interactive AT console](docs/I80386-AT-CONSOLE.md) accepts pinned raw
  disk images and explicit disk geometry. See `docs/I80386-EXPERIMENTAL.md`.
  The [reference-emulator audit](docs/I80386-REFERENCE-EMULATORS.md) compares
  its speed architecture and oracle roles with QEMU, Bochs, MAME and others.

**Composable machines** — a machine is a CONFIG (preset, declared
MAP/CHIP pseudocode, or a hand-wired breadboard solved by the bus
extractors):
- `src/m6502-machine.js` — regions + memory-mapped chips (`src/w65c22.js`
  VIA, `src/w65c51.js` ACIA, both datasheet clean-room). Presets:
  EATER6502, HB6502 (mike42, CC-BY facts). Extractor:
  `src/m6502-extract.js` (contention/open-vector refusals with
  addresses named).
- `src/z80-machine.js` — regions + PORT-mapped chips (`src/mc6850.js`),
  IM 1 delivery in the machine layer. Presets: SEARLE, CPM64K.
  Extractor: `src/z80-extract.js` (MREQ/IORQ-aware, per-space
  contention).
- `src/i8086-machine.js` — regions + PORT-mapped chips (8259 PIC, 8254 PIT,
  8255 PPI, 8237 DMA, 8251 USART, CGA/EGA/Hercules, uPD765 FDC). Presets from
  a minimal-GPIO breadboard (`BLINK8086`) up to a PC/XT with board-owned disk I/O.
  Chip advance is deadline-batched, so the machine layer stays thin over the
  core. On the pinned 2026-09-28 VPS, five runs of the functional benchmark
  had medians of **24× XT** for the bare core and **15.9×** for a synthetic
  PC/XT machine. These are different workloads, not full-PC boot or
  wired-board rates; see
  the [VPS receipt](docs/receipts/2026-09-28-x86-vps-throughput.json) and
  [cross-platform benchmark](docs/X86-RTX-PLATFORMS.md). The actual-net Harris
  wired board has separate, much lower capacity and its own
  [performance ledger](docs/WIRED-X86-PERFORMANCE-PLAN.md).
- `src/vdu-decoder.js` — the BBC VDU byte protocol as typed events
  (graphics without video hardware); `src/devices/hd44780.js` — the
  parallel character LCD as a board part.

**Real-time factor across the cores** — how fast each runs relative to the
real part, measured off-box on a fresh CI runner (`scripts/bench-chips.mjs`,
`.github/workflows/bench-chips.yml`; each core runs a small ALU + memory +
branch loop). RTx = emulated cycles per wall-second ÷ the part's real clock, so
**1.0× is real time**. A shared runner varies ±~25% run to run, so read these as
order-of-magnitude — the *ranking* is what is stable:

| Core | Engine | Clock | RTx (off-box) |
|------|--------|-------|---------------|
| Z80 (`z80.js`) | ours | 4 MHz | 186× |
| 6502 (`w65c02.js`) | ours | 1 MHz | 150× |
| AVR ATmega328P | avr8js ‡ | 16 MHz | 13.3× |
| 8051 | emu8051-stc (WASM) | — | 5.23× |
| RP2040 Cortex-M0+ | rp2040js † | 125 MHz | 1.66× |
| labwired STM32F0 | labwired (forked multi-arch WASM) § | 48 MHz | 24.2× |

The Z80 and 6502 cores run tens of times faster than the real silicon on this
loop. The
third-party JS engines (avr8js, rp2040js) and the WASM tiers — emu8051 and the
peripheral-accurate labwired STM32/RISC-V/Xtensa engine — are heavier than the
owned cores. Every measured engine now clears real time on this loop. These are
the medians of three passes from pinned GitHub run
[`36384508630`](https://github.com/CrispStrobe/bw-board/actions/runs/36384508630);
the machine-readable receipt is
[`docs/receipts/2026-09-28-chip-rtx.json`](docs/receipts/2026-09-28-chip-rtx.json).

† rp2040js's Thumb decoder is an 82-branch linear `if/else` chain; we run it
through a **switch-dispatch fork** (`src/vendor/rp2040js-fast/`, default-on and
behavior-identical — verified by an exhaustive 65,536-opcode stock-vs-fork
differential, `test/rp2040-fast-dispatch-differential.test.mjs`). Complete
MOVS/CMP/ADDS/SUBS-immediate and unconditional-branch families take an exact
tier-zero path before generic wide-instruction probing. That raised the hosted
RTx loop from a 0.94× pre-change median to 1.66×, with the exhaustive
differential still green. Upstreaming the restructuring to rp2040js is the end
state.

‡ avr8js's instruction decoder is a 99-branch linear `if/else` chain; we run it
through the same kind of **switch-dispatch fork** (`src/vendor/avr8js-fast/`,
generated by `scripts/gen-avr8js-fast.mjs`, default-on in the adapter — verified
by an exhaustive 65,536-opcode differential, `test/avr-fast-dispatch-differential`).
Off-box the forked decoder roughly doubles the stock ~5–6× on the RTx loop (to
~12×), so the AVR row reflects the fork (what the widgets pane runs). Upstreaming
it to avr8js is the end state.

§ The adapter applies LabWired's own `recommended_tick_interval()` (512 on this
single-core, walk-deleted STM32F0 bus; 1 on timing-sensitive or multi-core
buses). The fork also has an observer/interrupt/IT/MMIO-guarded Thumb-1 RAM-loop
basic-block path, plus a guarded closed-form path for rustc's current store-spin
loop, that aligns and coalesces from any entry phase. The current pinned
artifact measured 22.5×, 24.2×, and 25.4× in the 2026-09-28 hosted run
(median 24.2×).
The core repository separately gates the native production path at ≥1.0× for
all 38 modeled chips (74 board/mode measurements, with no coverage waivers).
Later same-VPS optimization receipts improved its ATmega328P `INC`/`RJMP`
throughput loop from 3.57× to a 21.43× three-run median (18.47–22.13×), while
cutting deterministic Callgrind cost from 223.9 to 12.0 Ir/step. That is the
LabWired AVR core, distinct from the avr8js measurement in this README's AVR
row. A pinned GitHub run of the real ESP32-C3 e-paper workload reached 1.020×
RTx (187.5 ms guest in 183.7 ms wall); exact-tick and batched runs produced the
same identity receipt.

The two Cortex-M board targets added in `labwired-core` `313252d4` also clear
real time in their representative UART boot smokes. With the adapter's real
policy (`recommended_tick_interval()` = 1024), seven independent hosted runs
gave a **3.323358273× median for micro:bit v2 / nRF52833** and a
**3.784580182× median for PyBadge / ATSAMD51**. The same smokes measured
0.0339× and 0.0112× medians respectively on the pre-change VPS build. Treat
those before/after numbers as threshold evidence, not a precise speedup ratio:
the hosts differ, and the timed phase is the firmware's terminal Thumb `b .`
loop (after UART `OK`, at PC `0x4a4` / `0x48a`), not an application workload.
The optimization coalesces only that exact self-branch while preserving the
scheduler boundary and disabling itself for observers, pending interrupts,
IT state, taps, and active debugging. Both optimized medians exceed the 1.0×
shipping floor. The exact seven samples, firmware checks and qualification
URLs are in
[`docs/receipts/2026-09-28-labwired-cortex-m-targets.json`](docs/receipts/2026-09-28-labwired-cortex-m-targets.json);
the reproduced browser/Node artifact is release
[`labwired-wasm-313252d4`](https://github.com/CrispStrobe/bw-board/releases/tag/labwired-wasm-313252d4).

**Historical predecessor-main motion result failed real time:** exact LabWired
`3456c048` [run 36694881019](https://github.com/CrispStrobe/labwired-core/actions/runs/36694881019)
passed functional checks but measured **0.889815× median / 0.887107× minimum**;
all five matrix/button/LSM303AGR samples were below 1.0×. The
[full failed motion receipt](docs/receipts/2026-09-30-microbit-motion-hosted-main-failed.json)
preserves source/executable hashes and all observations. GPIO-only reached
**2.545959× median** in the same job; its
[full receipt](docs/receipts/2026-09-30-microbit-active-hosted-main-motion-failed.json)
does not rescue the sensor-workload gate. This failed receipt remains evidence
for that exact predecessor, not a verdict on the successors below.

**New native successors landed:** [LabWired PR 134](https://github.com/CrispStrobe/labwired-core/pull/134)
(`96b739c2`) adds generation-scoped structural-discovery miss caching and cached
Nordic pull masks; [PR 135](https://github.com/CrispStrobe/labwired-core/pull/135)
(`ede33fb4`) completes START-latched, cumulative SAADC scan DMA. The controlled
[EPYC 7763 B/C/C/B run](https://github.com/CrispStrobe/labwired-core/actions/runs/36719325375)
measured candidate medians **1.036825× / 1.023289×**, versus predecessor main
**0.879752× / 0.882749×**, using the identical motion guest. The
[combined native ADC qualification](https://github.com/CrispStrobe/labwired-core/actions/runs/36720954929)
passed 314 selected executions, including the actual ARM sparse-channel scan
guest; its **1.996539× motion median** is a separate EPYC 9V45 observation,
not a controlled ADC speedup. Exact remote-main `ede33fb4`
[run 36725594408](https://github.com/CrispStrobe/labwired-core/actions/runs/36725594408)
now passed native board qualification on EPYC 9V74: motion **1.290097× median /
1.261066× minimum**, all five samples above 1×. The
[complete original motion receipt](docs/receipts/2026-09-30-microbit-exact-main-ede33/microbit-motion-throughput.json)
and [source/runner/retained-ELF provenance](docs/receipts/2026-09-30-microbit-exact-main-ede33/qualification-context.json)
preserve the exact-main result, including the actual ADC scan and measured
motion ELF hashes. GPIO-only measured **3.555766× median** in that run. This
is native held-input qualification, not a controlled cross-runner gain or a
new exact-main all-chip performance result.
All 40 synthetic chip RTx fixtures passed for the earlier optimization candidate,
but six pre-existing Nordic single-step instruction-cost gates remain tracked in
[issue 120](https://github.com/CrispStrobe/labwired-core/issues/120); thresholds
and baselines are unchanged. The GPIO-only
[PR 137](https://github.com/CrispStrobe/labwired-core/pull/137) head `72f8b4cf`
[CorePerf run 36726333551](https://github.com/CrispStrobe/labwired-core/actions/runs/36726333551)
passed all 40 absolute RTx targets and all unchanged relative instruction-cost
gates. Nordic step deltas were +1.3% (nRF52832), +0.1% (nRF52833/nRF52840),
+0.2% (nRF5340), −1.7% (nRF54L15) and −3.0% (nRF54LM20A). However,
[native run 36726335356](https://github.com/CrispStrobe/labwired-core/actions/runs/36726335356)
passed 331 functional executions but **failed motion real time: 0.995903× median
on EPYC 7763**. This split candidate result is not a landing, exact-main/browser
promotion or closure of issue 120. It remains predecessor evidence, not the
result of the newer combined candidate.

Fresh PR137 head `8c745a68` has the same runtime engine as the qualified combined
candidate. [Native run 36733437798](https://github.com/CrispStrobe/labwired-core/actions/runs/36733437798)
passed on EPYC 9V74: motion **1.396342× median / 1.369084× minimum**, all five
samples at or above 1×; GPIO-only median **7.307814×**.
[CorePerf run 36733427626](https://github.com/CrispStrobe/labwired-core/actions/runs/36733427626)
passed all forty absolute RTx targets and all unchanged relative-cost gates
(78 board-modes, eleven memory maps), including the six Nordic regressions.
The [controlled paired run against runtime-main `ede33fb4`](https://github.com/CrispStrobe/labwired-core/actions/runs/36731892881)
measured median-of-medians **1.003515× baseline / 1.087777× candidate**,
**8.396746% higher**, with all ten candidate windows at or above 1×.
Fresh rebased head `8c745a68`, tested merge-ref `3afa2088`, also passed
[native run 36772744347](https://github.com/CrispStrobe/labwired-core/actions/runs/36772744347)
on EPYC 7763: motion **1.116135× median / 1.051434× minimum**, all five samples
>=1× with transport error zero; GPIO-only median **5.536381×**. This and the
earlier EPYC 9V74 1.396342× observation are separate runner results, not a
cross-runner gain. The [fresh rebase paired A/B](https://github.com/CrispStrobe/labwired-core/actions/runs/36772744288)
passed too; the earlier 8.396746% figure belongs to its original run above.
Final PR137 head `bd05656f` changes CI only; its production engine is identical
to qualified `8c745a68`. All three workspace shards and their aggregate passed
for `8c745a68`; its original PR gate timed out after twenty minutes compiling
feature-off core, after Clippy/default-member checks passed. The
[fresh CI run 36778919591](https://github.com/CrispStrobe/labwired-core/actions/runs/36778919591)
splits those jobs without dropping commands or extending their twenty-minute
budgets, retaining a fail-closed aggregate. That run **passed the full Core CI**,
including all three workspace shards and aggregate. [PR137](https://github.com/CrispStrobe/labwired-core/pull/137)
now **landed at main `5fb3d7d44cc1487fdab757906ae62222e8798e93`**.
Its final-head [native run 36778919418](https://github.com/CrispStrobe/labwired-core/actions/runs/36778919418)
passed on EPYC 7763: motion **1.126718× median / 1.117467× minimum**, all five
samples >=1× with zero transport errors; GPIO-only **5.278345× median /
4.983699× minimum**. All 349 overlapping functional executions and both
benchmarks passed; [final paired A/B 36778919437](https://github.com/CrispStrobe/labwired-core/actions/runs/36778919437)
also passed. The same qualified runtime's strict all-chip result above remains
evidence; [additional final-head CorePerf 36779028846](https://github.com/CrispStrobe/labwired-core/actions/runs/36779028846)
passed on exact final head `bd05656f`: all forty chip medians and minima >=1×,
all 78 board-modes over eleven memory maps passed unchanged strict relative-
cost gates, with zero regressions, waivers, skips or contract failures. The
faster-than-baseline nRF51 advisory remains; no baselines changed. Exact
post-merge main `5fb3d7d4` measurement is pending,
and issue 120 is not declared closed here. Browser CI passing does not promote
the app's browser pin or establish an active-browser performance result.

The [countdown change](https://github.com/CrispStrobe/labwired-core/pull/136)
landed at `8736e1ff`; current main `5fb3d7d4` includes both countdown and PR137's
GPIO runtime. The earlier main `8b1cd3f5` lacked the GPIO changes. Countdown's
earlier isolated qualification
passed nine whole-engine regressions and an
[isolated EPYC 7763 A/B](https://github.com/CrispStrobe/labwired-core/actions/runs/36723407331):
**7.79%** over the optimized base, candidate medians **1.092× / 1.124×**, with
all ten candidate windows above 1×. The earlier exact-main `ede33fb4`
1.290097× / 1.261066× observation remains historical source-bound evidence,
not a measurement of current main `5fb3d7d4`. These are native results, not a browser
pin upgrade or CP13 completion.

The subsequently completed **exact landed-main** qualification at `5fb3d7d4`
passed on EPYC 7763: native motion **1.110217× median / 1.107712× minimum**,
with all five windows above 1×, and GPIO-only **5.532553× median**.
[Native run 36781277925](https://github.com/CrispStrobe/labwired-core/actions/runs/36781277925)
and [CorePerf run 36781277968](https://github.com/CrispStrobe/labwired-core/actions/runs/36781277968)
both succeeded. CorePerf measured all 40 chips above 1× in both medians and
minima, with no regression or contract failure; regression issue #120 is now
closed. The [raw exact-main receipts](docs/receipts/2026-10-01-microbit-exact-landed-main/qualification-context.json)
retain source, runner and artifact provenance. These native observations do
not qualify the app's WASM artifact, update its pins or complete CP13.

Separate **native Rust** micro:bit v2 PR qualification on 2026-09-30 measured
**1.758214× median / 1.733954× minimum** while the source-built ARM guest
polled the selected LSM303AGR accelerometer and magnetometer through TWIM
EasyDMA, scanned the 5×5 diagonal and read physical button inputs. The same
hosted job's display/button-only workload measured **5.531284× median**.
Each workload used five 64-million-cycle windows at 64 MHz. These are bounded,
held-input sensor fixtures, not full micro:bit applications or the ALU-loop
table above. The [pre-optimization hosted motion run](https://github.com/CrispStrobe/labwired-core/actions/runs/36683869753)
failed real time (0.326908× median); the optimized shared VPS also remained
below the target (0.312439× median / 0.288592× minimum). Its process used about
81% CPU over the complete invocation, including setup—not a measurement of
CPU availability during the timed windows; see the [native qualification notes](https://github.com/CrispStrobe/labwired-core/blob/ce60a49941f9fa94d83aca6859bc27ae1c5b9e0b/docs/engineering/microbit-lsm303agr.md).
The passing hosted [run 36687935898](https://github.com/CrispStrobe/labwired-core/actions/runs/36687935898)
tested merge ref `199af713`, with runtime optimization source `e32b4a35`;
the native slice landed in [LabWired PR #129](https://github.com/CrispStrobe/labwired-core/pull/129)
at main commit `ce60a499`.
[the retained receipt](docs/receipts/2026-09-30-labwired-microbit-native-motion.json)
binds its source, guest hash and complete samples. It does **not** qualify this
repository's browser-WASM artifact or update its `a7c7cbdf` engine pin.
CP13 remains open: shared sensor IRQ, timed microphone/audio and browser workload
qualification are incomplete.

The [selected-motion boundary](docs/LABWIRED-SELECTED-MOTION.md) now provides
an explicit `lsm303agr` board variant and an opt-in fresh-WASM guest/RTx CI gate.
Default board hardware and deployed engine pins are unchanged; this slice has
not yet produced a passing selected-motion WASM or browser measurement.
The corrected fresh-WASM [hosted run 36817423180](https://github.com/CrispStrobe/bw-board/actions/runs/36817423180)
at LabWired `4d944d2d` passed the guest's sensor/DMA/matrix/button assertions,
but failed real time on EPYC 7763: **0.686913× median / 0.653157× minimum**;
all five windows were below 1×. Both builds, determinism and existing integration
passed; publication remained blocked. [All five samples and provenance](docs/receipts/2026-10-01-microbit-motion-wasm-hosted/qualification-context.json)
are retained alongside the raw output. These are NODEJS results, not browser RTx.
The [shared-VPS diagnostics](docs/receipts/2026-10-01-microbit-motion-wasm-vps.json)
also failed; a JIT-request probe did not justify enabling JIT. Native qualification
above therefore does not qualify the deployed WASM artifact.
An additional [binary-only A/B/B/A probe](docs/receipts/2026-10-01-microbit-motion-wasm-opt-abba.json)
with Binaryen `-O3` reduced WASM size by about 11.2%, but showed no clear
throughput gain on the shared VPS (0.365510× baseline / 0.367560× candidate
pooled medians). All twenty windows failed 1×; no optimization was promoted.

The unmerged [Cortex-M block-payload candidate](https://github.com/CrispStrobe/labwired-core/pull/142)
`08ad74b7` avoids copying a complete cached instruction block on each call.
Exact-base native A/B/B/A on one Xeon Platinum 8573C observed **+5.23%**
(1.237437× baseline / 1.302110× candidate median-of-medians); all ten candidate
windows passed 1×. Its native CorePerf spin gate also passed all 40 targets,
with no reported performance regressions. These are not browser measurements.
The controlled NODEJS WASM A/B/B/A on one EPYC 7763 showed **no meaningful gain**:
0.680217× baseline / 0.683885× candidate pooled medians (+0.54%); **all twenty
windows failed 1×**. A separate fresh candidate qualification on EPYC 9V74
also failed (0.824684× median / 0.818189× minimum). Different runner CPUs must
not be compared as evidence of a speedup. [Raw results and context](docs/receipts/2026-10-01-cortex-m-block-payload/README.md)
are retained. The shared CPU change also triggers seven silicon-capture drift
checks; neither those checks nor the WASM floor have been waived. The candidate
is not merged or promoted; deployed pins are unchanged and CP13 remains open.

The independent [opcode-dispatch optimization](https://github.com/CrispStrobe/labwired-core/pull/143)
`13ace46f` selects relevant T16 probes from a borrowed cached opcode; it does
not include PR 142. Exact-base native A/B/B/A on one Xeon Platinum 8370C observed
**+13.03%** (1.326734× / 1.499638× median-of-medians); all ten candidate windows
passed 1×. Two independent hosted NODEJS WASM A/B/B/A runs, each comparing both
engines on one EPYC 9V74 runner, observed **+6.60%** and **+7.38%** pooled median
gains. Candidate medians were **0.889071×** and **0.687602×**, respectively;
**all forty windows remained below 1×**. The repeat's candidate minimum was
also below its baseline minimum, so a median gain is not an every-window gain.
Absolute speeds vary with host conditions and are not compared across runs.
Fresh qualification separately failed (0.738987× median / 0.716393× minimum on
EPYC 7763), despite passing functional, determinism and existing integration
checks. [All raw receipts and test context](docs/receipts/2026-10-01-cortex-m-dispatch/README.md)
are retained. This intermediate optimization landed in core `main` as
`4deee6f0` after final-head CI passed. The user approved seven exact-content-bound
drift acknowledgements, expiring **2026-10-31**; physical capture dates/results
remain unchanged and hardware re-capture is still owed. Final-head exact-base
native A/B/B/A on one EPYC 9V74 observed **+14.74%** (1.410521× / 1.618482×);
all ten candidate windows passed 1×, minimum **1.596440×**. This does not change
the below-1× WASM results or deployed pins; CP13 remains open.
[Landing, final-head qualification and raw receipts](docs/receipts/2026-10-01-cortex-m-dispatch-landing/README.md)
are separate from the earlier measurements above.
Its native CorePerf gate passed all 40 spin targets with no reported instruction
regressions or waivers. Board/model qualification passed, including all 156
Cortex-M tests with zero failures/ignored tests; other board suites retain
physical-hardware ignores, so the whole job is not described as zero-skip.

The later exact-main [run 36690708740](https://github.com/CrispStrobe/labwired-core/actions/runs/36690708740)
at `ce60a499` also passed native board/model, input-routing and RTx gates.
Its selected motion workload measured **1.030645× median / 1.027010× minimum**;
all five samples exceeded 1.0×, but the margin is thin. The separate GPIO-only
guest measured **3.355510× median**. Both the
[complete main motion receipt](docs/receipts/2026-09-30-microbit-motion-hosted-main.json)
and [GPIO-only receipt](docs/receipts/2026-09-30-microbit-active-hosted-main.json)
retain the original source, guest hashes and observations. Runtime code and
motion guest source bundle are unchanged from the earlier passing PR run;
these are different runner observations, not a code-regression or controlled
speedup measurement. Neither result upgrades the browser pin or belongs in
the ALU-loop table above.

A second CPU optimization, lazy successful-candidate construction, landed in
[LabWired PR #131](https://github.com/CrispStrobe/labwired-core/pull/131) at
main `3456c048`. Its [qualified PR run 36691941435](https://github.com/CrispStrobe/labwired-core/actions/runs/36691941435)
measured native motion **1.126555× median / 1.123001× minimum**, with all five
samples above 1.0×, and separate GPIO-only **3.783684× median**. The
[full motion receipt](docs/receipts/2026-09-30-microbit-motion-hosted-lazy.json)
and [GPIO-only receipt](docs/receipts/2026-09-30-microbit-active-hosted-lazy.json)
preserve tested merge-ref `9e4e5f83`, qualified head `143402d6`, CPU source
`ab501cdf`, and landing `3456c048` as distinct provenance. Qualified CPU,
11 CPU regression tests and all three guest sources are byte-identical to
landed main; the later exact-main benchmark failed as recorded above.
Full functional/model/DMA/input-routing gates passed in the PR run. These
hosted observations are not a controlled wall-time A/B against the first
optimization's runs, nor a browser pin upgrade or CP13 completion.

That target support is intentionally narrower than a whole-board simulation.
micro:bit v2's standalone manifest exposes buttons A/B, and the BW bridge maps
its edge-connector GPIO and on-module 5×5 matrix; the matrix already reaches
the bench and part through the pinned engine. The native motion slice above is
not yet integrated into that browser pin; microphone, speaker, touch logo and
BLE remain unqualified here. The BW bridge maps PyBadge header
GPIO, D13/PA23 and Feather UART on SERCOM1 (PA16/PA17); LabWired's standalone
PyBadge manifest additionally attaches the five PA15 NeoPixels. The ST7735
display/SERCOM4, seven-button shift-register mux, QSPI and native USB are not
yet modelled. Raw PyBadge applications default to the UF2 bootloader boundary
at `0x4000`; full-flash images may explicitly request address zero.

`LABWIRED_EXACT_TICK=1` keeps the benchmark's exact-policy A/B available.

## Source-built guest validation

Guest validation is distinct from an included, ready-to-run product image.
The table lists source-available systems with a distributable build path;
it does not advertise software supplied outside this repository.

| System | Current validation | Package availability |
|---|---|---|
| [FreeDOS 1.4](https://github.com/FDOS) | Bounded 386 AT shell, HDD directory access and persistence checks | Test image is not included; redistribution requires its GPL notices and corresponding source |
| [ELKS](https://github.com/jbruchon/elks) | 8086 PC/XT kernel banner, floppy probe, root mount and timer/FDC IRQ checks | Test image is not included; source and license are maintained upstream |
| [xv6 x86](https://github.com/mit-pdos/xv6-public) | Pinned kernel boots to a COM1 shell; its 224 MiB usertests run completes on one emulated CPU in 7,203,922,011 guest steps with serial agreement against QEMU ([result](docs/I80386-XV6-HIGH-MEMORY.md)) | MIT source; generated images and BIOS artifacts are not included |

These are bounded harness results, not general operating-system compatibility
or calibrated hardware-timing claims. Tests requiring absent build artifacts
skip explicitly. Self-authored ROM and instruction fixtures provide the
redistributable baseline for CPU, bus, interrupt and storage regression tests.

Profiling the stock xv6 `forktest` path identified per-instruction snapshots
as a major host cost; retaining immutable cache entries reduced one same-host
run from 68.20 to 48.28 seconds for the same 24,338,279 guest instructions.
The [performance receipt](docs/receipts/2026-09-27-i80386-snapshot-fast-path.json)
records the comparison. The six-clock 386 board charge is functional device
scheduling, so this wall rate is not calibrated 386DX RTx.
On the later stock xv6 `forktest` path, a direct same-host user-CPU comparison
of 24,338,279 identical guest instructions improved from 39.655 to 29.575
seconds (1.34×) after coherent paging-cache, same-page read, and immediate
fetch changes. The [combined receipt](docs/receipts/2026-09-27-i80386-combined-performance.json)
binds the inputs and source. A further [APIC pending-mask experiment](docs/receipts/2026-09-27-i80386-apic-pending-mask.json)
measured 1.08× on adjacent pairs; this is still far short of the requested
roughly 10× speedup. These are workload-specific host CPU measurements, not
silicon timing or a general real-time claim. The measured bottlenecks and
next architectural experiment are in [Experimental 80386 speed path](docs/I80386-10X-PERFORMANCE.md).
Later guarded RAM dword fetch and direct register-field access each preserved
the complete 24,338,279-step stock xv6 `forktest` report and improved paired
user CPU by 5–11% and 5–8%, respectively. Both changes passed fresh 45.8-million-step ordinary and browser-target
FreeDOS qualifications and the full 386 test suite.
The guarded mappages trace experiment instead regressed by 16–20% and was not
merged. None of these measurements establishes 10× or a calibrated 386DX RTx.
At source revision `8261e891`, a [VPS xv6 forktest receipt](docs/receipts/2026-09-28-x86-vps-throughput.json)
records three runs of the same 24,338,279-step boot and command: median user
CPU fell from 25.16 s in JavaScript to 18.21 s with opt-in native blocks,
while the guest output, RAM hash, and 163,891,880 configured board cycles
matched. Its 6 MHz virtual board clock yields 27.315 s of *configured* guest
time, not a calibrated 386DX real-time factor.
A later [packed-entry measurement](docs/receipts/2026-09-28-i80386-packed-entry-performance.json)
cut the opt-in native path's paired mean from 18.26 to 16.40 user-CPU seconds
on the same complete xv6 task (10.19%); all three pairs favored the change and
the complete guest reports matched. That result is specific to the VPS and
xv6. The 10× target and physical 386DX RTx measurement remain open.

The separate [owned Bochs CPU3 paging-byte capture](docs/I80386-BOCHS-CPU3-OWNED-MEMORY-ORACLE-V2.md)
has a [source-pinned receipt](docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-v2.json)
from board `19c48649`: 807 instruction hooks, 2,112 callback events, and seven
physical page-walk callbacks with direct PDE/PTE A/D bytes. The record states
`comparison: "not-run"`; it does not establish full physical bus or cycle
equivalence, a JavaScript comparison, or a native backend speed result.

The separate [IDTR-aligned owned receipt](docs/receipts/2026-09-30-i80386-bochs-cpu3-owned-memory-idtr-03ff.json)
uses fixture source `3889b374` and the exact same Bochs CPU3 build and probe.
It executes `LIDT` with base 0 and limit `03ff` before paging; the final state
has that IDTR, 808 instruction hooks, 2,115 events, and the same seven direct
physical page-walk callbacks. The earlier v2 receipt retains its `ffff` IDTR
limit as a negative case. The aligned receipt still says `comparison: "not-run"`
and makes no full-bus, cycle, JavaScript-parity, or speed claim.
The subsequent [source-bound aligned comparison](docs/I80386-BOCHS-CPU3-PAGING-IDTR-ALIGNED-COMPARISON.md)
matches selected integer/system fields and three final plain-RAM words at
the `BHPG004` boundary. Its scope excludes cross-engine hook/bus order and
all other RAM; the older unaligned comparison retains its IDTR mismatch.

A separate [owned recoverable page-fault capture](docs/I80386-BOCHS-CPU3-PAGEFAULT-RETRY-ORACLE.md)
records one CPU3 `#PF` on a not-present 4 KiB page, the guest-written exception
frame, a guest handler that maps the page and reloads CR3, and successful
`IRETD` retry. It reuses the same pinned native probe; that receipt is a
native-only callback and selected-RAM proof, with no speed claim.
The subsequent [source-bound page-fault retry comparison](docs/I80386-BOCHS-CPU3-PAGEFAULT-RETRY-COMPARISON.md)
matches the selected fault frame, CR2, guest repair/retry sequence, final
integer/system fields and three plain-RAM words against the JavaScript
`strict386` run. Native callback order versus JavaScript bus order, full CPU
behavior and performance remain unqualified.

The [owned native CPU3 slice gate](docs/I80386-NATIVE-CPU-SLICE-SELF-PARITY.md)
then compared continuous execution with 1/2/257-native-tick resume budgets
across REP, a recoverable page fault, guest retry, and port output. The four
fresh runs matched selected final CPU/RAM state and their ordered host
write/port records; seven fail-closed guard probes aborted at their exact
fallback sites. This is native self-parity for one free fixture, with no
WebAssembly, JavaScript board-event parity, or speed result.

The separate [native CPU3 host-event gate](docs/I80386-NATIVE-CPU-EVENT-SELF-PARITY.md)
now matches continuous and 1/2/257-tick arms through a REP event deadline,
STI-shadow IRQ delivery, HLT wakeup, and masked HLT idle. All four arms match
2,195 ordered host tick/event records; an independent capture reproduced the
result. This remains a native functional prototype, with board integration,
WebAssembly, and performance measurement still unfinished.

The [combined native paging and host-event gate](docs/I80386-NATIVE-PAGED-EVENT-SELF-PARITY.md)
now keeps an IRQ pending through a recoverable page fault, guest page-table
repair, CR3 reload, IRETD and the retried write. Continuous and 1/2/257-tick
arms match 6,388 ordered recorded events; independent reproduction and all
seven fallback guards passed. Mapped memory/A20, board devices, WebAssembly,
and the 10× speed objective remain unfinished.

The [native typed-memory/A20 gate](docs/I80386-NATIVE-MEMORY-MAP-SELF-PARITY.md)
now matches all four budgets through ROM write protection, synthetic MMIO,
open-bus accesses, and aliased page-table reads/A-D writes. Its 7,259 recorded
events and eleven abort guards were independently reproduced. The next
[device gate](docs/I80386-NATIVE-DEVICE-NEXT-GATE.md) is PIT/PIC timer wake;
real AT devices, a shipped WASM backend and speed measurements remain open.

The [native PIT/PIC device gate](docs/I80386-NATIVE-DEVICE-SELF-PARITY.md)
now wakes a halted protected-mode guest through the existing I8254/I8259
models, actual PIC acknowledgment, guest EOI and IRETD. All four budgets
match CPU/RAM/device evidence; independent reproduction, nine API probes,
eleven native guards and seven malformed transport guards passed. Its pipe
transport is a test apparatus. Full AT/WASM integration and real workload
speed measurements remain unfinished.

The [native successful-work clock gate](docs/I80386-NATIVE-DEVICE-QUANTA-SELF-PARITY.md)
now separates REP/ordinary completion charges from native fault ticks. All
four budgets agree through an active PIT edge, two repaired page faults,
zero-count/final REP charging and actual PIC acknowledgment. Independent
reproduction, twelve API probes and eighteen abort guards passed; 817 local
386 tests passed with six optional skips. Its next checkpoint is now qualified
by the [native cold entry on the actual board](docs/I80386-NATIVE-COLD-RESET-ACTUAL-BOARD.md). This does not yet
establish a shipped native/WASM backend, broad guest compatibility or new RTx.

The [actual-board cold-reset oracle](docs/I80386-JS-COLD-RESET-ORACLE.md) now
executes a free MIT reset ROM from `FFFFFFF0`, preserving guest reset-state
witnesses, RAM/ROM/open-bus effects and terminal chip debt. Its 23 tests pass
and an independent capture is byte-identical. This is the current JavaScript
compatibility profile; its recorded architectural reset differences remain visible.

The [native actual-board cold-reset gate](docs/I80386-NATIVE-COLD-RESET-ACTUAL-BOARD.md)
now executes that ROM before any Bochs BIOS instruction, with board-owned RAM,
ROM/open bus, ports and device clocks. All four budgets and an independent
reproduction agree through 49 instructions and 298 functional board clocks;
12 native guards and 16 transport rejections pass. The 79 focused tests have
zero skips. Architectural reset parity remains false. The separate RAM/SMC/A20
gate below extends this bounded proof; neither is a new speed/RTx result.

The new [actual-board RAM/SMC/A20 oracle](docs/I80386-JS-RAM-COHERENCE-ORACLE.md)
now creates RAM code through guest writes and verifies both live A20 aliases
with eight executable entries. Its independent capture is byte-identical and
34 tests pass. Its separate [native RAM/SMC/A20 gate](docs/I80386-NATIVE-RAM-COHERENCE-ACTUAL-BOARD.md)
now passes all four budgets and a fresh reproduction with actual board ownership,
updates to both live aliases, and committed cache flushes. All 79 mandatory
report tests pass; sixteen native guards and twenty transport rejections pass.
Raw reset differences and eight exact far-call stack word-order differences
remain visible. The separate native protected REP/PF/PIT gate below extends
this proof; no new speed measurement or broad guest compatibility claim follows.

The new [actual-board protected-mode REP/PF/PIT baseline](docs/I80386-JS-REP-PF-PIT-ORACLE.md)
now boots a free cold-reset ROM into protected mode and 4 KiB paging, recovers
from two page faults, and services the actual PIT/PIC interrupt after the STI
successor. It passes 135 successful work quanta with 814 functional clocks;
48 tests pass and a fresh capture is byte-identical. Its separate
[native actual-board REP/two-PF/PIT gate](docs/I80386-NATIVE-REP-PF-PIT-ACTUAL-BOARD.md)
now passes all four work budgets and a fresh reproduction, with 54 report tests
and five host tests passing without skips. Nineteen native guards and eighteen
transport rejections pass. Raw reset and named bus/pagewalk differences remain
visible. Next combine these boundaries with executable RAM/SMC/A20. No broader
guest acceptance or new RTx is claimed.

**DRC warnings** (`getWarnings()`): overcurrent, missing resistor, aggregate
chip budget (120 mA, §4.1) + supply budget (500 mA USB), non-convergence,
device sub-step overflow. Two-budget current ratings vendored from
`bw-parts/current-ratings.json`.

**Five port modes**: quasi-bidirectional (25 Ω sink / 21.7 kΩ source),
push-pull, input-only, open-drain, input-pullup (35 kΩ, AVR). Source:
STC12 datasheet §4.1 for the first four; AVR datasheet for input-pullup.

## What is verified

Evidence categories per `stc/docs/EVIDENCE-CATEGORIES.md`. Full ledger at
`stc/docs/VERIFICATION-LEDGER.md`.

**Nothing in this repo has been validated against real silicon.**

Key results (all category 2b unless noted):
- Servo: 1500.0 µs at 90° (emu8051), 1499.6 µs (ucsim), 0.4 µs spread
- Motor: 84/128/192 of 256 counts, period 277561 ns
- LED brightness: 0.07248 end-to-end (found the adapter time-zero bug)
- 70 ngspice golden circuits (category 1 — independent solver)
- 347-image corpus: 0 disagreements across two emulators (category 1 — different upstreams)
- Serial DebugTarget: HELLO/REGS/READ round-tripped against real firmware
  UART with no mock. Baud accuracy not modelled (emu8051 §9 trap).
- NeoPixel: all four WS2812B timing windows pass (T0H=362 ns, T1H=814 ns)

16 defects found and fixed during verification. See `CLOSE-OUT.md`.

## What is NOT done

- **Bench session** (BENCH-ADC/CUBE/UART/PWM): four pre-registered predictions
  in `stc/docs/BENCH-SESSION.md`, all hardware-blocked
- **Idle-timeout resync**: test framework written, blocked on `stc12_trace`
  rebuild with `-inject` (ucsim-stc ccc3e9d)
- **Headless live E2E** (Playwright): blocked on memory constraints
- **Mutual inductance / transformers**: not modelled
- **Propagation delay in logic gates**: gates respond in zero time
- **Temperature, tolerance, parasitics**: not modelled. See `VERIFICATION.md` §4

## How to run

```bash
npm test                    # node --test (1357 tests)
node bench/perf.js          # performance benchmark
```

Requires Node 20+. No build step, no dependencies.

### What a `# skipped` count means here

Some suites are driven by an oracle this repo does not contain — a built
emu8051 WASM, a firmware hex, a corpus. When one is not reachable, those cases
**skip, by name, saying which oracle is missing and how to get it**. So a local
run reporting skips is a box without an oracle, not a broken build.

`# pass` is a count of cases that actually RAN. It did not always mean that: nine
suites used to guard with an early `return` inside the test body, which the
runner never hears — the `# SKIP` was a printed comment and the case was counted
as a pass. Measured with the emulator deliberately unreachable, one file
reported `# pass 25 # skipped 0` while printing that comment 24 times; converted,
the same file under the same conditions reports `# pass 0 # skipped 25`. The
numbers got worse-looking and started being true.

CI does not skip these: it checks the emulator out and then asserts it arrived
(`node scripts/oracle-census.mjs --require nasm,emu8051`), so a green run there
cannot be hiding an oracle that failed to appear. `node scripts/oracle-census.mjs`
lists every oracle, whether it is present, and which gates depend on it.

## Quick start

```js
import { BoardImpl, inferNetlist } from './src/index.js';

const { parts, nets } = inferNetlist({
  pins: [
    { name: 'led1', port: 1, bit: 0, direction: 'output', activeLow: true },
    { name: 'pot',  port: 1, bit: 3, direction: 'analog', activeLow: false },
  ],
});

const board = new BoardImpl(5.0);
board.setNetlist(parts, nets);
board.setPin('P1.0', 'quasi', false);  // LED on (active-low)
board.setControl('POT_pot', 0.5);
board.advanceTo(25_000_000n);

const state = board.getRenderState();
// state.leds[0].brightness ≈ 0.145
```

## Consuming

bw-board is an npm package consumed at a git sha, not copied:

```json
"dependencies": { "bw-board": "github:CrispStrobe/bw-board#<40-hex sha>" }
```

`import { BoardImpl } from 'bw-board'` is the browser entry; every file under
`src/` is also reachable as `bw-board/<file>` (`bw-board/i8086-asm.js`,
`bw-board/devices/ssd1306.js`), and `bw-board/rom/*` / `bw-board/roms/*`
serve the ROM images. `bw-board/pin-functions` is node-only and is not part
of the browser entry graph. No build step. Two runtime dependencies, avr8js
and rp2040js, both MIT.

There is deliberately no `files` field: the whole tree installs, because
consumers read `rom/`, `docs/generated/` and `scripts/` from the installed
package the same way they used to read a checkout at the pin.

`test/package-consumable.test.mjs` holds the four properties this depends on
(declared deps == imported deps; no `node_modules/` path imports; every src
file resolves through `exports`; no `node:` import in the browser graph).
Copying `src/` into a consumer (the pre-2026-09-12 regime) still works but is
no longer how brickwright-lite takes the engine.

## Performance

Measured on a single core (Node 20, Linux), 11-part netlist:

| Operation | Throughput |
|-----------|-----------|
| advanceTo (steady state) | ~233 K ops/sec |
| setPin (closed-form) | ~184 K ops/sec |
| branchCurrent (MNA cached) | ~7.6 M ops/sec |
| branchCurrent (MNA solve) | ~12 K ops/sec |

Meter cliff: 8.0 K edges/sec full per-edge path = 1.1× real time.
Display-rate sampling is load-bearing.

## Key documents

- `VERIFICATION.md` — what is verified, to what standard, and what is not
- `CLOSE-OUT.md` — campaign results: numbers, categories, defects, open items
- `DEVICE-CENSUS.md` — which device models respond to pin voltages vs block calls
- `PARTS-TARGET.md` — engine-specific notes on the parts catalogue
- `BLOCKED.md` — items waiting on external work

## Working in a git worktree

`node_modules` is not tracked. A new worktree therefore starts with no dependencies.

Either install normally:

```sh
npm ci
```

or, to avoid a second copy on disk, borrow the main checkout's:

```sh
ln -s /path/to/bw-board/node_modules node_modules
```

## The lcapy oracle

`test/lcapy-oracle.test.mjs` checks the MNA solver against **lcapy**, an
independent symbolic circuit solver, rather than against hand-computed values
or our own recorded output. It skips — loudly, naming what it looked for — if
no Python with lcapy is available:

```sh
pipx install lcapy          # or set LCAPY_PYTHON to an interpreter that has it
```


## License

MIT. See [LICENSE](LICENSE) and [THIRD-PARTY.md](THIRD-PARTY.md).
