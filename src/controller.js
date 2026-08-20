/**
 * Controller panel — composable input surface for simulation.
 *
 * The panel holds named widgets (joystick, button, slider) that the user
 * places in edit mode and operates in play mode.  Each widget exposes a
 * value that can be read two ways:
 *
 *   1. **Program-facing** — extension blocks read `panel.getValue('joy1')`
 *      or `panel.getJoystick('joy1')` and surface the result as Scratch
 *      reporter/boolean blocks via the RUNTIME_EXTENSIONS registry.
 *
 *   2. **World-facing** — a widget binds to a board part parameter:
 *      `slider → potentiometer position`, `button → switch state`, etc.
 *      Routed through `board.setControl(partId, mappedValue)`.
 *
 * The panel serializes to/from JSON for project persistence.
 *
 * @module
 */

// ─── Widget type constants ─────────────────────────────────────────────────

export const WIDGET_TYPES = /** @type {const} */ ({
  JOYSTICK:  'joystick',
  BUTTON:    'button',
  SLIDER:    'slider',
  DPAD:      'dpad',
  DIAL:      'dial',
  GAUGE:     'gauge',
  MATRIX:    'matrix',
  KEYPAD:    'keypad',
  LCD:       'lcd',
  OLED:      'oled',
  SEVENSEG:  'sevenseg',
  KEYBOARD:  'keyboard',
  BARGRAPH:  'bargraph',
  SIMPLEVGA: 'simplevga',
  MONO_LCD:  'mono_lcd',
  RGB_LIGHT: 'rgb_light',
  TEXT:      'text',
  IMAGE:     'image',
});

/**
 * Decoration kinds: presentation only - neither input nor display. The
 * binding layers skip them entirely (no variable writes, no pump).
 */
export const DECORATION_TYPES = new Set(['text', 'image']);

/** Default configs per widget type. */
const DEFAULTS = {
  joystick: { x: 0, y: 0 },
  button:   { toggle: false, pressed: false },
  slider:   { min: 0, max: 100, step: 1, value: 0 },
  dpad:     { up: false, down: false, left: false, right: false },
  dial:     { min: 0, max: 360, value: 0 },
  gauge:    { min: 0, max: 100, value: 0, label: '' },
  // A dot-matrix DISPLAY: read-only face driven by a program variable. The
  // state is one number — a row-major bitmask (bit r*cols+c set = lit), so
  // it flows through the same numeric variable binding every other display
  // uses. 5x5 covers the micro:bit; rows*cols must stay <= 32 for the
  // bitmask to survive int coercion everywhere.
  matrix:   { rows: 5, cols: 5, value: 0 },
  keypad:   { cols: 4, rows: 4, labels: null, value: '' },
  lcd:      { cols: 4, rows: 2, text: '' },
  // A text OLED DISPLAY: read-only multi-row text face driven by a program
  // variable (newlines separate rows; each row clipped to `cols` on render).
  oled:     { rows: 4, cols: 21, text: '' },
  // A 7-segment numeric DISPLAY: read-only face showing the bound variable's
  // value right-aligned across `digits` tubes (the display contract is one
  // NUMERIC variable per display widget). Overflow renders as dashes.
  sevenseg: { digits: 4, value: 0 },
  // KEYBOARD input widget: serial-FIFO, lossless. Each keypress pushes its
  // ASCII byte into _fifo (an array); variable binding appends the char to a
  // growing string buffer (the input line). getValue() returns the last ASCII
  // code (secondary "current key held" readout).
  keyboard: { lastKey: 0 },
  // BARGRAPH display: a horizontal/vertical level bar driven by a numeric variable.
  bargraph: { min: 0, max: 100, value: 0, segments: 10, label: '' },
  // SIMPLEVGA display: framebuffer variable -> VGA screen. The state holds a
  // palette-indexed pixel buffer (Uint8Array); the pump writes it from a
  // numeric variable referencing the board's SimpleVGA renderer.
  simplevga: { width: 160, height: 120, value: 0 },
  // MONO_LCD display: byte-buffer mono LCD (EV3 = 178×128, NXT = 100×64).
  mono_lcd: { width: 178, height: 128, buffer: null },
  // RGB_LIGHT display: a single RGB status light (WeDo/Boost hubs).
  // value = 24-bit 0xRRGGBB or a Lego color ID (0..10) depending on mode.
  rgb_light: { mode: 'rgb', value: 0 },
  // Decorations (presentation only, never bound):
  text:     { text: 'Label', fontSize: 16, color: '#334155' },
  image:    { src: '', alt: '' },
};

