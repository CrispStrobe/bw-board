// SPDX-License-Identifier: MIT
/**
 * Depletion-mode dual-gate N-channel MOSFET (a MOS tetrode): `dual_gate_mosfet`,
 * pins drain / gate2 / gate1 / source.
 *
 * THE DEVICE. One n-channel between source and drain with TWO gates over it,
 * one after the other: gate 1 over the half next to the source, gate 2 over
 * the half next to the drain. Physically the two halves share one diffused
 * island in the middle, so the device is two MOSFETs in series — the lower
 * one's drain is the upper one's source. That is not an approximation chosen
 * for convenience: it is how the part is built, and it is how the RF
 * dual-gate MOSFETs are modelled in SPICE (a cascode of two single-gate cards
 * on an internal node). Either gate can therefore pinch the channel off on its
 * own; gate 2, held at a few volts above the source, is the classic gain
 * control of an RF stage, and with gate 2 tied high the device is an ordinary
 * single-gate MOSFET controlled by gate 1.
 *
 * DEPLETION MODE. The channel is already there at zero gate voltage (built
 * in by doping), so the device conducts with its gates at the source
 * potential and needs a NEGATIVE gate-source voltage, below the pinch-off
 * voltage, to stop conducting. In the level-1 law that is simply a negative
 * threshold: Id = K·(Vgs − Vp)² in saturation with Vp < 0, so the
 * zero-gate drain current is Idss = K·Vp².
 *
 * WHY TWO SOLVER NMOS AND NOT A NEW LAW. Each half obeys the ordinary
 * level-1 law, including its symmetric reverse operation (Vds < 0 swaps the
 * roles of drain and source), which is what makes the channel usable as a
 * voltage-controlled resistor for AC signals around 0 V. The engine's `nmos`
 * stamp already carries that law, its triode/saturation regions, its gate
 * capacitance and its Newton limiting; a second copy of the law would be a
 * second truth. So the drawn part stays exactly as the learner wired it and
 * the SOLVER VIEW gets two hidden `nmos` (`<id>_g1`: gate1, mid → source;
 * `<id>_g2`: gate2, drain → mid) on a hidden middle node, the drawn part's own
 * `mid` terminal there so its device model can read it.
 *
 * WHAT IS LEFT OUT, SAID PLAINLY. The bulk of a real dual-gate MOSFET is tied
 * to the source, so the upper half sits above its bulk and its threshold rises
 * a little with the middle node (body effect); the default card has no body
 * effect (gamma 0). The gate-protection diodes of commercial parts are not
 * modelled: a gate driven far beyond its rating is not refused.
 *
 * PARAMS (all optional): vp (pinch-off voltage of both halves, default
 * −1.2 V), vp1 / vp2 (per half), k (A/V², default 5 mA/V² per half, so one
 * half alone has Idss = 7.2 mA), k1 / k2, lambda (channel-length modulation,
 * 1/V, default 0.02).
 *
 * @module
 */

export const DUAL_GATE_KIND = 'dual_gate_mosfet';
export const DUAL_GATE_TERMINALS = Object.freeze(['drain', 'gate2', 'gate1', 'source']);
/** The hidden middle node's terminal on the drawn part (solver view only). */
export const DUAL_GATE_MID = 'mid';

export const DUAL_GATE_DEFAULTS = Object.freeze({ vp: -1.2, k: 5e-3, lambda: 0.02 });

const num = (v, d) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? d : Number(v));

/** The two halves' level-1 cards: {g1: {vth, k, lambda}, g2: {…}}. */
export function dualGateCard(part) {
    const P = part?.params ?? {};
    const D = DUAL_GATE_DEFAULTS;
    const vp = num(P.vp, D.vp);
    const k = Math.max(1e-9, num(P.k, D.k));
    const lambda = Math.max(0, num(P.lambda, D.lambda));
    return {
        g1: { vth: num(P.vp1, vp), k: Math.max(1e-9, num(P.k1, k)), lambda },
        g2: { vth: num(P.vp2, vp), k: Math.max(1e-9, num(P.k2, k)), lambda },
    };
}

/**
 * Solver-only expansion: every dual-gate MOSFET becomes two series `nmos` on a
 * hidden middle node. The caller's parts and nets are not mutated; a part
 * with its drain or source in the air is left alone (no channel, no current).
 * An unwired gate gets a net of its own, so its half sees a defined (ground-
 * referenced, through the solver's GMIN) gate rather than no gate at all.
 */
export function expandDualGateMosfets(parts, nets) {
    const selected = parts.filter((p) => p.kind === DUAL_GATE_KIND);
    if (!selected.length) return { parts, nets };
    const present = new Set(parts.map((p) => p.id));
    const outParts = [...parts];
    const outNets = nets.map((n) => ({ ...n, terminals: [...n.terminals] }));
    const netOf = (id, t) => outNets.find((n) => n.terminals.some((x) => x.part === id && x.terminal === t));
    for (const p of selected) {
        if (present.has(`${p.id}_g1`)) continue;   // already expanded: idempotent
        const drain = netOf(p.id, 'drain');
        const source = netOf(p.id, 'source');
        if (!drain || !source || drain === source) continue;
        const gate = (t) => {
            let n = netOf(p.id, t);
            if (!n) {
                n = { id: `n_${p.id}_${t}`, terminals: [{ part: p.id, terminal: t }] };
                outNets.push(n);
            }
            return n;
        };
        const g1 = gate('gate1');
        const g2 = gate('gate2');
        const mid = { id: `n_${p.id}_${DUAL_GATE_MID}`, terminals: [{ part: p.id, terminal: DUAL_GATE_MID }] };
        outNets.push(mid);
        const card = dualGateCard(p);
        const add = (id, params, ng, nd, ns) => {
            outParts.push({ id, kind: 'nmos', params: { ...params }, terminals: ['gate', 'drain', 'source'] });
            ng.terminals.push({ part: id, terminal: 'gate' });
            nd.terminals.push({ part: id, terminal: 'drain' });
            ns.terminals.push({ part: id, terminal: 'source' });
        };
        add(`${p.id}_g1`, card.g1, g1, mid, source);
        add(`${p.id}_g2`, card.g2, g2, drain, mid);
    }
    return { parts: outParts, nets: outNets };
}
