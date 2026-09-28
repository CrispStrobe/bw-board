/**
 * Chip descriptors and header maps for the labwired (heavy) tier.
 *
 * The engine takes its machine definition as YAML at construction time, so a
 * consumer needs the text — and a browser cannot read a test fixture off disk.
 * This module is where that text lives for anything that ships.
 *
 * GENERATED, and gated. The content is the same bytes as
 * `test/fixtures/labwired/stm32f0-chip.yaml`, which the differential oracle
 * feeds to the labwired CLI. test/labwired-chips.test.mjs asserts they are
 * identical, because two copies of a machine definition that can drift is how
 * the browser tier and the oracle tier end up disagreeing about the silicon
 * while both look healthy. Edit the fixture; regenerate this with
 * `node scripts/gen-labwired-chips.mjs`.
 *
 * @module
 */

/**
 * STM32F0 (F030-class), as the oracle and the browser tier both see it.
 *
 * Note every GPIO port carries `config.profile: stm32v2`. Without it
 * `type: stm32_gpioport` routes to labwired's STM32**F1** register map — CRL
 * @0x00, ODR @0x0C, BSRR @0x10 — while the F0 is MODER @0x00, ODR @0x14, BSRR
 * @0x18, so every output write lands on a different register and every pad
 * reads low forever with nothing erroring. See the fixture's own header for how
 * that was found.
 */
export const STM32F0_CHIP_YAML = `# LabWired - Firmware Simulation Platform
# Copyright (C) 2026 Andrii Shylenko
#
# This software is released under the MIT License.
# See the LICENSE file in the project root for full license information.

name: stm32f0
arch: arm
# WHY EVERY GPIO PORT CARRIES \`config.profile: stm32v2\`
#
# \`type: stm32_gpioport\` routes to labwired's STM32**F1** register map
# (CRL/CRH @0x00, ODR @0x0C, BSRR @0x10). The F0 is a V2-layout part —
# MODER @0x00, ODR @0x14, BSRR @0x18 — so without the profile every output
# write lands on a different register and the pads never move. It fails
# silently: the firmware runs, the UART talks, and the GPIO model simply
# reports every pad low forever.
#
# Found 2026-08-27 while building the boundary-A adapter, which is the first
# thing here that ever asked labwired for a PAD LEVEL. The oracle never
# noticed because it compares UART bytes and reassembles pin edges from raw
# BSRR *word writes* in the VCD — both layout-independent.
#
# Upstream's own onboarding configs have the same shape (stm32f0, stm32f072,
# stm32f4, stm32f746, stm32h743 all declare stm32_gpioport with no profile at
# V2-family base addresses).
flash:
  base: 134217728
  size: 256KB
ram:
  base: 536870912
  size: 64KB
peripherals:
- id: usart1
  type: stm32f7_usart
  bus: sysbus
  base_address: 1073821696
- id: usart2
  type: stm32f7_usart
  bus: sysbus
  base_address: 1073759232
- id: usart3
  type: stm32f7_usart
  bus: sysbus
  base_address: 1073760256
- id: usart4
  type: stm32f7_usart
  bus: sysbus
  base_address: 1073761280
- id: usart5
  type: stm32f7_usart
  bus: sysbus
  base_address: 1073762304
- id: usart6
  type: stm32f7_usart
  bus: sysbus
  base_address: 1073812480
- id: usart7
  type: stm32f7_usart
  bus: sysbus
  base_address: 1073813504
- id: gpioPortA
  type: stm32_gpioport
  bus: sysbus
  base_address: 1207959552
  config:
    profile: stm32v2
- id: gpioPortB
  type: stm32_gpioport
  bus: sysbus
  base_address: 1207960576
  config:
    profile: stm32v2
- id: gpioPortC
  type: stm32_gpioport
  bus: sysbus
  base_address: 1207961600
  config:
    profile: stm32v2
- id: gpioPortD
  type: stm32_gpioport
  bus: sysbus
  base_address: 1207962624
  config:
    profile: stm32v2
- id: gpioPortE
  type: stm32_gpioport
  bus: sysbus
  base_address: 1207963648
  config:
    profile: stm32v2
- id: gpioPortF
  type: stm32_gpioport
  bus: sysbus
  base_address: 1207964672
  config:
    profile: stm32v2
- id: i2c1
  type: stm32f7_i2c
  bus: sysbus
  base_address: 1073763328
- id: i2c2
  type: stm32f7_i2c
  bus: sysbus
  base_address: 1073764352
- id: spi1
  type: stm32spi
  bus: sysbus
  base_address: 1073819648
- id: spi2
  type: stm32spi
  bus: sysbus
  base_address: 1073756160
- id: timer1
  type: stm32_timer
  bus: sysbus
  base_address: 1073818624
- id: timer2
  type: stm32_timer
  bus: sysbus
  base_address: 1073741824
- id: timer3
  type: stm32_timer
  bus: sysbus
  base_address: 1073742848
  # ORACLE FIXTURE EDIT (2026-08-25): the upstream onboarding yaml wires
  # NO interrupts at all (the mature f103 config wires one per
  # peripheral) -- without this, TIM3's update event never pends the
  # NVIC and a tick-driven firmware hangs after its banner. IRQ 16 is
  # TIM3's position on the F0 (RM0360 Table 32), the same number the
  # firmware's vector table uses.
  irq: 16
- id: timer6
  type: stm32_timer
  bus: sysbus
  base_address: 1073745920
- id: timer7
  type: stm32_timer
  bus: sysbus
  base_address: 1073746944
- id: timer14
  type: stm32_timer
  bus: sysbus
  base_address: 1073750016
- id: timer15
  type: stm32_timer
  bus: sysbus
  base_address: 1073823744
- id: timer16
  type: stm32_timer
  bus: sysbus
  base_address: 1073824768
- id: timer17
  type: stm32_timer
  bus: sysbus
  base_address: 1073825792
- id: can
  type: stmcan
  bus: sysbus
  base_address: 1073767424
- id: rtc
  type: stm32f4_rtc
  bus: sysbus
  base_address: 1073752064
- id: rcc
  type: pythonperipheral
  bus: sysbus
  base_address: 1073876992
- id: DMA
  type: pythonperipheral
  bus: sysbus
  base_address: 1073872896
- id: adc
  type: stm32f0_adc
  bus: sysbus
  base_address: 1073816576
- id: crc
  type: stm32_crc
  bus: sysbus
  base_address: 1073885184
`;

