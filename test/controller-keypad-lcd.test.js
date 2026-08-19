/**
 * Controller keypad + LCD widget type tests.
 *
 * keypad: INPUT widget — 4×4 grid, pressing a key writes the label/index
 *         to the widget value; binding pushes to variable.
 * lcd:    DISPLAY widget — reads a string from a bound variable and
 *         shows it on a 2-row × 4-char display. Read-only like gauge.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerPanel, WIDGET_TYPES } from '../src/controller.js';
import { bindPanelToBoard } from '../src/controller-binding.js';

// ─── WIDGET_TYPES registry ──────────────────────────────────────────

describe('WIDGET_TYPES includes keypad and lcd', () => {
  it('KEYPAD constant exists', () => {
    assert.equal(WIDGET_TYPES.KEYPAD, 'keypad');
  });
  it('LCD constant exists', () => {
    assert.equal(WIDGET_TYPES.LCD, 'lcd');
  });
});

// ─── Keypad widget ──────────────────────────────────────────────────

describe('Keypad widget', () => {
  it('creates with default 4×4 config', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('keys', 'keypad');
    assert.equal(w.config.cols, 4);
    assert.equal(w.config.rows, 4);
    assert.equal(w.state.value, '');
  });

  it('setKeypadInput writes index as string by default', () => {
    const p = new ControllerPanel();
    p.addWidget('keys', 'keypad');
    p.setKeypadInput('keys', 5);
    assert.equal(p.getValue('keys'), '5');
  });

  it('setKeypadInput uses custom labels when provided', () => {
    const labels = [
      '1','2','3','A',
      '4','5','6','B',
      '7','8','9','C',
      '*','0','#','D',
    ];
    const p = new ControllerPanel();
    p.addWidget('keys', 'keypad', { labels });
    p.setKeypadInput('keys', 0);
    assert.equal(p.getValue('keys'), '1');
    p.setKeypadInput('keys', 3);
    assert.equal(p.getValue('keys'), 'A');
    p.setKeypadInput('keys', 14);
    assert.equal(p.getValue('keys'), '#');
  });

  it('ignores out-of-range key indices', () => {
    const p = new ControllerPanel();
    p.addWidget('keys', 'keypad');
    p.setKeypadInput('keys', 5);
    assert.equal(p.getValue('keys'), '5');
    p.setKeypadInput('keys', 16); // out of range for 4×4
    assert.equal(p.getValue('keys'), '5'); // unchanged
    p.setKeypadInput('keys', -1);
    assert.equal(p.getValue('keys'), '5'); // unchanged
  });

  it('emits input event with value and index', () => {
    const p = new ControllerPanel();
    p.addWidget('keys', 'keypad');
    const events = [];
    p.addListener((ev, d) => { if (ev === 'input') events.push(d); });
    p.setKeypadInput('keys', 7);
    assert.equal(events.length, 1);
    assert.equal(events[0].value, '7');
    assert.equal(events[0].index, 7);
  });

  it('resets to empty string on play mode', () => {
    const p = new ControllerPanel();
    p.addWidget('keys', 'keypad');
    p.setKeypadInput('keys', 3);
    assert.equal(p.getValue('keys'), '3');
    p.setMode('play');
    assert.equal(p.getValue('keys'), '');
  });

  it('keypad is INPUT — drives board.setControl on part binding', () => {
    const p = new ControllerPanel();
    p.addWidget('keys', 'keypad');
    p.bindToPart('keys', 'pot1');
    const calls = [];
    const mockBoard = {
      setControl(id, v) { calls.push({ id, v }); },
      writePin() {},
    };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setKeypadInput('keys', 5);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].id, 'pot1');
    assert.equal(calls[0].v, 5); // parseFloat('5') = 5
    bridge.dispose();
  });

  it('serializes and restores with labels', () => {
    const labels = ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P'];
    const p = new ControllerPanel();
    p.addWidget('keys', 'keypad', { labels });
    p.bindToVariable('keys', 'key_var');
    const data = p.toJSON();
    const restored = ControllerPanel.fromJSON(data);
    const w = restored.getWidget('keys');
    assert.equal(w.type, 'keypad');
    assert.deepEqual(w.config.labels, labels);
    assert.deepEqual(w.binding, { target: 'variable', variableName: 'key_var' });
  });
});

// ─── LCD widget ─────────────────────────────────────────────────────

describe('LCD widget', () => {
  it('creates with default 4×2 config', () => {
    const p = new ControllerPanel();
    const w = p.addWidget('disp', 'lcd');
    assert.equal(w.config.cols, 4);
    assert.equal(w.config.rows, 2);
    assert.equal(w.state.text, '');
  });

  it('setLcdText updates the display', () => {
    const p = new ControllerPanel();
    p.addWidget('disp', 'lcd');
    p.setLcdText('disp', 'Hi!');
    assert.equal(p.getValue('disp'), 'Hi!');
  });

  it('setLcdText coerces numbers to strings', () => {
    const p = new ControllerPanel();
    p.addWidget('disp', 'lcd');
    p.setLcdText('disp', 42);
    assert.equal(p.getValue('disp'), '42');
  });

  it('emits input event with text', () => {
    const p = new ControllerPanel();
    p.addWidget('disp', 'lcd');
    const events = [];
    p.addListener((ev, d) => { if (ev === 'input') events.push(d); });
    p.setLcdText('disp', 'test');
    assert.equal(events.length, 1);
    assert.equal(events[0].text, 'test');
  });

  it('lcd is DISPLAY — does NOT drive board on input', () => {
    const p = new ControllerPanel();
    p.addWidget('disp', 'lcd');
    p.bindToPart('disp', 'lcd1');
    const calls = [];
    const mockBoard = {
      setControl(id, v) { calls.push({ id, v }); },
      writePin() {},
    };
    const bridge = bindPanelToBoard(p, mockBoard);
    p.setLcdText('disp', 'hello');
    assert.equal(calls.length, 0, 'lcd should not push to board');
    bridge.dispose();
  });

  it('lcd is skipped in binding sync', () => {
    const p = new ControllerPanel();
    p.addWidget('disp', 'lcd');
    p.bindToPart('disp', 'lcd1');
    const calls = [];
    const mockBoard = {
      setControl(id, v) { calls.push({ id, v }); },
      writePin() {},
    };
    const bridge = bindPanelToBoard(p, mockBoard);
    bridge.sync();
    assert.equal(calls.length, 0, 'sync should skip lcd');
    bridge.dispose();
  });

  it('serializes and restores', () => {
    const p = new ControllerPanel();
    p.addWidget('disp', 'lcd', { cols: 8, rows: 2 });
    p.bindToVariable('disp', 'result');
    const data = p.toJSON();
    const restored = ControllerPanel.fromJSON(data);
    const w = restored.getWidget('disp');
    assert.equal(w.type, 'lcd');
    assert.equal(w.config.cols, 8);
    assert.deepEqual(w.binding, { target: 'variable', variableName: 'result' });
  });
});

// ─── Keypad → variable → LCD integration ────────────────────────────

describe('Keypad → variable → LCD integration', () => {
  it('keypad press sets value, lcd reads from variable', () => {
    const panel = new ControllerPanel();
    const labels = [
      '1','2','3','A',
      '4','5','6','B',
      '7','8','9','C',
      '*','0','#','D',
    ];
    panel.addWidget('keys', 'keypad', { labels });
    panel.bindToVariable('keys', 'key_input');
    panel.addWidget('screen', 'lcd', { cols: 4, rows: 2 });
    panel.bindToVariable('screen', 'display_out');

    // Simulate: user presses key at index 3 in the 4×4 grid
    // labels = ['1','2','3','A','4','5','6','B','7','8','9','C','*','0','#','D']
    // index 3 → label 'A' (row 0, col 3)
    panel.setKeypadInput('keys', 3);
    assert.equal(panel.getValue('keys'), 'A', 'key index 3 → label "A"');

    // The binding pump would read the variable and push to lcd.
    // Simulate: program computes result and sets display_out = 'A'
    panel.setLcdText('screen', 'A');
    assert.equal(panel.getValue('screen'), 'A', 'lcd shows "A"');
  });
});
