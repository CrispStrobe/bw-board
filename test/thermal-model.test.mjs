/**
 * The opt-in thermal model (src/thermal.js): parts with `rth` / `heatedBy`
 * get a temperature that follows their dissipation through a thermal
 * resistance and time constant toward the bench temperature; a heater warms
 * a coupled sensor; the world's airflow cools; junction drops follow the
 * part's own temperature at -2 mV/K. A circuit without those params is
 * untouched.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { ntcResistanceAt, airflowFactor } from '../src/thermal.js';

const t = (part, terminal) => ({ part, terminal });
const MS = 1_000_000n;
const V = { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] };
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const run = (b, ms, step = 50) => {
  const end = b.timeNs + BigInt(ms) * MS;
  for (let x = b.timeNs + BigInt(step) * MS; x <= end; x += BigInt(step) * MS) b.advanceTo(x);
};

/** 100 Ohm heater across 5 V (0.25 W), optional sensor circuit beside it. */
function heaterBench(heaterParams, extraParts = [], extraNets = []) {
  const b = new BoardImpl(5);
  b.setNetlist([V, G, { id: 'RH', kind: 'resistor', params: { ohms: 100, ...heaterParams }, terminals: ['a', 'b'] }, ...extraParts], [
    { id: 'top', terminals: [t('V', 'vcc'), t('RH', 'a'), ...extraNets.filter((n) => n[0] === 'top').map((n) => n[1])] },
    { id: 'gnd', terminals: [t('G', 'gnd'), t('RH', 'b'), ...extraNets.filter((n) => n[0] === 'gnd').map((n) => n[1])] },
    ...extraNets.filter((n) => n[0] !== 'top' && n[0] !== 'gnd').reduce((acc, [id, term]) => {
      const e = acc.find((x) => x.id === id);
      if (e) e.terminals.push(term); else acc.push({ id, terminals: [term] });
      return acc;
    }, []),
  ]);
  b.setPower(true);
  return b;
}

describe('thermal model: opt-in', () => {
  it('a circuit without thermal params has no part temperatures and solves as before', () => {
    const b = heaterBench({});
    assert.equal(b.partTemperature('RH'), null);
    run(b, 500);
    assert.equal(b.partTemperature('RH'), null);
    assert.equal(b.getRenderState().temperatures, undefined);
  });

  it('a self-heating resistor follows P x rth with its time constant', () => {
    const b = heaterBench({ rth: 100, thermalTau: 1 });
    close(b.partTemperature('RH'), 25, 1e-9, 'starts at the bench');
    run(b, 500);
    close(b.partTemperature('RH'), 25 + 25 * (1 - Math.exp(-0.5)), 0.05, 'half a tau');
    run(b, 4500);
    close(b.partTemperature('RH'), 25 + 25 * (1 - Math.exp(-5)), 0.05, 'five tau');
    const temps = b.getRenderState().temperatures;
    assert.ok(Array.isArray(temps) && temps.some((x) => x.id === 'RH'));
  });

  it('it relaxes toward a new bench temperature and is reset with the board', () => {
    const b = heaterBench({ rth: 100, thermalTau: 1 });
    run(b, 3000);
    b.setTemperature(0);
    run(b, 6000);
    close(b.partTemperature('RH'), 0 + 25, 0.1, 'rise rides on the new bench');
    b.reset();
    close(b.partTemperature('RH'), 0, 1e-9);
  });
});

describe('thermal model: a heater warms a coupled NTC', () => {
  // NTC in a divider: top 10k fixed, NTC to ground, read the middle.
  const sensor = (ntcParams) => [
    [{ id: 'RT', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'NTC', kind: 'ntc', params: { r25: 10000, beta: 3950, ...ntcParams }, terminals: ['a', 'b'] }],
    [['top', t('RT', 'a')], ['mid', t('RT', 'b')], ['mid', t('NTC', 'a')], ['gnd', t('NTC', 'b')]],
  ];

  it('the NTC reads r25 at the bench, then falls as the heater warms it', () => {
    const [parts, nets] = sensor({ heatedBy: 'RH', thermalCoupling: 0.5, thermalTau: 1 });
    const b = heaterBench({ rth: 100, thermalTau: 1 }, parts, nets);
    close(b.nodeVoltage('mid'), 2.5, 1e-3, 'r25 = 10k at 25 C');
    run(b, 10_000);
    // Heater at +25 K, NTC sees half of it: 37.5 C (+ its own ~0.3 K self-heat).
    const T = b.partTemperature('NTC');
    close(T, 37.5, 0.6, 'sensor temperature');
    const r = ntcResistanceAt({ params: { r25: 10000, beta: 3950 } }, T);
    close(b.nodeVoltage('mid'), 5 * r / (10000 + r), 2e-3, 'divider follows the beta equation');
    assert.ok(b.nodeVoltage('mid') < 2.0, `warmed NTC pulls the divider down (${b.nodeVoltage('mid')})`);
  });

  it('a heater that is not drawn with rth still joins with resistor defaults', () => {
    const [parts, nets] = sensor({ heatedBy: 'RH', thermalCoupling: 1 });
    const b = heaterBench({}, parts, nets);
    assert.ok(b.partTemperature('RH') !== null, 'heater joined the model');
  });
});

