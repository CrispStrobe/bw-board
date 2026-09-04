/**
 * The 8088 bus interface unit, as a SCHEDULER rather than a second CPU.
 *
 * E6.8.4's design decision, and the reason cycle mode does not fork the core:
 * the instruction path stays instruction-stepped, records what it asked the
 * bus for (`cpu.busTrace`), and this module turns that ORDER into TIME. The
 * core never becomes cycle-stepped, so the 19x-real-time path everything else
 * depends on is untouched when cycle mode is off.
 *
 * THE MODEL, and it was measured before it was written rather than after.
 * Correlating the suite's initial queue length against its cycle count for
 * one-byte instructions gives an unambiguous table:
 *
 *     nop      (EU 3)   queue 4 -> 3 cycles     queue 0 -> 4 cycles
 *     inc ax   (EU 2)   queue 4 -> 2 cycles     queue 0 -> 4 cycles
 *
 * Which is one rule: an instruction takes its execution time, OR the time the
 * bus needs to deliver what it could not find in the queue, whichever is
 * longer. The two overlap -- that is what a prefetch queue is FOR -- so they
 * do not add.
 *
 *     cycles = max(euCycles, fetchBytes * 4) + dataAccesses * 2
 *
 * The asymmetry is the finding: instruction fetches OVERLAP with execution and
 * data accesses do NOT. See predictCycles for the residuals that say so.
 *
 * A bus cycle is four T-states on an 8088 with no wait states, and the 8-bit
 * bus means every BYTE is its own cycle: a word access is two, which is the
 * four extra cycles per word that made this core undercount before any of
 * this existed.
 *
 * WHAT THIS DOES NOT MODEL, stated rather than discovered later: wait states
 * (none on a stock XT's RAM, real on its ROM), the 8087 escape, DMA stealing
 * the bus, and the exact T-state at which each transfer lands. The last is
 * why `tstate` is not among the scores this feeds -- an access trace carries
 * order and not time, which is the known boundary of the whole design.
 *
 * @module
 */

/** T-states in one bus cycle on an 8088 with no wait states. */
export const BUS_CYCLE = 4;

/** The 8088's prefetch queue is four bytes. The 8086's is six. */
export const QUEUE_BYTES = 4;

/**
 * Predict an instruction's cycle count.
 *
 * @param {{ euCycles: number, length: number, queueStart?: number,
 *           dataAccesses?: number }} req
 *   `euCycles` is what the core's own timing table returns, `length` the
 *   instruction's byte count including prefixes, `queueStart` how many bytes
 *   were already queued, `dataAccesses` the number of BYTE-wide memory or I/O
 *   transfers the instruction performed.
 * @returns {number} predicted cycles
 */
export function predictCycles({ euCycles, length, queueStart = QUEUE_BYTES, dataAccesses = 0 }) {
    // FETCHES OVERLAP, DATA ACCESSES ADD, and that asymmetry is measured
    // rather than assumed. Fitting the residual (want - euCycles) against
    // queue depth, instruction length and access count on 4,000 vectors of
    // `add r/m16, r16`:
    //
    //   queue 4, no data     residual 0        the EU table is exactly right
    //   queue 0, len 2       residual 5        = max(EU, 8) - EU
    //   queue 0, len 3       residual 7        = max(EU, 12) - EU
    //   queue 4, 4 accesses  residual 8 or 9   NOT overlapped at all
    //
    // The first three are one rule: an instruction waiting on its own opcode
    // bytes takes whichever is longer, because prefetch is what the queue is
    // FOR. The fourth is the opposite, and the reason is that Intel's
    // published timings already assume the 8086's SIXTEEN-bit bus -- on an
    // 8088 every word costs one extra bus cycle that the EU sits through,
    // because it is waiting for the datum it asked for.
    const fromBus = Math.max(0, length - Math.min(queueStart, QUEUE_BYTES));
    const DATA_PENALTY = 2;      // per byte-wide access; a word costs two
    return Math.max(euCycles, fromBus * BUS_CYCLE) + dataAccesses * DATA_PENALTY;
}

export default predictCycles;
