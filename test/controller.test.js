/**
 * Controller panel engine tests.
 *
 * Widget model, state, persistence, binding, and the program-facing API.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerPanel, WIDGET_TYPES } from '../src/controller.js';
import { bindPanelToBoard, createControllerDriver } from '../src/controller-binding.js';
import { BoardImpl } from '../src/board.js';

// ── Widget CRUD ─────────────────────────────────────────────────────────────

describe('ControllerPanel: widget CRUD', () => {
  it('addWidget creates a joystick with defaults', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('joy1', 'joystick');
    assert.equal(w.name, 'joy1');
    assert.equal(w.type, 'joystick');
    assert.equal(w.state.x, 0);
    assert.equal(w.state.y, 0);
  });

  it('addWidget creates a button (momentary by default)', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('btnA', 'button');
    assert.equal(w.config.toggle, false);
    assert.equal(w.state.pressed, false);
  });

  it('addWidget creates a slider with range', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('temp', 'slider', { min: -40, max: 85 });
    assert.equal(w.config.min, -40);
    assert.equal(w.config.max, 85);
    assert.equal(w.state.value, -40); // starts at min
  });

  it('addWidget rejects duplicate names', () => {
    const p = new ControllerPanel();
    p.addWidget('x', 'button');
    assert.throws(() => p.addWidget('x', 'slider'), /already exists/);
  });

  it('addWidget rejects unknown types', () => {
    const p = new ControllerPanel();
    assert.throws(() => p.addWidget('x', 'foobar'), /Unknown widget type/);
  });

  it('removeWidget works', () => {
    const p = new ControllerPanel();
    p.addWidget('x', 'button');
    p.removeWidget('x');
    assert.equal(p.getWidget('x'), null);
    assert.deepEqual(p.getWidgetNames(), []);
  });

  it('renameWidget updates the key', () => {
    const p = new ControllerPanel();
    p.addWidget('old', 'slider');
    p.renameWidget('old', 'new');
    assert.equal(p.getWidget('old'), null);
    assert.equal(p.getWidget('new').type, 'slider');
  });

  it('getWidgetsByType filters correctly', () => {
    const p = new ControllerPanel();
    p.addWidget('j1', 'joystick');
    p.addWidget('b1', 'button');
    p.addWidget('j2', 'joystick');
    assert.deepEqual(p.getWidgetsByType('joystick'), ['j1', 'j2']);
    assert.deepEqual(p.getWidgetsByType('button'), ['b1']);
  });
});

// ── Input & state ───────────────────────────────────────────────────────────

describe('ControllerPanel: input and state', () => {
  it('joystick input clamps to -100..100', () => {
    const p = new ControllerPanel();
    p.addWidget('joy', 'joystick');
    p.setJoystickInput('joy', 200, -300);
    assert.equal(p.getX('joy'), 100);
    assert.equal(p.getY('joy'), -100);
  });

  it('momentary button: press and release', () => {
    const p = new ControllerPanel();
    p.addWidget('btn', 'button');
    p.setButtonInput('btn', true);
    assert.equal(p.isPressed('btn'), true);
    p.setButtonInput('btn', false);
    assert.equal(p.isPressed('btn'), false);
  });

  it('toggle button: each press flips state', () => {
    const p = new ControllerPanel();
    p.addWidget('btn', 'button', { toggle: true });
    p.setButtonInput('btn', true);  // → on
    assert.equal(p.isPressed('btn'), true);
    p.setButtonInput('btn', false); // release → no change
    assert.equal(p.isPressed('btn'), true);
    p.setButtonInput('btn', true);  // press again → off
    assert.equal(p.isPressed('btn'), false);
  });

  it('slider input clamps to [min, max]', () => {
    const p = new ControllerPanel();
    p.addWidget('s', 'slider', { min: 0, max: 100 });
    p.setSliderInput('s', 150);
    assert.equal(p.getValue('s'), 100);
    p.setSliderInput('s', -50);
    assert.equal(p.getValue('s'), 0);
  });

  it('getValue returns magnitude for joystick', () => {
    const p = new ControllerPanel();
    p.addWidget('joy', 'joystick');
    p.setJoystickInput('joy', 60, 80);
    assert.equal(p.getValue('joy'), 100); // √(3600+6400) = 100
  });

  it('getAll returns all widget values', () => {
    const p = new ControllerPanel();
    p.addWidget('btn', 'button');
    p.addWidget('sl', 'slider', { min: 0, max: 10 });
    p.setButtonInput('btn', true);
    p.setSliderInput('sl', 7);
    const all = p.getAll();
    assert.equal(all.btn, 1);
    assert.equal(all.sl, 7);
  });
});

// ── Mode ────────────────────────────────────────────────────────────────────

describe('ControllerPanel: mode', () => {
  it('starts in edit mode', () => {
    const p = new ControllerPanel();
    assert.equal(p.mode, 'edit');
  });

  it('setMode switches between edit and play', () => {
    const p = new ControllerPanel();
    p.setMode('play');
    assert.equal(p.mode, 'play');
    p.setMode('edit');
    assert.equal(p.mode, 'edit');
  });

  it('rejects invalid mode', () => {
    const p = new ControllerPanel();
    assert.throws(() => p.setMode('fly'), /Invalid mode/);
  });
});

// ── Persistence ─────────────────────────────────────────────────────────────

describe('ControllerPanel: JSON round-trip', () => {
  it('serializes and deserializes widgets', () => {
    const p = new ControllerPanel();
    p.addWidget('joy1', 'joystick', {}, { x: 10, y: 20 });
    p.addWidget('btnA', 'button', { toggle: true });
    p.addWidget('temp', 'slider', { min: -40, max: 85 });
    p.getWidget('temp').binding = { target: 'part', partId: 'dht1', param: null };

    const json = p.toJSON();
    const p2 = ControllerPanel.fromJSON(json);

    assert.deepEqual(p2.getWidgetNames(), ['joy1', 'btnA', 'temp']);
    assert.equal(p2.getWidget('joy1').type, 'joystick');
    assert.equal(p2.getWidget('btnA').config.toggle, true);
    assert.equal(p2.getWidget('temp').config.min, -40);
    assert.equal(p2.getWidget('temp').binding.target, 'part');
    assert.equal(p2.getWidget('temp').binding.partId, 'dht1');
  });

  it('rejects invalid data', () => {
    assert.throws(() => ControllerPanel.fromJSON(null), /Invalid/);
    assert.throws(() => ControllerPanel.fromJSON({ version: 99 }), /Invalid/);
  });
});

// ── Events ──────────────────────────────────────────────────────────────────

describe('ControllerPanel: events', () => {
  it('emits input events on widget change', () => {
    const p = new ControllerPanel();
    p.addWidget('sl', 'slider', { min: 0, max: 100 });
    const events = [];
    p.addListener((e, d) => events.push({ e, d }));
    p.setSliderInput('sl', 42);
    assert.equal(events.length, 1);
    assert.equal(events[0].e, 'input');
    assert.equal(events[0].d.value, 42);
  });

  it('listener errors do not propagate', () => {
    const p = new ControllerPanel();
    p.addWidget('btn', 'button');
    p.addListener(() => { throw new Error('boom'); });
    // Should not throw
    p.setButtonInput('btn', true);
  });
});

// ── Board binding ───────────────────────────────────────────────────────────

describe('bindPanelToBoard', () => {
  /** Minimal circuit: VCC, GND, potentiometer, switch. */
  function makeCircuit() {
    return {
      parts: [
        { id: 'VCC', kind: 'vcc', terminals: ['vcc'], params: {} },
        { id: 'GND', kind: 'gnd', terminals: ['gnd'], params: {} },
        { id: 'pot1', kind: 'potentiometer', terminals: ['a', 'b', 'wiper'], params: { ohms: 10000 } },
        { id: 'sw1', kind: 'switch', terminals: ['a', 'b'], params: {} },
      ],
      nets: [
        { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'pot1', terminal: 'a' }] },
        { id: 'nw', terminals: [{ part: 'pot1', terminal: 'wiper' }, { part: 'sw1', terminal: 'a' }] },
        { id: 'ng', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'pot1', terminal: 'b' },
          { part: 'sw1', terminal: 'b' },
        ] },
      ],
    };
  }

  it('slider drives potentiometer position (0→0, 100→1)', () => {
    const panel = new ControllerPanel();
    panel.addWidget('knob', 'slider', { min: 0, max: 100 });
    panel.bindToPart('knob', 'pot1');

    const board = new BoardImpl(5.0);
    const { parts, nets } = makeCircuit();
    board.setNetlist(parts, nets);

    const bridge = bindPanelToBoard(panel, board);

    // Set slider to 50% → pot wiper at 0.5
    panel.setSliderInput('knob', 50);

    // The board should have received setControl('pot1', 0.5)
    const ctrls = board.getControls();
    const pot = ctrls.find(c => c.id === 'pot1');
    assert.ok(pot, 'potentiometer in controls');
    assert.ok(Math.abs(pot.value - 0.5) < 0.01,
      `pot value should be ~0.5, got ${pot.value}`);

    bridge.dispose();
  });

  it('button drives switch state', () => {
    const panel = new ControllerPanel();
    panel.addWidget('btn', 'button');
    panel.bindToPart('btn', 'sw1');

    const board = new BoardImpl(5.0);
    const { parts, nets } = makeCircuit();
    board.setNetlist(parts, nets);

    const bridge = bindPanelToBoard(panel, board);

    panel.setButtonInput('btn', true);
    const ctrls = board.getControls();
    const sw = ctrls.find(c => c.id === 'sw1');
    assert.equal(sw.value, 1, 'switch pressed');

    panel.setButtonInput('btn', false);
    const ctrls2 = board.getControls();
    const sw2 = ctrls2.find(c => c.id === 'sw1');
    assert.equal(sw2.value, 0, 'switch released');

    bridge.dispose();
  });

  it('sync() pushes all bound values', () => {
    const panel = new ControllerPanel();
    panel.addWidget('knob', 'slider', { min: 0, max: 100 });
    panel.bindToPart('knob', 'pot1');
    panel.setSliderInput('knob', 75);

    const board = new BoardImpl(5.0);
    const { parts, nets } = makeCircuit();
    board.setNetlist(parts, nets);

    const bridge = bindPanelToBoard(panel, board);
    bridge.sync();

    const pot = board.getControls().find(c => c.id === 'pot1');
    assert.ok(Math.abs(pot.value - 0.75) < 0.01, `expected ~0.75, got ${pot.value}`);

    bridge.dispose();
  });

  it('joystick x axis maps to 0..1', () => {
    const panel = new ControllerPanel();
    panel.addWidget('joy', 'joystick');
    panel.bindToPart('joy', 'pot1', 'x');

    const board = new BoardImpl(5.0);
    const { parts, nets } = makeCircuit();
    board.setNetlist(parts, nets);

    bindPanelToBoard(panel, board);

    // x = -100 → 0.0, x = 0 → 0.5, x = 100 → 1.0
    panel.setJoystickInput('joy', -100, 0);
    assert.ok(Math.abs(board.getControls().find(c => c.id === 'pot1').value) < 0.01);

    panel.setJoystickInput('joy', 100, 0);
    assert.ok(Math.abs(board.getControls().find(c => c.id === 'pot1').value - 1.0) < 0.01);
  });
});

