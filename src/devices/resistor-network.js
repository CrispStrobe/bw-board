/**
 * SIP resistor network — E5.11. One package, two topologies, and the
 * difference IS the teaching point: a bussed network shares pin 1 across
 * every element (fine for pull-ups, wrong wherever isolated resistors
 * are needed — LED-bar current sharing), an isolated network is N
 * independent pairs.
 *
 * Pure stamp device: each element is a conductance between two terminal
 * nets, exactly what a wired discrete resistor stamps — the solver is
 * untouched, and there is nothing behavioral to update.
 *
 *   params.ohms      element resistance (required)
 *   params.topology  'bussed' (default) | 'isolated'
 *   params.pins      how many package pins are populated (default 10,
 *                    the declared SIP-10 maximum; the BOM's 4609X is 9)
 *
 * Bussed:   p1 common, one element to each of p2..p{pins}.
 * Isolated: pairs (p1,p2), (p3,p4), … — pins/2 elements.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const MAX_PINS = 10;

export function registerResistorNetwork() {
  registerDevice('rnet_sip', {
    terminals: Array.from({ length: MAX_PINS }, (_, i) => `p${i + 1}`),
    requiredParams: ['ohms'],

    init() {
      return { drives: {} };
    },

    stamp(ctx, part) {
      const ohms = Number(part.params?.ohms);
      if (!Number.isFinite(ohms) || ohms <= 0) return;
      const g = 1 / ohms;
      const pins = Math.min(Number(part.params?.pins) || MAX_PINS, MAX_PINS);
      if (part.params?.topology === 'isolated') {
        for (let i = 1; i + 1 <= pins; i += 2) {
          ctx.conductance(`p${i}`, `p${i + 1}`, g);
        }
      } else {
        for (let i = 2; i <= pins; i++) {
          ctx.conductance('p1', `p${i}`, g);
        }
      }
    },
  });
}
