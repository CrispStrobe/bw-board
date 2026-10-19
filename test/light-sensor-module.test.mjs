/**
 * light_sensor — the three-pin photoresistor module (vcc/gnd/out) as a
 * divider: LDR vcc→out, fixed rLoad out→gnd. Asserts OUT follows the same
 * light control the built-in `ldr` uses, rising monotonically with light,
 * and equals the discrete ldr + resistor divider it stands for.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerSensors } from '../src/devices/sensors.js';

registerSensors();

const VCC = 5.0;

function moduleBoard(params = {}) {
  const board = new BoardImpl(VCC);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'LS', kind: 'light_sensor', params, terminals: ['vcc', 'gnd', 'out'] },
  ], [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LS', terminal: 'vcc' }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'LS', terminal: 'gnd' }] },
    { id: 'no', terminals: [{ part: 'LS', terminal: 'out' }] },
  ]);
  return board;
}

function discreteBoard() {
  const board = new BoardImpl(VCC);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'LDR', kind: 'ldr', params: {}, terminals: ['a', 'b'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ], [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'LDR', terminal: 'a' }] },
    { id: 'no', terminals: [{ part: 'LDR', terminal: 'b' }, { part: 'R1', terminal: 'a' }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
  ]);
  return board;
}

const out = (board, id, light) => { board.setControl(id, light); return board.nodeVoltage('no'); };
const LIGHTS = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

describe('light_sensor photoresistor module', () => {
  it('OUT rises strictly with light across the sweep', () => {
    const board = moduleBoard();
    const vs = LIGHTS.map(l => out(board, 'LS', l));
    for (let i = 1; i < vs.length; i++) {
      assert.ok(vs[i] > vs[i - 1], `light ${LIGHTS[i]}: ${vs[i]} V not above ${vs[i - 1]} V`);
    }
  });

  it('dark is near 0 V and full light near VCC (default 1M/100 LDR, 10k load)', () => {
    const board = moduleBoard();
    const dark = out(board, 'LS', 0);
    const bright = out(board, 'LS', 1);
    // 5 * 10k / (1M + 10k) = 0.0495 V; 5 * 10k / (100 + 10k) = 4.950 V
    assert.ok(Math.abs(dark - 5 * 1e4 / (1e6 + 1e4)) < 1e-3, `dark ${dark}`);
    assert.ok(Math.abs(bright - 5 * 1e4 / (100 + 1e4)) < 1e-3, `bright ${bright}`);
  });

  it('equals the discrete vcc→ldr→out→10k→gnd divider at every light level', () => {
    const mod = moduleBoard();
    const ref = discreteBoard();
    for (const l of LIGHTS) {
      const a = out(mod, 'LS', l);
      const b = out(ref, 'LDR', l);
      assert.ok(Math.abs(a - b) < 1e-6, `light ${l}: module ${a} vs discrete ${b}`);
    }
  });

  it('honours rLoad / rDark / rLight params', () => {
    const board = moduleBoard({ rLoad: 47000, rDark: 200000, rLight: 1000 });
    const v = out(board, 'LS', 0);
    assert.ok(Math.abs(v - 5 * 47000 / (200000 + 47000)) < 1e-3, `dark ${v}`);
  });

  it('is offered as a control, like the ldr', () => {
    const board = moduleBoard();
    assert.ok(board.getControls().some(c => c.id === 'LS' && c.kind === 'light_sensor'));
  });
});
