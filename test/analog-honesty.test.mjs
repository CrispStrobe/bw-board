// E3.6 — behavioral honesty upgrades, each with a hand oracle.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAnalogICs } from '../src/devices/analog-ics.js';
import { unregisterDevice } from '../src/devices.js';

describe('E3.6 honesty upgrades', () => {
    beforeEach(() => registerAnalogICs());
    afterEach(() => {
        for (const k of ['lm358', 'lm393', 'lm339', 'tmp36', 'light_bulb', 'optocoupler', 'timer_556']) {
            try { unregisterDevice(k); } catch {}
        }
    });

    it('lm393 hysteresis holds inside the band; default 0 flips at the crossing', () => {
        const bench = (params) => {
            const parts = [
                { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
                { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
                { id: 'U1', kind: 'lm393', params, terminals: ['1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out', 'vcc', 'gnd'] },
                { id: 'VREF', kind: 'vsource', params: { volts: 2.5 }, terminals: ['pos', 'neg'] },
                { id: 'VIN', kind: 'vsource', params: { volts: 0 }, terminals: ['pos', 'neg'] },
                { id: 'RP', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            ];
            const nets = [
                { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }, { part: 'RP', terminal: 'a' }] },
                { id: 'n_ref', terminals: [{ part: 'VREF', terminal: 'pos' }, { part: 'U1', terminal: '1_neg' }] },
                { id: 'n_in', terminals: [{ part: 'VIN', terminal: 'pos' }, { part: 'U1', terminal: '1_pos' }] },
                { id: 'n_out', terminals: [{ part: 'U1', terminal: '1_out' }, { part: 'RP', terminal: 'b' }] },
                { id: 'n_gnd', terminals: [
                    { part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' },
                    { part: 'VREF', terminal: 'neg' }, { part: 'VIN', terminal: 'neg' }] },
            ];
            const b = new BoardImpl(5.0);
            b.setNetlist(parts, nets);
            return b;
        };
        // Hysteresis 0.4 V: start high (vin 3 > ref) → out floats high;
        // dip to 2.4 (inside the ±0.2 band) → STILL high; 2.2 → low.
        const b = bench({ hysteresis: 0.4 });
        b.setControl('VIN', 3.0);
        assert.ok(b.nodeVoltage('n_out') > 4.0, 'above: open-collector floats high');
        b.setControl('VIN', 2.4);
        assert.ok(b.nodeVoltage('n_out') > 4.0, 'inside the band: holds');
        b.setControl('VIN', 2.2);
        assert.ok(b.nodeVoltage('n_out') < 1.0, 'below the band: sinks');
        b.setControl('VIN', 2.6);
        assert.ok(b.nodeVoltage('n_out') < 1.0, 'inside from below: still holds low');
        // Default (no param): flips right at the crossing.
        const b0 = bench({});
        b0.setControl('VIN', 2.4);
        assert.ok(b0.nodeVoltage('n_out') < 1.0, 'no hysteresis: 2.4 < 2.5 sinks');
        b0.setControl('VIN', 2.6);
        assert.ok(b0.nodeVoltage('n_out') > 4.0, 'no hysteresis: 2.6 > 2.5 floats');
    });

    it('optocoupler: the LED side clamps near vf, and CTR scales the sink', () => {
        const bench = (ctr) => {
            const parts = [
                { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
                { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
                { id: 'RL', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
                { id: 'U1', kind: 'optocoupler', params: { ctr }, terminals: ['anode', 'cathode', 'collector', 'emitter'] },
                { id: 'RC', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            ];
            const nets = [
                { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RL', terminal: 'a' }, { part: 'RC', terminal: 'a' }] },
                { id: 'n_led', terminals: [{ part: 'RL', terminal: 'b' }, { part: 'U1', terminal: 'anode' }] },
                { id: 'n_col', terminals: [{ part: 'RC', terminal: 'b' }, { part: 'U1', terminal: 'collector' }] },
                { id: 'n_gnd', terminals: [
                    { part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'cathode' },
                    { part: 'U1', terminal: 'emitter' }] },
            ];
            const b = new BoardImpl(5.0);
            b.setNetlist(parts, nets);
            return b;
        };
        const b1 = bench(1.0);
        const vLed = b1.nodeVoltage('n_led');
        // Junction: vLed = vf + i·rd with i = (5 − vLed)/330 → vLed = 1.7 V.
        assert.ok(Math.abs(vLed - 1.7) < 0.05,
            `the LED side clamps at vf + i·rd ≈ 1.7 V: got ${vLed.toFixed(3)}`);
        const vc1 = b1.nodeVoltage('n_col');
        const vc05 = bench(0.5).nodeVoltage('n_col');
        assert.ok(vc1 < 0.15, `ctr 1: hard sink, collector near ground: ${vc1.toFixed(3)}`);
        assert.ok(vc05 > vc1 * 1.7 && vc05 < 0.4,
            `ctr 0.5 sinks HALF as hard — the output scales: ${vc05.toFixed(3)} vs ${vc1.toFixed(3)}`);
    });

    it('filament bulb: switch-on inrush is ~10× the warm current, then decays', () => {
        const parts = [
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'RS', kind: 'resistor', params: { ohms: 1 }, terminals: ['a', 'b'] },
            { id: 'L1', kind: 'light_bulb', params: { ohms: 500, vRated: 5, filament: true }, terminals: ['a', 'b'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RS', terminal: 'a' }] },
            { id: 'n_m', terminals: [{ part: 'RS', terminal: 'b' }, { part: 'L1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'L1', terminal: 'b' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        // Inrush: cold filament is ohms/10 = 50 Ω → ~98 mA (98 mV across RS).
        b.advanceTo(1000n); // 1 µs: no meaningful warming yet
        const vCold = 5 - b.nodeVoltage('n_m');
        assert.ok(vCold > 0.07 && vCold < 0.12,
            `cold inrush ~98 mV across the 1 Ω sense: got ${(vCold * 1000).toFixed(1)} mV`);
        // After many thermal time constants the filament sits at rHot.
        for (let ms = 10; ms <= 400; ms += 10) b.advanceTo(BigInt(ms) * 1_000_000n);
        const vHot = 5 - b.nodeVoltage('n_m');
        assert.ok(vHot < 0.015,
            `warm current ~10 mA (10 mV): got ${(vHot * 1000).toFixed(1)} mV`);
        assert.ok(vCold / vHot > 6, `inrush ratio: ${(vCold / vHot).toFixed(1)}×`);
    });

    it('a plain bulb (no filament param) stays the fixed resistor it always was', () => {
        const parts = [
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'L1', kind: 'light_bulb', params: { ohms: 500 }, terminals: ['a', 'b'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'L1', terminal: 'a' }] },
            { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'L1', terminal: 'b' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        b.advanceTo(100_000_000n);
        assert.ok(Math.abs(b.nodeVoltage('n_vcc') - 5) < 1e-6, 'nothing sags, nothing warms');
    });
});