// ── Program-facing driver ───────────────────────────────────────────────────

describe('createControllerDriver', () => {
  it('reporter methods read widget state', () => {
    const panel = new ControllerPanel();
    panel.addWidget('joy', 'joystick');
    panel.addWidget('btn', 'button');
    panel.addWidget('sl', 'slider', { min: 0, max: 255 });

    panel.setJoystickInput('joy', 30, -40);
    panel.setButtonInput('btn', true);
    panel.setSliderInput('sl', 128);

    const drv = createControllerDriver(panel);

    assert.equal(drv.controllerX('joy'), 30);
    assert.equal(drv.controllerY('joy'), -40);
    assert.equal(drv.controllerPressed('btn'), true);
    assert.equal(drv.controllerValue('sl'), 128);
  });

  it('controllerWidgets returns all widget names', () => {
    const panel = new ControllerPanel();
    panel.addWidget('a', 'button');
    panel.addWidget('b', 'slider');

    const drv = createControllerDriver(panel);
    assert.deepEqual(drv.controllerWidgets(), ['a', 'b']);
  });

  it('returns defaults for missing widgets', () => {
    const panel = new ControllerPanel();
    const drv = createControllerDriver(panel);
    assert.equal(drv.controllerValue('nope'), 0);
    assert.equal(drv.controllerX('nope'), 0);
    assert.equal(drv.controllerPressed('nope'), false);
  });
});

