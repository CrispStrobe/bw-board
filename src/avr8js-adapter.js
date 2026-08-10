/**
 * avr8js → boundary A adapter: an ATmega328P (Arduino Nano / Uno) drives the
 * circuit board exactly the way the 8051 emulator does — pin edges arrive as
 * `board.setPin(name, mode, driveHigh)`, time as `board.advanceTo(tNs)`, and
 * analog reads pull the board's node voltage into the ADC.
 *
 * Mirrors src/emu8051-adapter.js's contract deliberately: the debug runner
 * and the designer must not care which silicon is underneath (boundary A × D,
 * DEBUG-CONTROL-MODEL). Differences from the 8051 adapter are differences in
 * the SILICON, not the contract:
 *
 *  - avr8js is pure TypeScript: no WASM, no callback-pointer gymnastics —
 *    port listeners are plain functions, so there is only "push" mode.
 *  - AVR pins are true push-pull with a direction register: DDR bit set →
 *    'pushpull' driven high/low; DDR clear → 'input' (PORT bit set adds the
 *    internal pull-up → 'input-pullup'). No quasi-bidirectional anything.
 *  - Pin NAMES are Arduino-style (D0–D13, A0–A5): that is what the sidecar's
 *    terminals say and what users wire to. The port/bit mapping lives here.
 *
 * The 16 MHz clock is the Nano/Uno default; boundary A publishes nanoseconds,
 * so `tNs = cycles * 1e9 / clockHz` exactly as the 8051 adapter does.
 *
 * @module
 */

import {
  CPU, avrInstruction, AVRIOPort, AVRTimer, AVRADC,
  portBConfig, portCConfig, portDConfig,
  timer0Config, timer1Config, timer2Config,
  adcConfig,
} from 'avr8js';

/** Arduino pin name → { port: 'B'|'C'|'D', bit } for the ATmega328P. */
export const ATMEGA328P_PINS = {
  D0: { port: 'D', bit: 0 }, D1: { port: 'D', bit: 1 },
  D2: { port: 'D', bit: 2 }, D3: { port: 'D', bit: 3 },
  D4: { port: 'D', bit: 4 }, D5: { port: 'D', bit: 5 },
  D6: { port: 'D', bit: 6 }, D7: { port: 'D', bit: 7 },
  D8: { port: 'B', bit: 0 }, D9: { port: 'B', bit: 1 },
  D10: { port: 'B', bit: 2 }, D11: { port: 'B', bit: 3 },
  D12: { port: 'B', bit: 4 }, D13: { port: 'B', bit: 5 },
  A0: { port: 'C', bit: 0 }, A1: { port: 'C', bit: 1 },
  A2: { port: 'C', bit: 2 }, A3: { port: 'C', bit: 3 },
  A4: { port: 'C', bit: 4 }, A5: { port: 'C', bit: 5 },
};

const PORT_PINS = { B: {}, C: {}, D: {} };
for (const [name, { port, bit }] of Object.entries(ATMEGA328P_PINS)) {
  PORT_PINS[port][bit] = name;
}

/**
 * @param {object} [opts]
 * @param {number} [opts.clockHz] - CPU clock (default 16 MHz, the Nano/Uno)
 * @param {number} [opts.vcc] - supply voltage (default 5.0)
 * @param {Uint16Array} [opts.program] - flash contents (word-addressed)
 * @returns {{
 *   cpu: import('avr8js').CPU,
 *   loadProgram(words: Uint16Array): void,
 *   attachBoard(b: object): void,
 *   advanceNs(deltaNs: number): void,
 *   timeNs(): bigint,
 *   stats: object,
 * }}
 */
export function createAvr8jsAdapter(opts = {}) {
  const clockHz = opts.clockHz ?? 16_000_000;
  const vcc = opts.vcc ?? 5.0;

  const progMem = new Uint16Array(0x8000 / 2); // 32 KB flash
  if (opts.program) progMem.set(opts.program);
  const cpu = new CPU(progMem);

  const ioPorts = {
    B: new AVRIOPort(cpu, portBConfig),
    C: new AVRIOPort(cpu, portCConfig),
    D: new AVRIOPort(cpu, portDConfig),
  };
  // Timers must exist for millis()-style code even before anyone reads them.
  new AVRTimer(cpu, timer0Config);
  new AVRTimer(cpu, timer1Config);
  new AVRTimer(cpu, timer2Config);
  const adc = new AVRADC(cpu, adcConfig);

  let board = null;
  const stats = { pinChangeCount: 0, advanceToCount: 0, adcReadCount: 0 };

  // DDR/PORT registers by data-space address, for mode classification.
  const REG = {
    B: { ddr: 0x24, port: 0x25 },
    C: { ddr: 0x27, port: 0x28 },
    D: { ddr: 0x2a, port: 0x2b },
  };

  /** Push one pin's CURRENT electrical role to the board. */
  function publishPin(portKey, bit) {
    if (!board) return;
    // Time FIRST, edge second — the 8051 push mode's contract. Without this
    // every edge in an advanceNs batch lands at the board's stale clock and
    // the LED persistence window averages a history that never happened
    // (measured: a 50 % duty blink read brightness 0).
    if (board.advanceTo) {
      board.advanceTo(BigInt(Math.round((cpu.cycles / clockHz) * 1e9)));
    }
    const name = PORT_PINS[portKey][bit];
    if (!name) return; // not a header pin (crystal, reset, ...)
    const ddr = cpu.data[REG[portKey].ddr];
    const out = cpu.data[REG[portKey].port];
    const driven = !!(ddr & (1 << bit));
    const high = !!(out & (1 << bit));
    // AVR semantics: output → hard push-pull; input with PORT bit → weak
    // internal pull-up (~35 kΩ); plain input → high-Z.
    if (driven) board.setPin(name, 'pushpull', high);
    else board.setPin(name, high ? 'input-pullup' : 'input', high);
    stats.pinChangeCount++;
  }

  for (const key of Object.keys(ioPorts)) {
    ioPorts[key].addListener(() => {
      // A listener fires on PORT writes; DDR changes surface on the next
      // PORT write or the initial sync. Publish the whole port: cheap (≤8)
      // and immune to which register moved.
      for (let bit = 0; bit < 8; bit++) publishPin(key, bit);
    });
  }

  // ADC: when the program starts a conversion, answer with the BOARD's node
  // voltage on that channel's pin (A0–A5 = ADC0–5) — boundary A's analog leg.
  adc.onADCRead = (input) => {
    stats.adcReadCount++;
    let volts = 0;
    if (board && board.readAnalog && input.channel <= 5) {
      try { volts = board.readAnalog(`A${input.channel}`) ?? 0; } catch { volts = 0; }
    }
    // avr8js completes the conversion after the sampling cycles elapse.
    adc.completeADCRead(Math.max(0, Math.min(1023, Math.round((volts / vcc) * 1023))));
  };

  return {
    cpu,

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
    },

    /** Run the CPU forward by deltaNs of simulated time, then sync the board clock. */
    advanceNs(deltaNs) {
      const targetCycles = cpu.cycles + Math.round((deltaNs / 1e9) * clockHz);
      while (cpu.cycles < targetCycles) {
        avrInstruction(cpu);
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
  };
}
