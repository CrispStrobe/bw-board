// BMP280 SDO — the address select, and why the breakout has six pins.
//
// SDO low is 0x76, SDO high is 0x77. That is how two of them share a bus,
// and the model answered only at 0x76, so the pin was unreachable: present
// on every breakout, connected to nothing in the app.
//
// CSB picks the interface — high is I2C. It is modelled as a terminal so it
// can be tied high like a real board does; pulling it low would put a real
// part into SPI, which this model does not speak, and the test says so
// rather than pretending otherwise.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const TERMS = ['vcc', 'gnd', 'sda', 'scl', 'csb', 'sdo'];

/** One BMP280 with SDO strapped to a rail, settled so update() has run. */
function sensor({ sdoHigh, params = {} } = {}) {
    const board = new BoardImpl(3.3);
    const hi = [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' },
        { part: 'U1', terminal: 'csb' }];
    const lo = [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }];
    (sdoHigh ? hi : lo).push({ part: 'U1', terminal: 'sdo' });
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sda', 'scl'] },
        { id: 'U1', kind: 'bmp280', params, terminals: TERMS },
    ], [
        { id: 'nv', terminals: hi },
        { id: 'ng', terminals: lo },
        { id: 'n_sda', terminals: [{ part: 'MCU', terminal: 'sda' }, { part: 'U1', terminal: 'sda' }] },
        { id: 'n_scl', terminals: [{ part: 'MCU', terminal: 'scl' }, { part: 'U1', terminal: 'scl' }] },
    ]);
    board.setPower(true);
    let t = 0n;
    for (let i = 0; i < 3; i++) { t += 1_000_000n; board.advanceTo(t); }
    const st = board.getDeviceState('U1');
    const handlers = st.i2cHandlers || st._i2c?.handlers;
    return {
        /** Does the part claim this 7-bit address? */
        answers: (a7) => handlers.onAddress(a7, 0) === true,
    };
}

describe('BMP280 address select', () => {
    it('SDO low is 0x76 — the address it always had', () => {
        const s = sensor({ sdoHigh: false });
        assert.equal(s.answers(0x76), true);
        assert.equal(s.answers(0x77), false, 'and it does not also answer at the other one');
    });

    it('SDO high is 0x77, and 0x76 stops working', () => {
        // The half that was impossible before: one address, whatever you wired.
        const s = sensor({ sdoHigh: true });
        assert.equal(s.answers(0x77), true);
        assert.equal(s.answers(0x76), false);
    });

    it('two on one bus do not collide', () => {
        // The whole reason the pin exists. A model ignoring SDO gives two
        // parts that both answer 0x76, and the bus has no way to tell them
        // apart — which is exactly the bug you cannot see with one sensor.
        const a = sensor({ sdoHigh: false });
        const b = sensor({ sdoHigh: true });
        assert.equal(a.answers(0x76), true);
        assert.equal(b.answers(0x76), false);
        assert.equal(b.answers(0x77), true);
        assert.equal(a.answers(0x77), false);
    });

    it('an explicit params.addr still wins over the strap', () => {
        // Backwards compatibility: i2c-sensors.test.mjs sets addr 0x77 with no
        // SDO wired at all, and must keep working.
        const s = sensor({ sdoHigh: false, params: { addr: 0x77 } });
        assert.equal(s.answers(0x77), true, 'the param decided');
        assert.equal(s.answers(0x76), false);
    });

    it('an unwired SDO reads low, so nothing that worked stops', () => {
        const board = new BoardImpl(3.3);
        board.setNetlist([
            { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
            { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
            { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sda', 'scl'] },
            { id: 'U1', kind: 'bmp280', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
        ], [
            { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' }] },
            { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' }] },
            { id: 'n_sda', terminals: [{ part: 'MCU', terminal: 'sda' }, { part: 'U1', terminal: 'sda' }] },
            { id: 'n_scl', terminals: [{ part: 'MCU', terminal: 'scl' }, { part: 'U1', terminal: 'scl' }] },
        ]);
        board.setPower(true);
        let t = 0n;
        for (let i = 0; i < 3; i++) { t += 1_000_000n; board.advanceTo(t); }
        const st = board.getDeviceState('U1');
        const handlers = st.i2cHandlers || st._i2c?.handlers;
        assert.equal(handlers.onAddress(0x76, 0), true, 'the old default survives');
    });
});
