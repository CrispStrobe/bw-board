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
 * The 6845 CRTC at 3D4h/3D5h IS modelled (E6.8.5) — a real MC6845 (the same
 * clean-room chip the Z80 tier uses) holds R0-R17, so 3D4h/3D5h latch and read
 * back, the START ADDRESS (R12:R13) and CURSOR (R14:R15) are emitted for the
 * renderer, and the vertical-retrace proportion is DERIVED from the CRTC's own
 * vertical registers rather than hardcoded. It powers on with the standard CGA
 * 80x25 text programming, which reproduces the 262-total / 200-active frame
 * this card always had, so an unprogrammed card is byte-for-byte unchanged. The
 * 3C8h/3C9h DAC palette (a VGA feature some games poke) is a separate follow-up.
 *
 * bit 0 (display enable, active-low sense inverted to "not displaying") is
 * high during horizontal blank of each active line AND all of vertical
 * blank — some code polls it instead of bit 3, so it moves at the line rate.
 *
 * ACCURACY TIER: THE PORTS AND THE RHYTHM, NOT THE PICTURE. The 3D8h/3D9h
 * latches (exposed raw through getVideoState) and the 3DAh status as a real
 * 60 Hz frame with the right active/blank proportion are what this provides.
 * What is NOT here: NO PIXELS — the framebuffer-to-image path is a separate
 * pure renderer; the retrace is a machine-time-derived FRAME, not cycle-exact
 * scanline timing, so a poll sees the right rhythm (once per frame, low most
 * of the frame) but not the precise horizontal count a real 6845 clocks. The
 * retrace stays FRAME-grained (a cycle-exact scanline count is E6.8.4's cycle
 * timing, which this pairs with); what E6.8.5 adds is that the frame's shape
 * and the start address/cursor come from the real CRTC registers, and there is
 * still no light pen.
 *
 * @module
 */

import { MC6845 } from './mc6845.js';

const FRAME_HZ = 60;
// Standard CGA 80x25 text-mode 6845 programming (R0-R17). Powers the card on at
// 262 total / 200 active lines — identical to the frame it used to hardcode.
const CGA_TEXT_CRTC = [0x71, 0x50, 0x5a, 0x0a, 0x1f, 0x06, 0x19, 0x1c,
    0x02, 0x07, 0x06, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];

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
        this.crtc = new MC6845({ clockHz: this.clockHz, fps: FRAME_HZ });
        this.crtc.regs.set(CGA_TEXT_CRTC);   // power on with the standard CGA text programming
        this._frame = Math.max(1, Math.round(this.clockHz / FRAME_HZ));
        this._recomputeGeom();
        this._lastVretrace = 0;
        this._frameCount = 0;
    }

    /** Derive the frame's active/total split (in cycles) from the CRTC's own
     *  vertical registers: total lines = (R4+1)*charH + R5 vertical adjust,
     *  displayed lines = R6*charH. Recomputed whenever 3D5h is written, so a
     *  program that reprograms the CRTC moves the retrace with it. */
    _recomputeGeom() {
        const charH = (this.crtc.regs[9] & 0x1f) + 1;
        const total = Math.max(1, (this.crtc.regs[4] + 1) * charH + this.crtc.regs[5]);
        const active = Math.min(total, this.crtc.regs[6] * charH);
        this._active = Math.round(this._frame * active / total);
        this._line = Math.max(1, Math.round(this._frame / total));
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
        if (r === 0x0a) return this._status();       // 3DAh — status
        if (r === 0x05) return this.crtc.read(1);    // 3D5h — CRTC data (R14-17 cursor/light pen read back)
        // 3D8h mode and 3D9h colour are WRITE-ONLY on a real CGA: a read
        // floats, it does NOT return the latch. Handing back the written byte
        // would invent a readable register the hardware lacks (the same
        // mistake as an 8255 control register that reads back). The renderer
        // sees the latch through getVideoState(), never through the bus.
        return 0xff;                                  // 3D8h/3D9h/3D4h index: open bus
    }

    /** @param {number} reg @param {number} val */
    write(reg, val) {
        const r = reg & 0x0f;
        val &= 0xff;
        if (r === 0x08) this.mode = val;             // 3D8h mode control
        else if (r === 0x09) this.color = val;       // 3D9h colour select
        else if (r === 0x04) this.crtc.write(0, val);   // 3D4h CRTC address register
        else if (r === 0x05) { this.crtc.write(1, val); this._recomputeGeom(); } // 3D5h CRTC data
        // 3DAh is read-only.
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
            // From the real CRTC (E6.8.5): the renderer reads startAddr as the
            // top-left VRAM offset, so a page flip / smooth scroll moves the
            // picture; cursor* place the text cursor.
            startAddr: this.crtc.startAddr,          // R12:R13, the display's base offset
            cursorAddr: this.crtc.cursorAddr,        // R14:R15
            cursorStart: this.crtc.regs[10] & 0x1f,  // R10 top scan line (bit 5 = hide)
            cursorEnd: this.crtc.regs[11] & 0x1f,    // R11 bottom scan line
            crtc: this.crtc.regs,                    // R0-R17 raw, for a renderer that wants more
        };
    }

    /** Cycles until the vertical-retrace bit next changes — for a HLT-poll. */
    nextWake() {
        const pos = this._framePos(this.cycles);
        return pos < this._active ? this._active - pos : this._frame - pos;
    }

    getState() {
        return { cycles: this.cycles, mode: this.mode, color: this.color,
            lastVretrace: this._lastVretrace, frameCount: this._frameCount,
            crtc: [...this.crtc.regs], crtcAddr: this.crtc._addrReg };
    }

    setState(s) {
        this.cycles = s.cycles; this.mode = s.mode; this.color = s.color;
        this._lastVretrace = s.lastVretrace ?? 0;
        this._frameCount = s.frameCount ?? 0;
        if (s.crtc) { this.crtc.regs.set(s.crtc); this.crtc._addrReg = s.crtcAddr ?? 0; this._recomputeGeom(); }
    }
}

export default CGACard;
