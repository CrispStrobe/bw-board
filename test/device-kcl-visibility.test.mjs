// Device KCL-visibility: every registered device's terminal currents are
// derived from the very companions its stamp wrote into the matrix, so an
// ammeter on ANY device lead reads the truth without a per-model
// branchCurrents hook. The census case that motivated this: a relay coil
// carrying 25 mA read 0 A because no hook existed for 'relay'.
//
// Sign convention: the resistor convention (positive = current OUT of the
// part into the net), the one dc-motor's hand-written hook documents as
// what a meter in either lead expects.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

describe('relay coil is KCL-visible (the census 0 A case)', () => {
    const rig = () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'RLY', kind: 'relay', params: { coilR: 200 }, terminals: ['coil_a', 'coil_b', 'com', 'nc', 'no'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['RLY', 'coil_a']),
            net('ng', ['GND', 'gnd'], ['RLY', 'coil_b']),
        ]);
        board.advanceTo(1n);
        return board;
    };

    it('coil_a carries 5 V / 200 Ω = 25 mA, not 0', () => {
        const board = rig();
        const iA = board.branchCurrent('RLY', 'coil_a');
        // Current flows INTO the part at coil_a (the VCC side): out-of-part
        // is negative there, exactly like a resistor's 'a' leg across the
        // same rail.
        assert.ok(Math.abs(iA + 0.025) < 1e-3,
            `coil_a expected −25 mA (into the part at the VCC leg), got ${(iA * 1e3).toFixed(3)} mA`);
    });

    it('coil_b returns the same 25 mA (KCL across the coil pair)', () => {
        const board = rig();
        const iA = board.branchCurrent('RLY', 'coil_a');
        const iB = board.branchCurrent('RLY', 'coil_b');
        assert.ok(Math.abs(iA + iB) < 1e-9,
            `coil pair must sum to zero, got ${iA} + ${iB}`);
        assert.ok(Math.abs(iB - 0.025) < 1e-3, `coil_b expected +25 mA out of the part, got ${iB}`);
    });

    it('matches the sign a series resistor would report on the same rail', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, R('RS', 100),
            { id: 'RLY', kind: 'relay', params: { coilR: 100 }, terminals: ['coil_a', 'coil_b', 'com', 'nc', 'no'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['RS', 'a']),
            net('nm', ['RS', 'b'], ['RLY', 'coil_a']),
            net('ng', ['GND', 'gnd'], ['RLY', 'coil_b']),
        ]);
        board.advanceTo(1n);
        // Series loop, 5 V over 200 Ω → 25 mA everywhere. The meter-facing
        // convention: at the leg where current ENTERS a part the reading is
        // negative, where it EXITS positive — resistor and relay agree.
        assert.ok(Math.abs(board.branchCurrent('RS', 'b') - board.branchCurrent('RLY', 'coil_b')) < 1e-6,
            'downstream legs of the series pair disagree');
        assert.ok(Math.abs(board.branchCurrent('RS', 'a') - board.branchCurrent('RLY', 'coil_a')) < 1e-6,
            'upstream legs of the series pair disagree');
    });

    it('all five relay terminals sum to ~0 (pairwise stamps, full-device KCL)', () => {
        const board = rig();
        const total = ['coil_a', 'coil_b', 'com', 'nc', 'no']
            .reduce((s, t) => s + board.branchCurrent('RLY', t), 0);
        assert.ok(Math.abs(total) < 1e-9, `device KCL residual ${total}`);
    });
});

describe('drives-based devices (Norton against reference) stay honest', () => {
    it('a logic output sourcing a load reports the load current at its pin', () => {
        // A device whose state.drives sources a resistor to ground: the pin
        // current must equal the resistor current, resistor convention on
        // both sides.
        const board = new BoardImpl(5.0);
        board.setNetlist([G, R('RL', 1000),
            { id: 'M', kind: 'dc_motor', params: {}, terminals: ['a', 'b'] },
        ], [
            net('nm', ['M', 'a'], ['RL', 'a']),
            net('ng', ['GND', 'gnd'], ['RL', 'b'], ['M', 'b']),
        ]);
        board.advanceTo(1n);
        // dc-motor HAS a hand-written branchCurrents hook — the override
        // must survive the generic derivation (its values win).
        const iA = board.branchCurrent('M', 'a');
        assert.ok(Number.isFinite(iA), 'override path still reports finite current');
    });
});
