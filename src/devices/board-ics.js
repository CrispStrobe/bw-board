/**
 * Learning-board ICs — AT24C02 (I2C EEPROM) and XPT2046 (SPI-style ADC),
 * the last two silicon gaps of the PRECHIN-A2 board preset, clean-room
 * from the Atmel/Microchip and XPTEK/TI-ADS7846 datasheets.
 *
 * AT24C02: 256 bytes, 7-bit address 0b1010|A2A1A0 (params.address,
 * default 0x50). Byte write and 8-byte page write — data COMMITS ON
 * STOP, page wrap keeps the high five address bits (both datasheet
 * behaviors, both the classic gotchas); current-address, random
 * (dummy-write + repeated START) and sequential reads with 256-byte
 * wrap. Sits on the full slave engine (i2c-slave.js), so it really
 * ACKs and really streams bytes to a reading master. The write-cycle
 * time (tWR ~5 ms of NACKed polling) is unmodeled: writes commit at
 * STOP instantly — stated, since poll loops simply fall through.
 *
 * XPT2046: command byte S|A2A1A0|MODE|SER-DFR|PD1PD0 shifted in on DCLK
 * rising edges while /CS low; the conversion streams out on falling
 * edges as one null bit + 12 (or 8, MODE=1) result bits MSB-first.
 * Single-ended channel map (the learning boards use it as a plain ADC):
 * 101→xp, 001→yp, 010→vbat (through the chip's internal 1/4 divider,
 * per datasheet), 110→aux, 000/111→temp diode (~600 mV at 25 °C,
 * -2.1 mV/°C, params.temperature). SER and DFR are treated alike
 * against vref (params.vref, default VCC) — stated simplification; the
 * touch-screen differential dance is not what these boards wire.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { createI2CSlave, feedI2CSlave } from './i2c-slave.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;

export function registerBoardICs() {

    // ─── AT24C02 ───────────────────────────────────────────────────────
    registerDevice('at24c02', {
        terminals: ['vcc', 'gnd', 'sda', 'scl'],

        init(part) {
            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                mem: new Array(256).fill(0xff),        // erased EEPROM reads 0xFF
                wordAddr: 0,
                _mode: 'addr',
                _pageBase: 0, _pageOff: 0, _pending: [],
            };
            const handlers = {
                onAddress: (a7, rw) => {
                    const mine = a7 === (part.params?.address ?? 0x50);
                    if (mine && rw === 0) { state._mode = 'addr'; state._pending = []; }
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._mode === 'addr') {
                        state.wordAddr = b & 0xff;
                        state._pageBase = b & 0xf8;
                        state._pageOff = b & 0x07;
                        state._mode = 'data';
                    } else {
                        // Page-write buffering: commit happens at STOP, and
                        // the address wraps WITHIN the 8-byte page.
                        state._pending.push([state._pageBase | state._pageOff, b]);
                        state._pageOff = (state._pageOff + 1) & 0x07;
                    }
                    return true;
                },
                onReadByte: () => {
                    const v = state.mem[state.wordAddr];
                    state.wordAddr = (state.wordAddr + 1) & 0xff;
                    return v;
                },
                onStop: () => {
                    for (const [a, v] of state._pending) state.mem[a] = v;
                    if (state._pending.length) {
                        // Sequential reads continue past the written page in
                        // the datasheet's current-address sense.
                        state.wordAddr = (state._pageBase | state._pageOff) & 0xff;
                    }
                    state._pending = [];
                },
            };
            state.i2cHandlers = handlers;
            state._i2c = createI2CSlave(handlers);
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
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

    // ─── AT24C64 / 24C64 ───────────────────────────────────────────────
    // The blinkenrocket badge's animation store (a 24C64 in DIP-8:
    // A0 A1 A2 GND | SDA SCL WP VCC). Three datasheet differences from
    // the AT24C02 above, each a classic gotcha:
    //   - TWO-byte word address (high, then low; 13 bits used of 16)
    //   - 32-byte page writes — the low FIVE address bits wrap
    //   - WP pin: writes are silently DISCARDED at STOP while WP is high
    //     (the device still ACKs — that is what the silicon does)
    // The A0–A2 pins are sampled ELECTRICALLY to form the bus address
    // 0b1010|A2A1A0, so strapping them in the circuit works exactly like
    // on the bench; unwired pins read low (datasheet default on the
    // Atmel/ST parts — internal pull-downs).
    registerDevice('at24c64', {
        terminals: ['a0', 'a1', 'a2', 'gnd', 'sda', 'scl', 'wp', 'vcc'],

        init(part) {
            const SIZE = 8192, PAGE = 32;
            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                mem: new Array(SIZE).fill(0xff),      // erased EEPROM reads 0xFF
                wordAddr: 0,
                _mode: 'addr-hi',
                _pageBase: 0, _pageOff: 0, _pending: [],
                _addrPins: 0,                          // sampled A2A1A0
                _wp: false,
            };
            // Preload: params.contents = array of bytes (media slots and
            // examples use this to ship animation data).
            if (Array.isArray(part.params?.contents)) {
                for (let i = 0; i < Math.min(SIZE, part.params.contents.length); i++) {
                    state.mem[i] = part.params.contents[i] & 0xff;
                }
            }
            const handlers = {
                onAddress: (a7, rw) => {
                    const mine = a7 === (0x50 | state._addrPins);
                    if (mine && rw === 0) { state._mode = 'addr-hi'; state._pending = []; }
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._mode === 'addr-hi') {
                        state.wordAddr = (b << 8) & 0x1f00;
                        state._mode = 'addr-lo';
                    } else if (state._mode === 'addr-lo') {
                        state.wordAddr = (state.wordAddr | (b & 0xff)) % 8192;
                        state._pageBase = state.wordAddr & ~(PAGE - 1);
                        state._pageOff = state.wordAddr & (PAGE - 1);
                        state._mode = 'data';
                    } else {
                        state._pending.push([state._pageBase | state._pageOff, b]);
                        state._pageOff = (state._pageOff + 1) & (PAGE - 1);
                    }
                    return true;
                },
                onReadByte: () => {
                    const v = state.mem[state.wordAddr];
                    state.wordAddr = (state.wordAddr + 1) % SIZE;
                    return v;
                },
                onStop: () => {
                    if (!state._wp) {
                        for (const [a, v] of state._pending) state.mem[a] = v;
                    }
                    if (state._pending.length) {
                        state.wordAddr = (state._pageBase | state._pageOff) % SIZE;
                    }
                    state._pending = [];
                },
            };
            state.i2cHandlers = handlers;
            state._i2c = createI2CSlave(handlers);
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
            // A0–A2 and WP: input loading plus a weak pull-down so an
            // unwired strap pin reads a defined LOW, not a floating NaN.
            for (const t of ['a0', 'a1', 'a2', 'wp']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            state._addrPins = (read('a2') > th ? 4 : 0) |
                              (read('a1') > th ? 2 : 0) |
                              (read('a0') > th ? 1 : 0);
            state._wp = read('wp') > th;
            const driveLow = feedI2CSlave(state._i2c, read('scl') > th, read('sda') > th);
            const nowLow = state.drives.sda.rTh === R_OUT;
            if (driveLow !== nowLow) {
                state.drives.sda = driveLow ? { vTh: 0, rTh: R_OUT } : { vTh: 0, rTh: R_OFF };
                return true;
            }
            return false;
        },
    });

    // ─── XPT2046 ───────────────────────────────────────────────────────
    registerDevice('xpt2046', {
        terminals: ['vcc', 'gnd', 'csb', 'dclk', 'din', 'dout', 'xp', 'yp', 'vbat', 'aux'],

        init() {
            return {
                drives: { dout: { vTh: 0, rTh: R_OFF } },
                _cs: true, _clk: false,
                _cmdBits: 0, _cmd: 0, _collecting: false,
                _out: [], _outIdx: 0,
            };
        },

        stamp(ctx) {
            ctx.conductance('csb', null, 1 / R_INPUT);
            ctx.conductance('dclk', null, 1 / R_INPUT);
            ctx.conductance('din', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const cs = read('csb') > th;
            const clk = read('dclk') > th;
            let changed = false;

            if (cs) {                                  // deselected: release, reset
                if (!state._cs) {
                    state._collecting = false; state._cmdBits = 0;
                    state._out = []; state._outIdx = 0;
                    state.drives.dout = { vTh: 0, rTh: R_OFF };
                    changed = true;
                }
                state._cs = cs; state._clk = clk;
                return changed;
            }
            state._cs = cs;

            if (clk && !state._clk) {                  // rising: shift command in
                const din = read('din') > th ? 1 : 0;
                if (!state._collecting) {
                    if (din === 1) {                   // S bit found: begin
                        state._collecting = true;
                        state._cmd = 1; state._cmdBits = 1;
                    }
                } else {
                    state._cmd = ((state._cmd << 1) | din) & 0xff;
                    state._cmdBits++;
                    if (state._cmdBits === 8) {
                        state._collecting = false; state._cmdBits = 0;
                        state._out = convert(part, state._cmd, read, vcc);
                        state._outIdx = 0;
                    }
                }
            }
            if (!clk && state._clk) {                  // falling: shift result out
                const bit = state._outIdx < state._out.length ? state._out[state._outIdx++] : 0;
                const want = { vTh: bit ? vcc : 0, rTh: R_OUT };
                if (state.drives.dout.vTh !== want.vTh || state.drives.dout.rTh !== want.rTh) {
                    state.drives.dout = want;
                    changed = true;
                }
            }
            state._clk = clk;
            return changed;
        },
    });
}

function convert(part, cmd, read, vcc) {
    const a = (cmd >> 4) & 0x07;
    const mode8 = !!(cmd & 0x08);
    const vref = part.params?.vref ?? vcc;
    let v;
    switch (a) {
        case 0b101: v = read('xp'); break;
        case 0b001: v = read('yp'); break;
        case 0b010: v = read('vbat') * 0.25; break;    // internal 1/4 divider
        case 0b110: v = read('aux'); break;
        case 0b000:
        case 0b111: {
            const t = part.params?.temperature ?? 25;
            v = 0.6 - (t - 25) * 0.0021;               // diode, rough per datasheet
            break;
        }
        default: v = 0;                                // touch Z channels: not wired here
    }
    const full = mode8 ? 255 : 4095;
    const raw = Math.max(0, Math.min(full, Math.round((v / vref) * full)));
    const nbits = mode8 ? 8 : 12;
    const out = [0];                                   // null/busy bit first
    for (let i = nbits - 1; i >= 0; i--) out.push((raw >> i) & 1);
    return out;
}

export default registerBoardICs;
