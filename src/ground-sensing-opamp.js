// SPDX-License-Identifier: MIT
/**
 * LM358 / LM324 — a time-domain macromodel solved INSIDE the MNA Newton loop.
 *
 * WHY THIS REPLACED THE SETTLE-LOOP "AIMING" MODEL (2026-11-23)
 * -------------------------------------------------------------
 * The old device was a Thévenin drive (fixed 100 Ω) that re-aimed its output
 * after every solve (secant on the input error) and returned `changed = true`
 * whenever it moved. That made three faults:
 *
 *  1. Stall. Every accepted adaptive-transient step whose device pass reports
 *     a change is treated as a DISCONTINUITY (board.js `accept`: trapezoidal
 *     history restarts and h /= 4). A gain stage driven by an audio-rate
 *     source moves its aim on every step, so h collapsed to the floor on
 *     every step: 2 ms of a ×101 stage on a 1 kHz sine took ~2 s of wall
 *     time, 10 ms in a real bench well over 100 s.
 *  2. No time. Open loop it marched G_STEP·e per settle round — 75 mV per
 *     round at 50 mV overdrive — so a comparator's speed was a count of solve
 *     events, not a slew rate or a pole; after 1 ms it could still be
 *     mid-swing.
 *  3. A fixed 100 Ω output with no current limit and no supply-current path.
 *
 * THE MODEL
 * ---------
 * Per channel, a standard two-stage behavioural macromodel on one hidden
 * node ("pole", referenced to the GND pin):
 *
 *   input stage   I = Is·tanh(gm·(v+ − v−)/Is) into the pole node
 *                 (small-signal gm, large-signal current Is → slew = Is/C)
 *   pole          C and Rp from the pole node to GND: A0 = gm·Rp,
 *                 GBW = gm/(2πC)
 *   swing clamp   the pole is held inside the output-swing window
 *                 [GND + 5 mV, VCC − 1.5 V] by a smooth stiff clamp, so a
 *                 saturated comparator does not wind up kilovolts it must
 *                 later slew back from
 *   output stage  I_out = I_lim·tanh((v_pole − v_out)/(I_lim·R_out)),
 *                 asymmetric limits (source 40 mA, sink 25 mA), drawn from
 *                 VCC when sourcing and returned to GND when sinking
 *
 * Every element is either a linear primitive (the hidden capacitor and Rp)
 * or a pure `nonlinearCurrents` law with an exact Jacobian, so feedback is
 * solved by Newton in one solve, the pole's history is the solver's own
 * capacitor history (step-doubling and rejection included), and the device
 * never returns `changed` — nothing for the integrator to treat as an edge.
 *
 * Card: TI SLOS068 (LM358) typicals — 100 dB large-signal gain, 0.7–1.2 MHz
 * unity-gain bandwidth (LM358 / LM358B; 1 MHz used), 0.3 V/µs slew, output
 * high ≈ VCC − 1.5 V, output low ≈ 5 mV at light load, 40 mA source / 20 mA
 * (at VO = 2 V) sink. Quiescent supply current, input bias/offset, noise and
 * phase reversal are NOT modelled.
 *
 * POLE INTEGRATION. The hidden pole capacitor is integrated with backward
 * Euler (`integration: 'be'` on the capacitor), not the trapezoidal rule
 * the board uses for drawn parts. In saturation the pole rests against the
 * swing clamp, a 0.1 ns mode (G_CLAMP on cInt), and the trapezoidal rule
 * does not damp a mode that much faster than the step: the pole alternated
 * about the clamp by ~90 µV indefinitely, Newton lost convergence on that
 * alternation at any useful step, and a comparator whose input crept toward
 * its threshold cost ~350 attempts per simulated ms (lab-v-to-f: 163 s of
 * test time). Backward Euler damps it in one step and is exact for the
 * constant-current slew; the step-doubling controller still measures the
 * pole voltage, so a step is still refused when its error is not met.
 *
 * INITIAL CONDITION. The hidden pole capacitor is seeded from the bias point
 * of the bench at the instant the netlist is set (BoardImpl seeds it, the way
 * SPICE starts a transient from its operating point), so a static op-amp
 * stage reads its settled value at t = 0+ as the old model did. Drawn
 * capacitors keep the board's power-on-at-rest rule.
 *
 * @module
 */

export const GROUND_SENSING_OPAMP_CARD = Object.freeze({
    a0: 1e5,                // 100 dB large-signal voltage gain
    gbwHz: 1e6,             // unity-gain bandwidth
    slewVPerUs: 0.3,        // V/µs
    cInt: 1e-9,             // realization choice; gm/C and gm·Rp are invariant
    outLowHeadroom: 0.005,  // VOL at light load
    outHighHeadroom: 1.5,   // VOH ≈ VCC − 1.5 V
    inputHighHeadroom: 1.5, // common-mode range 0 … VCC − 1.5 V
    rOut: 50,               // small-signal output resistance of either stage
    iSource: 0.040,         // short-circuit source current
    iSink: 0.025,           // sink capability (20 mA typ at VO = 2 V)
    minSupply: 3.0,
});

