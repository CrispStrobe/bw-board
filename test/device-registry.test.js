// Device registry: a part kind the engine has never heard of, registered at
// runtime, validated, stamped, settled to a fixpoint, and driven through the
// transient integrator. The reference device is a Schmitt inverter — with an
// RC in its feedback path it becomes a relaxation oscillator, which is the
// beating heart of every 555 circuit this registry exists to enable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerDevice, unregisterDevice } from '../src/devices.js';

const gnd = { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] };
const r = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

// Schmitt inverter: output drives HIGH while input < 1/3 VCC, LOW while
// input > 2/3 VCC, holds in between (hysteresis).
function registerSchmitt() {
  registerDevice('test_schmitt', {
    terminals: ['in', 'out'],
    init: () => ({ drives: { out: { vTh: 5, rTh: 25 } }, level: 1 }),
    update(part, state, read) {
      const vin = read('in');
      let level = state.level;
      if (vin > (2 / 3) * 5) level = 0;
      else if (vin < (1 / 3) * 5) level = 1;
      if (level === state.level) return false;
      state.level = level;
      state.drives.out = { vTh: level ? 5 : 0, rTh: 25 };
      return true;
    },
  });
}

test('registration validates, stamps, and settles a chain', (t) => {
  registerSchmitt();
  t.after(() => unregisterDevice('test_schmitt'));
  // Two inverters in series: in tied to GND → first out HIGH → second out LOW.
  const b = new BoardImpl();
  b.setNetlist(
    [gnd,
      { id: 'S1', kind: 'test_schmitt', params: {}, terminals: ['in', 'out'] },
      { id: 'S2', kind: 'test_schmitt', params: {}, terminals: ['in', 'out'] },
      r('RL', 10000)],
    [
      { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'S1', terminal: 'in' }, { part: 'RL', terminal: 'b' }] },
      { id: 'mid', terminals: [{ part: 'S1', terminal: 'out' }, { part: 'S2', terminal: 'in' }] },
      { id: 'out', terminals: [{ part: 'S2', terminal: 'out' }, { part: 'RL', terminal: 'a' }] },
    ]);
  // S1 sees 0 V → drives 5; S2 sees 5 → drives 0. Settled in one event.
  assert.ok(Math.abs(b.nodeVoltage('mid') - 5) < 0.01, `mid = ${b.nodeVoltage('mid')}`);
  assert.ok(Math.abs(b.nodeVoltage('out') - 0) < 0.01, `out = ${b.nodeVoltage('out')}`);
});

test('an unregistered kind is still refused with the full known list', () => {
  const b = new BoardImpl();
  assert.throws(
    () => b.setNetlist([{ id: 'X', kind: 'test_schmitt', params: {}, terminals: ['in', 'out'] }], []),
    /Unknown part kind "test_schmitt"/);
});

test('relaxation oscillator: Schmitt + RC feedback oscillates at ~RC·ln2 half-periods', (t) => {
  registerSchmitt();
  t.after(() => unregisterDevice('test_schmitt'));
  // out → 1 kΩ → in, in → 1 µF → GND. τ = 1 ms.
  // Charging 5/3 → 10/3 toward 5 (and discharging mirror): t½ = τ·ln2 ≈ 693 µs.
  // Full period ≈ 1.386 ms → ~7.2 cycles in 10 ms. Sub-step resolution is
  // 100 µs, so switching quantizes; accept a broad but decisive band.
  const b = new BoardImpl();
  b.setNetlist(
    [gnd,
      { id: 'S1', kind: 'test_schmitt', params: {}, terminals: ['in', 'out'] },
      r('R1', 1000),
      { id: 'C1', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] }],
    [
      { id: 'osc', terminals: [{ part: 'S1', terminal: 'out' }, { part: 'R1', terminal: 'a' }] },
      { id: 'cap', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'C1', terminal: 'a' }, { part: 'S1', terminal: 'in' }] },
      { id: 'gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'C1', terminal: 'b' }] },
    ]);
  let flips = 0;
  let lastOut = b.nodeVoltage('osc') > 2.5 ? 1 : 0;
  let vMin = 5, vMax = 0;
  for (let ms = 1; ms <= 100; ms++) {
    b.advanceTo(BigInt(ms) * 100_000n); // 100 µs steps, 10 ms total
    const out = b.nodeVoltage('osc') > 2.5 ? 1 : 0;
    if (out !== lastOut) { flips++; lastOut = out; }
    if (ms <= 20) continue; // skip the initial charge-up from 0 V
    const vc = b.getCapVoltage('C1');
    vMin = Math.min(vMin, vc); vMax = Math.max(vMax, vc);
  }
  // ~7.2 periods = ~14 flips ideally; quantization loses some. It must
  // OSCILLATE — a dead node (0 flips) or a railed one is the failure mode.
  assert.ok(flips >= 8 && flips <= 20, `flips = ${flips} (expected ~14)`);
  // The cap must swing about the 1/3–2/3 thresholds, never near the rails.
  assert.ok(vMin > 0.8 && vMin < 2.0, `vMin = ${vMin}`);
  assert.ok(vMax > 3.0 && vMax < 4.2, `vMax = ${vMax}`);
});
