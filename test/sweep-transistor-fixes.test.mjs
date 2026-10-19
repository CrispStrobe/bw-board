import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';

/**
 * The wiring-sweep transistor escalations (2026-08-15), pinned:
 * - PNP: the saturation clamp engaged on NON-conducting devices
 *   (entry lacked a base-junction gate), inventing -0.2 V collectors,
 *   above-rail followers, and active/saturated oscillation.
 * - NMOS: no triode region — the saturation VCCS demanded K·Vov² amps
 *   through any load and the drain ran away to -2247 V.
 */

const solve = (parts, nets) => {
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    b.advanceTo(1_000_000n);
    return b;
};

describe('PNP: the clamp only engages on a conducting device', () => {
    it('cutoff (emitter grounded, base high): collector rests at its pull-up', () => {
        const b = solve([
            { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'rc', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'rb', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'q1', kind: 'pnp', params: {}, terminals: ['base', 'collector', 'emitter'] },
        ], [
            { id: 'n0', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'rc', terminal: 'a' }, { part: 'rb', terminal: 'a' }] },
            { id: 'n1', terminals: [{ part: 'rc', terminal: 'b' }, { part: 'q1', terminal: 'collector' }] },
            { id: 'n2', terminals: [{ part: 'q1', terminal: 'emitter' }, { part: 'g1', terminal: 'gnd' }] },
            { id: 'n3', terminals: [{ part: 'rb', terminal: 'b' }, { part: 'q1', terminal: 'base' }] },
        ]);
        const vC = b.nodeVoltages.get('n1');
        assert.ok(vC > 4.5, `cutoff collector at the pull-up, got ${vC} (was -0.200)`);
    });

    it('a REAL saturated PNP (emitter at VCC): collector ≈ VCC - vceSat', () => {
        const b = solve([
            { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'rc', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'rb', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'q1', kind: 'pnp', params: {}, terminals: ['base', 'collector', 'emitter'] },
        ], [
            { id: 'n0', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'q1', terminal: 'emitter' }] },
            { id: 'n1', terminals: [{ part: 'rc', terminal: 'a' }, { part: 'q1', terminal: 'collector' }] },
            { id: 'n2', terminals: [{ part: 'rc', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }, { part: 'rb', terminal: 'b' }] },
            { id: 'n3', terminals: [{ part: 'rb', terminal: 'a' }, { part: 'q1', terminal: 'base' }] },
        ]);
        const vC = b.nodeVoltages.get('n1');
        assert.ok(vC > 4.3 && vC <= 5.0, `saturated collector near VCC-0.2, got ${vC}`);
    });

    it('emitter follower: emitter tracks base + vbe, never above the rail', () => {
        const b = solve([
            { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'r1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'r2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 're', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'q1', kind: 'pnp', params: {}, terminals: ['base', 'collector', 'emitter'] },
        ], [
            { id: 'n0', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'r1', terminal: 'a' }, { part: 're', terminal: 'a' }] },
            { id: 'nb', terminals: [{ part: 'r1', terminal: 'b' }, { part: 'r2', terminal: 'a' }, { part: 'q1', terminal: 'base' }] },
            { id: 'ne', terminals: [{ part: 're', terminal: 'b' }, { part: 'q1', terminal: 'emitter' }] },
            { id: 'ng', terminals: [{ part: 'r2', terminal: 'b' }, { part: 'g1', terminal: 'gnd' }, { part: 'q1', terminal: 'collector' }] },
        ]);
        const vE = b.nodeVoltages.get('ne');
        const vB = b.nodeVoltages.get('nb');
        assert.ok(vE <= 5.0, `emitter never above the rail, got ${vE} (was 5.200)`);
        assert.ok(Math.abs(vE - (vB + 0.7)) < 0.3, `follower tracks base+0.7 (vB=${vB}, vE=${vE})`);
    });
});

describe('NMOS: the triode region exists', () => {
    const nmosCircuit = () => [[
        { id: 'v1', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'g1', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'rd', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        { id: 'rg', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'q1', kind: 'nmos', params: {}, terminals: ['gate', 'drain', 'source'] },
    ], [
        { id: 'n0', terminals: [{ part: 'v1', terminal: 'vcc' }, { part: 'rd', terminal: 'a' }, { part: 'rg', terminal: 'a' }] },
        { id: 'n1', terminals: [{ part: 'rd', terminal: 'b' }, { part: 'q1', terminal: 'drain' }] },
        { id: 'n2', terminals: [{ part: 'q1', terminal: 'source' }, { part: 'g1', terminal: 'gnd' }] },
        { id: 'n3', terminals: [{ part: 'rg', terminal: 'b' }, { part: 'q1', terminal: 'gate' }] },
    ]];

    it('gate high: the drain sits near ground through Rds(on), not at -2247 V', () => {
        const [parts, nets] = nmosCircuit();
        const b = solve(parts, nets);
        const vD = b.nodeVoltages.get('n1');
        assert.ok(vD >= 0 && vD < 0.5, `switched-on drain near 0, got ${vD}`);
    });
});
