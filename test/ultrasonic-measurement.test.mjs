import test from 'node:test';
import assert from 'node:assert/strict';
import {BoardImpl} from '../src/board.js';
import {registerAllDevices} from '../src/register-all.js';

registerAllDevices();
const t = (part, terminal) => ({part, terminal});
const net = (id, ...terminals) => ({id, terminals});
const part = (id, kind, terminals, params = {}) => ({id, kind, terminals, params});
const pins = {trig: 'D7', echo: 'D8'};

function bench (connectEcho = true) {
  const board = new BoardImpl(5);
  board.setNetlist([
    part('mcu', 'mcu', ['D7', 'D8', 'D9']),
    {...part('sensor', 'ultrasonic', ['trig', 'echo', 'vcc', 'gnd']), declName: 'sonar'},
    part('vcc', 'vcc', ['vcc']),
    part('gnd', 'gnd', ['gnd']),
    part('series', 'resistor', ['a', 'b'], {ohms: 1000}),
    part('lower', 'resistor', ['a', 'b'], {ohms: 1800}),
  ], [
    net('trigger', t('mcu', 'D7'), t('sensor', 'trig')),
    net('echo', t('sensor', 'echo'), t('series', 'a')),
    net('gpio', t('series', 'b'), t('lower', 'a'), ...(connectEcho ? [t('mcu', 'D8')] : [])),
    net('supply', t('sensor', 'vcc'), t('vcc', 'vcc')),
    net('ground', t('lower', 'b'), t('sensor', 'gnd'), t('gnd', 'gnd')),
  ]);
  board.setPower(true);
  return board;
}

test('host HC-SR04 transaction reads the wired MCU input after a 10 µs trigger', () => {
  const board = bench();
  const trigger = [];
  let peak = 0;
  board.onChange(({type, detail}) => {
    if (type === 'pin' && detail.pin === pins.trig) trigger.push([board.getTime(), detail.driveHigh]);
    if (type === 'time') peak = Math.max(peak, board.nodeVoltage('gpio'));
  });
  assert.equal(board.measureUltrasonic('sonar', pins), 5800);
  assert.deepEqual(trigger, [[0n, false], [2000n, true], [12000n, false]]);
  assert.ok(peak > 3 && peak < 3.3, `divider peak ${peak} V`);
  board.setPartParam('sensor', 'distance', 40);
  assert.equal(board.measureUltrasonic('sensor', pins), 5800, 'returns the cached echo inside 60 ms');
  board.advanceTo(60_000_000n);
  assert.equal(board.measureUltrasonic('sensor', pins), 2320);
});

test('host HC-SR04 transaction rejects mismatched and disconnected wiring', () => {
  const board = bench();
  assert.equal(board.measureUltrasonic('sensor', {...pins, echo: 'D9'}), null);
  assert.equal(board.getTime(), 0n);
  const disconnected = bench(false);
  assert.equal(disconnected.measureUltrasonic('sensor', pins), null);
  assert.equal(disconnected.getTime(), 0n);
});

test('host HC-SR04 transaction times out when the echo is beyond the sensor window', () => {
  const board = bench();
  board.setPartParam('sensor', 'distance', 600);
  assert.equal(board.measureUltrasonic('sensor', pins), null);
  assert.equal(board.getTime(), 30_000_000n);
});
