# The board-manifest bridge — measured, then built

STM32-PATH.md Phase 4 left two pieces open after the wasm spike passed:

> the wasm-bindgen API surface → boundary-A adapter mapping, and their
> board-manifest → our-netlist bridge

The first landed on 2026-08-27 (`src/labwired-adapter.js`). This file is the
measurement and the ruling behind the second, written before the code, against
**labwired-core @ `41119903ced44a221a49aa0e8090ab012fbdba68`** (our fork's
`main`, = upstream) and **this repo at `5f36dfa`**. Every number below was
counted by running something, not recalled.

## 0. The direction, settled first

The plan's phrasing — "how their board manifests map onto our circuit model" —
points the wrong way for the law this repo runs on.

**ONE BOARD, ONE TRUTH.** The runner's board is the *designer's* board. A
labwired board manifest imported *into* our circuit model would be a second
drawing of the same bench that nothing keeps in step; the very first divergence
would be invisible, because both halves would look healthy. So the bridge runs
netlist → manifest, and the consequence is the rule that decides every row of
the table in §3:

> **THE PAD IS THE BOUNDARY.**
> labwired owns the silicon side: registers, peripherals, the pad's direction
> and drive. `board.js` owns the other side: the resistor, the LED's I–V curve,
> the divider, the shift register, the rail.

The manifest is therefore a **projection of the netlist onto that boundary**,
not a translation of the circuit. It says which pads exist, which of them the
board can drive, and what each is wired to — and it deliberately emits **no
`external_devices`**, because a second model of one LED is exactly the
disagreement the law exists to prevent.

That single rule is also what makes the refusal ledger meaningful. An
unrecognised part on an MCU net is *not* a refusal: a 74HC595 on PA0 needs
nothing from labwired. What is refused is a pad whose behaviour the bridge
cannot honestly carry.

## 1. What a labwired system manifest can express

`SystemManifest` (`crates/config/src/lib.rs:930`) has 14 fields. Counted:

| field | what it is | usable here |
| --- | --- | --- |
| `name`, `chip`, `schema_version` | identity | yes |
| `cpu_hz` | board clock override for the chip's default | yes — we emit 48 MHz |
| `board_io` | `BoardIoBinding[]` — the pad boundary | **the bridge's output** |
| `external_devices` | `ExternalDevice[]` — parts labwired models | **deliberately not emitted** |
| `parts` | part packs (`labwired.part/v1`) carried in-manifest | not needed |
| `peripherals` | extra peripherals beyond the chip descriptor | not needed |
| `memory_overrides` | flash/RAM size overrides | **parsed and never read** — see §6 |
| `motor_models`, `cosim_models` | typed plant models / co-simulation adapters | second-physics; refused by §0 |
| `debug_uart` | which console the board's USB socket is wired to | F0 has one USART path |
| `wifi_ap` | per-lab virtual access point | no radio on this chip |
| `walk_deleted` | scheduler escape hatch | leave on auto-derive |

A `BoardIoBinding` is
`{id, kind, peripheral, pin, signal, active_high, i2c_address?, device_type?, channel?}`.
`kind` has **seven** values (`BoardIoKind`): `led`, `button`, `adc_input`,
`pwm_output`, `i2c_device`, `spi_device`, `uart_device`. `signal` has two:
`input`, `output`.

**Exactly one of those combinations changes the simulation.** `kind: button`
with `signal: input` materialises a bus-resident `Button` whose level is applied
through the owning GPIO's `set_gpio_input`
(`crates/core/src/bus/from_config.rs:1031`, `attach_board_io_buttons`), and that
contact is what `set_board_io_input` resolves against
(`crates/wasm/src/inputs.rs:251`). Everything else is observational:

- `led` / `pwm_output` → `read_gpio_output` (`crates/wasm/src/lib.rs:1341`)
- `adc_input` → the ADC's `dr`, via `get_board_io_analog_states`
- the bus kinds → typed state accessors, and never a boolean

So an **output binding cannot contradict our board even in principle**. It only
gives the pad a name that `get_board_io_states` reports under — which is why the
bridge names output bindings with **our netlist part id**, so a consumer joins
labwired's answer straight onto the circuit.

