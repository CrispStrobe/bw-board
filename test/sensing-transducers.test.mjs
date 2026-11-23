// Thermocouple, hand-wound coil and electrolysis cell (src/sensing-transducers.js).
//
// Gap (2026-11-23, round 4): no part turned a temperature difference, a
// falling magnet, a coil current's field, metal near a coil or electrolysis
// into circuit behaviour. Oracles: the ITS-90 reference tables (thermocouple),
// Wheeler's formula, the finite-solenoid field and Faraday's law on the
// point-dipole flux linkage (coil), the Tafel law and KCL (electrolysis).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import {
    thermocoupleEmf, airCoilCard, fluxLinkage, fluxLinkageSlope, dropEmf, axialTeslaPerAmp, MU0,
    electrolysisCard, faradaicCurrent,
} from '../src/sensing-transducers.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

/** `kind` (pins a/b or pos/neg) with a load resistor across it. */
function across(kind, params, load) {
    const [pa, pb] = kind === 'thermocouple' ? ['pos', 'neg'] : ['a', 'b'];
    const b = new BoardImpl(5);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('X', kind, params, [pa, pb]), P('R', 'resistor', { ohms: load }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['X', pb], ['R', 'b']), net('o', ['X', pa], ['R', 'a'])]);
    b.setPower(true);
    return b;
}

describe('thermocouple: Seebeck EMF from the reference tables', () => {
    it('reference points: K 41.276 mV at 1000 °C, T 20.872 mV at 400 °C, J 27.393 mV at 500 °C', () => {
        close(thermocoupleEmf('K', 1000) * 1e3, 41.276, 1e-9, 'K 1000');
        close(thermocoupleEmf('T', 400) * 1e3, 20.872, 1e-9, 'T 400');
        close(thermocoupleEmf('J', 500) * 1e3, 27.393, 1e-9, 'J 500');
        close(thermocoupleEmf('K', 0), 0, 1e-12, 'zero at 0 °C');
        // Around room temperature: ≈ 41 µV/K (K), ≈ 41 µV/K (T, copper/constantan).
        close((thermocoupleEmf('K', 30) - thermocoupleEmf('K', 20)) / 10 * 1e6, 41, 0.5, 'K slope');
        close((thermocoupleEmf('T', 30) - thermocoupleEmf('T', 20)) / 10 * 1e6, 42.8, 0.5, 'T slope');
    });

    it('in a circuit: E(hot) − E(bench), through its own resistance', () => {
        const b = across('thermocouple', { type: 'K', hotC: 625, ohms: 5 }, 1e6);
        const want = thermocoupleEmf('K', 625) - thermocoupleEmf('K', 25);
        close(b.nodeVoltages.get('o'), want * 1e6 / (1e6 + 5), 1e-7, 'open-circuit EMF at 625 °C');
        close(b.getDeviceState('X').emfV, want, 1e-12, 'readout');
        // Loaded by 5 Ω: half the EMF.
        const h = across('thermocouple', { type: 'K', hotC: 625, ohms: 5 }, 5);
        close(h.nodeVoltages.get('o'), want / 2, 1e-6, 'divides with its resistance');
        // Both junctions at the bench temperature: nothing.
        close(across('thermocouple', { type: 'T' }, 1e6).nodeVoltages.get('o'), 0, 1e-9, 'no difference, no EMF');
        // The cold junction follows the bench.
        const w = across('thermocouple', { type: 'K', hotC: 625 }, 1e6);
        w.setTemperature(35);
        close(w.nodeVoltages.get('o'), thermocoupleEmf('K', 625) - thermocoupleEmf('K', 35), 1e-6, 'warmer bench, less EMF');
    });
});

