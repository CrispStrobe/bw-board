// A phototransistor reports the current it actually carries.
//
// Gap (2026-11-25, r12): a phototransistor lit through a light_path pulled
// its collector load down by tens of microamps, yet getDeviceState(pt)
// ._current read 0 and branchCurrent(pt, 'collector') read 0. The optical
// photocurrent flows in a hidden `<id>_optical` part beside the receiver
// (src/optics.js expandOptics); the part's own state only ever held the
// room-light share, at full compliance, and only as an internal stamp value.
// `_current` is now the collector current the accepted solution carries,
// room light and optical links together, after the VCE compliance.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
const rel = (a, e, tol, what) => assert.ok(Math.abs(a / e - 1) < tol, `${what}: ${a} vs ${e}`);

/** 9 V -> 330 R -> red LED; phototransistor with `rl` to 9 V, lit by the LED and/or the room. */
function bench({ path = { distanceMm: 5 }, rl = 1000, rx = {} } = {}) {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'RS', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
    { id: 'D', kind: 'led', params: { color: 'red' }, terminals: ['anode', 'cathode'] },
    { id: 'Q', kind: 'phototransistor', params: rx, terminals: ['collector', 'emitter'] },
    { id: 'RL', kind: 'resistor', params: { ohms: rl }, terminals: ['a', 'b'] },
    ...(path ? [{ id: 'P', kind: 'light_path', params: { from: 'D', to: 'Q', ...path }, terminals: [] }] : []),
  ], [
    net('v', ['VS', 'pos'], ['RL', 'a'], ['RS', 'a']),
    net('g', ['G', 'gnd'], ['VS', 'neg'], ['D', 'cathode'], ['Q', 'emitter']),
    net('a', ['RS', 'b'], ['D', 'anode']),
    net('c', ['RL', 'b'], ['Q', 'collector']),
  ]);
  b.setPower(true);
  b.advanceTo(2_000_000n);
  return b;
}
const loadAmps = (b, rl = 1000) => (9 - b.nodeVoltage('c')) / rl;

describe('phototransistor: reported current', () => {
  it('lit only through a light path: state and branch current carry the load current', () => {
    const b = bench();
    const i = loadAmps(b);
    assert.ok(i > 10e-6, `the path lights it (${i} A through RL)`);
    rel(b.getDeviceState('Q')._current, i, 1e-6, 'getDeviceState(Q)._current');
    // The engine's sign: a terminal's branch current is what the part
    // delivers into its net (a resistor's high end reads negative).
    rel(-b.branchCurrent('Q', 'collector'), i, 1e-6, 'branchCurrent(Q, collector)');
    rel(b.branchCurrent('Q', 'emitter'), i, 1e-6, 'branchCurrent(Q, emitter)');
  });

  it('room light and the path add, and the state reports the sum', () => {
    const b = bench({ rx: { iMax: 0.002 } });
    const pathOnly = loadAmps(b);
    b.setControl('Q', 0.25);
    b.advanceTo(4_000_000n);
    const both = loadAmps(b);
    rel(both - pathOnly, 0.5e-3, 1e-3, 'room light adds 0.25 x 2 mA');
    rel(b.getDeviceState('Q')._current, both, 1e-6, '_current is the total');
  });

  it('saturated, it reports what flows, not what the light could drive', () => {
    // 100 kOhm cannot pass more than 90 uA: the part saturates.
    const b = bench({ path: null, rl: 100000, rx: { iMax: 0.005 } });
    b.setControl('Q', 1);
    b.advanceTo(4_000_000n);
    const i = loadAmps(b, 100000);
    assert.ok(i < 90e-6, `saturated: ${i} A`);
    rel(b.getDeviceState('Q')._current, i, 1e-6, '_current after compliance');
  });

  it('dark, it reads zero', () => {
    const b = bench({ path: null });
    assert.equal(b.getDeviceState('Q')._current, 0);
  });
});
