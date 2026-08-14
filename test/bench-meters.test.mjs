// Bench instruments as parts, held to bench truth: the voltmeter LOADS
// high-impedance circuits, the ammeter's burden exists, the probe tells
// levels from pulses using machine time.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerBenchMeters } from '../src/devices/bench-meters.js';

registerBenchMeters();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });

describe('voltmeter', () => {
    const rig = (rTop, rBot) => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, R('R1', rTop), R('R2', rBot),
            { id: 'M', kind: 'voltmeter', params: {}, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['R1', 'a']),
            net('nm', ['R1', 'b'], ['R2', 'a'], ['M', 'a']),
            net('ng', ['GND', 'gnd'], ['R2', 'b'], ['M', 'b']),
        ]);
        board.advanceTo(1n);
        return board.getDeviceState('M').reading;
    };

    it('reads a stiff divider exactly', () => {
        const v = rig(10_000, 10_000);
        assert.ok(Math.abs(v - 2.5) < 0.01, `10k/10k → 2.5 V, got ${v.toFixed(3)}`);
    });

    it('LOADS a megohm divider — the bench lesson', () => {
        const v = rig(1e6, 1e6);
        // 10 MΩ in parallel with the lower 1 MΩ: 0.909 MΩ → 5×0.909/1.909.
        assert.ok(Math.abs(v - 2.38) < 0.02,
            `1M/1M divider dips below 2.5 under the meter's 10M load, got ${v.toFixed(3)}`);
    });
});

describe('ammeter', () => {
    it('measures series current, burden included', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, R('RL', 1000),
            { id: 'M', kind: 'ammeter', params: {}, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['M', 'a']),
            net('nm', ['M', 'b'], ['RL', 'a']),
            net('ng', ['GND', 'gnd'], ['RL', 'b']),
        ]);
        board.advanceTo(1n);
        const i = board.getDeviceState('M').reading;
        // 5 V / (1000 + 0.1) — the shunt's burden is in the arithmetic.
        assert.ok(Math.abs(i - 5 / 1000.1) < 1e-5, `~5 mA, got ${(i * 1000).toFixed(4)} mA`);
    });
});

describe('logic probe', () => {
    const rig = () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'P', kind: 'logic_probe', params: {}, terminals: ['vcc', 'gnd', 'tip'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['P', 'vcc']),
            net('ng', ['GND', 'gnd'], ['P', 'gnd']),
            net('nt', ['MCU', 'P1.0'], ['P', 'tip']),
        ]);
        let t = 0n;
        const tick = (ms) => { t += BigInt(ms) * 1_000_000n; board.advanceTo(t); };
        return { board, tick };
    };

    it('classifies high, low, and the forbidden zone', () => {
        const p = rig();
        p.board.setPin('P1.0', 'pushpull', true); p.tick(1);
        assert.equal(p.board.getDeviceState('P').level, 'high');
        p.board.setPin('P1.0', 'pushpull', false); p.tick(1);
        assert.equal(p.board.getDeviceState('P').level, 'low');
        p.board.setPin('P1.0', 'input', false); p.tick(1);
        assert.equal(p.board.getDeviceState('P').level, 'float',
            'a released pin sits at the probe\'s mid-rail bias — the forbidden zone');
    });

    it('a toggling pin reads PULSE; a held pin does not', () => {
        const p = rig();
        for (let i = 0; i < 6; i++) {
            p.board.setPin('P1.0', 'pushpull', i % 2 === 0); p.tick(5);
        }
        assert.equal(p.board.getDeviceState('P').pulsing, true, 'six edges in 30 ms');
        p.board.setPin('P1.0', 'pushpull', true);
        p.tick(200);                       // quiet for two windows
        assert.equal(p.board.getDeviceState('P').pulsing, false, 'stale edges age out');
        assert.equal(p.board.getDeviceState('P').level, 'high');
    });
});