const CARD = GROUND_SENSING_OPAMP_CARD;
const GM = 2 * Math.PI * CARD.gbwHz * CARD.cInt;
const R_POLE = CARD.a0 / GM;
const I_SLEW = CARD.slewVPerUs * 1e6 * CARD.cInt;
const G_CLAMP = 10;         // S — stiff: 0.3 mA of slew current overshoots the window by < 0.1 mV
const W_CLAMP = 1e-4;       // V — quadratic knee width of the swing clamp
const ENABLE_SPAN = 0.5;    // V — output enable ramps in over minSupply−0.5 … minSupply
const SPLIT_EPS = 1e-6;     // A — smoothing of the source/sink supply split

/** Package kinds served by this model, with their channel names. */
export const GROUND_SENSING_OPAMPS = Object.freeze([
    Object.freeze({ kind: 'lm358', channels: Object.freeze(['1', '2']), legacyUnwiredFiveVoltSupply: true }),
    Object.freeze({ kind: 'lm324', channels: Object.freeze(['1', '2', '3', '4']), legacyUnwiredFiveVoltSupply: false }),
]);

export const STAGE_KIND = 'ground_sensing_opamp_stage';
export const STAGE_TERMINALS = Object.freeze(['inp', 'inn', 'pole', 'out', 'vcc', 'gnd']);
const CONTROLS = STAGE_TERMINALS;

/** Smooth one-sided ramp: 0 below 0, quadratic knee, slope 1 beyond w. */
function knee(d) {
    if (d <= 0) return [0, 0];
    if (d < W_CLAMP) return [d * d / (2 * W_CLAMP), d / W_CLAMP];
    return [d - W_CLAMP / 2, 1];
}

/** Output-enable over the supply span, C1 smoothstep. */
function enable(supply, scale) {
    const lo = (CARD.minSupply - ENABLE_SPAN) * scale;
    const span = ENABLE_SPAN * scale;
    const x = (supply - lo) / span;
    if (x <= 0) return [0, 0];
    if (x >= 1) return [1, 0];
    return [x * x * (3 - 2 * x), 6 * x * (1 - x) / span];
}

/** Limited output current law and its slope with respect to the drive d. */
function outputLaw(d) {
    const iLim = d >= 0 ? CARD.iSource : CARD.iSink;
    const t = Math.tanh(d / (iLim * CARD.rOut));
    return [iLim * t, (1 - t * t) / CARD.rOut];
}

/**
 * Terminal currents (positive OUT of the device into each net) and their
 * Jacobian, for one channel. `v` holds terminal volts; `fixedVcc` (volts
 * above GND, already source-scaled) replaces an unwired VCC pin.
 */
export function evaluateStage(v, scale, fixedVcc = null) {
    const vg = v.gnd;
    const vc = fixedVcc === null ? v.vcc : vg + fixedVcc;
    const supply = vc - vg;

    // Input stage.
    const tIn = Math.tanh(GM * (v.inp - v.inn) / I_SLEW);
    const iIn = I_SLEW * tIn;
    const gIn = GM * (1 - tIn * tIn);

    // Swing window and clamp.
    const lo = vg + CARD.outLowHeadroom * scale;
    const hiRaw = vc - CARD.outHighHeadroom * scale;
    const hiFromVc = hiRaw > lo;
    const hi = hiFromVc ? hiRaw : lo;
    const [qh, qh1] = knee(v.pole - hi);
    const [ql, ql1] = knee(lo - v.pole);
    const iPole = iIn - G_CLAMP * qh + G_CLAMP * ql;

    // Output stage.
    const [k, k1] = enable(supply, scale);
    const [f, f1] = outputLaw(v.pole - v.out);
    const iOut = k * f;
    const root = Math.sqrt(iOut * iOut + SPLIT_EPS * SPLIT_EPS);
    const src = (iOut + root) / 2;          // drawn from VCC
    const snk = iOut - src;                 // ≤ 0: returned to GND
    const dSrc = (1 + iOut / root) / 2;     // d src / d iOut

    // Partials over the controls, in CONTROLS order. Plain arrays, then one
    // Map per row: this runs several times per Newton iteration.
    const fixed = fixedVcc !== null;
    const VC = fixed ? 5 : 4;   // the control index vc moves with
    const pole = [gIn, -gIn, -G_CLAMP * (qh1 + ql1), 0, 0, G_CLAMP * ql1];
    if (hiFromVc) pole[VC] += G_CLAMP * qh1; else pole[5] += G_CLAMP * qh1;
    const out = [0, 0, k * f1, -k * f1, 0, -k1 * f];
    out[VC] += k1 * f;
    const row = (values) => {
        const m = new Map();
        for (let i = 0; i < 6; i++) {
            if (values[i] !== 0 && !(fixed && i === 4)) m.set(CONTROLS[i], values[i]);
        }
        return m;
    };
    const gnd = new Array(6);
    const vccRow = new Array(6);
    for (let i = 0; i < 6; i++) {
        gnd[i] = -pole[i] - (1 - dSrc) * out[i];
        vccRow[i] = -dSrc * out[i];
    }
    const J = new Map([['pole', row(pole)], ['out', row(out)], ['gnd', row(gnd)]]);
    const currents = new Map([
        ['pole', iPole],
        ['out', iOut],
        ['gnd', -iPole - snk],
    ]);
    if (!fixed) {
        currents.set('vcc', -src);
        J.set('vcc', row(vccRow));
    }
    return { currents, jacobian: J, iOut };
}

