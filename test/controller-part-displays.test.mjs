/**
 * PART-bound display widgets mirror the board device's state.
 *
 * The board binding pushed widget INPUTS to setControl and deferred every
 * display to the VARIABLE layer — so an oled widget bound to the circuit's
 * SSD1306 could be selected and then showed nothing forever (the calculator
 * example's faceplate, owner report 2026-08-25). These oracles pin the new
 * mirror: pixel framebuffers for oled, text lines for character devices,
 * and the change hash that keeps an idle screen from re-emitting.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerPanel } from '../src/controller.js';
import { bindPanelToBoard } from '../src/controller-binding.js';

describe('part-bound displays mirror device state', () => {
    test('an oled widget bound to an ssd1306-shaped part receives its framebuffer', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('screen', 'oled', {}, {});
        w.binding = { target: 'part', partId: 'oled1' };
        const fb = new Uint8Array(1024);
        fb[0] = 0xAA; fb[512] = 0x55;
        const board = { setControl() {}, getDeviceState: id => (id === 'oled1' ? { fb } : null) };
        const binding = bindPanelToBoard(panel, board);
        binding.pumpDisplays();
        assert.ok(w.state.fb instanceof Uint8Array, 'the widget carries a pixel buffer');
        assert.equal(w.state.fb[0], 0xAA);
        assert.equal(w.state.fb[512], 0x55);
        assert.equal(w.state.fbW, 128);
        assert.equal(w.state.fbH, 64);

        // The mirror is a COPY: the device mutating its GDDRAM must not
        // silently rewrite the widget without a pump.
        fb[0] = 0x00;
        assert.equal(w.state.fb[0], 0xAA, 'the widget holds a snapshot, not a live view');
        binding.pumpDisplays();
        assert.equal(w.state.fb[0], 0x00, 'the next pump picks the change up');
        binding.dispose();
    });

    test('an unchanged framebuffer does not re-emit (change hash)', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('screen', 'oled', {}, {});
        w.binding = { target: 'part', partId: 'oled1' };
        const fb = new Uint8Array(1024).fill(7);
        const board = { setControl() {}, getDeviceState: () => ({ fb }) };
        const binding = bindPanelToBoard(panel, board);
        let emits = 0;
        panel.addListener((ev, d) => { if (ev === 'input' && d.pixels) emits++; });
        binding.pumpDisplays();
        binding.pumpDisplays();
        binding.pumpDisplays();
        assert.equal(emits, 1, 'an idle screen costs one emit, not one per frame');
        binding.dispose();
    });

    test('an lcd widget bound to a character device receives its text lines', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('readout', 'lcd', { rows: 2, cols: 16 }, {});
        w.binding = { target: 'part', partId: 'lcd1' };
        const board = {
            setControl() {},
            getDeviceState: () => ({ text: ['HELLO           ', 'WORLD           '] })
        };
        const binding = bindPanelToBoard(panel, board);
        binding.pumpDisplays();
        assert.match(w.state.text, /HELLO/);
        assert.match(w.state.text, /WORLD/);
        binding.dispose();
    });

    test('a part that is not a device breaks nothing', () => {
        const panel = new ControllerPanel();
        const w = panel.addWidget('screen', 'oled', {}, {});
        w.binding = { target: 'part', partId: 'r1' };
        const board = { setControl() {}, getDeviceState: () => { throw new Error('no state'); } };
        const binding = bindPanelToBoard(panel, board);
        assert.doesNotThrow(() => binding.pumpDisplays());
        binding.dispose();
    });
});
