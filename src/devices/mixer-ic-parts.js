// SPDX-License-Identifier: MIT
/**
 * Device model of the double-balanced mixer IC (src/mixer-ic.js): stamps the
 * Gilbert-cell core's output currents (its biases, resistors and oscillator
 * transistor are hidden solver parts) and, when the circuit has an RF front
 * end, the audio-rate product of RF and LO swings that share a band.
 * Publishes the operating point: vRf, vLo, iTail, the two output currents.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { MIXER_IC_KIND, MIXER_IC_PINS, MIXER_IC_LO_REF, mixerCard, mixerCurrents, mixerTail } from '../mixer-ic.js';

const TERMS = ['in_a', 'in_b', 'out_a', 'out_b', 'osc_b', 'vcc', 'gnd', MIXER_IC_LO_REF];

function pinVolts(read) {
    const g = read('gnd');
    return {
        rf: read('in_a') - read('in_b'),
        lo: read('osc_b') - read(MIXER_IC_LO_REF),
        vcc: read('vcc') - g,
        outA: read('out_a') - g,
        outB: read('out_b') - g,
    };
}

export function registerMixerIcParts() {
    registerDevice(MIXER_IC_KIND, {
        terminals: [...MIXER_IC_PINS, MIXER_IC_LO_REF],
        eventLocalization: false,
        init() { return { drives: {}, vRf: 0, vLo: 0, iTail: 0, iOutA: 0, iOutB: 0, audio: 0 }; },
        stamp(ctx, part) {
            const card = mixerCard(part);
            const det = part.rfDetector;
            const extra = det ? det.radio.mixerAudio(det.index, ctx.tSeconds ?? 0) : 0;
            ctx.nonlinearCurrents('mixer-core', (read) => {
                const f = (rd) => mixerCurrents(card, pinVolts(rd), extra);
                const [ia, ib] = f(read);
                // Currents out of the chip into each net: the core draws ia
                // from out_a and ib from out_b and returns both at gnd.
                const currents = new Map([['out_a', -ia], ['out_b', -ib], ['gnd', ia + ib]]);
                const jacobian = new Map([['out_a', new Map()], ['out_b', new Map()], ['gnd', new Map()]]);
                const d = 1e-6;
                for (const t of TERMS) {
                    const shifted = (s) => (u) => read(u) + (u === t ? s : 0);
                    const [pa, pb] = f(shifted(d));
                    const [ma, mb] = f(shifted(-d));
                    const da = (pa - ma) / (2 * d), db = (pb - mb) / (2 * d);
                    if (da === 0 && db === 0) continue;
                    jacobian.get('out_a').set(t, -da);
                    jacobian.get('out_b').set(t, -db);
                    jacobian.get('gnd').set(t, da + db);
                }
                return { region: 'smooth', currents, jacobian, residualOhms: 1e5 };
            });
        },
        update(part, state, read, tNs) {
            const card = mixerCard(part);
            const v = pinVolts(read);
            const det = part.rfDetector;
            const extra = det ? det.radio.mixerAudio(det.index, Number(tNs) / 1e9) : 0;
            const [ia, ib] = mixerCurrents(card, v, extra);
            state.vRf = v.rf;
            state.vLo = v.lo;
            state.iTail = mixerTail(card, v.vcc);
            state.iOutA = ia;
            state.iOutB = ib;
            state.audio = extra;
            return false;
        },
    });
}
