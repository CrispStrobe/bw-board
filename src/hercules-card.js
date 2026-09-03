/**
 * Hercules card — the mono sibling of the CGA card, port side only. Same
 * shape: a control latch and a status register whose retrace bit is drawn
 * from machine time, no pixels (the framebuffer at B0000h is the renderer's
 * concern).
 *
 * THE BLOCK is 3B0h-3BFh (where CGA is 3D0h-3DFh):
 *   3B8h  display/mode control  (write; bit 1 graphics-vs-text, bit 3 video
 *                                enable, bit 5 page select, bit 7 gfx page)
 *   3BAh  status                (read: bit 0 horizontal retrace, bit 3 video
 *                                — a pixel is being drawn, bit 7 VERTICAL
 *                                SYNC — the timing/detection bit)
 *   3BFh  configuration         (write; bit 0 enables graphics mode, bit 1
 *                                enables the second framebuffer page)
 *
 * BIT 7 IS THE ONE THAT MATTERS. Hercules code both detects the card and
 * times its frames on 3BAh bit 7: it toggles at the frame rate on a Hercules
 * and is static on a plain MDA. So, exactly as with CGA's bit 3, the bit is
 * a real ~50 Hz frame here — high through vertical blank, low while the
 * display is active — so a "wait for bit 7 to change" loop terminates and a
 * "wait for vsync" loop syncs once a frame rather than spinning or tearing.
 *
 * @module
 */

const FRAME_HZ = 50;              // MDA/Hercules timing
const TOTAL_LINES = 370;
const ACTIVE_LINES = 348;         // 720x348 graphics

export class HerculesCard {
    /**
     * @param {number} clockHz CPU clock, the retrace time base
     * @param {{ onVSync?: () => void }} [hooks]
     */
    constructor(clockHz, hooks = {}) {
        this.clockHz = clockHz || 5_000_000;
        this.hooks = hooks;
        this.reset();
    }

    reset() {
        this.cycles = 0;
        this.mode = 0;        // 3B8h latch
        this.config = 0;      // 3BFh latch
        this._frame = Math.max(1, Math.round(this.clockHz / FRAME_HZ));
        this._active = Math.round(this._frame * ACTIVE_LINES / TOTAL_LINES);
        this._line = Math.max(1, Math.round(this._frame / TOTAL_LINES));
        this._lastVsync = 0;
        this._frameCount = 0;
    }

    advance(n) {
        this.cycles += n;
        const v = this._vsyncAt(this.cycles);
        if (v && !this._lastVsync) {
            this._frameCount++;
            if (this.hooks.onVSync) this.hooks.onVSync();
        }
        this._lastVsync = v;
    }

    _framePos(cycles) { return cycles % this._frame; }

    _vsyncAt(cycles) { return this._framePos(cycles) >= this._active ? 1 : 0; }

    /** @param {number} reg offset within the 3B0h-3BFh window (port & 0x0F) */
    read(reg) {
        const r = reg & 0x0f;
        if (r === 0x0a) return this._status();       // 3BAh — the only readable reg
        // 3B8h/3BFh are write-only; a read floats. The latch reaches the
        // renderer through getVideoState(), never the bus.
        return 0xff;
    }

    /** @param {number} reg @param {number} val */
    write(reg, val) {
        const r = reg & 0x0f;
        val &= 0xff;
        if (r === 0x08) this.mode = val;             // 3B8h display/mode control
        else if (r === 0x0f) this.config = val;      // 3BFh configuration
    }

    _status() {
        const pos = this._framePos(this.cycles);
        const vsync = pos >= this._active ? 1 : 0;
        const linePos = pos % this._line;
        const hretrace = linePos >= this._line * 0.75 ? 1 : 0;
        const video = (vsync || hretrace) ? 0 : 1;   // a pixel is drawn only in active display
        return (hretrace ? 0x01 : 0) | (video ? 0x08 : 0) | (vsync ? 0x80 : 0);
    }

    getVideoState() {
        return {
            mode: this.mode,
            config: this.config,
            graphics: !!(this.mode & 0x02),
            frame: this._frameCount,
            inVSync: this._vsyncAt(this.cycles) === 1,
        };
    }

    nextWake() {
        const pos = this._framePos(this.cycles);
        return pos < this._active ? this._active - pos : this._frame - pos;
    }

    getState() {
        return { cycles: this.cycles, mode: this.mode, config: this.config,
            lastVsync: this._lastVsync, frameCount: this._frameCount };
    }

    setState(s) {
        this.cycles = s.cycles; this.mode = s.mode; this.config = s.config;
        this._lastVsync = s.lastVsync ?? 0;
        this._frameCount = s.frameCount ?? 0;
    }
}

export default HerculesCard;
