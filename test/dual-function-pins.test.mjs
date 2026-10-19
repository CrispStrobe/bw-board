/**
 * Dual-function package pins: one physical pin, two datasheet names.
 *
 * The STC12C5A60S2's PDIP-40 pin 9 is RST by default and GPIO P4.7 once the
 * P4SW configuration bit selects it. Boundary A addresses pins BY NAME, so
 * before src/pin-aliases.js the netlist's authoring choice decided which of
 * the two names could drive anything at all — the other was bit-identical
 * to a terminal that does not exist.
 *
 * The oracle here is Ohm's law, not the solver: a 5 V rail through 1 kOhm
 * into a pushpull-low pad. The pad's Thevenin is R_STRONG = 25 Ohm to 0 V
 * (pin-model.js), so the divider reads 5 * 25 / 1025 = 0.1219512195121951 V
 * at the pad and the resistor carries 5 / 1025 = 4.878 mA. What matters for
 * this gate is not the number but that BOTH spellings produce the SAME one,
 * and that the un-aliased control produces the idle rail instead.
 */

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { DUAL_FUNCTION_PINS, dualFunctionAlias, buildPinAliasTable } from '../src/pin-aliases.js';

registerAllDevices();

/** 5 V ─ R1(1k) ─ pin, with `pinName` the MCU's single declared terminal. */
function bench(pinName, extraTerminals = []) {
  const board = new BoardImpl(5.0);
  board.setNetlist(
    [
      { id: 'MCU', kind: 'mcu', params: {}, terminals: [pinName, 'GND', ...extraTerminals] },
      { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
      { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ],
    [
      { id: 'n_rail', terminals: [{ part: 'VCC1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
      { id: 'n_pad', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'MCU', terminal: pinName }] },
      { id: 'n_gnd', terminals: [{ part: 'GND1', terminal: 'gnd' }, { part: 'MCU', terminal: 'GND' }] },
    ]
  );
  return board;
}

const PAD = 'n_pad';
const IDLE = 5.0;          // nothing driving: the pad sits at the rail
const PULLED_LOW = 5 * 25 / 1025;  // 0.1219512195121951, hand-derived

describe('dual-function package pins (STC12 PDIP-40 pin 9: RST / P4.7)', () => {
  it('the table is a set of pairs and the lookup is symmetric', () => {
    for (const pair of DUAL_FUNCTION_PINS) {
      assert.equal(pair.length, 2, 'a dual-function entry names exactly two pins');
      const [a, b] = pair;
      assert.equal(a, a.toLowerCase(), 'table keys are canonical (lowercase)');
      assert.equal(b, b.toLowerCase(), 'table keys are canonical (lowercase)');
      assert.equal(dualFunctionAlias(a), b);
      assert.equal(dualFunctionAlias(b), a);
    }
    assert.equal(dualFunctionAlias('p1.0'), undefined, 'an ordinary pin has no alias');
  });

  it('a part declaring P4.7 is driven by EITHER spelling, to the same node', () => {
    // The name the bench was authored with.
    const own = bench('P4.7');
    own.setPin('P4.7', 'pushpull', false);
    const viaOwn = own.nodeVoltage(PAD);
    assert.ok(Math.abs(viaOwn - PULLED_LOW) < 1e-6,
      `P4.7 low should pull the pad to ${PULLED_LOW}, got ${viaOwn}`);

    // The other datasheet name for the same physical pin.
    const alias = bench('P4.7');
    alias.setPin('RST', 'pushpull', false);
    const viaAlias = alias.nodeVoltage(PAD);
    assert.equal(viaAlias, viaOwn,
      'RST and P4.7 are one pin; driving either must reach the same node');

    // ...and the case-blind join applies to the alias too.
    const lower = bench('P4.7');
    lower.setPin('rst', 'pushpull', false);
    assert.equal(lower.nodeVoltage(PAD), viaOwn, 'the alias join is case-blind');

    // Both spellings also agree when driven HIGH, so this is not a
    // one-sided "anything moves it" pass.
    const hiOwn = bench('P4.7'); hiOwn.setPin('P4.7', 'pushpull', true);
    const hiAlias = bench('P4.7'); hiAlias.setPin('RST', 'pushpull', true);
    assert.equal(hiAlias.nodeVoltage(PAD), hiOwn.nodeVoltage(PAD));
    assert.ok(hiOwn.nodeVoltage(PAD) > 4.9, 'pushpull high holds the pad at the rail');
  });

  it('the mirror holds: a part declaring RST is driven by P4.7', () => {
    // 51-tft-pixels' flat STC12 bench declares the package name; a firmware
    // write to P4^7 reaches setPin as 'P4.7' whatever the netlist called it.
    const own = bench('RST');
    own.setPin('RST', 'pushpull', false);
    const viaOwn = own.nodeVoltage(PAD);
    assert.ok(Math.abs(viaOwn - PULLED_LOW) < 1e-6);

    const alias = bench('RST');
    alias.setPin('P4.7', 'pushpull', false);
    assert.equal(alias.nodeVoltage(PAD), viaOwn);
  });

  it('ANTI-VACUITY: an unrelated name still moves nothing', () => {
    // Without this the test above would pass on a board that let any
    // string drive any pin.
    const b = bench('P4.7');
    b.setPin('P4.6', 'pushpull', false);
    assert.equal(b.nodeVoltage(PAD), IDLE, 'P4.6 is a different pin');
    b.setPin('ZZ.NOPE', 'pushpull', false);
    assert.equal(b.nodeVoltage(PAD), IDLE, 'a nonexistent terminal drives nothing');
  });

  it('UNIQUE MATCH: a part declaring BOTH names keeps them apart', () => {
    // Two terminals, two nodes. Aliasing here would merge pins the netlist
    // deliberately separated, so it must not fire at all.
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P4.7', 'RST', 'GND'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
      ],
      [
        { id: 'n_rail', terminals: [
          { part: 'VCC1', terminal: 'vcc' },
          { part: 'R1', terminal: 'a' },
          { part: 'R2', terminal: 'a' }] },
        { id: 'n_a', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'MCU', terminal: 'P4.7' }] },
        { id: 'n_b', terminals: [{ part: 'R2', terminal: 'b' }, { part: 'MCU', terminal: 'RST' }] },
        { id: 'n_gnd', terminals: [{ part: 'GND1', terminal: 'gnd' }, { part: 'MCU', terminal: 'GND' }] },
      ]
    );
    board.setPin('P4.7', 'pushpull', false);
    assert.ok(Math.abs(board.nodeVoltage('n_a') - PULLED_LOW) < 1e-6, 'P4.7 drives its own node');
    assert.equal(board.nodeVoltage('n_b'), IDLE,
      'RST is a separate declared terminal and must NOT follow P4.7');
  });

  it('the pin\'s OWN name wins when both are driven', () => {
    const board = bench('P4.7');
    board.setPin('RST', 'pushpull', true);    // alias says high
    board.setPin('P4.7', 'pushpull', false);  // own name says low
    assert.ok(Math.abs(board.nodeVoltage(PAD) - PULLED_LOW) < 1e-6,
      'the declared spelling is authoritative; the alias only fills a gap');
  });

  it('SCOPE: registered board-kind models are NOT aliased', () => {
    // The STC15's reset shares P5.4 on pin 17, not P4.7 — the same pair
    // would be a lie there, so the table is built for kind 'mcu' only.
    assert.equal(buildPinAliasTable(
      [{ id: 'U1', kind: 'stc15_mcu', params: {}, terminals: ['P4.5', 'RST', 'GND'] }]), null);
    assert.equal(buildPinAliasTable(
      [{ id: 'U1', kind: 'arduino_nano', params: {}, terminals: ['RST', 'd13'] }]), null);
    // ...and a bench with nothing to alias costs nothing.
    assert.equal(buildPinAliasTable(
      [{ id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] }]), null);
    const table = buildPinAliasTable(
      [{ id: 'MCU', kind: 'mcu', params: {}, terminals: ['P4.7', 'GND'] }]);
    assert.deepEqual([...table.get('MCU')], [['p4.7', 'rst']],
      'the table maps the DECLARED terminal (case-blind key) onto the absent name');
  });
});

// The table is only useful to a cross-repo gate if the gate can reach it.
// sb3-creator's bench-invariants ratchet asks the ENGINE whether an endpoint
// names a pin the part has; without this export it would have had to
// deep-import a private module or re-declare the pair, and a re-declared
// pair drifts. (producer-must-assert-consumer)
test('the alias surface is exported from the package entry', async () => {
  const idx = await import('../src/index.js');
  assert.equal(typeof idx.dualFunctionAlias, 'function');
  assert.equal(typeof idx.buildPinAliasTable, 'function');
  assert.ok(Array.isArray(idx.DUAL_FUNCTION_PINS) && idx.DUAL_FUNCTION_PINS.length > 0);
  assert.equal(idx.dualFunctionAlias('rst'), 'p4.7');
});
