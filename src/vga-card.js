/**
 * VGA card — port side only, no pixels. Unlike CGA this is a big register
 * file behind a few index/data port pairs, and the card's job here is to
 * LATCH those registers faithfully so a renderer can (a) identify the mode
 * and (b) read the palette, and to get the two stateful traps right. It does
 * not decode a picture — that is the renderer's, and it only renders mode
 * 13h; everything else it must REFUSE, which is why exposing the mode
 * discriminators matters more than the palette.
 *
 * THE BLOCK is 3C0h-3DFh:
 *   3C0h  attribute controller  — ONE port that alternates index/data under
 *         an internal flip-flop (see the trap below). 3C1h reads data.
 *   3C2h  miscellaneous output  (write; 3CCh reads it)
 *   3C4h/3C5h  sequencer index/data
 *   3C6h  DAC pixel mask
 *   3C7h  DAC read index ; 3C8h DAC write index ; 3C9h DAC data (RGB triples)
 *   3CEh/3CFh  graphics controller index/data
 *   3D4h/3D5h  CRTC index/data
 *   3DAh  input status 1  (bit 0 display-enable, bit 3 vertical retrace)
 *
 * TWO TRAPS, both real and both load-bearing:
 *
 *  1. THE ATTRIBUTE FLIP-FLOP. Writes to 3C0h alternate between selecting an
 *     index and writing that register's data, toggled by an internal
 *     flip-flop. Reading the status register 3DAh RESETS that flip-flop to
 *     the index phase — the documented way a program re-synchronises before
 *     an attribute write. That means a BUS READ of 3DAh has a side effect,
 *     and an observer (a debugger polling retrace) that reads 3DAh would
 *     silently desynchronise the program's next attribute write. So the bus
 *     read keeps the reset (a program depends on it) and observers get a
 *     SIDE-EFFECT-FREE path instead: peekStatus() and getVideoState() never
 *     touch the flip-flop or the DAC sequence. Never wire an observer to
 *     read(0x1A).
 *
 *  2. THE DAC RGB SEQUENCE. A palette entry is three writes to 3C9h — red,
 *     green, blue, each a SIX-BIT value — after a write index in 3C8h (or a
 *     read index in 3C7h); the index auto-increments after the third
 *     component. The six-bit width is the hardware's, and it is also what the
 *     renderer's DAC table wants, so the latch is passed through raw.
 *
 * ACCURACY TIER: THE REGISTERS, NOT THE RASTER. Every register bank (misc,
 * sequencer, graphics controller, CRTC, attribute) is LATCHED faithfully,
 * the attribute-controller flip-flop and its 3DAh-read reset are exact, and
 * the six-bit DAC RGB sequence is exact — so a renderer can read the true
 * configuration and identify the mode. What is NOT here: this card does not
 * INTERPRET the registers (it latches them; the renderer decides what mode
 * they mean and refuses what it cannot draw); NO PIXELS; and the retrace is
 * a fixed 70 Hz FRAME from machine time, NOT computed from the CRTC total
 * registers — reprogramming the CRTC to a tweaked mode does not change the
 * retrace rhythm, which is a cadence, not scanline-exact timing.
 *
 * @module
 */

const FRAME_HZ = 70;              // VGA 320x200/mode 13h timing
const TOTAL_LINES = 449;
const ACTIVE_LINES = 400;         // 200 lines, double-scanned

export class VGACard {
    constructor(clockHz, hooks = {}) {
        this.clockHz = clockHz || 5_000_000;
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.cycles = 0;
        this._frame = Math.max(1, Math.round(this.clockHz / FRAME_HZ));
        this._active = Math.round(this._frame * ACTIVE_LINES / TOTAL_LINES);
        this._lastVretrace = 0;
        this._frameCount = 0;

        this.misc = 0;
        this.seq = new Uint8Array(8);
        this.gc = new Uint8Array(16);
        this.crtc = new Uint8Array(32);
        this.attr = new Uint8Array(32);
        this._seqIndex = 0;
        this._gcIndex = 0;
        this._crtcIndex = 0;
        this._attrIndex = 0;
        this._attrFlipFlop = 0;    // 0 = expecting index, 1 = expecting data

        this.dac = new Uint8Array(768);   // 256 entries x RGB, six-bit values
        this.dacMask = 0xff;
        this._dacWriteIndex = 0;
        this._dacReadIndex = 0;
        this._dacPhase = 0;        // 0=R, 1=G, 2=B
        this._dacRead = false;     // true after 3C7h, false after 3C8h
    }

    advance(n) {
        this.cycles += n;
        const v = this._vretraceAt(this.cycles);
        if (v && !this._lastVretrace) {
            this._frameCount++;
            if (this.hooks.onVSync) this.hooks.onVSync();
        }
        this._lastVretrace = v;
    }

    _framePos(c) { return c % this._frame; }

    _vretraceAt(c) { return this._framePos(c) >= this._active ? 1 : 0; }

    _statusByte() {
        const pos = this._framePos(this.cycles);
        const vretrace = pos >= this._active ? 1 : 0;
        return (vretrace ? 0x08 : 0) | (vretrace ? 0x01 : 0);
    }

    /** Retrace state for an OBSERVER — no flip-flop reset, no DAC change. */
    peekStatus() { return this._statusByte(); }

