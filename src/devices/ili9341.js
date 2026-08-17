/**
 * ILI9341 — 240x320 SPI color TFT + 8080-parallel variant.
 *
 * Clean-room from the ILITEK ILI9341 datasheet (V1.11):
 *
 * SPI mode (ili9341): 4-line serial interface II (§7.1.9) — D/CX as a
 * separate pin, MOSI sampled on SCK rising, one byte per D/CX level.
 *
 * 8080-parallel mode (ili9341_par): 8-bit data bus D0-D7 with WR/RD/RS/CS
 * strobes (§7.1.3). Data latched on WR rising edge; RS selects command
 * (low) or data (high). The common shield interface (MCUFRIEND, cheap
 * 2.4"/2.8" TFT shields).
 *
 * Both modes share the same command set (§8), GRAM, MADCTL, COLMOD,
 * address windows, scroll, inversion, and readback — only the transport
 * differs.
 */
import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;
const R_OUT = 50;
const R_OFF = 1e9;
export const ILI9341_W = 240;
export const ILI9341_H = 320;

// ─── Shared state factory ─────────────────────────────────────────

function ili9341InitState() {
    return {
        gram: new Uint16Array(ILI9341_W * ILI9341_H), // RGB565
        sleeping: true,     // SLPIN after reset (§8.2.11)
        displayOn: false,   // DISPOFF after reset (§8.2.16)
        inverted: false,    // INVOFF after reset (§8.2.14)
        madctl: 0,
        colmod18: false,
        // Address window + write cursor (§8.2.20-22)
        x0: 0, x1: ILI9341_W - 1, y0: 0, y1: ILI9341_H - 1,
        cx: 0, cy: 0,
        // Vertical scroll (§8.2.24-25)
        scrollTFA: 0, scrollVSA: ILI9341_H, scrollBFA: 0,
        scrollStart: 0,
        // Command decoding
        _cmd: null, _params: [],
        _ramWriting: false, _pixHi: null, _pix18: [],
        // RAMRD state
        _ramReading: false, _readDummy: false, _readBuf: [],
        _readBit: 0,
        unknown: [],        // opcodes seen but not implemented
        notes: [],
        writes: 0,          // pixels written (cheap change detector)
    };
}

// ─── Shared command/data processing ───────────────────────────────

