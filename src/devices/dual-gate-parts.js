// SPDX-License-Identifier: MIT
/**
 * Device model for the depletion-mode dual-gate MOSFET (src/dual-gate-mosfet.js).
 * The channel itself is two solver `nmos` on a hidden middle node; this model
 * stamps nothing and publishes the operating point on the device state:
 * vg1s, vg2s (gate 2 against the SOURCE, the datasheet convention), vds, the
 * middle node, and which gate (if any) has pinched the channel off.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { DUAL_GATE_KIND, DUAL_GATE_TERMINALS, DUAL_GATE_MID, dualGateCard } from '../dual-gate-mosfet.js';

export function registerDualGateParts() {
    registerDevice(DUAL_GATE_KIND, {
        terminals: [...DUAL_GATE_TERMINALS],
        eventLocalization: false,
        init() { return { drives: {}, vg1s: 0, vg2s: 0, vds: 0, vMid: 0, pinchedBy: null }; },
        update(part, state, read) {
            const card = dualGateCard(part);
            const vs = read('source');
            const vd = read('drain');
            const vm = read(DUAL_GATE_MID);
            const vg1 = read('gate1');
            const vg2 = read('gate2');
            state.vg1s = vg1 - vs;
            state.vg2s = vg2 - vs;
            state.vds = vd - vs;
            state.vMid = vm;
            // Each half is pinched when its gate is below pinch-off against
            // the lower of its two channel ends (the end that acts as source).
            const pinch1 = vg1 - Math.min(vs, vm) < card.g1.vth;
            const pinch2 = vg2 - Math.min(vm, vd) < card.g2.vth;
            state.pinchedBy = pinch1 && pinch2 ? 'both' : pinch1 ? 'gate1' : pinch2 ? 'gate2' : null;
            return false;
        },
    });
}
