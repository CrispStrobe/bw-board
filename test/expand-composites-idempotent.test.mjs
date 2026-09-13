/**
 * `setNetlist` MUST BE SAFE TO RE-RUN ON THE BOARD'S OWN PART LIST.
 *
 * `_expandComposites` synthesizes the parts a device carries on its PCB — a
 * Pico's onboard LED and its 1 kOhm, an rgb_led's three junctions — and adds
 * them to the list it returns. That list is what `board.parts` becomes, so the
 * output of the expansion is a legal input to it, and
 * `setNetlist(board.parts, board.nets)` is the obvious way to re-stamp after
 * changing a parameter.
 *
 * It used to expand a SECOND time, under the same ids, and duplicates are real
 * loads. Measured on a Pico blink bench before the fix:
 *
 *     call 1    7 parts    I(gp25) 2.833073 mA    V(gp25 net) 3.229173
 *     call 2    9 parts    I(gp25) 4.151994 mA    V(gp25 net) 3.196200   <- +46.6 %
 *     call 3   11 parts
 *
 * Two onboard LEDs on one pin. The ids collide, the answer moves by 46 %, and
 * nothing reports it — the summary reads clean and `board.parts` merely looks
 * longer than you remembered.
 *
 * FOUND BY THE ngspice CORPUS SWEEP, indirectly and not by looking for it: I
 * re-ran setNetlist to re-stamp a junction model and the solve moved, which is
 * not something a re-stamp is allowed to do.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** A Pico driving an external LED chain, which is the shape that exposed it. */
function bench() {
    const parts = [
        {id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc']},
        {id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd']},
        {id: 'pico1', kind: 'pi_pico', params: {}, terminals: ['gp25', 'gnd_1', 'vbus']},
        {id: 'R1', kind: 'resistor', params: {ohms: 1000}, terminals: ['a', 'b']},
        {id: 'D1', kind: 'led', params: {vf: 2.0}, terminals: ['anode', 'cathode']}];
    const nets = [
        {id: 'n_pin', terminals: [{part: 'pico1', terminal: 'gp25'}, {part: 'R1', terminal: 'a'}]},
        {id: 'n_mid', terminals: [{part: 'R1', terminal: 'b'}, {part: 'D1', terminal: 'anode'}]},
        {id: 'n_gnd', terminals: [{part: 'GND', terminal: 'gnd'},
            {part: 'D1', terminal: 'cathode'}, {part: 'pico1', terminal: 'gnd_1'}]},
        {id: 'n_vcc', terminals: [{part: 'VCC', terminal: 'vcc'}, {part: 'pico1', terminal: 'vbus'}]}];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    return b;
}

const readings = (b) => {
    b.setPin('gp25', 'pushpull', true);
    return {
        parts: b.parts.length,
        onboard: b.parts.filter(p => p.id === 'pico1_onboard').length,
        v: b.nodeVoltage('n_pin'),
        i: b.branchCurrent('pico1', 'gp25'),
    };
};

test('re-running setNetlist on the board\'s own list changes nothing', () => {
    const b = bench();
    const first = readings(b);

    // ANTI-VACUITY: the expansion must have HAPPENED, or "it did not happen
    // twice" is a claim about a device that synthesizes nothing.
    assert.equal(first.onboard, 1,
        'fixture: a seated Pico must synthesize exactly one onboard LED, or this test '
        + 'is asserting idempotency over an empty expansion');
    assert.ok(Number.isFinite(first.i) && Math.abs(first.i) > 1e-6,
        `fixture: gp25 must carry a driven current, got ${first.i}`);

    for (let round = 2; round <= 3; round++) {
        b.setNetlist(b.parts, b.nets);
        const again = readings(b);
        assert.equal(again.onboard, 1,
            `round ${round}: ${again.onboard} onboard LEDs — the expansion ran again and the `
            + 'duplicates are real loads on the same pin');
        assert.equal(again.parts, first.parts, `round ${round}: part count moved`);
        // BIT-IDENTICAL. A re-stamp that moves the answer at all is not a
        // re-stamp, and a tolerance here would be admitting it might.
        assert.equal(again.v, first.v,
            `round ${round}: V(n_pin) ${again.v} against ${first.v}`);
        assert.equal(again.i, first.i,
            `round ${round}: I(gp25) ${again.i} against ${first.i}`);
    }
});
