// A control change continues from the present state: Newton starts from the
// previous solution (junction voltages and regions), not from 0 V. A
// two-transistor latch with no capacitor has two valid operating points; a
// cold restart after every event picked the same (symmetric) one, so the
// latch fell back the moment SET was released.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
function latch({ withCap = false } = {}) {
  const b = new BoardImpl(5);
  const parts = [
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'Q1', kind: 'npn', params: {}, terminals: ['base', 'collector', 'emitter'] },
    { id: 'Q2', kind: 'npn', params: {}, terminals: ['base', 'collector', 'emitter'] },
    { id: 'RC1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'RC2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'RB1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'RB2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    { id: 'SET', kind: 'button', params: {}, terminals: ['a', 'b'] },
    { id: 'RST', kind: 'button', params: {}, terminals: ['a', 'b'] },
  ];
  const nets = [net('vcc', ['V', 'vcc'], ['RC1', 'a'], ['RC2', 'a']),
    net('gnd', ['G', 'gnd'], ['Q1', 'emitter'], ['Q2', 'emitter'], ['SET', 'b'], ['RST', 'b']),
    net('c1', ['Q1', 'collector'], ['RC1', 'b'], ['RB2', 'a']), net('c2', ['Q2', 'collector'], ['RC2', 'b'], ['RB1', 'a']),
    net('b1', ['Q1', 'base'], ['RB1', 'b'], ['SET', 'a']), net('b2', ['Q2', 'base'], ['RB2', 'b'], ['RST', 'a'])];
  if (withCap) {
    // A reactive part elsewhere puts every advance through the transient
    // integrator, whose steps must also continue from the previous solution.
    parts.push({ id: 'CX', kind: 'capacitor', params: { farads: 1e-6 }, terminals: ['a', 'b'] },
      { id: 'RX', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] });
    nets[0].terminals.push({ part: 'RX', terminal: 'a' });
    nets[1].terminals.push({ part: 'CX', terminal: 'b' });
    nets.push(net('x', ['CX', 'a'], ['RX', 'b']));
  }
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

for (const withCap of [false, true]) {
  test(`a capacitor-free BJT latch holds after SET/RESET are released${withCap ? ' (transient bench)' : ''}`, () => {
    const b = latch({ withCap });
    b.advanceTo(1_000_000n);
    const high = n => b.nodeVoltage(n) > 4, low = n => b.nodeVoltage(n) < 0.3;
    for (const [btn, up, down] of [['SET', 'c1', 'c2'], ['RST', 'c2', 'c1'], ['SET', 'c1', 'c2']]) {
      b.setControl(btn, 1);
      b.advanceTo(b.getTime() + 1_000_000n);
      assert.ok(high(up) && low(down), `${btn} pressed`);
      b.setControl(btn, 0);
      assert.ok(high(up) && low(down), `${btn} released: ${up}=${b.nodeVoltage(up)} ${down}=${b.nodeVoltage(down)}`);
      b.advanceTo(b.getTime() + 5_000_000n);
      assert.ok(high(up) && low(down), `${btn} released, 5 ms later`);
    }
  });
}

test('a circuit with one operating point reaches the same answer warm or cold', () => {
  const b = latch();
  b.setControl('SET', 1);
  const warm = b.nodeVoltage('c1');
  const cold = new BoardImpl(5);
  cold.setNetlist(b.parts, b.nets);
  cold.setControl('SET', 1);
  cold.setPower(true);
  assert.ok(Math.abs(cold.nodeVoltage('c1') - warm) < 1e-6);
});
