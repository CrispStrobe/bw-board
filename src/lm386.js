// SPDX-License-Identifier: MIT
/**
 * LM386 low-voltage audio power amplifier: a macromodel solved INSIDE the MNA
 * Newton loop, in the style of the LM358 macromodel (ground-sensing-opamp.js).
 *
 * PACKAGE (PDIP-8, top view): 1 GAIN, 2 −IN, 3 +IN, 4 GND, 5 VOUT, 6 VS,
 * 7 BYPASS, 8 GAIN. Terminals: gain1, inn, inp, gnd, vout, vs, bypass, gain8.
 *
 * THE MODEL follows the datasheet's equivalent schematic rather than an
 * op-amp with an assumed gain, so the gain pins work the way they do on the
 * chip — anything wired across pins 1 and 8 (or from 5 to 1) changes the gain
 * through the same internal resistors:
 *
 *   inputs      50 kΩ from +IN and from −IN to GND (the input resistance of
 *               the PNP followers; an unwired input therefore reads 0 V)
 *   emitters    E1 (pin 1) follows +IN, X (internal) follows −IN, each held
 *               by a stiff, current-limited follower whose current is the
 *               input pair's signal current
 *   gain net    RG between pins 1 and 8, RE from pin 8 to X, RF from VOUT
 *               to pin 1 (feedback)
 *   bias        RB from VS to BYPASS (pin 7) and RB from BYPASS to X: with
 *               RF = RB the output sits at the BYPASS voltage, Vs/2
 *   balance     the second stage drives its pole until the two emitter
 *               currents match: I(E1) = I(X)
 *
 * Balancing gives  vout = Vs/2 + (1 + 2·RF / Z(1–8 network)) · (v+ − v−),
 * so the datasheet's ×20 with pins 1/8 open and ×200 with a capacitor across
 * them fix RE and RF (RG = 1.35 kΩ is the datasheet value): RE = 142.5 Ω,
 * RF = RB = 14.18 kΩ. (The datasheet's "150 Ω / 15 kΩ, Av = 2·RF/R" is the
 * same network with the emitter-follower "+1" term rounded away.) A resistor
 * in series with the capacitor across 1–8 sets any gain between; an RC from
 * pin 5 to pin 1 parallels RF (the datasheet's bass boost).
 *
 * SECOND STAGE AND OUTPUT, as the LM358 model: transconductance into a hidden
 * pole node (C and Rp to GND: A0, GBW, slew current), the pole held inside a
 * swing window [GND + 0.9 V, VS − 0.9 V] by a smooth stiff clamp, then a
 * current-limited output stage (±0.5 A, 0.25 Ω) drawn from VS when sourcing
 * and returned to GND when sinking. The bias network and a 3.8 mA quiescent
 * current make the supply current ≈ 4 mA at 6 V (datasheet 4 mA typ), and
 * everything turns on between 3.5 V and 4 V of supply (spec: 4–12 V).
 *
 * Card: TI SNAS545 (LM386) typicals — 26 dB / 46 dB gain, 300 kHz bandwidth
 * at gain 20, 50 kΩ input resistance, 4 mA quiescent at 6 V, 325 mW (6 V,
 * 8 Ω) and 700 mW (9 V, 8 Ω) output: the swing window gives ≈ 3.5 V peak into
 * 8 Ω at 9 V. NOT modelled: distortion, noise, supply rejection beyond what
 * the BYPASS network gives, thermal shutdown.
 *
 * Every element is a linear primitive (hidden resistors, the pole capacitor)
 * or a pure `nonlinearCurrents` law with an exact Jacobian, so the amplifier
 * is solved by Newton in one solve, the pole's history is the solver's own
 * capacitor history, and the device never reports a discrete change.
 *
 * @module
 */

export const LM386_CARD = Object.freeze({
    rIn: 50e3,          // input resistance, each input to GND
    rG: 1350,           // pins 1–8 (datasheet)
    rE: 142.5,          // pin 8 to the −IN emitter
    rF: 14178.75,       // VOUT to pin 1 (feedback); RB equals it
    a0: 1e4,            // second-stage DC gain (loop gain on the balance)
    gbwHz: 300e3,       // closed-loop bandwidth (datasheet: 300 kHz at gain 20)
    slewVPerUs: 1,      // V/µs
    cInt: 1e-9,         // realization choice
    gFollow: 1,         // S — emitter follower stiffness
    iFollow: 0.005,     // A — input-pair current limit
    outLowHeadroom: 0.9,
    outHighHeadroom: 0.9,
    rOut: 0.25,
    iLimit: 0.5,        // A, source and sink
    iQuiescent: 0.0038, // A, plus the bias network (≈ 4 mA at 6 V)
    minSupply: 4.0,
});

