/**
 * CGA/VGA framebuffer renderer -- the 8086 tier's pixels, and deliberately
 * NOT a chip. `renderMode(mode, read, opts)` is a pure function of memory:
 * it asks a callback for bytes and hands back an ImageData-shaped buffer.
 * There is no registration, no port decode, no clock and no state, which is
 * exactly what keeps this file independent of the machine layer -- the same
 * bargain the DOS layer struck when it decided the screen IS B8000h rather
 * than a private string.
 *
 * WHY THIS EXISTS. The 8086 game corpus does not go through DOS for output.
 * It writes video memory: B800:0000 for text mode 3, A000:0000 for mode
 * 13h, and the interleaved CGA banks for modes 4/5/6. `screenText()` in
 * i8086-dos.js already reads mode 3 back as CHARACTERS; nothing turned any
 * of it into PIXELS, so Breakout's mode-13h playfield and the 28 files of
 * retro-dos-graphics had nowhere to land.
 *
 * ACCURACY TIER: MEMORY TRUTH, NOT SIGNAL TRUTH. Given the bytes the CPU
 * has written and the mode it selected, the pixel grid is exact -- correct
 * bank interleave, correct bit packing, correct palette indices, correct
 * attribute decode. Everything BETWEEN the framebuffer and a phosphor is
 * absent, and named here rather than left to be discovered:
 *
 *   - NO 6845 TIMING. No horizontal or vertical retrace, no status port
 *     3DAh, no scanline counter. A program that polls 3DAh to avoid snow
 *     or to sync to vblank gets nothing from this file; that is the
 *     machine layer's business (see mc6845.js for the Z80 tier's CRTC).
 *   - NO SNOW. Real CGA corrupts the display when the CPU touches VRAM
 *     outside retrace. Reads here are free.
 *   - NO COMPOSITE ARTEFACT COLOUR. Mode 6 on a composite monitor shows
 *     sixteen artefact colours from pairs of adjacent bits, and mode 5's
 *     name ("colour burst off") is meaningless on RGBI. This renders the
 *     DIGITAL truth: mode 6 is two colours, mode 4/5 is four.
 *   - NO PALETTE REGISTERS AS PORTS. Ports 3D8h (mode control) and 3D9h
 *     (colour select) are not decoded, and neither are the VGA DAC ports
 *     3C8h/3C9h. Every one of their effects IS available, but as an
 *     explicit `opts` field the CALLER supplies -- `cgaPalette`,
 *     `intensity`, `background`, `blink`, `dac`. A pure function cannot
 *     have watched a port write, so it refuses to pretend it did.
 *   - NO CURSOR, NO PAGE REGISTER. The text cursor (6845 R10/R11) and a
 *     non-zero display start address (R12/R13, i.e. INT 10h/AH=05h page
 *     flipping) are not drawn or applied. `opts.base` is the escape hatch:
 *     page 1 of mode 3 is `base: 0xb8000 + 0x1000`.
 *   - NO EGA/VGA PLANAR MODES. 0Dh-12h are four bit planes behind the
 *     sequencer's latches, a different machine entirely. `likelyMode()`
 *     names them as unsupported rather than rendering rubbish.
 *
 * THE FOUR TRAPS, each of which a plausible implementation gets wrong:
 *
 *  1. THE CGA SCANLINE INTERLEAVE. Modes 4, 5 and 6 do NOT store rows
 *     consecutively. EVEN scanlines live at +0000h and ODD scanlines at
 *     +2000h, each bank holding 100 rows of 80 bytes. So row y is at
 *     `base + (y & 1) * 0x2000 + (y >> 1) * 80`. A naive `y * 80` renders
 *     the top half of the picture squashed into every other line and the
 *     bottom half as noise -- and it renders SOMETHING, which is why the
 *     bug survives casual inspection. 100 rows x 80 bytes is 8000 bytes
 *     per bank, so 192 bytes at the end of each 8192-byte bank are unused;
 *     programs sometimes stash data there.
 *
 *  2. THE ATTRIBUTE NIBBLE ORDER IS BACKWARDS from how it is written. The
 *     conventional notation 1Fh means "white on blue", but the LOW nibble
 *     is the FOREGROUND and the high nibble the background: 1Fh is fg=Fh
 *     (white), bg=1h (blue). Code that reads the byte left-to-right gets
 *     blue text on a white screen and looks merely ugly, not wrong.
 *
 *  3. BLINK VS. INTENSITY IS AMBIGUOUS IN THE BYTE. Attribute bit 7 means
 *     "blink this cell" or "the background is one of the eight BRIGHT
 *     colours", and which one is a property of the ADAPTER (3D8h bit 5),
 *     not of the byte. The BIOS leaves blink enabled, so `blink` defaults
 *     true and backgrounds are clamped to 0-7; a program that turned blink
 *     off to get sixteen background colours must say so with
 *     `blink: false`. Blinking is also time-dependent, which a pure
 *     function cannot know: `blinkOn` is the caller's phase, and when it
 *     is false a blinking cell renders entirely in its background colour.
 *
 *  4. COLOUR 6 IS BROWN, NOT DARK YELLOW. The IBM 5153 monitor pulls
 *     green down for that one entry, and the VGA DAC's default table bakes
 *     the correction in (2Ah,15h,00h). Generating the sixteen colours from
 *     the RGBI bits without the special case yields olive where every
 *     screenshot in the world shows brown.
 *
 * FONT PROVENANCE, and why there is no IBM ROM here. The 8x8 and 9x16 VGA
 * character ROMs are copyrighted works and are not in this repository.
 * Glyphs come from two sources, both auditable:
 *
 *   - EVERY CODE EXCEPT B0h-DFh AND FEh: funscii, via src/funscii-font.js
 *     -- Wuerfel21's unscii-derived 8x8 font, PUBLIC DOMAIN (Unlicense),
 *     vendored from rene6502/6502-vga-prop and already used by tilevga.js,
 *     the SSD1306 and the ILI9341. Its ASCII range sits at the right code
 *     points; ABOVE 7Fh IT IS NOT CP437, so accented letters and symbols
 *     in that range are funscii's own repertoire, not IBM's.
 *   - CODES B0h-DFh and FEh: GENERATED HERE, procedurally. These are
 *     CP437's semigraphics -- the shades, the half blocks and the 40
 *     line-drawing characters -- and they are pure geometry, so they are
 *     described by a four-arm spec (up/right/down/left, each none/single/
 *     double) and drawn by `verticalStrokes()`. This is the range text-mode
 *     games actually draw pictures with (Maze Runner's walls, every box
 *     border in the corpus), so it is the range worth getting exactly
 *     right rather than approximately.
 *
 * Because the semigraphics are generated AT THE CELL SIZE, a full block
 * (DBh) fills all nine columns of a 9x16 cell and block art tiles with no
 * seam. Real VGA achieves the same thing with a hack -- it repeats column
 * 8 for codes C0h-DFh only -- which this file does not need and therefore
 * does not implement. The 9x16 ASCII glyphs are funscii's 8x8 rows doubled
 * vertically with a blank ninth column; that is a SCALED font, not the
 * distinct 9x16 designs a real VGA ROM holds, and text will look coarser
 * than a screenshot for that reason.
 *
 * @module
 */
