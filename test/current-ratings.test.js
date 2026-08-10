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
import { getMaxCurrent, PORT_LIMITS } from '../src/current-ratings.js';

describe('getMaxCurrent: rated kinds return a number', () => {
  it('LED = 0.020 A', () => assert.equal(getMaxCurrent('led'), 0.020));
  it('gas_sensor = 0.150 A (heater)', () => assert.equal(getMaxCurrent('gas_sensor'), 0.150));
  it('tmp36 = 0.00005 A', () => assert.equal(getMaxCurrent('tmp36'), 0.00005));
  it('vcc = 0 (sources, not sinks)', () => assert.equal(getMaxCurrent('vcc'), 0));
});

describe('getMaxCurrent: unratable kinds return null', () => {
  it('resistor = null (depends on voltage and value)', () => {
    assert.equal(getMaxCurrent('resistor'), null);
  });
  it('npn = null (depends on circuit)', () => {
    assert.equal(getMaxCurrent('npn'), null);
  });
  it('potentiometer = null', () => {
    assert.equal(getMaxCurrent('potentiometer'), null);
  });
  it('unknown kind = null', () => {
    assert.equal(getMaxCurrent('nonexistent_part'), null);
  });
});

describe('aggregate current check: null handling', () => {
  /**
   * Reference implementation of a safe aggregate check.
   * This is how consumers SHOULD sum current ratings.
   * @returns {{ total: number, unrated: string[], complete: boolean }}
   */
  function aggregateCurrent(partKinds) {
    let total = 0;
    const unrated = [];
    for (const kind of partKinds) {
      const rating = getMaxCurrent(kind);
      if (rating === null) {
        unrated.push(kind);
      } else {
        total += rating;
      }
    }
    return { total, unrated, complete: unrated.length === 0 };
  }

  it('all rated parts: exact total, complete=true', () => {
    const parts = ['led', 'led', 'led', 'led', 'led', 'led', 'buzzer'];
    const result = aggregateCurrent(parts);
    // 6 LEDs × 20mA + 1 buzzer × 30mA = 150mA
    assert.ok(Math.abs(result.total - 0.150) < 1e-10, `total=${result.total}`);
    assert.equal(result.complete, true);
    assert.deepEqual(result.unrated, []);
    // This exceeds the 120 mA chip limit
    assert.ok(result.total > PORT_LIMITS.perChip.sink,
      `${result.total * 1000} mA > ${PORT_LIMITS.perChip.sink * 1000} mA limit`);
  });

  it('mix of rated + unrated: partial total, lists unrated', () => {
    const parts = ['led', 'led', 'led', 'resistor', 'npn'];
    const result = aggregateCurrent(parts);
    // 3 LEDs × 20mA = 60mA (partial — resistor and npn not counted)
    assert.equal(result.total, 0.060);
    assert.equal(result.complete, false);
    assert.deepEqual(result.unrated, ['resistor', 'npn']);
  });

  it('naive sum += null silently omits the part (JS coerces null to 0)', () => {
    // In JavaScript: null coerces to 0 in arithmetic, so sum += null is sum += 0.
    // This is WORSE than NaN — it produces a plausible-looking number that
    // silently excludes unrated parts from the total.
    let naiveTotal = 0;
    naiveTotal += getMaxCurrent('led');      // 0.020
    naiveTotal += getMaxCurrent('resistor'); // null → 0 (silent omission!)
    naiveTotal += getMaxCurrent('led');      // 0.020

    // The total looks correct (0.040) but it does not account for the resistor.
    // If the resistor were drawing significant current, the warning would not fire.
    assert.equal(naiveTotal, 0.040, 'naive sum treats null as 0 — silent omission');
    // This is why the consumer must check for null explicitly.
  });

  it('over-limit circuit with one unrated part: must still warn', () => {
    // 7 LEDs = 140mA (over 120mA limit) + 1 resistor (null)
    const parts = ['led', 'led', 'led', 'led', 'led', 'led', 'led', 'resistor'];
    const result = aggregateCurrent(parts);

    // The rated total alone (140mA) exceeds the limit
    assert.ok(result.total > PORT_LIMITS.perChip.sink,
      'rated-only subtotal still exceeds limit → must warn');
    // And we know the total is incomplete
    assert.equal(result.complete, false);
    // The correct message: "at least 140 mA (resistor not counted) exceeds 120 mA"
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
