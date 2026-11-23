// solar_cell is a single-diode photovoltaic model (builder 3): photocurrent
// in parallel with the junction and a shunt, behind a series resistance. The
// old straight line (Voc·light behind 5 Ω) had no knee, no maximum-power
// point, Voc linear in light, and its source referenced to ground.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/index.js';

registerAllDevices();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

function loaded(ohms, params = {}, light = 1) {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'S', kind: 'solar_cell', params: { light, ...params }, terminals: ['pos', 'neg'] },
        { id: 'R', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
    ], [
        net('np', ['S', 'pos'], ['R', 'a']),
        net('ng', ['G', 'gnd'], ['S', 'neg'], ['R', 'b']),
    ]);
    board.advanceTo(1_000_000n);
    const v = board.nodeVoltage('np');
    return { v, i: v / ohms, p: v * v / ohms };
}

describe('solar cell, single-diode model', () => {
    it('open circuit gives Voc and a short circuit gives Isc (defaults 0.6 V, 0.12 A)', () => {
        assert.ok(Math.abs(loaded(1e9).v - 0.6) < 0.005, `Voc ${loaded(1e9).v}`);
        assert.ok(Math.abs(loaded(1e-3).i - 0.12) < 0.002, `Isc ${loaded(1e-3).i}`);
    });

    it('has a knee: a maximum-power point near 0.8·Voc and a fill factor of a real cell', () => {
        let best = { p: 0 };
        for (let r = 0.5; r <= 50; r *= 1.05) {
            const x = loaded(r);
            if (x.p > best.p) best = { ...x, r };
        }
        const ff = best.p / (0.6 * 0.12);
        assert.ok(best.v > 0.42 && best.v < 0.53, `Vmpp ${best.v.toFixed(3)} V`);
        assert.ok(ff > 0.6 && ff < 0.85, `fill factor ${ff.toFixed(3)} (a straight line gives 0.25)`);
    });

    it('Voc falls logarithmically with light, Isc linearly', () => {
        const vHalf = loaded(1e9, {}, 0.5).v;
        // Δ = n·Vt·ln 2 ≈ 23 mV, not half of 0.6 V.
        assert.ok(vHalf > 0.56 && vHalf < 0.59, `Voc at half light ${vHalf}`);
        assert.ok(Math.abs(loaded(1e-3, {}, 0.5).i - 0.06) < 0.002);
    });

    it('a 6 V panel (voc 6, isc 0.2) scales by its series cells, and is referenced to its own neg', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'VB', kind: 'vsource', params: { volts: 2 }, terminals: ['pos', 'neg'] },
            { id: 'S', kind: 'solar_cell', params: { voc: 6, isc: 0.2 }, terminals: ['pos', 'neg'] },
            { id: 'R', kind: 'resistor', params: { ohms: 1e9 }, terminals: ['a', 'b'] },
        ], [
            net('nb', ['VB', 'pos'], ['S', 'neg']),
            net('np', ['S', 'pos'], ['R', 'a']),
            net('ng', ['G', 'gnd'], ['VB', 'neg'], ['R', 'b']),
        ]);
        board.advanceTo(1_000_000n);
        assert.ok(Math.abs(board.nodeVoltage('np') - 8) < 0.05, `2 V + 6 V Voc, got ${board.nodeVoltage('np')}`);
    });
});
