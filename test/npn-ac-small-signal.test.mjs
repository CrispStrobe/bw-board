import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';
import { ebersMollChargeCompanion, ebersMollParams } from '../src/mna.js';

const net = (id, ...terminals) => ({ id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });
const exactParams = Object.freeze({ model: 'shockley', is: 3e-9, beta: 200,
  vaf: 130, rb: 10 });

function bench(params = exactParams) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'G0', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'VCC', kind: 'vsource', params: { volts: 12 }, terminals: ['pos', 'neg'] },
    { id: 'VIN', kind: 'vsource', params: { volts: 0.75 }, terminals: ['pos', 'neg'] },
    { id: 'RC', kind: 'resistor', params: { ohms: 3000 }, terminals: ['a', 'b'] },
    { id: 'RE', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'Q1', kind: 'npn', params: { ...params }, terminals: ['collector', 'base', 'emitter'] },
  ], [
    net('gnd', ['G0', 'gnd'], ['VCC', 'neg'], ['VIN', 'neg'], ['RE', 'b']),
    net('vcc', ['VCC', 'pos'], ['RC', 'a']),
    net('base', ['VIN', 'pos'], ['Q1', 'base']),
    net('collector', ['RC', 'b'], ['Q1', 'collector']),
    net('emitter', ['RE', 'a'], ['Q1', 'emitter']),
  ]);
  return board;
}

function signedReal(row, node) {
  const value = row.results.get(node);
  return value.mag * Math.cos(value.phaseDeg * Math.PI / 180);
}

function rectangular(row, node) {
  const value = row.results.get(node);
  const phase = value.phaseDeg * Math.PI / 180;
  return { re: value.mag * Math.cos(phase), im: value.mag * Math.sin(phase) };
}

