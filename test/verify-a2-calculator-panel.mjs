/**
 * Headless gate: A2 calculator faceplate via keypad + lcd widgets.
 *
 * Loads the A2 calculator controller.json (keypad + 4 buttons + lcd),
 * presses keys via the panel API, and verifies the lcd widget shows
 * the running expression and result.
 *
 * The "program" is simulated as an event listener that builds an
 * expression string from keypad presses, evaluates on =, clears on C.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ControllerPanel, WIDGET_TYPES } from '../src/controller.js';

// ─── A2 calculator controller.json (inline) ─────────────────────────

const A2_CALC_JSON = {
  version: 1,
  widgets: [
    {
      name: 'keys',
      type: 'keypad',
      config: {
        cols: 4, rows: 4,
        labels: [
          '7','8','9','/',
          '4','5','6','*',
          '1','2','3','-',
          '0','.','=','+',
        ],
      },
      layout: { x: 10, y: 10 },
      binding: { target: 'variable', variableName: 'key_input' },
    },
    {
      name: 'btnC',
      type: 'button',
      config: { toggle: false, label: 'C' },
      layout: { x: 180, y: 10 },
      binding: { target: 'variable', variableName: 'btnC' },
    },
    {
      name: 'btnSign',
      type: 'button',
      config: { toggle: false, label: '+/-' },
      layout: { x: 180, y: 50 },
      binding: { target: 'variable', variableName: 'btnSign' },
    },
    {
      name: 'btnBack',
      type: 'button',
      config: { toggle: false, label: 'DEL' },
      layout: { x: 180, y: 90 },
      binding: { target: 'variable', variableName: 'btnBack' },
    },
    {
      name: 'btnMem',
      type: 'button',
      config: { toggle: false, label: 'M' },
      layout: { x: 180, y: 130 },
      binding: { target: 'variable', variableName: 'btnMem' },
    },
    {
      name: 'screen',
      type: 'lcd',
      config: { cols: 8, rows: 2 },
      layout: { x: 10, y: 200 },
      binding: { target: 'variable', variableName: 'lcd_text' },
    },
  ],
};

// ─── Simulated program ──────────────────────────────────────────────

/**
 * Attach a calculator program that responds to keypad + button events.
 * Returns a dispose function + the mutable state object.
 */
function attachA2CalcProgram(panel) {
  const state = { expression: '', result: '' };

  function onEvent(event, detail) {
    if (event !== 'input') return;
    const { name } = detail;

    // Keypad press: the value is the label character
    if (name === 'keys' && detail.value) {
      const key = detail.value;
      if (key === '=') {
        try {
          const r = Function('"use strict"; return (' + state.expression + ')')();
          state.result = String(r);
          panel.setLcdText('screen', state.expression + '\n= ' + state.result);
        } catch {
          state.result = 'Err';
          panel.setLcdText('screen', 'Error');
        }
        return;
      }
      state.expression += key;
      panel.setLcdText('screen', state.expression);
      return;
    }

    // C button: clear
    if (name === 'btnC' && detail.pressed) {
      state.expression = '';
      state.result = '';
      panel.setLcdText('screen', '0');
      return;
    }

    // DEL button: backspace
    if (name === 'btnBack' && detail.pressed) {
      state.expression = state.expression.slice(0, -1);
      panel.setLcdText('screen', state.expression || '0');
      return;
    }

    // +/- button: negate
    if (name === 'btnSign' && detail.pressed) {
      if (state.expression.startsWith('-')) {
        state.expression = state.expression.slice(1);
      } else if (state.expression.length > 0) {
        state.expression = '-' + state.expression;
      }
      panel.setLcdText('screen', state.expression || '0');
    }
  }

  panel.addListener(onEvent);
  return {
    state,
    dispose: () => panel.removeListener(onEvent),
  };
}

/** Press a keypad key by index. */
function pressKey(panel, index) {
  panel.setKeypadInput('keys', index);
}

/** Press a button (momentary: press then release). */
function pressButton(panel, name) {
  panel.setButtonInput(name, true);
  panel.setButtonInput(name, false);
}

// ─── Tests ──────────────────────────────────────────────────────────

describe('A2 calculator controller.json structure', () => {

  it('loads from JSON with 6 widgets', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    assert.equal(panel.getWidgetNames().length, 6);
  });

  it('has 1 keypad + 4 buttons + 1 lcd', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    const types = panel.getWidgets().map(w => w.type);
    assert.equal(types.filter(t => t === 'keypad').length, 1);
    assert.equal(types.filter(t => t === 'button').length, 4);
    assert.equal(types.filter(t => t === 'lcd').length, 1);
  });

  it('keypad has 16 labelled keys', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    const w = panel.getWidget('keys');
    assert.equal(w.config.labels.length, 16);
    assert.equal(w.config.labels[0], '7');
    assert.equal(w.config.labels[15], '+');
  });

  it('all widgets are variable-bound', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    for (const w of panel.getWidgets()) {
      assert.ok(w.binding, `${w.name} has binding`);
      assert.equal(w.binding.target, 'variable');
    }
  });

  it('lcd is bound to lcd_text', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    assert.equal(panel.getWidget('screen').binding.variableName, 'lcd_text');
  });
});

