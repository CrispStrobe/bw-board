/**
 * emu8051-stc adapter — bridges the WASM emulator API to boundary A.
 *
 * Two modes, selected automatically:
 *
 *   PUSH MODE (preferred): the emulator calls on_pin_change(port, bit,
 *   mode, drive) directly via a C callback registered through
 *   emu_set_board_callbacks / Emscripten addFunction. Zero polling loss.
 *   Every pin toggle is seen, including sub-microsecond buzzer edges.
 *
 *   POLL MODE (fallback): for WASM builds that don't expose the callback
 *   registration. Polls emu_get_pin_mode/emu_get_pin_drive after each
 *   run step and diffs against last known state. Toggle edges between
 *   polls are invisible — buzzer frequency degrades at high frequencies.
 *
 * The adapter auto-detects which mode is available.
 *
 * @module
 */

/** Mode index to PinMode string */
const MODE_NAMES = ['quasi', 'pushpull', 'input', 'opendrain'];

/**
 * @typedef {object} PinSnapshot
 * @property {string} mode
 * @property {boolean} driveHigh
 */

/**
 * @typedef {object} Emu8051Wasm
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
 * @property {(ptr: number, len: number) => number} [_emu_load_hex]
 * @property {(pinCb: number, readCb: number, analogCb: number, advCb: number, ud: number) => void} [_emu_set_board_callbacks]
 * @property {(sig: string, fn: Function) => number} [addFunction]
 * @property {(ptr: number) => void} [removeFunction]
 * @property {(size: number) => number} _malloc
 * @property {(ptr: number) => void} _free
 * @property {Uint8Array} HEAPU8
 */

/**
 * Create an emu8051 adapter that satisfies boundary A.
 *
 * @param {Emu8051Wasm} wasm - the WASM module instance
 * @param {object} [opts]
 * @param {number} [opts.fosc] - oscillator frequency (default 11059200)
 * @param {number} [opts.vcc] - supply voltage (default 5.0)
 * @param {number[]} [opts.ports] - which ports to track in poll mode (default [1, 3])
 * @param {number} [opts.pollIntervalNs] - poll interval in fallback mode (default 1000)
 * @param {'push' | 'poll' | 'auto'} [opts.mode] - force a mode (default 'auto')
 */
