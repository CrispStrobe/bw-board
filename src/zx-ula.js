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

const CLOCK_HZ = 3_500_000;  // the 48K machine's fixed clock
const FRAME_TSTATES = 69888; // 48K frame at 3.5 MHz → 50.08 Hz
const INT_LENGTH = 32;

export class ZXULA {
    /**
     * @param {Uint8Array} mem the machine's 64K (screen read live)
     * @param {{frameTstates?: number, screen?: Uint8Array}} [opts]
     *   frameTstates: 69888 (48K, default) or 70908 (128K timing).
     *   screen: a 16K view the bitmap+attrs live in; defaults to the
     *   $4000 window of mem. The 128K machine swaps this on OUT $7FFD
     *   bit 3 — the shadow screen in page 7.
     */
    constructor(mem, opts = {}) {
        this.mem = mem;
        this._frameTstates = opts.frameTstates ?? FRAME_TSTATES;
        this.screen = opts.screen ?? mem.subarray(0x4000, 0x8000);
        this.border = 7;           // boots white
        this.speaker = 0;
        this.speakerEdges = [];    // [tStateStamp, level]
        this.rows = new Uint8Array(8).fill(0x1f); // active-low, idle high
        this._toFrame = this._frameTstates;
        this._intLeft = 0;
        this.frame = 0;
        this.tStates = 0;          // total T-states, the edge clock
        // EAR input: a timed pulse list from the tape engine. Each entry
        // is { tStates, level } — the EAR bit flips at that T-state.
        // Between edges, the last level holds. Idle = 1 (high).
        this._earEdges = [];
        this._earIdx = 0;
        this._earLevel = 1;
    }

    /**
     * The audio-face contract, an ARRAY of one {hz, on} (E6.8.11a): the
     * dominant beeper frequency over the recent window, estimated from
     * speaker edges. Fewer than 4 edges in the window = silence — a
     * lone level change is a click, not a tone.
     * @param {number} [windowTs] look-back in T-states (default 50 ms)
     *
     * ALWAYS AN ARRAY, one element per voice (E6.8.11a). A single-voice
     * device returns a one-element array rather than a bare object: a
     * contract with two shapes is not a contract, and every producer added
     * after this one would otherwise have to guess which it was allowed to
     * return. The arity is meaningful — an empty array means NO VOICES, which
     * is how a machine with no sound chip differs from a silent one.
     * @returns {Array<{ hz: number, on: boolean }>} exactly one element
     */
    audioTone(windowTs = 175_000) {
        const since = this.tStates - windowTs;
        const e = this.speakerEdges;
        let first = e.length;
        while (first > 0 && e[first - 1][0] >= since) first--;
        const n = e.length - first;
        if (n < 4) return [{ hz: 0, on: false }];
        const span = e[e.length - 1][0] - e[first][0];
        if (span <= 0) return [{ hz: 0, on: false }];
        // n edges bound n-1 half-periods; a full period is two of them.
        const hz = CLOCK_HZ / (2 * (span / (n - 1)));
        return [{ hz: Math.round(hz), on: true }];
    }

    /** Machine-snapshot hooks. Held keys and recorded speaker edges
     *  are transients and reset; timing state carries over exactly. */
    saveState() {
        return {
            border: this.border, speaker: this.speaker, frame: this.frame,
            tStates: this.tStates, toFrame: this._toFrame, intLeft: this._intLeft,
        };
    }

    loadState(s) {
        this.border = s.border; this.speaker = s.speaker; this.frame = s.frame;
        this.tStates = s.tStates; this._toFrame = s.toFrame; this._intLeft = s.intLeft;
        this.rows.fill(0x1f);
        this.speakerEdges.length = 0;
        this._earEdges = [];
        this._earIdx = 0;
        this._earLevel = 1;
    }

    // ── Contention ─────────────────────────────────────────────────
    // Per-instruction approximation: given the current T-state position
    // in the frame, return the wait-state penalty from the 8-T-state
    // contention pattern. Returns 0 during border/blanking time.
    // The contention table: pattern offset 0→6, 1→5, ..., 6→0, 7→0.

    /** @type {number} T-states per scan line (224 for 48K, 228 for 128K) */
    get _lineTstates() { return this._frameTstates === 70908 ? 228 : 224; }

    /** @type {number} first contended scan line (48K: 64, 128K: 63) */
    get _firstContendedLine() { return this._frameTstates === 70908 ? 63 : 64; }

    /** @type {number} last contended scan line (exclusive) */
    get _lastContendedLine() { return this._firstContendedLine + 192; }

