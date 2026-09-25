/**
 * The MakeCode boards are MCU surfaces: Calliope mini, Circuit Playground
 * Express and PyBadge.
 *
 * lite runs MakeCode programs "on" these boards and reaches the circuit
 * through Boundary A: `board.setPin('p0', 'pushpull', true)`,
 * `board.readPin('a1')`. That only means anything if the pin id lands on the
 * placed board's pad. Before these kinds were registered, bw-circuit-ui sent
 * them to the engine as the generic `mcu` surface (its passthrough fallback),
 * which drives every pin at the BOARD's vcc — 5 V in the designer — and
 * leaves the 3V/GND pads as undriven pins. Measured on that pre-registration
 * path (last test below): the Calliope's GND pad is NOT a ground there — a
 * P0 → 220 R → LED → GND-pad loop carries 0 mA, every node floating at 5 V —
 * and with a separate ground part the same pin drives 5 V, not 3.3 V.
 *
 * Oracles are Ohm's law on MEASURED node voltages, not a guessed LED model:
 * the resistor current is (V_pad − V_anode)/220 and the pad sits 25 R
 * (pinThevenin's push-pull source) below the 3.3 V logic rail.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';
import { getMaxCurrent } from '../src/current-ratings.js';

registerAllDevices();

// ─── The circuits a learner draws ────────────────────────────────────────

/** pad → 220 R → LED → board ground pad. The designer builds at 5 V. */
function ledOnPad(kind, pad, gnd, { vcc = 5.0 } = {}) {
  const board = new BoardImpl(vcc);
  board.setNetlist(
    [
      { id: 'U1', kind, params: {}, terminals: [pad, gnd] },
      { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
      { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
    ],
    [
      { id: 'n_pin', terminals: [{ part: 'U1', terminal: pad }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
      { id: 'n_gnd', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'U1', terminal: gnd }] },
    ],
  );
  return board;
}

/** Board 3V pad → button → input pad, 10 k pull-down to the ground pad. */
function buttonOnPad(kind, pad, v3, gnd) {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'U1', kind, params: {}, terminals: [pad, v3, gnd] },
      { id: 'SW1', kind: 'button', params: {}, terminals: ['a', 'b'] },
      { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
    ],
    [
      { id: 'n_3v', terminals: [{ part: 'U1', terminal: v3 }, { part: 'SW1', terminal: 'a' }] },
      { id: 'n_in', terminals: [
        { part: 'SW1', terminal: 'b' }, { part: 'U1', terminal: pad }, { part: 'R1', terminal: 'a' },
      ]},
      { id: 'n_gnd', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'U1', terminal: gnd }] },
    ],
  );
  return board;
}

/** Forward LED current in mA (positive-OUT contract: it ENTERS the anode). */
const ledMilliamps = (board) => -board.branchCurrent('LED1', 'anode') * 1000;

/** The measured loop: pad voltage, anode voltage, resistor current in mA. */
function measure(board) {
  const vPin = board.nodeVoltage('n_pin');
  const vAnode = board.nodeVoltage('n_mid');
  return { vPin, vAnode, mA: (vPin - vAnode) / 220 * 1000 };
}