// ── D-pad — upstreamed from brickwright-lite c1edb5ba, where this widget
// landed IN THE VENDORED COPY and drifted from this repo (the vendor
// freshness gate caught it, 2026-08-19). The engine change and these tests
// are that commit's, moved to where the tree is owned.

// ─── D-pad widget tests ───────────────────────────────────────────────────

describe('ControllerPanel — D-pad widget', () => {

  it('adds a dpad with default state (all directions false)', () => {
    const panel = new ControllerPanel();
    const w = panel.addWidget('dpad1', 'dpad');
    assert.equal(w.type, 'dpad');
    assert.equal(w.state.up, false);
    assert.equal(w.state.down, false);
    assert.equal(w.state.left, false);
    assert.equal(w.state.right, false);
  });

  it('setDpadInput sets direction state', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    panel.setDpadInput('dpad1', 'up', true);
    panel.setDpadInput('dpad1', 'right', true);
    const w = panel.getWidget('dpad1');
    assert.equal(w.state.up, true);
    assert.equal(w.state.right, true);
    assert.equal(w.state.down, false);
    assert.equal(w.state.left, false);
  });

  it('setDpadInput rejects invalid direction', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    assert.throws(() => panel.setDpadInput('dpad1', 'diagonal', true), /Invalid D-pad direction/);
  });

  it('getValue returns bitmask (up=1, down=2, left=4, right=8)', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    assert.equal(panel.getValue('dpad1'), 0);
    panel.setDpadInput('dpad1', 'up', true);
    assert.equal(panel.getValue('dpad1'), 1);
    panel.setDpadInput('dpad1', 'right', true);
    assert.equal(panel.getValue('dpad1'), 1 | 8); // 9
    panel.setDpadInput('dpad1', 'down', true);
    assert.equal(panel.getValue('dpad1'), 1 | 2 | 8); // 11
  });

  it('getX returns -1/0/1 for dpad left/right', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    assert.equal(panel.getX('dpad1'), 0);
    panel.setDpadInput('dpad1', 'right', true);
    assert.equal(panel.getX('dpad1'), 1);
    panel.setDpadInput('dpad1', 'left', true);
    assert.equal(panel.getX('dpad1'), 0); // both pressed = 0
    panel.setDpadInput('dpad1', 'right', false);
    assert.equal(panel.getX('dpad1'), -1);
  });

  it('getY returns -1/0/1 for dpad up/down', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    assert.equal(panel.getY('dpad1'), 0);
    panel.setDpadInput('dpad1', 'up', true);
    assert.equal(panel.getY('dpad1'), 1);
    panel.setDpadInput('dpad1', 'down', true);
    assert.equal(panel.getY('dpad1'), 0); // both pressed = 0
    panel.setDpadInput('dpad1', 'up', false);
    assert.equal(panel.getY('dpad1'), -1);
  });

  it('isPressed returns true if any direction pressed', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    assert.equal(panel.isPressed('dpad1'), false);
    panel.setDpadInput('dpad1', 'left', true);
    assert.equal(panel.isPressed('dpad1'), true);
    panel.setDpadInput('dpad1', 'left', false);
    assert.equal(panel.isPressed('dpad1'), false);
  });

  it('dpad resets on entering play mode', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    panel.getWidget('dpad1').state.up = true;
    panel.getWidget('dpad1').state.right = true;
    panel.setMode('play');
    const w = panel.getWidget('dpad1');
    assert.equal(w.state.up, false);
    assert.equal(w.state.right, false);
  });

  it('dpad persists via toJSON/fromJSON', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad', {}, { x: 5, y: 10 });
    panel.bindToPart('dpad1', 'switch1', 'x');
    const json = panel.toJSON();
    const restored = ControllerPanel.fromJSON(json);
    const w = restored.getWidget('dpad1');
    assert.equal(w.type, 'dpad');
    assert.equal(w.layout.x, 5);
    assert.deepEqual(w.binding, { target: 'part', partId: 'switch1', param: 'x' });
  });
});

