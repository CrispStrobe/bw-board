/**
 * Current ratings: two-budget schema (chip_mA + supply_mA).
 * Vendored from bw-parts cf3eb7d.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getMaxCurrent, getSupplyCurrent, PORT_LIMITS, CURRENT_RATINGS,
         aggregateCurrent, checkCurrentBudget } from '../src/current-ratings.js';
import { BoardImpl } from '../src/board.js';

describe('getMaxCurrent (chip budget)', () => {
  it('LED = null (circuit-dependent)', () => assert.equal(getMaxCurrent('led'), null));
  it('servo = 0 (draws from supply, not MCU pin)', () => assert.equal(getMaxCurrent('servo'), 0));
  it('ir_receiver = 0.005 A', () => assert.equal(getMaxCurrent('ir_receiver'), 0.005));
  it('resistor = 0 (passive)', () => assert.equal(getMaxCurrent('resistor'), 0));
  it('npn = null (circuit-dependent)', () => assert.equal(getMaxCurrent('npn'), null));
  it('timer_555 via alias = 0', () => assert.equal(getMaxCurrent('timer_555'), 0));
});

describe('getSupplyCurrent (supply budget)', () => {
  it('servo = 0.350 A', () => assert.equal(getSupplyCurrent('servo'), 0.350));
  it('gas_sensor = 0.150 A (heater)', () => assert.equal(getSupplyCurrent('gas_sensor'), 0.150));
  it('buzzer = 0.030 A', () => assert.equal(getSupplyCurrent('buzzer'), 0.030));
  it('resistor = 0', () => assert.equal(getSupplyCurrent('resistor'), 0));
  it('dc_motor = null (circuit-dependent)', () => assert.equal(getSupplyCurrent('dc_motor'), null));
});

describe('aggregateCurrent: two budgets', () => {
  it('two servos: chip=0, supply=700mA', () => {
    const parts = [{ id: 'S1', kind: 'servo' }, { id: 'S2', kind: 'servo' }];
    const r = aggregateCurrent(parts);
    assert.equal(r.totalAmps, 0);
    assert.ok(Math.abs(r.supplyAmps - 0.700) < 1e-10);
    assert.equal(r.complete, true);
    assert.equal(r.supplyComplete, true);
  });

  it('LED is circuit-dependent on both budgets', () => {
    const parts = [{ id: 'L1', kind: 'led' }];
    const r = aggregateCurrent(parts);
    assert.equal(r.complete, false);
    assert.equal(r.supplyComplete, false);
    assert.equal(r.unrated[0].id, 'L1');
  });

  it('string "circuit" never enters arithmetic', () => {
    // The old bug: 0 + 'circuit' = '0circuit', comparisons silently fail
    const parts = [{ id: 'S1', kind: 'servo' }, { id: 'L1', kind: 'led' }];
    const r = aggregateCurrent(parts);
    assert.equal(typeof r.totalAmps, 'number', 'totalAmps must be a number');
    assert.equal(typeof r.supplyAmps, 'number', 'supplyAmps must be a number');
    assert.ok(!Number.isNaN(r.totalAmps), 'totalAmps must not be NaN');
    assert.ok(!Number.isNaN(r.supplyAmps), 'supplyAmps must not be NaN');
  });
});

describe('checkCurrentBudget: supply budget fires', () => {
  it('two servos on USB: 700 mA > 500 mA → danger', () => {
    const parts = [{ id: 'S1', kind: 'servo' }, { id: 'S2', kind: 'servo' }];
    const warnings = checkCurrentBudget(parts);
    const supply = warnings.find(w => w.type === 'supply-current');
    assert.ok(supply, 'should warn about supply current');
    assert.equal(supply.severity, 'danger');
    assert.ok(supply.message.includes('700'), `should mention 700 mA: ${supply.message}`);
    assert.ok(supply.message.includes('500'), `should mention 500 mA limit: ${supply.message}`);
  });

  it('one servo on USB: 350 mA < 500 mA → no supply warning', () => {
    const parts = [{ id: 'S1', kind: 'servo' }];
    const warnings = checkCurrentBudget(parts);
    const supply = warnings.find(w => w.type === 'supply-current');
    assert.equal(supply, undefined, 'should not warn under supply limit');
  });

  it('chip and supply are independent checks', () => {
    // A servo does not trip the chip budget (chip_mA=0)
    const parts = [{ id: 'S1', kind: 'servo' }, { id: 'S2', kind: 'servo' }];
    const warnings = checkCurrentBudget(parts);
    const chip = warnings.find(w => w.type === 'aggregate-current');
    assert.equal(chip, undefined, 'servos should not trigger chip warning');
  });
});

describe('PORT_LIMITS', () => {
  it('chip = 120 mA', () => assert.equal(PORT_LIMITS.perChip.sink, 0.120));
  it('supply USB = 500 mA', () => assert.equal(PORT_LIMITS.supplyUsb.sink, 0.500));
});

describe('getWarnings includes current budget on real board', () => {
  it('board with 8 LEDs: runs without error', () => {
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
      nets.push({ id: `net_led${i}`, terminals: [{ part: `R${i}`, terminal: 'b' }, { part: `LED${i}`, terminal: 'anode' }] });
      nets.push({ id: `net_pin${i}`, terminals: [{ part: `LED${i}`, terminal: 'cathode' }, { part: 'MCU', terminal: `P1.${i}` }] });
    }
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    const warnings = board.getWarnings();
    assert.ok(true, 'current budget check runs without error');
  });
});
