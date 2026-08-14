// MCP3008 / HX711 / TCS3200 goldens: each driven through board pins the
// way its canonical driver drives it, measuring real dividers where the
// input is a voltage.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAdcSensors } from '../src/devices/adc-sensors.js';

registerAdcSensors();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

describe('MCP3008', () => {
    function rigAdc() {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'RA', kind: 'resistor', params: { ohms: 15000 }, terminals: ['a', 'b'] },
            { id: 'RB', kind: 'resistor', params: { ohms: 5000 }, terminals: ['a', 'b'] },
            { id: 'U1', kind: 'mcp3008', params: {}, terminals: ['vcc', 'gnd', 'vref', 'csb', 'clk', 'din', 'dout', 'ch0', 'ch1', 'ch2', 'ch3', 'ch4', 'ch5', 'ch6', 'ch7'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['RA', 'a'], ['U1', 'vcc'], ['U1', 'vref']),
            net('ng', ['GND', 'gnd'], ['RB', 'b'], ['U1', 'gnd']),
            net('nch2', ['RA', 'b'], ['RB', 'a'], ['U1', 'ch2']),   // 1.25 V
            net('ncs', ['MCU', 'P1.0'], ['U1', 'csb']),
            net('nck', ['MCU', 'P1.1'], ['U1', 'clk']),
            net('ndi', ['MCU', 'P1.2'], ['U1', 'din']),
            net('ndo', ['MCU', 'P1.3'], ['U1', 'dout']),
        ]);
        let t = 0n;
        const tick = () => { t += 2_000n; board.advanceTo(t); };
        const pin = (p, h) => { board.setPin(p, 'pushpull', h); tick(); };
        // The canonical driver: CS low, clock start+SGL+ch, read 12 clocks.
        const readChannel = (ch, sgl = true) => {
            pin('P1.0', false);
            board.setPin('P1.3', 'input', false);
            const cfg = [(sgl ? 1 : 0), (ch >> 2) & 1, (ch >> 1) & 1, ch & 1];
            pin('P1.2', true);                       // start bit
            pin('P1.1', true); pin('P1.1', false);
            for (const b of cfg) {
                pin('P1.2', !!b);
                pin('P1.1', true); pin('P1.1', false);
            }
            let v = 0;
            // sample period clock + null bit clock + 10 data clocks
            pin('P1.1', true); pin('P1.1', false);   // sample period
            pin('P1.1', true); pin('P1.1', false);   // null bit
            for (let i = 0; i < 10; i++) {
                pin('P1.1', true); pin('P1.1', false);
                v = (v << 1) | (board.readAnalog('P1.3') > 2.5 ? 1 : 0);
            }
            pin('P1.0', true);
            return v;
        };
        return { readChannel };
    }

    it('single-ended: ch2 measures the divider; empty channel reads 0', () => {
        const a = rigAdc();
        const v = a.readChannel(2);
        assert.ok(Math.abs(v - 256) <= 3, `1.25/5.0 → ~256, got ${v}`);
        assert.equal(a.readChannel(5), 0, 'unwired channel');
    });

    it('differential ch2-ch3 clamps at zero in reverse polarity', () => {
        const a = rigAdc();
        const plus = a.readChannel(2, false);        // cfg 010: IN+=ch2, IN-=ch3
        assert.ok(Math.abs(plus - 256) <= 3, `+1.25 V diff → ~256, got ${plus}`);
        const minus = a.readChannel(3, false);       // cfg 011: IN+=ch3, IN-=ch2
        assert.equal(minus, 0, 'negative difference clamps at zero');
    });
});