    /** @param {number} reg offset within the 3C0h-3DFh window (port - 0x3C0) */
    read(reg) {
        const r = reg & 0x1f;
        switch (r) {
            case 0x01: return this.attr[this._attrIndex & 0x1f];   // 3C1h attr read data
            case 0x05: return this.seq[this._seqIndex & 0x07];     // 3C5h seq data
            case 0x06: return this.dacMask;                        // 3C6h
            case 0x07: return this._dacRead ? 0x03 : 0x00;         // 3C7h DAC state
            case 0x08: return this._dacWriteIndex & 0xff;          // 3C8h current write index
            case 0x09: return this._dacReadByte();                 // 3C9h DAC data
            case 0x0c: return this.misc;                           // 3CCh misc read
            case 0x0f: return this.gc[this._gcIndex & 0x0f];       // 3CFh gc data
            case 0x15: return this.crtc[this._crtcIndex & 0x1f];   // 3D5h crtc data
            case 0x1a:                                             // 3DAh status 1
                // BUS READ side effect: resets the attribute flip-flop.
                this._attrFlipFlop = 0;
                return this._statusByte();
            default: return 0xff;
        }
    }

    /** @param {number} reg @param {number} val */
    write(reg, val) {
        const r = reg & 0x1f;
        val &= 0xff;
        switch (r) {
            case 0x00:                                             // 3C0h attribute (index/data toggle)
                if (this._attrFlipFlop === 0) {
                    this._attrIndex = val & 0x1f;                  // bit 5 (PAS) not modelled
                    this._attrFlipFlop = 1;
                } else {
                    this.attr[this._attrIndex & 0x1f] = val;
                    this._attrFlipFlop = 0;
                }
                return;
            case 0x02: this.misc = val; return;                    // 3C2h misc output
            case 0x04: this._seqIndex = val & 0x07; return;        // 3C4h seq index
            case 0x05: this.seq[this._seqIndex & 0x07] = val; return; // 3C5h seq data
            case 0x06: this.dacMask = val; return;                 // 3C6h pixel mask
            case 0x07: this._dacReadIndex = val; this._dacPhase = 0; this._dacRead = true; return;  // 3C7h
            case 0x08: this._dacWriteIndex = val; this._dacPhase = 0; this._dacRead = false; return; // 3C8h
            case 0x09: this._dacWriteByte(val); return;            // 3C9h DAC data
            case 0x0e: this._gcIndex = val & 0x0f; return;         // 3CEh gc index
            case 0x0f: this.gc[this._gcIndex & 0x0f] = val; return; // 3CFh gc data
            case 0x14: this._crtcIndex = val & 0x1f; return;       // 3D4h crtc index
            case 0x15: this.crtc[this._crtcIndex & 0x1f] = val; return; // 3D5h crtc data
            default:
        }
    }

    _dacWriteByte(val) {
        const i = (this._dacWriteIndex & 0xff) * 3 + this._dacPhase;
        this.dac[i] = val & 0x3f;                                  // six-bit DAC
        if (++this._dacPhase === 3) {
            this._dacPhase = 0;
            this._dacWriteIndex = (this._dacWriteIndex + 1) & 0xff;
        }
    }

    _dacReadByte() {
        const v = this.dac[(this._dacReadIndex & 0xff) * 3 + this._dacPhase];
        if (++this._dacPhase === 3) {
            this._dacPhase = 0;
            this._dacReadIndex = (this._dacReadIndex + 1) & 0xff;
        }
        return v;
    }

    /**
     * Everything the renderer needs to identify the mode and paint mode 13h,
     * RAW and side-effect-free. The register banks are the live latches
     * (read-only to the caller); dac is six-bit RGB, index 3*colour+comp.
     */
    getVideoState() {
        return {
            misc: this.misc,
            seq: this.seq,
            gc: this.gc,
            crtc: this.crtc,
            attr: this.attr,
            dac: this.dac,
            dacMask: this.dacMask,
            dacWriteIndex: this._dacWriteIndex & 0xff,
            dacReadIndex: this._dacReadIndex & 0xff,
            inVRetrace: this._vretraceAt(this.cycles) === 1,
            frame: this._frameCount,
        };
    }

    nextWake() {
        const pos = this._framePos(this.cycles);
        return pos < this._active ? this._active - pos : this._frame - pos;
    }

    getState() {
        return {
            cycles: this.cycles, misc: this.misc,
            seq: Array.from(this.seq), gc: Array.from(this.gc),
            crtc: Array.from(this.crtc), attr: Array.from(this.attr),
            dac: Array.from(this.dac), dacMask: this.dacMask,
            seqIndex: this._seqIndex, gcIndex: this._gcIndex,
            crtcIndex: this._crtcIndex, attrIndex: this._attrIndex,
            attrFlipFlop: this._attrFlipFlop,
            dacWriteIndex: this._dacWriteIndex, dacReadIndex: this._dacReadIndex,
            dacPhase: this._dacPhase, dacRead: this._dacRead,
            lastVretrace: this._lastVretrace, frameCount: this._frameCount,
        };
    }

    setState(s) {
        this.cycles = s.cycles; this.misc = s.misc;
        this.seq.set(s.seq); this.gc.set(s.gc);
        this.crtc.set(s.crtc); this.attr.set(s.attr); this.dac.set(s.dac);
        this.dacMask = s.dacMask;
        this._seqIndex = s.seqIndex; this._gcIndex = s.gcIndex;
        this._crtcIndex = s.crtcIndex; this._attrIndex = s.attrIndex;
        this._attrFlipFlop = s.attrFlipFlop;
        this._dacWriteIndex = s.dacWriteIndex; this._dacReadIndex = s.dacReadIndex;
        this._dacPhase = s.dacPhase; this._dacRead = s.dacRead;
        this._lastVretrace = s.lastVretrace ?? 0;
        this._frameCount = s.frameCount ?? 0;
    }
}

export default VGACard;
