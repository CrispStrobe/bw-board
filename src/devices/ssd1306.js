/**
 * SSD1306 — Solomon Systech 128×64 monochrome OLED controller, clean-room
 * from the SSD1306 datasheet (rev 1.1, April 2008).
 *
 * I2C slave at 0x3C (SA0 low) or 0x3D (SA0 high), on the bidirectional
 * i2c-slave.js engine. The I2C framing uses a control byte before each
 * data/command byte:
 *   - 0x00: next byte is a command, single-byte mode (Co=0, D/C#=0)
 *   - 0x80: next byte is a command, more to follow (Co=1, D/C#=0)
 *   - 0x40: data stream follows (Co=0, D/C#=1) — all subsequent bytes
 *     are GDDRAM data until STOP.
 *   - 0xC0: next byte is data, more to follow (Co=1, D/C#=1)
 *
 * Key behaviors modeled:
 *   - Horizontal addressing mode (0x20, 0x00): column advances after each
 *     data byte, wraps at column end to next page, wraps at page end to
 *     start — the default mode every Adafruit/U8g2 driver uses.
 *   - Vertical addressing mode (0x20, 0x01): page advances after each byte,
 *     wraps at page end to next column.
 *   - Page addressing mode (0x20, 0x02): the power-on default. Column
 *     advances within the current page; page does NOT auto-increment.
 *   - 128×64 framebuffer as Uint8Array(1024): 8 pages × 128 columns,
 *     each byte is a vertical 8-pixel stripe (bit 0 = top pixel of the
 *     stripe).
 *   - Display ON/OFF (0xAE/0xAF), contrast (0x81), entire-display-on
 *     (0xA4/0xA5), normal/inverse (0xA6/0xA7), set display offset,
 *     set display start line, COM scan direction, segment remap,
 *     multiplex ratio, display clock, precharge period, VCOMH deselect,
 *     charge pump enable.
 *   - Column/page address windows (0x21, 0x22) for horizontal/vertical
 *     modes.
 *   - Scrolling commands are accepted and stored; the actual scroll
 *     engine is unmodeled (the learner lessons use full-frame writes,
 *     not hardware scroll). Stated.
 *
 * UI-facing state: fb (Uint8Array(1024)), displayOn, inverted.
 * A helper pixel(x, y) reads individual pixels for test assertions.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { createI2CSlave, feedI2CSlave } from './i2c-slave.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;

const WIDTH = 128;
const HEIGHT = 64;
const PAGES = HEIGHT / 8;

export function registerSSD1306() {

    registerDevice('ssd1306', {
        terminals: ['vcc', 'gnd', 'sda', 'scl'],

        init(part) {
            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                fb: new Uint8Array(PAGES * WIDTH),          // the GDDRAM
                displayOn: false,
                contrast: 0x7f,
                inverted: false,
                entireOn: false,
                addrMode: 0x02,                              // page mode (power-on default)
                col: 0, page: 0,
                colStart: 0, colEnd: 127,
                pageStart: 0, pageEnd: 7,
                segRemap: false,
                comScanDir: 0,                               // 0 = normal, 1 = remapped
                muxRatio: 63,
                displayOffset: 0,
                startLine: 0,
                chargePump: false,
                _ctrl: -1,                                   // pending control byte
                _cmdState: 'idle',                           // multi-byte command state
                _cmdBuf: [],
                _dataStream: false,
            };

            const handlers = {
                onAddress: (a7, rw) => {
                    const addr = part.params?.address ?? 0x3c;
                    const mine = a7 === addr;
                    if (mine && rw === 0) {
                        state._dataStream = false;
                        state._ctrl = -1;
                    }
                    return mine;
                },
                onWriteByte: (b) => {
                    // I2C framing: control byte then payload.
                    if (state._ctrl < 0) {
                        state._ctrl = b;
                        // If Co=0 and D/C#=1, all following bytes are data.
                        if ((b & 0xc0) === 0x40) state._dataStream = true;
                        return true;
                    }

                    if (state._dataStream) {
                        // GDDRAM data byte.
                        writeData(state, b);
                        return true;
                    }

                    const dc = (state._ctrl >> 6) & 1;
                    const co = (state._ctrl >> 7) & 1;

                    if (dc) {
                        // Data byte.
                        writeData(state, b);
                    } else {
                        // Command byte.
                        handleCmd(state, b);
                    }

                    // If Co=1, next byte needs its own control byte.
                    if (co) state._ctrl = -1;
                    return true;
                },
                onReadByte: () => 0,
                onStop: () => { state._ctrl = -1; state._dataStream = false; },
            };
            state.i2cHandlers = handlers;
            state._i2c = createI2CSlave(handlers);
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 3.3;
            const th = vcc * 0.5;
            const driveLow = feedI2CSlave(state._i2c, read('scl') > th, read('sda') > th);
            const nowLow = state.drives.sda.rTh === R_OUT;
            if (driveLow !== nowLow) {
                state.drives.sda = driveLow ? { vTh: 0, rTh: R_OUT } : { vTh: 0, rTh: R_OFF };
                return true;
            }
            return false;
        },
    });
}

// ─── Data write into GDDRAM ────────────────────────────────────────
function writeData(s, byte) {
    s.fb[s.page * WIDTH + s.col] = byte;
    advanceCursor(s);
}

function advanceCursor(s) {
    if (s.addrMode === 0x02) {
        // Page addressing: column increments, wraps within lower nibble range.
        s.col++;
        if (s.col > s.colEnd) s.col = s.colStart;
    } else if (s.addrMode === 0x00) {
        // Horizontal: column first, then page.
        s.col++;
        if (s.col > s.colEnd) {
            s.col = s.colStart;
            s.page++;
            if (s.page > s.pageEnd) s.page = s.pageStart;
        }
    } else {
        // Vertical: page first, then column.
        s.page++;
        if (s.page > s.pageEnd) {
            s.page = s.pageStart;
            s.col++;
            if (s.col > s.colEnd) s.col = s.colStart;
        }
    }
}

// ─── Command handler ───────────────────────────────────────────────
function handleCmd(s, b) {
    // Multi-byte command continuation.
    if (s._cmdState !== 'idle') {
        s._cmdBuf.push(b);
        switch (s._cmdState) {
            case 'contrast':
                s.contrast = b;
                s._cmdState = 'idle';
                return;
            case 'addrMode':
                s.addrMode = b & 0x03;
                s._cmdState = 'idle';
                return;
            case 'colAddr':
                if (s._cmdBuf.length === 1) return;    // need second byte
                s.colStart = s._cmdBuf[0] & 0x7f;
                s.colEnd = s._cmdBuf[1] & 0x7f;
                s.col = s.colStart;
                s._cmdState = 'idle';
                return;
            case 'pageAddr':
                if (s._cmdBuf.length === 1) return;
                s.pageStart = s._cmdBuf[0] & 0x07;
                s.pageEnd = s._cmdBuf[1] & 0x07;
                s.page = s.pageStart;
                s._cmdState = 'idle';
                return;
            case 'muxRatio':
                s.muxRatio = b & 0x3f;
                s._cmdState = 'idle';
                return;
            case 'displayOffset':
                s.displayOffset = b & 0x3f;
                s._cmdState = 'idle';
                return;
            case 'clockDiv':
            case 'precharge':
            case 'vcomh':
            case 'chargePump':
                if (s._cmdState === 'chargePump') s.chargePump = !!(b & 0x04);
                s._cmdState = 'idle';
                return;
            case 'scroll1': case 'scroll2': case 'scroll3': case 'scroll4':
            case 'scroll5': case 'scroll6':
                // Scroll commands take 6 or 5 trailing bytes; just consume them.
                { const need = s._scrollLen || 6;
                  if (s._cmdBuf.length >= need) s._cmdState = 'idle'; }
                return;
            default:
                s._cmdState = 'idle';
                return;
        }
    }

    // Single-byte commands and multi-byte command starters.
    // Lower nibble commands (page mode column set).
    if ((b & 0xf0) === 0x00) {                         // set lower column nibble
        s.col = (s.col & 0xf0) | (b & 0x0f);
        return;
    }
    if ((b & 0xf0) === 0x10) {                         // set upper column nibble
        s.col = (s.col & 0x0f) | ((b & 0x0f) << 4);
        return;
    }
    if ((b & 0xf8) === 0xb0) {                         // set page (page mode)
        s.page = b & 0x07;
        return;
    }
    if ((b & 0xc0) === 0x40) {                         // set display start line
        s.startLine = b & 0x3f;
        return;
    }

    switch (b) {
        case 0x81: s._cmdState = 'contrast'; s._cmdBuf = []; return;
        case 0xa0: s.segRemap = false; return;
        case 0xa1: s.segRemap = true; return;
        case 0xa4: s.entireOn = false; return;
        case 0xa5: s.entireOn = true; return;
        case 0xa6: s.inverted = false; return;
        case 0xa7: s.inverted = true; return;
        case 0xa8: s._cmdState = 'muxRatio'; s._cmdBuf = []; return;
        case 0xae: s.displayOn = false; return;
        case 0xaf: s.displayOn = true; return;
        case 0xd3: s._cmdState = 'displayOffset'; s._cmdBuf = []; return;
        case 0xd5: s._cmdState = 'clockDiv'; s._cmdBuf = []; return;
        case 0xd9: s._cmdState = 'precharge'; s._cmdBuf = []; return;
        case 0xda: s._cmdState = 'comPins'; s._cmdBuf = []; return;  // just consume
        case 0xdb: s._cmdState = 'vcomh'; s._cmdBuf = []; return;
        case 0x8d: s._cmdState = 'chargePump'; s._cmdBuf = []; return;
        case 0x20: s._cmdState = 'addrMode'; s._cmdBuf = []; return;
        case 0x21: s._cmdState = 'colAddr'; s._cmdBuf = []; return;
        case 0x22: s._cmdState = 'pageAddr'; s._cmdBuf = []; return;
        case 0xc0: s.comScanDir = 0; return;
        case 0xc8: s.comScanDir = 1; return;
        // Scrolling: accept and consume arguments.
        case 0x26: case 0x27:
            s._cmdState = 'scroll1'; s._cmdBuf = []; s._scrollLen = 6; return;
        case 0x29: case 0x2a:
            s._cmdState = 'scroll1'; s._cmdBuf = []; s._scrollLen = 5; return;
        case 0x2e: return;                              // deactivate scroll
        case 0x2f: return;                              // activate scroll
        // NOP or unhandled: ignore.
    }
}

/**
 * Read a pixel from the framebuffer.
 * @param {object} state - device state (the init() return value)
 * @param {number} x - 0..127
 * @param {number} y - 0..63
 * @returns {number} 0 or 1
 */
export function ssd1306Pixel(state, x, y) {
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT) return 0;
    const page = Math.floor(y / 8);
    const bit = y % 8;
    return (state.fb[page * WIDTH + x] >> bit) & 1;
}

export default registerSSD1306;
