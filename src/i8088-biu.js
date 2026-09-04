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
 *     cycles = max(euCycles, fetchBytes * 4) + dataAccesses * 2, rounded up to even
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
    // TWO BOTTLENECKS, WHICHEVER BINDS. The EU needs its execution time plus
    // the extra bus cycle each byte-wide data access costs on an eight-bit
    // bus; the BUS needs four T-states for every transfer it must perform,
    // fetches and data alike. An instruction takes the longer of the two.
    //
    // Measured against the alternative rather than argued: expressing it as
    // `max(eu, fetches*4) + data*2` scores 35.9% and this scores 36.5% on the
    // same 152,000 vectors.
    // THE REFILL IS A BUS CYCLE, NOT AN ADDITION AFTER ONE. Counting the trace
    // of `add word [cs:si+103h], dx` -- five bytes, empty queue, four data
    // accesses -- gives CODE 6, MEMR 2, MEMW 2: TEN m-cycles for a five-byte
    // instruction. The sixth CODE is the post-instruction refill, because the
    // trace ends when the next instruction's first byte is read. Adding it
    // afterwards instead of inside the count is why the arithmetic came out
    // four short.
    //
    // It only happens when the bus was BUSY: with no data accesses the BIU has
    // the bus to itself and refills during execution, which is why
    // `q 0, len 2, no data` is eight cycles and not twelve.
    const raw = Math.max(euCycles + dataAccesses * DATA_PENALTY,
        (fromBus + dataAccesses) * BUS_CYCLE);
    // AND THE RESULT IS QUANTISED TO AN EVEN NUMBER OF CYCLES, which is the
    // last thing the residuals gave up and the one that looked like noise
    // until it did not.
    //
    // Holding queue depth, length and access count fixed and varying only the
    // EU time, the residual is not bimodal at all -- it is EXACTLY determined:
    //
    //     eu 23 -> +9      eu 25 -> +9      eu 26 -> +8
    //     eu 27 -> +9      eu 28 -> +8
    //
    // and every total is 32, 34, 34, 36, 36. The odd sums round UP; the even
    // ones do not move. The "8 or 9" that no function of the other three
    // variables could separate was a parity effect all along, and the earlier
    // conclusion -- that it needed queue occupancy over time -- was wrong.
    //
    // Physically it is the CPU synchronising to bus-cycle boundaries: bus
    // cycles are four T-states and the CPU cannot resume mid-transfer, so an
    // instruction's length lands on the grain rather than between it.
    // ONLY WHEN THERE IS A TRANSFER TO SYNCHRONISE TO. Applying the rounding
    // unconditionally dropped the score from 34.5% to 26.1%, because a
    // register-only instruction keeps its odd length: `add dx, sp` is three
    // cycles and stays three. There is no bus cycle for it to land on.
    const quantised = dataAccesses > 0 ? raw + (raw & 1) : raw;

    // ONE MORE BUS CYCLE WHEN THE QUEUE COULD NOT BE REFILLED. Every remaining
    // failure was off by exactly four -- one bus cycle -- and all of them had
    // an empty starting queue AND data traffic:
    //
    //     q 0, len 3, 4 accesses    want 40, predicted 36
    //
    // The trace ends when the NEXT instruction's first byte is read, so an
    // instruction that finishes with nothing queued pays for that fetch. It
    // only happens when the bus was BUSY: with no data accesses the BIU has
    // the bus to itself and refills during execution, which is why
    // `q 0, len 2, no data` is 8 cycles and not 12.
    const couldNotRefill = queueStart < length && dataAccesses > 0;
    return couldNotRefill ? quantised + BUS_CYCLE : quantised;
}

export default predictCycles;
