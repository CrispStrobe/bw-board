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
    if (DISPLAYS.has(w.type)) return;

    if (w.binding.target === 'part') {
      const { partId, param } = w.binding;
      if (w.type === 'keyboard' && typeof board.setDeviceControl === 'function') {
        const code = detail.keyCode || 0;
        if (code) board.setDeviceControl(partId, 'type', String.fromCharCode(code));
        return;
      }
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

  // PART-bound displays: mirror the board device's own state. This
  // direction did not exist — the board binding pushed widget INPUTS to
  // setControl and deferred displays to the variable layer, so an oled
  // widget bound to the circuit's SSD1306 could be selected and then
  // showed nothing forever (owner report, 2026-08-25). Polled like the
  // variable pump; the change hash keeps an idle screen free.
  const shown = new Map();
  function pumpDisplays() {
    for (const w of panel.getWidgets()) {
      if (!w.binding || w.binding.target !== 'part' || !DISPLAYS.has(w.type)) continue;
      if (typeof board.getDeviceState !== 'function') continue;
      let st = null;
      try { st = board.getDeviceState(w.binding.partId); } catch (e) { /* not a device */ }
      if (!st) continue;
      if (w.type === 'oled' && st.fb && typeof panel.setOledPixels === 'function') {
        let h = 0;
        for (let i = 0; i < st.fb.length; i++) h = ((h * 31) + st.fb[i]) | 0;
        if (shown.get(w.name) !== h) {
          shown.set(w.name, h);
          panel.setOledPixels(w.name, st.fb, 128, 64);
        }
      } else if ((w.type === 'lcd' || w.type === 'oled' || w.type === 'terminal') &&
                 Array.isArray(st.text)) {
        // Character devices (hd44780 family) keep visible text lines.
        const sv = st.text.join('\n');
        if (shown.get(w.name) !== sv) {
          shown.set(w.name, sv);
          if (w.type === 'lcd' && typeof panel.setLcdText === 'function') panel.setLcdText(w.name, sv);
          else if (w.type === 'oled' && typeof panel.setOledText === 'function') panel.setOledText(w.name, sv);
          else if (typeof panel.setTerminalText === 'function') panel.setTerminalText(w.name, sv);
        }
      } else if (w.type === 'simplevga' && typeof st.videoFrame === 'function' &&
                 typeof panel.setVgaFrame === 'function') {
        const frame = st.videoFrame();
        const generation = frame && frame.frame;
        if (frame && shown.get(w.name) !== generation) {
          shown.set(w.name, generation);
          panel.setVgaFrame(w.name, frame);
        }
      }
    }
    if (raf !== null) raf = requestAnimationFrame(pumpDisplays);
  }
  let raf = typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(pumpDisplays) : null;

  return {
    /** One display-mirror pass, for tests and headless hosts. */
    pumpDisplays() { const r = raf; raf = null; pumpDisplays(); raf = r; },
    /** Push all bound widget values to the board (initial sync). */
    sync() {
      for (const w of panel.getWidgets()) {
        if (!w.binding) continue;
        if (DISPLAYS.has(w.type)) continue; // read-only
        if (w.binding.target === 'part') {
          if (w.type === 'keyboard') continue;
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
      if (raf !== null && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(raf);
      raf = null;
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

// Display widget types: read-only, driven by variable binding (program→face).
const DISPLAYS = new Set([
  'gauge', 'matrix', 'lcd', 'oled', 'terminal', 'sevenseg',
  'bargraph', 'simplevga', 'mono_lcd', 'rgb_light',
]);

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
  const isDisplay = (w) => DISPLAYS.has(w.type);

  // widget -> variable (inputs)
  function onPanelEvent(event, detail) {
    if (event !== 'input') return;
    const w = panel.getWidget(detail.name);
    if (!w || !w.binding || w.binding.target !== 'variable') return;
    if (DECORATIONS.has(w.type)) return;              // presentation only
    if (isDisplay(w)) return;                     // read-only, handled by pump()
    const v = findVar(w.binding.variableName);
    if (!v) return;
    if (w.type === 'keyboard') {
      // Keyboard: APPEND the character to the variable's string (input line).
      // The program reads and clears it. Never overwrite with lastKey.
      const code = detail.keyCode || 0;
      if (code >= 0x20 && code < 0x7f) v.value = String(v.value || '') + String.fromCharCode(code);
    } else {
      v.value = panel.getValue(detail.name);
    }
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
      if (w.type === 'lcd' || w.type === 'oled' || w.type === 'terminal' || w.type === 'mono_lcd') {
        const sv = String(v.value);
        if (shown.get(w.name) !== sv) {
          shown.set(w.name, sv);
          if (w.type === 'lcd' && typeof panel.setLcdText === 'function') panel.setLcdText(w.name, sv);
          else if (w.type === 'oled' && typeof panel.setOledText === 'function') panel.setOledText(w.name, sv);
          else if (w.type === 'terminal' && typeof panel.setTerminalText === 'function') panel.setTerminalText(w.name, sv);
          else if (w.type === 'mono_lcd' && typeof panel.setMonoLcdText === 'function') panel.setMonoLcdText(w.name, sv);
        }
      } else {
        const nv = Number(v.value);
        if (shown.get(w.name) !== nv) {
          shown.set(w.name, nv);
          if (w.type === 'gauge' && typeof panel.setGaugeValue === 'function') {
            panel.setGaugeValue(w.name, nv);
          } else if (w.type === 'matrix' && typeof panel.setMatrixValue === 'function') {
            panel.setMatrixValue(w.name, nv);
          } else if (w.type === 'sevenseg' && typeof panel.setSevenSegValue === 'function') {
            panel.setSevenSegValue(w.name, nv);
          } else if (w.type === 'bargraph' && typeof panel.setBargraphValue === 'function') {
            panel.setBargraphValue(w.name, nv);
          } else if (w.type === 'rgb_light' && typeof panel.setRgbLightColor === 'function') {
            panel.setRgbLightColor(w.name, nv);
          }
          // simplevga: pixel-level — the pump pushes the whole value;
          // actual pixel rendering is the face's job.
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
    case 'keyboard':
      // For part/pin binding: send the lastKey ASCII code normalized 0..1
      return (w.state.lastKey || 0) / 127;
    case 'gauge':
    case 'lcd':
    case 'oled':
    case 'terminal':
    case 'bargraph':
    case 'simplevga':
    case 'mono_lcd':
    case 'rgb_light':
    case 'sevenseg':
    case 'matrix':
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
