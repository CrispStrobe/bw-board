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
import { installInstructionDebugEvents } from './instruction-debug-events.js';
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
  const deviceAccessListeners = new Set();
  const publishDeviceAccess = (fact) => {
    for (const listener of [...deviceAccessListeners]) {
      // Observation cannot perturb the emulated peripheral transaction.
      try { listener({...fact}); } catch {}
    }
  };

  /**
   * THE INSTRUMENT, AND WHY IT LIVES ON THE ADAPTER RATHER THAN THE DEBUGGER.
   *
   * Every other core in this tree publishes debug facts during an ORDINARY run:
   * the z80 and 6502 wrap `cpu.step`, so anything that advances the machine is
   * observed. The AVR did not. `avr8js-debug.js` publishes from its own
   * `execute()` loop, which only runs when a debugger is DRIVING — so an AVR
   * board running normally was silent, and a consumer attaching a listener saw
   * nothing until it took control. Measured before this change: an attiny85
   * advanced a full simulated millisecond and published zero facts.
   *
   * The ordinary run is `advanceNs`, and `advanceNs` is the adapter's. So the
   * instrument is the adapter's too.
   *
   * FOUR PARAMETERS, BECAUSE THIS CORE SPELLS FOUR THINGS DIFFERENTLY. It has
   * `readData`/`writeData` rather than `read`/`write`; its `pc` counts WORDS
   * while every AVR tool speaks bytes; its cycle counter is on the CPU, not on
   * a machine; and it has no `cpu.step` at all — `avrInstruction(cpu)` is a
   * free function, so the instruction bracket is INJECTED (`aroundInstruction`)
   * instead of wrapped. None of that is a different mechanism, which is why it
   * became parameters rather than a second implementation.
   */
  const debugEvents = installInstructionDebugEvents({
    cpu,
    machine: {clockHz},          // no `step`: the bracket below is the outer one
    cpuId: 'main',
    timeDomain: 'avr-cycles',
    accessors: {read: 'readData', write: 'writeData'},
    pcOf: c => c.pc * 2,         // BYTES, like avr-objdump and the debug target
    clock: () => cpu.cycles,
    idleCause: () => 'sleeping'  // the only way this core parks
  });

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
    twiBridge = createTWIBridge(twi, { onAccess: publishDeviceAccess });
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
    spiBridge = createSPIBridge(spi, { onAccess: publishDeviceAccess });
    spi.onByte = spiBridge.onByte;
  }

  let board = null;
  const stats = { pinChangeCount: 0, advanceToCount: 0, adcReadCount: 0, instructions: 0, sleptCycles: 0 };

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

    /**
     * Observe instruction retires, data accesses and idle during ORDINARY runs.
     *
     * Many listeners, each returning its own unsubscribe — the same contract as
     * `onDeviceAccess` above and as the shared module's other users, and
     * deliberately NOT the single-listener-or-throw contract that
     * `avr8js-debug.js`'s own `onDebugEvent` has. The two coexist: that one
     * reports while a debugger drives, this one while the board just runs.
     */
    onDebugEvent(cb) { return debugEvents.onDebugEvent(cb); },
    debugTime() { return debugEvents.debugTime(); },
    openTimeEpoch() { return debugEvents.openTimeEpoch(); },
    debugEvents,

    /** Observe completed hardware-peripheral accesses without performing one. */
    onDeviceAccess(cb) {
      if (typeof cb !== 'function') throw new TypeError('device access listener must be a function');
      deviceAccessListeners.add(cb);
      return () => deviceAccessListeners.delete(cb);
    },

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
      // One instruction, bracketed. With no listener attached `aroundInstruction`
      // is the bare call, so an unobserved run pays one function call per
      // instruction and nothing else.
      const runOne = () => {
        const before = cpu.cycles;
        avrInstruction(cpu);
        cpu.pc &= pcMask;
        cpu.tick();
        return cpu.cycles - before;
      };
      // SLEEP fast-forward: avr8js implements the SLEEP opcode as a NOP,
      // so a firmware that idles correctly on silicon would still grind
      // this interpreter at full clock (the pico lane measured that spin
      // at 89% of the page's CPU before its own fix). Silicon semantics,
      // kept exactly — the first cut broke blinkenrocket by letting
      // execution FALL THROUGH a sleep at the end of a slice:
      //   - a sleeping core stays PARKED at the SLEEP instruction until a
      //     wake source actually pends an enabled interrupt;
      //   - the waking ISR's return address is the instruction AFTER
      //     sleep, so the opcode is consumed on the wake path only;
      //   - a clock event that pends nothing (a timer counting with its
      //     interrupt masked) does not wake the core.
      // SE gate: SMCR bit0 on the megas and the tiny88; MCUCR bit5 on
      // the tiny85 (avr-libc's sleep.h writes exactly these).
      const sleepReg = chipName === 'attiny85' ? 0x55 : 0x53;
      const sleepBit = chipName === 'attiny85' ? 0x20 : 0x01;
      while (cpu.cycles < targetCycles) {
        if (cpu.progMem[cpu.pc] === 0x9588 && (cpu.data[sleepReg] & sleepBit)) {
          if (cpu.interruptsEnabled && cpu.nextInterrupt >= 0) {
            // Wake: sleep completes, the ISR returns to the instruction
            // after it — consume the opcode before dispatching.
            debugEvents.aroundInstruction(runOne);
            continue;
          }
          const evt = cpu.nextClockEvent;
          if (evt && evt.cycles <= targetCycles) {
            // Jump to the next scheduled event and fire it WITHOUT the
            // interrupt dispatch tick() would couple to it (the dispatch
            // must happen on the wake path above, with the post-sleep
            // return address). The loop re-checks: if the callback
            // pended an enabled interrupt, the next iteration wakes.
            if (evt.cycles > cpu.cycles) {
              const jumped = evt.cycles - cpu.cycles;
              stats.sleptCycles += jumped;
              cpu.cycles = evt.cycles;
              // Time advanced to a SCHEDULED event and that event then fired —
              // its own fact kind, not an elapse. A consumer asking "did the
              // core sleep through the slice or did the clock jump to a timer?"
              // is asking a real question, and one shape cannot answer it.
              debugEvents.publishClockJump({cycles: jumped, event: {kind: 'clock-event'}});
            }
            evt.callback();
            cpu.nextClockEvent = evt.next;
            continue;
          }
          // Nothing due before the slice ends: sleep through the rest of
          // it, still parked — the next slice's syncInputs may pend a
          // pin-change wake, or a later event will.
          {
            const slept = targetCycles - cpu.cycles;
            stats.sleptCycles += slept;
            cpu.cycles = targetCycles;
            // The slice ended with the core parked at SLEEP. Nothing retired
            // and the counter moved: without this the consumer sees the tick
            // count jump with nothing to explain it — the exact hole the z80's
            // HALT had before the module grew the vocabulary.
            debugEvents.publishIdleElapse({cycles: slept});
          }
          break;
        }
        stats.instructions++;
        debugEvents.aroundInstruction(runOne);
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
