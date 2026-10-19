/**
 * MC6845 CRTC — Motorola/Rockwell CRT controller, the Z80 tier's
 * video chip.
 *
 * Clean-room from the Motorola MC6845 datasheet (ADI-851-R1) and the
 * Rockwell R6545 application note: 18 registers (R0-R17) addressed via
 * an address/data port pair, character-based framebuffer with
 * programmable sync geometry.
 *
 * Register map (§3.2):
 *   R0  Horizontal Total (chars per line − 1)
 *   R1  Horizontal Displayed (visible chars per line)
 *   R2  Horizontal Sync Position (char at which HSYNC starts)
 *   R3  Sync Widths (lower 4 = HSYNC width, upper 4 = VSYNC width)
 *   R4  Vertical Total (char rows per frame − 1)
 *   R5  Vertical Total Adjust (extra scan lines)
 *   R6  Vertical Displayed (visible char rows)
 *   R7  Vertical Sync Position (row at which VSYNC starts)
 *   R8  Interlace & Skew (mode bits; not modeled, stored)
 *   R9  Max Scan Line Address (scan lines per char row − 1)
 *   R10 Cursor Start (scan line + blink mode in bits 5-6)
 *   R11 Cursor End (scan line)
 *   R12 Start Address (H) — bits 13:8 of the framebuffer base
 *   R13 Start Address (L) — bits 7:0 of the framebuffer base
 *   R14 Cursor (H) — bits 13:8 of cursor position
 *   R15 Cursor (L) — bits 7:0 of cursor position
 *   R16 Light Pen (H) — read-only (returns 0)
 *   R17 Light Pen (L) — read-only (returns 0)
 *
 * Interface contract matches the machine's other chips:
 *   regs = 2 (reg 0 = address port, reg 1 = data port)
 *   read(reg)/write(reg, val), advance(cycles), videoFrame()
 *
 * Text-mode rendering: each character cell is looked up in a charset
 * (opts.charset, 256 × charH bytes, 1 bit per pixel MSB-left, like a
 * standard 8×N ROM font). The VRAM holds character codes; the charset
 * holds the glyph bitmaps.
 *
 * Deliberate v1 bounds, stated:
 * - Text mode only (the standard CP/M + Grant Searle usage).
 * - No interlace, no light pen, no cursor blink timing (cursor is
 *   always visible when enabled).
 * - Frame-grained: videoFrame() renders from the current register
 *   state, not mid-scanline.
 */

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 25;
const DEFAULT_CHAR_H = 8;

/** Default charset: 8×8 CP437 subset — printable ASCII 0x20-0x7E
 *  filled with a minimal recognizable glyph set. Full charsets are
 *  supplied via opts.charset; this is the "something shows up" fallback. */
function defaultCharset(charH) {
    const font = new Uint8Array(256 * charH);
    // Fill printable ASCII with a simple block pattern so text is visible
    // even without a real font ROM.  Character 0xDB = full block.
    for (let ch = 0x20; ch < 0x7f; ch++) {
        const base = ch * charH;
        // A crude recognizable glyph: top and bottom lines of a box,
        // with the left column set for all rows.  Not pretty, but
        // distinct per character (the column pattern varies with ch).
        font[base] = 0xff;                       // top line
        font[base + charH - 1] = 0xff;           // bottom line
        for (let r = 1; r < charH - 1; r++) {
            font[base + r] = 0x80 | ((ch >> (r % 7)) & 0x7e);
        }
    }
    // Space = blank
    for (let r = 0; r < charH; r++) font[0x20 * charH + r] = 0;
    return font;
}

/** CGA-style default palette: white on black. */
const DEFAULT_FG = [0xaa, 0xaa, 0xaa, 255];
const DEFAULT_BG = [0, 0, 0, 255];

export class MC6845 {
    /**
     * @param {{
     *   clockHz?: number,
     *   fps?: number,
     *   charset?: Uint8Array,
     *   charW?: number,
     *   fg?: number[],
     *   bg?: number[],
     *   vramSize?: number,
     * }} [opts]
     */
    constructor(opts = {}) {
        /** @type {Uint8Array} 18 CRTC registers */
        this.regs = new Uint8Array(18);
        this._addrReg = 0;          // selected register (written via port 0)

        // Sensible defaults: 80×25 text mode with 8-pixel-tall chars
        this.regs[0] = 99;          // R0: horizontal total − 1 (100 chars)
        this.regs[1] = DEFAULT_COLS;// R1: horizontal displayed
        this.regs[2] = 82;          // R2: hsync position
        this.regs[3] = 0x28;        // R3: sync widths (H=8, V=2)
        this.regs[4] = 30;          // R4: vertical total − 1 (31 rows)
        this.regs[5] = 2;           // R5: vertical adjust (2 extra lines)
        this.regs[6] = DEFAULT_ROWS;// R6: vertical displayed
        this.regs[7] = 27;          // R7: vsync position
        this.regs[8] = 0;           // R8: interlace mode
        const initCharH = opts.charH ?? DEFAULT_CHAR_H;
        this.regs[9] = initCharH - 1; // R9: max scan line
        this.regs[10] = 0;          // R10: cursor start (line 0, no blink)
        this.regs[11] = initCharH - 1; // R11: cursor end
        // R12-R17: start address and cursor default to 0

        /** @type {Uint8Array} Video RAM — character codes */
        this.vram = new Uint8Array(opts.vramSize ?? 0x4000);

        /** @type {Uint8Array} Character ROM/font bitmap */
        const charH = (this.regs[9] & 0x1f) + 1;
        this.charset = opts.charset ?? defaultCharset(charH);
        this.charW = opts.charW ?? 8;

        /** @type {number[]} Foreground RGBA */
        this.fg = opts.fg ?? [...DEFAULT_FG];
        /** @type {number[]} Background RGBA */
        this.bg = opts.bg ?? [...DEFAULT_BG];

        /** Frame counter (for polling change detection) */
        this.frame = 0;
        this.writes = 0;

        // Timing
        this._cyclesPerFrame = Math.round((opts.clockHz ?? 2_000_000) / (opts.fps ?? 50));
        this._toFrame = this._cyclesPerFrame;
    }

