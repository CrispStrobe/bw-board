/**
 * tilevga — rene6502/6502-vga-prop (public domain) as a machine chip:
 * the adjudicated 320x240 route for the 6502 tier. A Parallax
 * Propeller renders 40x30 tiles of 8x8 pixels, 16-of-64 colors; the
 * CPU sees a 16K dual-port VRAM window. This is adoption of a
 * public-domain design, not clean-room; semantics below are measured
 * from driver/vram_driver.spin and renderer_driver.spin.
 *
 * VRAM map (offsets inside the window):
 *   $0200        ctrl_cmd — which sections copy at the next vblank:
 *                bit0 control, bit1 tilemap+palettes, bit2 charset
 *   $0210-$0B6F  tilemap: 40x30 tiles, 16-bit LE. LSB = char code;
 *                MSB low nibble = palette index, bit 4 = user charset
 *   $0B70-$0C6F  16 palettes x 16 colors; color byte %RRGGBB00
 *   $0C70-$0C71  frame counter (16-bit LE) — WRITTEN BY THE CARD
 *   $0C80-$2C7F  user charset: 256 chars x 32 bytes, 8 rows of 4
 *                bytes; 4bpp, LOW nibble = leftmost pixel of the pair
 *
 * The double buffer is the educational core, exactly as measured:
 * the renderer never reads live VRAM. Each vblank the card reads
 * ctrl_cmd FROM VRAM, copies the enabled sections to its display-side
 * buffers, then increments the frame counter INTO VRAM — every
 * vblank, copy or not (vram_driver.spin: "increment frame (always)").
 * ctrl_cmd is cleared only at card startup, never per-frame: leaving
 * it set means the copy repeats every vblank; the demo's own idiom is
 * set bits → poll frame until it changes → write SCREEN_NONE.
 *
 * System font: funscii (public domain), 1bpp, bit 0 = leftmost pixel,
 * rendered in palette colors 0/1. User chars use palette colors 0-15.
 */
import { FUNSCII } from './funscii-font.js';

export const TILE_W = 320;
export const TILE_H = 240;
export const TILE_COLS = 40;
export const TILE_ROWS = 30;

const OFF_CMD = 0x0200;
const OFF_CONTROL = 0x0200;   // control section, 16 bytes
const SIZE_CONTROL = 0x10;
const OFF_TILEMAP = 0x0210;   // tilemap + palettes copy as one block
const SIZE_TILES = 0x0a60;    // 2400 tilemap + 256 palettes
const OFF_PALETTES = 0x0b70;
const OFF_FRAME = 0x0c70;
const OFF_CHARSET = 0x0c80;
const SIZE_CHARSET = 0x2000;

/** %RRGGBB00 → [r,g,b], 2 bits per channel. */
const level = (v2) => v2 * 85;

export class TileVGA {
    /** @param {{clockHz?: number}} [opts] CPU clock the machine
     *  advances this chip with; vblank derives 60 Hz from it. */
    constructor({ clockHz = 1_000_000 } = {}) {
        this.vram = new Uint8Array(0x4000);
        // Display-side buffers — what the renderer actually reads.
        this.dispControl = new Uint8Array(SIZE_CONTROL);
        this.dispTiles = new Uint8Array(SIZE_TILES);
        this.dispCharset = new Uint8Array(SIZE_CHARSET);
        this.frame = 0;
        this._vblankPeriod = clockHz / 60;
        this._toVblank = this._vblankPeriod;
    }

    /** CPU side of the dual-port VRAM. */
    read(off) { return this.vram[off & 0x3fff]; }
    write(off, val) { this.vram[off & 0x3fff] = val & 0xff; }

    /** @param {number} cycles CPU cycles elapsed */
    /** Never asserts an interrupt: a halted CPU cannot be woken here,
     *  and bulk advance is already the per-instruction norm. */
    nextWake() { return Infinity; }

    advance(cycles) {
        this._toVblank -= cycles;
        while (this._toVblank <= 0) {
            this._toVblank += this._vblankPeriod;
            this._vblank();
        }
    }

    _vblank() {
        const cmd = this.vram[OFF_CMD];
        if (cmd & 0x01) this.dispControl.set(this.vram.subarray(OFF_CONTROL, OFF_CONTROL + SIZE_CONTROL));
        if (cmd & 0x02) this.dispTiles.set(this.vram.subarray(OFF_TILEMAP, OFF_TILEMAP + SIZE_TILES));
        this.frame = (this.frame + 1) & 0xffff;
        this.vram[OFF_FRAME] = this.frame & 0xff;
        this.vram[OFF_FRAME + 1] = this.frame >> 8;
        if (cmd & 0x04) this.dispCharset.set(this.vram.subarray(OFF_CHARSET, OFF_CHARSET + SIZE_CHARSET));
    }

    /** The common video-face contract: 320x240 RGBA from the DISPLAY
     *  buffers. The Propeller always generates sync, so signal is
     *  always true — an untouched card shows a black screen, honestly. */
    videoFrame() {
        const rgba = new Uint8ClampedArray(TILE_W * TILE_H * 4);
        const palBase = OFF_PALETTES - OFF_TILEMAP;
        for (let ty = 0; ty < TILE_ROWS; ty++) {
            for (let tx = 0; tx < TILE_COLS; tx++) {
                const ti = (ty * TILE_COLS + tx) * 2;
                const ch = this.dispTiles[ti];
                const attr = this.dispTiles[ti + 1];
                const user = (attr & 0x10) !== 0;
                const pal = palBase + (attr & 0x0f) * 16;
                for (let row = 0; row < 8; row++) {
                    let out = ((ty * 8 + row) * TILE_W + tx * 8) * 4;
                    if (user) {
                        const g = ch * 32 + row * 4;
                        for (let x = 0; x < 8; x++, out += 4) {
                            const b = this.dispCharset[g + (x >> 1)];
                            const idx = x & 1 ? b >> 4 : b & 0x0f;
                            const c = this.dispTiles[pal + idx];
                            rgba[out] = level((c >> 6) & 3);
                            rgba[out + 1] = level((c >> 4) & 3);
                            rgba[out + 2] = level((c >> 2) & 3);
                            rgba[out + 3] = 255;
                        }
                    } else {
                        const bits = FUNSCII[ch * 8 + row]; // bit 0 = leftmost
                        for (let x = 0; x < 8; x++, out += 4) {
                            const c = this.dispTiles[pal + ((bits >> x) & 1)];
                            rgba[out] = level((c >> 6) & 3);
                            rgba[out + 1] = level((c >> 4) & 3);
                            rgba[out + 2] = level((c >> 2) & 3);
                            rgba[out + 3] = 255;
                        }
                    }
                }
            }
        }
        return { width: TILE_W, height: TILE_H, rgba, frame: this.frame, signal: true };
    }
    saveState() {
        return {
            vram: this.vram.slice(),
            dispControl: this.dispControl.slice(),
            dispTiles: this.dispTiles.slice(),
            dispCharset: this.dispCharset.slice(),
            frame: this.frame,
            _toVblank: this._toVblank,
        };
    }

    loadState(s) {
        this.vram.set(s.vram);
        this.dispControl.set(s.dispControl);
        this.dispTiles.set(s.dispTiles);
        this.dispCharset.set(s.dispCharset);
        this.frame = s.frame;
        this._toVblank = s._toVblank;
    }
}

export default TileVGA;
