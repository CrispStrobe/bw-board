/**
 * 74HC373 — octal TRANSPARENT D latch (E5.6). Datasheet truth table:
 * LE=H → Q follows D; LE falling edge latches; /OE=H → high-Z.
 *
 * The load-bearing assertion is the one that distinguishes it from the
 * '374 already in the catalog: a data change DURING LE-high propagates
 * immediately, where a '374 holds until the next rising clock edge.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerLogicChips, CHIPS } from '../src/devices/chip-composer.js';
import { unregisterDevice } from '../src/devices.js';

function setup() { registerLogicChips(); }
function teardown() {
  for (const c of CHIPS) { try { unregisterDevice(c.kind); } catch {} }
  for (const k of ['74hc373', '74hc374']) { try { unregisterDevice(k); } catch {} }
}

function latchBench(kind, ctlName) {
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'U1', kind, params: {}, terminals: [
      'oeb', 'q0', 'd0', 'd1', 'q1', 'q2', 'd2', 'd3', 'q3', 'gnd',
      ctlName, 'q4', 'd4', 'd5', 'q5', 'q6', 'd6', 'd7', 'q7', 'vcc'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
  ];
  const nets = [
    { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
    { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
    { id: 'net_d0', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'd0' }] },
    { id: 'net_ctl', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: ctlName }] },
    { id: 'net_oe', terminals: [{ part: 'MCU', terminal: 'P1.2' }, { part: 'U1', terminal: 'oeb' }] },
    { id: 'net_q0', terminals: [{ part: 'U1', terminal: 'q0' }, { part: 'R1', terminal: 'a' }] },
  ];
  const board = new BoardImpl(5.0);
  board.setNetlist(parts, nets);
  board.setPin('P1.2', 'pushpull', false); // /OE low: outputs enabled
  return board;
}

describe('74HC373 transparent latch', () => {
  beforeEach(setup);
  afterEach(teardown);

  it('follows D while LE is high, latches on the falling edge', () => {
    const b = latchBench('74hc373', 'le');
    b.setPin('P1.1', 'pushpull', true);  // LE high: transparent
    b.setPin('P1.0', 'pushpull', true);
    assert.ok(b.nodeVoltage('net_q0') > 4.0, 'Q follows D=1 while transparent');
    b.setPin('P1.0', 'pushpull', false);
    assert.ok(b.nodeVoltage('net_q0') < 1.0, 'Q follows D=0 while transparent');

    b.setPin('P1.0', 'pushpull', true);
    assert.ok(b.nodeVoltage('net_q0') > 4.0, 'transparent again before latching');
    b.setPin('P1.1', 'pushpull', false); // LE falls: latch the 1
    b.setPin('P1.0', 'pushpull', false); // D changes after the latch
    assert.ok(b.nodeVoltage('net_q0') > 4.0, 'Q holds the latched 1 with LE low');
  });

  it("is NOT a '374: a D change during LE/CLK high propagates on the '373 only", () => {
    // Same bench, same stimulus, both chips: control high, then flip D.
    const b373 = latchBench('74hc373', 'le');
    b373.setPin('P1.1', 'pushpull', true);
    b373.setPin('P1.0', 'pushpull', true);
    assert.ok(b373.nodeVoltage('net_q0') > 4.0);

    const b374 = latchBench('74hc374', 'clk');
    b374.setPin('P1.0', 'pushpull', true); // D=1 first, CLK still low
    b374.setPin('P1.1', 'pushpull', true); // rising edge captures 1
    assert.ok(b374.nodeVoltage('net_q0') > 4.0, "the '374 captured on the edge");

    // Now flip D with the control line STILL high.
    b373.setPin('P1.0', 'pushpull', false);
    b374.setPin('P1.0', 'pushpull', false);
    assert.ok(b373.nodeVoltage('net_q0') < 1.0,
      "the '373 is transparent: Q dropped with D");
    assert.ok(b374.nodeVoltage('net_q0') > 4.0,
      "the '374 is edge-triggered: Q still holds the captured 1");
  });

  it('tri-states on /OE high and recovers', () => {
    const b = latchBench('74hc373', 'le');
    b.setPin('P1.1', 'pushpull', true);
    b.setPin('P1.0', 'pushpull', true);
    assert.ok(b.nodeVoltage('net_q0') > 4.0);
    b.setPin('P1.2', 'pushpull', true); // /OE high → high-Z
    assert.ok(b.nodeVoltage('net_q0') < 1.0,
      'high-Z output: the 10k pulldown owns the net');
    b.setPin('P1.2', 'pushpull', false);
    assert.ok(b.nodeVoltage('net_q0') > 4.0, 'enabled again: the latched 1 returns');
  });
});
