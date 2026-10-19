/**
 * Golden cube trace: a known pin sequence with expected cubeBrightness.
 *
 * This is the cross-check that pins together bw-board's cubeBrightness
 * and bw-circuit-ui's scan accumulator. Run the same trace through both
 * and assert the same 64 values.
 *
 * Usage:
 *   import { cubeTrace, expectedBrightness } from './golden/cube-trace.js';
 *   // cubeTrace is the pin events to replay
 *   // expectedBrightness is what cubeBrightness should return
 */

/**
 * 8-line scan, 8 data bits, one full frame.
 * Each line drives a different P0 pattern.
 * Line timing: 1.006ms per line (measured from emu8051-stc).
 *
 * Scan table (matching the real hardware):
 *   line 0: P2=0xFE (bit 0 low = select), P0=0x0F (low 4 bits on)
 *   line 1: P2=0xFD (bit 1 low), P0=0xF0 (high 4 bits on)
 *   line 2: P2=0xFB, P0=0x0F
 *   line 3: P2=0xF7, P0=0xF0
 *   line 4: P2=0xEF, P0=0x0F
 *   line 5: P2=0xDF, P0=0xF0
 *   line 6: P2=0xBF, P0=0x0F
 *   line 7: P2=0x7F, P0=0xF0
 *
 * With active-low polarity (as on the real cube):
 *   select LOW = active, data LOW = lit
 *
 * For active-HIGH test (simpler to reason about):
 *   select line N active, data bits = pattern
 */

const LINE_NS = 1_006_000n;

// Active-high trace: select HIGH = active, data HIGH = lit
export const cubeTrace = {
  polarity: 'active-high',
  scanLines: 8,
  dataBits: 8,
  lineTimeNs: LINE_NS,
  scans: 25, // 25 full frames = ~201ms, well past 20ms window

  // Pattern: alternating 0x0F and 0xF0 per line
  // Line 0: data = 0x0F → bits 0-3 on, 4-7 off
  // Line 1: data = 0xF0 → bits 0-3 off, 4-7 on
  // etc.
  dataPerLine: [0x0F, 0xF0, 0x0F, 0xF0, 0x0F, 0xF0, 0x0F, 0xF0],
};

/**
 * Expected brightness per voxel after the trace.
 *
 * Each voxel is lit on exactly one scan line out of 8.
 * Duty = 1/8 = 12.5%.
 *
 * Voxel index = line * 8 + col.
 * Line 0: cols 0-3 lit (0x0F), cols 4-7 dark
 * Line 1: cols 0-3 dark, cols 4-7 lit (0xF0)
 * etc.
 *
 * Every voxel that is ever lit is lit on exactly one line → 12.5%.
 * Every voxel that is never lit → 0%.
 */
export function computeExpectedBrightness() {
  const { scanLines, dataBits, dataPerLine } = cubeTrace;
  const total = scanLines * dataBits;
  const expected = new Array(total).fill(0);

  for (let line = 0; line < scanLines; line++) {
    const pattern = dataPerLine[line];
    for (let bit = 0; bit < dataBits; bit++) {
      if ((pattern >> bit) & 1) {
        // This voxel is lit on this line → 1/8 duty
        expected[line * dataBits + bit] = 1 / scanLines;
      }
    }
  }

  return expected;
}

export const expectedBrightness = computeExpectedBrightness();
