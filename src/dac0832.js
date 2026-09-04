/**
 * DAC0832 — 8-bit multiplying digital-to-analog converter.
 *
 * The counterpart to the ADC0809 already on this bench, and chosen for the
 * same reason: it is the lab-manual part that sits on a 8080/8085/8086
 * prototype card, it is parallel and 8-bit so it needs no serial protocol a
 * learner has not met, and its control lines are plain chip-select and write
 * strobes rather than a bus a card would have to arbitrate.
 *
 * WHAT IT IS FOR. `set led to 128` -- `stc12_writepin` -- is "put this value
 * on that pin", and on an STC12 that is the on-chip DAC. There is no such
 * thing on an 8086, so the value has to land somewhere real. This is that
 * somewhere.
 *
 * THE OUTPUT IS A CURRENT, NOT A VOLTAGE. A real 0832 sinks current out of
 * IOUT1/IOUT2 through an R-2R ladder, and it takes an external op-amp with the
 * on-chip feedback resistor to turn that into a voltage you can measure. This
 * model reports VOLTS, which presumes that op-amp is there -- the standard
 * single-supply hookup from the datasheet. That is a statement about the
 * CARD, not about the chip, and it is written down here because a learner who
 * wires a 0832 with no op-amp and expects `volts()` will measure nothing.
 *
 * FULL SCALE IS Vref x 255/256, NOT Vref. An 8-bit ladder has 256 steps and
 * the last one is 255/256 of the reference, so at Vref = 5 V the code 255
 * gives 4.980 V and NOTHING gives 5.000 V. This is the DAC's half of the
 * quantisation the ADC already states, and it is modelled rather than rounded
 * away because a learner who writes 255 and expects the rail is learning the
 * wrong thing about converters.
 *
 * IT IS WRITE-ONLY. The 0832's latches have no read path -- there are no data
 * outputs on the package. Reading the port therefore returns open bus (0xFF),
 * NOT the last value written, because a model that echoed the write back
 * would teach that a DAC can be read, and the program that relied on it would
 * work here and fail on a bench.
 *
 * DOUBLE BUFFERING IS THE CHIP'S ACTUAL FEATURE, and it is why the window is
 * three ports rather than one. The 0832 has TWO latches in series: an input
 * latch (WR1/ILE/CS) and a DAC latch (WR2/XFER). Loading several converters
 * and then transferring them together is how a multi-axis output moves at one
 * instant instead of one channel at a time. A card that ties XFER low gets
 * the simple one-write path and gives that up.
 *
 * Both wirings are reachable, by address, in the 310h prototype-card block --
 * the next window after the ADC's 300h-308h:
 *
 *     310h   WRITE  load the input latch AND transfer: the output moves now.
 *                   The single-buffered path, and what a pin write lowers to.
 *     311h   WRITE  load the INPUT latch only. The output does not move.
 *     312h   WRITE  transfer input latch -> DAC latch. The output moves to
 *                   whatever 311h last staged. The data byte is ignored,
 *                   because XFER is a strobe and carries no data.
 *     any    READ   0xFF. See "it is write-only" above.
 *
 * POWER-ON STATE IS INDETERMINATE ON REAL SILICON. The 0832 has no reset pin,
 * so its latches come up holding whatever they come up holding, and a real
 * board can twitch its output at power-on. This model starts at 0, because a
 * deterministic bench cannot offer a value nobody can predict -- the
 * divergence is named here rather than modelled, on the same grounds as the
 * ADC's floating-input note.
 *
 * @module
 */

/** An 8-bit ladder: 256 steps, of which the top code is 255. */
const STEPS = 256;

export class DAC0832 {
    /**
     * @param {{ vref?: number }} [opts] vref is the reference the ladder
     *   divides; 5 V unless a card says otherwise, so a 3.3 V board is not
     *   silently reported as a 5 V one.
     */
    constructor(opts = {}) {
        this.vref = Number.isFinite(opts.vref) ? opts.vref : 5.0;
        this.reset();
    }

    reset() {
        /** The first latch: staged, not yet on the ladder. */
        this.input = 0;
        /** The second latch: what the ladder is actually converting. */
        this.dac = 0;
    }

    /**
     * A write into the chip's window. `reg` is the offset within it, which is
     * the wiring: A0/A1 pick which strobe the card asserts.
     * @param {number} reg 0 = load+transfer, 1 = load input latch, 2 = transfer
     * @param {number} val the data byte (ignored for the transfer strobe)
     */
    write(reg, val = 0) {
        const byte = val & 0xff;
        switch (reg & 3) {
            case 0: this.input = byte; this.dac = byte; break;   // single-buffered
            case 1: this.input = byte; break;                    // staged only
            case 2: this.dac = this.input; break;                // XFER strobe
            default: break;                                       // 313h: not a strobe
        }
    }

    /**
     * OPEN BUS. A 0832 has no data outputs, so nothing drives the bus when the
     * card is read and the pull-ups win -- the same 0xFF an unmapped port
     * gives, and deliberately not the last value written.
     * @returns {number} 0xFF, always
     */
    read() { return 0xff; }

    /** The code currently on the ladder, 0-255. */
    get counts() { return this.dac & 0xff; }

    /**
     * The voltage the op-amp is presenting, quantised the way the ladder is.
     *
     * Vref x D/256, so the top code 255 gives Vref x 255/256 and the reference
     * itself is not reachable. See the header.
     * @returns {number}
     */
    volts() { return (this.dac & 0xff) * this.vref / STEPS; }

    getState() { return { input: this.input, dac: this.dac, vref: this.vref }; }

    setState(s) {
        this.input = s.input | 0;
        this.dac = s.dac | 0;
        if (Number.isFinite(s.vref)) this.vref = s.vref;
    }
}

export default DAC0832;
