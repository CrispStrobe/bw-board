/**
 * Dallas parts — DS1302 (3-wire RTC) and DS18B20 (1-Wire temperature),
 * our own models from the Maxim/Dallas datasheets. The two named gaps of
 * the PRECHIN-A2 board preset, and the two most-wired hobby parts after
 * the LCD.
 *
 * DS1302: CE frames a transfer; everything is LSB-first. Command byte:
 * bit7 mandatory 1, bit6 RAM/~CK, bits5-1 address, bit0 RD/~W. Input
 * bits are sampled on SCLK RISING edges; read data is driven on FALLING
 * edges, the first one being the edge that follows the command's last
 * rising edge. Clock/calendar in BCD (24h and 12h modes both handled),
 * CH halt flag in seconds bit 7, WP in register 7, 31 bytes of RAM,
 * clock burst (commits only when all 8 bytes arrive, per datasheet) and
 * RAM burst. THE CLASSIC TRAP IS KEPT: CH powers up SET (datasheet says
 * undefined; halted is what fresh silicon overwhelmingly does), so a
 * program that never clears CH sees a stopped clock — on the bench and
 * here.
 *
 * DS18B20: reset/presence, then ROM commands 0x33 READ ROM, 0xCC SKIP
 * ROM, 0x55 MATCH ROM; function commands 0x44 CONVERT T, 0xBE READ
 * SCRATCHPAD (9 bytes, Dallas CRC8 over the first 8), 0x4E WRITE
 * SCRATCHPAD, 0xB4 READ POWER (replies "external"). Temperature comes
 * from part.params.temperature (°C, default 25), encoded 12-bit,
 * conversion takes params.tconvMs (default the datasheet's 750).
 * STATED DIVERGENCE: master write bits are decided on the RISING edge
 * by low-time (<20 µs → 1, 20-400 µs → 0, ≥400 µs → bus reset) instead
 * of sampling inside the 15-60 µs window — behaviorally identical for
 * spec-compliant masters, and robust to coarse advanceTo stepping.
 * SEARCH ROM (0xF0) is unmodeled (single-drop buses never need it);
 * a search simply gets no reply bits.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_OFF = 1e9;           // released: practically not driving
const R_INPUT = 1e6;

const bcd = (v) => (((v / 10) | 0) << 4) | (v % 10);
const unbcd = (b) => ((b >> 4) & 0x0f) * 10 + (b & 0x0f);

/** Dallas/Maxim CRC8, poly x^8+x^5+x^4+1, LSB-first. */
export function crc8Dallas(bytes) {
    let crc = 0;
    for (let b of bytes) {
        for (let i = 0; i < 8; i++) {
            const mix = (crc ^ b) & 1;
            crc >>= 1;
            if (mix) crc ^= 0x8c;
            b >>= 1;
        }
    }
    return crc;
}

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const daysIn = (month, year) => (month === 2 && year % 4 === 0) ? 29 : DAYS[month - 1];

