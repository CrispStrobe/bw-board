// switch / button take an initial state from params (closed / pressed), and a
// slide_switch is operable through setControl like every other contact.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerMiscParts } from '../src/devices/misc-parts.js';

registerMiscParts();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
function contact(kind, params) {
  const b = new BoardImpl(5);
  b.setNetlist([{ id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'S', kind, params, terminals: ['a', 'b'] }, { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
  [net('vcc', ['V', 'vcc'], ['S', 'a']), net('mid', ['S', 'b'], ['R', 'a']), net('gnd', ['G', 'gnd'], ['R', 'b'])]);
  b.setPower(true);
  return b;
}

for (const [kind, key] of [['switch', 'closed'], ['button', 'pressed'], ['switch', 'pressed'], ['button', 'closed']]) {
  test(`${kind} with ${key}: true starts closed; setControl still opens it`, () => {
    const b = contact(kind, { [key]: true });
    assert.ok(b.nodeVoltage('mid') > 4.9, 'closed at t = 0, before any advance');
    b.advanceTo(1_000_000n);
    assert.ok(b.nodeVoltage('mid') > 4.9);
    assert.equal(b.getControls().find(c => c.id === 'S').value, 1);
    b.setControl('S', 0);
    assert.ok(b.nodeVoltage('mid') < 0.01, 'the control wins over the authored start');
  });
}

test('closed: 0 / false and an absent param start open', () => {
  for (const params of [{}, { closed: 0 }, { closed: false }, { pressed: 0 }]) {
    assert.ok(contact('switch', params).nodeVoltage('mid') < 0.01, JSON.stringify(params));
  }
});

test('an initial state that is not true/false/1/0 is refused, not guessed', () => {
  assert.throws(() => contact('switch', { closed: 'yes' }), /initial state closed="yes"/);
});

test('the authored state survives a snapshot/restore that predates the part (designer edit path)', () => {
  const empty = new BoardImpl(5);
  const snap = empty.snapshot();
  const b = contact('switch', { closed: 1 });
  b.restore(snap);
  assert.equal(b.controls.get('S'), 1);
});

test('slide_switch: setControl moves com between a (0) and b (1); params.position is the start', () => {
  for (const start of [0, 1]) {
    const b = new BoardImpl(5);
    b.setNetlist([{ id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] }, { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'S', kind: 'slide_switch', params: { position: start }, terminals: ['a', 'com', 'b'] },
      { id: 'RA', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'RB', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }],
    [net('vcc', ['V', 'vcc'], ['S', 'com']), net('na', ['S', 'a'], ['RA', 'a']), net('nb', ['S', 'b'], ['RB', 'a']),
      net('gnd', ['G', 'gnd'], ['RA', 'b'], ['RB', 'b'])]);
    b.setPower(true);
    const on = n => b.nodeVoltage(n) > 4.9;
    assert.equal(on(start ? 'nb' : 'na'), true);
    assert.equal(b.getControls().find(c => c.id === 'S').value, start);
    b.setControl('S', 1 - start);
    assert.equal(on(start ? 'na' : 'nb'), true, 'moved by setControl');
    assert.equal(on(start ? 'nb' : 'na'), false);
  }
});
