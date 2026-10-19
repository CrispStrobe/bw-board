import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';
import { mosGds, mosK, mosTriode, smoothVov } from '../src/mna.js';

const gnd = { id: 'G0', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...terminals) => ({ id,
  terminals: terminals.map(([part, terminal]) => ({ part, terminal })) });
const params = Object.freeze({ model: 'level1', vth: 1, kp: 50e-6,
  w: 100e-6, l: 1e-6, lambda: 0.01, bulkAtGround: true });

function bench({ supply, load }) {
  const board = new BoardImpl(5);
  board.setNetlist([
    gnd,
    { id: 'VIN', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
    { id: 'VDD', kind: 'vsource', params: { volts: supply }, terminals: ['pos', 'neg'] },
    { id: 'RD', kind: 'resistor', params: { ohms: load }, terminals: ['a', 'b'] },
    { id: 'M1', kind: 'nmos', params: { ...params }, terminals: ['drain', 'gate', 'source'] },
  ], [
    net('gnd', ['G0', 'gnd'], ['VIN', 'neg'], ['VDD', 'neg'], ['M1', 'source']),
    net('gate', ['VIN', 'pos'], ['M1', 'gate']),
    net('vdd', ['VDD', 'pos'], ['RD', 'a']),
    net('drain', ['RD', 'b'], ['M1', 'drain']),
  ]);
  return board;
}

function bodyBench(overrides = {}) {
  const board = new BoardImpl(10);
  const mosParams = { ...params, gamma: 0.5, phi: 0.6,
    kp: 100e-6, w: 10e-6, lambda: 0, ...overrides };
  for (const [key, value] of Object.entries(mosParams)) {
    if (value === undefined) delete mosParams[key];
  }
  board.setNetlist([
    gnd,
    { id: 'VG', kind: 'vsource', params: { volts: 4 }, terminals: ['pos', 'neg'] },
    { id: 'VDD', kind: 'vsource', params: { volts: 10 }, terminals: ['pos', 'neg'] },
    { id: 'RD', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
    { id: 'RS', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'M1', kind: 'nmos', params: mosParams, terminals: ['drain', 'gate', 'source'] },
  ], [
    net('gnd', ['G0', 'gnd'], ['VG', 'neg'], ['VDD', 'neg'], ['RS', 'b']),
    net('gate', ['VG', 'pos'], ['M1', 'gate']),
    net('vdd', ['VDD', 'pos'], ['RD', 'a']),
    net('drain', ['RD', 'b'], ['M1', 'drain']),
    net('source', ['RS', 'a'], ['M1', 'source']),
  ]);
  return board;
}

function ngspiceBodyEffectAc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmos-body-ac-'));
  const deckPath = path.join(dir, 'witness.cir');
  const dataPath = path.join(dir, 'witness.dat');
  fs.writeFileSync(deckPath, `body-effect ac witness
VDD vdd 0 DC 10
VG g 0 DC 4 AC 1
RD vdd d 2k
RS s 0 1k
M1 d g s 0 NM W=10u L=1u
.model NM NMOS(LEVEL=1 VTO=1 KP=100u LAMBDA=0 GAMMA=0.5 PHI=0.6)
.control
ac lin 1 1k 1k
set wr_singlescale
wrdata ${dataPath} v(d) v(s)
.endc
.end
`);
  try {
    execFileSync('ngspice', ['-b', deckPath], { encoding: 'utf8' });
    const row = fs.readFileSync(dataPath, 'utf8').trim().split(/\s+/).map(Number);
    assert.equal(row.length, 5);
    assert.ok(row.every(Number.isFinite) && row[0] === 1000);
    return { drain: row[1], source: row[3] };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function signedReal(row, node) {
  const value = row.results.get(node);
  return value.mag * Math.cos(value.phaseDeg * Math.PI / 180);
}

describe('strict grounded-bulk Level-1 NMOS small-signal AC', () => {
  for (const fixture of [
    { name: 'saturation', supply: 10, load: 1000 },
    { name: 'triode', supply: 0.5, load: 100 },
  ]) it(`uses the DC Level-1 ${fixture.name} Jacobian`, () => {
    const board = bench(fixture);
    const before = board.operatingPoint();
    const vd = before.nodeVoltages.get('drain');
    const k = mosK(params);
    const [vov, dVov] = smoothVov(1);
    let gm;
    let gds;
    if (vd < vov) {
      ({ gm, gds } = mosTriode(k, vov, vd, dVov, params));
      gds += 1e-12;
    } else {
      const id0 = k * vov * vov;
      gm = 2 * k * vov * dVov * (1 + params.lambda * vd);
      gds = mosGds(params, id0, dVov);
    }
    const expected = -gm / (1 / fixture.load + gds);
    const row = board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['drain'] })[0];
    assert.ok(Math.abs(signedReal(row, 'drain') - expected) < 1e-10,
      `${signedReal(row, 'drain')} vs ${expected}`);
    const after = board.operatingPoint();
    assert.deepEqual([...after.nodeVoltages], [...before.nodeVoltages],
      'small-signal analysis must not adopt or move the DC operating point');
  });

  it('retains the generic interactive MOS compatibility model', () => {
    const strict = bench({ supply: 10, load: 1000 });
    const generic = bench({ supply: 10, load: 1000 });
    generic._solveParts.find(part => part.id === 'M1').params = { vth: 1, k: 0.5 };
    const run = board => signedReal(board.runAc({ sourceId: 'VIN', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['drain'] })[0], 'drain');
    assert.notEqual(run(generic), run(strict));
  });

  it('matches live ngspice for the nonzero grounded-bulk body Jacobian', () => {
    const board = bodyBench();
    const before = board.operatingPoint();
    const row = board.runAc({ sourceId: 'VG', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['drain', 'source'] })[0];
    const oracle = ngspiceBodyEffectAc();
    assert.ok(Math.abs(signedReal(row, 'drain') - oracle.drain) < 1e-6,
      `drain ${signedReal(row, 'drain')} vs ngspice ${oracle.drain}`);
    assert.ok(Math.abs(signedReal(row, 'source') - oracle.source) < 1e-6,
      `source ${signedReal(row, 'source')} vs ngspice ${oracle.source}`);
    const after = board.operatingPoint();
    assert.deepEqual([...after.nodeVoltages], [...before.nodeVoltages],
      'the body-effect AC sweep must not adopt or move its DC bias');
  });

  it('keeps declared zero GAMMA byte-for-behaviour equivalent to no body effect', () => {
    const run = board => board.runAc({ sourceId: 'VG', frequencies: [1000],
      analysisProfile: 'source-analysis-v1', nodeRegularizationSiemens: 0,
      probes: ['drain', 'source'] })[0].results;
    assert.deepEqual([...run(bodyBench({ gamma: 0 }))],
      [...run(bodyBench({ gamma: undefined, phi: undefined }))]);
  });

  it('refuses an incomplete body-effect pair instead of using the generic MOS law', () => {
    assert.throws(() => bodyBench({ phi: undefined }).runAc({ sourceId: 'VG',
      frequencies: [1000], analysisProfile: 'source-analysis-v1',
      nodeRegularizationSiemens: 0, probes: ['drain'] }), /gamma and phi must/);
  });
});
