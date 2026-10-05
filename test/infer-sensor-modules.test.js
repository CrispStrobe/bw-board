/**
 * PIR and sound-module inference from pin name convention.
 *
 * Both parts were registered devices with catalog entries, but every INPUT pin
 * became a button with a pull-up and every ANALOG pin a potentiometer, so a
 * program declaring `PIN pir = P3.2 INPUT` got a bench holding a push button.
 * Electrically that "works" (the pin reads a level either way); only the
 * lesson is wrong — the same species as the LDR that used to arrive as a knob.
 *
 * Unlike a button, both modules DRIVE their output, so they take no pull-up:
 * a pull-up on an idle PIR line would read as permanent motion on any target
 * that samples an undriven-high pin.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inferNetlist } from '../src/infer-netlist.js';
import { validateNetlist } from '../src/validate.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const infer = (name, direction) => inferNetlist({
  pins: [{ name, port: 3, bit: 2, direction, activeLow: false }],
});
const netOf = (nets, part, terminal) => nets.find(n =>
  n.terminals.some(t => t.part === part && t.terminal === terminal));

describe('inferNetlist: PIR motion sensor by name', () => {
  for (const name of ['pir', 'PIR', 'pirSensor', 'motion', 'presence1']) {
    it(`"${name}" INPUT → a PIR, not a button`, () => {
      const { parts } = infer(name, 'input');
      assert.ok(parts.some(p => p.kind === 'pir'), `should create a PIR for "${name}"`);
      assert.ok(!parts.some(p => p.kind === 'button'), 'and no button');
    });
  }

  it('drives the pin from its out terminal, powered from the rails, with no pull-up', () => {
    const { parts, nets } = infer('pir', 'input');
    const pir = parts.find(p => p.kind === 'pir');
    const sig = netOf(nets, pir.id, 'out');
    assert.ok(sig && sig.terminals.some(t => t.part === 'MCU'), 'out must reach the MCU pin');
    assert.ok(netOf(nets, pir.id, 'vcc').terminals.some(t => t.part === 'VCC'));
    assert.ok(netOf(nets, pir.id, 'gnd').terminals.some(t => t.part === 'GND'));
    assert.ok(!parts.some(p => p.kind === 'resistor'), 'a driven output takes no pull-up');
    const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
    assert.deepEqual(errors.map(e => e.message), []);
  });
});

describe('inferNetlist: sound module by name', () => {
  for (const name of ['sound', 'noise', 'clap', 'mic', 'microphone', 'loudness']) {
    it(`"${name}" INPUT → sound module DO`, () => {
      const { parts, nets } = infer(name, 'input');
      const mod = parts.find(p => p.kind === 'sound_module');
      assert.ok(mod, `should create a sound module for "${name}"`);
      assert.ok(!parts.some(p => p.kind === 'button'));
      assert.ok(netOf(nets, mod.id, 'do').terminals.some(t => t.part === 'MCU'));
    });
    it(`"${name}" ANALOG → sound module AO, not a potentiometer`, () => {
      const { parts, nets } = infer(name, 'analog');
      const mod = parts.find(p => p.kind === 'sound_module');
      assert.ok(mod, `should create a sound module for "${name}"`);
      assert.ok(!parts.some(p => p.kind === 'potentiometer'));
      assert.ok(netOf(nets, mod.id, 'ao').terminals.some(t => t.part === 'MCU'));
    });
  }

  it('produces netlists the engine accepts', () => {
    for (const dir of ['input', 'analog']) {
      const { parts, nets } = infer('sound', dir);
      const errors = validateNetlist(parts, nets).filter(e => e.severity === 'error');
      assert.deepEqual(errors.map(e => e.message), [], dir);
    }
  });
});

describe('inferNetlist: the older conventions keep their names', () => {
  it('buttons, tilt switches and knobs are unchanged', () => {
    for (const name of ['btn', 'button', 'key1', 'start']) {
      assert.ok(infer(name, 'input').parts.some(p => p.kind === 'button'), name);
    }
    assert.ok(infer('tilt', 'input').parts.some(p => p.kind === 'tilt_sensor'));
    for (const name of ['pot', 'level', 'a0', 'knob']) {
      assert.ok(infer(name, 'analog').parts.some(p => p.kind === 'potentiometer'), name);
    }
    assert.ok(infer('ldr', 'analog').parts.some(p => p.kind === 'ldr'));
    assert.ok(infer('temp', 'analog').parts.some(p => p.kind === 'ntc'));
  });

  it('matches only at the start of a name', () => {
    // `dynamic` contains "mic", `empire` contains "pir": neither is a sensor.
    assert.ok(infer('dynamic', 'input').parts.some(p => p.kind === 'button'));
    assert.ok(infer('empire', 'input').parts.some(p => p.kind === 'button'));
  });

  it('a resistive sensor name keeps precedence over a sound name on ANALOG', () => {
    // `micLight` matches both; the LDR rule is the older one.
    const { parts } = infer('micLight', 'analog');
    assert.ok(parts.some(p => p.kind === 'ldr'));
    assert.ok(!parts.some(p => p.kind === 'sound_module'));
  });
});

describe('the modules respond in the engine', () => {
  it('PIR out follows its motion parameter', async () => {
    const { getDevice } = await import('../src/devices.js');
    const pir = getDevice('pir');
    const st = pir.init();
    const read = () => 5;
    pir.update({ params: { motion: 1 } }, st, read);
    assert.equal(st.drives.out.vTh, 5);
    pir.update({ params: { motion: 0 } }, st, read);
    assert.equal(st.drives.out.vTh, 0);
  });
});

describe('inferNetlist: an LED named for a colour is that colour', () => {
  const led = (name) => infer(name, 'output').parts.find(p => p.kind === 'led');
  it('red, yellow and green pins make a traffic light, not three red LEDs', () => {
    assert.equal(led('green').params.color, 'green');
    assert.equal(led('yellowLed').params.color, 'yellow');
    assert.equal(led('ledBlue').params.color, 'blue');
    assert.equal(led('white').params.color, 'white');
    assert.equal(led('red').params.color, 'red');
  });
  it('any other name keeps the red default, and the electrical model does not move', () => {
    for (const name of ['led1', 'lamp', 'go']) {
      assert.equal(led(name).params.color, 'red', name);
      assert.equal(led(name).params.vf, 2.0, name);
    }
    assert.equal(led('green').params.vf, 2.0, 'colour is display only');
  });
  it('a whole-port LED bank is unchanged', () => {
    const { parts } = inferNetlist({ pins: [],
      ports: [{ name: 'green', port: 2, direction: 'output', activeLow: true }] });
    const leds = parts.filter(p => p.kind === 'led');
    assert.ok(leds.length > 0);
    assert.ok(leds.every(p => p.params.color === 'red'));
  });
});
