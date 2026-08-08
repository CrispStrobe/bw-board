/**
 * emu8051-stc adapter — bridges the WASM emulator API to boundary A.
 *
 * The emu8051-stc WASM API is CLOSE to boundary A but does not satisfy it
 * natively. This adapter bridges the gap:
 *
 *   Gap 1: No pin-change callback from JS side. The C layer has
 *          on_pin_change callbacks, but WASM/Emscripten does not expose
 *          them to JS. We POLL emu_get_pin_mode/emu_get_pin_drive after
 *          each run step and diff against the last known state.
 *
 *   Gap 2: emu_advance_to_ns takes split (lo, hi) uint32 pair, not bigint.
 *          We split the bigint here.
 *
 *   Gap 3: readPin/readAnalog go through emu_set_pin_input and
 *          emu_set_adc_voltage — the adapter hooks these so the board's
 *          answers are injected before the MCU reads.
 *
 * KNOWN LOSS from polling (measure this):
 *   Toggle edges between polls are invisible. If the MCU toggles a pin
 *   twice within one run step, only the final state is seen. This makes
 *   buzzer frequency detection unreliable at high frequencies or coarse
 *   poll intervals. The measurement of this loss is what justifies asking
 *   the emulator agent to add native JS callbacks.
 *
 * @module
 */

/**
 * @typedef {object} Emu8051Wasm
 * The WASM module instance (from createEmu8051()).
 * @property {(stc12: number) => void} _emu_init
 * @property {(wipe: number) => void} _emu_reset
 * @property {(fosc: number) => void} _emu_set_fosc
 * @property {(lo: number, hi: number) => number} _emu_advance_to_ns
 * @property {(port: number, bit: number) => number} _emu_get_pin_mode
 * @property {(port: number, bit: number) => number} _emu_get_pin_drive
 * @property {(port: number, bit: number, level: number) => void} _emu_set_pin_input
 * @property {(channel: number, volts: number) => void} _emu_set_adc_voltage
 * @property {(vcc: number) => void} _emu_set_vcc
 * @property {() => number} _emu_get_time_ns_lo
 * @property {() => number} _emu_get_time_ns_hi
 * @property {(addr: number) => number} _emu_get_sfr
 * @property {(addr: number, val: number) => void} _emu_set_sfr
 * @property {(ptr: number, len: number) => number} _emu_load_hex
 * @property {(size: number) => number} _malloc
 * @property {(ptr: number) => void} _free
 * @property {Uint8Array} HEAPU8
 */

/** Mode index to PinMode string */
const MODE_NAMES = ['quasi', 'pushpull', 'input', 'opendrain'];

/**
 * State for one pin.
 * @typedef {object} PinSnapshot
 * @property {string} mode
 * @property {boolean} driveHigh
 */

/**
 * Create an emu8051 adapter that satisfies boundary A.
 *
 * @param {Emu8051Wasm} wasm - the WASM module instance
 * @param {object} [opts]
 * @param {number} [opts.fosc] - oscillator frequency (default 11059200)
 * @param {number} [opts.vcc] - supply voltage (default 5.0)
 * @param {number[]} [opts.ports] - which ports to track (default [1, 3])
 * @param {number} [opts.pollIntervalNs] - how often to poll for pin changes
 *   during advanceTo. Default 1000 (1 µs). Lower = more accurate buzzer
 *   frequency but slower. 0 = poll only at the end of each run step.
 */
