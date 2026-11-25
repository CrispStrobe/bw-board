// SPDX-License-Identifier: MIT
/**
 * The edge detector every clocked logic model shares.
 *
 * An edge is a change from the PREVIOUS level of an input to its present one,
 * so a detector needs a previous level before it can see anything. Models used
 * to hard-code it in init() (false; true for an idle-high falling-edge clock),
 * which made the first evaluation compare the first real level against a
 * guess: a rising-edge counter powered up with its clock held high counted
 * once at t = 0, and a falling-edge counter clocked by a gate that settles low
 * at power-on did the same. A real counter powered up under a steady clock
 * level counts nothing.
 *
 * So the previous level starts UNKNOWN (absent from the state) and is taken
 * from the first SETTLED input level: while `read.priming` is true the
 * detector only records. The board sets it for the device passes of the
 * power-on settle (a new netlist solved while powered, or power switched on)
 * until a pass changes no device output, and at the latest until that solve
 * ends -- an inverter that starts at its init level and settles inside that
 * fixpoint is not a clock edge either.
 *
 * A model driven WITHOUT a board (a unit harness calling update() on pins it
 * initialised to 0 V) never primes; there an unknown previous level reads as
 * low, the level such a harness starts every pin at, which is what the
 * models' old init value was for all but one of them.
 *
 * Always call it on every update, including while an asynchronous reset or
 * load holds the part: the detector must keep tracking the input, or the
 * level frozen when the reset came is compared against the one after its
 * release and a clock edge that never happened is taken.
 *
 * @module
 */

/**
 * Track one input level and report its edge.
 * @param {object|Array} store - where the previous level lives (the device state, or an array of them)
 * @param {string|number} key - its key in `store`
 * @param {boolean} level - the input's present logic level
 * @param {{priming?: boolean}} [read] - the board's read function (carries `priming`)
 * @returns {1|-1|0} 1 rising, -1 falling, 0 no edge (or still priming)
 */
export function clockEdge(store, key, level, read) {
    const prev = Boolean(store[key]);
    store[key] = level;
    if (read?.priming) return 0;
    if (level && !prev) return 1;
    if (!level && prev) return -1;
    return 0;
}

/** True on a rising edge of `level` (see clockEdge). */
export const rose = (store, key, level, read) => clockEdge(store, key, level, read) === 1;
/** True on a falling edge of `level` (see clockEdge). */
export const fell = (store, key, level, read) => clockEdge(store, key, level, read) === -1;
