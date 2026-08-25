/**
 * TMS9918A VDP — the video chip of the composable retro machine.
 *
 * Clean-room from the TI TMS9918A/9928A/9929A datasheet ("Video Display
 * Processors", TI 1982): CPU interface (§2.2), registers (§2.1.2), VRAM
 * addressing (§2.2.1-2), Graphics I / Graphics II / Text modes
 * (§3.3-3.5), sprites with the four-per-line rule and the status flags
 * (§3.7). vrEmuTms9918 (MIT) is the adopted differential oracle — a
 * later harness compares frames, it is never a source.
 *
 * Interface contract matches the machine's other chips: `regs = 2`
 * (mode 0 = VRAM data port, mode 1 = control/status port),
 * read(reg)/write(reg, val), advance(cycles), irqAsserted.
 *
 * Deliberate v1 bounds, stated:
 * - Frame-grained timing: the frame flag, rendering and the sprite
 *   status flags land at VBLANK boundaries (cpu-cycles per frame from
 *   the machine clock at 60 Hz), not mid-scanline. Mid-frame register
 *   tricks (split screens) render as the final register state.
 * - Multicolor mode is NOT rendered yet — renderFrame() names the
 *   refusal instead of painting something wrong.
 * - 4K/16K select (R1 bit 7) is ignored; VRAM is always 16K.
 */

/** The canonical TMS9918A palette (index 0 is transparent). */
export const TMS9918_PALETTE = [
    [0, 0, 0, 0],        // 0 transparent
    [0, 0, 0, 255],      // 1 black
    [33, 200, 66, 255],  // 2 medium green
    [94, 220, 120, 255], // 3 light green
    [84, 85, 237, 255],  // 4 dark blue
    [125, 118, 252, 255],// 5 light blue
    [212, 82, 77, 255],  // 6 dark red
    [66, 235, 245, 255], // 7 cyan
    [252, 85, 84, 255],  // 8 medium red
    [255, 121, 120, 255],// 9 light red
    [212, 193, 84, 255], // 10 dark yellow
    [230, 206, 128, 255],// 11 light yellow
    [33, 176, 59, 255],  // 12 dark green
    [201, 91, 186, 255], // 13 magenta
    [204, 204, 204, 255],// 14 gray
    [255, 255, 255, 255],// 15 white
];

const WIDTH = 256;
const HEIGHT = 192;

export class TMS9918 {
    /**
     * @param {{ clockHz?: number, fps?: number }} [opts] clockHz is the
     *   MACHINE's CPU clock — frame pacing is derived from it, since the
     *   machine advances chips in CPU cycles.
     */
    constructor({ clockHz = 1_000_000, fps = 60 } = {}) {
        this.vram = new Uint8Array(0x4000);
        this.regs = new Uint8Array(8);
        this.status = 0;
        this.addr = 0;
        this._latch = null;      // first byte of a mode-1 pair, or null
        this._readBuf = 0;       // mode-0 read-ahead buffer (§2.2.2)
        this._cyclesPerFrame = Math.round(clockHz / fps);
        this._toFrame = this._cyclesPerFrame;
        this.frame = 0;          // frames completed
        // Last rendered frame: palette indices, row-major 256x192.
        this.indices = new Uint8Array(WIDTH * HEIGHT);
    }

    // ── CPU interface ──────────────────────────────────────────────

    /** @param {number} reg 0 = data port, 1 = control port */
    read(reg) {
        if ((reg & 1) === 0) {
            // Mode 0 read: buffered — returns the prefetched byte and
            // refills from the CURRENT address, then increments (§2.2.2).
            this._latch = null;
            const v = this._readBuf;
            this._readBuf = this.vram[this.addr];
            this.addr = (this.addr + 1) & 0x3fff;
            return v;
        }
        // Status read: returns F/5S/C/number, clears them, resets the
        // address latch (§2.1.3).
        const s = this.status;
        this.status = 0;
        this._latch = null;
        return s;
    }

    /** @param {number} reg 0 = data port, 1 = control port */
    write(reg, val) {
        val &= 0xff;
        if ((reg & 1) === 0) {
            // Mode 0 write: store, load the read buffer with the same
            // byte (the datasheet's write-through), increment.
            this._latch = null;
            this.vram[this.addr] = val;
            this._readBuf = val;
            this.addr = (this.addr + 1) & 0x3fff;
            return;
        }
        // Mode 1: byte pairs (§2.2.1).
        if (this._latch === null) { this._latch = val; return; }
        const first = this._latch;
        this._latch = null;
        if (val & 0x80) {
            // 1xxx xxxx: register write, register in the low 3 bits
            this.regs[val & 0x07] = first;
        } else if (val & 0x40) {
            // 01xx xxxx: set VRAM WRITE address
            this.addr = ((val & 0x3f) << 8) | first;
        } else {
            // 00xx xxxx: set VRAM READ address — prefetch begins now
            this.addr = ((val & 0x3f) << 8) | first;
            this._readBuf = this.vram[this.addr];
            this.addr = (this.addr + 1) & 0x3fff;
        }
    }

