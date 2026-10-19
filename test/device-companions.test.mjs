/**
 * THE COMPANIONS AN EXPORTER NEEDS SO A PART DOES NOT VANISH.
 *
 * `BoardImpl.deviceCompanions(partId)` returns the companion elements the last
 * solve STAMPED — the same records the generic terminal-current extraction is
 * derived from. It exists because a part a target format has no card for used
 * to be dropped, and a dropped part does not make a deck smaller, it makes it a
 * DIFFERENT CIRCUIT.
 *
 * Measured against ngspice on the shipped corpus, before this existed:
 *   - a `74hc595` dropped from a deck left eight LED branches at 0 V against
 *     the engine's 1.842233 V;
 *   - a `buzzer` dropped from a deck left its node at the full 5 V rail
 *     against the engine's 4.0 — 5 x 100/125, the buzzer being a 100 Ohm load;
 *   - 42 kinds are in that state, in 1,250 of 2,163 corpus circuits.
 *
 * The tests below are ARITHMETIC on the returned records, not recorded
 * snapshots: each asserts the value an independent hand calculation gives, so a
 * record that silently changed shape or units fails rather than re-baselines.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { classDefaults } from '../src/parts-library.js';

registerAllDevices();

test('a buzzer reports the conductance the solver actually stamped', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'VCC1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 25 }, terminals: ['a', 'b'] },
            { id: 'LS1', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
        ],
        [
            { id: 'n_rail', terminals: [{ part: 'VCC1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
            { id: 'n_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'LS1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'LS1', terminal: 'b' }, { part: 'GND1', terminal: 'gnd' }] },
        ],
    );
    const snap = board.deviceCompanions('LS1');
    assert.equal(snap.converged, true);
    const comps = snap.records;
    assert.equal(comps.length, 1, `expected one companion, got ${JSON.stringify(comps)}`);
    assert.equal(comps[0].kind, 'cond');
    assert.equal(1 / comps[0].g, classDefaults('buzzer').ohms);
    // And the divider the companion predicts is the one the board solves:
    // 5 * 100/125 = 4.0 V.
    assert.ok(Math.abs(board.nodeVoltage('n_mid') - 4.0) < 1e-9,
        `divider read ${board.nodeVoltage('n_mid')} V, expected 4.0`);
});

test('a buzzer with its own ohms reports THAT value, not the table default', () => {
    // The card is not the only authority when the part carries a number. A
    // companion that always reported the table would export a different buzzer
    // than the one the solve used — the exact split this API is meant to close.
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'LS1', kind: 'buzzer', params: { ohms: 470 }, terminals: ['a', 'b'] },
        ],
        [
            { id: 'n_a', terminals: [{ part: 'LS1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'LS1', terminal: 'b' }, { part: 'GND1', terminal: 'gnd' }] },
        ],
    );
    assert.equal(1 / board.deviceCompanions('LS1').records[0].g, 470);
});

test('a button reports open or closed, and the two differ', () => {
    const mk = () => {
        const board = new BoardImpl(5.0);
        board.setNetlist(
            [
                { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
                { id: 'SW1', kind: 'button', params: {}, terminals: ['a', 'b'] },
            ],
            [
                { id: 'n_a', terminals: [{ part: 'SW1', terminal: 'a' }] },
                { id: 'n_gnd', terminals: [{ part: 'SW1', terminal: 'b' }, { part: 'GND1', terminal: 'gnd' }] },
            ],
        );
        return board;
    };
    const open = mk();
    const gOpen = open.deviceCompanions('SW1').records[0].g;

    const closed = mk();
    closed.setControl('SW1', 1);
    const gClosed = closed.deviceCompanions('SW1').records[0].g;

    // 1 mOhm closed, effectively open otherwise. The SEPARATING state matters:
    // a companion that always reported "open" would be right for most of the
    // corpus and wrong for exactly the circuits a button is in.
    assert.equal(1 / gClosed, 0.001);
    assert.ok(gOpen < 1e-9, `open button conductance ${gOpen}, expected ~0`);
    assert.ok(gClosed > gOpen * 1e6, 'a pressed button must differ from an unpressed one');
});

test('a registered device reports its drives as sources, at the driven level', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'B1', kind: 'battery_9v', params: {}, terminals: ['pos', 'neg'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 9 }, terminals: ['a', 'b'] },
        ],
        [
            { id: 'n_pos', terminals: [{ part: 'B1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [
                { part: 'R1', terminal: 'b' },
                { part: 'B1', terminal: 'neg' },
                { part: 'GND1', terminal: 'gnd' },
            ]},
        ],
    );
    const comps = board.deviceCompanions('B1').records;
    const src = comps.find(c => c.kind === 'norton' && c.t === 'pos');
    assert.ok(src, `no norton on pos, got ${JSON.stringify(comps)}`);
    assert.equal(src.vth, 9.0);
    // 1.0 Ohm, not the 0.5 two parallel Nortons used to give.
    assert.ok(Math.abs(1 / src.g - 1.0) < 1e-12, `rTh ${1 / src.g}, expected 1.0`);
});

test('an unregistered, unstamped kind reports nothing rather than something', () => {
    // A zero you did not drive: the accessor must return an empty list for a
    // part it knows nothing about, and the caller must be able to tell that
    // apart from "this part stamped a companion of zero conductance".
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
        ],
        [{ id: 'n_gnd', terminals: [
            { part: 'R1', terminal: 'a' },
            { part: 'R1', terminal: 'b' },
            { part: 'GND1', terminal: 'gnd' },
        ]}],
    );
    assert.deepEqual(board.deviceCompanions('R1').records, []);
    assert.deepEqual(board.deviceCompanions('NOT_A_PART').records, []);
});

test('the records are copies: a caller cannot edit what the solve stamped', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'LS1', kind: 'buzzer', params: { ohms: 470 }, terminals: ['a', 'b'] },
        ],
        [
            { id: 'n_a', terminals: [{ part: 'LS1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'LS1', terminal: 'b' }, { part: 'GND1', terminal: 'gnd' }] },
        ],
    );
    board.deviceCompanions('LS1').records[0].g = 12345;
    assert.equal(1 / board.deviceCompanions('LS1').records[0].g, 470);
});

test('the snapshot carries its own provenance, and it is not a DC claim', () => {
    // The review that produced this shape: the accessor reads the board's LIVE
    // solve — the same one nodeVoltage and branchCurrent report — so it can be
    // an instantaneous transient state, and it said nothing about convergence.
    // A consumer must not be able to take the records without both facts.
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'LS1', kind: 'buzzer', params: { ohms: 470 }, terminals: ['a', 'b'] },
        ],
        [
            { id: 'n_a', terminals: [{ part: 'LS1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'LS1', terminal: 'b' }, { part: 'GND1', terminal: 'gnd' }] },
        ],
    );
    const snap = board.deviceCompanions('LS1');
    assert.equal(typeof snap.converged, 'boolean');
    assert.equal(typeof snap.timeNs, 'bigint');
    assert.ok(Array.isArray(snap.records));
    // The time it names is the board's, and it MOVES: a snapshot that always
    // said 0 would be a label rather than provenance.
    board.advanceTo(1_000_000n);
    assert.equal(board.deviceCompanions('LS1').timeNs, board.timeNs);
    assert.ok(board.timeNs > 0n, 'the board did not advance, so the check above proved nothing');
});

test('an unpowered board reports no companions, and says which board it is', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
        [
            { id: 'GND1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'LS1', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
        ],
        [
            { id: 'n_a', terminals: [{ part: 'LS1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'LS1', terminal: 'b' }, { part: 'GND1', terminal: 'gnd' }] },
        ],
    );
    board.setPower(false);
    const snap = board.deviceCompanions('LS1');
    assert.deepEqual(snap.records, []);
    assert.equal(typeof snap.timeNs, 'bigint');
});