/**
 * The F030 header pins the codegen can name, mapped to the engine's peripheral
 * ids. Deliberately the same set as `STM32F0_PINS` in stm32-adapter.js — the
 * two tiers must offer a project the SAME pins or a design that runs on one
 * silently loses I/O on the other.
 */
export const STM32F0_LABWIRED_PINS = (() => {
  const defs = {};
  for (let bit = 0; bit <= 7; bit++) defs[`PA${bit}`] = { peripheral: 'gpioPortA', pin: bit };
  defs.PA9 = { peripheral: 'gpioPortA', pin: 9 };
  defs.PA10 = { peripheral: 'gpioPortA', pin: 10 };
  defs.PB1 = { peripheral: 'gpioPortB', pin: 1 };
  return defs;
})();

/**
 * ADC channel per header pin. RM0360: ADC_IN`n` is the PA`n` pad for n = 0..7,
 * which is the same rule `stm32-adapter.js` uses on the light tier
 * (`onAnalogRead(ch) → board.readAnalog('PA'+ch)`). PA9/PA10/PB1 have no
 * channel on this part's cap, so they are absent rather than mapped to 0 —
 * an absent entry is what makes the bridge call an analog attachment on them
 * a refusal instead of silently reading channel 0.
 */
export const STM32F0_ADC_CHANNELS = (() => {
  const defs = {};
  for (let bit = 0; bit <= 7; bit++) defs[`PA${bit}`] = bit;
  return defs;
})();

/**
 * Pads the codegen can drive from a timer (TIM3 CH1/CH2/CH4 via AF1).
 *
 * Recorded for the bridge's benefit and DELIBERATELY not used to pick a
 * `board_io` kind: whether a pad is driven by a timer or by BSRR is a firmware
 * fact the netlist cannot see, and labwired reads `kind: pwm_output` and
 * `kind: led` through the identical `read_gpio_output` call anyway. Emitting
 * `pwm_output` from a wiring guess would be a claim the manifest cannot back.
 */
export const STM32F0_PWM_PINS = ['PA6', 'PA7', 'PB1'];

