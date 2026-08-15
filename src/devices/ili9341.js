/**
 * ILI9341 — 240x320 SPI color TFT, the display of the course-project
 * and handheld tier (video tier rung 2).
 *
 * Clean-room from the ILITEK ILI9341 datasheet (V1.11): 4-line serial
 * interface II (§7.1.9 — D/CX as a separate pin, one byte per D/CX
 * level), the command set (§8), column/page address windows with
 * wrap-and-advance GRAM writes (§8.2.20-22), MADCTL row/column
 * exchange and mirroring (§8.2.29), COLMOD 16/18-bit pixel formats
 * (§8.2.33). The unlicensed 6502TFTScreen and vectron_handheld repos
 * were never read by this implementation — the LED-cube procedure.
 *
 * v1 bounds, stated:
 * - Write path only: MISO stays high-Z (readback commands are rare in
 *   drivers; RAMRD can join later with its dummy-byte rule).
 * - 16-bit RGB565 pixels fully; 18-bit COLMOD accepted and stored as
 *   truncated 565 (a note lands in state.notes the first time).
 * - Commands outside the implemented set are consumed with their
 *   parameter bytes ignored — unknown-command opcodes are RECORDED in
 *   state.unknown so a driver differential can list what it needed.
 */
import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;
export const ILI9341_W = 240;
export const ILI9341_H = 320;