describe('ControllerPanel — D-pad world-facing binding', () => {

  it('dpad bound to part calls board.setControl on direction press', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    panel.bindToPart('dpad1', 'switch1', 'x');

    const calls = [];
    const mockBoard = { setControl(partId, value) { calls.push({ partId, value }); } };
    const binding = bindPanelToBoard(panel, mockBoard);

    panel.setDpadInput('dpad1', 'right', true);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].partId, 'switch1');
    // right pressed, no left → x = (1 + 1) / 2 = 1.0
    assert.equal(calls[0].value, 1.0);

    panel.setDpadInput('dpad1', 'right', false);
    assert.equal(calls.length, 2);
    // neither → x = (0 + 1) / 2 = 0.5
    assert.equal(calls[1].value, 0.5);

    binding.dispose();
  });

  it('dpad y-axis binding works', () => {
    const panel = new ControllerPanel();
    panel.addWidget('dpad1', 'dpad');
    panel.bindToPart('dpad1', 'pot1', 'y');

    const calls = [];
    const mockBoard = { setControl(partId, value) { calls.push({ partId, value }); } };
    const binding = bindPanelToBoard(panel, mockBoard);

    panel.setDpadInput('dpad1', 'up', true);
    assert.equal(calls[0].value, 1.0); // (1 + 1) / 2

    panel.setDpadInput('dpad1', 'down', true);
    assert.equal(calls[1].value, 0.5); // both pressed, (0 + 1) / 2

    binding.dispose();
  });
});
