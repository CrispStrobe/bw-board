/**
 * ONLY AN EXPLICIT AUTOMATIC DEVELOPMENT-BOARD SUPPLY FALLBACK YIELDS TO VCC.
 *
 * A `vcc` part fixes its node voltage exactly. That proves nothing about source
 * current: a physical source at a different EMF still drives real current into
 * the ideal rail. Suppressing every static registered drive erased batteries,
 * solar cells, grounds and other genuine conflicts while leaving voltages
 * unchanged. Only boardModel's declared positive-supply fallbacks may yield.
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
 * This fallback is a product abstraction for a bare dev board, not Schottky
 * physics. Physical forward feeding needs a physical model and is not removed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

/** 5 V rail -> 1k -> gnd, with `extra` terminals merged onto either net. */
function bench(extraParts = [], extraOnRail = [], extraOnGround = []) {
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
                ...extraOnGround,
            ]},
        ],
    );
    return board;
}

test('an opted-in Pico VBUS fallback yields to an explicit vcc rail', () => {
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
        `automatic VBUS fallback on an ideal 5 V rail must yield, read ${iVbus} A. Before the policy `
        + 'rule this pin was a 5.0 V / 0.1 Ohm source fighting the rail; on a 3.3 V bench it read '
        + '17 A against ngspice\'s zero.');
});

test('a physical 9 V / 1 Ohm battery held at 5 V retains 4 A and matches ngspice', {
    skip: spawnSync('ngspice', ['--version'], { encoding: 'utf8' }).status !== 0,
}, () => {
    const board = bench(
        [{ id: 'B1', kind: 'battery_9v', params: {}, terminals: ['pos', 'neg'] }],
        [{ part: 'B1', terminal: 'pos' }],
        [{ part: 'B1', terminal: 'neg' }],
    );
    assert.equal(board.nodeVoltage('n_rail'), 5);
    assert.ok(Math.abs(board.branchCurrent('B1', 'pos') - 4) < 1e-9,
        `9 V behind 1 Ohm into a fixed 5 V rail must source 4 A, got ${board.branchCurrent('B1', 'pos')}`);

    const deck = 'self-authored conflicting physical supplies\nVbattery internal 0 DC 9\n'
        + 'Rinternal internal rail 1\nVrail rail 0 DC 5\n.control\nset numdgt=15\nop\n'
        + 'print v(internal) v(rail) @vbattery[i]\n.endc\n.end\n';
    const ng = spawnSync('ngspice', ['-b'], { input: deck, encoding: 'utf8' });
    assert.equal(ng.status, 0, ng.stderr || ng.stdout);
    const match = ng.stdout.match(/@vbattery\[i\]\s*=\s*([-+0-9.e]+)/i);
    assert.ok(match, ng.stdout);
    assert.ok(Math.abs(board.branchCurrent('B1', 'pos') + Number(match[1])) < 1e-9,
        `engine source current must equal ngspice magnitude with the documented opposite sign: ${ng.stdout}`);
});

test('physical solar, board ground, and dynamic GPIO never inherit fallback suppression', () => {
    const solar = bench(
        [{ id: 'S1', kind: 'solar_cell', params: { voc: 0.6, rInternal: 5 }, terminals: ['pos', 'neg'] }],
        [{ part: 'S1', terminal: 'pos' }],
        [{ part: 'S1', terminal: 'neg' }],
    );
    assert.ok(Math.abs(solar.branchCurrent('S1', 'pos') + 0.88) < 1e-9,
        `0.6 V / 5 Ohm solar source held at 5 V must sink 0.88 A, got ${solar.branchCurrent('S1', 'pos')}`);

    const groundShort = bench(
        [{ id: 'U1', kind: 'pi_pico', params: {}, terminals: ['gnd_1'] }],
        [{ part: 'U1', terminal: 'gnd_1' }],
    );
    assert.ok(Math.abs(groundShort.branchCurrent('U1', 'gnd_1') + 50) < 1e-6,
        'a board ground pin on 5 V is a real 0.1 Ohm short, not a supply fallback');

    const gpioShort = bench(
        [{ id: 'U1', kind: 'pi_pico', params: {}, terminals: ['gp0'] }],
        [{ part: 'U1', terminal: 'gp0' }],
    );
    gpioShort.setPin('gp0', 'pushpull', false);
    assert.ok(gpioShort.branchCurrent('U1', 'gp0') < -0.1,
        `a GPIO driven low on 5 V must retain short current, got ${gpioShort.branchCurrent('U1', 'gp0')}`);
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
