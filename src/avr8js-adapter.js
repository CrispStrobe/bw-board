/**
 * avr8js → boundary A adapter: an AVR MCU drives the circuit board exactly
 * the way the 8051 emulator does — pin edges arrive as
 * `board.setPin(name, mode, driveHigh)`, time as `board.advanceTo(tNs)`, and
 * analog reads pull the board's node voltage into the ADC.
 *
 * Chip-parameterized: pass `opts.chip` as 'atmega328p' (default), 'atmega2560',
 * or 'attiny85' to select the pin map, ports, timers, ADC, and USART config
 * for each variant. The boundary-A contract is identical for all chips.
 *
 * @module
 */

import {
  CPU, avrInstruction, AVRIOPort, AVRTimer, AVRADC, AVRUSART, PinState,
  ATtinyTimer1, attinyTimer1Config,
  AVRTWI, AVRSPI,
} from 'avr8js';
import { CHIPS, ATMEGA328P } from './avr-chips.js';
import { createTWIBridge } from './twi-bridge.js';
import { createSPIBridge } from './spi-bridge.js';
import { createUSIBridge } from './usi-bridge.js';

// Re-export for backward compatibility (existing tests import this)
export { ATMEGA328P_PINS } from './avr-chips.js';
// Also re-export the chip definitions for the factory / debug target
export { CHIPS, ATMEGA328P } from './avr-chips.js';

/**
 * @param {object} [opts]
 * @param {string} [opts.chip] - Chip name: 'atmega328p' (default), 'atmega2560', 'attiny85'
 * @param {number} [opts.clockHz] - CPU clock (overrides chip default)
 * @param {number} [opts.vcc] - supply voltage (overrides chip default)
 * @param {Uint16Array} [opts.program] - flash contents (word-addressed)
 * @returns {{
 *   cpu: import('avr8js').CPU,
 *   chip: object,
 *   clockHz: number,
 *   loadProgram(words: Uint16Array): void,
 *   attachBoard(b: object): void,
 *   advanceNs(deltaNs: number): void,
 *   timeNs(): bigint,
 *   onSerial(cb: (byte: number) => void): void,
 *   syncInputs(): void,
 *   stats: object,
 * }}
 */
