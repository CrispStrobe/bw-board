// Depletion-mode dual-gate MOSFET (src/dual-gate-mosfet.js).
//
// Gap (2026-11-24): the engine had only enhancement `nmos`/`pmos` with one
// gate. A depletion-mode device (conducting at zero gate voltage, pinched off
// by a negative one) and a tetrode whose second gate can pinch the channel as
// well had no part. Oracles: the level-1 law of each channel half
// (Id = K·(Vgs − Vp)² in saturation, Id = K·(2·Vov·Vds − Vds²) in triode),
// composed in series by hand — the two halves share the middle node, so the
// same current flows through both.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { dualGateCard, DUAL_GATE_DEFAULTS } from '../src/dual-gate-mosfet.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

/**
 * Drain at `vd` through a 1 Ω current-sense resistor, source at 0, gate 1 at
 * `vg1`, gate 2 at `vg2` (both against ground = source). Returns the drain
 * current (A) and the board.
 */
function bench({ vd, vg1, vg2, params = { lambda: 0 } }) {
    const b = new BoardImpl(9);
    b.setNetlist([
        P('G', 'gnd', {}, ['gnd']),
        P('VD', 'vsource', { volts: vd }, ['pos', 'neg']),
        P('V1', 'vsource', { volts: vg1 }, ['pos', 'neg']),
        P('V2', 'vsource', { volts: vg2 }, ['pos', 'neg']),
        P('RS', 'resistor', { ohms: 1 }, ['a', 'b']),
        P('Q', 'dual_gate_mosfet', params, ['drain', 'gate2', 'gate1', 'source']),
    ], [
        net('g', ['G', 'gnd'], ['VD', 'neg'], ['V1', 'neg'], ['V2', 'neg'], ['Q', 'source']),
        net('d0', ['VD', 'pos'], ['RS', 'a']),
        net('d', ['RS', 'b'], ['Q', 'drain']),
        net('g1', ['V1', 'pos'], ['Q', 'gate1']),
        net('g2', ['V2', 'pos'], ['Q', 'gate2']),
    ]);
    b.setPower(true);
    b.advanceTo(1_000_000n);
    const i = (b.nodeVoltages.get('d0') - b.nodeVoltages.get('d')) / 1;
    return { i, b };
}

describe('dual-gate MOSFET: depletion mode', () => {
    const { k, vp } = DUAL_GATE_DEFAULTS;

    it('conducts with both gates at the source: Idss = K·Vp² (gate 2 high, lower half saturated)', () => {
        // Gate 2 at +6 V leaves the upper half a small triode resistance; the
        // lower half, gate 1 at 0 V, is saturated and sets the current.
        const { i } = bench({ vd: 9, vg1: 0, vg2: 6 });
        close(i, k * vp * vp, 2e-5, 'Idss');
    });

    it('the square law in gate 1: Id = K·(Vg1s − Vp)², up and down from zero', () => {
        for (const vg1 of [-0.8, -0.4, 0.5, 1]) {
            const { i } = bench({ vd: 9, vg1, vg2: 8 });
            close(i, k * (vg1 - vp) ** 2, 4e-5, `Vg1s = ${vg1} V`);
        }
    });

    it('gate 1 below pinch-off cuts the channel: a negative gate voltage switches it off', () => {
        const { i, b } = bench({ vd: 9, vg1: -2, vg2: 6 });
        assert.ok(Math.abs(i) < 1e-6, `pinched by gate 1: ${i} A`);
        assert.equal(b.getDeviceState('Q').pinchedBy, 'gate1');
    });

    it('gate 1 alone pinching is reported as gate 1, whatever gate 2 is doing above its own pinch-off', () => {
        // With the series current cut, the hidden middle node has nothing to
        // hold it: it floats up between the drain and the source (GMIN) until
        // the upper half reads "cut off" against it too. That is a symptom of
        // the lower half's pinch-off, not a second one: gate 2 at 0..4 V is
        // far above Vp against the source, where the middle node sits as soon
        // as gate 1 lets current through. The defect reported 'both' here.
        for (const vg2 of [4, 2, 0, -1]) {
            const { i, b } = bench({ vd: 9, vg1: -2, vg2 });
            assert.ok(Math.abs(i) < 1e-6, `cut off: ${i} A`);
            assert.equal(b.getDeviceState('Q').pinchedBy, 'gate1', `Vg2s = ${vg2} V`);
        }
    });

    it('both gates below pinch-off is "both"', () => {
        const { i, b } = bench({ vd: 9, vg1: -2, vg2: -2 });
        assert.ok(Math.abs(i) < 1e-6, `cut off: ${i} A`);
        assert.equal(b.getDeviceState('Q').pinchedBy, 'both');
    });

    it('gate 2 alone pinches it too, with gate 1 wide open', () => {
        const { i, b } = bench({ vd: 9, vg1: 0, vg2: -2 });
        assert.ok(Math.abs(i) < 1e-6, `pinched by gate 2: ${i} A`);
        assert.equal(b.getDeviceState('Q').pinchedBy, 'gate2');
        // Gate 2 just above pinch-off: the upper half limits the current to
        // K·(Vg2 − Vmid − Vp)², far below what gate 1 alone would allow.
        const part = bench({ vd: 9, vg1: 0, vg2: -0.6 });
        assert.ok(part.i > 1e-5 && part.i < 0.5 * k * vp * vp, `gate 2 throttles: ${part.i} A`);
        const s = part.b.getDeviceState('Q');
        close(part.i, k * (s.vg2s - s.vMid - vp) ** 2, 2e-5, 'upper half saturated at its own overdrive');
    });
});