import { FUNSCII } from './funscii-font.js';

// ---- the VGA DAC default palette ------------------------------------
//
// Generated, not dumped. The 256 entries are three concatenated
// structures, and the third one is where mode 13h's reputation for
// "that ugly default palette" comes from:
//
//   00h-0Fh  the sixteen CGA colours (RGBI bits, with the brown fix)
//   10h-1Fh  sixteen greys
//   20h-F7h  216 = 9 x 6 x 4: nine value/saturation blocks, each a walk
//            around the hue wheel in six sextants of four steps
//   F8h-FFh  black
//
// Values are stored SIX BITS WIDE, because that is the width of a VGA DAC
// register -- a program that reads port 3C9h back sees these numbers, and
// `opts.dac` is expected in the same units.

/** 6-bit DAC value to 8-bit channel, the DAC's own bit replication. */
const exp6 = (v) => (((v & 0x3f) << 2) | ((v & 0x3f) >> 4)) & 0xff;

/**
 * One step of a hue ramp from `lo` to `hi` in quarters.
 *
 * The rounding is ROUND-HALF-DOWN, which is not an aesthetic choice: it is
 * what reproduces the IBM table exactly. The 0->63 ramp must give
 * 0,16,31,47,63 (so 15.75 rounds UP to 16 but 31.5 rounds DOWN to 31) and
 * the 45->63 ramp must give 45,49,54,58,63 (so 49.5 rounds DOWN). Ordinary
 * rounding gets one of the two wrong whichever way it breaks ties.
 */
