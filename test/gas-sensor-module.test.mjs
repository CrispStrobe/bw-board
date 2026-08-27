// An MQ gas sensor comes as a bare ELEMENT or on a MODULE, and they are
// different things to wire.
//
// The element is four wires: a sense resistance that falls with gas, and a
// heater coil you power yourself. The module is that element on a carrier
// with a load resistor, a comparator and a trim pot — vcc, gnd, an analog
// out and a digital one. The model had only the element, so bw-parts' module
// sidecar named pins nothing could reach.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

function moduleBoard(params = {}) {
    const board = new BoardImpl(5.0);
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'U', kind: 'gas_sensor', params: { package: 'module', ...params },
          terminals: ['vcc', 'gnd', 'aout', 'dout'] },
    ], [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U', terminal: 'vcc' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U', terminal: 'gnd' }] },
        { id: 'n_aout', terminals: [{ part: 'U', terminal: 'aout' }] },
        { id: 'n_dout', terminals: [{ part: 'U', terminal: 'dout' }] },
    ]);
    let t = 0n;
    for (let i = 0; i < 3; i++) { t += 1_000_000n; board.advanceTo(t); }
    return {
        aout: () => board.nodeVoltage('n_aout'),
        dout: () => board.nodeVoltage('n_dout'),
    };
}

describe('gas sensor as a module', () => {
    it('more gas means MORE volts out, which is the opposite of what it sounds like', () => {
        // The sense RESISTANCE falls with gas, and it is the top half of a
        // divider — so the output RISES. Getting this backwards is the classic
        // MQ mistake and it reads plausibly either way.
        const clean = moduleBoard({ gas: 0 }).aout();
        const some = moduleBoard({ gas: 0.5 }).aout();
        const lots = moduleBoard({ gas: 1 }).aout();
        assert.ok(clean < some && some < lots,
            `aout must rise with gas: ${clean.toFixed(2)} < ${some.toFixed(2)} < ${lots.toFixed(2)}`);
        assert.ok(clean < 0.6, `clean air is a small fraction of the rail, got ${clean.toFixed(2)}`);
        assert.ok(lots > 4.0, `saturated is most of the rail, got ${lots.toFixed(2)}`);
    });

    it('the load resistor sets the scale, as it does on a real carrier', () => {
        // Same gas, different RL: the divider moves. This is the trim you
        // actually make on a module, so a model that ignored RL would give
        // advice that does not transfer to the bench.
        const small = moduleBoard({ gas: 0.5, loadOhms: 1000 }).aout();
        const big = moduleBoard({ gas: 0.5, loadOhms: 100000 }).aout();
        assert.ok(big > small, `a bigger load gives more volts: ${small.toFixed(2)} -> ${big.toFixed(2)}`);
    });

    it('dout is a comparator against the pot, and it is ACTIVE LOW', () => {
        // Every MQ carrier pulls DOUT down when the gas passes the setpoint.
        // Wired as active-high, an alarm reads "danger" in clean air.
        const quiet = moduleBoard({ gas: 0.1, trip: 0.5 });
        const alarm = moduleBoard({ gas: 0.9, trip: 0.5 });
        assert.ok(quiet.dout() > 2.5, 'below the setpoint, dout idles HIGH');
        assert.ok(alarm.dout() < 2.5, 'above it, the module pulls dout LOW');
    });

    it('the setpoint is the pot, and moving it moves the trip', () => {
        const sameGas = 0.4;
        assert.ok(moduleBoard({ gas: sameGas, trip: 0.9 }).dout() > 2.5, 'high setpoint: quiet');
        assert.ok(moduleBoard({ gas: sameGas, trip: 0.2 }).dout() < 2.5, 'low setpoint: alarm');
    });

    it('the default package is still the bare element, with its four wires', () => {
        // Backwards compatibility, asserted: a bench that placed a gas_sensor
        // before the module existed keeps a/b/heater_a/heater_b.
        const board = new BoardImpl(5.0);
        board.setNetlist([
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'U', kind: 'gas_sensor', params: { gas: 0.5 },
              terminals: ['a', 'b', 'heater_a', 'heater_b'] },
        ], [
            { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U', terminal: 'b' }] },
            { id: 'na', terminals: [{ part: 'U', terminal: 'a' }] },
            { id: 'nh1', terminals: [{ part: 'U', terminal: 'heater_a' }] },
            { id: 'nh2', terminals: [{ part: 'U', terminal: 'heater_b' }] },
        ]);
        assert.ok(board.getDeviceState('U'), 'the element still loads');
    });
});
