/**
 * The debugger's target-kind metadata — pure data, and NOTHING ELSE.
 *
 * WHY THIS IS ITS OWN MODULE, restored 2026-09-05. `547bb4e perf: isolate
 * debugger target metadata` created it for exactly one reason: lite's
 * `debug-panel.jsx` dynamic-imports it behind
 * `webpackChunkName: "bw-debug-target-kinds"` so the picker's labels reach the
 * browser WITHOUT the debugger backend. It was folded back into
 * `debug-target-factory.js` shortly after, which silently undid that.
 *
 * THE MEASUREMENT THAT MATTERS: this module is ~2.5 KB with ZERO imports.
 * `debug-target-factory.js` is ~22 KB and pulls emu8051-adapter, avr8js-adapter,
 * labwired-adapter, labwired-debug, labwired-bridge, serial-debug and
 * intel-hex. Pointing that isolated chunk at the factory does not add a few
 * kilobytes -- it drags the entire debugger backend into first load. lite
 * measured 5.53 MB and ratchets against 7; this is how you spend the gap
 * without noticing.
 *
 * SO THE IMPORT-FREEDOM IS THE CONTRACT, not an accident of how it was written.
 * `test/target-kinds-leaf.test.mjs` asserts it, because a comment saying "do
 * not add imports here" is exactly the kind of prose that loses to the first
 * person who needs one.
 *
 * `debug-target-factory.js` re-exports both symbols, so every existing
 * consumer keeps working and this file is additive.
 *
 * @module
 */

/**
 * The labwired kind's menu entry, kept OUT of getTargetKinds() on purpose.
 *
 * Its engine is a 20 MB artifact fetched at deploy time and loaded on demand,
 * so unlike every other kind here it can be genuinely absent. A host that has
 * probed for it (lite's lib/labwired-engine.js) appends this; a host that has
 * not must not offer it. That is the same rule that kept 'rp2040js' out of the
 * list until its compile route existed: a picker entry nobody can select is a
 * lie the front end tells for us.
 */
export const LABWIRED_KIND = {
  kind: 'labwired',
  label: 'Simulated (labwired — full fidelity)',
  description: 'The heavy tier: F103/F4/F7, RISC-V and Xtensa, via the labwired engine. '
    + 'Downloaded on first use.',
};

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
      // MISSING SINCE THE KIND SHIPPED, and the failure was not "no entry" --
      // a <select> whose value matches no option renders the FIRST option, so
      // the picker read "Simulated (STC12 / 8051)" while running 8086 code.
      // A host cannot tell that from a user who chose 8051.
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
