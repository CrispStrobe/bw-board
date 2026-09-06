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
 *    maps that to the board's PinMode. InputPullDown → 'input-pulldown'
 *    (vTh=0, rTh=50 kΩ per RP2040 §2.19.6.3). InputBusKeeper → plain
 *    'input' with the latch behavior lost (see spec-updates/input-pulldown.md).
 *  - 3.3 V part. ADC is 12-bit (0..4095), channels 0–2 on GP26–GP28
 *    (channel 3 = VSYS/3 and 4 = the temperature sensor never reach the
 *    header, so they never reach the board).
 *  - Pin NAMES are Pico-style GP0–GP28 — what the sidecar's terminals say.
 *    GP25 is the onboard LED on the Pico board itself.
 *
 * Program loading: hand-assembled Thumb (or any raw image) into SRAM, PC
 * and SP set directly — the same shortcut rp2040js's own tests use. The
 * clean-room bootrom IS installed (rp2040-bootrom.js), so ROM lookups
 * resolve, but full flash/UF2 boot is still not this adapter's job; the
 * Pico compile route (MicroPython vs bare-metal) is an open roadmap
 * question and nothing here prejudges it.
 *
 * @module
 */

import { RP2040, GPIOPinState, ConsoleLogger, LogLevel } from 'rp2040js';
import { buildBootrom } from './rp2040-bootrom.js';

export const RAM_START = 0x20000000;

/** Flash (XIP) base — where a Pico image begins and where stage 2 runs. */
export const FLASH_BASE = 0x10000000;

/** The stack pointer stage 2 runs on before the image installs its own
 *  (the SDK boot2's SP). */
export const BOOT_SP = 0x20042000;

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
 *   takeResetRequest(): ({cause: string, entryPC: number, entrySP: number}|null),
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

  // rp2040js boots with an all-zero bootrom, so anything that reaches ROM
  // reads 0x0000 — a `movs r0, r0` slide, not a fault, which is why a
  // program that jumps there dies far from the jump. Install the clean-room
  // ROM (rp2040-bootrom.js) so the addresses the SDK actually dereferences
  // — the §2.8.2 header at 0x10 and the rom_table_lookup pointer at 0x18 —
  // resolve to real code. Both are Uint32Array(4 KiB words) = 16 KiB, so
  // the sizes line up exactly; the bytes are little-endian, as ARM reads them.
  rp2040.loadBootrom(new Uint32Array(buildBootrom().buffer));

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
      case GPIOPinState.InputPullDown:
        board.setPin(name, 'input-pulldown', false);
        break;
      // InputBusKeeper: the bus-keeper latches the last driven level — a
      // stateful behavior with no Thévenin equivalent. Published as plain
      // high-Z input, bus-keep behavior LOST. See spec-updates/input-pulldown.md
      // §BusKeeper adjudication.
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
  let resetRequest = null;

  function loadProgram(halfwords, origin = RAM_START) {
    for (let i = 0; i < halfwords.length; i++) {
      rp2040.writeUint16(origin + i * 2, halfwords[i]);
    }
    entryPC = origin;
    core.PC = entryPC;
    core.SP = entrySP;
  }

  /**
   * Boot a flat FLASH image the way silicon does, instead of dropping code
   * into SRAM. loadProgram() writes halfwords to RAM and jumps straight in;
   * that cannot run a real Pico image (MicroPython), which begins with an SDK
   * stage-2 boot at flash base that sets up XIP and then relocates its vector
   * table into SRAM. bootFromFlash places the image at FLASH_BASE and enters
   * stage 2 there with the boot stack pointer, so boot2 runs first and the
   * image ends up with VTOR at RAM_START on its own — no hand-set PC.
   *
   * Proven end to end by lite's scripts/probe-pico-micropython.mjs: with this
   * entry, MicroPython v1.22.2 boots to a REPL and os.statvfs('/') reports a
   * live flash filesystem (4096-byte blocks); the hand-rolled boot that probe
   * used before — set rp2040.flash, PC = 0x10000000 by hand — is now this call.
   *
   * @param {Uint8Array} image  flat flash image, byte 0 at FLASH_BASE
   */
  function bootFromFlash(image) {
    rp2040.flash.set(image, 0);
    entryPC = FLASH_BASE;   // stage 2 first, what real silicon does
    entrySP = BOOT_SP;
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

  // rp2040js models the watchdog register and timer, but intentionally leaves
  // the chip-reset action to its host. A full reboot must replace the SoC so
  // USB, GPIO, DMA, alarms and core state all return to power-on values while
  // flash survives. Surface that event explicitly; a browser or runner can
  // construct the replacement and reconnect its host-side USB/GPIO bindings.
  const watchdog = rp2040.peripherals[0x40058];
  watchdog.onWatchdogTrigger = () => {
    watchdog.writeUint32(0, 0);
    resetRequest = {cause: 'watchdog', entryPC, entrySP};
    core.waiting = true;
    if (opts.onResetRequest) opts.onResetRequest(resetRequest);
  };

  return {
    rp2040,
    core,
    clockHz,

    loadProgram,
    bootFromFlash,
    resetToProgram,
    takeResetRequest() {
      const request = resetRequest;
      resetRequest = null;
      return request;
    },

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
        if (resetRequest) break;
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
