/**
 * LM358/LM324/LM741 op-amps + LM3915 dot/bar display driver — the analog pair
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

// LM741 typical/minimum figures from TI SNOSC25D, electrical characteristics
// at VS=+/-15 V.  The behavioural model keeps the important old-bipolar-op-amp
// limits visible without embedding a proprietary transistor macromodel.
const LM741_A0 = 200000;             // 200 V/mV typical large-signal gain
const LM741_GBW_HZ = 1e6;            // conservative 1 MHz-class unity bandwidth
const LM741_SLEW_V_PER_US = 0.5;     // unity-gain slew rate
const LM741_INPUT_R = 2e6;           // differential input resistance, typical
const LM741_R_OUT = 600;             // gives ~10 V into 2 kOhm at +/-15 V
const LM741_TICK_NS = 300n;           // resolves 0.3 us typical rise time
const LM741_SETTLED_V = 1e-6;

function registerGroundSensingOpAmp(kind, channels, {
    minSupply = 3.0, highHeadroom = 1.5, lowHeadroom = 0.005,
    inputHighHeadroom = 1.5, legacyUnwiredFiveVoltSupply = false,
} = {}) {
    const channelTerminals = channels.flatMap(ch => [`${ch}_pos`, `${ch}_neg`, `${ch}_out`]);
    registerDevice(kind, {
        terminals: ['vcc', 'gnd', ...channelTerminals],

        init() {
            return {
                drives: Object.fromEntries(channels.map(ch => [`${ch}_out`, { vTh: 0, rTh: R_OUT }])),
                _prev: Object.fromEntries(channels.map(ch => [ch, null])),
                powered: false,
                inputCommonMode: Object.fromEntries(channels.map(ch => [ch, 'unknown'])),
            };
        },

        update(part, state, read) {
            const rawVcc = read('vcc');
            const vcc = legacyUnwiredFiveVoltSupply && !rawVcc ? 5.0 : rawVcc;
            const gnd = read('gnd') || 0;
            const powered = Number.isFinite(vcc) && Number.isFinite(gnd) && vcc - gnd >= minSupply;
            state.powered = powered;
            if (!state._prev) state._prev = Object.fromEntries(channels.map(ch => [ch, null]));
            if (!state.inputCommonMode) state.inputCommonMode = {};
            let changed = false;
            if (!powered) {
                for (const ch of channels) {
                    state.inputCommonMode[ch] = 'unpowered';
                    const cur = state.drives[`${ch}_out`];
                    if (cur.vTh !== gnd || cur.rTh !== R_OFF) {
                        state.drives[`${ch}_out`] = { vTh: gnd, rTh: R_OFF };
                        state._prev[ch] = null;
                        changed = true;
                    }
                }
                return changed;
            }

            const hi = vcc - highHeadroom;
            const lo = gnd + lowHeadroom;
            const inputHi = vcc - inputHighHeadroom;
            for (const ch of channels) {
                const pos = read(`${ch}_pos`);
                const neg = read(`${ch}_neg`);
                const common = (pos + neg) / 2;
                state.inputCommonMode[ch] = common < gnd ? 'below'
                    : common > inputHi ? 'above' : 'valid';
                // Outside the characterised common-mode range the real devices
                // do not promise linear accuracy. We retain a deterministic,
                // rail-bounded solve and publish the limitation in state; we
                // deliberately do not invent phase reversal or precision.
                const e = pos - neg;
                const cur = state.drives[`${ch}_out`].vTh;
                const prev = state._prev[ch];
                let next = null;
                if (prev && Math.abs(cur - prev.u) > U_TOL) {
                    const beta = (prev.e - e) / (cur - prev.u);
                    if (Number.isFinite(beta) && beta > BETA_MIN) next = cur + e / beta;
                }
                if (next === null) next = cur + G_STEP * e;
                next = Math.max(lo, Math.min(hi, next));
                state._prev[ch] = { u: cur, e };
                const inSwing = cur >= lo - U_TOL && cur <= hi + U_TOL;
                if ((Math.abs(e) <= E_TOL && inSwing) || Math.abs(next - cur) <= U_TOL) continue;
                state.drives[`${ch}_out`] = { vTh: next, rTh: R_OUT };
                changed = true;
            }
            return changed;
        },
    });
}

function registerLm741() {
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    registerDevice('lm741', {
        // TI PDIP-8 top-view contract: 1 null, 2 -, 3 +, 4 V-, 5 null,
        // 6 output, 7 V+, 8 NC.  Null pins remain present and high-Z; their
        // trim network is explicitly reported as outside this bounded model.
        terminals: ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'],

        init(part) {
            return {
                drives: { out: { vTh: 0, rTh: R_OFF } },
                powered: false,
                inputCommonMode: 'unknown',
                offsetNull: 'unmodeled',
                inputOffsetV: Number.isFinite(part.params?.inputOffsetV)
                    ? Number(part.params.inputOffsetV) : 0.001,
                _prev: null,
                _beta: null,
                _lastUpdateNs: null,
                _wakeNs: null,
            };
        },

        stamp(ctx) {
            // The 2 MOhm figure is differential input resistance.  Stamping
            // it between the two pins avoids inventing either input as ground.
            ctx.conductance('inp', 'inn', 1 / LM741_INPUT_R);
        },

        update(part, state, read, tNs) {
            const vpos = read('vpos');
            const vneg = read('vneg');
            const powered = Number.isFinite(vpos) && Number.isFinite(vneg)
                && vpos - vneg >= 10;
            state.powered = powered;
            if (!powered) {
                state.inputCommonMode = 'unpowered';
                state._prev = null;
                state._beta = null;
                state._lastUpdateNs = tNs;
                state._wakeNs = null;
                const old = state.drives.out;
                if (old.vTh === vneg && old.rTh === R_OFF) return false;
                state.drives.out = { vTh: vneg, rTh: R_OFF };
                return true;
            }

            // At +/-15 V the guaranteed input range is +/-12 V and the
            // loaded output guarantee is +/-10 V.  Three volts of input
            // headroom and a +/-13 V Thevenin source behind 600 ohms express
            // those two independent limits without claiming rail-to-rail I/O.
            const commonLow = vneg + 3;
            const commonHigh = vpos - 3;
            const inp = read('inp');
            const inn = read('inn');
            state.inputCommonMode = (inp < commonLow || inn < commonLow) ? 'below'
                : (inp > commonHigh || inn > commonHigh) ? 'above' : 'valid';

            const low = vneg + 2;
            const high = vpos - 2;
            const out = read('out');
            const drive = state.drives.out.vTh;
            const residual = inp - inn + state.inputOffsetV - out / LM741_A0;
            if (state._lastUpdateNs !== null && tNs <= state._lastUpdateNs) {
                // The board re-solves immediately after a drive changes and
                // calls us again at the SAME simulated instant.  That pass
                // must not overwrite the before-drive sample used to measure
                // feedback beta.  A changed input with an unchanged drive is
                // different: retain that sample and arm the next real tick.
                if (state._prev && Math.abs(drive - state._prev.u) <= U_TOL
                    && Math.abs(residual - state._prev.r) > LM741_SETTLED_V) {
                    state._prev = { u: drive, r: residual };
                    state._lastUpdateNs = tNs;
                    state._wakeNs = tNs + LM741_TICK_NS;
                }
                return false;
            }
            let beta = null;
            let target;
            const measuredSlope = state._prev && Math.abs(drive - state._prev.u) > U_TOL;
            if (measuredSlope) {
                beta = (state._prev.r - residual) / (drive - state._prev.u);
            }
            if (Number.isFinite(beta) && beta > BETA_MIN) state._beta = beta;
            else beta = state._beta;
            if (Number.isFinite(beta) && beta > BETA_MIN) {
                target = drive + residual / beta;
            } else if (!measuredSlope) {
                // A quiescent zero-output follower has not yet supplied two
                // points from which to infer feedback.  Use one bounded
                // residual-sized probe; the next tick then distinguishes a
                // real feedback network from open/positive-loop operation.
                target = drive + residual;
            } else {
                target = drive + LM741_A0 * residual;
            }
            target = clamp(target, low, high);
            state._prev = { u: drive, r: residual };

            if (state._lastUpdateNs === null) {
                state._lastUpdateNs = tNs;
                state._wakeNs = tNs + LM741_TICK_NS;
                return false;
            }
            if (state._wakeNs && tNs < state._wakeNs) {
                return false;
            }

            const dtSec = Number(tNs - state._lastUpdateNs) / 1e9;
            const dtUs = dtSec * 1e6;
            const closedLoopBw = Number.isFinite(beta) && beta > BETA_MIN
                ? LM741_GBW_HZ * Math.min(1, beta) : LM741_GBW_HZ;
            const alpha = 1 - Math.exp(-2 * Math.PI * closedLoopBw * dtSec);
            const bandwidthStep = (target - drive) * alpha;
            const slewStep = LM741_SLEW_V_PER_US * dtUs;
            const delta = clamp(bandwidthStep, -slewStep, slewStep);
            const next = clamp(drive + delta, low, high);
            state._lastUpdateNs = tNs;

            const settled = Math.abs(target - next) <= LM741_SETTLED_V
                && Math.abs(residual) <= LM741_SETTLED_V;
            state._wakeNs = settled ? null : tNs + LM741_TICK_NS;
            if (Math.abs(next - drive) <= U_TOL) return false;
            state.drives.out = { vTh: next, rTh: LM741_R_OUT };
            return true;
        },
    });
}

export function registerAnalogAmps() {
    // Preserve LM358's historical implicit 5 V fallback for old benches that
    // omitted its supply wire; LM324 is new and requires its real shared rails.
    registerGroundSensingOpAmp('lm358', ['1', '2'], { legacyUnwiredFiveVoltSupply: true });
    registerGroundSensingOpAmp('lm324', ['1', '2', '3', '4']);
    registerLm741();

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