describe('a depletion-mode nmos card (vth < 0): the region the solver picks is the region it stamps', () => {
    it('at Vds = 20 mV and Vgs = 0 it is a resistor of 1/(2K·(Vgs − Vth)), not a current source of Idss', () => {
        // Before mosOverdrive the region FSM read Vgs − |Vth| = −1.2 V (cut
        // off, so "saturation") while the stamp linearised about +1.2 V: the
        // device passed Idss = 7.2 mA at 13 mV, i.e. 1.8 Ω.
        const b = new BoardImpl(9);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('VD', 'vsource', { volts: 0.02 }, ['pos', 'neg']),
            P('RS', 'resistor', { ohms: 1 }, ['a', 'b']), P('M', 'nmos', { vth: -1.2, k: 5e-3 }, ['gate', 'drain', 'source'])],
        [net('g', ['G', 'gnd'], ['VD', 'neg'], ['M', 'source'], ['M', 'gate']), net('d0', ['VD', 'pos'], ['RS', 'a']),
            net('d', ['RS', 'b'], ['M', 'drain'])]);
        b.setPower(true);
        const i = b.nodeVoltages.get('d0') - b.nodeVoltages.get('d');
        close(b.nodeVoltages.get('d') / i / (1 / (2 * 5e-3 * 1.2)), 1, 0.02, 'channel resistance');
    });
});

describe('dual-gate MOSFET: voltage-controlled resistor', () => {
    const { k, vp } = DUAL_GATE_DEFAULTS;
    /** Small-signal channel resistance at Vds = ±20 mV, from the two triode halves in series. */
    const triodeOhms = (vg1, vg2) => 1 / (2 * k * (vg1 - vp)) + 1 / (2 * k * (vg2 - vp));

    it('at small Vds the channel is a resistor of 1/(2K·Vov) per half, in series', () => {
        for (const vg1 of [-0.6, 0, 1, 2]) {
            const { i } = bench({ vd: 0.02, vg1, vg2: 6 });
            const r = 0.02 / i - 1;   // less the 1 Ω sense resistor
            close(r / triodeOhms(vg1, 6), 1, 0.03, `R(Vg1s = ${vg1} V) = ${r.toFixed(1)} Ω`);
        }
    });

    it('works both ways round (Vds < 0): the channel is symmetric, so it passes AC', () => {
        const fwd = bench({ vd: 0.02, vg1: 0, vg2: 6 }).i;
        const rev = bench({ vd: -0.02, vg1: 0, vg2: 6 }).i;
        assert.ok(rev < 0, `reverse current flows backwards: ${rev}`);
        close(-rev / fwd, 1, 0.06, 'reverse / forward at ±20 mV');
    });

    it('the card: one pinch-off and K for both halves unless a half states its own', () => {
        const c = dualGateCard({ params: { vp: -2, k: 1e-3, vp2: -0.5 } });
        assert.deepEqual([c.g1.vth, c.g1.k, c.g2.vth, c.g2.k], [-2, 1e-3, -0.5, 1e-3]);
    });

    it('the drawn netlist stays as wired; the two halves exist only in the solver view', () => {
        const { b } = bench({ vd: 9, vg1: 0, vg2: 6 });
        assert.deepEqual(b.parts.filter((p) => p.id.startsWith('Q')).map((p) => p.kind), ['dual_gate_mosfet']);
        assert.ok(!b.getNets().some((n) => n.terminals.some((t) => t.part === 'Q_g1')), 'no hidden part on a public net');
    });
});
