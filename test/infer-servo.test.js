/**
 * Servo inference from pin name convention.
 *
 * A pin named `servo` was rendered as an LED, which is how 53-servo-sweep came
 * to open with "A servo motor sweeping back and forth between 0 and 180
 * degrees" over a bench holding one LED. The servo is a registered
 * three-terminal device that takes the pin as its signal and its own power from
 * the rails, so unlike the motor it needs no driver transistor — and unlike the
 * LED it must not be one.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';
import { registerAllDevices } from '../src/register-all.js';

// validateNetlist knows the built-in kinds plus whatever is REGISTERED; the
// servo is a registered device, so without this it reports 'registered
// devices: (none)' and rejects its own part. The bench generator registers
// them the same way before it validates.
registerAllDevices();

const infer = (name, direction = 'output') => inferNetlist({
  pins: [{ name, port: 1, bit: 1, direction, activeLow: false }],
});

describe('inferNetlist: servo detection by name', () => {
  for (const name of ['servo', 'SERVO', 'myServo', 'servo1', 'panServo']) {
    it(`"${name}" → servo part, not LED`, () => {
      const { parts } = infer(name);
      const servo = parts.find(p => p.kind === 'servo');
      assert.ok(servo, `should create a servo for "${name}"`);
      assert.ok(!parts.some(p => p.kind === 'led'), `should not also create an LED for "${name}"`);
      assert.deepEqual(servo.terminals, ['signal', 'vcc', 'gnd']);
    });
  }

  it('takes the pin as its signal and its power from the rails', () => {
    const { parts, nets } = infer('servo');
    const servo = parts.find(p => p.kind === 'servo');
    const on = terminal => nets.find(n => n.terminals.some(t =>
      t.part === servo.id && t.terminal === terminal));
    const sig = on('signal');
    assert.ok(sig, 'signal must be on a net');
    assert.ok(sig.terminals.some(t => t.part === 'MCU'), 'signal must reach the MCU pin');
    assert.ok(on('vcc'), 'vcc must be on a net');
    assert.ok(on('gnd'), 'gnd must be on a net');
    // No driver transistor: a servo powers itself, which is the whole
    // difference from the motor branch next to it.
    assert.ok(!parts.some(p => p.kind === 'npn'), 'a servo needs no driver transistor');
  });

  it('produces a netlist the engine accepts', () => {
    const { parts, nets } = infer('servo');
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.deepEqual(errors.map(e => e.message), []);
  });

  it('works on a PWM pin too, which is how a servo is actually driven', () => {
    assert.ok(infer('servo', 'pwm').parts.some(p => p.kind === 'servo'));
  });

  it('yields to the older conventions on an ambiguous name', () => {
    // `servoMotor` matches BOTH patterns. The motor branch is older and builds
    // a driver transistor; whichever wins must win deterministically, and the
    // order is: buzzer, motor, relay, then servo. Without that chain a name
    // like this would take two branches at once.
    const both = infer('servoMotor').parts;
    assert.ok(both.some(p => p.kind === 'dc_motor'), 'motor wins servoMotor');
    assert.ok(!both.some(p => p.kind === 'servo'), 'and it is not also a servo');
    const withBuzz = infer('servoBuzzer').parts;
    assert.ok(withBuzz.some(p => p.kind === 'buzzer'), 'buzzer wins servoBuzzer');
    assert.ok(!withBuzz.some(p => p.kind === 'servo'));
    const withRelay = infer('servoRelay').parts;
    assert.ok(withRelay.some(p => p.kind === 'relay'), 'relay wins servoRelay');
    assert.ok(!withRelay.some(p => p.kind === 'servo'));
  });

  it('leaves the neighbouring name conventions alone', () => {
    // Each of these already had a meaning; servo must not steal any of them.
    assert.ok(infer('motor').parts.some(p => p.kind === 'dc_motor'));
    assert.ok(infer('relay').parts.some(p => p.kind === 'relay'));
    assert.ok(infer('buzzer').parts.some(p => p.kind === 'buzzer'));
    assert.ok(infer('led1').parts.some(p => p.kind === 'led'));
    assert.ok(!infer('led1').parts.some(p => p.kind === 'servo'));
  });
});

/**
 * A named sensor is the sensor, not a knob.
 *
 * Every analog pin became a potentiometer, so 03-night-light opened with "a
 * light-dependent resistor (LDR) in a voltage divider" over a bench holding a
 * pot, 16-ldr-bargraph and arduino-sk-p06-light-theremin likewise, and nothing
 * on screen told the reader a substitution had happened.
 */
