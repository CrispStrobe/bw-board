/**
 * The audio bus — one mixer and one ring buffer, shared by every tier.
 *
 * E6.8.11a gave the engine a second audio contract: `audioTone()` says what a
 * chip is CONFIGURED to produce, and `renderAudio(dest, frames, sampleRate)`
 * says what it SOUNDS like. This module is what turns several producers of
 * the second kind into one stream a host can play.
 *
 * IT IS SHARED ON PURPOSE. The 8086, Z80 and 6502 tiers all need exactly this
 * and three copies would diverge — a contract is only worth having if the
 * thing consuming it is one thing. Nothing in here knows what a CPU is.
 *
 * TIME IS EMULATED, NOT WALL. This is the design's load-bearing decision and
 * it comes from a measurement rather than from convention: `bench-i8086.mjs`
 * puts this engine at 0.7x-1.4x real time on a real DOS boot, jittering run
 * to run. A bus driven by wall time would ask for the wrong number of frames
 * on almost every call. So the machine tells the bus how far EMULATED time
 * has advanced, the bus renders exactly that much audio, and the ring absorbs
 * the difference between that and the rate the host drains at.
 *
 * TWO THINGS ARE COUNTED RATHER THAN SWALLOWED, in the style of the DOS
 * layer's refusal histogram:
 *
 *   - UNDERRUN. The host asked for more than the emulator has produced.
 *     Padding with silence is unavoidable — the alternative is a worse noise
 *     — but hiding it is not, so `stats.underruns` counts the frames that
 *     were invented. A number somebody can read beats a glitch somebody
 *     notices.
 *   - STARVED. A source supplied fewer frames than it was asked for. Added
 *     after the AY proved it was needed: the shortfall used to be padded
 *     silently, the ring filled normally, `read()` never underran, and the
 *     only symptom was a frequency that came out wrong for no visible
 *     reason. Silence mixed INLINE between real samples corrupts the pitch of
 *     what remains rather than merely thinning it.
 *   - CLIP. Several sources summing past full scale are clamped, and
 *     `stats.clipped` counts the samples. "The mix is distorting" should be
 *     a fact you can assert on, not a thing you hear.
 *
 * TWO KINDS OF PRODUCER, AND THE SECOND ONE CHANGED THIS CONTRACT. The first
 * draft assumed every source could render on demand, which is true of a chip
 * whose output is DERIVED — `pc-speaker.js` has no counters of its own, it
 * reads a divisor and computes a square wave, so it can produce any interval
 * at any time. The AY-3-8912 is the other kind: it is clocked by the machine
 * at chip rate and its audible output IS its internal counter state, already
 * being computed and thrown away. Such a chip cannot render on demand,
 * because by the time the host asks, the waveform has already happened; and
 * it must not be re-clocked by the renderer either, or it advances twice.
 *
 * So a source may implement `prepareAudio(sampleRate)`. The bus calls it on
 * attach with the rate and on detach with 0, and a chip of the second kind
 * uses it to arm a decimator that accumulates as it is clocked and to disarm
 * when nobody is listening. `renderAudio` then DRAINS what was accumulated
 * rather than generating it. Sources of the first kind do not implement it.
 *
 * That distinction was found by writing the second producer, which is exactly
 * what the second producer was for.
 *
 * NO ATTENUATION IS APPLIED PER SOURCE. A PC speaker is one bit driving a
 * cone and renders at ±1 because that is what it does; a chip that
 * pre-attenuated itself would be guessing how many other chips exist. The
 * bus owns headroom, because the bus is the only thing that knows.
 *
 * @module
 */

/** The default host rate. Web Audio picks its own; this is for tests. */
const DEFAULT_RATE = 48000;

export class AudioBus {
    /**
     * @param {{ sampleRate?: number, ringMs?: number, headroom?: number }} [opts]
     *   `ringMs` is how much emulated audio may run ahead of the host before
     *   the bus stops rendering — the jitter budget. 200 ms is about a dozen
     *   frames at 60 Hz, which is enough to ride out the 0.7x-1.4x spread we
     *   measured without adding latency anyone can hear.
     */
    constructor(opts = {}) {
        this.sampleRate = opts.sampleRate ?? DEFAULT_RATE;
        this.headroom = opts.headroom ?? 1;
        const ringMs = opts.ringMs ?? 200;
        this._ring = new Float32Array(Math.max(2, Math.ceil(this.sampleRate * ringMs / 1000)));
        this._sources = [];
        this._scratch = new Float32Array(1024);
        this.reset();
    }

    reset() {
        this._ring.fill(0);
        this._head = 0;          // where the emulator writes
        this._tail = 0;          // where the host reads
        this._filled = 0;        // frames available
        this._carry = 0;         // fractional frames owed from the last advance
        this._lastMs = null;
        this.stats = { underruns: 0, clipped: 0, rendered: 0, dropped: 0, starved: 0 };
    }

