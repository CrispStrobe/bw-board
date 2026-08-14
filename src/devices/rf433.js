/**
 * 433 MHz OOK link — the cheap tx/rx module pair as the air's second
 * kind, proving the medium engine general. Electrically the modules are
 * a WIRELESS WIRE with attitude: the transmitter keys its carrier from
 * the DATA pin, every receiver on the band demodulates the strongest
 * carrier back to a level — so the model broadcasts LEVEL EDGES through
 * space `rf433:${band}` and each receiver drives the OR of all live
 * transmitters (two keyed carriers jam high, which is true to the bench).
 * Noise, range and the receiver's AGC hiss on silence are unmodeled,
 * stated — VirtualWire-class protocols run on top unchanged, which is
 * the point.
 *
 * tx: vcc/gnd/data(in).  rx: vcc/gnd/data(out).  params.band both ends
 * (default 433). Same band = same world; 315 vs 433 never meet.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { joinAir, airSend } from '../air.js';

const R_OUT = 50;
const R_INPUT = 1e6;

export function registerRf433() {

    registerDevice('rf433_tx', {
        terminals: ['vcc', 'gnd', 'data'],

        init(part) {
            const state = { drives: {}, _level: 0 };
            state._member = joinAir(`rf433:${part.params?.band ?? 433}`, {
                state,
                addr: () => `tx:${part.id}`,
                deliver: () => { },                    // transmitters are deaf
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('data', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const level = read('data') > vcc * 0.5 ? 1 : 0;
            if (level === state._level) return false;
            state._level = level;
            airSend(state._member, { level });
            return false;
        },
    });

    registerDevice('rf433_rx', {
        terminals: ['vcc', 'gnd', 'data'],

        init(part) {
            const state = {
                drives: { data: { vTh: 0, rTh: R_OUT } },
                _carriers: new Map(),                  // fromAddr → level
                _pending: false,
            };
            state._member = joinAir(`rf433:${part.params?.band ?? 433}`, {
                state,
                addr: () => `rx:${part.id}`,
                deliver: (payload, from) => {
                    state._carriers.set(from, payload.level);
                    state._pending = true;
                },
            });
            return state;
        },

        stamp() { },

        update(part, state, read) {
            if (!state._pending) return false;
            state._pending = false;
            const vcc = read('vcc') || 5.0;
            let level = 0;
            for (const l of state._carriers.values()) level = level || l;
            const want = { vTh: level ? vcc : 0, rTh: R_OUT };
            if (state.drives.data.vTh === want.vTh) return false;
            state.drives.data = want;
            return true;
        },
    });
}

export default registerRf433;
