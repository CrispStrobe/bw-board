// CD74HC4067 + level shifter goldens. The shifter test is the 3.3V/5V
// lesson itself: a real LDO makes the LV rail, lows cross the channel,
// highs stay in their own domain.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerLevelMux } from '../src/devices/level-mux.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();
registerLevelMux();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const R = (id, ohms, a = 'a', b = 'b') => ({ id, kind: 'resistor', params: { ohms }, terminals: [a, b] });

describe('CD74HC4067', () => {
    function rigMux() {
        const board = new BoardImpl(5.0);
        const muxTerms = ['vcc', 'gnd', 's0', 's1', 's2', 's3', 'eb', 'z',
            ...Array.from({ length: 16 }, (_, i) => `c${i}`)];
        board.setNetlist([V, G,
            R('RA', 15000), R('RB', 5000),      // 1.25 V onto c3
            R('RC', 15000), R('RD', 10000),     // 2.0 V onto c9
            R('RZ', 100000),                    // weak pulldown defines a floating Z
            { id: 'U1', kind: 'cd74hc4067', params: {}, terminals: muxTerms },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['RA', 'a'], ['RC', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['RB', 'b'], ['RD', 'b'], ['RZ', 'b'], ['U1', 'gnd'], ['U1', 'eb']),
            net('n3', ['RA', 'b'], ['RB', 'a'], ['U1', 'c3']),
            net('n9', ['RC', 'b'], ['RD', 'a'], ['U1', 'c9']),
            net('nz', ['U1', 'z'], ['RZ', 'a'], ['MCU', 'P1.4']),
            net('ns0', ['MCU', 'P1.0'], ['U1', 's0']),
            net('ns1', ['MCU', 'P1.1'], ['U1', 's1']),
            net('ns2', ['MCU', 'P1.2'], ['U1', 's2']),
            net('ns3', ['MCU', 'P1.3'], ['U1', 's3']),
        ]);
        const sel = (n) => {
            board.setPin('P1.0', 'pushpull', !!(n & 1));
            board.setPin('P1.1', 'pushpull', !!(n & 2));
            board.setPin('P1.2', 'pushpull', !!(n & 4));
            board.setPin('P1.3', 'pushpull', !!(n & 8));
            board.advanceTo(1n);
        };
        board.setPin('P1.4', 'input', false);
        return { board, sel, z: () => board.readAnalog('P1.4') };
    }

    it('routes the selected channel voltage to Z, honestly loaded', () => {
        const m = rigMux();
        // The 100k pulldown that defines a floating Z also LOADS the
        // dividers through the switch: Thevenin says 1.205 and 1.887, and
        // the solver delivers exactly that — asserting the unloaded 1.25
        // and 2.0 would be asserting a wrong circuit.
        m.sel(3);
        assert.ok(Math.abs(m.z() - 1.205) < 0.02, `c3 loaded → ~1.205 V, got ${m.z().toFixed(3)}`);
        m.sel(9);
        assert.ok(Math.abs(m.z() - 1.887) < 0.02, `c9 loaded → ~1.887 V, got ${m.z().toFixed(3)}`);
        m.sel(0);
        assert.ok(m.z() < 0.05, 'unwired channel reads the pulldown');
    });
});

describe('level shifter', () => {
    function rigShift() {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'REG', kind: 'ld1117v33', params: {}, terminals: ['in', 'gnd', 'out'] },
            { id: 'U1', kind: 'level_shifter4', params: {}, terminals: ['lv', 'hv', 'gnd', 'lv1', 'lv2', 'lv3', 'lv4', 'hv1', 'hv2', 'hv3', 'hv4'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P2.0', 'P2.1'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['REG', 'in'], ['U1', 'hv']),
            net('ng', ['GND', 'gnd'], ['REG', 'gnd'], ['U1', 'gnd']),
            net('n33', ['REG', 'out'], ['U1', 'lv']),
            net('nh1', ['MCU', 'P1.0'], ['U1', 'hv1']),
            net('nl1', ['MCU', 'P2.0'], ['U1', 'lv1']),
            net('nh2', ['MCU', 'P1.1'], ['U1', 'hv2']),
            net('nl2', ['MCU', 'P2.1'], ['U1', 'lv2']),
        ]);
        let t = 0n;
        const tick = () => { t += 5_000n; board.advanceTo(t); };
        return { board, tick };
    }

    it('each side idles at ITS OWN rail — highs never cross domains', () => {
        const s = rigShift();
        s.board.setPin('P1.0', 'input', false);
        s.board.setPin('P2.0', 'input', false);
        s.tick();
        const hv1 = s.board.readAnalog('P1.0');
        const lv1 = s.board.readAnalog('P2.0');
        assert.ok(hv1 > 4.5, `hv side idles near 5 V, got ${hv1.toFixed(2)}`);
        assert.ok(lv1 > 3.0 && lv1 < 3.6, `lv side idles near 3.3 V, got ${lv1.toFixed(2)} — the lesson`);
    });

    it('a low crosses in both directions and releases cleanly', () => {
        const s = rigShift();
        s.board.setPin('P1.0', 'input', false);
        s.board.setPin('P2.0', 'input', false);
        s.board.setPin('P1.1', 'input', false);
        s.board.setPin('P2.1', 'input', false);
        s.tick();

        // HV side pulls channel 1 low (open-drain, as the module wants).
        s.board.setPin('P1.0', 'opendrain', false); s.tick(); s.tick();
        assert.ok(s.board.readAnalog('P2.0') < 0.5, 'low crossed hv→lv');
        s.board.setPin('P1.0', 'input', false); s.tick(); s.tick();
        assert.ok(s.board.readAnalog('P2.0') > 3.0, 'released: lv back to 3.3');
        assert.ok(s.board.readAnalog('P1.0') > 4.5, 'released: hv back to 5 — no latch-up');

        // LV side pulls channel 2 low.
        s.board.setPin('P2.1', 'opendrain', false); s.tick(); s.tick();
        assert.ok(s.board.readAnalog('P1.1') < 0.5, 'low crossed lv→hv');
        s.board.setPin('P2.1', 'input', false); s.tick(); s.tick();
        assert.ok(s.board.readAnalog('P1.1') > 4.5, 'released: hv back high — no latch-up');
    });
});