describe('inferNetlist: light and temperature sensors by name', () => {
  const analog = name => inferNetlist({
    pins: [{ name, port: 1, bit: 3, direction: 'analog', activeLow: false }],
  });

  for (const name of ['ldr', 'LDR', 'photocell', 'lightSensor']) {
    it(`"${name}" → an LDR, not a potentiometer`, () => {
      const { parts } = analog(name);
      assert.ok(parts.some(p => p.kind === 'ldr'), `should create an LDR for "${name}"`);
      assert.ok(!parts.some(p => p.kind === 'potentiometer'));
    });
  }

  for (const name of ['ntc', 'thermistor', 'tempSensor', 'thermo']) {
    it(`"${name}" → an NTC, not a potentiometer`, () => {
      const { parts } = analog(name);
      assert.ok(parts.some(p => p.kind === 'ntc'), `should create an NTC for "${name}"`);
      assert.ok(!parts.some(p => p.kind === 'potentiometer'));
    });
  }

  it('an unnamed analog pin is still a potentiometer', () => {
    // The default must not move: most analog pins really are knobs, and every
    // bench that already shows one has to keep showing one.
    for (const name of ['pot', 'knob', 'a0', 'level']) {
      assert.ok(analog(name).parts.some(p => p.kind === 'potentiometer'), name);
      assert.ok(!analog(name).parts.some(p => p.kind === 'ldr' || p.kind === 'ntc'), name);
    }
  });

  it('wires the sensor as the top leg of a divider the pin can read', () => {
    const { parts, nets } = analog('ldr');
    const ldr = parts.find(p => p.kind === 'ldr');
    const div = parts.find(p => p.kind === 'resistor');
    assert.ok(div, 'a two-terminal sensor needs a fixed leg or the pin reads nothing');
    // The junction of the two legs is what the MCU samples.
    const mid = nets.find(n => n.terminals.some(t => t.part === 'MCU'));
    assert.ok(mid.terminals.some(t => t.part === ldr.id && t.terminal === 'b'));
    assert.ok(mid.terminals.some(t => t.part === div.id && t.terminal === 'a'));
    // Both ends of the divider must actually reach a rail, or the junction
    // floats and the pin reads a number that means nothing.
    const onNet = (part, terminal) => nets.find(n =>
      n.terminals.some(t => t.part === part && t.terminal === terminal));
    const vcc = nets.find(n => n.terminals.some(t => t.part === 'VCC'));
    const gnd = nets.find(n => n.terminals.some(t => t.part === 'GND'));
    assert.ok(vcc && vcc.terminals.some(t => t.part === ldr.id && t.terminal === 'a'),
      'the sensor must hang from VCC');
    assert.ok(gnd && gnd.terminals.some(t => t.part === div.id && t.terminal === 'b'),
      'the fixed leg must reach ground');
    assert.ok(onNet(div.id, 'b'), 'the fixed leg must be on a net at all');
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.deepEqual(errors.map(e => e.message), []);
  });

  it('light beats temperature when a name says both', () => {
    // "lightTemp" is contrived, but the order has to be decided somewhere and
    // asserted, or a later edit can silently swap which sensor appears.
    assert.ok(analog('lightTemp').parts.some(p => p.kind === 'ldr'));
    assert.ok(!analog('lightTemp').parts.some(p => p.kind === 'ntc'));
  });
});

/**
 * Whole-panel PART bindings.
 *
 * Only `74hc595` was ever built from a PART binding, so a program that declared
 * its entire display inferred nothing and its generated bench showed a bare
 * MCU. That is how 81-8051-lcd1602-parallel came to document a wiring — "D4-D7
 * on P1.4-P1.7, RS on P2.0, EN on P2.1" — over a breadboard with no LCD on it,
 * and 82-a2-led-row an eight-LED row with no LEDs.
 */