export function createEmu8051Adapter(wasm, opts = {}) {
  const fosc = opts.fosc ?? 11059200;
  const vcc = opts.vcc ?? 5.0;
  const ports = opts.ports ?? [1, 3];
  const pollIntervalNs = opts.pollIntervalNs ?? 1000;
  const part = String(opts.part ?? 'stc12c5a60s2').toLowerCase();

  // Initialize
  wasm._emu_init(1); // STC12 mode
  // Part selection — the ABI contract with emu8051-stc: _emu_set_part(id)
  // after emu_init, before any hex load. The table is the contract; both
  // sides cite it (STC15-PERIPHERAL-MODEL.md §3 for what each id implies —
  // an STC15 program on the STC12 model loses P5 SILENTLY, which is how
  // the RBS15667 console's buzzer would die with no error anywhere).
  const PART_IDS = {
    stc12c5a60s2: 0, stc12c5a16s2: 0,
    stc15f2k60s2: 1, stc15w408as: 1,
    stc89c52: 2, stc89c52rc: 2,
  };
  const partId = PART_IDS[part] ?? 0;
  if (typeof wasm._emu_set_part === 'function') {
    wasm._emu_set_part(partId);
  } else if (partId !== 0) {
    // Truthful refusal, not silence: the build cannot model this part.
    console.warn(`[emu8051-adapter] this emulator build has no _emu_set_part — ` +
      `'${part}' runs on the STC12 model (P5 and STC15-only registers will refuse)`);
  }
  wasm._emu_set_fosc(fosc);
  wasm._emu_set_vcc(vcc);

  /** @type {{ setPin: Function, advanceTo: Function, readPin: Function, readAnalog: Function } | null} */
  let board = null;

  /** @type {Map<string, PinSnapshot>} */
  const lastState = new Map();

  const stats = {
    pollCount: 0,
    pinChangeCount: 0,
    advanceToCount: 0,
    pushCallbackCount: 0,
    mode: /** @type {'push' | 'poll' | 'none'} */ ('none'),
  };

  // ─── Push mode setup ─────────────────────────────────────────────────

  const hasPushAPI = !!(wasm._emu_set_board_callbacks && wasm.addFunction);
  let requestedMode = opts.mode ?? 'auto';
  const usePush = requestedMode === 'push' || (requestedMode === 'auto' && hasPushAPI);

  /** @type {number | null} registered function pointer for cleanup */
  let pinCbPtr = null;
  let readPinCbPtr = null;
  let readAnalogCbPtr = null;
  let advanceCbPtr = null;

  function setupPushCallbacks() {
    if (!wasm.addFunction || !wasm._emu_set_board_callbacks) return false;

    // Guard: Emscripten's addFunction can fail with WASM type signature
    // mismatches (e.g., i64 legalization splits uint64_t into two i32 args,
    // but the generated WASM shim expects the original signature).
    // Try it and fall back to poll mode if it throws.

    // on_pin_change(port, bit, mode, drive, user_data)
    try {
      // Emscripten type sig: v=void, i=int32, d=double
      pinCbPtr = wasm.addFunction((port, bit, modeIdx, drive, _ud) => {
        if (!board) return;
        // Advance board time to the emulator's current time BEFORE applying
        // the pin change. Without this, the brightness integrator sees all
        // toggles at the same board time and cannot integrate duty.
        board.advanceTo(getCurrentTimeNs());
        const pinId = `P${port}.${bit}`;
        const mode = MODE_NAMES[modeIdx] ?? 'quasi';
        const driveHigh = drive !== 0;
        lastState.set(pinId, { mode, driveHigh });
        board.setPin(pinId, mode, driveHigh);
        stats.pushCallbackCount++;
        stats.pinChangeCount++;
      }, 'viiiii');

      readPinCbPtr = wasm.addFunction((port, bit, _ud) => {
        if (!board) return 0;
        return board.readPin(`P${port}.${bit}`);
      }, 'iiii');

      readAnalogCbPtr = wasm.addFunction((port, bit, _ud) => {
        if (!board) return 0;
        return board.readAnalog(`P${port}.${bit}`);
      }, 'diii');

      // on_advance: uint64_t is legalized to two i32 args without WASM_BIGINT
      advanceCbPtr = wasm.addFunction((tNsLo, tNsHi, _ud) => {
        if (!board) return;
        const tNs = BigInt(tNsLo >>> 0) | (BigInt(tNsHi >>> 0) << 32n);
        board.advanceTo(tNs);
        stats.advanceToCount++;
      }, 'viii');

      wasm._emu_set_board_callbacks(
        pinCbPtr, readPinCbPtr, readAnalogCbPtr, advanceCbPtr, 0
      );

      stats.mode = 'push';
      return true;
    } catch (e) {
      // WASM function signature mismatch — fall back to poll mode.
      // This happens when Emscripten legalizes i64 into split i32 args
      // and the addFunction shim doesn't match. Clean up any partial
      // registrations.
      if (wasm.removeFunction) {
        if (pinCbPtr) { try { wasm.removeFunction(pinCbPtr); } catch {} }
        if (readPinCbPtr) { try { wasm.removeFunction(readPinCbPtr); } catch {} }
        if (readAnalogCbPtr) { try { wasm.removeFunction(readAnalogCbPtr); } catch {} }
        if (advanceCbPtr) { try { wasm.removeFunction(advanceCbPtr); } catch {} }
      }
      pinCbPtr = readPinCbPtr = readAnalogCbPtr = advanceCbPtr = null;
      return false;
    }
  }

  // ─── Poll mode helpers ───────────────────────────────────────────────

  function splitNs(ns) {
    const lo = Number(ns & 0xFFFFFFFFn);
    const hi = Number((ns >> 32n) & 0xFFFFFFFFn);
    return [lo, hi];
  }

  function getCurrentTimeNs() {
    // >>> 0 is load-bearing: the wasm returns uint32_t but Emscripten's
    // glue delivers a SIGNED i32, so past 2^31 ns (2.147 s of sim time)
    // the low word goes negative — time ran backwards, the brightness
    // window integrated nothing (dark display digits), and the next
    // splitNs built a target near 2^64 that advance chased forever
    // (found by the 76-multimeter chain test, 2026-08-17). The push
    // callbacks already guarded with tNsLo >>> 0; this path did not.
    const lo = wasm._emu_get_time_ns_lo() >>> 0;
    const hi = wasm._emu_get_time_ns_hi() >>> 0;
    return BigInt(lo) | (BigInt(hi) << 32n);
  }

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

  function syncPinInputs() {
    if (!board) return;
    for (const port of ports) {
      for (let bit = 0; bit < 8; bit++) {
        const pinId = `P${port}.${bit}`;
        const state = lastState.get(pinId);
        if (state && (state.mode === 'input' || state.mode === 'quasi' || state.mode === 'opendrain')) {
          const level = board.readPin(pinId);
          wasm._emu_set_pin_input(port, bit, level);
        }
      }
    }
  }

  function syncAdcInputs() {
    if (!board) return;
    for (let ch = 0; ch < 8; ch++) {
      const volts = board.readAnalog(`P1.${ch}`);
      wasm._emu_set_adc_voltage(ch, volts);
    }
  }

  // ─── The adapter ─────────────────────────────────────────────────────

  const adapter = {
    reset() {
      wasm._emu_reset(1);
      lastState.clear();
      stats.pollCount = 0;
      stats.pinChangeCount = 0;
      stats.advanceToCount = 0;
      stats.pushCallbackCount = 0;
    },

    setFosc(hz) { wasm._emu_set_fosc(hz); },

    attachBoard(b) {
      board = b;

      // Try push mode first
      if (usePush && !pinCbPtr) {
        setupPushCallbacks();
      }

      if (stats.mode !== 'push') {
        stats.mode = 'poll';
      }
      // Initial full publish in BOTH modes. Push callbacks fire only on
      // CHANGES, so a pin the firmware never writes — a button input
      // sitting at its reset value — was never seated on the board: the
      // net floated at 0 V and the read-back callback returned 0, i.e.
      // every untouched active-low button read as held-down forever
      // (found by the 76-multimeter mode button, 2026-08-17).
      pollPins();
    },

    writePort(port, value) {
      wasm._emu_set_sfr(0x80 + port * 0x10, value);
      if (stats.mode === 'poll') pollPins();
    },

    setPortMode(port, m1, m0) {
      const m1Addrs = [0x93, 0x91, 0x95, 0xB1, 0xB3, 0xC9];
      const m0Addrs = [0x94, 0x92, 0x96, 0xB2, 0xB4, 0xCA];
      if (port < m1Addrs.length) {
        wasm._emu_set_sfr(m1Addrs[port], m1);
        wasm._emu_set_sfr(m0Addrs[port], m0);
      }
      if (stats.mode === 'poll') pollPins();
    },

    readPort(port) {
      if (stats.mode === 'poll') syncPinInputs();
      return wasm._emu_get_sfr(0x80 + port * 0x10);
    },

    runNs(ns) {
      if (stats.mode === 'poll') {
        syncPinInputs();
        syncAdcInputs();
      }

      const targetNs = getCurrentTimeNs() + BigInt(ns);

      if (stats.mode === 'push') {
        // Push mode: callbacks fire during execution — no polling needed
        const [lo, hi] = splitNs(targetNs);
        wasm._emu_advance_to_ns(lo, hi);
        // The on_advance callback already called board.advanceTo
      } else {
        // Poll mode: step in intervals
        if (pollIntervalNs > 0 && ns > pollIntervalNs) {
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
      }
    },

    startAdc(channel) {
      if (stats.mode === 'poll') syncAdcInputs();
      wasm._emu_set_sfr(0xBC, 0xE8 | (channel & 0x07));
    },

    adcReady() {
      return (wasm._emu_get_sfr(0xBC) & 0x10) !== 0;
    },

    readAdc() {
      const hi = wasm._emu_get_sfr(0xBD);
      const lo = wasm._emu_get_sfr(0xBE);
      wasm._emu_set_sfr(0xBC, wasm._emu_get_sfr(0xBC) & ~0x10);
      return (hi << 2) | (lo & 0x03);
    },

    getStats() { return { ...stats }; },

    loadHex(hexString) {
      if (!wasm._emu_load_hex) return;
      if (wasm.stringToUTF8 && wasm._malloc) {
        // Emscripten module with stringToUTF8 helper
        const len = hexString.length;
        const ptr = wasm._malloc(len + 1);
        wasm.stringToUTF8(hexString, ptr, len + 1);
        wasm._emu_load_hex(ptr, len);
        wasm._free(ptr);
      } else if (wasm.ccall) {
        // Emscripten ccall fallback
        wasm.ccall('emu_load_hex', 'number', ['string', 'number'],
                   [hexString, hexString.length]);
      }
    },

    /** Clean up registered function pointers. */
    destroy() {
      if (wasm.removeFunction) {
        if (pinCbPtr) wasm.removeFunction(pinCbPtr);
        if (readPinCbPtr) wasm.removeFunction(readPinCbPtr);
        if (readAnalogCbPtr) wasm.removeFunction(readAnalogCbPtr);
        if (advanceCbPtr) wasm.removeFunction(advanceCbPtr);
      }
      pinCbPtr = readPinCbPtr = readAnalogCbPtr = advanceCbPtr = null;
    },

    // Conformance adapter interface
    getPinHistory() {
      return [...lastState.entries()].map(([pin, s]) => ({
        pin, mode: s.mode, driveHigh: s.driveHigh, tNs: getCurrentTimeNs(),
      }));
    },
    getTimeHistory() { return [getCurrentTimeNs()]; },
  };

  return adapter;
}

/**
 * Format a polling loss report for documentation.
 * @param {object} stats
 * @param {number} elapsedNs
 * @returns {string}
 */
export function formatPollingLossReport(stats, elapsedNs) {
  const lines = [
    'Adapter Mode Report',
    '─'.repeat(40),
    `Mode: ${stats.mode}`,
    `Pin changes detected: ${stats.pinChangeCount}`,
    `advanceTo calls: ${stats.advanceToCount}`,
  ];

  if (stats.mode === 'push') {
    lines.push(`Push callbacks received: ${stats.pushCallbackCount}`);
    lines.push('');
    lines.push('Push mode: every pin toggle is seen. Zero polling loss.');
  } else {
    lines.push(`Polls: ${stats.pollCount}`);
    lines.push('');
    lines.push('Poll mode: toggle edges between polls are invisible.');
    lines.push('Upgrade to a WASM build with emu_set_board_callbacks');
    lines.push('to eliminate this loss.');
  }

  return lines.join('\n');
}