describe('strict explicit Ebers-Moll NPN small-signal AC', () => {
  it('matches the independent ngspice two-junction, Early-effect and RB Jacobian', () => {
    // Self-authored ngspice 42 deck at TEMP=TNOM=26.826895261366076 C,
    // selected so its thermal voltage is this engine's declared 0.02585 V:
    // VCC=12, VIN DC .75 AC 1, RC=3k, RE=1k and
    // .model QN NPN(IS=3n BF=200 VAF=130 RB=10).
    const expected = new Map([
      ['base', 1],
      ['collector', -2.81964946107703],
      ['emitter', 0.9443053619883761],
    ]);
    const board = bench();
    const before = board.operatingPoint();
    const row = board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: [...expected.keys()] })[0];
    for (const [node, oracle] of expected) {
      const actual = signedReal(row, node);
      assert.ok(Math.abs(actual - oracle) < 2e-8,
        `${node}: ${actual} vs ngspice ${oracle}`);
    }
    const after = board.operatingPoint();
    assert.deepEqual([...after.nodeVoltages], [...before.nodeVoltages],
      'small-signal analysis must not adopt or move the DC operating point');
  });

  it('matches an independent ngspice intrinsic-collector RC Jacobian', () => {
    // Same self-authored bench and matched temperature as above, with RC=100.
    const expected = new Map([
      ['base', 1],
      ['collector', -2.8195889809420733],
      ['emitter', 0.9442879018998295],
    ]);
    const board = bench({ ...exactParams, rc: 100 });
    const before = board.operatingPoint();
    const row = board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: [...expected.keys()] })[0];
    for (const [node, oracle] of expected) {
      const actual = signedReal(row, node);
      assert.ok(Math.abs(actual - oracle) < 2e-8,
        `${node}: ${actual} vs ngspice ${oracle}`);
    }
    assert.deepEqual([...board.operatingPoint().nodeVoltages], [...before.nodeVoltages]);
  });

  it('matches the independent ngspice IKF high-current Jacobian', () => {
    // Same self-authored bench and matched temperature, with IKF=10 mA.
    const expected = new Map([
      ['base', 1],
      ['collector', -2.8120736314311232],
      ['emitter', 0.9421294955055833],
    ]);
    const board = bench({ ...exactParams, ikf: 0.01 });
    const before = board.operatingPoint();
    const row = board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: [...expected.keys()] })[0];
    for (const [node, oracle] of expected) {
      const actual = signedReal(row, node);
      assert.ok(Math.abs(actual - oracle) < 2e-8,
        `${node}: ${actual} vs ngspice ${oracle}`);
    }
    assert.deepEqual([...board.operatingPoint().nodeVoltages], [...before.nodeVoltages]);
  });

  it('matches independent ngspice CJE/CJC/TF charge storage at 1 MHz', () => {
    // Self-authored ngspice 42 deck using the same bench and matched
    // TEMP=TNOM as above. The model adds RC=100, IKF=10m, CJE=20p,
    // CJC=10p and TF=.5n; no charge-shaping parameter is declared.
    const expected = new Map([
      ['base', { re: 1, im: 0 }],
      ['collector', { re: -2.7836164880391721, im: 0.3401614479609181 }],
      ['emitter', { re: 0.9420364784804977, im: -0.0003402408658239708 }],
    ]);
    const params = { ...exactParams, rc: 100, ikf: 0.01,
      cje: 20e-12, cjc: 10e-12, tf: 0.5e-9 };
    const board = bench(params);
    const before = board.operatingPoint();
    const row = board.runAc({ sourceId: 'VIN', frequencies: [1e6],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: [...expected.keys()] })[0];
    for (const [node, oracle] of expected) {
      const actual = rectangular(row, node);
      assert.ok(Math.abs(actual.re - oracle.re) < 2e-8,
        `${node}.re: ${actual.re} vs ngspice ${oracle.re}`);
      assert.ok(Math.abs(actual.im - oracle.im) < 2e-8,
        `${node}.im: ${actual.im} vs ngspice ${oracle.im}`);
    }
    assert.deepEqual([...board.operatingPoint().nodeVoltages], [...before.nodeVoltages]);
  });

  it('derives the TF cross charge from the same VAF/IKF transport law', () => {
    const raw = { kind: 'npn', params: { ...exactParams, ikf: 0.01,
      cje: 20e-12, cjc: 10e-12, tf: 0.5e-9 } };
    const p = ebersMollParams(raw);
    const vbe = 0.72;
    const vbc = -3;
    const q = ebersMollChargeCompanion(vbe, vbc, p);
    const h = 1e-7;
    const forwardCharge = (be, bc) => {
      const cap = 80 * p.nVt;
      const iF = p.is * (Math.exp(Math.min(be, cap) / p.nVt) - 1);
      const early = 1 - bc / p.vaf;
      const rolloff = 2 / (1 + Math.sqrt(Math.max(0, 1 + 4 * iF / p.ikf)));
      return p.tf * iF * early * rolloff;
    };
    const dVbc = (forwardCharge(vbe, vbc + h) - forwardCharge(vbe, vbc - h)) / (2 * h);
    assert.ok(Math.abs(q.cbeVbc - dVbc) < 1e-16,
      `TF cross derivative ${q.cbeVbc} vs finite difference ${dVbc}`);
    assert.ok(q.cbe > p.cje && q.cbc > 0,
      'the witness must exercise diffusion plus both depletion capacitances');
  });

  it('keeps omitted charge storage identical to an explicit all-zero card', () => {
    const run = params => bench(params).runAc({ sourceId: 'VIN', frequencies: [1e6],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['base', 'collector', 'emitter'] });
    assert.deepEqual(run(exactParams), run({ ...exactParams, cje: 0, cjc: 0, tf: 0 }));
  });

  it('retains the generic interactive NPN compatibility model', () => {
    const exact = bench();
    const generic = bench({ beta: 200, vbe: 0.7 });
    const run = board => signedReal(board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['collector'] })[0], 'collector');
    assert.notEqual(run(generic), run(exact));
  });
});
