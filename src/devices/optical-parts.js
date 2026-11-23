// SPDX-License-Identifier: MIT
/**
 * Device models for optical links (src/optics.js): the `light_path` part,
 * the `laser_diode` emitter and the solver-only `optical_rx` photocurrent.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { vceShape } from '../photo-junctions.js';
import { OPTICAL_RX_KIND } from '../optics.js';

export function registerOpticalParts() {
    // A light path has no leads (params.from / params.to name its emitter
    // and receiver), so it has no device model: the registry is for parts
    // with terminals. src/optics.js owns it.

    // A laser diode is solved as an LED of the same id (BoardImpl.setNetlist)
    // with a red junction; its light is a threshold law (src/optics.js).
    registerDevice('laser_diode', {
        terminals: ['anode', 'cathode'],
        eventLocalization: false,
        init() { return { drives: {} }; },
    });

    // In parallel with a receiver: the extra photocurrent its optical links
    // deliver, read at the stamp from the last accepted emitter currents.
    // 'vce': phototransistor collector (p) to emitter (n) with the same
    // VCE compliance as the part itself, so the two currents simply add.
    // 'source': photocurrent out of p (photodiode/LED anode, solar +).
    registerDevice(OPTICAL_RX_KIND, {
        terminals: ['p', 'n'],
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const o = part.optics;
            if (!o) return;
            const iL = o.model.rxAmps(o.rxId, ctx.tSeconds ?? 0);
            if (!(iL > 0)) return;
            if (part.params?.law === 'vce') {
                ctx.nonlinearCurrents('optical-collector', (read, scale) => {
                    const [s, ds] = vceShape(read('p') - read('n'));
                    const i = iL * scale * s;
                    const g = iL * scale * ds;
                    return {
                        region: 'smooth',
                        currents: new Map([['p', -i], ['n', i]]),
                        jacobian: new Map([
                            ['p', new Map([['p', -g], ['n', g]])],
                            ['n', new Map([['p', g], ['n', -g]])],
                        ]),
                        residualOhms: 1e6,
                    };
                });
            } else {
                ctx.current('p', iL);
                ctx.current('n', -iL);
            }
        },
        branchCurrents(part, state, read, tSeconds) {
            const o = part.optics;
            const iL = o ? o.model.rxAmps(o.rxId, tSeconds ?? 0) : 0;
            if (part.params?.law === 'vce') {
                const i = iL * vceShape(read('p') - read('n'))[0];
                return new Map([['p', -i], ['n', i]]);
            }
            return new Map([['p', iL], ['n', -iL]]);
        },
    });
}
