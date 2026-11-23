// Voltage compliance of the light-driven parts (gap 4) and the optocoupler's
// output side (builder 3). Each of these was an ideal current source (or an
// event-driven conductance): a big resistor drove a node far outside the
// supply, a phototransistor never saturated, and an optocoupler feeding a
// diode-pump detector failed at the integrator's minimum step after its LED
// switched off.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/index.js';

registerAllDevices();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const V = (id, volts, extra = {}) => ({ id, kind: 'vsource', params: { volts, ...extra }, terminals: ['pos', 'neg'] });
const G = { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] };

const solve = (parts, nets, atNs = 1_000_000n) => {
    const board = new BoardImpl(5.0);
    board.setNetlist(parts, nets);
    board.advanceTo(atNs);
    return board;
};

describe('phototransistor compliance', () => {
    const PT = { id: 'Q', kind: 'phototransistor', params: { light: 1 }, terminals: ['collector', 'emitter'] };

    it('saturates against a 1 MΩ pull-up instead of driving the collector to −4995 V', () => {
        const b = solve([V('VS', 5), G, R('RC', 1e6), PT], [
            net('nv', ['VS', 'pos'], ['RC', 'a']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['Q', 'emitter']),
            net('nc', ['RC', 'b'], ['Q', 'collector']),
        ]);
        const vc = b.nodeVoltage('nc');
        assert.ok(vc >= 0 && vc < 0.3, `VCE(sat), got ${vc}`);
        // Current is then set by the resistor: (5 − VCE)/1 MΩ ≈ 5 µA.
        assert.ok(Math.abs(b.branchCurrent('Q', 'collector') + (5 - vc) / 1e6) < 1e-8);
    });

    it('as an emitter follower it cannot lift the emitter above the supply', () => {
        const b = solve([V('VS', 5), G, R('RE', 1e6), PT], [
            net('nv', ['VS', 'pos'], ['Q', 'collector']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['RE', 'b']),
            net('ne', ['Q', 'emitter'], ['RE', 'a']),
        ]);
        const ve = b.nodeVoltage('ne');
        assert.ok(ve > 4.6 && ve <= 5, `emitter just below the rail, got ${ve}`);
    });

    it('in its active region it is still a light-proportional current (5 mA × light)', () => {
        const part = { ...PT, params: { light: 0.4 } };
        const b = solve([V('VS', 5), G, R('RC', 100), part], [
            net('nv', ['VS', 'pos'], ['RC', 'a']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['Q', 'emitter']),
            net('nc', ['RC', 'b'], ['Q', 'collector']),
        ]);
        // 2 mA through 100 Ω: VCE = 4.8 V, far from saturation.
        assert.ok(Math.abs(b.nodeVoltage('nc') - 4.8) < 1e-3, `got ${b.nodeVoltage('nc')}`);
    });
});

describe('photodiode compliance', () => {
    const PD = { id: 'D', kind: 'photodiode', params: { light: 1 }, terminals: ['anode', 'cathode'] };

    it('a 10 MΩ load lifts the anode only to the junction\'s open-circuit voltage above the cathode', () => {
        // Cathode at 5 V, anode to ground through 10 MΩ: the 1 mA photocurrent
        // would need 10 kV. The junction forward-biases instead and the anode
        // sits at 5 V + ~nVt·ln(iL/Is) ≈ 5.42 V.
        const b = solve([V('VS', 5), G, R('RL', 1e7), PD], [
            net('nv', ['VS', 'pos'], ['D', 'cathode']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['RL', 'b']),
            net('na', ['D', 'anode'], ['RL', 'a']),
        ]);
        const va = b.nodeVoltage('na');
        assert.ok(va > 5.3 && va < 5.6, `anode at 5 V + Voc, got ${va}`);
    });

    it('reverse-biased with a modest load it is the photocurrent source it always was', () => {
        const b = solve([V('VS', 5), G, R('RL', 1000), PD], [
            net('nv', ['VS', 'pos'], ['D', 'cathode']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['RL', 'b']),
            net('na', ['D', 'anode'], ['RL', 'a']),
        ]);
        // 1 mA × 1 kΩ = 1 V at the anode, junction 4 V reverse-biased.
        assert.ok(Math.abs(b.nodeVoltage('na') - 1.0) < 1e-6, `got ${b.nodeVoltage('na')}`);
    });
});

describe('optocoupler output side', () => {
    const OC = { id: 'U', kind: 'optocoupler', params: {}, terminals: ['anode', 'cathode', 'collector', 'emitter'] };

    it('saturates against a large pull-up when the LED is on, and is open when off', () => {
        const bench = (vLed) => solve([V('VS', 5), V('VL', vLed), G, R('RL', 330), R('RC', 1e6), OC], [
            net('nv', ['VS', 'pos'], ['RC', 'a']),
            net('nl', ['VL', 'pos'], ['RL', 'a']),
            net('na', ['RL', 'b'], ['U', 'anode']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VL', 'neg'], ['U', 'cathode'], ['U', 'emitter']),
            net('nc', ['RC', 'b'], ['U', 'collector']),
        ]);
        const on = bench(5).nodeVoltage('nc');
        assert.ok(on >= 0 && on < 0.3, `on: VCE(sat), got ${on}`);
        const off = bench(0).nodeVoltage('nc');
        assert.ok(off > 4.99, `off: pulled up, got ${off}`);
    });

    it('a diode-pump detector and NPN stage keep solving after the LED switches off', () => {
        // LED driven by a 50 Hz square for 40 ms then held off by the square's
        // low half; collector pulled up by 10 k, pumped through a diode into
        // 10 µF, which drives an NPN base through 10 k.
        const b = new BoardImpl(5.0);
        b.setNetlist([V('VS', 5), G,
            V('VL', 0, { wave: 'square', freq: 50, amplitude: 2.5, offset: 2.5 }),
            R('RL', 330), R('RC', 10000), R('RB', 10000), R('RK', 1000), R('RD', 100000), OC,
            { id: 'D1', kind: 'diode', params: {}, terminals: ['anode', 'cathode'] },
            { id: 'C1', kind: 'capacitor', params: { farads: 10e-6 }, terminals: ['a', 'b'] },
            { id: 'Q1', kind: 'npn', params: {}, terminals: ['collector', 'base', 'emitter'] }], [
            net('nv', ['VS', 'pos'], ['RC', 'a'], ['RK', 'a']),
            net('nl', ['VL', 'pos'], ['RL', 'a']),
            net('na', ['RL', 'b'], ['U', 'anode']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['VL', 'neg'], ['U', 'cathode'], ['U', 'emitter'],
                ['C1', 'b'], ['Q1', 'emitter'], ['RD', 'b']),
            net('nc', ['RC', 'b'], ['U', 'collector'], ['D1', 'anode']),
            net('np', ['D1', 'cathode'], ['C1', 'a'], ['RB', 'a'], ['RD', 'a']),
            net('nb', ['RB', 'b'], ['Q1', 'base']),
            net('nk', ['RK', 'b'], ['Q1', 'collector']),
        ]);
        for (let ms = 1n; ms <= 120n; ms++) {
            b.advanceTo(ms * 1_000_000n);
            assert.equal(b._transientAccuracyUnmet, null, `solve failed at ${ms} ms`);
            const vc = b.nodeVoltage('nc');
            assert.ok(vc > -0.01 && vc < 5.01, `collector inside the rails at ${ms} ms: ${vc}`);
        }
    });
});
