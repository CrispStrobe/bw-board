// Light-sensing parts answer the same control path as the LDR.
//
// Gap (2026-11-23, round 2): `setControl(ldr, 0..1)` moved an LDR, but a
// phototransistor ignored it — only its `light` param (or the world's
// lightLux) moved it — and none of the photo parts were listed by
// getControls, so no panel offered them a light slider. Precedence is now the
// same for every light-sensing part: a set control wins, else params.light,
// else the world's light, else the part's legacy default.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
const net = (id, ...pins) => ({ id, terminals: pins.map(([part, terminal]) => ({ part, terminal })) });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) < tol, `${what}: ${a} vs ${e}`);

// A light-driven current into a 1 kΩ load from a 5 V rail.
function photoBench(kind, terminals, params, pins) {
  const b = new BoardImpl(5);
  b.setNetlist([
    { id: 'V', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    { id: 'P', kind, params, terminals },
  ], [
    net('vcc', ['V', 'vcc'], ['P', pins.high]),
    net('mid', ['P', pins.low], ['R', 'a']),
    net('gnd', ['G', 'gnd'], ['R', 'b']),
  ]);
  b.setPower(true);
  return b;
}

describe('phototransistor', () => {
  const mk = (params = {}) => photoBench('phototransistor', ['collector', 'emitter'], params,
    { high: 'collector', low: 'emitter' });

  it('setControl moves it like an LDR (0 -> dark, 0.4 -> 0.4 x iMax)', () => {
    const b = mk({ iMax: 0.002 });
    close(b.nodeVoltage('mid'), 0, 1e-3, 'dark by default');
    b.setControl('P', 0.4);
    close(b.nodeVoltage('mid'), 0.8, 1e-3, '0.8 mA into 1 kΩ');
    b.setControl('P', 0);
    close(b.nodeVoltage('mid'), 0, 1e-3, 'dark again');
  });

  it('a set control wins over the authored light param', () => {
    const b = mk({ iMax: 0.002, light: 1 });
    close(b.nodeVoltage('mid'), 2, 1e-2, 'authored full light');
    b.setControl('P', 0.25);
    close(b.nodeVoltage('mid'), 0.5, 1e-3, 'control 0.25');
  });

  it('is listed by getControls with its present light as the value', () => {
    const b = mk({ light: 0.7 });
    const c = b.getControls().find(x => x.id === 'P');
    assert.ok(c, 'phototransistor listed');
    assert.equal(c.kind, 'phototransistor');
    assert.equal(c.value, 0.7);
    b.setControl('P', 0.2);
    assert.equal(b.getControls().find(x => x.id === 'P').value, 0.2);
  });
});

describe('photodiode', () => {
  it('setControl drives its photocurrent (reverse-biased into 1 kΩ)', () => {
    const b = photoBench('photodiode', ['anode', 'cathode'], { iMax: 0.001 },
      { high: 'cathode', low: 'anode' });
    close(b.nodeVoltage('mid'), 0, 1e-3, 'dark');
    b.setControl('P', 0.5);
    close(b.nodeVoltage('mid'), 0.5, 1e-3, '0.5 mA into 1 kΩ');
    assert.ok(b.getControls().some(x => x.id === 'P' && x.kind === 'photodiode'));
  });
});

describe('solar_cell', () => {
  it('setControl dims it: open-circuit voltage falls, short-circuit current scales', () => {
    const b = new BoardImpl(5);
    b.setNetlist([
      { id: 'S', kind: 'solar_cell', params: {}, terminals: ['pos', 'neg'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R', kind: 'resistor', params: { ohms: 0.5 }, terminals: ['a', 'b'] },
    ], [net('p', ['S', 'pos'], ['R', 'a']), net('g', ['S', 'neg'], ['R', 'b'], ['G', 'gnd'])]);
    b.setPower(true);
    const full = b.nodeVoltage('p');                 // default light 1.0
    b.setControl('S', 0.5);
    const half = b.nodeVoltage('p');
    // Into 0.5 Ω the cell is near short circuit: the current halves.
    close(half / full, 0.5, 0.03, 'near-short current scales with light');
    const c = b.getControls().find(x => x.id === 'S');
    assert.ok(c && c.value === 0.5, 'solar_cell listed with its control');
  });

  it('with no control set, getControls reports its default full light', () => {
    const b = new BoardImpl(5);
    b.setNetlist([{ id: 'S', kind: 'solar_cell', params: {}, terminals: ['pos', 'neg'] },
      { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] }],
    [net('g', ['S', 'neg'], ['G', 'gnd']), net('p', ['S', 'pos'])]);
    assert.equal(b.getControls().find(x => x.id === 'S').value, 1);
  });
});
