/**
 * vcvs / vccs — hand oracles per spec-updates/controlled-sources.md.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';

const VCC = { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] };
const GND = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

function dividerDrivenBench(srcParams) {
  // 5 V → 9k/1k divider → 0.5 V control; source output into a 1 kΩ load.
  const parts = [VCC, GND, R('RA', 9000), R('RB', 1000), R('RL', 1000),
    { id: 'S1', kind: srcParams.kind, params: srcParams.params,
      terminals: ['outp', 'outn', 'inp', 'inn'] }];
  const nets = [
    { id: 'n_vcc', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'RA', terminal: 'a' }] },
    { id: 'n_ctl', terminals: [
      { part: 'RA', terminal: 'b' }, { part: 'RB', terminal: 'a' },
      { part: 'S1', terminal: 'inp' },
    ] },
    { id: 'n_out', terminals: [{ part: 'S1', terminal: 'outp' }, { part: 'RL', terminal: 'a' }] },
    { id: 'n_gnd', terminals: [
      { part: 'G1', terminal: 'gnd' },
      { part: 'RB', terminal: 'b' }, { part: 'RL', terminal: 'b' },
      { part: 'S1', terminal: 'outn' }, { part: 'S1', terminal: 'inn' },
    ] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  return board;
}

function groundedOutpBench(volts) {
  const board = new BoardImpl(5);
  board.setNetlist([
    { id: 'V1', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
    { id: 'E1', kind: 'vcvs', params: { gain: 2 },
      terminals: ['outp', 'outn', 'inp', 'inn'] },
    R('RL', 1000), GND,
  ], [
    { id: 'in', terminals: [
      { part: 'V1', terminal: 'pos' }, { part: 'E1', terminal: 'inp' },
    ] },
    { id: 'out', terminals: [
      { part: 'E1', terminal: 'outn' }, { part: 'RL', terminal: 'a' },
    ] },
    { id: 'gnd', terminals: [
      { part: 'V1', terminal: 'neg' }, { part: 'E1', terminal: 'inn' },
      { part: 'E1', terminal: 'outp' }, { part: 'RL', terminal: 'b' },
      { part: 'G1', terminal: 'gnd' },
    ] },
  ]);
  return board;
}

describe('vcvs', () => {
  it('allocates a row with grounded outp and matches ngspice for both polarities', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
  }, () => {
    for (const vin of [1, -1]) {
      const board = groundedOutpBench(vin);
      const expectedOut = -2 * vin;
      const expectedEOutn = expectedOut / 1000;
      assert.ok(Math.abs(board.nodeVoltage('out') - expectedOut) < 1e-10,
        `${vin} V control must produce ${expectedOut} V at grounded-outp E1`);
      assert.ok(Math.abs(board.branchCurrent('E1', 'outn') - expectedEOutn) < 5e-12);
      // Both public terminal currents are out-of-part: sum at the shared net.
      assert.ok(Math.abs(board.branchCurrent('E1', 'outn')
        + board.branchCurrent('RL', 'a')) < 5e-12, `${vin} V live-node KCL`);

      const deck = `self-authored grounded-outp VCVS\nV1 in 0 DC ${vin}\n`
        + 'E1 0 out in 0 2\nR1 out 0 1k\n.control\nset numdgt=15\nop\n'
        + 'print v(out) @e1[i]\n.endc\n.end\n';
      const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
      assert.equal(ng.status, 0, ng.stderr || ng.stdout);
      const vMatch = ng.stdout.match(/v\(out\)\s*=\s*([-+0-9.e]+)/i);
      const iMatch = ng.stdout.match(/@e1\[i\]\s*=\s*([-+0-9.e]+)/i);
      assert.ok(vMatch && iMatch, ng.stdout);
      assert.ok(Math.abs(board.nodeVoltage('out') - Number(vMatch[1])) < 1e-10);
      assert.ok(Math.abs(board.branchCurrent('E1', 'outp') + Number(iMatch[1])) < 1e-10);
    }
  });

  it('gain 10: 0.5 V control → 5.000 V into the load, current in the row', () => {
    const b = dividerDrivenBench({ kind: 'vcvs', params: { gain: 10 } });
    const vOut = b.nodeVoltage('n_out');
    assert.ok(Math.abs(vOut - 5.0) < 1e-6, `out must be 5.000, got ${vOut}`);
    const i = b.branchCurrent('S1', 'outp');
    assert.ok(Math.abs(Math.abs(i) - 5e-3) < 1e-6,
      `row carries the 5 mA load current, got ${(i * 1e3).toFixed(4)} mA`);
    // Control pins are ideal: the divider is undisturbed (0.5 V exactly).
    assert.ok(Math.abs(b.nodeVoltage('n_ctl') - 0.5) < 1e-9, 'no control loading');
  });

  it('rails: gain 1e6 with 0.5 V control sits AT railHigh', () => {
    const b = dividerDrivenBench({
      kind: 'vcvs', params: { gain: 1e6, railLow: 0, railHigh: 5 } });
    const vOut = b.nodeVoltage('n_out');
    assert.ok(Math.abs(vOut - 5.0) < 1e-6, `railed at 5.000, got ${vOut}`);
  });
});

describe('vccs', () => {
  it('gm 1 mS: 2 V control → 2.000 mA into 1 kΩ (2.000 V)', () => {
    // Control from a stiffer divider: 3k/2k → 2.0 V.
    const b = dividerDrivenBench({ kind: 'vccs', params: { gm: 1e-3 } });
    // 0.5 V control → 0.5 mA → 0.5 V on the load.
    const vOut = b.nodeVoltage('n_out');
    assert.ok(Math.abs(vOut - 0.5) < 1e-6, `0.5 mA into 1 kΩ = 0.500 V, got ${vOut}`);
  });

  it('iMax is a DYNAMIC limit: DC ignores it (stated in the spec)', () => {
    // At DC a slew clamp is meaningless and makes an integrator-loop
    // operating point a clamp± ping-pong through the rails — so the
    // clamp engages only in transient (the macromodel slew oracle in
    // test/opamp-macromodel.test.mjs is the dynamic proof). Here the DC
    // answer is the UNclamped 5 mA despite iMax 1 mA.
    const b = dividerDrivenBench({ kind: 'vccs', params: { gm: 10e-3, iMax: 1e-3 } });
    const vOut = b.nodeVoltage('n_out');
    assert.ok(Math.abs(vOut - 5.0) < 1e-6,
      `DC is unclamped: 5 mA into 1 kΩ = 5.000 V, got ${vOut}`);
  });
});
