/**
 * gearmotor and dc_motor_encoder turn both ways (Lite task B14,
 * docs/OPEN-TASKS-2026-09-29.md; B7 made dc_motor signed, this extends it).
 *
 * MEASURED FIRST, at master 18fa8508, on the L293D bench below (kV 0.05,
 * J 1e-5, windingR 5; EN, IN1, IN2 on MCU pins; 200 ms):
 *  - program forward (IN1 high, IN2 low): gearmotor omega 17.51 rad/s,
 *    dc_motor_encoder omega 16.92, angle 3.18, slot 40.
 *  - program reverse (IN1 low, IN2 high): both omega 0, the encoder's angle 0
 *    — both models clamped omega at 0, so backwards they sat still.
 *  - setDeviceControl(m, 'speed' | 'direction', ...) returned false on both
 *    ("has no simulator action for this"): B7's routes were dc_motor-only.
 *  - FOUND: both models stamped the back-EMF as a Norton pair with the EMF
 *    INVERTED — the bug dc_motor shed earlier (test/referenced-drives.test.mjs).
 *    A driven motor ran at ~40 % of V/kV (17.5 vs ~44 rad/s; 4.33 vs dc_motor's
 *    35.6 on a 50 % PWM pin), an open-circuit (EN-low) motor braked itself to
 *    0 in 40 ms, and once signed a rotor coasting to 0 crept into reverse
 *    (stale solve, inverted EMF). They now use dc_motor's Thevenin stamp.
 *
 * The signed velocity step is dc_motor's own (stepMotorVelocity): with the
 * old stamp kept, a forward-driven trace of both models (bridge, PWM pin,
 * supply; every state field at every 1 ms for 150 ms) is bit-identical to
 * master — the integrator changes nothing forward. dc_motor's trace is
 * bit-identical with the final code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const MS = 1_000_000n;
const t = (part, terminal) => ({ part, terminal });
const MOTOR = { kV: 0.05, J: 1e-5, windingR: 5 };
const KINDS = ['gearmotor', 'dc_motor_encoder'];
const terminalsOf = (kind) => (kind === 'dc_motor_encoder' ? ['a', 'b', 'enc_a', 'enc_b'] : ['a', 'b']);

/** MCU -> L293D channel 1 -> motor; EN P1.4, IN1 P3.4, IN2 P3.5 (B7's bench). */
function bench(kind, params = MOTOR) {
  const b = new BoardImpl(5);
  const nets = [
    { id: 'nv', terminals: [t('v', 'vcc'), t('u1', 'vcc')] },
    { id: 'ng', terminals: [t('g', 'gnd'), t('u1', 'gnd')] },
    { id: 'na', terminals: [t('u1', 'out1'), t('m1', 'a')] },
    { id: 'nb', terminals: [t('u1', 'out2'), t('m1', 'b')] },
    { id: 'nen', terminals: [t('mcu', 'P1.4'), t('u1', 'en1')] },
    { id: 'ni1', terminals: [t('mcu', 'P3.4'), t('u1', 'in1')] },
    { id: 'ni2', terminals: [t('mcu', 'P3.5'), t('u1', 'in2')] },
  ];
  b.setNetlist([
    { id: 'mcu', kind: 'mcu', params: {}, terminals: ['P1.4', 'P3.4', 'P3.5'] },
    { id: 'v', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'u1', kind: 'h_bridge', params: {}, terminals: ['vcc', 'gnd', 'en1', 'in1', 'in2', 'out1', 'out2', 'en2', 'in3', 'in4', 'out3', 'out4'] },
    { id: 'm1', kind, params, terminals: terminalsOf(kind) },
  ], nets);
  b.setPower(true);
  return b;
}

/** The program drives the bridge itself: EN high, IN1/IN2 by the truth table. */
function programDrive(b, dir) {
  b.setPin('P1.4', 'pushpull', true);
  b.setPin('P3.4', 'pushpull', dir === 'forward');
  b.setPin('P3.5', 'pushpull', dir === 'reverse');
}

const run = (b, ms, stepMs = 10) => {
  const end = b.timeNs + BigInt(ms) * MS;
  const step = BigInt(stepMs * 1e6);
  for (let x = b.timeNs + step; x <= end; x += step) b.advanceTo(x);
};
const motor = (b) => b.getDeviceState('m1');
const refusals = (b) => b.getWarnings().map((w) => w.message).join('\n');

