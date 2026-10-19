/**
 * Controller panel integration tests.
 *
 * End-to-end: panel → binding → board → extension reporter readback.
 * Stage-view descriptor lifecycle. Extension getInfo shape contract.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { ControllerPanel } from '../src/controller.js';
import { bindPanelToBoard, createControllerDriver } from '../src/controller-binding.js';
import { ControllerExtension } from '../src/controller-extension.js';
import { createControllerStageView, WIDGET_RENDER_INFO } from '../src/controller-stage-view.js';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

// ─── Helper: minimal board with a potentiometer and a switch ──────────────

function makeBoard() {
  return new BoardImpl({
    nets: ['vcc', 'gnd', 'n1', 'n2', 'n3'],
    parts: [
      { id: 'pot1', type: 'potentiometer', value: 10000,
        pins: { a: 'vcc', b: 'n1', w: 'n2' } },
      { id: 'sw1', type: 'switch',
        pins: { a: 'n2', b: 'n3' } },
    ],
    vcc: 'vcc',
    gnd: 'gnd',
  });
}

// ─── Extension getInfo shape ──────────────────────────────────────────────

describe('ControllerExtension: getInfo contract', () => {

  // Scratch object stub — extension reads BlockType/ArgumentType from global
  const origScratch = globalThis.Scratch;
  const ScratchStub = {
    BlockType: { REPORTER: 'reporter', BOOLEAN: 'Boolean', COMMAND: 'command' },
    ArgumentType: { STRING: 'string', NUMBER: 'number' },
    extensions: { register() {} },
  };

  it('getInfo returns expected block opcodes', () => {
    globalThis.Scratch = ScratchStub;
    try {
      const ext = new ControllerExtension();
      const info = ext.getInfo();
      assert.equal(info.id, 'controller');
      const opcodes = info.blocks
        .filter(b => typeof b === 'object')
        .map(b => b.opcode);
      assert.deepEqual(opcodes, [
        'controllerValue', 'controllerX', 'controllerY',
        'controllerPressed', 'setWidget', 'setBargraphLevel',
        'vgaDrawPixel', 'vgaClear',
        'monoLcdPixel', 'monoLcdText', 'monoLcdClear',
        'setRgbLight', 'readKeyboard', 'keyboardHasInput',
      ]);
    } finally {
      globalThis.Scratch = origScratch;
    }
  });

  it('getInfo block types match RUNTIME_EXTENSIONS kinds', () => {
    globalThis.Scratch = ScratchStub;
    try {
      const ext = new ControllerExtension();
      const info = ext.getInfo();
      const byOpcode = {};
      for (const b of info.blocks) {
        if (typeof b === 'object') byOpcode[b.opcode] = b;
      }
      // Reporters
      assert.equal(byOpcode.controllerValue.blockType, 'reporter');
      assert.equal(byOpcode.controllerX.blockType, 'reporter');
      assert.equal(byOpcode.controllerY.blockType, 'reporter');
      // Boolean
      assert.equal(byOpcode.controllerPressed.blockType, 'Boolean');
      // Command
      assert.equal(byOpcode.setWidget.blockType, 'command');
    } finally {
      globalThis.Scratch = origScratch;
    }
  });

  it('dynamic menu returns widget names from panel', () => {
    globalThis.Scratch = ScratchStub;
    try {
      const ext = new ControllerExtension();
      const panel = new ControllerPanel();
      panel.addWidget('slider1', 'slider');
      panel.addWidget('joy1', 'joystick');
      ext.setPanel(panel);
      const items = ext._getWidgetMenu();
      assert.deepEqual(items.map(i => i.value), ['slider1', 'joy1']);
    } finally {
      globalThis.Scratch = origScratch;
    }
  });

  it('dynamic menu shows placeholder when no panel', () => {
    globalThis.Scratch = ScratchStub;
    try {
      const ext = new ControllerExtension();
      const items = ext._getWidgetMenu();
      assert.equal(items.length, 1);
      assert.equal(items[0].value, '');
    } finally {
      globalThis.Scratch = origScratch;
    }
  });
});

// ─── End-to-end: slider → pot → reporter readback ─────────────────────────

describe('End-to-end: slider → board → extension reporter', () => {

  it('slider input propagates through binding to board and reads back via extension', () => {
    const panel = new ControllerPanel();
    panel.addWidget('vol', 'slider', { min: 0, max: 100 });
    panel.bindToPart('vol', 'pot1');

    const board = makeBoard();
    const binding = bindPanelToBoard(panel, board);
    binding.sync();

    // Set slider to 75 → pot position should be 0.75
    panel.setSliderInput('vol', 75);

    // Verify board received the control (pot position stored as control value)
    assert.equal(board.controls.get('pot1'), 0.75);

    // Verify extension reporter reads back the slider value
    const ext = new ControllerExtension();
    ext.setPanel(panel);
    assert.equal(ext.controllerValue({ NAME: 'vol' }), 75);

    // Verify driver readback matches
    const driver = createControllerDriver(panel);
    assert.equal(driver.controllerValue('vol'), 75);

    binding.dispose();
  });

  it('button → switch binding: press propagates, extension reads pressed', () => {
    const panel = new ControllerPanel();
    panel.addWidget('fire', 'button');
    panel.bindToPart('fire', 'sw1');

    const board = makeBoard();
    const binding = bindPanelToBoard(panel, board);

    // Press button — switch control value becomes 1
    panel.setButtonInput('fire', true);
    assert.equal(board.controls.get('sw1'), 1);

    // Extension reads pressed
    const ext = new ControllerExtension();
    ext.setPanel(panel);
    assert.equal(ext.controllerPressed({ NAME: 'fire' }), true);
    assert.equal(ext.controllerValue({ NAME: 'fire' }), 1);

    // Release
    panel.setButtonInput('fire', false);
    assert.equal(ext.controllerPressed({ NAME: 'fire' }), false);
    assert.equal(ext.controllerValue({ NAME: 'fire' }), 0);

    binding.dispose();
  });

  it('joystick axes read back through extension reporters', () => {
    const panel = new ControllerPanel();
    panel.addWidget('stick', 'joystick');

    panel.setJoystickInput('stick', 50, -30);

    const ext = new ControllerExtension();
    ext.setPanel(panel);
    assert.equal(ext.controllerX({ NAME: 'stick' }), 50);
    assert.equal(ext.controllerY({ NAME: 'stick' }), -30);
    // Magnitude = sqrt(50² + 30²) ≈ 58
    assert.equal(ext.controllerValue({ NAME: 'stick' }), 58);
  });

  it('setWidget command drives slider from program side', () => {
    globalThis.Scratch = {
      BlockType: { REPORTER: 'reporter', BOOLEAN: 'Boolean', COMMAND: 'command' },
      ArgumentType: { STRING: 'string', NUMBER: 'number' },
      extensions: { register() {} },
    };
    try {
      const panel = new ControllerPanel();
      panel.addWidget('knob', 'slider', { min: 0, max: 255 });

      const ext = new ControllerExtension();
      ext.setPanel(panel);

      ext.setWidget({ NAME: 'knob', VALUE: 128 });
      assert.equal(panel.getValue('knob'), 128);
      assert.equal(ext.controllerValue({ NAME: 'knob' }), 128);

      // Clamp to max
      ext.setWidget({ NAME: 'knob', VALUE: 999 });
      assert.equal(panel.getValue('knob'), 255);
    } finally {
      delete globalThis.Scratch;
    }
  });
});

// ─── Stage-view descriptor ────────────────────────────────────────────────

describe('ControllerStageView', () => {

  it('has correct identity', () => {
    const panel = new ControllerPanel();
    const view = createControllerStageView(panel);
    assert.equal(view.id, 'controller');
    assert.equal(view.label, 'Controller');
  });

  it('getWidgets attaches render info', () => {
    const panel = new ControllerPanel();
    panel.addWidget('s1', 'slider');
    panel.addWidget('j1', 'joystick');
    const view = createControllerStageView(panel);
    const widgets = view.getWidgets();
    assert.equal(widgets.length, 2);
    assert.equal(widgets[0].render.icon, 'slider');
    assert.equal(widgets[1].render.icon, 'joystick');
    assert.deepEqual(widgets[1].render.minSize, { w: 120, h: 120 });
  });

  it('enter/exit lifecycle manages mode and binding', () => {
    const panel = new ControllerPanel();
    panel.addWidget('vol', 'slider', { min: 0, max: 100 });
    panel.bindToPart('vol', 'pot1');

    const board = makeBoard();
    const view = createControllerStageView(panel);

    // Enter: mode becomes play, binding syncs
    view.enter(board);
    assert.equal(panel.mode, 'play');

    // Slider input during play propagates
    panel.setSliderInput('vol', 50);
    assert.equal(board.controls.get('pot1'), 0.5);

    // Exit: mode returns to edit
    view.exit();
    assert.equal(panel.mode, 'edit');
  });

  it('serialize/restore round-trips', () => {
    const panel = new ControllerPanel();
    panel.addWidget('knob', 'dial', { min: 0, max: 360 });
    panel.addWidget('btn', 'button', { toggle: true });
    panel.bindToPart('knob', 'pot1');

    const view = createControllerStageView(panel);
    const data = view.serialize();

    const restored = view.restore(data);
    assert.equal(restored.getWidgetNames().length, 2);
    const knob = restored.getWidget('knob');
    assert.equal(knob.type, 'dial');
    assert.equal(knob.config.max, 360);
    assert.equal(knob.binding.target, 'part');
    assert.equal(knob.binding.partId, 'pot1');
  });

  it('WIDGET_RENDER_INFO covers all widget types', () => {
    const types = ['joystick', 'button', 'slider', 'dpad', 'dial'];
    for (const t of types) {
      assert.ok(WIDGET_RENDER_INFO[t], `missing render info for ${t}`);
      assert.ok(WIDGET_RENDER_INFO[t].minSize, `missing minSize for ${t}`);
      assert.ok(WIDGET_RENDER_INFO[t].icon, `missing icon for ${t}`);
    }
  });
});

// ─── Extension with no panel (graceful degradation) ───────────────────────

describe('ControllerExtension: no panel attached', () => {
  it('reporters return zero/false without a panel', () => {
    const ext = new ControllerExtension();
    assert.equal(ext.controllerValue({ NAME: 'x' }), 0);
    assert.equal(ext.controllerX({ NAME: 'x' }), 0);
    assert.equal(ext.controllerY({ NAME: 'x' }), 0);
    assert.equal(ext.controllerPressed({ NAME: 'x' }), false);
  });

  it('setWidget is a no-op without a panel', () => {
    const ext = new ControllerExtension();
    // Should not throw
    ext.setWidget({ NAME: 'x', VALUE: 42 });
  });

  it('clearPanel reverts to runtime lookup', () => {
    const ext = new ControllerExtension();
    const panel = new ControllerPanel();
    panel.addWidget('a', 'slider');
    panel.setSliderInput('a', 42);

    ext.setPanel(panel);
    assert.equal(ext.controllerValue({ NAME: 'a' }), 42);

    ext.clearPanel();
    // No runtime.controllerPanel set, so falls back to null
    assert.equal(ext.controllerValue({ NAME: 'a' }), 0);
  });
});