// Residual currents are checked as volts across this resistance. The pole
// node is a ~16 MΩ node, so a residual judged at the 50 Ω output scale left
// up to ~0.3 µV of closed-loop output error; judge every row at 1 MΩ.
export const STAGE_RESIDUAL_OHMS = 1e6;
export const POLE_FARADS = CARD.cInt;
export const POLE_OHMS = R_POLE;

const hiddenPrefix = (part, ch) => `@${part.kind}:${part.id}:${ch}:`;
export const polePin = (ch) => `${ch}_pole`;
export const isHiddenPoleCapacitor = (id) => /^@lm3[25][48]:.*:cap$/.test(id);

/**
 * Solver-only expansion of every LM358/LM324 channel into: one hidden pole
 * net, one pole capacitor and one stage element. The caller's parts/nets are
 * not mutated. A channel whose output is unwired is skipped (it drives
 * nothing); an unwired input reads the reference, as the old model's
 * read() → 0 did; an unwired GND pin uses the reference net; an unwired VCC
 * is the LM358's historical implicit 5 V, and leaves an LM324 unpowered.
 *
 * @param {{kind: string, channels: string[], legacyUnwiredFiveVoltSupply: boolean}[]} kinds
 */
export function expandGroundSensingOpAmps(parts, nets, kinds = GROUND_SENSING_OPAMPS) {
    const byKind = new Map(kinds.map(k => [k.kind, k]));
    const selected = parts.filter(p => byKind.has(p.kind));
    if (!selected.length) return { parts, nets };
    const outNets = nets.map(n => ({ ...n, terminals: n.terminals.map(t => ({ ...t })) }));
    const outParts = [...parts];
    const gndKinds = new Set(parts.filter(p => p.kind === 'gnd').map(p => p.id));
    const reference = outNets.find(n => n.terminals.some(t => gndKinds.has(t.part))) ?? null;
    const netOf = (id, terminal) => outNets.find(n => n.terminals.some(t => t.part === id && t.terminal === terminal)) ?? null;
    for (const part of selected) {
        const { channels, legacyUnwiredFiveVoltSupply } = byKind.get(part.kind);
        const gndNet = netOf(part.id, 'gnd') ?? reference;
        const vccNet = netOf(part.id, 'vcc');
        if (!gndNet) continue;
        if (!vccNet && !legacyUnwiredFiveVoltSupply) continue;
        for (const ch of channels) {
            const outNet = netOf(part.id, `${ch}_out`);
            if (!outNet) continue;
            const prefix = hiddenPrefix(part, ch);
            const stageId = `${prefix}stage`, capId = `${prefix}cap`, rpId = `${prefix}rp`, poleNet = `${prefix}pole`;
            outParts.push(
                { id: stageId, kind: STAGE_KIND,
                    params: { fixedVcc: vccNet ? null : 5.0 },
                    terminals: [...STAGE_TERMINALS] },
                // Backward Euler: see POLE INTEGRATION above.
                { id: capId, kind: 'capacitor', params: { farads: POLE_FARADS, integration: 'be' }, terminals: ['a', 'b'] },
                { id: rpId, kind: 'resistor', params: { ohms: POLE_OHMS }, terminals: ['a', 'b'] },
            );
            const T = (p, terminal) => ({ part: p, terminal });
            for (const [pin, stageTerm] of [[`${ch}_pos`, 'inp'], [`${ch}_neg`, 'inn']]) {
                const n = netOf(part.id, pin) ?? reference ?? gndNet;
                n.terminals.push(T(stageId, stageTerm));
            }
            outNet.terminals.push(T(stageId, 'out'));
            if (vccNet) vccNet.terminals.push(T(stageId, 'vcc'));
            gndNet.terminals.push(T(stageId, 'gnd'), T(capId, 'b'), T(rpId, 'b'));
            outNets.push({ id: poleNet, terminals: [
                T(stageId, 'pole'), T(capId, 'a'), T(rpId, 'a'), T(part.id, polePin(ch)),
            ] });
        }
    }
    return { parts: outParts, nets: outNets };
}