export function registerILI9341() {
    registerDevice('ili9341', {
        // The common 8-pin module header (vcc gnd cs reset dc mosi sck led)
        // plus miso for completeness.
        terminals: ['vcc', 'gnd', 'cs', 'rst', 'dc', 'mosi', 'sck', 'miso', 'led'],

        init() {
            return {
                drives: {},
                gram: new Uint16Array(ILI9341_W * ILI9341_H), // RGB565
                sleeping: true,     // SLPIN after reset (§8.2.11)
                displayOn: false,   // DISPOFF after reset (§8.2.16)
                madctl: 0,
                colmod18: false,
                // Address window + write cursor (§8.2.20-22)
                x0: 0, x1: ILI9341_W - 1, y0: 0, y1: ILI9341_H - 1,
                cx: 0, cy: 0,
                // SPI byte assembly
                _bits: 0, _byte: 0,
                _lastSck: false, _lastCs: true, _lastRst: true,
                // Command decoding
                _cmd: null, _params: [],
                _ramWriting: false, _pixHi: null, _pix18: [],
                unknown: [],        // opcodes seen but not implemented
                notes: [],
                writes: 0,          // pixels written (cheap change detector)
            };
        },

        stamp(ctx) {
            for (const t of ['cs', 'rst', 'dc', 'mosi', 'sck']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
            // Backlight LED string through its series behavior (~15 mA)
            ctx.conductance('led', 'gnd', 1 / 200);
        },

        update(part, state, read, tNs) {
            const vdd = read('vcc') || 3.3;
            const th = vdd * 0.5;
            const rst = read('rst') > th;
            const cs = read('cs') > th;
            const sck = read('sck') > th;

            // RESX low = hardware reset (§15.4): back to sleeping defaults.
            if (!rst && state._lastRst) {
                Object.assign(state, this.init(part), {
                    _lastRst: false, _lastCs: cs, _lastSck: sck,
                });
                return false;
            }
            state._lastRst = rst;
            if (!rst) return false;

            // CS high: deselected — byte assembly resets, command state
            // survives (a driver may pulse CS between bytes).
            if (cs) {
                state._bits = 0; state._byte = 0;
                state._lastCs = cs; state._lastSck = sck;
                return false;
            }
            state._lastCs = cs;

            if (sck && !state._lastSck) { // rising edge: sample MOSI (§7.1.9)
                state._byte = ((state._byte << 1) | (read('mosi') > th ? 1 : 0)) & 0xff;
                state._bits++;
                if (state._bits === 8) {
                    const dc = read('dc') > th; // D/CX sampled with the byte
                    this._byteIn(state, state._byte, dc);
                    state._bits = 0; state._byte = 0;
                }
            }
            state._lastSck = sck;
            return false;
        },

        /** One assembled byte, with its D/CX level. */
        _byteIn(state, byte, isData) {
            if (!isData) { // command byte (§8.1)
                state._cmd = byte;
                state._params = [];
                state._ramWriting = false;
                state._pixHi = null; state._pix18 = [];
                switch (byte) {
                    case 0x01: { // SWRESET — like RESX, minus the pin
                        const keep = { _lastSck: state._lastSck, _lastCs: state._lastCs, _lastRst: state._lastRst };
                        Object.assign(state, this.init({}), keep);
                        break;
                    }
                    case 0x10: state.sleeping = true; break;   // SLPIN
                    case 0x11: state.sleeping = false; break;  // SLPOUT
                    case 0x28: state.displayOn = false; break; // DISPOFF
                    case 0x29: state.displayOn = true; break;  // DISPON
                    case 0x2c:                                  // RAMWR
                        state._ramWriting = true;
                        state.cx = state.x0; state.cy = state.y0;
                        break;
                    case 0x2a: case 0x2b: case 0x36: case 0x3a:
                        break; // parameters follow
                    default:
                        if (!state.unknown.includes(byte)) state.unknown.push(byte);
                        break;
                }
                return;
            }
            // data byte
            if (state._ramWriting) { this._pixelByte(state, byte); return; }
            state._params.push(byte);
            const p = state._params;
            switch (state._cmd) {
                case 0x2a: // CASET: x0/x1, two bytes each (§8.2.20)
                    if (p.length === 4) {
                        state.x0 = ((p[0] << 8) | p[1]);
                        state.x1 = ((p[2] << 8) | p[3]);
                    }
                    break;
                case 0x2b: // PASET: y0/y1 (§8.2.21)
                    if (p.length === 4) {
                        state.y0 = ((p[0] << 8) | p[1]);
                        state.y1 = ((p[2] << 8) | p[3]);
                    }
                    break;
                case 0x36: // MADCTL (§8.2.29)
                    state.madctl = p[0];
                    break;
                case 0x3a: // COLMOD (§8.2.33): 0x55 = 16-bit, 0x66 = 18-bit
                    state.colmod18 = (p[0] & 0x07) === 0x06;
                    if (state.colmod18 && !state.notes.includes('colmod18')) {
                        state.notes.push('colmod18'); // stored truncated to 565
                    }
                    break;
                default: break; // parameters of unimplemented commands: consumed
            }
        },

        _pixelByte(state, byte) {
            if (state.colmod18) {
                state._pix18.push(byte);
                if (state._pix18.length === 3) {
                    const [r, g, b] = state._pix18;
                    state._pix18 = [];
                    this._putPixel(state,
                        ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3));
                }
                return;
            }
            if (state._pixHi === null) { state._pixHi = byte; return; }
            const px = (state._pixHi << 8) | byte;
            state._pixHi = null;
            this._putPixel(state, px);
        },

        _putPixel(state, rgb565) {
            // MADCTL MV/MX/MY resolve the memory-to-panel mapping. The
            // cursor walks the WINDOW in logical order; the flags remap
            // the landing coordinate (§8.2.29 fig — MV swaps, MX/MY mirror).
            let x = state.cx, y = state.cy;
            const mv = state.madctl & 0x20, mx = state.madctl & 0x40, my = state.madctl & 0x80;
            if (mv) [x, y] = [y, x];
            if (mx) x = ILI9341_W - 1 - x;
            if (my) y = ILI9341_H - 1 - y;
            if (x >= 0 && x < ILI9341_W && y >= 0 && y < ILI9341_H) {
                state.gram[y * ILI9341_W + x] = rgb565;
                state.writes++;
            }
            // Advance the cursor through the window, wrap column → next
            // page, stop past the window's end (§8.8 flow).
            if (state.cx < state.x1) state.cx++;
            else { state.cx = state.x0; state.cy = state.cy < state.y1 ? state.cy + 1 : state.y0; }
        },
    });
}

/** GRAM as RGBA for a canvas face; black when the display is off. */
export function ili9341Rgba(state) {
    const out = new Uint8ClampedArray(ILI9341_W * ILI9341_H * 4);
    if (!state.displayOn || state.sleeping) {
        for (let i = 3; i < out.length; i += 4) out[i] = 255;
        return out;
    }
    for (let i = 0; i < state.gram.length; i++) {
        const px = state.gram[i];
        out[i * 4] = ((px >> 11) & 0x1f) << 3;
        out[i * 4 + 1] = ((px >> 5) & 0x3f) << 2;
        out[i * 4 + 2] = (px & 0x1f) << 3;
        out[i * 4 + 3] = 255;
    }
    return out;
}

export default registerILI9341;
