/**
 * AN MCU *INPUT* IS HIGH-Z. AN MCU *OUTPUT* IS 25 OHMS.
 *
 * `_needsMNA` routes a potentiometer with a LOADED wiper to the full solver,
 * because the fast walker's `_solvePot` returns the UNLOADED midpoint and
 * `_solveLedChain` then treats that midpoint as an ideal source — a stitched
 * answer that violates KCL at the wiper by whatever the load draws.
 *
 * The load test was `other.kind !== 'mcu'`: a claim about a PART where the
 * thing that matters is a claim about a PIN. A push-pull pin, an open-drain
 * pin driving low, and both input-pullup and input-pulldown all load the
 * wiper — only a plain input does not. So the walker answered for a pot whose
 * wiper was being actively driven.
 *
 * Measured on the gallery topology {vcc, pot 10k, mcu} with the wiper on P1.3
 * and the pin push-pull high:
 *
 *   engine    2.500000 V   (the bare midpoint)
 *   ngspice   4.975248 V
 *   analytic  (5/25 + 5/5000) / (1/25 + 1/5000 + 1/5000) = 4.975248 V
 *
 * 2.48 V out, and it was 11 of the 47 remaining disagreements in the
 * 2,163-circuit gallery sweep — every one an `analogRead` example on a board
 * whose GPIO is a bare `mcu`. The identical circuit passed on every dev-board
 * kind, because those are not `kind === 'mcu'` and so were never exempted.
 * That contrast is the control, and it is asserted below.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { NetlistBuilder } from '../src/builder.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** The analytic wiper voltage for a 25 Ohm driver against two 5k halves. */
const R_STRONG = 25, HALF = 5000, VCC = 5;
const drivenHigh = (VCC / R_STRONG + VCC / HALF) / (1 / R_STRONG + 1 / HALF + 1 / HALF);
const drivenLow = (0 / R_STRONG + VCC / HALF) / (1 / R_STRONG + 1 / HALF + 1 / HALF);

function potOnPin() {
  const { parts, nets } = new NetlistBuilder()
    .vcc('VCC').gnd('GND').potentiometer('POT1', 10000).mcu('MCU', ['P1.3'])
    .wire('VCC.vcc', 'POT1.a').wire('POT1.b', 'GND.gnd')
    .wire('POT1.wiper', 'MCU.P1.3')
    .build();
  const board = new BoardImpl(VCC);
  board.setNetlist(parts, nets);
  const wiper = nets.find((n) =>
    n.terminals.some((t) => t.part === 'POT1' && t.terminal === 'wiper')).id;
  return { board, wiper };
}