const ramp = (lo, hi, k) => lo + (((hi - lo) * k * 2 + 3) >> 3);

/** The sixteen RGBI colours, 6-bit, brown fix included. */
function cgaColour(i) {
    const bright = (i & 8) !== 0;
    const on = bright ? 63 : 42;
    const off = bright ? 21 : 0;
    const r = (i & 4) ? on : off;
    let g = (i & 2) ? on : off;
    const b = (i & 1) ? on : off;
    // Trap 4: entry 6 alone is brown. The high-intensity twin (Eh) is
    // plain yellow, so the special case must not be applied to it.
    if (i === 6) g = 21;
    return [r, g, b];
}

/**
 * The sixteen greys of 10h-1Fh. There is no closed form for these -- the
 * ramp is perceptual, not linear (the steps widen from 5 to 7) -- so the
 * levels are listed. Sixteen integers are a measurement, not a font.
 */
const GREY_LEVELS = [0, 5, 8, 11, 14, 17, 20, 24, 28, 32, 36, 40, 45, 50, 56, 63];

/** Hue-wheel sextants as [r, g, b] recipes: 1 = hi, 0 = lo, 'u' = rising, 'd' = falling. */
const SEXTANTS = [
    ['u', 0, 1],    // blue    -> magenta
    [1, 0, 'd'],    // magenta -> red
    [1, 'u', 0],    // red     -> yellow
    ['d', 1, 0],    // yellow  -> green
    [0, 1, 'u'],    // green   -> cyan
    [0, 'd', 1],    // cyan    -> blue
];

function buildDefaultDac() {
    const dac = new Uint8Array(768);
    for (let i = 0; i < 16; i++) {
        const [r, g, b] = cgaColour(i);
        dac[i * 3] = r; dac[i * 3 + 1] = g; dac[i * 3 + 2] = b;
    }
    for (let i = 0; i < 16; i++) {
        const v = GREY_LEVELS[i];
        const p = (16 + i) * 3;
        dac[p] = v; dac[p + 1] = v; dac[p + 2] = v;
    }
    let idx = 32;
    for (const hi of [63, 28, 16]) {                 // three value levels
        // Three saturation levels: full, half, and five sevenths. The last
        // is not a guess -- 63*5/7 is exactly 45, 28*5/7 exactly 20, and
        // 16*5/7 floors to 11, which are the three tables' floor values.
        for (const lo of [0, hi >> 1, Math.floor(hi * 5 / 7)]) {
            for (const sx of SEXTANTS) {
                for (let k = 0; k < 4; k++) {
                    const chan = (spec) => {
                        if (spec === 1) return hi;
                        if (spec === 0) return lo;
                        if (spec === 'u') return ramp(lo, hi, k);
                        return hi - (ramp(lo, hi, k) - lo);      // 'd'
                    };
                    const p = idx * 3;
                    dac[p] = chan(sx[0]);
                    dac[p + 1] = chan(sx[1]);
                    dac[p + 2] = chan(sx[2]);
                    idx++;
                }
            }
        }
    }
    // F8h-FFh stay zero: the BIOS table really does end in eight blacks.
    return dac;
}

/** The mode 13h / VGA power-on palette, 256 entries x 3 six-bit channels. */
export const DEFAULT_DAC = buildDefaultDac();

// ---- CGA four-colour and two-colour palettes ------------------------
//
// Colour 0 in mode 4/5 is NOT fixed: it is the border/background field of
// port 3D9h (bits 0-3), so all sixteen colours are available for it while
// colours 1-3 come from a fixed set. `opts.background` is that field.

