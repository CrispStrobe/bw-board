// E2.2 — bench temperature. Hand oracles per
// spec-updates/bench-temperature.md.
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAnalogICs } from '../src/devices/analog-ics.js';
import { unregisterDevice } from '../src/devices.js';

describe('bench temperature', () => {
    it('a red LED chain warms up: vf drops 2 mV/°C, current rises the hand amount', () => {
        const parts = [
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
            { id: 'D1', kind: 'led', params: { vf: 2.0 }, terminals: ['anode', 'cathode'] },
        ];
        const nets = [
            { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }] },
            { id: 'n_a', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'D1', terminal: 'anode' }] },
            { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'D1', terminal: 'cathode' }] },
        ];
        const b = new BoardImpl(5.0);
        b.setNetlist(parts, nets);
        const i25 = b.branchCurrent('D1', 'anode');
        b.setTemperature(85);
        const i85 = b.branchCurrent('D1', 'anode');
        // ΔVf = 60 °C · −2 mV/°C = −0.12 V → ΔI ≈ 0.12/330 ≈ 0.36 mA
        // (rd=10 Ω softens it slightly: 0.12/340 ≈ 0.353 mA).
        const dI = (i85 - i25) * 1000;
        assert.ok(dI > 0.30 && dI < 0.40,
            `current rises ~0.35 mA from 25→85 °C: got ${dI.toFixed(3)} mA`);
        // Symmetric: back to 25 restores the original solve exactly.
        b.setTemperature(25);
        assert.ok(Math.abs(b.branchCurrent('D1', 'anode') - i25) < 1e-12);
    });

    describe('TMP36', () => {
        beforeEach(() => registerAnalogICs());
        afterEach(() => {
            for (const k of ['lm358', 'lm393', 'lm339', 'tmp36', 'light_bulb', 'optocoupler', 'timer_556']) {
                try { unregisterDevice(k); } catch {}
            }
        });

        function bench(params) {
            const parts = [
                { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
                { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
                { id: 'U1', kind: 'tmp36', params, terminals: ['vcc', 'out', 'gnd'] },
                { id: 'R1', kind: 'resistor', params: { ohms: 100000 }, terminals: ['a', 'b'] },
            ];
            const nets = [
                { id: 'n_vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
                { id: 'n_out', terminals: [{ part: 'U1', terminal: 'out' }, { part: 'R1', terminal: 'a' }] },
                { id: 'n_gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }, { part: 'R1', terminal: 'b' }] },
            ];
            const b = new BoardImpl(5.0);
            b.setNetlist(parts, nets);
            return b;
        }

        it('reads the bench: 0.750 V at 25, 1.350 V at 85', () => {
            const b = bench({});
            assert.ok(Math.abs(b.nodeVoltage('n_out') - 0.750) < 0.005, 'default bench 25 °C');
            b.setTemperature(85);
            assert.ok(Math.abs(b.nodeVoltage('n_out') - 1.350) < 0.005, 'bench 85 °C');
        });

        it('an explicit params.tempC pins the sensor against the ambient', () => {
            const b = bench({ tempC: 25 });
            b.setTemperature(85);
            assert.ok(Math.abs(b.nodeVoltage('n_out') - 0.750) < 0.005,
                'user-set tempC is never overridden by the bench');
        });
    });
});
