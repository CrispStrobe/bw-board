// The per-project world (src/world.js, docs/WORLD.md): defaults, precedence,
// sharing between boards, schedules, chip temperature and persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
registerAllDevices();
const createBoard = () => new BoardImpl(5.0);
import { World, createWorld, WORLD_DEFAULTS, ambient, worldDefault, luxToUnit, dbToUnit, evaluateSchedule } from '../src/world.js';
import { benchCelsius } from '../src/chip-temperature.js';

function boardWith (parts) {
  const b = createBoard();
  b.setNetlist(parts.map(p => ({ params: {}, terminals: [], ...p })), []);
  return b;
}

test('defaults equal the legacy sensor fallbacks; light and sound start unset', () => {
  const w = createWorld();
  assert.equal(w.get('temperatureC'), 25);
  assert.equal(w.get('humidityPct'), 50);
  assert.equal(w.get('pressureHpa'), 1013.25);
  assert.equal(w.get('lightLux'), null);
  assert.equal(w.get('soundDb'), null);
  assert.ok(w.isDefault());
  assert.deepEqual(w.toJSON(), {});
  assert.deepEqual(Object.keys(WORLD_DEFAULTS), ['temperatureC', 'humidityPct', 'pressureHpa', 'lightLux', 'soundDb']);
});

test('a part with no explicit param reads the world; unset light keeps the legacy fallback', () => {
  const b = boardWith([
    { id: 'dht', kind: 'dht11' },
    { id: 'bmp', kind: 'bmp280' },
    { id: 'lux', kind: 'bh1750' },
    { id: 'amb', kind: 'ambient_light' },
    { id: 'mic', kind: 'sound_module' },
    { id: 'tp', kind: 'xpt2046' },
  ]);
  const [dht, bmp, lux, amb, mic, tp] = b.getParts();
  assert.equal(ambient(dht, 'temperature', 25), 25);
  assert.equal(ambient(lux, 'lux', 0), 0, 'unset light → legacy fallback');
  assert.equal(ambient(amb, 'light', 0.5), 0.5);
  assert.equal(ambient(mic, 'level', 0), 0);
  b.world.set('temperatureC', 31);
  b.world.set('humidityPct', 70);
  b.world.set('pressureHpa', 950);
  b.world.set('lightLux', 999);
  b.world.set('soundDb', 75);
  assert.equal(ambient(dht, 'temperature', 25), 31);
  assert.equal(ambient(dht, 'humidity', 50), 70);
  assert.equal(ambient(bmp, 'pressure', 101325), 95000);
  assert.equal(ambient(lux, 'lux', 0), 999);
  assert.equal(ambient(amb, 'light', 0.5), luxToUnit(999));
  assert.equal(ambient(mic, 'level', 0), dbToUnit(75));
  // 'pressure' on a touch controller is touch pressure, not air pressure
  assert.equal(worldDefault(tp, 'pressure'), undefined);
  assert.equal(ambient(tp, 'pressure', 0), 0);
});

test('an explicit per-part stimulus wins over the world', () => {
  const b = boardWith([{ id: 'dht', kind: 'dht11' }]);
  b.world.set('temperatureC', 40);
  b.setPartParam('dht', 'temperature', 12);
  assert.equal(ambient(b.getParts()[0], 'temperature', 25), 12);
  b.world.set('temperatureC', 5);
  assert.equal(ambient(b.getParts()[0], 'temperature', 25), 12);
});

test('several boards share one world; a change through either board reaches both', () => {
  const a = boardWith([{ id: 'd1', kind: 'dht11' }]);
  const c = boardWith([{ id: 'd2', kind: 'ds18b20' }]);
  const world = createWorld();
  a.setWorld(world); c.setWorld(world);
  const seen = [];
  c.onChange(e => seen.push(e.type));
  a.setTemperature(33);
  assert.equal(c.temperatureC, 33);
  assert.equal(ambient(c.getParts()[0], 'temperature', 25), 33);
  world.set('humidityPct', 80);
  assert.equal(ambient(a.getParts()[0], 'humidity', 50), 80);
  assert.ok(seen.includes('temperature') && seen.includes('world'));
});

test('a fresh board has its own world (one-board projects are self-contained)', () => {
  const a = createBoard(); const c = createBoard();
  assert.notEqual(a.world, c.world);
  a.setTemperature(10);
  assert.equal(c.temperatureC, 25);
});

test('chip temperature follows the world', () => {
  const b = createBoard();
  assert.equal(benchCelsius(b), 25);
  b.world.set('temperatureC', -5);
  assert.equal(benchCelsius(b), -5);
  assert.equal(b.temperatureC, -5);
});

test('schedules are piecewise-linear in simulation time and deterministic', () => {
  assert.equal(evaluateSchedule([[0, 10], [10, 20]], 5), 15);
  assert.equal(evaluateSchedule([[0, 10], [10, 20]], -1), 10);
  assert.equal(evaluateSchedule([[0, 10], [10, 20]], 99), 20);
  const w = createWorld();
  w.setSchedule('temperatureC', [[10, 30], [0, 20]]);
  assert.equal(w.get('temperatureC', 0), 20);
  assert.equal(w.get('temperatureC', 5), 25);
  const b = createBoard(); b.setWorld(w);
  b.timeNs = 2_500_000_000n;
  assert.equal(b.temperatureC, 22.5);
  w.set('temperatureC', 18); // a constant clears the schedule
  assert.equal(w.getSchedule('temperatureC'), null);
  assert.equal(b.temperatureC, 18);
});

test('persistence: only non-defaults are written; round trip is exact', () => {
  const w = createWorld();
  w.set('temperatureC', 21.5);
  w.set('lightLux', 300);
  w.setSchedule('humidityPct', [[0, 40], [60, 60]]);
  const json = JSON.parse(JSON.stringify(w));
  assert.deepEqual(json, { temperatureC: 21.5, lightLux: 300, schedules: { humidityPct: [[0, 40], [60, 60]] } });
  const back = World.fromJSON(json);
  assert.deepEqual(back.toJSON(), json);
  assert.equal(back.get('humidityPct', 30), 50);
  assert.ok(World.fromJSON(undefined).isDefault());
  // setting a key back to its default leaves nothing to persist
  w.set('temperatureC', 25); w.set('lightLux', null); w.set('humidityPct', 50);
  assert.deepEqual(w.toJSON(), {});
});

test('values are clamped and non-finite input is ignored', () => {
  const w = createWorld();
  w.set('humidityPct', 140);
  assert.equal(w.get('humidityPct'), 100);
  w.set('temperatureC', 'nope');
  assert.equal(w.get('temperatureC'), 25);
  assert.throws(() => w.get('colour'));
});

test('world parts are not serialised: no hidden field lands on part objects', () => {
  const b = boardWith([{ id: 'dht', kind: 'dht11' }]);
  assert.deepEqual(Object.keys(b.getParts()[0]).sort(), ['id', 'kind', 'params', 'terminals']);
});