    /** Level-triggered: frame flag AND interrupt enable (R1 bit 5). */
    get irqAsserted() { return (this.status & 0x80) !== 0 && (this.regs[1] & 0x20) !== 0; }

    /** Cycles to the next VBLANK if its interrupt is enabled — the HALT
     *  wake horizon. With IE clear the flag still sets, but a halted CPU
     *  cannot see it: Infinity. */
    nextWake() {
        if (!(this.regs[1] & 0x20)) return Infinity;
        if (this.status & 0x80) return 1;
        return Math.max(1, this._toFrame);
    }

    /** @param {number} n CPU cycles elapsed */
    advance(n) {
        this._toFrame -= n;
        while (this._toFrame <= 0) {
            this._toFrame += this._cyclesPerFrame;
            this.frame++;
            this._renderFrame();          // also sets C / 5S
            this.status |= 0x80;          // F — end of frame (§3.7)
        }
    }

    // ── Mode / table decoding (§2.1.2) ────────────────────────────

    /** 'graphics1' | 'graphics2' | 'text' | 'multicolor' */
    get mode() {
        if (this.regs[1] & 0x10) return 'text';        // M1
        if (this.regs[1] & 0x08) return 'multicolor';  // M2
        if (this.regs[0] & 0x02) return 'graphics2';   // M3
        return 'graphics1';
    }

    get nameBase() { return (this.regs[2] & 0x0f) << 10; }
    get colorBase() { return this.regs[3] << 6; }
    get patternBase() { return (this.regs[4] & 0x07) << 11; }
    get spriteAttrBase() { return (this.regs[5] & 0x7f) << 7; }
    get spritePatternBase() { return (this.regs[6] & 0x07) << 11; }
    get backdrop() { return this.regs[7] & 0x0f; }

    // ── Rendering ─────────────────────────────────────────────────

    /**
     * Render the current VDP state to palette indices (also called at
     * each VBLANK by advance()). Returns
     * {width, height, indices, mode, note?} — note names anything the
     * renderer refused rather than faked.
     */
    renderFrame() {
        this._renderFrame();
        return {
            width: WIDTH, height: HEIGHT, indices: this.indices,
            mode: this.mode,
            ...(this.mode === 'multicolor'
                ? { note: 'multicolor mode not rendered yet (named refusal, not a blank screen bug)' } : {}),
        };
    }

    /** The common video-face contract every video chip implements:
     *  {width, height, rgba, frame, mode?, signal} — frame is a change
     *  generation so pollers skip unchanged repaints. */
    videoFrame() {
        return { width: 256, height: 192, rgba: this.rgba(), frame: this.frame, mode: this.mode, signal: true };
    }

    /** Last frame as RGBA for a canvas face; transparent → backdrop. */
    rgba() {
        const out = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
        const bd = TMS9918_PALETTE[this.backdrop || 1];
        for (let i = 0; i < this.indices.length; i++) {
            const c = TMS9918_PALETTE[this.indices[i]] ?? bd;
            const src = this.indices[i] === 0 ? bd : c;
            out.set(src, i * 4);
        }
        return out;
    }

    _renderFrame() {
        const bd = this.backdrop;
        this.indices.fill(bd);
        // BLANK (R1 bit 6 low = screen off): backdrop only (§2.1.2).
        if ((this.regs[1] & 0x40) === 0) return;

        const mode = this.mode;
        if (mode === 'text') { this._renderText(); return; }
        if (mode === 'multicolor') return; // named refusal, see renderFrame()
        this._renderPattern(mode === 'graphics2');
        this._renderSprites();
    }

    _renderText() {
        // 40x24 cells, 6 pixels wide, colors entirely from R7 (§3.5).
        const fg = (this.regs[7] >> 4) & 0x0f;
        const bg = this.regs[7] & 0x0f;
        this.indices.fill(bg);
        for (let row = 0; row < 24; row++) {
            for (let col = 0; col < 40; col++) {
                const ch = this.vram[this.nameBase + row * 40 + col];
                for (let y = 0; y < 8; y++) {
                    const bits = this.vram[this.patternBase + ch * 8 + y];
                    for (let x = 0; x < 6; x++) {
                        // Text cells use the HIGH six bits of the pattern
                        const on = (bits >> (7 - x)) & 1;
                        // 240px of text centred in the 256px raster: 8px borders
                        const px = 8 + col * 6 + x;
                        const py = row * 8 + y;
                        if (on) this.indices[py * WIDTH + px] = fg || this.backdrop;
                    }
                }
            }
        }
    }

