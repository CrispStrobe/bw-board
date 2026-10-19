/**
 * A BUZZER MUST LOAD ITS NET IN BOTH ANSWERS, NOT ONE.
 *
 * `stampBuzzerResistance` puts the buzzer in the MNA matrix, so
 * `branchCurrent` was right. Neither walker — `_gatherSourcesInner` nor
 * `_traceToSourceInner` — had a case for it, so the walk STOPPED at the buzzer
 * and `nodeVoltage` never saw the load. The two answers then described
 * different circuits: the two-solvers-two-truths trap mna.js warns about, in
 * the one place nothing checked.
 *
 * MEASURED before the fix, identical topology, 5 V through 100 Ohm:
 *
 *     resistor 100   nodeVoltage 2.500000   i 25.0000 mA   consistent
 *     buzzer         nodeVoltage 5.000000   i 25.0000 mA   DISAGREE
 *     ldr            nodeVoltage 4.999500   i  0.0050 mA   consistent
 *
 * 25 mA through 100 Ohm cannot leave the node at 5 V. A user's buzzer bench
 * displayed the full rail on a net that was carrying a quarter of an amp-tenth.
 *
 * THE TEST IS THE CROSS-CHECK, NOT A RECORDED NUMBER. `nodeVoltage` and
 * `branchCurrent` come from different code paths, so requiring them to tell one
 * story catches this whole class without anyone deciding in advance what the
 * voltage should be. The resistor and the ldr are CONTROLS: same topology, a
 * kind the walkers already knew, and they must pass for the buzzer's failure to
 * mean anything.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { classDefaults } from '../src/parts-library.js';

registerAllDevices();

const R_SERIES = 100;

/** 5 V -> R_SERIES -> the part under test -> GND. */
function divider(kind, params = {}) {
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'R1', kind: 'resistor', params: {ohms: R_SERIES}, terminals: ['a', 'b']},
        {id: 'X1', kind, params, terminals: ['a', 'b']}];
    const nets = [
        {id: 'nv', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'R1', terminal: 'a'}]},
        {id: 'nm', terminals: [{part: 'R1', terminal: 'b'}, {part: 'X1', terminal: 'a'}]},
        {id: 'ng', terminals: [{part: 'GND', terminal: 'gnd'}, {part: 'X1', terminal: 'b'}]}];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    return {v: b.nodeVoltage('nm'), i: Math.abs(b.branchCurrent('X1', 'a'))};
}

test('nodeVoltage and branchCurrent tell one story for a buzzer', () => {
    // CONTROLS FIRST. If a plain resistor disagreed too, the buzzer would be
    // telling us about the harness rather than about itself.
    for (const [kind, params] of [['resistor', {ohms: 100}], ['ldr', {}]]) {
        const {v, i} = divider(kind, params);
        assert.ok(Math.abs(v - (5 - i * R_SERIES)) < 1e-6,
            `control ${kind} already disagrees: nodeVoltage ${v}, branchCurrent ${i} A`);
    }

    const {v, i} = divider('buzzer');
    // ANTI-VACUITY: it must actually conduct, or "the two agree" is a statement
    // about two zeros.
    assert.ok(i > 1e-3, `the buzzer must carry a real current, got ${i} A`);
    assert.ok(Math.abs(v - (5 - i * R_SERIES)) < 1e-6,
        `nodeVoltage ${v.toFixed(6)} V and branchCurrent ${(i * 1e3).toFixed(4)} mA describe `
        + `different circuits: ${(i * 1e3).toFixed(4)} mA through ${R_SERIES} Ohm leaves the node `
        + `at ${(5 - i * R_SERIES).toFixed(6)} V. A walker with no case for this kind stops at it `
        + 'and never sees the load.');
});

test('the buzzer resistance comes from the one table, not a literal', () => {
    // The number moved out of `const g = 1 / 100` in stampBuzzerResistance. If a
    // literal grows back, this divider stops matching the card.
    const ohms = classDefaults('buzzer').ohms;
    assert.ok(ohms > 0, 'classDefaults(buzzer) has no ohms');
    const {i} = divider('buzzer');
    const want = 5 / (R_SERIES + ohms);
    assert.ok(Math.abs(i - want) < 1e-9,
        `a ${R_SERIES} Ohm series with the card's ${ohms} Ohm must draw ${want} A, got ${i}`);
    // And an explicit param still wins, because a typed number was meant.
    const {i: iExplicit} = divider('buzzer', {ohms: 400});
    assert.ok(Math.abs(iExplicit - 5 / (R_SERIES + 400)) < 1e-9,
        `an explicit 400 Ohm buzzer must draw ${5 / 500} A, got ${iExplicit}`);
});
