/**
 * Sound Blaster DSP — the DIGITAL half of E6.8.11's audio, and the half that
 * needed no licence decision at all.
 *
 * The FM half (an OPL2) is where the licences bite and where `ymfm` (BSD-3)
 * is the one clean door. This is the other half, and it turned out to be
 * nearly free because its hard part was already built: a Sound Blaster's DSP
 * is a port/command state machine that moves bytes with **8237 DMA channel 1**
 * and raises an **8259 IRQ** at the end of a block, and both of those exist
 * here and already move real bytes — `test/dos-boot-fdc.test.mjs` proves the
 * DMA path against an independent one.
 *
 * Clean-room from Creative's own *Sound Blaster Hardware Programming Guide*,
 * which is a specification to implement from rather than code to copy.
 *
 * WHAT IT IS AND IS NOT. This is an SB 1.x/2.0-class 8-bit mono DSP: reset
 * handshake, time constant, speaker gate, direct DAC, single-cycle and
 * auto-init 8-bit DMA output, pause/continue, and the version query. It is
 * NOT a 16-bit SB16, has no mixer, no ADC (input is refused by name rather
 * than answered with silence), and no FM — the OPL is a separate chip at
 * 388h and a separate decision.
 *
 * THE FIRST PRODUCER WITH NO TONE. `audioTone()` returns an EMPTY ARRAY, and
 * that is not an oversight — a PCM device has a sample RATE, not a pitch, and
 * there is no frequency it could honestly claim. This is the case the arity
 * rule was sharpened for (E6.8.11a): an empty array means NO VOICES, which is
 * exactly right here and is distinguishable from `[{on:false}]`, a voice that
 * happens to be silent. It also proves the two contracts are genuinely
 * independent rather than one being derivable from the other.
 *
 * @module
 */

import {noteRefusal} from './chip-ledger.js';

/** Ports, as offsets from the base (220h on a stock card). */
const R_RESET = 0x6;
const R_READ = 0xa;
const R_WRITE = 0xc;          // command/data in; bit 7 of a READ is "busy"
const R_RSTATUS = 0xe;        // bit 7 = data available; reading it acks the IRQ

/** A byte the DSP hands back after a successful reset. */
const RESET_OK = 0xaa;

export class SBDSP {
    /**
     * @param {{ clockHz?: number, version?: [number, number] }} [opts]
     *   `clockHz` is the MACHINE clock, because `advance()` is handed machine
     *   cycles — the AY's own crystal taught this tier to be explicit about
     *   which clock a chip is counting (see m6502-machine.js's ayRatio).
     */
    constructor(opts = {}) {
        this.clockHz = opts.clockHz || 4_772_727;
        this.version = opts.version || [2, 1];
        this.hooks = { onDmaRequest: null, onIrq: null };
        this.reset();
    }

    reset() {
        this._resetLatch = 0;
        this._out = [];              // bytes the CPU may read back
        this._cmd = null;            // command awaiting its operands
        this._args = [];
        this._need = 0;
        this.speaker = false;        // D1h/D3h — the output gate
        this.timeConstant = 0;
        this.blockLen = 0;           // programmed length-1 (48h / 14h)
        this.remaining = 0;
        this.autoInit = false;
        this.paused = false;
        this.running = false;
        this.irq = false;
        this._acc = 0;               // machine cycles owed to the sample clock
        this._last = 0x80;           // last byte fetched; 80h is silence, unsigned
        this._auRate = 0;
        this._auStep = 0;
        this._auAcc = 0;
        this._auBuf = null;
        this._auHead = this._auTail = this._auFilled = 0;
    }

    /**
     * Samples per second, from the time constant.
     *
     * THE FORMULA IS 1000000 / (256 - tc) AND THE DIVISION IS THE TRAP: a
     * time constant of 256 would divide by zero, and the register is a byte,
     * so tc is at most 255 and the rate at most 1 MHz. A tc of 0 means
     * 1000000/256 = 3906 Hz, the slowest the card can go — not "unset".
     */
    get sampleRate() {
        return Math.round(1_000_000 / (256 - (this.timeConstant & 0xff)));
    }

