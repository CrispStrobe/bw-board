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
