import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { solveMNA } from '../src/mna.js';
import { BoardImpl } from '../src/board.js';
import { registerDevice } from '../src/devices.js';

const current = (result, part, terminal) =>
  result.branchCurrents.get(part)?.get(terminal) ?? 0;

function instrumentBench({ parallel = false, volts = 1, otherVolts = volts } = {}) {
  const parts = [
    { id: 'A', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    ...(parallel ? [{ id: 'B', kind: 'vsource', params: { volts: otherVolts }, terminals: ['pos', 'neg'] }] : []),
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const sources = parts.filter(p => p.kind === 'vsource');
  return { parts, nets: [
    { id: 'live', terminals: [...sources.map(p => ({ part: p.id, terminal: 'pos' })), { part: 'R', terminal: 'a' }] },
    { id: 'ground', terminals: [...sources.map(p => ({ part: p.id, terminal: 'neg' })), { part: 'R', terminal: 'b' }, { part: 'G', terminal: 'gnd' }] },
  ] };
}
const instrumentBoard = opts => {
  const b = new BoardImpl(5), f = instrumentBench(opts);
  b.setNetlist(f.parts, f.nets);
  return b;
};
const failedMeasurement = error => error.code === 'SOLVE_FAILED_MEASUREMENT' && /solve failed/.test(error.message);

describe('failed live solves are not zero-valued instrument measurements', () => {
  it('refuses voltage, source/load current and both analog scope captures for actual singular and inconsistent sources', () => {
    for (const otherVolts of [1, 2]) {
      const b = instrumentBoard({ parallel: true, otherVolts });
      assert.equal(b._mnaCache.converged, false, 'the real solver fails, not a synthetic guard fixture');
      assert.throws(() => b.meterVoltage('live', 'ground'), failedMeasurement);
      for (const id of ['A', 'B', 'R']) {
        const terminal = id === 'R' ? 'a' : 'pos';
        assert.throws(() => b.branchCurrent(id, terminal), failedMeasurement);
        assert.throws(() => b.meterCurrent(id, terminal), failedMeasurement);
      }
      assert.equal(b._meterWatches.size, 0, 'failed primes never register watches');
      for (const capture of ['sample', 'envelope']) {
        const h = b.addScopeChannel({ type: 'voltage', netId: 'live', referenceNetId: 'ground', capture, sampleRateHz: 1000, depth: 8 });
        b.advanceTo(1_000_000n);
        assert.throws(() => b.getScopeData(h), failedMeasurement);
        const ch = b._scopeChannels.get(h);
        assert.equal(ch.count, 0, 'failed solve writes no false-zero samples');
        assert.ok([...ch.samples].every(Number.isNaN));
      }
      const h = b.addScopeChannel({ type: 'current', partId: 'R', terminal: 'a', depth: 8 });
      assert.throws(() => b.sampleCurrentChannels(), failedMeasurement);
      assert.equal(b._scopeChannels.get(h).count, 0);
    }
  });

  it('retains determinate nonzero/zero and power-off controls without changing nodeVoltage consumers', () => {
    for (const volts of [0, 1, -1]) {
      const b = instrumentBoard({ volts });
      assert.equal(b._mnaCache.converged, true);
      assert.ok(Math.abs(b.meterVoltage('live', 'ground') - volts) < 1e-12);
      assert.ok(Math.abs(b.meterCurrent('R', 'a') + volts / 1000) < 1e-12);
      assert.equal(b.branchCurrent('unknown', 'custom'), 0);
      const h = b.addScopeChannel({ type: 'voltage', netId: 'live', capture: 'sample', sampleRateHz: 1000, depth: 8 });
      b.advanceTo(1_000_000n);
      assert.equal(b.getScopeData(h).count, 1);
      assert.ok(Math.abs(b.getScopeData(h).samples[0] - volts) < 1e-12);
      b.setPower(false);
      assert.equal(b.branchCurrent('R', 'a'), 0);
    }
    const failed = instrumentBoard({ parallel: true });
    assert.equal(failed.nodeVoltage('live'), 0, 'general runtime API deliberately remains unchanged');
  });

  it('keeps a bad interval sticky across recovery but permits fresh netlist meter and fresh scope capture', () => {
    const b = instrumentBoard();
    b.meterVoltage('live', 'ground'); b.meterCurrent('R', 'a');
    const h = b.addScopeChannel({ type: 'voltage', netId: 'live', capture: 'sample', sampleRateHz: 1000, depth: 8 });
    b.advanceTo(1_000_000n);
    const f = instrumentBench({ parallel: true });
    // Exercise actual adopted results without setNetlist's intentional watch reset.
    const bad = solveMNA(f.parts, f.nets, new Map(), new Map(), 5);
    b._adoptSolution(bad);
    b._updateScopeChannels(2_000_000n, null, bad);
    const good = instrumentBench();
    b._adoptSolution(solveMNA(good.parts, good.nets, new Map(), new Map(), 5));
    assert.throws(() => b.meterVoltage('live', 'ground'), /meter mean refused:.*solve failed/);
    assert.throws(() => b.meterCurrent('R', 'a'), /meter mean refused:.*solve failed/);
    assert.throws(() => b.getScopeData(h), failedMeasurement);
    assert.equal(b._scopeChannels.get(h).count, 1, 'invalid interval added no samples');
    b.setNetlist(good.parts, good.nets);
    assert.equal(b.meterVoltage('live', 'ground'), 1);
    b.clearScopeChannels();
    const fresh = b.addScopeChannel({ type: 'voltage', netId: 'live', capture: 'sample', sampleRateHz: 1000, depth: 8 });
    b.advanceTo(2_000_000n);
    assert.equal(b.getScopeData(fresh).count, 1);
  });

  it('uses the matching fractional solution rather than an older converged cache and propagates unrelated errors', () => {
    const b = instrumentBoard();
    b.meterVoltage('live', 'ground');
    const h = b.addScopeChannel({ type: 'voltage', netId: 'live', capture: 'sample', sampleRateHz: 1000, depth: 8 });
    const f = instrumentBench({ parallel: true });
    const bad = solveMNA(f.parts, f.nets, new Map(), new Map(), 5);
    assert.equal(b._mnaCache.converged, true);
    b._recordMeterSamples(0, bad);
    b._updateScopeChannels(1_000_000n, 0.001, bad);
    assert.throws(() => b.meterVoltage('live', 'ground'), /meter mean refused:.*solve failed/);
    assert.throws(() => b.getScopeData(h), failedMeasurement);
    assert.equal(b._scopeChannels.get(h).count, 0);
    const good = instrumentBench();
    b.setNetlist(good.parts, good.nets);
    b.meterVoltage('live', 'ground');
    b._meterValue = () => { throw new Error('unexpected recorder defect'); };
    assert.throws(() => b._recordMeterSamples(), /unexpected recorder defect/);
  });

  it('passes the actual accepted transient result into scope publication, not only the integer clock', () => {
    const b = new BoardImpl(5), f = instrumentBench();
    f.parts[0].params = { wave: 'sine', freq: 1000, amplitude: 1, offset: 1 };
    b.setNetlist(f.parts, f.nets);
    const h = b.addScopeChannel({ type: 'voltage', netId: 'live', capture: 'sample', sampleRateHz: 20000, depth: 32 });
    const update = b._updateScopeChannels;
    let fractional = 0;
    b._updateScopeChannels = function(tNs, exactTimeSec, solution) {
      if (exactTimeSec != null) {
        fractional++;
        assert.equal(solution?.converged, true, 'production publisher supplies its real accepted result');
        assert.deepEqual(solution.nodeVoltages, this.nodeVoltages, 'result belongs to this fractional instant');
      }
      return update.call(this, tNs, exactTimeSec, solution);
    };
    b.advanceTo(1_000_000n);
    assert.ok(fractional > 1, 'actual transient substeps exercised');
    assert.equal(b.getScopeData(h).count, 20);
  });
});

function sourceAndLoad(sourceReversed) {
  const liveTerminal = sourceReversed ? 'neg' : 'pos';
  const groundTerminal = sourceReversed ? 'pos' : 'neg';
  const parts = [
    { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'live', terminals: [
      { part: 'V1', terminal: liveTerminal },
      { part: 'R1', terminal: 'a' },
    ] },
    { id: 'ground', terminals: [
      { part: 'V1', terminal: groundTerminal },
      { part: 'R1', terminal: 'b' },
      { part: 'GND', terminal: 'gnd' },
    ] },
  ];
  return solveMNA(parts, nets, new Map(), new Map(), 5, {});
}

describe('independent voltage source with either terminal grounded', () => {
  it('solves both orientations with voltage polarity, signed currents, and KCL intact', () => {
    const normal = sourceAndLoad(false);
    assert.equal(normal.converged, true);
    assert.ok(Math.abs(normal.nodeVoltages.get('live') - 5) < 1e-9,
      'the established pos-live orientation is non-vacuously driven to +5 V');
    assert.ok(Math.abs(current(normal, 'V1', 'pos') - 0.005) < 1e-9,
      'normal source delivers 5 mA out of its pos terminal');
    assert.ok(Math.abs(current(normal, 'R1', 'a') + 0.005) < 1e-9,
      'normal load current is signed out-of-part at terminal a');
    assert.ok(Math.abs(current(normal, 'V1', 'pos') + current(normal, 'R1', 'a')) < 1e-9,
      'normal live-node KCL holds directly in the uniform terminal convention');

    const reversed = sourceAndLoad(true);
    assert.equal(reversed.converged, true);
    assert.ok(Math.abs(reversed.nodeVoltages.get('live') + 5) < 1e-9,
      'a grounded pos terminal drives the live neg terminal to -5 V');
    assert.ok(Math.abs(current(reversed, 'V1', 'neg') + 0.005) < 1e-9,
      'reversed source draws 5 mA into its neg terminal');
    assert.ok(Math.abs(current(reversed, 'R1', 'a') - 0.005) < 1e-9,
      'reversed load current changes sign with the voltage');
    assert.ok(Math.abs(current(reversed, 'V1', 'neg') + current(reversed, 'R1', 'a')) < 1e-9,
      'reversed live-node KCL holds directly in the uniform terminal convention');
  });

  it('does not allocate a redundant zero-volt ground-to-ground source row', () => {
    const parts = [
      { id: 'VGOOD', kind: 'vsource', params: { volts: 3 }, terminals: ['pos', 'neg'] },
      { id: 'VZERO', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'live', terminals: [
        { part: 'VGOOD', terminal: 'pos' }, { part: 'R1', terminal: 'a' },
      ] },
      { id: 'ground', terminals: [
        { part: 'VGOOD', terminal: 'neg' }, { part: 'VZERO', terminal: 'pos' },
        { part: 'VZERO', terminal: 'neg' }, { part: 'R1', terminal: 'b' },
        { part: 'GND', terminal: 'gnd' },
      ] },
    ];
    const result = solveMNA(parts, nets, new Map(), new Map(), 5, {});
    assert.equal(result.converged, true);
    assert.ok(Math.abs(result.nodeVoltages.get('live') - 3) < 1e-9,
      'redundant ground-ground source stays outside the MNA rows and cannot singularize the valid circuit');
    assert.equal(result.branchCurrents.get('VZERO')?.size, 0);
  });
});

function selfShort(volts, { live = false, merged = false, alone = false, params = {} } = {}) {
  const parts = [
    { id: 'VBAD', kind: 'vsource', params: { volts, ...params }, terminals: ['pos', 'neg'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const ground = { id: 'ground', terminals: [{ part: 'GND', terminal: 'gnd' }] };
  const nets = [ground];
  if (!alone) {
    parts.push(
      { id: 'VGOOD', kind: 'vsource', params: { volts: 1 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    );
    ground.terminals.push({ part: 'VGOOD', terminal: 'neg' }, { part: 'R1', terminal: 'b' });
    nets.push({ id: 'live', terminals: [
      { part: 'VGOOD', terminal: 'pos' }, { part: 'R1', terminal: 'a' },
    ] });
  }
  const target = live ? nets[1] : ground;
  target.terminals.push({ part: 'VBAD', terminal: 'pos' });
  if (merged) {
    parts.push({ id: 'GND2', kind: 'gnd', params: {}, terminals: ['gnd'] });
    nets.push({ id: 'second-ground', terminals: [
      { part: 'GND2', terminal: 'gnd' }, { part: 'VBAD', terminal: 'neg' },
    ] });
  } else target.terminals.push({ part: 'VBAD', terminal: 'neg' });
  return { parts, nets };
}

describe('live solver exceptions invalidate measurements without swallowing the fault', () => {
  it('refuses old means and fresh probes after a real control fault, with original error identity and sticky recovery', () => {
    const f = selfShort(0), b = new BoardImpl(5);
    b.setNetlist(f.parts, f.nets);
    assert.equal(b.meterVoltage('live', 'ground'), 1);
    assert.equal(b.meterCurrent('VGOOD', 'pos'), 0.001);
    const h = b.addScopeChannel({ type: 'voltage', netId: 'live', capture: 'sample', sampleRateHz: 1000, depth: 8 });
    b.advanceTo(1_000_000n);
    let original;
    assert.throws(() => b.setControl('VBAD', 5), error => {
      original = error;
      return /inconsistent ideal voltage constraint VBAD/.test(error.message);
    });
    assert.equal(b._liveSolveError, original, 'the actual thrown solver error is retained, not replaced');
    assert.equal(b._mnaCache, null);
    assert.throws(() => b.meterVoltage('live', 'ground'), failedMeasurement);
    assert.throws(() => b.meterVoltage('ground', 'live'), failedMeasurement);
    assert.throws(() => b.meterCurrent('VGOOD', 'pos'), failedMeasurement);
    // Do not read the scope during the fault: invalidation must not depend
    // on a consumer noticing the error before recovery.
    b.setControl('VBAD', 0);
    assert.equal(b._liveSolveError, null);
    assert.equal(b.meterVoltage('ground', 'live'), -1, 'a fresh unprimed pair can read the recovered valid solve');
    assert.throws(() => b.meterVoltage('live', 'ground'), /meter mean refused:.*solve failed/);
    assert.throws(() => b.meterCurrent('VGOOD', 'pos'), /meter mean refused:.*solve failed/);
    assert.throws(() => b.getScopeData(h), failedMeasurement);
    b.setNetlist(f.parts, f.nets);
    assert.equal(b.meterVoltage('live', 'ground'), 1, 'intentional watch reset recovers');
  });

  it('a real transient source exception invalidates observers even when the old cache still says converged', () => {
    const f = selfShort(0, { params: { wave: 'spice-pulse', v1: 0, v2: 1, td: 10e-6, tr: 1e-6, tf: 1e-6, pw: 10e-6, per: 100e-6 } });
    const b = new BoardImpl(5); b.setNetlist(f.parts, f.nets);
    b.meterVoltage('live', 'ground'); b.meterCurrent('VGOOD', 'pos');
    const h = b.addScopeChannel({ type: 'voltage', netId: 'live', capture: 'sample', sampleRateHz: 1e6, depth: 32 });
    assert.throws(() => b.advanceTo(20_000n), /inconsistent ideal voltage constraint VBAD/);
    assert.equal(b._mnaCache.converged, true, 'previously accepted cache is not the failed attempt');
    assert.ok(b._scopeChannels.get(h).count > 0, 'valid observations existed before the fault');
    assert.throws(() => b.meterVoltage('live', 'ground'), failedMeasurement);
    assert.throws(() => b.meterCurrent('VGOOD', 'pos'), failedMeasurement);
    assert.throws(() => b.getScopeData(h), failedMeasurement);
  });

  it('observational DC-bias refusal does not invalidate the healthy live time-zero measurement', () => {
    const f = selfShort(0, { params: { wave: 'sine', amplitude: 1, offset: 0, freq: 1, dcValue: 2 } });
    const b = new BoardImpl(5); b.setNetlist(f.parts, f.nets);
    assert.equal(b.meterVoltage('live', 'ground'), 1);
    assert.throws(() => b.operatingPoint({ waveformBias: 'dc-value' }), /inconsistent ideal voltage constraint VBAD/);
    assert.equal(b._liveSolveError, null);
    assert.equal(b.meterVoltage('live', 'ground'), 1);
    assert.ok([...b._meterWatches.values()].every(w => !w.failure));
  });

  it('preserves the exact unexpected stamp exception and never classifies a merely absent cache as failure', () => {
    const sentinel = new TypeError('load-bearing stamp defect');
    registerDevice('measurement-stamp-defect', { terminals: ['a'], stamp() { throw sentinel; } });
    const f = instrumentBench();
    f.parts.push({ id: 'BUG', kind: 'measurement-stamp-defect', params: {}, terminals: ['a'] });
    f.nets[0].terminals.push({ part: 'BUG', terminal: 'a' });
    const b = new BoardImpl(5);
    assert.throws(() => b.setNetlist(f.parts, f.nets), error => error === sentinel);
    assert.throws(() => b.meterVoltage('live', 'ground'), failedMeasurement);
    b.setPower(false);
    assert.equal(b.branchCurrent('R', 'a'), 0);
    const healthy = instrumentBoard({ volts: 0 });
    healthy._mnaCache = null;
    assert.equal(healthy.meterVoltage('live', 'ground'), 0, 'no exception authority, valid zero with absent cache');
  });

  it('recovers when replacing the failed topology with a valid closed-form circuit', () => {
    const f = selfShort(0), b = new BoardImpl(5); b.setNetlist(f.parts, f.nets);
    assert.throws(() => b.setControl('VBAD', 5));
    b.setNetlist([
      { id: 'SUP', kind: 'vcc', params: { volts: 5 }, terminals: ['vcc'] },
      { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ], [
      { id: 'live', terminals: [{ part: 'SUP', terminal: 'vcc' }, { part: 'R', terminal: 'a' }] },
      { id: 'ground', terminals: [{ part: 'G', terminal: 'gnd' }, { part: 'R', terminal: 'b' }] },
    ]);
    assert.equal(b._mnaCache, null, 'control genuinely uses the closed-form path');
    assert.equal(b.meterVoltage('live', 'ground'), 5);
  });
});

function solveShort(fixture, options = {}, controls = new Map()) {
  return solveMNA(fixture.parts, fixture.nets, new Map(), controls, 5, options);
}

describe('explicit indeterminate ideal-source current observations', () => {
  it('marks omitted ideal rows in ground/live/merged/all-ground and transient solves, but not powered-off or resistive controls', () => {
    for (const placement of [{}, {live:true}, {merged:true}, {alone:true}]) {
      const fixture = selfShort(0, placement);
      for (const opts of [{}, {transient:{dtSec:1e-6}}]) {
        const result = solveShort(fixture, opts);
        assert.deepEqual([...result.indeterminateBranchCurrents], ['VBAD']);
        assert.equal(result.branchCurrents.get('VBAD')?.size ?? 0, 0);
      }
      assert.equal(solveShort(fixture,{powerOff:true}).indeterminateBranchCurrents.size,0);
      const resistive = selfShort(0,{...placement,params:{rInternal:10}});
      assert.equal(solveShort(resistive).indeterminateBranchCurrents.size,0);
      assert.equal(current(solveShort(resistive),'VBAD','pos'),0);
    }
  });

  it('refuses instantaneous and repeated mean reads without installing an empty watch or breaking valid voltage/load meters', () => {
    for (const placement of [{}, {live:true}, {merged:true}, {alone:true}]) {
      const fixture = selfShort(0, placement);
      const board = new BoardImpl(5); board.setNetlist(fixture.parts,fixture.nets);
      for (const terminal of ['pos','neg']) {
        assert.throws(()=>board.branchCurrent('VBAD',terminal),/indeterminate source current VBAD/);
        for (let repeat=0;repeat<2;repeat++) {
          assert.throws(()=>board.meterCurrent('VBAD',terminal),/indeterminate source current VBAD/);
          assert.equal(board._meterWatches.size,0,'failed priming must not register empty history');
        }
      }
      assert.equal(board.branchCurrent('unknown','pos'),0,'unregistered legacy fallback is unchanged');
      assert.equal(board.branchCurrent('VBAD','unknown'),0,'unknown terminal fallback is unchanged');
      if (!placement.alone) {
        assert.equal(board.meterVoltage('live','ground'),1);
        assert.ok(Math.abs(board.meterCurrent('VGOOD','pos')-.001)<1e-12);
        assert.doesNotThrow(()=>board.advanceTo(1_000_000n));
        assert.equal(board.meterVoltage('live','ground'),1);
        assert.ok(Math.abs(board.meterCurrent('VGOOD','pos')-.001)<1e-12);
      }
      board.setPower(false);
      assert.equal(board.branchCurrent('VBAD','pos'),0);
      assert.equal(board.meterCurrent('VBAD','pos'),0,'known powered-off zero remains observable');
      assert.doesNotThrow(()=>board.setPower(true),'a failed watch must not break power-on solving');
      assert.throws(()=>board.meterCurrent('VBAD','pos'),/indeterminate source current VBAD/);
    }
  });

  it('keeps an invalid interval sticky without making a parameter edit or unrelated meter fail', () => {
    const fixture = selfShort(0,{live:true,params:{rInternal:10}});
    const board = new BoardImpl(5); board.setNetlist(fixture.parts,fixture.nets);
    assert.equal(board.meterCurrent('VBAD','pos'),0,'determinate resistive zero is valid');
    board.meterCurrent('VGOOD','pos'); board.advanceTo(100_000n);
    assert.doesNotThrow(()=>board.setPartParam('VBAD','rInternal',0));
    assert.throws(()=>board.meterCurrent('VBAD','pos'),/indeterminate source current VBAD/);
    assert.ok(Math.abs(board.meterCurrent('VGOOD','pos')-.001)<1e-12);
    board.setPartParam('VBAD','rInternal',10);
    assert.equal(board.branchCurrent('VBAD','pos'),0);
    board.advanceTo(200_000n);
    assert.throws(()=>board.meterCurrent('VBAD','pos'),/indeterminate source current VBAD/,
      'restoring determinate topology cannot repair the earlier unmeasured interval');
    assert.ok(Math.abs(board.meterCurrent('VGOOD','pos')-.001)<1e-12);
    const reset = selfShort(0,{live:true,params:{rInternal:10}});
    board.setNetlist(reset.parts,reset.nets);
    assert.equal(board.meterCurrent('VBAD','pos'),0,'netlist reset starts a new qualified watch');
  });

  it('preserves current availability through observational OP and adopted initial-state caches', () => {
    for (const live of [false,true]) {
      const fixture = selfShort(0,{live});
      const board = new BoardImpl(5); board.setNetlist(fixture.parts,fixture.nets);
      const op = board.operatingPoint();
      assert.deepEqual([...op.indeterminateBranchCurrents],['VBAD']);
      assert.equal(board.timeNs,0n);
      const initialized = board.initializeTransientFromOperatingPoint();
      assert.equal(initialized.converged,true);
      assert.throws(()=>board.branchCurrent('VBAD','pos'),/indeterminate source current VBAD/);
      assert.throws(()=>board.meterCurrent('VBAD','neg'),/indeterminate source current VBAD/);
      assert.equal(board.nodeVoltage('live'),1);
      assert.ok(Math.abs(board.branchCurrent('VGOOD','pos')-.001)<1e-12);
    }
  });

  it('does not swallow unrelated meter recorder exceptions', () => {
    const fixture = selfShort(0,{params:{rInternal:10}});
    const board = new BoardImpl(5); board.setNetlist(fixture.parts,fixture.nets);
    board.meterCurrent('VBAD','pos');
    board._meterValue=()=>{throw new Error('unrelated recorder defect');};
    assert.throws(()=>board._recordMeterSamples(),/unrelated recorder defect/);
  });
});

describe('independent ideal-source self-constraint consistency', () => {
  it('rejects signed nonzero ground, live and merged-ground constraints by name without mutating inputs', () => {
    for (const volts of [5, -5]) for (const placement of [{}, { live: true }, { merged: true }]) {
      const fixture = selfShort(volts, placement);
      const before = structuredClone(fixture);
      assert.throws(() => solveShort(fixture),
        /solveMNA: inconsistent ideal voltage constraint VBAD; -?5 V cannot be imposed across the same net/);
      assert.deepEqual(fixture, before);
    }
  });

  it('checks conflicts before returning from all-ground zero-node circuits', () => {
    for (const merged of [false, true]) {
      assert.throws(() => solveShort(selfShort(5, { alone: true, merged })), /constraint VBAD; 5 V/);
      assert.doesNotThrow(() => solveShort(selfShort(0, { alone: true, merged })));
    }
  });

  it('omits zero redundant rows without grounding a driven live node', () => {
    for (const placement of [{}, { live: true }, { merged: true }]) {
      const result = solveShort(selfShort(0, placement));
      assert.equal(result.converged, true);
      assert.ok(Math.abs(result.nodeVoltages.get('live') - 1) < 1e-12);
      assert.equal(result.branchCurrents.get('VBAD')?.size, 0,
        'redundant ideal branch current is indeterminate, not an invented reading');
      assert.ok(Math.abs(current(result, 'VGOOD', 'pos') - 0.001) < 1e-12);
    }
  });

  it('uses control overrides, transient time and explicit DC bias from the actual stamp authority', () => {
    assert.equal(solveShort(selfShort(5), {}, new Map([['VBAD', 0]])).converged, true);
    assert.throws(() => solveShort(selfShort(0), {}, new Map([['VBAD', -2]])), /VBAD; -2 V/);
    const fixture = selfShort(0, { params: { wave: 'sine', amplitude: 1, offset: 0, freq: 1, dcValue: 2 } });
    assert.equal(solveShort(fixture, { tSeconds: 0 }).converged, true);
    assert.throws(() => solveShort(fixture, { tSeconds: 0.25 }), /VBAD; 1 V/);
    assert.throws(() => solveShort(fixture, { dcSources: true }), /VBAD; 2 V/);
  });

  it('preserves power-off, disconnected and nonideal-source exclusions', () => {
    assert.doesNotThrow(() => solveShort(selfShort(5), { powerOff: true }));
    for (const params of [{ rInternal: 10 }, { iLimit: 0.1 }]) {
      const result = solveShort(selfShort(5, { params }));
      assert.equal(result.converged, true);
      assert.ok(Math.abs(result.nodeVoltages.get('live') - 1) < 1e-12);
    }
    for (const removed of [['pos'], ['neg'], ['pos', 'neg']]) {
      const fixture = selfShort(5);
      for (const net of fixture.nets) {
        net.terminals = net.terminals.filter(t => t.part !== 'VBAD' || !removed.includes(t.terminal));
      }
      assert.doesNotThrow(() => solveShort(fixture));
    }
  });

  it('protects real public voltage observers and catches a future nonzero waveform', () => {
    for (const volts of [5, -5]) {
      const fixture = selfShort(volts);
      const board = new BoardImpl(5);
      assert.throws(() => board.setNetlist(fixture.parts, fixture.nets), /constraint VBAD/);
      assert.throws(() => board.biasPointVoltages(), /constraint VBAD/);
    }
    const fixture = selfShort(0, { live: true });
    const valid = new BoardImpl(5);
    valid.setNetlist(fixture.parts, fixture.nets);
    valid.advanceTo(1_000_000n);
    assert.ok(Math.abs(valid.nodeVoltage('live') - 1) < 1e-12);
    const wave = selfShort(0, { params: { wave: 'sine', amplitude: 1, offset: 0, freq: 1 } });
    const changing = new BoardImpl(5);
    changing.setNetlist(wave.parts, wave.nets);
    assert.ok(Math.abs(changing.nodeVoltage('live') - 1) < 1e-12);
    assert.throws(() => changing.advanceTo(250_000_000n), /constraint VBAD/);
  });
});

describe('finite-resistance source self-short currents', () => {
  it('preserves signed short current, unrelated load current and live voltage on ground/live/merged nodes', () => {
    for (const volts of [5, -5, 0]) for (const placement of [{}, { live: true }, { merged: true }]) {
      const fixture = selfShort(volts, { ...placement, params: { rInternal: 10 } });
      const before = structuredClone(fixture);
      const result = solveShort(fixture);
      assert.equal(result.converged, true);
      assert.ok(Math.abs(result.nodeVoltages.get('live') - 1) < 1e-12);
      assert.equal(current(result, 'VBAD', 'pos'), volts / 10);
      assert.equal(current(result, 'VBAD', 'neg'), -volts / 10);
      assert.equal(current(result, 'VBAD', 'pos') + current(result, 'VBAD', 'neg'), 0);
      assert.ok(Math.abs(current(result, 'VGOOD', 'pos') - 0.001) < 1e-12,
        'same-node circulation cannot load the unrelated 1 V supply');
      assert.ok(Math.abs(current(result, 'VGOOD', 'pos') + current(result, 'R1', 'a')) < 1e-12);
      assert.deepEqual(fixture, before);
    }
  });

  it('solves an all-ground resistive row and preserves the power-off zero-node path', () => {
    for (const merged of [false, true]) {
      const fixture = selfShort(5, { alone: true, merged, params: { rInternal: 10 } });
      const result = solveShort(fixture);
      assert.equal(result.converged, true);
      assert.equal(current(result, 'VBAD', 'pos'), 0.5);
      const off = solveShort(fixture, { powerOff: true });
      assert.equal(off.branchCurrents.size, 0);
    }
  });

  it('retains controls and existing current-limit selection with finite internal resistance', () => {
    for (const placement of [{}, { live: true }, { alone: true }]) {
      const fixture = selfShort(5, { ...placement, params: { rInternal: 10 } });
      const adjusted = solveShort(fixture, {}, new Map([['VBAD', -2]]));
      assert.equal(current(adjusted, 'VBAD', 'pos'), -0.2);
      const limited = selfShort(5, { ...placement, params: { rInternal: 10, iLimit: 0.1 } });
      const result = solveShort(limited);
      assert.equal(result.converged, true);
      assert.ok(Math.abs(current(result, 'VBAD', 'pos') - 0.1) < 1e-12);
      if (!placement.alone) assert.ok(Math.abs(current(result, 'VGOOD', 'pos') - 0.001) < 1e-12);
    }
  });

  it('publishes the actual current through public Board observers and meter means', () => {
    for (const live of [false, true]) {
      const fixture = selfShort(5, { live, params: { rInternal: 10 } });
      const board = new BoardImpl(5);
      board.setNetlist(fixture.parts, fixture.nets);
      assert.equal(board.branchCurrent('VBAD', 'pos'), 0.5);
      assert.ok(Math.abs(board.branchCurrent('VGOOD', 'pos') - 0.001) < 1e-12);
      assert.equal(board.biasPointVoltages().converged, true);
      board.meterCurrent('VBAD', 'pos');
      board.meterCurrent('VBAD', 'neg');
      board.meterCurrent('VGOOD', 'pos');
      for (const at of [100_000n, 700_000n, 1_000_000n]) {
        board.advanceTo(at);
        assert.ok(Math.abs(board.meterCurrent('VBAD', 'pos') - 0.5) < 1e-12);
        assert.ok(Math.abs(board.meterCurrent('VBAD', 'neg') + 0.5) < 1e-12);
        assert.ok(Math.abs(board.meterCurrent('VGOOD', 'pos') - 0.001) < 1e-12);
      }
    }
  });
});
