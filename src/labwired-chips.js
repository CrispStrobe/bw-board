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

/** Everything a caller needs to stand up the F0 on the heavy tier. */
export const STM32F0 = {
  chipYaml: STM32F0_CHIP_YAML,
  pins: STM32F0_LABWIRED_PINS,
  clockHz: 48_000_000,
  name: 'bw-stm32f0',
};
