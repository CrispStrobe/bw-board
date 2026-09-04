/**
 * ADC0809 — eight-channel 8-bit analog-to-digital converter.
 *
 * WHY THIS CHIP AND NOT THE ADC0804, which is the other lab-manual staple.
 * The 0809 carries an EIGHT-CHANNEL analog multiplexer selected by three
 * address lines, and that is what preserves a contract the tier already has.
 * An 8051 program declares `PIN pot = P1.3 ANALOG`, and on an STC12 that means
 * ADC channel 3 because channel n IS physically P1.n. With a 0809, `P1.n ->
 * channel n` is a MAPPING, exactly as `P1/P2/P3 -> ports A/B/C` already is for
 * the 8255. With a single-channel 0804 it would become a translation through a
 * lookup, and a reseat would stop being a one-line change.
 *
 * EOC IS POLLED, NOT AN INTERRUPT, and that is not a simplification. The bench
 * this runs on (DOSBOX8086_XT) has NO PIC, so there is no IRQ line for a
 * conversion-complete to arrive on. The 0809 is usable here precisely because
 * its End-Of-Conversion is a status pin a program can read in a loop; a
 * converter that only signalled by interrupt would be unusable on this machine.
 *
 * THE CONVERSION TAKES REAL TIME. A 0809 needs 64 clocks of its own oscillator
 * — about 100 us at the 640 kHz the datasheet recommends — and this models
 * that rather than answering instantly. A program that starts a conversion and
 * reads without polling gets the PREVIOUS result, which is what the silicon
 * does and what the learner's oscilloscope would show. Answering immediately
 * would make a broken polling loop look correct.
 *
 * THE CARD, not the chip, decides addresses. On an IBM XT the 300h-31Fh block
 * is the documented PROTOTYPE CARD range — the address space IBM set aside for
 * exactly this, a board a learner adds. So an eight-port window at 300h:
 *
 *     300h + n   WRITE  latch channel n and START a conversion (ALE + START)
 *                READ   the last completed result (OE)
 *     308h       READ   status: bit 0 = EOC, 1 when a conversion has finished
 *
 * The channel comes from the ADDRESS rather than from the data byte because
 * that is how the chip is wired: A0-A2 drive ADD A/B/C. A card that took the
 * channel in the data would be a different board.
 *
 * ANALOG IN COMES FROM OUTSIDE. `setChannel(n, volts)` is how a board, a
 * widget or a test says what is on the pin; `vref` scales it. Nothing here
 * invents a signal: an unconnected channel reads 0 V and converts to 0, which
 * is what a floating input on a real board does NOT do — a real one picks up
 * noise — and the difference is stated rather than modelled, because noise a
 * learner cannot predict is worse than a zero they can.
 *
 * @module
 */

/** Datasheet: 64 clock periods per conversion. */
const CONVERSION_CLOCKS = 64;
/** The clock the datasheet recommends, and what the timing here assumes. */
const DEFAULT_ADC_CLOCK_HZ = 640_000;

export class ADC0809 {
    /**
     * @param {number} [cpuClockHz] the machine's clock, so a conversion can be
     *   counted in the CPU cycles the machine advances chips by.
     * @param {{ vref?: number, adcClockHz?: number }} [opts]
     */
    constructor(cpuClockHz = 5_000_000, opts = {}) {
        this.cpuClockHz = cpuClockHz;
        /** Full scale. 5 V in, 255 out. */
        this.vref = opts.vref ?? 5.0;
        this.adcClockHz = opts.adcClockHz ?? DEFAULT_ADC_CLOCK_HZ;
        /** CPU cycles one conversion costs, rounded up so it is never free. */
        this.convCycles = Math.max(1,
            Math.ceil(CONVERSION_CLOCKS * (this.cpuClockHz / this.adcClockHz)));
        this.reset();
    }

    reset() {
        /** Volts presented on each of the eight channels. */
        this.volts = new Array(8).fill(0);
        /** The last completed conversion, which is what a read returns. */
        this.result = 0;
        /** Which channel the mux is latched onto. */
        this.channel = 0;
        /** Cycles left before EOC rises. 0 means idle and complete. */
        this.remaining = 0;
        /** EOC: false while converting. A fresh chip has converted nothing,
         *  and reports so rather than claiming a result it does not have. */
        this.eoc = false;
    }

    /** What a board or a widget puts on a channel, in volts. */
    setChannel(n, v) {
        this.volts[n & 7] = Number(v) || 0;
    }

    /** The byte a completed conversion of `v` volts produces. Clamped, because
     *  a board can present more than vref and the chip cannot report it. */
    _quantise(v) {
        if (!(v > 0)) return 0;
        if (v >= this.vref) return 255;
        return Math.min(255, Math.floor((v / this.vref) * 256));
    }

    /**
     * @param {number} reg 0-7 select a channel, 8 is the status port.
     */
    read(reg) {
        if ((reg & 0x0f) === 8) return this.eoc ? 0x01 : 0x00;
        // OE: the chip drives the last COMPLETED result, whichever channel it
        // came from. Reading mid-conversion gives the previous one -- the
        // output latch is not cleared by START.
        return this.result & 0xff;
    }

    /** Any write to a channel port is ALE followed by START. The data byte is
     *  ignored, because on the real card nothing is connected to it. */
    write(reg) {
        this.channel = reg & 7;
        this.remaining = this.convCycles;
        this.eoc = false;
    }

    /** Count down the conversion in CPU cycles, the way every other chip here
     *  is advanced. */
    advance(cycles) {
        if (this.remaining <= 0) return;
        this.remaining -= cycles;
        if (this.remaining <= 0) {
            this.remaining = 0;
            this.result = this._quantise(this.volts[this.channel]);
            this.eoc = true;
        }
    }

    /** Cycles until something changes, so a halted machine can skip to it. */
    nextWake() {
        return this.remaining > 0 ? this.remaining : Infinity;
    }

    getState() {
        return {volts: this.volts.slice(), result: this.result, channel: this.channel,
            remaining: this.remaining, eoc: this.eoc};
    }

    setState(s) {
        this.volts = (s.volts || new Array(8).fill(0)).slice();
        this.result = s.result & 0xff;
        this.channel = s.channel & 7;
        this.remaining = s.remaining || 0;
        this.eoc = !!s.eoc;
    }
}

export default ADC0809;
