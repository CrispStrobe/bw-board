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

import { avrTemperatureCounts, benchCelsius } from './chip-temperature.js';
import {
  CPU, avrInstruction, AVRIOPort, AVRTimer, AVRADC, AVRUSART, PinState,
  ATtinyTimer1, attinyTimer1Config,
  AVRTWI, AVRSPI, AVREEPROM, EEPROMMemoryBackend,
} from 'avr8js';
import { CHIPS, ATMEGA328P } from './avr-chips.js';
import { fastAvrInstruction } from './vendor/avr8js-fast/instruction.js';
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
  // FAST-DISPATCH FORK (src/vendor/avr8js-fast/instruction.js): avr8js decodes
  // each opcode through a 99-branch linear if/else chain (72.7% of ticks under
  // --prof). fastAvrInstruction is a behavior-identical switch(opcode>>12)
  // restructuring, verified by an exhaustive stock-vs-fork differential over all
  // 65536 opcodes. Opt out with opts.fastDispatch === false (the A/B baseline).
  const instr = opts.fastDispatch === false ? avrInstruction : fastAvrInstruction;
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
    // UNREVIEWED — preserves today's `-reset-` behaviour EXACTLY (a no-op made
    // explicit because rewindLabel is now required). Whether avr's cycle counter
    // advances or rewinds on reset() is the avr session's knowledge; the correct
    // label is theirs to confirm. Do not guess it into a behaviour change here.
    rewindLabel: 'reset',
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
  // Bytes sent TO the program, waiting for the receiver. One at a time,
  // through avr8js's own writeByte, so each arrives at the programmed baud
  // rate and sets RXC exactly as a real frame would; the next is offered when
  // the previous completes. Bytes sent before the program enables its
  // receiver (Serial.begin not yet called) wait here rather than vanish.
  const rxQueue = [];
  let usart = null;
  const pumpRx = () => {
    while (usart && rxQueue.length && usart.rxEnable && !usart.rxBusy) {
      if (!usart.writeByte(rxQueue[0])) break;
      rxQueue.shift();
    }
  };
  if (chip.usart) {
    usart = new AVRUSART(cpu, chip.usart, clockHz);
    usart.onByteTransmit = (byte) => {
      if (serialListener) serialListener(byte);
    };
    usart.onRxComplete = pumpRx;
  }

  // ── EEPROM ──
  // Every chip here has internal EEPROM, and a program that writes it waits
  // for EEPE to clear. Without the peripheral the bit is plain RAM that
  // nothing clears, so EEPROM.write() -- and every EEPROM.read() after it --
  // hung forever (measured: an Arduino sketch printed its first line and
  // stopped). avr-peripherals.js's wirePeripherals() had this and nothing
  // called it; the adapter owns it now, like the USART.
  let eeprom = null, eepromBackend = null;
  if (chip.eeprom) {
    eepromBackend = new EEPROMMemoryBackend(chip.eepromBytes ?? 512);
    eeprom = new AVREEPROM(cpu, eepromBackend, chip.eeprom);
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
    // Hardware SPI on the pins (see spi-bridge.js): the peripheral overrides
    // the port for SCK/MOSI -- the same override timer PWM uses, so the edges
    // reach the board through publishPin -- and MISO is read off the board.
    // avr8js's PinOverrideMode (not exported from its index): None 0, Set 2, Clear 3.
    const OVERRIDE_NONE = 0, OVERRIDE_SET = 2, OVERRIDE_CLEAR = 3;
    const sp = chip.spiPins;
    const wire = sp && {
      SPCR: chip.spi.SPCR,
      ready: () => !!board && !!(cpu.data[chip.spi.SPCR] & 0x10),   // MSTR
      drive(which, high) {
        ioPorts[sp.port].timerOverridePin(sp[which], high ? OVERRIDE_SET : OVERRIDE_CLEAR);
      },
      release() {
        ioPorts[sp.port].timerOverridePin(sp.sck, OVERRIDE_NONE);
        ioPorts[sp.port].timerOverridePin(sp.mosi, OVERRIDE_NONE);
      },
      readMiso: () => board.readPin(portPins[sp.port][sp.miso]) === 1,
    };
    spiBridge = createSPIBridge(spi, { onAccess: publishDeviceAccess, wire });
    spi.onByte = spiBridge.onByte;
    // While SPE and MSTR are set the peripheral owns SCK and it idles at CPOL
    // -- in mode 2/3 that is HIGH between bytes whatever PORTB says, and a
    // part counting edges would otherwise see a spurious one per byte. SPI
    // off (or slave) hands both pins back to the port.
    if (wire) {
      const avrSpcrHook = cpu.writeHooks[chip.spi.SPCR];
      cpu.writeHooks[chip.spi.SPCR] = (value, ...rest) => {
        const r = avrSpcrHook ? avrSpcrHook(value, ...rest) : false;
        if (!board) return r;
        if ((value & 0x50) === 0x50) wire.drive('sck', !!(value & 0x08));
        else wire.release();
        return r;
      };
    }
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

  // ── Software UART (the ATtinys: no USART) ──
  // print/ask on these chips bit-bang 9600 8N1 on the chip's softSerial pins.
  // TX: every edge on the TX pin is stamped with cpu.cycles, and one clock
  // event 9.5 bit-times after a start bit reads the frame back from those
  // stamps at the bit centres -- exact, whatever the program's own timing
  // jitter, as long as it is inside the half-bit a real receiver allows. As
  // on a real receiver, a start bit needs the line high for a bit-time before
  // it, and a frame whose stop bit is low is a framing error, not a byte: a
  // blinking LED on the pin prints nothing (a fast PWM could, as it would on
  // a real serial monitor wired there).
  // RX: sendSerial drives the RX pin through each frame on clock events. From
  // the first byte on, a serial monitor is on that pin, and its TX idles HIGH
  // between frames: the adapter keeps holding the line (syncInputsBody skips
  // it) rather than handing it back to whatever the bench says.
  const soft = !chip.usart && chip.softSerial ? chip.softSerial : null;
  let softRxOwned = false;
  const softRxQueue = [];
  let softRxBusy = false;
  let softRxStart = null;
  if (soft) {
    const bitCycles = clockHz / soft.baud;
    const txPort = ioPorts[soft.tx.port];
    const rxPort = ioPorts[soft.rx.port];
    const levelNow = () => (txPort.pinState(soft.tx.bit) === PinState.Low ? 0 : 1);
    let level = levelNow();
    let lastChange = -Infinity;                    // idle since power-on
    let frameStart = -1;
    let edges = [];
    const levelAt = (t) => {
      let l = 0;                                   // the start bit
      for (const [c, v] of edges) { if (c <= t) l = v; else break; }
      return l;
    };
    const decode = () => {
      const t0 = frameStart;
      let byte = 0;
      for (let i = 0; i < 8; i++) if (levelAt(t0 + bitCycles * (1.5 + i))) byte |= 1 << i;
      const stop = levelAt(t0 + bitCycles * 9.5);
      const started = !levelAt(t0 + bitCycles * 0.5);
      frameStart = -1;
      edges = [];
      if (!started) return;                        // a glitch, not a start bit (re-checked mid-bit, as a UART does)
      if (!stop) return;                           // framing error: not a byte
      if (serialListener) serialListener(byte);
    };
    txPort.addListener(() => {
      const l = levelNow();
      if (l === level) return;
      const c = cpu.cycles;
      if (frameStart >= 0) {
        edges.push([c, l]);
      } else if (l === 0 && c - lastChange >= bitCycles * 0.9) {
        frameStart = c;
        edges = [];
        cpu.addClockEvent(decode, Math.round(bitCycles * 9.5));
      }
      level = l;
      lastChange = c;
    });
    const sendFrame = () => {
      if (!softRxQueue.length) {
        softRxBusy = false;                        // the line stays high: idle
        return;
      }
      const byte = softRxQueue.shift();
      const levels = [0];
      for (let i = 0; i < 8; i++) levels.push((byte >> i) & 1);
      levels.push(1, 1);                           // stop bit, one bit of idle
      let i = 0;
      const step = () => {
        rxPort.setPin(soft.rx.bit, levels[i] === 1);
        i++;
        cpu.addClockEvent(i < levels.length ? step : sendFrame, Math.round(bitCycles));
      };
      step();
    };
    softRxStart = () => {
      if (softRxBusy) return;
      softRxBusy = true;
      softRxOwned = true;
      rxPort.setPin(soft.rx.bit, true);            // idle high before the first start bit
      cpu.addClockEvent(sendFrame, Math.round(bitCycles));
    };
  }

  // A level a DEVICE changes on its own (an echo ending, a 1-Wire slave's
  // slot) must reach the PIN register when the program reads it, not at the
  // slice end: every PINx read first brings the board up to the CPU's time
  // when a device has something due (board.dueDeviceDeadline). SBIS/SBIC and
  // IN all read through cpu.readData, so one hook per port covers them.
  function catchUpInputs() {
    if (!board || !board.dueDeviceDeadline || inInputSync) return;
    const t = BigInt(Math.round((cpu.cycles / clockHz) * 1e9));
    if (!board.dueDeviceDeadline(t)) return;
    board.advanceTo(t);
    stats.advanceToCount++;
    syncInputs();
  }
  for (const key of Object.keys(ioPorts)) {
    const pinAddr = chip.ports[key] && chip.ports[key].PIN;
    if (pinAddr === undefined) continue;
    const prior = cpu.readHooks[pinAddr];
    cpu.readHooks[pinAddr] = (addr) => {
      catchUpInputs();
      return prior ? prior(addr) : cpu.data[addr];
    };
  }

  /** Sync input pins from board → CPU (buttons, external signals). */
  let inInputSync = false;
  function syncInputs() {
    // Serial bytes waiting for the receiver are an input too, re-offered at
    // the same cadence -- the debug loop bypasses advanceNs and calls this.
    pumpRx();
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
      if (softRxOwned && def.port === soft.rx.port && def.bit === soft.rx.bit) continue; // a frame is on it
      port.setPin(def.bit, board.readPin(name) === 1);
    }
  }

  // ADC: read from board's analog voltage on the mapped pin.
  const adcMap = chip.adcChannelToPin ?? {};
  if (adc) {
    adc.onADCRead = (input) => {
      stats.adcReadCount++;
      if (input.type === 3/*Temperature*/) {
        // The chip's own sensor at the bench temperature, in counts against
        // the internal 1.1 V the datasheets require for this channel.
        adc.completeADCRead(avrTemperatureCounts(chip.tempSensor, benchCelsius(board)) ?? 0);
        return;
      }
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

    /** Receive every byte the program transmits on UART0 (print output);
     *  on the ATtinys, every byte decoded from the software-UART TX pin. */
    onSerial(cb) { serialListener = cb; },

    /** The chip's internal EEPROM (avr8js AVREEPROM), or null. */
    eeprom,
    /** Its backing store (EEPROMMemoryBackend; .memory is the bytes), or null. */
    eepromBackend,

    /**
     * Send bytes TO the program's UART0 (what a serial monitor types). Queued
     * and delivered at the programmed baud rate; on the ATtinys, as 9600 8N1
     * frames on the software-UART RX pin. False on a chip with neither. Not recorded: the AVR
     * debug target declares no replay surface, so nothing claims to replay it.
     */
    sendSerial(byteOrBytes) {
      if (!usart && soft) {
        const bytes = typeof byteOrBytes === 'number' ? [byteOrBytes] : Array.from(byteOrBytes);
        for (const b of bytes) softRxQueue.push(b & 0xff);
        softRxStart();
        return true;
      }
      if (!usart) return false;
      const bytes = typeof byteOrBytes === 'number' ? [byteOrBytes] : Array.from(byteOrBytes);
      for (const b of bytes) rxQueue.push(b & 0xff);
      pumpRx();
      return true;
    },

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
        instr(cpu);
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