/** Everything a caller needs to stand up the F0 on the heavy tier. */
export const STM32F0 = {
  chipYaml: STM32F0_CHIP_YAML,
  pins: STM32F0_LABWIRED_PINS,
  adcChannels: STM32F0_ADC_CHANNELS,
  pwmPins: STM32F0_PWM_PINS,
  clockHz: 48_000_000,
  name: 'bw-stm32f0',
  /** The ADC peripheral id in the chip YAML above (`set_adc_value`'s target). */
  adcPeripheral: 'adc',
  /**
   * Our engine's board-part kinds that ARE this chip. `board-kinds.js`
   * registers `stm32f030`; bw-circuit-ui's canonical loader rewrites every
   * controller kind to the generic `mcu` before the netlist reaches the engine,
   * so the netlist alone cannot say which silicon it is — the caller passes the
   * kind, exactly as lite's device picker already knows it.
   */
  boardKinds: ['stm32f030'],
};

/** LabWired's proven AVR target is ATmega328P-class, not ATtiny88. */
export const ATMEGA328P_CHIP_YAML = `name: "atmega328p"
arch: "avr"
core: "avr8"
registers_count: 32
cpu_hz: 16_000_000
io_voltage_v: 5.0
gpio_input_thresholds:
  vil: 0.3
  vih: 0.6
flash:
  base: 0x00000000
  size: "32KB"
ram:
  base: 0x00000100
  size: "2KB"
peripherals:
  - id: "spi"
    type: "spi"
    base_address: 0x00010000
    size: "16"
  - id: "i2c"
    type: "i2c"
    base_address: 0x00010010
    size: "16"
  - id: "portb"
    type: "avr_gpio"
    base_address: 0x00010023
    size: "3"
  - id: "portc"
    type: "avr_gpio"
    base_address: 0x00010026
    size: "3"
  - id: "portd"
    type: "avr_gpio"
    base_address: 0x00010029
    size: "3"
  - id: "adc"
    type: "avr_adc"
    base_address: 0x00010030
    size: "16"
`;

export const ATMEGA328P_LABWIRED_PINS = (() => {
  const defs = {};
  for (let bit = 0; bit <= 7; bit++) defs[`D${bit}`] = { peripheral: 'portd', pin: bit };
  for (let bit = 0; bit <= 5; bit++) defs[`D${bit + 8}`] = { peripheral: 'portb', pin: bit };
  for (let bit = 0; bit <= 5; bit++) defs[`A${bit}`] = { peripheral: 'portc', pin: bit };
  return defs;
})();

export const ATMEGA328P_ADC_CHANNELS = (() => {
  const defs = {};
  for (let bit = 0; bit <= 5; bit++) defs[`A${bit}`] = bit;
  return defs;
})();

export const ATMEGA328P = {
  chipYaml: ATMEGA328P_CHIP_YAML,
  pins: ATMEGA328P_LABWIRED_PINS,
  adcChannels: ATMEGA328P_ADC_CHANNELS,
  pwmPins: [],
  clockHz: 16_000_000,
  name: 'bw-atmega328p',
  adcPeripheral: 'adc',
  boardKinds: ['arduino_uno'],
};