// ─── ControllerPanel ────────────────────────────────────────────────────────

export class ControllerPanel {

  constructor() {
    /** @type {Map<string, Widget>} */
    this._widgets = new Map();
    /** @type {'edit' | 'play'} */
    this._mode = 'edit';
    /** @type {Set<(event: string, detail: object) => void>} */
    this._listeners = new Set();
  }

  // ── Mode ──────────────────────────────────────────────────────────────

  get mode() { return this._mode; }

  setMode(mode) {
    if (mode !== 'edit' && mode !== 'play') throw new Error(`Invalid mode: ${mode}`);
    if (this._mode === mode) return;
    this._mode = mode;
    // Reset momentary buttons when entering play mode
    if (mode === 'play') {
      for (const w of this._widgets.values()) {
        if (w.type === 'button' && !w.config.toggle) w.state.pressed = false;
        if (w.type === 'dpad') { w.state.up = false; w.state.down = false; w.state.left = false; w.state.right = false; }
        if (w.type === 'keypad') w.state.value = '';
        if (w.type === 'keyboard') { w.state.lastKey = 0; w.state._fifo = []; w.state._lineBuffer = ''; }
      }
    }
    this._emit('mode', { mode });
  }

  // ── Widget CRUD ───────────────────────────────────────────────────────

  /**
   * Add a widget.
   * @param {string} name - Unique name (used in extension blocks).
   * @param {string} type - One of WIDGET_TYPES.
   * @param {object} [config] - Type-specific config overrides.
   * @param {{ x?: number, y?: number }} [layout] - Position on the panel.
   * @returns {Widget}
   */
  addWidget(name, type, config = {}, layout = {}) {
    if (this._widgets.has(name)) throw new Error(`Widget '${name}' already exists`);
    if (!DEFAULTS[type]) throw new Error(`Unknown widget type: ${type}`);
    const w = {
      name,
      type,
      config: { ...DEFAULTS[type], ...config },
      state: { ...DEFAULTS[type] },
      // Placement + presentation: x/y and any editor fields (w/h/rotation/
      // color/label) survive verbatim. NOT state: state.{x,y} is a
      // joystick's INPUT value; layout is where the widget SITS.
      layout: { x: 0, y: 0, ...layout },
      binding: null,
    };
    // state is mutable; config is the template.
    // Sliders/dials start at min unless a value was specified in config.
    if (type === 'slider') w.state = { value: config.value ?? w.config.min };
    if (type === 'dial') w.state = { value: config.value ?? w.config.min };
    if (type === 'gauge') w.state = { value: config.value ?? w.config.min };
    if (type === 'matrix') w.state = { value: config.value ?? 0 };
    if (type === 'keypad') w.state = { value: '' };
    if (type === 'lcd') w.state = { text: '' };
    if (type === 'oled') w.state = { text: config.text ?? '' };
    if (type === 'sevenseg') w.state = { value: config.value ?? 0 };
    if (type === 'bargraph') w.state = { value: config.value ?? w.config.min };
    if (type === 'simplevga') w.state = { value: 0, buffer: null };
    if (type === 'mono_lcd') w.state = { buffer: null, text: '' };
    if (type === 'rgb_light') w.state = { value: config.value ?? 0 };
    if (type === 'keyboard') w.state = { lastKey: 0, _fifo: [] };
    this._widgets.set(name, w);
    this._emit('add', { name, type });
    return w;
  }

  removeWidget(name) {
    if (!this._widgets.delete(name)) throw new Error(`Widget '${name}' not found`);
    this._emit('remove', { name });
  }

  getWidget(name) { return this._widgets.get(name) ?? null; }

  /**
   * Merge layout fields (placement/size/rotation/color/label). Emits
   * 'layout' so views re-render and hosts persist.
   * @param {string} name
   * @param {object} patch
   */
  setWidgetLayout(name, patch) {
    const w = this._requireWidget(name);
    w.layout = { ...w.layout, ...patch };
    this._emit('layout', { name });
    return w;
  }

  /**
   * Merge config fields (a text decoration's text/fontSize/color, an
   * image's src…). Emits 'config' so views re-render and hosts persist.
   * @param {string} name
   * @param {object} patch
   */
  setWidgetConfig(name, patch) {
    const w = this._requireWidget(name);
    w.config = { ...w.config, ...patch };
    this._emit('config', { name });
    return w;
  }

