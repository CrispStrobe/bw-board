// MSGEQ7 golden: the canonical driver loop — reset pulse, then seven
// strobe cycles reading OUT — recovers the seven band levels in order.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerMsgeq7 } from '../src/devices/msgeq7.js';

registerMsgeq7();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

describe('MSGEQ7', () => {
    it('reset + seven strobes read the bands in order; the cycle wraps', () => {
        const board = new BoardImpl(5.0);
        const bands = [1, 0.5, 0.25, 0, 0.8, 0.1, 0.6];
        board.setNetlist([
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'U1', kind: 'msgeq7', params: { bands }, terminals: ['vcc', 'gnd', 'strobe', 'reset', 'out'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('ns', ['MCU', 'P1.0'], ['U1', 'strobe']),
            net('nr', ['MCU', 'P1.1'], ['U1', 'reset']),
            net('no', ['MCU', 'P1.2'], ['U1', 'out']),
        ]);
        let t = 0n;
        const tick = () => { t += 30_000n; board.advanceTo(t); };
        const pin = (p, h) => { board.setPin(p, 'pushpull', h); tick(); };
        board.setPin('P1.2', 'input', false);

        // The canonical driver: reset pulse, then strobe-low/read/strobe-high ×7.
        pin('P1.0', true);
        pin('P1.1', true); pin('P1.1', false);       // reset pulse
        const readBands = () => {
            const out = [];
            for (let i = 0; i < 7; i++) {
                pin('P1.0', false);                   // falling edge presents band
                out.push(board.readAnalog('P1.2') / (5.0 - 0.8));
                pin('P1.0', true);
            }
            return out;
        };
        const got = readBands();
        for (let i = 0; i < 7; i++) {
            assert.ok(Math.abs(got[i] - bands[i]) < 0.02,
                `band ${i}: expected ${bands[i]}, got ${got[i].toFixed(3)}`);
        }
        // Without a reset the multiplexor wraps back to band 1.
        const second = readBands();
        assert.ok(Math.abs(second[0] - bands[0]) < 0.02, 'cycle wrapped to band 1');
    });

    it('spectrum_display maps levels to lit rows per column', () => {
        const board = new BoardImpl(5.0);
        const parts = [
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'D', kind: 'spectrum_display', params: { levels: [1, 0.5, 0] }, terminals: ['vcc', 'gnd'] },
        ];
        board.setNetlist(parts, [
            net('nv', ['VCC', 'vcc'], ['D', 'vcc']),
            net('ng', ['GND', 'gnd'], ['D', 'gnd']),
        ]);
        board.advanceTo(1n);
        const s = board.getDeviceState('D');
        assert.equal(s.rows, 11, 'the 132-LED kit shape by default');
        assert.equal(s.columns[0], 11);
        assert.equal(s.columns[1], 6);
        assert.equal(s.columns[2], 0);
    });
});