/** BBC micro:bit v2 / nRF52833, synchronized from labwired-core. */
export const NRF52833_CHIP_YAML = `# LabWired - Nordic nRF52833 Chip Descriptor
#
# Sources:
#   * Nordic nRF52833 Product Specification v1.7 (memory map §4.2.4; GPIO §6.8;
#     UARTE §6.33; peripheral instantiation table).
#   * Nordic nrfx MDK \`nrf52833.svd\` (peripheral base addresses + NVIC IRQ
#     numbers), the same vendor SVD that backs the nRF52840 register sweep.
#
# nRF52833 = Cortex-M4F, 64 MHz, 512 KB flash, 128 KB RAM, 42 GPIOs
# (P0.00-P0.31 + P1.00-P1.09). The peripheral map is an nRF52840 SUBSET: every
# block below shares nRF52833/nRF52840 silicon IP and IRQ number. The 52833
# omits QSPI and CryptoCell entirely, so neither is declared here even though
# nrf52840.yaml carries them. ACL is present (PS v1.7 ch. 6.3) but shares the
# NVMC window at 0x4001E000, which is what this descriptor declares.
name: "nrf52833"
arch: "arm"
core: "cortex-m4"
# Simulated core clock, Hz — see ChipDescriptor::cpu_hz. Self-timed devices
# scale their datasheet microseconds by it; a slower board overrides it.
# nRF52833 runs its Cortex-M4F at a fixed 64 MHz.
cpu_hz: 64_000_000

flash:
  base: 0x00000000
  size: "512KB"
ram:
  base: 0x20000000
  size: "128KB"
# Nordic nRF5 SDK / ArduinoCore-nRF5 errata probes read a reserved silicon
# fingerprint window at 0xF0000FE0 (nrf52_errata_16 etc.). Map a tiny
# zero-filled window so "not this rev" is honest — same pattern as
# configs/chips/nrf52840.yaml and configs/chips/nrf52832.yaml.
memory_regions:
  - name: "nrf_errata_probe"
    base: 0xF0000000
    size: "4KB"
peripherals:
  # Debug schemas point at the nRF52840 descriptors: these blocks are the same
  # Nordic IP at the same offsets (nrfx nrf52833.svd / nrf52840.svd agree), and
  # the schema is debugger decode metadata only — it models no register.
  #
  # DMA on this silicon is EasyDMA: there is NO central DMA controller, so no
  # instance id/type contains "dma" and the tier-1 row would read \`na\` from the
  # heuristic alone. The EasyDMA blocks below opt the class in explicitly via
  # \`tier1_classes: ["dma"]\` (crates/cli/src/tier1.rs reads it; every other
  # chip YAML is unaffected). The TIER1 \`dma\` check in
  # examples/tier1-fixture/nrf52833 proves EasyDMA descriptor semantics —
  # PTR/MAXCNT/AMOUNT and the transferred payload.
  - id: "uart0"
    type: "nrf52840_uart"
    base_address: 0x40002000
    size: "4KB"
    irq: 2
    config:
      debug_schema: "../peripherals/nrf52840/uart0.yaml"
      tier1_classes: ["dma"] # UARTE is an EasyDMA block
  # SPIM0/TWIM0 share 0x40003000; active peripheral selected by ENABLE (6=TWIM, 7=SPIM).
  - id: "i2c0"
    type: "nrf52840_serial"
    base_address: 0x40003000
    size: "4KB"
    irq: 3
    config:
      debug_schema: "../peripherals/nrf52840/twim0.yaml"
      tier1_classes: ["dma"] # TWIM is an EasyDMA block
  - id: "gpio0"
    type: "gpio"
    base_address: 0x50000000
    size: "4KB"
    config:
      debug_schema: "../peripherals/nrf52840/p0.yaml"
      profile: "nrf52"
  # P1 is P1.00-P1.09 on the nRF52833 (10 pins; the family total is 42 GPIOs).
  # The sim window is remapped to 0x50001000 to avoid GPIO0's 4KB window — same
  # simulator memory map as nrf52840.yaml.
  - id: "gpio1"
    type: "gpio"
    base_address: 0x50001000
    size: "4KB"
    config:
      debug_schema: "../peripherals/nrf52840/p1.yaml"
      profile: "nrf52"
      num_pins: 10
  - id: "uart1"
    type: "nrf52840_uart"
    base_address: 0x40028000
    size: "4KB"
    irq: 40
    config:
      debug_schema: "../peripherals/nrf52840/uarte1.yaml"
  - id: "clock"
    type: "nrf_clock"
    base_address: 0x40000000
    size: "4KB"
    irq: 0
    config:
      debug_schema: "../peripherals/nrf52840/clock.yaml"
  - id: "radio"
    type: "nrf52840_radio"
    base_address: 0x40001000
    size: "4KB"
    irq: 1
    config:
      debug_schema: "../peripherals/nrf52840/radio.yaml"
  - id: "twi1"
    type: "nrf52840_i2c"
    base_address: 0x40004000
    size: "4KB"
    irq: 4
    config:
      debug_schema: "../peripherals/nrf52840/twi1.yaml"
  - id: "nfct"
    type: "nrf52840_nfct"
    base_address: 0x40005000
    size: "4KB"
    irq: 5
    config:
      debug_schema: "../peripherals/nrf52840/nfct.yaml"
  - id: "gpiote"
    type: "nrf52840_gpiotasksevents"
    base_address: 0x40006000
    size: "4KB"
    irq: 6
    config:
      debug_schema: "../peripherals/nrf52840/gpiote.yaml"
  - id: "saadc"
    type: "nrf52840_saadc"
    base_address: 0x40007000
    size: "4KB"
    irq: 7
    config:
      debug_schema: "../peripherals/nrf52840/saadc.yaml"
      tier1_classes: ["dma"] # SAADC RESULT is an EasyDMA block
  - id: "timer0"
    type: "nrf52840_timer"
    base_address: 0x40008000
    size: "4KB"
    irq: 8
    config:
      debug_schema: "../peripherals/nrf52840/timer0.yaml"
  - id: "timer1"
    type: "nrf52840_timer"
    base_address: 0x40009000
    size: "4KB"
    irq: 9
    config:
      debug_schema: "../peripherals/nrf52840/timer1.yaml"
  - id: "timer2"
    type: "nrf52840_timer"
    base_address: 0x4000a000
    size: "4KB"
    irq: 10
    config:
      debug_schema: "../peripherals/nrf52840/timer2.yaml"
  - id: "rtc0"
    type: "nrf52840_rtc"
    base_address: 0x4000b000
    size: "4KB"
    irq: 11
    config:
      debug_schema: "../peripherals/nrf52840/rtc0.yaml"
  - id: "temp"
    type: "nrf52840_temp"
    base_address: 0x4000c000
    size: "4KB"
    irq: 12
    config:
      debug_schema: "../peripherals/nrf52840/temp.yaml"
  - id: "rng"
    type: "nrf52840_rng"
    base_address: 0x4000d000
    size: "4KB"
    irq: 13
    config:
      debug_schema: "../peripherals/nrf52840/rng.yaml"
  - id: "ecb"
    type: "nrf52840_ecb"
    base_address: 0x4000e000
    size: "4KB"
    irq: 14
    config:
      debug_schema: "../peripherals/nrf52840/ecb.yaml"
  # AAR and CCM share 0x4000f000 (SVD 52833/52840); the engine models the
  # AAR personality on this window.
  - id: "aar"
    type: "nrf52840_aar"
    base_address: 0x4000f000
    size: "4KB"
    irq: 15
    config:
      debug_schema: "../peripherals/nrf52840/aar.yaml"
  - id: "wdt"
    type: "nrf52840_watchdog"
    base_address: 0x40010000
    size: "4KB"
    irq: 16
    config:
      debug_schema: "../peripherals/nrf52840/wdt.yaml"
  - id: "rtc1"
    type: "nrf52840_rtc"
    base_address: 0x40011000
    size: "4KB"
    irq: 17
    config:
      debug_schema: "../peripherals/nrf52840/rtc1.yaml"
      num_cc: 4
  - id: "qdec"
    type: "nrf52840_qdec"
    base_address: 0x40012000
    size: "4KB"
    irq: 18
    config:
      debug_schema: "../peripherals/nrf52840/qdec.yaml"
  # COMP and LPCOMP share 0x40013000; the engine models the COMP personality.
  - id: "comp"
    type: "nrf52840_comp"
    base_address: 0x40013000
    size: "4KB"
    irq: 19
    config:
      debug_schema: "../peripherals/nrf52840/comp.yaml"
  - id: "egu0"
    type: "nrf52840_egu"
    base_address: 0x40014000
    size: "4KB"
    irq: 20
    config:
      debug_schema: "../peripherals/nrf52840/egu0.yaml"
  - id: "egu1"
    type: "nrf52840_egu"
    base_address: 0x40015000
    size: "4KB"
    irq: 21
    config:
      debug_schema: "../peripherals/nrf52840/egu1.yaml"
  - id: "egu2"
    type: "nrf52840_egu"
    base_address: 0x40016000
    size: "4KB"
    irq: 22
    config:
      debug_schema: "../peripherals/nrf52840/egu2.yaml"
  - id: "egu3"
    type: "nrf52840_egu"
    base_address: 0x40017000
    size: "4KB"
    irq: 23
    config:
      debug_schema: "../peripherals/nrf52840/egu3.yaml"
  - id: "egu4"
    type: "nrf52840_egu"
    base_address: 0x40018000
    size: "4KB"
    irq: 24
    config:
      debug_schema: "../peripherals/nrf52840/egu4.yaml"
  - id: "egu5"
    type: "nrf52840_egu"
    base_address: 0x40019000
    size: "4KB"
    irq: 25
    config:
      debug_schema: "../peripherals/nrf52840/egu5.yaml"
  - id: "timer3"
    type: "nrf52840_timer"
    base_address: 0x4001a000
    size: "4KB"
    irq: 26
    config:
      debug_schema: "../peripherals/nrf52840/timer3.yaml"
      num_cc: 6
  - id: "timer4"
    type: "nrf52840_timer"
    base_address: 0x4001b000
    size: "4KB"
    irq: 27
    config:
      debug_schema: "../peripherals/nrf52840/timer4.yaml"
      num_cc: 6
  - id: "pwm0"
    type: "nrf52840_pwm"
    base_address: 0x4001c000
    size: "4KB"
    irq: 28
    config:
      debug_schema: "../peripherals/nrf52840/pwm0.yaml"
      tier1_classes: ["dma"] # PWM sequence playback is EasyDMA from SEQ[].PTR
  - id: "pdm"
    type: "nrf52840_pdm"
    base_address: 0x4001d000
    size: "4KB"
    irq: 29
    config:
      debug_schema: "../peripherals/nrf52840/pdm.yaml"
  - id: "nvmc"
    type: "nrf52840_nvmc"
    base_address: 0x4001e000
    size: "4KB"
    config:
      debug_schema: "../peripherals/nrf52840/nvmc.yaml"
  - id: "ppi"
    type: "nrf52840_ppi"
    base_address: 0x4001f000
    size: "4KB"
    config:
      debug_schema: "../peripherals/nrf52840/ppi.yaml"
  - id: "mwu"
    type: "nrf52840_mwu"
    base_address: 0x40020000
    size: "4KB"
    irq: 32
    config:
      debug_schema: "../peripherals/nrf52840/mwu.yaml"
  - id: "pwm1"
    type: "nrf52840_pwm"
    base_address: 0x40021000
    size: "4KB"
    # nRF52833 PWM1_IRQn = 33 (SVD); 29 is PDM.
    irq: 33
    config:
      debug_schema: "../peripherals/nrf52840/pwm1.yaml"
  - id: "pwm2"
    type: "nrf52840_pwm"
    base_address: 0x40022000
    size: "4KB"
    irq: 34
    config:
      debug_schema: "../peripherals/nrf52840/pwm2.yaml"
  - id: "spi2"
    type: "nrf52840_spi"
    base_address: 0x40023000
    size: "4KB"
    irq: 35
    config:
      # Nordic SPIM, stated explicitly — \`SpiRegisterLayout\` derives Default =
      # Stm32, so omitting this would silently answer reads from the STM32 SPI
      # register map. Same trap documented in nrf52840.yaml.
      profile: "nrf52_spim"
      debug_schema: "../peripherals/nrf52840/spi2.yaml"
      tier1_classes: ["dma"] # SPIM is an EasyDMA block
  - id: "rtc2"
    type: "nrf52840_rtc"
    base_address: 0x40024000
    size: "4KB"
    irq: 36
    config:
      debug_schema: "../peripherals/nrf52840/rtc2.yaml"
      num_cc: 4
  - id: "i2s"
    type: "nrf52840_i2s"
    base_address: 0x40025000
    size: "4KB"
    irq: 37
    config:
      debug_schema: "../peripherals/nrf52840/i2s.yaml"
  - id: "usbd"
    type: "nrf52840_usbd"
    base_address: 0x40027000
    size: "4KB"
    irq: 39
    config:
      debug_schema: "../peripherals/nrf52840/usbd.yaml"
  - id: "pwm3"
    type: "nrf52840_pwm"
    base_address: 0x4002d000
    size: "4KB"
    irq: 45
    config:
      debug_schema: "../peripherals/nrf52840/pwm3.yaml"
  # SPIM3/SPIS3 — the "high-speed 32 MHz SPI" block. Only SPIM3 exists here:
  # there is no TWIM3 on this part (SVD 52833).
  - id: "spi3"
    type: "nrf52840_spi"
    base_address: 0x4002f000
    size: "4KB"
    irq: 47
    config:
      profile: "nrf52_spim"
      debug_schema: "../peripherals/nrf52840/spim3.yaml"
  - id: "ficr"
    type: "nrf52840_ficr"
    base_address: 0x10000000
    size: "4KB"
    config:
      debug_schema: "../peripherals/nrf52840/ficr.yaml"
  - id: "uicr"
    type: "nrf52840_uicr"
    base_address: 0x10001000
    size: "4KB"
    config:
      debug_schema: "../peripherals/nrf52840/uicr.yaml"
  # NVIC is part of the Cortex-M4F System Control Space, not a Nordic
  # peripheral — there is no nrf52833.svd entry and no nRF52-specific model.
  # The engine installs it for every Cortex-M chip regardless; declaring it
  # here is what makes the tier-1 \`irq\` class resolve to this chip's row
  # instead of \`na\` (same shape as stm32g071.yaml). IRQ numbers come from the
  # nrfx nrf52833.svd \`*_IRQn\` values on the peripherals above.
  - id: "nvic"
    type: "nvic"
    base_address: 0xE000E100
    size: "1KB"
`;

