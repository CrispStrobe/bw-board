// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {REFERENCE_TIMES_NS, windingReferenceDeck, parseReferenceWaveform, sampleReferenceWaveform,
    refinementReport, runWindingUicReference, referenceProcessOptions,
    MEASUREMENT_PRECISION, referenceIntervalMean} from '../scripts/diagnose-winding-uic-reference.mjs';

test('pure clipped raw-waveform mean integrates interior rows rather than held endpoints', () => {
    const rows = [{timeSec: 0, voltage: 0, current: 0},
        {timeSec: 1e-6, voltage: 2, current: 4}, {timeSec: 2e-6, voltage: 0, current: 0}];
    const mean = referenceIntervalMean(rows, 500, 1500);
    assert.ok(Math.abs(mean.voltage - 1.5) < 1e-14);
    assert.ok(Math.abs(mean.current - 3) < 1e-14);
    assert.throws(() => referenceIntervalMean(rows, 500, 500), /ordered/);
    assert.throws(() => referenceIntervalMean(rows, 500, 2500), /outside/);
    for (const times of [[1, 1], [2, 1], [1, NaN], [1, 1.5], Array(402).fill(1)]) {
        assert.throws(() => sampleReferenceWaveform(rows, times), /ordered/);
    }
});

test('pure held-endpoint reference integral mutant fails the clipped triangular caller', async () => {
    const original = readFileSync(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url), 'utf8');
    const anchor = 'mean[key] /= to - from';
    assert.equal(original.split(anchor).length - 1, 1);
    const source = original.replace(anchor, 'mean[key] = end[key]');
    const module = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    const rows = [{timeSec: 0, voltage: 0, current: 0},
        {timeSec: 1e-6, voltage: 2, current: 4}, {timeSec: 2e-6, voltage: 0, current: 0}];
    assert.throws(() => assert.ok(Math.abs(module.referenceIntervalMean(rows, 500, 1500).voltage - 1.5) < 1e-14),
        assert.AssertionError);
    assert.equal(readFileSync(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url), 'utf8'), original);
});

test('reference model cards, zero IC and UIC are independent explicit authorities', () => {
    const deck = windingReferenceDeck(25);
    assert.match(deck, /LW supply winding 5m IC=0/);
    assert.match(deck, /CP collector 0 12p IC=0/);
    assert.match(deck, /tran 0\.25n 1.011m 0 25n uic/);
    assert.match(windingReferenceDeck(100), /tran 1n 1.011m 0 100n uic/);
    assert.match(windingReferenceDeck(50), /tran 0\.5n 1.011m 0 50n uic/);
    assert.match(deck, /method=gear maxord=2 reltol=1e-9 abstol=1e-14 vntol=1e-11 trtol=1/);
    assert.match(deck, /set numdgt=15/);
    assert.match(deck, /let ref_voltage = v\(collector\)/);
    assert.match(deck, /let ref_current = i\(LW\)/);
    assert.match(deck, /set wr_singlescale\nset wr_vecnames\nwrdata reference.dat ref_voltage ref_current/);
    assert.doesNotMatch(deck, /meas | FIND |raw_v|raw_i/);
    assert.match(deck, /\.model QM NPN\(IS=1e-14 BF=100 BR=1 VAF=100\)/);
    assert.match(deck, /\.model DM D\(IS=1e-12 N=1 RS=\.568\)/);
    assert.doesNotMatch(windingReferenceDeck(25, false), /IC=0| uic/);
    assert.throws(() => windingReferenceDeck(24), /Unreviewed/);
});

