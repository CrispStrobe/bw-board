/**
 * Starter-kit sensors — DHT11 and the analog joystick, clean-room from
 * the Aosong datasheet and the module schematic. Top two gaps of the
 * UNO-kit lesson canon.
 *
 * DHT11: the single-wire handshake, by the datasheet's timing —
 *   host pulls DATA low ≥18 ms and releases; sensor answers 80 µs low +
 *   80 µs high, then 40 bits, each a 50 µs low followed by 26-28 µs
 *   high (0) or 70 µs high (1), MSB first: humidity int, humidity dec,
 *   temp int, temp dec, checksum = sum of the four bytes. Values from
 *   params.humidity / params.temperature (integer resolution, like the
 *   part). The bit stream is generated as REAL timed edges on the line,
 *   so pulse-width-measuring drivers (all of them) decode it; the
 *   datasheet's 1 s minimum between reads is modeled — poll faster and
 *   the sensor stays silent, exactly the bug every beginner hits.
 *
 * joystick: two 10 kΩ pots (X, Y) between VCC and GND with wipers on
 *   vrx/vry, plus a push switch to GND on sw (pull it up yourself or
 *   use the MCU's pullup, as on the module). params.x / params.y are
 *   -1..1 (0 = center → wiper at VCC/2), params.pressed the button.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_POT_HALF = 5000;     // 10k pot, wiper mid → 5k each way at center

export function registerKitSensors() {

    // ─── DHT11 ─────────────────────────────────────────────────────────
    registerDevice('dht11', {
        terminals: ['vcc', 'gnd', 'data'],

        init() {
            return {
                drives: { data: { vTh: 0, rTh: R_OFF } },
                _data: true, _fellNs: -1n,
                _frame: null,          // scheduled edge list [{t, low}]
                _frameIdx: 0,
                _lastReadNs: -2_000_000_000n,
            };
        },

        stamp() { /* open-drain party line; the module has its pullup — wire one */ },

        update(part, state, read, tNs) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            const v = read('data') > th;

            // Play out a scheduled response frame.
            if (state._frame) {
                let changed = false;
                while (state._frameIdx < state._frame.length
                    && tNs >= state._frame[state._frameIdx].t) {
                    const edge = state._frame[state._frameIdx++];
                    state.drives.data = edge.low
                        ? { vTh: 0, rTh: R_OUT } : { vTh: 0, rTh: R_OFF };
                    changed = true;
                }
                if (state._frameIdx >= state._frame.length) state._frame = null;
                state._data = read('data') > th;
                return changed;
            }

            if (!v && state._data) state._fellNs = tNs;
            if (v && !state._data && state._fellNs >= 0n) {
                const lowUs = Number((tNs - state._fellNs) / 1000n);
                // Start signal: host low ≥18 ms (accept ≥1 ms — real sensors
                // do). Respect the 1 s repoll limit: too soon → stay silent.
                if (lowUs >= 1000) {
                    if (tNs - state._lastReadNs >= 1_000_000_000n) {
                        state._lastReadNs = tNs;
                        state._frame = buildFrame(part, tNs);
                        state._frameIdx = 0;
                    }
                }
            }
            state._data = v;
            return false;
        },
    });

    // ─── Analog joystick ───────────────────────────────────────────────
    registerDevice('joystick', {
        terminals: ['vcc', 'gnd', 'vrx', 'vry', 'sw'],

        init() {
            return { drives: {}, _x: null, _y: null, _pressed: null };
        },

        stamp(ctx, part, state) {
            // Each axis is a pot: wiper position from the -1..1 param.
            for (const [axis, term] of [['x', 'vrx'], ['y', 'vry']]) {
                const p = Math.max(-1, Math.min(1, part.params?.[axis] ?? 0));
                const frac = (p + 1) / 2;                    // 0..1 along the track
                const rTop = Math.max(1, (1 - frac) * 2 * R_POT_HALF);
                const rBot = Math.max(1, frac * 2 * R_POT_HALF);
                ctx.conductance('vcc', term, 1 / rTop);
                ctx.conductance(term, 'gnd', 1 / rBot);
            }
            if (part.params?.pressed) ctx.conductance('sw', 'gnd', 1 / 0.1);
        },

        update(part, state) {
            const x = part.params?.x ?? 0;
            const y = part.params?.y ?? 0;
            const pressed = !!part.params?.pressed;
            if (x === state._x && y === state._y && pressed === state._pressed) return false;
            state._x = x; state._y = y; state._pressed = pressed;
            return true;                                     // re-stamp the pots
        },
    });
}

function buildFrame(part, t0) {
    const h = Math.max(0, Math.min(95, Math.round(part.params?.humidity ?? 50)));
    const t = Math.max(0, Math.min(50, Math.round(part.params?.temperature ?? 25)));
    const bytes = [h, 0, t, 0];
    bytes.push((bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff);

    const edges = [];
    let now = t0 + 20_000n;                                  // sensor turnaround
    const seg = (low, us) => { edges.push({ t: now, low }); now += BigInt(us) * 1000n; };
    seg(true, 80);                                           // response: 80 µs low
    seg(false, 80);                                          // 80 µs high
    for (const byte of bytes) {
        for (let i = 7; i >= 0; i--) {
            seg(true, 50);                                   // bit preamble
            seg(false, (byte >> i) & 1 ? 70 : 27);           // width IS the bit
        }
    }
    edges.push({ t: now, low: false });                      // release the line
    return edges;
}

export default registerKitSensors;
