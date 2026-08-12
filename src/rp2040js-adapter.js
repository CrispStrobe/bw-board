/**
 * rp2040js → boundary A adapter: a Raspberry Pi Pico (RP2040) drives the
 * circuit board through the SAME contract the 8051 and AVR adapters speak —
 * pin edges as `board.setPin(name, mode, driveHigh)`, time as
 * `board.advanceTo(tNs)`, analog reads pulling the board's node voltage.
 *
 * Mirrors src/avr8js-adapter.js deliberately (which mirrors
 * src/emu8051-adapter.js): the runner must not care which silicon is
 * underneath. Differences from the AVR adapter are differences in the
 * SILICON, not the contract:
 *
 *  - rp2040js keeps time in NANOSECONDS natively (SimulationClock), so
 *    boundary A's clock is read off directly instead of derived from a
 *    cycle count. Instruction cycles still drive it: this module owns the
 *    execute loop (executeInstruction → clock.tick), the same coupling
 *    rp2040js's own Simulator uses.
 *  - Pins are single-bank GPIOs with per-pin function select. rp2040js
 *    reports each pin's electrical role as a GPIOPinState; the adapter
 *    maps that to the board's PinMode. The RP2040's pad pull-DOWN has no
 *    PinMode equivalent yet (the 8051/AVR never needed one) — it maps to
 *    plain 'input' with the pull-down LOST. Extending PinMode is an
 *    mna-gated change (spec-update + hand-computed oracle) and stays with
 *    the engine owners; this comment is the marker.
 *  - 3.3 V part. ADC is 12-bit (0..4095), channels 0–2 on GP26–GP28
 *    (channel 3 = VSYS/3 and 4 = the temperature sensor never reach the
 *    header, so they never reach the board).
 *  - Pin NAMES are Pico-style GP0–GP28 — what the sidecar's terminals say.
 *    GP25 is the onboard LED on the Pico board itself.
 *
 * Program loading: hand-assembled Thumb (or any raw image) into SRAM, PC
 * and SP set directly — the same no-bootrom shortcut rp2040js's own tests
 * use. Flash/UF2 boot needs the real bootrom and is NOT this adapter's
 * job; the Pico compile route (MicroPython vs bare-metal) is still an open
 * roadmap question and nothing here prejudges it.
 *
 * @module
 */

import { RP2040, GPIOPinState, ConsoleLogger, LogLevel } from 'rp2040js';

export const RAM_START = 0x20000000;

/** Pico header pins: GP0–GP28 (GP23/24/25/29 exist on the chip; only
 *  GP25 = onboard LED is meaningful to users, so it stays in the map). */
export const RP2040_PINS = {};
for (let i = 0; i <= 28; i++) RP2040_PINS[`GP${i}`] = { index: i };
/** GP26..GP28 carry ADC channels 0..2. */
for (let ch = 0; ch <= 2; ch++) RP2040_PINS[`GP${26 + ch}`].adcChannel = ch;

/**
 * @param {object} [opts]
 * @param {number} [opts.clockHz] - core clock (default 125 MHz, the Pico)
 * @param {number} [opts.vcc] - ADC reference (default 3.3 — a 3.3 V part)
 * @param {Uint16Array} [opts.program] - Thumb halfwords, loaded at RAM_START
 * @param {number} [opts.sp] - initial stack pointer (default top of SRAM)
 * @returns {{
 *   rp2040: import('rp2040js').RP2040,
 *   core: object,
 *   clockHz: number,
 *   loadProgram(halfwords: Uint16Array, origin?: number): void,
 *   attachBoard(b: object): void,
 *   advanceNs(deltaNs: number): void,
 *   timeNs(): bigint,
 *   onSerial(cb: (byte: number) => void): void,
 *   stats: object,
 * }}
 */