/**
 * micro:bit edge connector → nRF52833 package pin.  These values are the
 * `MICROBIT_PIN_P*` definitions in codal-microbit-v2's MIT-licensed
 * MicroBitIO.h, not the misleading edge-connector ordinal.
 */
export const MICROBIT_V2_LABWIRED_PINS = {
  p0: { peripheral: 'gpio0', pin: 2 }, p1: { peripheral: 'gpio0', pin: 3 },
  p2: { peripheral: 'gpio0', pin: 4 }, p3: { peripheral: 'gpio0', pin: 31 },
  p4: { peripheral: 'gpio0', pin: 28 }, p5: { peripheral: 'gpio0', pin: 14 },
  p6: { peripheral: 'gpio1', pin: 5 }, p7: { peripheral: 'gpio0', pin: 11 },
  p8: { peripheral: 'gpio0', pin: 10 }, p9: { peripheral: 'gpio0', pin: 9 },
  p10: { peripheral: 'gpio0', pin: 30 }, p11: { peripheral: 'gpio0', pin: 23 },
  p12: { peripheral: 'gpio0', pin: 12 }, p13: { peripheral: 'gpio0', pin: 17 },
  p14: { peripheral: 'gpio0', pin: 1 }, p15: { peripheral: 'gpio0', pin: 13 },
  p16: { peripheral: 'gpio1', pin: 2 }, p19: { peripheral: 'gpio0', pin: 26 },
  p20: { peripheral: 'gpio1', pin: 0 },
};