/** [cgaPalette][intensity] -> indices for pixel values 1, 2, 3. */
const CGA4 = [
    [[2, 4, 6], [10, 12, 14]],      // palette 0: green / red / brown
    [[3, 5, 7], [11, 13, 15]],      // palette 1: cyan / magenta / light grey
];
/**
 * Mode 5 is mode 4 with the composite colour burst disabled, and on an
 * RGBI monitor that bit does something quite different from what its name
 * says: it selects a THIRD palette, cyan/red/white. Nothing about it is
 * monochrome despite the BIOS calling the mode so.
 */
const CGA5 = [[3, 4, 7], [11, 12, 15]];

// ---- geometry --------------------------------------------------------

/** Bytes per scanline in every CGA graphics mode -- 320*2bpp and 640*1bpp both land on 80. */
const CGA_STRIDE = 80;
/** Distance to the odd-scanline bank. Trap 1. */
const CGA_BANK = 0x2000;

const MODE_TABLE = {
    0x00: { kind: 'text', cols: 40, rows: 25, base: 0xb8000 },
    0x01: { kind: 'text', cols: 40, rows: 25, base: 0xb8000 },
    0x02: { kind: 'text', cols: 80, rows: 25, base: 0xb8000 },
    0x03: { kind: 'text', cols: 80, rows: 25, base: 0xb8000 },
    0x04: { kind: 'cga4', width: 320, height: 200, base: 0xb8000 },
    0x05: { kind: 'cga4', width: 320, height: 200, base: 0xb8000, burst: false },
    0x06: { kind: 'cga2', width: 640, height: 200, base: 0xb8000 },
    0x13: { kind: 'vga8', width: 320, height: 200, base: 0xa0000 },
};

/** BIOS modes this file knows about but cannot draw, with the reason. */
const KNOWN_UNSUPPORTED = {
    0x07: 'MDA/Hercules 80x25 mono text at B0000h -- different base and attribute meanings',
    0x0d: 'EGA 320x200x16 planar -- four bit planes behind the sequencer',
    0x0e: 'EGA 640x200x16 planar',
    0x0f: 'EGA 640x350 mono planar',
    0x10: 'EGA 640x350x16 planar',
    0x11: 'VGA 640x480x2 planar',
    0x12: 'VGA 640x480x16 planar',
};

/**
 * Resolved geometry for a mode.
 *
 * @param {number} mode BIOS mode number (03h, 04h, 13h, ...)
 * @param {{ cellW?: number, cellH?: number, base?: number }} [opts]
 * @returns {{ kind: string, width: number, height: number, base: number,
 *             cols?: number, rows?: number, cellW?: number, cellH?: number }}
 */
export function modeInfo(mode, opts = {}) {
    const m = MODE_TABLE[mode & 0xff];
    if (!m) return null;
    const base = opts.base !== undefined ? opts.base : m.base;
    if (m.kind !== 'text') return { ...m, base };
    // The text raster is a consequence of the cell size, not a constant:
    // 80x25 is 720x400 on VGA (9x16 cells) and 640x200 on CGA (8x8).
    const cellW = opts.cellW || 9;
    const cellH = opts.cellH || 16;
    return { ...m, base, cellW, cellH, width: m.cols * cellW, height: m.rows * cellH };
}

// ---- the font --------------------------------------------------------
//
// Rows are stored as bit masks with BIT x = COLUMN x, so bit 0 is the
// LEFTMOST pixel. That is funscii's own order (and tilevga.js's), which is
// the opposite of an IBM ROM's MSB-left rows -- worth knowing before
// comparing a glyph against a hex dump from a PC font.

const CP437_SPEC = buildLineSpecs();
const fontCache = new Map();

/**
 * The CP437 line-drawing block as arm weights [up, right, down, left],
 * 0 = no arm, 1 = single stroke, 2 = double stroke.
 */
