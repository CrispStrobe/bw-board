/**
 * A transistor as a thermometer: its VBE at a held current falls by about
 * 2 mV/K. The exponential (Ebers-Moll, `model: 'shockley'`) card is what such
 * a sensor is built on, because the default piecewise junction barely moves
 * its VBE with current. It has to follow
 *   - its own surroundings (`surroundC`, the opt-in thermal model), and
 *   - the bench temperature, like every other junction, when it is not in the
 *     thermal model.
 * The second was missing: the exponential card sat at its 25 C saturation
 * current whatever the bench was, while a piecewise transistor beside it
 * followed the bench.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const EM = { model: 'shockley', is: 1e-14, beta: 100, br: 1, n: 1 };

/** VBE of a diode-connected transistor fed ~85 uA from 9 V through 100 k. */
function vbe(kind, params, benchC = 25, advanceMs = 0) {
  const b = new BoardImpl(9);
  const npn = kind === 'npn';
  b.setNetlist([
    { id: 'V', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
    { id: 'Q', kind, params, terminals: ['base', 'collector', 'emitter'] },
  ], npn ? [
    net('vcc', ['V', 'pos'], ['R', 'a']),
    net('bc', ['R', 'b'], ['Q', 'base'], ['Q', 'collector']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['Q', 'emitter']),
  ] : [
    net('vcc', ['V', 'pos'], ['Q', 'emitter']),
    net('bc', ['R', 'a'], ['Q', 'base'], ['Q', 'collector']),
    net('g', ['G', 'gnd'], ['V', 'neg'], ['R', 'b']),
  ]);
  b.setTemperature(benchC);
  b.setPower(true);
  if (advanceMs) b.advanceTo(BigInt(advanceMs * 1e6));
  const v = b.nodeVoltage('bc');
  return npn ? v : 9 - v;
}

const near = (got, want, tol, what) =>
  assert.ok(Math.abs(got - want) <= tol, `${what}: ${got.toFixed(4)}, expected ${want} +-${tol}`);

describe('an exponential transistor as a thermometer', () => {
  it('follows its own surroundings (surroundC) at -2 mV/K', () => {
    const cold = vbe('npn', { ...EM, surroundC: 0 });
    const room = vbe('npn', { ...EM, surroundC: 25 });
    const warm = vbe('npn', { ...EM, surroundC: 50 });
    near(cold - room, 0.050, 0.002, '0 C against 25 C (V)');
    near(room - warm, 0.050, 0.002, '25 C against 50 C (V)');
  });

  it('follows the bench temperature when it is not in the thermal model', () => {
    const room = vbe('npn', EM, 25);
    near(vbe('npn', EM, 0) - room, 0.050, 0.002, 'bench 0 C against 25 C (V)');
    near(room - vbe('npn', EM, 50), 0.050, 0.002, 'bench 25 C against 50 C (V)');
    // The same shift a piecewise transistor has always had at the bench.
    near(vbe('npn', {}, 0) - vbe('npn', {}, 50), 0.100, 0.002, 'piecewise, for comparison (V)');
  });

  it('a PNP card follows the bench the same way', () => {
    near(vbe('pnp', EM, 0) - vbe('pnp', EM, 50), 0.100, 0.003, 'PNP bench 0 C against 50 C (V)');
  });

  it('its own surroundings win over the bench, also in a running transient', () => {
    // A sensor held in ice water on a warm bench reads the ice water.
    const iceOnWarmBench = vbe('npn', { ...EM, surroundC: 0, thermalTau: 0.001 }, 40, 20);
    near(iceOnWarmBench, vbe('npn', { ...EM, surroundC: 0 }, 25), 0.001, 'surroundC 0 on a 40 C bench (V)');
  });

  it('a bench at 25 C leaves the card bit-identical', () => {
    assert.equal(vbe('npn', EM, 25), vbe('npn', EM));
  });
});
