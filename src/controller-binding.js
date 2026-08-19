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

    // Display widgets are read-only — they don't push values out
    if (w.type === 'gauge' || w.type === 'lcd' || w.type === 'oled') return;

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
        if (w.type === 'gauge' || w.type === 'lcd' || w.type === 'oled') continue; // read-only
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
 * Wire a controller panel to the program's VARIABLES — the live show/change
 * loop. This is the "extension layer" bindPanelToBoard defers variable
 * bindings to:
 *   INPUT widgets (slider/button/dpad/dial/joystick) WRITE the bound variable
 *     on every input — you turn a knob, the program's variable changes.
 *   DISPLAY widgets (gauge, and future matrix/display/sevenseg) READ the bound
 *     variable and show it — the program sets a variable, the face updates.
 *
 * The read direction is polled (`pump()`), driven by requestAnimationFrame in
 * the browser; pass {autoPump:false} and call pump() yourself in tests.
 *
 * @param {import('./controller.js').ControllerPanel} panel
 * @param {{runtime: object}} vm the scratch-vm instance (for stage variables)
 * @param {{autoPump?: boolean}} [opts]
 * @returns {{ pump: () => void, dispose: () => void }}
 */
// Decoration kinds (mirrors controller.js DECORATION_TYPES — this file is
// deliberately import-free): presentation only, never bound.
const DECORATIONS = new Set(['text', 'image']);

export function bindPanelToVariables(panel, vm, opts = {}) {
  const autoPump = opts.autoPump !== false;

  const stage = () => {
    const r = vm && vm.runtime;
    return r && r.getTargetForStage ? r.getTargetForStage() : null;
  };
  const findVar = (name) => {
    const s = stage();
    if (!s) return null;
    if (typeof s.lookupVariableByNameAndType === 'function') {
      const v = s.lookupVariableByNameAndType(name, '');
      if (v) return v;
    }
    const vars = s.variables || {};
    for (const id of Object.keys(vars)) {
      if (vars[id] && vars[id].name === name) return vars[id];
    }
    return null;
  };

  // Which widget types READ from the variable (displays), vs WRITE to it (inputs).
  const isDisplay = (w) => w.type === 'gauge' || w.type === 'matrix' || w.type === 'lcd' || w.type === 'oled' || w.type === 'sevenseg';

  // widget -> variable (inputs)
  function onPanelEvent(event, detail) {
    if (event !== 'input') return;
    const w = panel.getWidget(detail.name);
    if (!w || !w.binding || w.binding.target !== 'variable') return;
    if (DECORATIONS.has(w.type)) return;              // presentation only
    if (isDisplay(w)) return;                     // read-only, handled by pump()
    const v = findVar(w.binding.variableName);
    if (v) v.value = panel.getValue(detail.name);
  }
  panel.addListener(onPanelEvent);

  // variable -> widget (displays), polled
  const shown = new Map();
  function pump() {
    for (const w of panel.getWidgets()) {
      if (DECORATIONS.has(w.type)) continue;          // presentation only
      if (!w.binding || w.binding.target !== 'variable' || !isDisplay(w)) continue;
      const v = findVar(w.binding.variableName);
      if (!v) continue;
      if (w.type === 'lcd' || w.type === 'oled') {
        const sv = String(v.value);
        if (shown.get(w.name) !== sv) {
          shown.set(w.name, sv);
          if (w.type === 'lcd' && typeof panel.setLcdText === 'function') panel.setLcdText(w.name, sv);
          else if (w.type === 'oled' && typeof panel.setOledText === 'function') panel.setOledText(w.name, sv);
        }
      } else {
        const nv = Number(v.value);
        if (shown.get(w.name) !== nv) {
          shown.set(w.name, nv);
          if (typeof panel.setGaugeValue === 'function' && w.type === 'gauge') {
            panel.setGaugeValue(w.name, nv);
          } else if (typeof panel.setMatrixValue === 'function' && w.type === 'matrix') {
            panel.setMatrixValue(w.name, nv);
          } else if (typeof panel.setSevenSegValue === 'function' && w.type === 'sevenseg') {
            panel.setSevenSegValue(w.name, nv);
          }
        }
      }
    }
    if (autoPump && raf) raf = requestAnimationFrame(pump);
  }
  let raf = autoPump && typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(pump) : null;

  return {
    pump,
    dispose() {
      panel.removeListener(onPanelEvent);
      if (raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = null;
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
  if (DECORATIONS.has(w.type)) return null;         // presentation only
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
    case 'keypad':
      // Keypad value is a string (key label or index) — returned as-is
      // for variable bindings; for part/pin bindings, parse as number.
      return typeof w.state.value === 'string' ? (parseFloat(w.state.value) || 0) : 0;
    case 'gauge':
    case 'lcd':
      // Display widgets are read-only — mapping returns null (no output)
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
