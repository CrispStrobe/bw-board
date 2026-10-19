// The regulator family variants: setpoints regulate, dropout bites.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerNamedParts } from '../src/devices/named-parts.js';

registerNamedParts();

function rail(kind, volts) {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VS', kind: 'vsource', params: { volts }, terminals: ['pos', 'neg'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'REG', kind, params: {}, terminals: ['in', 'out', 'gnd'] },
        { id: 'RL', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
    ], [
        { id: 'nin', terminals: [{ part: 'VS', terminal: 'pos' }, { part: 'REG', terminal: 'in' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'VS', terminal: 'neg' }, { part: 'REG', terminal: 'gnd' }, { part: 'RL', terminal: 'b' }] },
        { id: 'nout', terminals: [{ part: 'REG', terminal: 'out' }, { part: 'RL', terminal: 'a' }, { part: 'MCU', terminal: 'P1.0' }] },
    ]);
    board.setPin('P1.0', 'input', false);
    board.advanceTo(1n);
    return board.readAnalog('P1.0');
}

describe('regulator variants', () => {
    it('regulate at their setpoints with headroom', () => {
        assert.ok(Math.abs(rail('lm7809', 12) - 9.0) < 0.1, 'LM7809 → 9 V from 12');
        assert.ok(Math.abs(rail('lm7812', 15) - 12.0) < 0.1, 'LM7812 → 12 V from 15');
        assert.ok(Math.abs(rail('ams1117_50', 7) - 5.0) < 0.1, 'AMS1117-5.0 → 5 V from 7');
        assert.ok(Math.abs(rail('ams1117_33', 5) - 3.3) < 0.1, 'AMS1117-3.3 → 3.3 V from 5');
    });

    it('dropout bites when headroom is gone', () => {
        const v = rail('lm7809', 9.5);        // 9.5 - 2.0 = 7.5 < 9
        assert.ok(Math.abs(v - 7.5) < 0.1, `LM7809 starved → ~7.5 V, got ${v.toFixed(2)}`);
        const v2 = rail('ams1117_50', 5);     // 5 - 1.1 = 3.9 < 5
        assert.ok(Math.abs(v2 - 3.9) < 0.1, `AMS1117-5 from 5 V in → ~3.9 V — the classic
            "why is my 5 V rail at 3.9" breadboard moment, got ${v2.toFixed(2)}`);
    });
});
