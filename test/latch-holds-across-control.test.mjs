/**
 * A user action re-solves FROM THE PRESENT STATE: a latched two-transistor
 * thyristor stays latched when an unrelated control moves.
 *
 * A setControl is a discrete event: the board re-solves the operating point
 * (_solveForUserAction). That solve must continue from where the circuit is,
 * as SPICE continues a transient from its last timepoint; started from a
 * guess that is not the present state it may find the circuit's other
 * stable point, and a thyristor that was conducting switched itself off when
 * the learner turned a knob somewhere else on the bench.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

/** NPN + PNP thyristor with an LED load, a gate button, and (elsewhere on
 * the bench) a pot dimming a second LED, with a capacitor so the board
 * integrates in time. */
function bench() {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    R('RL', 1000), { id: 'LED', kind: 'led', params: { color: 'red' }, terminals: ['anode', 'cathode'] },
    { id: 'QP', kind: 'pnp', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] },
    { id: 'QN', kind: 'npn', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] },
    R('RAK', 22000), R('RGK', 10000), R('RG', 10000),
    { id: 'GATE', kind: 'button', params: {}, terminals: ['a', 'b'] },
    { id: 'POT', kind: 'potentiometer', params: { ohms: 10000, position: 0.5 }, terminals: ['a', 'wiper', 'b'] },
    R('R2', 1000), { id: 'LED2', kind: 'led', params: { color: 'green' }, terminals: ['anode', 'cathode'] },
    { id: 'C', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
  ], [
    net('vp', ['V', 'pos'], ['RL', 'a'], ['GATE', 'a'], ['POT', 'a']),
    net('l', ['RL', 'b'], ['LED', 'anode']),
    net('k', ['LED', 'cathode'], ['QP', 'emitter'], ['RAK', 'a']),
    net('pb', ['QP', 'base'], ['RAK', 'b'], ['QN', 'collector']),
    net('nb', ['QP', 'collector'], ['QN', 'base'], ['RGK', 'a'], ['RG', 'b']),
    net('gt', ['GATE', 'b'], ['RG', 'a']),
    net('w', ['POT', 'wiper'], ['R2', 'a'], ['C', 'a']),
    net('l2', ['R2', 'b'], ['LED2', 'anode']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['QN', 'emitter'], ['RGK', 'b'], ['POT', 'b'], ['LED2', 'cathode'], ['C', 'b']),
  ]);
  b.setPower(true);
  return b;
}

/** The slave-flash thyristor (sb3 lab-scr-flash) WITHOUT its 10 nF gate
 * capacitor: a phototransistor's emitter, through 100 nF and a diode, gives
 * the gate a pulse when the light JUMPS; a small step of light must not fire
 * it. */
function slaveFlash() {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    R('RL', 470), { id: 'FL', kind: 'led', params: { color: 'white' }, terminals: ['anode', 'cathode'] },
    { id: 'QP', kind: 'pnp', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] },
    { id: 'QN', kind: 'npn', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] },
    R('RAK', 4700), R('RGK', 1000), R('RBL', 47000),
    { id: 'PT', kind: 'phototransistor', params: {}, terminals: ['collector', 'emitter'] },
    R('RE', 1000), { id: 'CG', kind: 'capacitor', params: { farads: 100e-9 }, terminals: ['a', 'b'] },
    R('RPD', 10000), { id: 'DG', kind: 'diode', params: { part: '1N4148' }, terminals: ['anode', 'cathode'] }, R('RG', 1000),
  ], [
    net('vp', ['V', 'pos'], ['RL', 'a'], ['PT', 'collector']),
    net('l', ['RL', 'b'], ['FL', 'anode']),
    net('k', ['FL', 'cathode'], ['QP', 'emitter'], ['RAK', 'a'], ['RBL', 'a']),
    net('pb', ['QP', 'base'], ['RAK', 'b'], ['QN', 'collector']),
    net('nb', ['QP', 'collector'], ['QN', 'base'], ['RGK', 'a'], ['RG', 'b']),
    net('e', ['PT', 'emitter'], ['RE', 'a'], ['CG', 'a']),
    net('d', ['CG', 'b'], ['RPD', 'a'], ['DG', 'anode']),
    net('dk', ['DG', 'cathode'], ['RG', 'a']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['QN', 'emitter'], ['RGK', 'b'], ['RBL', 'b'], ['RE', 'b'], ['RPD', 'b']),
  ]);
  b.setPower(true);
  return b;
}

describe('a user action re-solves from the present state', () => {
  it('slave flash: small steps of light leave the thyristor off; a jump fires it', () => {
    const b = slaveFlash();
    let t = 0n;
    const run = (ms) => { t += BigInt(Math.round(ms * 1e6)); b.advanceTo(t); assert.equal(b.transientAnalysisStatus().failure, null); };
    run(5);
    const off = b.nodeVoltage('k');
    assert.ok(off > 5, `off at the start: anode ${off} V`);
    for (const light of [0.1, 0.2, 0.3, 0.4, 0.5, 0.6]) {
      b.setControl('PT', light);
      assert.ok(b.nodeVoltage('k') > 5, `light ${light}: still off right after the step (anode ${b.nodeVoltage('k')} V)`);
      run(5);
      assert.ok(b.nodeVoltage('k') > 5, `light ${light}: still off 5 ms later (anode ${b.nodeVoltage('k')} V)`);
    }
    b.setControl('PT', 0); run(5);
    b.setControl('PT', 0.8); run(5);
    assert.ok(b.nodeVoltage('k') < 1.5, `a jump of light fires it: anode ${b.nodeVoltage('k')} V`);
  });

  it('an OFF thyristor stays off when an unrelated knob turns', () => {
    const b = bench();
    let t = 0n;
    const run = (ms) => { t += BigInt(Math.round(ms * 1e6)); b.advanceTo(t); assert.equal(b.transientAnalysisStatus().failure, null); };
    run(5);
    for (const position of [0.2, 0.8, 0.5, 1, 0]) {
      b.setControl('POT', position);
      assert.ok(b.ledBrightness('LED') < 0.01, `still off right after the knob moved to ${position}: ${b.ledBrightness('LED')}`);
      run(2);
      assert.ok(b.ledBrightness('LED') < 0.01, `still off 2 ms after the knob moved to ${position}: ${b.ledBrightness('LED')}`);
    }
  });

  it('a latched thyristor stays on when an unrelated knob turns', () => {
    const b = bench();
    let t = 0n;
    const run = (ms) => { t += BigInt(Math.round(ms * 1e6)); b.advanceTo(t); assert.equal(b.transientAnalysisStatus().failure, null); };
    run(5);
    assert.ok(b.ledBrightness('LED') < 0.01, 'off before the gate pulse');
    b.setControl('GATE', 1); run(2); b.setControl('GATE', 0); run(5);
    const on = b.ledBrightness('LED');
    assert.ok(on > 0.2, `latched on after the gate pulse: ${on}`);
    for (const position of [0.2, 0.8, 0.5, 1, 0]) {
      b.setControl('POT', position);
      assert.ok(b.ledBrightness('LED') > 0.2, `still on right after the knob moved to ${position}: ${b.ledBrightness('LED')}`);
      run(2);
      assert.ok(b.ledBrightness('LED') > 0.2, `still on 2 ms after the knob moved to ${position}: ${b.ledBrightness('LED')}`);
    }
  });
});
