/**
 * THE TWO JUNCTION PATHS DESCRIBE DIFFERENT DEVICES, AND THIS RECORDS IT.
 *
 * `rs` (exponential, SPICE's RS) and `rd` (piecewise dynamic resistance) are the
 * same physical quantity. `rs` defaults to 2; `rd` is 10 (board.js LED_RD, and
 * `const rd = 10` in seven places in mna.js). While they differ, flipping
 * JUNCTION_ROUTING does not switch MODELS of one part — it switches PARTS, and
 * every accuracy number measured across the toggle is partly a device swap.
 *
 * WHY THIS IS A RECORD AND NOT A FIX. Setting rs to JUNCTION_RD in isolation was
 * tried and MEASURED: the bw-board suite goes 8 -> 17 failures. It moves away
 * from expectations calibrated to the piecewise path without the knee correction
 * that would justify them, and `rs` is shared with `kind === 'diode'` while our
 * own reference part is `D1N4148 D(IS=2.52e-9 RS=0.568 N=1.752)` — 10 is 17x its
 * real bulk resistance. The correct change is coupled: rd and rs must become
 * per-kind AND equal, and the piecewise knee must become `vf - 0.020*rd`, in one
 * move across all eleven readers, or nodeVoltage and branchCurrent disagree.
 *
 * The `2` itself was never measured against a device. It minimised error against
 * test/golden/oracles.json, which is compute_oracles.py emitting the piecewise
 * formula — fitting the exponential to the answer being corrected.
 *
 * This file exists so the divergence cannot be forgotten or rediscovered, and so
 * that closing it is a deliberate act that has to come here and delete a test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JUNCTION_RD} from '../src/mna.js';
import {BoardImpl} from '../src/board.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const chain = (vcc, r, params) => {
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'R1', kind: 'resistor', params: {ohms: r}, terminals: ['a', 'b']},
        {id: 'D1', kind: 'led', params, terminals: ['anode', 'cathode']}];
    const nets = [
        {id: 'nv', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'R1', terminal: 'a'}]},
        {id: 'na', terminals: [{part: 'R1', terminal: 'b'}, {part: 'D1', terminal: 'anode'}]},
        {id: 'ng', terminals: [{part: 'GND', terminal: 'gnd'}, {part: 'D1', terminal: 'cathode'}]}];
    const b = new BoardImpl(vcc);
    b.setNetlist(parts, nets);
    return Math.abs(b.branchCurrent('D1', 'anode'));
};

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
        const parts = [
            {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
            {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
            {id: 'R1', kind: 'resistor', params: {ohms: 150}, terminals: ['a', 'b']},
            {id: 'D1', kind, params: {vf: 2.0, model: 'shockley'}, terminals: ['anode', 'cathode']}];
        const nets = [
            {id: 'nv', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'R1', terminal: 'a'}]},
            {id: 'na', terminals: [{part: 'R1', terminal: 'b'}, {part: 'D1', terminal: 'anode'}]},
            {id: 'ng', terminals: [{part: 'GND', terminal: 'gnd'}, {part: 'D1', terminal: 'cathode'}]}];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        const i = Math.abs(b.branchCurrent('D1', 'anode'));
        assert.ok(Math.abs(i - 0.020) < 1e-5,
            `${kind}: the rated bias must give 20.000 mA by construction, got ${(i * 1e3).toFixed(4)} mA`);
        // AND the piecewise path must agree there, which is the vf-convention
        // correction itself: before it, this read 18.7500 mA against 20.0000.
        const iPwl = chain(5.0, 150, {vf: 2.0, model: 'pwl'});
        assert.ok(Math.abs(iPwl - 0.020) < 1e-5,
            `the piecewise path must also give 20.000 mA at the rated bias, got `
            + `${(iPwl * 1e3).toFixed(4)} mA — vf has stopped meaning the same thing in both paths`);
    }
});

// MEASURED 2026-09-12, AFTER the vf-convention correction. There were TWO
// divergences between the paths and they close separately:
//
//   the vf CONVENTION  -- piecewise read vf as the knee, exponential as the
//                         total drop at the rated current. CLOSED: both paths
//                         now give exactly 20.000 mA at the rated bias, which
//                         is asserted above and is not a ratchet.
//   rs versus rd       -- 2 against 10, the same physical quantity. STILL OPEN,
//                         and it is what the remaining spread is made of:
//                         6.67% at the rated bias before, 1.83% worst now.
//
// This ratchet tracks the SECOND one only, away from the rated bias where the
// first one used to hide it. It may only fall. Closing it means giving rs and
// rd one value per kind — and note that a sweep cannot choose that value: it
// elects whatever RS the reference device was built with (an exact diagonal at
// RS = 5, 10, 25, 40), because shockleyParams reconstructs the device when rs
// matches. Pick it from the part, not from a fit.
const PATH_GAP_OFF_RATED = 0.0183;

test('RATCHET: the rs-versus-rd half, away from the rated bias', () => {
    let worst = 0, worstR = 0;
    for (const r of [100, 220, 470, 1000, 2200]) {
        const iPwl = chain(5.0, r, {vf: 2.0, model: 'pwl'});
        const iShk = chain(5.0, r, {vf: 2.0, model: 'shockley'});
        assert.ok(iPwl > 0 && iShk > 0, `R=${r}: both paths must have produced a driven current`);
        const gap = Math.abs(iShk - iPwl) / iPwl;
        if (gap > worst) { worst = gap; worstR = r; }
    }
    assert.ok(worst <= PATH_GAP_OFF_RATED + 1e-4,
        `the two paths now disagree by ${(worst * 100).toFixed(2)}% at R=${worstR}, worse than the `
        + `recorded ${(PATH_GAP_OFF_RATED * 100).toFixed(2)}%. They model one device; this may only fall.`);
    assert.ok(worst > 0,
        'the paths agree everywhere, so rs and rd have been reconciled — delete this file and the '
        + 'JUNCTION_RD note rather than leaving a passing test that describes a fixed defect');
});