function buildLineSpecs() {
    const s = new Map();
    const put = (code, up, right, down, left) => s.set(code, [up, right, down, left]);
    put(0xb3, 1, 0, 1, 0);      // |
    put(0xb4, 1, 0, 1, 1);      // -|
    put(0xb5, 1, 0, 1, 2);      // =|
    put(0xb6, 2, 0, 2, 1);      // -||
    put(0xb7, 0, 0, 2, 1);      // -,,
    put(0xb8, 0, 0, 1, 2);      // =,
    put(0xb9, 2, 0, 2, 2);      // =||
    put(0xba, 2, 0, 2, 0);      // ||
    put(0xbb, 0, 0, 2, 2);      // =,,
    put(0xbc, 2, 0, 0, 2);      // ='' bottom right
    put(0xbd, 2, 0, 0, 1);      // -'' bottom right
    put(0xbe, 1, 0, 0, 2);      // =' bottom right
    put(0xbf, 0, 0, 1, 1);      // -, top right
    put(0xc0, 1, 1, 0, 0);      // '- bottom left
    put(0xc1, 1, 1, 0, 1);      // -'- tee up
    put(0xc2, 0, 1, 1, 1);      // -,- tee down
    put(0xc3, 1, 1, 1, 0);      // |- tee right
    put(0xc4, 0, 1, 0, 1);      // --
    put(0xc5, 1, 1, 1, 1);      // -+-
    put(0xc6, 1, 2, 1, 0);      // |= tee right
    put(0xc7, 2, 1, 2, 0);      // ||- tee right
    put(0xc8, 2, 2, 0, 0);      // ''= bottom left
    put(0xc9, 0, 2, 2, 0);      // ,,= top left
    put(0xca, 2, 2, 0, 2);      // ='= tee up
    put(0xcb, 0, 2, 2, 2);      // =,= tee down
    put(0xcc, 2, 2, 2, 0);      // ||= tee right
    put(0xcd, 0, 2, 0, 2);      // ==
    put(0xce, 2, 2, 2, 2);      // =+= cross
    put(0xcf, 1, 2, 0, 2);      // = tee up, single stem
    put(0xd0, 2, 1, 0, 1);      // - tee up, double stem
    put(0xd1, 0, 2, 1, 2);      // = tee down, single stem
    put(0xd2, 0, 1, 2, 1);      // - tee down, double stem
    put(0xd3, 2, 1, 0, 0);      // '- bottom left, double stem
    put(0xd4, 1, 2, 0, 0);      // '= bottom left, single stem
    put(0xd5, 0, 2, 1, 0);      // ,= top left, single stem
    put(0xd6, 0, 1, 2, 0);      // ,- top left, double stem
    put(0xd7, 2, 1, 2, 1);      // -||- cross
    put(0xd8, 1, 2, 1, 2);      // =|= cross
    put(0xd9, 1, 0, 0, 1);      // -' bottom right
    put(0xda, 0, 1, 1, 0);      // ,- top left
    return s;
}

/**
 * Where the strokes of one glyph's VERTICAL arms run, as [col, y0, y1].
 *
 * The whole difficulty of generating box art is deciding where a stroke
 * STOPS, because a double line has two lanes and they do not stop in the
 * same place: in a top-left double corner the outer lane turns at the
 * outer corner and the inner lane at the inner one. The rules below were
 * derived by working backwards from what each CP437 glyph has to look
 * like, and the single non-obvious one is that A STROKE IS ONLY EVER
 * BROKEN WHEN BOTH AXES ARE DOUBLE. Double-crossing-double leaves the hole
 * in the middle of a '+'-shaped glyph; every mixed crossing draws straight
 * through.
 *
 * The horizontal arms are obtained by calling this again on a transposed
 * glyph, which is why only one axis is written out.
 */
function verticalStrokes(w, h, arms) {
    const [up, right, down, left] = arms;
    const v = Math.max(up, down);
    if (v === 0) return [];
    const hw = Math.max(left, right);
    const cx = w >> 1, cy = h >> 1;
    const lanes = v === 2 ? [cx - 1, cx + 1] : [cx];
    const rows = hw === 2 ? [cy - 1, cy + 1] : hw === 1 ? [cy] : [];
    const out = [];
    for (const dir of [-1, 1]) {                    // -1 = the up arm, +1 = down
        if (dir < 0 ? !up : !down) continue;
        const edge = dir < 0 ? 0 : h - 1;
        const farEdge = dir < 0 ? h - 1 : 0;
        const through = dir < 0 ? down : up;        // is this axis a through line?
        const nearRow = dir < 0 ? Math.min(...rows) : Math.max(...rows);
        const farRow = dir < 0 ? Math.max(...rows) : Math.min(...rows);
        for (const c of lanes) {
            let stop;
            if (rows.length === 0) {
                stop = through ? farEdge : cy;
            } else if (v === 2 && hw === 2) {
                if (left && right) {
                    stop = nearRow;                 // the broken crossing
                } else {
                    // A double corner or double tee: the lane on the far
                    // side from the crossbar takes the far row.
                    const nearLane = left ? Math.min(...lanes) : Math.max(...lanes);
                    stop = c === nearLane ? nearRow : farRow;
                }
            } else if (through) {
                stop = farEdge;                     // draws straight through
            } else if (left && right) {
                stop = nearRow;                     // a stem meeting a crossbar
            } else {
                stop = farRow;                      // a corner must close both lanes
            }
            out.push([c, Math.min(edge, stop), Math.max(edge, stop)]);
        }
    }
    return out;
}

