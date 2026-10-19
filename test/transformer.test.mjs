// E3.4 — coupled inductors / transformer. Hand oracles per
// spec-updates/coupled-inductors.md.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { validateNetlist } from '../src/validate.js';

const US = 1000n;
const MS = 1_000_000n;

function acBench() {
    // 1 kHz sine, ratio 2 (lm 10 H), 1 Ω primary sense, 100 Ω secondary load.
    const parts = [
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'FG', kind: 'vsource', params: { wave: 'sine', freq: 1000, amplitude: 5, offset: 0, volts: 0 }, terminals: ['pos', 'neg'] },
        { id: 'RS', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
        { id: 'T1', kind: 'transformer', params: { ratio: 2, lm: 10 }, terminals: ['p1', 'p2', 's1', 's2'] },
        { id: 'RL', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
    ];
    const nets = [
        { id: 'n_src', terminals: [{ part: 'FG', terminal: 'pos' }, { part: 'RS', terminal: 'a' }] },
        { id: 'n_pri', terminals: [{ part: 'RS', terminal: 'b' }, { part: 'T1', terminal: 'p1' }] },
        { id: 'n_sec', terminals: [{ part: 'T1', terminal: 's1' }, { part: 'RL', terminal: 'a' }] },
        { id: 'n_gnd', terminals: [
            { part: 'GND', terminal: 'gnd' }, { part: 'FG', terminal: 'neg' },
            { part: 'T1', terminal: 'p2' }, { part: 'T1', terminal: 's2' },
            { part: 'RL', terminal: 'b' }] },
    ];
    const b = new BoardImpl(5.0);
    b.setNetlist(parts, nets);
    return b;
}

describe('transformer (E3.4)', () => {
    it('2:1 turns: secondary voltage halves, current doubles; power balances', () => {
        const b = acBench();
        // Sample cycles 2–5 (skip the first: magnetizing transient).
        let sPri = 0; let sSec = 0; let pIn = 0; let pOut = 0; let n = 0;
        for (let us = 1000; us <= 5000; us += 10) {
            b.advanceTo(BigInt(us) * US);
            const vSrc = b.nodeVoltage('n_src');
            const vPri = b.nodeVoltage('n_pri');
            const vSec = b.nodeVoltage('n_sec');
            const iPri = (vSrc - vPri) / 1;      // the 1 Ω sense
            const iSec = vSec / 100;             // the load
            sPri += vPri * vPri; sSec += vSec * vSec;
            pIn += vPri * iPri; pOut += vSec * iSec;
            n++;
        }
        const rmsPri = Math.sqrt(sPri / n);
        const rmsSec = Math.sqrt(sSec / n);
        const ratio = rmsPri / rmsSec;
        assert.ok(Math.abs(ratio - 2) < 0.1,
            `voltage ratio ≈ n = 2: measured ${ratio.toFixed(3)}`);
        // Current ratio is the reciprocal: i_sec/i_pri ≈ 2 · (load share).
        // Power balance is the cleaner lossless statement:
        const pinAvg = pIn / n; const poutAvg = pOut / n;
        assert.ok(poutAvg > 0.01, 'real power flows');
        assert.ok(Math.abs(pinAvg - poutAvg) / pinAvg < 0.05,
            `lossless: P_in ≈ P_out over whole cycles: in ${pinAvg.toFixed(4)} W, out ${poutAvg.toFixed(4)} W`);
    });

    it('energy books balance instant by instant against the stored-field term', () => {
        const b = acBench();
        const P = { l1: 10, l2: 2.5 };
        const m = 0.999 * Math.sqrt(P.l1 * P.l2);
        const eStored = () => {
            const i1 = b.inductorCurrents.get('T1:p') ?? 0;
            const i2 = b.inductorCurrents.get('T1:s') ?? 0;
            return 0.5 * (P.l1 * i1 * i1 + 2 * m * i1 * i2 + P.l2 * i2 * i2);
        };
        let acc = 0; let prevT = 0;
        b.advanceTo(1n * US);
        const e0 = eStored();
        for (let us = 2; us <= 2000; us += 2) {
            const t = us * 1e-6;
            b.advanceTo(BigInt(us) * US);
            const vPri = b.nodeVoltage('n_pri');
            const vSec = b.nodeVoltage('n_sec');
            const iPri = (b.nodeVoltage('n_src') - vPri) / 1;
            const iSec = -(vSec / 100); // current INTO s1 is negative of load draw
            acc += (vPri * iPri + vSec * iSec) * (t - prevT);
            prevT = t;
        }
        const dE = eStored() - e0;
        // ∫(v·i) into the windings = stored-energy change, lossless.
        assert.ok(Math.abs(acc - dE) < Math.max(2e-4, Math.abs(acc) * 0.1),
            `energy conservation: ∫p dt = ${acc.toExponential(3)} J vs ΔE = ${dE.toExponential(3)} J`);
    });

    it('AC sweep: |V2/V1| matches the LEAKAGE-aware hand value, not the naive 1/n', () => {
        // First drafted as "≈ 0.5" — and the model refused, correctly:
        // with k = 0.999 the secondary leakage (1−k²)·L2 = 5 mH is
        // 31.4 Ω at 1 kHz against the 100 Ω load, so
        // |V2/V1| = (k/n)·ZL/|ZL + jω(1−k²)L2| = 0.4766. The naive 1/n
        // is the k→1 limit, which the k = 0.9999 point approaches.
        const b = acBench();
        const rows = b.runAc({ sourceId: 'FG', from: 999, to: 1001, pointsPerDecade: 1, probes: ['n_pri', 'n_sec'] });
        const r = rows[0].results;
        const g = r.get('n_sec').mag / r.get('n_pri').mag;
        const w = 2 * Math.PI * 1000;
        const leak = (1 - 0.999 * 0.999) * 2.5;
        const hand = (0.999 / 2) * 100 / Math.hypot(100, w * leak);
        assert.ok(Math.abs(g - hand) < 0.005,
            `|V2/V1| = leakage-aware ${hand.toFixed(4)}: got ${g.toFixed(4)}`);

        // Tighter coupling approaches the ideal ratio.
        const parts2 = JSON.parse(JSON.stringify(b.parts));
        parts2.find((x) => x.id === 'T1').params.k = 0.9999;
        const b2 = new BoardImpl(5.0);
        b2.setNetlist(parts2, JSON.parse(JSON.stringify(b.nets)));
        const rows2 = b2.runAc({ sourceId: 'FG', from: 999, to: 1001, pointsPerDecade: 1, probes: ['n_pri', 'n_sec'] });
        const g2 = rows2[0].results.get('n_sec').mag / rows2[0].results.get('n_pri').mag;
        assert.ok(Math.abs(g2 - 0.5) < 0.01, `k→1 approaches 1/n: got ${g2.toFixed(4)}`);
    });

    it('DC honesty: a DC primary induces nothing; the winding is a short', () => {
        const parts = [
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
            { id: 'T1', kind: 'transformer', params: { ratio: 2 }, terminals: ['p1', 'p2', 's1', 's2'] },
            { id: 'RL', kind: 'resistor', params: { ohms: 100 }, terminals: ['a', 'b'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
            { id: 'n_pri', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'T1', terminal: 'p1' }] },
            { id: 'n_sec', terminals: [{ part: 'T1', terminal: 's1' }, { part: 'RL', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [
                { part: 'GND', terminal: 'gnd' }, { part: 'T1', terminal: 'p2' },
                { part: 'T1', terminal: 's2' }, { part: 'RL', terminal: 'b' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        assert.ok(b.nodeVoltage('n_pri') < 0.01, 'DC: the winding is a short');
        assert.ok(Math.abs(b.nodeVoltage('n_sec')) < 0.01, 'DC: nothing crosses');
    });

    it('k outside (0,1) refuses at validation with the reason named', () => {
        const parts = [{ id: 'T1', kind: 'transformer', params: { k: 1 }, terminals: ['p1', 'p2', 's1', 's2'] }];
        const r = validateNetlist(parts, []);
        const err = r.find((e) => e.severity === 'error' && /coupling must sit in \(0, 1\)/.test(e.message));
        assert.ok(err, `expected the named k refusal, got: ${JSON.stringify(r)}`);
        assert.match(err.message, /singular inductance matrix/);
    });
});