/** One assembled byte, with its D/CX level. */
function byteIn(state, byte, isData, resetFn) {
    if (!isData) { // command byte (§8.1)
        state._cmd = byte;
        state._params = [];
        state._ramWriting = false;
        state._ramReading = false;
        state._pixHi = null; state._pix18 = [];
        switch (byte) {
            case 0x01: // SWRESET
                resetFn(state);
                break;
            case 0x10: state.sleeping = true; break;   // SLPIN
            case 0x11: state.sleeping = false; break;  // SLPOUT
            case 0x20: state.inverted = false; break;  // INVOFF (§8.2.14)
            case 0x21: state.inverted = true; break;   // INVON (§8.2.15)
            case 0x28: state.displayOn = false; break; // DISPOFF
            case 0x29: state.displayOn = true; break;  // DISPON
            case 0x2c:                                  // RAMWR
                state._ramWriting = true;
                state.cx = state.x0; state.cy = state.y0;
                break;
            case 0x2e:                                  // RAMRD (§8.2.23)
                state._ramReading = true;
                state._readDummy = true;
                state._readBuf = [];
                state._readBit = 0;
                state.cx = state.x0; state.cy = state.y0;
                loadReadBuf(state);
                break;
            case 0x2a: case 0x2b: case 0x33: case 0x36: case 0x37: case 0x3a:
                break; // parameters follow
            // ── Power / gamma / vendor opcodes: named, consumed, no-op ──
            case 0xb1:   // FRMCTR1 — frame rate control (normal mode)
            case 0xb6:   // DFUNCTR — display function control
            case 0xc0:   // PWCTR1  — power control 1
            case 0xc1:   // PWCTR2  — power control 2
            case 0xc5:   // VMCTR1  — VCOM control 1
            case 0xc7:   // VMCTR2  — VCOM control 2
            case 0xe0:   // GMCTRP1 — positive gamma correction
            case 0xe1:   // GMCTRN1 — negative gamma correction
            case 0x26:   // GAMSET  — gamma curve select
            case 0xf2:   // 3-gamma function disable (Adafruit)
            case 0xcb:   // Power control A (vendor, undocumented)
            case 0xcf:   // Power control B (vendor, undocumented)
            case 0xe8:   // Driver timing control A (vendor)
            case 0xea:   // Driver timing control B (vendor)
            case 0xed:   // Power on sequence control (vendor)
            case 0xef:   // Undocumented vendor init byte
            case 0xf7:   // Pump ratio control (vendor)
                break;  // params consumed silently below
            default:
                if (!state.unknown.includes(byte)) state.unknown.push(byte);
                break;
        }
        return;
    }
    // data byte
    if (state._ramWriting) { pixelByte(state, byte); return; }
    if (state._ramReading) return;
    state._params.push(byte);
    const p = state._params;
    switch (state._cmd) {
        case 0x2a: // CASET
            if (p.length === 4) {
                state.x0 = ((p[0] << 8) | p[1]);
                state.x1 = ((p[2] << 8) | p[3]);
            }
            break;
        case 0x2b: // PASET
            if (p.length === 4) {
                state.y0 = ((p[0] << 8) | p[1]);
                state.y1 = ((p[2] << 8) | p[3]);
            }
            break;
        case 0x33: // VSCRDEF
            if (p.length === 6) {
                state.scrollTFA = (p[0] << 8) | p[1];
                state.scrollVSA = (p[2] << 8) | p[3];
                state.scrollBFA = (p[4] << 8) | p[5];
            }
            break;
        case 0x36: // MADCTL
            state.madctl = p[0];
            break;
        case 0x37: // VSCRSADD
            if (p.length === 2) {
                state.scrollStart = (p[0] << 8) | p[1];
            }
            break;
        case 0x3a: // COLMOD
            state.colmod18 = (p[0] & 0x07) === 0x06;
            if (state.colmod18 && !state.notes.includes('colmod18')) {
                state.notes.push('colmod18');
            }
            break;
        default: break;
    }
}

function loadReadBuf(state) {
    const mv = state.madctl & 0x20, mx = state.madctl & 0x40, my = state.madctl & 0x80;
    let x = state.cx, y = state.cy;
    if (mv) [x, y] = [y, x];
    if (mx) x = ILI9341_W - 1 - x;
    if (my) y = ILI9341_H - 1 - y;
    let px = 0;
    if (x >= 0 && x < ILI9341_W && y >= 0 && y < ILI9341_H) {
        px = state.gram[y * ILI9341_W + x];
    }
    const r = ((px >> 11) & 0x1f) << 3;
    const g = ((px >> 5) & 0x3f) << 2;
    const b = (px & 0x1f) << 3;
    state._readBuf = [0x00, r, g, b];
    state._readBit = 0;
}

