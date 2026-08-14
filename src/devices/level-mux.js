/**
 * CD74HC4067 16-channel analog mux + the BSS138-style bidirectional
 * level-shifter module — the last two tier-2 parts. Clean-room from the
 * TI datasheet and the canonical module schematic (two pullups and one
 * MOSFET per channel).
 *
 * cd74hc4067: S0-S3 select which of C0-C15 connects to the common Z
 * through the on-resistance (~70 Ω typical); /E high disconnects
 * everything. A real analog path through the MNA solver — voltages,
 * not levels — so it multiplexes ADC inputs exactly like the bench.
 *
 * level_shifter4: four bidirectional channels between an LV and an HV
 * rail. Electrically the module is: 10 kΩ pullup from each side to its
 * own rail, and a MOSFET that passes a LOW in either direction; highs
 * never cross — each side idles at ITS OWN rail, which is the entire
 * 3.3 V/5 V teaching point. The MOSFET is modeled behaviorally with an
 * INITIATOR per channel: whichever side goes low first (while we are
 * not driving it) owns the channel, we mirror the low onto the other
 * side, and we release when the initiating side returns high — which
 * is what prevents the model latching on its own mirrored drive, the
 * classic bidirectional-model trap. Push-pull drivers fighting the
 * mirror are out of spec on the real module too (it wants open-drain
 * or input-idle sides).
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_ON = 70;          // 4067 switch on-resistance, datasheet typical
const R_MOSFET = 60;      // shifter pass transistor, saturated
const R_PULLUP = 10_000;  // the module's own pullups
const R_INPUT = 1e6;

export function registerLevelMux() {

    // ─── CD74HC4067 ────────────────────────────────────────────────────
    registerDevice('cd74hc4067', {
        terminals: ['vcc', 'gnd', 's0', 's1', 's2', 's3', 'eb', 'z',
            ...Array.from({ length: 16 }, (_, i) => `c${i}`)],

        init() {
            return { drives: {}, _sel: -1 };
        },

        stamp(ctx, part, state) {
            for (const t of ['s0', 's1', 's2', 's3', 'eb']) {
                ctx.conductance(t, null, 1 / R_INPUT);
            }
            if (state._sel >= 0) {
                ctx.conductance('z', `c${state._sel}`, 1 / R_ON);
            }
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const th = vcc * 0.5;
            let sel = -1;
            if (read('eb') < th) {                     // enabled (active low)
                sel = (read('s3') > th ? 8 : 0) | (read('s2') > th ? 4 : 0)
                    | (read('s1') > th ? 2 : 0) | (read('s0') > th ? 1 : 0);
            }
            if (sel === state._sel) return false;
            state._sel = sel;
            return true;                               // re-stamp the path
        },
    });

    // ─── 4-channel bidirectional level shifter ─────────────────────────
    registerDevice('level_shifter4', {
        terminals: ['lv', 'hv', 'gnd',
            'lv1', 'lv2', 'lv3', 'lv4', 'hv1', 'hv2', 'hv3', 'hv4'],

        init() {
            return {
                drives: {},
                _mode: ['idle', 'idle', 'idle', 'idle'],
            };
        },

        stamp(ctx) {
            // The module's own pullups: each side idles at its own rail.
            for (let i = 1; i <= 4; i++) {
                ctx.conductance(`lv${i}`, 'lv', 1 / R_PULLUP);
                ctx.conductance(`hv${i}`, 'hv', 1 / R_PULLUP);
            }
        },

        update(part, state, read) {
            const lvRail = read('lv') || 3.3;
            const hvRail = read('hv') || 5.0;
            let changed = false;
            for (let i = 0; i < 4; i++) {
                const lvPin = `lv${i + 1}`;
                const hvPin = `hv${i + 1}`;
                const lvLow = read(lvPin) < lvRail * 0.3;
                const hvLow = read(hvPin) < hvRail * 0.3;
                const mode = state._mode[i];
                let next = mode;
                if (mode === 'idle') {
                    if (lvLow) next = 'lvDrives';
                    else if (hvLow) next = 'hvDrives';
                } else if (mode === 'lvDrives') {
                    // We drive HV low; watch only the side we do NOT drive.
                    if (!lvLow) next = 'idle';
                } else if (mode === 'hvDrives') {
                    if (!hvLow) next = 'idle';
                }
                if (next !== mode) {
                    state._mode[i] = next;
                    delete state.drives[lvPin];
                    delete state.drives[hvPin];
                    if (next === 'lvDrives') state.drives[hvPin] = { vTh: 0, rTh: R_MOSFET };
                    if (next === 'hvDrives') state.drives[lvPin] = { vTh: 0, rTh: R_MOSFET };
                    changed = true;
                }
            }
            return changed;
        },
    });
}

export default registerLevelMux;
