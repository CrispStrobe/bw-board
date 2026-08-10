/**
 * Cube-trace oracle — property-based verification for LED cube drivers.
 *
 * CATEGORY: 3 (single implementation). Neither the voxel map nor the
 * polarity has been verified on real silicon. The (select, bit) → (x,y,z)
 * map is EMPTY — only a real cube can fill it. BENCH-CUBE is the bench
 * question that would settle polarity, and the 64-row table is its
 * deliverable. Category 2b is reachable if both emulators agree on the
 * trace; category 1 requires silicon.
 *
 * FORMAT: each event is { tNs: bigint, port: number, value: number }.
 *   tNs   = nanoseconds since reset (emulator sim-time)
 *   port  = 0 for P0 (data), 2 for P2 (select)
 *   value = the byte written to that port register
 *
 * WHAT THIS DOES NOT ESTABLISH:
 *   - The voxel map (which physical LED lights for which select/bit pair)
 *   - Whether the polarity assumption (active-high) matches hardware
 *   - Whether the refresh rate is perceptible on a real display
 *   - Anything about brightness — that is cubeBrightness() in board.js
 *
 * @module
 */

// ─── Trace format ───────────────────────────────────────────────────────

/**
 * @typedef {{ tNs: bigint, port: number, value: number }} CubeEvent
 */

/**
 * The reference trace: 8-line scan, 8 data bits, alternating pattern.
 * Generated from test/golden/cube-trace.js scan parameters.
 *
 * Time base: nanoseconds from emulator reset.
 * Line dwell: 1,006,000 ns (measured from emu8051-stc).
 * Frame period: 8 × 1,006,000 = 8,048,000 ns ≈ 124.3 Hz.
 */
export function generateTrace(frames = 25) {
  const events = [];
  const LINE_NS = 1_006_000n;
  const SELECT_PATTERNS = [0xFE, 0xFD, 0xFB, 0xF7, 0xEF, 0xDF, 0xBF, 0x7F];
  const DATA_PATTERNS = [0x0F, 0xF0, 0x0F, 0xF0, 0x0F, 0xF0, 0x0F, 0xF0];

  let tNs = 100_000n; // small setup delay

  for (let frame = 0; frame < frames; frame++) {
    for (let line = 0; line < 8; line++) {
      // Blank P0 before switching select (prevent ghosting)
      events.push({ tNs, port: 0, value: 0x00 });
      tNs += 1000n;
      // Switch select line
      events.push({ tNs, port: 2, value: SELECT_PATTERNS[line] });
      tNs += 1000n;
      // Drive data
      events.push({ tNs, port: 0, value: DATA_PATTERNS[line] });
      // Dwell for the rest of the line period
      tNs += LINE_NS - 2000n;
    }
  }

  return events;
}

// ─── Invariants ─────────────────────────────────────────────────────────

/**
 * @typedef {{ pass: boolean, message: string, line?: number }} InvariantResult
 */

/**
 * Verify a cube trace against structural invariants.
 * Returns one result per invariant.
 *
 * @param {CubeEvent[]} events
 * @returns {InvariantResult[]}
 */