export const MICROBIT_V2 = {
  chipYaml: NRF52833_CHIP_YAML,
  pins: MICROBIT_V2_LABWIRED_PINS,
  adcChannels: { p0: 0, p1: 1, p2: 2, p3: 7, p4: 4, p10: 6 },
  pwmPins: Object.keys(MICROBIT_V2_LABWIRED_PINS),
  clockHz: 64_000_000,
  flashOrigin: 0,
  name: 'bw-microbit-v2',
  adcPeripheral: 'saadc',
  boardKinds: ['microbit', 'microbit_v2'],
};

/** Adafruit PyBadge / ATSAMD51J19A, synchronized from labwired-core. */
export const ATSAMD51_CHIP_YAML = `# LabWired - Firmware Simulation Platform
# Copyright (C) 2026 Andrii Shylenko
#
# This software is released under the MIT License.
# See the LICENSE file in the project root for full license information.
#
# SIM-DERIVED SAMD51J19A descriptor for Adafruit Metro M4 bring-up.
# Not silicon-verified. Bench silicon may be ItsyBitsy M4 (SAMD51G19A);
# Playground pinout is Metro M4. QSPI, USB, NeoPixel, and unused SERCOMs
# are intentionally stubbed / omitted — only the MCU core, PORT, MCLK/GCLK,
# SERCOM1/3 UARTs and SysTick are modelled here.
# Pin labels follow Adafruit ArduinoCore-samd variants/metro_m4/variant.cpp.

name: "atsamd51j19a"
arch: "arm"
core: "cortex-m4"
cpu_hz: 120_000_000
flash:
  base: 0x00000000
  size: "512KB"
ram:
  base: 0x20000000
  size: "192KB"
# PyBadge's resident UF2 bootloader occupies the first 16 KiB. Raw MakeCode
# Arcade application payloads carry their vector table at this offset.
reset_vector_offset: 0x4000
pins:
  # PyBadge Feather TX/RX — SERCOM1 PAD[0]/PAD[1].
  PA17: { gpio: porta, bit: 17, functions: [{ type: uart, peripheral: sercom1, role: rx }] }
  # D0 / RX — variant.cpp: PORTA 23 (SERCOM3/PAD[1]).
  PA23: { gpio: porta, bit: 23, functions: [{ type: uart, peripheral: sercom3, role: rx }] }
  # D1 / TX — variant.cpp: PORTA 22 (SERCOM3/PAD[0]).
  PA22: { gpio: porta, bit: 22, functions: [{ type: uart, peripheral: sercom3, role: tx }] }
  # Metro D13 LED / PyBadge Feather TX.
  PA16: { gpio: porta, bit: 16, functions: [{ type: gpio, peripheral: porta }, { type: uart, peripheral: sercom1, role: tx }] }
peripherals:
  - id: "mclk"
    type: "sam_mclk"
    base_address: 0x40000800
    size: "256B"
  - id: "gclk"
    type: "sam_gclk"
    base_address: 0x40001C00
    size: "1KB"
  - id: "porta"
    type: "gpio"
    base_address: 0x41008000
    size: "128B"
    config:
      profile: "sam_port"
  - id: "portb"
    type: "gpio"
    base_address: 0x41008080
    size: "128B"
    config:
      profile: "sam_port"
  # PyBadge Feather UART on PA16/PA17 (SERCOM1 PAD0/PAD1).
  # MCLK.APBAMASK bit 13; GCLK PCHCTRL[8] = SERCOM1_CORE.
  - id: "sercom1"
    type: "uart"
    base_address: 0x40003400
    size: "256B"
    irq: 50
    clock:
      controller: "mclk"
      reg: "APBAMASK"
      bit: 13
    config:
      profile: "sercom"
      gclk_id: 8
  - id: "systick"
    type: "systick"
    base_address: 0xE000E010
  # Serial1 — SERCOM3 on PA22/PA23 (variant.cpp Uart Serial1(&sercom3, ...)).
  # MCLK.APBBMASK bit 10; GCLK PCHCTRL[24] = SERCOM3_CORE (DS60001507).
  - id: "sercom3"
    type: "uart"
    base_address: 0x41014000
    size: "256B"
    irq: 58
    clock:
      controller: "mclk"
      reg: "APBBMASK"
      bit: 10
    config:
      profile: "sercom"
      gclk_id: 24
  - id: "usb"
    type: "stub"
    base_address: 0x41000000
    size: "1KB"
  - id: "qspi"
    type: "stub"
    base_address: 0x42003400
    size: "1KB"
`;

