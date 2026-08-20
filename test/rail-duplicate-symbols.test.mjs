/**
 * One constraint per rail: several power symbols on one net must not make the
 * matrix singular.
 *
 * A schematic conventionally draws one VCC symbol per connection point, so a
 * single rail routinely carries three, five, a dozen `vcc` parts. Each used to
 * get its own voltage-source row; two rows both enforcing V(net) = 5 leave the
 * current split between them indeterminate, the solve fails, and EVERY node —
 * the rail included — reads 0 V with converged:false and nothing naming the
 * cause. It presents as a board that imports cleanly and simulates dark.
 *
 * Found by running 26 imported EAGLE boards past lcapy: 25 failed here and
 * lcapy solved most of them. This is the minimal reproduction.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { solveMNA } from '../src/mna.js';

const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const VCC = (id, volts) => ({ id, kind: 'vcc', params: volts === undefined ? {} : { volts }, terminals: ['vcc'] });
const GND = (id) => ({ id, kind: 'gnd', params: {}, terminals: ['gnd'] });

/** 5 V rail -> 1k -> mid -> 1k -> gnd, with `supplies` power symbols on the rail. */
function divider(supplies, grounds = [GND('G1')]) {
  const parts = [...supplies, ...grounds, R('R1', 1000), R('R2', 1000)];
  const nets = [
    { id: 'sup', terminals: [...supplies.map((v) => ({ part: v.id, terminal: 'vcc' })), { part: 'R1', terminal: 'a' }] },
    { id: 'mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
    { id: 'gnd', terminals: [...grounds.map((g) => ({ part: g.id, terminal: 'gnd' })), { part: 'R2', terminal: 'b' }] },
  ];
  return solveMNA(parts, nets, new Map(), new Map(), 5);
}

describe('duplicate power symbols on one net', () => {
    for (const n of [1, 2, 3, 8]) {
        test(`${n} vcc symbol${n > 1 ? 's' : ''} on the rail still solves`, () => {
            const supplies = Array.from({ length: n }, (_, i) => VCC(`V${i + 1}`));
            const r = divider(supplies);
            assert.equal(r.converged, true, `${n} supplies: solver did not converge`);
            assert.ok(Math.abs(r.nodeVoltages.get('sup') - 5) < 1e-6,
                `rail reads ${r.nodeVoltages.get('sup')} V, not 5 — the all-zeros failure`);
            assert.ok(Math.abs(r.nodeVoltages.get('mid') - 2.5) < 1e-5,
                `divider midpoint reads ${r.nodeVoltages.get('mid')} V, not 2.5`);
        });
    }

    test('many ground symbols were always fine — gnd is not a source', () => {
        // Recorded so the fix is not mistaken for symmetry: only vcc allocated
        // a constraint row, so only vcc could duplicate one.
        const r = divider([VCC('V1')], [GND('G1'), GND('G2'), GND('G3'), GND('G4')]);
        assert.equal(r.converged, true);
        assert.ok(Math.abs(r.nodeVoltages.get('mid') - 2.5) < 1e-5);
    });

    test('two symbols demanding DIFFERENT voltages are reported, not averaged', () => {
        // This one is not a duplicate — it is a 5 V rail shorted to a 3.3 V
        // rail, which a schematic can genuinely express and which the user
        // needs told about. Silently keeping whichever was stamped first would
        // make a wiring error look like a working board.
        const r = divider([VCC('V1', 5), VCC('V2', 3.3)]);
        assert.equal(r.converged, true);
        assert.ok(Array.isArray(r.railConflicts) && r.railConflicts.length === 1,
            `expected a reported conflict, got ${JSON.stringify(r.railConflicts)}`);
        assert.match(r.railConflicts[0], /5 V and 3\.3 V/);
    });

    test('no conflict is reported when the symbols agree', () => {
        // Guards the other direction: a check that always fires is no check.
        const r = divider([VCC('V1', 3.3), VCC('V2', 3.3)]);
        assert.equal(r.railConflicts, undefined,
            `duplicates that agree are not a conflict, got ${JSON.stringify(r.railConflicts)}`);
        assert.ok(Math.abs(r.nodeVoltages.get('sup') - 3.3) < 1e-6);
    });
});
