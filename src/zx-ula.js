/**
 * ZX Spectrum ULA — the 48K machine's video/keyboard/beeper chip.
 *
 * Clean-room from the public documentation of the most-documented 8-bit
 * machine there is (the community timing/format references; Chris
 * Smith's ULA book is the deep source of record). What v1 models:
 *
 * - VIDEO: bitmap $4000-$57FF with the famous interleaved line order —
 *   address bits arrange as [010 Y7Y6 Y2Y1Y0 Y5Y4Y3 X4..X0], so line
 *   N+1 of a character row is 256 bytes away, not 32. Attributes
 *   $5800-$5AFF, one byte per 8x8 cell: FLASH|BRIGHT|PAPER(3)|INK(3).
 *   Border color from OUT (bits 0-2). videoFrame() renders 256x192
 *   plus a 16px border frame like a real TV picture.
 * - PORT $FE (every EVEN port — the ULA decodes only A0): OUT sets
 *   border(0-2)/MIC(3)/SPEAKER(4); IN reads the keyboard half-row(s)
 *   selected by ZERO bits in A8-A15, keys active-LOW in bits 0-4,
 *   EAR in bit 6 (idle high on real hardware with no tape).
 * - KEYBOARD: the 8x5 matrix, addressed by half-row. setKeys() takes
 *   a set of key names ('a'..'z','0'..'9','enter','space','caps',
 *   'sym') — the face's focus-routing contract feeds this.
 * - 50 Hz FRAME INTERRUPT: INT asserted each 69888 T-states (48K
 *   timing at 3.5 MHz), held ~32 T-states like the real pulse.
 * - BEEPER: speaker-bit edges recorded with timestamps for a future
 *   audio face (the buzzerEdges pattern).
 *
 * Stated v1 bounds: NO memory contention (timing-honest emulation of
 * contended RAM is a later, separate effort), no FLASH phase swap yet,
 * EAR/tape always idle.
 */

export const ZX_W = 256;
export const ZX_H = 192;
export const ZX_BORDER = 16;

/** The Spectrum palette: normal 0-7, bright 8-15 (GRB bit order). */
export const ZX_PALETTE = Array.from({ length: 16 }, (_, i) => {
    const v = i & 0x08 ? 255 : 205;
    return [
        i & 0x02 ? v : 0,   // R (bit 1)
        i & 0x04 ? v : 0,   // G (bit 2)
        i & 0x01 ? v : 0,   // B (bit 0)
        255,
    ];
});

/** key name → [halfRow (A8..A15 index), bit] per the 48K matrix. */
const MATRIX = {
    caps: [0, 0], z: [0, 1], x: [0, 2], c: [0, 3], v: [0, 4],
    a: [1, 0], s: [1, 1], d: [1, 2], f: [1, 3], g: [1, 4],
    q: [2, 0], w: [2, 1], e: [2, 2], r: [2, 3], t: [2, 4],
    1: [3, 0], 2: [3, 1], 3: [3, 2], 4: [3, 3], 5: [3, 4],
    0: [4, 0], 9: [4, 1], 8: [4, 2], 7: [4, 3], 6: [4, 4],
    p: [5, 0], o: [5, 1], i: [5, 2], u: [5, 3], y: [5, 4],
    enter: [6, 0], l: [6, 1], k: [6, 2], j: [6, 3], h: [6, 4],
    space: [7, 0], sym: [7, 1], m: [7, 2], n: [7, 3], b: [7, 4],
};

const FRAME_TSTATES = 69888; // 48K frame at 3.5 MHz → 50.08 Hz
const INT_LENGTH = 32;

export class ZXULA {
    /** @param {Uint8Array} mem the machine's 64K (screen read live) */
    constructor(mem) {
        this.mem = mem;
        this.border = 7;           // boots white
        this.speaker = 0;
        this.speakerEdges = [];    // [tStateStamp, level]
        this.rows = new Uint8Array(8).fill(0x1f); // active-low, idle high
        this._toFrame = FRAME_TSTATES;
        this._intLeft = 0;
        this.frame = 0;
    }

    /** Face-input contract: the currently held key names. */
    setKeys(names) {
        this.rows.fill(0x1f);
        for (const n of names) {
            const m = MATRIX[String(n).toLowerCase()];
            if (m) this.rows[m[0]] &= ~(1 << m[1]);
        }
    }

