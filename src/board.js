/**
 * Board implementation — closed-form solver for the starter-kit component set.
 *
 * No MNA solver yet. Handles: resistor, LED, potentiometer, button, buzzer,
 * capacitor, VCC, GND, and MCU pins via Thévenin equivalents.
 *
 * @module
 */

/** @typedef {import('./types.js').Part} Part */
/** @typedef {import('./types.js').Net} Net */
/** @typedef {import('./types.js').PinId} PinId */
/** @typedef {import('./types.js').PinMode} PinMode */
/** @typedef {import('./types.js').TheveninSource} TheveninSource */

import { pinThevenin } from './pin-model.js';
import { solveMNA } from './mna.js';
import { validateNetlist } from './validate.js';
import { getDevice, initDeviceState } from './devices.js';

/**
 * Internal pin state.
 * @typedef {object} PinState
 * @property {PinMode} mode
 * @property {boolean} driveHigh
 */

/**
 * LED default parameters.
 */
const LED_VF = 2.0;       // forward voltage threshold
const LED_RD = 10;         // dynamic resistance above threshold
const LED_I_RATED = 0.020; // 20 mA rated current (for brightness normalization)

/**
 * Part kinds the closed-form walker cannot represent. Their presence routes
 * _solve() through the full MNA path — the walker would otherwise report
 * voltages as if these parts were absent.
 */
const MNA_ONLY_KINDS = new Set([
  'npn', 'pnp', 'nmos', 'pmos', 'opamp', 'zener', 'diode', 'vsource', 'isource',
]);

/**
 * Brightness integrator window.
 */
const BRIGHTNESS_WINDOW_NS = 20_000_000n; // 20 ms

/**
 * Combine multiple Thévenin sources into one via Norton equivalents.
 * @param {Array<{vTh: number, rTh: number}>} sources
 * @returns {{ vTh: number, rTh: number } | null}
 */
function combineThevenin(sources) {
  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];

  let iTotal = 0;
  let gTotal = 0;
  for (const s of sources) {
    const r = Math.max(s.rTh, 0.001);
    gTotal += 1 / r;
    iTotal += s.vTh / r;
  }
  if (gTotal <= 0) return null;
  return { vTh: iTotal / gTotal, rTh: 1 / gTotal };
}

export class BoardImpl {
  constructor(vcc = 5.0) {
    /** @type {number} */
    this.vcc = vcc;

    /** @type {boolean} */
    this.powered = true;

    /** @type {Part[]} */
    this.parts = [];

    /** @type {Net[]} */
    this.nets = [];

    /** @type {Map<string, Part>} part id → Part */
    this.partMap = new Map();

    /** @type {Map<string, Net>} net id → Net */
    this.netMap = new Map();

    /** @type {Map<string, PinState>} PinId → state */
    this.pinStates = new Map();

    /** @type {Map<string, number>} part id → control value (pot 0…1, button 0/1) */
    this.controls = new Map();

    /** @type {bigint} current simulation time in nanoseconds */
    this.timeNs = 0n;

    /**
     * LED brightness history: part id → array of {tNs, current} samples.
     * @type {Map<string, Array<{tNs: bigint, current: number}>>}
     */
    this.ledHistory = new Map();

    /**
     * Buzzer edge history: part id → array of timestamps when the driving net toggled.
     * @type {Map<string, bigint[]>}
     */
    this.buzzerEdges = new Map();

    /**
     * Cached node voltages from last solve.
     * @type {Map<string, number>}
     */
    this.nodeVoltages = new Map();

    /**
     * Inductor currents: part id → current through the inductor.
     * @type {Map<string, number>}
     */
    this.inductorCurrents = new Map();

    /**
     * Cached LED currents from last solve.
     * @type {Map<string, number>}
     */
    this.ledCurrents = new Map();

    /**
     * Oscilloscope probes: net id → ring buffer of {tNs, voltage} samples.
     * @type {Map<string, Array<{tNs: bigint, v: number}>>}
     */
    this._probes = new Map();

    /** Maximum samples per probe (ring buffer size). */
    this._probeMaxSamples = 10000;

    /**
     * Scope channels: handle → channel config + ring buffer.
     * @type {Map<number, object>}
     */
    this._scopeChannels = new Map();

    /** Next scope channel handle. */
    this._nextScopeHandle = 1;

    /** Whether the last MNA solve converged. */
    this._lastSolveConverged = true;

    /** Whether advanceTo hit the device sub-step cap. */
    this._deviceSubstepOverflow = false;

    /**
     * 74HC595 shift register states: part id → FSM state.
     * @type {Map<string, {shiftReg: number, latchReg: number, lastClock: boolean, lastLatch: boolean}>}
     */
    this._shiftRegisters = new Map();

    /**
     * Capacitor voltages: part id → current voltage across the cap.
     * @type {Map<string, number>}
     */
    this.capVoltages = new Map();

    /**
     * Registered-device states: part id → model state (incl. state.drives).
     * @type {Map<string, object>}
     */
    this._deviceStates = new Map();

    /**
     * LED cube state: part id → { selectPins, dataPins, polarity, voxelHistory }.
     * Each voxel accumulates lit-time over the brightness window.
     * @type {Map<string, object>}
     */
    this._cubes = new Map();
  }

  // ─── Boundary B: setNetlist ──────────────────────────────────────────────

  /**
   * @param {Part[]} parts
   * @param {Net[]} nets
   */
  setNetlist(parts, nets) {
    // Validate the netlist and reject malformed input. Without this,
    // a wrong terminal name (e.g. {a,b} instead of {anode,cathode} for
    // an LED) silently produces brightness 0 — a plausible wrong answer.
    const errors = validateNetlist(parts, nets);
    const fatal = errors.filter(e => e.severity === 'error');
    if (fatal.length > 0) {
      throw new Error(
        'Invalid netlist:\n' + fatal.map(e => `  - ${e.message}`).join('\n')
      );
    }

    this.parts = parts;
    this.nets = nets;
    this.partMap = new Map(parts.map(p => [p.id, p]));
    this.netMap = new Map(nets.map(n => [n.id, n]));
    this.ledHistory.clear();
    this.buzzerEdges.clear();
    this.capVoltages.clear();
    this.nodeVoltages.clear();
    this.ledCurrents.clear();

    for (const p of parts) {
      if (p.kind === 'led') {
        this.ledHistory.set(p.id, []);
      }
      if (p.kind === 'buzzer') {
        this.buzzerEdges.set(p.id, []);
      }
      if (p.kind === 'capacitor') {
        if (!this.capVoltages.has(p.id)) {
          this.capVoltages.set(p.id, 0); // start uncharged
        }
      }
      if (p.kind === 'inductor') {
        if (!this.inductorCurrents.has(p.id)) {
          this.inductorCurrents.set(p.id, 0);
        }
      }
      if (p.kind === 'shift_register') {
        this._shiftRegisters.set(p.id, {
          shiftReg: 0,    // 8-bit shift register
          latchReg: 0,    // 8-bit output latch
          lastClock: false,
          lastLatch: false,
        });
      }
      if (p.kind === 'led_cube') {
        // Default: 8 scan lines × 8 data bits.
        // The STC12 cube scans 8 lines (4 layers × 2 colour groups)
        // with P0 as 8-bit data. A voxel lit on exactly one scan line
        // has 12.5% duty (1/8), not 25%.
        const layers = /** @type {number} */ (p.params.layers ?? 8);
        const cols = /** @type {number} */ (p.params.cols ?? 8);
        const polarity = /** @type {string} */ (p.params.polarity ?? 'active-high');
        const voxels = layers * cols;
        // History: array of {tNs, litMask} where litMask is a BigInt bitmask
        this._cubes.set(p.id, {
          layers, cols, polarity,
          history: [{ tNs: 0n, litMask: 0n }],
        });
      }
    }

    this._deviceStates = new Map();
    for (const p of parts) {
      const st = initDeviceState(p);
      if (st) this._deviceStates.set(p.id, st);
    }

    this._solve();
    this._recordLedSamples();
    this._notifyChange('netlist');
  }

  // ─── Boundary A: McuToBoard ──────────────────────────────────────────────

  /**
   * @param {PinId} pin
   * @param {PinMode} mode
   * @param {boolean} driveHigh
   */
  setPin(pin, mode, driveHigh) {
    const prev = this.pinStates.get(pin);
    this.pinStates.set(pin, { mode, driveHigh });
    this._solve();
    this._recordLedSamples();

    // Update scope channel min/max for voltage changes between sample points
    if (this._scopeChannels.size > 0) {
      this._feedScopeVoltages();
    }

    // Record buzzer edges on state change
    if (prev && prev.driveHigh !== driveHigh) {
      this._recordBuzzerEdges(pin);
    }

    // Update LED cube voxel state
    for (const [cubeId] of this._cubes) {
      this._updateCube(cubeId);
    }

    this._notifyChange('pin', { pin, mode, driveHigh });
  }

