/**
 * Actuator intent through the pin, and what a DMM shows on a PWM net
 * (Lite task B5, docs/OPEN-TASKS-2026-09-29.md; spec-updates/set-pwm.md).
 *
 * 1. `setDeviceControl(motor, 'speed', N)` was REFUSED — the dc_motor model
 *    has no speed input ("has no simulator action for this"), so the devices
 *    extension's `set motor speed` did nothing. A motor's speed is what the
 *    MCU pin driving it does, so the board now finds that pin (through the
 *    base resistor and driver transistor bw-board infers) and runs N % duty on
 *    it with setPwm — the same mechanism analogWrite and the emulated timers
 *    use. Held: the speed equals the one the same duty gives by setPwm on the
 *    pin directly, and a motor no pin drives is refused by name.
 * 2. `setDeviceControl(servo, 'angle', N)` set the target and nothing else:
 *    no pulse, so a canvas that looks for one said "no signal". On a servo a
 *    pin drives, the board now sends the 50 Hz frame this servo decodes to N.
 *    On a servo no pin drives, the state says `signal: 'control'`.
 * 3. The servo's default calibration is 500..2500 us, what every driver that
 *    reaches it emits (sb3-creator C/MicroPython, CODAL). At the old
 *    1000..2000 default a 1000 us pulse (45 degrees from those drivers) read 0.
 * 4. meterVoltage / meterCurrent average over 100 ms: a 25 % PWM of 5 V into
 *    a resistor reads 1.25 V where nodeVoltage reads 0 or 5; a DC net reads
 *    exactly what nodeVoltage reads.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { inferNetlist } from '../src/infer-netlist.js';

registerAllDevices();
const MS = 1_000_000n;

function inferred(pins, vcc = 5) {
  const stc = { device: 'stc12c5a60s2', pins, ports: [], parts: [], tables: [] };
  const { parts, nets } = inferNetlist(stc);
  const b = new BoardImpl(vcc);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

function runTo(b, ms) { for (let t = b.timeNs + 10n * MS; t <= BigInt(ms) * MS; t += 10n * MS) b.advanceTo(t); }

/** pin → DC motor → GND, B1's motor bench (default winding). */
function motorBench(pin = 'D9') {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'mcu', kind: 'mcu', params: {}, terminals: [pin] },
    { id: 'm1', kind: 'dc_motor', params: {}, terminals: ['a', 'b'] },
    { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ], [
    { id: 'n1', terminals: [{ part: 'mcu', terminal: pin }, { part: 'm1', terminal: 'a' }] },
    { id: 'n2', terminals: [{ part: 'm1', terminal: 'b' }, { part: 'g', terminal: 'gnd' }] },
  ]);
  b.setPower(true);
  return b;
}

