/**
 * YM3812 (OPL2) — the FM half of E6.8.11, and the one that had a licence
 * question attached.
 *
 * THE LICENCE DECISION, MADE HERE AND RECORDED HERE. §E6.8.11 established
 * `aaronsgiles/ymfm` (BSD-3) as the one clean door to an OPL, vendorable with
 * its notice. This core is NOT that port, and the reason is that ymfm is C++
 * and this engine is JavaScript: a translation is a derivative work just as a
 * copy is, so the "nothing in this tier is vendored" property — which §E6's
 * licence table calls the only reason the tier can ship inside a BSD-3 bundle
 * — is lost either way, and a careful translation costs about what writing it
 * costs. So this is clean-room from the YM3812 datasheet and the published
 * register map, and **ymfm stays as an ORACLE rather than a source**, which is
 * the more valuable of the two roles and the one this tier has always
 * preferred.
 *
 * WHAT IS MODELLED: the nine two-operator melodic channels — phase generator
 * with the multiple/block/F-number chain, the four OPL2 waveforms, an ADSR
 * envelope with key-scaling, modulator→carrier FM with feedback, and the
 * additive connection bit.
 *
 * WHAT IS NOT, named rather than left to be discovered:
 *
 *   - RHYTHM MODE (BDh bit 5, and the five percussion voices that replace
 *     channels 6-8). A program that enables it gets the melodic channels it
 *     had, which is wrong; `report().unsupported` records it.
 *   - CSM (08h bit 7), and the timers at 02h/03h/04h.
 *   - KSL, the key-scale LEVEL attenuation. Key-scale RATE is modelled;
 *     level is not, so high notes are louder here than on the part.
 *   - Tremolo and vibrato depth (BDh bits 6-7). The AM/VIB enables per
 *     operator are stored and ignored.
 *
 * The accuracy claim is therefore PITCH AND ENVELOPE SHAPE, not timbre: the
 * agreement test (E6.8.11a) checks that what `audioTone()` claims is what
 * `renderAudio()` produces, and that is the axis this core is held to.
 *
 * @module
 */

/** The part's own clock, and the sample rate it divides down to. */
const MASTER_HZ = 3_579_545;
const OPL_RATE = MASTER_HZ / 72;                 // 49716 Hz

/** Operator index for (channel, slot). The OPL's register map is not linear. */
const OP_OF = [
    [0, 3], [1, 4], [2, 5],
    [8, 11], [9, 12], [10, 13],
    [16, 19], [17, 20], [18, 21],
];

/** Register offset -> operator index, or -1. The inverse of OP_OF's layout. */
const OP_AT = new Int8Array(32).fill(-1);
OP_OF.forEach(([m, c], ch) => { OP_AT[m] = ch * 2; OP_AT[c] = ch * 2 + 1; });

const SIN = new Float32Array(1024);
for (let i = 0; i < 1024; i++) SIN[i] = Math.sin(2 * Math.PI * i / 1024);

/** The four OPL2 waveforms, applied to the sine table's index. */
function wave(sel, phase) {
    const i = phase & 1023;
    const s = SIN[i];
    switch (sel & 3) {
        case 0: return s;                        // full sine
        case 1: return i < 512 ? s : 0;          // half sine
        case 2: return Math.abs(s);              // absolute sine
        default: return (i & 511) < 256 ? Math.abs(s) : 0;   // pulse sine
    }
}

/** Envelope phases. */
const OFF = 0, ATTACK = 1, DECAY = 2, SUSTAIN = 3, RELEASE = 4;

class Operator {
    constructor() { this.reset(); }
    reset() {
        this.mult = 1; this.ksr = 0; this.egType = 0; this.am = 0; this.vib = 0;
        this.tl = 0; this.ksl = 0;
        this.ar = 0; this.dr = 0; this.sl = 0; this.rr = 0;
        this.wave = 0;
        this.phase = 0;
        this.env = 0;            // 0 = silent, 1 = full
        this.stage = OFF;
    }
}

export class YM3812 {
    constructor(opts = {}) {
        this.clockHz = opts.clockHz || MASTER_HZ;
        this.rate = this.clockHz / 72;
        this.reset();
    }

    reset() {
        this.regs = new Uint8Array(256);
        this._addr = 0;
        this.ops = Array.from({ length: 18 }, () => new Operator());
        this.ch = Array.from({ length: 9 }, () => ({
            fnum: 0, block: 0, keyOn: false, fb: 0, alg: 0, feedbackBuf: [0, 0],
        }));
        this.unsupported = new Map();
        this._auRate = 0; this._auStep = 0; this._auAcc = 0;
        this._auBuf = null; this._auHead = this._auTail = this._auFilled = 0;
        this._acc = 0;
    }