  /**
   * @param {bigint} tNs
   */
  advanceTo(tNs) {
    const prevNs = this.timeNs;
    if (tNs < prevNs) return;
    if (tNs === prevNs) {
      // Same time: still record probes/LED samples (first call at t=0)
      this._recordLedSamples();
      if (this._scopeChannels.size > 0) this._updateScopeChannels(tNs);
      for (const [netId, data] of this._probes) {
        const v = this.nodeVoltages.get(netId) ?? 0;
        data.push({ tNs, v: Number.isFinite(v) ? v : 0 });
        if (data.length > this._probeMaxSamples) data.splice(0, data.length - this._probeMaxSamples);
      }
      this._notifyChange('time', { tNs });
      return;
    }

    const hasDevices = this._deviceStates.size > 0 || this._shiftRegisters.size > 0;

    // Sub-step through device deadlines so timed transitions fire at the
    // correct time, not just at the destination. Without this, a relay with
    // a 5ms deadline jumped 0→100ms would only see 100ms, and an encoder
    // would undercount edges by the entire interval.
    if (hasDevices && this.powered) {
      const MAX_DEVICE_SUBSTEPS = 200;
      let steps = 0;
      let cursor = prevNs;

      while (cursor < tNs && steps < MAX_DEVICE_SUBSTEPS) {
        // Find the earliest device deadline in (cursor, tNs]
        const deadline = this._earliestDeviceDeadline(cursor, tNs);
        const nextT = deadline ?? tNs;

        // Advance time to this point
        this.timeNs = nextT;
        const dtSec = Number(nextT - cursor) / 1e9;

        // Integrate reactive components for this sub-interval
        if (dtSec > 0) {
          if (this._needsMNA() && (this._hasReactive() || this._hasTimeVaryingSource())) {
            this._integrateTransientMNA(dtSec);
          } else {
            this._integrateCapacitors(dtSec);
            this._integrateInductors(dtSec);
          }
        }

        // Update devices at this time and re-solve if state changed
        for (let round = 0; round < 5; round++) {
          if (!this._updateDevices()) break;
          this._solve();
        }

        cursor = nextT;
        steps++;

        // If we hit the destination and no deadline pulled us earlier, done
        if (nextT >= tNs) break;
      }

      // If we hit the sub-step cap, report it
      if (steps >= MAX_DEVICE_SUBSTEPS && cursor < tNs) {
        this.timeNs = tNs;
        this._deviceSubstepOverflow = true;
      }
    } else {
      // No devices: original fast path
      this.timeNs = tNs;

      if (tNs > prevNs && this.powered) {
        const dtSec = Number(tNs - prevNs) / 1e9;
        if (this._needsMNA() && (this._hasReactive() || this._hasTimeVaryingSource())) {
          this._integrateTransientMNA(dtSec);
        } else {
          this._integrateCapacitors(dtSec);
          this._integrateInductors(dtSec);
        }
      }
    }

    // Record LED current samples at this timestamp
    this._recordLedSamples();

    // Update scope channels (fixed cadence, min/max decimation)
    if (this._scopeChannels.size > 0) {
      this._updateScopeChannels(tNs);
    }

    // Record oscilloscope probe samples
    for (const [netId, data] of this._probes) {
      const v = this.nodeVoltages.get(netId) ?? 0;
      data.push({ tNs, v: Number.isFinite(v) ? v : 0 });
      if (data.length > this._probeMaxSamples) {
        data.splice(0, data.length - this._probeMaxSamples);
      }
    }

    this._notifyChange('time', { tNs });
  }

  // ─── Boundary A: BoardToMcu ──────────────────────────────────────────────

  /**
   * @param {PinId} pin
   * @returns {0 | 1}
   */
  readPin(pin) {
    const v = this._pinVoltage(pin);
    // Standard TTL threshold for 5V: ~1.5V (VIL max ~0.8V, VIH min ~2.0V).
    // Use midpoint ~1.5V for simplicity.
    return v > 1.5 ? 1 : 0;
  }

  /**
   * @param {PinId} pin
   * @returns {number} voltage 0…VCC
   */
  readAnalog(pin) {
    const v = this._pinVoltage(pin);
    return Number.isFinite(v) ? v : 0;
  }

  // ─── Boundary B: instruments ─────────────────────────────────────────────

  /**
   * @param {string} netId
   * @returns {number}
   */
  nodeVoltage(netId) {
    const v = this.nodeVoltages.get(netId) ?? 0;
    return Number.isFinite(v) ? v : 0;
  }

  // ─── Oscilloscope probes ────────────────────────────────────────────────

  /**
   * Attach an oscilloscope probe to a net. Starts recording voltage
   * samples at each advanceTo call.
   * @param {string} netId
   */
  addProbe(netId) {
    if (!this._probes.has(netId)) {
      this._probes.set(netId, []);
    }
  }

  /**
   * Remove a probe from a net.
   * @param {string} netId
   */
  removeProbe(netId) {
    this._probes.delete(netId);
  }

  /**
   * Get the recorded waveform for a probed net.
   * @param {string} netId
   * @returns {Array<{tNs: bigint, v: number}>}
   */
  getProbeData(netId) {
    return this._probes.get(netId) ?? [];
  }

  /**
   * Get all active probe net IDs.
   * @returns {string[]}
   */
  getProbes() {
    return [...this._probes.keys()];
  }

  /** Clear all probe data without removing probes. */
  clearProbeData() {
    for (const [, data] of this._probes) {
      data.length = 0;
    }
  }

  // ─── Scope channels ────────────────────────────────────────────────────

  /**
   * Attach a scope channel with fixed sim-time cadence and (min,max) decimation.
   *
   * @param {object} opts
   * @param {'voltage' | 'current'} opts.type - Channel type
   * @param {string} [opts.netId] - Net to probe (for voltage channels)
   * @param {string} [opts.partId] - Part to probe (for current channels)
   * @param {string} [opts.terminal] - Terminal to probe (for current channels)
   * @param {number} [opts.sampleRateHz=100000] - Sim-time sample rate
   * @param {number} [opts.depth=8192] - Ring buffer depth in (min,max) pairs
   * @returns {number} Channel handle
   */
  addScopeChannel(opts) {
    const handle = this._nextScopeHandle++;
    const sampleRateHz = opts.sampleRateHz ?? 100_000;
    const depth = opts.depth ?? 8192;
    const intervalNs = BigInt(Math.round(1e9 / sampleRateHz));

    const ch = {
      type: opts.type,
      netId: opts.netId ?? null,
      partId: opts.partId ?? null,
      terminal: opts.terminal ?? null,
      sampleRateHz,
      intervalNs,
      depth,
      // Ring buffer: interleaved [min0, max0, min1, max1, ...]
      // Unwritten regions are NaN, never flat 0 — per boundary-B v2.
      samples: new Float64Array(depth * 2).fill(NaN),
      writeIndex: 0,     // next write position (in pairs, 0..depth-1)
      count: 0,          // how many pairs have been written total
      startTNs: 0n,      // sim-time of the oldest sample in the buffer
      // For voltage channels: track running (min, max) within current bucket
      _bucketMin: Infinity,
      _bucketMax: -Infinity,
      _nextSampleNs: this.timeNs + intervalNs, // next sample point
    };

    this._scopeChannels.set(handle, ch);
    return handle;
  }

  /**
   * Remove a scope channel.
   * @param {number} handle
   */
  removeScopeChannel(handle) {
    this._scopeChannels.delete(handle);
  }

  /** Remove all scope channels. */
  clearScopeChannels() {
    this._scopeChannels.clear();
  }

  /**
   * Get the waveform data for a scope channel.
   * @param {number} handle
   * @returns {{samples: Float64Array, startTNs: bigint, sampleIntervalNs: bigint,
   *            writeIndex: number, count: number, channelType: string} | null}
   */
  getScopeData(handle) {
    const ch = this._scopeChannels.get(handle);
    if (!ch) return null;
    return {
      samples: ch.samples,
      startTNs: ch.startTNs,
      sampleIntervalNs: ch.intervalNs,
      writeIndex: ch.writeIndex,
      count: ch.count,
      channelType: ch.type,
    };
  }

  /**
   * Sample all current-type scope channels once (call from display loop, ~60 Hz).
   * Returns a Map of handle → instantaneous current.
   * @returns {Map<number, number>}
   */
  sampleCurrentChannels() {
    const results = new Map();
    for (const [handle, ch] of this._scopeChannels) {
      if (ch.type !== 'current') continue;
      const current = this.branchCurrent(ch.partId, ch.terminal);
      // Write into ring buffer as a single (min=max=current) pair
      const idx = ch.writeIndex * 2;
      ch.samples[idx] = current;
      ch.samples[idx + 1] = current;
      ch.writeIndex = (ch.writeIndex + 1) % ch.depth;
      ch.count++;
      if (ch.count > ch.depth) {
        ch.startTNs += ch.intervalNs;
      }
      results.set(handle, current);
    }
    return results;
  }

  /**
   * Get all active scope channel handles.
   * @returns {number[]}
   */
  getScopeChannels() {
    return [...this._scopeChannels.keys()];
  }

  /**
   * Update scope channel min/max with current voltages (no flush).
   * Called from setPin/setControl to capture intra-bucket voltage changes.
   * @private
   */
  _feedScopeVoltages() {
    for (const [, ch] of this._scopeChannels) {
      if (ch.type !== 'voltage') continue;
      const v = this.nodeVoltages.get(ch.netId) ?? 0;
      const val = Number.isFinite(v) ? v : 0;
      if (val < ch._bucketMin) ch._bucketMin = val;
      if (val > ch._bucketMax) ch._bucketMax = val;
    }
  }

  /**
   * Feed the current voltage into scope voltage channels.
   * Called from advanceTo when time crosses sample boundaries.
   * @private
   */
  _updateScopeChannels(tNs) {
    for (const [, ch] of this._scopeChannels) {
      if (ch.type !== 'voltage') continue;

      // Get current voltage
      const v = this.nodeVoltages.get(ch.netId) ?? 0;
      const val = Number.isFinite(v) ? v : 0;

      // Track running min/max for this bucket
      if (val < ch._bucketMin) ch._bucketMin = val;
      if (val > ch._bucketMax) ch._bucketMax = val;

      // Flush completed buckets
      while (tNs >= ch._nextSampleNs) {
        const idx = ch.writeIndex * 2;
        ch.samples[idx] = ch._bucketMin;
        ch.samples[idx + 1] = ch._bucketMax;
        ch.writeIndex = (ch.writeIndex + 1) % ch.depth;
        ch.count++;

        // Update start time when buffer wraps
        if (ch.count > ch.depth) {
          ch.startTNs = ch._nextSampleNs - ch.intervalNs * BigInt(ch.depth - 1);
        } else if (ch.count === 1) {
          ch.startTNs = ch._nextSampleNs - ch.intervalNs;
        }

        ch._nextSampleNs += ch.intervalNs;
        // Reset bucket for next interval
        ch._bucketMin = val;
        ch._bucketMax = val;
      }
    }
  }

