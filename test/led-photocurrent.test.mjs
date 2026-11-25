// An LED used backwards as a light sensor: opt-in photocurrent.
//
// Gap (2026-11-23, round 2): an LED had no photocurrent, so the gallery's
// "LED as a light sensor" (lab-led-light-sensor) needed a photodiode stand-in.
// params.photoSensitivity (amps at full light, light 0..1) gives an LED a
// photocurrent in parallel with its junction, on the same light control path
// as the LDR (setControl, else params.light, else the world). An LED without
// the param is the exact part it was: no extra solver element at all.
//
// Physics note for readers: an LED absorbs photons at or ABOVE its own band
// gap, i.e. light at or SHORTER than its own emission wavelength (a red LED
// responds to red, yellow, green and blue; a blue LED only to blue/UV). The
// model takes one scalar light level; the colour match is the builder's job.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) < tol, `${what}: ${a} vs ${e}`);
const LM358 = { id: 'U1', kind: 'lm358', params: {}, terminals: ['vcc', 'gnd', '1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out'] };
// The LM358's - input sources its own bias current (Ib - Ios/2 = 42.5 nA,
// test/opamp-input-bias.test.mjs) into the same 1 MOhm, against the
// photocurrent: the output sits 42.5 mV lower.
const IB_NEG_V = 42.5e-9 * 1e6;

// lab-led-light-sensor's front end with the photodiode replaced by an LED:
// photocurrent into the inverting input of an LM358 transimpedance stage,
// R1 = 1 MΩ from the output; output = photocurrent x 1 MΩ.
function tia(ledParams) {
  const b = new BoardImpl(9);
  b.setNetlist([
    { id: 'VS', kind: 'vsource', params: { volts: 9 }, terminals: ['pos', 'neg'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'D', kind: 'led', params: { color: 'red', ...ledParams }, terminals: ['anode', 'cathode'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 1e6 }, terminals: ['a', 'b'] },
    LM358,
  ], [
    net('v', ['VS', 'pos'], ['U1', 'vcc']),
    net('g', ['G', 'gnd'], ['VS', 'neg'], ['U1', 'gnd'], ['U1', '1_pos'], ['D', 'anode']),
    net('n', ['U1', '1_neg'], ['D', 'cathode'], ['R1', 'a']),
    net('o', ['U1', '1_out'], ['R1', 'b']),
  ]);
  b.setPower(true);
  return b;
}

describe('LED photocurrent', () => {
  it('a plain LED has none, and gets no hidden solver element', () => {
    const b = tia({});
    b.advanceTo(2_000_000n);
    close(b.nodeVoltage('o'), 0, 0.01, 'dark output');
    assert.ok(!b._solveParts.some(p => p.id === 'D_photo'), 'no photocurrent element');
    assert.ok(!b.getControls().some(c => c.id === 'D'), 'no light control');
  });

  it('photoSensitivity 5 µA at light 0.8 gives 4 µA -> 4.0 V out of a 1 MΩ TIA', () => {
    const b = tia({ photoSensitivity: 5e-6, light: 0.8 });
    b.advanceTo(2_000_000n);
    close(b.nodeVoltage('o'), 4.0 - IB_NEG_V, 0.01, 'TIA output');
    close(b.nodeVoltage('n'), 0, 0.01, 'virtual ground');
  });

  it('answers setControl like an LDR, and is listed by getControls', () => {
    const b = tia({ photoSensitivity: 5e-6 });
    b.advanceTo(1_000_000n);
    close(b.nodeVoltage('o'), 0, 0.01, 'dark by default');
    const c = b.getControls().find(x => x.id === 'D');
    assert.ok(c && c.kind === 'led' && c.value === 0, 'listed, dark');
    b.setControl('D', 0.4);
    b.advanceTo(3_000_000n);
    close(b.nodeVoltage('o'), 2.0 - IB_NEG_V, 0.01, '2 µA x 1 MΩ');
  });

  it('open circuit: the photocurrent forward-biases the LED to a bounded voltage', () => {
    const b = new BoardImpl(5);
    b.setNetlist([
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'D', kind: 'led', params: { color: 'red', photoSensitivity: 5e-6, light: 1 }, terminals: ['anode', 'cathode'] },
      { id: 'RM', kind: 'resistor', params: { ohms: 1e7 }, terminals: ['a', 'b'] },
    ], [net('a', ['D', 'anode'], ['RM', 'a']), net('g', ['G', 'gnd'], ['D', 'cathode'], ['RM', 'b'])]);
    b.setPower(true);
    const v = b.nodeVoltage('a');
    assert.ok(v > 0.5 && v < 2.2, `photovoltaic open-circuit voltage ${v}`);
  });
});