    // ---- the port interface --------------------------------------------
    read(reg) {
        switch (reg & 0xf) {
            case R_READ: {
                const v = this._out.length ? this._out.shift() : 0xff;
                return v & 0xff;
            }
            // Bit 7 CLEAR means "ready for a command". This DSP is never busy
            // -- it has no internal delay worth modelling -- so the low bits
            // read high like the undriven lines they are.
            case R_WRITE: return 0x7f;
            case R_RSTATUS: {
                const v = this._out.length ? 0xff : 0x7f;
                // READING THIS PORT ACKNOWLEDGES THE INTERRUPT on an SB 1.x/2.0.
                // A driver's ISR does exactly this and nothing else, so a DSP
                // that ignored the read would re-raise on the next block and
                // the machine would live in its own handler.
                this.irq = false;
                return v;
            }
            default: return 0xff;
        }
    }

    write(reg, val) {
        const v = val & 0xff;
        switch (reg & 0xf) {
            case R_RESET:
                // The handshake is a 1 then a 0. Only the falling edge counts,
                // which is why a driver that writes 1 twice still gets one
                // reset and not two.
                if (v & 1) { this._resetLatch = 1; return; }
                if (this._resetLatch) {
                    this._resetLatch = 0;
                    const hooks = this.hooks;
                    this.reset();
                    this.hooks = hooks;
                    this._out.push(RESET_OK);
                }
                return;
            case R_WRITE:
                if (this._need > 0) {
                    this._args.push(v);
                    if (--this._need === 0) { this._exec(this._cmd, this._args); this._cmd = null; }
                    return;
                }
                this._begin(v);
                return;
            default:
        }
    }

    /** How many operand bytes a command takes, or -1 for "not ours". */
    _operands(cmd) {
        switch (cmd) {
            case 0x10: return 1;                 // direct DAC write
            case 0x14: return 2;                 // 8-bit single-cycle DMA output
            case 0x1c: return 0;                 // 8-bit auto-init DMA output
            case 0x40: return 1;                 // set time constant
            case 0x48: return 2;                 // set block size
            case 0xd0: case 0xd1: case 0xd3: case 0xd4: case 0xda: return 0;
            case 0xe1: return 0;                 // DSP version
            default: return -1;
        }
    }

    _begin(cmd) {
        const n = this._operands(cmd);
        if (n < 0) {
            // AN UNKNOWN COMMAND IS RECORDED, NOT SWALLOWED -- the DOS layer's
            // refusal histogram habit. A driver using an SB16 command on a
            // 2.0 card should be visible as a name, not as silence.
            noteRefusal(this.unsupported ||= new Map(),
                `DSP command ${cmd.toString(16).padStart(2, '0')}h`, {
                    symptom: 'the byte was consumed and nothing was produced: no '
                        + 'sample plays and no status comes back, so a driver '
                        + 'polling the read port sees whatever the last real '
                        + 'command left there',
                    at: R_WRITE,
                });
            return;
        }
        if (n === 0) { this._exec(cmd, []); return; }
        this._cmd = cmd; this._args = []; this._need = n;
    }

    _exec(cmd, a) {
        switch (cmd) {
            case 0x10:                                   // direct DAC: one sample, now
                this._last = a[0] & 0xff;
                this._emit(this._last);
                return;
            case 0x40: this.timeConstant = a[0] & 0xff; return;
            case 0x48: this.blockLen = (a[0] | (a[1] << 8)) & 0xffff; return;
            case 0x14:
                this.blockLen = (a[0] | (a[1] << 8)) & 0xffff;
                this.remaining = this.blockLen + 1;      // the register holds LENGTH-1
                this.autoInit = false;
                this.running = true; this.paused = false;
                return;
            case 0x1c:
                this.remaining = this.blockLen + 1;
                this.autoInit = true;
                this.running = true; this.paused = false;
                return;
            case 0xd0: this.paused = true; return;
            case 0xd1: this.speaker = true; return;
            case 0xd3: this.speaker = false; return;
            case 0xd4: this.paused = false; return;
            case 0xda: this.running = false; this.autoInit = false; return;   // exit auto-init
            case 0xe1: this._out.push(this.version[0], this.version[1]); return;
            default:
        }
    }