export function verifyTrace(events) {
  const results = [];

  // ── Invariant 1: at most one select line active at any time ────────
  // Active-low select: exactly one bit LOW in the P2 byte.
  // Active-high select: exactly one bit HIGH. We check both.
  {
    let pass = true;
    let failLine = -1;
    let failMsg = '';
    for (let i = 0; i < events.length; i++) {
      if (events[i].port !== 2) continue;
      const v = events[i].value;
      // Active-low: count zeros (inverted ones)
      const activeLow = 8 - popcount(v);
      // Active-high: count ones
      const activeHigh = popcount(v);
      // One or zero active lines is valid; more than one is ghosting
      if (activeLow > 1 && activeHigh > 1) {
        // Ambiguous — could be neither convention
        pass = false;
        failLine = i;
        failMsg = `P2=0x${v.toString(16)}: ${activeLow} active-low lines AND ${activeHigh} active-high lines`;
        break;
      }
    }
    results.push({
      pass,
      message: pass ? 'At most one select line active at any time' : failMsg,
      line: failLine >= 0 ? failLine : undefined,
    });
  }

  // ── Invariant 2: data is blanked before select changes ─────────────
  // P0 should be 0x00 (all off) before P2 changes, to prevent ghosting.
  {
    let pass = true;
    let failLine = -1;
    let lastP0 = 0;
    let lastP2 = 0xFF;
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (e.port === 0) {
        lastP0 = e.value;
      } else if (e.port === 2) {
        if (e.value !== lastP2 && lastP0 !== 0x00) {
          pass = false;
          failLine = i;
          break;
        }
        lastP2 = e.value;
      }
    }
    results.push({
      pass,
      message: pass ? 'Data blanked before every select change (no ghosting)' :
        `Select changed at event ${failLine} while P0=0x${lastP0.toString(16)} (should be 0x00)`,
      line: failLine >= 0 ? failLine : undefined,
    });
  }

  // ── Invariant 3: refresh period within bounds ─────────────────────
  // A full frame = 8 select changes cycling through all 8 lines.
  // Expected: ~8.05 ms (124 Hz). Visible flicker below ~70 Hz.
  {
    const selectEvents = events.filter(e => e.port === 2);
    let pass = true;
    let failMsg = '';
    if (selectEvents.length >= 16) {
      // Measure frame-to-frame period: 8 select events = 1 frame
      const frame0 = selectEvents[0].tNs;
      const frame1 = selectEvents[8].tNs;
      const frameNs = Number(frame1 - frame0);
      const frameHz = 1e9 / frameNs;
      if (frameHz < 70) {
        pass = false;
        failMsg = `Refresh ${frameHz.toFixed(1)} Hz < 70 Hz — visible flicker`;
      } else if (frameHz > 200) {
        pass = false;
        failMsg = `Refresh ${frameHz.toFixed(1)} Hz > 200 Hz — implausibly fast`;
      } else {
        failMsg = `Refresh ${frameHz.toFixed(1)} Hz (${(frameNs/1e6).toFixed(2)} ms frame)`;
      }
    } else {
      failMsg = 'Not enough select events to measure frame period';
      pass = false;
    }
    results.push({ pass, message: pass ? failMsg : failMsg });
  }

  // ── Invariant 4: every voxel gets equal on-time per frame ─────────
  // Each of 8 scan lines should have approximately equal dwell time.
  {
    const selectEvents = events.filter(e => e.port === 2);
    let pass = true;
    let failMsg = '';
    if (selectEvents.length >= 9) {
      const dwells = [];
      for (let i = 0; i < 8 && i + 1 < selectEvents.length; i++) {
        dwells.push(Number(selectEvents[i + 1].tNs - selectEvents[i].tNs));
      }
      const avg = dwells.reduce((a, b) => a + b, 0) / dwells.length;
      const maxDev = Math.max(...dwells.map(d => Math.abs(d - avg)));
      const devPct = (maxDev / avg) * 100;
      if (devPct > 10) {
        pass = false;
        failMsg = `Scan line dwell varies by ${devPct.toFixed(1)}% — unequal brightness`;
      } else {
        failMsg = `Scan line dwell uniform within ${devPct.toFixed(1)}% (avg ${(avg/1e6).toFixed(3)} ms)`;
      }
    } else {
      failMsg = 'Not enough events to measure dwell uniformity';
      pass = false;
    }
    results.push({ pass, message: pass ? failMsg : failMsg });
  }

  return results;
}

function popcount(v) {
  let n = 0;
  while (v) { n += v & 1; v >>= 1; }
  return n;
}

/**
 * Run all invariants and return a summary.
 * @param {CubeEvent[]} events
 * @returns {{ pass: boolean, results: InvariantResult[] }}
 */
export function checkCubeTrace(events) {
  const results = verifyTrace(events);
  return { pass: results.every(r => r.pass), results };
}
