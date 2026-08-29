/**
 * LM358 dual op-amp + LM3915 dot/bar display driver — the analog pair
 * behind every cheap VU meter, clean-room from the TI datasheets.
 *
 * The op-amp is the genuinely hard one: real feedback needs convergence
 * inside the board's bounded settle loop (ten device/solve rounds per
 * event). The output is a Thévenin drive the model re-aims each round;
 * what changed (2026-08-29, defect D18) is HOW it aims.
 *
 * It used to be a damped integrator: output += G_STEP × (v+ − v−), halt
 * once that step fell below 1 mV. The header claimed "a follower (β = 1)
 * lands within millivolts in ten rounds, resistor-gain stages faster".
 * That is backwards, and the corpus caught it. Under negative feedback
 * with attenuation β the error contracts by |1 − G_STEP·β| per round, so
 * a GAIN stage — which by construction has SMALL β — converges SLOWEST.
 * The shipped ×46.45 shunt amplifier (100 kΩ/2.2 kΩ, β = 0.0215)
 * contracts by 0.9677 per round: closing 99 % of the error needs 141
 * rounds against the ten the settle loop allows. The 1 mV halt then
 * froze it at a WRONG fixed point, leaving up to 1 mV/G_STEP = 0.667 mV
 * of input error unamplified — realised gain 31.04 at a 2 mV input,
 * 38.79 at 4 mV, 43.39 at 10 mV. Input-dependent, and stable in time, so
 * it read as physics rather than as arithmetic.
 *
 * It is now a SECANT iteration on the input error. For a linear feedback
 * network the error is affine in the output, e(u) = k − β·u, so two
 * (u, e) pairs give β exactly and one step lands on e = 0 — whatever β
 * is, and without the model ever being told what the feedback network
 * looks like. Round 0 has no history and takes the old damped step;
 * round 1 is the secant; round 2 confirms |e| ≤ E_TOL and halts. Three
 * rounds for any resistive feedback, against 141 for the shunt amp.
 *
 * The damped step survives as the fallback for every case where the
 * secant has no slope to work with: open loop (β = 0 — it marches
 * rail-ward like the comparator it then is) and POSITIVE feedback
 * (β < 0 — a Schmitt trigger must run to a rail, not be solved to the
 * unstable point the secant would find). A naked ×100k VCVS would
 * ping-pong between rails forever; that is why this is an aiming loop
 * and not a gain block, and it is stated here rather than hidden.
 *
 * LM3915: ten comparators on a 3 dB/step log ladder (datasheet's
 * defining feature — the equal-loudness VU law), reference from
 * params.fullScale (default 1.25, the internal reference), outputs
 * active-LOW current sinks (LEDs hang from VCC), MODE pin high = bar,
 * low/open = dot. state.level 0-10 for the artwork.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 100;          // LM358 output stage, modest drive
const R_SINK = 50;
const R_OFF = 1e9;
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.
const G_STEP = 1.5;         // fallback damped step per settle round
// Secant guards. BETA_MIN is the smallest feedback attenuation the secant
// is allowed to divide by: below it the loop is open (or positive) and the
// damped march to a rail is the honest answer. E_TOL is the residual input
// error the loop settles for — it is the ONLY thing that now limits
// realised gain, at |e|/Vin relative error (5e-5 on the 2 mV shunt bench,
// against the 33 % the 1 mV output-step halt used to leave).
const BETA_MIN = 1e-4;
const E_TOL = 1e-7;         // volts of residual (v+ − v−)
const U_TOL = 1e-9;         // volts of output movement below which nothing changed

export function registerAnalogAmps() {

    registerDevice('lm358', {
        terminals: ['vcc', 'gnd',
            '1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out'],

        init() {
            return {
                drives: {
                    '1_out': { vTh: 0, rTh: R_OUT },
                    '2_out': { vTh: 0, rTh: R_OUT },
                },
                // Previous (applied output, resulting input error) pair per
                // channel — the secant's second point. Null until the first
                // round has produced one.
                _prev: { 1: null, 2: null },
            };
        },

        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const gnd = read('gnd') || 0;
            const hi = vcc - 1.5;              // the LM358's real top swing
            const lo = gnd + 0.005;
            if (!state._prev) state._prev = { 1: null, 2: null };
            let changed = false;
            for (const ch of ['1', '2']) {
                const e = read(`${ch}_pos`) - read(`${ch}_neg`);
                const cur = state.drives[`${ch}_out`].vTh;
                const prev = state._prev[ch];
                // The secant needs two DISTINCT outputs to measure a slope.
                let next = null;
                if (prev && Math.abs(cur - prev.u) > U_TOL) {
                    // e(u) = k − β·u ⇒ β = −de/du, measured, not assumed.
                    const beta = (prev.e - e) / (cur - prev.u);
                    if (Number.isFinite(beta) && beta > BETA_MIN) next = cur + e / beta;
                }
                // No usable slope (first round, open loop, positive feedback):
                // the damped march, which is what makes the rails reachable.
                if (next === null) next = cur + G_STEP * e;
                next = Math.max(lo, Math.min(hi, next));
                // The pair stored is always (output that was APPLIED, error it
                // produced), so a rail clamp never corrupts the slope estimate.
                state._prev[ch] = { u: cur, e };
                // Settled means the INPUT error is closed, not that the output
                // stopped moving: the old output-step halt is exactly what left
                // 0.667 mV of input unamplified.
                //
                // …AND the drive is inside the part's own swing. A powered-up
                // LM358 does not sit below its own bottom swing, and that is
                // not pedantry: on the very first solve of an oscillator every
                // node reads 0, so e = 0 EXACTLY on both channels, and an
                // error-only halt leaves the whole analog section dead at 0 V
                // forever. The old damped step broke that symmetry by
                // accident, through the same clamp — pc85-led-lampe-puls (an
                // LM358 triangle oscillator) is where the corpus differential
                // caught it.
                const inSwing = cur >= lo - U_TOL && cur <= hi + U_TOL;
                if ((Math.abs(e) <= E_TOL && inSwing) || Math.abs(next - cur) <= U_TOL) continue;
                state.drives[`${ch}_out`] = { vTh: next, rTh: R_OUT };
                changed = true;
            }
            return changed;
        },
    });

    registerDevice('lm3915', {
        terminals: ['vcc', 'gnd', 'sig', 'mode',
            'l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10'],

        init() {
            const drives = {};
            for (let i = 1; i <= 10; i++) drives[`l${i}`] = { vTh: 0, rTh: R_OFF };
            return { drives, level: 0, bar: false };
        },

        // The SIG input is buffered on the real part — near-zero load, which
        // is exactly what an unstamped pin is. The 10 MOhm declared here named
        // no second terminal and never ran, so there is no stamp
        // (spec-updates/ideal-high-z-inputs.md).
        update(part, state, read) {
            const vcc = read('vcc') || 5.0;
            const full = part.params?.fullScale ?? 1.25;
            const v = read('sig') - (read('gnd') || 0);
            // 3 dB per step, top step at fullScale: thresholds
            // full × 10^(−3·(10−i)/20) for i = 1..10.
            let level = 0;
            for (let i = 1; i <= 10; i++) {
                const th = full * Math.pow(10, (-3 * (10 - i)) / 20);
                if (v >= th) level = i;
            }
            const bar = read('mode') > vcc * 0.5;
            if (level === state.level && bar === state.bar) return false;
            state.level = level;
            state.bar = bar;
            for (let i = 1; i <= 10; i++) {
                const on = bar ? i <= level : i === level && level > 0;
                state.drives[`l${i}`] = on
                    ? { vTh: 0, rTh: R_SINK }          // sink: LED from VCC lights
                    : { vTh: 0, rTh: R_OFF };
            }
            return true;
        },
    });
}

export default registerAnalogAmps;
