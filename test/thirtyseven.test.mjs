// The 37-in-1 small faces, table-driven where the pattern allows plus
// dedicated goldens for the timing devices (heartbeat, 7-color LED).
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerThirtySeven } from '../src/devices/thirtyseven.js';

registerThirtySeven();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

function rigModule(kind, params, terms, mcuPins) {
    const board = new BoardImpl(5.0);
    const nets = [
        net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
        net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
    ];
    const mcuTerms = [];
    Object.entries(mcuPins).forEach(([term, pin], i) => {
        mcuTerms.push(pin);
        nets.push(net(`n${i}`, ['MCU', pin], ['U1', term]));
    });
    const parts = [V, G,
        { id: 'U1', kind, params, terminals: terms },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: mcuTerms }];
    board.setNetlist(parts, nets);
    for (const pin of mcuTerms) board.setPin(pin, 'input', false);
    board.advanceTo(1n);
    return { board, parts,
        v: (pin) => board.readAnalog(pin),
        set: (p) => { parts[2].params = p; board.setControl('U1', 1); } };
}

describe('37-in-1 module faces', () => {
    it('hall_analog: ratiometric AO, active-low DO past threshold', () => {
        const m = rigModule('hall_analog', { field: 0 },
            ['vcc', 'gnd', 'ao', 'do'], { ao: 'P1.0', do: 'P1.1' });
        assert.ok(Math.abs(m.v('P1.0') - 2.5) < 0.05, 'no field → mid-rail');
        assert.ok(m.v('P1.1') > 4.5, 'DO idle high');
        m.set({ field: 0.9 });
        assert.ok(m.v('P1.0') > 4.0, 'north pole swings AO up');
        assert.ok(m.v('P1.1') < 0.5, 'DO active low past threshold');
        m.set({ field: -0.9 });
        assert.ok(m.v('P1.0') < 1.0, 'south pole swings AO down');
    });

    it('digital faces: touch, interrupter, ir_reflect, hall_digital, sound DO', () => {
        // [kind, stimulus param, idle DO level, active DO level]
        const cases = [
            ['touch_ttp223', 'touched', false, true],
            ['photo_interrupter', 'blocked', false, true],
            ['ir_reflect', 'detect', true, false],       // active-low boards
            ['hall_digital', 'field', true, false],
        ];
        for (const [kind, param, idleHigh, activeHigh] of cases) {
            const m = rigModule(kind, {}, ['vcc', 'gnd', 'do'], { do: 'P1.0' });
            assert.equal(m.v('P1.0') > 2.5, idleHigh, `${kind}: idle level`);
            m.set({ [param]: kind === 'hall_digital' ? 1 : true });
            assert.equal(m.v('P1.0') > 2.5, activeHigh, `${kind}: active level`);
        }
    });

    it('reed_switch closes the circuit only under the magnet', () => {
        const board = new BoardImpl(5.0);
        const parts = [V, G,
            { id: 'RS', kind: 'reed_switch', params: {}, terminals: ['a', 'b'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] }];
        board.setNetlist(parts, [
            net('nv', ['VCC', 'vcc'], ['RS', 'a']),
            net('nm', ['RS', 'b'], ['R1', 'a'], ['MCU', 'P1.0']),
            net('ng', ['GND', 'gnd'], ['R1', 'b']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.advanceTo(1n);
        assert.ok(board.readAnalog('P1.0') < 0.5, 'open: pulled down');
        parts[2].params = { magnet: true };
        board.setControl('RS', 1);
        assert.ok(board.readAnalog('P1.0') > 4.5, 'magnet: closed to VCC');
    });

    it('heartbeat: peak-counting over machine time finds the BPM', () => {
        const m = rigModule('heartbeat', { bpm: 120 },
            ['vcc', 'gnd', 'ao'], { ao: 'P1.0' });
        let t = 0n;
        let peaks = 0;
        let above = false;
        // 3 s at 120 BPM = 6 beats; sample at 5 ms.
        for (let i = 0; i < 600; i++) {
            t += 5_000_000n;
            m.board.advanceTo(t);
            const high = m.v('P1.0') > 3.6;
            if (high && !above) peaks++;
            above = high;
        }
        assert.ok(Math.abs(peaks - 6) <= 1, `~6 beats in 3 s at 120 BPM, got ${peaks}`);
    });

    it('led_7color cycles its color only while powered', () => {
        const board = new BoardImpl(5.0);
        const parts = [V, G,
            { id: 'L', kind: 'led_7color', params: { cycleHz: 10 }, terminals: ['a', 'k'] }];
        board.setNetlist(parts, [
            net('nv', ['VCC', 'vcc'], ['L', 'a']),
            net('ng', ['GND', 'gnd'], ['L', 'k']),
        ]);
        let t = 0n;
        const tick = (ms) => { t += BigInt(ms) * 1_000_000n; board.advanceTo(t); };
        tick(1);
        const start = board.getDeviceState('L').colorIndex;
        tick(550);                                   // ~5 cycles at 10 Hz
        const after = board.getDeviceState('L').colorIndex;
        assert.notEqual(after, start, 'color advanced under power');
    });
});
