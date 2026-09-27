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

// A single dynamic controller serves the physical single op-amps below;
// every electrical number remains a part fact in its own immutable card.
// Keeping LM741's prior values in the card is intentional: the extraction is
// a refactor, not permission to alter an already shipped device.
const PRECISION_OP_AMPS = Object.freeze({
    lm741: Object.freeze({
        a0: 200000,             // TI SNOSC25D: 200 V/mV typical
        gbwHz: 1e6,
        slewVPerUs: 0.5,
        inputR: 2e6,
        rOut: 600,              // gives ~10 V into 2 kOhm at +/-15 V
        tickNs: 300n,
        settledV: 1e-6,
        minSupply: 10,
        commonHeadroom: 3,
        outputHeadroom: 2,
        defaultOffsetV: 0.001,
    }),
    // Analog Devices LT1001 data sheet, electrical characteristics at
    // VS=+/-15 V.  This is a bounded behavioural card, not ADI's transistor
    // macromodel: the static limits and dominant-pole/slew response are kept;
    // noise, drift and trim-network dynamics are named outside the model.
    lt1001: Object.freeze({
        a0: 5e6,                // 5,000 V/mV typical large-signal gain
        gbwHz: 0.8e6,           // 0.8 MHz typical gain-bandwidth product
        slewVPerUs: 0.25,       // 0.25 V/us typical
        inputR: 50e6,           // differential input resistance, typical
        rOut: 150,              // bounded loaded swing at +/-15 V, 2 kOhm
        tickNs: 300n,
        settledV: 1e-7,
        minSupply: 6,
        commonHeadroom: 2,
        outputHeadroom: 1.5,
        defaultOffsetV: 5e-6,   // typical room-temperature offset
    }),
    // Analog Devices LT1006 data sheet, S8 commercial part at 5 V. Unlike
    // the dual-supply precision cards, this part is explicitly asymmetric:
    // its inputs include the negative rail and its output sinks to within
    // millivolts of it, while both remain bounded away from the positive rail.
    // Pin 8 can trade supply current for speed; that external programming
    // network is physical but deliberately not simulated by this card.
    lt1006: Object.freeze({
        a0: 2e6,                // LT1006C typical large-signal gain at 5 V
        gbwHz: 0.7e6,           // bounded 5 V unity-gain crossover from G20/G21
        slewVPerUs: 0.4,        // room-temperature typical
        inputR: 300e6,          // differential input resistance, typical
        rOut: 100,              // conservative loaded single-supply swing
        tickNs: 300n,
        settledV: 1e-7,
        minSupply: 2.7,
        commonLowHeadroom: 0,   // guaranteed input range includes V-
        commonHighHeadroom: 1.5,
        outputLowHeadroom: 0.015,
        outputHighHeadroom: 1.0,
        defaultOffsetV: 80e-6,  // S8 at 5 V, room-temperature maximum
        terminals: ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'iset'],
        pin8Role: 'supply-current-set',
    }),
    // Analog Devices OP07 Rev. G, OP07C typicals at VS=+/-15 V. This keeps
    // the public electrical limits that matter to a circuit while declining
    // to impersonate the vendor transistor macromodel: noise, temperature
    // drift, bias current and the external trim network remain outside scope.
    op07: Object.freeze({
        a0: 400000,             // 400 V/mV typical large-signal gain
        gbwHz: 0.6e6,           // 0.6 MHz typical gain-bandwidth product
        slewVPerUs: 0.3,        // 0.3 V/us typical
        inputR: 33e6,           // differential input resistance, typical
        rOut: 60,               // open-loop output resistance, typical
        tickNs: 300n,
        settledV: 1e-7,
        minSupply: 6,           // specified down to +/-3 V
        commonHeadroom: 2,      // guaranteed +/-13 V at +/-15 V supplies
        outputHeadroom: 2,      // loaded swing stays inside the +/-12 V floor
        defaultOffsetV: 60e-6,  // OP07C room-temperature typical
    }),
    // Analog Devices OP27 Rev. H typicals at VS=+/-15 V. The data sheet does
    // not specify differential input resistance, so unlike the older cards we
    // leave that path high-Z instead of misusing its 3 GOhm common-mode value.
    op27: Object.freeze({
        a0: 1.8e6,              // 1,800 V/mV typical large-signal gain
        gbwHz: 8e6,             // 8 MHz typical gain-bandwidth product
        slewVPerUs: 2.8,        // 2.8 V/us typical
        inputR: null,
        rOut: 70,               // 70 ohm typical open-loop output resistance
        tickNs: 25n,
        settledV: 1e-8,
        minSupply: 8,           // characterized down to +/-4 V
        commonHeadroom: 4,      // guaranteed +/-11 V at +/-15 V supplies
        outputHeadroom: 2,      // with 70 ohm Rout, retains 600-ohm loaded swing
        defaultOffsetV: 10e-6,  // front-page room-temperature typical
    }),
    // Analog Devices LT1007/LT1037 data sheet typicals at VS=+/-15 V. The
    // specified 5 GOhm figure is common-mode input resistance, not authority
    // for a differential resistor, so the two inputs remain honestly high-Z.
    // Noise, drift, bias current and the external offset-trim network remain
    // outside this bounded circuit model.
    lt1007: Object.freeze({
        a0: 20e6,
        gbwHz: 8e6,
        slewVPerUs: 2.5,
        inputR: null,
        rOut: 70,
        tickNs: 25n,
        settledV: 1e-8,
        minSupply: 8,
        commonHeadroom: 2.5,
        outputHeadroom: 1,
        defaultOffsetV: 10e-6,
        terminals: ['offset_1', 'inn', 'inp', 'vneg', 'nc', 'out', 'vpos', 'offset_8'],
    }),
    // Analog Devices AD711 Rev. E J-grade typicals at VS=+/-15 V. Unlike
    // several bipolar precision cards, this data sheet explicitly specifies
    // differential input impedance, so the bounded model retains its 3 TOhm
    // resistive term while leaving the parallel 5.5 pF, bias/noise/drift and
    // external offset-trim network outside this slice.
    ad711: Object.freeze({
        a0: 400000,             // 400 V/mV typical open-loop gain
        gbwHz: 4e6,             // 4 MHz typical small-signal bandwidth
        slewVPerUs: 20,         // 20 V/us typical large-signal slew
        inputR: 3e12,           // differential input impedance, typical
        rOut: 0.01,             // low-frequency unity-gain output impedance
        tickNs: 25n,
        settledV: 1e-7,
        minSupply: 9,           // operating range begins at +/-4.5 V
        commonLowHeadroom: 3.5, // typical -11.5 V at a -15 V rail
        commonHighHeadroom: 0.5,// typical +14.5 V at a +15 V rail
        outputLowHeadroom: 1.9, // typical -13.1 V with the loaded table case
        outputHighHeadroom: 1.2,// typical +13.8 V with the loaded table case
        defaultOffsetV: 0.3e-3, // J-grade room-temperature typical
        terminals: ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'],
    }),
});