test('missing, duplicate, failed and unstable reference evidence cannot pass', () => {
    const header = 'time ref_voltage ref_current\n';
    const zero = '0.000000000000000e+00 1.000000000000000e+00 2.000000000000000e-02';
    const end = '2.000000000000000e-03 3.000000000000000e+00 4.000000000000000e-02';
    const output = header + zero + '\n' + end;
    const waveform = parseReferenceWaveform(output);
    const rows = sampleReferenceWaveform(waveform);
    assert.equal(rows.length, 10);
    assert.ok(Math.abs(rows[0].voltage - (1 + 1000 * 25e-9)) < 1e-15);
    assert.equal(rows[0].bracket.left.raw, zero);
    assert.equal(rows[0].bracket.right.raw, end);
    // Interpolation itself creates extra digits from rounded inputs. It must
    // not be mistaken for evidence that the stored waveform retained them.
    const roundedRows = sampleReferenceWaveform(parseReferenceWaveform(
        output.replace('2.000000000000000e-03', '2.003000000000000e-03')));
    assert.notEqual(roundedRows[0].voltage, Number(roundedRows[0].voltage.toPrecision(7)));
    assert.equal(roundedRows[0].bracket.left.voltage, Number(roundedRows[0].bracket.left.voltage.toPrecision(7)));
    assert.equal(roundedRows[0].bracket.right.voltage, Number(roundedRows[0].bracket.right.voltage.toPrecision(7)));
    assert.throws(() => parseReferenceWaveform(header + zero), /ordered/);
    assert.throws(() => parseReferenceWaveform(output + '\n' + end), /ordered/);
    assert.throws(() => parseReferenceWaveform(output.replace('1.000000000000000e+00', '1.000000e+00')), /precision/);
    assert.throws(() => parseReferenceWaveform(output.replace('ref_current', 'ref_voltage')), /authority/);
    assert.throws(() => parseReferenceWaveform(output, '', 'timestep too small'), /refused/);
    assert.throws(() => sampleReferenceWaveform([{timeSec: 1}, {timeSec: 2}]), /outside/);
    assert.equal(refinementReport([rows, rows, rows]).stable, true);
    const shifted = rows.map(row => ({...row, voltage: row.voltage + .001}));
    assert.equal(refinementReport([rows, rows, shifted]).stable, false);
    assert.throws(() => refinementReport([rows, rows]), /three complete/);
    const misaligned = rows.map(row => ({...row, timeNs: row.timeNs + 1}));
    assert.throws(() => refinementReport([rows, rows, misaligned]), /aligned/);
});

test('measurement precision is bound to the actual child process, not table formatting', () => {
    const previous = process.env.NGSPICE_MEAS_PRECISION;
    try {
        process.env.NGSPICE_MEAS_PRECISION = '5';
        const options = referenceProcessOptions('independent deck');
        assert.equal(options.env.NGSPICE_MEAS_PRECISION, '15');
        assert.equal(options.input, 'independent deck');
        assert.equal(MEASUREMENT_PRECISION, 15);
        // An ambient-precision mutant must fail this bound authority oracle.
        assert.notEqual({...options, env: {...process.env}}.env.NGSPICE_MEAS_PRECISION, '15');
        assert.equal(process.env.NGSPICE_MEAS_PRECISION, '5');
    } finally {
        if (previous === undefined) delete process.env.NGSPICE_MEAS_PRECISION;
        else process.env.NGSPICE_MEAS_PRECISION = previous;
    }
});

const ngspice = process.env.NGSPICE || 'ngspice';
// No availability probe or numerical child runs when selecting pure controls.
test('hosted live zero-storage reference meets fixed refinement bounds and rejects OP substitution', t => {
    if (spawnSync(ngspice, ['--version'], {encoding: 'utf8', timeout: 5000}).status !== 0) {
        t.skip('ngspice unavailable; CI oracle census requires the executable');
        return;
    }
    const report = runWindingUicReference(ngspice);
    assert.equal(report.measurementPrecision, 15);
    assert.equal(report.engineAgreement, 'not-tested');
    assert.equal(report.arms.length, 3);
    for (const arm of report.arms) {
        assert.equal(arm.zeroStorage, true);
        assert.equal(arm.startupStepNs, arm.maxStepNs / 100);
        assert.ok(Math.abs(arm.measurements[0].voltage) < .1, 'zero-storage early collector control');
        assert.ok(arm.waveformRows > 2);
        // Padding a rounded FIND result cannot satisfy these actual-value
        // negatives: this circuit's nontrivial values retain further digits.
        const retainsDigits = (measurement, key) => ['left', 'right'].some(side => {
            const stored = measurement.bracket[side][key];
            return stored !== Number(stored.toPrecision(7));
        });
        assert.ok(retainsDigits(arm.measurements[0], 'voltage'), 'stored startup voltage is not padded seven-digit FIND');
        assert.ok(retainsDigits(arm.measurements[1], 'current'), 'stored bias current is not padded seven-digit FIND');
    }
    assert.ok(report.normalOp.measurements[0].voltage > 4.9, 'normal OP is a different initial capacitor state');
    assert.notEqual(report.arms[2].deckSha256, report.normalOp.deckSha256);
    t.diagnostic(JSON.stringify(report));
    // Preserve actual evidence before refusing an insufficiently refined
    // reference. The acceptance bounds themselves have not been relaxed.
    assert.equal(report.refinement.stable, true, JSON.stringify(report.refinement));
});