    /**
     * Memory contention penalty for a bus access at the current frame
     * position. Returns 0 when not in the contended display area.
     * @param {number} frameTs — T-states into the current frame
     *   (typically machine.cycles % frameTstates)
     * @returns {number} wait states (0-6)
     */
    contend(frameTs) {
        const lineTs = this._lineTstates;
        const line = Math.floor(frameTs / lineTs);
        if (line < this._firstContendedLine || line >= this._lastContendedLine) return 0;
        const col = frameTs % lineTs;
        // Only the first 128 T-states of each line are contended
        // (the pixel/attr fetch area)
        if (col >= 128) return 0;
        const pattern = col & 7; // 0-7 position in the 8-T-state cycle
        return pattern < 6 ? 6 - pattern : 0;
    }

    /**
     * Feed a list of timed EAR edges for bit-level tape playback.
     * Each entry: { tStates: number, level: 0|1 }. The list must be
     * sorted by tStates. Called by the TZX pulse scheduler.
     * @param {Array<{tStates: number, level: 0|1}>} edges
     */
    setEarEdges(edges) {
        this._earEdges = edges;
        this._earIdx = 0;
        this._earLevel = 1; // idle high before first edge
    }

    /** Clear the EAR input (tape stopped/ejected). */
    clearEar() {
        this._earEdges = [];
        this._earIdx = 0;
        this._earLevel = 1;
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
        // Advance EAR state to the current T-state position
        while (this._earIdx < this._earEdges.length
            && this.tStates >= this._earEdges[this._earIdx].tStates) {
            this._earLevel = this._earEdges[this._earIdx].level;
            this._earIdx++;
        }
        const ear = this._earLevel ? 0x40 : 0x00;
        return 0xa0 | ear | v; // bit7/5 float high, bit6 = EAR
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
        this.tStates += t;
        if (this._intLeft > 0) this._intLeft = Math.max(0, this._intLeft - t);
        this._toFrame -= t;
        while (this._toFrame <= 0) {
            this._toFrame += this._frameTstates;
            this._intLeft = INT_LENGTH;
            this.frame++;
        }
    }

    /** Level-triggered like the real pulse: ~32 T-states per frame. */
    get irqAsserted() { return this._intLeft > 0; }

    /** Cycles until the next frame INT — the HALT wake horizon. */
    nextWake() { return this._intLeft > 0 ? 1 : Math.max(1, this._toFrame); }

    /** The screen (with border frame) as palette indices. */
    renderFrame() {
        const W = ZX_W + 2 * ZX_BORDER, H = ZX_H + 2 * ZX_BORDER;
        const indices = new Uint8Array(W * H).fill(this.border);
        // FLASH: attribute bit 7 swaps ink/paper for 16 frames of
        // every 32 — the real ULA's cursor blink.
        const flashPhase = (this.frame >> 4) & 1;
        for (let y = 0; y < ZX_H; y++) {
            // The interleave: bits [7:6]=Y7Y6, [5:3]=Y2Y1Y0, [2:0]=Y5Y4Y3
            const addr = ((y & 0xc0) << 5)   // Y7Y6 → A12..A11
                | ((y & 0x07) << 8)   // Y2Y1Y0 → A10..A8
                | ((y & 0x38) << 2);  // Y5Y4Y3 → A7..A5
            for (let cx = 0; cx < 32; cx++) {
                const bits = this.screen[addr + cx];
                const attr = this.screen[0x1800 + (y >> 3) * 32 + cx];
                const bright = (attr & 0x40) ? 8 : 0;
                let ink = (attr & 0x07) + bright;
                let paper = ((attr >> 3) & 0x07) + bright;
                if ((attr & 0x80) && flashPhase) { const s = ink; ink = paper; paper = s; }
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
 * @param {{font?: Uint8Array}} [opts] the 768-byte character set
 *   (chars 32-127 × 8 rows). Defaults to mem's $3D00 — right for a
 *   48K machine; a BANKED machine's flat mem has no ROM, so pass
 *   machine.roms[1].subarray(0x3d00, 0x4000) there.
 */
export function zxScreenText(mem, opts = {}) {
    const font = opts.font ?? mem.subarray(0x3d00, 0x4000);
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
                    const g = (c - 32) * 8;
                    let ok = true;
                    for (let dy = 0; dy < 8; dy++) if (font[g + dy] !== cell[dy]) { ok = false; break; }
                    if (ok) { ch = String.fromCharCode(c); break; }
                }
            }
            line += ch;
        }
        lines.push(line.trimEnd());
    }
    return lines;
}
