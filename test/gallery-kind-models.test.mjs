// Every advertised part kind must be modelled — the audit found two
// kinds ('555', rgb_led) that validation accepted and nothing stamped:
// silent dead parts in teaching material. This is the Layer-1
// hardening rule as a ratchet: KNOWN_INERT may only shrink.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

describe('gallery kind coverage', () => {
  it("the '555' kind is modelled: floating pin 5 sits at 2/3 VCC", () => {
    const parts = [
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 't1', kind: '555', params: {},
        terminals: ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'] },
    ];
    const nets = [
      { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 't1', terminal: 'vcc' }] },
      { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 't1', terminal: 'gnd' }] },
      { id: 'n_c', terminals: [{ part: 't1', terminal: 'control' }] }, // pin 5 floating
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.advanceTo(1n);
    const vControl = b.nodeVoltages.get('n_c');
    assert.ok(Math.abs(vControl - 10 / 3) < 0.15,
      `internal divider must hold floating pin 5 at 2/3 VCC ≈ 3.33, got ${vControl}`);
  });

  it('every kind in the terminal table is stamped or registered (ratchet)', () => {
    // Kinds mna.js stamps directly (the built-in analog set).
    const STAMPED = new Set([
      'vcc', 'gnd', 'resistor', 'capacitor', 'inductor', 'diode', 'led',
      'zener', 'potentiometer', 'button', 'switch', 'buzzer', 'ldr', 'ntc',
      'npn', 'pnp', 'nmos', 'pmos', 'opamp', 'vsource', 'isource', 'mcu',
      'seven_segment', 'shift_register', 'ir_receiver', 'temp_sensor',
      'eeprom', 'led_matrix', 'led_cube',
    ]);
    // The shame list. It may only SHRINK; a new inert kind is a bug.
    const KNOWN_INERT = new Set(['rgb_led']);
    const kinds = BoardImpl.getPartKinds ? BoardImpl.getPartKinds() : [];
    assert.ok(kinds.length > 50, `kind table enumerable, got ${kinds.length}`);
    const inert = kinds.filter((k) =>
      !STAMPED.has(k) && !getDevice(k) && !KNOWN_INERT.has(k));
    assert.deepEqual(inert, [],
      `kinds advertised but modelled by nothing (add a model or, with a stated reason, to KNOWN_INERT): ${inert}`);
    const healed = [...KNOWN_INERT].filter((k) => getDevice(k));
    assert.deepEqual(healed, [], `remove from KNOWN_INERT, now modelled: ${healed}`);
  });
});

describe('stored charge survives power-off (audit escalation)', () => {
  it('a charged cap discharges through its bleeder at the real tau', () => {
    const parts = [
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
      { id: 'c1', kind: 'capacitor', params: { farads: 0.001 }, terminals: ['a', 'b'] },
      { id: 'rb', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }] },
      { id: 'n_c', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'c1', terminal: 'a' }, { part: 'rb', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'c1', terminal: 'b' }, { part: 'rb', terminal: 'b' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.advanceTo(2_000_000_000n);
    const v0 = b.capVoltages.get('c1');
    assert.ok(v0 > 4.5, `charged, got ${v0}`);
    b.setPower(false);
    b.advanceTo(6_700_000_000n); // one tau (4.7s) later
    const v1 = b.capVoltages.get('c1');
    assert.ok(Math.abs(v1 - v0 / Math.E) < 0.1,
      `one tau of discharge: expected ~${(v0 / Math.E).toFixed(2)}, got ${v1}`);
    const node = b.nodeVoltages.get('n_c');
    assert.ok(Math.abs(node - v1) < 0.05, 'the node tells the same truth as the cap state');
  });
});
