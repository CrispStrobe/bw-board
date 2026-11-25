// Radio front end: the sky wave by the hour (src/radio.js nightShare,
// stationField). Gap (2026-11-25): every station had one field strength,
// day and night, so a receiver could not show distant medium-wave stations
// coming in after dark. A station may now carry a sky-wave field that the
// night lets through (the sun-lit lowest ionospheric layer absorbs it by
// day); an antenna with a clock carries the hour on its dial. Oracles: the
// smoothstep twilight (half at 18:00 and 06:00); a passive receiver's tank
// swing proportional to the field.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { nightShare, stationField } from '../src/radio.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);
const ms = (b, t) => b.advanceTo(BigInt(Math.round(t * 1e6)));

describe('the sky wave by the hour', () => {
    it('night share: none by day, all at night, half at 18:00 and 06:00', () => {
        close(nightShare(12), 0, 0, 'noon');
        close(nightShare(16.9), 0, 0, '16:54');
        close(nightShare(18), 0.5, 1e-12, 'sunset');
        close(nightShare(6), 0.5, 1e-12, 'sunrise');
        close(nightShare(0), 1, 0, 'midnight');
        close(nightShare(19.5), 1, 0, '19:30');
        close(stationField({ fieldVPerM: 0.001, skyFieldVPerM: 0.02 }, 22), 0.021, 1e-12, 'ground plus sky wave at night');
    });

    it('a crystal set hears a distant station after dark: the antenna\'s clock dial sets the hour', () => {
        // A long wire on a tuned circuit (250 µH ‖ tuning capacitor at
        // 1 MHz), a germanium diode, 47 kΩ ‖ 2.2 nF. The distant station's
        // ground wave is 50 µV/m; its sky wave 2 mV/m at night.
        const run = (dial) => {
            const b = new BoardImpl(5);
            b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('A', 'antenna', { clock: true, hourOfDay: 12 }, ['a']), P('E', 'earth', {}, ['earth']),
                P('L', 'ferrite_coil', { rodHeightM: 0 }, ['a', 'tap', 'b', 'c1', 'c2']), P('TC', 'tuning_cap', { position: 0.165 }, ['a', 'b']),
                P('D', 'diode', { part: '1N34A' }, ['anode', 'cathode']), P('CD', 'capacitor', { farads: 2.2e-9 }, ['a', 'b']), P('RD', 'resistor', { ohms: 47e3 }, ['a', 'b'])],
            [net('g', ['G', 'gnd'], ['E', 'earth'], ['L', 'a'], ['TC', 'b'], ['CD', 'b'], ['RD', 'b']), net('ant', ['A', 'a'], ['L', 'tap']),
                net('top', ['L', 'b'], ['TC', 'a'], ['D', 'anode']), net('det', ['D', 'cathode'], ['CD', 'a'], ['RD', 'a'])]);
            if (dial !== undefined) b.setControl('A', dial);
            b.setBroadcast([{ id: 'far', hz: 1e6, fieldVPerM: 50e-6, skyFieldVPerM: 0.002, depth: 0, audio: { type: 'none' } }]);
            b.setPower(true);
            ms(b, 2);
            return { rf: b._radio.netAmplitudes('top').find(x => x.id === 'far').volts, det: b.nodeVoltages.get('det'), hour: b._radio.hour() };
        };
        const noon = run(), evening = run(18 / 24), night = run(22 / 24);
        close(noon.hour, 12, 0, 'no dial turned: the antenna\'s own hour');
        close(night.hour, 22, 1e-9, 'the dial: 22:00');
        // The station's swing on the tank follows the field: 50 µV/m by day,
        // 2.05 mV/m at night (41 times), at 18:00 half the sky wave.
        close(night.rf / noon.rf, 0.00205 / 50e-6, 0.1 * 41, 'night against noon: the field ratio');
        close(evening.rf / night.rf, (50e-6 + 0.001) / 0.00205, 0.05, 'at 18:00');
        assert.ok(night.det > 20 * Math.max(noon.det, 1e-6), `the detector by night ${night.det} V, by day ${noon.det} V`);
    });
});

describe('the antenna\'s clock is a control', () => {
    it('listed by getControls at its authored hour; antennas without a clock are not', () => {
        const b = new BoardImpl(5);
        b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('A', 'antenna', { clock: true, hourOfDay: 21 }, ['a']), P('B', 'antenna', {}, ['a']),
            P('R', 'resistor', { ohms: 1e3 }, ['a', 'b'])],
        [net('g', ['G', 'gnd'], ['R', 'b']), net('a', ['A', 'a'], ['B', 'a'], ['R', 'a'])]);
        const c = b.getControls().filter(x => x.kind === 'antenna');
        assert.deepEqual(c, [{ id: 'A', kind: 'antenna', value: 21 / 24 }]);
    });
});