describe('hand-wound coil', () => {
    it('inductance (Wheeler), wire resistance and the field of its current', () => {
        const c = airCoilCard({ params: { turns: 200, radiusM: 0.015, lengthM: 0.03, wireMm: 0.25 } });
        close(c.henrys, MU0 * 200 ** 2 * Math.PI * 0.015 ** 2 / (0.03 + 0.9 * 0.015), 1e-12, 'L');
        close(c.ohms, 1.72e-8 * 200 * 2 * Math.PI * 0.015 / (Math.PI * 0.25e-3 ** 2 / 4), 1e-9, 'R');
        // The axial field formula at the centre is the textbook µ0NI/√(l²+4r²).
        close(axialTeslaPerAmp(200, 0.015, 0.03, 0), MU0 * 200 / Math.hypot(0.03, 0.03), 1e-12, 'B(0)');
        // A long solenoid's centre field tends to µ0 N I / l.
        close(axialTeslaPerAmp(1000, 0.01, 1, 0), MU0 * 1000, MU0 * 1000 * 1e-3, 'long-solenoid limit');
    });

    it('a battery through it: current from the wire resistance, compass deflection from the field', () => {
        const b = new BoardImpl(5);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('V', 'vsource', { volts: 1.5 }, ['pos', 'neg']),
            P('L', 'air_coil', {}, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['V', 'neg'], ['L', 'b']), net('o', ['V', 'pos'], ['L', 'a'])]);
        b.setPower(true);
        b.advanceTo(20_000_000n);
        const s = b.getDeviceState('L');
        const c = airCoilCard({ params: {} });
        close(s.amps, 1.5 / c.ohms, 1e-4, 'I = V/R once L has settled');
        close(s.fieldT, c.teslaPerAmp * s.amps, 1e-12, 'B at the centre');
        const bx = axialTeslaPerAmp(200, 0.015, 0.03, 0.05) * s.amps;
        close(s.compassDeg, Math.atan2(bx, 20e-6) * 180 / Math.PI, 1e-6, 'needle 5 cm away against 20 µT');
        assert.ok(s.compassDeg > 45 && s.compassDeg < 89, `deflection ${s.compassDeg}`);
    });

    it('a dropped magnet: EMF = dΛ/dt, a pulse in, an opposite one out, zero net flux change', () => {
        const card = airCoilCard({ params: { turns: 1000 } });
        // dΛ/dz is the derivative of Λ (numerically).
        for (const z of [0.05, 0.02, 0.01, 0, -0.01, -0.03]) {
            const dz = 1e-6;
            close(fluxLinkageSlope(card, z), (fluxLinkage(card, z + dz) - fluxLinkage(card, z - dz)) / (2 * dz), 1e-6, `slope at z=${z}`);
        }
        // ∫e dt over the whole fall = Λ(end) − Λ(start): both far away, so ≈ 0.
        let integral = 0; let peak = 0; let trough = 0;
        const dt = 1e-5;
        for (let t = 0; t < 0.4; t += dt) { const e = dropEmf(card, t); integral += e * dt; peak = Math.max(peak, e); trough = Math.min(trough, e); }
        close(integral, 0, 2e-4, 'net flux change');
        assert.ok(peak > 0.5 && trough < -0.5, `entry ${peak} V, exit ${trough} V`);
        assert.ok(-trough > peak, 'the magnet leaves faster than it enters: a bigger exit pulse');

        // In a circuit: 10 kΩ across the coil sees the pulses after the drop, nothing before.
        const b = new BoardImpl(5);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('L', 'air_coil', { turns: 1000 }, ['a', 'b']), P('R', 'resistor', { ohms: 10000 }, ['a', 'b'])],
            [net('g', ['G', 'gnd'], ['L', 'b'], ['R', 'b']), net('o', ['L', 'a'], ['R', 'a'])]);
        b.setPower(true);
        b.advanceTo(20_000_000n);
        close(b.nodeVoltages.get('o'), 0, 1e-9, 'no magnet, no EMF');
        assert.equal(b.setDeviceControl('L', 'drop', 1), true);
        let mx = 0; let mn = 0;
        for (let ms = 21; ms <= 260; ms++) {
            b.advanceTo(BigInt(ms) * 1_000_000n);
            const v = b.nodeVoltages.get('o');
            mx = Math.max(mx, v); mn = Math.min(mn, v);
        }
        close(mx, peak * 10000 / (10000 + card.ohms), 0.05 * peak, 'entry pulse at the load');
        close(mn, trough * 10000 / (10000 + card.ohms), 0.05 * -trough, 'exit pulse at the load');
        assert.equal(b.transientAnalysisStatus().failure, null);
    });

    it('metal near the coil: a coin lowers L, iron raises it, falling off with distance', () => {
        const L0 = airCoilCard({ params: {} }).henrys;
        const coin = (cm) => airCoilCard({ params: { metalCm: cm } }).henrys / L0 - 1;
        const nail = (cm) => airCoilCard({ params: { metalCm: cm, metalKind: 'ferrous' } }).henrys / L0 - 1;
        close(coin(0), -0.05, 1e-12, 'coin flat on the coil: −5 %');
        close(nail(0), 0.05, 1e-12, 'iron: +5 %');
        close(coin(1.5), -0.05 / 8, 1e-12, 'at one radius: an eighth');
        assert.ok(Math.abs(coin(10)) < 1e-4, 'far away: nothing');
        // In a circuit the solver inductor follows the param live.
        const b = new BoardImpl(5);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('V', 'vsource', { volts: 1 }, ['pos', 'neg']), P('L', 'air_coil', {}, ['a', 'b'])],
            [net('g', ['G', 'gnd'], ['V', 'neg'], ['L', 'b']), net('o', ['V', 'pos'], ['L', 'a'])]);
        b.setPower(true);
        b.advanceTo(1_000_000n);
        b.setPartParam('L', 'metalCm', 0);
        b.advanceTo(2_000_000n);
        close(b.getDeviceState('L').henrys, L0 * 0.95, 1e-12, 'device reports the shifted L');
        close(b._solveParts.find(p => p.id === 'L_l').params.henrys, L0 * 0.95, 1e-12, 'solver inductor moved');
    });
});

