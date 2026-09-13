/**
 * A `vcc` PART PINS ITS NET, SO A DEVICE THEVENIN ON THAT NET IS AN INPUT.
 *
 * A `vcc` part gets a voltage-source ROW in the MNA matrix: it fixes its node
 * exactly. A registered device that also declares a Thevenin drive on the same
 * net — a Pico's VBUS, a battery's `pos`, a USB connector's VBUS — cannot move
 * that node by a microvolt, because every amp it pushes returns through the
 * ideal source. Its only effect is a circulating current between two sources
 * that no meter would ever read.
 *
 * FOUND BY NGSPICE, NOT BY A TEST. The exporter writes no card for an MCU, so a
 * deck for `72-pico-oled-hello` has no VBUS source at all: ngspice read 0 A of
 * supply current where our engine read 17. Every node voltage in that circuit
 * agreed to 1e-6 V — which is the tell. One matrix produces both voltages and
 * currents, so a wrong SOLVE moves them together; exactly one reader
 * disagreeing means the disagreement is not in the solve.
 *
 * 595 of the 2,163 corpus circuits wire a dev-board supply pin to a `vcc` part,
 * and in every one of those the other supply on that net IS a `vcc` part.
 *
 * The claim these tests hold is deliberately the strong one: suppressing the
 * drive changes NO node voltage. If it moved one, the suppression would be a
 * behaviour change rather than the removal of a fiction.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** 5 V rail -> 1k -> gnd, with `extra` parts/nets merged onto the rail. */
function bench(extraParts = [], extraOnRail = []) {
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            ...extraParts,
        ],
        [
            { id: 'n_rail', terminals: [
                { part: 'VCC1', terminal: 'vcc' },
                { part: 'R1', terminal: 'a' },
                ...extraOnRail,
            ]},
            { id: 'n_gnd', terminals: [
                { part: 'R1', terminal: 'b' },
                { part: 'GND1', terminal: 'gnd' },
            ]},
        ],
    );
    return board;
}

test('a Pico VBUS pin on a vcc rail draws nothing and moves nothing', () => {
    const plain = bench();
    const vPlain = plain.nodeVoltage('n_rail');
    const iPlain = plain.branchCurrent('R1', 'a');

    const withPico = bench(
        [{ id: 'U1', kind: 'pi_pico', params: {}, terminals: ['vbus', 'gnd_1'] }],
        [{ part: 'U1', terminal: 'vbus' }],
    );

    // The rail is ideal, so the answer is not "close": it is the same number.
    assert.equal(withPico.nodeVoltage('n_rail'), vPlain);
    assert.equal(withPico.branchCurrent('R1', 'a'), iPlain);

    const iVbus = withPico.branchCurrent('U1', 'vbus');
    assert.ok(Math.abs(iVbus) < 1e-9,
        `VBUS on an ideal 5 V rail must carry no current, read ${iVbus} A. Before the ideal-rail `
        + 'rule this pin was a 5.0 V / 0.1 Ohm source fighting the rail; on a 3.3 V bench it read '
        + '17 A against ngspice\'s zero.');
});

test('the rule is about the RAIL, not about the pin: unpinned, VBUS still sources', () => {
    // The counter-example. Without it the assertion above is satisfied by a
    // change that stopped board power pins sourcing anything at all — which
    // would unpower most of the gallery, where the dev board IS the supply.
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'U1', kind: 'pi_pico', params: {}, terminals: ['vbus', 'gnd_1'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        ],
        [
            { id: 'n_rail', terminals: [
                { part: 'U1', terminal: 'vbus' },
                { part: 'R1', terminal: 'a' },
            ]},
            { id: 'n_gnd', terminals: [
                { part: 'R1', terminal: 'b' },
                { part: 'GND1', terminal: 'gnd' },
                { part: 'U1', terminal: 'gnd_1' },
            ]},
        ],
    );
    const v = board.nodeVoltage('n_rail');
    // 5 V behind 0.1 Ohm into 1k: 5 * 1000/1000.1 = 4.9995 V.
    assert.ok(Math.abs(v - 5 * 1000 / 1000.1) < 1e-6,
        `VBUS with nothing else on the net must source it; rail read ${v} V`);
    const i = board.branchCurrent('U1', 'vbus');
    assert.ok(Math.abs(Math.abs(i) - 5 / 1000.1) < 1e-6,
        `VBUS must carry the load current, read ${i} A`);
});

test('the declared source impedance is the one that is stamped', () => {
    // The doubling this pairs with: `pi_pico` declared 0.1 Ohm and stamped
    // 0.05, because state.drives and stamp() both sourced the pin. 5 V behind
    // 0.05 into 1k reads 4.99975 V — inside any loose tolerance, and wrong.
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'B1', kind: 'battery_9v', params: {}, terminals: ['pos', 'neg'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 9 }, terminals: ['a', 'b'] },
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        ],
        [
            { id: 'n_pos', terminals: [
                { part: 'B1', terminal: 'pos' },
                { part: 'R1', terminal: 'a' },
            ]},
            { id: 'n_gnd', terminals: [
                { part: 'R1', terminal: 'b' },
                { part: 'GND1', terminal: 'gnd' },
                { part: 'B1', terminal: 'neg' },
            ]},
        ],
    );
    // 9 V, 1.0 Ohm internal, 9 Ohm load: 0.9 A, 8.1 V at the terminals.
    // At the halved 0.5 Ohm it was 0.947 A and 8.526 V.
    const v = board.nodeVoltage('n_pos');
    assert.ok(Math.abs(v - 8.1) < 1e-3, `terminal voltage ${v} V, expected 8.1 V (1 Ohm internal)`);
});