  /**
   * Rename a widget. The widget OBJECT moves (binding, layout, state all
   * travel with it), so nothing is orphaned; refuses collisions and empty
   * names. Emits 'rename' with both names so hosts can re-key anything
   * external.
   * @param {string} oldName
   * @param {string} newName
   */
  renameWidget(oldName, newName) {
    const w = this._requireWidget(oldName);
    newName = String(newName || '').trim();
    if (!newName) throw new Error('Widget name cannot be empty');
    if (newName === oldName) return w;
    if (this._widgets.has(newName)) throw new Error(`Widget '${newName}' already exists`);
    // rebuild the map so iteration order (== paint order) is preserved
    const entries = [...this._widgets.entries()].map(([k, v]) =>
      k === oldName ? [newName, v] : [k, v]);
    this._widgets = new Map(entries);
    w.name = newName;
    this._emit('rename', { oldName, newName });
    return w;
  }
  getWidgetNames() { return [...this._widgets.keys()]; }
  getWidgets() { return [...this._widgets.values()]; }

  /** @returns {string[]} Names of widgets of the given type. */
  getWidgetsByType(type) {
    return [...this._widgets.values()].filter(w => w.type === type).map(w => w.name);
  }

  // ── Input (called by UI in play mode) ─────────────────────────────────

  /**
   * Set joystick axes.  Values are clamped to -100..100.
   * @param {string} name
   * @param {number} x
   * @param {number} y
   */
  setJoystickInput(name, x, y) {
    const w = this._requireWidget(name, 'joystick');
    w.state.x = Math.max(-100, Math.min(100, Math.round(x)));
    w.state.y = Math.max(-100, Math.min(100, Math.round(y)));
    this._emit('input', { name, x: w.state.x, y: w.state.y });
  }

  /**
   * Set button state.
   * For momentary buttons: true on press, false on release.
   * For toggle buttons: each call toggles the state.
   * @param {string} name
   * @param {boolean} pressed
   */
  setButtonInput(name, pressed) {
    const w = this._requireWidget(name, 'button');
    if (w.config.toggle) {
      // Toggle on press, ignore release
      if (pressed) w.state.pressed = !w.state.pressed;
    } else {
      w.state.pressed = !!pressed;
    }
    this._emit('input', { name, pressed: w.state.pressed });
  }

  /**
   * Set D-pad direction state.
   * @param {string} name
   * @param {'up'|'down'|'left'|'right'} direction
   * @param {boolean} pressed
   */
  setDpadInput(name, direction, pressed) {
    const w = this._requireWidget(name, 'dpad');
    if (!['up', 'down', 'left', 'right'].includes(direction)) {
      throw new Error(`Invalid D-pad direction: ${direction}`);
    }
    w.state[direction] = !!pressed;
    this._emit('input', { name, direction, pressed: w.state[direction] });
  }

  /**
   * Set slider / dial value.  Clamped to [min, max].
   * @param {string} name
   * @param {number} value
   */
  setSliderInput(name, value) {
    const w = this._requireWidget(name);
    if (w.type !== 'slider' && w.type !== 'dial') {
      throw new Error(`Widget '${name}' is not a slider or dial`);
    }
    const { min, max } = w.config;
    w.state.value = Math.max(min, Math.min(max, value));
    this._emit('input', { name, value: w.state.value });
  }

  /**
   * Set gauge value.  Gauges are read-only indicators driven by the
   * program or by a pin/variable binding — not by direct user touch.
   * Clamped to [min, max].
   * @param {string} name
   * @param {number} value
   */
  setGaugeValue(name, value) {
    const w = this._requireWidget(name, 'gauge');
    const { min, max } = w.config;
    w.state.value = Math.max(min, Math.min(max, value));
    this._emit('input', { name, value: w.state.value });
  }

  /**
   * Set matrix display state. Read-only indicator like the gauge: driven by
   * the program (variable binding), never by touch.
   * @param {string} name
   * @param {number} bits - row-major bitmask, bit (r*cols+c) = dot lit
   */
  setMatrixValue(name, bits) {
    const w = this._requireWidget(name, 'matrix');
    const cells = (w.config.rows | 0) * (w.config.cols | 0);
    const mask = cells >= 32 ? 0xFFFFFFFF : (1 << cells) - 1;
    w.state.value = (Number(bits) || 0) & mask;
    this._emit('input', { name, value: w.state.value });
  }

