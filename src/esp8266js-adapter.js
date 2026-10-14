/**
 * ESP8266 on the bench, through our esp8266js fork (CrispStrobe/esp8266js,
 * MIT): pin edges become `board.setPin(name, mode, driveHigh)`, time becomes
 * `board.advanceTo(tNs)`, the board's levels drive the chip's inputs, and the
 * serial port reaches the caller both ways.
 *
 * WHAT RUNS. A flash image booted WITHOUT the mask ROM: the fork's own boot
 * loader copies the image's segments and its stand-ins answer the ROM calls
 * firmware makes. Firmware built on the fork's blob-free runtime runs. Stock
 * Arduino / Espressif SDK images are a different matter: the SDK's licence
 * limits its use to the chip itself, so this adapter is not offered for them
 * (nothing here detects them; the factory's kind entry says so).
 *
 * PINS. GPIO0-GPIO15 by their GPIO numbers. A pin the firmware drives shows
 * as 'pushpull' high or low; an input shows as 'input', or 'input-pullup'
 * when its pull-up is on. Inputs read the board's level at every advance.
 * Not modelled through the board: the analog input, the radio (there is
 * none), GPIO16.
 *
 * TIME is the chip's simulated clock (80 MHz), continued across resets (a
 * reset starts a new chip whose clock begins at zero; the adapter's time goes
 * on from where it was). `advanceNs` runs instructions
 * until the clock reaches the target; while the CPU waits for an interrupt
 * the clock skips to the next timer event instead of spinning.
 *
 * @module
 */

/** The fork's pin states (IOPinState in its src/peripherals/gpio.ts). */
const LOW = 0, HIGH = 1, INPUT = 2, PULLUP = 3, PULLDOWN = 4;
export const ESP8266_PINS = Array.from({ length: 16 }, (_, i) => `GPIO${i}`);
/** GPIO 6-11 are the flash chip's on every module and are not offered. */
const USABLE = [0, 1, 2, 3, 4, 5, 12, 13, 14, 15];

/**
 * @param {object} opts
 * @param {object} opts.esp8266js   the fork's module (`await import('esp8266js')`)
 * @param {Uint8Array} opts.image   a flash image (written at offset 0)
 * @returns {object} boundary-A adapter
 */
export function createEsp8266jsAdapter (opts = {}) {
  const lib = opts.esp8266js;
  if (!lib || !lib.ESP8266 || !lib.RomHle || !lib.bootFromFlash) {
    throw new Error('esp8266js-adapter: opts.esp8266js must be the esp8266js module (ESP8266, RomHle, bootFromFlash)');
  }
  if (!(opts.image instanceof Uint8Array) || opts.image.length < 8 || opts.image[0] !== 0xe9) {
    throw new Error('esp8266js-adapter: opts.image must be an ESP8266 flash image (it starts with 0xE9)');
  }
  const image = opts.image.slice();
  const stats = { pinChangeCount: 0, advanceToCount: 0, steps: 0 };
  let board = null;
  let serialListener = null;
  let esp = null;
  let removeListeners = [];
  let fault = null;
  /**
   * Board time at which the present chip started. A reset builds a new chip
   * whose clock starts at zero; the board's time must not run backwards.
   */
  let startNs = 0n;

  function build () {
    if (esp) startNs = timeNs();
    for (const remove of removeListeners) remove();
    removeListeners = [];
    esp = new lib.ESP8266();
    if (image.length > esp.flash.length) throw new Error('esp8266js-adapter: the image is larger than the flash');
    esp.flash.set(image, 0);
    new lib.RomHle(esp).install();
    lib.bootFromFlash(esp);
    fault = null;
    esp.cores[0].unknownInstruction = (opcode) => {
      fault = fault || { cause: 'unknown-instruction', pc: esp.cores[0].PC, opcode };
    };
    esp.uart[0].onTX = (byte) => {
      esp.uart[0].txComplete();
      if (serialListener) serialListener(byte & 0xff);
    };
    adapter.esp = esp;
    if (board) wire();
  }

  function timeNs () { return startNs + BigInt(Math.round(esp.clock.nanos)); }

  function wire () {
    for (const index of USABLE) {
      const name = ESP8266_PINS[index];
      const pin = esp.gpio.pins[index];
      removeListeners.push(pin.addListener((state) => report(name, state)));
      report(name, pin.state, true);
    }
    syncInputs();
  }

  function report (name, state, initial = false) {
    if (!board || !board.setPin) return;
    if (!initial && board.advanceTo) { board.advanceTo(timeNs()); stats.advanceToCount++; }
    switch (state) {
      case LOW: board.setPin(name, 'pushpull', false); break;
      case HIGH: board.setPin(name, 'pushpull', true); break;
      case PULLUP: board.setPin(name, 'input-pullup', true); break;
      case PULLDOWN: board.setPin(name, 'input-pulldown', false); break;
      case INPUT:
      default: board.setPin(name, 'input', false); break;
    }
    if (!initial) stats.pinChangeCount++;
  }

  /** Give every pin the firmware is not driving the board's level. */
  function syncInputs () {
    if (!board || !board.readPin) return;
    for (const index of USABLE) {
      const pin = esp.gpio.pins[index];
      if (pin.state === LOW || pin.state === HIGH) continue;
      pin.inputValue = board.readPin(ESP8266_PINS[index]) === 1;
    }
  }

  const adapter = {
    kind: 'esp8266js',
    clockHz: 80_000_000,
    pins: USABLE.map(i => ESP8266_PINS[i]),
    stats,
    esp: null,

    attachBoard (b) {
      board = b;
      for (const remove of removeListeners) remove();
      removeListeners = [];
      wire();
    },

    /** Start the program again from its image, as a reset does. */
    resetToProgram () { build(); },

    /** Run the chip until `deltaNs` more of its time has passed, or it faults. */
    advanceNs (deltaNs) {
      syncInputs();
      const target = esp.clock.nanos + Number(deltaNs);
      while (esp.clock.nanos < target && !fault) {
        if (esp.coresIdle) esp.clock.skipToNextEvent(target);
        else { esp.step(); stats.steps++; }
      }
      if (board && board.advanceTo) { board.advanceTo(timeNs()); stats.advanceToCount++; }
    },

    timeNs,

    /** Why the program stopped, if it did: an unknown instruction, or null. */
    get fault () { return fault; },

    onSerial (cb) { serialListener = cb; },

    /** Bytes into the chip's serial receiver. */
    sendSerial (byteOrBytes) {
      const bytes = typeof byteOrBytes === 'number' ? [byteOrBytes] : Array.from(byteOrBytes);
      for (const b of bytes) esp.uart[0].feedByte(b & 0xff);
    },

    syncInputs,
  };

  build();
  return adapter;
}

export default createEsp8266jsAdapter;