    // ---- time ------------------------------------------------------------
    /**
     * Advance by MACHINE cycles, pulling one DMA byte per sample period while
     * a transfer is running.
     *
     * THE RATE IS THE DSP'S, NOT THE MACHINE'S, and the accumulator is a float
     * so a 22050 Hz stream on a 4.77 MHz machine (216.4 cycles per sample)
     * neither rounds to 216 nor drifts. This is the same care the AY's crystal
     * ratio needed, and for the same reason.
     */
    advance(cycles) {
        if (!this.running || this.paused) return;
        const rate = this.sampleRate;
        if (!(rate > 0)) return;
        const perSample = this.clockHz / rate;
        this._acc += cycles;
        while (this._acc >= perSample) {
            this._acc -= perSample;
            if (!this._pull()) break;
        }
    }

    /** One byte from memory via the DMA controller. False when it ends. */
    _pull() {
        if (!this.running) return false;
        const req = this.hooks.onDmaRequest;
        // NO DMA WIRE MEANS NO SOUND, and it is silent rather than a throw --
        // a card in a machine with no 8237 is a real configuration, not an
        // error. It stops running so it does not spin.
        if (typeof req !== 'function') { this.running = false; return false; }
        const byte = req('read');
        if (byte === false || byte === null || byte === undefined) {
            this._endBlock();
            return false;
        }
        this._last = byte & 0xff;
        this._emit(this._last);
        if (--this.remaining <= 0) this._endBlock();
        return this.running;
    }

    _endBlock() {
        this.irq = true;
        if (this.hooks.onIrq) this.hooks.onIrq(true);
        if (this.autoInit) {
            this.remaining = this.blockLen + 1;          // and round it goes
        } else {
            this.running = false;
        }
    }

    // ---- the audio contracts (E6.8.11a) ----------------------------------
    /**
     * NO TONAL VOICES, and that is the honest answer rather than a gap. A PCM
     * device has a sample rate, not a pitch. An empty array means "no voices"
     * -- distinct from `[{on:false}]`, a voice that is silent -- which is the
     * distinction the arity rule exists to make.
     */
    audioTone() { return []; }

    prepareAudio(sampleRate) {
        this._auRate = sampleRate > 0 ? sampleRate : 0;
        this._auAcc = 0;
        this._auHead = this._auTail = this._auFilled = 0;
        if (!this._auRate) { this._auBuf = null; return; }
        this._auBuf = new Float32Array(Math.max(256, Math.ceil(this._auRate / 4)));
    }

    /** One DSP sample, resampled to the host rate by repetition. */
    _emit(byte) {
        if (!this._auRate) return;
        // Unsigned 8-bit, 80h is silence. The speaker gate is a real gate:
        // a card whose speaker is off is still transferring, and a driver
        // that forgets D1h hears nothing on hardware too.
        const v = this.speaker ? (byte - 128) / 128 : 0;
        const rate = this.sampleRate;
        this._auAcc += this._auRate / (rate > 0 ? rate : this._auRate);
        while (this._auAcc >= 1) {
            this._auAcc -= 1;
            if (this._auFilled < this._auBuf.length) {
                this._auBuf[this._auHead] = v;
                this._auHead = (this._auHead + 1) % this._auBuf.length;
                this._auFilled++;
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

    getState() {
        return {
            speaker: this.speaker, timeConstant: this.timeConstant,
            blockLen: this.blockLen, remaining: this.remaining,
            autoInit: this.autoInit, paused: this.paused,
            running: this.running, irq: this.irq, last: this._last,
        };
    }

    setState(s) { Object.assign(this, {
        speaker: !!s.speaker, timeConstant: s.timeConstant | 0,
        blockLen: s.blockLen | 0, remaining: s.remaining | 0,
        autoInit: !!s.autoInit, paused: !!s.paused,
        running: !!s.running, irq: !!s.irq, _last: s.last | 0,
    }); }
}

export default SBDSP;
