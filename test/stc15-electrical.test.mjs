// STC15F2K60S2 — MEASURED behaviour, not a terminal-list roll call.
//
// test/stc15-bench-load.test.mjs already checks that the kind is registered
// and that its terminal spellings match the gallery benches. That is a
// naming check: it would still pass if the model were electrically dead,
// which is exactly the state the whole campaign exists to fix (104 gallery
// parts drew, wired, and took no part in MNA).
//
// So this file asserts the three things `hasDevice()`'s doc comment names as
// the reason a registered model beats collapsing to the generic `mcu`
// surface: the GPIO actually drives a net, `readPin` actually reads one, and
// the chip's vcc/gnd are CONSUMERS — a bare DIP has no regulator, so wiring
// a 3.3 V bench to its VCC must win rather than being overridden by a
// phantom 5 V source inside the model.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

const net = (id, ...ts) => ({ id, terminals: ts.map(([part, terminal]) => ({ part, terminal })) });
const VCC = { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] };
const GND = { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] };

describe('STC15 GPIO is electrically real', () => {
    it('a driven port pin sources and sinks a resistor-loaded net', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            VCC, GND,
            { id: 'U1', kind: 'stc15_mcu', params: {}, terminals: ['P1.0', 'VCC', 'GND'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'VCC']),
            net('ng', ['GND', 'gnd'], ['U1', 'GND'], ['R1', 'b']),
            net('nq', ['U1', 'P1.0'], ['R1', 'a']),
        ]);

        board.setPin('P1.0', 'pushpull', true);
        board.advanceTo(10_000n);
        const high = board.readAnalog('P1.0');
        assert.ok(high > 4.5, `driven HIGH pulls the 10k net up (got ${high})`);

        board.setPin('P1.0', 'pushpull', false);
        board.advanceTo(20_000n);
        const low = board.readAnalog('P1.0');
        assert.ok(low < 0.5, `driven LOW pulls the 10k net down (got ${low})`);
    });

    it('readPin reads the net back through the model, both rails', () => {
        const board = new BoardImpl(5.0);
        board.setNetlist([
            VCC, GND,
            { id: 'U1', kind: 'stc15_mcu', params: {}, terminals: ['P1.1', 'P2.0', 'VCC', 'GND'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'VCC'], ['U1', 'P1.1']),
            net('ng', ['GND', 'gnd'], ['U1', 'GND'], ['U1', 'P2.0']),
        ]);
        board.setPin('P1.1', 'input', false);
        board.setPin('P2.0', 'input', false);
        board.advanceTo(10_000n);

        assert.equal(board.readPin('P1.1'), 1, 'P1.1 strapped to VCC reads 1');
        assert.equal(board.readPin('P2.0'), 0, 'P2.0 strapped to GND reads 0');
    });

    it('P0 pins drive too — the port that runs ASCENDING on this part', () => {
        // Guards the pinout trap: the STC15 is NOT pin-compatible with the
        // STC12, and P0 ascends (pin 1 = P0.0). If the terminal list were
        // copied from the STC12 body this net would not exist to drive.
        const board = new BoardImpl(5.0);
        board.setNetlist([
            VCC, GND,
            { id: 'U1', kind: 'stc15_mcu', params: {}, terminals: ['P0.0', 'P0.7', 'VCC', 'GND'] },
            { id: 'R1', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
            { id: 'R2', kind: 'resistor', params: { ohms: 10000 }, terminals: ['a', 'b'] },
        ], [
            net('nv', ['VCC', 'vcc'], ['U1', 'VCC']),
            net('ng', ['GND', 'gnd'], ['U1', 'GND'], ['R1', 'b'], ['R2', 'b']),
            net('n0', ['U1', 'P0.0'], ['R1', 'a']),
            net('n7', ['U1', 'P0.7'], ['R2', 'a']),
        ]);
        board.setPin('P0.0', 'pushpull', true);
        board.setPin('P0.7', 'pushpull', false);
        board.advanceTo(10_000n);
        assert.ok(board.readAnalog('P0.0') > 4.5, 'P0.0 high');
        assert.ok(board.readAnalog('P0.7') < 0.5, 'P0.7 low');
    });

    it('the model declares the flags that make it beat the generic mcu surface', () => {
        const m = getDevice('stc15_mcu');
        assert.equal(m.gpioFollowsPinStates, true, 'GPIO tracks pin states');
        assert.equal(m.vcc, 5.0, 'nominal part voltage');
        // No power drives: a bare DIP has no regulator, so vcc/gnd are
        // CONSUMERS — the bench supplies them. This is asserted at MODEL
        // level on purpose. The board-level version of this check is
        // VACUOUS: a `vcc` part clamps its net to params.volts regardless
        // of what a device model drives onto it, so a model that wrongly
        // sourced 5 V here still measures 3.3 V on a 3.3 V bench. Verified
        // by mutation — init() returning a 5 V VCC drive (with or without
        // _staticDrives) leaves nodeVoltage at 3.3 and only this
        // assertion notices.
        const st = m.init({ id: 'U1', kind: 'stc15_mcu', params: {}, terminals: [] });
        assert.deepEqual(st.drives, {}, 'bare chip stamps no supply of its own');
    });
});
