// Face contract goldens: validation catches malformed descriptors, the
// sim resolver reads pins/devices/nets with the kind vocabulary, diff()
// reports only changes — and the YL-39 face resolves against a live
// board with the active-low LED convention doing its job.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { createFaceResolver, validateFace, YL39_FACE } from '../src/face.js';
import { registerMsgeq7 } from '../src/devices/msgeq7.js';

registerMsgeq7();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

describe('validateFace', () => {
    it('names every problem', () => {
        const p = validateFace({
            id: 'x',
            elements: [
                { id: 'a', kind: 'led', bind: { source: 'pin', ref: 'P1.0' } },
                { id: 'a', kind: 'led', bind: { source: 'nope', ref: 'y' } },
                { id: 'b', kind: 'lcd', bind: { source: 'device', ref: 'U1' } },
                { kind: 'led' },
            ],
        });
        assert.ok(p.some((s) => s.includes('duplicate element id a')));
        assert.ok(p.some((s) => s.includes('unknown bind source')));
        assert.ok(p.some((s) => s.includes('device binds need a field')));
        assert.ok(p.some((s) => s.includes('element without id')));
        assert.deepEqual(validateFace(YL39_FACE), [], 'the shipped face is valid');
    });
});

describe('sim resolver', () => {
    it('pins, devices, nets and diff()', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'D', kind: 'spectrum_display', params: { cols: 2, levels: [1, 0] }, terminals: ['vcc', 'gnd'] },
            { id: 'RA', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'RB', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.7'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['D', 'vcc'], ['RA', 'a']),
            net('ng', ['GND', 'gnd'], ['D', 'gnd'], ['RB', 'b']),
            net('nm', ['RA', 'b'], ['RB', 'a'], ['MCU', 'P1.7']),
        ]);
        board.setPin('P1.7', 'input', false);
        board.advanceTo(1n);

        const face = createFaceResolver(board, {
            id: 't',
            elements: [
                { id: 'led1', kind: 'led', bind: { source: 'pin', ref: 'P1.0', activeLow: true } },
                { id: 'cols', kind: 'matrix', bind: { source: 'device', ref: 'D', field: 'columns' } },
                { id: 'mid', kind: 'level', bind: { source: 'net', ref: 'P1.7' } },
            ],
        });

        board.setPin('P1.0', 'pushpull', false);        // active low: lit
        board.advanceTo(2n);
        let snap = face.snapshot();
        assert.equal(snap.led1, 1, 'low pin + activeLow = LED on');
        assert.deepEqual(snap.cols, [11, 0]);
        assert.ok(Math.abs(snap.mid - 2.5) < 0.05, 'divider voltage');

        board.setPin('P1.0', 'pushpull', true);
        board.advanceTo(3n);
        const d1 = face.diff();
        assert.deepEqual(Object.keys(d1).sort(), ['cols', 'led1', 'mid'], 'first diff carries all');
        const d2 = face.diff();
        assert.deepEqual(d2, {}, 'nothing changed since');
        board.setPin('P1.0', 'pushpull', false);
        board.advanceTo(4n);
        const d3 = face.diff();
        assert.deepEqual(Object.keys(d3), ['led1'], 'only the LED changed');
        assert.equal(d3.led1, 1);
    });

    it('a malformed descriptor refuses loudly', () => {
        const board = new BoardImpl(5.0);
        assert.throws(() => createFaceResolver(board, { id: 'bad', elements: [{ id: 'x', kind: 'led', bind: { source: 'pin' } }] }),
            /missing bind/);
    });
});
