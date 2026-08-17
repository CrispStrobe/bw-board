/**
 * HD44780 backlight and contrast state tests.
 *
 * Backlight: A-K branch current → state.backlight 0..1 (rated 20 mA).
 *   Wired A→VCC, K→GND through a series resistor: current flows, lit.
 *   Unwired or same-net A/K: no current, dark.
 *
 * Contrast: Vlcd = VDD - V0 → state.contrast 0..1.
 *   V0 at GND (Vlcd=5V): full contrast.
 *   V0 at VDD (Vlcd=0V): invisible.
 *   Pot sweep across the range maps linearly through the visible knee.
 *
 * HD44780U datasheet reference: ADE-207-272(Z), Table 8 (p.49).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerHD44780 } from '../src/devices/hd44780.js';

try { registerHD44780(); } catch {}

function makeLCDBoard(opts = {}) {
  const v0Target = opts.v0 ?? 'gnd';  // 'gnd', 'vcc', or 'pot' (potentiometer)
  const backlightR = opts.backlightR ?? 220;  // series resistor for backlight
  const wireBacklight = opts.wireBacklight !== false;

  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'LCD', kind: 'hd44780', params: {},
      terminals: ['vss', 'vdd', 'v0', 'rs', 'rw', 'e',
        'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'a', 'k'] },
  ];
  const nets = [
    { id: 'vcc', terminals: [
      { part: 'VCC', terminal: 'vcc' },
      { part: 'LCD', terminal: 'vdd' },
    ]},
    { id: 'gnd', terminals: [
      { part: 'GND', terminal: 'gnd' },
      { part: 'LCD', terminal: 'vss' },
    ]},
  ];

  // V0 wiring
  if (v0Target === 'gnd') {
    nets[1].terminals.push({ part: 'LCD', terminal: 'v0' });
  } else if (v0Target === 'vcc') {
    nets[0].terminals.push({ part: 'LCD', terminal: 'v0' });
  } else if (typeof v0Target === 'number') {
    // Use a voltage divider to set V0 to a specific voltage
    // Pot modeled as two resistors forming a divider
    const r1 = 10000 * (1 - v0Target / 5.0);  // VCC side
    const r2 = 10000 * (v0Target / 5.0);        // GND side
    if (r1 > 0) {
      parts.push({ id: 'R_V0_TOP', kind: 'resistor', params: { ohms: Math.max(r1, 1) }, terminals: ['a', 'b'] });
      nets[0].terminals.push({ part: 'R_V0_TOP', terminal: 'a' });
      if (r2 > 0) {
        parts.push({ id: 'R_V0_BOT', kind: 'resistor', params: { ohms: Math.max(r2, 1) }, terminals: ['a', 'b'] });
        nets.push({ id: 'v0_net', terminals: [
          { part: 'R_V0_TOP', terminal: 'b' },
          { part: 'R_V0_BOT', terminal: 'a' },
          { part: 'LCD', terminal: 'v0' },
        ]});
        nets[1].terminals.push({ part: 'R_V0_BOT', terminal: 'b' });
      } else {
        nets.push({ id: 'v0_net', terminals: [
          { part: 'R_V0_TOP', terminal: 'b' },
          { part: 'LCD', terminal: 'v0' },
        ]});
        nets[1].terminals.push({ part: 'R_V0_TOP', terminal: 'b' });  // GND side
      }
    }
  }

  // Backlight wiring
  if (wireBacklight) {
    parts.push({ id: 'R_BL', kind: 'resistor', params: { ohms: backlightR }, terminals: ['a', 'b'] });
    nets[0].terminals.push({ part: 'R_BL', terminal: 'a' });
    nets.push({ id: 'bl_mid', terminals: [
      { part: 'R_BL', terminal: 'b' },
      { part: 'LCD', terminal: 'a' },
    ]});
    nets[1].terminals.push({ part: 'LCD', terminal: 'k' });
  }

  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  board.setPower(true);
  board.advanceTo(1_000_000n); // 1 ms for settle
  return board;
}

describe('HD44780 backlight', () => {

  it('wired backlight (VCC → 220Ω → A, K → GND): backlight > 0', () => {
    const board = makeLCDBoard({ wireBacklight: true, backlightR: 220 });
    const st = board.getDeviceState('LCD');
    assert.ok(st.backlight > 0.1,
      `backlight should be lit with 220Ω, got ${st.backlight.toFixed(3)}`);
  });

  it('unwired backlight: backlight ≈ 0', () => {
    const board = makeLCDBoard({ wireBacklight: false });
    const st = board.getDeviceState('LCD');
    assert.ok(st.backlight < 0.01,
      `unwired backlight should be dark, got ${st.backlight.toFixed(3)}`);
  });

  it('backlight scales with series resistance', () => {
    const boardLow = makeLCDBoard({ wireBacklight: true, backlightR: 100 });
    const boardHigh = makeLCDBoard({ wireBacklight: true, backlightR: 1000 });
    const bLow = boardLow.getDeviceState('LCD').backlight;
    const bHigh = boardHigh.getDeviceState('LCD').backlight;
    assert.ok(bLow > bHigh,
      `lower R should give brighter backlight: ${bLow.toFixed(3)} > ${bHigh.toFixed(3)}`);
  });
});

describe('HD44780 contrast from V0', () => {

  it('V0 at GND (Vlcd=5V): full contrast', () => {
    const board = makeLCDBoard({ v0: 'gnd', wireBacklight: false });
    const st = board.getDeviceState('LCD');
    assert.ok(st.contrast > 0.9,
      `V0=GND should give full contrast, got ${st.contrast.toFixed(3)}`);
  });

  it('V0 at VCC (Vlcd=0V): invisible (contrast=0)', () => {
    const board = makeLCDBoard({ v0: 'vcc', wireBacklight: false });
    const st = board.getDeviceState('LCD');
    assert.ok(st.contrast < 0.1,
      `V0=VCC should give zero contrast, got ${st.contrast.toFixed(3)}`);
  });

  it('V0 at 3V (Vlcd=2V): contrast at threshold', () => {
    const board = makeLCDBoard({ v0: 3.0, wireBacklight: false });
    const st = board.getDeviceState('LCD');
    // Vlcd=2V → contrast = (2-2)/2 = 0 — just at the threshold
    assert.ok(st.contrast >= 0 && st.contrast < 0.15,
      `V0=3V (Vlcd=2V) should be at visibility threshold, got ${st.contrast.toFixed(3)}`);
  });

  it('pot sweep: contrast increases as V0 decreases', () => {
    // V0=4V → Vlcd=1V → dark
    // V0=2V → Vlcd=3V → moderate
    // V0=0.5V → Vlcd=4.5V → full
    const b4 = makeLCDBoard({ v0: 4.0, wireBacklight: false });
    const b2 = makeLCDBoard({ v0: 2.0, wireBacklight: false });
    const b05 = makeLCDBoard({ v0: 0.5, wireBacklight: false });

    const c4 = b4.getDeviceState('LCD').contrast;
    const c2 = b2.getDeviceState('LCD').contrast;
    const c05 = b05.getDeviceState('LCD').contrast;

    assert.ok(c05 > c2, `V0=0.5V should beat V0=2V: ${c05.toFixed(3)} > ${c2.toFixed(3)}`);
    assert.ok(c2 > c4, `V0=2V should beat V0=4V: ${c2.toFixed(3)} > ${c4.toFixed(3)}`);
    assert.ok(c05 > 0.8, `V0=0.5V (Vlcd≈4.5V) should be nearly full, got ${c05.toFixed(3)}`);
    assert.ok(c4 < 0.1, `V0=4V (Vlcd≈1V) should be invisible, got ${c4.toFixed(3)}`);
  });
});