const C = LM386_CARD;
const GM = 2 * Math.PI * C.gbwHz * C.cInt;
const R_POLE = C.a0 / GM;
const I_SLEW = C.slewVPerUs * 1e6 * C.cInt;
const R_T = C.rF;           // balance current → error volts: loop gain = A0
const G_CLAMP = 10;
const W_CLAMP = 1e-4;
const ENABLE_SPAN = 0.5;
const SPLIT_EPS = 1e-6;

export const LM386_TERMINALS = Object.freeze(['gain1', 'inn', 'inp', 'gnd', 'vout', 'vs', 'bypass', 'gain8']);
export const LM386_STAGE_KIND = 'lm386_stage';
export const LM386_STAGE_TERMINALS = Object.freeze(['inp', 'inn', 'e1', 'x', 'pole', 'vout', 'vs', 'gnd']);
export const LM386_POLE_PIN = 'pole';
export const LM386_RESIDUAL_OHMS = 1e6;

function knee(d) {
    if (d <= 0) return [0, 0];
    if (d < W_CLAMP) return [d * d / (2 * W_CLAMP), d / W_CLAMP];
    return [d - W_CLAMP / 2, 1];
}

function enable(supply, scale) {
    const lo = (C.minSupply - ENABLE_SPAN) * scale;
    const span = ENABLE_SPAN * scale;
    const x = (supply - lo) / span;
    if (x <= 0) return [0, 0];
    if (x >= 1) return [1, 0];
    return [x * x * (3 - 2 * x), 6 * x * (1 - x) / span];
}

const T = LM386_STAGE_TERMINALS;
const NT = T.length;
const [I_INP, I_INN, I_E1, I_X, I_POLE, I_VOUT, I_VS, I_GND] = [0, 1, 2, 3, 4, 5, 6, 7];
const SCRATCH = new Float64Array(6 * NT);

/**
 * Terminal currents (positive OUT of the stage into each net) and Jacobian.
 * @param {Record<string, number>} v terminal volts
 * @param {number} scale source-stepping scale
 */
export function evaluateLm386Stage(v, scale = 1) {
    // Rows live in one scratch buffer (this runs several times per Newton
    // iteration); only the Maps handed back are allocated per call.
    const n = NT;
    const J = SCRATCH;
    J.fill(0);
    const F1 = 0, F2 = n, P = 2 * n, O = 3 * n, S = 4 * n, G = 5 * n;

    // Emitter followers: E1 <- +IN, X <- -IN.
    const t1 = Math.tanh(C.gFollow * (v.inp - v.e1) / C.iFollow);
    const iF1 = C.iFollow * t1;
    const g1 = C.gFollow * (1 - t1 * t1);
    const t2 = Math.tanh(C.gFollow * (v.inn - v.x) / C.iFollow);
    const iF2 = C.iFollow * t2;
    const g2 = C.gFollow * (1 - t2 * t2);
    J[F1 + I_INP] = g1; J[F1 + I_E1] = -g1;
    J[F2 + I_INN] = g2; J[F2 + I_X] = -g2;

    // Balance error: the followers SINK what the networks push into their
    // nodes, so iF1 - iF2 < 0 means more current into E1 (output too high).
    const ev = R_T * (iF1 - iF2);
    const tp = Math.tanh(GM * ev / I_SLEW);
    const gp = GM * (1 - tp * tp) * R_T;
    J[P + I_INP] = gp * g1; J[P + I_E1] = -gp * g1;
    J[P + I_INN] = -gp * g2; J[P + I_X] = gp * g2;
    let iPole = I_SLEW * tp;

    // Swing window on the pole.
    const lo = v.gnd + C.outLowHeadroom * scale;
    const hiRaw = v.vs - C.outHighHeadroom * scale;
    const hiFromVs = hiRaw > lo;
    const hi = hiFromVs ? hiRaw : lo;
    const [qh, qh1] = knee(v.pole - hi);
    const [ql, ql1] = knee(lo - v.pole);
    iPole += -G_CLAMP * qh + G_CLAMP * ql;
    J[P + I_POLE] += -G_CLAMP * (qh1 + ql1);
    J[P + (hiFromVs ? I_VS : I_GND)] += G_CLAMP * qh1;
    J[P + I_GND] += G_CLAMP * ql1;

    // Output stage, enabled by the supply.
    const [k, k1] = enable(v.vs - v.gnd, scale);
    const tl = Math.tanh((v.pole - v.vout) / (C.iLimit * C.rOut));
    const f = C.iLimit * tl;
    const f1 = (1 - tl * tl) / C.rOut;
    const iOut = k * f;
    J[O + I_POLE] = k * f1; J[O + I_VOUT] = -k * f1;
    J[O + I_VS] += k1 * f; J[O + I_GND] -= k1 * f;

    // Supply: the sourced part of the output current and the quiescent
    // current come out of VS.
    const root = Math.sqrt(iOut * iOut + SPLIT_EPS * SPLIT_EPS);
    const src = (iOut + root) / 2;
    const dSrc = (1 + iOut / root) / 2;
    const iq = C.iQuiescent * scale * k;
    for (let i = 0; i < n; i++) J[S + i] = -dSrc * J[O + i];
    J[S + I_VS] -= C.iQuiescent * scale * k1;
    J[S + I_GND] += C.iQuiescent * scale * k1;
    const iVs = -src - iq;

    // GND closes KCL.
    const iGnd = -(iF1 + iF2 + iPole + iOut + iVs);
    for (let i = 0; i < n; i++) J[G + i] = -(J[F1 + i] + J[F2 + i] + J[P + i] + J[O + i] + J[S + i]);

    const row = (base) => {
        const m = new Map();
        for (let i = 0; i < n; i++) if (J[base + i] !== 0) m.set(T[i], J[base + i]);
        return m;
    };
    return {
        currents: new Map([['e1', iF1], ['x', iF2], ['pole', iPole], ['vout', iOut], ['vs', iVs], ['gnd', iGnd]]),
        jacobian: new Map([['e1', row(F1)], ['x', row(F2)], ['pole', row(P)],
            ['vout', row(O)], ['vs', row(S)], ['gnd', row(G)]]),
        iOut,
        iSupply: -iVs,
    };
}

