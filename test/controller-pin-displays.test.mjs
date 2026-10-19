/**
 * PIN-bound numeric displays mirror a board pin's digital level.
 *
 * The output direction already writes a widget's value OUT to a pin
 * (`writePin`). This is the read-back: a design that drives a header pin — an
 * FPGA lighting an on-screen Tang Nano's LED — now also lights an on-panel
 * indicator, so the Controller view reflects the same signal the board shows.
 * A pin carries one bit, so only the numeric indicators mirror it; a
 * character/pixel display bound to a pin is meaningless and stays untouched.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerPanel } from '../src/controller.js';
import { bindPanelToBoard } from '../src/controller-binding.js';

// A minimal board whose pin levels the test drives directly, exposing only the
// surface the binding reads: getPinState + the no-op output methods.
function pinBoard(levels = {}) {
    return {
        levels,
        setControl() {},
        writePin() {},
        getPinState(pin) {
            const p = String(pin).toLowerCase();
            return p in this.levels ? { mode: 'pushpull', driveHigh: !!this.levels[p] } : null;
        }
    };
}

describe('pin-bound numeric displays mirror a pin level', () => {
    test('a bargraph bound to a driven-high pin reads 1, and 0 when the pin drops', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('led15', 'bargraph', { min: 0, max: 1, segments: 1 }, {});
        w.binding = { target: 'pin', pinName: 'p15' };
        const board = pinBoard({ p15: true });
        const binding = bindPanelToBoard(panel, board);

        binding.pumpDisplays();
        assert.equal(w.state.value, 1, 'a driven-high pin lights the indicator');

        board.levels.p15 = false;
        binding.pumpDisplays();
        assert.equal(w.state.value, 0, 'the pin dropping darkens it');
        binding.dispose();
    });

    test('a high-Z (undriven) pin reads 0, never left unknown', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('g', 'gauge', { min: 0, max: 1 }, {});
        w.binding = { target: 'pin', pinName: 'p16' };
        const board = pinBoard({}); // p16 not present → getPinState returns null
        const binding = bindPanelToBoard(panel, board);
        binding.pumpDisplays();
        assert.equal(w.state.value, 0, 'an undriven pin is dark (0), not unknown');
        binding.dispose();
    });

    test('gauge, sevenseg and matrix all mirror the level through their own setters', () => {
        const board = pinBoard({ p17: true });
        for (const type of ['gauge', 'sevenseg', 'matrix']) {
            const panel = new ControllerPanel();
            const w = panel.addWidget('w', type, {}, {});
            w.binding = { target: 'pin', pinName: 'p17' };
            const binding = bindPanelToBoard(panel, board);
            binding.pumpDisplays();
            assert.equal(w.state.value, 1, `${type} reflects a high pin`);
            binding.dispose();
        }
    });

    test('an idle pin costs one emit, not one per frame (change hash)', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('led', 'bargraph', { min: 0, max: 1 }, {});
        w.binding = { target: 'pin', pinName: 'p18' };
        const board = pinBoard({ p18: true });
        const binding = bindPanelToBoard(panel, board);
        let emits = 0;
        panel.addListener((ev, d) => { if (ev === 'input' && d.name === 'led') emits++; });
        binding.pumpDisplays();
        binding.pumpDisplays();
        binding.pumpDisplays();
        assert.equal(emits, 1, 'an unchanging pin emits once, not once per pump');
        binding.dispose();
    });

    test('a character/pixel display bound to a pin is left alone (a pin is one bit)', () => {
        const panel = new ControllerPanel();
        const lcd = panel.addWidget('screen', 'lcd', { rows: 2, cols: 16 }, {});
        lcd.binding = { target: 'pin', pinName: 'p15' };
        const before = lcd.state.text;
        const board = pinBoard({ p15: true });
        const binding = bindPanelToBoard(panel, board);
        assert.doesNotThrow(() => binding.pumpDisplays());
        assert.equal(lcd.state.text, before, 'an lcd is not a 1-bit indicator; the pin path skips it');
        binding.dispose();
    });

    test('a board without getPinState breaks nothing', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('led', 'bargraph', {}, {});
        w.binding = { target: 'pin', pinName: 'p15' };
        const board = { setControl() {}, writePin() {} }; // no getPinState
        const binding = bindPanelToBoard(panel, board);
        assert.doesNotThrow(() => binding.pumpDisplays());
        binding.dispose();
    });
});