  /**
   * @param {string} partId
   * @param {string} terminal
   * @returns {number}
   */
  branchCurrent(partId, terminal) {
    if (!this.powered) return 0; // no current without power

    // Cache the MNA result — only re-solve when the state has changed.
    // The cache is invalidated by _solve() (called by setPin, setControl,
    // setPower, setNetlist).
    if (!this._mnaCache) {
      this._mnaCache = this._solveMNA(false);
    }
    const partCurrents = this._mnaCache.branchCurrents.get(partId);
    if (!partCurrents) return 0;
    const i = partCurrents.get(terminal) ?? 0;
    return Number.isFinite(i) ? i : 0;
  }

  /**
   * @param {string} a
   * @param {string} b
   * @returns {number | 'requires-power-off'}
   */
  resistance(a, b) {
    if (this.powered) return 'requires-power-off';

    const testCurrent = 0.001; // 1 mA test current
    // testNodeB is used as the reference (V=0), so R = V_A / I_test
    const result = this._solveMNA(true, a, b, testCurrent);
    const vA = result.nodeVoltages.get(a) ?? 0;
    const r = Math.abs(vA) / testCurrent;
    return Number.isFinite(r) ? r : 0;
  }

  // ─── Boundary B: transducers ─────────────────────────────────────────────