// TI SLOS039D, LT1014 at 5 V unless noted. This is the physical quad package,
// not four unrelated single-amplifier aliases: all four channels share the
// same vpos/vneg rails and one device state. The bounded card retains the
// circuit-relevant finite gain, differential input resistance, output swing,
// offset and large-signal slew while leaving noise, bias-current and thermal
// coupling outside the model.
const LT1014_SPEC = Object.freeze({
    a0: 1e6,                 // typical 5 V large-signal gain, 1 V/uV
    gbwHz: 0.8e6,            // dominant-pole class shared with LT1013/1014
    slewVPerUs: 0.4,         // typical at +/-15 V
    inputR: 300e6,           // typical differential input resistance
    rOut: 100,               // bounded loaded single-supply output
    tickNs: 300n,
    settledV: 1e-7,
    minSupply: 4,
    commonLowHeadroom: 0,
    commonHighHeadroom: 1.5,
    outputLowHeadroom: 0.015,
    outputHighHeadroom: 1.0,
    defaultOffsetV: 90e-6,   // typical at 5 V
    terminals: ['inp', 'inn', 'vpos', 'vneg', 'out'],
});

// Analog Devices ADTL082/ADTL084 Rev. B at +/-15 V. The physical ADTL082 is
// one dual, shared-rail device; its JFET inputs are represented by the
// specified 1 TOhm input impedance rather than by the bipolar cards' lower
// differential resistances. This bounded card retains DC gain/ranges and the
// dominant bandwidth/slew behavior, while noise, distortion, bias-current
// drift and the proprietary transistor macromodel remain outside scope.
const ADTL082_SPEC = Object.freeze({
    a0: 200000,              // 200 V/mV typical large-signal gain
    gbwHz: 5e6,              // 5 MHz typical gain-bandwidth product
    slewVPerUs: 20,          // typical large-signal slew rate
    inputR: 1e12,            // typical input impedance
    rOut: 600,               // retains the guaranteed +/-10 V into 2 kOhm
    tickNs: 25n,
    settledV: 1e-7,
    minSupply: 10,           // specified from +/-5 V through +/-15 V
    commonLowHeadroom: 4,    // -11 V minimum at a -15 V rail
    commonHighHeadroom: 0,   // common-mode maximum includes +15 V
    outputLowHeadroom: 2,
    outputHighHeadroom: 2,
    defaultOffsetV: 1.5e-3,  // A-grade room-temperature typical
    terminals: ['inp', 'inn', 'vpos', 'vneg', 'out'],
});

