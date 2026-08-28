// A 10-segment LED bargraph that never lit, and was not a diode.
//
// Two faults in one part, both invisible from the outside because the thing
// still drew on screen:
//
//   * it reported NO BRIGHTNESS. init() returned `{drives:{}}` and update()
//     was `return false`, so `state.brightness` never existed — and the
//     designer's face reads exactly that. Seven shipped disp-bargraph circuits
//     placed one and every segment stayed dark whatever you wired to it.
//
//   * it was a RESISTOR, not ten diodes. The stamp put a fixed conductance of
//     1/(rd+100) between each anode and cathode in BOTH directions. A forward
//     segment sat on a divider instead of clamping near its forward drop, and
//     a reverse-connected one conducted happily — which is the one mistake a
//     bargraph bench exists to teach you not to make.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const TERMS = [];
for (let i = 0; i < 10; i++) TERMS.push(`a${i}`, `k${i}`);

/**
 * One segment fed from the 5 V rail through a resistor.
 * `reverse` swaps anode and cathode, which a real LED refuses to conduct.
 */
function seg({ index = 0, ohms = 330, reverse = false, params = {} } = {}) {
  const board = new BoardImpl(5.0);
  const hot = reverse ? `k${index}` : `a${index}`;
  const cold = reverse ? `a${index}` : `k${index}`;
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
    { id: 'BG', kind: 'bargraph', params, terminals: TERMS },
  ], [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R', terminal: 'a' }] },
    { id: 'n1', terminals: [{ part: 'R', terminal: 'b' }, { part: 'BG', terminal: hot }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'BG', terminal: cold }] },
  ]);
  let t = 0n;
  for (let i = 0; i < 8; i++) { t += 1_000_000n; board.advanceTo(t); }
  return {
    volts: board.nodeVoltage('n1'),
    bright: board.getDeviceState('BG').brightness,
  };
}

describe('bargraph segments light', () => {
  it('a driven segment reports brightness at all', () => {
    // The whole bug: this was undefined, so the face drew nothing.
    const s = seg();
    assert.ok(Array.isArray(s.bright), 'brightness is an array of ten');
    assert.equal(s.bright.length, 10);
    assert.ok(s.bright[0] > 0.1, `segment 0 should be lit, got ${s.bright[0]}`);
  });

  it('only the driven segment lights', () => {
    const s = seg({ index: 3 });
    assert.ok(s.bright[3] > 0.1, 'the wired one is lit');
    for (const i of [0, 1, 2, 4, 9]) {
      assert.equal(s.bright[i], 0, `segment ${i} must stay dark`);
    }
  });

  it('brightness follows the current, not just on/off', () => {
    // 330R gives about 9 mA against a 20 mA full scale; 1k gives about 3.
    const bright = seg({ ohms: 330 }).bright[0];
    const dim = seg({ ohms: 1000 }).bright[0];
    assert.ok(bright > dim, `330R (${bright.toFixed(3)}) must outshine 1k (${dim.toFixed(3)})`);
    assert.ok(dim > 0, 'and 1k still lights it');
  });

  it('a segment saturates rather than exceeding full scale', () => {
    const s = seg({ ohms: 10 });
    assert.ok(s.bright[0] <= 1, `brightness is a fraction, got ${s.bright[0]}`);
    assert.ok(s.bright[0] > 0.9, 'and 10R drives it to full');
  });
});

describe('bargraph segments are diodes, not resistors', () => {
  it('a forward segment CLAMPS near its drop instead of dividing', () => {
    // The old fixed 110 ohm put this node at 5 * 110/440 = 1.25 V, which is a
    // divider. A diode holds vf plus its own small drop: about 2.09 V.
    const s = seg();
    assert.ok(s.volts > 1.9 && s.volts < 2.4,
      `expected a clamp near 2.1 V, got ${s.volts.toFixed(2)} V — 1.25 V means it is a resistor again`);
  });

  it('a REVERSE-connected segment does not conduct, and does not light', () => {
    // The mistake a bargraph bench exists to catch. With no current the node
    // sits at the rail, because nothing is drawing through the resistor.
    const s = seg({ reverse: true });
    assert.ok(s.volts > 4.9, `reverse should block and leave the node at 5 V, got ${s.volts.toFixed(2)} V`);
    assert.equal(s.bright[0], 0, 'and it must be dark');
  });

  it('a reverse segment does not latch itself on', () => {
    // The subtle half. Deciding conduction from VOLTAGE lets the companion
    // source confirm its own state: the reverse segment dragged its cathode to
    // -1.79 V, which made the measured forward voltage positive, which kept it
    // conducting. Asking whether CURRENT still flows the right way cannot do
    // that. Guarded because the failure looked like a lit segment.
    const s = seg({ reverse: true });
    assert.ok(s.volts > 0, `a latched segment goes NEGATIVE; got ${s.volts.toFixed(2)} V`);
  });

  it('the forward drop is a parameter, and moving it moves the clamp', () => {
    const low = seg({ params: { vForward: 1.8 } }).volts;
    const high = seg({ params: { vForward: 3.2 } }).volts;
    assert.ok(high > low + 1.0,
      `a blue LED clamps higher than a red one: ${low.toFixed(2)} vs ${high.toFixed(2)}`);
  });
});