  /**
   * Press a key on a keypad widget.  Writes the key label (or index) to
   * the widget's value, which the binding pump pushes to the bound variable.
   * @param {string} name
   * @param {number} index - Key index (0-based, row-major).
   */
  setKeypadInput(name, index) {
    const w = this._requireWidget(name, 'keypad');
    const total = (w.config.cols ?? 4) * (w.config.rows ?? 4);
    if (index < 0 || index >= total) return;
    const labels = w.config.labels;
    w.state.value = labels ? (labels[index] ?? '') : String(index);
    this._emit('input', { name, value: w.state.value, index });
  }

  /**
   * Set the text on an LCD display widget.  The LCD is a DISPLAY widget —
   * this is called by the binding pump when a variable changes, not by
   * the user directly.
   * @param {string} name
   * @param {string} text
   */
  setLcdText(name, text) {
    const w = this._requireWidget(name, 'lcd');
    w.state.text = String(text);
    this._emit('input', { name, text: w.state.text });
  }

  /**
   * Set OLED text. Display-only, driven by the program or a variable binding;
   * newlines separate rows and each row is clipped to `cols` on render.
   * @param {string} name
   * @param {string} text
   */
  setOledText(name, text) {
    const w = this._requireWidget(name, 'oled');
    w.state.text = String(text);
    this._emit('input', { name, text: w.state.text });
  }

  /**
   * Get the OLED text as an array of `rows` rows, each padded to `cols` wide.
   * @param {string} name
   * @returns {string[]}
   */
  getOledRows(name) {
    const w = this._widgets.get(name);
    if (!w || w.type !== 'oled') return [];
    const { rows, cols } = w.config;
    const lines = String(w.state.text || '').split('\n');
    const result = [];
    for (let i = 0; i < rows; i++) {
      result.push((lines[i] || '').slice(0, cols).padEnd(cols, ' '));
    }
    return result;
  }

  /**
   * Set 7-segment display value. Read-only indicator like the gauge: driven
   * by the program (variable binding), never by touch. Stores the raw
   * number; the face truncates to integer and handles overflow.
   * @param {string} name
   * @param {number} value
   */
  setSevenSegValue(name, value) {
    const w = this._requireWidget(name, 'sevenseg');
    w.state.value = Number(value) || 0;
    this._emit('input', { name, value: w.state.value });
  }

  // ── New display/input widget methods ──────────────────────────────────

  /**
   * Set bargraph level. Display-only, driven by program or variable binding.
   * Clamped to [min, max].
   * @param {string} name
   * @param {number} value
   */
  setBargraphValue(name, value) {
    const w = this._requireWidget(name, 'bargraph');
    const { min, max } = w.config;
    w.state.value = Math.max(min, Math.min(max, Number(value) || 0));
    this._emit('input', { name, value: w.state.value });
  }

