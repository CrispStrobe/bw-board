/**
 * THE EARLY EFFECT: ONE MODEL PARAMETER, 59 CORPUS DECKS.
 *
 * ADI2005 v2 had 101 real numeric disagreements against ngspice, and 81 of them
 * sat on a BJT node. All 59 of the base-node ones were one circuit family, "BJT
 * Emitter Follower", with one model card:
 *
 *     .MODEL Q2N2222 NPN (IS=1e-14 BF=200 VAF=100 IKF=0.3 RC=0.3
 *                         CJC=8p CJE=25p TF=0.5n)
 *     V1 VCC 0 DC 5.0 / RB1 VCC BASE 22Meg / RE1 EMIT 0 12k
 *     Q1 VCC BASE EMIT Q2N2222 / .op
 *
 *     ngspice V(BASE) 1.022540      before 1.006830      delta 15.7 mV
 *
 * VAF WAS THE WHOLE OF IT, established by removal rather than by argument:
 * deleting VAF from the card made the two engines agree, while deleting IKF
 * (a 0.3 A knee against a 35 uA emitter current) or RC (0.3 Ohm carrying
 * nothing) left the same 15.7 mV. The capacitances cannot matter at `.op`.
 *
 * WHAT THIS SUITE HOLDS, in the order the tests appear:
 *
 *   1. A card WITHOUT VAF is bit-identical to the tree before the term existed
 *      -- not "close", the same digits. The expected numbers below were read
 *      off commit 4dc3426, which has no Early term at all, and any of them
 *      moving means the default stopped being free.
 *   2. VAF=100 moves V(BASE) to within 0.25 mV of ngspice, from 15.7 mV out.
 *      This is the separating state: without it a test of this feature passes
 *      on an implementation that does nothing.
 *   3. The base current is NOT scaled by the factor. Early raises Ic at a fixed
 *      Ib, which is the same statement as beta rising with Vce; an
 *      implementation that scales Ib too cancels most of the effect and still
 *      looks like the feature.
 *   4. The Jacobian entries are the derivatives of the current actually
 *      stamped, by finite difference. A chain-rule term left out of gcR is
 *      invisible in every converged voltage and costs only iterations, so
 *      nothing else in this file can see it.
 *   5. VAF=0 and a negative VAF mean "no Early effect", as in SPICE, rather
 *      than a division by zero or a sign inversion.
 *   6. SATURATION, where Vbc > 0 and the factor drops BELOW one. Every other
 *      test here is forward-active, so a sign error that only shows up on the
 *      other side of Vbc = 0 would have no holder. This is also ROADMAP E3.2's
 *      "saturated transistor" case.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { JUNCTION_ROUTING, ebersMollCompanion } from '../src/mna.js';

registerAllDevices();

/** The corpus family's topology: collector on the rail, 22 MOhm base feed. */
function follower(params) {
    const prior = JUNCTION_ROUTING.mode;
    JUNCTION_ROUTING.mode = 'shockley';
    try {
        const b = new BoardImpl(5);
        b.setNetlist([
            { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'RB1', kind: 'resistor', params: { ohms: 22e6 }, terminals: ['a', 'b'] },
            { id: 'RE1', kind: 'resistor', params: { ohms: 12e3 }, terminals: ['a', 'b'] },
            { id: 'Q1', kind: 'npn', params, terminals: ['base', 'collector', 'emitter'] },
        ], [
            { id: 'n_v', terminals: [
                { part: 'VCC1', terminal: 'vcc' },
                { part: 'RB1', terminal: 'a' },
                { part: 'Q1', terminal: 'collector' },
            ] },
            { id: 'n_b', terminals: [{ part: 'RB1', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
            { id: 'n_e', terminals: [{ part: 'Q1', terminal: 'emitter' }, { part: 'RE1', terminal: 'a' }] },
            { id: 'n_g', terminals: [{ part: 'GND1', terminal: 'gnd' }, { part: 'RE1', terminal: 'b' }] },
        ]);
        return {
            vb: b.nodeVoltage('n_b'),
            ve: b.nodeVoltage('n_e'),
            ib: b.branchCurrent('Q1', 'base'),
            ic: b.branchCurrent('Q1', 'collector'),
            converged: b._lastSolveConverged,
        };
    } finally {
        JUNCTION_ROUTING.mode = prior;
    }
}

const CARD = { part: '2N2222', beta: 200, is: 1e-14, model: 'shockley' };

/** Read off 4dc3426, the commit before the Early term existed. */
const BEFORE = { vb: 1.006829645, ve: 0.437804967, ib: -1.815077434e-7 };
const NGSPICE_VB = 1.022540;

test('a card without VAF is BIT-IDENTICAL to the tree before the term existed', () => {
    const r = follower({ ...CARD });
    assert.equal(r.converged, true, 'the solve did not converge, so nothing here is a reading');
    // Nine digits, and deliberately not a tolerance: the claim is that the
    // default costs nothing, and a tolerance cannot tell "unchanged" from
    // "changed by less than the tolerance".
    assert.equal(r.vb.toFixed(9), BEFORE.vb.toFixed(9), `V(base) ${r.vb} against 4dc3426's ${BEFORE.vb}`);
    assert.equal(r.ve.toFixed(9), BEFORE.ve.toFixed(9));
    assert.equal(r.ib.toExponential(9), BEFORE.ib.toExponential(9));
});

test('VAF=100 closes the 15.7 mV gap to ngspice', () => {
    const r = follower({ ...CARD, vaf: 100 });
    assert.equal(r.converged, true);
    const before = Math.abs(BEFORE.vb - NGSPICE_VB);
    const after = Math.abs(r.vb - NGSPICE_VB);
    assert.ok(before > 1.5e-2, `the gap this feature closes must be real: ${before}`);
    assert.ok(after < 5e-4,
        `V(base) ${r.vb} must sit within 0.5 mV of ngspice ${NGSPICE_VB}, was ${after} out`);
    // The direction matters as much as the size. Early effect RAISES Ic, which
    // raises the emitter and the base with it; a sign error would land the same
    // distance on the wrong side and this test would still be within 20 mV.
    assert.ok(r.vb > BEFORE.vb, `V(base) must RISE: ${BEFORE.vb} -> ${r.vb}`);
    assert.ok(after < before / 30, `the gap must shrink by more than 30x: ${before} -> ${after}`);
});

test('the factor is on the transport current and NOT on the base current', () => {
    // Same bias point, two cards. Ib is a junction recombination current and
    // must be untouched; Ic must move by exactly the Early factor.
    const p = { is: 1e-14, nVt: 0.025852, bf: 200, br: 1 };
    const vbe = 0.65;
    const vbc = -4.0;
    const plain = ebersMollCompanion(vbe, vbc, p);
    const early = ebersMollCompanion(vbe, vbc, { ...p, vaf: 100 });
    assert.equal(early.ib, plain.ib, 'Ib may not move');
    assert.equal(early.gpi, plain.gpi, 'd Ib / d Vbe may not move');
    assert.equal(early.gmu, plain.gmu, 'd Ib / d Vbc may not move');
    const factor = 1 - vbc / 100;
    assert.ok(Math.abs(early.ic / plain.ic - factor) < 1e-6,
        `Ic must scale by ${factor}, scaled by ${early.ic / plain.ic}`);
    // And an omitted `vaf` is the same object as an infinite one, because an
    // exported function can be handed a params bag assembled by hand.
    assert.deepEqual(ebersMollCompanion(vbe, vbc, { ...p, vaf: Infinity }), plain);
});

test('IKF uses SPICE forward base charge and its own exact Jacobian', () => {
    // Bias and terminal currents are from the independent ngspice 42
    // high-current operating-point witness in npn-operating-point.test.mjs.
    const p = { is: 1e-14, nVt: 0.02585, bf: 200, br: 1, vaf: 100, ikf: 0.01 };
    const vbe = 0.7761044166980251;
    const vbc = -7.843419750002912;
    const at = ebersMollCompanion(vbe, vbc, p);
    assert.ok(Math.abs(at.ib - 5.469643173914041e-4) < 1e-15);
    assert.ok(Math.abs(at.ic - 3.0681874447563224e-2) < 1e-14);

    // High-current rolloff reduces transported collector current at the same
    // junction/base current. Applying the charge factor to Ib would preserve
    // beta and defeat the parameter's meaning.
    const noRolloff = ebersMollCompanion(vbe, vbc, { ...p, ikf: Infinity });
    assert.equal(at.ib, noRolloff.ib, 'IKF may not scale base current');
    assert.equal(at.gpi, noRolloff.gpi, 'IKF may not scale dIb/dVbe');
    assert.ok(at.ic < noRolloff.ic / 3, 'the high-current witness must exercise real rolloff');
    assert.deepEqual(noRolloff,
        ebersMollCompanion(vbe, vbc, { is: p.is, nVt: p.nVt, bf: p.bf, br: p.br, vaf: p.vaf }),
        'omitted IKF must retain the prior arithmetic exactly');

    const h = 1e-7;
    const dIcDbe = (ebersMollCompanion(vbe + h, vbc, p).ic
      - ebersMollCompanion(vbe - h, vbc, p).ic) / (2 * h);
    const dIcDbc = (ebersMollCompanion(vbe, vbc + h, p).ic
      - ebersMollCompanion(vbe, vbc - h, p).ic) / (2 * h);
    const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
    assert.ok(rel(at.gcF, dIcDbe) < 1e-8, `gcF ${at.gcF} vs ${dIcDbe}`);
    assert.ok(rel(at.gcR, dIcDbc) < 1e-7, `gcR ${at.gcR} vs ${dIcDbc}`);
});

test('the stamped Jacobian is the derivative of the stamped current', () => {
    // The only test here that can see a missing chain-rule term: `gcR` carries
    // the Early factor's OWN derivative times the transport current, and a
    // converged solution is identical without it.
    const p = { is: 1e-14, nVt: 0.025852, bf: 200, br: 1, vaf: 100 };
    const h = 1e-6;
    for (const [vbe, vbc] of [[0.65, -4.0], [0.70, -1.0], [0.75, -0.2], [0.60, -12.0]]) {
        const at = ebersMollCompanion(vbe, vbc, p);
        const dIc_dVbe = (ebersMollCompanion(vbe + h, vbc, p).ic - ebersMollCompanion(vbe - h, vbc, p).ic) / (2 * h);
        const dIc_dVbc = (ebersMollCompanion(vbe, vbc + h, p).ic - ebersMollCompanion(vbe, vbc - h, p).ic) / (2 * h);
        const dIb_dVbe = (ebersMollCompanion(vbe + h, vbc, p).ib - ebersMollCompanion(vbe - h, vbc, p).ib) / (2 * h);
        const rel = (a, b) => Math.abs(a - b) / Math.max(Math.abs(b), 1e-12);
        assert.ok(rel(at.gcF, dIc_dVbe) < 1e-5, `gcF ${at.gcF} vs finite difference ${dIc_dVbe} at ${vbe}/${vbc}`);
        assert.ok(rel(at.gcR, dIc_dVbc) < 1e-4, `gcR ${at.gcR} vs finite difference ${dIc_dVbc} at ${vbe}/${vbc}`);
        assert.ok(rel(at.gpi, dIb_dVbe) < 1e-5, `gpi ${at.gpi} vs finite difference ${dIb_dVbe} at ${vbe}/${vbc}`);
    }
});

test('VAF=0 and a negative VAF mean no Early effect, as they do in SPICE', () => {
    // A zero here would be a division by zero and a negative would invert the
    // sign of the effect, so both fall back to Infinity at the card rather than
    // in a branch further down where only one caller would be covered.
    for (const vaf of [0, -5, -1e9]) {
        const r = follower({ ...CARD, vaf });
        assert.equal(r.converged, true, `VAF=${vaf} did not converge`);
        assert.equal(r.vb.toFixed(9), BEFORE.vb.toFixed(9), `VAF=${vaf} must solve as no VAF at all`);
    }
    // NaN is not a number a card should carry, and it must not poison the solve
    // either -- the guard is `> 0`, which NaN fails.
    const r = follower({ ...CARD, vaf: NaN });
    assert.equal(r.converged, true);
    assert.equal(r.vb.toFixed(9), BEFORE.vb.toFixed(9));
});

/** The saturated motor-driver bench from `bjt-ebers-moll`, with a VAF on it. */
function saturatedBench(params) {
    const prior = JUNCTION_ROUTING.mode;
    JUNCTION_ROUTING.mode = 'shockley';
    try {
        const b = new BoardImpl(5);
        b.setNetlist([
            { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'VB', kind: 'vsource', params: { volts: 4.898 }, terminals: ['pos', 'neg'] },
            { id: 'RM', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
            { id: 'RB', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'Q1', kind: 'npn', params, terminals: ['base', 'collector', 'emitter'] },
        ], [
            { id: 'n_v', terminals: [{ part: 'VCC1', terminal: 'vcc' }, { part: 'RM', terminal: 'a' }] },
            { id: 'n_c', terminals: [{ part: 'RM', terminal: 'b' }, { part: 'Q1', terminal: 'collector' }] },
            { id: 'n_bs', terminals: [{ part: 'VB', terminal: 'pos' }, { part: 'RB', terminal: 'a' }] },
            { id: 'n_b', terminals: [{ part: 'RB', terminal: 'b' }, { part: 'Q1', terminal: 'base' }] },
            { id: 'n_g', terminals: [
                { part: 'GND1', terminal: 'gnd' },
                { part: 'Q1', terminal: 'emitter' },
                { part: 'VB', terminal: 'neg' },
            ] },
        ]);
        return {
            vc: b.nodeVoltage('n_c'),
            ic: b.branchCurrent('Q1', 'collector'),
            converged: b._lastSolveConverged,
        };
    } finally {
        JUNCTION_ROUTING.mode = prior;
    }
}

test('in SATURATION the factor goes below one, and the solve still converges', () => {
    // Every other test here is forward-active, where Vbc < 0 and the factor is
    // above 1. Saturation is the other sign: Vbc > 0, so `early` < 1 and Ic is
    // REDUCED. A sign error that this file's forward-active tests would catch
    // is not the same as one that only shows up here, and an unclamped factor
    // is worth exercising at a VAF small enough to matter -- which is also the
    // roadmap's "saturated transistor" case for E3.2.
    const CARD_SAT = { part: '2N2222', beta: 200, is: 1e-14, model: 'shockley' };
    const plain = saturatedBench({ ...CARD_SAT });
    assert.equal(plain.converged, true);
    let previousVc = plain.vc;
    for (const vaf of [100, 10, 1]) {
        const r = saturatedBench({ ...CARD_SAT, vaf });
        assert.equal(r.converged, true, `VAF=${vaf} did not converge in saturation`);
        // Less collector current through a fixed 10 Ohm load means a HIGHER
        // collector voltage, monotonically as VAF falls.
        assert.ok(r.vc > previousVc,
            `V(collector) must rise as VAF falls: ${previousVc} then ${r.vc} at VAF=${vaf}`);
        assert.ok(Math.abs(r.ic) < Math.abs(plain.ic),
            `|Ic| must be below the no-VAF ${plain.ic}, was ${r.ic} at VAF=${vaf}`);
        previousVc = r.vc;
    }
    // And the bench is genuinely saturated, or the sign of Vbc above is a guess.
    assert.ok(plain.vc < 0.4, `V(collector) ${plain.vc} is not a saturated collector`);
});