export function createAvr8jsAdapter(opts = {}) {
  const chipName = (opts.chip ?? 'atmega328p').toLowerCase();
  const chip = CHIPS[chipName];
  if (!chip) throw new Error(`Unknown AVR chip: ${opts.chip}`);

  const clockHz = opts.clockHz ?? chip.clockHz;
  const vcc = opts.vcc ?? chip.vcc;

  const progMem = new Uint16Array(chip.flashWords);
  if (opts.program && opts.program.length > chip.flashWords) {
    // Refuse WITH THE SIZE NAMED — a silent truncation boots garbage and a
    // bare RangeError names neither the image nor the chip.
    throw new Error(`Program is ${opts.program.length} words `
      + `(${opts.program.length * 2} bytes); ${chip.name} flash holds `
      + `${chip.flashWords} words (${chip.flashWords * 2} bytes)`);
  }
  if (opts.program) progMem.set(opts.program);
  const cpu = new CPU(progMem, chip.sramBytes);

  // ── Ports ──
  const ioPorts = {};
  for (const [key, cfg] of Object.entries(chip.ports)) {
    ioPorts[key] = new AVRIOPort(cpu, cfg);
  }

  // ── Reverse map: port key + bit → pin name ──
  const portPins = {};
  for (const key of Object.keys(chip.ports)) portPins[key] = {};
  for (const [name, def] of Object.entries(chip.pins)) {
    if (def.analogOnly) continue;
    if (portPins[def.port]) portPins[def.port][def.bit] = name;
  }

  // ── Timers ──
  // Standard AVRTimer instances for all timer configs in the chip definition.
  for (const tcfg of chip.timers) {
    new AVRTimer(cpu, tcfg);
  }
  // ATtiny85 Timer1 uses a separate class (ATtinyTimer1) that chains hooks
  // with Timer0 on shared TIFR/TIMSK registers. It must be created AFTER
  // Timer0 so its hook chaining finds the existing hooks.
  if (chip.attinyTimer1) {
    new ATtinyTimer1(cpu, attinyTimer1Config);
  }

  // ── ADC ──
  const adc = chip.adc ? new AVRADC(cpu, chip.adc) : null;

  // ── USART ──
  let serialListener = null;
  if (chip.usart) {
    const usart = new AVRUSART(cpu, chip.usart, clockHz);
    usart.onByteTransmit = (byte) => {
      if (serialListener) serialListener(byte);
    };
  }

  // ── TWI (I2C hardware peripheral) ──
  let twi = null;
  let twiBridge = null;
  if (chip.twi) {
    twi = new AVRTWI(cpu, chip.twi, clockHz);
    twiBridge = createTWIBridge(twi);
    twi.eventHandler = twiBridge;
  }

  // ── USI (ATtiny85 software I2C) ──
  let usiBridge = null;
  if (chip.usi) {
    usiBridge = createUSIBridge(cpu, chip.usi);
  }

  // ── SPI (hardware peripheral) ──
  let spi = null;
  let spiBridge = null;
  if (chip.spi) {
    spi = new AVRSPI(cpu, chip.spi, clockHz);
    spiBridge = createSPIBridge(spi);
    spi.onByte = spiBridge.onByte;
  }

  let board = null;
  const stats = { pinChangeCount: 0, advanceToCount: 0, adcReadCount: 0 };

  /** Push one pin's CURRENT electrical role to the board.
   *  Uses AVRIOPort.pinState() which reads lastValue — the override-applied
   *  output — so hardware-timer PWM edges (timerOverridePin) propagate to the
   *  board correctly. */
  function publishPin(portKey, bit) {
    if (!board) return;
    if (board.advanceTo) {
      board.advanceTo(BigInt(Math.round((cpu.cycles / clockHz) * 1e9)));
    }
    const name = portPins[portKey]?.[bit];
    if (!name) return; // not a header pin
    const pinDef = chip.pins[name];
    if (pinDef?.analogOnly) return;
    const state = ioPorts[portKey].pinState(bit);
    switch (state) {
      case PinState.High:   board.setPin(name, 'pushpull', true);      break;
      case PinState.Low:    board.setPin(name, 'pushpull', false);     break;
      case PinState.InputPullUp: board.setPin(name, 'input-pullup', true); break;
      default:              board.setPin(name, 'input', false);        break;
    }
    stats.pinChangeCount++;
  }

  for (const key of Object.keys(ioPorts)) {
    ioPorts[key].addListener(() => {
      for (let bit = 0; bit < 8; bit++) publishPin(key, bit);
      // Inputs must see the board the CPU just changed: syncInputs() ran
      // only at slice boundaries, so a keypad scan — drive a row, read a
      // column IN THE SAME SLICE — read frozen pre-slice levels and no
      // matrix key could ever register (the calculator bench, 2026-08-17).
      // Refreshing after every output edge is what the silicon does: the
      // PIN register follows the pin, always.
      if (!inInputSync) syncInputs();
    });
  }

  /** Sync input pins from board → CPU (buttons, external signals). */
  let inInputSync = false;
  function syncInputs() {
    if (!board || !board.readPin) return;
    inInputSync = true;
    try {
      syncInputsBody();
    } finally {
      inInputSync = false;
    }
  }
  function syncInputsBody() {
    for (const [name, def] of Object.entries(chip.pins)) {
      if (def.analogOnly) continue;
      const port = ioPorts[def.port];
      if (!port) continue;
      const portCfg = chip.ports[def.port];
      const ddr = cpu.data[portCfg.DDR];
      if (ddr & (1 << def.bit)) continue; // MCU-driven
      port.setPin(def.bit, board.readPin(name) === 1);
    }
  }

  // ADC: read from board's analog voltage on the mapped pin.
  const adcMap = chip.adcChannelToPin ?? {};
  if (adc) {
    adc.onADCRead = (input) => {
      stats.adcReadCount++;
      let volts = 0;
      if (board && board.readAnalog && input.channel != null) {
        const pinName = adcMap[input.channel];
        if (pinName) {
          try { volts = board.readAnalog(pinName) ?? 0; } catch { volts = 0; }
        }
      }
      adc.completeADCRead(Math.max(0, Math.min(1023, Math.round((volts / vcc) * 1023))));
    };
  }

  return {
    cpu,
    chip,
    clockHz,

    /** Receive every byte the program transmits on UART0 (print output).
     *  No-op on chips without USART (ATtiny85). */
    onSerial(cb) { serialListener = cb; },

    loadProgram(words) {
      progMem.fill(0);
      progMem.set(words);
      cpu.reset();
    },

    attachBoard(b) {
      board = b;
      for (const key of Object.keys(ioPorts)) {
        for (let bit = 0; bit < 8; bit++) publishPin(key, bit);
      }
      syncInputs();
      // Wire TWI/USI/SPI bridges to the board's device handlers.
      if (twiBridge) twiBridge.attach(b);
      if (usiBridge) usiBridge.attach(b);
      if (spiBridge) spiBridge.attach(b);
    },

    syncInputs,

    advanceNs(deltaNs) {
      syncInputs();
      const targetCycles = cpu.cycles + Math.round((deltaNs / 1e9) * clockHz);
      // Flash-size PC mask: real AVRs address flash modulo its size, and
      // on ≤8K parts the linker RELIES on it — RJMP/RCALL wrap through
      // the top of flash (blinkenrocket's ctor loop does exactly this).
      // avr8js wraps only sequential fetch, so a wrapping call sends
      // cpu.pc negative and the core executes garbage. Masking after
      // each instruction is what the silicon's program counter does.
      const pcMask = cpu.progMem.length - 1;
      while (cpu.cycles < targetCycles) {
        avrInstruction(cpu);
        cpu.pc &= pcMask;
        cpu.tick();
      }
      if (board && board.advanceTo) {
        board.advanceTo(this.timeNs());
        stats.advanceToCount++;
      }
    },

    timeNs() {
      return BigInt(Math.round((cpu.cycles / clockHz) * 1e9));
    },

    stats,
    twi,
    twiBridge,
    usiBridge,
    spi,
    spiBridge,
  };
}