    /**
     * Anything with renderAudio(dest, frames, sampleRate).
     *
     * `prepareAudio(sampleRate)` IS CALLED HERE IF THE SOURCE HAS ONE, and
     * the reason is a finding rather than a convenience — see the module
     * header's note on the two kinds of producer. A chip whose output is
     * PRODUCED BY ITS OWN CLOCK cannot render on demand: by the time the host
     * asks, the waveform has already happened. Such a chip has to accumulate
     * as it is clocked, which means it must know the output rate BEFORE the
     * first clock, not at the first render.
     */
    addSource(src) {
        if (src && typeof src.renderAudio === 'function' && !this._sources.includes(src)) {
            src.prepareAudio?.(this.sampleRate);
            this._sources.push(src);
        }
        return this;
    }

    removeSource(src) {
        const i = this._sources.indexOf(src);
        if (i >= 0) {
            this._sources.splice(i, 1);
            // Disarm, so a chip that accumulates while clocked stops paying
            // for an audience that has left. Same rule as the write trap and
            // the E6.8.3 hooks: present only while something is watching.
            src.prepareAudio?.(0);
        }
        return this;
    }

    /** True when anything is attached — the caller's cue to skip advance(). */
    get active() { return this._sources.length > 0; }

    /** Frames currently buffered, and how much room is left. */
    get available() { return this._filled; }

    /**
     * Emulated time has reached `tMs`. Render the audio for the interval
     * since the last call.
     *
     * THE FIRST CALL RENDERS NOTHING, deliberately: it establishes the origin.
     * A machine that has been running for ten seconds before anything listens
     * would otherwise be asked for ten seconds of audio in one go, which is
     * both a spike and wrong — nobody was listening then.
     */
    advance(tMs) {
        if (this._lastMs === null) { this._lastMs = tMs; return 0; }
        let dtMs = tMs - this._lastMs;
        this._lastMs = tMs;
        // Time going backwards means a reset or a state restore. Re-anchor
        // rather than rendering a negative interval.
        if (!(dtMs > 0)) return 0;
        if (!this._sources.length) return 0;

        const exact = dtMs * this.sampleRate / 1000 + this._carry;
        let frames = Math.floor(exact);
        this._carry = exact - frames;
        if (frames <= 0) return 0;

        // THE RING IS A BUDGET, NOT A QUEUE. If the emulator has run far
        // ahead of the host, the excess is DROPPED and counted rather than
        // overwriting unread audio — an emulator that is ahead has produced
        // sound nobody will hear in time, and playing it late is worse than
        // not playing it.
        const room = this._ring.length - this._filled;
        if (frames > room) { this.stats.dropped += frames - room; frames = room; }
        if (frames <= 0) return 0;

        if (this._scratch.length < frames) this._scratch = new Float32Array(frames);
        const mix = this._scratch;
        mix.fill(0, 0, frames);

        // Sum every source. Each renders into the scratch tail and is added,
        // so a source that writes fewer frames than asked contributes silence
        // for the rest rather than leaving the previous source's samples.
        const one = new Float32Array(frames);
        for (const src of this._sources) {
            one.fill(0);
            const n = src.renderAudio(one, frames, this.sampleRate) | 0;
            const lim = Math.min(n > 0 ? n : frames, frames);
            for (let i = 0; i < lim; i++) mix[i] += one[i];
            // A SOURCE THAT SUPPLIED LESS THAN IT WAS ASKED FOR IS COUNTED,
            // and this counter was added after a second producer proved it
            // was needed. Without it the shortfall was padded with silence
            // right here and vanished: the ring filled normally, `read()`
            // never underran, and the only symptom was a frequency that came
            // out wrong for no visible reason. Silence mixed INLINE between
            // real samples does not merely lose audio, it corrupts the pitch
            // of what remains — so this is the difference between a defect
            // that announces itself and one that sounds like a broken chip.
            if (lim < frames) this.stats.starved += frames - lim;
        }

        const h = this.headroom;
        for (let i = 0; i < frames; i++) {
            let v = mix[i] * h;
            if (v > 1) { v = 1; this.stats.clipped++; } else if (v < -1) { v = -1; this.stats.clipped++; }
            this._ring[this._head] = v;
            this._head = (this._head + 1) % this._ring.length;
        }
        this._filled += frames;
        this.stats.rendered += frames;
        return frames;
    }

    /**
     * The host drains. Always writes `frames` samples — padding with silence
     * when the emulator has not kept up, and COUNTING what it invented.
     * @returns {number} frames of real audio (the rest of `dest` is padding)
     */
    read(dest, frames) {
        const have = Math.min(frames, this._filled);
        for (let i = 0; i < have; i++) {
            dest[i] = this._ring[this._tail];
            this._tail = (this._tail + 1) % this._ring.length;
        }
        this._filled -= have;
        if (have < frames) {
            dest.fill(0, have, frames);
            this.stats.underruns += frames - have;
        }
        return have;
    }
}

export default AudioBus;
