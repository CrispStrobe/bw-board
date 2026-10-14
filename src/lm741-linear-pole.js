// SPDX-License-Identifier: MIT
// Shared nominal card. The legacy controller and explicit linear pole must
// not acquire independent copies of gain, impedance or bandwidth authority.
export const LM741_CARD = Object.freeze({
    a0: 200000, gbwHz: 1e6, slewVPerUs: .5, inputR: 2e6, rOut: 600,
    tickNs: 300n, settledV: 1e-6, minSupply: 10, commonHeadroom: 3,
    outputHeadroom: 2, defaultOffsetV: .001,
});
const CINT = 30e-12; // Internal realization choice; gm/C and gm*Rp are invariant.
const POLE_PIN = '__linear_pole';
const fail = (part, detail) => {throw new Error(`LM741 ${part.id} linear-pole: ${detail}`);};

export function lm741LinearParameters(part) {
    if (part.kind !== 'lm741' || part.params?.transientModel === undefined) return null;
    const p = part.params;
    if (p.transientModel !== 'linear-pole') fail(part, 'unsupported transientModel');
    if (Object.keys(p).some(key => !['transientModel', 'supplyPositiveV', 'supplyNegativeV', 'inputOffsetV'].includes(key))) {
        fail(part, 'unsupported parameter');
    }
    if (p.inputOffsetV !== 0 || !Object.hasOwn(p, 'inputOffsetV')) fail(part, 'explicit zero inputOffsetV required');
    if (!Number.isFinite(p.supplyPositiveV) || !Number.isFinite(p.supplyNegativeV)
        || p.supplyPositiveV - p.supplyNegativeV < LM741_CARD.minSupply
        || p.supplyPositiveV - p.supplyNegativeV > 36) fail(part, 'fixed 10–36 V supply span required');
    return p;
}

export function assertLm741LinearTopology(part, ctx) {
    const p = lm741LinearParameters(part);
    if (!p) return;
    const topology = ctx.topology;
    if (!topology.referenceNet || topology.powerOff) fail(part, 'powered reference net required');
    for (const pin of ['inp', 'inn', 'out', 'vpos', 'vneg', POLE_PIN]) {
        if (!ctx.netFor(pin)) fail(part, `connected ${pin} required`);
    }
    for (const pin of ['offset_1', 'offset_5', 'nc']) {
        if (ctx.netFor(pin)) fail(part, `open ${pin} required`);
    }
    for (const [pin, expected] of [['vpos', p.supplyPositiveV], ['vneg', p.supplyNegativeV]]) {
        const net = topology.net(ctx.netFor(pin));
        if (!net || net.extraSources.length) fail(part, `fixed ideal ${pin} source required`);
        const sources = net.terminals.filter(t => t.kind === 'vsource');
        if (sources.length !== 1) fail(part, `single fixed ideal ${pin} source required`);
        const source = sources[0], e = source.electrical;
        const other = source.terminal === 'pos' ? 'neg' : 'pos';
        const sign = source.terminal === 'pos' ? 1 : -1;
        if (source.connections[other] !== topology.referenceNet || e.controlPresent
            || (e.wave !== undefined && e.wave !== 'dc')
            || (e.rInternal !== undefined && e.rInternal !== 0)
            || e.iLimit !== undefined || e.ccClampPresent
            || !Number.isFinite(e.effectiveVolts) || Math.abs(sign * e.effectiveVolts - expected) > 1e-12) {
            fail(part, `fixed ideal ${pin} source does not match declared supply`);
        }
    }
}

