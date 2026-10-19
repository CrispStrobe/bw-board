import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';

// reset() starts a new transient history at t = 0, so it must leave the
// adaptive controller where a fresh board has it. It used to keep the last
// accepted step size (_transH, which grows to ~0.27 ms on a spinning winding)
// and the trapezoidal history: the next startup began from that stale step,
// the stiff winding edge drove the controller to its 1e-15 s floor with the
// error still above tolerance, and advanceToLive then refused the whole run
// ("advanceToLive refuses failed transient history") — the intermittent
// green-flag failure of Lite's 54-motor-driver bench after a restart.
const net = (id, ...terminals) => ({id,
  terminals: terminals.map(([part, terminal]) => ({part, terminal}))});
function winding() {
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vcc',params:{},terminals:['vcc']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'M',kind:'mcu',params:{},terminals:['P1.0','P1.4']},
    {id:'RB',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
    {id:'Q',kind:'npn',params:{vceSat:.2},terminals:['base','collector','emitter']},
    {id:'L',kind:'inductor',params:{henrys:.005},terminals:['a','b']},
    {id:'RW',kind:'resistor',params:{ohms:10},terminals:['a','b']},
    {id:'D',kind:'diode',params:{vf:.7},terminals:['anode','cathode']},
  ],[
    net('supply',['V','vcc'],['L','a'],['D','cathode']),
    net('zero',['G','gnd'],['Q','emitter']),
    net('pin',['M','P1.4'],['RB','a']),
    net('base',['RB','b'],['Q','base']),
    net('winding',['L','b'],['RW','a']),
    net('collector',['RW','b'],['Q','collector'],['D','anode']),
  ]);
  b.setPower(true);
  return b;
}
const arm = b => { b.reset(); b.setPin('P1.4', 'quasi', true); };
const run = (b, endNs) => { while (b.getTime() < endNs) b.advanceToLive(endNs, {maxSteps: 16}); };

test('a restart after a long run integrates like a fresh board', () => {
  const fresh = winding(); arm(fresh);
  run(fresh, 1_510_691n);
  assert.equal(fresh.transientAnalysisStatus().accuracyMet, true);

  const restarted = winding(); arm(restarted);
  run(restarted, 80_564_413n);
  arm(restarted);
  assert.doesNotThrow(() => run(restarted, 1_510_691n), 'the restarted run advances');
  assert.equal(restarted.getTime(), 1_510_691n);
  assert.equal(restarted.transientAnalysisStatus().accuracyMet, true);
  assert.equal(restarted.inductorCurrents.get('L'), fresh.inductorCurrents.get('L'),
    'same winding current as the fresh board at the same time: no state carried over');
});

test('a failed transient history ends with the run: reset clears the refusal', () => {
  const b = winding(); arm(b);
  b._transientAccuracyUnmet = {code: 'minimum-step-accuracy-unmet', timeSec: 0, stepSec: 1e-15, normalizedError: 2};
  b._transientAttemptOverflow = true;
  assert.throws(() => b.advanceToLive(1_000_000n, {maxSteps: 16}), /refuses failed transient history/);
  arm(b);
  assert.notEqual(b.transientAnalysisStatus().accuracyMet, false, 'no refusal survives the reset');
  run(b, 1_000_000n);
  assert.equal(b.getTime(), 1_000_000n);
  assert.equal(b.transientAnalysisStatus().accuracyMet, true);
});

// The motor-driver bench Lite ships (an MCU pin through 1 kOhm into an NPN
// switching a DC motor with a flyback diode). A 9.536 us first advance left
// the trapezoidal history out of step with the motor's back-EMF stamp; from
// there the full step and the half steps disagreed by 0.92 mV at the winding
// node at EVERY step size, down to the 1e-15 s floor, and the run was refused.
// That signature is ringing, not truncation error, and a damped restart of
// the history removes it.
import { registerDCMotor } from '../src/devices/dc-motor.js';
function motorBench() {
  registerDCMotor();
  const b = new BoardImpl(5);
  b.setNetlist([
    {id:'V',kind:'vcc',params:{},terminals:['vcc']},
    {id:'G',kind:'gnd',params:{},terminals:['gnd']},
    {id:'M',kind:'mcu',params:{},terminals:['P1.0','P1.4']},
    {id:'R',kind:'resistor',params:{ohms:1000},terminals:['a','b']},
    {id:'Q',kind:'npn',params:{},terminals:['base','collector','emitter']},
    {id:'MOT',kind:'dc_motor',params:{},terminals:['a','b']},
    {id:'D',kind:'diode',params:{vf:0.7},terminals:['anode','cathode']},
  ],[
    net('supply',['V','vcc'],['MOT','a'],['D','cathode']),
    net('zero',['G','gnd'],['Q','emitter']),
    net('pin',['M','P1.4'],['R','a']),
    net('base',['R','b'],['Q','base']),
    net('collector',['MOT','b'],['Q','collector'],['D','anode']),
  ]);
  b.setPower(true);
  arm(b);
  return b;
}

test('a short first advance does not strand the motor bench at the step floor', () => {
  const b = motorBench();
  run(b, 9_536n);
  assert.doesNotThrow(() => run(b, 11_122_069n));
  assert.equal(b.getTime(), 11_122_069n);
  assert.equal(b.transientAnalysisStatus().accuracyMet, true);
});

test('a reset brings the motor to rest', () => {
  const b = motorBench();
  run(b, 20_000_000n);
  assert.ok(b.getDeviceState('MOT').omega > 0, 'the motor is turning before the reset');
  arm(b);
  const st = b.getDeviceState('MOT');
  assert.deepEqual([st.velocity, st.omega, st.current, st.direction], [0, 0, 0, 'stopped']);
});
