// E4.2 — digital scope channels. Transitions with exact solve-point
// timestamps: a 1 kHz square's edges land on the 0.5 ms grid because
// source edges are step barriers, and a tpd ring's period survives the
// transition record intact.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerLogicGates } from '../src/devices/logic-gates.js';
import { unregisterDevice } from '../src/devices.js';

describe('digital scope channels', () => {
    it('a 1 kHz square records transitions ON the edges, half-period apart', () => {
        const parts = [
            { id: 'gnd', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'vs', kind: 'vsource', params: { wave: 'square', amplitude: 5, offset: 0, freq: 1000, volts: 0 }, terminals: ['pos', 'neg'] },
            { id: 'r1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        ];
        const nets = [
            { id: 'n_src', terminals: [{ part: 'vs', terminal: 'pos' }, { part: 'r1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'gnd', terminal: 'gnd' }, { part: 'vs', terminal: 'neg' }, { part: 'r1', terminal: 'b' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        const h = b.addScopeChannel({ type: 'digital', netId: 'n_src' });
        b.advanceTo(3_200_000n); // 3.2 ms: edges at 0.5, 1.0, 1.5, 2.0, 2.5, 3.0 ms
        const d = b.getScopeData(h);
        assert.equal(d.channelType, 'digital');
        assert.equal(d.threshold, 2.5, 'default threshold is vcc/2');
        const trans = [];
        for (let i = 0; i < d.count && i < d.depth; i++) {
            trans.push([d.transitions[i * 2], d.transitions[i * 2 + 1]]);
        }
        // First record is the initial level (high half-cycle), then edges.
        assert.equal(trans[0][1], 1, 'initial level recorded high');
        const edges = trans.slice(1);
        assert.ok(edges.length >= 6, `six edges in 3.2 ms: got ${edges.length}`);
        for (let k = 0; k < 6; k++) {
            const expectNs = (k + 1) * 500_000;
            assert.ok(Math.abs(edges[k][0] - expectNs) <= 2,
                `edge ${k} at ${expectNs} ns exactly (solve-point timestamps): got ${edges[k][0]}`);
            assert.equal(edges[k][1], k % 2 === 0 ? 0 : 1, 'levels alternate');
        }
    });

    describe('with tpd gates', () => {
        beforeEach(() => registerLogicGates());
        afterEach(() => {
            for (const k of ['gate_and', 'gate_or', 'gate_not', 'gate_nand', 'gate_nor', 'gate_xor']) {
                try { unregisterDevice(k); } catch {}
            }
        });

        it('a ring oscillator channel measures the 720 ns period from transitions alone', () => {
            const parts = [
                { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] },
                { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            ];
            const nets = [
                { id: 'n_vcc', terminals: [{ part: 'V1', terminal: 'vcc' }] },
                { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }] },
            ];
            const tpds = [100, 120, 140];
            for (let k = 0; k < 3; k++) {
                parts.push({ id: `N${k}`, kind: 'gate_not', params: { tpdNs: tpds[k] }, terminals: ['in0', 'out'] });
                nets.push({ id: `n_${k}`, terminals: [
                    { part: `N${k}`, terminal: 'out' },
                    { part: `N${(k + 1) % 3}`, terminal: 'in0' },
                ] });
            }
            const b = new BoardImpl(5.0);
            b.setNetlist(parts, nets);
            const h = b.addScopeChannel({ type: 'digital', netId: 'n_0' });
            b.advanceTo(6_000n);
            const d = b.getScopeData(h);
            const rises = [];
            for (let i = 0; i < Math.min(d.count, d.depth); i++) {
                const t = d.transitions[i * 2]; const lv = d.transitions[i * 2 + 1];
                if (lv === 1 && t > 1500) rises.push(t);
            }
            assert.ok(rises.length >= 4, `oscillating: ${rises.length} rising transitions`);
            const period = (rises[rises.length - 1] - rises[0]) / (rises.length - 1);
            assert.ok(Math.abs(period - 720) <= 5,
                `period 2·Σtpd = 720 ns from the transition record: ${period.toFixed(1)} ns`);
        });
    });

    it('a quiet net records its initial level and then nothing', () => {
        const parts = [
            { id: 'V1', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'G1', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
        ];
        const nets = [
            { id: 'n_hi', terminals: [{ part: 'V1', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'G1', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        const h = b.addScopeChannel({ type: 'digital', netId: 'n_hi' });
        b.advanceTo(10_000_000n); // 10 ms of nothing happening
        const d = b.getScopeData(h);
        assert.equal(d.count, 1, 'one record: the initial level');
        assert.equal(d.transitions[1], 1, 'and it is high');
    });
});
