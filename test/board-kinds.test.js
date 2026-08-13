/**
 * Board-kind power pin tests — Arduino Nano, Uno, Pi Pico power terminals
 * act as voltage sources / ground references in the solver.
 *
 * Oracle values are derived by hand from Ohm's law, not from running the
 * solver first.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeBoard(parts, nets, vcc = 5.0) {
  const board = new BoardImpl(vcc);
  board.setNetlist(parts, nets);
  return board;
}

// ─── Arduino Nano ────────────────────────────────────────────────────────

describe('arduino_nano power pins', () => {
  it('5v terminal sources 5V to a resistor-LED circuit', () => {
    // Nano 5V → 220Ω → LED (Vf=2, Rd=10) → Nano GND
    // Expected: I = (5 - 2) / (220 + 10 + 0.1 + 0.1) ≈ 13.03 mA
    // LED anode voltage: 5 - I * (220 + 0.1) = 5 - 13.03e-3 * 220.1 ≈ 2.133V
    const board = makeBoard(
      [
        { id: 'NANO', kind: 'arduino_nano', params: {},
          terminals: ['5v', 'gnd', 'd13'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'n_5v', terminals: [
          { part: 'NANO', terminal: '5v' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_mid', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'LED1', terminal: 'anode' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'LED1', terminal: 'cathode' },
          { part: 'NANO', terminal: 'gnd' },
        ]},
      ],
    );

    const v5 = board.nodeVoltage('n_5v');
    const vGnd = board.nodeVoltage('n_gnd');

    assert.ok(Math.abs(v5 - 5.0) < 0.05,
      `5V pin should source ~5.0V, got ${v5.toFixed(3)}V`);
    assert.ok(Math.abs(vGnd) < 0.05,
      `GND pin should be ~0V, got ${vGnd.toFixed(3)}V`);

    // LED should be lit
    const brightness = board.ledBrightness('LED1');
    assert.ok(brightness > 0.3,
      `LED should be visibly lit (brightness ${brightness.toFixed(3)})`);
  });

  it('3v3 terminal sources 3.3V', () => {
    // Nano 3V3 → 1kΩ → Nano GND
    // Expected: I = 3.3 / (1000 + 0.1 + 0.1) ≈ 3.299 mA
    // Voltage at 3v3 net: 3.3V (supply)
    const board = makeBoard(
      [
        { id: 'NANO', kind: 'arduino_nano', params: {},
          terminals: ['3v3', 'gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_3v3', terminals: [
          { part: 'NANO', terminal: '3v3' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'NANO', terminal: 'gnd' },
        ]},
      ],
    );

    const v = board.nodeVoltage('n_3v3');
    assert.ok(Math.abs(v - 3.3) < 0.05,
      `3V3 pin should source ~3.3V, got ${v.toFixed(3)}V`);
  });

  it('gnd and gnd2 are both at 0V', () => {
    // 5V → 1kΩ → GND, and 5V → 1kΩ → GND2
    const board = makeBoard(
      [
        { id: 'NANO', kind: 'arduino_nano', params: {},
          terminals: ['5v', 'gnd', 'gnd2'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_5v', terminals: [
          { part: 'NANO', terminal: '5v' },
          { part: 'R1', terminal: 'a' },
          { part: 'R2', terminal: 'a' },
        ]},
        { id: 'n_gnd1', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'NANO', terminal: 'gnd' },
        ]},
        { id: 'n_gnd2', terminals: [
          { part: 'R2', terminal: 'b' },
          { part: 'NANO', terminal: 'gnd2' },
        ]},
      ],
    );

    const vG1 = board.nodeVoltage('n_gnd1');
    const vG2 = board.nodeVoltage('n_gnd2');
    assert.ok(Math.abs(vG1) < 0.05, `GND should be ~0V, got ${vG1.toFixed(3)}V`);
    assert.ok(Math.abs(vG2) < 0.05, `GND2 should be ~0V, got ${vG2.toFixed(3)}V`);
  });

  it('vin is high-Z (not driven by the board)', () => {
    // VIN has no internal source — it should float near 0V with pull-down
    const board = makeBoard(
      [
        { id: 'NANO', kind: 'arduino_nano', params: {},
          terminals: ['vin', 'gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_vin', terminals: [
          { part: 'NANO', terminal: 'vin' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'NANO', terminal: 'gnd' },
        ]},
      ],
    );

    const vVin = board.nodeVoltage('n_vin');
    // With only a 1MΩ pull-down and a 1kΩ resistor to GND, voltage should be near 0
    assert.ok(Math.abs(vVin) < 0.1,
      `VIN should be ~0V (undriven), got ${vVin.toFixed(3)}V`);
  });
});

// ─── Arduino Uno ─────────────────────────────────────────────────────────

describe('arduino_uno power pins', () => {
  it('5v and gnd work as supply', () => {
    const board = makeBoard(
      [
        { id: 'UNO', kind: 'arduino_uno', params: {},
          terminals: ['5v', 'gnd', 'd13'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 470 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_5v', terminals: [
          { part: 'UNO', terminal: '5v' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'UNO', terminal: 'gnd' },
        ]},
      ],
    );

    assert.ok(Math.abs(board.nodeVoltage('n_5v') - 5.0) < 0.05);
    assert.ok(Math.abs(board.nodeVoltage('n_gnd')) < 0.05);
  });

  it('gnd3 (third ground pin) is also at 0V', () => {
    const board = makeBoard(
      [
        { id: 'UNO', kind: 'arduino_uno', params: {},
          terminals: ['5v', 'gnd3'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_5v', terminals: [
          { part: 'UNO', terminal: '5v' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'UNO', terminal: 'gnd3' },
        ]},
      ],
    );

    assert.ok(Math.abs(board.nodeVoltage('n_gnd')) < 0.05,
      `GND3 should be ~0V`);
  });
});

// ─── Pi Pico ─────────────────────────────────────────────────────────────

describe('pi_pico power pins', () => {
  it('3v3 sources 3.3V, gnd_1 is at 0V', () => {
    const board = makeBoard(
      [
        { id: 'PICO', kind: 'pi_pico', params: {},
          terminals: ['3v3', 'gnd_1', 'gp0'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_3v3', terminals: [
          { part: 'PICO', terminal: '3v3' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'PICO', terminal: 'gnd_1' },
        ]},
      ],
    );

    assert.ok(Math.abs(board.nodeVoltage('n_3v3') - 3.3) < 0.05,
      `3V3 should be ~3.3V`);
    assert.ok(Math.abs(board.nodeVoltage('n_gnd')) < 0.05,
      `GND_1 should be ~0V`);
  });

  it('vbus sources ~5V (USB)', () => {
    const board = makeBoard(
      [
        { id: 'PICO', kind: 'pi_pico', params: {},
          terminals: ['vbus', 'gnd_1'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_vbus', terminals: [
          { part: 'PICO', terminal: 'vbus' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'PICO', terminal: 'gnd_1' },
        ]},
      ],
    );

    const v = board.nodeVoltage('n_vbus');
    assert.ok(Math.abs(v - 5.0) < 0.05,
      `VBUS should be ~5.0V, got ${v.toFixed(3)}V`);
  });

  it('vsys sources ~4.7V (USB through Schottky)', () => {
    const board = makeBoard(
      [
        { id: 'PICO', kind: 'pi_pico', params: {},
          terminals: ['vsys', 'gnd_1'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_vsys', terminals: [
          { part: 'PICO', terminal: 'vsys' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'PICO', terminal: 'gnd_1' },
        ]},
      ],
    );

    const v = board.nodeVoltage('n_vsys');
    assert.ok(Math.abs(v - 4.7) < 0.15,
      `VSYS should be ~4.7V, got ${v.toFixed(3)}V`);
  });

  it('agnd is at 0V (analog ground)', () => {
    const board = makeBoard(
      [
        { id: 'PICO', kind: 'pi_pico', params: {},
          terminals: ['3v3', 'agnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_3v3', terminals: [
          { part: 'PICO', terminal: '3v3' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_agnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'PICO', terminal: 'agnd' },
        ]},
      ],
    );

    assert.ok(Math.abs(board.nodeVoltage('n_agnd')) < 0.05,
      `AGND should be ~0V`);
  });

  it('multiple gnd pins all at 0V', () => {
    const board = makeBoard(
      [
        { id: 'PICO', kind: 'pi_pico', params: {},
          terminals: ['3v3', 'gnd_1', 'gnd_3', 'gnd_7', 'swd_gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R3', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R4', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_3v3', terminals: [
          { part: 'PICO', terminal: '3v3' },
          { part: 'R1', terminal: 'a' },
          { part: 'R2', terminal: 'a' },
          { part: 'R3', terminal: 'a' },
          { part: 'R4', terminal: 'a' },
        ]},
        { id: 'n_g1', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'PICO', terminal: 'gnd_1' }]},
        { id: 'n_g3', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'PICO', terminal: 'gnd_3' }]},
        { id: 'n_g7', terminals: [{ part: 'R3', terminal: 'b' }, { part: 'PICO', terminal: 'gnd_7' }]},
        { id: 'n_swd', terminals: [{ part: 'R4', terminal: 'b' }, { part: 'PICO', terminal: 'swd_gnd' }]},
      ],
    );

    for (const net of ['n_g1', 'n_g3', 'n_g7', 'n_swd']) {
      assert.ok(Math.abs(board.nodeVoltage(net)) < 0.05,
        `${net} should be ~0V`);
    }
  });
});

// ─── LED through board power pins (end-to-end) ──────────────────────────

describe('board-kind LED circuit', () => {
  it('Nano 5V → 220Ω → LED → GND gives correct brightness', () => {
    // I = (5 - 2) / (220 + 10 + 0.1 + 0.1) ≈ 13.03 mA
    // brightness = 13.03 / 20 ≈ 0.6517
    const board = makeBoard(
      [
        { id: 'NANO', kind: 'arduino_nano', params: {},
          terminals: ['5v', 'gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'n_5v', terminals: [
          { part: 'NANO', terminal: '5v' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_mid', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'LED1', terminal: 'anode' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'LED1', terminal: 'cathode' },
          { part: 'NANO', terminal: 'gnd' },
        ]},
      ],
    );

    const brightness = board.ledBrightness('LED1');
    // Derived: I = 3 / 230.2 = 0.01303 A, brightness = 0.01303 / 0.020 = 0.6513
    const expected = 3.0 / (220 + 10 + 0.2) / 0.020;
    assert.ok(Math.abs(brightness - expected) < expected * 0.1,
      `LED brightness should be ~${expected.toFixed(4)}, got ${brightness.toFixed(4)}`);
  });

  it('Pico 3V3 → 100Ω → LED (Vf=2) → GND gives correct brightness', () => {
    // I = (3.3 - 2) / (100 + 10 + 0.2) = 1.3 / 110.2 ≈ 11.80 mA
    // brightness = 11.80 / 20 ≈ 0.5899
    const board = makeBoard(
      [
        { id: 'PICO', kind: 'pi_pico', params: {},
          terminals: ['3v3', 'gnd_1'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'n_3v3', terminals: [
          { part: 'PICO', terminal: '3v3' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_mid', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'LED1', terminal: 'anode' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'LED1', terminal: 'cathode' },
          { part: 'PICO', terminal: 'gnd_1' },
        ]},
      ],
    );

    const brightness = board.ledBrightness('LED1');
    const expected = 1.3 / (100 + 10 + 0.2) / 0.020;
    assert.ok(Math.abs(brightness - expected) < expected * 0.1,
      `LED brightness should be ~${expected.toFixed(4)}, got ${brightness.toFixed(4)}`);
  });
});

describe('board-kind GPIO follows pinStates (the engine half of the contract)', () => {
  it('setPin lights a bench LED wired to a Nano GPIO terminal', () => {
    // The module header always CLAIMED this worked "exactly like MCU
    // pins"; no stamping path existed until 2026-08-13, and every
    // board-kind bench LED was dark at engine level.
    const board = makeBoard(
      [
        { id: 'NANO', kind: 'arduino_nano', params: {},
          terminals: ['gnd', 'd13'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
      ],
      [
        { id: 'n_pin', terminals: [
          { part: 'NANO', terminal: 'd13' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_mid', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'LED1', terminal: 'anode' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'LED1', terminal: 'cathode' },
          { part: 'NANO', terminal: 'gnd' },
        ]},
      ],
    );
    // The adapter speaks the datasheet spelling; the join is case-blind.
    board.setPin('D13', 'pushpull', true);
    const on = board.ledBrightness('LED1');
    assert.ok(on > 0.3, `driven HIGH lights the LED (brightness ${on.toFixed(3)})`);
    board.setPin('D13', 'pushpull', false);
    assert.equal(board.ledBrightness('LED1'), 0, 'driven LOW darkens it');
  });

  it('a Pico GPIO drives at 3.3 V, not the board default 5 V', () => {
    const board = makeBoard(
      [
        { id: 'PICO', kind: 'pi_pico', params: {}, terminals: ['gnd_1', 'gp15'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_pin', terminals: [
          { part: 'PICO', terminal: 'gp15' },
          { part: 'R1', terminal: 'a' },
        ]},
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' },
          { part: 'PICO', terminal: 'gnd_1' },
        ]},
      ],
    );
    board.setPin('GP15', 'pushpull', true);
    // Hand-computed: 3.3 V through the push-pull's 25 ohm into 10 k is
    // 3.3 x 10000/10025 = 3.2918 V. A 5 V board would read 4.9875.
    const v = board.nodeVoltage('n_pin');
    assert.ok(Math.abs(v - 3.2918) < 0.02,
      `a Pico pin sources 3.3 V logic, got ${v.toFixed(4)} V`);
  });
});
