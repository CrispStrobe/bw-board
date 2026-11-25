// Salt-film humidity comb (src/sensing-transducers.js, `humidity_comb`).
//
// Gap (2026-11-24): the only humidity sensors were digital modules (dht11,
// dht22) that report a number over one wire; nothing turned humidity into a
// circuit quantity. Oracle: the film's resistance law R = r50·10^((50 − RH)/d),
// read through a divider, against the learner's control, the part's param and
// the world's humidity.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { combOhms, HUMIDITY_COMB_DEFAULTS } from '../src/sensing-transducers.js';

registerAllDevices();
const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const P = (id, kind, params, terminals) => ({ id, kind, params, terminals });
const close = (a, e, tol, what) => assert.ok(Math.abs(a - e) <= tol, `${what}: ${a} vs ${e} (±${tol})`);

/** 9 V across the comb in series with `load` Ω to ground; returns the board. */
function divider(params = {}, load = 1e6) {
    const b = new BoardImpl(9);
    b.setNetlist([P('G', 'gnd', {}, ['gnd']), P('V', 'vsource', { volts: 9 }, ['pos', 'neg']),
        P('H', 'humidity_comb', params, ['a', 'b']), P('R', 'resistor', { ohms: load }, ['a', 'b'])],
    [net('g', ['G', 'gnd'], ['V', 'neg'], ['R', 'b']), net('top', ['V', 'pos'], ['H', 'a']), net('o', ['H', 'b'], ['R', 'a'])]);
    b.setPower(true);
    return b;
}
const filmOhms = (b, load = 1e6) => { const v = b.nodeVoltages.get('o'); return load * (9 - v) / v; };

describe('humidity comb: resistance falls one decade per 12 % RH', () => {
    const { r50, decadePct } = HUMIDITY_COMB_DEFAULTS;

    it('the law: r50 at 50 % RH, ten times less per decadePct', () => {
        close(combOhms({ params: {} }, 50), r50, 1e-6, 'R(50 %)');
        close(combOhms({ params: {} }, 50 + decadePct) / r50, 0.1, 1e-12, 'one decade wetter');
        close(combOhms({ params: { r50: 1e6, decadePct: 20 } }, 10) / 1e6, 100, 1e-9, 'its own card');
    });

    it('in a divider, at the world humidity (50 % by default)', () => {
        const b = divider();
        close(filmOhms(b) / r50, 1, 1e-3, 'film at 50 % RH');
        close(b.getDeviceState('H').humidityPct, 50, 1e-9, 'readout');
    });

    it('breathing on it (the control near 0.9) drops it to kilohms; a dry room sends it to hundreds of megohms', () => {
        const b = divider();
        b.setControl('H', 0.9);
        close(filmOhms(b) / combOhms({ params: {} }, 90), 1, 1e-3, 'breath, 90 % RH');
        assert.ok(b.nodeVoltages.get('o') > 8.9, `the divider jumps to the rail: ${b.nodeVoltages.get('o')}`);
        b.setControl('H', 0.3);
        close(filmOhms(b) / combOhms({ params: {} }, 30), 1, 1e-3, 'dry, 30 % RH');
        assert.ok(b.nodeVoltages.get('o') < 0.05, `and back down: ${b.nodeVoltages.get('o')}`);
    });

    it('its own humidity param, then the world, when no control is set', () => {
        close(filmOhms(divider({ humidity: 74 })) / combOhms({ params: {} }, 74), 1, 1e-3, 'param 74 %');
        const b = divider();
        b.world.set('humidityPct', 62);
        b.setControl('V', 9);   // any user action re-solves
        close(b.getDeviceState('H').humidityPct, 62, 1e-9, 'world humidity');
    });

    it('a panel offers it as a control, resting at the humidity it sees', () => {
        const c = divider({ humidity: 40 }).getControls().find((x) => x.id === 'H');
        assert.ok(c, 'listed');
        close(c.value, 0.4, 1e-12, 'rest value');
    });
});
