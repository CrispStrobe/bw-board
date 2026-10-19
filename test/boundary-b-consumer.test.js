/**
 * Boundary B consumer tests: exercise the API surface exactly as
 * the circuit designer UI would use it. These tests protect against
 * breaking changes that would affect bw-circuit-ui.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { inferNetlist } from '../src/infer-netlist.js';

describe('boundary B: UI lifecycle', () => {
  it('create board → setNetlist → setPin → advanceTo → query', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [
        { name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true },
        { name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false },
      ],
    });
    board.setNetlist(parts, nets);

    board.setPin('P1.0', 'quasi', false);
    board.setPin('P1.3', 'input', false);
    board.setControl('POT_pot', 0.5);
    board.advanceTo(25_000_000n);

    // All boundary B queries should work
    const brightness = board.ledBrightness('LED_led');
    const voltage = board.nodeVoltage('net_vcc');
    const analog = board.readAnalog('P1.3');
    const digital = board.readPin('P1.0');
    const resistance = board.resistance('net_vcc', 'net_gnd');

    assert.equal(typeof brightness, 'number');
    assert.equal(typeof voltage, 'number');
    assert.equal(typeof analog, 'number');
    assert.ok(digital === 0 || digital === 1);
    assert.equal(resistance, 'requires-power-off');
  });

  it('setPower off → resistance becomes measurable', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'na', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'nb', terminals: [{ part: 'R1', terminal: 'b' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }] },
      ],
    );

    assert.equal(board.resistance('na', 'nb'), 'requires-power-off');
    board.setPower(false);
    const r = board.resistance('na', 'nb');
    assert.equal(typeof r, 'number');
  });

  it('setControl updates pot and triggers re-solve', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false }],
    });
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // UI slider moves pot from 0 to 1 in steps
    const readings = [];
    for (let i = 0; i <= 10; i++) {
      board.setControl('POT_pot', i / 10);
      readings.push(board.readAnalog('P1.3'));
    }

    // Should be monotonically increasing
    for (let i = 1; i < readings.length; i++) {
      assert.ok(readings[i] >= readings[i - 1],
        `monotonic: ${readings[i - 1]} ≤ ${readings[i]}`);
    }
    assert.ok(Math.abs(readings[0]) < 0.01, 'pos=0 → 0V');
    assert.ok(Math.abs(readings[10] - 5.0) < 0.01, 'pos=1 → 5V');
  });
});

describe('boundary B: rapid UI updates', () => {
  it('60 fps pot updates (16ms intervals)', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false }],
    });
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Simulate 60fps UI updates
    for (let frame = 0; frame < 60; frame++) {
      const pos = Math.sin(frame / 10) * 0.5 + 0.5; // oscillate
      board.setControl('POT_pot', pos);
      board.advanceTo(BigInt(frame) * 16_666_667n); // ~16.67ms per frame

      const v = board.readAnalog('P1.3');
      assert.ok(!Number.isNaN(v), `frame ${frame}: not NaN`);
      assert.ok(v >= 0 && v <= 5.0, `frame ${frame}: in range`);
    }
  });

  it('button rapid click/release', () => {
    const board = new BoardImpl(5.0);
    const { parts, nets } = inferNetlist({
      pins: [{ name: 'btn', port: 3, bit: 2, direction: 'input', activeLow: false }],
    });
    board.setNetlist(parts, nets);
    board.setPin('P3.2', 'input', false);

    for (let i = 0; i < 100; i++) {
      board.setControl('BTN_btn', i % 2);
      const pin = board.readPin('P3.2');
      assert.ok(pin === 0 || pin === 1);
    }
  });
});

describe('boundary B: querying nonexistent parts', () => {
  it('ledBrightness for missing part returns 0', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    assert.equal(board.ledBrightness('NOPE'), 0);
  });

  it('buzzerTone for missing part returns off', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const t = board.buzzerTone('NOPE');
    assert.equal(t.on, false);
    assert.equal(t.hz, 0);
  });

  it('nodeVoltage for missing net returns 0', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    assert.equal(board.nodeVoltage('NOPE'), 0);
  });

  it('sevenSegmentBrightness for missing part returns all zeros', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const ssb = board.sevenSegmentBrightness('NOPE');
    for (const seg of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'dp']) {
      assert.equal(ssb[seg], 0);
    }
  });

  it('rgbLedBrightness for missing part returns all zeros', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist([], []);
    const rgb = board.rgbLedBrightness('NOPE');
    assert.equal(rgb.r, 0);
    assert.equal(rgb.g, 0);
    assert.equal(rgb.b, 0);
  });
});

describe('boundary B: concurrent pin and control changes', () => {
  it('pin mode change + pot change in same tick', () => {
    const board = new BoardImpl(5.0);
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
      { id: 'POT', kind: 'potentiometer', params: { ohms: 10000 }, terminals: ['a', 'b', 'wiper'] },
      { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.3'] },
    ];
    const nets = [
      { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }, { part: 'POT', terminal: 'a' }] },
      { id: 'nr', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'np', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'MCU', terminal: 'P1.0' }] },
      { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'POT', terminal: 'b' }] },
      { id: 'nw', terminals: [{ part: 'POT', terminal: 'wiper' }, { part: 'MCU', terminal: 'P1.3' }] },
    ];
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);

    // Simultaneous: turn LED on AND move pot
    board.setPin('P1.0', 'pushpull', false);
    board.setControl('POT', 0.7);
    board.advanceTo(25_000_000n);

    const b = board.ledBrightness('LED1');
    const v = board.readAnalog('P1.3');
    assert.ok(b > 0.10, `LED on: ${b}`);
    assert.ok(Math.abs(v - 3.5) < 0.1, `pot at 70%: ${v}`);
  });
});

describe('boundary B: full netlist replacement', () => {
  it('swapping netlist clears all state cleanly', () => {
    const board = new BoardImpl(5.0);

    // First netlist: LED
    const n1 = inferNetlist({
      pins: [{ name: 'led', port: 1, bit: 0, direction: 'output', activeLow: true }],
    });
    board.setNetlist(n1.parts, n1.nets);
    board.setPin('P1.0', 'quasi', false);
    board.advanceTo(25_000_000n);
    assert.ok(board.ledBrightness('LED_led') > 0.10);

    // Replace with: pot only
    const n2 = inferNetlist({
      pins: [{ name: 'pot', port: 1, bit: 3, direction: 'analog', activeLow: false }],
    });
    board.setNetlist(n2.parts, n2.nets);
    board.setPin('P1.3', 'input', false);
    board.setControl('POT_pot', 0.5);

    // Old LED should be gone
    assert.equal(board.ledBrightness('LED_led'), 0);
    // New pot should work
    assert.ok(Math.abs(board.readAnalog('P1.3') - 2.5) < 0.1);
  });
});
