/**
 * THE rs-VERSUS-rd DIVERGENCE IS CLOSED. THIS FILE NOW HOLDS IT CLOSED, AND
 * MEASURES THE DIFFERENT THING THAT IS LEFT.
 *
 * What this file used to record: `rs` (exponential, SPICE's RS) defaulted to 2
 * while `rd` (piecewise dynamic resistance) was 10, and they are the same
 * physical quantity. While they differed, flipping JUNCTION_ROUTING did not
 * switch MODELS of one part -- it switched PARTS, and every accuracy number
 * measured across the toggle was partly a device swap.
 *
 * It is closed by giving the quantity ONE home: classDefaults in
 * src/parts-library.js. Both junctionOpts (exponential) and junctionRd
 * (piecewise) read that table, so they cannot drift per kind. The closing was
 * NOT a sweep -- a sweep elects whatever RS the reference device was built
 * with, an exact 0.04 % diagonal at RS = 5, 10, 25 and 40, because
 * shockleyParams algebraically reconstructs the device when rs matches. The
 * value came from the part.
 *
 * WHAT IS LEFT IS NOT THAT DEFECT. The two paths still disagree away from the
 * rated bias, and now the whole of that disagreement is the one thing it should
 * be: PIECEWISE IS A STRAIGHT LINE AND THE JUNCTION IS A LOGARITHM. With rs
 * == rd the series term is identical at every current, so the residue is pure
 * shape. It is a real modelling difference, not a bug, and it is why the
 * default stays PWL until the corpus flip (ROADMAP E1.3b). The ratchet below
 * tracks it so a REGRESSION in shape is still caught -- but it is not waiting
 * to reach zero, and it must not, because zero would mean the exponential path
 * had stopped being exponential.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JUNCTION_RD, junctionRd} from '../src/mna.js';
import {classDefaults} from '../src/parts-library.js';
import {BoardImpl} from '../src/board.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const chain = (vcc, r, params, kind = 'led') => {
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'R1', kind: 'resistor', params: {ohms: r}, terminals: ['a', 'b']},
        {id: 'D1', kind, params, terminals: ['anode', 'cathode']}];
    const nets = [
        {id: 'nv', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'R1', terminal: 'a'}]},
        {id: 'na', terminals: [{part: 'R1', terminal: 'b'}, {part: 'D1', terminal: 'anode'}]},
        {id: 'ng', terminals: [{part: 'GND', terminal: 'gnd'}, {part: 'D1', terminal: 'cathode'}]}];
    const b = new BoardImpl(vcc);
    b.setNetlist(parts, nets);
    return Math.abs(b.branchCurrent('D1', 'anode'));
};

test('CLOSED, AND HELD: rs and rd are one number for every junction kind', () => {
    // The assertion that makes the closing permanent. It reads the two paths'
    // OWN accessors rather than the table, so re-introducing a literal in
    // either path fails here even if classDefaults is untouched.
    const kinds = ['led', 'diode', 'zener'];
    for (const kind of kinds) {
        const rd = junctionRd({kind});
        const rs = classDefaults(kind).rs;
        assert.ok(rs !== undefined, `classDefaults(${kind}) lost its rs`);
        assert.equal(rd, rs,
            `${kind}: piecewise rd=${rd} but exponential rs=${rs}. While these differ the routing `
            + 'toggle switches DEVICES, not models, and every number measured across it is a swap.');
    }
    // ANTI-VACUITY: zener is the kind this check exists for. junctionRd used to
    // branch `kind === 'diode' ? SILICON_RD : JUNCTION_RD`, which is right for
    // led and diode and wrong for zener -- so a two-kind loop passed while the
    // split was live. Assert the third kind is genuinely in the loop and is
    // genuinely the silicon value, not the 10 the old else-branch gave.
    assert.equal(junctionRd({kind: 'zener'}), junctionRd({kind: 'diode'}),
        'a zener is silicon; it must not take the LED bulk resistance');
    assert.notEqual(junctionRd({kind: 'zener'}), JUNCTION_RD,
        'zener is back on the LED default -- the ternary has grown back');
});

test('the piecewise rd is still the single value this records', () => {
    const m = read('src/board.js').match(/const LED_RD\s*=\s*([\d.]+)/);
    assert.ok(m, 'board.js no longer declares LED_RD — re-point this record, do not delete it');
    assert.equal(Number(m[1]), JUNCTION_RD,
        `board.js LED_RD=${m[1]} but mna.js JUNCTION_RD=${JUNCTION_RD}; keep them in step`);
    const lits = [...read('src/mna.js').matchAll(/^\s*const rd\s*=\s*([\d.]+)\s*;/gm)].map(x => Number(x[1]));
    // ANTI-VACUITY: the literals are the subject; finding none means drift.
    assert.ok(lits.length >= 5, `only ${lits.length} \`const rd = <n>\` site(s) — the scan drifted`);
    assert.deepEqual(lits.filter(v => v !== JUNCTION_RD), [],
        'a junction rd literal has drifted away from the others, which splits the two paths for '
        + 'that device alone — the hardest version of this bug to find');
});

test('INVARIANT that holds at any rs: the rated bias gives exactly 20 mA', () => {
    // vf is DEFINED as the total drop at 20 mA, and 5 V through 150 Ω is that
    // bias, so the exponential path must land on 20.000 mA whatever rs is. This
    // is the one cross-rs claim, and it is what makes `vf` mean something.
    for (const kind of ['led', 'diode']) {
        const i = chain(5.0, 150, {vf: 2.0, model: 'shockley'}, kind);
        assert.ok(Math.abs(i - 0.020) < 1e-5,
            `${kind}: the rated bias must give 20.000 mA by construction, got ${(i * 1e3).toFixed(4)} mA`);
        // AND the piecewise path must agree there, which is the vf-convention
        // correction itself: before it, this read 18.7500 mA against 20.0000.
        const iPwl = chain(5.0, 150, {vf: 2.0, model: 'pwl'}, kind);
        assert.ok(Math.abs(iPwl - 0.020) < 1e-5,
            `${kind}: the piecewise path must also give 20.000 mA at the rated bias, got `
            + `${(iPwl * 1e3).toFixed(4)} mA — vf has stopped meaning the same thing in both paths`);
    }
});

// MEASURED 2026-09-13, after rs and rd were unified. LED, vf = 2.0, 5 V rail:
//
//       R      i_pwl mA    i_shk mA     gap %
//     100      29.09091    28.93469      0.537
//     150      20.00000    20.00000      0.000   <- the rated bias, by construction
//     220      13.91304    13.98541      0.520
//     470       6.66667     6.77165      1.575
//    1000       3.16832     3.25200      2.641
//    2200       1.44861     1.50247      3.718
//    4700       0.68062     0.71235      4.662
//   10000       0.32071     0.33864      5.591
//
// The shape of that column is the proof that nothing but shape is left: it is
// ZERO at the rated bias and grows monotonically as the current falls away from
// it, in BOTH directions. A residual rs/rd split would show as a gap that grows
// with CURRENT (an i*R term) and would be non-zero at 150 R; a residual vf
// split would show as a roughly constant offset. Neither is present.
const SHAPE_GAP = {rated: 150, worstR: 10000, worst: 0.05591};

test('the residue is pure shape: zero at the rated bias, monotone away from it', () => {
    const rows = [100, 150, 220, 470, 1000, 2200, 4700, 10000].map(r => {
        const iPwl = chain(5.0, r, {vf: 2.0, model: 'pwl'});
        const iShk = chain(5.0, r, {vf: 2.0, model: 'shockley'});
        assert.ok(iPwl > 0 && iShk > 0, `R=${r}: both paths must have produced a driven current`);
        return {r, gap: Math.abs(iShk - iPwl) / iPwl};
    });
    const at150 = rows.find(x => x.r === SHAPE_GAP.rated);
    assert.ok(at150.gap < 1e-6,
        `the two paths must agree EXACTLY at the rated bias, got ${(at150.gap * 100).toFixed(4)}% — `
        + 'a gap here is an rs/rd or vf split, not shape');
    // Monotone below the rated bias: less current, further from the anchor.
    const below = rows.filter(x => x.r > SHAPE_GAP.rated);
    for (let i = 1; i < below.length; i++) {
        assert.ok(below[i].gap > below[i - 1].gap,
            `gap must grow as current falls: R=${below[i].r} gives ${(below[i].gap * 100).toFixed(3)}% `
            + `but R=${below[i - 1].r} gave ${(below[i - 1].gap * 100).toFixed(3)}%`);
    }
    const worst = rows.reduce((a, b) => (b.gap > a.gap ? b : a));
    assert.equal(worst.r, SHAPE_GAP.worstR, `the worst gap moved to R=${worst.r}`);
    assert.ok(Math.abs(worst.gap - SHAPE_GAP.worst) < 5e-4,
        `the recorded piecewise-vs-exponential shape gap is ${(SHAPE_GAP.worst * 100).toFixed(3)}% at `
        + `R=${SHAPE_GAP.worstR}; measured ${(worst.gap * 100).toFixed(3)}%. This is a MODELLING `
        + 'difference, not a defect — re-derive and update the table above rather than widening this.');
    // And it must NOT be zero. A zero here would mean the exponential path had
    // stopped being exponential, which is the failure this whole lane exists to
    // avoid: an agreement bought by making both sides answer the same wrong way.
    assert.ok(worst.gap > 0.001,
        'the paths now agree everywhere, which means one of them stopped modelling what it models');
});
