/**
 * ST7920 128x64 LCD controller (the "LCD12864") — our own model from the
 * Sitronix datasheet, SERIAL interface first: that is what the learning
 * boards wire (PSB strapped low; CS/SID/SCLK + reset), and what the
 * Apache reference firmware drives. CS is ACTIVE HIGH on this chip.
 *
 * Serial protocol: within CS high, bytes shift MSB-first on SCLK rising
 * edges. A transfer is sync byte 1 1 1 1 1 RW RS 0, then the payload
 * byte split as [D7-D4,0000] [D3-D0,0000]. After the low nibble the
 * engine expects a sync byte again, so both CS-per-byte firmware (the
 * reference demos) and streamed transfers decode.
 *
 * Instructions (basic set, RE=0): clear 0x01, home 0x02, entry 0x06,
 * display on/off 0x08|DCB, function set 0x3x (bit2 = RE), DDRAM address
 * 0x80|addr. TEXT is 16 chars x 4 rows; each DDRAM address is 16 bits
 * wide = TWO characters, so bytes land left-then-right before the
 * address increments — row bases 0x00, 0x10, 0x08, 0x18 (the classic
 * interleave: line 3 continues line 1).
 *
 * Extended set (RE=1): graphics on via bit1 (0x36), GDRAM addressing as
 * the two-write dance — vertical 0x80|y (0-31) then horizontal 0x80|x
 * (0-15) — then data byte PAIRS fill 16-bit cells, x auto-incrementing
 * and wrapping. Cell (y, x<8) is screen row y, x>=8 is row y+32.
 *
 * Unmodeled, stated: serial reads (RW=1 — the breadboard wiring is
 * write-only), the parallel bus (PSB high), busy timing (transfers are
 * instruction-stepped; a delay-paced driver is simply fast here),
 * display shift, and CGRAM glyphs (codes 0x00-0x07 render as blanks).
 *
 * UI-facing state: text (4x16 array of char codes), gdram
 * (Uint16Array(512), cell-major [y*16+x]), displayOn, graphicsOn.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_INPUT = 1e6;

export function registerST7920() {

    registerDevice('st7920', {
        digitalFastPath: true,
        terminals: ['vcc', 'gnd', 'cs', 'sclk', 'sid', 'rstb'],

        init() {
            return {
                drives: {},
                text: Array.from({ length: 4 }, () => new Array(16).fill(0x20)),
                gdram: new Uint16Array(32 * 16),
                displayOn: false, graphicsOn: false, extended: false,
                addr: 0, pair: 0,                 // DDRAM addr + left/right phase
                gy: 0, gx: 0, gPhase: 0, gHi: 0,  // GDRAM address dance + byte pair
                _cs: false, _clk: false, _rst: true,
                _bits: 0, _sr: 0,
                _phase: 'sync', _rs: 0, _hi: 0,
            };
        },

        stamp(ctx) {
            ctx.conductance('cs', null, 1 / R_INPUT);
            ctx.conductance('sclk', null, 1 / R_INPUT);
            ctx.conductance('sid', null, 1 / R_INPUT);
            ctx.conductance('rstb', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const rst = read('rstb') > th;
            if (!rst) {                            // reset pin low: clean slate
                if (state._rst) resetChip(state);
                state._rst = false;
                return false;
            }
            state._rst = true;

            const cs = read('cs') > th;            // ACTIVE HIGH
            const clk = read('sclk') > th;
            if (cs && !state._cs) { state._bits = 0; state._sr = 0; state._phase = 'sync'; }
            if (cs && clk && !state._clk) {
                state._sr = ((state._sr << 1) | (read('sid') > th ? 1 : 0)) & 0xff;
                state._bits++;
                if (state._bits === 8) {
                    state._bits = 0;
                    this._byte(state, state._sr);
                    state._sr = 0;
                }
            }
            state._cs = cs; state._clk = clk;
            return false;                          // no bus outputs to drive
        },

        _byte(state, b) {
            switch (state._phase) {
                case 'sync':
                    if ((b & 0xf8) === 0xf8 && !(b & 0x04)) {   // write sync
                        state._rs = (b >> 1) & 1;
                        state._phase = 'hi';
                    }
                    // RW=1 (read) unsupported: stay in sync, byte ignored.
                    break;
                case 'hi':
                    state._hi = b & 0xf0;
                    state._phase = 'lo';
                    break;
                case 'lo': {
                    const value = state._hi | (b >> 4);
                    state._phase = 'sync';
                    if (state._rs) writeData(state, value);
                    else command(state, value);
                    break;
                }
            }
        },
    });
}

function resetChip(state) {
    for (const row of state.text) row.fill(0x20);
    state.gdram.fill(0);
    state.displayOn = false; state.graphicsOn = false; state.extended = false;
    state.addr = 0; state.pair = 0; state.gPhase = 0;
    state._phase = 'sync'; state._bits = 0; state._sr = 0;
}

// DDRAM address (basic set) → text row. Bases 0x00/0x10/0x08/0x18.
function rowOf(addr) {
    if (addr < 0x08) return 0;
    if (addr < 0x10) return 2;
    if (addr < 0x18) return 1;
    return 3;
}

function command(state, v) {
    if (v & 0x80) {
        if (state.extended) {
            // The two-write GDRAM dance: vertical first, then horizontal.
            if (state.gPhase === 0) { state.gy = v & 0x3f; state.gPhase = 1; }
            else { state.gx = v & 0x0f; state.gPhase = 0; state.gHi = -1; }
        } else {
            state.addr = v & 0x3f;
            state.pair = 0;
        }
        return;
    }
    if ((v & 0xc0) === 0x40) return;               // CGRAM address: unmodeled
    if ((v & 0xe0) === 0x20) {                     // function set 001x xxxx
        state.extended = !!(v & 0x04);
        if (state.extended) state.graphicsOn = !!(v & 0x02);
        state.gPhase = 0;
        return;
    }
    if (v & 0x10) return;                          // cursor/shift: unmodeled
    if (v & 0x08) { state.displayOn = !!(v & 0x04); return; }
    if (v & 0x04) return;                          // entry mode: increment assumed
    if (v === 0x01) { for (const row of state.text) row.fill(0x20); state.addr = 0; state.pair = 0; return; }
    if (v === 0x02 || v === 0x03) { state.addr = 0; state.pair = 0; }
}

function writeData(state, v) {
    if (state.extended) {
        // GDRAM: byte pairs form a 16-bit cell, x auto-increments.
        if (state.gHi < 0) { state.gHi = v; return; }
        const cell = ((state.gy & 0x1f) * 16) + (state.gx & 0x0f);
        state.gdram[cell] = ((state.gHi << 8) | v) & 0xffff;
        state.gHi = -1;
        state.gx = (state.gx + 1) & 0x0f;
        return;
    }
    // Text: two characters per DDRAM address, left then right.
    const row = rowOf(state.addr & 0x1f);
    const col = ((state.addr & 0x07) * 2 + state.pair) & 0x0f;
    state.text[row][col] = v;
    if (state.pair === 0) { state.pair = 1; }
    else {
        state.pair = 0;
        // Increment stays inside the row band the address started in.
        state.addr = (state.addr & 0x18) | ((state.addr + 1) & 0x07);
    }
}

/** Screen pixel (x 0-127, y 0-63) from GDRAM — for tests and renderers. */
export function st7920Pixel(state, x, y) {
    const half = y >= 32 ? 1 : 0;
    const cy = y & 0x1f;
    const cx = (half ? 8 : 0) + (x >> 4);
    const word = state.gdram[cy * 16 + cx];
    return (word >> (15 - (x & 0x0f))) & 1;
}

export default registerST7920;
