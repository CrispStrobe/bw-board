/**
 * AY-3-8912 — General Instrument PSG (Programmable Sound Generator),
 * the 128K Spectrum's sound chip. Clean-room from the GI AY-3-8910/
 * 8912/8913 datasheet.
 *
 * 16 registers selected via an address/data port pair:
 *   R0/R1   Tone period channel A (12-bit, R1 upper 4)
 *   R2/R3   Tone period channel B
 *   R4/R5   Tone period channel C
 *   R6      Noise period (5-bit)
 *   R7      Mixer: bits 0-2 tone disable A/B/C, bits 3-5 noise disable
 *   R8      Volume A (4-bit + bit 4 = envelope mode)
 *   R9      Volume B
 *   R10     Volume C
 *   R11/R12 Envelope period (16-bit)
 *   R13     Envelope shape (attack, alternate, hold)
 *   R14/R15 I/O ports (unused on the 8912 single-port variant)
 *
 * Port decode for the 128K Spectrum (from the schematic):
 *   A15=1, A14=1 → $FFFD: address select (active when A1=0)
 *   A15=1, A14=0 → $BFFD: data write
 * The machine.js `out` handler does the decode; the chip sees only
 * select(reg) and write(val)/read().
 *
 * advance(cycles) clocks tone counters at clock/16 (the AY's internal
 * divider); each counter halves its period into a square wave.
 *
 * audioTone() returns per-channel {hz, on, vol} mirroring ULA.audioTone —
 * the face summary a visualiser or audio renderer consumes.
 *
 * @module
 */

const NUM_REGS = 16;

export class AY38912 {
    /**
     * @param {{ clockHz?: number }} [opts] AY clock input — on the 128K
     *   Spectrum this is the CPU clock (3.5469 MHz), not half.
     */
    constructor({ clockHz = 3_546_900 } = {}) {
        this.clockHz = clockHz;
        /** @type {Uint8Array} the 16 registers */
        this.regs = new Uint8Array(NUM_REGS);
        this.regs[7] = 0x3f; // mixer: all disabled at reset
        this._selected = 0;
        // Tone counters: 12-bit period down-counters, output flip-flops
        this._toneCount = [0, 0, 0];
        this._toneOut = [0, 0, 0];
        // Noise counter
        this._noiseCount = 0;
        this._noiseOut = 0;
        this._noiseLfsr = 1; // 17-bit LFSR, seed 1
        // Envelope counter
        this._envCount = 0;
        this._envStep = 0;
        this._envHolding = false;
        // Clock accumulator (system clock → AY internal clock/16)
        this._acc = 0;
    }

    /** Select the register for the next read/write. */
    select(reg) { this._selected = reg & 0x0f; }

    /** Read the currently selected register. */
    read() { return this.regs[this._selected]; }

    /** Write to the currently selected register. */
    write(val) {
        val &= 0xff;
        const r = this._selected;
        if (r >= NUM_REGS) return;
        // Mask writable bits per register
        switch (r) {
            case 1: case 3: case 5: val &= 0x0f; break; // tone high: 4 bits
            case 6: val &= 0x1f; break;                  // noise: 5 bits
            case 8: case 9: case 10: val &= 0x1f; break; // volume: 5 bits (4+M)
            case 13:                                       // envelope shape: trigger reset
                this._envStep = 0;
                this._envCount = this._envPeriod();
                this._envHolding = false;
                break;
        }
        this.regs[r] = val;
    }

    // ── Period helpers ─────────────────────────────────────────────

    _tonePeriod(ch) {
        return (this.regs[ch * 2] | ((this.regs[ch * 2 + 1] & 0x0f) << 8)) || 1;
    }

    _noisePeriod() { return (this.regs[6] & 0x1f) || 1; }

    _envPeriod() { return (this.regs[11] | (this.regs[12] << 8)) || 1; }

    // ── Clock advance ─────────────────────────────────────────────

    /**
     * Advance by system-clock cycles. The AY internally divides by 16.
     * @param {number} cycles
     */
    /** Never asserts an interrupt: a halted CPU cannot be woken here,
     *  and bulk advance is already the per-instruction norm. */
    nextWake() { return Infinity; }

    advance(cycles) {
        this._acc += cycles;
        const div = 16;
        while (this._acc >= div) {
            this._acc -= div;
            this._tick();
        }
    }