describe('set motor speed drives the motor pin as a PWM', () => {
  it('is accepted, and gives the speed the same duty gives by setPwm', () => {
    for (const pct of [25, 50, 100]) {
      const viaControl = motorBench();
      assert.equal(viaControl.setDeviceControl('m1', 'speed', pct), true);
      assert.deepEqual(viaControl.getPwm('D9'), { duty: pct / 100, hz: 500 });
      runTo(viaControl, 300);
      const viaPin = motorBench();
      viaPin.setPwm('D9', pct);
      runTo(viaPin, 300);
      const a = viaControl.getDeviceState('m1').omega;
      const b = viaPin.getDeviceState('m1').omega;
      assert.ok(a > 0, `${pct} %: the motor turns (omega ${a})`);
      assert.equal(a, b, `${pct} %: same omega as setPwm on the pin`);
    }
    const warn = motorBench();
    warn.setDeviceControl('m1', 'speed', 60);
    assert.ok(!JSON.stringify(warn.getWarnings()).includes('no simulator action'), 'no refusal recorded');
  });

  it('speed is monotone in the setting, and clamps at 0 and 100 as the C driver does', () => {
    const omega = (pct) => { const b = motorBench(); b.setDeviceControl('m1', 'speed', pct); runTo(b, 300); return b.getDeviceState('m1').omega; };
    const w = [-20, 0, 25, 50, 75, 100, 250].map(omega);
    assert.equal(w[0], 0, 'below 0 clamps to stopped');
    assert.equal(w[1], 0);
    for (let i = 2; i < 6; i++) assert.ok(w[i] > w[i - 1], `omega ${w.join(' < ')}`);
    assert.equal(w[6], w[5], 'above 100 clamps to full');
  });

  it('finds the pin through the base resistor and driver transistor bw-board infers', () => {
    const b = inferred([{ name: 'MOTOR', port: 1, bit: 4, direction: 'output', activeLow: false }]);
    assert.equal(b.setDeviceControl('MOTOR_MOTOR', 'speed', 50), true);
    assert.deepEqual(b.getPwm('P1.4'), { duty: 0.5, hz: 500 });
    runTo(b, 20);
    assert.ok(b.getDeviceState('MOTOR_MOTOR').omega > 0, 'the motor turns');
  });

  it('a motor no MCU pin drives is refused by name', () => {
    const b = new BoardImpl(5);
    b.setNetlist([
      { id: 'v', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'm1', kind: 'dc_motor', params: {}, terminals: ['a', 'b'] },
    ], [
      { id: 'n1', terminals: [{ part: 'v', terminal: 'vcc' }, { part: 'm1', terminal: 'a' }] },
      { id: 'n2', terminals: [{ part: 'm1', terminal: 'b' }, { part: 'g', terminal: 'gnd' }] },
    ]);
    b.setPower(true);
    assert.equal(b.setDeviceControl('m1', 'speed', 50), false);
    assert.match(JSON.stringify(b.getWarnings()), /no MCU pin drives it/);
  });
});

describe('set servo angle', () => {
  it('sends the pulse the servo decodes, on the pin that drives it', () => {
    for (const deg of [0, 45, 90, 180]) {
      const b = inferred([{ name: 'SERVO', port: 1, bit: 3, direction: 'output', activeLow: false }]);
      assert.equal(b.setDeviceControl('SERVO_SERVO', 'angle', deg), true);
      assert.equal(b.getPwm('P1.3').hz, 50);
      runTo(b, 1500);
      const st = b.getDeviceState('SERVO_SERVO');
      assert.equal(st.signal, 'pulse', 'the angle came from a decoded pulse');
      assert.ok(Math.abs(st.actualAngle - deg) < 0.5, `${deg}: ${st.actualAngle}`);
    }
  });

  it('a servo no pin drives still takes the angle, as a control', () => {
    const b = new BoardImpl(5);
    b.setNetlist([
      { id: 's1', kind: 'servo', params: {}, terminals: ['signal', 'vcc', 'gnd'] },
    ], []);
    b.setPower(true);
    assert.equal(b.getDeviceState('s1').signal, null, 'nothing has commanded it yet');
    assert.equal(b.setDeviceControl('s1', 'angle', 30), true);
    assert.equal(b.getDeviceState('s1').signal, 'control');
    assert.equal(b.getDeviceState('s1').targetAngle, 30);
  });

  it('decodes the drivers\' 500..2500 us by default', () => {
    for (const [us, deg] of [[500, 0], [1000, 45], [2500, 180]]) {
      const b = inferred([{ name: 'SERVO', port: 1, bit: 3, direction: 'output', activeLow: false }]);
      b.setPwm('P1.3', 0, { hz: 50, pulseUs: us });
      runTo(b, 1500);
      assert.ok(Math.abs(b.getDeviceState('SERVO_SERVO').actualAngle - deg) < 0.5,
        `${us} us: ${b.getDeviceState('SERVO_SERVO').actualAngle}`);
    }
  });
});