  /**
   * @param {string} partId
   * @returns {number} 0…1
   */
  ledBrightness(partId) {
    const history = this.ledHistory.get(partId);
    if (!history || history.length === 0) return 0;

    const now = this.timeNs;
    const windowStart = now > BRIGHTNESS_WINDOW_NS ? now - BRIGHTNESS_WINDOW_NS : 0n;

    // Find the most recent sample at or before windowStart (the "initial" value
    // for the window), plus all samples within the window.
    let initialCurrent = 0;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].tNs <= windowStart) {
        initialCurrent = history[i].current;
        break;
      }
    }

    // Build the step function over [windowStart, now].
    // Each segment holds a constant current until the next change.
    /** @type {Array<{tNs: bigint, current: number}>} */
    const steps = [];

    // Start of window: either the initial sample's value or 0
    steps.push({ tNs: windowStart, current: initialCurrent });

    // Add all samples within the window
    for (const s of history) {
      if (s.tNs > windowStart && s.tNs <= now) {
        steps.push(s);
      }
    }

    // Integrate the step function
    const windowNs = now - windowStart;
    if (windowNs <= 0n) {
      // Time hasn't advanced — return instantaneous value
      const last = history[history.length - 1];
      return Math.min(1, Math.max(0, last.current / LED_I_RATED));
    }

    let weightedSum = 0;
    for (let i = 0; i < steps.length; i++) {
      const nextT = i + 1 < steps.length ? steps[i + 1].tNs : now;
      const dt = nextT - steps[i].tNs;
      weightedSum += steps[i].current * Number(dt);
    }

    const avgCurrent = weightedSum / Number(windowNs);
    return Math.min(1, Math.max(0, avgCurrent / LED_I_RATED));
  }

  /**
   * @param {string} partId
   * @returns {{hz: number, on: boolean}}
   */
  buzzerTone(partId) {
    const edges = this.buzzerEdges.get(partId);
    if (!edges || edges.length < 2) return { hz: 0, on: false };

    // Measure period from the last two edges
    const last = edges[edges.length - 1];
    const prev = edges[edges.length - 2];
    const halfPeriodNs = Number(last - prev);
    if (halfPeriodNs <= 0) return { hz: 0, on: false };

    // Staleness check: if the last edge is more than 100ms ago,
    // the buzzer has stopped toggling (e.g., after a debug halt).
    // Report as off rather than a meaninglessly low frequency.
    const age = this.timeNs - last;
    if (age > 100_000_000n) return { hz: 0, on: false };

    const hz = 1e9 / (2 * halfPeriodNs); // two edges = one full period
    return { hz, on: true };
  }

  /**
   * Seven-segment display brightness: returns brightness for each segment.
   * The display part has terminals: a, b, c, d, e, f, g, dp, common.
   * Each segment is an LED between its terminal and the common terminal.
   *
   * @param {string} partId
   * @returns {{ a: number, b: number, c: number, d: number, e: number, f: number, g: number, dp: number }}
   */
  sevenSegmentBrightness(partId) {
    const result = { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0, g: 0, dp: 0 };
    const segments = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp'];
    for (const seg of segments) {
      const ledId = `${partId}_${seg}`;
      result[seg] = this.ledBrightness(ledId);
    }
    return result;
  }

  /**
   * RGB LED brightness: returns brightness for each channel.
   * The part has terminals: r, g, b, common.
   *
   * @param {string} partId
   * @returns {{ r: number, g: number, b: number }}
   */
  rgbLedBrightness(partId) {
    return {
      r: this.ledBrightness(`${partId}_r`),
      g: this.ledBrightness(`${partId}_g`),
      b: this.ledBrightness(`${partId}_b`),
    };
  }

  /**
   * LED cube voxel brightness: POV-integrated over ~20ms.
   *
   * A voxel is lit when its layer select is active AND its column data
   * bit is active. Polarity is a parameter: 'active-high' (default)
   * means a pin HIGH lights the voxel; 'active-low' means pin LOW does.
   *
   * Returns a flat array of brightness values [0..1] for all voxels,
   * in layer-major order: [layer0_col0, layer0_col1, ..., layer3_col15].
   *
   * @param {string} partId
   * @returns {number[]}
   */
  cubeBrightness(partId) {
    const cube = this._cubes.get(partId);
    if (!cube) return [];

    const { layers, cols, history } = cube;
    const total = layers * cols;
    const result = new Array(total).fill(0);

    const now = this.timeNs;
    const windowStart = now > BRIGHTNESS_WINDOW_NS ? now - BRIGHTNESS_WINDOW_NS : 0n;
    const windowNs = now - windowStart;
    if (windowNs <= 0n) return result;

    // Find initial state before window
    let initialMask = 0n;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i].tNs <= windowStart) {
        initialMask = history[i].litMask;
        break;
      }
    }

    // Build step function over the window
    /** @type {Array<{tNs: bigint, mask: bigint}>} */
    const steps = [{ tNs: windowStart, mask: initialMask }];
    for (const s of history) {
      if (s.tNs > windowStart && s.tNs <= now) {
        steps.push({ tNs: s.tNs, mask: s.litMask });
      }
    }

    // Integrate each voxel's lit time
    for (let i = 0; i < steps.length; i++) {
      const nextT = i + 1 < steps.length ? steps[i + 1].tNs : now;
      const dt = Number(nextT - steps[i].tNs);
      const mask = steps[i].mask;

      for (let v = 0; v < total; v++) {
        if ((mask >> BigInt(v)) & 1n) {
          result[v] += dt;
        }
      }
    }

    // Normalize to 0..1
    const windowF = Number(windowNs);
    for (let v = 0; v < total; v++) {
      result[v] = Math.min(1, result[v] / windowF);
    }

    return result;
  }

  /**
   * Update cube voxel state from current pin states.
   * Called from advanceTo after pin state changes.
   * @param {string} partId
   */
  _updateCube(partId) {
    const cube = this._cubes.get(partId);
    if (!cube) return;

    const part = this.partMap.get(partId);
    if (!part) return;

    const { layers, cols, polarity, history } = cube;
    const activeHigh = polarity !== 'active-low';

    // Read select and data pin states from the part's params
    const selectPins = /** @type {string[]} */ (part.params.selectPins ?? []);
    const dataPins = /** @type {string[]} */ (part.params.dataPins ?? []);

    let litMask = 0n;

    for (let layer = 0; layer < layers && layer < selectPins.length; layer++) {
      const selState = this.pinStates.get(selectPins[layer]);
      if (!selState) continue;

      const selActive = activeHigh ? selState.driveHigh : !selState.driveHigh;
      if (!selActive) continue;

      for (let col = 0; col < cols && col < dataPins.length; col++) {
        const dataState = this.pinStates.get(dataPins[col]);
        if (!dataState) continue;

        const dataActive = activeHigh ? dataState.driveHigh : !dataState.driveHigh;
        if (dataActive) {
          litMask |= 1n << BigInt(layer * cols + col);
        }
      }
    }

    // Record only if changed
    const last = history.length > 0 ? history[history.length - 1] : null;
    if (!last || last.litMask !== litMask) {
      history.push({ tNs: this.timeNs, litMask });

      // Prune when large
      if (history.length > 200) {
        const windowStart = this.timeNs > BRIGHTNESS_WINDOW_NS
          ? this.timeNs - BRIGHTNESS_WINDOW_NS : 0n;
        let keepIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].tNs <= windowStart) { keepIdx = i; break; }
        }
        if (keepIdx > 0) history.splice(0, keepIdx);
      }
    }
  }

  // ─── Boundary B: user interaction ────────────────────────────────────────

  /**
   * @param {string} partId
   * @param {number} value
   */
  setControl(partId, value) {
    this.controls.set(partId, value);
    this._solve();
    this._notifyChange('control', { partId, value });
  }

  /**
   * @param {boolean} on
   */
  setPower(on) {
    this.powered = on;
    this._solve();
    this._recordLedSamples();
    this._notifyChange('power', { on });
  }

  // ─── Internal: inductor integration ───────────────────────────────────────

  /**
   * Integrate inductor currents using backward Euler companion model.
   * V = L · dI/dt → I_new = I_old + (V_across / L) · dt
   *
   * At each step, the inductor acts like a current source (I_old) in
   * parallel with a conductance (dt/L). For the closed-form path, we
   * compute the voltage across the inductor from the surrounding network
   * and update the current.
   *
   * @param {number} dtSec
   */
  _integrateInductors(dtSec) {
    if (dtSec <= 0) return;

    for (const part of this.parts) {
      if (part.kind !== 'inductor') continue;

      const henrys = /** @type {number} */ (part.params.henrys ?? 0.01);
      if (henrys <= 0) continue;

      const netA = this._netForTerminal(part.id, 'a');
      const netB = this._netForTerminal(part.id, 'b');
      if (!netA || !netB) continue;

      const vA = this.nodeVoltages.get(netA) ?? 0;
      const vB = this.nodeVoltages.get(netB) ?? 0;
      const vAcross = vA - vB;

      // Backward Euler: I_new = I_old + (V / L) × dt
      const iOld = this.inductorCurrents.get(part.id) ?? 0;
      const iNew = iOld + (vAcross / henrys) * dtSec;

      this.inductorCurrents.set(part.id, iNew);
    }
  }

  // ─── State getters ───────────────────────────────────────────────────────

  /** Current simulation time in nanoseconds. @returns {bigint} */
  getTime() { return this.timeNs; }

  /** Whether the board is powered. @returns {boolean} */
  isPowered() { return this.powered; }

  /** Supply voltage. @returns {number} */
  getVcc() { return this.vcc; }

  /**
   * Current state of an MCU pin.
   * @param {PinId} pin
   * @returns {{ mode: PinMode, driveHigh: boolean } | null}
   */
  getPinState(pin) {
    const s = this.pinStates.get(pin);
    return s ? { mode: s.mode, driveHigh: s.driveHigh } : null;
  }

  /**
   * Current value of a user control (pot position, button state).
   * @param {string} partId
   * @returns {number | undefined}
   */
  getControl(partId) {
    return this.controls.get(partId);
  }

  /**
   * Current voltage across a capacitor.
   * @param {string} partId
   * @returns {number}
   */
  getCapVoltage(partId) {
    return this.capVoltages.get(partId) ?? 0;
  }

  /**
   * Current through an inductor (DC steady-state).
   * @param {string} partId
   * @returns {number}
   */
  getInductorCurrent(partId) {
    return this.inductorCurrents.get(partId) ?? 0;
  }

  // ─── Part queries ───────────────────────────────────────────────────────

  /** All parts in the current netlist. @returns {Part[]} */
  getParts() { return this.parts; }

  /** All nets in the current netlist. @returns {Net[]} */
  getNets() { return this.nets; }

  /**
   * Get the expected terminal names for a part kind.
   * Returns null for MCU (terminals are PinIds) and composites.
   * Useful for the UI inspector panel.
   *
   * @param {string} kind
   * @returns {string[] | null}
   */
  static getTerminalsForKind(kind) {
    const map = {
      vcc: ['vcc'], gnd: ['gnd'],
      resistor: ['a', 'b'], capacitor: ['a', 'b'], inductor: ['a', 'b'],
      diode: ['anode', 'cathode'], led: ['anode', 'cathode'],
      zener: ['anode', 'cathode'],
      potentiometer: ['a', 'b', 'wiper'],
      button: ['a', 'b'], switch: ['a', 'b'],
      buzzer: ['a', 'b'], ldr: ['a', 'b'], ntc: ['a', 'b'],
      npn: ['base', 'collector', 'emitter'],
      pnp: ['base', 'collector', 'emitter'],
      nmos: ['gate', 'drain', 'source'],
      pmos: ['gate', 'drain', 'source'],
      opamp: ['inp', 'inn', 'out'],
      vsource: ['pos', 'neg'],
      isource: ['pos', 'neg'],
      ir_receiver: ['vcc', 'gnd', 'out'],
      temp_sensor: ['vcc', 'gnd', 'dq'],
      eeprom: ['sda', 'scl', 'vcc', 'gnd'],
      shift_register: ['data', 'clock', 'latch', 'oe', 'q0', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'],
      char_lcd: ['rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'vcc', 'gnd', 'vo', 'bl_a', 'bl_k'],
      // Device-registry kinds
      gate_and: ['in0', 'in1', 'out'],
      gate_or: ['in0', 'in1', 'out'],
      gate_not: ['in0', 'out'],
      gate_nand: ['in0', 'in1', 'out'],
      gate_nor: ['in0', 'in1', 'out'],
      gate_xor: ['in0', 'in1', 'out'],
      relay: ['coil_a', 'coil_b', 'com', 'nc', 'no'],
      dc_motor: ['a', 'b'],
      servo: ['signal', 'vcc', 'gnd'],
      timer_555: ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'],
    };
    return map[kind] ?? null;
  }

  /**
   * Get all known part kinds.
   * @returns {string[]}
   */
  static getPartKinds() {
    return [
      'vcc', 'gnd', 'resistor', 'capacitor', 'inductor',
      'diode', 'led', 'zener', 'potentiometer',
      'button', 'switch', 'buzzer', 'ldr', 'ntc',
      'npn', 'pnp', 'nmos', 'pmos', 'opamp',
      'vsource', 'isource', 'seven_segment', 'rgb_led',
      'shift_register', 'char_lcd', 'led_matrix', 'led_cube',
      'ir_receiver', 'temp_sensor', 'eeprom', 'mcu',
      // Device-registry kinds (registered at runtime, listed here for discovery)
      'gate_and', 'gate_or', 'gate_not', 'gate_nand', 'gate_nor', 'gate_xor',
      'relay', 'dc_motor', 'servo', 'timer_555',
      'battery', 'vreg', 'fuse',
      'h_bridge', 'stepper', 'solenoid',
      'ultrasonic', 'pir', 'tilt_sensor', 'flex_sensor', 'force_sensor', 'phototransistor',
      'neopixel', 'bargraph',
      'decade_counter', 'dff', 'jkff', 'darlington_driver', 'piezo',
      // Analog ICs + discrete
      'tip120', 'lm393', 'tmp36', 'light_bulb', 'optocoupler',
      // Real DIP chips (chip-composer)
      '74hc00', '74hc02', '74hc04', '74hc08', '74hc10', '74hc11', '74hc14',
      '74hc20', '74hc21', '74hc27', '74hc32', '74hc73', '74hc74', '74hc86',
      '74hc93', '74hc132', 'cd4511',
      // Misc parts
      'dc_motor_encoder', 'keypad_4x4', 'dip_switch', 'vibration_motor', 'polarized_cap',
      // Named variants (real part numbers)
      'battery_9v', 'battery_aa', 'battery_coin', 'lm7805', 'ld1117v33',
      'gas_sensor', 'ambient_light', 'ir_transmitter',
      '74hc95', 'lm339', 'timer_556',
      // Tier 1 catalogue parts
      'photodiode', 'soil_moisture', 'relay_dpdt', 'solar_cell', 'gearmotor',
      '74hc75', '74hc283', 'header', 'usb_a', 'ir_remote', 'clock_display',
      'pcf8574', 'char_lcd_i2c',
    ];
  }

  /** All LED part IDs. @returns {string[]} */
  getLeds() { return this.parts.filter(p => p.kind === 'led').map(p => p.id); }

  /** All buzzer part IDs. @returns {string[]} */
  getBuzzers() { return this.parts.filter(p => p.kind === 'buzzer').map(p => p.id); }

  /**
   * All controllable parts: pots, buttons, switches, LDRs, NTCs.
   * @returns {Array<{id: string, kind: string, value: number}>}
   */
  getControls() {
    const controllable = ['potentiometer', 'button', 'switch', 'ldr', 'ntc'];
    return this.parts
      .filter(p => controllable.includes(p.kind))
      .map(p => ({ id: p.id, kind: p.kind, value: this.controls.get(p.id) ?? 0 }));
  }

  /**
   * Get the state of a registered device or built-in shift register.
   * Returns the device's internal state object (drives, FSM state, etc.)
   * or null if the part has no device state.
   *
   * For shift registers: { shiftReg, latchReg, oeActive }
   * For registry devices: whatever the model's init() returned + mutations
   *
   * @param {string} partId
   * @returns {object | null}
   */
  getDeviceState(partId) {
    // Built-in shift register
    const sr = this._shiftRegisters.get(partId);
    if (sr) return { shiftReg: sr.shiftReg, latchReg: sr.latchReg, oeActive: sr.oeActive ?? true };
    // Registry devices
    return this._deviceStates.get(partId) ?? null;
  }

  /**
   * All MCU pin IDs currently tracked.
   * @returns {Array<{pin: string, mode: string, driveHigh: boolean}>}
   */
  getPinStates() {
    return [...this.pinStates.entries()].map(([pin, s]) => ({
      pin, mode: s.mode, driveHigh: s.driveHigh,
    }));
  }

  // ─── Change notification ────────────────────────────────────────────────

  /**
   * Register a callback for board state changes.
   * Called after every setPin, setControl, setPower, advanceTo, and setNetlist.
   *
   * @param {(event: {type: string, detail?: any}) => void} fn
   */
  onChange(fn) {
    if (!this._changeListeners) this._changeListeners = [];
    this._changeListeners.push(fn);
  }

  /**
   * Remove a previously registered change listener.
   * @param {(event: {type: string, detail?: any}) => void} fn
   */
  offChange(fn) {
    if (!this._changeListeners) return;
    this._changeListeners = this._changeListeners.filter(f => f !== fn);
  }

  /** @param {string} type @param {any} [detail] */
  _notifyChange(type, detail) {
    if (!this._changeListeners) return;
    const event = { type, detail };
    for (const fn of this._changeListeners) {
      try { fn(event); } catch { /* listener error must not break the board */ }
    }
  }

  // ─── Circuit warnings ──────────────────────────────────────────────────

  /**
   * Check the circuit for potential problems: overcurrent, missing
   * ground path, LED without resistor, etc.
   *
   * @returns {Array<{severity: 'warning' | 'danger', partId?: string, message: string}>}
   */
  getWarnings() {
    /** @type {Array<{severity: 'warning' | 'danger', partId?: string, message: string}>} */
    const warnings = [];

    if (!this.powered) return warnings;

    // Device sub-step overflow: advanceTo hit the cap on device sub-steps.
    if (this._deviceSubstepOverflow) {
      warnings.push({
        severity: 'warning',
        message: 'Device sub-step limit reached — some timed transitions may have been ' +
          'skipped. This happens when many device deadlines fall within one advanceTo interval.',
      });
    }

    // Non-convergence: the solver could not find a consistent operating point.
    // This is a RESULT, not an error — the UI can render "circuit did not settle".
    if (this._lastSolveConverged === false) {
      warnings.push({
        severity: 'danger',
        message: 'Circuit did not converge — voltages shown are approximate. ' +
          'This can happen with circuits that have no stable operating point.',
      });
    }

    for (const part of this.parts) {
      if (part.kind === 'led') {
        // Use closed-form current if available, fall back to MNA
        let current = this.ledCurrents.get(part.id) ?? 0;
        if (current === 0) {
          try { current = this.branchCurrent(part.id, 'anode'); } catch {}
        }
        if (current > 0.025) { // > 25 mA
          warnings.push({
            severity: 'danger',
            partId: part.id,
            message: `${part.id}: current ${(current * 1000).toFixed(1)} mA exceeds 20 mA rating. Add or increase the series resistor.`,
          });
        }
      }

      // Check for MCU pins driving into VCC or GND directly (short circuit)
      if (part.kind === 'mcu') {
        for (const terminal of part.terminals) {
          const state = this.pinStates.get(terminal);
          if (!state || state.mode === 'input') continue;

          // Find the net this pin is on
          const net = this.nets.find(n => n.terminals.some(
            t => t.part === part.id && t.terminal === terminal
          ));
          if (!net) continue;

          // Check if this net is directly connected to VCC or GND
          for (const t of net.terminals) {
            if (t.part === part.id) continue;
            const other = this.partMap.get(t.part);
            if (!other) continue;
            if (other.kind === 'vcc' && state.mode !== 'input' && !state.driveHigh) {
              warnings.push({
                severity: 'danger',
                partId: part.id,
                message: `${terminal}: pin drives LOW but is wired directly to VCC. This is a short circuit.`,
              });
            }
            if (other.kind === 'gnd' && state.mode !== 'input' && state.driveHigh && state.mode === 'pushpull') {
              warnings.push({
                severity: 'danger',
                partId: part.id,
                message: `${terminal}: pin drives HIGH but is wired directly to GND. This is a short circuit.`,
              });
            }
          }
        }
      }
    }

    // Check for LED wired backward (cathode to VCC, anode to GND)
    for (const part of this.parts) {
      if (part.kind !== 'led') continue;
      const anodeNet = this._netForTerminal(part.id, 'anode');
      const cathodeNet = this._netForTerminal(part.id, 'cathode');
      if (!anodeNet || !cathodeNet) continue;

      const anodeV = this.nodeVoltages.get(anodeNet) ?? 0;
      const cathodeV = this.nodeVoltages.get(cathodeNet) ?? 0;
      if (cathodeV > anodeV + 0.5) {
        warnings.push({
          severity: 'warning',
          partId: part.id,
          message: `${part.id}: LED appears to be wired backward (cathode at ${cathodeV.toFixed(1)}V > anode at ${anodeV.toFixed(1)}V). Swap anode and cathode.`,
        });
      }
    }

    // Check for output pins with nothing connected
    for (const part of this.parts) {
      if (part.kind !== 'mcu') continue;
      for (const terminal of part.terminals) {
        const state = this.pinStates.get(terminal);
        if (!state || state.mode === 'input') continue;

        const net = this.nets.find(n => n.terminals.some(
          t => t.part === part.id && t.terminal === terminal
        ));
        if (!net) continue;

        // Check if this pin's net has only the MCU terminal (nothing else connected)
        const externalTerminals = net.terminals.filter(t => t.part !== part.id);
        if (externalTerminals.length === 0) {
          warnings.push({
            severity: 'warning',
            partId: part.id,
            message: `${terminal}: output pin is driving but nothing is connected to it.`,
          });
        }
      }
    }

    // Note: drawable-only parts have minimal electrical models (supply
    // current + input impedance) but no functional simulation. The part
    // loads the net correctly but its behavior is not modeled.
    // This is stated honestly rather than hidden.

    return warnings;
  }

  // ─── UI render state ─────────────────────────────────────────────────────

  /**
   * Get everything the UI needs to render the current board state in one call.
   * Avoids the UI having to make 20+ individual queries per frame.
   *
   * @returns {{
   *   powered: boolean,
   *   timeNs: bigint,
   *   vcc: number,
   *   leds: Array<{id: string, brightness: number, color?: string}>,
   *   buzzers: Array<{id: string, hz: number, on: boolean}>,
   *   controls: Array<{id: string, kind: string, value: number}>,
   *   pins: Array<{pin: string, mode: string, driveHigh: boolean}>,
   *   warnings: Array<{severity: string, partId?: string, message: string}>,
   *   nodeVoltages: Array<{net: string, voltage: number}>,
   *   capacitors: Array<{id: string, voltage: number}>,
   * }}
   */
  getRenderState() {
    return {
      powered: this.powered,
      timeNs: this.timeNs,
      vcc: this.vcc,
      leds: this.parts
        .filter(p => p.kind === 'led')
        .map(p => ({
          id: p.id,
          brightness: this.ledBrightness(p.id),
          color: /** @type {string | undefined} */ (p.params.color),
        })),
      buzzers: this.parts
        .filter(p => p.kind === 'buzzer')
        .map(p => ({ id: p.id, ...this.buzzerTone(p.id) })),
      controls: this.getControls(),
      pins: this.getPinStates(),
      warnings: this.getWarnings(),
      nodeVoltages: this.nets.map(n => ({
        net: n.id,
        voltage: this.nodeVoltage(n.id),
      })),
      capacitors: this.parts
        .filter(p => p.kind === 'capacitor')
        .map(p => ({ id: p.id, voltage: this.getCapVoltage(p.id) })),
    };
  }

  // ─── Reset ──────────────────────────────────────────────────────────────

  /**
   * Reset simulation state without changing the netlist.
   * Clears pin states, time, capacitor voltages, LED history, buzzer edges.
   * Parts, nets, and controls are preserved.
   */
  reset() {
    this.pinStates.clear();
    this.timeNs = 0n;
    this.capVoltages.clear();
    this.ledHistory.clear();
    this.buzzerEdges.clear();
    this.nodeVoltages.clear();
    this.ledCurrents.clear();
    this.inductorCurrents.clear();

    // Re-initialize cap voltages and LED/buzzer tracking
    for (const p of this.parts) {
      if (p.kind === 'led') this.ledHistory.set(p.id, []);
      if (p.kind === 'buzzer') this.buzzerEdges.set(p.id, []);
      if (p.kind === 'capacitor') this.capVoltages.set(p.id, 0);
    }

    this._solve();
    this._recordLedSamples();
    this._notifyChange('reset');
  }

  // ─── State snapshot ─────────────────────────────────────────────────────

  /**
   * Take a snapshot of the current board state for save/undo.
   * @returns {object}
   */
  snapshot() {
    return {
      timeNs: this.timeNs,
      powered: this.powered,
      pinStates: new Map(this.pinStates),
      controls: new Map(this.controls),
      capVoltages: new Map(this.capVoltages),
      inductorCurrents: new Map(this.inductorCurrents),
    };
  }

  /**
   * Restore a previously taken snapshot.
   * @param {object} snap
   */
  restore(snap) {
    this.timeNs = snap.timeNs;
    this.powered = snap.powered;
    this.pinStates = new Map(snap.pinStates);
    this.controls = new Map(snap.controls);
    this.capVoltages = new Map(snap.capVoltages);
    this.inductorCurrents = new Map(snap.inductorCurrents ?? []);

    // Re-initialize LED/buzzer tracking
    this.ledHistory.clear();
    this.buzzerEdges.clear();
    for (const p of this.parts) {
      if (p.kind === 'led') this.ledHistory.set(p.id, []);
      if (p.kind === 'buzzer') this.buzzerEdges.set(p.id, []);
    }

    this._solve();
    this._recordLedSamples();
    this._notifyChange('restore');
  }

  // ─── Internal: MNA solver bridge ──────────────────────────────────────────

  /**
   * Run the MNA solver on the current netlist.
   * @param {boolean} powerOff - if true, omit active sources (for resistance)
   * @param {string} [testNodeA] - inject test current from this net
   * @param {string} [testNodeB] - inject test current to this net
   * @param {number} [testCurrent] - test current magnitude
   */
  _solveMNA(powerOff, testNodeA, testNodeB, testCurrent) {
    return solveMNA(this.parts, this.nets, this._pinSources(), this.controls, this.vcc, {
      powerOff,
      testNodeA,
      testNodeB,
      testCurrent,
      // Instruments must see the circuit as it IS: a half-charged capacitor
      // pins its nets at its stored voltage, and a waveform source is at its
      // value for the current simulation time.
      capVoltages: this.capVoltages,
      tSeconds: Number(this.timeNs) / 1e9,
      deviceStates: this._deviceStates,
    });
  }

  /** Build the pin source map from current pin states. */
  _pinSources() {
    /** @type {Map<string, import('./types.js').TheveninSource>} */
    const pinSources = new Map();
    for (const [pinId, state] of this.pinStates) {
      pinSources.set(pinId, pinThevenin(state.mode, state.driveHigh, this.vcc));
    }
    return pinSources;
  }

  /**
   * Does this netlist contain parts the closed-form walker cannot represent?
   * If so, node voltages must come from the full MNA solve — the walker would
   * silently report voltages as if those parts were absent, which is the
   * "plausible, wrong" answer this project's doctrine forbids.
   */
  _needsMNA() {
    for (const p of this.parts) {
      if (MNA_ONLY_KINDS.has(p.kind) || getDevice(p.kind)) return true;
    }
    return false;
  }

  /** Any capacitor or inductor present? */
  _hasReactive() {
    for (const p of this.parts) {
      if (p.kind === 'capacitor' || p.kind === 'inductor') return true;
    }
    return false;
  }

  /** Any source whose value moves with time? */
  _hasTimeVaryingSource() {
    for (const p of this.parts) {
      if (p.kind === 'vsource' && p.params && p.params.wave && p.params.wave !== 'dc') {
        return true;
      }
    }
    return false;
  }

  /**
   * Full-MNA instantaneous solve: node voltages, LED currents and the
   * instrument cache all come from one solution.
   */
  _solveViaMNA() {
    let res = this._solveMNA(false);
    this._adoptSolution(res);
    // Devices react to the solved voltages (a gate sees its input change),
    // may change what they drive, and the network is re-solved — to a
    // bounded fixpoint, so a chain of gates settles within one event.
    for (let round = 0; round < 10; round++) {
      if (!this._updateDevices()) break;
      res = this._solveMNA(false);
      this._adoptSolution(res);
    }
  }

  /** Adopt an MNA solution as the board's current answer. */
  _adoptSolution(res) {
    this.nodeVoltages = new Map(res.nodeVoltages);
    for (const part of this.parts) {
      if (part.kind !== 'led') continue;
      const c = res.branchCurrents.get(part.id);
      this.ledCurrents.set(part.id, Math.max(0, c ? (c.get('anode') ?? 0) : 0));
    }
    this._mnaCache = res;
    // Track non-convergence — a solver that cannot converge must say so.
    // Returning the last iterate as if it were an answer is the numerical
    // form of the silent-degradation bug.
    this._lastSolveConverged = res.converged !== false;
  }

  /**
   * Find the earliest device deadline strictly after `afterNs` and at or before `beforeNs`.
   * Returns the deadline bigint, or null if no deadline exists in that range.
   *
   * Devices with deadlines: relay (_pendingState.deadlineNs), ultrasonic (_echoEndNs).
   * Continuous devices (motor, servo, encoder) use a max sub-step interval instead.
   */
  _earliestDeviceDeadline(afterNs, beforeNs) {
    let earliest = null;

    // Check registry device states for known deadline fields
    for (const [, state] of this._deviceStates) {
      // Relay-style deadline
      if (state._pendingState && state._pendingState.deadlineNs > afterNs &&
          state._pendingState.deadlineNs <= beforeNs) {
        if (earliest === null || state._pendingState.deadlineNs < earliest) {
          earliest = state._pendingState.deadlineNs;
        }
      }
      // Ultrasonic echo end
      if (state._measuring && state._echoEndNs > afterNs &&
          state._echoEndNs <= beforeNs) {
        if (earliest === null || state._echoEndNs < earliest) {
          earliest = state._echoEndNs;
        }
      }
    }

    // For continuous devices (motor, encoder, servo): impose a max sub-step
    // of 1ms so they don't lose resolution on long jumps.
    // Only if the interval is large enough to warrant sub-stepping.
    const MAX_DEVICE_INTERVAL = 1_000_000n; // 1ms
    if (beforeNs - afterNs > MAX_DEVICE_INTERVAL) {
      const periodicDeadline = afterNs + MAX_DEVICE_INTERVAL;
      if (periodicDeadline <= beforeNs) {
        if (earliest === null || periodicDeadline < earliest) {
          earliest = periodicDeadline;
        }
      }
    }

    return earliest;
  }

  /**
   * Update 74HC595 shift register FSMs. Returns true if any output changed.
   * Called from the settle loop alongside _updateDevices.
   */
  _updateShiftRegisters() {
    if (this._shiftRegisters.size === 0) return false;
    let changed = false;
    const VCC = this.vcc;
    const VIH = 0.7 * VCC;
    const VIL = 0.3 * VCC;

    for (const part of this.parts) {
      if (part.kind !== 'shift_register') continue;
      const sr = this._shiftRegisters.get(part.id);
      if (!sr) continue;

      const readV = (terminal) => {
        const n = this._netForTerminal(part.id, terminal);
        return n ? (this.nodeVoltages.get(n) ?? 0) : 0;
      };

      const dataV = readV('data');
      const clockV = readV('clock');
      const latchV = readV('latch');
      const oeV = readV('oe');

      const clockHigh = clockV > VIH;
      const latchHigh = latchV > VIH;
      const dataBit = dataV > VIH ? 1 : 0;
      const oeActive = oeV < VIL; // active LOW

      // Rising edge on clock: shift in data bit
      if (clockHigh && !sr.lastClock) {
        sr.shiftReg = ((sr.shiftReg << 1) | dataBit) & 0xFF;
      }
      sr.lastClock = clockHigh;

      // Rising edge on latch: copy shift to output
      if (latchHigh && !sr.lastLatch) {
        if (sr.latchReg !== sr.shiftReg) {
          sr.latchReg = sr.shiftReg;
          changed = true;
        }
      }
      sr.lastLatch = latchHigh;

      // Update output drives based on OE and latch contents
      // (This is read by the MNA via the closed-form or MNA solver)
      // We store the drive state for the solver to pick up
      sr.oeActive = oeActive;
    }
    return changed;
  }

  /** One update pass over all registered devices. True if any changed. */
  _updateDevices() {
    let changed = false;
    // Built-in shift registers
    if (this._shiftRegisters.size > 0) {
      if (this._updateShiftRegisters()) changed = true;
    }
    // Registry devices
    if (this._deviceStates.size === 0) return changed;
    for (const part of this.parts) {
      const model = getDevice(part.kind);
      if (!model || !model.update) continue;
      const state = this._deviceStates.get(part.id);
      const read = (terminal) => {
        const n = this._netForTerminal(part.id, terminal);
        return n ? (this.nodeVoltages.get(n) ?? 0) : 0;
      };
      if (model.update(part, state, read, this.timeNs)) changed = true;
    }
    return changed;
  }

  /**
   * Transient integration through MNA: sub-step backward Euler across dtSec,
   * carrying capacitor voltages and inductor currents forward. Used when
   * MNA-only parts coexist with reactive parts, or a waveform source runs —
   * the closed-form RC/RL integrators cannot see either.
   *
   * @param {number} dtSec
   */
  _integrateTransientMNA(dtSec) {
    const tEnd = Number(this.timeNs) / 1e9;
    const t0 = tEnd - dtSec;
    // Sub-step: 100 µs of simulated time, capped at 200 steps per call so a
    // long idle advance cannot stall the caller. Adaptive control can replace
    // this; the cap is a stated accuracy limit, not a hidden one.
    const SUB = 1e-4;
    let n = Math.max(1, Math.ceil(dtSec / SUB));
    if (n > 200) n = 200;
    const h = dtSec / n;

    const pinSources = this._pinSources();
    let cv = this.capVoltages;
    let il = this.inductorCurrents;
    let res = null;
    for (let i = 1; i <= n; i++) {
      res = solveMNA(this.parts, this.nets, pinSources, this.controls, this.vcc, {
        tSeconds: t0 + i * h,
        transient: { dtSec: h, capVoltages: cv, inductorCurrents: il },
        deviceStates: this._deviceStates,
      });
      cv = res.capVoltagesNext ?? cv;
      il = res.inductorCurrentsNext ?? il;
      // Every sub-step publishes its voltages and feeds the scope at its
      // intermediate timestamp. Without this, a waveform source sampled only
      // at advanceTo boundaries aliases to a flat line: a 50 ms tick is an
      // integer number of 1 kHz periods, so sin() is 0 at every boundary.
      this.nodeVoltages = new Map(res.nodeVoltages);
      if (this._scopeChannels.size > 0) {
        const stepNs = this.timeNs - BigInt(Math.round((n - i) * h * 1e9));
        this._updateScopeChannels(stepNs);
      }
      // One device pass per sub-step: a comparator/gate that flips here is
      // seen by the network on the NEXT sub-step — switching resolution is
      // one sub-step, which is the stated accuracy of this integrator.
      if (this._deviceStates.size > 0) {
        this.nodeVoltages = new Map(res.nodeVoltages);
        this._updateDevices();
      }
    }
    this.capVoltages = new Map(cv);
    this.inductorCurrents = new Map(il);
    if (res) {
      this.nodeVoltages = new Map(res.nodeVoltages);
      for (const part of this.parts) {
        if (part.kind !== 'led') continue;
        const c = res.branchCurrents.get(part.id);
        this.ledCurrents.set(part.id, Math.max(0, c ? (c.get('anode') ?? 0) : 0));
      }
      this._mnaCache = res;
    }
  }

  // ─── Internal: capacitor RC integration ───────────────────────────────────

  /**
   * Integrate capacitor voltages using closed-form RC step.
   * V += (Vt − V) · (1 − e^(−dt/RC))
   * where Vt is the target voltage from the driving source and RC is the
   * time constant.
   *
   * @param {number} dtSec - time step in seconds
   */
  _integrateCapacitors(dtSec) {
    // Temporarily strip cached voltages from non-ideal-source nets so
    // _gatherSources traces all the way to VCC/GND/pin Thévenins and
    // accumulates the real source impedance. Without this, a net like
    // "MCU quasi-high → 10kΩ pull-up net" gets cached as V=5V (correct)
    // but with implied R=0 (wrong — the quasi pin has 21.7kΩ behind it).
    const savedVoltages = new Map(this.nodeVoltages);
    const idealNets = new Set();
    for (const net of this.nets) {
      for (const t of net.terminals) {
        const p = this.partMap.get(t.part);
        if (p && (p.kind === 'vcc' || p.kind === 'gnd')) {
          idealNets.add(net.id);
        }
      }
    }
    // Keep only VCC/GND net voltages
    for (const [netId] of this.nodeVoltages) {
      if (!idealNets.has(netId)) {
        this.nodeVoltages.delete(netId);
      }
    }

    for (const part of this.parts) {
      if (part.kind !== 'capacitor') continue;

      const farads = /** @type {number} */ (part.params.farads ?? 0.0001);
      const netA = this._netForTerminal(part.id, 'a');
      const netB = this._netForTerminal(part.id, 'b');
      if (!netA || !netB) continue;

      // Use _gatherSources to find ALL Thévenin sources reaching each
      // terminal, including their series resistance. This is critical:
      // _traceToSource stops at cached node voltages and loses the source
      // impedance behind them (e.g., a quasi pin's 21.7kΩ behind a net
      // that _resolveNet cached as "5V").
      const aSources = this._gatherSources(netA);
      const bSources = this._gatherSources(netB);

      // Remove any sources from the cap's own side (avoid self-reference)
      // gatherSources already skips the cap because it doesn't trace
      // through capacitors.

      if (aSources.length === 0 && bSources.length === 0) continue;

      // Combine each side into a single Thévenin equivalent via Norton.
      const aThev = combineThevenin(aSources);
      const bThev = combineThevenin(bSources);

      if (!aThev && !bThev) continue;

      const vTarget = (aThev ? aThev.vTh : 0) - (bThev ? bThev.vTh : 0);
      const rSource = (aThev ? aThev.rTh : 0) + (bThev ? bThev.rTh : 0);

      if (rSource <= 0) continue;

      const rc = rSource * farads;
      const vCap = this.capVoltages.get(part.id) ?? 0;
      const vNew = vCap + (vTarget - vCap) * (1 - Math.exp(-dtSec / rc));

      this.capVoltages.set(part.id, vNew);

      // Update node voltages for the capacitor's terminals
      // The capacitor voltage determines the node voltage at its "a" terminal
      // relative to "b"
      const vB = this.nodeVoltages.get(netB) ?? 0;
      this.nodeVoltages.set(netA, vB + vNew);
    }

    // Restore cached voltages for non-cap nets
    for (const [netId, v] of savedVoltages) {
      if (!this.nodeVoltages.has(netId)) {
        this.nodeVoltages.set(netId, v);
      }
    }
  }

  // ─── Internal: closed-form solver ────────────────────────────────────────

  /**
   * Resolve node voltages for the current state. Closed-form only.
   *
   * Strategy: walk each net and determine its voltage from the sources
   * connected to it (VCC, GND, pin Thévenin equivalents, potentiometer wipers).
   * For simple series chains (pin → resistor → LED → net), solve the loop
   * analytically.
   */
  _solve() {
    this.nodeVoltages.clear();
    this.ledCurrents.clear();
    this._mnaCache = null; // invalidate MNA cache

    if (!this.powered) return;

    // Parts beyond the walker's vocabulary? One full MNA solve answers
    // everything coherently (and primes the instrument cache for free).
    if (this._needsMNA()) {
      this._solveViaMNA();
      return;
    }

    // Set known voltages: VCC and GND nets
    for (const net of this.nets) {
      for (const t of net.terminals) {
        const part = this.partMap.get(t.part);
        if (!part) continue;
        if (part.kind === 'vcc') {
          this.nodeVoltages.set(net.id, this.vcc);
        } else if (part.kind === 'gnd') {
          this.nodeVoltages.set(net.id, 0);
        }
      }
    }

    // Resolve potentiometer wipers
    for (const part of this.parts) {
      if (part.kind === 'potentiometer') {
        this._solvePot(part);
      }
    }

    // Resolve LED chains: find LEDs and trace their series path
    for (const part of this.parts) {
      if (part.kind === 'led') {
        this._solveLedChain(part);
      }
    }

    // Resolve remaining unresolved nets (e.g. pull-up/pull-down to an input pin).
    // For each unresolved net, trace through resistors/buttons to find a voltage source.
    // If there's no load (only high-Z connections), voltage equals the source voltage.
    for (const net of this.nets) {
      if (this.nodeVoltages.has(net.id)) continue;
      this._resolveNet(net);
    }

    // Override net voltages for capacitor nodes with their actual charge state.
    // The static solve gives the long-term target voltage; the cap's current
    // charge may be different (it hasn't reached steady state yet).
    for (const part of this.parts) {
      if (part.kind !== 'capacitor') continue;
      const capV = this.capVoltages.get(part.id);
      if (capV === undefined) continue;
      const netA = this._netForTerminal(part.id, 'a');
      const netB = this._netForTerminal(part.id, 'b');
      if (netA) {
        const vB = netB ? (this.nodeVoltages.get(netB) ?? 0) : 0;
        this.nodeVoltages.set(netA, vB + capV);
      }
    }

    // Settle built-in shift registers (clock edge → latch → output change → re-solve).
    if (this._shiftRegisters.size > 0) {
      for (let round = 0; round < 3; round++) {
        if (!this._updateShiftRegisters()) break;
        // Re-resolve affected output nets
        for (const part of this.parts) {
          if (part.kind !== 'shift_register') continue;
          for (let i = 0; i < 8; i++) {
            const netId = this._netForTerminal(part.id, `q${i}`);
            if (netId && !this.nodeVoltages.has(netId)) continue;
            if (netId) {
              // Clear and re-resolve this net
              this.nodeVoltages.delete(netId);
              const net = this.netMap.get(netId);
              if (net) this._resolveNet(net);
            }
          }
        }
      }
    }
  }

  /**
   * Resolve a net's voltage by finding all Thévenin sources connected to it
   * (through resistors, buttons, or directly). Combines parallel sources.
   * High-Z connections (input pins, open buttons) contribute nothing.
   *
   * @param {Net} net
   */
  _resolveNet(net) {
    // Gather all Thévenin sources reaching this net
    const sources = this._gatherSources(net.id);
    if (sources.length === 0) return;

    if (sources.length === 1) {
      // Single source: voltage is Vth (no current flows through the series R
      // because there's no other path — only high-Z loads)
      this.nodeVoltages.set(net.id, sources[0].vTh);
      return;
    }

    // Multiple sources: combine in parallel using Norton equivalent.
    // I_total = Σ(Vth_i / Rth_i), G_total = Σ(1 / Rth_i)
    // V_node = I_total / G_total
    let iTotal = 0;
    let gTotal = 0;
    for (const s of sources) {
      if (s.rTh <= 0) { s.rTh = 0.001; } // avoid division by zero
      gTotal += 1 / s.rTh;
      iTotal += s.vTh / s.rTh;
    }
    this.nodeVoltages.set(net.id, gTotal > 0 ? iTotal / gTotal : 0);
  }

  /**
   * Gather Thévenin sources that can reach a net (directly or through
   * resistors/closed buttons). Does not follow through LEDs or buzzers.
   *
   * @param {string} netId
   * @returns {Array<{vTh: number, rTh: number}>}
   */
  _gatherSources(netId) {
    /** @type {Array<{vTh: number, rTh: number}>} */
    const sources = [];
    this._gatherSourcesInner(netId, new Set(), 0, sources);
    return sources;
  }

  /**
   * @param {string} netId
   * @param {Set<string>} visited
   * @param {number} rAccum
   * @param {Array<{vTh: number, rTh: number}>} out
   */
  _gatherSourcesInner(netId, visited, rAccum, out) {
    // If this net has a known voltage, it's a terminal source —
    // return it without marking visited, so parallel paths to the
    // same known net (e.g. two resistors both to GND) are all found.
    const knownV = this.nodeVoltages.get(netId);
    if (knownV !== undefined) {
      out.push({ vTh: knownV, rTh: rAccum });
      return;
    }

    if (visited.has(netId)) return;
    visited.add(netId);

    const net = this.netMap.get(netId);
    if (!net) return;

    for (const t of net.terminals) {
      const part = this.partMap.get(t.part);
      if (!part) continue;

      switch (part.kind) {
        case 'vcc':
          out.push({ vTh: this.vcc, rTh: rAccum });
          break;
        case 'gnd':
          out.push({ vTh: 0, rTh: rAccum });
          break;
        case 'mcu': {
          const state = this.pinStates.get(t.terminal);
          if (!state) break;
          const thev = pinThevenin(state.mode, state.driveHigh, this.vcc);
          if (thev !== 'high-z') {
            out.push({ vTh: thev.vTh, rTh: rAccum + thev.rTh });
          }
          break;
        }
        case 'shift_register': {
          // Output terminals q0-q7 are Thévenin drivers from the latch register
          const sr = this._shiftRegisters.get(part.id);
          if (sr && t.terminal.startsWith('q')) {
            const bitIdx = parseInt(t.terminal.slice(1), 10);
            if (!isNaN(bitIdx) && sr.oeActive !== false) {
              const bitVal = (sr.latchReg >> bitIdx) & 1;
              const rOut = /** @type {number} */ (part.params?.rOut ?? 50);
              out.push({ vTh: bitVal ? this.vcc : 0, rTh: rAccum + rOut });
            }
            // If OE inactive: high-Z, don't push any source
          }
          // Input terminals (data, clock, latch, oe): high impedance, ignore
          break;
        }
        case 'resistor': {
          const ohms = /** @type {number} */ (part.params.ohms ?? 1000);
          const otherT = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherT);
          if (otherNet) {
            this._gatherSourcesInner(otherNet, visited, rAccum + ohms, out);
          }
          break;
        }
        case 'inductor': {
          // DC steady state: inductor is a wire (zero resistance)
          const otherT = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherT);
          if (otherNet) {
            this._gatherSourcesInner(otherNet, visited, rAccum, out);
          }
          break;
        }
        case 'ldr': {
          // Photoresistor: control 0…1 maps to resistance range.
          // 0 = dark (high R, e.g. 1MΩ), 1 = bright (low R, e.g. 100Ω).
          const rDark = /** @type {number} */ (part.params.rDark ?? 1000000);
          const rLight = /** @type {number} */ (part.params.rLight ?? 100);
          const light = this.controls.get(part.id) ?? 0;
          const ohms = rDark * Math.pow(rLight / rDark, light);
          const otherT = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherT);
          if (otherNet) {
            this._gatherSourcesInner(otherNet, visited, rAccum + ohms, out);
          }
          break;
        }
        case 'ntc': {
          // NTC thermistor: control 0…1 maps from cold (high R) to hot (low R).
          // Simplified: exponential interpolation between rCold and rHot.
          const rCold = /** @type {number} */ (part.params.rCold ?? 100000);
          const rHot = /** @type {number} */ (part.params.rHot ?? 1000);
          const temp = this.controls.get(part.id) ?? 0;
          const ohms = rCold * Math.pow(rHot / rCold, temp);
          const otherT = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherT);
          if (otherNet) {
            this._gatherSourcesInner(otherNet, visited, rAccum + ohms, out);
          }
          break;
        }
        case 'button':
        case 'switch': {
          const pressed = (this.controls.get(part.id) ?? 0) === 1;
          if (!pressed) break;
          const otherT = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherT);
          if (otherNet) {
            this._gatherSourcesInner(otherNet, visited, rAccum, out);
          }
          break;
        }
        case 'potentiometer': {
          if (t.terminal === 'wiper') {
            const wiperNet = this._netForTerminal(part.id, 'wiper');
            if (wiperNet) {
              const wV = this.nodeVoltages.get(wiperNet);
              if (wV !== undefined) {
                out.push({ vTh: wV, rTh: rAccum });
              }
            }
          }
          break;
        }
        // LEDs, buzzers, capacitors: not followed through
      }
    }
  }

  /**
   * Solve a potentiometer: wiper voltage = VCC × position.
   * Assumes terminals are ["a", "b", "wiper"] with a→VCC, b→GND.
   * @param {Part} pot
   */
  _solvePot(pot) {
    const position = this.controls.get(pot.id) ?? 0.5;
    // Find the nets connected to terminals a and b
    const netA = this._netForTerminal(pot.id, 'a');
    const netB = this._netForTerminal(pot.id, 'b');
    const netW = this._netForTerminal(pot.id, 'wiper');

    if (!netA || !netB || !netW) return;

    const vA = this.nodeVoltages.get(netA) ?? 0;
    const vB = this.nodeVoltages.get(netB) ?? 0;

    // Wiper voltage: linear interpolation from b to a
    const vWiper = vB + (vA - vB) * position;
    this.nodeVoltages.set(netW, vWiper);
  }

  /**
   * Solve an LED in a series chain. Traces from the LED's anode and cathode
   * back to voltage sources (VCC/GND/pin Thévenin) through resistors,
   * then solves the loop analytically.
   *
   * @param {Part} led
   */
  _solveLedChain(led) {
    const vf = /** @type {number} */ (led.params.vf ?? LED_VF);
    const rd = LED_RD;

    // LED terminals: "anode" and "cathode"
    const anodeNet = this._netForTerminal(led.id, 'anode');
    const cathodeNet = this._netForTerminal(led.id, 'cathode');
    if (!anodeNet || !cathodeNet) return;

    // Trace from anode side: find the Thévenin source looking outward
    const anodeSource = this._traceToSource(anodeNet, led.id);
    // Trace from cathode side
    const cathodeSource = this._traceToSource(cathodeNet, led.id);

    if (!anodeSource || !cathodeSource) return;

    // Both sides resolved: solve the loop.
    // Convention: current flows anode → cathode (positive = LED is forward-biased).
    // V_anode_source - I*R_anode - Vf - I*Rd - I*R_cathode - V_cathode_source = 0
    // (Vth_a - Vth_c - Vf) = I * (Rth_a + Rd + Rth_c)

    const vDiff = anodeSource.vTh - cathodeSource.vTh;
    const rTotal = anodeSource.rTh + rd + cathodeSource.rTh;

    let current;
    if (vDiff >= vf) {
      // Forward biased, above threshold
      current = (vDiff - vf) / rTotal;
    } else {
      // Below threshold or reverse biased — no current
      current = 0;
    }

    this.ledCurrents.set(led.id, current);

    // Set node voltages at the LED terminals
    // V_anode_node = V_anode_source - I * R_anode_source
    this.nodeVoltages.set(anodeNet, anodeSource.vTh - current * anodeSource.rTh);
    this.nodeVoltages.set(cathodeNet, cathodeSource.vTh + current * cathodeSource.rTh);
  }

  /**
   * Trace from a net outward (excluding `excludePart`) to find a Thévenin
   * equivalent source. Follows through resistors, buttons (closed = wire),
   * to reach VCC, GND, or an MCU pin.
   *
   * Returns {vTh, rTh} accumulated along the path, or null if no source found.
   *
   * @param {string} netId
   * @param {string} excludePart - part to exclude (the LED we're tracing from)
   * @returns {{ vTh: number; rTh: number } | null}
   */
  _traceToSource(netId, excludePart) {
    return this._traceToSourceInner(netId, excludePart, new Set(), 0);
  }

  /**
   * @param {string} netId
   * @param {string} excludePart
   * @param {Set<string>} visited - nets already visited (cycle detection)
   * @param {number} rAccum - resistance accumulated so far
   * @returns {{ vTh: number; rTh: number } | null}
   */
  _traceToSourceInner(netId, excludePart, visited, rAccum) {
    if (visited.has(netId)) return null;
    visited.add(netId);

    const net = this.netMap.get(netId);
    if (!net) return null;

    // Check if this net has a known voltage source
    const knownV = this.nodeVoltages.get(netId);
    if (knownV !== undefined) {
      return { vTh: knownV, rTh: rAccum };
    }

    // Look at parts connected to this net (excluding the one we came from)
    for (const t of net.terminals) {
      if (t.part === excludePart) continue;

      const part = this.partMap.get(t.part);
      if (!part) continue;

      switch (part.kind) {
        case 'vcc':
          return { vTh: this.vcc, rTh: rAccum };

        case 'gnd':
          return { vTh: 0, rTh: rAccum };

        case 'mcu': {
          // The terminal name is the PinId
          const pinId = t.terminal;
          const state = this.pinStates.get(pinId);
          if (!state) continue;
          const thev = pinThevenin(state.mode, state.driveHigh, this.vcc);
          if (thev === 'high-z') continue;
          return { vTh: thev.vTh, rTh: rAccum + thev.rTh };
        }

        case 'resistor': {
          const ohms = /** @type {number} */ (part.params.ohms ?? 1000);
          const otherTerminal = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherTerminal);
          if (!otherNet) continue;
          const result = this._traceToSourceInner(
            otherNet, part.id, visited, rAccum + ohms
          );
          if (result) return result;
          break;
        }

        case 'inductor': {
          // DC: wire (zero resistance)
          const otherTerminal = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherTerminal);
          if (!otherNet) continue;
          const result = this._traceToSourceInner(otherNet, part.id, visited, rAccum);
          if (result) return result;
          break;
        }

        case 'ldr': {
          const rDark = /** @type {number} */ (part.params.rDark ?? 1000000);
          const rLight = /** @type {number} */ (part.params.rLight ?? 100);
          const light = this.controls.get(part.id) ?? 0;
          const ohms = rDark * Math.pow(rLight / rDark, light);
          const otherTerminal = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherTerminal);
          if (!otherNet) continue;
          const result = this._traceToSourceInner(otherNet, part.id, visited, rAccum + ohms);
          if (result) return result;
          break;
        }

        case 'ntc': {
          const rCold = /** @type {number} */ (part.params.rCold ?? 100000);
          const rHot = /** @type {number} */ (part.params.rHot ?? 1000);
          const temp = this.controls.get(part.id) ?? 0;
          const ohms = rCold * Math.pow(rHot / rCold, temp);
          const otherTerminal = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherTerminal);
          if (!otherNet) continue;
          const result = this._traceToSourceInner(otherNet, part.id, visited, rAccum + ohms);
          if (result) return result;
          break;
        }

        case 'button':
        case 'switch': {
          const pressed = (this.controls.get(part.id) ?? 0) === 1;
          if (!pressed) continue; // open = no connection
          const otherTerminal = t.terminal === 'a' ? 'b' : 'a';
          const otherNet = this._netForTerminal(part.id, otherTerminal);
          if (!otherNet) continue;
          const result = this._traceToSourceInner(
            otherNet, part.id, visited, rAccum
          );
          if (result) return result;
          break;
        }

        case 'potentiometer': {
          // If connected to the wiper, return the wiper voltage
          if (t.terminal === 'wiper') {
            const wiperNet = this._netForTerminal(part.id, 'wiper');
            if (wiperNet) {
              const wV = this.nodeVoltages.get(wiperNet);
              if (wV !== undefined) {
                return { vTh: wV, rTh: rAccum };
              }
            }
          }
          break;
        }
      }
    }

    return null;
  }

  /**
   * Find the voltage at an MCU pin by looking at the net it's connected to.
   * @param {PinId} pin
   * @returns {number}
   */
  _pinVoltage(pin) {
    // Find the MCU part and the net this pin is connected to
    for (const net of this.nets) {
      for (const t of net.terminals) {
        const part = this.partMap.get(t.part);
        if (part && part.kind === 'mcu' && t.terminal === pin) {
          return this.nodeVoltages.get(net.id) ?? 0;
        }
      }
    }
    return 0;
  }

  /**
   * Find the net connected to a specific terminal of a part.
   * @param {string} partId
   * @param {string} terminal
   * @returns {string | undefined} net id
   */
  _netForTerminal(partId, terminal) {
    for (const net of this.nets) {
      for (const t of net.terminals) {
        if (t.part === partId && t.terminal === terminal) {
          return net.id;
        }
      }
    }
    return undefined;
  }

  /**
   * Record current LED current values as samples for brightness integration.
   */
  _recordLedSamples() {
    for (const [partId, history] of this.ledHistory) {
      const current = this.ledCurrents.get(partId) ?? 0;

      const last = history.length > 0 ? history[history.length - 1] : null;

      // Skip if nothing changed (same time and current)
      if (last && last.tNs === this.timeNs && last.current === current) continue;

      // If time hasn't changed but current has, update in place
      if (last && last.tNs === this.timeNs) {
        last.current = current;
        continue;
      }

      // Skip recording if the current hasn't changed since the last sample
      // (steady state — no need to record the same value repeatedly)
      if (last && last.current === current) continue;

      history.push({ tNs: this.timeNs, current });

      // Prune only when the history is large (amortized O(1))
      if (history.length > 200) {
        const windowStart = this.timeNs > BRIGHTNESS_WINDOW_NS
          ? this.timeNs - BRIGHTNESS_WINDOW_NS
          : 0n;

        let keepIdx = -1;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].tNs <= windowStart) {
            keepIdx = i;
            break;
          }
        }
        if (keepIdx > 0) {
          history.splice(0, keepIdx);
        }
      }
    }
  }

  /**
   * Check if a pin change affects a buzzer and record the edge.
   * @param {PinId} pin
   */
  _recordBuzzerEdges(pin) {
    // Find buzzers connected to a net that includes this pin
    for (const part of this.parts) {
      if (part.kind !== 'buzzer') continue;
      // Check if this buzzer shares a net with the pin
      const buzzerNet = this._netForTerminal(part.id, 'a') ||
                        this._netForTerminal(part.id, 'b');
      if (!buzzerNet) continue;

      const net = this.netMap.get(buzzerNet);
      if (!net) continue;

      for (const t of net.terminals) {
        const p = this.partMap.get(t.part);
        if (p && p.kind === 'mcu' && t.terminal === pin) {
          const edges = this.buzzerEdges.get(part.id);
          if (edges) {
            edges.push(this.timeNs);
            // Keep only recent edges
            while (edges.length > 100) edges.shift();
          }
          break;
        }
      }
    }
  }
}
