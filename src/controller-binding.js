/**
 * Controller panel ↔ board binding bridge.
 *
 * Connects a ControllerPanel to a BoardImpl so that widget changes
 * propagate to board parts via `board.setControl(partId, mappedValue)`,
 * to pins via `board.writePin(pinName, value)`, or to Scratch variables
 * via `vm.runtime`.
 *
 * Range mapping:
 *   slider (min..max) → potentiometer (0..1)
 *   button (pressed)  → switch/button (1/0)
 *   joystick axis     → pot pair ((-100..100) → (0..1))
 *   gauge             → read-only indicator (no output mapping)
 *
 * Also exposes the program-facing API that extension blocks call:
 * an object whose methods match the RUNTIME_EXTENSIONS shape.
 *
 * @module
 */

/**
 * Wire a controller panel to a board.  Listens for 'input' events on the
 * panel and pushes values to the board for part-bound widgets.
 * For pin-bound widgets, calls board.writePin(pinName, value).
 *
 * @param {import('./controller.js').ControllerPanel} panel
 * @param {import('./board.js').BoardImpl} board
 * @returns {{ dispose: () => void }}
 */
export function bindPanelToBoard(panel, board) {

  function onPanelEvent(event, detail) {
    if (event !== 'input') return;
    const w = panel.getWidget(detail.name);
    if (!w || !w.binding) return;

    // Gauges are read-only — they don't push values out
    if (w.type === 'gauge') return;

    if (w.binding.target === 'part') {
      const { partId, param } = w.binding;
      const mapped = mapWidgetToControl(w, param);
      if (mapped !== null) {
        board.setControl(partId, mapped);
      }
    } else if (w.binding.target === 'pin') {
      const mapped = mapWidgetToControl(w, null);
      if (mapped !== null && board.writePin) {
        board.writePin(w.binding.pinName, mapped);
      }
    }
    // 'variable' bindings are handled by the extension layer, not here
  }

  panel.addListener(onPanelEvent);

  return {
    /** Push all bound widget values to the board (initial sync). */
    sync() {
      for (const w of panel.getWidgets()) {
        if (!w.binding) continue;
        if (w.type === 'gauge') continue; // read-only
        if (w.binding.target === 'part') {
          const mapped = mapWidgetToControl(w, w.binding.param);
          if (mapped !== null) {
            board.setControl(w.binding.partId, mapped);
          }
        } else if (w.binding.target === 'pin' && board.writePin) {
          const mapped = mapWidgetToControl(w, null);
          if (mapped !== null) {
            board.writePin(w.binding.pinName, mapped);
          }
        }
      }
    },

    dispose() {
      panel.removeListener(onPanelEvent);
    },
  };
}

/**
 * Map a widget's current state to a board control value.
 *
 * Potentiometer control range: 0..1
 * Button/switch control range: 0 or 1
 * Joystick: param selects axis, maps -100..100 → 0..1
 *
 * @param {import('./controller.js').Widget} w
 * @param {string | null} param
 * @returns {number | null}
 */
function mapWidgetToControl(w, param) {
  switch (w.type) {
    case 'slider':
    case 'dial': {
      // Normalize to 0..1
      const { min, max } = w.config;
      const range = max - min;
      return range > 0 ? (w.state.value - min) / range : 0;
    }
    case 'button':
      return w.state.pressed ? 1 : 0;
    case 'joystick': {
      // Map -100..100 → 0..1. param selects axis ('x' or 'y').
      const axis = param === 'y' ? w.state.y : w.state.x;
      return (axis + 100) / 200;
    }
    case 'dpad': {
      // param selects axis: 'x' → left/right, 'y' → up/down, default → any-pressed
      if (param === 'x') return ((w.state.right ? 1 : 0) - (w.state.left ? 1 : 0) + 1) / 2;
      if (param === 'y') return ((w.state.up ? 1 : 0) - (w.state.down ? 1 : 0) + 1) / 2;
      return (w.state.up || w.state.down || w.state.left || w.state.right) ? 1 : 0;
    }
    case 'gauge':
      // Gauge is read-only — mapping returns null (no output)
      return null;
    default:
      return null;
  }
}

/**
 * Create the program-facing API object that extension blocks call.
 *
 * Methods match the RUNTIME_EXTENSIONS reporter/boolean shape:
 *   controllerValue(name) → number (reporter)
 *   controllerX(name)     → number (reporter)
 *   controllerY(name)     → number (reporter)
 *   controllerPressed(name) → boolean (boolean reporter)
 *   controllerWidgets()   → string[] (for dropdown population)
 *
 * @param {import('./controller.js').ControllerPanel} panel
 * @returns {object}
 */
export function createControllerDriver(panel) {
  return {
    controllerValue(name)   { return panel.getValue(name); },
    controllerX(name)       { return panel.getX(name); },
    controllerY(name)       { return panel.getY(name); },
    controllerPressed(name) { return panel.isPressed(name); },
    controllerWidgets()     { return panel.getWidgetNames(); },
  };
}
