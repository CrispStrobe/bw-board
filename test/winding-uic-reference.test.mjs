// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {REFERENCE_TIMES_NS, windingReferenceDeck, parseReferenceMeasurements,
    refinementReport, runWindingUicReference} from '../scripts/diagnose-winding-uic-reference.mjs';

test('reference model cards, zero IC and UIC are independent explicit authorities', () => {
    const deck = windingReferenceDeck(25);
    assert.match(deck, /LW supply winding 5m IC=0/);
    assert.match(deck, /CP collector 0 12p IC=0/);
    assert.match(deck, /tran 25n 1.011m 0 25n uic/);
    assert.match(deck, /\.model QM NPN\(IS=1e-14 BF=100 BR=1 VAF=100\)/);
    assert.match(deck, /\.model DM D\(IS=1e-12 N=1 RS=\.568\)/);
    assert.doesNotMatch(windingReferenceDeck(25, false), /IC=0| uic/);
    assert.throws(() => windingReferenceDeck(24), /Unreviewed/);
});

test('missing, duplicate, failed and unstable reference evidence cannot pass', () => {
    const output = REFERENCE_TIMES_NS.map((_, i) => `v${i} = 1\ni${i} = 0.02`).join('\n');
    const rows = parseReferenceMeasurements(output);
    assert.equal(rows.length, 10);
    assert.throws(() => parseReferenceMeasurements(output.replace('v0 = 1', '')), /v0/);
    assert.throws(() => parseReferenceMeasurements(output + '\nv0 = 1'), /v0/);
    assert.throws(() => parseReferenceMeasurements(output, 'timestep too small'), /refused/);
    assert.equal(refinementReport([rows, rows, rows]).stable, true);
    const shifted = rows.map(row => ({...row, voltage: row.voltage + .001}));
    assert.equal(refinementReport([rows, rows, shifted]).stable, false);
    assert.throws(() => refinementReport([rows, rows]), /three complete/);
    const misaligned = rows.map(row => ({...row, timeNs: row.timeNs + 1}));
    assert.throws(() => refinementReport([rows, rows, misaligned]), /aligned/);
});

const ngspice = process.env.NGSPICE || 'ngspice';
// No availability probe or numerical child runs when selecting pure controls.
test('hosted live zero-storage reference characterizes refinement and rejects OP substitution', t => {
    if (spawnSync(ngspice, ['--version'], {encoding: 'utf8', timeout: 5000}).status !== 0) {
        t.skip('ngspice unavailable; CI oracle census requires the executable');
        return;
    }
    const report = runWindingUicReference(ngspice);
    assert.equal(report.engineAgreement, 'not-tested');
    assert.equal(report.arms.length, 3);
    for (const arm of report.arms) {
        assert.equal(arm.zeroStorage, true);
        assert.ok(Math.abs(arm.measurements[0].voltage) < .1, 'zero-storage early collector control');
    }
    assert.ok(report.normalOp.measurements[0].voltage > 4.9, 'normal OP is a different initial capacitor state');
    assert.notEqual(report.arms[2].deckSha256, report.normalOp.deckSha256);
    // An unstable reference is recorded as such, not forced into a golden.
    assert.equal(typeof report.refinement.stable, 'boolean');
    t.diagnostic(JSON.stringify(report));
});
