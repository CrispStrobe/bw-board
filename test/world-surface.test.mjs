// Colour and distance sensors without a 3D scene (step 3, docs/WORLD.md):
// the surface under / in front of a sensor, per sensor or project-wide, and
// the readings the models compute from it and the world's light.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';
import { World, createWorld, colourCounts, surfaceFor, surfaceDistanceCm, DEFAULT_SURFACE_LUX } from '../src/world.js';
import { STIMULUS_CATALOGUE } from '../src/stimulus-catalogue.js';

registerAllDevices();

function boardWith (parts) {
  const b = new BoardImpl(5.0);
  b.setNetlist(parts.map(p => ({ params: {}, terminals: [], ...p })), []);
  return b;
}

test('no surface and no channel params: a colour sensor reads 0 as before', () => {
  const b = boardWith([{ id: 'c', kind: 'tcs34725' }]);
  assert.deepEqual(colourCounts(b.getParts()[0]), { red: 0, green: 0, blue: 0, clear: 0 });
  assert.equal(surfaceFor(b.getParts()[0]), null);
});

test('a surface under default room light, then under the world\'s light and a lamp', () => {
  const b = boardWith([{ id: 'c', kind: 'tcs34725' }]);
  const c = b.getParts()[0];
  b.world.setSurface({ r: 0.8, g: 0.2, b: 0.1 });
  assert.deepEqual(colourCounts(c), { red: 0.8 * DEFAULT_SURFACE_LUX, green: 0.2 * DEFAULT_SURFACE_LUX,
    blue: Math.round(0.1 * DEFAULT_SURFACE_LUX), clear: 240 + 60 + 30 });
  b.world.set('lightLux', 1000);
  assert.deepEqual(colourCounts(c), { red: 800, green: 200, blue: 100, clear: 1100 });
  b.setPartPositions({ c: { x: 0, y: 0 } });
  b.world.setSource({ id: 'l', kind: 'lamp', x: 0, y: 0, strength: 1000 });
  assert.equal(colourCounts(c).red, 1600, 'a lamp next to the sensor brightens the reflection');
  b.world.set('lightLux', 0);
  b.world.removeSource('l');
  assert.deepEqual(colourCounts(c), { red: 0, green: 0, blue: 0, clear: 0 }, 'dark: nothing reflected');
});

test('per-sensor surface overrides the world field by field; explicit channels win', () => {
  const b = boardWith([{ id: 'c1', kind: 'tcs34725' }, { id: 'c2', kind: 'tcs34725' }]);
  const [c1, c2] = b.getParts();
  b.world.set('lightLux', 100);
  b.world.setSurface({ r: 1, g: 1, b: 1 });
  b.setPartParam('c1', 'surfaceG', 0);
  assert.deepEqual(colourCounts(c1), { red: 100, green: 0, blue: 100, clear: 200 });
  assert.deepEqual(colourCounts(c2), { red: 100, green: 100, blue: 100, clear: 300 });
  b.setPartParam('c2', 'red', 7);
  b.setPartParam('c2', 'clear', 9);
  assert.deepEqual(colourCounts(c2), { red: 7, green: 100, blue: 100, clear: 9 });
});

test('the TCS34725 model reports the computed counts through its state', () => {
  const b = boardWith([{ id: 'c', kind: 'tcs34725' }]);
  const part = b.getParts()[0];
  b.world.set('lightLux', 500);
  b.setPartParam('c', 'surfaceR', 0.5);
  const dev = getDevice('tcs34725');
  const state = dev.init(part);
  dev.update(part, state, () => 0, 0n);
  assert.equal(state.red, 250);
  assert.equal(state.clear, 250);
});

test('distance: own param, else the surface distance, else the legacy default', () => {
  const b = boardWith([{ id: 'u', kind: 'ultrasonic' }, { id: 't', kind: 'vl53l0x' }]);
  const [u, t] = b.getParts();
  assert.equal(surfaceDistanceCm(u), undefined);
  b.world.setSurface({ distanceCm: 42 });
  assert.equal(surfaceDistanceCm(u), 42);
  b.setPartParam('t', 'surfaceDistanceCm', 7.5);
  assert.equal(surfaceDistanceCm(t), 7.5);
  const state = getDevice('vl53l0x').init(t);
  assert.equal(state.distance_mm, 75);
  b.setPartParam('t', 'distance_mm', 300);
  assert.equal(getDevice('vl53l0x').init(t).distance_mm, 300, 'own param wins');
});

test('the ultrasonic echo lasts for the surface distance', () => {
  const b = boardWith([{ id: 'u', kind: 'ultrasonic' }]);
  const u = b.getParts()[0];
  b.world.setSurface({ distanceCm: 20 });
  const dev = getDevice('ultrasonic');
  const state = dev.init(u);
  let trig = 5;
  const read = name => (name === 'trig' ? trig : name === 'vcc' ? 5 : 0);
  dev.update(u, state, read, 0n);
  trig = 0;
  dev.update(u, state, read, 10_000n);
  assert.equal(state._echoEndNs - state._echoStartNs, BigInt(20 * 58 * 1000));
});

test('surface persists and round-trips; clearing it leaves a default world', () => {
  const w = createWorld();
  w.setSurface({ r: 2, g: 0.5, distanceCm: -3 });
  assert.deepEqual(w.getSurface(), { r: 1, g: 0.5, distanceCm: 0 }, 'clamped');
  const json = JSON.parse(JSON.stringify(w));
  assert.deepEqual(World.fromJSON(json).toJSON(), json);
  w.setSurface(null);
  assert.ok(w.isDefault());
  assert.throws(() => w.setSurface({ r: 'x' }));
});

test('the catalogue offers the per-sensor surface params', () => {
  const names = k => STIMULUS_CATALOGUE[k].map(p => p.param);
  for (const p of ['surfaceR', 'surfaceG', 'surfaceB']) assert.ok(names('tcs34725').includes(p));
  assert.ok(names('ultrasonic').includes('surfaceDistanceCm'));
  assert.ok(names('vl53l0x').includes('surfaceDistanceCm'));
});