describe('HX711', () => {
    function rigHx(params) {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'U1', kind: 'hx711', params, terminals: ['vcc', 'gnd', 'dout', 'sck'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('nd', ['MCU', 'P1.0'], ['U1', 'dout']),
            net('nk', ['MCU', 'P1.1'], ['U1', 'sck']),
        ]);
        let t = 0n;
        const tick = (us) => { t += BigInt(us) * 1000n; board.advanceTo(t); };
        board.setPin('P1.0', 'input', false);
        board.setPin('P1.1', 'pushpull', false);
        const ready = () => board.readAnalog('P1.0') < 2.5;
        const readFrame = (pulses = 25) => {
            let w = 0;
            for (let i = 0; i < pulses; i++) {
                board.setPin('P1.1', 'pushpull', true); tick(2);
                if (i < 24) w = (w * 2) + (board.readAnalog('P1.0') > 2.5 ? 1 : 0);
                board.setPin('P1.1', 'pushpull', false); tick(2);
            }
            if (w >= 0x800000) w -= 0x1000000;
            return w;
        };
        return { tick, ready, readFrame };
    }

    it('DOUT signals ready per rate; 24-bit two-s complement reads back', () => {
        const h = rigHx({ valueA: -123456, rateHz: 100 });
        assert.equal(h.ready(), false, 'busy right after power-up');
        h.tick(11_000);                              // > 1/100 s
        assert.equal(h.ready(), true, 'conversion ready');
        assert.equal(h.readFrame(25), -123456);
        assert.equal(h.ready(), false, 'busy again after the frame');
        h.tick(11_000);
        assert.equal(h.ready(), true, 'next conversion arrived');
    });

    it('26 pulses selects channel B for the NEXT frame', () => {
        const h = rigHx({ valueA: 1000, valueB: 2000, rateHz: 100 });
        h.tick(11_000);
        assert.equal(h.readFrame(26), 1000, 'first frame is still channel A');
        h.tick(11_000);
        assert.equal(h.readFrame(25), 2000, 'second frame delivers channel B');
        h.tick(11_000);
        assert.equal(h.readFrame(25), 1000, '25 pulses reverted to A×128');
    });
});

describe('TCS3200', () => {
    function rigTcs(params) {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'U1', kind: 'tcs3200', params, terminals: ['vcc', 'gnd', 's0', 's1', 's2', 's3', 'oe', 'out'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd'], ['U1', 'oe']),
            net('n0', ['MCU', 'P1.0'], ['U1', 's0']),
            net('n1', ['MCU', 'P1.1'], ['U1', 's1']),
            net('n2', ['MCU', 'P1.2'], ['U1', 's2']),
            net('n3', ['MCU', 'P1.3'], ['U1', 's3']),
            net('no', ['MCU', 'P1.5'], ['U1', 'out']),
        ]);
        let t = 0n;
        const tick = (ns) => { t += BigInt(ns); board.advanceTo(t); };
        const pin = (p, h) => board.setPin(p, 'pushpull', h);
        board.setPin('P1.5', 'input', false);
        // Count OUT edges over a window by sampling densely.
        const countEdges = (windowNs, stepNs) => {
            let edges = 0;
            let last = board.readAnalog('P1.5') > 2.5;
            for (let el = 0; el < windowNs; el += stepNs) {
                tick(stepNs);
                const now = board.readAnalog('P1.5') > 2.5;
                if (now !== last) edges++;
                last = now;
            }
            return edges;
        };
        return { pin, tick, countEdges };
    }

    it('red at 2% scale: frequency tracks intensity × scale', () => {
        const t = rigTcs({ red: 0.5, green: 0.1, fullScaleHz: 600_000 });
        t.pin('P1.0', false); t.pin('P1.1', true);   // S0S1=01 → 2%
        t.pin('P1.2', false); t.pin('P1.3', false);  // red
        // f = 600k × 0.02 × 0.5 = 6 kHz → 12k edges/s → 120 edges in 10 ms.
        const edges = t.countEdges(10_000_000, 10_000);
        assert.ok(Math.abs(edges - 120) <= 6, `~120 edges expected, got ${edges}`);
    });

    it('channel select changes the rate; power-down parks the output', () => {
        const t = rigTcs({ red: 0.5, green: 0.1, fullScaleHz: 600_000 });
        t.pin('P1.0', false); t.pin('P1.1', true);
        t.pin('P1.2', true); t.pin('P1.3', true);    // green
        // f = 600k × 0.02 × 0.1 = 1.2 kHz → 24 edges in 10 ms.
        const green = t.countEdges(10_000_000, 10_000);
        assert.ok(Math.abs(green - 24) <= 4, `~24 edges, got ${green}`);
        t.pin('P1.0', false); t.pin('P1.1', false);  // power down
        const off = t.countEdges(5_000_000, 10_000);
        assert.equal(off, 0, 'no oscillation powered down');
    });
});