/** PyBadge header map from Microsoft's UF2 board_config.h CF2 table. */
export const PYBADGE_LABWIRED_PINS = {
  a0: { peripheral: 'porta', pin: 2 }, a1: { peripheral: 'porta', pin: 5 },
  a2: { peripheral: 'portb', pin: 8 }, a3: { peripheral: 'portb', pin: 9 },
  a4: { peripheral: 'porta', pin: 4 }, a5: { peripheral: 'porta', pin: 6 },
  sck: { peripheral: 'porta', pin: 17 }, mosi: { peripheral: 'portb', pin: 23 },
  miso: { peripheral: 'portb', pin: 22 }, rx: { peripheral: 'porta', pin: 17 },
  tx: { peripheral: 'porta', pin: 16 }, sda: { peripheral: 'porta', pin: 12 },
  scl: { peripheral: 'porta', pin: 13 }, stemma_sda: { peripheral: 'porta', pin: 12 },
  stemma_scl: { peripheral: 'porta', pin: 13 }, d2: { peripheral: 'portb', pin: 3 },
  d3: { peripheral: 'portb', pin: 2 }, d5: { peripheral: 'porta', pin: 16 },
  d6: { peripheral: 'porta', pin: 18 }, free: { peripheral: 'portb', pin: 14 },
  d9: { peripheral: 'porta', pin: 19 }, d10: { peripheral: 'porta', pin: 20 },
  d11: { peripheral: 'porta', pin: 21 }, d12: { peripheral: 'porta', pin: 22 },
  d13: { peripheral: 'porta', pin: 23 },
};

export const PYBADGE = {
  chipYaml: ATSAMD51_CHIP_YAML,
  pins: PYBADGE_LABWIRED_PINS,
  adcChannels: { a0: 0, a1: 5, a2: 2, a3: 3, a4: 4, a5: 6 },
  pwmPins: ['d5', 'd6', 'd9', 'd13'],
  clockHz: 120_000_000,
  flashOrigin: 0,
  // MakeCode Arcade UF2 payloads begin after the resident 16 KiB bootloader.
  // Callers with a full-flash image can still override `firmwareAddress: 0`.
  firmwareOrigin: 0x4000,
  name: 'bw-pybadge',
  boardKinds: ['pybadge'],
};

/** Board-part kind → heavy-tier chip. The one place a new chip gets added. */
export const LABWIRED_CHIPS = {
  stm32f030: STM32F0,
  arduino_uno: ATMEGA328P,
  microbit_v2: MICROBIT_V2,
  microbit: MICROBIT_V2,
  pybadge: PYBADGE,
};