/** Fill one glyph's rows from the CP437 semigraphics generators. */
function generateSemigraphic(code, rows, off, w, h) {
    const set = (x, y) => { if (x >= 0 && x < w && y >= 0 && y < h) rows[off + y] |= 1 << x; };

    if (code >= 0xb0 && code <= 0xb2) {
        // The three shades, as densities rather than as IBM's exact
        // patterns: a quarter-density lattice, the checkerboard, and the
        // lattice's complement. IBM's B0h is sparser still (12.5%); the
        // structure -- dotted rows alternating with blank or solid ones --
        // is the same, and these are the ones Unicode's names describe.
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const lattice = (x & 1) === 0 && (y & 1) === 0;
                const on = code === 0xb0 ? lattice
                    : code === 0xb1 ? ((x + y) & 1) === 0
                        : !lattice;
                if (on) set(x, y);
            }
        }
        return;
    }
    if (code >= 0xdb && code <= 0xdf) {
        // The half blocks tile EXACTLY: with an odd cell width the left
        // half takes floor(w/2) columns and the right half the rest, so
        // DDh beside DEh leaves no seam and no overlap.
        const half = w >> 1;
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const on = code === 0xdb ? true
                    : code === 0xdc ? y >= (h >> 1)
                        : code === 0xdd ? x < half
                            : code === 0xde ? x >= half
                                : y < (h >> 1);             // DFh, upper half
                if (on) set(x, y);
            }
        }
        return;
    }
    if (code === 0xfe) {
        for (let y = h >> 2; y < h - (h >> 2); y++) {
            for (let x = 2; x <= w - 3; x++) set(x, y);
        }
        return;
    }
    const arms = CP437_SPEC.get(code);
    for (const [c, y0, y1] of verticalStrokes(w, h, arms)) {
        for (let y = y0; y <= y1; y++) set(c, y);
    }
    // Transposing swaps up<->left and down<->right, so the same solver
    // yields the horizontal arms with no second implementation.
    const [up, right, down, left] = arms;
    for (const [r, x0, x1] of verticalStrokes(h, w, [left, down, right, up])) {
        for (let x = x0; x <= x1; x++) set(x, r);
    }
}

/**
 * The glyph table for one cell size: 256 glyphs of `cellH` rows, bit x =
 * column x. Memoised because a renderer is called once per frame and this
 * is a pure function of its two arguments -- a cache, not state.
 *
 * @param {number} cellW 8 or 9 (a wider cell just leaves blank columns)
 * @param {number} cellH 8 or 16 (funscii's eight rows are doubled for 16)
 */
export function buildFont(cellW = 9, cellH = 16) {
    const key = cellW * 100 + cellH;
    const hit = fontCache.get(key);
    if (hit) return hit;
    const rows = new Uint16Array(256 * cellH);
    for (let code = 0; code < 256; code++) {
        const off = code * cellH;
        if (CP437_SPEC.has(code) || (code >= 0xb0 && code <= 0xb2)
            || (code >= 0xdb && code <= 0xdf) || code === 0xfe) {
            generateSemigraphic(code, rows, off, cellW, cellH);
            continue;
        }
        for (let y = 0; y < cellH; y++) {
            // Nearest-row scaling of funscii's eight rows. For cellH 8
            // this is the identity; for 16 it doubles each row.
            const src = FUNSCII[code * 8 + (((y * 8) / cellH) | 0)];
            rows[off + y] = src & 0xff;              // columns 8+ stay blank
        }
    }
    fontCache.set(key, rows);
    return rows;
}

