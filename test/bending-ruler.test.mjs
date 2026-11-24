/**
 * The bending-ruler scale (src/bending-ruler.js): a load at the tip of a
 * clamped ruler deflects it by F L^3 / (3 E I); the magnet at the tip comes
 * closer to a linear Hall sensor, whose field grows as 1/d^3, and the
 * sensor's output rises.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { rulerCard } from '../src/bending-ruler.js';

registerAllDevices();

const t = (part, terminal) => ({ part, terminal });
const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b}`);

function bench(params) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'S', kind: 'bending_ruler', params, terminals: ['vcc', 'gnd', 'ao'] },
    { id: 'R', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'top', terminals: [t('V', 'vcc'), t('S', 'vcc')] },
    { id: 'ao', terminals: [t('S', 'ao'), t('R', 'a')] },
    { id: 'gnd', terminals: [t('G', 'gnd'), t('S', 'gnd'), t('R', 'b')] },
  ]);
  b.setPower(true);
  b.advanceTo(1_000_000n);
  return b;
}

describe('bending_ruler', () => {
  it('Hooke: deflection is linear in the load (steel rule, 20 cm: 12.5 mm/N)', () => {
    const c = (g) => rulerCard({ params: { loadG: g } });
    close(c(0).deflectionMm, 0, 1e-12);
    close(c(10).deflectionMm, 0.0981 * 12.5, 0.005, '10 g');
    close(c(50).deflectionMm, 5 * c(10).deflectionMm, 1e-9, 'five times the load, five times the bend');
    close(c(10).mmPerN, 8e-3 / (3 * 200e9 * (0.025 * 0.0008 ** 3 / 12)) * 1000, 1e-9);
  });

  it('the field rises as 1/d^3 and the tip stops on the sensor', () => {
    const c = (g) => rulerCard({ params: { loadG: g } });
    close(c(0).fieldMt, 2e-7 * 0.1 / 0.015 ** 3 * 1000, 1e-6, 'rest: 5.9 mT at 15 mm');
    const d = c(50).distanceMm;
    close(c(50).fieldMt / c(0).fieldMt, (15 / d) ** 3, 1e-9);
    assert.equal(c(5000).distanceMm, 1, 'resting on the sensor');
    assert.equal(c(5000).touching, true);
  });

  it('the sensor output follows the load on the board', () => {
    const b = bench({ loadG: 0 });
    const rest = b.nodeVoltages.get('ao');
    close(rest, 2.5 + 0.014 * rulerCard({ params: {} }).fieldMt, 0.002, 'rest output');
    b.setPartParam('S', 'loadG', 50);
    b.advanceTo(2_000_000n);
    const loaded = b.nodeVoltages.get('ao');
    close(loaded, 2.5 + 0.014 * rulerCard({ params: { loadG: 50 } }).fieldMt, 0.002, '50 g');
    assert.ok(loaded - rest > 0.05, `50 g lifts the output by ${loaded - rest} V (expected ~0.10 V)`);
    assert.equal(b.getDeviceState('S').deflectionMm, rulerCard({ params: { loadG: 50 } }).deflectionMm);
  });

  it('a flipped magnet swings the output the other way', () => {
    const b = bench({ loadG: 100, flip: true });
    assert.ok(b.nodeVoltages.get('ao') < 2.4, `${b.nodeVoltages.get('ao')} below half supply`);
  });
});
