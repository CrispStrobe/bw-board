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
      'seven_segment', 'seven_seg_3', 'seven_seg_4', 'shift_register', 'ir_receiver', 'temp_sensor',
      'eeprom', 'led_matrix', 'led_cube',
      'rgb_led', // expanded to _r/_g/_b sub-LEDs in setNetlist
    ]);
    // The shame list. It may only SHRINK; a new inert kind is a bug.
    const KNOWN_INERT = new Set([]); // emptied 2026-08-15: rgb_led expands to sub-LEDs now
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

describe('composite expansion + buzzer DC (last audit escalations)', () => {
  it('a designer-placed rgb_led lights its channels', () => {
    const parts = [
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'rr', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
      { id: 'rgb', kind: 'rgb_led', params: {},
        terminals: ['r_anode', 'g_anode', 'b_anode', 'cathode'] },
    ];
    const nets = [
      { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'rr', terminal: 'a' }] },
      { id: 'n_r', terminals: [{ part: 'rr', terminal: 'b' }, { part: 'rgb', terminal: 'r_anode' }] },
      { id: 'n_g', terminals: [{ part: 'rgb', terminal: 'g_anode' }] },
      { id: 'n_b', terminals: [{ part: 'rgb', terminal: 'b_anode' }] },
      { id: 'n_k', terminals: [{ part: 'rgb', terminal: 'cathode' }, { part: 'g1', terminal: 'gnd' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.advanceTo(1n);
    const { r, g, b: blue } = b.rgbLedBrightness('rgb');
    assert.ok(r > 0.05, `red channel lit through its resistor, got ${r}`);
    assert.equal(g, 0, 'green unwired stays dark');
    assert.equal(blue, 0, 'blue unwired stays dark');
    // and it is no longer a 5V short: the red anode sits at a diode-ish drop
    const vAnode = b.nodeVoltages.get('n_r');
    assert.ok(vAnode > 1 && vAnode < 4, `real diode drop at the anode, got ${vAnode}`);
  });

  it('an active buzzer on plain DC sounds its rated tone', () => {
    const parts = [
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'bz', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
    ];
    const nets = [
      { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'bz', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'bz', terminal: 'b' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.advanceTo(1n);
    const tone = b.buzzerTone('bz');
    assert.equal(tone.on, true, 'DC across an active buzzer IS sound');
    assert.equal(tone.hz, 2400);
    b.setPower(false);
    assert.equal(b.buzzerTone('bz').on, false, 'power off silences it');
  });
});

describe('power-off discharge with devices on the board (substep path)', () => {
  it('a charged cap still discharges at tau when a device forces substepping', () => {
    // Same RC as above PLUS a 555 — its device state forces the
    // device-substep path in advanceTo, which used to skip power-off
    // integration entirely (the gate read `hasDevices && this.powered`),
    // freezing stored charge the moment a device shared the board.
    const parts = [
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'r1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
      { id: 'c1', kind: 'capacitor', params: { farads: 0.001 }, terminals: ['a', 'b'] },
      { id: 'rb', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
      { id: 't1', kind: '555', params: {},
        terminals: ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'] },
    ];
    const nets = [
      { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }, { part: 't1', terminal: 'vcc' }] },
      { id: 'n_c', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'c1', terminal: 'a' }, { part: 'rb', terminal: 'a' }] },
      { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'c1', terminal: 'b' }, { part: 'rb', terminal: 'b' }, { part: 't1', terminal: 'gnd' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    // Tick-wise like a real session (MCU boards advance in ms steps);
    // a single multi-second jump is bounded by the documented 200-substep
    // accuracy cap and is not what sessions do.
    for (let t = 100n; t <= 2000n; t += 100n) b.advanceTo(t * 1_000_000n);
    const v0 = b.capVoltages.get('c1');
    assert.ok(v0 > 4.5, `charged, got ${v0}`);
    b.setPower(false);
    for (let t = 2100n; t <= 6700n; t += 100n) b.advanceTo(t * 1_000_000n);
    const v1 = b.capVoltages.get('c1');
    // The dead 555's supply pin is itself a load through r1, so the
    // discharge runs FASTER than the bleeder-only tau — before the fix
    // the substep path froze the charge entirely (v1 === v0).
    assert.ok(v1 < v0 / Math.E, `discharging faster than bleeder-only tau, got ${v1}`);
    assert.ok(v1 > 0.1, `a real exponential, not an instant zero: ${v1}`);
  });
});

describe('diode default Vf (wiring-sweep escalation 2026-08-15)', () => {
  it('a bare diode is silicon (0.7 V), not an LED junction', () => {
    const mk = (kind) => {
      const b = new BoardImpl(5.0);
      b.setNetlist([
        { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'd1', kind, params: {}, terminals: ['anode', 'cathode'] },
      ], [
        { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }] },
        { id: 'n_a', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'd1', terminal: 'anode' }] },
        { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'd1', terminal: 'cathode' }] },
      ]);
      b.advanceTo(1_000_000n);
      return b.nodeVoltages.get('n_a');
    };
    const vDiode = mk('diode');
    const vLed = mk('led');
    assert.ok(Math.abs(vDiode - 0.74) < 0.1, `bare diode anode ~0.74 V, got ${vDiode}`);
    assert.ok(vLed > 1.9, `bare LED keeps its ~2 V junction, got ${vLed}`);
  });
});
