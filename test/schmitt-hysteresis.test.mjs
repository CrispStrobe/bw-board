// Schmitt-trigger inputs hold their level between VT− and VT+ (builder 3).
// An RC relaxation oscillator on one gate is the reproducer: without
// hysteresis it ran at ~60 kHz with a 0.1 V swing where ~1.25 kHz was
// designed. Oracle: T = RC·[ln((VCC−VT−)/(VCC−VT+)) + ln(VT+/VT−)].
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/index.js';

registerAllDevices();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const DIP14 = ['1a', '1b', '1y', '2a', '2b', '2y', 'gnd', '3y', '3a', '3b', '4y', '4a', '4b', 'vcc'];
const HC14 = ['1a', '1y', '2a', '2y', '3a', '3y', 'gnd', '4y', '4a', '5y', '5a', '6y', '6a', 'vcc'];

function oscillator(kind) {
    const nand = kind !== '74hc14';
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VS', kind: 'vsource', params: { volts: 5 }, terminals: ['pos', 'neg'] },
        { id: 'G', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U', kind, params: {}, terminals: nand ? DIP14 : HC14 },
        { id: 'R', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'C', kind: 'capacitor', params: { farads: 100e-9 }, terminals: ['a', 'b'] },
    ], [
        // A NAND with its second input high is an inverter.
        net('nv', ['VS', 'pos'], ['U', 'vcc'], ...(nand ? [['U', '1b']] : [])),
        net('ng', ['G', 'gnd'], ['VS', 'neg'], ['U', 'gnd'], ['C', 'b']),
        net('nin', ['U', '1a'], ['R', 'b'], ['C', 'a']),
        net('nout', ['U', '1y'], ['R', 'a']),
    ]);
    const rises = [];
    let last = null, lo = Infinity, hi = -Infinity;
    for (let us = 5n; us <= 12000n; us += 5n) {
        board.advanceTo(us * 1000n);
        const high = board.nodeVoltage('nout') > 2.5;
        if (last === false && high) rises.push(Number(us));
        last = high;
        if (us > 3000n) {
            const v = board.nodeVoltage('nin');
            lo = Math.min(lo, v); hi = Math.max(hi, v);
        }
    }
    return { period: (rises.at(-1) - rises[1]) / (rises.length - 2) / 1000, lo, hi };
}

const designed = (up, down, vcc = 5) => Math.log((vcc - down) / (vcc - up)) + Math.log(up / down); // ms at RC = 1 ms

describe('Schmitt inputs have hysteresis', () => {
    for (const [kind, up, down] of [['74hc14', 2.75, 1.775], ['74hc132', 2.75, 1.775], ['cd4093', 2.9, 1.9]]) {
        it(`${kind}: an RC oscillator runs at its designed period with a VT−…VT+ swing`, () => {
            const { period, lo, hi } = oscillator(kind);
            const t = designed(up, down);
            assert.ok(Math.abs(period - t) / t < 0.04, `${kind} period ${period.toFixed(4)} ms, designed ${t.toFixed(4)}`);
            assert.ok(Math.abs(lo - down) < 0.06 && Math.abs(hi - up) < 0.06,
                `${kind} capacitor swings ${lo.toFixed(3)} … ${hi.toFixed(3)} V`);
        });
    }
});
