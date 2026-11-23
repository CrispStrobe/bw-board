/**
 * Three model gaps found while building the lab circuits (fix brief
 * 2026-11-23), held to the physics they were missing:
 *
 *  - analog_meter had no internal resistance (a flat 10 MOhm), so meter
 *    loading -- a moving-coil voltmeter dragging a divider down, an
 *    ammeter's shunt burden -- could not be shown. It is now a coil
 *    (coilOhms, ifs) with a multiplier (voltage mode) or a shunt (current
 *    mode), the way the instrument is built.
 *  - polarized_cap was stamped as a plain 1 MOhm resistor, so an
 *    electrolytic never charged. It is now a solver capacitor, and reverse
 *    bias is flagged.
 *  - dc_motor_encoder had no load torque or friction, and its default rotor
 *    inertia (1e-3 kg m^2) gave a 100 s mechanical time constant: about 200 s
 *    of simulated time to reach speed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const t = (part, terminal) => ({ part, terminal });
const MS = 1_000_000n;
const V = (volts = 5) => ({ id: 'V', kind: 'vcc', params: { volts }, terminals: ['vcc'] });
const G = { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] };
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

describe('analog_meter: a moving coil loads the circuit it measures', () => {
  /** 10k/10k divider from 5 V with the meter across the bottom leg. */
  function divider(meterParams) {
    const b = new BoardImpl(5);
    b.setNetlist([V(), G, R('R1', 10_000), R('R2', 10_000),
      { id: 'M', kind: 'analog_meter', params: meterParams, terminals: ['a', 'b'] }], [
      { id: 'top', terminals: [t('V', 'vcc'), t('R1', 'a')] },
      { id: 'mid', terminals: [t('R1', 'b'), t('R2', 'a'), t('M', 'a')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('R2', 'b'), t('M', 'b')] },
    ]);
    b.setPower(true);
    return b;
  }

  it('a 1 mA / 5 V-full-scale voltmeter (5 kOhm total) pulls a 10k/10k divider from 2.5 V to 1.25 V', () => {
    const b = divider({ fullScale: 5 });
    const st = b.getDeviceState('M');
    // R_total = fullScale / ifs = 5 kOhm; 10k || 5k = 3.333k; 5 * 3.333/13.333
    close(st.reading, 1.25, 1e-3, 'loaded reading');
    close(st.deflection, 0.25, 1e-3, 'needle');
    close(st.ohms, 5000, 1e-9, 'meter resistance');
  });

  it('a 50 uA movement (20 kOhm/V) loads it far less', () => {
    const b = divider({ fullScale: 5, ifs: 50e-6 });
    // 100 kOhm meter: 10k || 100k = 9.0909k
    close(b.getDeviceState('M').reading, 5 * 9090.909 / 19090.909, 1e-3);
  });

  it('current mode: the shunt sets the burden (100 Ohm coil, 1 mA, 10 mA full scale -> 10 Ohm)', () => {
    const b = new BoardImpl(5);
    b.setNetlist([V(), G, R('RL', 1000),
      { id: 'M', kind: 'analog_meter', params: { mode: 'current', fullScale: 0.01 }, terminals: ['a', 'b'] }], [
      { id: 'top', terminals: [t('V', 'vcc'), t('M', 'a')] },
      { id: 'mid', terminals: [t('M', 'b'), t('RL', 'a')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('RL', 'b')] },
    ]);
    b.setPower(true);
    const st = b.getDeviceState('M');
    close(st.ohms, 10, 1e-9, 'coil || shunt');
    close(st.reading, 5 / 1010, 1e-7, 'amps');
    close(st.deflection, (5 / 1010) / 0.01, 1e-5);
  });

  it('a bare movement (full scale = ifs) is just its coil', () => {
    const b = divider({ mode: 'current', fullScale: 0.001, ifs: 0.001, coilOhms: 100 });
    close(b.getDeviceState('M').ohms, 100, 1e-9);
  });
});

