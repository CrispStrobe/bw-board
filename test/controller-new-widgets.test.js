/**
 * Tests for the 5 new widget types:
 *   keyboard (INPUT)  — serial FIFO, lossless, append-to-variable
 *   bargraph (DISPLAY) — numeric level bar
 *   simplevga (DISPLAY) — VGA framebuffer
 *   mono_lcd (DISPLAY) — monochrome LCD (EV3/NXT)
 *   rgb_light (DISPLAY) — RGB status light (WeDo/Boost)
 *
 * Each test verifies: creation, state management, setValue/getValue,
 * binding direction (display=read-only, keyboard=input), serialization,
 * and the pump dispatch path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerPanel, WIDGET_TYPES } from '../src/controller.js';
import { bindPanelToBoard, bindPanelToVariables } from '../src/controller-binding.js';

// ─── WIDGET_TYPES registration ──────────────────────────────────────

describe('New widget types registered', () => {
  it('KEYBOARD', () => assert.equal(WIDGET_TYPES.KEYBOARD, 'keyboard'));
  it('BARGRAPH', () => assert.equal(WIDGET_TYPES.BARGRAPH, 'bargraph'));
  it('SIMPLEVGA', () => assert.equal(WIDGET_TYPES.SIMPLEVGA, 'simplevga'));
  it('MONO_LCD', () => assert.equal(WIDGET_TYPES.MONO_LCD, 'mono_lcd'));
  it('RGB_LIGHT', () => assert.equal(WIDGET_TYPES.RGB_LIGHT, 'rgb_light'));
});

// ─── Keyboard widget ────────────────────────────────────────────────

describe('Keyboard widget', () => {
  it('creates with empty FIFO and lastKey=0', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('kbd', 'keyboard');
    assert.equal(w.state.lastKey, 0);
    assert.ok(Array.isArray(w.state._fifo));
    assert.equal(w.state._fifo.length, 0);
  });

  it('pushKeyboardKey adds to FIFO and sets lastKey', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    p.pushKeyboardKey('kbd', 65); // 'A'
    const w = p.getWidget('kbd');
    assert.equal(w.state.lastKey, 65);
    assert.equal(w.state._fifo.length, 1);
    assert.equal(w.state._fifo[0], 65);
  });

  it('readKeyboardKey drains FIFO in order', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    p.pushKeyboardKey('kbd', 72); // 'H'
    p.pushKeyboardKey('kbd', 105); // 'i'
    assert.equal(p.readKeyboardKey('kbd'), 72);
    assert.equal(p.readKeyboardKey('kbd'), 105);
    assert.equal(p.readKeyboardKey('kbd'), 0); // empty
  });

  it('FIFO is lossless under fast typing (100 keys)', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    const sent = [];
    for (let i = 0; i < 100; i++) {
      const code = 32 + (i % 95); // printable ASCII
      p.pushKeyboardKey('kbd', code);
      sent.push(code);
    }
    const received = [];
    let c;
    while ((c = p.readKeyboardKey('kbd')) !== 0) received.push(c);
    assert.deepEqual(received, sent, 'all 100 keys received in order');
  });

  it('getValue returns lastKey (secondary readout)', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    p.pushKeyboardKey('kbd', 42);
    assert.equal(p.getValue('kbd'), 42);
  });

  it('keyboard is INPUT — drives board on part binding', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    p.bindToPart('kbd', 'serial1');
    const calls = [];
    const mockBoard = { setControl(id, v) { calls.push({ id, v }); }, writePin() {} };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.pushKeyboardKey('kbd', 65);
    assert.ok(calls.length > 0, 'keyboard drives board');
    bridge.dispose();
  });

  it('keyboard → variable APPENDS chars (not overwrites)', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    p.bindToVariable('kbd', 'input_line');

    // Mock VM with a stage variable
    const vars = { v1: { name: 'input_line', value: '' } };
    const vm = {
      runtime: {
        getTargetForStage: () => ({ variables: vars }),
      },
    };
    const binding = bindPanelToVariables(p, vm, { autoPump: false });

    p.pushKeyboardKey('kbd', 72);  // 'H'
    p.pushKeyboardKey('kbd', 105); // 'i'
    assert.equal(vars.v1.value, 'Hi', 'chars appended, not overwritten');
    binding.dispose();
  });

  it('resets on play mode', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    p.pushKeyboardKey('kbd', 65);
    p.setMode('play');
    const w = p.getWidget('kbd');
    assert.equal(w.state.lastKey, 0);
    assert.equal(w.state._fifo.length, 0);
  });

  it('serializes and restores', () => {
    const p = new ControllerPanel();
    p.addWidget('kbd', 'keyboard');
    p.bindToVariable('kbd', 'serial_rx');
    const data = p.toJSON();
    const restored = ControllerPanel.fromJSON(data);
    const w = restored.getWidget('kbd');
    assert.equal(w.type, 'keyboard');
    assert.deepEqual(w.binding, { target: 'variable', variableName: 'serial_rx' });
  });
});

// ─── Bargraph widget ────────────────────────────────────────────────

describe('Bargraph widget', () => {
  it('creates with default 0..100 range', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('bar', 'bargraph');
    assert.equal(w.config.min, 0);
    assert.equal(w.config.max, 100);
    assert.equal(w.config.segments, 10);
    assert.equal(w.state.value, 0);
  });

  it('setBargraphValue clamps to range', () => {
    const p = new ControllerPanel();
    p.addWidget('bar', 'bargraph', { min: 0, max: 50 });
    p.setBargraphValue('bar', 75);
    assert.equal(p.getValue('bar'), 50, 'clamped to max');
    p.setBargraphValue('bar', -10);
    assert.equal(p.getValue('bar'), 0, 'clamped to min');
  });

  it('bargraph is DISPLAY — does NOT drive board', () => {
    const p = new ControllerPanel();
    p.addWidget('bar', 'bargraph');
    p.bindToPart('bar', 'led1');
    const calls = [];
    const mockBoard = { setControl(id, v) { calls.push(v); }, writePin() {} };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setBargraphValue('bar', 50);
    assert.equal(calls.length, 0);
    bridge.dispose();
  });

  it('pump dispatches to setBargraphValue', () => {
    const p = new ControllerPanel();
    p.addWidget('bar', 'bargraph');
    p.bindToVariable('bar', 'level');
    const vars = { v1: { name: 'level', value: 42 } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars }) } };
    const binding = bindPanelToVariables(p, vm, { autoPump: false });
    binding.pump();
    assert.equal(p.getValue('bar'), 42);
    binding.dispose();
  });
});

// ─── SimpleVGA widget ───────────────────────────────────────────────

describe('SimpleVGA widget', () => {
  it('creates with default 160x120', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('vga', 'simplevga');
    assert.equal(w.config.width, 160);
    assert.equal(w.config.height, 120);
  });

  it('setVgaPixel writes to buffer', () => {
    const p = new ControllerPanel();
    p.addWidget('vga', 'simplevga', { width: 10, height: 10 });
    p.setVgaPixel('vga', 3, 2, 5);
    const w = p.getWidget('vga');
    assert.ok(w.state.buffer instanceof Uint8Array);
    assert.equal(w.state.buffer[2 * 10 + 3], 5);
  });

  it('clearVga zeros the buffer', () => {
    const p = new ControllerPanel();
    p.addWidget('vga', 'simplevga', { width: 10, height: 10 });
    p.setVgaPixel('vga', 0, 0, 7);
    p.clearVga('vga');
    assert.equal(p.getWidget('vga').state.buffer[0], 0);
  });

  it('simplevga is DISPLAY — does NOT drive board', () => {
    const p = new ControllerPanel();
    p.addWidget('vga', 'simplevga');
    p.bindToPart('vga', 'x');
    const calls = [];
    const mockBoard = { setControl(id, v) { calls.push(v); }, writePin() {} };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setVgaPixel('vga', 0, 0, 1);
    assert.equal(calls.length, 0);
    bridge.dispose();
  });
});

// ─── Mono LCD widget ────────────────────────────────────────────────

describe('Mono LCD widget', () => {
  it('creates with default 178x128 (EV3)', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('lcd', 'mono_lcd');
    assert.equal(w.config.width, 178);
    assert.equal(w.config.height, 128);
  });

  it('setMonoLcdPixel sets individual bits', () => {
    const p = new ControllerPanel();
    p.addWidget('lcd', 'mono_lcd', { width: 8, height: 8 });
    p.setMonoLcdPixel('lcd', 3, 1, true);
    const w = p.getWidget('lcd');
    assert.ok(w.state.buffer);
    // bit index = 1*8+3 = 11, byte 1, bit 3
    assert.equal((w.state.buffer[1] >> 3) & 1, 1);
  });

  it('setMonoLcdText stores text', () => {
    const p = new ControllerPanel();
    p.addWidget('lcd', 'mono_lcd');
    p.setMonoLcdText('lcd', 'Hello EV3');
    assert.equal(p.getWidget('lcd').state.text, 'Hello EV3');
  });

  it('clearMonoLcd clears buffer and text', () => {
    const p = new ControllerPanel();
    p.addWidget('lcd', 'mono_lcd', { width: 8, height: 8 });
    p.setMonoLcdPixel('lcd', 0, 0, true);
    p.setMonoLcdText('lcd', 'test');
    p.clearMonoLcd('lcd');
    assert.equal(p.getWidget('lcd').state.buffer[0], 0);
    assert.equal(p.getWidget('lcd').state.text, '');
  });

  it('pump dispatches mono_lcd as string', () => {
    const p = new ControllerPanel();
    p.addWidget('d', 'mono_lcd');
    p.bindToVariable('d', 'ev3_display');
    const vars = { v1: { name: 'ev3_display', value: 'Line1' } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars }) } };
    const binding = bindPanelToVariables(p, vm, { autoPump: false });
    binding.pump();
    assert.equal(p.getWidget('d').state.text, 'Line1');
    binding.dispose();
  });

  it('mono_lcd is DISPLAY — does NOT drive board', () => {
    const p = new ControllerPanel();
    p.addWidget('d', 'mono_lcd');
    p.bindToPart('d', 'x');
    const calls = [];
    const mockBoard = { setControl(id, v) { calls.push(v); }, writePin() {} };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setMonoLcdText('d', 'test');
    assert.equal(calls.length, 0);
    bridge.dispose();
  });
});

// ─── RGB Light widget ───────────────────────────────────────────────

describe('RGB Light widget', () => {
  it('creates with default mode=rgb, value=0', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('light', 'rgb_light');
    assert.equal(w.config.mode, 'rgb');
    assert.equal(w.state.value, 0);
  });

  it('setRgbLightColor sets 24-bit color', () => {
    const p = new ControllerPanel();
    p.addWidget('light', 'rgb_light');
    p.setRgbLightColor('light', 0xFF0000);
    assert.equal(p.getValue('light'), 0xFF0000);
  });

  it('pump dispatches rgb_light as number', () => {
    const p = new ControllerPanel();
    p.addWidget('light', 'rgb_light');
    p.bindToVariable('light', 'hub_color');
    const vars = { v1: { name: 'hub_color', value: 255 } };
    const vm = { runtime: { getTargetForStage: () => ({ variables: vars }) } };
    const binding = bindPanelToVariables(p, vm, { autoPump: false });
    binding.pump();
    assert.equal(p.getValue('light'), 255);
    binding.dispose();
  });

  it('rgb_light is DISPLAY — does NOT drive board', () => {
    const p = new ControllerPanel();
    p.addWidget('light', 'rgb_light');
    p.bindToPart('light', 'x');
    const calls = [];
    const mockBoard = { setControl(id, v) { calls.push(v); }, writePin() {} };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setRgbLightColor('light', 0x00FF00);
    assert.equal(calls.length, 0);
    bridge.dispose();
  });

  it('serializes and restores', () => {
    const p = new ControllerPanel();
    p.addWidget('light', 'rgb_light', { mode: 'lego_id' });
    p.bindToVariable('light', 'status_color');
    const data = p.toJSON();
    const restored = ControllerPanel.fromJSON(data);
    const w = restored.getWidget('light');
    assert.equal(w.type, 'rgb_light');
    assert.equal(w.config.mode, 'lego_id');
  });
});
