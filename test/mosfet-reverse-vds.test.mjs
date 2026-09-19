import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { describe, it } from 'node:test';
import { BoardImpl } from '../src/board.js';

const HAS_NGSPICE = spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status === 0;

function oracle(kind) {
  const pmos = kind === 'pmos';
  const deck = `* reverse-vds Level-1 witness
VG gate 0 ${pmos ? -3 : 3}
VD drain 0 ${pmos ? 0.2 : -0.2}
M1 drain gate 0 0 M W=1u L=1u
.model M ${pmos ? 'PMOS' : 'NMOS'}(LEVEL=1 VTO=${pmos ? -1 : 1} KP=100u LAMBDA=.02)
.temp 27
.options tnom=27 reltol=1e-12 abstol=1e-18 vntol=1e-15
.control
set numdgt=17
op
print @m1[id]
.endc
.end
`;
  const run = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const match = /@m1\[id\]\s*=\s*([-+0-9.e]+)/i.exec(run.stdout);
  assert.ok(match, run.stdout);
  return Number(match[1]);
}

function board(kind) {
  const pmos = kind === 'pmos';
  const terminals = ['drain', 'gate', 'source', ...(pmos ? ['bulk'] : [])];
  const params = { model: 'level1', vth: pmos ? -1 : 1, kp: 100e-6,
    w: 1e-6, l: 1e-6, lambda: 0.02, ...(pmos ? {} : { bulkOnSource: true }) };
  const parts = [
    { id: 'M1', kind, params, terminals },
    { id: 'VG', kind: 'vsource', params: { volts: pmos ? -3 : 3 }, terminals: ['pos', 'neg'] },
    { id: 'VD', kind: 'vsource', params: { volts: pmos ? 0.2 : -0.2 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const ground = [{ part: 'G', terminal: 'gnd' }, { part: 'VG', terminal: 'neg' },
    { part: 'VD', terminal: 'neg' }, { part: 'M1', terminal: 'source' },
    ...(pmos ? [{ part: 'M1', terminal: 'bulk' }] : [])];
  const nets = [
    { id: 'ground', terminals: ground },
    { id: 'gate', terminals: [{ part: 'VG', terminal: 'pos' }, { part: 'M1', terminal: 'gate' }] },
    { id: 'drain', terminals: [{ part: 'VD', terminal: 'pos' }, { part: 'M1', terminal: 'drain' }] },
  ];
  const value = new BoardImpl(5);
  value.setNetlist(parts, nets);
  return value.operatingPoint();
}

describe('Level-1 MOS reverse-VDS channel roles', () => {
  it('swaps the NMOS channel source/drain roles exactly as ngspice does', { skip: !HAS_NGSPICE }, () => {
    const result = board('nmos');
    assert.equal(result.converged, true);
    const actual = result.branchCurrents.get('M1').get('drain');
    const expected = oracle('nmos');
    assert.ok(Math.abs(actual - expected) < 1e-12, `${actual} vs ${expected}`);
    assert.ok(Math.abs(actual) > 40e-6, 'the reverse channel, not junction leakage, carries the current');
  });

  it('applies the same role selection to the mirrored PMOS law', { skip: !HAS_NGSPICE }, () => {
    const result = board('pmos');
    assert.equal(result.converged, true);
    const actual = result.branchCurrents.get('M1').get('drain');
    const expected = oracle('pmos');
    // Board reports current out of a PMOS drain; ngspice @id uses current into it.
    assert.ok(Math.abs(actual + expected) < 1e-12, `${actual} vs ${expected}`);
    const sum = [...result.branchCurrents.get('M1').values()].reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum) < 1e-15, `PMOS terminal currents must conserve: ${sum}`);
  });
});
