import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { solveMNA } from '../src/mna.js';
import { BoardImpl } from '../src/board.js';

const current = (result, part, terminal) =>
  result.branchCurrents.get(part)?.get(terminal) ?? 0;

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

function solveShort(fixture, options = {}, controls = new Map()) {
  return solveMNA(fixture.parts, fixture.nets, new Map(), controls, 5, options);
}

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
