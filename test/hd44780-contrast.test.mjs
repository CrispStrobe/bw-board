// The V0 pin is physical now: a contrast pot wired VCC—wiper→V0—GND
// sweeps the text from full contrast to invisible, exactly the first
// knob every real LCD build makes you turn.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

function bench() {
  const parts = [
    { id: 'lcd', kind: 'hd44780', params: {},
      terminals: ['vss', 'vdd', 'v0', 'rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a', 'k'] },
    { id: 'pot1', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'wiper', 'b'] },
    { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'n_vcc', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'lcd', terminal: 'vdd' }, { part: 'pot1', terminal: 'a' }] },
    { id: 'n_gnd', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'lcd', terminal: 'vss' }, { part: 'pot1', terminal: 'b' }] },
    { id: 'n_v0', terminals: [{ part: 'pot1', terminal: 'wiper' }, { part: 'lcd', terminal: 'v0' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

describe('hd44780 contrast pot', () => {
  it('sweeping the pot sweeps the contrast: low V0 sharp, high V0 blank', () => {
    const b = bench();
    const at = (frac) => {
      b.setControl('pot1', frac);
      b.advanceTo(b.timeNs + 1_000_000n);
      return b.getDeviceState('lcd').contrast;
    };
    const sharp = at(0.0);   // wiper at the GND end: V0 ≈ 0
    const mid = at(0.55);    // mid-travel
    const blank = at(1.0);   // wiper at the VCC end: V0 ≈ 5
    assert.ok(sharp > 0.9, `V0 near 0 V is full contrast, got ${sharp}`);
    assert.ok(mid > 0.05 && mid < 0.95, `mid travel is partial, got ${mid}`);
    assert.ok(blank < 0.05, `V0 near VDD is invisible, got ${blank}`);
    assert.ok(sharp > mid && mid > blank, 'monotonic along the travel');
  });

  it('an unwired V0 keeps the tutorial default: full contrast', () => {
    const parts = [
      { id: 'lcd', kind: 'hd44780', params: {},
        terminals: ['vss', 'vdd', 'v0', 'rs', 'rw', 'e', 'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a', 'k'] },
      { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    const nets = [
      { id: 'n_vcc', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'lcd', terminal: 'vdd' }] },
      { id: 'n_gnd', terminals: [{ part: 'g1', terminal: 'gnd' }, { part: 'lcd', terminal: 'vss' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.setPower(true);
    b.advanceTo(1_000_000n);
    assert.ok(b.getDeviceState('lcd').contrast > 0.9);
  });
});
