// LED forward voltage follows colour when `vf` is absent (gap 6), and the
// `ir_transmitter` is an IR LED, not a 110 Ω resistor (gap 5).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/index.js';
import { ledVf, LED_COLOR_VF } from '../src/led-color.js';

registerAllDevices();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

/** 5 V → R → junction → GND; returns the junction voltage and current. */
function drop(junction, ohms) {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
        { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'R', kind: 'resistor', params: { ohms }, terminals: ['a', 'b'] },
        { id: 'D', terminals: ['anode', 'cathode'], ...junction },
    ], [
        net('nv', ['VS', 'pos'], ['R', 'a']),
        net('na', ['R', 'b'], ['D', 'anode']),
        net('ng', ['G', 'gnd'], ['VS', 'neg'], ['D', 'cathode']),
    ]);
    board.advanceTo(1_000_000n);
    const v = board.nodeVoltage('na');
    return { v, i: (5 - v) / ohms };
}

describe('LED forward voltage by colour', () => {
    it('ledVf: explicit vf wins, then colour, then the historical 2.0 V', () => {
        assert.equal(ledVf({ params: { vf: 2.4, color: 'blue' } }), 2.4);
        assert.equal(ledVf({ params: { color: 'Blue' } }), LED_COLOR_VF.blue);
        assert.equal(ledVf({ params: { color: 'chartreuse' } }), 2.0);
        assert.equal(ledVf({ params: {} }), 2.0);
    });

    it('red < yellow < green < blue/white at the same drive, each near its datasheet vf', () => {
        // Near 20 mA the LED drops its rated vf (the knee model's anchor).
        const at = (color) => drop({ kind: 'led', params: { color } }, (5 - LED_COLOR_VF[color]) / 0.02).v;
        const red = at('red'), yellow = at('yellow'), green = at('green'), blue = at('blue'), white = at('white');
        assert.ok(Math.abs(red - 1.9) < 0.02, `red ${red}`);
        assert.ok(Math.abs(yellow - 2.1) < 0.02, `yellow ${yellow}`);
        assert.ok(Math.abs(green - 2.2) < 0.02, `green ${green}`);
        assert.ok(Math.abs(blue - 3.1) < 0.02 && Math.abs(white - 3.1) < 0.02, `blue ${blue} white ${white}`);
    });

    it('an explicit vf is untouched by colour', () => {
        const a = drop({ kind: 'led', params: { vf: 2.0, color: 'blue' } }, 150).v;
        const b = drop({ kind: 'led', params: { vf: 2.0 } }, 150).v;
        assert.equal(a, b);
    });

    it('an RGB LED\'s dies carry their colours', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
            { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'RR', kind: 'resistor', params: { ohms: 155 }, terminals: ['a', 'b'] },
            { id: 'RB', kind: 'resistor', params: { ohms: 95 }, terminals: ['a', 'b'] },
            { id: 'L', kind: 'rgb_led', params: {}, terminals: ['r_anode', 'g_anode', 'b_anode', 'cathode'] },
        ], [
            net('nv', ['VS', 'pos'], ['RR', 'a'], ['RB', 'a']),
            net('nr', ['RR', 'b'], ['L', 'r_anode']),
            net('nb', ['RB', 'b'], ['L', 'b_anode']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['L', 'cathode']),
        ]);
        board.advanceTo(1_000_000n);
        assert.ok(Math.abs(board.nodeVoltage('nr') - 1.9) < 0.03, `red die ${board.nodeVoltage('nr')}`);
        assert.ok(Math.abs(board.nodeVoltage('nb') - 3.1) < 0.03, `blue die ${board.nodeVoltage('nb')}`);
    });
});

describe('ir_transmitter is an IR LED', () => {
    const IR = { kind: 'ir_transmitter', params: {} };

    it('drops ~1.3 V at 20 mA, not 2.2 V of resistor', () => {
        const { v, i } = drop(IR, (5 - 1.3) / 0.02);
        assert.ok(Math.abs(v - 1.3) < 0.02 && Math.abs(i - 0.02) < 0.001, `${v} V at ${i * 1000} mA`);
    });

    it('at 50 µA it is still a junction near its knee (was 0.0055 V)', () => {
        const { v } = drop(IR, (5 - 1.1) / 50e-6);
        assert.ok(v > 0.9 && v < 1.3, `IR LED at 50 µA: ${v} V`);
    });

    it('blocks in reverse', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
            { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] },
            { id: 'D', ...IR, terminals: ['anode', 'cathode'] },
        ], [
            net('nv', ['VS', 'pos'], ['R', 'a']),
            net('nk', ['R', 'b'], ['D', 'cathode']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['D', 'anode']),
        ]);
        board.advanceTo(1_000_000n);
        assert.ok(board.nodeVoltage('nk') > 4.99, `reverse: ${board.nodeVoltage('nk')}`);
    });

    it('still reports emission from its device model', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
            { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'R', kind: 'resistor', params: { ohms: 220 }, terminals: ['a', 'b'] },
            { id: 'D', ...IR, terminals: ['anode', 'cathode'] },
        ], [
            net('nv', ['VS', 'pos'], ['R', 'a']),
            net('na', ['R', 'b'], ['D', 'anode']),
            net('ng', ['G', 'gnd'], ['VS', 'neg'], ['D', 'cathode']),
        ]);
        board.advanceTo(1_000_000n);
        assert.equal(board.getDeviceState('D').emitting, true);
        assert.ok(Math.abs(board.branchCurrent('D', 'anode') + (5 - board.nodeVoltage('na')) / 220) < 1e-6);
    });
});