    /** IN from any even port: keyboard half-rows selected by ZERO bits
     *  of the high address byte, ANDed together like the real matrix. */
    in(port) {
        const high = (port >> 8) & 0xff;
        let v = 0x1f;
        for (let r = 0; r < 8; r++) {
            if (((high >> r) & 1) === 0) v &= this.rows[r];
        }
        return 0xa0 | v; // bit7/5 float high, bit6 EAR idle high, no tape
    }

    /** OUT to any even port. */
    out(_port, val, tStates) {
        this.border = val & 0x07;
        const spk = (val >> 4) & 1;
        if (spk !== this.speaker) {
            this.speaker = spk;
            this.speakerEdges.push([tStates, spk]);
            if (this.speakerEdges.length > 4096) this.speakerEdges.splice(0, 2048);
        }
    }

    /** @param {number} t T-states elapsed */
    advance(t) {
        if (this._intLeft > 0) this._intLeft = Math.max(0, this._intLeft - t);
        this._toFrame -= t;
        while (this._toFrame <= 0) {
            this._toFrame += FRAME_TSTATES;
            this._intLeft = INT_LENGTH;
            this.frame++;
        }
    }

    /** Level-triggered like the real pulse: ~32 T-states per frame. */
    get irqAsserted() { return this._intLeft > 0; }

    /** The screen (with border frame) as palette indices. */
    renderFrame() {
        const W = ZX_W + 2 * ZX_BORDER, H = ZX_H + 2 * ZX_BORDER;
        const indices = new Uint8Array(W * H).fill(this.border);
        for (let y = 0; y < ZX_H; y++) {
            // The interleave: bits [7:6]=Y7Y6, [5:3]=Y2Y1Y0, [2:0]=Y5Y4Y3
            const addr = 0x4000
                | ((y & 0xc0) << 5)   // Y7Y6 → A12..A11
                | ((y & 0x07) << 8)   // Y2Y1Y0 → A10..A8
                | ((y & 0x38) << 2);  // Y5Y4Y3 → A7..A5
            for (let cx = 0; cx < 32; cx++) {
                const bits = this.mem[addr + cx];
                const attr = this.mem[0x5800 + (y >> 3) * 32 + cx];
                const bright = (attr & 0x40) ? 8 : 0;
                const ink = (attr & 0x07) + bright;
                const paper = ((attr >> 3) & 0x07) + bright;
                const row = (y + ZX_BORDER) * W + ZX_BORDER + cx * 8;
                for (let b = 0; b < 8; b++) {
                    indices[row + b] = (bits >> (7 - b)) & 1 ? ink : paper;
                }
            }
        }
        return { width: W, height: H, indices, signal: true };
    }

    /** The common video-face contract. */
    videoFrame() {
        const f = this.renderFrame();
        const rgba = new Uint8ClampedArray(f.indices.length * 4);
        for (let i = 0; i < f.indices.length; i++) rgba.set(ZX_PALETTE[f.indices[i]], i * 4);
        return { width: f.width, height: f.height, rgba, frame: this.frame, signal: true };
    }
}

export default ZXULA;

/**
 * Decode the bitmap screen back to text by matching each 8x8 cell
 * against the ROM character set (chars 32-127 at ROM $3D00). Cells
 * that match no glyph (graphics, UDGs, inverse video) become '?'.
 * This turns every Spectrum acceptance test from pixel-counting into
 * string assertion — the same jump the HD44780's text state gave.
 * @param {Uint8Array} mem the machine's 64K (ROM font + screen)
 */
export function zxScreenText(mem) {
    const lines = [];
    for (let row = 0; row < 24; row++) {
        let line = '';
        for (let col = 0; col < 32; col++) {
            const y0 = row * 8;
            const cell = [];
            for (let dy = 0; dy < 8; dy++) {
                const y = y0 + dy;
                const addr = 0x4000 | ((y & 0xc0) << 5) | ((y & 0x07) << 8) | ((y & 0x38) << 2) | col;
                cell.push(mem[addr]);
            }
            let ch = '?';
            if (cell.every((b) => b === 0)) { ch = ' '; }
            else {
                for (let c = 32; c < 128; c++) {
                    const g = 0x3d00 + (c - 32) * 8;
                    let ok = true;
                    for (let dy = 0; dy < 8; dy++) if (mem[g + dy] !== cell[dy]) { ok = false; break; }
                    if (ok) { ch = String.fromCharCode(c); break; }
                }
            }
            line += ch;
        }
        lines.push(line.trimEnd());
    }
    return lines;
}
