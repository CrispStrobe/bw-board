// SPDX-License-Identifier: MIT
/**
 * Device models for the loudspeaker, the earphone and the radio front end.
 * The electrical networks are solver-view expansions (src/transducers.js,
 * src/radio.js); these models report sound and own nothing else.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { transducerCard, coneSignal, initToneTracker, trackTone } from '../transducers.js';
import { RF_DETECT_KIND, rectificationCurrent, junctionCard } from '../radio.js';
import { acousticsOf } from '../acoustics.js';

export function registerRadioParts() {
    // ─── Dynamic loudspeaker and earphone ───────────────────────────────
    // Voice coil Re + Le (+ optional motional impedance), built by
    // expandTransducers; the model follows the coil current for pitch and
    // loudness (board.buzzerTone()).
    for (const kind of ['speaker', 'earphone']) {
        registerDevice(kind, {
            terminals: ['a', 'b'],
            // Never changes the circuit, so it is never probed for events.
            eventLocalization: false,
            init() { return initToneTracker(); },
            update(part, state, read, tNs) {
                const card = state._card ?? (state._card = transducerCard(part));
                // A transducer in an acoustic path (src/acoustics.js): its coil
                // carries the sound EMF, which is not cone drive; and when it
                // is heard, its drive is recorded for the listener.
                const env = acousticsOf(part);
                const tSec = Number(tNs) / 1e9;
                const emf = env ? env.emf(part, tSec) : 0;
                const x = coneSignal(card, read, emf);
                if (env) {
                    env.record(part, tSec, x);
                    state.emf = emf;
                    state.pressurePa = env.listeners.has(part.id) ? env.pressure(part, tSec) : 0;
                }
                const minSwing = card.crystal ? 1e-3 : card.ratedAmps * 1e-3;
                trackTone(state, x, Number(tNs), minSwing);
                return false;
            },
        });
    }

    // ─── Radio front end ────────────────────────────────────────────────
    // Antenna, earth, tuning capacitor and ferrite coil are networks in the
    // solver view (src/radio.js); the drawn parts carry no stamp of their own.
    registerDevice('antenna', { terminals: ['a'], init() { return { drives: {} }; } });
    registerDevice('earth', { terminals: ['earth'], init() { return { drives: {} }; } });
    registerDevice('tuning_cap', { terminals: ['a', 'b'], init() { return { drives: {} }; } });
    registerDevice('ferrite_coil', { terminals: ['a', 'tap', 'b', 'c1', 'c2'], init() { return { drives: {} }; } });

    // ─── Junction rectification (solver-only) ───────────────────────────
    // In parallel with a diode (anode/cathode) or a transistor's B-E
    // junction: the cycle-averaged extra current an RF swing of amplitude A
    // produces, Is·e^{v/nVt}·(I0(A/nVt) − 1) (src/radio.js). Zero without RF.
    registerDevice(RF_DETECT_KIND, {
        terminals: ['anode', 'cathode', 'base', 'collector', 'emitter'],
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const det = part.rfDetector;
            if (!det) return;
            const A = det.radio.amplitude(det.index, ctx.tSeconds ?? 0);
            if (!(A > 1e-9)) return;
            const card = junctionCard(det.of);
            if (det.kind === 'diode') {
                ctx.nonlinearCurrents('rf-detect', (read) => {
                    const [i, g] = rectificationCurrent(read('anode') - read('cathode'), A, card.is, card.nVt);
                    return {
                        region: 'smooth',
                        currents: new Map([['anode', -i], ['cathode', i]]),
                        jacobian: new Map([
                            ['anode', new Map([['anode', -g], ['cathode', g]])],
                            ['cathode', new Map([['anode', g], ['cathode', -g]])],
                        ]),
                        residualOhms: 1e5,
                    };
                });
                return;
            }
            // Transistor: the emitter current's rectified part, split β : 1
            // between collector and base.
            const s = det.kind === 'pnp' ? -1 : 1;
            const hasC = det.wired.includes('collector');
            const fb = hasC ? 1 / (card.beta + 1) : 1;
            const fc = hasC ? card.beta / (card.beta + 1) : 0;
            ctx.nonlinearCurrents('rf-detect', (read) => {
                const [i, g] = rectificationCurrent(s * (read('base') - read('emitter')), A, card.is, card.nVt);
                // Out of the device into each net; npn draws from base and
                // collector and delivers at the emitter; pnp the reverse.
                const currents = new Map([['base', -s * fb * i], ['emitter', s * i]]);
                const dB = (f) => new Map([['base', -f * g], ['emitter', f * g]]);
                const jacobian = new Map([['base', dB(fb)], ['emitter', dB(-1)]]);
                if (hasC) { currents.set('collector', -s * fc * i); jacobian.set('collector', dB(fc)); }
                return { region: 'smooth', currents, jacobian, residualOhms: 1e5 };
            });
        },
    });
}
