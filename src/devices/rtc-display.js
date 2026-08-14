/**
 * DS3231 + MAX7219 — the UNO-kit's RTC and LED-matrix driver, clean-room
 * from the Maxim datasheets.
 *
 * DS3231: I2C at 0x68 on the slave engine, register-pointer semantics
 * (write sets the pointer, bytes then stream with auto-increment and
 * 0x00-0x12 wrap in BOTH directions). BCD clock/calendar with 12/24
 * modes and leap years, running from machine time from power-on —
 * unlike the DS1302 this part has no CH trap, but the OSCILLATOR STOP
 * FLAG powers up SET (status 0x0F bit 7), exactly the "why does my
 * module say the time is invalid" moment RTClib's begin() checks for;
 * it clears only when written zero. Temperature registers 0x11/0x12
 * from params.temperature at the part's 0.25 °C step. Alarms store and
 * read back; alarm FIRING is unmodeled, stated (the kit lessons poll
 * time; A1F/A2F never set).
 *
 * MAX7219 (as the ubiquitous matrix module): DIN shifts MSB-first on
 * CLK rising edges into a 16-bit packet, LATCHED ON THE RISING EDGE of
 * LOAD/CS — between latches bits just flow, which is what makes
 * daisy-chaining work; DOUT re-emits bits with the 16-bit delay so a
 * second module can hang off it. Registers per datasheet: digits
 * 0x01-0x08 (the framebuffer state.digits the artwork renders),
 * decode-mode, intensity, scan-limit, shutdown (state.shutdown blanks
 * the display), display-test. LedControl (MIT) is the validation
 * driver when the corpus reaches it.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { createI2CSlave, feedI2CSlave } from './i2c-slave.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;

const bcd = (v) => (((v / 10) | 0) << 4) | (v % 10);
const unbcd = (b) => ((b >> 4) & 0x0f) * 10 + (b & 0x0f);
const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysIn = (m, y) => (m === 2 && y % 4 === 0) ? 29 : DAYS[m - 1];

export function registerRtcDisplay() {

    // ─── DS3231 ────────────────────────────────────────────────────────
    registerDevice('ds3231', {
        terminals: ['vcc', 'gnd', 'sda', 'scl'],

        init(part) {
            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                ptr: 0,
                sec: 0, min: 0, hour: 0, dow: 1, date: 1, month: 1, year: 0,
                hour12: false,
                regs: new Array(0x13).fill(0),   // alarms/control/status/aging raw
                osf: true,                        // powers up "oscillator stopped"
                _lastNs: null, _acc: 0n,
            };
            state.regs[0x0e] = 0x1c;              // control power-on default
            const handlers = {
                onAddress: (a7, rw) => {
                    const mine = a7 === (part.params?.address ?? 0x68);
                    if (mine && rw === 0) state._first = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._first) { state.ptr = b % 0x13; state._first = false; return true; }
                    writeReg(state, state.ptr, b);
                    state.ptr = (state.ptr + 1) % 0x13;
                    return true;
                },
                onReadByte: () => {
                    const v = readReg(part, state, state.ptr);
                    state.ptr = (state.ptr + 1) % 0x13;
                    return v;
                },
            };
            state.i2cHandlers = handlers;
            state._i2c = createI2CSlave(handlers);
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            // The oscillator runs from power-on; only OSF says it once
            // stopped. Machine time is the crystal.
            if (state._lastNs !== null) {
                state._acc += tNs - state._lastNs;
                while (state._acc >= 1_000_000_000n) {
                    state._acc -= 1_000_000_000n;
                    tickSecond(state);
                }
            }
            state._lastNs = tNs;

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

    // ─── MAX7219 matrix module ─────────────────────────────────────────
    registerDevice('max7219', {
        terminals: ['vcc', 'gnd', 'din', 'clk', 'cs', 'dout'],

        init() {
            return {
                drives: { dout: { vTh: 0, rTh: R_OUT } },
                digits: new Array(8).fill(0),     // the framebuffer
                decodeMode: 0, intensity: 0, scanLimit: 7,
                shutdown: true,                    // datasheet power-on state
                displayTest: false,
                _sr: 0, _clk: false, _cs: false,
                _out16: 0,                         // daisy-chain delay line
            };
        },

        stamp(ctx) {
            ctx.conductance('din', null, 1 / R_INPUT);
            ctx.conductance('clk', null, 1 / R_INPUT);
            ctx.conductance('cs', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const clk = read('clk') > th;
            const cs = read('cs') > th;
            let changed = false;

            if (clk && !state._clk) {              // shift in; DOUT is the
                const din = read('din') > th ? 1 : 0;   // bit 16 clocks ago
                const outBit = (state._out16 >> 15) & 1;
                state._out16 = ((state._out16 << 1) | ((state._sr >> 15) & 1)) & 0xffff;
                state._sr = ((state._sr << 1) | din) & 0xffff;
                const want = { vTh: outBit ? vcc : 0, rTh: R_OUT };
                if (state.drives.dout.vTh !== want.vTh) { state.drives.dout = want; changed = true; }
            }
            if (cs && !state._cs) {                // LOAD rising: latch packet
                const addr = (state._sr >> 8) & 0x0f;
                const data = state._sr & 0xff;
                if (addr >= 0x01 && addr <= 0x08) { state.digits[addr - 1] = data; changed = true; }
                else if (addr === 0x09) state.decodeMode = data;
                else if (addr === 0x0a) state.intensity = data & 0x0f;
                else if (addr === 0x0b) state.scanLimit = data & 0x07;
                else if (addr === 0x0c) { state.shutdown = !(data & 1); changed = true; }
                else if (addr === 0x0f) { state.displayTest = !!(data & 1); changed = true; }
                // addr 0x00: no-op — the daisy-chain filler, deliberately.
            }
            state._clk = clk; state._cs = cs;
            return changed;
        },
    });
}

function tickSecond(s) {
    if (++s.sec < 60) return;
    s.sec = 0;
    if (++s.min < 60) return;
    s.min = 0;
    if (++s.hour < 24) return;
    s.hour = 0;
    s.dow = (s.dow % 7) + 1;
    if (++s.date <= daysIn(s.month, s.year)) return;
    s.date = 1;
    if (++s.month <= 12) return;
    s.month = 1;
    s.year = (s.year + 1) % 100;
}

function readReg(part, state, reg) {
    switch (reg) {
        case 0x00: return bcd(state.sec);
        case 0x01: return bcd(state.min);
        case 0x02:
            if (!state.hour12) return bcd(state.hour);
            {
                const pm = state.hour >= 12;
                const h12 = state.hour % 12 === 0 ? 12 : state.hour % 12;
                return 0x40 | (pm ? 0x20 : 0) | bcd(h12);
            }
        case 0x03: return bcd(state.dow);
        case 0x04: return bcd(state.date);
        case 0x05: return bcd(state.month);
        case 0x06: return bcd(state.year);
        case 0x0f: return (state.osf ? 0x80 : 0) | (state.regs[0x0f] & 0x7f);
        case 0x11: {                                // temp MSB, two's complement
            const t = part.params?.temperature ?? 25;
            let i = Math.floor(t);
            if (i < 0) i += 256;
            return i & 0xff;
        }
        case 0x12: {                                // temp LSB: quarter degrees
            const t = part.params?.temperature ?? 25;
            return (Math.round((t - Math.floor(t)) * 4) & 0x03) << 6;
        }
        default: return state.regs[reg] ?? 0;
    }
}

function writeReg(state, reg, v) {
    switch (reg) {
        case 0x00: state.sec = unbcd(v & 0x7f); break;
        case 0x01: state.min = unbcd(v & 0x7f); break;
        case 0x02:
            state.hour12 = !!(v & 0x40);
            if (state.hour12) {
                const h = unbcd(v & 0x1f) % 12;
                state.hour = h + ((v & 0x20) ? 12 : 0);
            } else state.hour = unbcd(v & 0x3f);
            break;
        case 0x03: state.dow = unbcd(v & 0x07) || 1; break;
        case 0x04: state.date = unbcd(v & 0x3f) || 1; break;
        case 0x05: state.month = unbcd(v & 0x1f) || 1; break;
        case 0x06: state.year = unbcd(v); break;
        case 0x0f:
            // OSF clears only by writing it zero — RTClib's lostPower() dance.
            if (!(v & 0x80)) state.osf = false;
            state.regs[0x0f] = v & 0x7f;
            break;
        default: state.regs[reg] = v;
    }
}

export default registerRtcDisplay;