    /** One AY internal clock tick (clock/16). */
    _tick() {
        // Tone counters
        for (let ch = 0; ch < 3; ch++) {
            if (--this._toneCount[ch] <= 0) {
                this._toneCount[ch] = this._tonePeriod(ch);
                this._toneOut[ch] ^= 1;
            }
        }
        // Noise counter
        if (--this._noiseCount <= 0) {
            this._noiseCount = this._noisePeriod();
            // 17-bit LFSR: tap bits 0 and 3, XOR into bit 16
            const bit = ((this._noiseLfsr ^ (this._noiseLfsr >> 3)) & 1);
            this._noiseLfsr = ((this._noiseLfsr >> 1) | (bit << 16)) & 0x1ffff;
            this._noiseOut = this._noiseLfsr & 1;
        }
        // Envelope counter
        if (!this._envHolding) {
            if (--this._envCount <= 0) {
                this._envCount = this._envPeriod();
                this._envStep++;
                const shape = this.regs[13] & 0x0f;
                if (this._envStep >= 16) {
                    // Cycle/hold logic from the datasheet shape table
                    const cont = shape & 0x08;
                    const hold = shape & 0x01;
                    if (!cont) { this._envStep = 0; this._envHolding = true; }
                    else if (hold) { this._envStep = 15; this._envHolding = true; }
                    else { this._envStep = 0; } // cycling
                }
            }
        }
    }

    // ── Mixer output ──────────────────────────────────────────────

    /**
     * Is channel ch currently producing output?
     * Mixer combines tone enable, noise enable, and the flip-flop states.
     */
    _channelOn(ch) {
        const mixer = this.regs[7];
        const toneDisable = (mixer >> ch) & 1;
        const noiseDisable = (mixer >> (ch + 3)) & 1;
        const toneVal = toneDisable ? 1 : this._toneOut[ch];
        const noiseVal = noiseDisable ? 1 : this._noiseOut;
        return (toneVal & noiseVal) !== 0;
    }

    /** Channel volume (0-15), accounting for envelope mode. */
    _channelVol(ch) {
        const v = this.regs[8 + ch];
        if (v & 0x10) {
            // Envelope mode: use the envelope step as volume
            const shape = this.regs[13] & 0x0f;
            const attack = shape & 0x04;
            return attack ? this._envStep : (15 - this._envStep);
        }
        return v & 0x0f;
    }

    // ── Face summary ──────────────────────────────────────────────

    /**
     * Per-channel {hz, on, vol} — the face-consumable audio summary,
     * mirroring zx-ula.js audioTone(). hz is the tone frequency, on is
     * true when the channel is audible (tone or noise enabled AND volume
     * non-zero), vol is 0-15.
     */
    audioTone() {
        const out = [];
        for (let ch = 0; ch < 3; ch++) {
            const period = this._tonePeriod(ch);
            // Frequency = clockHz / (16 * period * 2) — the /2 is the
            // flip-flop halving the counter output.
            const hz = Math.round(this.clockHz / (16 * period * 2));
            const vol = this._channelVol(ch);
            const mixer = this.regs[7];
            const toneEnabled = !((mixer >> ch) & 1);
            const noiseEnabled = !((mixer >> (ch + 3)) & 1);
            const on = (toneEnabled || noiseEnabled) && vol > 0;
            out.push({ hz, on, vol });
        }
        return out;
    }

    // ── Snapshot ───────────────────────────────────────────────────

    saveState() {
        return {
            regs: Array.from(this.regs),
            _selected: this._selected,
            _toneCount: [...this._toneCount],
            _toneOut: [...this._toneOut],
            _noiseCount: this._noiseCount,
            _noiseOut: this._noiseOut,
            _noiseLfsr: this._noiseLfsr,
            _envCount: this._envCount,
            _envStep: this._envStep,
            _envHolding: this._envHolding,
            _acc: this._acc,
        };
    }

    loadState(s) {
        this.regs.set(s.regs);
        this._selected = s._selected;
        this._toneCount = [...s._toneCount];
        this._toneOut = [...s._toneOut];
        this._noiseCount = s._noiseCount;
        this._noiseOut = s._noiseOut;
        this._noiseLfsr = s._noiseLfsr;
        this._envCount = s._envCount;
        this._envStep = s._envStep;
        this._envHolding = s._envHolding;
        this._acc = s._acc;
    }
}

export default AY38912;
