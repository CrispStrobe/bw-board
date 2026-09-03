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
 * ACCURACY TIER: THE DIVISOR, NOT THE WAVEFORM. `audioTone()` answers what
 * the hardware is CONFIGURED to produce — the counter's reload and the two
 * gate bits — and that is exact. What it is not is a signal: there are no
 * samples, no edges, and no phase, so nothing here can be summed, mixed or
 * played back directly.
 *
 * What follows from that, named rather than left to be discovered:
 *
 *   - NO SUB-INSTRUCTION TIMING. The machine advances peripherals by each
 *     instruction's cycle count, so a program that shapes a tone by BUSY
 *     LOOPING between writes to 61h is quantised to instruction boundaries.
 *     A program that sets the divisor and lets counter 2 run is exact; one
 *     that bit-bangs the speaker data bit to make a waveform is not, and the
 *     difference is audible in exactly the software that does it.
 *   - NO AMPLITUDE, and no envelope: a PC speaker is one bit driving a cone.
 *     `on` is that bit, and how loud it is was never the computer's business.
 *   - NO PIT MODE BEYOND 3. Counter 2 in square-wave mode is what a PC uses
 *     for sound; `hz` is read from the divisor and does NOT check the mode,
 *     so a program that puts counter 2 in mode 0 or 2 and reads the speaker
 *     gets the divisor back as if it were a tone.
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