// ---- rendering -------------------------------------------------------

/** Expand a 256-entry 6-bit DAC into a flat RGBA lookup, once per frame. */
function dacToLut(dac) {
    const lut = new Uint8ClampedArray(1024);
    for (let i = 0; i < 256; i++) {
        lut[i * 4] = exp6(dac[i * 3]);
        lut[i * 4 + 1] = exp6(dac[i * 3 + 1]);
        lut[i * 4 + 2] = exp6(dac[i * 3 + 2]);
        lut[i * 4 + 3] = 255;
    }
    return lut;
}

/**
 * Turn video memory into pixels.
 *
 * @param {number} mode BIOS mode number as INT 10h/AH=00h took it: 00h-03h
 *   text, 04h/05h CGA four-colour, 06h CGA two-colour, 13h VGA 256-colour.
 *   The CALLER supplies this. Nothing in this file watches the CPU, and
 *   i8086-dos.js is not modified to report it -- see `likelyMode()` for
 *   turning a log of AH=00h calls into this argument.
 * @param {(addr: number) => number} read reads ONE byte at a PHYSICAL
 *   (20-bit linear) address. Never written to, never read outside the
 *   mode's own window.
 * @param {{
 *   base?: number, dac?: ArrayLike<number>,
 *   cellW?: number, cellH?: number, blink?: boolean, blinkOn?: boolean,
 *   cgaPalette?: number, intensity?: boolean, background?: number,
 *   foreground?: number
 * }} [opts]
 *   `base` relocates the framebuffer (page flipping, or a machine that maps
 *   CGA elsewhere). `dac` is a 768-entry SIX-BIT palette as the VGA DAC
 *   holds it, for programs that reprogrammed it through 3C8h/3C9h or INT
 *   10h/AX=1012h; it applies to every mode, since the sixteen- and
 *   four-colour modes also resolve to DAC indices. `blink`/`blinkOn` are
 *   trap 3. `cgaPalette`/`intensity`/`background` are the three fields of
 *   port 3D9h for modes 4/5; `foreground` is that port's colour field in
 *   mode 6, where the "white" of a two-colour screen is tintable.
 * @returns {{ width: number, height: number, rgba: Uint8ClampedArray }}
 *   `rgba` is ready for `new ImageData(rgba, width, height)`.
 */
export function renderMode(mode, read, opts = {}) {
    const info = modeInfo(mode, opts);
    if (!info) {
        const why = KNOWN_UNSUPPORTED[mode & 0xff];
        throw new Error(`i8086-cga: mode ${(mode & 0xff).toString(16).toUpperCase()}h`
            + ` is not rendered${why ? ' -- ' + why : ''}`);
    }
    const lut = dacToLut(opts.dac || DEFAULT_DAC);
    const { width, height, base } = info;
    const rgba = new Uint8ClampedArray(width * height * 4);
    const rd = (a) => read(a) & 0xff;

    /** Write one pixel from a DAC index. */
    const px = (o, idx) => {
        const p = (idx & 0xff) * 4;
        rgba[o] = lut[p]; rgba[o + 1] = lut[p + 1];
        rgba[o + 2] = lut[p + 2]; rgba[o + 3] = 255;
    };

    if (info.kind === 'text') return renderText(info, rd, opts, rgba, px);
    if (info.kind === 'vga8') {
        // The one mode with no packing and no interleave: one byte, one
        // pixel, in order. This is why every corpus game that wants
        // graphics wants mode 13h.
        for (let i = 0, n = width * height; i < n; i++) px(i * 4, rd(base + i));
        return { width, height, rgba };
    }
    if (info.kind === 'cga4') {
        const set = mode === 0x05
            ? CGA5[opts.intensity ? 1 : 0]
            : CGA4[opts.cgaPalette ? 1 : 0][opts.intensity ? 1 : 0];
        const bg = (opts.background || 0) & 0x0f;
        for (let y = 0; y < height; y++) {
            const row = base + (y & 1) * CGA_BANK + (y >> 1) * CGA_STRIDE;   // trap 1
            let o = y * width * 4;
            for (let x = 0; x < width; x += 4) {
                const b = rd(row + (x >> 2));
                // Leftmost pixel in the HIGH bit pair, so the shift counts
                // down: 6, 4, 2, 0.
                for (let k = 0; k < 4; k++, o += 4) {
                    const v = (b >> (6 - k * 2)) & 3;
                    px(o, v === 0 ? bg : set[v - 1]);
                }
            }
        }
        return { width, height, rgba };
    }
    // cga2: mode 6, one bit per pixel, bit 7 leftmost, same interleave.
    const fg = opts.foreground === undefined ? 15 : opts.foreground & 0x0f;
    for (let y = 0; y < height; y++) {
        const row = base + (y & 1) * CGA_BANK + (y >> 1) * CGA_STRIDE;
        let o = y * width * 4;
        for (let x = 0; x < width; x += 8) {
            const b = rd(row + (x >> 3));
            for (let k = 7; k >= 0; k--, o += 4) px(o, (b >> k) & 1 ? fg : 0);
        }
    }
    return { width, height, rgba };
}