describe('polarized_cap: an electrolytic is a capacitor', () => {
  function rc(farads, reversed = false) {
    const b = new BoardImpl(5);
    const cap = { id: 'C1', kind: 'polarized_cap', params: { farads }, terminals: ['pos', 'neg'] };
    b.setNetlist([V(), G, R('R1', 1000), cap], [
      { id: 'top', terminals: [t('V', 'vcc'), t('R1', 'a')] },
      { id: 'mid', terminals: [t('R1', 'b'), t('C1', reversed ? 'neg' : 'pos')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('C1', reversed ? 'pos' : 'neg')] },
    ]);
    b.setPower(true);
    return b;
  }

  it('charges through R with tau = RC (1k x 100 uF = 100 ms)', () => {
    const b = rc(100e-6);
    close(b.nodeVoltage('mid'), 0, 0.05, 'uncharged at t=0');
    // 10 ms steps: one advance carries at most 200 device sub-steps of 1 ms.
    for (let ms = 10n; ms <= 100n; ms += 10n) b.advanceTo(ms * MS);
    close(b.nodeVoltage('mid'), 5 * (1 - Math.exp(-1)), 0.05, 'one tau');
    close(b.getCapVoltage('C1'), b.nodeVoltage('mid'), 1e-6, 'getCapVoltage on the drawn id');
    close(-b.branchCurrent('C1', 'pos'), (5 - b.nodeVoltage('mid')) / 1000, 1e-5, 'charging current into pos');
    for (let ms = 110n; ms <= 600n; ms += 10n) b.advanceTo(ms * MS);
    close(b.nodeVoltage('mid'), 5, 0.02, 'charged');
    assert.equal(b.getDeviceState('C1').reversed, false);
  });

  it('reverse bias is flagged in device state and warnings', () => {
    const b = rc(100e-6, true);
    for (let ms = 10n; ms <= 300n; ms += 10n) b.advanceTo(ms * MS);
    assert.equal(b.getDeviceState('C1').reversed, true);
    const w = b.getWarnings().find((x) => x.partId === 'C1');
    assert.ok(w, 'a warning names the part');
    assert.equal(w.type, 'polarized-cap-reversed');
  });
});

describe('dc_motor_encoder: spins up like a hobby motor, and a load slows it', () => {
  function bench(params = {}) {
    const b = new BoardImpl(5);
    b.setNetlist([V(), G, { id: 'M', kind: 'dc_motor_encoder', params, terminals: ['a', 'b', 'enc_a', 'enc_b'] }], [
      { id: 'top', terminals: [t('V', 'vcc'), t('M', 'a')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('M', 'b')] },
      { id: 'ea', terminals: [t('M', 'enc_a')] },
      { id: 'eb', terminals: [t('M', 'enc_b')] },
    ]);
    b.setPower(true);
    return b;
  }
  const run = (b, ms) => { for (let x = 1; x <= ms; x++) b.advanceTo(BigInt(x) * MS); };

  it('with defaults it is above 95 % of V/kV within 500 ms', () => {
    const b = bench();
    run(b, 500);
    const v = b.getDeviceState('M').velocity;
    assert.ok(v > 0.95 * 5 / 0.01, `velocity ${v} rad/s after 0.5 s (V/kV = 500)`);
  });

  it('load torque and viscous friction lower the steady speed to the torque balance', () => {
    // Steady state: kT (V - kV w)/R = tau_L + b w  ->  w = (kT V/R - tau_L) / (kT kV/R + b)
    const kV = 0.01, Rw = 10, load = 2e-3, friction = 1e-6;
    const b = bench({ loadTorque: load, friction });
    run(b, 1500);
    const expected = (kV * 5 / Rw - load) / (kV * kV / Rw + friction);
    close(b.getDeviceState('M').velocity, expected, 0.01 * expected, 'torque balance');
  });

  it('a load torque above stall torque never starts it', () => {
    const b = bench({ loadTorque: 0.01 }); // stall torque kT V/R = 5 mN m
    run(b, 100);
    assert.equal(b.getDeviceState('M').velocity, 0);
  });
});
