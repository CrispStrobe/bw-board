import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { getDevice, registerDevice } from '../src/devices.js';
import { registerBoardKinds } from '../src/devices/board-kinds.js';
import {
  PORTABLE_GPIO_PROFILES, getPortableGpioProfile, logicalPinForTerminal,
  resolvePortableGpioController,
} from '../src/portable-gpio.js';

registerBoardKinds();
const part = (id, kind, terminals, params = {}) => ({ id, kind, terminals, params });
const terminal = (part, terminal) => ({ part, terminal });
const net = (id, ...terminals) => ({ id, terminals });
const boardFor = (kind, terminals) => ({ parts: [part('cpu', kind, terminals)], nets: [] });
const unavailable = error => error.code === 'unavailable';

// Independent pin anchors: original program-facing numbers must not shift as
// more board kinds are added. These include every new family and package gap.
const anchors = [
  ['mcu', 'P3.2', 26], ['arduino_uno', 'A0', 14], ['arduino_nano', 'A5', 19],
  ['arduino_mega', 'A15', 69], ['pi_pico', 'GP25', 25], ['microbit', 'P2', 2],
  ['microbit_breakout', 'P16', 16], ['calliopemini', 'P3', 3],
  ['circuit_playground_express', 'A7', 7], ['esp8266', 'GPIO12', 12],
  ['esp32_4848s040', 'GPIO44', 44], ['attiny85', 'PB5', 13],
  ['attiny88', 'PD7', 31], ['attiny88_qfn32', 'PA3', 3],
  ['stm32f030', 'PB1', 17], ['eater6502', 'VIA1.PB7', 15],
];

test('public inventory is immutable, explicit, and covers 16 electrical surfaces', () => {
  assert.equal(PORTABLE_GPIO_PROFILES.length, 16);
  assert.equal(new Set(PORTABLE_GPIO_PROFILES.map(entry => entry.kind)).size, 16);
  assert.ok(Object.isFrozen(PORTABLE_GPIO_PROFILES));
  for (const entry of PORTABLE_GPIO_PROFILES) {
    assert.ok(Object.isFrozen(entry) && Object.isFrozen(entry.pins) && entry.pins.every(Object.isFrozen));
    assert.ok(entry.label && entry.numbering && entry.help);
    assert.equal(entry.execution, 'host-driven-circuit');
    assert.equal(entry.hardware, false);
    assert.equal(entry.nativeInterpreter, false);
    assert.equal(new Set(entry.pins.map(pin => pin.pin)).size, entry.pins.length);
    assert.equal(new Set(entry.pins.map(pin => pin.terminal)).size, entry.pins.length);
    assert.ok(entry.pins.every(pin => Number.isInteger(pin.pin) && pin.pin >= 0 && pin.pin < 256));
  }
  assert.equal(getPortableGpioProfile('__proto__'), null);
  assert.equal(getPortableGpioProfile('pybadge'), null, 'unqualified serial/analog aliases are not guessed');
  assert.equal(getPortableGpioProfile('stc15_mcu'), null, 'case-aliased package requires a separate qualified mapping');
});

