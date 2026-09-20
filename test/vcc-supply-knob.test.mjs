/**
 * The vcc symbol is a bench supply you can turn.
 *
 * The solver has honoured `params.volts` on a vcc part for as long as the
 * 3.3 V rail has existed, and the current out of that part has always been
 * solved — but `vcc` was missing from getControls(), so no panel offered a
 * knob and the only way to run the Zener regulator at 9 V was to hand-edit
 * its JSON. Owner report: "in examples like Zener voltage regulator we must
 * be able to change for vcc1 how much volt is delivered. and what about
 * amperes?" Both answers were already in the engine; neither was reachable.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const OHMS = 1000;

function railBench(params = {}, boardVcc = 5) {
  const board = new BoardImpl(boardVcc);
  board.setNetlist([
    { id: 'VCC1', kind: 'vcc', params, terminals: ['vcc'] },
    { id: 'R1', kind: 'resistor', params: { ohms: OHMS }, terminals: ['a', 'b'] },
    { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'rail', terminals: [{ part: 'VCC1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
    { id: 'gnd', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'G1', terminal: 'gnd' }] },
  ]);
  board.setPower(true);
  return board;
}

/** Current OUT of the supply, in amps. Positive is into a terminal. */
const supplyAmps = board => -board.operatingPoint().branchCurrents.get('VCC1').get('vcc');

describe('vcc: the supply knob', () => {
  it('offers a control whose rest value is the rail it already has', () => {
    assert.deepEqual(railBench().getControls(),
      [{ id: 'VCC1', kind: 'vcc', value: 5 }], 'board default');
    assert.deepEqual(railBench({ volts: 3.3 }).getControls(),
      [{ id: 'VCC1', kind: 'vcc', value: 3.3 }], 'authored rail wins over the board default');
    const turned = railBench({ volts: 3.3 });
    turned.setControl('VCC1', 9);
    assert.deepEqual(turned.getControls(),
      [{ id: 'VCC1', kind: 'vcc', value: 9 }], 'and the knob wins over both');
  });

  it('delivers the voltage the knob asks for', () => {
    const board = railBench();
    for (const volts of [5, 9, 3.3, 12, 1.5]) {
      board.setControl('VCC1', volts);
      const rail = board.operatingPoint().nodeVoltages.get('rail');
      assert.ok(Math.abs(rail - volts) < 1e-9, `knob ${volts} V gave ${rail} V`);
    }
  });

  it('answers the amperes question too, and Ohm agrees', () => {
    // The current was always solved; nothing exposed it beside the voltage.
    const board = railBench();
    for (const volts of [5, 9, 3.3]) {
      board.setControl('VCC1', volts);
      const amps = supplyAmps(board);
      assert.ok(Math.abs(amps - volts / OHMS) < 1e-9,
        `${volts} V into ${OHMS} ohm should draw ${volts / OHMS} A, got ${amps}`);
    }
  });

  it('agrees between the closed-form seed and the MNA solve', () => {
    // Three separate sites read the rail. A nonlinear part moves the net from
    // the closed-form resolver to MNA, so a disagreement shows up as the rail
    // changing when an unrelated LED is added — which is exactly the class of
    // bug that made the shift-register outputs die.
    const withDiode = new BoardImpl(5);
    withDiode.setNetlist([
      { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'R1', kind: 'resistor', params: { ohms: OHMS }, terminals: ['a', 'b'] },
      { id: 'D1', kind: 'led', params: { vf: 2 }, terminals: ['anode', 'cathode'] },
      { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ], [
      { id: 'rail', terminals: [{ part: 'VCC1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
      { id: 'gnd', terminals: [{ part: 'D1', terminal: 'cathode' }, { part: 'G1', terminal: 'gnd' }] },
    ]);
    withDiode.setPower(true);
    withDiode.setControl('VCC1', 9);
    const rail = withDiode.nodeVoltage('rail');
    assert.ok(Math.abs(rail - 9) < 1e-6, `nonlinear load moved the rail to ${rail}`);
  });

  it('leaves a board with no vcc symbol exactly as it was', () => {
    // vsource benches must not grow a phantom control.
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'V1', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
      { id: 'R1', kind: 'resistor', params: { ohms: OHMS }, terminals: ['a', 'b'] },
      { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ], [
      { id: 'n', terminals: [{ part: 'V1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'V1', terminal: 'neg' }, { part: 'R1', terminal: 'b' },
        { part: 'G1', terminal: 'gnd' }] },
    ]);
    board.setPower(true);
    assert.deepEqual(board.getControls().map(c => c.kind), ['vsource']);
  });

  it('keeps two rails independent', () => {
    // The 3.3 V rail beside the 5 V one is the case params.volts was added for;
    // turning one knob must not move the other.
    const board = new BoardImpl(5);
    board.setNetlist([
      { id: 'VCC5', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'VCC3', kind: 'vcc', params: { volts: 3.3 }, terminals: ['vcc'] },
      { id: 'R1', kind: 'resistor', params: { ohms: OHMS }, terminals: ['a', 'b'] },
      { id: 'R2', kind: 'resistor', params: { ohms: OHMS }, terminals: ['a', 'b'] },
      { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ], [
      { id: 'hi', terminals: [{ part: 'VCC5', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'lo', terminals: [{ part: 'VCC3', terminal: 'vcc' }, { part: 'R2', terminal: 'a' }] },
      { id: 'gnd', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'b' },
        { part: 'G1', terminal: 'gnd' }] },
    ]);
    board.setPower(true);
    board.setControl('VCC5', 12);
    const op = board.operatingPoint();
    assert.ok(Math.abs(op.nodeVoltages.get('hi') - 12) < 1e-9, 'the turned rail moves');
    assert.ok(Math.abs(op.nodeVoltages.get('lo') - 3.3) < 1e-9, 'the other rail does not');
  });
});
