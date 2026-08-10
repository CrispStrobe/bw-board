/**
 * Current ratings: verify getMaxCurrent returns correct values,
 * and that a sum across a mixed circuit handles null correctly.
 *
 * Contract: when a part returns null (unratable), the consumer must
 * not silently sum what it can — it must either warn conservatively
 * or report that the total is incomplete. sum += null → NaN → the
 * safety warning never fires, which is the worst outcome.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMaxCurrent, PORT_LIMITS, aggregateCurrent, checkCurrentBudget } from '../src/current-ratings.js';
import { BoardImpl } from '../src/board.js';

describe('getMaxCurrent: rated kinds return a number', () => {
  it('LED = 0.020 A', () => assert.equal(getMaxCurrent('led'), 0.020));
  it('gas_sensor = 0.150 A (heater)', () => assert.equal(getMaxCurrent('gas_sensor'), 0.150));
  it('tmp36 = 0.00005 A', () => assert.equal(getMaxCurrent('tmp36'), 0.00005));
  it('vcc = 0 (sources, not sinks)', () => assert.equal(getMaxCurrent('vcc'), 0));
});

describe('getMaxCurrent: passives return 0, transistors return null', () => {
  it('resistor = 0 (current-limiter, not consumer)', () => {
    assert.equal(getMaxCurrent('resistor'), 0);
  });
  it('npn = null (collector current is circuit-dependent)', () => {
    assert.equal(getMaxCurrent('npn'), null);
  });
  it('potentiometer = 0 (passive)', () => {
    assert.equal(getMaxCurrent('potentiometer'), 0);
  });
  it('unknown kind = null', () => {
    assert.equal(getMaxCurrent('nonexistent_part'), null);
  });
});

describe('aggregateCurrent (from src/current-ratings.js)', () => {
  it('all rated parts: exact total, complete=true', () => {
    const parts = [
      { id: 'L1', kind: 'led' }, { id: 'L2', kind: 'led' }, { id: 'L3', kind: 'led' },
      { id: 'L4', kind: 'led' }, { id: 'L5', kind: 'led' }, { id: 'L6', kind: 'led' },
      { id: 'B1', kind: 'buzzer' },
    ];
    const result = aggregateCurrent(parts);
    // 6 LEDs × 20mA + 1 buzzer × 30mA = 150mA
    assert.ok(Math.abs(result.totalAmps - 0.150) < 1e-10, `total=${result.totalAmps}`);
    assert.equal(result.complete, true);
    assert.deepEqual(result.unrated, []);
  });

  it('mix of rated + unrated: partial total, lists unrated by id+kind', () => {
    const parts = [
      { id: 'L1', kind: 'led' }, { id: 'L2', kind: 'led' }, { id: 'L3', kind: 'led' },
      { id: 'Q1', kind: 'npn' }, { id: 'Q2', kind: 'tip120' },
    ];
    const result = aggregateCurrent(parts);
    assert.equal(result.totalAmps, 0.060);
    assert.equal(result.complete, false);
    assert.equal(result.unrated.length, 2);
    assert.equal(result.unrated[0].id, 'Q1');
    assert.equal(result.unrated[1].kind, 'tip120');
  });

  it('naive sum += null silently omits the part (JS coerces null to 0)', () => {
    // Transistors return null — their collector current is circuit-dependent.
    let naiveTotal = 0;
    naiveTotal += getMaxCurrent('led');  // 0.020
    naiveTotal += getMaxCurrent('npn'); // null → 0 (silent omission!)
    naiveTotal += getMaxCurrent('led');  // 0.020
    assert.equal(naiveTotal, 0.040, 'naive sum treats null as 0 — silent omission');
  });
});

describe('checkCurrentBudget: DRC warnings on real circuits', () => {
  it('7 LEDs = 140mA → danger warning (exceeds 120mA chip limit)', () => {
    const parts = [
      { id: 'L1', kind: 'led' }, { id: 'L2', kind: 'led' }, { id: 'L3', kind: 'led' },
      { id: 'L4', kind: 'led' }, { id: 'L5', kind: 'led' }, { id: 'L6', kind: 'led' },
      { id: 'L7', kind: 'led' },
    ];
    const warnings = checkCurrentBudget(parts);
    assert.ok(warnings.length > 0, 'must warn');
    assert.equal(warnings[0].severity, 'danger');
    assert.ok(warnings[0].message.includes('140'), `message should include 140mA: ${warnings[0].message}`);
  });

  it('3 LEDs = 60mA → no warning (under 120mA)', () => {
    const parts = [
      { id: 'L1', kind: 'led' }, { id: 'L2', kind: 'led' }, { id: 'L3', kind: 'led' },
    ];
    const warnings = checkCurrentBudget(parts);
    assert.equal(warnings.length, 0, 'should not warn under limit');
  });

  it('7 LEDs + NPN transistor (unrated) → danger warning naming the unrated part', () => {
    const parts = [
      { id: 'L1', kind: 'led' }, { id: 'L2', kind: 'led' }, { id: 'L3', kind: 'led' },
      { id: 'L4', kind: 'led' }, { id: 'L5', kind: 'led' }, { id: 'L6', kind: 'led' },
      { id: 'L7', kind: 'led' }, { id: 'Q1', kind: 'npn' },
    ];
    const warnings = checkCurrentBudget(parts);
    assert.ok(warnings.length > 0, 'must warn even with unrated parts');
    assert.equal(warnings[0].severity, 'danger');
    assert.ok(warnings[0].message.includes('Q1'), `message should name unrated part: ${warnings[0].message}`);
  });

  it('1 LED + NPN (under limit but incomplete) → warning about incomplete total', () => {
    const parts = [
      { id: 'L1', kind: 'led' }, { id: 'Q1', kind: 'npn' },
    ];
    const warnings = checkCurrentBudget(parts);
    assert.ok(warnings.length > 0, 'should warn about incomplete total');
    assert.equal(warnings[0].severity, 'warning');
    assert.ok(warnings[0].message.includes('Q1'), `names the unrated part: ${warnings[0].message}`);
  });
});

describe('getWarnings includes current budget on real board', () => {
  it('8 LEDs on a board triggers current warning via getWarnings()', () => {
    const parts = [
      { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
      { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    ];
    for (let i = 0; i < 8; i++) {
      parts.push({ id: `LED${i}`, kind: 'led', params: { vForward: 2.0 }, terminals: ['anode', 'cathode'] });
      parts.push({ id: `R${i}`, kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] });
    }
    parts.push({ id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0','P1.1','P1.2','P1.3','P1.4','P1.5','P1.6','P1.7'] });

    const nets = [
      { id: 'net_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }] },
      { id: 'net_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }] },
    ];
    for (let i = 0; i < 8; i++) {
      nets[0].terminals.push({ part: `R${i}`, terminal: 'a' });
      nets.push({ id: `net_led${i}`, terminals: [
        { part: `R${i}`, terminal: 'b' }, { part: `LED${i}`, terminal: 'anode' },
      ]});
      nets.push({ id: `net_pin${i}`, terminals: [
        { part: `LED${i}`, terminal: 'cathode' }, { part: 'MCU', terminal: `P1.${i}` },
      ]});
    }

    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    for (let i = 0; i < 8; i++) board.setPin(`P1.${i}`, 'quasi', false);

    const warnings = board.getWarnings();
    const budgetWarning = warnings.find(w => w.message.includes('mA') && w.message.includes('limit'));
    assert.ok(budgetWarning, 'getWarnings should include a current budget warning for 8 LEDs');
  });
});

describe('PORT_LIMITS: correct values and provenance', () => {
  it('perPin sink = 20 mA (datasheet §4.1)', () => {
    assert.equal(PORT_LIMITS.perPin.sink, 0.020);
  });
  it('perPin source = 230 µA (datasheet §4.1)', () => {
    assert.equal(PORT_LIMITS.perPin.source, 0.000230);
  });
  it('perPort sink = 80 mA (8051 family guidance)', () => {
    assert.equal(PORT_LIMITS.perPort.sink, 0.080);
  });
  it('perChip sink = 120 mA (datasheet §4.1 intro)', () => {
    assert.equal(PORT_LIMITS.perChip.sink, 0.120);
  });
});
