/**
 * STM32F0 → boundary A adapter: the F030 machine drives the circuit
 * board exactly the way every other core does — pin edges arrive as
 * `board.setPin(name, mode, driveHigh)`, time as `board.advanceTo(tNs)`
 * (bigint, time first, edge second), inputs sync back from the board
 * each slice and each output edge, and attachBoard SEATS every header
 * pin's initial state (the push-callback-only-fires-on-changes lesson,
 * emu8051-adapter 0263cd4 — pillar 1 of the shared adapter contract).
 *
 * The returned object also exposes the facade `createRp2040jsDebugTarget`
 * consumes ({ rp2040: bus+sram+clock, core, clockHz, timeNs, advanceNs,
 * syncInputs, resetToProgram }) — the debug target is core-agnostic over
 * that surface, so the F0 reuses it wholesale instead of growing a
 * second 500-line stepper (STM32-PATH.md tier cap: no new machinery
 * where existing machinery fits).
 *
 * @module
 */

import { CortexM0Machine } from './cortex-m0-machine.js';
import { attachStm32F0 } from './stm32f0-board.js';

/** The F030 header pins the codegen can name (armHw stm32 variant):
 *  PA0–PA7, PA9/PA10 (USART1 TX/RX when AF'd), PB1. */
export const STM32F0_PINS = (() => {
  const defs = {};
  for (let bit = 0; bit <= 7; bit++) defs[`PA${bit}`] = { port: 0, bit };
  defs.PA9 = { port: 0, bit: 9 };
  defs.PA10 = { port: 0, bit: 10 };
  defs.PB1 = { port: 1, bit: 1 };
  return defs;
})();

/**
 * @param {object} [opts]
 * @param {Uint8Array} [opts.program] flash image (vectors first)
 * @param {number} [opts.clockHz] default 48 MHz
 * @returns {object} boundary-A adapter + debug-target facade
 */
export function createStm32F0Adapter (opts = {}) {
  const clockHz = opts.clockHz ?? 48_000_000;
  const machine = new CortexM0Machine({ clockHz, sramBytes: 4096, flashBytes: 16 * 1024 });

  let board = null;
  let serialListener = null;
  let inInputSync = false;
  const stats = { pinChangeCount: 0, advanceToCount: 0 };

  // Last published (mode, high) per pin: the F0 GPIO republishes the
  // whole port on every BSRR write, so the adapter dedups — the board
  // sees edges, not repetition (MNA churn and stub-board noise both).
  const published = new Map();

  const publish = (pin, mode, driveHigh) => {
    if (!board || !(pin in STM32F0_PINS)) return;
    const prev = published.get(pin);
    if (prev && prev.mode === mode && prev.high === driveHigh) return;
    published.set(pin, { mode, high: driveHigh });
    if (board.advanceTo) board.advanceTo(machine.timeNs()); // time first
    board.setPin(pin, mode, driveHigh);
    stats.pinChangeCount++;
    // Outputs the firmware just changed may feed inputs it reads in the
    // same slice (a keypad scan) — refresh, like the AVR adapter.
    if (!inInputSync) syncInputs();
  };

  const peripherals = attachStm32F0(machine, {
    onPinChange: publish,
    onSerialByte: (b) => { if (serialListener) serialListener(b); },
  });

  function syncInputs () {
    if (!board || !board.readPin) return;
    inInputSync = true;
    try {
      for (const [name, def] of Object.entries(STM32F0_PINS)) {
        const gpio = def.port === 0 ? peripherals.gpioA : peripherals.gpioB;
        const mode = (gpio.moder >>> (2 * def.bit)) & 3;
        if (mode !== 0) continue; // MCU-driven or AF: not an input pad
        gpio.setInput(def.bit, board.readPin(name) === 1);
      }
    } finally {
      inInputSync = false;
    }
  }

  const program = opts.program ?? null;
  function resetToProgram () {
    machine.sram.fill(0);
    if (program) machine.loadFirmware(program);
  }
  if (program) machine.loadFirmware(program);

  // The clock facade the shared debug target's execute loop drives.
  // nanosToNextAlarm is a DELTA, same semantics as rp2040js's clock;
  // the 1 µs floor is the machine's own park floor (an interrupt pended
  // but never NVIC-enabled must not livelock the debug loop either).
  const clock = {
    get nanos () { return Number(machine.timeNsInternal); },
    get nanosToNextAlarm () {
      const h = machine.wakeHorizonNs();
      if (!Number.isFinite(h)) return 0;
      return Math.max(1000, h);
    },
    tick (dt) { machine.tickNs(dt); },
  };

  return {
    machine,
    peripherals,
    core: machine.core,
    clockHz,
    // the debug target's `rp2040` facade: the bus object the core holds
    // (so write-watch wraps intercept), plus sram and the clock
    rp2040: Object.assign(machine.bus, { sram: machine.sram, clock }),
    attachBoard (b) {
      board = b;
      published.clear();
      // Seat every header pin's CURRENT state, not just future changes.
      peripherals.gpioA._publishAll();
      peripherals.gpioB._publishAll();
      // Reset-state MODER is all-zeros = plain input: _publishAll covers
      // every header pin, so nothing stays unseated.
      syncInputs();
    },
    syncInputs,
    advanceNs (deltaNs) {
      syncInputs();
      machine.advanceNs(deltaNs);
      if (board && board.advanceTo) {
        board.advanceTo(machine.timeNs());
        stats.advanceToCount++;
      }
    },
    timeNs () { return machine.timeNs(); },
    resetToProgram,
    onSerial (cb) { serialListener = cb; },
    feedSerial (byte) { peripherals.usart1.feed(byte); },
    stats,
  };
}

export default createStm32F0Adapter;