describe('meters read the average over 100 ms', () => {
  /** pin → 1 k → 1 k → GND: the midpoint is half the pin. */
  function divider() {
    const b = new BoardImpl(5);
    b.setNetlist([
      { id: 'mcu', kind: 'mcu', params: {}, terminals: ['D9'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'r2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'g', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ], [
      { id: 'pin', terminals: [{ part: 'mcu', terminal: 'D9' }, { part: 'r1', terminal: 'a' }] },
      { id: 'mid', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'r2', terminal: 'a' }] },
      { id: 'n0', terminals: [{ part: 'r2', terminal: 'b' }, { part: 'g', terminal: 'gnd' }] },
    ]);
    b.setPower(true);
    return b;
  }

  /** The pin's on and off levels and the currents at them, from DC drives. */
  function levels() {
    const on = divider(); on.setPin('D9', 'pushpull', true); runTo(on, 20);
    const off = divider(); off.setPin('D9', 'pushpull', false); runTo(off, 20);
    return {
      vOn: on.nodeVoltage('pin'), vOff: off.nodeVoltage('pin'),
      midOn: on.nodeVoltage('mid'), midOff: off.nodeVoltage('mid'),
      iOn: on.branchCurrent('r1', 'a'), iOff: off.branchCurrent('r1', 'a'),
    };
  }

  it('a 25 % PWM reads the duty-weighted mean, where nodeVoltage reads on or off', () => {
    const L = levels();
    assert.ok(L.vOn > 4.5 && L.vOff === 0, `levels ${L.vOn} / ${L.vOff}`);
    const b = divider();
    b.setPwm('D9', 25);
    b.meterVoltage('pin'); b.meterVoltage('mid', 'n0'); b.meterCurrent('r1', 'a');   // start watching
    const inst = new Set();
    for (let t = 1n; t <= 300n; t++) {
      b.advanceTo(t * MS + 300_000n);
      inst.add(b.nodeVoltage('pin'));
    }
    assert.deepEqual([...inst].sort(), [L.vOff, L.vOn].sort(), 'the instantaneous solve is on or off');
    const mean = (on, off) => 0.25 * on + 0.75 * off;
    const v = b.meterVoltage('pin');
    assert.ok(Math.abs(v - mean(L.vOn, L.vOff)) < 1e-9, `meter reads ${v} V, want ${mean(L.vOn, L.vOff)}`);
    assert.ok(Math.abs(b.meterVoltage('mid', 'n0') - mean(L.midOn, L.midOff)) < 1e-9);
    const i = b.meterCurrent('r1', 'a');
    assert.ok(Math.abs(i - mean(L.iOn, L.iOff)) < 1e-12, `meter reads ${i} A, want ${mean(L.iOn, L.iOff)}`);
  });

  it('a DC net reads exactly what the instantaneous solve reads', () => {
    const b = divider();
    b.setPin('D9', 'pushpull', true);
    assert.equal(b.meterVoltage('mid'), b.nodeVoltage('mid'), 'first read, no history');
    assert.equal(b.meterCurrent('r2', 'a'), b.branchCurrent('r2', 'a'), 'first read, no history');
    runTo(b, 250);
    assert.equal(b.meterVoltage('mid'), b.nodeVoltage('mid'));
    assert.equal(b.meterCurrent('r2', 'a'), b.branchCurrent('r2', 'a'));
  });

  it('the window is 100 ms: a step reads its time-weighted mean, then settles', () => {
    const { vOn } = levels();
    const b = divider();
    b.setPin('D9', 'pushpull', false);
    b.meterVoltage('pin');
    runTo(b, 200);
    b.setPin('D9', 'pushpull', true);
    runTo(b, 250);
    assert.ok(Math.abs(b.meterVoltage('pin') - vOn / 2) < 1e-9, 'half the window on');
    runTo(b, 300);
    assert.equal(b.meterVoltage('pin'), vOn);
  });
});
