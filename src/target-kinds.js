/**
 * Lightweight target-picker metadata.
 *
 * Keep this module dependency-free: menus need these labels before choosing a
 * target, and importing a list must not pull any emulator, CPU or factory code.
 */

/**
 * The labwired kind's menu entry, kept OUT of getTargetKinds() on purpose.
 * Its 20 MB engine is loaded and probed by the host before this row is added.
 */
export const LABWIRED_KIND = {
  kind: 'labwired',
  label: 'Simulated (labwired — full fidelity)',
  description: 'The heavy tier: F103/F4/F7, RISC-V and Xtensa, via the labwired engine. '
    + 'Downloaded on first use.',
};

/**
 * The known target kinds for the target picker UI.
 * @returns {Array<{kind: string, label: string, description: string}>}
 */
export function getTargetKinds() {
  return [
    {
      kind: 'emulator',
      label: 'Simulated (STC12 / 8051)',
      description: 'Full instruction-level 8051 emulation. All debug features available.',
    },
    {
      kind: 'avr8js',
      label: 'Simulated (ATmega328P)',
      description: 'AVR instruction-level emulation. Arduino Nano/Uno programs.',
    },
    {
      kind: 'atmega2560',
      label: 'Simulated (ATmega2560)',
      description: 'AVR instruction-level emulation. Arduino Mega programs.',
    },
    {
      kind: 'attiny85',
      label: 'Simulated (ATtiny85)',
      description: 'AVR instruction-level emulation. ATtiny85/Digispark programs.',
    },
    {
      kind: 'z80',
      label: 'Simulated (Z80)',
      description: 'Composable Z80 machine — Searle bench, CP/M, ZX Spectrum configs.',
    },
    {
      kind: 'i8086',
      label: 'Simulated (8086 / 8088)',
      description: 'Composable 8086 machine — breadboard, XT board with CGA and floppy, or DOS programs.',
    },
    {
      kind: 'attiny88',
      label: 'Simulated (ATtiny88)',
      description: 'AVR instruction-level emulation. ATtiny88 (blinkenrocket-class boards).',
    },
    {
      kind: 'eater6502',
      label: 'Simulated (6502 breadboard)',
      description: '6502 instruction-level emulation. VIA/ACIA-based breadboard computers.',
    },
    {
      kind: 'rp2040js',
      label: 'Simulated (RP2040)',
      description: 'ARM Cortex-M0+ emulation. Raspberry Pi Pico programs.',
    },
    {
      kind: 'stm32f0',
      label: 'Simulated (STM32F030)',
      description: 'ARM Cortex-M0 emulation. STM32F030 (16K flash / 4K SRAM) programs.',
    },
    {
      kind: 'serial',
      label: 'Live board (USB)',
      description: 'Real hardware over serial. Block stepping and yield breakpoints only.',
    },
  ];
}