test('numbering anchors retain complete names and exclude power, control and unexposed pins', () => {
  for (const [kind, pad, expected] of anchors) {
    assert.equal(logicalPinForTerminal(kind, pad), expected, `${kind}.${pad}`);
    assert.equal(logicalPinForTerminal(kind, pad.toLowerCase()), expected);
    assert.equal(logicalPinForTerminal(kind, `${pad}extra`), null);
    assert.equal(logicalPinForTerminal(kind, ` ${pad}`), null);
    assert.equal(logicalPinForTerminal(kind, 'gnd'), null);
    assert.equal(logicalPinForTerminal(kind, '3v3'), null);
  }
  for (const [kind, pads] of [
    ['arduino_nano', ['A6', 'A7', 'D14', 'D013']],
    ['pi_pico', ['GP23', 'GP24', 'GP29']], ['microbit', ['P8', 'P16']],
    ['microbit_breakout', ['P3', 'P4', 'P20']], ['calliopemini', ['P4', 'C4']],
    ['esp8266', ['GPIO6', 'GPIO11', 'GPIO16', 'D0']],
    ['esp32_4848s040', ['GPIO0', 'GPIO3', 'GPIO45']],
    ['attiny85', ['PB6', 'PA0']], ['attiny88', ['PA0', 'PA3']],
    ['attiny88_qfn32', ['PA4', 'PC8']],
    ['stm32f030', ['PA8', 'PA13', 'PA14', 'PF0', 'PF1', 'BOOT0', 'NRST']],
    ['eater6502', ['PA0', 'VIA2.PA0', 'VIA1.PC0']],
  ]) for (const pad of pads) assert.equal(logicalPinForTerminal(kind, pad), null, `${kind}.${pad}`);
  assert.equal(logicalPinForTerminal('unknown', 'P0'), null);
  assert.equal(logicalPinForTerminal('microbit', 0), null);
});

for (const entry of PORTABLE_GPIO_PROFILES) {
  test(`${entry.kind}: whole registered terminal map and partial circuit map resolve`, () => {
    const terminals = entry.kind === 'mcu' ? entry.pins.map(pin => pin.terminal) : getDevice(entry.kind).terminals;
    const before = [...terminals];
    const mapping = resolvePortableGpioController(boardFor(entry.kind, terminals));
    assert.equal(mapping.profile, entry);
    assert.equal(mapping.pinMap.length, entry.pins.length);
    assert.deepEqual(mapping.pins, entry.pins.map(pin => pin.pin).sort((a, b) => a - b));
    assert.ok(Object.isFrozen(mapping) && Object.isFrozen(mapping.controller) && Object.isFrozen(mapping.pins));
    assert.ok(Object.isFrozen(mapping.pinMap) && mapping.pinMap.every(Object.isFrozen));
    assert.deepEqual(terminals, before);
    const [kind, pad, expected] = anchors.find(anchor => anchor[0] === entry.kind);
    assert.deepEqual(resolvePortableGpioController(boardFor(kind, [pad, 'gnd'])).pinMap,
      [{ pin: expected, terminal: pad }]);
  });

  test(`${entry.kind}: every admitted pad has solved output, input and high-impedance behavior at its own voltage`, () => {
    const expectedVoltage = entry.nominalVoltage ?? 5;
    for (const { pin, terminal: pad } of entry.pins) {
      // Deliberately use a 5 V bench for all 3.3 V models. A qualified logical
      // map must reach the model GPIO drive, never a generic qualified pin
      // source accidentally using the bench voltage.
      const board = new BoardImpl(5);
      board.setNetlist([
        part('cpu', entry.kind, [pad]),
        part('load', 'resistor', ['a', 'b'], { ohms: 1000 }),
        part('ground', 'gnd', ['gnd']),
      ], [
        net('signal', terminal('cpu', pad), terminal('load', 'a')),
        net('ground', terminal('load', 'b'), terminal('ground', 'gnd')),
      ]);
      const mapping = resolvePortableGpioController(board);
      assert.equal(mapping.pinMap[0].pin, pin);
      const actualPad = mapping.pinMap[0].terminal;
      board.setPin(actualPad, 'pushpull', true);
      const high = board.readAnalog(actualPad);
      // Pico GP25 also supplies the engine's onboard LED. Retain that real
      // load and include its measured branch current in the independent KCL
      // calculation instead of deleting the device to force an unloaded pad.
      const onboardCurrent = entry.kind === 'pi_pico' && pad === 'gp25' ?
        -board.branchCurrent('cpu_onboard', 'anode') : 0;
      const expectedHigh = (expectedVoltage - 25 * onboardCurrent) * 1000 / 1025;
      assert.ok(Math.abs(high - expectedHigh) < 0.001, `${entry.kind}.${pad}: ${high} V, expected ${expectedHigh}`);
      assert.equal(board.readPin(actualPad), 1, `${entry.kind}.${pad}: HIGH readback`);
      board.setPin(actualPad, 'pushpull', false);
      assert.ok(Math.abs(board.readAnalog(actualPad)) < 0.001);
      assert.equal(board.readPin(actualPad), 0);
      board.setPin(actualPad, 'input', false);
      assert.ok(Math.abs(board.readAnalog(actualPad)) < 0.001, 'released pad follows its load');
      assert.equal(board.getTime(), 0n, 'GPIO work does not fabricate elapsed time');

      // Replace the external load with a known source to exercise input
      // sensing independently of the output latch, then release the source.
      board.setNetlist([
        part('cpu', entry.kind, [pad]),
        part('supply', 'vcc', ['vcc'], { volts: expectedVoltage }),
        part('ground', 'gnd', ['gnd']),
        part('load', 'resistor', ['a', 'b'], { ohms: 10000 }),
      ], [
        net('signal', terminal('cpu', pad), terminal('supply', 'vcc'), terminal('load', 'a')),
        net('ground', terminal('ground', 'gnd'), terminal('load', 'b')),
      ]);
      board.setPin(actualPad, 'input', false);
      assert.equal(board.readPin(actualPad), 1, 'an external source reaches input readback');
      assert.ok(Math.abs(board.readAnalog(actualPad) - expectedVoltage) < 0.001);
    }
  });
}

