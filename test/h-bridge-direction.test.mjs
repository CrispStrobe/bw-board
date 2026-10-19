/**
 * `set motor direction` through an H-bridge, and the bridge's clamp diodes
 * (Lite task B7, docs/OPEN-TASKS-2026-09-29.md; spec-updates/set-pwm.md,
 * "Actuator intent").
 *
 * MEASURED FIRST, at master 98414f2e, on the L293D bench below:
 *  - setDeviceControl(motor, 'direction', 'forward' | 'reverse') returned
 *    false ("has no simulator action for this"): the devices extension's
 *    `set motor direction` did nothing, so with `set motor speed` alone the
 *    bridge's IN pins were never driven and the motor stayed at omega 0.
 *  - The dc_motor model clamped omega at 0: driven backwards (IN1 low, IN2
 *    high) the motor did not turn at all, and its state had no `direction`,
 *    so the `direction of motor` reporter said "stopped" for every motor.
 *  - A disabled h_bridge output was an open circuit, so the motor winding's
 *    current had no path when EN dropped: 100 ms of board time after one
 *    EN-low on a spinning motor took 347 s of wall time, and a 500 Hz PWM on
 *    EN (B5's speed route, and any emulated analogWrite on EN) 66 s per 40 ms.
 *    The L293D's output clamp diodes are now real solver diodes
 *    (BoardImpl._expandBridgeClampDiodes). The integrator still latches
 *    'minimum-step-accuracy-unmet' at a diode turn-off, exactly as it does
 *    on the gallery's NPN + flyback-diode motor bench (measured: 5100
 *    attempts per 10 ms of PWM there, 7005 on this bridge), so this file
 *    holds the work bound and the physics, not that flag.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const MS = 1_000_000n;
const t = (part, terminal) => ({ part, terminal });
// A small fast motor (mechanical time constant J*R/(kT*kV) = 20 ms), so a
// run of a few hundred milliseconds reaches its steady speed.
const MOTOR = { kV: 0.05, J: 1e-5, windingR: 5 };

/**
 * MCU -> L293D channel 1 -> DC motor. EN on P1.4 (or tied to VCC), IN1 on
 * P3.4, IN2 on P3.5 — example 54-motor-driver's EXPECTED.md wiring.
 * `swap` puts the motor's `a` lead on OUT2 instead of OUT1.
 */
function bench({ enTied = false, swap = false, inTied = false, load = 0 } = {}) {
  const b = new BoardImpl(5);
  const nets = [
    { id: 'nv', terminals: [t('v', 'vcc'), t('u1', 'vcc'), ...(enTied ? [t('u1', 'en1')] : []), ...(inTied ? [t('u1', 'in1')] : [])] },
    { id: 'ng', terminals: [t('g', 'gnd'), t('u1', 'gnd'), ...(inTied ? [t('u1', 'in2')] : [])] },
    { id: 'na', terminals: [t('u1', swap ? 'out2' : 'out1'), t('m1', 'a')] },
    { id: 'nb', terminals: [t('u1', swap ? 'out1' : 'out2'), t('m1', 'b')] },
  ];
  if (!enTied) nets.push({ id: 'nen', terminals: [t('mcu', 'P1.4'), t('u1', 'en1')] });
  if (!inTied) {
    nets.push({ id: 'ni1', terminals: [t('mcu', 'P3.4'), t('u1', 'in1')] });
    nets.push({ id: 'ni2', terminals: [t('mcu', 'P3.5'), t('u1', 'in2')] });
  }
  b.setNetlist([
    { id: 'mcu', kind: 'mcu', params: {}, terminals: ['P1.4', 'P3.4', 'P3.5'] },
    { id: 'v', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'u1', kind: 'h_bridge', params: {}, terminals: ['vcc', 'gnd', 'en1', 'in1', 'in2', 'out1', 'out2', 'en2', 'in3', 'in4', 'out3', 'out4'] },
    { id: 'm1', kind: 'dc_motor', params: { ...MOTOR, loadTorque: load }, terminals: ['a', 'b'] },
  ], nets);
  b.setPower(true);
  return b;
}