    _renderPattern(g2) {
        const bd = this.backdrop;
        for (let row = 0; row < 24; row++) {
            const third = row >> 3; // 0..2, Graphics II banking
            for (let col = 0; col < 32; col++) {
                const name = this.vram[this.nameBase + row * 32 + col];
                for (let y = 0; y < 8; y++) {
                    let bits, color;
                    if (g2) {
                        // Graphics II (§3.4): pattern and color tables are
                        // 0x1800 bytes in three 0x800 banks selected by the
                        // screen third; R4 bit 2 / R3 bit 7 give the base,
                        // R4 bits 0-1 / R3 bits 5-6 AND-mask the bank
                        // (the mask behavior every real program relies on).
                        const pBank = third & (this.regs[4] & 0x03);
                        const pBase = (this.regs[4] & 0x04) << 11;
                        bits = this.vram[pBase + pBank * 0x800 + name * 8 + y];
                        const cBank = third & ((this.regs[3] >> 5) & 0x03);
                        const cBase = (this.regs[3] & 0x80) << 6;
                        color = this.vram[cBase + cBank * 0x800 + name * 8 + y];
                    } else {
                        // Graphics I (§3.3): one color-table byte covers a
                        // GROUP of eight patterns.
                        bits = this.vram[this.patternBase + name * 8 + y];
                        color = this.vram[this.colorBase + (name >> 3)];
                    }
                    const fg = (color >> 4) & 0x0f;
                    const bg = color & 0x0f;
                    const py = row * 8 + y;
                    for (let x = 0; x < 8; x++) {
                        const on = (bits >> (7 - x)) & 1;
                        const c = on ? fg : bg;
                        this.indices[py * WIDTH + col * 8 + x] = c === 0 ? bd : c;
                    }
                }
            }
        }
    }

    _renderSprites() {
        // §3.7: 32 sprites, 4-byte attributes (Y, X, name, tag). Y=0xD0
        // terminates. Display starts at Y+1. Four per scanline; the
        // fifth sets 5S with its number. Coincidence = any two opaque
        // sprite pixels on the same spot. Lower number = on top.
        const size = (this.regs[1] & 0x02) ? 16 : 8;
        const mag = (this.regs[1] & 0x01) ? 2 : 1;
        const span = size * mag;
        const attrs = [];
        for (let i = 0; i < 32; i++) {
            const y = this.vram[this.spriteAttrBase + i * 4];
            if (y === 0xd0) break;
            attrs.push({
                n: i,
                y, // top line is y+1 (0xFF means line 0)
                x: this.vram[this.spriteAttrBase + i * 4 + 1],
                name: this.vram[this.spriteAttrBase + i * 4 + 2],
                tag: this.vram[this.spriteAttrBase + i * 4 + 3],
            });
        }
        // Ownership per pixel for coincidence; -1 = none.
        const owner = new Int16Array(WIDTH * HEIGHT).fill(-1);
        let coincidence = false;
        for (let line = 0; line < HEIGHT; line++) {
            let onLine = 0;
            for (const s of attrs) {
                const top = (s.y + 1) & 0xff; // 0xFF wraps to 0 (§3.7.1)
                const rel = line - (top >= 0xe1 ? top - 0x100 : top);
                if (rel < 0 || rel >= span) continue;
                onLine++;
                if (onLine > 4) {
                    if ((this.status & 0x40) === 0) {
                        this.status |= 0x40 | (s.n & 0x1f); // 5S + number
                    }
                    break; // this and later sprites don't render on this line
                }
                const color = s.tag & 0x0f;
                const x0 = s.x - ((s.tag & 0x80) ? 32 : 0); // EC: early clock
                const srcRow = Math.floor(rel / mag);
                for (let px = 0; px < span; px++) {
                    const sx = Math.floor(px / mag);
                    // 16x16 sprites: four 8x8 chars, name & 0xFC, column-major
                    const chOff = size === 16 ? ((sx >> 3) * 2 + (srcRow >> 3)) : 0;
                    const nm = size === 16 ? (s.name & 0xfc) + chOff : s.name;
                    const bits = this.vram[this.spritePatternBase + nm * 8 + (srcRow & 7)];
                    if (((bits >> (7 - (sx & 7))) & 1) === 0) continue;
                    const x = x0 + px;
                    if (x < 0 || x >= WIDTH) continue;
                    const at = line * WIDTH + x;
                    if (owner[at] !== -1) { coincidence = true; continue; } // earlier sprite keeps the pixel
                    owner[at] = s.n;
                    if (color !== 0) this.indices[at] = color;
                }
            }
        }
        if (coincidence) this.status |= 0x20; // C
    }
    /** Snapshot VDP state for machine save. */
    saveState() {
        return {
            vram: this.vram.slice(),
            regs: this.regs.slice(),
            status: this.status,
            addr: this.addr,
            _latch: this._latch,
            _readBuf: this._readBuf,
            _toFrame: this._toFrame,
            frame: this.frame,
        };
    }

    /** Restore from a saveState() snapshot. */
    loadState(s) {
        this.vram.set(s.vram);
        this.regs.set(s.regs);
        this.status = s.status;
        this.addr = s.addr;
        this._latch = s._latch;
        this._readBuf = s._readBuf;
        this._toFrame = s._toFrame;
        this.frame = s.frame;
        this._renderFrame();
    }
}

export default TMS9918;
