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
 * The readout is `audioTone() -> [{ hz, on }]` -- an ARRAY of one, the same
 * shape the ZX tier's ULA and the AY answer with (E6.8.11a), so a debug target or UI needs no new concept: the tone
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
        // Square-wave phase in [0,1), kept across renderAudio() calls. Not
        // machine state: it is where the cone happens to be, which no program
        // can observe and no snapshot needs.
        this._phase = 0;
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
     *
     * ALWAYS AN ARRAY, one element per voice (E6.8.11a). A single-voice
     * device returns a one-element array rather than a bare object: a
     * contract with two shapes is not a contract, and every producer added
     * after this one would otherwise have to guess which it was allowed to
     * return. The arity is meaningful — an empty array means NO VOICES, which
     * is how a machine with no sound chip differs from a silent one.
     * @returns {Array<{ hz: number, on: boolean }>} exactly one element
     */
    audioTone() {
        if (!this.on) return [{ hz: 0, on: false }];
        const raw = this._readDivisor() | 0;
        const divisor = raw === 0 ? 0x10000 : raw;
        return [{ hz: Math.round(PIT_CLOCK_HZ / divisor), on: true }];
    }

    /**
     * The SECOND audio contract (E6.8.11a): what it SOUNDS like, as samples,
     * beside `audioTone()`'s what it is CONFIGURED to produce. Both stay,
     * because they answer different questions — the tone is exact and free
     * and is what a teaching UI shows next to a buzzer; only samples can be
     * mixed with an OPL, or capture a program bit-banging the data bit.
     *
     * A PC speaker is ONE BIT DRIVING A CONE, so the waveform is a square at
     * the divisor's frequency and the amplitude is ±1 — not a choice, and not
     * a level to be tuned here. A mixer summing several sources applies its
     * own headroom; a chip that pre-attenuated itself would be guessing at
     * how many other chips exist.
     *
     * PHASE IS KEPT ACROSS CALLS. The host asks for a few hundred samples at
     * a time and the buffers must join without a discontinuity; restarting
     * the phase at zero each call is inaudible in a test that renders once
     * and a click every buffer in the app that renders forever.
     *
     * @param {Float32Array} dest
     * @param {number} frames how many samples to write
     * @param {number} sampleRate the HOST's rate; the chip converts from its
     *   own clock, because only the chip knows what its own clock is
     * @returns {number} frames written
     */
    renderAudio(dest, frames, sampleRate) {
        const { hz, on } = this.audioTone()[0];
        // A silent speaker still advances nothing and writes zeros: silence
        // is a signal, and leaving the buffer untouched would replay whatever
        // the previous producer left in it.
        if (!on || hz <= 0 || !(sampleRate > 0)) {
            for (let i = 0; i < frames; i++) dest[i] = 0;
            return frames;
        }
        const step = hz / sampleRate;
        let ph = this._phase;
        for (let i = 0; i < frames; i++) {
            dest[i] = ph < 0.5 ? 1 : -1;
            ph += step;
            if (ph >= 1) ph -= 1;
        }
        this._phase = ph;
        return frames;
    }

    getState() { return { gate: this.gate, data: this.data }; }

    setState(s) { this.gate = s.gate | 0; this.data = s.data | 0; }
}

export default PCSpeaker;
