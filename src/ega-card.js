/**
 * EGA card — port side plus a PLANAR framebuffer, the hardest of the display
 * family. Like the VGA card it LATCHES the register banks (misc, sequencer,
 * graphics controller, CRTC, attribute) so a renderer can identify the mode and
 * read the palette; unlike CGA/VGA-13h its memory at A0000 is NOT linear — a
 * pixel's four-bit colour is one bit from each of FOUR bit planes at the same
 * offset, so the card mediates the A0000 window instead of it being plain RAM.
 *
 * PORTS (same layout as VGA, minus the DAC — EGA colour comes from the
 * attribute palette AR00-0F, not a DAC):
 *   3C2h misc output (3CCh reads) ; 3C4h/3C5h sequencer ; 3CEh/3CFh graphics
 *   controller ; 3D4h/3D5h CRTC ; 3C0h attribute (index/data flip-flop, reset
 *   by a bus read of 3DAh) ; 3DAh input status 1 (retrace + flip-flop reset).
 *
 * PLANAR MEMORY (the A0000 window, mediated here):
 *   - WRITE selects planes by the Sequencer Map Mask (SR2, low four bits): the
 *     byte lands in every plane whose mask bit is set, at the same offset.
 *   - READ returns one plane, chosen by the Graphics Controller Read Map Select
 *     (GR4, low two bits).
 *
 * ACCURACY TIER: THE PLANES AND THE MAP MASK, NOT THE FULL GC ALU. This models
 * write mode 0 (map-mask plane routing) and read mode 0 (read-map-select),
 * which is what a bare-metal demo and a straight framebuffer read need. NOT
 * modelled: the four read latches, write modes 1-3, the set/reset and
 * rotate/ALU functions in GR0-3/GR8, and odd/even addressing. A program that
 * uses them would see write mode 0 semantics; the header says so rather than a
 * latch that surprises. The renderer composes pixels from getVideoState().planes
 * and the attribute palette.
 */
export class EGACard {
    constructor(clockHz, hooks = {}) {
        this.clockHz = clockHz || 5_000_000;
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.cycles = 0;
        this._frame = Math.max(1, Math.round(this.clockHz / 60));   // ~60 Hz, 350-line EGA
        this._active = Math.round(this._frame * 350 / 449);
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
        this._attrFlipFlop = 0;

        // Four bit planes of 64K. A pixel's colour is one bit from each, at the
        // same offset; the planes overlay the single A0000 window.
        this.planes = [new Uint8Array(0x10000), new Uint8Array(0x10000),
            new Uint8Array(0x10000), new Uint8Array(0x10000)];
    }

    advance(n) {
        this.cycles += n;
        const v = this._vretraceAt(this.cycles);
        if (v && !this._lastVretrace) this._frameCount++;
        this._lastVretrace = v;
    }

    _framePos(c) { return c % this._frame; }
    _vretraceAt(c) { return this._framePos(c) >= this._active ? 1 : 0; }
    _statusByte() { return this._vretraceAt(this.cycles) ? 0x09 : 0x00; }   // retrace + display-enable bits
    peekStatus() { return this._statusByte(); }

    /** Register-block I/O: reg is (port - 0x3C0). */
    read(reg) {
        const r = reg & 0x1f;
        switch (r) {
            case 0x01: return this.attr[this._attrIndex & 0x1f];   // 3C1h attr read
            case 0x05: return this.seq[this._seqIndex & 0x07];     // 3C5h seq data
            case 0x0c: return this.misc;                           // 3CCh misc read
            case 0x0f: return this.gc[this._gcIndex & 0x0f];       // 3CFh gc data
            case 0x15: return this.crtc[this._crtcIndex & 0x1f];   // 3D5h crtc data
            case 0x1a:                                             // 3DAh status 1 — resets the flip-flop
                this._attrFlipFlop = 0;
                return this._statusByte();
            default: return 0xff;
        }
    }

    write(reg, val) {
        const r = reg & 0x1f;
        val &= 0xff;
        switch (r) {
            case 0x00:                                             // 3C0h attribute (index/data toggle)
                if (this._attrFlipFlop === 0) { this._attrIndex = val & 0x1f; this._attrFlipFlop = 1; }
                else { this.attr[this._attrIndex & 0x1f] = val; this._attrFlipFlop = 0; }
                return;
            case 0x02: this.misc = val; return;                    // 3C2h misc output
            case 0x04: this._seqIndex = val & 0x07; return;        // 3C4h seq index
            case 0x05: this.seq[this._seqIndex & 0x07] = val; return; // 3C5h seq data
            case 0x0e: this._gcIndex = val & 0x0f; return;         // 3CEh gc index
            case 0x0f: this.gc[this._gcIndex & 0x0f] = val; return; // 3CFh gc data
            case 0x14: this._crtcIndex = val & 0x1f; return;       // 3D4h crtc index
            case 0x15: this.crtc[this._crtcIndex & 0x1f] = val; return; // 3D5h crtc data
            default:
        }
    }

    /** Planar framebuffer write (write mode 0): the byte lands in every plane
     *  the Sequencer Map Mask (SR2) selects. off is (addr - 0xA0000). */
    memWrite(off, val) {
        const o = off & 0xffff;
        const mask = this.seq[0x02] & 0x0f;
        for (let p = 0; p < 4; p++) if (mask & (1 << p)) this.planes[p][o] = val & 0xff;
    }

    /** Planar framebuffer read: one plane, chosen by GC Read Map Select (GR4). */
    memRead(off) {
        return this.planes[this.gc[0x04] & 0x03][off & 0xffff];
    }

    /** Everything the renderer needs: the register banks (to identify the mode
     *  and read the 16-entry attribute palette) and the four planes. */
    getVideoState() {
        return {
            misc: this.misc,
            seq: this.seq,
            gc: this.gc,
            crtc: this.crtc,
            attr: this.attr,
            planes: this.planes,
            inVRetrace: this._vretraceAt(this.cycles) === 1,
            frame: this._frameCount,
        };
    }

    getState() {
        return { cycles: this.cycles, misc: this.misc, seq: [...this.seq], gc: [...this.gc],
            crtc: [...this.crtc], attr: [...this.attr],
            planes: this.planes.map((p) => [...p]) };
    }

    setState(s) {
        this.cycles = s.cycles; this.misc = s.misc;
        this.seq.set(s.seq); this.gc.set(s.gc); this.crtc.set(s.crtc); this.attr.set(s.attr);
        for (let p = 0; p < 4; p++) this.planes[p].set(s.planes[p]);
    }
}