for (const kind of KINDS) {
  describe(`${kind}: reverse through an L293D`, () => {
    it('a program driving IN2 high turns it backwards at the forward speed', () => {
      const fwd = bench(kind);
      programDrive(fwd, 'forward');
      run(fwd, 200);
      const rev = bench(kind);
      programDrive(rev, 'reverse');
      run(rev, 200);
      const f = motor(fwd);
      const r = motor(rev);
      assert.ok(f.velocity > 1, `forward velocity ${f.velocity}`);
      assert.equal(f.direction, 'forward');
      assert.ok(r.velocity < -1, `reverse velocity ${r.velocity} (was 0: omega clamped at 0)`);
      assert.equal(r.direction, 'reverse');
      assert.equal(r.omega, Math.abs(r.velocity), 'omega stays the speed (a magnitude)');
      assert.ok(Math.abs(r.omega - f.omega) < 0.01 * f.omega,
        `the same speed both ways (${f.omega} vs ${r.omega})`);
      if (kind === 'gearmotor') {
        assert.ok(Math.abs(r.outputRpm - (r.omega * 60 / (2 * Math.PI)) / 48) < 1e-9,
          'outputRpm is the output shaft speed (magnitude) through the 48:1 gear');
      }
    });

    it('`set motor speed` + `set motor direction` drive it both ways (B7\'s routes)', () => {
      const b = bench(kind);
      assert.equal(b.setDeviceControl('m1', 'speed', 100), true);
      assert.equal(b.setDeviceControl('m1', 'direction', 'forward'), true);
      run(b, 200);
      assert.equal(motor(b).direction, 'forward', `velocity ${motor(b).velocity}`);
      assert.equal(b.setDeviceControl('m1', 'direction', 'reverse'), true);
      assert.equal(b.pinStates.get('p3.4')?.driveHigh, false, 'reverse: IN1 low');
      run(b, 400);
      assert.ok(motor(b).velocity < -1, `turns in reverse (velocity ${motor(b).velocity})`);
      assert.equal(motor(b).direction, 'reverse');
      assert.doesNotMatch(refusals(b), /m1/, 'nothing refused');
    });

    it('back-EMF has the right sign: steady speed ~ V/kV, and an open (EN-low) motor coasts on', () => {
      const b = bench(kind);
      programDrive(b, 'forward');
      run(b, 200);
      const driven = motor(b).velocity;
      // Bridge outputs 3.6 V / 1.4 V (vDrop 1.4): 2.2 V across, no load -> 44 rad/s.
      // The inverted Norton EMF settled at ~17.5 (2.2 = 4 ohm * 2e/5 + e).
      assert.ok(driven > 40 && driven < 44.5, `steady velocity ${driven} vs V/kV = 44`);
      b.setPin('P1.4', 'pushpull', false);
      run(b, 100, 1);
      const coast = motor(b).velocity;
      // An ideal motor with nothing to push current through keeps turning
      // (dc_motor does the same). The inverted EMF braked it to 0 in ~40 ms,
      // and with signed velocity then crept it into reverse.
      assert.ok(coast > 0.9 * driven, `coasts on open circuit (${driven} -> ${coast})`);
    });
  });
}

describe('dc_motor_encoder: signed count and quadrature order', () => {
  /** The (A, B) levels the encoder drives, each change in order. */
  function phases(dir) {
    const b = bench('dc_motor_encoder', { ...MOTOR, pulsesPerRev: 20 });
    programDrive(b, dir);
    run(b, 100); // reach speed
    const seen = [];
    for (let i = 0; i < 200; i++) {
      b.advanceTo(b.timeNs + 250_000n);
      const d = motor(b).drives;
      const ab = `${d.enc_a.vTh > 2.5 ? 1 : 0}${d.enc_b.vTh > 2.5 ? 1 : 0}`;
      if (seen[seen.length - 1] !== ab) seen.push(ab);
    }
    return { seen, state: motor(b) };
  }
  // Forward: A leads B — 10 -> 11 -> 01 -> 00 -> 10 ...
  const NEXT_FORWARD = { 10: '11', 11: '01', '01': '00', '00': '10' };

  it('forward: count rises, A leads B', () => {
    const { seen, state } = phases('forward');
    assert.ok(state.count > 0, `count ${state.count}`);
    assert.ok(seen.length > 8, `saw ${seen.length} phases`);
    for (let i = 1; i < seen.length; i++) {
      assert.equal(seen[i], NEXT_FORWARD[seen[i - 1]], `forward Gray order at ${i}: ${seen.join(' ')}`);
    }
  });

  it('reverse: count falls below zero, B leads A (was: no edges at all)', () => {
    const { seen, state } = phases('reverse');
    assert.ok(state.count < 0, `count ${state.count}`);
    assert.ok(state.angle < 0, `angle ${state.angle}`);
    assert.equal(state.count,
      Math.floor((state.angle / (2 * Math.PI)) * 80), 'count is the signed edge index (4 per pulse)');
    assert.ok(seen.length > 8, `saw ${seen.length} phases`);
    for (let i = 1; i < seen.length; i++) {
      assert.equal(seen[i - 1], NEXT_FORWARD[seen[i]], `reverse Gray order at ${i}: ${seen.join(' ')}`);
    }
  });
});
