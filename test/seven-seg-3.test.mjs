// seven_seg_3 — the 3-digit multiplexed display (056SMG-3, the retro
// console's score). Eight shared segment lines, one common per digit; the
// composite expands to 24 LEDs and the multiplex physics must fall out:
// a segment lights ONLY on the digit whose common is low, and scanning
// digits divides brightness by the duty exactly like the matrices.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

const US = 1_000n;

function bench() {
  // MCU pins drive segment 'a' and the three commons through the pin
  // interface: vcc/gnd rails plus a resistor per line keeps the MNA happy.
  const parts = [
    { id: 'mcu1', kind: 'mcu', params: {}, terminals: ['P1.0', 'P2.0', 'P2.1', 'P2.2'] },
    { id: 'disp', kind: 'seven_seg_3', params: {}, terminals: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp', 'com0', 'com1', 'com2'] },
    { id: 'r1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
    { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
  ];
  const nets = [
    { id: 'n_seg', terminals: [{ part: 'mcu1', terminal: 'P1.0' }, { part: 'r1', terminal: 'a' }] },
    { id: 'n_a', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'disp', terminal: 'a' }] },
    { id: 'n_c0', terminals: [{ part: 'mcu1', terminal: 'P2.0' }, { part: 'disp', terminal: 'com0' }] },
    { id: 'n_c1', terminals: [{ part: 'mcu1', terminal: 'P2.1' }, { part: 'disp', terminal: 'com1' }] },
    { id: 'n_c2', terminals: [{ part: 'mcu1', terminal: 'P2.2' }, { part: 'disp', terminal: 'com2' }] },
    { id: 'n_v', terminals: [{ part: 'v1', terminal: 'vcc' }] },
    { id: 'n_g', terminals: [{ part: 'g1', terminal: 'gnd' }] },
  ];
  const b = new BoardImpl(5.0);
  b.setNetlist(parts, nets);
  b.setPower(true);
  return b;
}

describe('seven_seg_3 — one bus, three digits', () => {
  it('validates and expands: the netlist is accepted, 24 synthetic LEDs exist', () => {
    const b = bench();
    const bright = b.sevenSeg3Brightness('disp');
    assert.equal(bright.length, 3);
    for (const digit of bright) {
      assert.deepEqual(Object.keys(digit).sort(),
        ['a', 'b', 'c', 'd', 'dp', 'e', 'f', 'g'].sort());
    }
  });

  it("segment 'a' high lights ONLY the digit whose common is low", () => {
    const b = bench();
    b.setPin('P1.0', 'pushpull', true);   // segment a high
    b.setPin('P2.0', 'pushpull', false);  // digit 0 selected (common low)
    b.setPin('P2.1', 'pushpull', true);   // digits 1, 2 deselected
    b.setPin('P2.2', 'pushpull', true);
    let t = b.timeNs;
    for (let k = 0; k < 40; k++) { t += 500n * US; b.advanceTo(t); }
    const [d0, d1, d2] = b.sevenSeg3Brightness('disp');
    assert.ok(d0.a > 0.5, `selected digit lit, got ${d0.a}`);
    assert.ok(d1.a < 0.05, `deselected digit dark, got ${d1.a}`);
    assert.ok(d2.a < 0.05, `deselected digit dark, got ${d2.a}`);
    assert.ok(d0.b < 0.05, 'undriven segment stays dark');
  });

  it('scanning the commons multiplexes: each digit integrates its own duty', () => {
    const b = bench();
    b.setPin('P1.0', 'pushpull', true);
    let t = b.timeNs;
    // 200 scan cycles at 0.5 ms per phase — faster than the brightness
    // filter's time constant, so the reading converges to the DUTY, the
    // way a real multiplexed display averages in the eye.
    for (let cycle = 0; cycle < 200; cycle++) {
      b.setPin('P2.0', 'pushpull', false); b.setPin('P2.1', 'pushpull', true); b.setPin('P2.2', 'pushpull', true);
      t += 500n * US; b.advanceTo(t);
      b.setPin('P2.0', 'pushpull', true); b.setPin('P2.1', 'pushpull', false);
      t += 500n * US; b.advanceTo(t);
      b.setPin('P2.1', 'pushpull', true); // nobody selected
      t += 500n * US; b.advanceTo(t);
    }
    const [d0, d1, d2] = b.sevenSeg3Brightness('disp');
    assert.ok(d0.a > 0.1 && d0.a < 0.7, `digit0 at ~1/3 duty, got ${d0.a}`);
    assert.ok(d1.a > 0.1 && d1.a < 0.7, `digit1 at ~1/3 duty, got ${d1.a}`);
    assert.ok(d2.a < 0.05, `digit2 never selected, got ${d2.a}`);
    assert.ok(Math.abs(d0.a - d1.a) < 0.15, 'equal duty, equal brightness');
  });
});