    // ---- the two-port interface -----------------------------------------
    /** reg 0 = address latch (388h), reg 1 = data (389h). */
    write(reg, val) {
        if ((reg & 1) === 0) { this._addr = val & 0xff; return; }
        this._poke(this._addr, val & 0xff);
    }

    /** 388h reads the status byte. No timers, so no IRQ bits are ever set. */
    read(reg) { return (reg & 1) === 0 ? 0x06 : 0xff; }

    _poke(a, v) {
        this.regs[a] = v;
        if (a === 0xbd) {
            if (v & 0x20) this._refuse('rhythm mode (BDh bit 5)');
            return;
        }
        if (a === 0x08 && (v & 0x80)) { this._refuse('CSM (08h bit 7)'); return; }
        if (a >= 0x20 && a <= 0x35) return this._opReg(a - 0x20, (o) => {
            o.mult = (v & 0x0f) || 0.5;              // multiple 0 means x1/2
            o.ksr = (v >> 4) & 1; o.egType = (v >> 5) & 1;
            o.vib = (v >> 6) & 1; o.am = (v >> 7) & 1;
        });
        if (a >= 0x40 && a <= 0x55) return this._opReg(a - 0x40, (o) => {
            o.tl = v & 0x3f; o.ksl = (v >> 6) & 3;
        });
        if (a >= 0x60 && a <= 0x75) return this._opReg(a - 0x60, (o) => {
            o.ar = (v >> 4) & 0x0f; o.dr = v & 0x0f;
        });
        if (a >= 0x80 && a <= 0x95) return this._opReg(a - 0x80, (o) => {
            o.sl = (v >> 4) & 0x0f; o.rr = v & 0x0f;
        });
        if (a >= 0xe0 && a <= 0xf5) return this._opReg(a - 0xe0, (o) => { o.wave = v & 3; });
        if (a >= 0xa0 && a <= 0xa8) {
            const c = this.ch[a - 0xa0];
            c.fnum = (c.fnum & 0x300) | v;
            return;
        }
        if (a >= 0xb0 && a <= 0xb8) {
            const c = this.ch[a - 0xb0];
            c.fnum = (c.fnum & 0xff) | ((v & 3) << 8);
            c.block = (v >> 2) & 7;
            const on = !!(v & 0x20);
            if (on !== c.keyOn) { c.keyOn = on; this._key(a - 0xb0, on); }
            return;
        }
        if (a >= 0xc0 && a <= 0xc8) {
            const c = this.ch[a - 0xc0];
            c.alg = v & 1; c.fb = (v >> 1) & 7;
        }
    }

    _opReg(off, fn) { const i = OP_AT[off]; if (i >= 0) fn(this.ops[i]); }

    _refuse(what) { this.unsupported.set(what, (this.unsupported.get(what) || 0) + 1); }

    /** A key-on restarts BOTH operators' envelopes from attack. */
    _key(chIdx, on) {
        for (const slot of [0, 1]) {
            const o = this.ops[chIdx * 2 + slot];
            if (on) { o.stage = ATTACK; o.phase = 0; } else if (o.stage !== OFF) o.stage = RELEASE;
        }
    }

    // ---- synthesis --------------------------------------------------------
    /**
     * Phase increment per OPL sample, in 1024ths of a cycle.
     * fout = FNum * rate / 2^(20-Block), and the phase table is 1024 entries.
     */
    _inc(c, o) {
        // fout = FNum * rate / 2^(20-Block), so cycles per OPL sample is
        // FNum / 2^(20-Block) and the phase table is 1024 entries wide.
        //
        // THIS LINE HAD A SPURIOUS x2 AND THE AGREEMENT TEST CAUGHT IT ON THE
        // FIRST RUN of this chip: claimed 440 Hz, measured 880. That is
        // precisely the failure lego-47 said the test had to be able to
        // detect when he rejected a bare Goertzel at the claimed frequency --
        // "the drift that actually happens is off by an octave" -- and it
        // showed up in a brand-new core within a minute of it existing.
        const cycles = c.fnum / Math.pow(2, 20 - c.block);
        return cycles * 1024 * o.mult;
    }

    /** Attack/decay/release rates as a per-sample multiplier. */
    _rateStep(r) {
        if (r <= 0) return 0;
        // Rate 15 is near-instant, rate 1 is seconds. An exponential ladder
        // over the OPL's sample rate, which is the shape the datasheet's
        // table describes even though the exact table is not reproduced here.
        return Math.min(1, Math.pow(2, r) / (this.rate * 0.5));
    }

