// Source and transistor current honesty — hand oracles per
// spec-updates/source-and-transistor-current-honesty.md.
//
// The transistor cases cross-check the extraction against a NEIGHBOR's
// independently computed branch current (Ohm's law on solved nodes),
// so extraction and stamp cannot agree by sharing a wrong assumption.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { solveMNA } from '../src/mna.js';
import { BoardImpl } from '../src/board.js';

const V = (r, n) => r.nodeVoltages.get(n) ?? 0;
const I = (r, p, t) => r.branchCurrents.get(p)?.get(t) ?? 0;

describe('vsource rInternal (source honesty 1)', () => {
    const bench = (params) => {
        const parts = [
            { id: 'B1', kind: 'vsource', params, terminals: ['pos', 'neg'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 10 }, terminals: ['a', 'b'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        ];
        const nets = [
            { id: 'n_pos', terminals: [{ part: 'B1', terminal: 'pos' }, { part: 'R1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [
                { part: 'B1', terminal: 'neg' }, { part: 'R1', terminal: 'b' },
                { part: 'GND', terminal: 'gnd' }] },
        ];
        return solveMNA(parts, nets, new Map(), new Map(), 5.0, {});
    };

    it('9 V, rInternal 2 Ω, 10 Ω load: terminal sits at 7.5000 V', () => {
        const r = bench({ volts: 9, rInternal: 2 });
        assert.ok(Math.abs(V(r, 'n_pos') - 7.5) < 1e-9,
            `divider 9·10/12 = 7.5: got ${V(r, 'n_pos').toFixed(6)}`);
    });

    it('without rInternal the source stays ideal (9.0000 V)', () => {
        const r = bench({ volts: 9 });
        assert.ok(Math.abs(V(r, 'n_pos') - 9) < 1e-9,
            `ideal preserved: got ${V(r, 'n_pos').toFixed(6)}`);
    });

    it('AC: swept source rInternal 100 into 100 Ω load reads 0.5 flat', () => {
        const parts = [
            { id: 'FG', kind: 'vsource', params: { volts: 0, wave: 'sine', freq: 1000, amplitude: 1, rInternal: 100 }, terminals: ['pos', 'neg'] },
            { id: 'RL', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        ];
        const nets = [
            { id: 'n_out', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'RL', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [
                { part: 'FG', terminal: 'neg' }, { part: 'RL', terminal: 'b' },
                { part: 'GND', terminal: 'gnd' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        const rows = b.runAc({ sourceId: 'FG', from: 100, to: 10000, pointsPerDecade: 2, probes: ['n_out'] });
        for (const row of rows) {
            const m = row.results.get('n_out').mag;
            assert.ok(Math.abs(m - 0.5) < 1e-6,
                `resistive divider at ${row.freq} Hz: |V| = ${m.toFixed(6)}`);
        }
    });
});

describe('saturated PNP stamps its base junction (source honesty 2)', () => {
    // pc32-pnp-high-side, switch closed — the EXPECTED-quantities census
    // case: previously base 0 V / rb 0 mA / extracted ib 430 mA.
    const bench = () => {
        const parts = [
            { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'q1', kind: 'pnp', params: { beta: 100, vbe: 0.7 }, terminals: ['base', 'collector', 'emitter'] },
            { id: 'rb', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'sw', kind: 'switch', params: {}, terminals: ['a', 'b'] },
            { id: 'rl', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'led', kind: 'led', params: { vf: 2 }, terminals: ['anode', 'cathode'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'q1', terminal: 'emitter' }] },
            { id: 'n_base', terminals: [{ part: 'q1', terminal: 'base' }, { part: 'sw', terminal: 'a' }] },
            { id: 'n_swb', terminals: [{ part: 'sw', terminal: 'b' }, { part: 'rb', terminal: 'a' }] },
            { id: 'n_col', terminals: [{ part: 'q1', terminal: 'collector' }, { part: 'rl', terminal: 'a' }] },
            { id: 'n_led', terminals: [{ part: 'rl', terminal: 'b' }, { part: 'led', terminal: 'anode' }] },
            { id: 'n_gnd', terminals: [
                { part: 'gnd1', terminal: 'gnd' }, { part: 'rb', terminal: 'b' },
                { part: 'led', terminal: 'cathode' }] },
        ];
        return solveMNA(parts, nets, new Map(), new Map([['sw', 1]]), 5.0, {});
    };

    it('base conducts: ≈4.30 V, and ib EQUALS the base resistor current', () => {
        const r = bench();
        assert.ok(r.converged, 'converges');
        const vBase = V(r, 'n_base');
        assert.ok(Math.abs(vBase - 4.304) < 0.02, `base ≈ 4.304 V: got ${vBase.toFixed(4)}`);
        const ib = I(r, 'q1', 'base');
        const iRb = I(r, 'rb', 'b'); // into b = current flowing a→b = the base drive
        assert.ok(Math.abs(ib - iRb) < 1e-9,
            `cross-part KCL: ib ${(ib * 1e3).toFixed(4)} mA == rb ${(iRb * 1e3).toFixed(4)} mA`);
        assert.ok(Math.abs(ib - 0.4296e-3) < 0.02e-3, `ib ≈ 0.430 mA: got ${(ib * 1e3).toFixed(4)}`);
    });

    it('collector passes the load current; the transistor sums to zero', () => {
        const r = bench();
        const ic = I(r, 'q1', 'collector');
        const iRl = I(r, 'rl', 'b');
        assert.ok(Math.abs(ic - iRl) < 1e-6,
            `ic ${(ic * 1e3).toFixed(4)} mA == load ${(iRl * 1e3).toFixed(4)} mA`);
        assert.ok(Math.abs(ic - 2.772e-3) < 0.05e-3, `ic ≈ 2.772 mA: got ${(ic * 1e3).toFixed(4)}`);
        const kcl = I(r, 'q1', 'base') + I(r, 'q1', 'collector') + I(r, 'q1', 'emitter');
        assert.ok(Math.abs(kcl) < 1e-9, `KCL at q1: ${(kcl * 1e3).toExponential(2)} mA`);
    });
});

describe('FET extraction matches the region the solve used (source honesty 3)', () => {
    it('NMOS in triode: extracted drain current equals the load current', () => {
        // vth 2, gate 5 → vov 3; k·vov² would demand 4.5 A, so with a
        // 1 kΩ load the region logic drives it to triode and the channel
        // is gOn = 2K·vov = 3 S. Load current ≈ 5/(1000 + 1/3) ≈ 4.998 mA.
        const parts = [
            { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'vg', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
            { id: 'rd', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'm1', kind: 'nmos', params: { vth: 2.0, k: 0.5 }, terminals: ['gate', 'drain', 'source'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'rd', terminal: 'a' }] },
            { id: 'n_drain', terminals: [{ part: 'rd', terminal: 'b' }, { part: 'm1', terminal: 'drain' }] },
            { id: 'n_gate', terminals: [{ part: 'vg', terminal: 'pos' }, { part: 'm1', terminal: 'gate' }] },
            { id: 'n_gnd', terminals: [
                { part: 'gnd1', terminal: 'gnd' }, { part: 'vg', terminal: 'neg' },
                { part: 'm1', terminal: 'source' }] },
        ];
        const r = solveMNA(parts, nets, new Map(), new Map(), 5.0, {});
        assert.ok(r.converged, 'converges');
        assert.ok(V(r, 'n_drain') < 0.05, `drain near ground: ${V(r, 'n_drain').toFixed(4)} V`);
        const idExtract = I(r, 'm1', 'drain');
        const iLoad = I(r, 'rd', 'b');
        assert.ok(Math.abs(idExtract - iLoad) < 1e-6,
            `triode extraction ${(idExtract * 1e3).toFixed(4)} mA == load ${(iLoad * 1e3).toFixed(4)} mA`);
        const kcl = I(r, 'm1', 'gate') + I(r, 'm1', 'drain') + I(r, 'm1', 'source');
        assert.ok(Math.abs(kcl) < 1e-9, `KCL at m1: ${kcl.toExponential(2)}`);
    });

    it('conducting PMOS: into-source positive, into-drain negative, |i| = load', () => {
        // High-side PMOS: source at 5 V, gate grounded (vsg = 5 > |vth|),
        // drain through 1 kΩ to ground — triode, load ≈ 5 mA.
        const parts = [
            { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'm1', kind: 'pmos', params: { vth: -2.0, k: 0.5 }, terminals: ['gate', 'drain', 'source'] },
            { id: 'rl', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'm1', terminal: 'source' }] },
            { id: 'n_drain', terminals: [{ part: 'm1', terminal: 'drain' }, { part: 'rl', terminal: 'a' }] },
            { id: 'n_gate', terminals: [{ part: 'm1', terminal: 'gate' }, { part: 'gnd1', terminal: 'gnd' }] },
            { id: 'n_gnd2', terminals: [{ part: 'rl', terminal: 'b' }, { part: 'gnd1', terminal: 'gnd' }] },
        ];
        const r = solveMNA(parts, nets, new Map(), new Map(), 5.0, {});
        assert.ok(r.converged, 'converges');
        const iS = I(r, 'm1', 'source');
        const iD = I(r, 'm1', 'drain');
        const iLoad = I(r, 'rl', 'b');
        assert.ok(iS > 0 && iD < 0, `signs: source ${iS.toExponential(2)}, drain ${iD.toExponential(2)}`);
        assert.ok(Math.abs(-iD - iLoad) < 1e-6,
            `|into-drain| ${(-iD * 1e3).toFixed(4)} mA == load ${(iLoad * 1e3).toFixed(4)} mA`);
    });
});

describe('buzzer branch current is extractable (KCL-visible load)', () => {
    it('44-darlington topology: buzzer current equals the collector current', () => {
        const parts = [
            { id: 'vcc1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'gnd1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'buzz1', kind: 'buzzer', params: {}, terminals: ['a', 'b'] },
            { id: 'q1', kind: 'npn', params: { beta: 100 }, terminals: ['base', 'collector', 'emitter'] },
            { id: 'btn1', kind: 'button', params: {}, terminals: ['a', 'b'] },
            { id: 'rb1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'vcc1', terminal: 'vcc' }, { part: 'buzz1', terminal: 'a' }, { part: 'btn1', terminal: 'a' }] },
            { id: 'n_col', terminals: [{ part: 'buzz1', terminal: 'b' }, { part: 'q1', terminal: 'collector' }] },
            { id: 'n_btn', terminals: [{ part: 'btn1', terminal: 'b' }, { part: 'rb1', terminal: 'a' }] },
            { id: 'n_base', terminals: [{ part: 'rb1', terminal: 'b' }, { part: 'q1', terminal: 'base' }] },
            { id: 'n_gnd', terminals: [{ part: 'gnd1', terminal: 'gnd' }, { part: 'q1', terminal: 'emitter' }] },
        ];
        const r = solveMNA(parts, nets, new Map(), new Map([['btn1', 1]]), 5.0, {});
        assert.ok(r.converged, 'converges');
        const iBuzz = I(r, 'buzz1', 'b');
        const iC = I(r, 'q1', 'collector');
        assert.ok(Math.abs(iBuzz) > 1e-3, `buzzer carries real current: ${(iBuzz * 1e3).toFixed(3)} mA`);
        assert.ok(Math.abs(iBuzz - iC) < 1e-6,
            `buzzer ${(iBuzz * 1e3).toFixed(4)} mA == collector ${(iC * 1e3).toFixed(4)} mA`);
    });
});