/** pin -> motor -> GND, one MCU pin and no bridge (B1/B5's bench). */
function singlePin({ reversed = false } = {}) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'mcu', kind: 'mcu', params: {}, terminals: ['D9'] },
    { id: 'm1', kind: 'dc_motor', params: { ...MOTOR }, terminals: ['a', 'b'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'n1', terminals: [t('mcu', 'D9'), t('m1', reversed ? 'b' : 'a')] },
    { id: 'n2', terminals: [t('m1', reversed ? 'a' : 'b'), t('g', 'gnd')] },
  ]);
  b.setPower(true);
  return b;
}

const run = (b, ms) => {
  const end = b.timeNs + BigInt(ms) * MS;
  for (let x = b.timeNs + 10n * MS; x <= end; x += 10n * MS) b.advanceTo(x);
};
const level = (b, pin) => b.pinStates.get(pin.toLowerCase())?.driveHigh;
const motor = (b) => b.getDeviceState('m1');
const refusals = (b) => b.getWarnings().map((w) => w.message).join('\n');

describe('set motor direction through an L293D (EN on an MCU pin)', () => {
  it('forward and reverse set IN1/IN2 by the truth table and turn the motor both ways', () => {
    const b = bench();
    assert.equal(b.setDeviceControl('m1', 'speed', 100), true);
    assert.equal(b.setDeviceControl('m1', 'direction', 'forward'), true);
    assert.equal(level(b, 'P3.4'), true, 'forward: IN1 high');
    assert.equal(level(b, 'P3.5'), false, 'forward: IN2 low');
    run(b, 200);
    assert.ok(motor(b).velocity > 1, `turns forward (velocity ${motor(b).velocity})`);
    assert.equal(motor(b).direction, 'forward');
    const forwardSpeed = motor(b).omega;

    assert.equal(b.setDeviceControl('m1', 'direction', 'reverse'), true);
    assert.equal(level(b, 'P3.4'), false, 'reverse: IN1 low');
    assert.equal(level(b, 'P3.5'), true, 'reverse: IN2 high');
    run(b, 400);
    assert.ok(motor(b).velocity < -1, `turns in reverse (velocity ${motor(b).velocity})`);
    assert.equal(motor(b).direction, 'reverse');
    assert.ok(motor(b).omega > 0, 'omega stays the speed (a magnitude)');
    assert.ok(Math.abs(motor(b).omega - forwardSpeed) < 0.02 * forwardSpeed,
      `the same speed both ways (${forwardSpeed} vs ${motor(b).omega})`);
    assert.doesNotMatch(refusals(b), /m1/, 'nothing refused');
  });

  it('the speed is a PWM on the active input with EN held high; a direction change moves it', () => {
    const b = bench();
    b.setDeviceControl('m1', 'speed', 40);
    assert.deepEqual(b.getPwm('P3.4'), { duty: 0.4, hz: 500 }, 'forward: IN1 carries the duty');
    assert.equal(level(b, 'P3.5'), false);
    assert.equal(level(b, 'P1.4'), true, 'EN held high');
    b.setDeviceControl('m1', 'direction', 'reverse');
    assert.deepEqual(b.getPwm('P3.5'), { duty: 0.4, hz: 500 }, 'reverse: IN2 carries it');
    assert.equal(b.getPwm('P3.4'), null);
    assert.equal(level(b, 'P3.4'), false);
    run(b, 300);
    const slow = motor(b).omega;
    const fast = bench();
    fast.setDeviceControl('m1', 'speed', 90);
    fast.setDeviceControl('m1', 'direction', 'reverse');
    run(fast, 300);
    assert.ok(slow > 0 && motor(fast).omega > slow, `speed follows the duty in reverse (${slow} < ${motor(fast).omega})`);
    assert.equal(motor(fast).direction, 'reverse');
  });

  it('`set motor speed` alone runs the motor forward (it used to brake: IN pins undriven)', () => {
    const b = bench();
    b.setDeviceControl('m1', 'speed', 100);
    run(b, 200);
    assert.equal(motor(b).direction, 'forward', `velocity ${motor(b).velocity}`);
  });

  it('a program that drives IN1/IN2 itself keeps them when it only sets the speed (speed on EN)', () => {
    const b = bench();
    b.setPin('P3.4', 'pushpull', false);
    b.setPin('P3.5', 'pushpull', true);
    b.setDeviceControl('m1', 'speed', 100);
    assert.equal(level(b, 'P3.4'), false);
    assert.equal(level(b, 'P3.5'), true);
    assert.deepEqual(b.getPwm('P1.4'), { duty: 1, hz: 500 }, 'the speed went to EN');
    run(b, 200);
    assert.equal(motor(b).direction, 'reverse');
  });

  it('brake holds both inputs and EN high and stops the motor faster than coast', () => {
    const spun = () => { const b = bench(); b.setDeviceControl('m1', 'speed', 100); b.setDeviceControl('m1', 'direction', 'forward'); run(b, 200); return b; };
    const braked = spun();
    const w0 = motor(braked).omega;
    assert.equal(braked.setDeviceControl('m1', 'direction', 'brake'), true);
    assert.equal(level(braked, 'P3.4'), true);
    assert.equal(level(braked, 'P3.5'), true);
    assert.equal(level(braked, 'P1.4'), true, 'EN high (the PWM taken back)');
    assert.equal(braked.getPwm('P1.4'), null);
    run(braked, 30);
    const coasted = spun();
    assert.equal(coasted.setDeviceControl('m1', 'direction', 'coast'), true);
    assert.equal(level(coasted, 'P1.4'), false, 'coast drops EN');
    run(coasted, 30);
    assert.ok(motor(braked).omega < motor(coasted).omega,
      `brake ${motor(braked).omega} < coast ${motor(coasted).omega} (from ${w0})`);
    assert.ok(motor(braked).omega < 0.5 * w0, `brake stops it (${motor(braked).omega} from ${w0})`);
  });

  it('a motor whose `a` lead is on OUT2 is still steered by its own leads', () => {
    const b = bench({ swap: true });
    b.setDeviceControl('m1', 'speed', 100);
    b.setDeviceControl('m1', 'direction', 'forward');
    assert.equal(level(b, 'P3.5'), true, 'IN2 drives OUT2, which carries a');
    assert.equal(level(b, 'P3.4'), false);
    run(b, 200);
    assert.equal(motor(b).direction, 'forward');
  });
});

