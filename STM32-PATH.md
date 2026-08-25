# STM32 emulation — the path, phased, license-verified

Written 2026-08-25 after the owner asked whether we could emulate the
ATmega8A and the STM32F103C8T6 "Blue Pill", and which of the existing
STM32 emulators could help. Everything below was VERIFIED, not recalled
— the license table via the GitHub API, the core-coupling claim by
reading the shipped code.

## The license table (checked 2026-08-25)

| Project | License | Verdict |
| --- | --- | --- |
| wokwi/rp2040js (the M0+ core we already ship) | MIT | **the foundation** |
| wokwi/avr8js | MIT | already shipped |
| renode/renode | MIT | **oracle + peripheral-model source** (a .NET app: never bundleable, freely portable-from) |
| Gissio/stm32-emulator-renode | MIT | proven Renode platform configs for real STM32F0/F1 devices — tells us which peripheral subset real firmware touches |
| nviennot/stm32-emulator | **GPL-3.0, on unicorn-engine (GPL-2)** | look, don't touch. Architecture ideas only, clean-room; not one line of code |
| Qiling | GPL-2 (on unicorn) | same; at most a never-shipped analysis tool |
| Wokwi's STM32 cores | not published | nothing to take |
| **w1ne/labwired-core** | **MIT** | **already ADOPTED by this fleet before this doc existed** — see the correction in Phase 4 |

The clean-room boundary, stated: from the GPL projects we may take the
UNPROTECTABLE ideas — SVD-driven register maps, fault-on-unmapped +
log-what-firmware-touches, implement-only-what-is-needed — and nothing
else. From Renode (MIT) we may PORT peripheral model semantics into JS
with attribution, which converts "write STM32 peripherals from the
reference manual" into "port battle-tested models".

## The architecture decision (verified, the key cheapness)

`rp2040js`'s Cortex-M0+ core touches its SoC through EXACTLY this
surface: `readUint8/16/32`, `writeUint8/16/32`, `onBreak`, `logger`
(grepped from `cortex-m0-core.js`, nothing else). So a thin bus object
gives us a **standalone ARMv6-M core** — an STM32 machine is

    { bus: flash + SRAM + peripheral dispatch, core, peripherals[] }

with no fork of rp2040js and no RP2040 baggage. Same machine shape as
`m6502-machine.js` / `z80-machine.js`, and the idle wave's contract
(core.waiting fast-forward, wake horizons per peripheral, veto for
horizon-less ones) carries over verbatim.

ISA honesty: the core is ARMv6-M (Thumb-1 + M-profile subset).
- **Exact** for Cortex-M0/M0+ parts: STM32F0, STM32C0, STM32G0, SAMD21, nRF51.
- **Subset** for the Cortex-M3 F103: OUR generated C compiled with
  `-mcpu=cortex-m0` runs identically on the emulator and on real Blue
  Pill silicon (ARMv6-M is upward-compatible). What this canNOT do is
  execute arbitrary third-party F103 binaries (Thumb-2). Every F103
  surface must SAY so.

## Phases

### Phase 0 — standalone-core spike (hours)
A bus shim + a gcc-compiled `-mcpu=cortex-m0` blink against one
hand-mapped GPIO register. Proves: boot, execution, WFI parking, and
that the coupling claim above holds at runtime. Deliverable:
`src/cortex-m0-machine.js` (bus + core + vector handling — the M0 has
no real VTOR requirement; we set the core's VTOR to the image base,
the same trick the pico debug path uses) + a deterministic test.

### Phase 1 — STM32F0 minimal board (the first shippable chip)
Target: **STM32F030** (or C0 — same GPIO v2 generation).
- Peripherals, in dependency order: RCC (enable-bits honesty stub —
  writes recorded, reads coherent), GPIOA/B/C (v2: MODER/IDR/ODR/BSRR),
  TIM3 (the 1 ms tick + PWM later), USART1 (serial console contract),
  EXTI+SYSCFG (button interrupts, also the WFI wake source).
- Semantics ported from Renode's MIT models; skeletons generated from
  ST's CMSIS-SVD (generator fetches SVD at dev time — we vendor OUR
  generated code, not the SVD).
- Honesty rules (the architecture lesson taken clean-room): an
  unmapped peripheral access NEVER silently returns 0 — it logs the
  address, and the census test asserts the log is empty for every
  shipped example. A modeled register is modeled; an unmodeled one is
  a named refusal.
