// SPDX-License-Identifier: MIT
/**
 * Device models for the field probe and the solver-only parts of
 * src/fields.js: field EMF sources, the skin contact and the reverse
 * breakdown (with avalanche noise) of a junction.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { BREAKDOWN_KIND, FIELD_EMF_KIND, FIELD_CONTACT_KIND, FIELD_COUPLER_KIND, breakdownCurrent, bandNoise } from '../fields.js';

const EMF_OHMS = 1;
const COUPLER_SIEMENS = 1;

export function registerFieldParts() {
    // ─── Field probe ────────────────────────────────────────────────────
    // A bare wire or plate. Its couplings are solver-view parts built by
    // expandFields; the drawn part carries no stamp of its own. Its control
    // (0..1) is how close the field source is (src/fields.js).
    registerDevice('field_probe', { terminals: ['a'], init() { return { drives: {} }; } });

    // ─── Field EMF (solver-only) ────────────────────────────────────────
    // An ideal source (1 Ω) between a hidden node and the room's earth whose
    // voltage the FieldEnvironment gives as a function of time.
    registerDevice(FIELD_EMF_KIND, {
        terminals: ['p', 'e'],
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const src = part.fieldSource;
            if (!src) return;
            ctx.theveninBetween('p', 'e', src.env.emf(src.index, ctx.tSeconds ?? 0), EMF_OHMS);
        },
    });

    // ─── Time-varying conductance (solver-only) ─────────────────────────
    // A finger's skin resistance as it presses: siemens as a function of time.
    registerDevice(FIELD_CONTACT_KIND, {
        terminals: ['a', 'b'],
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const c = part.fieldContact;
            if (!c) return;
            const g = c.siemens(ctx.tSeconds ?? 0);
            if (g !== 0) ctx.conductance('a', 'b', g);
        },
    });

    // ─── Moving coupling (solver-only) ──────────────────────────────────
    // Holds m at v(a) + x(t)·(v(p) − v(a)) (a stiff Norton, current drawn
    // from p), so the fixed capacitor between m and a carries the current
    // of a coupling capacitance x(t)·C (src/fields.js). Linear.
    registerDevice(FIELD_COUPLER_KIND, {
        terminals: ['m', 'a', 'p'],
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const c = part.fieldCoupler;
            if (!c) return;
            const x = c.position(ctx.tSeconds ?? 0);
            const G = COUPLER_SIEMENS;
            ctx.nonlinearCurrents('coupling', (read) => {
                const i = G * (read('a') + x * (read('p') - read('a')) - read('m'));
                const row = (s) => new Map([['m', -s * G], ['a', s * G * (1 - x)], ['p', s * G * x]]);
                return {
                    region: 'linear',
                    currents: new Map([['m', i], ['p', -i]]),
                    jacobian: new Map([['m', row(1)], ['p', row(-1)]]),
                    residualOhms: 1,
                };
            });
        },
    });

    // ─── Reverse breakdown with avalanche noise (solver-only) ───────────
    // Across a junction, p the side that is positive in breakdown (the
    // emitter of an npn, the base of a pnp, a diode's cathode). The
    // breakdown law is Newton-solved with its exact Jacobian; the noise is
    // an independent current whose rms follows the last accepted current.
    registerDevice(BREAKDOWN_KIND, {
        terminals: ['p', 'n'],
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const j = part.fieldJunction;
            if (!j) return;
            const sigma = j.env.noiseSigma(j.index);
            const noise = sigma > 0 ? sigma * bandNoise(j.card.seed, ctx.tSeconds ?? 0, 2 * j.card.B) : 0;
            ctx.nonlinearCurrents('breakdown', (read, sourceScale) => {
                const [i, g] = breakdownCurrent(read('p') - read('n'), j.card);
                const total = i + (sourceScale ?? 1) * noise;
                return {
                    region: 'smooth',
                    currents: new Map([['p', -total], ['n', total]]),
                    jacobian: new Map([
                        ['p', new Map([['p', -g], ['n', g]])],
                        ['n', new Map([['p', g], ['n', -g]])],
                    ]),
                    residualOhms: 1e5,
                };
            });
        },
    });
}
