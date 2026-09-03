/**
 * CGA card — the PORT side only. The framebuffer-to-pixels renderer is a
 * separate pure function (i8086-cga.js); this chip is what a program TALKS
 * to, and the one register that matters for whether a game runs at all is
 * the status port 3DAh.
 *
 * WHY 3DAh IS THE WHOLE POINT. A CGA game times its frames by polling the
 * vertical-retrace bit: spin until it is low (mid-frame), then spin until it
 * goes high (retrace has started), and now you are synchronised to 60 Hz.
 * If nothing drives that bit the spin never ends and the game hangs before
 * it draws a pixel — which is exactly what the corpus harness reported as
 * the top reason a game never terminates. So the bit is derived from machine
 * time here: a 60 Hz frame, 200 active lines of 262, the bit high through
 * the 62 lines of vertical blank.
 *
 * THREE REGISTERS in the 3D0h-3DFh block:
 *   3D8h  mode control     (write; the renderer reads it back as opts)
 *   3D9h  colour select    (write; border/background/palette bits)
 *   3DAh  status           (read: bit 0 display-enable, bit 3 vertical
 *                           retrace; bits derived from machine time)
 * The 6845 CRTC at 3D4h/3D5h is NOT modelled — a breadboard/emulator frame
 * pulse from machine time is enough, and nothing in the corpus reprograms
 * the CRTC to a mode the renderer would have to follow. The 3C8h/3C9h DAC
 * palette (a VGA feature some games poke) is a separate follow-up.
 *
 * bit 0 (display enable, active-low sense inverted to "not displaying") is
 * high during horizontal blank of each active line AND all of vertical
 * blank — some code polls it instead of bit 3, so it moves at the line rate.
 *
 * @module
 */

const FRAME_HZ = 60;
const TOTAL_LINES = 262;
const ACTIVE_LINES = 200;

export class CGACard {
    /**
     * @param {number} clockHz CPU clock, the time base the retrace is drawn from
     * @param {{ onVSync?: () => void }} [hooks]
     */
    constructor(clockHz, hooks = {}) {
        this.clockHz = clockHz || 5_000_000;
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.cycles = 0;
        this.mode = 0;        // 3D8h latch
        this.color = 0;       // 3D9h latch
        this._frame = Math.max(1, Math.round(this.clockHz / FRAME_HZ));
        this._active = Math.round(this._frame * ACTIVE_LINES / TOTAL_LINES);
        this._line = Math.max(1, Math.round(this._frame / TOTAL_LINES));
        this._lastVretrace = 0;
        this._frameCount = 0;
    }

    /** Machine time passes; watch for the vertical-retrace rising edge. */
    advance(n) {
        const before = this.cycles;
        this.cycles += n;
        // Count frames by detecting the vretrace edge crossing.
        const vNow = this._vretraceAt(this.cycles);
        if (vNow && !this._lastVretrace) {
            this._frameCount++;
            if (this.hooks.onVSync) this.hooks.onVSync();
        }
        this._lastVretrace = vNow;
        void before;
    }

    _framePos(cycles) { return cycles % this._frame; }

    _vretraceAt(cycles) { return this._framePos(cycles) >= this._active ? 1 : 0; }

    /** @param {number} reg offset within the 3D0h-3DFh window (port & 0x0F) */
    read(reg) {
        const r = reg & 0x0f;
        if (r === 0x0a) return this._status();       // 3DAh — the only readable reg
        // 3D8h mode and 3D9h colour are WRITE-ONLY on a real CGA: a read
        // floats, it does NOT return the latch. Handing back the written byte
        // would invent a readable register the hardware lacks (the same
        // mistake as an 8255 control register that reads back). The renderer
        // sees the latch through getVideoState(), never through the bus.
        return 0xff;                                  // 3D8h/3D9h/6845/etc: open bus
    }

    /** @param {number} reg @param {number} val */
    write(reg, val) {
        const r = reg & 0x0f;
        val &= 0xff;
        if (r === 0x08) this.mode = val;             // 3D8h mode control
        else if (r === 0x09) this.color = val;       // 3D9h colour select
        // 3DAh is read-only; other regs (CRTC) are not modelled.
    }

    _status() {
        const pos = this._framePos(this.cycles);
        const vretrace = pos >= this._active ? 1 : 0;
        // Horizontal blank: the tail of each active scanline.
        const linePos = pos % this._line;
        const hblank = linePos >= this._line * 0.75 ? 1 : 0;
        const displayDisable = (vretrace || hblank) ? 1 : 0;
        // Bits 4-7 read high on a real card's open upper bits; keep 1s the way
        // hardware does so a `test al,08h` is unaffected but a raw compare is
        // not surprised by zeros where the card floats them. We report only
        // the two live bits and leave the rest 0 for a clean, testable value.
        return (displayDisable ? 0x01 : 0) | (vretrace ? 0x08 : 0);
    }

    /** The state the pure renderer needs; it reads, it does not reach in. */
    getVideoState() {
        return {
            mode: this.mode,
            color: this.color,
            frame: this._frameCount,
            inVRetrace: this._vretraceAt(this.cycles) === 1,
        };
    }

    /** Cycles until the vertical-retrace bit next changes — for a HLT-poll. */
    nextWake() {
        const pos = this._framePos(this.cycles);
        return pos < this._active ? this._active - pos : this._frame - pos;
    }

    getState() {
        return { cycles: this.cycles, mode: this.mode, color: this.color,
            lastVretrace: this._lastVretrace, frameCount: this._frameCount };
    }

    setState(s) {
        this.cycles = s.cycles; this.mode = s.mode; this.color = s.color;
        this._lastVretrace = s.lastVretrace ?? 0;
        this._frameCount = s.frameCount ?? 0;
    }
}

export default CGACard;
