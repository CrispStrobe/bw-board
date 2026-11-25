/**
 * A diode that names a part card follows its temperature too.
 *
 * Without a card the diode's forward drop falls about 2 mV/K with the bench
 * temperature (effVf, JUNCTION_TEMPCO_V_PER_K). A diode with
 * `part: '1N4148'` takes the card's saturation current `is`, which the
 * exponential junction used as it stood: the drop at 75 C was the drop at
 * 25 C. The card's Is is a 25 C value; at another temperature the junction
 * takes Is(T) such that the drop at a held current moves by the same
 * tempco, as the BJT card already does (ebersMollParams).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

function drop(params, celsius) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 4300 }, terminals: ['a', 'b'] },
    { id: 'D', kind: 'diode', params, terminals: ['anode', 'cathode'] },
  ], [net('p', ['V', 'pos'], ['R', 'a']), net('a', ['R', 'b'], ['D', 'anode']), net('g', ['G', 'gnd'], ['V', 'neg'], ['D', 'cathode'])]);
  b.setTemperature(celsius);
  b.setPower(true);
  b.advanceTo(1_000_000n);
  return b.nodeVoltage('a');
}

describe('a diode with a part card follows its temperature', () => {
  it('1N4148: the drop at ~1 mA falls about 2 mV/K, like the card-less diode', () => {
    const cold = drop({ part: '1N4148' }, 25);
    const hot = drop({ part: '1N4148' }, 75);
    const slope = (hot - cold) / 50;
    assert.ok(slope < -1.7e-3 && slope > -2.3e-3, `1N4148: ${(slope * 1e3).toFixed(3)} mV/K`);
  });

  it('at 25 C the card is untouched', () => {
    // The 25 C drop is the card's own (is 2.52 nA, n 1.752, rs 0.568).
    const v = drop({ part: '1N4148' }, 25);
    assert.ok(Math.abs(v - 0.5856) < 5e-4, `1N4148 at 25 C: ${v}`);
  });
});