// Analog Devices LT1678/LT1679 at +/-15 V. The physical LT1678 is one
// shared-rail dual in the production S8 package. The proprietary LTspice
// subcircuit remains a downstream source-model blocker: this card deliberately
// bounds the public DC, dominant-pole and slew behavior, not transistor-level
// noise, distortion, bias, drift, CMRR/PSRR or package parasitics. The data
// sheet's 2 GOhm figure is common-mode resistance, so it is not stamped as a
// made-up differential conductance.
const LT1678_SPEC = Object.freeze({
    a0: 7e6,                 // 7 V/uV typical large-signal gain, RL=10 kOhm
    gbwHz: 20e6,             // 20 MHz typical gain-bandwidth product
    slewVPerUs: 6,           // typical large-signal slew rate
    inputR: null,            // 2 GOhm is specified as common-mode resistance
    rOut: 100,               // typical open-loop output resistance
    tickNs: 10n,
    settledV: 1e-8,
    minSupply: 3.1,          // guaranteed operating span over temperature
    commonLowHeadroom: 1.7,  // guaranteed -13.3 V at a -15 V rail
    commonHighHeadroom: 1.0, // guaranteed +14 V at a +15 V rail
    outputLowHeadroom: 0.37, // typical 10 mA loaded rail-to-rail envelope
    outputHighHeadroom: 0.20,
    defaultOffsetV: 20e-6,   // typical at +/-15 V
    terminals: ['inp', 'inn', 'vpos', 'vneg', 'out'],
});