// kind, one GPIO pad per program-facing name, its 3.3 V pad, its ground pad.
const BOARDS = [
  { kind: 'calliopemini', pads: ['p0', 'p1', 'p2', 'p3'], v3: '3v', gnd: 'gnd' },
  { kind: 'circuit_playground_express',
    pads: ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7'], v3: '3v3_2', gnd: 'gnd3' },
  { kind: 'pybadge', pads: ['a0', 'd2', 'd13', 'sda'], v3: '3v3', gnd: 'gnd' },
];

describe('MakeCode boards are registered MCU surfaces', () => {
  for (const { kind } of BOARDS) {
    it(`${kind}: a registered model whose GPIO follows pin states at 3.3 V`, () => {
      const model = getDevice(kind);
      assert.ok(model, `${kind} has no device model — it would collapse to 'mcu'`);
      assert.equal(model.gpioFollowsPinStates, true);
      assert.equal(model.vcc, 3.3);
    });
  }
});

describe('setPin on a MakeCode board pad drives an LED + resistor', () => {
  for (const { kind, pads, gnd } of BOARDS) {
    for (const pad of pads) {
      it(`${kind}.${pad} HIGH lights the LED at 3.3 V logic, LOW darkens it`, () => {
        const board = ledOnPad(kind, pad, gnd);
        // MakeCode's own spelling (DigitalPin.P0, pins.A1) — the join is case-blind.
        board.setPin(pad.toUpperCase(), 'pushpull', true);
        const { vPin, vAnode, mA } = measure(board);
        // KCL: the resistor's current is the LED's current.
        assert.ok(Math.abs(ledMilliamps(board) - mA) < 0.01,
          `LED ${ledMilliamps(board).toFixed(3)} mA vs resistor ${mA.toFixed(3)} mA`);
        // The pad is a 3.3 V source behind 25 R. A 5 V pin would sit near 4.7 V.
        assert.ok(Math.abs(vPin - (3.3 - 0.025 * mA)) < 0.005,
          `${kind}.${pad}: pad ${vPin.toFixed(4)} V at ${mA.toFixed(3)} mA is not a 3.3 V pin`);
        // A red-ish LED at a few mA: forward drop 1.7..2.1 V, current 4..7 mA
        // (the same loop on a 5 V pin carries ~12.5 mA).
        assert.ok(vAnode > 1.7 && vAnode < 2.1, `LED forward drop ${vAnode.toFixed(3)} V`);
        assert.ok(mA > 4 && mA < 7, `${mA.toFixed(3)} mA`);
        assert.ok(board.ledBrightness('LED1') > 0.1, 'the LED is lit');

        board.setPin(pad, 'pushpull', false);
        assert.equal(board.ledBrightness('LED1'), 0, 'driven LOW darkens it');
        assert.ok(Math.abs(ledMilliamps(board)) < 0.01);
      });
    }
  }

  it('the pre-registration path (generic mcu on a 5 V designer board) is what this replaced', () => {
    // The fallback bw-circuit-ui uses for an unregistered board kind, kept as
    // the measured counterfactual — the numbers the registration moves.
    // (1) The board's own GND pad is just another pin: the loop never closes.
    const floating = ledOnPad('mcu', 'p0', 'gnd');
    floating.setPin('p0', 'pushpull', true);
    assert.ok(Math.abs(measure(floating).mA) < 0.01, 'an mcu surface has no ground pad');
    // (2) Given a real ground, the pin drives the BOARD's 5 V, not 3.3 V.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'U1', kind: 'mcu', params: {}, terminals: ['p0'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
        { id: 'LED1', kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] },
        { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'n_pin', terminals: [{ part: 'U1', terminal: 'p0' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LED1', terminal: 'anode' }] },
        { id: 'n_gnd', terminals: [{ part: 'LED1', terminal: 'cathode' }, { part: 'G1', terminal: 'gnd' }] },
      ],
    );
    board.setPin('p0', 'pushpull', true);
    const { vPin, mA } = measure(board);
    assert.ok(Math.abs(vPin - (5.0 - 0.025 * mA)) < 0.005, `mcu pad ${vPin.toFixed(4)} V`);
    assert.ok(mA > 10, `mcu surface at 5 V: ${mA.toFixed(3)} mA`);
  });
});

describe('readPin reads a button wired to a MakeCode board pad', () => {
  for (const { kind, pads, v3, gnd } of BOARDS) {
    const pad = pads[1];
    it(`${kind}.${pad}: released reads 0, pressed reads 1 (powered from the board's own ${v3} pad)`, () => {
      const board = buttonOnPad(kind, pad, v3, gnd);
      board.setPin(pad, 'input', false);
      assert.equal(board.readPin(pad), 0, 'the pull-down holds the pad low');
      board.setControl('SW1', 1);
      assert.equal(board.readPin(pad.toUpperCase()), 1, 'pressing connects the 3.3 V pad');
      assert.ok(Math.abs(board.nodeVoltage('n_in') - 3.3) < 0.02,
        `pressed pad sits at the 3.3 V rail, got ${board.nodeVoltage('n_in').toFixed(3)} V`);
      board.setControl('SW1', 0);
      assert.equal(board.readPin(pad), 0, 'releasing drops it again');
    });
  }
});

describe('MakeCode board power pads source', () => {
  // pad → 1 k → board ground pad; the pad holds its rail (0.1 R source).
  const railCases = [
    ['calliopemini', '3v', 'gnd', 3.3],
    ['circuit_playground_express', '3v3', 'gnd', 3.3],
    ['circuit_playground_express', '3v3_2', 'gnd2', 3.3],
    ['circuit_playground_express', 'vout', 'gnd3', 4.7],
    ['pybadge', '3v3', 'gnd', 3.3],
    ['pybadge', 'usb', 'gnd', 5.0],
  ];
  for (const [kind, rail, gnd, volts] of railCases) {
    it(`${kind}.${rail} sources ${volts} V`, () => {
      const board = new BoardImpl(5.0);
      board.setNetlist(
        [
          { id: 'U1', kind, params: {}, terminals: [rail, gnd] },
          { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        ],
        [
          { id: 'n_rail', terminals: [{ part: 'U1', terminal: rail }, { part: 'R1', terminal: 'a' }] },
          { id: 'n_gnd', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'U1', terminal: gnd }] },
        ],
      );
      assert.ok(Math.abs(board.nodeVoltage('n_rail') - volts) < 0.02,
        `${rail}: ${board.nodeVoltage('n_rail').toFixed(3)} V`);
      assert.ok(Math.abs(board.nodeVoltage('n_gnd')) < 0.02);
    });
  }

  it('pybadge battery and enable do not source (no LiPo assumed; EN is a control)', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'U1', kind: 'pybadge', params: {}, terminals: ['battery', 'enable', 'gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      ],
      [
        { id: 'n_bat', terminals: [{ part: 'U1', terminal: 'battery' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n_en', terminals: [{ part: 'U1', terminal: 'enable' }, { part: 'R2', terminal: 'a' }] },
        { id: 'n_gnd', terminals: [
          { part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'b' }, { part: 'U1', terminal: 'gnd' },
        ]},
      ],
    );
    assert.ok(Math.abs(board.nodeVoltage('n_bat')) < 0.01);
    assert.ok(Math.abs(board.nodeVoltage('n_en')) < 0.01);
  });
});

describe('current ratings', () => {
  for (const { kind } of BOARDS) {
    it(`${kind} has a row: not a consumer of the chip-pin budget`, () => {
      assert.equal(getMaxCurrent(kind), 0);
    });
  }
});