    // ── CPU interface ──────────────────────────────────────────────

    /** Number of addressable I/O registers. */
    get portCount() { return 2; }

    /**
     * @param {number} reg 0 = address register, 1 = data register
     */
    read(reg) {
        if ((reg & 1) === 0) return this._addrReg;
        const r = this._addrReg & 0x1f;
        if (r >= 18) return 0;
        // R16/R17 (light pen) are read-only and always 0
        return this.regs[r];
    }

    /**
     * @param {number} reg 0 = address register, 1 = data register
     * @param {number} val
     */
    write(reg, val) {
        val &= 0xff;
        if ((reg & 1) === 0) {
            this._addrReg = val & 0x1f;
            return;
        }
        const r = this._addrReg & 0x1f;
        if (r >= 18) return;
        // R16/R17 (light pen) are read-only
        if (r === 16 || r === 17) return;
        this.regs[r] = val;
    }

    /**
     * Advance by CPU cycles; tick the frame counter.
     * @param {number} cycles
     */
    advance(cycles) {
        this._toFrame -= cycles;
        while (this._toFrame <= 0) {
            this._toFrame += this._cyclesPerFrame;
            this.frame++;
        }
    }

    // ── Derived geometry ───────────────────────────────────────────

    /** Visible columns (R1). */
    get cols() { return this.regs[1] || DEFAULT_COLS; }

    /** Visible rows (R6). */
    get rows() { return this.regs[6] || DEFAULT_ROWS; }

    /** Scan lines per character row (R9 + 1). */
    get charH() { return (this.regs[9] & 0x1f) + 1; }

    /** Start address (R12:R13). */
    get startAddr() { return ((this.regs[12] & 0x3f) << 8) | this.regs[13]; }

    /** Cursor position (R14:R15). */
    get cursorAddr() { return ((this.regs[14] & 0x3f) << 8) | this.regs[15]; }

    /** Cursor start scan line (R10 bits 4:0). */
    get cursorStart() { return this.regs[10] & 0x1f; }

    /** Cursor end scan line (R11 bits 4:0). */
    get cursorEnd() { return this.regs[11] & 0x1f; }

    /** Cursor enabled (R10 bits 6:5 !== 01 = cursor off). */
    get cursorEnabled() { return ((this.regs[10] >> 5) & 0x03) !== 1; }

    // ── Rendering ─────────────────────────────────────────────────

    /**
     * Render the text framebuffer to RGBA.
     * @returns {Uint8ClampedArray}
     */
    rgba() {
        const cols = this.cols;
        const rows = this.rows;
        const charH = this.charH;
        const charW = this.charW;
        const w = cols * charW;
        const h = rows * charH;
        const out = new Uint8ClampedArray(w * h * 4);
        const start = this.startAddr;
        const curPos = this.cursorAddr;
        const curOn = this.cursorEnabled;
        const curS = this.cursorStart;
        const curE = this.cursorEnd;

        for (let row = 0; row < rows; row++) {
            for (let col = 0; col < cols; col++) {
                const addr = (start + row * cols + col) & (this.vram.length - 1);
                const ch = this.vram[addr];
                const isCursor = curOn && addr === curPos;

                for (let scanLine = 0; scanLine < charH; scanLine++) {
                    // Glyph bitmap: charset[ch * charH + scanLine]
                    const glyphByte = this.charset[ch * charH + scanLine] ?? 0;
                    const cursorLine = isCursor && scanLine >= curS && scanLine <= curE;

                    const py = row * charH + scanLine;
                    for (let px = 0; px < charW; px++) {
                        const bit = (glyphByte >> (charW - 1 - px)) & 1;
                        const on = cursorLine ? !bit : !!bit; // cursor inverts
                        const color = on ? this.fg : this.bg;
                        const oi = (py * w + col * charW + px) * 4;
                        out[oi] = color[0];
                        out[oi + 1] = color[1];
                        out[oi + 2] = color[2];
                        out[oi + 3] = color[3];
                    }
                }
            }
        }
        return out;
    }

    /**
     * The common video-face contract (TMS9918/SimpleVGA/ILI9341):
     * {width, height, rgba, frame, signal}.
     */
    videoFrame() {
        const cols = this.cols;
        const rows = this.rows;
        const charH = this.charH;
        return {
            width: cols * this.charW,
            height: rows * charH,
            rgba: this.rgba(),
            frame: this.frame,
            mode: 'text',
            signal: true,
        };
    }

    /**
     * Snapshot CRTC state for machine save. The vram is a live subarray
     * view of system memory — the machine's mem.slice() already carries
     * it, so we snapshot only registers and frame-related state.
     */
    saveState() {
        return {
            regs: Array.from(this.regs),
            _addrReg: this._addrReg,
            frame: this.frame,
            writes: this.writes,
            _toFrame: this._toFrame,
        };
    }

    /** Restore from a saveState() snapshot. */
    loadState(s) {
        this.regs.set(s.regs);
        this._addrReg = s._addrReg;
        this.frame = s.frame;
        this.writes = s.writes;
        this._toFrame = s._toFrame;
    }
}