export function registerDallasParts() {

    // ─── DS1302 ────────────────────────────────────────────────────────
    registerDevice('ds1302', {
        terminals: ['vcc', 'gnd', 'ce', 'sclk', 'io'],

        init() {
            return {
                drives: { io: { vTh: 0, rTh: R_OFF } },
                _ce: false, _sclk: false,
                _mode: 'cmd', _bits: 0, _buf: 0,
                _isRam: false, _addr: 0, _burst: false, _burstIdx: 0,
                _burstClock: [],
                _tx: 0, _txBits: 0,
                _lastNs: null, _nsAcc: 0n,
                ch: true, wp: false, hour12: false, pm: false,
                sec: 0, min: 0, hour: 0, date: 1, month: 1, dow: 1, year: 0,
                trickle: 0,
                ram: new Array(31).fill(0),
            };
        },

        stamp(ctx) {
            ctx.conductance('ce', null, 1 / R_INPUT);
            ctx.conductance('sclk', null, 1 / R_INPUT);
        },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            let changed = false;

            // Timekeeping: seconds accumulate only while CH is clear.
            if (state._lastNs !== null && !state.ch) {
                state._nsAcc += tNs - state._lastNs;
                while (state._nsAcc >= 1_000_000_000n) {
                    state._nsAcc -= 1_000_000_000n;
                    tickSecond(state);
                }
            } else if (state.ch) {
                state._nsAcc = 0n;
            }
            state._lastNs = tNs;

            const ce = read('ce') > th;
            const sclk = read('sclk') > th;
            const ioHigh = read('io') > th;

            if (ce && !state._ce) {          // CE rise: new frame
                state._mode = 'cmd'; state._bits = 0; state._buf = 0;
                state._burst = false; state._burstIdx = 0; state._burstClock = [];
            }
            if (!ce && state._ce) {          // CE fall: release the pin
                if (state.drives.io.rTh !== R_OFF) { state.drives.io = { vTh: 0, rTh: R_OFF }; changed = true; }
            }

            if (ce) {
                if (sclk && !state._sclk) changed = this._risingEdge(state, ioHigh) || changed;
                if (!sclk && state._sclk) changed = this._fallingEdge(state, vcc) || changed;
            }
            state._ce = ce; state._sclk = sclk;
            return changed;
        },

        _risingEdge(state, ioHigh) {
            if (state._mode !== 'cmd' && state._mode !== 'write') return false;
            state._buf |= (ioHigh ? 1 : 0) << state._bits;
            state._bits++;
            if (state._bits < 8) return false;
            const byte = state._buf;
            state._bits = 0; state._buf = 0;

            if (state._mode === 'cmd') {
                if (!(byte & 0x80)) { state._mode = 'idle'; return false; }
                state._isRam = !!(byte & 0x40);
                state._addr = (byte >> 1) & 0x1f;
                state._burst = state._addr === 0x1f;
                state._burstIdx = 0;
                state._burstClock = [];
                if (byte & 0x01) {          // read
                    state._mode = 'read';
                    state._tx = readReg(state, state._isRam, state._burst ? 0 : state._addr, state._burstIdx);
                    state._txBits = 0;
                } else {
                    state._mode = 'write';
                }
                return false;
            }

            // write data byte
            if (state._isRam) {
                const idx = state._burst ? state._burstIdx++ : state._addr;
                if (idx < 31 && !state.wp) state.ram[idx] = byte;
            } else if (state._burst) {
                // Clock burst commits ONLY when all 8 bytes arrived.
                state._burstClock.push(byte);
                if (state._burstClock.length === 8 && !state.wp) {
                    for (let i = 0; i < 8; i++) writeReg(state, i, state._burstClock[i], true);
                }
            } else {
                writeReg(state, state._addr, byte, false);
            }
            if (!state._burst) state._mode = 'idle';
            return false;
        },

        _fallingEdge(state, vcc) {
            if (state._mode !== 'read') return false;
            const bit = (state._tx >> state._txBits) & 1;
            state.drives.io = { vTh: bit ? vcc : 0, rTh: R_OUT };
            state._txBits++;
            if (state._txBits >= 8) {
                state._txBits = 0;
                if (state._burst) {
                    state._burstIdx++;
                    const limit = state._isRam ? 31 : 8;
                    if (state._burstIdx < limit) {
                        state._tx = readReg(state, state._isRam, 0, state._burstIdx);
                    } else { state._mode = 'idle'; }
                } else { state._mode = 'done'; }
            }
            return true;
        },
    });

    // ─── DS18B20 ───────────────────────────────────────────────────────
    registerDevice('ds18b20', {
        terminals: ['vcc', 'gnd', 'dq'],

        init() {
            return {
                drives: { dq: { vTh: 0, rTh: R_OFF } },
                _dq: true, _fellNs: 0n,
                _presenceFrom: -1n, _presenceTo: -1n,
                _releaseAt: -1n,
                _phase: 'idle',       // idle | rom | match | fn | rx | tx
                _bits: 0, _buf: 0,
                _rxTarget: 0, _rxBytes: [],
                _txQueue: [], _txByte: 0, _txBits: 0,
                _matchIdx: 0, _inert: false,
                _convertEnd: -1n, _converted: false,
                th: 0x55, tl: 0x00, config: 0x7f,
            };
        },

        stamp() { /* dq is open-drain: pullup comes from the circuit */ },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            let changed = false;

            // Edges FIRST: a falling edge that starts a 0-bit read slot must
            // set up the drive before the drive computation below runs, or
            // the master's first sample poll would still see the pullup.
            const dq = read('dq') > th;
            if (!dq && state._dq) {
                // A falling edge INSIDE the presence window is our own drive,
                // not the master's — processing it as a slot start shifted
                // every later command by one bit and went inert.
                const selfPresence = state._presenceFrom >= 0n
                    && tNs >= state._presenceFrom && tNs < state._presenceTo + 20_000n;
                state._fellNs = selfPresence ? -1n : tNs;           // -1: ignore this low
                if (!selfPresence
                    && (state._phase === 'tx' || state._phase === 'convert')
                    && txCurrentBit(state, tNs) === 0) {
                    state._releaseAt = tNs + 45_000n;               // 0-bit: hold low into the slot
                }
            }
            if (dq && !state._dq && state._fellNs >= 0n) {
                changed = this._rose(part, state, tNs) || changed;
            }
            state._dq = dq;

            // Timed drives: presence pulse window, 0-bit slot release.
            const wantLow =
                (state._presenceFrom >= 0n && tNs >= state._presenceFrom && tNs < state._presenceTo) ||
                (state._releaseAt >= 0n && tNs < state._releaseAt);
            if (state._releaseAt >= 0n && tNs >= state._releaseAt) state._releaseAt = -1n;
            if (state._presenceTo >= 0n && tNs >= state._presenceTo) { state._presenceFrom = -1n; state._presenceTo = -1n; }
            const nowLow = state.drives.dq.rTh === R_OUT;
            if (wantLow !== nowLow) {
                state.drives.dq = wantLow ? { vTh: 0, rTh: R_OUT } : { vTh: 0, rTh: R_OFF };
                changed = true;
            }
            return changed;
        },

        _rose(part, state, tNs) {
            const lowUs = Number((tNs - state._fellNs) / 1000n);
            if (lowUs >= 400) {                                     // bus reset
                state._phase = 'rom'; state._bits = 0; state._buf = 0;
                state._txQueue = []; state._inert = false;
                state._presenceFrom = tNs + 30_000n;
                state._presenceTo = tNs + 150_000n;
                return false;
            }
            if (state._inert) return false;
            // A short low is a slot. While transmitting, the slot was a READ
            // slot and the bit was decided at the falling edge — see update().
            if (state._phase === 'tx') return this._txSlot(state, tNs);
            // Convert-status polls are read slots too, not incoming bits;
            // the master leaves the phase with a bus reset, never with data.
            if (state._phase === 'convert') return false;
            const bit = lowUs < 20 ? 1 : 0;
            return this._rxBit(part, state, bit, tNs);
        },

        _txSlot(state, tNs) {
            // The bit for THIS slot: drive already began at the falling edge
            // via _releaseAt (0-bit) or never began (1-bit). Advance.
            state._txBits++;
            if (state._txBits >= 8) {
                state._txBits = 0;
                state._txQueue.shift();
                if (!state._txQueue.length) state._phase = 'idle';
            }
            return false;
        },

        _rxBit(part, state, bit, tNs) {
            state._buf |= bit << state._bits;
            state._bits++;
            if (state._phase === 'match') {
                const rom = romBytes(part);
                const want = (rom[state._matchIdx >> 3] >> (state._matchIdx & 7)) & 1;
                if (bit !== want) state._inert = true;
                state._matchIdx++; state._bits = 0; state._buf = 0;
                if (state._matchIdx >= 64 && !state._inert) state._phase = 'fn';
                return false;
            }
            if (state._bits < 8) return false;
            const byte = state._buf; state._bits = 0; state._buf = 0;

            if (state._phase === 'rom') {
                if (byte === 0xcc) state._phase = 'fn';
                else if (byte === 0x33) this._startTx(state, romBytes(part));
                else if (byte === 0x55) { state._phase = 'match'; state._matchIdx = 0; }
                else state._inert = true;                            // incl. SEARCH ROM: unmodeled
                return false;
            }
            if (state._phase === 'fn') {
                if (byte === 0x44) {
                    const ms = part.params?.tconvMs ?? 750;
                    state._convertEnd = tNs + BigInt(Math.round(ms * 1e6));
                    state._converted = false;
                    // Busy replies: read slots return 0 until done. Model as
                    // tx of a stream recomputed per slot in _fallStart via
                    // the convert flag — here just mark the phase.
                    state._phase = 'convert';
                } else if (byte === 0xbe) {
                    this._startTx(state, scratchpad(part, state));
                } else if (byte === 0x4e) {
                    state._phase = 'rx'; state._rxTarget = 3; state._rxBytes = [];
                } else if (byte === 0xb4) {
                    this._startTx(state, [0x01]);                    // external power
                } else if (byte === 0x48 || byte === 0xb8) {
                    // copy/recall: instantaneous at our fidelity
                } else state._inert = true;
                return false;
            }
            if (state._phase === 'rx') {
                state._rxBytes.push(byte);
                if (state._rxBytes.length >= state._rxTarget) {
                    [state.th, state.tl, state.config] = state._rxBytes;
                    state._phase = 'idle';
                }
                return false;
            }
            return false;
        },

        _startTx(state, bytes) {
            state._phase = 'tx';
            state._txQueue = [...bytes];
            state._txBits = 0;
        },
    });
}

