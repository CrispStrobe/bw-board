// TCS34725 INT — the threshold interrupt, and the pin that reports it.
//
// The whole reason a colour sensor has an interrupt pin: instead of polling
// the RGBC registers over I2C, you set a window (AILT..AIHT) and the part
// pulls INT low when the clear channel leaves it. The model declared the pin
// and stamped it, then never drove it — so bw-parts' sidecar could not honestly
// draw the pad, and the cross-check counted `int` as an engine name the
// package does not have.
//
// Two more things were wrong behind it, both silent:
//   * STATUS returned 0x11 whenever the part was on, i.e. AINT hardcoded SET.
//     A driver polling for its interrupt saw one pending forever; one waiting
//     for it to clear waited forever.
//   * The command byte's TYPE field (bits 6:5) was discarded. Type 0b11 is a
//     SPECIAL FUNCTION, not a register, so "clear the interrupt" (0xE6) masked
//     to 0x06 and overwrote AIHTL — the acknowledge moved the very threshold
//     it was acknowledging.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const ENABLE = 0x00, AILTL = 0x04, AIHTL = 0x06, STATUS = 0x13;
const PON_AEN = 0x03, AIEN = 0x10;

/** A sensor with INT pulled up, so the pin can be read as a real node. */
function rig(params = {}) {
    const board = new BoardImpl(3.3);
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sda', 'scl'] },
        { id: 'RP', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
        { id: 'U1', kind: 'tcs34725', params,
          terminals: ['vcc', 'gnd', 'sda', 'scl', 'int', 'led'] },
    ], [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' },
            { part: 'U1', terminal: 'vcc' }, { part: 'RP', terminal: 'a' }] },
        { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' },
            { part: 'U1', terminal: 'gnd' }] },
        { id: 'n_sda', terminals: [{ part: 'MCU', terminal: 'sda' }, { part: 'U1', terminal: 'sda' }] },
        { id: 'n_scl', terminals: [{ part: 'MCU', terminal: 'scl' }, { part: 'U1', terminal: 'scl' }] },
        { id: 'n_int', terminals: [{ part: 'RP', terminal: 'b' }, { part: 'U1', terminal: 'int' }] },
    ]);
    board.setPower(true);

    let t = 0n;
    const settle = () => { for (let i = 0; i < 3; i++) { t += 1_000_000n; board.advanceTo(t); } };
    settle();

    const st = board.getDeviceState('U1');
    const h = st.i2cHandlers || st._i2c?.handlers;

    const api = {
        board,
        /** Write one register through the command protocol (type 00). */
        write(reg, v) { h.onAddress(0x29, 0); h.onWriteByte(0x80 | reg); h.onWriteByte(v); settle(); return api; },
        /** Write a 16-bit threshold pair, low byte first, as a driver does. */
        write16(reg, v) { return api.write(reg, v & 0xff).write(reg + 1, (v >> 8) & 0xff); },
        read(reg) { h.onAddress(0x29, 0); h.onWriteByte(0x80 | reg); h.onAddress(0x29, 1); return h.onReadByte(); },
        /** The special-function command: bits 6:5 = 11. 0xE6 clears the interrupt. */
        special(fn) { h.onAddress(0x29, 0); h.onWriteByte(0xe0 | fn); settle(); return api; },
        /** Change the light the sensor sees. */
        light(clear) { board.setPartParam('U1', 'clear', clear); settle(); return api; },
        aint: () => (api.read(STATUS) & 0x10) !== 0,
        /** The INT pin as wired: LOW = asserted, pulled up = idle. */
        intLow: () => board.nodeVoltage('n_int') < 1.0,
    };
    return api;
}

/** A sensor watching the window 100..1000, interrupt armed. */
function armed(clear) {
    return rig({ clear })
        .write(ENABLE, PON_AEN)
        .write16(AILTL, 100)
        .write16(AIHTL, 1000)
        .write(ENABLE, PON_AEN | AIEN);
}

describe('TCS34725 threshold interrupt', () => {
    it('inside the window, nothing fires and the pin stays up', () => {
        const s = armed(500);
        assert.equal(s.aint(), false, 'AINT clear');
        assert.equal(s.intLow(), false, 'INT released, pull-up wins');
    });

    it('above the high threshold asserts, and pulls the pin LOW', () => {
        const s = armed(5000);
        assert.equal(s.aint(), true, 'AINT set');
        assert.equal(s.intLow(), true, 'INT pulled low');
    });

    it('below the low threshold asserts too — a window has two sides', () => {
        // Easy to model only the bright side and never notice: most benches
        // point the sensor at something and turn the light UP.
        const s = armed(10);
        assert.equal(s.aint(), true, 'AINT set on darkness');
        assert.equal(s.intLow(), true);
    });

    it('with AIEN off, the light can do anything and the pin never moves', () => {
        // The arming bit has to matter, or the pin is just a light detector
        // wired to an MCU pin that never asked for it.
        const s = rig({ clear: 5000 })
            .write(ENABLE, PON_AEN)
            .write16(AILTL, 100)
            .write16(AIHTL, 1000);
        assert.equal(s.aint(), false, 'not armed, so no flag');
        assert.equal(s.intLow(), false, 'and no pin');
    });

    it('AINT LATCHES: the light coming back does not clear it', () => {
        // The property that makes it usable as an edge. A flag that cleared
        // itself when the light returned could be missed entirely between two
        // polls, and the event it reported would be unobservable.
        const s = armed(5000);
        assert.equal(s.aint(), true, 'fired');
        s.light(500);                       // back inside the window
        assert.equal(s.aint(), true, 'still set — only the driver clears it');
        assert.equal(s.intLow(), true, 'and the pin is still held low');
    });

    it('the special-function command clears it, and the pin releases', () => {
        const s = armed(5000);
        assert.equal(s.intLow(), true);
        s.light(500).special(0x06);         // 0xE6: clear channel interrupt clear
        assert.equal(s.aint(), false, 'acknowledged');
        assert.equal(s.intLow(), false, 'pin released');
    });

    it('clearing does NOT move the threshold it is acknowledging', () => {
        // The command-type bug, stated as the thing it broke: 0xE6 masked to
        // 0x06 = AIHTL, so acknowledging an interrupt wrote 0xE6 into the low
        // byte of the high threshold. The window silently became 100..0x03E6
        // and the next reading was judged against a limit nobody set.
        const s = armed(5000);
        s.light(500).special(0x06);
        assert.equal(s.read(AIHTL), 1000 & 0xff, 'AIHTL untouched');
        assert.equal(s.read(AIHTL + 1), (1000 >> 8) & 0xff, 'AIHTH untouched');
        // And the window still works afterwards.
        s.light(5000);
        assert.equal(s.aint(), true, 'the same window still fires');
    });

    it('after acknowledging, it can fire again', () => {
        const s = armed(5000);
        s.light(500).special(0x06);
        assert.equal(s.aint(), false);
        s.light(9000);
        assert.equal(s.aint(), true, 'a second event is reported');
        assert.equal(s.intLow(), true);
    });

    it('AVALID still means what it did, and is not AINT', () => {
        // STATUS used to return 0x11 when on — the two bits moved together
        // because one of them was a constant. They are different facts.
        const s = rig({ clear: 500 });
        assert.equal(s.read(STATUS) & 0x01, 0, 'off: no valid data');
        s.write(ENABLE, PON_AEN);
        assert.equal(s.read(STATUS) & 0x01, 1, 'on: data valid');
        assert.equal(s.read(STATUS) & 0x10, 0, 'and no interrupt, because none was armed');
    });
});