describe('A2 calculator — headless gate', () => {

  it('press 1 + 2 = shows result 3 on lcd', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    panel.setMode('play');
    const { state, dispose } = attachA2CalcProgram(panel);

    // Key layout: ['7','8','9','/','4','5','6','*','1','2','3','-','0','.','=','+']
    // index 8='1', 15='+', 9='2', 14='='
    pressKey(panel, 8);   // '1'
    assert.equal(state.expression, '1');

    pressKey(panel, 15);  // '+'
    assert.equal(state.expression, '1+');

    pressKey(panel, 9);   // '2'
    assert.equal(state.expression, '1+2');

    pressKey(panel, 14);  // '='
    assert.equal(state.result, '3');

    const lcd = panel.getWidget('screen');
    assert.ok(lcd.state.text.includes('1+2'), `expression on lcd: ${lcd.state.text}`);
    assert.ok(lcd.state.text.includes('= 3'), `result on lcd: ${lcd.state.text}`);
    dispose();
  });

  it('C clears expression and lcd', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    panel.setMode('play');
    const { state, dispose } = attachA2CalcProgram(panel);

    pressKey(panel, 4);   // '4'
    pressKey(panel, 5);   // '5'
    assert.equal(state.expression, '45');

    pressButton(panel, 'btnC');
    assert.equal(state.expression, '');
    assert.equal(panel.getWidget('screen').state.text, '0');
    dispose();
  });

  it('6 * 7 = 42', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    panel.setMode('play');
    const { state, dispose } = attachA2CalcProgram(panel);

    // index 6='6', 7='*', 0='7'
    pressKey(panel, 6);   // '6'
    pressKey(panel, 7);   // '*'
    pressKey(panel, 0);   // '7'
    pressKey(panel, 14);  // '='

    assert.equal(state.result, '42');
    assert.ok(panel.getWidget('screen').state.text.includes('= 42'));
    dispose();
  });

  it('DEL removes last character', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    panel.setMode('play');
    const { state, dispose } = attachA2CalcProgram(panel);

    pressKey(panel, 8);   // '1'
    pressKey(panel, 9);   // '2'
    pressKey(panel, 10);  // '3'
    assert.equal(state.expression, '123');

    pressButton(panel, 'btnBack');
    assert.equal(state.expression, '12');
    assert.equal(panel.getWidget('screen').state.text, '12');
    dispose();
  });

  it('+/- negates expression', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    panel.setMode('play');
    const { state, dispose } = attachA2CalcProgram(panel);

    pressKey(panel, 4);   // '4'
    pressKey(panel, 5);   // '5'
    assert.equal(state.expression, '45');

    pressButton(panel, 'btnSign');
    assert.equal(state.expression, '-45');

    pressButton(panel, 'btnSign');
    assert.equal(state.expression, '45');
    dispose();
  });

  it('decimal: 3.14 + 2.86 = 6', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    panel.setMode('play');
    const { state, dispose } = attachA2CalcProgram(panel);

    // '3' idx=10, '.' idx=13, '1' idx=8, '4' idx=4, '+' idx=15,
    // '2' idx=9, '8' idx=1, '6' idx=6, '=' idx=14
    pressKey(panel, 10);  // '3'
    pressKey(panel, 13);  // '.'
    pressKey(panel, 8);   // '1'
    pressKey(panel, 4);   // '4'
    pressKey(panel, 15);  // '+'
    pressKey(panel, 9);   // '2'
    pressKey(panel, 13);  // '.'
    pressKey(panel, 1);   // '8'
    pressKey(panel, 6);   // '6'
    pressKey(panel, 14);  // '='

    assert.equal(state.result, '6');
    assert.ok(panel.getWidget('screen').state.text.includes('= 6'));
    dispose();
  });

  it('keypad → variable → lcd: full pipeline', () => {
    const panel = ControllerPanel.fromJSON(A2_CALC_JSON);
    panel.setMode('play');
    const { state, dispose } = attachA2CalcProgram(panel);

    // Press key '9' (index 2 in the 4×4 grid)
    pressKey(panel, 2);
    assert.equal(panel.getValue('keys'), '9', 'keypad value is "9"');
    assert.equal(state.expression, '9', 'expression is "9"');
    assert.equal(panel.getValue('screen'), '9', 'lcd shows "9"');

    dispose();
  });
});