describe('electrolysis cell', () => {
    const cell = (volts, params = {}) => {
        const b = new BoardImpl(9);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('V', 'vsource', { volts }, ['pos', 'neg']), P('T', 'electrolysis_cell', params, ['a', 'b'])],
            [net('g', ['G', 'gnd'], ['V', 'neg'], ['T', 'b']), net('o', ['V', 'pos'], ['T', 'a'])]);
        b.setPower(true);
        b.advanceTo(200_000_000n);
        return b;
    };

    it('below the decomposition voltage almost nothing flows; above it, Tafel-limited by the electrolyte', () => {
        const card = electrolysisCard({ params: {} });
        const s15 = cell(1.5).getDeviceState('T');
        // Steady state: all of it is electrolysis, I_F(V_interface) = (V − V_interface)/R.
        close(s15.faradaicAmps, faradaicCurrent(card, s15.polarisationV), 1e-8, '1.5 V: I_F at the interface');
        assert.ok(s15.amps < 1e-6, `1.5 V: ${s15.amps} A`);
        assert.equal(s15.taste, 'none');
        const s9 = cell(9).getDeviceState('T');
        close(s9.amps, faradaicCurrent(card, s9.polarisationV), 2e-5, '9 V: steady current is the Faradaic one');
        close(s9.amps, (9 - s9.polarisationV) / 2000, 1e-6, 'and the electrolyte drops the rest');
        assert.ok(s9.polarisationV > 1.9 && s9.polarisationV < 2.3, `interface ${s9.polarisationV} V`);
        assert.equal(s9.taste, 'strong');
        assert.equal(s9.sourAt, 'a', 'acid at the electrode the current enters by');
        // Hydrogen: Q/2F.
        close(s9.hydrogenMol, s9.chargeC / (2 * 96485.33), 1e-15, 'Faraday');
    });

    it('the double layer keeps a polarisation voltage after the battery is taken away', () => {
        const b = new BoardImpl(9);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('V', 'vsource', { volts: 9 }, ['pos', 'neg']), P('S', 'switch', {}, ['a', 'b']),
            P('T', 'electrolysis_cell', {}, ['a', 'b']), P('M', 'resistor', { ohms: 10e6 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['V', 'neg'], ['T', 'b'], ['M', 'b']), net('v', ['V', 'pos'], ['S', 'a']), net('o', ['S', 'b'], ['T', 'a'], ['M', 'a'])]);
        b.setPower(true);
        b.setControl('S', 1);
        b.advanceTo(100_000_000n);
        b.setControl('S', 0);
        b.advanceTo(101_000_000n);
        const v = b.nodeVoltages.get('o');
        assert.ok(v > 1.5 && v < 2.2, `polarisation left on the electrodes: ${v} V`);
        b.advanceTo(1_000_000_000n);
        assert.ok(b.nodeVoltages.get('o') < v, 'and it decays through the electrolysis branch');
    });
});