describe('set motor direction with EN tied high', () => {
  it('the speed moves to the active input as a PWM, the other input low', () => {
    const b = bench({ enTied: true });
    assert.equal(b.setDeviceControl('m1', 'speed', 60), true);
    assert.deepEqual(b.getPwm('P3.4'), { duty: 0.6, hz: 500 });
    assert.equal(level(b, 'P3.5'), false);
    run(b, 200);
    assert.equal(motor(b).direction, 'forward');
    assert.equal(b.setDeviceControl('m1', 'direction', 'reverse'), true);
    assert.deepEqual(b.getPwm('P3.5'), { duty: 0.6, hz: 500 }, 'the PWM moves to IN2');
    assert.equal(b.getPwm('P3.4'), null);
    assert.equal(level(b, 'P3.4'), false);
    run(b, 400);
    assert.equal(motor(b).direction, 'reverse');
  });

  it('coast is refused by name: with EN tied, both inputs low is a brake', () => {
    const b = bench({ enTied: true });
    assert.equal(b.setDeviceControl('m1', 'direction', 'coast'), false);
    assert.match(refusals(b), /u1\.EN1 is not driven by an MCU pin, so the bridge cannot release the motor/);
  });
});

describe('what direction cannot drive is refused by name', () => {
  it('a motor on one MCU pin turns one way: forward is accepted, reverse and brake are refused', () => {
    const b = singlePin();
    assert.equal(b.setDeviceControl('m1', 'direction', 'forward'), true);
    for (const dir of ['reverse', 'brake']) {
      const c = singlePin();
      assert.equal(c.setDeviceControl('m1', 'direction', dir), false, dir);
      assert.match(refusals(c), /driven by one MCU pin \(D9\) through a single switch, which turns it one way only/);
    }
  });

  it('a bridge whose inputs are tied cannot be steered', () => {
    const b = bench({ inTied: true });
    assert.equal(b.setDeviceControl('m1', 'direction', 'reverse'), false);
    assert.match(refusals(b), /u1\.IN1 and u1\.IN2 are not driven by an MCU pin/);
    // EN still carries the speed (B5's route), in the direction the wiring fixes.
    assert.equal(b.setDeviceControl('m1', 'speed', 100), true);
    assert.deepEqual(b.getPwm('P1.4'), { duty: 1, hz: 500 });
  });

  it('a word that is not a direction is refused', () => {
    const b = bench();
    assert.equal(b.setDeviceControl('m1', 'direction', 'sideways'), false);
    assert.match(refusals(b), /"sideways" is not a direction/);
  });
});

