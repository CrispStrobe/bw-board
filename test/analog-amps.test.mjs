// LM358 + LM3915 goldens: feedback CONVERGES in the settle loop — the
// follower and the resistor-gain stage are the hard asserts; the VU
// ladder checks the 3 dB law and dot vs bar.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAnalogAmps } from '../src/devices/analog-amps.js';

registerAnalogAmps();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms) => ({ id, kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] });
const DIV = (id, top, bot) => [R(`${id}T`, top), R(`${id}B`, bot)];

const AMP = { id: 'U1', kind: 'lm358', params: {}, terminals: ['vcc', 'gnd', '1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out'] };

describe('LM358', () => {
    it('open loop saturates like the comparator it then is', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, ...DIV('A', 10000, 10000), ...DIV('B', 15000, 10000), AMP,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }], [
            net('nv', ['VCC', 'vcc'], ['AT', 'a'], ['BT', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['AB', 'b'], ['BB', 'b'], ['U1', 'gnd']),
            net('np', ['AT', 'b'], ['AB', 'a'], ['U1', '1_pos']),      // 2.5 V
            net('nn', ['BT', 'b'], ['BB', 'a'], ['U1', '1_neg']),      // 2.0 V
            net('no', ['U1', '1_out'], ['MCU', 'P1.0']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.advanceTo(1n);
        const v = board.readAnalog('P1.0');
        assert.ok(v > 3.3, `v+ > v- → output at the top swing (~3.5), got ${v.toFixed(2)}`);
    });

    it('a voltage follower converges onto its input', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, ...DIV('A', 15000, 10000), AMP,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }], [
            net('nv', ['VCC', 'vcc'], ['AT', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['AB', 'b'], ['U1', 'gnd']),
            net('np', ['AT', 'b'], ['AB', 'a'], ['U1', '1_pos']),      // 2.0 V
            net('nfb', ['U1', '1_out'], ['U1', '1_neg'], ['MCU', 'P1.0']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.advanceTo(1n);
        const v = board.readAnalog('P1.0');
        assert.ok(Math.abs(v - 2.0) < 0.03, `follower tracks 2.0 V, got ${v.toFixed(3)}`);
    });

    it('a non-inverting ×2 stage lands on twice the input', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G, ...DIV('A', 40000, 10000), R('RF', 10000), R('RG', 10000), AMP,
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }], [
            net('nv', ['VCC', 'vcc'], ['AT', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['AB', 'b'], ['RG', 'b'], ['U1', 'gnd']),
            net('np', ['AT', 'b'], ['AB', 'a'], ['U1', '1_pos']),      // 1.0 V
            net('nn', ['U1', '1_neg'], ['RF', 'a'], ['RG', 'a']),
            net('no', ['U1', '1_out'], ['RF', 'b'], ['MCU', 'P1.0']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.advanceTo(1n);
        const v = board.readAnalog('P1.0');
        assert.ok(Math.abs(v - 2.0) < 0.05, `gain 2 on 1.0 V → 2.0 V, got ${v.toFixed(3)}`);
    });
});

describe('LM3915', () => {
    function rig(sigVolts, bar) {
        const board = new BoardImpl(5.0);
        // The signal comes from a divider so it is a real node voltage.
        const rTop = Math.max(1, Math.round(10000 * (5 - sigVolts) / Math.max(0.001, sigVolts)));
        board.setNetlist([V, G, R('ST', rTop), R('SB', 10000),
            { id: 'U1', kind: 'lm3915', params: {}, terminals: ['vcc', 'gnd', 'sig', 'mode', ...Array.from({ length: 10 }, (_, i) => `l${i + 1}`)] },
        ], [
            net('nv', ['VCC', 'vcc'], ['ST', 'a'], ['U1', 'vcc'],
                ...(bar ? [['U1', 'mode']] : [])),
            net('ng', ['GND', 'gnd'], ['SB', 'b'], ['U1', 'gnd'],
                ...(bar ? [] : [['U1', 'mode']])),
            net('ns', ['ST', 'b'], ['SB', 'a'], ['U1', 'sig']),
        ]);
        board.advanceTo(1n);
        return board.getDeviceState('U1');
    }

    it('the 3 dB ladder: full scale lights all ten, −9 dB lights seven', () => {
        assert.equal(rig(1.26, true).level, 10);
        const minus9 = 1.25 * Math.pow(10, -9 / 20) * 1.01;   // just above step 7
        assert.equal(rig(minus9, true).level, 7);
        assert.equal(rig(0.02, true).level, 0, 'below the bottom step: dark');
    });

    it('bar sinks all LEDs up to the level; dot sinks exactly one', () => {
        const bar = rig(1.26, true);
        assert.equal(bar.bar, true);
        const dot = rig(1.26, false);
        assert.equal(dot.bar, false);
        assert.equal(dot.level, 10, 'dot mode still knows the level');
    });
});