export function assertLm741LinearSolution(part, read) {
    const p = lm741LinearParameters(part);
    if (!p) return;
    const vp = read('vpos'), vn = read('vneg'), inp = read('inp'), inn = read('inn');
    const out = read('out'), pole = read(POLE_PIN);
    if (![vp, vn, inp, inn, out, pole].every(Number.isFinite)) fail(part, 'finite solved voltages required');
    if (Math.abs(vp-p.supplyPositiveV) > 1e-7 || Math.abs(vn-p.supplyNegativeV) > 1e-7) {
        fail(part, 'solved supplies do not match declared fixed rails');
    }
    if ([inp, inn].some(v => v < vn+LM741_CARD.commonHeadroom || v > vp-LM741_CARD.commonHeadroom)) {
        fail(part, 'input common-mode outside linear envelope');
    }
    if ([out, pole].some(v => v < vn+LM741_CARD.outputHeadroom || v > vp-LM741_CARD.outputHeadroom)) {
        fail(part, 'output swing outside linear envelope');
    }
    const derivative = 2*Math.PI*LM741_CARD.gbwHz*(inp-inn-pole/LM741_CARD.a0);
    if (Math.abs(derivative) > LM741_CARD.slewVPerUs*1e6*(1+1e-8)) fail(part, 'slew outside linear envelope');
    // This is a conservative admission boundary, not an invented LM741
    // short-circuit limit or a claim of physical load-current qualification.
    if (Math.abs((pole-out)/LM741_CARD.rOut) > .001) fail(part, 'output load exceeds 1 mA linear envelope');
}

/** Solver-only expansion; caller topology and package identity remain intact. */
export function expandLm741LinearPoles(parts, nets) {
    const selected = parts.filter(part => lm741LinearParameters(part));
    if (!selected.length) return {parts, nets};
    const references = nets.filter(n => n.terminals.some(t => parts.some(p => p.id === t.part && p.kind === 'gnd')));
    if (references.length !== 1) fail(selected[0], 'one explicit reference net required');
    const outNets = nets.map(n => ({...n, terminals: n.terminals.map(t => ({...t}))}));
    const outParts = [...parts], ids = new Set(parts.map(p => p.id)), netIds = new Set(nets.map(n => n.id));
    const reference = outNets.find(n => n.id === references[0].id);
    for (const part of selected) {
        const pins = Object.fromEntries(['inp', 'inn', 'out', 'vpos', 'vneg'].map(pin =>
            [pin, outNets.find(n => n.terminals.some(t => t.part === part.id && t.terminal === pin))]));
        for (const [pin, net] of Object.entries(pins)) if (!net) fail(part, `connected ${pin} required`);
        for (const pin of ['offset_1', 'offset_5', 'nc', POLE_PIN]) {
            if (outNets.some(n => n.terminals.some(t => t.part === part.id && t.terminal === pin))) fail(part, `open ${pin} required`);
        }
        const prefix = `@lm741:${part.id}:`, pole = `${prefix}pole`, drive = `${prefix}drive`;
        const named = Object.fromEntries(['gm', 'cap', 'rp', 'buffer', 'rout'].map(s => [s, `${prefix}${s}`]));
        if (Object.values(named).some(id => ids.has(id)) || [pole, drive].some(id => netIds.has(id))) {
            fail(part, 'hidden identity collision');
        }
        Object.values(named).forEach(id => ids.add(id)); [pole, drive].forEach(id => netIds.add(id));
        const gm = 2*Math.PI*LM741_CARD.gbwHz*CINT;
        outParts.push(
            {id: named.gm, kind: 'vccs', params: {gm}, terminals: ['outp','outn','inp','inn']},
            {id: named.cap, kind: 'capacitor', params: {farads:CINT}, terminals: ['a','b']},
            {id: named.rp, kind: 'resistor', params: {ohms:LM741_CARD.a0/gm}, terminals: ['a','b']},
            {id: named.buffer, kind: 'vcvs', params: {gain:1}, terminals: ['outp','outn','inp','inn']},
            {id: named.rout, kind: 'resistor', params: {ohms:LM741_CARD.rOut}, terminals: ['a','b']},
        );
        const t = (part, terminal) => ({part,terminal});
        pins.inp.terminals.push(t(named.gm,'inp')); pins.inn.terminals.push(t(named.gm,'inn'));
        pins.out.terminals.push(t(named.rout,'b'));
        reference.terminals.push(t(named.gm,'outn'),t(named.cap,'b'),t(named.rp,'b'),t(named.buffer,'inn'),t(named.buffer,'outn'));
        outNets.push({id:pole,terminals:[t(named.gm,'outp'),t(named.cap,'a'),t(named.rp,'a'),t(named.buffer,'inp'),t(part.id,POLE_PIN)]},
            {id:drive,terminals:[t(named.buffer,'outp'),t(named.rout,'a')]});
    }
    return {parts:outParts,nets:outNets};
}