export const LM386_POLE_FARADS = C.cInt;
export const LM386_POLE_OHMS = R_POLE;
const prefix = (part) => `@lm386:${part.id}:`;
export const isLm386PoleCapacitor = (id) => /^@lm386:.*:cap$/.test(id);

/**
 * Solver-only expansion of every `lm386` into its hidden network (see the
 * module note). The caller's parts/nets are not mutated. An LM386 with no VS
 * connection is unpowered and left as drawn; an unwired GND uses the
 * reference net; unwired inputs, gain pins, BYPASS and VOUT get hidden nets.
 */
export function expandLm386(parts, nets) {
    const selected = parts.filter(p => p.kind === 'lm386');
    if (!selected.length) return { parts, nets };
    const outNets = nets.map(n => ({ ...n, terminals: n.terminals.map(t => ({ ...t })) }));
    const outParts = [...parts];
    const gndIds = new Set(parts.filter(p => p.kind === 'gnd').map(p => p.id));
    const reference = outNets.find(n => n.terminals.some(t => gndIds.has(t.part))) ?? null;
    const netOf = (id, terminal) => outNets.find(n => n.terminals.some(t => t.part === id && t.terminal === terminal)) ?? null;
    const TT = (part, terminal) => ({ part, terminal });
    for (const part of selected) {
        const vs = netOf(part.id, 'vs');
        const gnd = netOf(part.id, 'gnd') ?? reference;
        if (!vs || !gnd) continue;
        const pre = prefix(part);
        const pin = (terminal) => {
            let n = netOf(part.id, terminal);
            if (!n) { n = { id: `${pre}${terminal}`, terminals: [TT(part.id, terminal)] }; outNets.push(n); }
            return n;
        };
        const inp = pin('inp'), inn = pin('inn'), e1 = pin('gain1'), g8 = pin('gain8');
        const byp = pin('bypass'), vout = pin('vout');
        const x = { id: `${pre}x`, terminals: [] };
        const pole = { id: `${pre}pole`, terminals: [TT(part.id, LM386_POLE_PIN)] };
        outNets.push(x, pole);
        const R = (name, ohms, a, b) => {
            const id = `${pre}${name}`;
            outParts.push({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
            a.terminals.push(TT(id, 'a'));
            b.terminals.push(TT(id, 'b'));
        };
        R('rinp', C.rIn, inp, gnd);
        R('rinn', C.rIn, inn, gnd);
        R('rg', C.rG, e1, g8);
        R('re', C.rE, g8, x);
        R('rf', C.rF, vout, e1);
        R('rbt', C.rF, vs, byp);
        R('rbx', C.rF, byp, x);
        R('rp', R_POLE, pole, gnd);
        const capId = `${pre}cap`;
        outParts.push({ id: capId, kind: 'capacitor', params: { farads: C.cInt }, terminals: ['a', 'b'] });
        pole.terminals.push(TT(capId, 'a'));
        gnd.terminals.push(TT(capId, 'b'));
        const stageId = `${pre}stage`;
        outParts.push({ id: stageId, kind: LM386_STAGE_KIND, params: {}, terminals: [...LM386_STAGE_TERMINALS] });
        for (const [n, t] of [[inp, 'inp'], [inn, 'inn'], [e1, 'e1'], [x, 'x'], [pole, 'pole'],
            [vout, 'vout'], [vs, 'vs'], [gnd, 'gnd']]) n.terminals.push(TT(stageId, t));
    }
    return { parts: outParts, nets: outNets };
}
