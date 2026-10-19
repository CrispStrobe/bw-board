/**
 * Widget styling layout fields: borderless, hideLabel, hideValue,
 * hideText, hideMaxOut, backgroundColor, color, label.
 * All persist through JSON round-trip via layout.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ControllerPanel } from '../src/controller.js';

describe('Widget styling layout fields', () => {
  it('setWidgetLayout accepts all styling fields', () => {
    const p = new ControllerPanel();
    p.addWidget('g', 'gauge');
    p.setWidgetLayout('g', {
      borderless: true,
      hideLabel: true,
      hideValue: true,
      hideText: true,
      hideMaxOut: true,
      backgroundColor: '#1a1a2e',
      color: '#e94560',
      label: 'Voltage',
    });
    const w = p.getWidget('g');
    assert.equal(w.layout.borderless, true);
    assert.equal(w.layout.hideLabel, true);
    assert.equal(w.layout.hideValue, true);
    assert.equal(w.layout.hideText, true);
    assert.equal(w.layout.hideMaxOut, true);
    assert.equal(w.layout.backgroundColor, '#1a1a2e');
    assert.equal(w.layout.color, '#e94560');
    assert.equal(w.layout.label, 'Voltage');
  });

  it('styling fields survive JSON round-trip', () => {
    const p = new ControllerPanel();
    p.addWidget('bar', 'bargraph');
    p.setWidgetLayout('bar', {
      borderless: true,
      hideLabel: false,
      hideValue: true,
      backgroundColor: '#0f3460',
    });
    const data = p.toJSON();
    const restored = ControllerPanel.fromJSON(data);
    const w = restored.getWidget('bar');
    assert.equal(w.layout.borderless, true);
    assert.equal(w.layout.hideLabel, false);
    assert.equal(w.layout.hideValue, true);
    assert.equal(w.layout.backgroundColor, '#0f3460');
  });

  it('partial patch merges without overwriting other fields', () => {
    const p = new ControllerPanel();
    p.addWidget('m', 'matrix', {}, { x: 10, y: 20 });
    p.setWidgetLayout('m', { borderless: true });
    p.setWidgetLayout('m', { hideValue: true });
    const w = p.getWidget('m');
    assert.equal(w.layout.x, 10, 'x preserved');
    assert.equal(w.layout.y, 20, 'y preserved');
    assert.equal(w.layout.borderless, true, 'borderless preserved');
    assert.equal(w.layout.hideValue, true, 'hideValue added');
  });

  it('works on every widget type', () => {
    const p = new ControllerPanel();
    const types = [
      'joystick', 'button', 'slider', 'dpad', 'dial', 'gauge',
      'matrix', 'sevenseg', 'keyboard', 'bargraph', 'simplevga',
      'mono_lcd', 'rgb_light', 'keypad', 'lcd', 'oled',
    ];
    for (const t of types) {
      const name = `w_${t}`;
      p.addWidget(name, t);
      p.setWidgetLayout(name, { borderless: true, hideLabel: true });
      const w = p.getWidget(name);
      assert.equal(w.layout.borderless, true, `${t}: borderless`);
      assert.equal(w.layout.hideLabel, true, `${t}: hideLabel`);
    }
  });
});
