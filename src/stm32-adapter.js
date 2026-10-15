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
import { stm32f0TemperatureVolts, stm32g0TemperatureVolts, benchCelsius } from './chip-temperature.js';
import { attachStm32F0, attachStm32G0, fillPowerOnRam } from './stm32f0-board.js';

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

/** The G030 header pins (PA0-PA15, PB0-PB9, PC14-PC15). */
export const STM32G0_PINS = (() => {
  const defs = {};
  for (let bit = 0; bit <= 15; bit++) defs[`PA${bit}`] = { port: 0, bit };
  for (let bit = 0; bit <= 9; bit++) defs[`PB${bit}`] = { port: 1, bit };
  defs.PC14 = { port: 2, bit: 14 };
  defs.PC15 = { port: 2, bit: 15 };
  return defs;
})();

function createStm32AdapterInternal ({
  family,
  fixedClockHz = null,
  hseHz = 0,
  ramAtReset = 'pattern',
  sramBytes,
  flashBytes,
  pinDefs,
  program = null,
}) {
  // The core clock is whatever the firmware's RCC setup selects (reset:
  // HSI). The machine's construction value is overwritten by the attach.
  const machine = new CortexM0Machine({ sramBytes, flashBytes });
  const attach = family === 'g0' ? attachStm32G0 : attachStm32F0;
  const sensorVolts = family === 'g0' ? stm32g0TemperatureVolts : stm32f0TemperatureVolts;

  let board = null;
  let serialListener = null;
  let inInputSync = false;
  const stats = { pinChangeCount: 0, advanceToCount: 0 };

  // Last published (mode, high) per pin: the F0/G0 GPIO republishes the
  // whole port on every BSRR write, so the adapter dedups — the board
  // sees edges, not repetition (MNA churn and stub-board noise both).
  const published = new Map();

  const publish = (pin, mode, driveHigh) => {
    if (!board || !(pin in pinDefs)) return;
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

  const peripherals = attach(machine, {
    fixedClockHz, hseHz, ramAtReset,
    onPinChange: publish,
    onSerialByte: (b) => { if (serialListener) serialListener(b); },
    // ADC channel n is the PA n pad: the board's solved node voltage.
    // A level a DEVICE changes on its own reaches IDR when the program reads
    // it, not at the slice end (board.dueDeviceDeadline; the AVR PINx hook).
    onInputRead: () => {
      if (!board || !board.dueDeviceDeadline || inInputSync) return;
      const t = machine.timeNs();
      if (!board.dueDeviceDeadline(t)) return;
      board.advanceTo(t);
      stats.advanceToCount++;
      syncInputs();
    },
    onAnalogRead: (ch) => {
      if (!board || !board.readAnalog || ch > 7) return 0;
      const v = board.readAnalog(`PA${ch}`);
      return typeof v === 'number' && Number.isFinite(v) ? v : 0;
    },
    // The on-die sensor (F0 channel 16, G0 channel 12) sees the bench temperature.
    onTemperature: () => sensorVolts(benchCelsius(board)),
  });

  function syncInputs () {
    if (!board || !board.readPin) return;
    inInputSync = true;
    try {
      for (const [name, def] of Object.entries(pinDefs)) {
        const gpio = def.port === 0 ? peripherals.gpioA : def.port === 1 ? peripherals.gpioB : peripherals.gpioC;
        if (!gpio) continue;
        const mode = (gpio.moder >>> (2 * def.bit)) & 3;
        if (mode !== 0) continue; // MCU-driven or AF: not an input pad
        gpio.setInput(def.bit, board.readPin(name) === 1);
      }
    } finally {
      inInputSync = false;
    }
  }

  const initialProgram = program;
  function resetToProgram () {
    // A reset is a power-on here: SRAM holds its pattern, not zeroes,
    // unless the caller models a warm debugger reset (ramAtReset 'zero').
    if (ramAtReset === 'zero') machine.sram.fill(0); else fillPowerOnRam(machine.sram);
    if (initialProgram) machine.loadFirmware(initialProgram);
  }
  if (initialProgram) machine.loadFirmware(initialProgram);

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
    /** the CURRENT core clock (HCLK), following the firmware's RCC setup */
    get clockHz () { return machine.clockHz; },
    // the debug target's `rp2040` facade: the bus object the core holds
    // (so write-watch wraps intercept), plus sram and the clock
    rp2040: Object.assign(machine.bus, { sram: machine.sram, clock }),
    attachBoard (b) {
      board = b;
      published.clear();
      // Seat every header pin's CURRENT state, not just future changes.
      peripherals.gpioA._publishAll();
      peripherals.gpioB._publishAll();
      if (peripherals.gpioC) peripherals.gpioC._publishAll();
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
    /** The adapters' common receive surface (avr8js/rp2040js sendSerial). */
    sendSerial (byteOrBytes) {
      const bytes = typeof byteOrBytes === 'number' ? [byteOrBytes] : Array.from(byteOrBytes);
      for (const b of bytes) peripherals.usart1.feed(b & 0xff);
      return true;
    },
    stats,
  };
}

// `clockHz` used to pin the core at 48/64 MHz whatever the firmware did,
// which hid the missing-PLL bug. Refuse it loudly instead of ignoring it.
function refuseClockHz (opts) {
  if (opts.clockHz !== undefined) {
    throw new TypeError('STM32 adapters take their clock from the firmware\'s RCC setup; '
      + '`clockHz` is no longer accepted. Pass `fixedClockHz` only to pin every clock '
      + '(cross-simulator parity with a model that has no clock tree).');
  }
}

/**
 * @param {object} [opts]
 * @param {Uint8Array} [opts.program] flash image (vectors first)
 * @param {number} [opts.fixedClockHz] LEGACY: pin core/timer/USART clocks, bypassing RCC
 * @param {number} [opts.hseHz] external crystal fitted (default none)
 * @param {'pattern'|'zero'} [opts.ramAtReset] power-on SRAM (default pattern)
 */
export function createStm32F0Adapter (opts = {}) {
  refuseClockHz(opts);
  return createStm32AdapterInternal({
    ...opts,
    family: 'f0',
    sramBytes: 4096,
    flashBytes: 16 * 1024,
    pinDefs: STM32F0_PINS,
  });
}

export function createStm32G0Adapter (opts = {}) {
  refuseClockHz(opts);
  return createStm32AdapterInternal({
    ...opts,
    family: 'g0',
    sramBytes: 8192,
    flashBytes: 64 * 1024,
    pinDefs: STM32G0_PINS,
  });
}

export default createStm32F0Adapter;