  /**
   * Set a single pixel on the SimpleVGA framebuffer.
   * @param {string} name
   * @param {number} x - column (0-based)
   * @param {number} y - row (0-based)
   * @param {number} colorIndex - palette index (0 clears)
   */
  setVgaPixel(name, x, y, colorIndex) {
    const w = this._requireWidget(name, 'simplevga');
    const { width, height } = w.config;
    x = Math.trunc(x); y = Math.trunc(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    if (!w.state.buffer) w.state.buffer = new Uint8Array(width * height);
    w.state.buffer[y * width + x] = (Number(colorIndex) || 0) & 0xFF;
    this._emit('input', { name, x, y, colorIndex });
  }

  /**
   * Clear the SimpleVGA framebuffer.
   * @param {string} name
   */
  clearVga(name) {
    const w = this._requireWidget(name, 'simplevga');
    if (w.state.buffer) w.state.buffer.fill(0);
    else w.state.buffer = new Uint8Array(w.config.width * w.config.height);
    this._emit('input', { name, cleared: true });
  }

  /**
   * Set a pixel on the mono LCD (EV3/NXT-style).
   * @param {string} name
   * @param {number} x
   * @param {number} y
   * @param {boolean} on
   */
  setMonoLcdPixel(name, x, y, on) {
    const w = this._requireWidget(name, 'mono_lcd');
    const { width, height } = w.config;
    x = Math.trunc(x); y = Math.trunc(y);
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    if (!w.state.buffer) w.state.buffer = new Uint8Array(Math.ceil(width * height / 8));
    const idx = y * width + x;
    const byte = idx >> 3, bit = idx & 7;
    if (on) w.state.buffer[byte] |= (1 << bit);
    else w.state.buffer[byte] &= ~(1 << bit);
    this._emit('input', { name, x, y, on });
  }

  /**
   * Write text to the mono LCD at a cursor position. Simplified: stores
   * the text string and lets the face render it.
   * @param {string} name
   * @param {string} text
   */
  setMonoLcdText(name, text) {
    const w = this._requireWidget(name, 'mono_lcd');
    w.state.text = String(text);
    this._emit('input', { name, text: w.state.text });
  }

  /**
   * Clear the mono LCD.
   * @param {string} name
   */
  clearMonoLcd(name) {
    const w = this._requireWidget(name, 'mono_lcd');
    if (w.state.buffer) w.state.buffer.fill(0);
    w.state.text = '';
    this._emit('input', { name, cleared: true });
  }

  /**
   * Set the RGB light color.
   * @param {string} name
   * @param {number} color - 0xRRGGBB (24-bit) or Lego color ID (0..10)
   */
  setRgbLightColor(name, color) {
    const w = this._requireWidget(name, 'rgb_light');
    w.state.value = (Number(color) || 0) & 0xFFFFFF;
    this._emit('input', { name, value: w.state.value });
  }

  /**
   * Push a key into the keyboard FIFO. Each key is an ASCII code.
   * @param {string} name
   * @param {number} keyCode - ASCII code
   */
  pushKeyboardKey(name, keyCode) {
    const w = this._requireWidget(name, 'keyboard');
    const code = Math.trunc(Number(keyCode) || 0) & 0xFF;
    if (!w.state._fifo) w.state._fifo = [];
    w.state._fifo.push(code);
    w.state.lastKey = code;
    this._emit('input', { name, keyCode: code });
  }

  /**
   * Read the next key from the keyboard FIFO (consuming it). Returns 0
   * if the FIFO is empty — the same contract as a serial read.
   * @param {string} name
   * @returns {number} ASCII code or 0
   */
  readKeyboardKey(name) {
    const w = this._requireWidget(name, 'keyboard');
    if (!w.state._fifo || w.state._fifo.length === 0) return 0;
    return w.state._fifo.shift();
  }

  // ── State query (program-facing API for extension blocks) ─────────────

  /** Scalar value for any widget (slider/dial/gauge value, button 0/1, joystick magnitude, dpad bitmask). */
  getValue(name) {
    const w = this._widgets.get(name);
    if (!w) return 0;
    switch (w.type) {
      case 'slider':
      case 'dial':
      case 'gauge':
      case 'matrix':
      case 'sevenseg':
      case 'bargraph':
      case 'simplevga':
      case 'rgb_light':
        return w.state.value;
      case 'button':
        return w.state.pressed ? 1 : 0;
      case 'joystick':
        return Math.round(Math.sqrt(w.state.x ** 2 + w.state.y ** 2));
      case 'dpad':
        // Bitmask: up=1, down=2, left=4, right=8
        return (w.state.up ? 1 : 0) | (w.state.down ? 2 : 0)
             | (w.state.left ? 4 : 0) | (w.state.right ? 8 : 0);
      case 'keypad':
        return w.state.value;
      case 'lcd':
        return w.state.text;
      case 'oled':
      case 'mono_lcd':
        return w.state.text || '';
      case 'keyboard':
        return w.state.lastKey || 0;
      default:
        return 0;
    }
  }

  /** X axis: joystick -100..100, D-pad -1/0/1.  0 for other types. */
  getX(name) {
    const w = this._widgets.get(name);
    if (!w) return 0;
    if (w.type === 'joystick') return w.state.x;
    if (w.type === 'dpad') return (w.state.right ? 1 : 0) - (w.state.left ? 1 : 0);
    return 0;
  }

  /** Y axis: joystick -100..100, D-pad -1/0/1.  0 for other types. */
  getY(name) {
    const w = this._widgets.get(name);
    if (!w) return 0;
    if (w.type === 'joystick') return w.state.y;
    if (w.type === 'dpad') return (w.state.up ? 1 : 0) - (w.state.down ? 1 : 0);
    return 0;
  }

  /** Button/D-pad pressed state. For D-pad, returns true if any direction is pressed. */
  isPressed(name) {
    const w = this._widgets.get(name);
    if (!w) return false;
    if (w.type === 'button') return w.state.pressed;
    if (w.type === 'dpad') return w.state.up || w.state.down || w.state.left || w.state.right;
    return false;
  }

  /** All widget names → current scalar values. */
  getAll() {
    const out = {};
    for (const [name] of this._widgets) out[name] = this.getValue(name);
    return out;
  }

  // ── Binding ───────────────────────────────────────────────────────────

  /**
   * Bind a widget to a board part.  When the widget changes, the board's
   * setControl is called with the mapped value.
   * @param {string} widgetName
   * @param {string} partId - Board part id.
   * @param {string} [param] - Optional parameter key (e.g. 'x', 'y' for joystick).
   */
  bindToPart(widgetName, partId, param) {
    const w = this._requireWidget(widgetName);
    w.binding = { target: 'part', partId, param: param ?? null };
    this._emit('bind', { name: widgetName, binding: w.binding });
  }

  /**
   * Bind a widget to a pin.  For input widgets (joystick, slider) the
   * widget value is written to the pin; for gauges the pin value is
   * read and displayed.
   * @param {string} widgetName
   * @param {string} pinName - e.g. 'P1.0'
   */
  bindToPin(widgetName, pinName) {
    const w = this._requireWidget(widgetName);
    w.binding = { target: 'pin', pinName };
    this._emit('bind', { name: widgetName, binding: w.binding });
  }

  /**
   * Bind a widget to a Scratch variable.  Input widgets write to the
   * variable; gauges read from it.
   * @param {string} widgetName
   * @param {string} variableName
   */
  bindToVariable(widgetName, variableName) {
    const w = this._requireWidget(widgetName);
    w.binding = { target: 'variable', variableName };
    this._emit('bind', { name: widgetName, binding: w.binding });
  }

  /** Mark a widget as program-facing (no board binding). */
  bindToProgram(widgetName) {
    const w = this._requireWidget(widgetName);
    w.binding = { target: 'program' };
    this._emit('bind', { name: widgetName, binding: w.binding });
  }

  /** Remove any binding. */
  unbind(widgetName) {
    const w = this._requireWidget(widgetName);
    w.binding = null;
    this._emit('bind', { name: widgetName, binding: null });
  }

  // ── Persistence ───────────────────────────────────────────────────────

  /** Serialize to a plain JSON-safe object. */
  toJSON() {
    const widgets = [];
    for (const w of this._widgets.values()) {
      widgets.push({
        name: w.name,
        type: w.type,
        config: { ...w.config },
        layout: { ...w.layout },
        binding: w.binding ? { ...w.binding } : null,
      });
    }
    return { version: 1, widgets };
  }

  /** Restore from a previously serialized object. */
  static fromJSON(data) {
    if (!data || data.version !== 1 || !Array.isArray(data.widgets)) {
      throw new Error('Invalid controller panel data');
    }
    const panel = new ControllerPanel();
    for (const entry of data.widgets) {
      const w = panel.addWidget(entry.name, entry.type, entry.config, entry.layout);
      if (entry.binding) w.binding = { ...entry.binding };
    }
    return panel;
  }

  // ── Events ────────────────────────────────────────────────────────────

  /** @param {(event: string, detail: object) => void} fn */
  addListener(fn) { this._listeners.add(fn); }
  removeListener(fn) { this._listeners.delete(fn); }

  // ── Private ───────────────────────────────────────────────────────────

  _requireWidget(name, expectedType) {
    const w = this._widgets.get(name);
    if (!w) throw new Error(`Widget '${name}' not found`);
    if (expectedType && w.type !== expectedType) {
      throw new Error(`Widget '${name}' is ${w.type}, not ${expectedType}`);
    }
    return w;
  }

  _emit(event, detail) {
    for (const fn of this._listeners) {
      try { fn(event, detail); } catch { /* listener errors don't propagate */ }
    }
  }
}

/**
 * @typedef {object} Widget
 * @property {string} name
 * @property {string} type
 * @property {object} config
 * @property {object} state
 * @property {{ x: number, y: number }} layout
 * @property {{ target: 'part' | 'pin' | 'variable' | 'program', partId?: string, param?: string, pinName?: string, variableName?: string } | null} binding
 */