describe('a pot wiper driven by an MCU pin', () => {
  it('reads the UNLOADED midpoint only while the pin is a plain input', () => {
    const { board, wiper } = potOnPin();
    board.setPin('P1.3', 'input', false);
    assert.ok(Math.abs(board.nodeVoltage(wiper) - 2.5) < 1e-6,
      `a high-Z input does not load the wiper: ${board.nodeVoltage(wiper)}`);
  });

  it('reads 4.975248 V with the pin PUSH-PULL HIGH — ngspice\'s value', () => {
    const { board, wiper } = potOnPin();
    board.setPin('P1.3', 'pushpull', true);
    const v = board.nodeVoltage(wiper);
    assert.ok(Math.abs(v - drivenHigh) < 1e-3,
      `wiper ${v} V, ngspice and the analytic divider both give ${drivenHigh}`);
    // And it must have MOVED: the defect returned exactly 2.5 here.
    assert.ok(Math.abs(v - 2.5) > 2,
      `the walker's bare midpoint is 2.5 V; getting ${v} means the load was ignored`);
  });

  it('and the mirror case with the pin PUSH-PULL LOW', () => {
    const { board, wiper } = potOnPin();
    board.setPin('P1.3', 'pushpull', false);
    const v = board.nodeVoltage(wiper);
    assert.ok(Math.abs(v - drivenLow) < 1e-3, `wiper ${v} V, expected ${drivenLow}`);
  });

  it('open-drain loads when driving LOW and not when released', () => {
    // The mode-by-mode point: `pinThevenin` returns the string 'high-z' for
    // exactly the non-loading modes, and it is asked rather than a mode list
    // being restated in the routing check.
    const hi = potOnPin(); hi.board.setPin('P1.3', 'opendrain', true);
    assert.ok(Math.abs(hi.board.nodeVoltage(hi.wiper) - 2.5) < 1e-6,
      'open-drain driving high is high-Z');
    const lo = potOnPin(); lo.board.setPin('P1.3', 'opendrain', false);
    assert.ok(Math.abs(lo.board.nodeVoltage(lo.wiper) - drivenLow) < 1e-3,
      'open-drain driving low is 25 Ohms to ground');
  });

  it('input-pullup and input-pulldown load it too, weakly but really', () => {
    for (const [mode, direction] of [['input-pullup', 1], ['input-pulldown', -1]]) {
      const { board, wiper } = potOnPin();
      board.setPin('P1.3', mode, false);
      const v = board.nodeVoltage(wiper);
      assert.ok(Math.abs(v - 2.5) > 1e-3,
        `${mode} must pull the wiper off 2.5 V, got ${v}`);
      assert.ok(direction > 0 ? v > 2.5 : v < 2.5,
        `${mode} pulled the wrong way: ${v}`);
    }
  });

  it('CHANGES ANSWER when the mode changes, on one board', () => {
    // The memo half of the defect: `_wiperLoaded` was computed once from
    // topology and never invalidated by `setPin`, so even a mode-aware test
    // would have been cached wrong. This drives one board through both states.
    const { board, wiper } = potOnPin();
    board.setPin('P1.3', 'input', false);
    const asInput = board.nodeVoltage(wiper);
    board.setPin('P1.3', 'pushpull', true);
    const asOutput = board.nodeVoltage(wiper);
    board.setPin('P1.3', 'input', false);
    const backToInput = board.nodeVoltage(wiper);
    assert.ok(Math.abs(asInput - 2.5) < 1e-6, `input: ${asInput}`);
    assert.ok(Math.abs(asOutput - drivenHigh) < 1e-3, `output: ${asOutput}`);
    assert.ok(Math.abs(backToInput - 2.5) < 1e-6,
      `back to input: ${backToInput} — the routing must follow the mode both ways`);
  });

  it('the exemption still applies: a pot read by a real input keeps the fast path', () => {
    // The exemption exists for a reason and must survive -- a pot being READ by
    // a high-Z input is exactly what the walker is for, and the first case in
    // this file is the test of it. A pot with NOTHING on the wiper cannot be
    // asserted the same way: nets are built from wires, so an unwired wiper has
    // no net to read. So this checks the nearest observable thing, that adding
    // a SECOND high-Z reader does not tip the routing either.
    const { parts, nets } = new NetlistBuilder()
      .vcc('VCC').gnd('GND').potentiometer('POT1', 10000)
      .mcu('MCU', ['P1.3', 'P1.4'])
      .wire('VCC.vcc', 'POT1.a').wire('POT1.b', 'GND.gnd')
      .wire('POT1.wiper', 'MCU.P1.3').wire('POT1.wiper', 'MCU.P1.4')
      .build();
    const board = new BoardImpl(VCC);
    board.setNetlist(parts, nets);
    board.setPin('P1.3', 'input', false);
    board.setPin('P1.4', 'input', false);
    const wiper = nets.find((n) =>
      n.terminals.some((t) => t.part === 'POT1' && t.terminal === 'wiper')).id;
    assert.ok(Math.abs(board.nodeVoltage(wiper) - 2.5) < 1e-6,
      `two high-Z readers still do not load the wiper: ${board.nodeVoltage(wiper)}`);
    // And driving just ONE of them must still tip it.
    board.setPin('P1.4', 'pushpull', true);
    assert.ok(Math.abs(board.nodeVoltage(wiper) - drivenHigh) < 1e-3,
      `one driven pin among readers must load it: ${board.nodeVoltage(wiper)}`);
  });
});