describe('the dc_motor model turns both ways', () => {
  it('a motor wired b-to-pin turns in reverse (it used to sit still)', () => {
    const b = singlePin({ reversed: true });
    b.setPin('D9', 'pushpull', true);
    run(b, 200);
    assert.ok(motor(b).velocity < -1, `velocity ${motor(b).velocity}`);
    assert.equal(motor(b).direction, 'reverse');
    assert.ok(motor(b).omega > 1, 'omega is the speed');
  });

  it('a motor at rest reports stopped', () => {
    const b = singlePin();
    run(b, 50);
    assert.equal(motor(b).direction, 'stopped');
    assert.equal(motor(b).omega, 0);
  });
});

describe('the L293D clamp diodes', () => {
  // Bounded by the integrator's own work counter, not by wall time, so a
  // regression fails in seconds instead of grinding for minutes: with the
  // outputs open (the model before the clamp) the first millisecond after EN
  // low hit the 20000-attempt backstop and 4 ms of EN PWM took 40052 attempts;
  // with the clamp diodes, about 1500 per 10 ms and 4900 per 4 ms.
  const attempts = (b) => b.transientAnalysisStatus().work.attempts;

  it('EN low on a spinning motor: the winding current decays through the diodes, within the rails', () => {
    // Loaded, so the winding carries ~0.1 A at speed (unloaded, the back-EMF
    // cancels the drive and there is next to no current to commutate).
    const b = bench({ load: 0.005 });
    b.setPin('P1.4', 'pushpull', true);
    b.setPin('P3.4', 'pushpull', true);
    b.setPin('P3.5', 'pushpull', false);
    run(b, 200);
    assert.ok(motor(b).current > 0.05, `driven current ${motor(b).current} A`);
    const a0 = attempts(b);
    b.setPin('P1.4', 'pushpull', false);
    let worst = 0;
    for (let i = 0; i < 20; i++) {
      b.advanceTo(b.timeNs + 50_000n); // 50 us steps through the first ms
      worst = Math.max(worst, Math.abs(b.nodeVoltage('na')), Math.abs(b.nodeVoltage('nb')));
    }
    const work = attempts(b) - a0;
    assert.ok(work < 2000, `the first ms after EN low took ${work} integrator attempts (open outputs: 20000)`);
    assert.ok(worst < 5 + 0.7 + 0.5, `outputs stay within a diode drop of the rails (worst ${worst} V)`);
    assert.ok(Math.abs(motor(b).current) < 0.005, `current gone within 1 ms (${motor(b).current} A)`);
  });

  it('a PWM on EN advances in bounded work and gives a speed that follows its duty', () => {
    const speedAt = (pct) => {
      const b = bench();
      b.setPin('P3.4', 'pushpull', true);
      b.setPin('P3.5', 'pushpull', false);
      b.setPwm('P1.4', pct);
      const a0 = attempts(b);
      for (let ms = 1; ms <= 4; ms++) b.advanceTo(BigInt(ms) * MS);
      const work = attempts(b) - a0;
      assert.ok(work < 15000, `${pct} %: 4 ms of EN PWM took ${work} attempts (open outputs: 40052)`);
      run(b, 20);
      return motor(b).omega;
    };
    const w = [25, 50, 100].map(speedAt);
    assert.ok(w[0] > 0 && w[0] < w[1] && w[1] < w[2], `omega ${w.join(' < ')}`);
  });

  it('the diodes are solver-only: the drawn netlist still holds one L293D; clampDiodes: false omits them', () => {
    const b = bench();
    assert.deepEqual(b.parts.filter((p) => p.kind === 'diode'), [], 'nothing added to the drawn parts');
    const clamps = b._solveParts.filter((p) => p.id.startsWith('u1_clamp_')).map((p) => p.id).sort();
    assert.deepEqual(clamps, ['u1_clamp_out1_hi', 'u1_clamp_out1_lo', 'u1_clamp_out2_hi', 'u1_clamp_out2_lo'],
      'two per CONNECTED output (out3/out4 are not wired)');
    const bare = bench();
    bare.parts.find((p) => p.id === 'u1').params.clampDiodes = false;
    bare.setNetlist(bare.parts, bare.nets);
    assert.deepEqual(bare._solveParts.filter((p) => p.id.startsWith('u1_clamp_')), []);
  });
});
