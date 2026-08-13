/**
 * VDU stream decoder — the logic half of the VDU terminal.
 *
 * The BBC's whole graphics system is a BYTE PROTOCOL: MOVE/DRAW/PLOT/COLOUR
 * are sugar over VDU control sequences on the same stream as printed text
 * (that is why a serial BBC BASIC can draw). This decoder turns the raw
 * ACIA byte stream into typed events; a canvas face renders them, tests
 * assert on them, and neither needs video hardware emulated.
 *
 * The grammar is the classic VDU parameter-count table: codes 0-31 take a
 * fixed number of parameter bytes (VDU 25 = PLOT takes 5: mode, x lo/hi,
 * y lo/hi as SIGNED 16-bit), 32-126 are printable characters, 127 is
 * delete. Codes this decoder understands get typed events (plot/move/draw,
 * mode, colour, gcol, origin, tab, cls/clg, newline, bell); the rest come
 * out as {type:'vdu', code, params} so nothing is dropped silently.
 *
 * Feed it bytes in any chunking — state carries across pushes.
 *
 * @module
 */

/** Parameter byte counts for VDU 0-31 (the BBC MOS table). */
const PARAM_COUNT = [
    0, 1, 0, 0, 0, 0, 0, 0,   // 0 nul, 1 next-to-printer, 2 printer on, 3 off, 4 text@text, 5 text@graphics, 6 enable, 7 bell
    0, 0, 0, 0, 0, 0, 0, 0,   // 8 back, 9 fwd, 10 lf, 11 up, 12 cls, 13 cr, 14 page-on, 15 page-off
    0, 1, 2, 5, 0, 0, 1, 9,   // 16 clg, 17 colour, 18 gcol, 19 palette, 20 default-cols, 21 vdu-off, 22 mode, 23 udg
    8, 5, 0, 0, 4, 4, 0, 2,   // 24 gwindow, 25 plot, 26 default-windows, 27 -, 28 twindow, 29 origin, 30 home, 31 tab
];

const s16 = (lo, hi) => { const v = lo | (hi << 8); return v >= 0x8000 ? v - 0x10000 : v; };

export class VduDecoder {
    constructor() {
        this.code = null;      // control code awaiting parameters
        this.params = [];
        this.need = 0;
    }

    /**
     * Push one byte; returns an array of decoded events (possibly empty —
     * a parameter byte mid-sequence produces nothing yet).
     */
    push(byte) {
        byte &= 0xff;
        if (this.code !== null) {
            this.params.push(byte);
            if (this.params.length < this.need) return [];
            const ev = this._finish(this.code, this.params);
            this.code = null;
            this.params = [];
            this.need = 0;
            return ev;
        }
        if (byte >= 32 && byte !== 127) return [{ type: 'char', code: byte, char: String.fromCharCode(byte) }];
        if (byte === 127) return [{ type: 'delete' }];
        const need = PARAM_COUNT[byte];
        if (need === 0) return this._finish(byte, []);
        this.code = byte;
        this.need = need;
        return [];
    }

    /** Convenience: push many bytes, collect all events. */
    pushAll(bytes) {
        const out = [];
        for (const b of bytes) out.push(...this.push(b));
        return out;
    }

    _finish(code, p) {
        switch (code) {
            case 7: return [{ type: 'bell' }];
            case 8: return [{ type: 'cursor', dx: -1, dy: 0 }];
            case 9: return [{ type: 'cursor', dx: 1, dy: 0 }];
            case 10: return [{ type: 'newline' }];
            case 11: return [{ type: 'cursor', dx: 0, dy: -1 }];
            case 12: return [{ type: 'cls' }];
            case 13: return [{ type: 'cr' }];
            case 16: return [{ type: 'clg' }];
            case 17: return [{ type: 'colour', n: p[0] }];
            case 18: return [{ type: 'gcol', mode: p[0], colour: p[1] }];
            case 22: return [{ type: 'mode', n: p[0] }];
            case 25: {
                const mode = p[0];
                const x = s16(p[1], p[2]);
                const y = s16(p[3], p[4]);
                // 0-7 relative/absolute line family: 4 = MOVE, 5 = DRAW —
                // the two BASIC keywords are exactly these plot modes.
                const name = mode === 4 ? 'move' : mode === 5 ? 'draw' : 'plot';
                return [{ type: name, mode, x, y }];
            }
            case 29: return [{ type: 'origin', x: s16(p[0], p[1]), y: s16(p[2], p[3]) }];
            case 30: return [{ type: 'home' }];
            case 31: return [{ type: 'tab', x: p[0], y: p[1] }];
            default: return [{ type: 'vdu', code, params: p }];
        }
    }
}

export default VduDecoder;
