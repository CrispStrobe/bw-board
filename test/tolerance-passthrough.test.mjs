// E2.3 — tolerance metadata passthrough. The engine STORES the field
// and solves nominal; randomization is the UI-side Monte-Carlo runner's
// job, so determinism here is part of the contract.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

test('params.tolerance survives setNetlist untouched and changes nothing', () => {
    const parts = [
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R1', kind: 'resistor', params: { ohms: 1000, tolerance: 0.05 }, terminals: ['a', 'b'] },
        { id: 'R2', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
    ];
    const nets = [
        { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
        { id: 'n_mid', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'R2', terminal: 'a' }] },
        { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'R2', terminal: 'b' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    const r1 = b.parts.find((p) => p.id === 'R1');
    assert.equal(r1.params.tolerance, 0.05, 'the field survives, unstripped');
    // Nominal solve, exactly the tolerance-free divider:
    assert.ok(Math.abs(b.nodeVoltage('n_mid') - 2.5) < 1e-9,
        'the engine solves nominal — tolerance is metadata, not perturbation');
    // Determinism: a second identical board answers identically.
    const b2 = new BoardImpl(5.0);
    b2.setNetlist(structuredClone(parts), structuredClone(nets));
    assert.equal(b2.nodeVoltage('n_mid'), b.nodeVoltage('n_mid'));
});