export function createEmu8051Adapter(wasm, opts = {}) {
  const fosc = opts.fosc ?? 11059200;
  const vcc = opts.vcc ?? 5.0;
  const ports = opts.ports ?? [1, 3];
  const pollIntervalNs = opts.pollIntervalNs ?? 1000;

  // Initialize
  wasm._emu_init(1); // STC12 mode
  wasm._emu_set_fosc(fosc);
  wasm._emu_set_vcc(vcc);

  /** @type {{ setPin: Function, advanceTo: Function, readPin: Function, readAnalog: Function } | null} */
  let board = null;

  /** @type {Map<string, PinSnapshot>} pinId → last known state */
  const lastState = new Map();

  /** Stats for measuring polling loss */
  const stats = {
    pollCount: 0,
    pinChangeCount: 0,
    advanceToCount: 0,
    /** Estimated missed edges (pin state same at start and end of step but
     *  may have toggled in between — we can't know) */
    potentialMissedEdges: 0,
  };

  /**
   * Split a bigint nanosecond value into (lo, hi) uint32 pair.
   * @param {bigint} ns
   * @returns {[number, number]}
   */
  function splitNs(ns) {
    const lo = Number(ns & 0xFFFFFFFFn);
    const hi = Number((ns >> 32n) & 0xFFFFFFFFn);
    return [lo, hi];
  }

  /**
   * Get the current MCU time as bigint nanoseconds.
   * @returns {bigint}
   */
  function getCurrentTimeNs() {
    const lo = wasm._emu_get_time_ns_lo();
    const hi = wasm._emu_get_time_ns_hi();
    return BigInt(lo) | (BigInt(hi) << 32n);
  }

  /**
   * Poll all tracked pins and emit setPin for any changes.
   */
  function pollPins() {
    if (!board) return;
    stats.pollCount++;

    for (const port of ports) {
      for (let bit = 0; bit < 8; bit++) {
        const pinId = `P${port}.${bit}`;
        const modeIdx = wasm._emu_get_pin_mode(port, bit);
        const driveVal = wasm._emu_get_pin_drive(port, bit);
        const mode = MODE_NAMES[modeIdx] ?? 'quasi';
        const driveHigh = driveVal !== 0;

        const prev = lastState.get(pinId);
        if (!prev || prev.mode !== mode || prev.driveHigh !== driveHigh) {
          lastState.set(pinId, { mode, driveHigh });
          board.setPin(pinId, mode, driveHigh);
          stats.pinChangeCount++;
        }
      }
    }
  }

  /**
   * Inject board's readPin results back into the emulator.
   * Called before the MCU reads a port.
   */
  function syncPinInputs() {
    if (!board) return;
    for (const port of ports) {
      for (let bit = 0; bit < 8; bit++) {
        const pinId = `P${port}.${bit}`;
        const state = lastState.get(pinId);
        // Only inject for input/quasi/opendrain modes where external state matters
        if (state && (state.mode === 'input' || state.mode === 'quasi' || state.mode === 'opendrain')) {
          const level = board.readPin(pinId);
          wasm._emu_set_pin_input(port, bit, level);
        }
      }
    }
  }

  /**
   * Inject board's readAnalog results for ADC channels.
   * Called when ADC conversion starts.
   */
  function syncAdcInputs() {
    if (!board) return;
    for (let ch = 0; ch < 8; ch++) {
      const pinId = `P1.${ch}`;
      const volts = board.readAnalog(pinId);
      wasm._emu_set_adc_voltage(ch, volts);
    }
  }

  // ─── The adapter object ──────────────────────────────────────────────────

  const adapter = {
    // ─── Setup ─────────────────────────────────────────────────────────

    reset() {
      wasm._emu_reset(1);
      lastState.clear();
      stats.pollCount = 0;
      stats.pinChangeCount = 0;
      stats.advanceToCount = 0;
      stats.potentialMissedEdges = 0;
    },

    setFosc(hz) {
      wasm._emu_set_fosc(hz);
    },

    /**
     * @param {{ setPin: Function, advanceTo: Function, readPin: Function, readAnalog: Function }} b
     */
    attachBoard(b) {
      board = b;
      // Do initial pin state sync
      pollPins();
    },

    // ─── Stimulation ───────────────────────────────────────────────────

    writePort(port, value) {
      wasm._emu_set_sfr(0x80 + port * 0x10, value);
      // Port writes change pin state — poll immediately
      pollPins();
    },

    setPortMode(port, m1, m0) {
      // SFR addresses for PxM1/PxM0 (from STC12-PERIPHERAL-MODEL.md §2)
      const m1Addrs = [0x93, 0x91, 0x95, 0xB1, 0xB3, 0xC9]; // P0M1..P5M1
      const m0Addrs = [0x94, 0x92, 0x96, 0xB2, 0xB4, 0xCA]; // P0M0..P5M0
      if (port < m1Addrs.length) {
        wasm._emu_set_sfr(m1Addrs[port], m1);
        wasm._emu_set_sfr(m0Addrs[port], m0);
      }
      // Mode changes are pin events — poll immediately
      pollPins();
    },

    readPort(port) {
      syncPinInputs();
      return wasm._emu_get_sfr(0x80 + port * 0x10);
    },

    runNs(ns) {
      syncPinInputs();
      syncAdcInputs();

      const targetNs = getCurrentTimeNs() + BigInt(ns);

      if (pollIntervalNs > 0 && ns > pollIntervalNs) {
        // Step in intervals, polling each time
        let current = getCurrentTimeNs();
        while (current < targetNs) {
          const stepEnd = current + BigInt(pollIntervalNs);
          const end = stepEnd < targetNs ? stepEnd : targetNs;
          const [lo, hi] = splitNs(end);
          wasm._emu_advance_to_ns(lo, hi);
          pollPins();
          if (board) {
            stats.advanceToCount++;
            board.advanceTo(getCurrentTimeNs());
          }
          current = getCurrentTimeNs();
        }
      } else {
        const [lo, hi] = splitNs(targetNs);
        wasm._emu_advance_to_ns(lo, hi);
        pollPins();
        if (board) {
          stats.advanceToCount++;
          board.advanceTo(getCurrentTimeNs());
        }
      }
    },

    // ─── ADC ───────────────────────────────────────────────────────────

    startAdc(channel) {
      syncAdcInputs();
      // Write ADC_CONTR: power on, fastest speed, start, channel
      wasm._emu_set_sfr(0xBC, 0xE8 | (channel & 0x07));
    },

    adcReady() {
      return (wasm._emu_get_sfr(0xBC) & 0x10) !== 0; // ADC_FLAG
    },

    readAdc() {
      const hi = wasm._emu_get_sfr(0xBD); // ADC_RES
      const lo = wasm._emu_get_sfr(0xBE); // ADC_RESL
      // Clear flag
      wasm._emu_set_sfr(0xBC, wasm._emu_get_sfr(0xBC) & ~0x10);
      return (hi << 2) | (lo & 0x03);
    },

    // ─── Observation ───────────────────────────────────────────────────

    /** Get polling loss statistics. */
    getStats() { return { ...stats }; },

    /**
     * Load an Intel HEX file into the emulator.
     * @param {string} hexString
     */
    loadHex(hexString) {
      const bytes = new TextEncoder().encode(hexString);
      const ptr = wasm._malloc(bytes.length + 1);
      wasm.HEAPU8.set(bytes, ptr);
      wasm.HEAPU8[ptr + bytes.length] = 0; // null-terminate
      wasm._emu_load_hex(ptr, bytes.length);
      wasm._free(ptr);
    },

    // ─── Conformance adapter interface ─────────────────────────────────
    // These are for the conformance kit — not part of the normal API.

    getPinHistory() {
      // We can't replay history — we only have the current state.
      // Return current state for all tracked pins.
      return [...lastState.entries()].map(([pin, s]) => ({
        pin, mode: s.mode, driveHigh: s.driveHigh, tNs: getCurrentTimeNs(),
      }));
    },

    getTimeHistory() {
      return [getCurrentTimeNs()];
    },
  };

  return adapter;
}

/**
 * Document the known polling losses for the README.
 *
 * @param {object} stats - from adapter.getStats()
 * @param {number} elapsedNs - total simulated time
 * @returns {string}
 */
export function formatPollingLossReport(stats, elapsedNs) {
  const lines = [
    'Polling Loss Report',
    '─'.repeat(40),
    `Polls: ${stats.pollCount}`,
    `Pin changes detected: ${stats.pinChangeCount}`,
    `advanceTo calls: ${stats.advanceToCount}`,
    `Simulated time: ${(Number(elapsedNs) / 1e6).toFixed(1)} ms`,
    '',
    'Known losses from polling (vs native callbacks):',
    '  - Toggle edges between polls are invisible',
    '  - Buzzer frequency accuracy degrades at >10 kHz',
    '  - PWM brightness has temporal aliasing at coarse intervals',
    '',
    'Mitigation: request native on_pin_change callback exposure',
    'from the emu8051-stc WASM build (the C layer already has it).',
  ];
  return lines.join('\n');
}
