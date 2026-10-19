// Positioned sensors and world sources (step 2, docs/WORLD.md): falloff,
// combination, precedence, sharing between boards, persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { World, createWorld, ambient, falloff, REFERENCE_DISTANCE, luxToUnit } from '../src/world.js';

registerAllDevices();

function boardWith (parts) {
  const b = new BoardImpl(5.0);
  b.setNetlist(parts.map(p => ({ params: {}, terminals: [], ...p })), []);
  return b;
}

test('falloff: 1 inside the radius, inverse-square beyond it', () => {
  assert.equal(falloff(0), 1);
  assert.equal(falloff(REFERENCE_DISTANCE), 1);
  assert.equal(falloff(2 * REFERENCE_DISTANCE), 0.25);
  assert.equal(falloff(300, 100), 1 / 9);
  assert.equal(falloff(50, 25), 0.25);
});

test('a heater warms nearby sensors more than far ones; ambient is the floor', () => {
  const w = createWorld();
  w.set('temperatureC', 20);
  w.setSource({ id: 'h', kind: 'heater', x: 0, y: 0, strength: 8 });
  assert.equal(w.getAt('temperatureC', 50, 0), 28);
  assert.equal(w.getAt('temperatureC', 200, 0), 22);
  assert.equal(w.getAt('temperatureC', 400, 0), 20.5);
  assert.equal(w.get('temperatureC'), 20, 'the uniform value is unchanged');
});

test('a fan cools; contributions add; an off source does nothing', () => {
  const w = createWorld();
  w.setSource({ id: 'h', kind: 'heater', x: 0, y: 0, strength: 8 });
  w.setSource({ id: 'f', kind: 'fan', x: 200, y: 0, strength: 4 });
  // at x=100: heater full (+8), fan at d=100 full (−4)
  assert.equal(w.getAt('temperatureC', 100, 0), 29);
  w.setSource({ id: 'f', kind: 'fan', x: 200, y: 0, strength: 4, on: false });
  assert.equal(w.getAt('temperatureC', 100, 0), 33);
  w.removeSource('h');
  assert.equal(w.getAt('temperatureC', 100, 0), 25);
});

test('a lamp lights an unset-light world from zero; sound levels add as intensities', () => {
  const w = createWorld();
  w.setSource({ id: 'l', kind: 'lamp', x: 0, y: 0, strength: 400 });
  assert.equal(w.getAt('lightLux', 0, 200), 100);
  assert.equal(w.get('lightLux'), null, 'uniform light stays unset');
  w.setSource({ id: 's1', kind: 'sound', x: 0, y: 0, strength: 70 });
  w.setSource({ id: 's2', kind: 'sound', x: 0, y: 0, strength: 70 });
  assert.ok(Math.abs(w.getAt('soundDb', 0, 0) - (70 + 10 * Math.log10(2))) < 1e-9, 'two equal sources: +3 dB');
  // 2× the radius: −6 dB each
  assert.ok(Math.abs(w.getAt('soundDb', 0, 200) - (70 + 10 * Math.log10(2) - 20 * Math.log10(2))) < 1e-9);
});

test('positioned sensor parts read their local value; precedence still holds', () => {
  const b = boardWith([
    { id: 'near', kind: 'dht11' },
    { id: 'far', kind: 'dht11' },
    { id: 'nowhere', kind: 'dht11' },
    { id: 'pinned', kind: 'dht11' },
    { id: 'lux', kind: 'bh1750' },
    { id: 'amb', kind: 'ambient_light' },
  ]);
  b.setPartPositions({ near: { x: 10, y: 0 }, far: { x: 300, y: 0 }, pinned: { x: 0, y: 0 },
    lux: { x: 0, y: 100 }, amb: { x: 0, y: 100 }, bogus: { x: 'a', y: 1 } });
  b.world.setSource({ id: 'h', kind: 'heater', x: 0, y: 0, strength: 9 });
  b.world.setSource({ id: 'l', kind: 'lamp', x: 0, y: 0, strength: 999 });
  b.setPartParam('pinned', 'temperature', 12);
  const [near, far, nowhere, pinned, lux, amb] = b.getParts();
  assert.equal(ambient(near, 'temperature', 25), 34);
  assert.equal(ambient(far, 'temperature', 25), 26);
  assert.equal(ambient(nowhere, 'temperature', 25), 25, 'no position: the uniform world');
  assert.equal(ambient(pinned, 'temperature', 25), 12, 'the per-part stimulus wins');
  assert.equal(ambient(lux, 'lux', 0), 999);
  assert.equal(ambient(amb, 'light', 0.5), luxToUnit(999));
  // netlist coordinates are used when the host gives none
  const c = boardWith([{ id: 'd', kind: 'dht11', x: 0, y: 0 }]);
  c.world.setSource({ id: 'h', kind: 'heater', x: 0, y: 0, strength: 5 });
  assert.equal(ambient(c.getParts()[0], 'temperature', 25), 30);
});

test('boards sharing a world share sources; the bench origin places each board', () => {
  const w = createWorld();
  const a = boardWith([{ id: 'd', kind: 'dht11' }]);
  const b = boardWith([{ id: 'd', kind: 'dht11' }]);
  a.setWorld(w); b.setWorld(w);
  a.setPartPositions({ d: { x: 0, y: 0 } });
  b.setPartPositions({ d: { x: 0, y: 0 } });
  b.setBenchOrigin(400, 0);
  w.setSource({ id: 'h', kind: 'heater', x: 0, y: 0, strength: 16 });
  assert.equal(ambient(a.getParts()[0], 'temperature', 25), 41);
  assert.equal(ambient(b.getParts()[0], 'temperature', 25), 26);
});

test('sources persist and round-trip; a world with only defaults still writes nothing', () => {
  const w = createWorld();
  w.setSource({ id: 'l', kind: 'lamp', x: 1, y: 2 });
  const json = JSON.parse(JSON.stringify(w));
  assert.deepEqual(json, { sources: [{ id: 'l', kind: 'lamp', x: 1, y: 2, strength: 500, on: true, radius: 100 }] });
  assert.deepEqual(World.fromJSON(json).toJSON(), json);
  const other = createWorld();
  other.replaceWith(json);
  assert.deepEqual(other.toJSON(), json);
  other.replaceWith({});
  assert.deepEqual(other.toJSON(), {});
  w.removeSource('l');
  assert.ok(w.isDefault());
});

test('bad sources are refused', () => {
  const w = createWorld();
  assert.throws(() => w.setSource({ id: 'x', kind: 'volcano', x: 0, y: 0 }));
  assert.throws(() => w.setSource({ id: 'x', kind: 'lamp', x: NaN, y: 0 }));
  assert.throws(() => w.setSource({ id: '', kind: 'lamp', x: 0, y: 0 }));
  assert.throws(() => w.setSource({ id: 'x', kind: 'lamp', x: 0, y: 0, strength: -1 }));
  assert.equal(w.getSources().length, 0);
});

test('a source change notifies every board sharing the world', () => {
  const w = createWorld();
  const a = boardWith([]); a.setWorld(w);
  const seen = [];
  a.onChange(e => seen.push(e.type));
  w.setSource({ id: 'h', kind: 'heater', x: 0, y: 0 });
  assert.ok(seen.includes('world'));
});
