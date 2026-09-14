/**
 * A POTENTIOMETER CARRIED CURRENT AND REPORTED NONE.
 *
 * `stampPotentiometer` puts two resistors in the matrix, so the wiper VOLTAGE
 * was right — 5 V across a 10k pot solves the wiper to 2.500000 — while
 * `branchCurrent` returned 0 for `a`, `b` AND `wiper`, with 0.5 mA flowing.
 * The extraction switch simply had no arm for the kind, so a real reading came
 * back as a confident zero and a meter on a pot read 0 A.
 *
 * Same shape as the buzzer's missing walker case, found the same way: the
 * ngspice corpus sweep reported "the engine draws 1.776e-14 A" against
 * ngspice's 4.95 uA on 02-dimmer while every node voltage agreed to 1e-6.
 * Voltages agreeing and current not is the signature of a missing extraction
 * rather than a wrong solve.
 *
 * THE TEST IS KIRCHHOFF, not a recorded number: what enters `a` must leave `b`,
 * and the divider's own resistances must explain the magnitude. That catches
 * the whole class without anyone deciding in advance what the current is.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** 5 V across a pot, wiper optionally loaded to ground through `loadOhms`. */
function bench({ohms = 10000, position, loadOhms = null} = {}) {
    const params = position === undefined ? {ohms} : {ohms, position};
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'P1', kind: 'potentiometer', params, terminals: ['a', 'wiper', 'b']}];
    const nets = [
        {id: 'nv', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'P1', terminal: 'a'}]},
        {id: 'ng', terminals: [{part: 'GND', terminal: 'gnd'}, {part: 'P1', terminal: 'b'}]},
        {id: 'nw', terminals: [{part: 'P1', terminal: 'wiper'}]}];
    if (loadOhms !== null) {
        parts.push({id: 'RL', kind: 'resistor', params: {ohms: loadOhms}, terminals: ['a', 'b']});
        nets[2].terminals.push({part: 'RL', terminal: 'a'});
        nets[1].terminals.push({part: 'RL', terminal: 'b'});
    }
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    return {
        vW: b.nodeVoltage('nw'),
        iA: b.branchCurrent('P1', 'a'),
        iB: b.branchCurrent('P1', 'b'),
        iW: b.branchCurrent('P1', 'wiper'),
    };
}

test('an unloaded pot reports the current its own resistance implies', () => {
    const {vW, iA, iB, iW} = bench({ohms: 10000});
    assert.ok(Math.abs(vW - 2.5) < 1e-9, `fixture: mid-travel wiper must be 2.5 V, got ${vW}`);
    // ANTI-VACUITY: the whole defect was a zero, so assert it is not one FIRST.
    assert.ok(Math.abs(iA) > 1e-6,
        `the pot carries 5 V / 10 kOhm = 0.5 mA and reports ${iA} A — a missing extraction `
        + 'arm returns a confident zero that looks exactly like no current');
    assert.ok(Math.abs(iA + 5 / 10000) < 1e-9, `expected -0.5 mA out of a, got ${iA}`);
    // KCL: nothing leaves the wiper, so the terminal currents cancel.
    assert.ok(Math.abs(iA + iB) < 1e-9, `a (${iA}) and b (${iB}) must be equal and opposite`);
    assert.ok(Math.abs(iW) < 1e-9, `an unloaded wiper carries nothing, got ${iW}`);
});

test('a loaded wiper carries the difference, and the total still balances', () => {
    // The case that separates a real extraction from one that just negates `a`.
    const {iA, iB, iW} = bench({ohms: 10000, loadOhms: 10000});
    assert.ok(Math.abs(iW) > 1e-6, `a loaded wiper must carry current, got ${iW}`);
    assert.ok(Math.abs(iA + iB + iW) < 1e-9,
        `Kirchhoff at the part: a ${iA} + b ${iB} + wiper ${iW} must sum to zero`);
});

test('the current follows the POSITION, the same one the stamp uses', () => {
    // If extraction re-derived the divider instead of mirroring the stamp, the
    // two would drift apart exactly where the pot is not mid-travel.
    const mid = bench({ohms: 10000, position: 0.5});
    const low = bench({ohms: 10000, position: 0.1});
    assert.ok(Math.abs(mid.iA - low.iA) < 1e-9,
        'end-to-end current does not depend on wiper position for an unloaded pot');
    assert.ok(Math.abs(low.vW - 0.5) < 1e-6,
        `position 0.1 must put the wiper at 0.5 V, got ${low.vW} — extraction and stamp `
        + 'disagree about which divider this is');
});