- sb3-creator: `DEVICE STM32F030` (core 'arm', new hw table — the
  BW_MMIO register style the pico target already uses), compile target
  in stc-compiler (`-mcpu=cortex-m0`), idle via WFI + TIM interrupt
  (a REAL vector table like the pico's — the emitted-table trick works
  unchanged).
- bw-board: `stm32-adapter.js` (boundary A: setPin/advanceTo/readPin —
  copy the rp2040js-adapter shape), debug target, DebugPanel entry.

### Phase 2 — F103 Blue Pill (the name people know)

Owner-supplied references (2026-08-25):
- Board truth: stm32-base.org's STM32F103C8T6 Blue Pill page (schematic,
  pinout, the PC13 LED, the USB pull-up quirk); mikrocontroller.net's
  "STM32F103C8T6 Billig Board" article is the acceptance CHECKLIST —
  the things owners of the real board actually test.
- **Oracle, GPL-correct use**: nviennot/stm32-emulator (GPL-3, on
  unicorn) may be RUN server-side for differential comparison — outputs
  compared, nothing linked, nothing shipped — alongside Renode. Wokwi's
  STM32 is closed; compare behavior through its public UI only.
- Test-firmware corpus, roughly by difficulty: cpq's
  bare-metal-programming-guide (register-level, ideal first subjects),
  MaJerle/stm32-usart-uart-dma-rx-tx (USART+DMA — DMA is unmodeled,
  will exercise the unmapped ledger honestly), afiskon/stm32-ssd1306
  (I2C + the OLED we already model), lamik/EEPROM-emulation-STM32F1
  (flash writes — a NEW peripheral surface), iliasam/OpenSimpleLidar,
  PikaPython (an embedded Python — the stress test), LVGL (display
  stack, far horizon). Most compile for cortex-m3: on our M0-subset
  machine they run only if rebuilt with -mcpu=cortex-m0 — each corpus
  entry must state which build it was tested as.
- Second owner batch (2026-08-25, licenses API-checked): small MIT
  firmware repos usable as corpus subjects — 808017/STM32_LED_Blink
  (F103 blink, the smallest possible subject), Martlet-Tech/
  uart-emulation (UART TX), HajjSalad/STM32-Sensor-Data-Simulation
  (HAL + timers + PWM + ADC), abhigoraya005/STM32_Driver_Development
  (bare-register GPIO/UART/ADC/timer/SPI/I2C drivers for the F103 —
  the best of this batch for our register-level machine),
  DwHz's SRF-04 ultrasonic timer project, extrachange/STM32H7Synth
  (M7 — LabWired territory, not ours yet), geek-is-big's F401 Proteus
  model. marwen-maghrebi/Advanced-STM32-Simulations- has **NO license**
  — reference-only, nothing copied, nothing vendored. The Proteus-based
  repos' .pdsprj files are for a proprietary simulator; only their C
  sources matter here.
- GPIO v1 is a DIFFERENT model (CRL/CRH config, AFIO remap) — port
  Renode's F1 GPIO, do not shoehorn v2.
- APB2/APB1 address map, TIM2/3, USART1 at F1 addresses.
- Every UI surface labels it "runs BrickWright-built programs
  (ARMv6-M subset)" — the Thumb-2 caveat is stated, never hidden.

### Phase 3 — Renode as the differential oracle (VPS-shaped)
Renode (MIT) + Gissio's platform configs run server-side, CI compares
our peripheral behavior against Renode's for the same firmware — the
exact ucsim pattern the 8051 corpus uses, minus ucsim's GPL wall.
Mono/.NET installs on the VPS; this is fleet work.

### Phase 4 — full F103 fidelity: LABWIRED, per a decision OLDER than this doc

