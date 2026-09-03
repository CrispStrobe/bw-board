/**
 * The PC speaker — the wiring between two chips you already have, not a new
 * one. On an XT the speaker is 8255 port B bits 0 and 1 gating 8254 counter
 * 2 into an amplifier:
 *
 *   bit 0 (61h)  — timer-2 GATE: lets counter 2 count (mode 3, square wave)
 *   bit 1 (61h)  — speaker DATA: connects counter 2's output to the cone
 *
 * A tone sounds only when BOTH are set; the pitch is the counter's square
 * wave, 1193182 / divisor Hz, where 1193182 is the PIT's own clock (a third
 * of the 3.579545 MHz colour-burst crystal) — NOT the CPU clock, so it is a
 * constant here and the divisor is whatever the program loaded into counter
 * 2.
 *
 * The readout is `audioTone() -> { hz, on }`, the same shape the ZX tier's
 * ULA answers with, so a debug target or UI needs no new concept: the tone
 * the hardware is producing, derived from the divisor and the two gate bits.
 * No samples, no synthesis.
 *
 * @module
 */

/** The 8254's input clock on a PC: 1.193182 MHz, a third of the colour burst. */
const PIT_CLOCK_HZ = 1_193_182;

export class PCSpeaker {
    /**
     * @param {{ readDivisor?: () => number }} [opts] readDivisor returns the
     *   current reload of the wired counter (2 on a PC); 0 means 65536, the
     *   8254's wrap, exactly as the counter itself treats it.
     */
    constructor(opts = {}) {
        this._readDivisor = opts.readDivisor || (() => 0);
        this.reset();
    }

    reset() {
        this.gate = 0;   // 61h bit 0
        this.data = 0;   // 61h bit 1
    }

    /** A write to port 61h (8255 port B): the low two bits are ours. */
    setControl(portB) {
        this.gate = portB & 1;
        this.data = (portB >> 1) & 1;
    }

    /** True when a tone is actually routed to the cone. */
    get on() { return !!(this.gate && this.data); }

    /**
     * The tone the hardware is producing right now.
     * @returns {{ hz: number, on: boolean }}
     */
    audioTone() {
        if (!this.on) return { hz: 0, on: false };
        const raw = this._readDivisor() | 0;
        const divisor = raw === 0 ? 0x10000 : raw;
        return { hz: Math.round(PIT_CLOCK_HZ / divisor), on: true };
    }

    getState() { return { gate: this.gate, data: this.data }; }

    setState(s) { this.gate = s.gate | 0; this.data = s.data | 0; }
}

export default PCSpeaker;
