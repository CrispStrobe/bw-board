/**
 * Controller panel engine tests.
 *
 * Widget model, state, persistence, binding, and the program-facing API.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerPanel, WIDGET_TYPES, DECORATION_TYPES } from '../src/controller.js';
import { bindPanelToBoard, createControllerDriver, bindPanelToVariables } from '../src/controller-binding.js';
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

// ─── D-pad widget ──────────────────────────────────────────────────────────

describe('ControllerPanel: D-pad widget', () => {
  it('adds a dpad with default state (all false)', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('dpad1', 'dpad');
    assert.equal(w.type, 'dpad');
    assert.equal(w.state.up, false);
    assert.equal(w.state.down, false);
    assert.equal(w.state.left, false);
    assert.equal(w.state.right, false);
  });

  it('setDpadInput sets and rejects invalid direction', () => {
    const p = new ControllerPanel();
    p.addWidget('dpad1', 'dpad');
    p.setDpadInput('dpad1', 'up', true);
    assert.equal(p.getWidget('dpad1').state.up, true);
    assert.throws(() => p.setDpadInput('dpad1', 'diagonal', true), /Invalid/);
  });

  it('getValue returns bitmask (up=1 down=2 left=4 right=8)', () => {
    const p = new ControllerPanel();
    p.addWidget('dpad1', 'dpad');
    p.setDpadInput('dpad1', 'up', true);
    p.setDpadInput('dpad1', 'right', true);
    assert.equal(p.getValue('dpad1'), 1 | 8); // 9
  });

  it('getX/getY map to -1/0/1', () => {
    const p = new ControllerPanel();
    p.addWidget('dpad1', 'dpad');
    p.setDpadInput('dpad1', 'right', true);
    assert.equal(p.getX('dpad1'), 1);
    assert.equal(p.getY('dpad1'), 0);
    p.setDpadInput('dpad1', 'up', true);
    assert.equal(p.getY('dpad1'), 1);
  });

  it('isPressed returns true if any direction held', () => {
    const p = new ControllerPanel();
    p.addWidget('dpad1', 'dpad');
    assert.equal(p.isPressed('dpad1'), false);
    p.setDpadInput('dpad1', 'left', true);
    assert.equal(p.isPressed('dpad1'), true);
  });

  it('resets on play mode', () => {
    const p = new ControllerPanel();
    p.addWidget('dpad1', 'dpad');
    p.getWidget('dpad1').state.up = true;
    p.setMode('play');
    assert.equal(p.getWidget('dpad1').state.up, false);
  });

  it('persists via toJSON/fromJSON', () => {
    const p = new ControllerPanel();
    p.addWidget('dpad1', 'dpad', {}, { x: 5, y: 10 });
    p.bindToPart('dpad1', 'sw1', 'x');
    const json = p.toJSON();
    const p2 = ControllerPanel.fromJSON(json);
    const w = p2.getWidget('dpad1');
    assert.equal(w.type, 'dpad');
    assert.deepEqual(w.binding, { target: 'part', partId: 'sw1', param: 'x' });
    assert.equal(w.layout.x, 5);
  });
});

// ─── Gauge widget ──────────────────────────────────────────────────────────

describe('ControllerPanel: gauge (read-only indicator)', () => {
  it('adds a gauge with default config', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('meter', 'gauge', { min: 0, max: 5, label: 'V' });
    assert.equal(w.type, 'gauge');
    assert.equal(w.config.label, 'V');
    assert.equal(w.state.value, 0);
  });

  it('setGaugeValue clamps to [min, max]', () => {
    const p = new ControllerPanel();
    p.addWidget('meter', 'gauge', { min: 0, max: 100 });
    p.setGaugeValue('meter', 50);
    assert.equal(p.getValue('meter'), 50);
    p.setGaugeValue('meter', 200);
    assert.equal(p.getValue('meter'), 100);
    p.setGaugeValue('meter', -10);
    assert.equal(p.getValue('meter'), 0);
  });

  it('setGaugeValue rejects non-gauge', () => {
    const p = new ControllerPanel();
    p.addWidget('btn', 'button');
    assert.throws(() => p.setGaugeValue('btn', 42));
  });

  it('gauge does NOT drive board.setControl (read-only)', () => {
    const p = new ControllerPanel();
    p.addWidget('meter', 'gauge', { min: 0, max: 100 });
    p.bindToPart('meter', 'pot1');

    const calls = [];
    const mockBoard = { setControl(id, v) { calls.push({ id, v }); } };
    const bridge = bindPanelToBoard(p, mockBoard);

    p.setGaugeValue('meter', 50);
    assert.equal(calls.length, 0);

    bridge.dispose();
  });

  it('persists with pin binding', () => {
    const p = new ControllerPanel();
    p.addWidget('meter', 'gauge', { min: 0, max: 5, label: 'V' }, { x: 20, y: 30 });
    p.bindToPin('meter', 'P1.3');

    const json = p.toJSON();
    const p2 = ControllerPanel.fromJSON(json);
    const w = p2.getWidget('meter');
    assert.equal(w.type, 'gauge');
    assert.equal(w.config.max, 5);
    assert.deepEqual(w.binding, { target: 'pin', pinName: 'P1.3' });
  });
});

// ─── Pin and variable bindings ─────────────────────────────────────────────

describe('ControllerPanel: pin binding', () => {
  it('bindToPin stores target=pin', () => {
    const p = new ControllerPanel();
    p.addWidget('sl', 'slider', { min: 0, max: 255 });
    p.bindToPin('sl', 'P1.0');
    assert.deepEqual(p.getWidget('sl').binding, { target: 'pin', pinName: 'P1.0' });
  });

  it('pin-bound slider calls board.writePin', () => {
    const p = new ControllerPanel();
    p.addWidget('sl', 'slider', { min: 0, max: 100 });
    p.bindToPin('sl', 'P1.0');

    const calls = [];
    const mockBoard = {
      setControl() {},
      writePin(pin, val) { calls.push({ pin, val }); },
    };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setSliderInput('sl', 50);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pin, 'P1.0');
    assert.equal(calls[0].val, 0.5);
    bridge.dispose();
  });

  it('pin-bound joystick calls board.writePin', () => {
    const p = new ControllerPanel();
    p.addWidget('joy', 'joystick');
    p.bindToPin('joy', 'P1.3');

    const calls = [];
    const mockBoard = {
      setControl() {},
      writePin(pin, val) { calls.push({ pin, val }); },
    };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setJoystickInput('joy', 100, 0);
    assert.equal(calls[0].pin, 'P1.3');
    assert.equal(calls[0].val, 1.0);
    bridge.dispose();
  });

  it('pin binding round-trips', () => {
    const p = new ControllerPanel();
    p.addWidget('sl', 'slider');
    p.bindToPin('sl', 'P2.5');
    const p2 = ControllerPanel.fromJSON(p.toJSON());
    assert.deepEqual(p2.getWidget('sl').binding, { target: 'pin', pinName: 'P2.5' });
  });
});

describe('ControllerPanel: variable binding', () => {
  it('bindToVariable stores target=variable', () => {
    const p = new ControllerPanel();
    p.addWidget('sl', 'slider');
    p.bindToVariable('sl', 'speed');
    assert.deepEqual(p.getWidget('sl').binding, { target: 'variable', variableName: 'speed' });
  });

  it('variable-bound gauge persists', () => {
    const p = new ControllerPanel();
    p.addWidget('meter', 'gauge', { min: 0, max: 100, label: 'RPM' });
    p.bindToVariable('meter', 'motor_speed');
    const p2 = ControllerPanel.fromJSON(p.toJSON());
    assert.deepEqual(p2.getWidget('meter').binding, { target: 'variable', variableName: 'motor_speed' });
  });

  it('variable-bound widgets do not call board methods', () => {
    const p = new ControllerPanel();
    p.addWidget('sl', 'slider', { min: 0, max: 100 });
    p.bindToVariable('sl', 'level');

    const calls = [];
    const mockBoard = {
      setControl(id, v) { calls.push(id); },
      writePin(pin, v) { calls.push(pin); },
    };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setSliderInput('sl', 50);
    assert.equal(calls.length, 0);
    bridge.dispose();
  });
});

// ─── Steering widgets: full persistence round-trip ─────────────────────────

describe('Steering widgets: joystick + slider + gauge save/load', () => {
  it('all three survive with mixed bindings', () => {
    const orig = new ControllerPanel();
    orig.addWidget('joy1', 'joystick', {}, { x: 10, y: 10 });
    orig.bindToPin('joy1', 'P1.3');
    orig.addWidget('speed', 'slider', { min: 0, max: 255 }, { x: 120, y: 10 });
    orig.bindToVariable('speed', 'motor_pwm');
    orig.addWidget('volts', 'gauge', { min: 0, max: 5, label: 'V' }, { x: 10, y: 100 });
    orig.bindToPin('volts', 'P1.7');

    const data = orig.toJSON();
    const live = new ControllerPanel();
    live.addWidget('stale', 'button'); // will be replaced
    const restored = ControllerPanel.fromJSON(data);
    for (const name of live.getWidgetNames()) live.removeWidget(name);
    for (const w of restored.getWidgets()) {
      const a = live.addWidget(w.name, w.type, w.config, w.layout);
      if (w.binding) a.binding = { ...w.binding };
    }

    assert.equal(live.getWidget('stale'), null);
    assert.deepEqual(live.getWidgetNames(), ['joy1', 'speed', 'volts']);
    assert.deepEqual(live.getWidget('joy1').binding, { target: 'pin', pinName: 'P1.3' });
    assert.deepEqual(live.getWidget('speed').binding, { target: 'variable', variableName: 'motor_pwm' });
    assert.deepEqual(live.getWidget('volts').binding, { target: 'pin', pinName: 'P1.7' });
    assert.equal(live.getWidget('volts').config.label, 'V');
  });

  it('restored bindings drive board after round-trip', () => {
    const orig = new ControllerPanel();
    orig.addWidget('joy1', 'joystick');
    orig.bindToPin('joy1', 'P1.0');
    orig.addWidget('sl', 'slider', { min: 0, max: 100 });
    orig.bindToPart('sl', 'pot1');
    orig.addWidget('meter', 'gauge', { min: 0, max: 100 });
    orig.bindToPin('meter', 'P1.5');

    const live = ControllerPanel.fromJSON(orig.toJSON());

    const pinCalls = [];
    const partCalls = [];
    const mockBoard = {
      setControl(id, v) { partCalls.push({ id, v }); },
      writePin(pin, v) { pinCalls.push({ pin, v }); },
    };
    const bridge = bindPanelToBoard(live, mockBoard);

    live.setJoystickInput('joy1', 50, 0);
    assert.equal(pinCalls.length, 1);
    assert.equal(pinCalls[0].pin, 'P1.0');

    live.setSliderInput('sl', 50);
    assert.equal(partCalls.length, 1);
    assert.equal(partCalls[0].id, 'pot1');

    live.setGaugeValue('meter', 75);
    assert.equal(pinCalls.length, 1); // gauge is read-only
    assert.equal(partCalls.length, 1);

    bridge.dispose();
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

// ── Matrix display widget — the faceplate triplet's display primitive.
// Read-only like the gauge: the program writes a variable, the binding pumps
// it into the widget; the face renders the bitmask. Upstreamed with the
// micro:bit-matrix reference triplet (2026-08-19).

describe('ControllerPanel — matrix display widget', () => {
  it('adds a matrix with 5x5 defaults and zero state', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('scr', 'matrix');
    assert.equal(w.type, 'matrix');
    assert.equal(w.config.rows, 5);
    assert.equal(w.config.cols, 5);
    assert.equal(w.state.value, 0);
  });

  it('setMatrixValue stores the bitmask and emits input', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'matrix');
    const events = [];
    p.addListener((e, d) => { if (e === 'input') events.push(d); });
    p.setMatrixValue('scr', 0b101);
    assert.equal(p.getValue('scr'), 5);
    assert.deepEqual(events, [{ name: 'scr', value: 5 }]);
  });

  it('masks the bitmask to rows*cols bits and coerces junk to 0', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'matrix', { rows: 2, cols: 2 });
    p.setMatrixValue('scr', 0b10111);   // 5 bits into a 4-cell matrix
    assert.equal(p.getValue('scr'), 0b0111);
    p.setMatrixValue('scr', 'garbage');
    assert.equal(p.getValue('scr'), 0);
  });

  it('rejects setMatrixValue on a non-matrix widget', () => {
    const p = new ControllerPanel();
    p.addWidget('g', 'gauge');
    assert.throws(() => p.setMatrixValue('g', 1), /matrix/);
  });

  it('persists via toJSON/fromJSON with binding', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'matrix', {}, { x: 1, y: 2 });
    p.getWidget('scr').binding = { target: 'variable', variableName: 'screen' };
    const r = ControllerPanel.fromJSON(p.toJSON());
    const w = r.getWidget('scr');
    assert.equal(w.type, 'matrix');
    assert.deepEqual(w.binding, { target: 'variable', variableName: 'screen' });
  });
});

// ── Widget layout model + decorations (the widgets-editor campaign) ────────

describe('ControllerPanel — layout model (move/resize/rotate/colour/label)', () => {
  it('addWidget keeps every layout field verbatim', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('j', 'joystick', {}, { x: 8, y: 16, w: 120, h: 90, rotation: 15, color: '#f00', label: 'Steer' });
    assert.deepEqual(w.layout, { x: 8, y: 16, w: 120, h: 90, rotation: 15, color: '#f00', label: 'Steer' });
  });

  it('setWidgetLayout merges and emits layout', () => {
    const p = new ControllerPanel();
    p.addWidget('j', 'joystick', {}, { x: 8, y: 16 });
    const events = [];
    p.addListener((e, d) => { if (e === 'layout') events.push(d); });
    p.setWidgetLayout('j', { w: 200, rotation: 30 });
    assert.deepEqual(p.getWidget('j').layout, { x: 8, y: 16, w: 200, rotation: 30 });
    assert.deepEqual(events, [{ name: 'j' }]);
  });

  it('layout fields survive toJSON/fromJSON round-trip', () => {
    const p = new ControllerPanel();
    p.addWidget('j', 'joystick', {}, { x: 8, y: 16, w: 120, rotation: 45, color: '#0f0', label: 'L' });
    const r = ControllerPanel.fromJSON(p.toJSON());
    assert.deepEqual(r.getWidget('j').layout, { x: 8, y: 16, w: 120, rotation: 45, color: '#0f0', label: 'L' });
  });

  it('layout.{x,y} never touches a joystick state.{x,y} (input vs placement)', () => {
    const p = new ControllerPanel();
    p.addWidget('j', 'joystick', {}, { x: 50, y: 60 });
    p.setJoystickInput('j', -30, 70);
    assert.equal(p.getWidget('j').state.x, -30);
    assert.equal(p.getWidget('j').layout.x, 50);
    p.setWidgetLayout('j', { x: 99 });
    assert.equal(p.getWidget('j').state.x, -30, 'input untouched by placement');
  });

  it('renameWidget preserves binding + layout, refuses collisions/empties', () => {
    const p = new ControllerPanel();
    p.addWidget('a', 'button', {}, { x: 1, color: '#00f' });
    p.addWidget('b', 'button');
    p.bindToVariable('a', 'btnA');
    p.renameWidget('a', 'fire');
    assert.equal(p.getWidget('a'), null);
    const w = p.getWidget('fire');
    assert.deepEqual(w.binding, { target: 'variable', variableName: 'btnA' });
    assert.equal(w.layout.color, '#00f');
    assert.throws(() => p.renameWidget('fire', 'b'), /already exists/);
    assert.throws(() => p.renameWidget('fire', '  '), /empty/);
    // paint order preserved: fire stays first
    assert.deepEqual(p.getWidgetNames(), ['fire', 'b']);
  });
});

describe('ControllerPanel — decoration widgets (text/image)', () => {
  it('text and image exist with defaults and are DECORATION_TYPES', () => {
    const p = new ControllerPanel();
    const tw = p.addWidget('t', 'text');
    const iw = p.addWidget('i', 'image');
    assert.equal(tw.config.text, 'Label');
    assert.equal(iw.config.src, '');
    assert.ok(DECORATION_TYPES.has('text') && DECORATION_TYPES.has('image'));
    assert.equal(p.getValue('t'), 0);
  });

  it('decorations survive persistence with config + layout', () => {
    const p = new ControllerPanel();
    p.addWidget('t', 'text', { text: 'Hello', fontSize: 24, color: '#123456' }, { x: 5, y: 6, rotation: 10 });
    p.addWidget('i', 'image', { src: 'data:image/png;base64,AAAA' }, { w: 80, h: 60 });
    const r = ControllerPanel.fromJSON(p.toJSON());
    assert.equal(r.getWidget('t').config.text, 'Hello');
    assert.equal(r.getWidget('t').layout.rotation, 10);
    assert.equal(r.getWidget('i').config.src, 'data:image/png;base64,AAAA');
    assert.equal(r.getWidget('i').layout.h, 60);
  });

  it('the variable binding layer skips decorations entirely', () => {
    const p = new ControllerPanel();
    p.addWidget('t', 'text');
    p.bindToVariable('t', 'oops');   // a user CAN mis-bind; the layer must ignore it
    const vars = { id_oops: { name: 'oops', value: 7 } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars,
        lookupVariableByNameAndType: (n) => Object.values(vars).find((v) => v.name === n) || null }) } };
    const b = bindPanelToVariables(p, vm, { autoPump: false });
    b.pump();
    assert.equal(vars.id_oops.value, 7, 'pump never wrote through a decoration');
    p._emit('input', { name: 't' });
    assert.equal(vars.id_oops.value, 7, 'input path never wrote either');
    b.dispose();
  });
});

describe('ControllerPanel — setWidgetConfig', () => {
  it('merges config and emits config (text decoration editing)', () => {
    const p = new ControllerPanel();
    p.addWidget('t', 'text');
    const events = [];
    p.addListener((e, d) => { if (e === 'config') events.push(d); });
    p.setWidgetConfig('t', { text: 'Hello', fontSize: 24 });
    assert.equal(p.getWidget('t').config.text, 'Hello');
    assert.equal(p.getWidget('t').config.color, '#334155', 'unpatched fields keep defaults');
    assert.deepEqual(events, [{ name: 't' }]);
  });
});

describe('ControllerPanel — sevenseg display widget', () => {
  it('adds a sevenseg with 4-digit defaults and zero state', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('num', 'sevenseg');
    assert.equal(w.type, 'sevenseg');
    assert.equal(w.config.digits, 4);
    assert.equal(w.state.value, 0);
  });

  it('setSevenSegValue stores the number and emits input', () => {
    const p = new ControllerPanel();
    p.addWidget('num', 'sevenseg');
    const events = [];
    p.addListener((e, d) => { if (e === 'input') events.push(d); });
    p.setSevenSegValue('num', 42);
    assert.equal(p.getValue('num'), 42);
    p.setSevenSegValue('num', -7.9);
    assert.equal(p.getValue('num'), -7.9);   // raw store; the FACE truncates
    assert.equal(events.length, 2);
  });

  it('coerces junk to 0 and rejects wrong widget type', () => {
    const p = new ControllerPanel();
    p.addWidget('num', 'sevenseg');
    p.setSevenSegValue('num', 'garbage');
    assert.equal(p.getValue('num'), 0);
    p.addWidget('g', 'gauge');
    assert.throws(() => p.setSevenSegValue('g', 1), /sevenseg/);
  });

  it('persists via toJSON/fromJSON with binding', () => {
    const p = new ControllerPanel();
    p.addWidget('num', 'sevenseg', { digits: 8 }, { x: 3, y: 0 });
    p.getWidget('num').binding = { target: 'variable', variableName: 'shown' };
    const r = ControllerPanel.fromJSON(p.toJSON());
    const w = r.getWidget('num');
    assert.equal(w.type, 'sevenseg');
    assert.equal(w.config.digits, 8);
    assert.deepEqual(w.binding, { target: 'variable', variableName: 'shown' });
  });

  // Regression: the pump must dispatch sevenseg like gauge/matrix/lcd. The
  // sevenseg type shipped with isDisplay + setSevenSegValue but the pump's
  // setter dispatch had no sevenseg branch, so a bound sevenseg face never
  // updated — caught only by the pump-path test, not the direct-setter tests.
  it('a bound sevenseg follows its variable through the pump', () => {
    const p = new ControllerPanel();
    p.addWidget('num', 'sevenseg');
    p.bindToVariable('num', 'shown');
    const vars = { id_shown: { name: 'shown', value: 0 } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars,
        lookupVariableByNameAndType: (n) => Object.values(vars).find((v) => v.name === n) || null }) } };
    const b = bindPanelToVariables(p, vm, { autoPump: false });
    b.pump();
    assert.equal(p.getValue('num'), 0);
    vars.id_shown.value = 168;
    b.pump();
    assert.equal(p.getValue('num'), 168, 'pump wrote the variable into the sevenseg face');
    b.dispose();
  });
});

describe('ControllerPanel — oled display widget', () => {
  it('adds an oled with default rows/cols and empty text', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('scr', 'oled');
    assert.equal(w.type, 'oled');
    assert.equal(w.config.rows, 4);
    assert.equal(w.config.cols, 21);
    assert.equal(w.state.text, '');
  });

  it('setOledText stores text and getOledRows pads/clips to rows x cols', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'oled', { rows: 2, cols: 5 });
    const events = [];
    p.addListener((e, d) => { if (e === 'input') events.push(d); });
    p.setOledText('scr', 'HELLO WORLD\nHI');
    assert.equal(p.getValue('scr'), 'HELLO WORLD\nHI');
    assert.deepEqual(p.getOledRows('scr'), ['HELLO', 'HI   ']);  // clipped + padded
    assert.equal(events.length, 1);
    assert.throws(() => p.setOledText('nope', 'x'), /not found|oled/);
  });

  it('a bound oled follows its variable through the pump (regression)', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'oled', { rows: 2, cols: 8 });
    p.bindToVariable('scr', 'display');
    const vars = { id_display: { name: 'display', value: '' } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars,
        lookupVariableByNameAndType: (n) => Object.values(vars).find((v) => v.name === n) || null }) } };
    const b = bindPanelToVariables(p, vm, { autoPump: false });
    b.pump();
    assert.equal(p.getValue('scr'), '');
    vars.id_display.value = '12 + 3\n= 15';
    b.pump();
    assert.equal(p.getValue('scr'), '12 + 3\n= 15', 'pump wrote the variable into the oled face');
    b.dispose();
  });
});

// ─── Bargraph widget ───────────────────────────────────────────────────────

describe('ControllerPanel — bargraph widget', () => {
  it('adds with defaults and clamps to [min, max]', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('bar', 'bargraph', { min: 0, max: 100 });
    assert.equal(w.type, 'bargraph');
    assert.equal(w.state.value, 0);
    p.setBargraphValue('bar', 50);
    assert.equal(p.getValue('bar'), 50);
    p.setBargraphValue('bar', 200);
    assert.equal(p.getValue('bar'), 100);
    p.setBargraphValue('bar', -10);
    assert.equal(p.getValue('bar'), 0);
  });

  it('is a display — does NOT drive board.setControl', () => {
    const p = new ControllerPanel();
    p.addWidget('bar', 'bargraph');
    p.bindToPart('bar', 'pot1');
    const calls = [];
    const mock = { setControl(id, v) { calls.push(id); } };
    const b = bindPanelToBoard(p, mock);
    p.setBargraphValue('bar', 50);
    assert.equal(calls.length, 0);
    b.dispose();
  });

  it('persists via toJSON/fromJSON', () => {
    const p = new ControllerPanel();
    p.addWidget('bar', 'bargraph', { min: 0, max: 200, segments: 20 }, { x: 5 });
    p.bindToVariable('bar', 'level');
    const r = ControllerPanel.fromJSON(p.toJSON());
    const w = r.getWidget('bar');
    assert.equal(w.type, 'bargraph');
    assert.equal(w.config.max, 200);
    assert.equal(w.config.segments, 20);
    assert.deepEqual(w.binding, { target: 'variable', variableName: 'level' });
  });

  it('variable pump drives bargraph', () => {
    const p = new ControllerPanel();
    p.addWidget('bar', 'bargraph', { min: 0, max: 100 });
    p.bindToVariable('bar', 'level');
    const vars = { id_level: { name: 'level', value: 75 } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars,
        lookupVariableByNameAndType: (n) => Object.values(vars).find(v => v.name === n) || null }) } };
    const b = bindPanelToVariables(p, vm, { autoPump: false });
    b.pump();
    assert.equal(p.getValue('bar'), 75);
    b.dispose();
  });
});

// ─── SimpleVGA widget ──────────────────────────────────────────────────────

describe('ControllerPanel — simplevga widget', () => {
  it('draws and clears pixels', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'simplevga', { width: 4, height: 3 });
    p.setVgaPixel('scr', 1, 2, 5);
    assert.equal(p.getWidget('scr').state.buffer[2 * 4 + 1], 5);
    p.clearVga('scr');
    assert.equal(p.getWidget('scr').state.buffer[2 * 4 + 1], 0);
  });

  it('clamps out-of-bounds pixels (no crash)', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'simplevga', { width: 4, height: 3 });
    p.setVgaPixel('scr', -1, 0, 1);
    p.setVgaPixel('scr', 4, 0, 1);
    p.setVgaPixel('scr', 0, 3, 1);
    // buffer never allocated because all were out of bounds
    assert.equal(p.getWidget('scr').state.buffer, null);
  });

  it('persists via toJSON/fromJSON', () => {
    const p = new ControllerPanel();
    p.addWidget('scr', 'simplevga', { width: 8, height: 6 });
    p.bindToVariable('scr', 'fb');
    const r = ControllerPanel.fromJSON(p.toJSON());
    assert.equal(r.getWidget('scr').config.width, 8);
    assert.deepEqual(r.getWidget('scr').binding, { target: 'variable', variableName: 'fb' });
  });
});

// ─── Mono LCD widget ───────────────────────────────────────────────────────

describe('ControllerPanel — mono_lcd widget', () => {
  it('sets pixels in a bit-packed buffer', () => {
    const p = new ControllerPanel();
    p.addWidget('lcd', 'mono_lcd', { width: 16, height: 8 });
    p.setMonoLcdPixel('lcd', 3, 0, true);
    const buf = p.getWidget('lcd').state.buffer;
    assert.equal((buf[0] >> 3) & 1, 1);
    p.setMonoLcdPixel('lcd', 3, 0, false);
    assert.equal((buf[0] >> 3) & 1, 0);
  });

  it('sets and clears text', () => {
    const p = new ControllerPanel();
    p.addWidget('lcd', 'mono_lcd', { width: 100, height: 64 });
    p.setMonoLcdText('lcd', 'Hello');
    assert.equal(p.getValue('lcd'), 'Hello');
    p.clearMonoLcd('lcd');
    assert.equal(p.getValue('lcd'), '');
  });

  it('persists via toJSON/fromJSON', () => {
    const p = new ControllerPanel();
    p.addWidget('lcd', 'mono_lcd', { width: 178, height: 128 });
    p.bindToVariable('lcd', 'display');
    const r = ControllerPanel.fromJSON(p.toJSON());
    assert.equal(r.getWidget('lcd').type, 'mono_lcd');
    assert.deepEqual(r.getWidget('lcd').binding, { target: 'variable', variableName: 'display' });
  });

  it('variable pump drives mono_lcd text', () => {
    const p = new ControllerPanel();
    p.addWidget('lcd', 'mono_lcd');
    p.bindToVariable('lcd', 'display');
    const vars = { id_d: { name: 'display', value: 'Row1' } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars,
        lookupVariableByNameAndType: (n) => Object.values(vars).find(v => v.name === n) || null }) } };
    const b = bindPanelToVariables(p, vm, { autoPump: false });
    b.pump();
    assert.equal(p.getValue('lcd'), 'Row1');
    b.dispose();
  });
});

// ─── RGB light widget ──────────────────────────────────────────────────────

describe('ControllerPanel — rgb_light widget', () => {
  it('sets color as 24-bit RGB', () => {
    const p = new ControllerPanel();
    p.addWidget('led', 'rgb_light');
    p.setRgbLightColor('led', 0xFF00FF);
    assert.equal(p.getValue('led'), 0xFF00FF);
  });

  it('masks to 24 bits', () => {
    const p = new ControllerPanel();
    p.addWidget('led', 'rgb_light');
    p.setRgbLightColor('led', 0x1FFFFFF);
    assert.equal(p.getValue('led'), 0xFFFFFF);
  });

  it('is a display — does NOT drive board.setControl', () => {
    const p = new ControllerPanel();
    p.addWidget('led', 'rgb_light');
    p.bindToPart('led', 'led1');
    const calls = [];
    const mock = { setControl(id, v) { calls.push(id); } };
    const b = bindPanelToBoard(p, mock);
    p.setRgbLightColor('led', 0xFF0000);
    assert.equal(calls.length, 0);
    b.dispose();
  });

  it('persists via toJSON/fromJSON', () => {
    const p = new ControllerPanel();
    p.addWidget('led', 'rgb_light', { mode: 'rgb' });
    p.bindToVariable('led', 'color');
    const r = ControllerPanel.fromJSON(p.toJSON());
    assert.equal(r.getWidget('led').type, 'rgb_light');
    assert.deepEqual(r.getWidget('led').binding, { target: 'variable', variableName: 'color' });
  });

  it('variable pump drives rgb_light', () => {
    const p = new ControllerPanel();
    p.addWidget('led', 'rgb_light');
    p.bindToVariable('led', 'color');
    const vars = { id_c: { name: 'color', value: 0x00FF00 } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars,
        lookupVariableByNameAndType: (n) => Object.values(vars).find(v => v.name === n) || null }) } };
    const b = bindPanelToVariables(p, vm, { autoPump: false });
    b.pump();
    assert.equal(p.getValue('led'), 0x00FF00);
    b.dispose();
  });
});

// ─── Keyboard widget ───────────────────────────────────────────────────────

describe('ControllerPanel — keyboard widget', () => {
  it('pushes keys into FIFO and reads them back', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    p.pushKeyboardKey('kb', 65);
    p.pushKeyboardKey('kb', 66);
    assert.equal(p.getValue('kb'), 66);
    assert.equal(p.readKeyboardKey('kb'), 65);
    assert.equal(p.readKeyboardKey('kb'), 66);
    assert.equal(p.readKeyboardKey('kb'), 0);
  });

  it('masks key codes to 0..255', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    p.pushKeyboardKey('kb', 300);
    assert.equal(p.getValue('kb'), 300 & 0xFF);
  });

  it('persists via toJSON/fromJSON', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    p.bindToVariable('kb', 'input_line');
    const r = ControllerPanel.fromJSON(p.toJSON());
    assert.equal(r.getWidget('kb').type, 'keyboard');
    assert.deepEqual(r.getWidget('kb').binding, { target: 'variable', variableName: 'input_line' });
  });

  it('variable binding appends printable chars to string', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    p.bindToVariable('kb', 'line');
    const vars = { id_l: { name: 'line', value: '' } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars,
        lookupVariableByNameAndType: (n) => Object.values(vars).find(v => v.name === n) || null }) } };
    const b = bindPanelToVariables(p, vm, { autoPump: false });
    p.pushKeyboardKey('kb', 72);
    p.pushKeyboardKey('kb', 105);
    assert.equal(vars.id_l.value, 'Hi');
    b.dispose();
  });

  it('hasKeyboardInput returns true when FIFO non-empty, false when empty', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    assert.equal(p.hasKeyboardInput('kb'), false);
    p.pushKeyboardKey('kb', 65);
    assert.equal(p.hasKeyboardInput('kb'), true);
    p.readKeyboardKey('kb'); // consume
    assert.equal(p.hasKeyboardInput('kb'), false);
  });

  it('FIFO is lossless and in-order under rapid input', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    const input = 'Hello, World!';
    for (const ch of input) p.pushKeyboardKey('kb', ch.charCodeAt(0));
    let result = '';
    while (p.hasKeyboardInput('kb')) {
      result += String.fromCharCode(p.readKeyboardKey('kb'));
    }
    assert.equal(result, input);
    assert.equal(p.readKeyboardKey('kb'), 0); // empty
  });

  it('play-mode reset clears the FIFO', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    p.pushKeyboardKey('kb', 65);
    assert.equal(p.hasKeyboardInput('kb'), true);
    p.setMode('play');
    assert.equal(p.hasKeyboardInput('kb'), false);
    assert.equal(p.readKeyboardKey('kb'), 0);
  });

  it('getValue returns lastKey (non-consuming peek)', () => {
    const p = new ControllerPanel();
    p.addWidget('kb', 'keyboard');
    p.pushKeyboardKey('kb', 65);
    p.pushKeyboardKey('kb', 66);
    // getValue returns lastKey (66), does NOT consume FIFO
    assert.equal(p.getValue('kb'), 66);
    assert.equal(p.getValue('kb'), 66); // still 66
    // FIFO still has both entries
    assert.equal(p.readKeyboardKey('kb'), 65);
    assert.equal(p.readKeyboardKey('kb'), 66);
  });
});