describe('inferNetlist: whole-panel parts', () => {
  const lcdPart = (rw = null, data = [4, 5, 6, 7]) => ({
    name: 'lcd', type: 'lcd1602',
    data: data.map(bit => ({ port: 1, bit })),
    rs: { port: 2, bit: 0 }, rw, en: { port: 2, bit: 1 },
  });

  it('builds a char_lcd on the declared 4-bit bus', () => {
    const { parts, nets } = inferNetlist({ pins: [], parts: [lcdPart()] });
    const lcd = parts.find(p => p.kind === 'char_lcd');
    assert.ok(lcd, 'the declared panel must appear');
    // A 4-bit bus drives D4..D7 and leaves D0..D3 alone — that IS 4-bit mode.
    for (const [i, bit] of [4, 5, 6, 7].entries()) {
      const net = nets.find(n => n.terminals.some(t =>
        t.part === lcd.id && t.terminal === `d${i + 4}`));
      assert.ok(net, `d${i + 4} must be wired`);
      assert.ok(net.terminals.some(t => t.part === 'MCU' && /1\.?/.test(String(t.terminal))),
        `d${i + 4} must reach the MCU pin P1.${bit}`);
    }
    for (const low of ['d0', 'd1', 'd2', 'd3']) {
      assert.ok(!nets.some(n => n.terminals.some(t => t.part === lcd.id && t.terminal === low)),
        `${low} must stay unconnected in 4-bit mode`);
    }
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.deepEqual(errors.map(e => e.message), []);
  });

  it('ties RW to ground when the board declares none', () => {
    const { parts, nets } = inferNetlist({ pins: [], parts: [lcdPart()] });
    const lcd = parts.find(p => p.kind === 'char_lcd');
    const gnd = nets.find(n => n.terminals.some(t => t.part === 'GND'));
    assert.ok(gnd.terminals.some(t => t.part === lcd.id && t.terminal === 'rw'),
      'a write-only panel must have RW grounded, not floating');
  });

  it('wires RW to the MCU when the board does declare one', () => {
    const { parts, nets } = inferNetlist({ pins: [], parts: [lcdPart({ port: 2, bit: 5 })] });
    const lcd = parts.find(p => p.kind === 'char_lcd');
    const rwNet = nets.find(n => n.terminals.some(t => t.part === lcd.id && t.terminal === 'rw'));
    assert.ok(rwNet.terminals.some(t => t.part === 'MCU'), 'RW must reach the MCU');
    const gnd = nets.find(n => n.terminals.some(t => t.part === 'GND'));
    assert.ok(!gnd.terminals.some(t => t.part === lcd.id && t.terminal === 'rw'),
      'and must not ALSO be grounded, which would short the pin');
  });

  it('builds all eight LEDs of a declared bank on one port', () => {
    const { parts, nets } = inferNetlist({
      pins: [], parts: [{ name: 'leds', type: 'ledbank8', ledPort: 2, activeLow: true }],
    });
    const bank = parts.find(p => p.kind === 'ledbank8');
    assert.ok(bank, 'the declared bank must appear');
    assert.equal(bank.params.activeLow, true, 'the declared polarity must survive');
    for (let bit = 0; bit < 8; bit++) {
      const net = nets.find(n => n.terminals.some(t =>
        t.part === bank.id && t.terminal === `d${bit}`));
      assert.ok(net, `d${bit} must be wired`);
      assert.ok(net.terminals.some(t => t.part === 'MCU'), `d${bit} must reach the MCU`);
    }
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.deepEqual(errors.map(e => e.message), []);
  });

  it('still refuses a part kind it has no model for', () => {
    const { parts, notes } = inferNetlist({
      pins: [], parts: [{ name: 'x', type: 'nonesuch9000' }],
    });
    assert.ok(!parts.some(p => p.declName === 'x'), 'nothing may be invented');
    assert.ok(notes.some(n => /nonesuch9000/.test(n)), 'and the refusal must be said out loud');
  });
});
