// SPDX-License-Identifier: MIT
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {EDGE_TIMES_NS} from '../scripts/diagnose-winding-uic-reference.mjs';
import {compareCurrentSamples, readCurrentSampleGrid, currentScopeExitCode,
    runWindingCurrentScope} from '../scripts/compare-winding-current-scope.mjs';

const limits = {maxAttempts: 20000, maxSolves: 60001, maxAdvances: 200};
const net = (id, ...pins) => ({id, terminals: pins.map(([part, terminal]) => ({part, terminal}))});
async function rig (rc = false, redundant = false) {
    const {BoardImpl} = await import('../src/board.js');
    const b = new BoardImpl(5); b.configureTransientAnalysis('precision-v1');
    const parts = [{id: 'V', kind: 'vsource', params: {volts: rc ? 8 : 5}, terminals: ['pos', 'neg']},
        {id: 'G', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'R', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']}];
    const nets = [net('in', ['V', 'pos'], ['R', 'a']), net('zero', ['V', 'neg'], ['G', 'gnd'])];
    if (rc) {
        parts.push({id: 'C', kind: 'capacitor', params: {farads: 1e-6}, terminals: ['a', 'b']});
        nets.push(net('out', ['R', 'b'], ['C', 'a'])); nets[1].terminals.push({part: 'C', terminal: 'b'});
    } else nets[1].terminals.push({part: 'R', terminal: 'b'});
    if (redundant === 'rail' || redundant === 'single-rail') {
        assert.equal(rc, false);
        parts[0] = {id: 'V', kind: 'vcc', params: {volts: 5}, terminals: ['vcc']};
        nets[0].terminals[0].terminal = 'vcc';
        nets[1].terminals = nets[1].terminals.filter(pin => pin.part !== 'V');
        if (redundant === 'rail') {
            parts.push({id: 'V2', kind: 'vcc', params: {volts: 5}, terminals: ['vcc']});
            nets[0].terminals.push({part: 'V2', terminal: 'vcc'});
        }
    } else if (redundant) {
        parts.push({id: 'V2', kind: 'vsource', params: {volts: 5}, terminals: ['pos', 'neg']});
        nets[0].terminals.push({part: 'V2', terminal: 'pos'}); nets[1].terminals.push({part: 'V2', terminal: 'neg'});
    }
    b.setNetlist(parts, nets); b.setPower(true); b.reset(); return b;
}
const attach = (b, extra = {}) => b.addScopeChannel({type: 'current', partId: 'R', terminal: 'a',
    currentClock: 'simulation', sampleRateHz: 1e6, depth: 8, ...extra});
const snapshot = value => ({converged: true, branchCurrents: new Map([['R', new Map([['a', value]])]])});

test('pure current grid/sign comparison rejects display, missing final point and unstable reference', () => {
    const data = {channelType: 'current', currentClock: 'simulation', capture: 'sample',
        startTNs: 1000025n, sampleIntervalNs: 25n, count: 400, writeIndex: 400,
        samples: new Float64Array(804).fill(-.02)};
    const reference = {arms: [100, 50, 25].map(maxStepNs => ({maxStepNs, startupStepNs: maxStepNs / 100,
        zeroStorage: true, measurements: EDGE_TIMES_NS.map(timeNs => ({timeNs, voltage: 5, current: .02}))}))};
    const samples = readCurrentSampleGrid(data);
    assert.equal(compareCurrentSamples(samples, reference).agreement, true);
    samples[399].current = .02;
    assert.equal(compareCurrentSamples(samples, reference).agreement, false);
    assert.equal(currentScopeExitCode({agreement: false}), 1);
    for (const edit of [{currentClock: undefined}, {count: 399}, {startTNs: 1000000n}]) {
        assert.throws(() => readCurrentSampleGrid({...data, ...edit}));
    }
    reference.arms[2].measurements[399].current += .001;
    assert.throws(() => compareCurrentSamples(samples, reference), /refinement/);
});

test('hosted default display acquisition remains unchanged beside opt-in simulation acquisition', async () => {
    const b = await rig(), display = b.addScopeChannel({type: 'current', partId: 'R', terminal: 'a', depth: 8});
    const sim = attach(b); b.advanceTo(10000n);
    assert.equal(b.getScopeData(display).count, 0);
    assert.equal(b.getScopeData(display).currentClock, undefined);
    assert.equal(b.getScopeData(sim).count, 10);
    for (let i = 0; i < 3; i++) {
        const result = b.sampleCurrentChannels(); assert.equal(result.has(sim), false);
        assert.ok(Math.abs(result.get(display) + .005) < 1e-12);
    }
    assert.equal(b.getScopeData(display).count, 3);
    assert.equal(b.getScopeData(sim).count, 10);
});

test('hosted previously closed-form passive DC current scope acquires without display or getter priming', async () => {
    const b = await rig(false, 'single-rail');
    assert.equal(b._mnaCache, null, 'baseline walker does not supply MNA branch currents');
    const handle = attach(b); b.advanceTo(2000n);
    const data = b.getScopeData(handle);
    assert.equal(data.count, 2); assert.equal(data.startTNs, 1000n);
    assert.ok(Math.abs(data.samples[0] + .005) < 1e-12);
    assert.ok(Math.abs(data.samples[2] + .005) < 1e-12);
});

test('hosted RC current standalone grid preserves analytical sign, wrap, reset and late attach', async () => {
    const b = await rig(true), handle = attach(b);
    b.advanceTo(12000n);
    const data = b.getScopeData(handle); assert.equal(data.count, 12);
    assert.equal(data.startTNs, 5000n); assert.equal(data.writeIndex, 4);
    for (let i = 0; i < 8; i++) {
        const seconds = (5000 + 1000 * i) * 1e-9, index = (data.writeIndex + i) % 8;
        assert.ok(Math.abs(data.samples[index * 2] + .008 * Math.exp(-seconds / .001)) < 1e-9);
    }
    assert.equal(b._nextSampleGridSec(12e-6), 13e-6);
    b.reset(); assert.equal(b.getScopeData(handle).count, 0);
    b.advanceTo(2000n); assert.equal(b.getScopeData(handle).startTNs, 1000n);
    const late = attach(b); b.advanceTo(4000n);
    assert.equal(b.getScopeData(late).startTNs, 3000n); assert.equal(b.getScopeData(late).count, 2);
});

test('hosted fractional accepted snapshot and discontinuity history never read a later cache', async () => {
    const b = await rig(), handle = attach(b);
    b._mnaCache = snapshot(999); // Deliberately different later-cache authority.
    b._updateScopeChannels(1000n, .99975e-6, snapshot(-.003999));
    assert.equal(b.getScopeData(handle).count, 0);
    b._updateScopeChannels(1000n, 1.00025e-6, snapshot(-.004001));
    assert.ok(Math.abs(b.getScopeData(handle).samples[0] + .004) < 1e-15);
    const edge = await rig(), channel = attach(edge);
    edge._updateScopeChannels(1000n, .99975e-6, snapshot(-.001));
    edge.timeNs = 1000n; edge._mnaCache = snapshot(-.005); edge._feedScopeVoltages();
    edge._updateScopeChannels(1000n, 1.00025e-6, snapshot(-.006));
    assert.equal(edge.getScopeData(channel).samples[0], -.005);
});

test('hosted invalid targets/cadence refuse before allocating any handle', async () => {
    const b = await rig();
    for (const extra of [{partId: 'missing'}, {terminal: 'missing'}, {currentClock: 'other'},
        {type: 'voltage'}, {sampleRateHz: 0}, {sampleRateHz: 2e9}, {sampleRateHz: NaN},
        {depth: 0}, {depth: 1.5}, {depth: 1000001}, {capture: 'envelope'}]) {
        const before = b.getScopeChannels(); assert.throws(() => attach(b, extra));
        assert.deepEqual(b.getScopeChannels(), before);
    }
});

test('hosted missing/nonfinite snapshots and redundant ideal-source currents fail closed', async () => {
    for (const value of [undefined, NaN, Infinity]) {
        const b = await rig(), handle = attach(b);
        b._updateScopeChannels(1000n, 1e-6, snapshot(value));
        assert.throws(() => b.getScopeData(handle), /unavailable/);
        b._updateScopeChannels(2000n, 2e-6, snapshot(-.005)); b.reset();
        assert.throws(() => b.getScopeData(handle), /unavailable/);
        assert.equal(b._scopeChannels.get(handle).count, 0);
    }
    const failed = await rig(), refused = attach(failed);
    failed._updateScopeChannels(1000n, 1e-6, {...snapshot(-.005), converged: false});
    assert.throws(() => failed.getScopeData(refused), /failed/);
    assert.equal(failed._scopeChannels.get(refused).count, 0);
    // Generic duplicate ideal-source rows are singular, not a supported rail
    // alias. Preserve that distinct physical failure rather than accepting
    // its error text as evidence of determinate-load/nonunique-source handling.
    const singular = await rig(false, true), singularSource = attach(singular, {partId: 'V', terminal: 'pos'});
    const singularLoad = attach(singular); singular.advanceTo(2000n);
    assert.throws(() => singular.getScopeData(singularSource), /solve failed/);
    assert.throws(() => singular.getScopeData(singularLoad), /solve failed/);
    const b = await rig(false, 'rail'), alias = attach(b, {partId: 'V', terminal: 'vcc'}), load = attach(b);
    b.advanceTo(2000n);
    assert.ok(Math.abs(b.branchCurrent('R', 'a') + .005) < 1e-12,
        'validated public load current remains determinate; cache persistence is not a contract');
    assert.throws(() => b.getScopeData(alias), /indeterminate/);
    assert.equal(b.getScopeData(load).count, 2);
    assert.ok(Math.abs(b.getScopeData(load).samples[0] + .005) < 1e-12);
});

test('hosted unpowered valid current channel retains zero convention', async () => {
    const b = await rig(), handle = attach(b); b.setPower(false); b.advanceTo(2000n);
    const data = b.getScopeData(handle); assert.equal(data.count, 2);
    assert.equal(data.samples[0], 0); assert.equal(data.samples[2], 0);
});

test('hosted whole-capture exhaustion invalidates current acquisition', async () => {
    const b = await rig(true), handle = attach(b);
    assert.throws(() => b.advanceToBounded(100000n, {...limits, maxAttempts: 1}), /work budget exceeded/);
    assert.equal(b.transientAnalysisStatus().boundedAdvance.completed, false);
    assert.throws(() => b.getScopeData(handle));
});

test('hosted actual snapshot/display/barrier mutants fail their caller contracts and restore prototypes', async () => {
    const {BoardImpl} = await import('../src/board.js');
    const saved = {sample: BoardImpl.prototype._scopeCurrentSample,
        display: BoardImpl.prototype.sampleCurrentChannels, grid: BoardImpl.prototype._nextSampleGridSec};
    try {
        BoardImpl.prototype._scopeCurrentSample = function (ch) { return this.branchCurrent(ch.partId, ch.terminal); };
        const stale = await rig(), ch = attach(stale); stale._mnaCache = snapshot(999);
        stale._updateScopeChannels(1000n, 1e-6, snapshot(-.004));
        assert.throws(() => assert.equal(stale.getScopeData(ch).samples[0], -.004), assert.AssertionError);
        BoardImpl.prototype._scopeCurrentSample = saved.sample;
        const body = saved.display.toString().replace("if (ch.currentClock === 'simulation') continue;", '');
        assert.notEqual(body, saved.display.toString());
        BoardImpl.prototype.sampleCurrentChannels = new Function(`return (${body.replace('sampleCurrentChannels()', 'function()')})`)();
        const b = await rig(), h = attach(b); b.advanceTo(2000n); b.sampleCurrentChannels();
        assert.throws(() => assert.equal(b.getScopeData(h).count, 2), assert.AssertionError);
        BoardImpl.prototype.sampleCurrentChannels = saved.display;
        BoardImpl.prototype._nextSampleGridSec = function () { return null; };
        const noGrid = await rig(); attach(noGrid);
        assert.throws(() => assert.equal(noGrid._nextSampleGridSec(0), 1e-6), assert.AssertionError);
    } finally {
        BoardImpl.prototype._scopeCurrentSample = saved.sample;
        BoardImpl.prototype.sampleCurrentChannels = saved.display;
        BoardImpl.prototype._nextSampleGridSec = saved.grid;
    }
});

test('hosted standalone winding current scope matches all400 independently refined SPICE samples', async t => {
    if (spawnSync(process.env.NGSPICE || 'ngspice', ['--version'], {encoding: 'utf8', timeout: 5000}).status !== 0) {
        t.skip('ngspice unavailable; mandatory CI census requires it'); return;
    }
    const report = await runWindingCurrentScope();
    const json = value => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? String(item) : item);
    t.diagnostic(json({record: 'winding-current-summary', schema: report.schema, agreement: report.agreement,
        failure: report.failure, engine: report.engine && {...report.engine, samples: undefined},
        refinement: report.reference.refinement.stable}));
    for (const row of report.comparisons || []) t.diagnostic(json({record: 'winding-current-comparison', ...row}));
    for (const arm of report.reference.arms) {
        const {measurements, ...metadata} = arm;
        t.diagnostic(json({record: 'winding-current-reference-arm', ...metadata}));
        for (const row of measurements) t.diagnostic(json({record: 'winding-current-reference-row',
            maxStepNs: arm.maxStepNs, ...row}));
    }
    assert.equal(report.agreement, true);
    assert.equal(report.engine.voltageChannels, 0);
    assert.equal(report.engine.receipt.completed, true);
    assert.deepEqual(report.engine.receipt.limits, limits);
    assert.deepEqual(report.engine.initialStorage, {capacitorVoltage: 0, inductorCurrent: 0});
});

test('pure current CLI failure exit cannot be mutated to success', async () => {
    const original = readFileSync(new URL('../scripts/compare-winding-current-scope.mjs', import.meta.url), 'utf8');
    const anchor = 'report.agreement === true ? 0 : 1'; assert.equal(original.split(anchor).length - 1, 1);
    const source = original.replace(anchor, '0').replaceAll("'./diagnose-winding-uic-reference.mjs'",
        JSON.stringify(new URL('../scripts/diagnose-winding-uic-reference.mjs', import.meta.url).href));
    const mutant = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
    assert.throws(() => assert.equal(mutant.currentScopeExitCode({agreement: false}), 1), assert.AssertionError);
    assert.equal(readFileSync(new URL('../scripts/compare-winding-current-scope.mjs', import.meta.url), 'utf8'), original);
});