describe('thermal model: airflow cools a self-heated sensor', () => {
  // 100 Ohm (r25) NTC in series with 100 Ohm from 5 V: tens of mW, self-heats.
  function hotWire() {
    const b = new BoardImpl(5);
    b.setNetlist([V, G, { id: 'RS', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
      { id: 'NTC', kind: 'ntc', params: { r25: 100, beta: 3950, rth: 500, thermalTau: 1 }, terminals: ['a', 'b'] }], [
      { id: 'top', terminals: [t('V', 'vcc'), t('RS', 'a')] },
      { id: 'mid', terminals: [t('RS', 'b'), t('NTC', 'a')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('NTC', 'b')] },
    ]);
    b.setPower(true);
    return b;
  }

  it('still air: hot; 4 m/s: much cooler, and the sensor voltage rises back', () => {
    const b = hotWire();
    run(b, 10_000);
    const hot = b.partTemperature('NTC');
    const vHot = b.nodeVoltage('mid');
    assert.ok(hot > 40, `self-heated to ${hot} C`);
    b.world.set('airflowMs', 4);
    run(b, 10_000);
    const cooled = b.partTemperature('NTC');
    assert.ok(cooled < hot - 10, `airflow cooled it: ${hot} -> ${cooled}`);
    assert.ok(b.nodeVoltage('mid') > vHot, 'cooler NTC, higher resistance, higher voltage');
    // Steady state check: T = 25 + P rth / (1 + sqrt(4)).
    const vm = b.nodeVoltage('mid');
    const P = vm * (5 - vm) / 100;
    close(cooled, 25 + P * 500 / airflowFactor(4), 0.2, 'heat balance');
  });
});

describe('thermal model: a transistor as a thermometer (VBE -2 mV/K)', () => {
  // Diode-connected NPN fed 0.43 mA through 10k; heater glued on (coupling 1).
  function vbeBench(npnParams, heaterOn) {
    const parts = [
      { id: 'RB', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      { id: 'Q', kind: 'npn', params: { heatedBy: 'RH', thermalCoupling: 1, thermalTau: 1, rth: 1e-6, ...npnParams }, terminals: ['base', 'collector', 'emitter'] },
    ];
    const nets = [['top', t('RB', 'a')], ['be', t('RB', 'b')], ['be', t('Q', 'base')], ['be', t('Q', 'collector')], ['gnd', t('Q', 'emitter')]];
    return heaterBench(heaterOn ? { rth: 100, thermalTau: 1 } : { rth: 1e-6, thermalTau: 1 }, parts, nets);
  }

  it('VBE falls about 2 mV per kelvin of the transistor\'s own temperature', () => {
    const cold = vbeBench({}, false);
    const hot = vbeBench({}, true);
    run(cold, 10_000);
    run(hot, 10_000);
    const dT = hot.partTemperature('Q') - cold.partTemperature('Q');
    assert.ok(dT > 20, `heated by ${dT} K`);
    const dV = hot.nodeVoltage('be') - cold.nodeVoltage('be');
    close(dV / dT, -0.002, 0.0002, 'dVBE/dT');
  });

  it('the Ebers-Moll (shockley) transistor follows too, through IS', () => {
    const cold = vbeBench({ model: 'shockley' }, false);
    const hot = vbeBench({ model: 'shockley' }, true);
    run(cold, 10_000);
    run(hot, 10_000);
    const dT = hot.partTemperature('Q') - cold.partTemperature('Q');
    const dV = hot.nodeVoltage('be') - cold.nodeVoltage('be');
    close(dV / dT, -0.002, 0.0003, 'dVBE/dT (EM)');
  });

  it('a diode on the heater does the same', () => {
    const mk = (heaterOn) => heaterBench(heaterOn ? { rth: 100, thermalTau: 1 } : { rth: 1e-6, thermalTau: 1 },
      [{ id: 'RD', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'D', kind: 'diode', params: { heatedBy: 'RH', thermalCoupling: 1, thermalTau: 1 }, terminals: ['anode', 'cathode'] }],
      [['top', t('RD', 'a')], ['an', t('RD', 'b')], ['an', t('D', 'anode')], ['gnd', t('D', 'cathode')]]);
    const cold = mk(false), hot = mk(true);
    run(cold, 10_000); run(hot, 10_000);
    const dT = hot.partTemperature('D') - cold.partTemperature('D');
    close((hot.nodeVoltage('an') - cold.nodeVoltage('an')) / dT, -0.002, 0.0002, 'dVf/dT');
  });
});