// The falling edge of a read slot must start the 0-bit drive; that logic
// lives in update() timing via _releaseAt, decided here. Split out so both
// tx and convert-status polling share it.
function txCurrentBit(state, tNs) {
    if (state._phase === 'convert') {
        const done = state._convertEnd >= 0n && tNs >= state._convertEnd;
        if (done) state._converted = true;
        return done ? 1 : 0;
    }
    if (state._phase !== 'tx' || !state._txQueue.length) return 1;
    return (state._txQueue[0] >> state._txBits) & 1;
}

function romBytes(part) {
    const serial = part.params?.serial ?? [0x01, 0x02, 0x03, 0x04, 0x05, 0x06];
    const head = [0x28, ...serial.slice(0, 6)];
    return [...head, crc8Dallas(head)];
}

function scratchpad(part, state) {
    const t = part.params?.temperature ?? 25.0;
    let raw = Math.round(t * 16);
    if (raw < 0) raw += 0x10000;
    const bytes = [raw & 0xff, (raw >> 8) & 0xff, state.th, state.tl, state.config, 0xff, 0x00, 0x10];
    return [...bytes, crc8Dallas(bytes)];
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

function readReg(state, isRam, addr, burstIdx) {
    if (isRam) {
        const idx = state._burst ? burstIdx : addr;
        return idx < 31 ? state.ram[idx] : 0xff;
    }
    const a = state._burst ? burstIdx : addr;
    switch (a) {
        case 0: return (state.ch ? 0x80 : 0) | bcd(state.sec);
        case 1: return bcd(state.min);
        case 2:
            if (!state.hour12) return bcd(state.hour);
            {
                const pm = state.hour >= 12;
                const h12 = state.hour % 12 === 0 ? 12 : state.hour % 12;
                return 0x80 | (pm ? 0x20 : 0) | bcd(h12);
            }
        case 3: return bcd(state.date);
        case 4: return bcd(state.month);
        case 5: return bcd(state.dow);
        case 6: return bcd(state.year);
        case 7: return state.wp ? 0x80 : 0;
        case 8: return state.trickle;
        default: return 0;
    }
}

function writeReg(state, addr, byte, fromBurst) {
    // WP blocks everything except writing WP itself (never reachable from
    // a clock burst, whose 8th byte IS the WP register — datasheet order).
    if (state.wp && !(addr === 7 && !fromBurst)) return;
    switch (addr) {
        case 0: state.ch = !!(byte & 0x80); state.sec = unbcd(byte & 0x7f); break;
        case 1: state.min = unbcd(byte & 0x7f); break;
        case 2:
            state.hour12 = !!(byte & 0x80);
            if (state.hour12) {
                const h = unbcd(byte & 0x1f) % 12;
                state.hour = h + ((byte & 0x20) ? 12 : 0);
            } else state.hour = unbcd(byte & 0x3f);
            break;
        case 3: state.date = unbcd(byte & 0x3f) || 1; break;
        case 4: state.month = unbcd(byte & 0x1f) || 1; break;
        case 5: state.dow = unbcd(byte & 0x07) || 1; break;
        case 6: state.year = unbcd(byte); break;
        case 7: state.wp = !!(byte & 0x80); break;
        case 8: state.trickle = byte; break;
    }
}

export { txCurrentBit };
export default registerDallasParts;
