// A fan can cool its own sensor: opt-in motor -> airflow coupling.
//
// Gap (2026-11-23, round 2): the airflow bench's fan (a dc_motor) had no way
// to set the airflow the thermal model reads; only the world's airflowMs did,
// so a thermostat that switches on a fan could not close its own loop.
// params.airflowGain (m/s per rad/s of shaft speed) on a motor adds
// airflowGain x |speed| to the world's airflow. Without the param a motor
// moves no air, exactly as before.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const t = (part, terminal) => ({ part, terminal });
const MS = 1_000_000n;
const run = (b, ms, step = 50) => {
  const end = b.timeNs + BigInt(ms) * MS;
  for (let x = b.timeNs + BigInt(step) * MS; x <= end; x += BigInt(step) * MS) b.advanceTo(x);
};

// 100 Ω heater across 5 V (0.25 W, rth 200 K/W -> 50 K rise in still air),
// and a small fan motor on its own switch from the same rail.
function bench(motorParams, fanOn = true) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'RH', kind: 'resistor', params: { ohms: 100, rth: 200, thermalTau: 0.2 }, terminals: ['a', 'b'] },
    { id: 'SW', kind: 'switch', params: { closed: fanOn }, terminals: ['a', 'b'] },
    { id: 'M', kind: 'dc_motor', params: { kV: 0.1, windingR: 10, J: 2e-4, ...motorParams }, terminals: ['a', 'b'] },
  ], [
    { id: 'top', terminals: [t('V', 'vcc'), t('RH', 'a'), t('SW', 'a')] },
    { id: 'm', terminals: [t('SW', 'b'), t('M', 'a')] },
    { id: 'gnd', terminals: [t('G', 'gnd'), t('RH', 'b'), t('M', 'b')] },
  ]);
  b.setPower(true);
  return b;
}

describe('motor airflowGain', () => {
  it('a motor without airflowGain moves no air (unchanged)', () => {
    const b = bench({});
    run(b, 2_000);
    assert.equal(b.effectiveAirflowMs(), 0);
    const rise = b.partTemperature('RH') - 25;
    assert.ok(Math.abs(rise - 50) < 1, `still-air rise ${rise}`);
  });

  it('a spinning fan adds airflowGain x speed and cools the heater', () => {
    // No load: speed -> V/kV = 50 rad/s; gain 0.04 -> 2 m/s.
    const b = bench({ airflowGain: 0.04 });
    run(b, 2_000);
    const air = b.effectiveAirflowMs();
    assert.ok(Math.abs(air - 2) < 0.1, `fan airflow ${air}`);
    // thermal.js: rth_eff = rth / (1 + sqrt(v)) -> 50 K / 2.414 = 20.7 K.
    const rise = b.partTemperature('RH') - 25;
    assert.ok(Math.abs(rise - 50 / (1 + Math.sqrt(air))) < 1, `forced-air rise ${rise}`);
  });

  it('adds to the world airflow, and a stopped fan adds nothing', () => {
    const b = bench({ airflowGain: 0.04 }, false);
    b.world.set('airflowMs', 1);
    run(b, 2_000);
    // an open switch leaks 1 pA: the fan creeps, but moves no air worth naming
    assert.ok(Math.abs(b.effectiveAirflowMs() - 1) < 1e-6, `world only: ${b.effectiveAirflowMs()}`);
    b.setControl('SW', 1);
    run(b, 2_000);
    assert.ok(Math.abs(b.effectiveAirflowMs() - 3) < 0.1, `world 1 + fan 2: ${b.effectiveAirflowMs()}`);
  });

  it('closes the loop: a thermostat-switched fan holds the heater between its set points', () => {
    // Bang-bang in the test (the bench's LM358 does it in the gallery):
    // fan on above 45 °C, off below 40 °C.
    const b = bench({ airflowGain: 0.04 }, false);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 120; i++) {
      run(b, 25, 25);
      const T = b.partTemperature('RH');
      if (T > 45) b.setControl('SW', 1);
      if (T < 40) b.setControl('SW', 0);
      if (i > 60) { lo = Math.min(lo, T); hi = Math.max(hi, T); }
    }
    assert.ok(lo > 35 && hi < 50, `regulated between ${lo.toFixed(1)} and ${hi.toFixed(1)} °C`);
  });
});