function renderText(info, rd, opts, rgba, px) {
    const { cols, rows, cellW, cellH, base, width, height } = info;
    const font = buildFont(cellW, cellH);
    const blink = opts.blink !== false;                  // BIOS default: on
    const blinkOn = opts.blinkOn !== false;
    for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
            const cell = base + (row * cols + col) * 2;
            const code = rd(cell);
            const attr = rd(cell + 1);
            // Trap 2: LOW nibble is the foreground.
            let fg = attr & 0x0f;
            // Trap 3: bit 7 is blink or background intensity, and only the
            // adapter knows which.
            const bg = blink ? (attr >> 4) & 0x07 : (attr >> 4) & 0x0f;
            if (blink && (attr & 0x80) && !blinkOn) fg = bg;
            const glyph = code * cellH;
            for (let y = 0; y < cellH; y++) {
                const bits = font[glyph + y];
                let o = ((row * cellH + y) * width + col * cellW) * 4;
                for (let x = 0; x < cellW; x++, o += 4) {
                    px(o, (bits >> x) & 1 ? fg : bg);    // bit x = column x
                }
            }
        }
    }
    return { width, height, rgba };
}

// ---- which mode is on screen? ---------------------------------------

/**
 * Guess the mode a program selected from the INT 10h/AH=00h calls the DOS
 * layer saw.
 *
 * THE CALLER SUPPLIES THE LOG. i8086-dos.js is deliberately not modified
 * to produce it: this file must stay a pure function of memory, and the
 * DOS layer must stay free of a renderer's opinions. Pass the AL values in
 * call order -- a machine layer can collect them by wrapping the INT 10h
 * service, or a debug session can read them off a trace.
 *
 * @param {ArrayLike<number>} [seen] AL values from AH=00h, oldest first.
 * @param {{ fallback?: number }} [opts] What to answer when nothing was
 *   seen. Defaults to 03h, which is both the BIOS power-on mode for a
 *   colour adapter and the mode i8086-dos.js already renders text in, so a
 *   program that never called INT 10h is correctly assumed to be in it.
 * @returns {{ mode: number, supported: boolean, reason: string }}
 */
export function likelyMode(seen = [], opts = {}) {
    const fallback = opts.fallback === undefined ? 0x03 : opts.fallback;
    if (!seen || seen.length === 0) {
        return {
            mode: fallback, supported: !!MODE_TABLE[fallback],
            reason: 'no INT 10h/AH=00h call was seen; assuming the power-on text mode',
        };
    }
    const raw = seen[seen.length - 1] & 0xff;
    // AL BIT 7 IS NOT PART OF THE MODE. Set, it means "do not clear the
    // display" -- so AL=83h is mode 3, and a table lookup on the raw byte
    // finds nothing and reports a mode-3 program as unsupported.
    const mode = raw & 0x7f;
    const noClear = (raw & 0x80) !== 0;
    const note = (seen.length > 1 ? `last of ${seen.length} mode sets` : 'one mode set')
        + (noClear ? ', AL bit 7 set (display not cleared)' : '');
    if (MODE_TABLE[mode]) {
        return { mode, supported: true, reason: `${note}; renderable` };
    }
    const why = KNOWN_UNSUPPORTED[mode];
    return {
        mode, supported: false,
        reason: `${note}; ${why || 'unknown or VESA mode number'}`,
    };
}
