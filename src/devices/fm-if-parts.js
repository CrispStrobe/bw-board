// SPDX-License-Identifier: MIT
/**
 * Device model of the FM IF IC (src/fm-if-ic.js): its output is a source
 * behind 5 kΩ at half the supply plus the quadrature detector's reading of
 * the IF band at its input (src/radio.js fmDemod). Publishes `detector`
 * (V about mid-supply) and `quadHz`.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { FM_IF_KIND, FM_IF_PINS, fmIfCard, fmIfSupply, fmQuadHz } from '../fm-if-ic.js';

const TERMS = ['out', 'vcc', 'gnd'];

export function registerFmIfParts() {
    registerDevice(FM_IF_KIND, {
        terminals: [...FM_IF_PINS],
        eventLocalization: false,
        init() { return { drives: {}, detector: 0, quadHz: 0 }; },
        stamp(ctx, part) {
            const card = fmIfCard(part);
            const det = part.rfDetector;
            const d = det ? det.radio.fmDemod(det.index, ctx.tSeconds ?? 0) : 0;
            ctx.nonlinearCurrents('fm-detector', (read) => {
                const f = (rd) => {
                    const vs = rd('vcc') - rd('gnd');
                    const on = fmIfSupply(vs);
                    const target = on * (vs / 2 + d);
                    return (target - (rd('out') - rd('gnd'))) / card.rout;
                };
                const i = f(read);
                const currents = new Map([['out', i], ['gnd', -i]]);
                const jacobian = new Map([['out', new Map()], ['gnd', new Map()]]);
                const h = 1e-6;
                for (const t of TERMS) {
                    const sh = (s) => (u) => read(u) + (u === t ? s : 0);
                    const di = (f(sh(h)) - f(sh(-h))) / (2 * h);
                    if (di === 0) continue;
                    jacobian.get('out').set(t, di);
                    jacobian.get('gnd').set(t, -di);
                }
                return { region: 'smooth', currents, jacobian, residualOhms: 1e5 };
            });
        },
        update(part, state, read, tNs) {
            const det = part.rfDetector;
            state.detector = det ? det.radio.fmDemod(det.index, Number(tNs) / 1e9) : 0;
            state.quadHz = fmQuadHz(fmIfCard(part), part.rfDetector?.radio?._controls?.()?.get(part.id));
            return false;
        },
    });
}