test('missing, malformed, ambiguous and unqualified controllers fail before changing a circuit', () => {
  for (const value of [null, {}, { parts: [], nets: [] }]) {
    assert.throws(() => resolvePortableGpioController(value), unavailable);
  }
  const multiple = { parts: [part('a', 'microbit', ['p0']), part('b', 'pi_pico', ['gp0'])], nets: [] };
  assert.throws(() => resolvePortableGpioController(multiple), /exactly one GPIO controller/);
  for (const terminals of [['P0', 'p0'], ['p0', 'p0']]) {
    const board = boardFor('microbit', terminals);
    const before = JSON.stringify(board);
    assert.throws(() => resolvePortableGpioController(board), /duplicate logical pin/);
    assert.equal(JSON.stringify(board), before);
  }
  assert.throws(() => resolvePortableGpioController(boardFor('microbit', null)), /no terminal map/);
  assert.throws(() => resolvePortableGpioController(boardFor('microbit', ['p0', 1])), /invalid terminal/);
  assert.throws(() => resolvePortableGpioController(boardFor('microbit', ['p8', '3v', 'gnd'])), /no supported digital pins/);
  assert.throws(() => resolvePortableGpioController(boardFor('pybadge', ['a0'])), /does not support pybadge/);
  registerDevice('portable_gpio_unverified', { terminals: ['p0'], gpioFollowsPinStates: true, vcc: 3.3 });
  assert.throws(() => resolvePortableGpioController(boardFor('portable_gpio_unverified', ['p0'])), /does not support/);
  multiple.parts[1] = part('b', 'portable_gpio_unverified', ['p0']);
  assert.throws(() => resolvePortableGpioController(multiple), /exactly one GPIO controller/);
});

test('model registration, voltage and terminal mismatches do not widen a profile', () => {
  const original = getDevice('microbit');
  try {
    registerDevice('microbit', { ...original, gpioFollowsPinStates: false });
    assert.throws(() => resolvePortableGpioController(boardFor('microbit', ['p0'])), /has not registered/);
    registerDevice('microbit', { ...original, vcc: 5 });
    assert.throws(() => resolvePortableGpioController(boardFor('microbit', ['p0'])), /incompatible GPIO model/);
    registerDevice('microbit', { ...original, terminals: ['p0', '3v', 'gnd'] });
    assert.throws(() => resolvePortableGpioController(boardFor('microbit', ['p0'])), /missing GPIO terminals/);
  } finally {
    registerDevice('microbit', original);
  }
});