function pixelByte(state, byte) {
    if (state.colmod18) {
        state._pix18.push(byte);
        if (state._pix18.length === 3) {
            const [r, g, b] = state._pix18;
            state._pix18 = [];
            putPixel(state, ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
        }
        return;
    }
    if (state._pixHi === null) { state._pixHi = byte; return; }
    const px = (state._pixHi << 8) | byte;
    state._pixHi = null;
    putPixel(state, px);
}

function putPixel(state, rgb565) {
    let x = state.cx, y = state.cy;
    const mv = state.madctl & 0x20, mx = state.madctl & 0x40, my = state.madctl & 0x80;
    if (mv) [x, y] = [y, x];
    if (mx) x = ILI9341_W - 1 - x;
    if (my) y = ILI9341_H - 1 - y;
    if (x >= 0 && x < ILI9341_W && y >= 0 && y < ILI9341_H) {
        state.gram[y * ILI9341_W + x] = rgb565;
        state.writes++;
    }
    if (state.cx < state.x1) state.cx++;
    else { state.cx = state.x0; state.cy = state.cy < state.y1 ? state.cy + 1 : state.y0; }
}

// ─── SPI mode device (ili9341) ────────────────────────────────────

export function registerILI9341() {
    registerDevice('ili9341', {
        digitalFastPath: true,
        terminals: ['vcc', 'gnd', 'cs', 'rst', 'dc', 'mosi', 'sck', 'miso', 'led'],

        init() {
            return {
                drives: { miso: { vTh: 0, rTh: R_OFF } },
                ...ili9341InitState(),
                _bits: 0, _byte: 0,
                _lastSck: false, _lastCs: true, _lastRst: true,
            };
        },

        stamp(ctx) {
            for (const t of ['cs', 'rst', 'dc', 'mosi', 'sck']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
            ctx.conductance('led', 'gnd', 1 / 200);
        },

        update(part, state, read, tNs) {
            const vdd = read('vcc') || 3.3;
            const th = vdd * 0.5;
            const rst = read('rst') > th;
            const cs = read('cs') > th;
            const sck = read('sck') > th;

            if (!rst && state._lastRst) {
                Object.assign(state, this.init(part), {
                    _lastRst: false, _lastCs: cs, _lastSck: sck,
                });
                return false;
            }
            state._lastRst = rst;
            if (!rst) return false;

            if (cs) {
                state._bits = 0; state._byte = 0;
                if (state._ramReading) {
                    state.drives.miso = { vTh: 0, rTh: R_OFF };
                    state._ramReading = false;
                }
                state._lastCs = cs; state._lastSck = sck;
                return false;
            }
            state._lastCs = cs;

            let changed = false;

            if (sck && !state._lastSck) {
                state._byte = ((state._byte << 1) | (read('mosi') > th ? 1 : 0)) & 0xff;
                state._bits++;
                if (state._bits === 8) {
                    const dc = read('dc') > th;
                    byteIn(state, state._byte, dc, (s) => {
                        const keep = { _lastSck: s._lastSck, _lastCs: s._lastCs, _lastRst: s._lastRst, drives: s.drives };
                        Object.assign(s, ili9341InitState(), keep, { _bits: 0, _byte: 0 });
                    });
                    state._bits = 0; state._byte = 0;
                }
            }

            if (!sck && state._lastSck && state._ramReading && state._readBuf.length > 0) {
                const byteIdx = Math.floor(state._readBit / 8);
                const bitIdx = 7 - (state._readBit % 8);
                if (byteIdx < state._readBuf.length) {
                    const bit = (state._readBuf[byteIdx] >> bitIdx) & 1;
                    const want = bit ? vdd : 0;
                    if (state.drives.miso.vTh !== want || state.drives.miso.rTh !== R_OUT) {
                        state.drives.miso = { vTh: want, rTh: R_OUT };
                        changed = true;
                    }
                    state._readBit++;
                }
            }

            state._lastSck = sck;
            return changed;
        },
    });

    // ─── 8080-parallel mode device (ili9341_par) ──────────────────
    //
    // The common shield interface: 8-bit data bus D0-D7, active-low CS,
    // WR strobe (data latched on rising edge), RD strobe, RS = D/CX,
    // RST. Same command set, same GRAM.
    registerDevice('ili9341_par', {
        digitalFastPath: true,
        terminals: ['vcc', 'gnd', 'cs', 'rst', 'rs', 'wr', 'rd',
                    'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'led'],

        init() {
            return {
                drives: {},
                ...ili9341InitState(),
                _lastWr: true, _lastRd: true, _lastCs: true, _lastRst: true,
            };
        },

        stamp(ctx) {
            for (const t of ['cs', 'rst', 'rs', 'wr', 'rd',
                             'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
            ctx.conductance('led', 'gnd', 1 / 200);
        },

        update(part, state, read, tNs) {
            const vdd = read('vcc') || 3.3;
            const th = vdd * 0.5;
            const rst = read('rst') > th;
            const cs = read('cs') > th;
            const wr = read('wr') > th;
            const rd = read('rd') > th;

            // RESX low = hardware reset
            if (!rst && state._lastRst) {
                Object.assign(state, this.init(part), {
                    _lastRst: false, _lastCs: cs, _lastWr: wr, _lastRd: rd,
                });
                return false;
            }
            state._lastRst = rst;
            if (!rst) return false;

            // CS high: deselected
            if (cs) {
                state._lastCs = cs; state._lastWr = wr; state._lastRd = rd;
                return false;
            }
            state._lastCs = cs;

            let changed = false;

            // WR rising edge: latch the 8-bit data bus (§7.1.3)
            if (wr && !state._lastWr) {
                let byte = 0;
                for (let i = 0; i < 8; i++) {
                    if (read(`d${i}`) > th) byte |= (1 << i);
                }
                const isData = read('rs') > th; // RS high = data, low = command
                byteIn(state, byte, isData, (s) => {
                    const keep = { _lastWr: s._lastWr, _lastRd: s._lastRd, _lastCs: s._lastCs, _lastRst: s._lastRst, drives: s.drives };
                    Object.assign(s, ili9341InitState(), keep);
                });
            }

            // RD falling edge: drive data bus with read buffer (RAMRD)
            if (!rd && state._lastRd && state._ramReading && state._readBuf.length > 0) {
                // Advance past dummy byte on first read
                if (state._readDummy) {
                    state._readDummy = false;
                    // Skip dummy byte index
                    if (state._readBuf.length > 1) {
                        state._readBuf.shift();
                    }
                }
                if (state._readBuf.length > 0) {
                    const byte = state._readBuf.shift();
                    for (let i = 0; i < 8; i++) {
                        const bit = (byte >> i) & 1;
                        state.drives[`d${i}`] = { vTh: bit ? vdd : 0, rTh: R_OUT };
                    }
                    changed = true;
                }
            }
            // RD rising edge: release the bus
            if (rd && !state._lastRd) {
                for (let i = 0; i < 8; i++) {
                    if (state.drives[`d${i}`]) {
                        state.drives[`d${i}`] = { vTh: 0, rTh: R_OFF };
                        changed = true;
                    }
                }
            }

            state._lastWr = wr; state._lastRd = rd;
            return changed;
        },
    });
}

/**
 * GRAM as RGBA for a canvas face; black when the display is off.
 * Honors MADCTL BGR bit (bit 3) and display inversion.
 * Applies vertical scroll offset within the scrolling area.
 */
export function ili9341Rgba(state) {
    const out = new Uint8ClampedArray(ILI9341_W * ILI9341_H * 4);
    if (!state.displayOn || state.sleeping) {
        for (let i = 3; i < out.length; i += 4) out[i] = 255;
        return out;
    }
    const bgr = !!(state.madctl & 0x08);
    const inv = !!state.inverted;
    const tfa = state.scrollTFA || 0;
    const vsa = state.scrollVSA || ILI9341_H;
    const ss = state.scrollStart || 0;
    const scrollActive = (tfa + vsa + (state.scrollBFA || 0)) === ILI9341_H
        && vsa < ILI9341_H && ss !== 0;

    for (let row = 0; row < ILI9341_H; row++) {
        let srcRow = row;
        if (scrollActive && row >= tfa && row < tfa + vsa) {
            srcRow = tfa + ((row - tfa + ss - tfa) % vsa);
        }
        for (let col = 0; col < ILI9341_W; col++) {
            const px = state.gram[srcRow * ILI9341_W + col];
            let r = ((px >> 11) & 0x1f) << 3;
            let g = ((px >> 5) & 0x3f) << 2;
            let b = (px & 0x1f) << 3;
            if (bgr) { const tmp = r; r = b; b = tmp; }
            if (inv) { r = 255 - r; g = 255 - g; b = 255 - b; }
            const oi = (row * ILI9341_W + col) * 4;
            out[oi] = r; out[oi + 1] = g; out[oi + 2] = b; out[oi + 3] = 255;
        }
    }
    return out;
}

export default registerILI9341;