// Analog Devices OP777/OP727/OP747 Rev. D. The physical OP747 is one
// shared-rail quad in an R-14 SOIC or RU-14 TSSOP. This bounded card uses the
// +/-15 V typical large-signal gain and the guaranteed common-mode/output
// envelopes; input bias is specified but differential input resistance is not,
// so the inputs remain honestly high-Z rather than receiving an invented value.
const OP747_SPEC = Object.freeze({
    a0: 2.5e6,               // 2,500 V/mV typical large-signal gain at +/-15 V
    gbwHz: 0.7e6,            // 0.7 MHz gain-bandwidth product
    slewVPerUs: 0.2,         // specified large-signal slew rate
    inputR: null,            // no differential resistance specified
    rOut: 100,               // bounded rail-to-rail loaded output
    tickNs: 300n,
    settledV: 1e-8,
    minSupply: 3,            // +3 V single supply / +/-1.5 V dual supply
    commonLowHeadroom: 0,
    commonHighHeadroom: 1,   // 0..4 V at 5 V; -15..+14 V at +/-15 V
    outputLowHeadroom: 0.04, // plus rOut drop retains the 1 mA 140 mV limit
    outputHighHeadroom: 0.02,// plus rOut drop retains the 1 mA 120 mV limit
    defaultOffsetV: 30e-6,   // OP747 room-temperature typical
    terminals: ['inp', 'inn', 'vpos', 'vneg', 'out'],
});

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

