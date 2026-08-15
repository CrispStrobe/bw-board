/**
 * simplevga — gfoot/simplevga6502 (Unlicense) as a machine-level card.
 *
 * The design, measured from src/lib/vga.s and the hardware notes (the
 * source is Unlicense, so this is adoption, not clean-room):
 *
 * - Dedicated video RAM scanned by counters; the CPU reaches it as a
 *   WRITE-ONLY overlay on $8000-$FFFF (reads still hit ROM — the card
 *   snoops the write strobe). 64K modelled as two 32K banks; the VIA's
 *   PORT B drives the bank bit (vga.s: `inc PORTB` at the row-128
 *   crossing, `sta PORTB` in vram_init).
 * - Layout: VRAM_STRIDE 256 bytes/row, 160x240 effective pixels
 *   (640x480 divided H/4, V/2). Linear address = row*256 + x, running
 *   straight across the bank boundary at row 128.
 * - THE SYNC LIVES IN VRAM: each byte carries pixel bits AND sync bits
 *   (BITS_PIXELDATA %00001111, BIT_HSYNC %00100000, BIT_VSYNC
 *   %01000000). vram_init writes the pulse patterns into the porch
 *   bytes; the counters just shift bytes out. A program that skips
 *   vram_init therefore produces NO SYNC — and this model says so
 *   (signal() === false) instead of painting pixels a real monitor
 *   would never lock onto. That refusal is the educational point.
 *
 * Palette: 4-bit pixel as IRGB — CONFIRMED against hardware/
 * schematic.png (rev 2, 29/12/2020), transcribed 2026-08-15: the
 * 74HCT273 latch drives Q0→VGA_B, Q1→VGA_G, Q2→VGA_R through
 * 470Ω/220Ω pads, and Q3 drives the COMMON bottom rail of the three
 * 680Ω resistors — a shared intensity bit that lifts even channels
 * whose color bit is low (hence the dim-channel value below). Q5/Q6
 * carry VGA_H/VGA_V, matching vga.s's %00100000/%01000000 sync bits;
 * Q4/Q7 are the /HR//VR counter resets.
 */

export const SVGA_W = 160;      // 640 / 4
export const SVGA_H = 240;      // 480 / 2
export const SVGA_STRIDE = 256; // 1024 / 4
const BIT_HSYNC = 0x20;
const BIT_VSYNC = 0x40;
const PIXEL_MASK = 0x0f;
// Horizontal timing in VRAM columns (spec / H_DIVISOR):
// visible 0..159, front porch to 163, sync pulse 164..187, back porch.
const HSYNC_START = (640 + 16) / 4;       // 164
const HSYNC_END = (640 + 16 + 96) / 4;    // 188 (exclusive)

/** IRGB → RGBA. Index = the low nibble of a VRAM byte. */
export const SVGA_PALETTE = Array.from({ length: 16 }, (_, i) => {
    const hi = i & 0x08 ? 255 : 160;
    const lo = i & 0x08 ? 85 : 0;
    return [
        i & 0x04 ? hi : lo,
        i & 0x02 ? hi : lo,
        i & 0x01 ? hi : lo,
        255,
    ];
});

export class SimpleVGA {
    /**
     * @param {{rows?: number}} [opts] visible rows. MEASURED default:
     *   snake.rom's vram_init fills 128 rows per 32K bank with vsync at
     *   row 117 — and gameplay occupies the FULL 128 rows (snake's own
     *   head crawls row 120): sync lives in columns 164+, never in the
     *   0-159 pixel columns, so all 128 rows render. The second bank
     *   is the DOUBLE BUFFER (PORTB page-flips), not row extension.
     */
    constructor({ rows = 128 } = {}) {
        this.rows = rows;
        this.vram = new Uint8Array(0x10000); // two 32K banks (double buffer)
        this.bank = 0;
        this.writes = 0;   // change generation for pollers
    }

    /** VIA port B output — bit 0 is the card's bank line. */
    setBank(portB) { this.bank = portB & 0x01; }

    /** CPU write snooped in the $8000-$FFFF window. */
    write(addr, val) {
        this.vram[(this.bank << 15) | (addr & 0x7fff)] = val & 0xff;
        this.writes++;
    }

    /**
     * Is the monitor locked? True when the VRAM carries the sync
     * pulses vram_init writes: HSYNC bits in the pulse columns of
     * (nearly) every visible row, and a VSYNC row below the visible
     * region. All-zero VRAM — the skipped-init case — fails both.
     */
    signal() {
        // Polarities MEASURED from vram_init's actual output (snake.rom,
        // VRAM dump 2026-08-15): HSYNC idle-HIGH — visible bytes carry
        // the bit set ($BE/$B0) and the pulse is the bit going LOW ($90)
        // at exactly the pulse columns; VSYNC is idle-LOW, pulsing HIGH
        // on its row(s). The first draft assumed set-during-pulse and
        // refused a perfectly good picture.
        let goodRows = 0;
        const bankBase = this.bank << 15;
        for (let row = 0; row < this.rows; row++) {
            const base = bankBase + row * SVGA_STRIDE;
            const idleSet = this.vram[base] & BIT_HSYNC;             // visible: idle high
            const pulseClear = !(this.vram[base + HSYNC_START] & BIT_HSYNC)
                && !(this.vram[base + HSYNC_END - 1] & BIT_HSYNC);   // pulse: low
            if (idleSet && pulseClear) goodRows++;
        }
        if (goodRows < this.rows * 0.9) return false;
        for (let row = 0; row < 128; row++) {
            if (this.vram[bankBase + row * SVGA_STRIDE + HSYNC_START] & BIT_VSYNC) return true;
        }
        return false;
    }

    /** Palette indices (0-15), row-major 160x240; null without sync. */
    renderFrame() {
        if (!this.signal()) return { width: SVGA_W, height: this.rows, indices: null, signal: false };
        const bankBase = this.bank << 15;
        const indices = new Uint8Array(SVGA_W * this.rows);
        for (let row = 0; row < this.rows; row++) {
            const base = bankBase + row * SVGA_STRIDE;
            for (let x = 0; x < SVGA_W; x++) {
                indices[row * SVGA_W + x] = this.vram[base + x] & PIXEL_MASK;
            }
        }
        return { width: SVGA_W, height: this.rows, indices, signal: true };
    }

    /** The common video-face contract (see TMS9918.videoFrame). signal
     *  false = the monitor is not locked; the face shows NO SIGNAL. */
    videoFrame() {
        return { width: SVGA_W, height: this.rows, rgba: this.rgba(), frame: this.writes, signal: this.signal() };
    }

    /** RGBA for a canvas face; black frame (not null) when unlocked —
     *  the face draws NO SIGNAL over it, mirroring a real monitor. */
    rgba() {
        const out = new Uint8ClampedArray(SVGA_W * this.rows * 4);
        const f = this.renderFrame();
        if (!f.signal) {
            for (let i = 3; i < out.length; i += 4) out[i] = 255;
            return out;
        }
        for (let i = 0; i < f.indices.length; i++) out.set(SVGA_PALETTE[f.indices[i]], i * 4);
        return out;
    }
}

export default SimpleVGA;