**CORRECTION (2026-08-25, owner's catch):** this doc first presented
LabWired as a find. It is not. The fleet adopted it before this doc
existed: `sb3-creator/reference/corpus-and-oracles.md` lists
labwired-core as the RP2040 second-opinion oracle (layer-5 sweep), and
`stc/docs/ROADMAP.md` records the decision — seeded ~2026-08-14 —
"**STM32 — via the labwired-core (MIT) adoption already seeded: G0/F103
before F4; never hand-rolled**", with validation rows already landed
(nRF52840 deep/silicon-verified; ESP32-C3 reset-state only, needs a
runtime differential before oracle use). The meta-lesson joins the
fleet's collection: this doc verified EXTERNAL repos via the API and
never grepped OUR OWN .md corpus — scoping a lane starts with
`grep -ril <topic> */docs */reference *.md`, or you re-derive (or
contradict) a decision the fleet already made.

**DECIDED (owner, 2026-08-25): two tiers, permanently.** The
hand-rolled machine is the LIGHT tier — M0-class chips running
BrickWright-built firmware, peripheral set CAPPED at what the codegen
emits (digital I/O, tick timer, USART print, ADC, PWM — the standard
example vocabulary and no more). Everything beyond — foreign binaries,
F103/F4, RISC-V, ESP32 — goes through labwired (wasm-spike gate before
Phase 2; CLI as the CI oracle immediately). The cap is the roadmap's
"never hand-rolled" intent kept honest: no Thumb-2, no DMA, no
peripheral forest will ever grow here. STM32C0/G0 share the F0's
GPIOv2 nearly register-for-register and ride this tier almost free,
which honors the roadmap's G0-before-F4 ordering. The paragraph below
records the tension as it stood before the decision.

**The tension this creates, stated rather than papered over:** Phases
0–1 above hand-rolled an F030 machine and board — working, tested,
in-browser-ready JS — against a roadmap line that says "never
hand-rolled" for STM32. Reconciliation is the OWNER's call, with two
honest readings: (a) the hand-rolled F0 path ships (it exists today,
runs in the browser with zero new infrastructure, and its codegen +
compile target are emulator-agnostic) while labwired-wasm is evaluated
for the full-fidelity tier — the F0 work then becomes the validation
BASELINE labwired is compared against; or (b) the roadmap line is
enforced strictly, the F0 machine becomes a test oracle only, and the
shipping path waits for labwired-wasm. Either way the sb3-creator
DEVICE STM32F030 emission, the stc-compiler target, and the chain
tests survive unchanged — firmware is firmware.

Verified via the API and the repo tree (this part WAS new work):
- Cores: Cortex-M0+/M3/M4/M7/M33, RISC-V, Xtensa LX6/LX7 (ESP32 paths).
- Chips modeled include **stm32f103** (with `firmware-f103-conformance`
  and `firmware-f103-fuzztarget` crates — the Blue Pill is a VALIDATED
  target), F401/405/407/411, F767, RP2040/2350, nRF52/53/54, ESP32/C3/S3,
  ATmega328P.
- Deterministic by contract ("same ELF + same manifest = same trace"),
  CI-native (pass/fail exit codes), hardware-validation workflows, and a
  **Fidelity Ledger** documenting every place the model short-circuits
  silicon — independently, they built our honesty-ledger philosophy.
- A hosted browser playground exists, so in-browser execution of this
  engine is already proven feasible.

Two uses, in order:
1. **Oracle, immediately**: the CLI is a better differential oracle for
   our F0/F103 models than Renode — MIT, deterministic, scriptable,
   maintained. Runs on the Mac, the VPS, or CI.
2. **The Phase-4 road**: BEFORE anyone hand-writes Thumb-2 in JS,
   evaluate compiling LabWired's core to WASM (Rust → wasm32 is
   first-class; their own playground suggests it is done or close) —
   the same play as our emu8051 fork, and it would deliver M3/M4/M7 +
   RISC-V + Xtensa in one move, MIT-clean. Open questions to answer in
   the evaluation: does the core crate build for wasm32-unknown-unknown;
   binary size; the boundary-A adapter surface; how their board
   manifests map onto our circuit model. Hand-writing ARMv7-M remains
   the fallback, not the plan.

**Correction this find forces**: the "deliberately OUT" list below said
no permissive ESP32 emulator exists. That was true of the projects
checked on 2026-08-25 morning and is now STALE — LabWired's Xtensa
paths are MIT. ESP32 moves from "impossible" to "evaluate with the same
WASM question".

### Alongside, cheap and unblocked: ATmega8A
Not an STM32 but part of the same owner question: a `CHIPS.atmega8a`
config entry (avr8js is register-parameterized; note Timer0 has NO
compare unit — the ms tick uses Timer2 CTC), the MCUCR-bit-5 sleep
gate (the tiny85 case), an sb3-creator device entry, and
`-mmcu=atmega8` in the compile service. Small lane, real classroom
demand.

## What is deliberately OUT
- ESP32/ESP8266: ~~no permissive emulator exists~~ — STALE since the
  LabWired find (its Xtensa LX6/LX7 paths are MIT); see Phase 4. PIC
  remains out (gpsim is GPL).
- Bundling Renode or anything unicorn-based: never.
- Pretending the M0-subset F103 runs foreign firmware: never — the
  label is part of the deliverable.