function registerPrecisionOpAmp(kind, spec) {
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    registerDevice(kind, {
        // The LT1001 and LM741 share the industry-standard PDIP-8 top view:
        // 1 null, 2 -, 3 +, 4 V-, 5 null, 6 output, 7 V+, 8 NC. Null pins
        // remain present and high-Z; trim dynamics are explicitly unmodelled.
        terminals: spec.terminals
            || ['offset_1', 'inn', 'inp', 'vneg', 'offset_5', 'out', 'vpos', 'nc'],

        init(part) {
            return {
                drives: { out: { vTh: 0, rTh: R_OFF } },
                powered: false,
                inputCommonMode: 'unknown',
                offsetNull: 'unmodeled',
                inputOffsetV: Number.isFinite(part.params?.inputOffsetV)
                    ? Number(part.params.inputOffsetV) : spec.defaultOffsetV,
                _prev: null,
                _beta: null,
                _lastUpdateNs: null,
                _wakeNs: null,
                ...(spec.pin8Role === 'supply-current-set'
                    ? { supplyCurrentSet: 'unmodeled' } : {}),
            };
        },

        stamp(ctx) {
            // This is differential input resistance. Stamping it between the
            // pins avoids inventing either input as ground.
            if (Number.isFinite(spec.inputR)) ctx.conductance('inp', 'inn', 1 / spec.inputR);
        },

        update(part, state, read, tNs) {
            const vpos = read('vpos');
            const vneg = read('vneg');
            const powered = Number.isFinite(vpos) && Number.isFinite(vneg)
                && vpos - vneg >= spec.minSupply;
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

            const commonLow = vneg + (spec.commonLowHeadroom ?? spec.commonHeadroom);
            const commonHigh = vpos - (spec.commonHighHeadroom ?? spec.commonHeadroom);
            const inp = read('inp');
            const inn = read('inn');
            state.inputCommonMode = (inp < commonLow || inn < commonLow) ? 'below'
                : (inp > commonHigh || inn > commonHigh) ? 'above' : 'valid';

            const low = vneg + (spec.outputLowHeadroom ?? spec.outputHeadroom);
            const high = vpos - (spec.outputHighHeadroom ?? spec.outputHeadroom);
            const out = read('out');
            const drive = state.drives.out.vTh;
            const residual = inp - inn + state.inputOffsetV - out / spec.a0;
            if (state._lastUpdateNs !== null && tNs <= state._lastUpdateNs) {
                // The board re-solves immediately after a drive changes and
                // calls us again at the SAME simulated instant.  That pass
                // must not overwrite the before-drive sample used to measure
                // feedback beta.  A changed input with an unchanged drive is
                // different: retain that sample and arm the next real tick.
                if (state._prev && Math.abs(drive - state._prev.u) <= U_TOL
                    && Math.abs(residual - state._prev.r) > spec.settledV) {
                    state._prev = { u: drive, r: residual };
                    state._lastUpdateNs = tNs;
                    state._wakeNs = tNs + spec.tickNs;
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
                target = drive + spec.a0 * residual;
            }
            target = clamp(target, low, high);
            state._prev = { u: drive, r: residual };

            if (state._lastUpdateNs === null) {
                state._lastUpdateNs = tNs;
                state._wakeNs = tNs + spec.tickNs;
                return false;
            }
            if (state._wakeNs && tNs < state._wakeNs) {
                return false;
            }

            const dtSec = Number(tNs - state._lastUpdateNs) / 1e9;
            const dtUs = dtSec * 1e6;
            const closedLoopBw = Number.isFinite(beta) && beta > BETA_MIN
                ? spec.gbwHz * Math.min(1, beta) : spec.gbwHz;
            const alpha = 1 - Math.exp(-2 * Math.PI * closedLoopBw * dtSec);
            const bandwidthStep = (target - drive) * alpha;
            const slewStep = spec.slewVPerUs * dtUs;
            const delta = clamp(bandwidthStep, -slewStep, slewStep);
            const next = clamp(drive + delta, low, high);
            state._lastUpdateNs = tNs;

            const settled = Math.abs(target - next) <= spec.settledV
                && Math.abs(residual) <= spec.settledV;
            state._wakeNs = settled ? null : tNs + spec.tickNs;
            if (Math.abs(next - drive) <= U_TOL) return false;
            state.drives.out = { vTh: next, rTh: spec.rOut };
            return true;
        },
    });
}

function registerPrecisionMultiOpAmp(kind, spec, channels, terminals) {
    const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
    registerDevice(kind, {
        terminals,

        init(part) {
            const configured = part.params?.inputOffsetV;
            const offsets = channels.map((ch, index) => {
                const perChannel = part.params?.[`inputOffsetV${ch}`];
                if (Number.isFinite(perChannel)) return Number(perChannel);
                if (Array.isArray(configured) && Number.isFinite(configured[index])) {
                    return Number(configured[index]);
                }
                return Number.isFinite(configured) ? Number(configured) : spec.defaultOffsetV;
            });
            return {
                drives: Object.fromEntries(channels.map(ch => [`${ch}_out`, { vTh: 0, rTh: R_OFF }])),
                powered: false,
                inputCommonMode: Object.fromEntries(channels.map(ch => [ch, 'unknown'])),
                inputOffsetV: Object.fromEntries(channels.map((ch, index) => [ch, offsets[index]])),
                _channels: Object.fromEntries(channels.map(ch => [ch, {
                    prev: null, beta: null, lastUpdateNs: null, wakeNs: null,
                }])),
                _wakeNs: null,
            };
        },

        stamp(ctx) {
            if (!Number.isFinite(spec.inputR)) return;
            for (const ch of channels) {
                ctx.conductance(`${ch}_pos`, `${ch}_neg`, 1 / spec.inputR);
            }
        },

        update(part, state, read, tNs) {
            const vpos = read('vpos');
            const vneg = read('vneg');
            const powered = Number.isFinite(vpos) && Number.isFinite(vneg)
                && vpos - vneg >= spec.minSupply;
            state.powered = powered;
            let changed = false;
            if (!powered) {
                state._wakeNs = null;
                for (const ch of channels) {
                    state.inputCommonMode[ch] = 'unpowered';
                    state._channels[ch] = { prev: null, beta: null, lastUpdateNs: tNs, wakeNs: null };
                    const old = state.drives[`${ch}_out`];
                    if (old.vTh !== vneg || old.rTh !== R_OFF) {
                        state.drives[`${ch}_out`] = { vTh: vneg, rTh: R_OFF };
                        changed = true;
                    }
                }
                return changed;
            }

            const commonLow = vneg + spec.commonLowHeadroom;
            const commonHigh = vpos - spec.commonHighHeadroom;
            const low = vneg + spec.outputLowHeadroom;
            const high = vpos - spec.outputHighHeadroom;
            for (const ch of channels) {
                const cs = state._channels[ch];
                const inp = read(`${ch}_pos`);
                const inn = read(`${ch}_neg`);
                state.inputCommonMode[ch] = (inp < commonLow || inn < commonLow) ? 'below'
                    : (inp > commonHigh || inn > commonHigh) ? 'above' : 'valid';
                const drive = state.drives[`${ch}_out`].vTh;
                const out = read(`${ch}_out`);
                const residual = inp - inn + state.inputOffsetV[ch] - out / spec.a0;

                if (cs.lastUpdateNs !== null && tNs <= cs.lastUpdateNs) {
                    if (cs.prev && Math.abs(drive - cs.prev.u) <= U_TOL
                        && Math.abs(residual - cs.prev.r) > spec.settledV) {
                        cs.prev = { u: drive, r: residual };
                        cs.lastUpdateNs = tNs;
                        cs.wakeNs = tNs + spec.tickNs;
                    }
                    continue;
                }

                let beta = null;
                let target;
                const measuredSlope = cs.prev && Math.abs(drive - cs.prev.u) > U_TOL;
                if (measuredSlope) beta = (cs.prev.r - residual) / (drive - cs.prev.u);
                // A passive voltage-feedback fraction cannot exceed one.
                // Near a fully settled, high-gain loop both numerator and
                // denominator approach floating-point noise; accepting their
                // quotient as a new beta can freeze the next authored input
                // change behind an enormous bogus feedback factor.
                if (Number.isFinite(beta) && beta > BETA_MIN) {
                    // Unity feedback can measure infinitesimally above one as
                    // the residual and drive deltas approach machine noise.
                    // Clamp that passive estimate; discarding it falls back to
                    // open-loop slew and can strand an unloaded follower.
                    cs.beta = Math.min(1, beta);
                    beta = cs.beta;
                } else beta = cs.beta;
                if (Number.isFinite(beta) && beta > BETA_MIN) target = drive + residual / beta;
                else if (!measuredSlope) target = drive + residual;
                else target = drive + spec.a0 * residual;
                target = clamp(target, low, high);
                cs.prev = { u: drive, r: residual };

                if (cs.lastUpdateNs === null) {
                    cs.lastUpdateNs = tNs;
                    cs.wakeNs = tNs + spec.tickNs;
                    continue;
                }
                if (cs.wakeNs && tNs < cs.wakeNs) continue;

                const dtSec = Number(tNs - cs.lastUpdateNs) / 1e9;
                const dtUs = dtSec * 1e6;
                const closedLoopBw = Number.isFinite(beta) && beta > BETA_MIN
                    ? spec.gbwHz * Math.min(1, beta) : spec.gbwHz;
                const alpha = 1 - Math.exp(-2 * Math.PI * closedLoopBw * dtSec);
                const bandwidthStep = (target - drive) * alpha;
                const slewStep = spec.slewVPerUs * dtUs;
                const delta = clamp(bandwidthStep, -slewStep, slewStep);
                const next = clamp(drive + delta, low, high);
                cs.lastUpdateNs = tNs;
                const settled = Math.abs(target - next) <= spec.settledV
                    && Math.abs(residual) <= spec.settledV;
                cs.wakeNs = settled ? null : tNs + spec.tickNs;
                if (Math.abs(next - drive) <= U_TOL) continue;
                state.drives[`${ch}_out`] = { vTh: next, rTh: spec.rOut };
                changed = true;
            }
            const wakes = channels.map(ch => state._channels[ch].wakeNs).filter(Boolean);
            state._wakeNs = wakes.length ? wakes.reduce((a, b) => a < b ? a : b) : null;
            return changed;
        },
    });
}

export function registerAnalogAmps() {
    // Preserve LM358's historical implicit 5 V fallback for old benches that
    // omitted its supply wire; LM324 is new and requires its real shared rails.
    registerGroundSensingOpAmp('lm358', ['1', '2'], { legacyUnwiredFiveVoltSupply: true });
    registerGroundSensingOpAmp('lm324', ['1', '2', '3', '4']);
    registerPrecisionOpAmp('lm741', PRECISION_OP_AMPS.lm741);
    registerPrecisionOpAmp('lt1001', PRECISION_OP_AMPS.lt1001);
    registerPrecisionOpAmp('lt1006', PRECISION_OP_AMPS.lt1006);
    registerPrecisionMultiOpAmp('lt1014', LT1014_SPEC, ['1', '2', '3', '4'], [
        '1_out', '1_neg', '1_pos', 'vpos', '2_pos', '2_neg', '2_out',
        '3_out', '3_neg', '3_pos', 'vneg', '4_pos', '4_neg', '4_out',
    ]);
    // LTspice's official LT1014 symbols describe one five-terminal functional
    // unit and provide no package/channel identity. This hidden logical card
    // lets an importer preserve that channel without inventing a whole
    // 14-pin package. It is never a palette/face identity, and callers must
    // retain the source-model substitution blocker.
    registerPrecisionOpAmp('lt1014_channel', LT1014_SPEC);
    registerPrecisionMultiOpAmp('adtl082', ADTL082_SPEC, ['1', '2'], [
        '1_out', '1_neg', '1_pos', 'vneg', '2_pos', '2_neg', '2_out', 'vpos',
    ]);
    // The official LTspice symbol is one five-terminal functional amplifier,
    // not the whole SOIC-8 dual. Importers retain this package-neutral card
    // together with the ADI.lib/ADTL082 substitution blocker.
    registerPrecisionOpAmp('adtl082_channel', ADTL082_SPEC);
    registerPrecisionMultiOpAmp('lt1678', LT1678_SPEC, ['1', '2'], [
        '1_out', '1_neg', '1_pos', 'vneg', '2_pos', '2_neg', '2_out', 'vpos',
    ]);
    // The official LTspice symbol exposes one five-terminal functional
    // amplifier, not a selected channel or the complete SOIC-8 package. Keep
    // its package-neutral identity and proprietary-model blocker downstream.
    registerPrecisionOpAmp('lt1678_channel', LT1678_SPEC);
    registerPrecisionMultiOpAmp('op747', OP747_SPEC, ['1', '2', '3', '4'], [
        '1_neg', '1_pos', 'vpos', '2_pos', '2_neg', '2_out', '4_out',
        '4_neg', '4_pos', 'vneg', '3_pos', '3_neg', '3_out', '1_out',
    ]);
    // The official LTspice symbol is one five-terminal logical amplifier and
    // carries no channel or package identity. Importers retain this hidden card
    // together with the ADI.lib/OP747 substitution blocker.
    registerPrecisionOpAmp('op747_channel', OP747_SPEC);
    registerPrecisionOpAmp('op07', PRECISION_OP_AMPS.op07);
    registerPrecisionOpAmp('op27', PRECISION_OP_AMPS.op27);
    registerPrecisionOpAmp('lt1007', PRECISION_OP_AMPS.lt1007);
    // Official LTspice symbols are five-terminal logical amplifiers without
    // N8/S8 package identity. Keep that source contract separate from the
    // physical N8 device, and let importers retain the LTC.lib blocker.
    registerPrecisionOpAmp('lt1007_channel', Object.freeze({
        ...PRECISION_OP_AMPS.lt1007,
        terminals: ['inp', 'inn', 'vpos', 'vneg', 'out'],
    }));
    registerPrecisionOpAmp('ad711', PRECISION_OP_AMPS.ad711);
    // LTspice's official source symbol is one five-terminal logical channel
    // without package identity and delegates to AD712 in ADI1.lib. Importers
    // keep that substitution blocker; this card only supplies the electrical
    // terminal contract without lending it the physical N-8 face.
    registerPrecisionOpAmp('ad711_channel', Object.freeze({
        ...PRECISION_OP_AMPS.ad711,
        terminals: ['inp', 'inn', 'vpos', 'vneg', 'out'],
    }));

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
