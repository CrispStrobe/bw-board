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
import { acousticsOf } from '../acoustics.js';
import { RF_DETECT_KIND, rectificationCurrentL, junctionCard, mosRectification } from '../radio.js';

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
    // Air-core VHF coil and varicap diode: networks in the solver view too
    // (an inductor with its RF loss; a diode whose capacitance the RF bands see).
    registerDevice('vhf_coil', { terminals: ['a', 'b'], init() { return { drives: {} }; } });
    registerDevice('varicap', { terminals: ['anode', 'cathode'], init() { return { drives: {} }; } });

    // ─── Junction rectification (solver-only) ───────────────────────────
    // In parallel with a diode (anode/cathode), a transistor's B-E and B-C
    // junctions or a MOSFET's channel: the cycle-averaged extra current the
    // RF swings of every band produce (src/radio.js, src/rf-bands.js):
    // Is·e^{v/nVt}·(Π_b I0(A_b/nVt) − 1) for a junction, <id(vgs + A·cos)> −
    // id(vgs) for a MOSFET. Zero without RF.
    registerDevice(RF_DETECT_KIND, {
        terminals: ['anode', 'cathode', 'base', 'collector', 'emitter', 'gate', 'drain', 'source'],
        init() { return { drives: {} }; },
        stamp(ctx, part) {
            const det = part.rfDetector;
            if (!det) return;
            const drive = det.radio.junctionDrive(det.index, ctx.tSeconds ?? 0);
            if (!drive || !drive.length) return;
            const L0 = drive[0].L, L1 = drive[1]?.L ?? 0;
            if (!(L0 > 1e-12) && !(L1 > 1e-12) && !(drive[0].A > 1e-9)) return;
            if (det.kind === 'diode') {
                if (!(L0 > 1e-12)) return;
                const card = junctionCard(det.of);
                ctx.nonlinearCurrents('rf-detect', (read) => {
                    const [i, g] = rectificationCurrentL(read('anode') - read('cathode'), L0, card.is, card.nVt);
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
            if (det.kind === 'nmos' || det.kind === 'pmos') {
                const A = drive[0].A;
                if (!(A > 1e-9) || !det.wired.includes('drain')) return;
                const s = det.kind === 'pmos' ? -1 : 1;
                ctx.nonlinearCurrents('rf-detect', (read) => {
                    const [i0, g0] = mosRectification(det.of, s * (read('gate') - read('source')), A);
                    // In triode the channel cannot carry it: the extra current
                    // fades as vds → 0 (a drain pulled below its source by a
                    // rectified current with nowhere to come from otherwise).
                    const vds = s * (read('drain') - read('source'));
                    const fd = vds > 0 ? Math.tanh(vds / 0.2) : 0;
                    const i = i0 * fd, g = g0 * fd;
                    // Extra drain current D → S (nmos); S → D (pmos).
                    return {
                        region: 'smooth',
                        currents: new Map([['drain', -s * i], ['source', s * i]]),
                        jacobian: new Map([
                            ['drain', new Map([['gate', -g], ['source', g]])],
                            ['source', new Map([['gate', g], ['source', -g]])],
                        ]),
                        residualOhms: 1e5,
                    };
                });
                return;
            }
            // Transistor: the emitter current's rectified part, split β : 1
            // between collector and base; and the B-C junction's own, base to
            // collector, when the collector swing reaches it (saturation).
            const card = junctionCard(det.of);
            const s = det.kind === 'pnp' ? -1 : 1;
            const hasC = det.wired.includes('collector');
            const fb = hasC ? 1 / (card.beta + 1) : 1;
            const fc = hasC ? card.beta / (card.beta + 1) : 0;
            const isBE = det.radio._bias?.[det.index]?.isEff ?? card.is;
            ctx.nonlinearCurrents('rf-detect', (read) => {
                const [i, g] = rectificationCurrentL(s * (read('base') - read('emitter')), L0, isBE, card.nVt);
                // Out of the device into each net; npn draws from base and
                // collector and delivers at the emitter; pnp the reverse.
                const currents = new Map([['base', -s * fb * i], ['emitter', s * i]]);
                const dB = (f) => new Map([['base', -f * g], ['emitter', f * g]]);
                const jacobian = new Map([['base', dB(fb)], ['emitter', dB(-1)]]);
                if (hasC) { currents.set('collector', -s * fc * i); jacobian.set('collector', dB(fc)); }
                if (hasC && L1 > 1e-12) {
                    const [ib, gb] = rectificationCurrentL(s * (read('base') - read('collector')), L1, card.is, card.nVt);
                    currents.set('base', currents.get('base') - s * ib);
                    currents.set('collector', currents.get('collector') + s * ib);
                    const jb = jacobian.get('base'), jc = jacobian.get('collector');
                    jb.set('base', (jb.get('base') ?? 0) - gb); jb.set('collector', (jb.get('collector') ?? 0) + gb);
                    jc.set('base', (jc.get('base') ?? 0) + gb); jc.set('collector', (jc.get('collector') ?? 0) - gb);
                }
                return { region: 'smooth', currents, jacobian, residualOhms: 1e5 };
            });
        },
    });
}