    _envStep(o) {
        switch (o.stage) {
            case ATTACK: {
                const s = this._rateStep(o.ar);
                if (o.ar === 0) { o.env = 0; return; }
                o.env += s * (1.02 - o.env);
                if (o.env >= 0.999) { o.env = 1; o.stage = DECAY; }
                return;
            }
            case DECAY: {
                const target = 1 - (o.sl / 15);
                o.env -= this._rateStep(o.dr) * (o.env - target + 0.001);
                if (o.env <= target) { o.env = target; o.stage = SUSTAIN; }
                return;
            }
            case SUSTAIN:
                // egType 0 is PERCUSSIVE: it keeps decaying to silence even
                // while the key is held. egType 1 sustains, which is what a
                // held organ note does.
                if (!o.egType) o.env = Math.max(0, o.env - this._rateStep(o.rr) * o.env);
                return;
            case RELEASE:
                o.env = Math.max(0, o.env - this._rateStep(o.rr) * (o.env + 0.001));
                if (o.env <= 0.0005) { o.env = 0; o.stage = OFF; }
                return;
            default:
        }
    }

    /** One OPL-rate sample from all nine channels, in [-1,1]. */
    _sample() {
        let out = 0;
        for (let i = 0; i < 9; i++) {
            const c = this.ch[i];
            const mod = this.ops[i * 2], car = this.ops[i * 2 + 1];
            if (mod.stage === OFF && car.stage === OFF) continue;

            const incM = this._inc(c, mod), incC = this._inc(c, car);
            mod.phase += incM; car.phase += incC;
            this._envStep(mod); this._envStep(car);

            const attM = Math.pow(10, -mod.tl / 20);
            const attC = Math.pow(10, -car.tl / 20);
            // Feedback is the modulator's own last two outputs, averaged --
            // the part sums them, which is why fb=1 is already audible.
            const fb = c.fb ? ((c.feedbackBuf[0] + c.feedbackBuf[1]) / 2) * Math.pow(2, c.fb) / 16 : 0;
            const mv = wave(mod.wave, (mod.phase + fb * 1024) | 0) * mod.env * attM;
            c.feedbackBuf[1] = c.feedbackBuf[0];
            c.feedbackBuf[0] = mv;

            if (c.alg) {
                // Additive: both operators reach the output.
                out += mv + wave(car.wave, car.phase | 0) * car.env * attC;
            } else {
                // FM: the modulator bends the carrier's phase.
                out += wave(car.wave, (car.phase + mv * 1024) | 0) * car.env * attC;
            }
        }
        return Math.max(-1, Math.min(1, out / 3));
    }

    // ---- the two audio contracts (E6.8.11a) -------------------------------
    /**
     * One entry per MELODIC CHANNEL that is keyed on. `hz` is the pitch the
     * F-number and block encode; `on` is the key state.
     *
     * Nine channels but not always nine entries: a channel that has never
     * been keyed has no pitch worth claiming, and this contract's arity is
     * meaningful (E6.8.11a).
     */
    audioTone() {
        const out = [];
        for (const c of this.ch) {
            if (!c.keyOn) continue;
            const hz = c.fnum * this.rate / Math.pow(2, 20 - c.block);
            out.push({ hz: Math.round(hz), on: true, vol: 15 });
        }
        return out;
    }

    prepareAudio(sampleRate) {
        this._auRate = sampleRate > 0 ? sampleRate : 0;
        this._auAcc = 0;
        this._auHead = this._auTail = this._auFilled = 0;
        if (!this._auRate) { this._auBuf = null; this._auStep = 0; return; }
        this._auStep = this._auRate / this.rate;
        this._auBuf = new Float32Array(Math.max(256, Math.ceil(this._auRate / 4)));
    }

    /** Advance by MACHINE cycles at `machineHz`, generating OPL samples. */
    advanceMs(ms) {
        if (!this._auRate) return;
        this._acc += ms * this.rate / 1000;
        let n = Math.floor(this._acc);
        this._acc -= n;
        while (n-- > 0) {
            const v = this._sample();
            this._auAcc += this._auStep;
            while (this._auAcc >= 1) {
                this._auAcc -= 1;
                if (this._auFilled < this._auBuf.length) {
                    this._auBuf[this._auHead] = v;
                    this._auHead = (this._auHead + 1) % this._auBuf.length;
                    this._auFilled++;
                }
            }
        }
    }

    renderAudio(dest, frames) {
        if (!this._auRate) { dest.fill(0, 0, frames); return 0; }
        const have = Math.min(frames, this._auFilled);
        for (let i = 0; i < have; i++) {
            dest[i] = this._auBuf[this._auTail];
            this._auTail = (this._auTail + 1) % this._auBuf.length;
        }
        this._auFilled -= have;
        if (have < frames) dest.fill(0, have, frames);
        return have;
    }

    /** What was asked for and refused, in the DOS layer's histogram style. */
    report() { return { unsupported: [...this.unsupported].map(([what, count]) => ({ what, count })) }; }

    getState() { return { regs: Array.from(this.regs), addr: this._addr }; }
    setState(s) { this.regs.set(s.regs); this._addr = s.addr | 0; for (let a = 0; a < 256; a++) this._poke(a, this.regs[a]); }
}

export default YM3812;