export function createRp2040jsAdapter(opts = {}) {
  const clockHz = opts.clockHz ?? 125_000_000;
  const vcc = opts.vcc ?? 3.3;
  const cycleNanos = 1e9 / clockHz;

  // The package's exports map hides SimulationClock, so use the one the
  // RP2040 constructs for itself — it is a SimulationClock, and tick() is
  // this module's to drive (the same coupling rp2040js's Simulator uses).
  const rp2040 = new RP2040();
  const clock = rp2040.clock;
  const core = rp2040.core;
  // Errors only, and never throw: a program that escapes into unmapped
  // memory logs ONE line per instruction at warn level — a runaway loop
  // floods the host console (298 MB observed) and an emulated program's
  // bad read must never take the app down with it.
  rp2040.logger = new ConsoleLogger(LogLevel.Error, false);

  let board = null;
  const stats = { pinChangeCount: 0, advanceToCount: 0, adcReadCount: 0 };

  function timeNs() {
    return BigInt(Math.round(clock.nanos));
  }

  /** GPIOPinState → the board's PinMode vocabulary. */
  function publishPin(index, state) {
    if (!board) return;
    if (board.advanceTo) board.advanceTo(timeNs()); // time first, edge second
    const name = `GP${index}`;
    switch (state) {
      case GPIOPinState.Low:
        board.setPin(name, 'pushpull', false);
        break;
      case GPIOPinState.High:
        board.setPin(name, 'pushpull', true);
        break;
      case GPIOPinState.InputPullUp:
        board.setPin(name, 'input-pullup', true);
        break;
      // InputPullDown / InputBusKeeper: no PinMode for a pull-down yet —
      // published as plain high-Z input, pull LOST (see module header).
      default:
        board.setPin(name, 'input', false);
        break;
    }
    stats.pinChangeCount++;
  }

  for (const def of Object.values(RP2040_PINS)) {
    rp2040.gpio[def.index].addListener((state) => publishPin(def.index, state));
  }

  /** Boundary A's digital-input leg: every pin the MCU is NOT driving
   *  (output-enable clear) takes its level from the solved circuit —
   *  the same rule as the 8051 and AVR adapters. */
  function syncInputs() {
    if (!board || !board.readPin) return;
    for (const def of Object.values(RP2040_PINS)) {
      const pin = rp2040.gpio[def.index];
      if (pin.outputEnable) continue;
      pin.setInputValue(board.readPin(`GP${def.index}`) === 1);
    }
  }

  // ADC: answer a conversion with the BOARD's node voltage on that
  // channel's pin. rp2040js's default handler reads channelValues[] and
  // completes after the 2 µs sample time via a clock alarm — refresh the
  // value from the board, then let the default do the completion.
  const defaultADCRead = rp2040.adc.onADCRead;
  rp2040.adc.onADCRead = (channel) => {
    stats.adcReadCount++;
    if (channel <= 2 && board && board.readAnalog) {
      let volts = 0;
      try { volts = board.readAnalog(`GP${26 + channel}`) ?? 0; } catch { volts = 0; }
      rp2040.adc.channelValues[channel] =
        Math.max(0, Math.min(4095, Math.round((volts / vcc) * 4095)));
    }
    defaultADCRead(channel);
  };

  // UART0 TX (GP0) carries print output to the host, byte at a time.
  let serialListener = null;
  rp2040.uart[0].onByte = (byte) => {
    if (serialListener) serialListener(byte);
  };

  // Entry point of the LOADED program — resetToProgram() restores it. A
  // plain core.reset() fetches PC from the vector table, and without a
  // bootrom that lands in unmapped memory: the core NOP-slides through
  // 0xffff opcodes, logging one warning per instruction (a 298 MB flood
  // in the test that found this).
  let entryPC = RAM_START;
  let entrySP = opts.sp ?? RAM_START + rp2040.sram.length;

  function loadProgram(halfwords, origin = RAM_START) {
    for (let i = 0; i < halfwords.length; i++) {
      rp2040.writeUint16(origin + i * 2, halfwords[i]);
    }
    entryPC = origin;
    core.PC = entryPC;
    core.SP = entrySP;
  }
  if (opts.program) loadProgram(opts.program);

  /** Reset the core AND return to the loaded program's entry point. */
  function resetToProgram() {
    core.reset();
    core.PC = entryPC;
    core.SP = entrySP;
  }

  return {
    rp2040,
    core,
    clockHz,

    loadProgram,
    resetToProgram,

    /** Receive every byte the program transmits on UART0 (print output). */
    onSerial(cb) { serialListener = cb; },

    attachBoard(b) {
      board = b;
      for (const def of Object.values(RP2040_PINS)) {
        publishPin(def.index, rp2040.gpio[def.index].value);
      }
      syncInputs();
    },

    /** Re-read every input pin from the board (also called internally at
     *  each advance slice; exposed for the debug target's runFor). */
    syncInputs,

    /** Run the CPU forward by deltaNs of simulated time, then sync the board clock. */
    advanceNs(deltaNs) {
      syncInputs();
      const target = clock.nanos + deltaNs;
      while (clock.nanos < target) {
        if (core.waiting) {
          // Asleep (WFI/WFE): jump to the next alarm, or — if nothing is
          // scheduled (nanosToNextAlarm is 0 then) — to the budget's end.
          const toAlarm = clock.nanosToNextAlarm;
          const dt = toAlarm > 0 ? Math.min(toAlarm, target - clock.nanos)
            : target - clock.nanos;
          clock.tick(dt);
        } else {
          const cycles = core.executeInstruction();
          clock.tick(cycles * cycleNanos);
        }
      }
      if (board && board.advanceTo) {
        board.advanceTo(timeNs());
        stats.advanceToCount++;
      }
    },

    timeNs,

    stats,
  };
}
