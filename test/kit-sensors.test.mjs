// DHT11 + joystick goldens. The DHT11 harness is a pulse-width decoder —
// exactly what every driver is — measuring the sensor's timed edges.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerKitSensors } from '../src/devices/kit-sensors.js';

registerKitSensors();

const V = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const G = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });

describe('DHT11', () => {
    function rig(params) {
        const board = new BoardImpl(5.0);
        board.setNetlist([V, G,
            { id: 'RP', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
            { id: 'U1', kind: 'dht11', params, terminals: ['vcc', 'gnd', 'data'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['RP', 'a'], ['U1', 'vcc']),
            net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
            net('nd', ['MCU', 'P1.0'], ['RP', 'b'], ['U1', 'data']),
        ]);
        let t = 0n;
        const tick = (us) => { t += BigInt(us) * 1000n; board.advanceTo(t); };
        const low = () => board.setPin('P1.0', 'pushpull', false);
        const release = () => board.setPin('P1.0', 'input', false);
        const high = () => board.readAnalog('P1.0') > 2.5;

        // The canonical driver: start signal, then measure the 40 high
        // pulses' widths by dense sampling.
        const readSensor = () => {
            low(); tick(18_000); release();
            // Wait through turnaround + response preamble: sample until the
            // line has gone low (response) then high (preamble) then low
            // (first bit) — with a deadline so silence is detectable.
            const waitFor = (level, deadlineUs) => {
                let waited = 0;
                while (high() !== level && waited < deadlineUs) { tick(2); waited += 2; }
                return waited < deadlineUs;
            };
            if (!waitFor(false, 100)) return null;           // response low
            if (!waitFor(true, 200)) return null;            // preamble high
            const bits = [];
            for (let i = 0; i < 40; i++) {
                if (!waitFor(false, 200)) return null;       // bit preamble
                if (!waitFor(true, 200)) return null;        // data high begins
                let width = 0;
                while (high() && width < 200) { tick(2); width += 2; }
                bits.push(width > 45 ? 1 : 0);
            }
            const bytes = [];
            for (let b = 0; b < 5; b++) {
                bytes.push(bits.slice(b * 8, b * 8 + 8).reduce((v, bit) => (v << 1) | bit, 0));
            }
            return bytes;
        };
        return { readSensor, tick };
    }

    it('delivers humidity/temperature with a valid checksum', () => {
        const d = rig({ humidity: 62, temperature: 31 });
        d.tick(1_100_000);                                   // past the power-on holdoff
        const bytes = d.readSensor();
        assert.ok(bytes, 'sensor answered');
        assert.equal(bytes[0], 62, 'humidity integer');
        assert.equal(bytes[2], 31, 'temperature integer');
        assert.equal(bytes[4], (bytes[0] + bytes[1] + bytes[2] + bytes[3]) & 0xff, 'checksum');
    });

    it('polling faster than 1 Hz gets silence — the beginner bug, modeled', () => {
        const d = rig({ humidity: 40, temperature: 20 });
        d.tick(1_100_000);
        assert.ok(d.readSensor(), 'first read fine');
        d.tick(200_000);                                     // only 0.2 s later
        assert.equal(d.readSensor(), null, 'too soon: no response');
        d.tick(1_000_000);
        assert.ok(d.readSensor(), 'a second later it answers again');
    });
});

describe('joystick', () => {
    function rig(params) {
        const board = new BoardImpl(5.0);
        const parts = [V, G,
            { id: 'J', kind: 'joystick', params, terminals: ['vcc', 'gnd', 'vrx', 'vry', 'sw'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0', 'P1.1', 'P1.2'] },
        ];
        board.setNetlist(parts, [
            net('nv', ['VCC', 'vcc'], ['J', 'vcc']),
            net('ng', ['GND', 'gnd'], ['J', 'gnd']),
            net('nx', ['MCU', 'P1.0'], ['J', 'vrx']),
            net('ny', ['MCU', 'P1.1'], ['J', 'vry']),
            net('ns', ['MCU', 'P1.2'], ['J', 'sw']),
        ]);
        board.setPin('P1.0', 'input', false);
        board.setPin('P1.1', 'input', false);
        board.setPin('P1.2', 'input-pullup', false);
        board.advanceTo(1n);
        return { board, parts };
    }

    it('center reads mid-rail, extremes read the rails, button pulls sw low', () => {
        const j = rig({ x: 0, y: 0 });
        assert.ok(Math.abs(j.board.readAnalog('P1.0') - 2.5) < 0.05, 'x centered');
        assert.ok(Math.abs(j.board.readAnalog('P1.1') - 2.5) < 0.05, 'y centered');
        assert.ok(j.board.readAnalog('P1.2') > 4.0, 'button open, pulled up');

        j.parts[2].params = { x: 1, y: -1, pressed: true };
        j.board.setControl('J', 1);
        assert.ok(j.board.readAnalog('P1.0') > 4.9, 'x full right → VCC');
        assert.ok(j.board.readAnalog('P1.1') < 0.1, 'y full down → GND');
        assert.ok(j.board.readAnalog('P1.2') < 0.2, 'pressed → low');
    });
});