`external_devices` is where labwired's real catalogue lives: **70 canonical
`device_type` strings** plus **14 legacy aliases** (`peripherals/kit/registry.rs`
`KITS` + `TYPE_ALIASES`), covering I²C/SPI/UART sensors, displays, motors,
shift registers and analog sources. It is a good catalogue. We use none of it,
by §0.

## 2. What our circuit model is

`registerAllDevices()` registers **211 part kinds** (`registeredKinds().length`,
measured). A netlist is `{parts, nets}`:

```
parts: [{ id, kind, params, terminals? }]
nets:  [{ id, terminals: [{ part, terminal }] }]
```

That is what `BoardImpl` takes and what the MNA solver solves. Note what the
netlist does **not** carry: bw-circuit-ui's canonical loader rewrites every
controller kind to the generic `mcu` before the netlist reaches the engine, so
the netlist alone cannot say which silicon it is. The chip kind is a caller
input (lite's device picker already knows it) — `buildLabwiredSystem({chipKind})`.

## 3. The mapping table

Classification walks **through** series elements (`resistor`, `fuse`,
`inductor`, ≤3 hops) to the functional leaf. Stopping at the resistor would
classify 160 of the corpus's MCU attachments as "a resistor" — true and useless.

| our netlist, at an MCU pad | role | what the manifest gets | why |
| --- | --- | --- | --- |
| *(every header pin, unconditionally)* | — | `kind: button, signal: input, id: <header name>` | A pad's direction is a **runtime** property. A binding emitted only for pads that look like inputs today makes the pad undrivable the moment firmware changes MODER — silently, because `set_board_io_input` resolves ids and nothing else. This is the slice `labwired-adapter.js` already generated; it stays. |
| `led`, `rgb_led`, `bargraph`, `sevenseg8`, `matrix*`, `piezo`, `buzzer`, `relay`, `dc_motor`, `servo`, `stepper`, `solenoid`, `light_bulb`, `optocoupler`, `tip120`, `npn`/`pnp`/`nmos`/`pmos`, `neopixel`, … | `indicator` | + `kind: led, signal: output, id: <our part id>` | Observational. `led` is the label labwired's vocabulary offers for "a pad drives something"; the engine reads `led` and `pwm_output` through the identical call. |
| `button`, `switch`, `slide_switch`, `dip_switch*`, `reed_switch`, `tilt_sensor`, `touch_ttp223`, `keypad_4x4`, `74c922`, `pir`, `hall_digital`, … | `contact` | the injection binding, re-labelled with the contact's kind | A second `signal: input` binding on one pad attaches a **second** `Button`, and the second overwrites the first's level on every service. One pad, one contact. |
| `potentiometer`, `ldr`, `ntc`, `tmp36`, `photodiode`, `phototransistor`, `joystick`, `soil_moisture`, `force_sensor`, `flex_sensor`, `hall_analog`, … | `analog` | + `kind: adc_input, signal: input` **and a refusal** | See §4. |
| `shift_register`, `ultrasonic`, I²C/SPI parts, gates, anything unrecognised | `digital` | + an output binding naming the part | **Not a refusal.** The pad is bridged; the part is our board's business. |
| `vcc`, `gnd`, `battery*`, regulators only | `rail` | nothing beyond the injection binding | Supply, not signal. |
| nothing on the net | `floating` | injection binding only | |
| a controller terminal **outside** the chip's header map that carries a signal | — | **`pin-unmapped` refusal, named** | Nothing on the heavy tier could reach it, and a silent drop is the bug. |
| PWM-capable pads (PA6/PA7/PB1 on the F0) | *(no special kind)* | — | Whether a pad is driven by TIM3 or by BSRR is a **firmware** fact the netlist cannot see, and labwired reads `pwm_output` and `led` identically. Emitting `pwm_output` from a wiring guess would be a claim the manifest cannot back. |

Board-level refusals: `chip-unmapped` (no heavy-tier descriptor for the board
kind — only `stm32f030` today), `mcu-absent`, `mcu-ambiguous` (the heavy tier
runs one core per manifest).

## 4. The one thing the manifest cannot carry, and the fix

An analog pad's level is a **voltage our board solves**. To run the heavy tier
against the same circuit truth, that voltage has to reach labwired's ADC. It
cannot, through the wasm boundary as it stands:

- `WasmSimulator::set_adc_value(peripheral, value)`
  (`crates/wasm/src/inputs.rs:309`) writes `adc.dr` directly and sets EOC. It
  **names no channel**, so on a bench with two analog pads whichever conversion
  runs next takes the last value written, whatever channel it selected.
- The poke does not survive a conversion. `Adc::advance_conversion` rewrites
  `dr` from the *selected* channel's injected value, and for a channel with
  nothing injected it writes an **incrementing counter** ("visual feedback",
  `crates/core/src/peripherals/adc.rs:291`).
- `board_io kind: adc_input` is read-only — `get_board_io_analog_states` reports
  `dr`; nothing sets it.

**The core already has the right primitive.** `Adc::set_channel_input(channel,
millivolts)` (`adc.rs:332`) exists, and the bus reaches it through
`SystemBus::seed_adc_channel` (`bus/sim_inputs.rs`) whenever an `AnalogSource`
kit is attached. It is simply not exported through `crates/wasm`. The clean fix
is one wasm-bindgen method:

```rust
#[wasm_bindgen]
pub fn set_adc_channel_millivolts(&mut self, peripheral: &str, channel: u8, mv: u16)
    -> Result<(), JsValue>
```

routed through `seed_adc_channel` so it works for every ADC model, not just the
STM32 one. Until that lands in our fork and a rebuilt artifact is published, an
analog pad is **named** in the manifest and its injection is **refused**, rather
than quietly reported as a boolean — which would be a lie about a mid-rail node,
not a loss of precision.

Two carriers were considered and rejected:

- **Declare the pot as `external_devices: {type: potentiometer}`** and drive it
  with `set_potentiometer(id, pct)`. The kit's math is
  `mv = 3300 × pct/100`, so feeding it `pct = 100 × V_solved/3.3` *is* a pure
  projection, not a second physics. But it hangs the analog path on a
  hard-coded 3.3 V reference inside the kit and on the `Adc` layout the F0's
  `stm32f0_adc` resolves to (the profile canonicalises to the generic `adc`,
  default layout `Stm32F1` — the same shape of trap as the GPIO V1/V2 one that
  cost a day). It buys nothing the one-line export above does not.
- **Poke `dr` on every sync.** Racy by construction, per the second bullet
  above.

## 4b. The pull-up that is not there — found by running the round trip

Found the moment a real bench ran on both tiers instead of a recording stub,
and it is the most important finding in this lane:

**labwired's V2 GPIO model does not model a pull at all.** `V2Gpio::effective_idr()`
(`crates/core/src/peripherals/gpio.rs:238`) is

```rust
((self.odr & push_pull) | (self.idr & !driven)) & 0xFFFF
```

— an undriven input reads its raw `idr` latch, which resets to 0, **whatever
PUPDR holds**. PUPDR is stored and read back correctly at `0x0C`; it simply has
no effect on the pad. And `pin_routing` reports only
`input | output | af | analog`, so the adapter could not see the pull either.

Left alone, that turns the pulled-up idle button — the gallery's *only* button
idiom — into a key held down from reset. On `01-blink`, where PA1 is a pulled-up
input with **nothing wired to it**, the heavy tier printed 23 spurious `B` bytes
where the light tier printed none — while the firmware ran correctly and the LED
blinked correctly the whole time. No error, anywhere.

The fix is on our side and needs no fork patch: `get_peripheral_snapshot(port)`
returns the flat V2 register struct **including `pupdr`**, so
`labwired-adapter.js` reads the pull itself and publishes the pad to the board as
`input-pullup` / `input-pulldown` / `input` — which is exactly what
`stm32f0-board.js`'s `_publishAll` does on the light tier. Our board *does* model
pull resistors (`pin-model.js`, `R_INPUT_PULLUP`), so it solves the pad, and
`syncInputs` pushes the solved level back into IDR. Two tiers, one description of
one pad.

Defensive by construction: a family whose snapshot carries no numeric `pupdr`
(the F1 encodes pulls in CRL/CRH + ODR; nRF52 in PIN_CNF) reports no pull and the
pad stays a plain input, rather than acquiring an invented one.

Worth an upstream note: an `effective_idr` that honoured PUPDR for undriven pins
would be a few lines, and the absence is invisible to anything that does not ask
for a pad LEVEL — the same blind spot that hid the F1/V2 register-map trap.

## 4c. Two interrupt entries per timer update — measured, with the control

The second thing the round trip found, and the reason it compares an edge
*prefix* rather than an edge count.

Firmware that toggles PA0 once per TIM3 handler entry makes the edge count a
direct count of interrupt entries, and TIM3 at `PSC=47, ARR=999` on a 48 MHz
part produces exactly one update event per millisecond. Over 40 ms:

| tier | PA0 level changes in 40 ms | handler entries per update event |
| --- | --- | --- |
| light (`CortexM0Machine`) | 39 | **0.97** |
| heavy (labwired-wasm @ 41119903c) | 78 | **1.95** |

(The ±1 is the update event on the window's last millisecond, which may or may
not fall inside it. Nothing else here is approximate: a standalone probe over
the same firmware measured 40 and 79.)

So any interrupt-counted millisecond clock — **which is exactly what our codegen
emits** — runs at double speed on the heavy tier. A 20 ms blink comes out at
9.8 ms.

**The control isolates it.** The same grid polled off `TIM3_SR` UIF, with the
NVIC not involved at all, agrees:

| tier | polled half-period (asked: 20 ms) |
| --- | --- |
| light | 20.001 ms |
| heavy | 20.000 ms |

They agree to five parts in a hundred thousand. The counter, the prescaler and
the clock are fine. The interrupt path is not.
labwired's timer IRQ is **level**-pended — `irq_level_held()` is
`SR & DIER & 0x1F` (`crates/core/src/peripherals/timer.rs:343`) and the walk
pends the line on every tick while that holds — and the NVIC pending latch is
not dropped when the peripheral deasserts during the handler. So the
`TIM3_SR = 0` at the *top* of the ISR is still followed by a second entry. On
silicon the NVIC clears a level-triggered pending bit once the source deasserts
before the return.

Not patched here: the fix is in the NVIC's level handling, not a two-line change,
and proving it needs a full workspace build. It is a clean upstream-PR candidate
with a five-line reproducer, and the round-trip test carries it as a *named,
ledgered* assertion with a band wide enough that a repair (→ 1.00) lands inside
it rather than reading as a regression.

Why the oracle never saw this: it compares UART byte *streams* and reassembles
edges from raw BSRR word writes. Both agree here — the firmware says the same
things in the same order. Only the RATE differs, and nothing before the round
trip ever put a hardware-timed firmware on both engines against one board.

## 5. The census — measured over the shipped gallery

`scripts/labwired-bridge-census.mjs`, run against sb3-creator
`86a5bab6bb1a29ff02e93055f5f42557dbbfb2ba` and bw-circuit-ui
`60fd1178a099b537de58a68608687da55fd11b86` (the sibling-pin tips):

```
benches: 85   loaded: 85   load failures: 0
pad roles:     indicator=112 analog=32 contact=16 digital=8
parts at pads: led=112 potentiometer=30 button=24 gnd=13 vcc=9 bargraph=8 seven_segment=7
               shift_register=6 npn=3 rgb_led=3 ldr=3 ultrasonic=3 piezo=2 neopixel=1
refusals:      analog-injection-unavailable=32
```

- **60 of 85 benches bridge with a completely empty refusal ledger.**
- **25 benches** carry **32** refusals — one per analog pad, and nothing else.
- **Zero** `pin-unmapped`, `chip-unmapped`, `mcu-absent` or `mcu-ambiguous`
  anywhere in the corpus. Every pad the gallery actually wires (`pa0` 59×,
  `pa1` 45×, `pa2` 18×, `pa3`/`pa6` 9×, `pa4`/`pa5` 6×, `pb1` 5×, `pa7` 2×) is
  inside the F0 header map, which is the same set the light tier offers — the
  two tiers hand a project the same pins, so a design cannot silently lose I/O
  by changing engine.

`test/labwired-bridge.test.mjs` asserts all of that against
`test/fixtures/labwired/f030-bench-netlists.json` — the engine-side netlists of
those 84 benches, resolved once by the script and stamped with the sb3-creator
commit, so the census runs in this repo with no gallery and no MPL-licensed
loader in the dependency graph.

### The one load failure — RETRACTED: it was the census rig, not the bench

An earlier revision of this section blamed `disp-bargraph`'s bench file for
wiring `bar1` by `a`/`b`. **The bench was always correct** (all seven variants
wire `a0..a7`/`k0..k7` and seat by `a0..k9`). The census script's `setEngine`
call omitted `getDevice` — the surface production injects — so bw-circuit-ui's
`terminalsForKind('bargraph')` could not ask the engine, fell back to a generic
two-terminal `['a','b']`, and the validator rejected the real pin table. The
instrument blamed its subject. Proven both ways by fab-pins (sb3-creator lane,
2026-08-29): shipped script 84/85 with disp-bargraph LOAD-FAILED; with
`getDevice`, 85/85 and disp-bargraph carries exactly one honest refusal (PA7
analog injection). The same stale-`setEngine`-surface class exists at 14 more
call sites in sb3-creator's tests and generators — ledgered there.

## 6. What is still open

1. **The wasm ADC channel export** (§4) — one method in our fork, a rebuilt
   artifact, and 24 benches move from "named refusal" to "carried".
2. **Lite wiring** — deliberately not started; see the lane's report.
2b. **Two upstream-PR candidates, both with reproducers here.** §4b: `V2Gpio`
   (and the F1 and Kinetis families beside it) never applies PUPDR to an
   undriven pad, so a pulled-up idle input reads low forever — worked around on
   our side, but the model is wrong for anyone who does not. §4c: a
   level-pended peripheral IRQ enters its handler twice per event because the
   NVIC pending latch is not dropped when the source deasserts inside the
   handler. Neither is patched in our fork: the first needs no patch for us, and
   the second is in NVIC level handling rather than two lines, so it wants a
   full workspace build to prove.
3. **The two tiers disagree about how much memory the part has.**
   `stm32-adapter.js` builds an **F030F4** — `sramBytes: 4096, flashBytes: 16K`,
   which is what the TSSOP20 sidecar the designer seats actually is — while
   `stm32f0-chip.yaml` (copied from upstream's onboarding config) declares
   **256 KB flash / 64 KB RAM**. A firmware linked against the generous map runs
   on the heavy tier and silently stops ticking on the light one, which is why
   the round-trip firmware is linked for the SMALLER of the two. The manifest
   cannot fix this: `SystemManifest::memory_overrides` is declared, parsed, and
   **read by nothing** — no construction path in `crates/core` consults it, so a
   manifest that declares it gets silence, exactly the way `cpu_hz` behaved
   before upstream started reading it. The real fix is to size the chip
   descriptor to the part, which also means re-cutting `labwired-chips.js` and
   re-linking the oracle's firmware — a deliberate act, not a side effect.
4. **Chips beyond the F0.** `LABWIRED_CHIPS` in `src/labwired-chips.js` is the
   one place a new one is added: a chip YAML, a header pin map that MATCHES the
   light tier's, an ADC channel map, and the board kinds our registry uses for
   it. The F103 is the obvious next entry and needs a GPIO **v1** profile, not
   `stm32v2`.

## 7. Housekeeping note

`build/` is gitignored as of this lane. The 21 MB `labwired-wasm` artifact was
committed by accident in `5f36dfa` (a `git add -A` that swept the download
directory) and is untracked again here — but the blob stays reachable in
master's history, and by the time it was noticed another agent had already
pushed three commits on top, so rewriting would have rewritten their work too.
On-disk cost of the mistake: **4.2 MB packed**. If the coordinator wants it gone
it is a scheduled history rewrite, not something to force-push under a live
fleet.
