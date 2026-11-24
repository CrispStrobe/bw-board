/**
 * A part in surroundings of its own (src/thermal.js `surroundC`) and the
 * silicon PTC temperature sensor (`ptc_sensor`).
 *
 * A sensor on a lead can be held between the fingers or dipped in ice water
 * while the rest of the circuit stays at the bench temperature: params.surroundC
 * is the temperature of that part's own surroundings. It relaxes there with
 * its thermal time constant (plus its own self-heating), and the bench
 * temperature no longer reaches it.
 *
 * The silicon PTC (a spreading-resistance sensor) rises with temperature:
 * R(T) = r25 (1 + A (T - 25) + B (T - 25)^2), A = 7.88e-3 /K, B = 1.937e-5 /K^2
 * by default, so 2 kOhm at 25 C is about 1.63 kOhm at 0 C and 3.4 kOhm at 100 C.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { ptcResistanceAt } from '../src/thermal.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const t = (part, terminal) => ({ part, terminal });
const MS = 1_000_000n;
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);
const run = (b, ms, step = 50) => {
  const end = b.timeNs + BigInt(ms) * MS;
  for (let x = b.timeNs + BigInt(step) * MS; x <= end; x += BigInt(step) * MS) b.advanceTo(x);
};
const V = { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] };

/** 5 V -> R top -> mid -> part(a..b) -> ground. */
function divider(rTop, part) {
  const b = new BoardImpl(5);
  b.setNetlist([V, G, { id: 'RT', kind: 'resistor', params: { ohms: rTop }, terminals: ['a', 'b'] }, part], [
    { id: 'top', terminals: [t('V', 'vcc'), t('RT', 'a')] },
    { id: 'mid', terminals: [t('RT', 'b'), t(part.id, part.terminals[0])] },
    { id: 'gnd', terminals: [t('G', 'gnd'), t(part.id, part.terminals[1])] },
  ]);
  b.setPower(true);
  return b;
}
const mid = (b) => b.nodeVoltages.get('mid');

describe('surroundC: a part in surroundings of its own', () => {
  it('a diode dipped in ice water relaxes to 0 C and its drop rises about 2 mV/K', () => {
    const b = divider(4700, { id: 'D', kind: 'diode', params: { surroundC: 25, thermalTau: 0.5 }, terminals: ['anode', 'cathode'] });
    run(b, 3000);
    const warm = mid(b);
    close(b.partTemperature('D'), 25, 0.5, 'at 25 C surroundings (plus a little self-heating)');
    b.setPartParam('D', 'surroundC', 0);
    run(b, 4000);
    close(b.partTemperature('D'), 0, 0.5, 'in ice water');
    close(mid(b) - warm, 0.05, 0.006, 'forward drop up by 25 K x 2 mV/K');
  });

  it('the bench temperature does not reach a part with its own surroundings', () => {
    const b = divider(4700, { id: 'D', kind: 'diode', params: { surroundC: 30, thermalTau: 0.5 }, terminals: ['anode', 'cathode'] });
    run(b, 3000);
    const before = b.partTemperature('D');
    b.setTemperature(60);
    run(b, 3000);
    close(b.partTemperature('D'), before, 0.05, 'held in the fingers at 30 C');
    close(before, 30, 0.5);
  });

  it('an npn held at 35 C has a base-emitter drop 20 mV lower', () => {
    const q = (surroundC) => {
      const b = new BoardImpl(5);
      b.setNetlist([V, G, { id: 'RB', kind: 'resistor', params: { ohms: 47000 }, terminals: ['a', 'b'] },
        { id: 'Q', kind: 'npn', params: { beta: 100, surroundC, thermalTau: 0.5 }, terminals: ['collector', 'base', 'emitter'] }], [
        { id: 'top', terminals: [t('V', 'vcc'), t('RB', 'a'), t('Q', 'collector')] },
        { id: 'base', terminals: [t('RB', 'b'), t('Q', 'base')] },
        { id: 'gnd', terminals: [t('G', 'gnd'), t('Q', 'emitter')] },
      ]);
      b.setPower(true);
      run(b, 4000);
      return b.nodeVoltages.get('base');
    };
    close(q(25) - q(35), 0.02, 0.003, 'VBE falls 2 mV/K');
  });
});

describe('ptc_sensor: silicon PTC temperature sensor', () => {
  it('its resistance law', () => {
    const p = { params: {} };
    close(ptcResistanceAt(p, 25), 2000, 1e-9);
    close(ptcResistanceAt(p, 0), 2000 * (1 - 25 * 7.88e-3 + 625 * 1.937e-5), 1e-6);
    close(ptcResistanceAt(p, 100), 2000 * (1 + 75 * 7.88e-3 + 5625 * 1.937e-5), 1e-6);
    close(ptcResistanceAt({ params: { r25: 1000 } }, 100), 1700.2, 0.5, 'r25 scales it');
  });

  it('it reads r25 at the bench and follows the bench temperature without thermal params', () => {
    const b = divider(2000, { id: 'S', kind: 'ptc_sensor', params: {}, terminals: ['a', 'b'] });
    close(mid(b), 2.5, 0.002, '2 k against 2 k at 25 C');
    b.setTemperature(50);
    const r = ptcResistanceAt({ params: {} }, 50);
    close(mid(b), 5 * r / (2000 + r), 0.002, 'warmer bench, higher resistance');
  });

  it('in its own surroundings it moves to the PTC value there', () => {
    const b = divider(2000, { id: 'S', kind: 'ptc_sensor', params: { surroundC: 25, thermalTau: 0.5 }, terminals: ['a', 'b'] });
    run(b, 2000);
    b.setPartParam('S', 'surroundC', 100);
    run(b, 4000);
    const T = b.partTemperature('S');
    close(T, 100, 1.5, 'near 100 C (its own 3 mW self-heating adds about 1 K)');
    const r = ptcResistanceAt({ params: {} }, T);
    close(mid(b), 5 * r / (2000 + r), 0.003, 'divider follows R(T)');
  });

  it('a heater warms it through heatedBy like an NTC', () => {
    const b = new BoardImpl(9);
    b.setNetlist([V, G,
      { id: 'RH', kind: 'resistor', params: { ohms: 100, rth: 100, thermalTau: 0.5 }, terminals: ['a', 'b'] },
      { id: 'RT', kind: 'resistor', params: { ohms: 2000 }, terminals: ['a', 'b'] },
      { id: 'S', kind: 'ptc_sensor', params: { heatedBy: 'RH', thermalCoupling: 1, thermalTau: 0.5 }, terminals: ['a', 'b'] }], [
      { id: 'top', terminals: [t('V', 'vcc'), t('RH', 'a'), t('RT', 'a')] },
      { id: 'mid', terminals: [t('RT', 'b'), t('S', 'a')] },
      { id: 'gnd', terminals: [t('G', 'gnd'), t('RH', 'b'), t('S', 'b')] },
    ]);
    b.setPower(true);
    run(b, 5000);
    assert.ok(b.partTemperature('S') > 100, `heated to ${b.partTemperature('S')} (expected ~105 C: 0.81 W x 100 K/W)`);
    assert.ok(mid(b) > 5.5, `divider rose from 4.5 V to ${mid(b)} (expected ~5.6 V)`);
  });
});
