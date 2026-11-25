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

/**
 * Which gate has pinched the channel off: 'gate1', 'gate2', 'both' or null.
 *
 * Each half is pinched when its gate is below its pinch-off voltage against
 * the end of that half that acts as its source (the lower one). For the half
 * at the channel's LOW terminal that end is the terminal itself (the source
 * terminal in normal operation; the drain when Vds < 0), so that half's
 * verdict is always well defined: it is the authority. The other half's
 * source end is the hidden middle node, and the middle node only means
 * something while the authority half conducts. Once the authority half cuts
 * the series current off, nothing holds the middle node: it floats up
 * towards the drain (through GMIN) until the other half reads "cut off"
 * against it as well, and comparing against it reported 'both' when gate 1
 * alone pinched. So with the authority half cut off the other gate is judged
 * where the middle node sits the moment current flows again: at the low
 * terminal.
 */
export function pinchedBy(card, { vs, vd, vm, vg1, vg2 }) {
    const forward = vd >= vs;
    const low = forward ? vs : vd;
    const [auth, other] = forward
        ? [{ vg: vg1, vth: card.g1.vth, name: 'gate1' }, { vg: vg2, vth: card.g2.vth, far: vd, name: 'gate2' }]
        : [{ vg: vg2, vth: card.g2.vth, name: 'gate2' }, { vg: vg1, vth: card.g1.vth, far: vs, name: 'gate1' }];
    const authPinched = auth.vg - low < auth.vth;
    const otherSource = authPinched ? low : Math.min(vm, other.far);
    const otherPinched = other.vg - otherSource < other.vth;
    if (authPinched && otherPinched) return 'both';
    if (authPinched) return auth.name;
    return otherPinched ? other.name : null;
}

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
            state.pinchedBy = pinchedBy(card, { vs, vd, vm, vg1, vg2 });
            return false;
        },
    });
}
