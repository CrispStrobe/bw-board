/**
 * Controller panel stage-view descriptor.
 *
 * The host (brickwright-lite) renders the controller panel as a stage-view
 * mode — a replacement for the Scratch stage canvas that shows interactive
 * widgets instead of sprites.  This module describes:
 *
 *   1. The view's identity and metadata (id, label, icon hint).
 *   2. Widget rendering descriptors: what each widget type looks like and
 *      what input events the host should route to the panel.
 *   3. The lifecycle hooks the host calls on mode enter/exit.
 *
 * The host owns the DOM / React tree; this module is pure data + callbacks,
 * no DOM dependency.
 *
 * @module
 */

import { ControllerPanel, WIDGET_TYPES } from './controller.js';
import { bindPanelToBoard } from './controller-binding.js';

// ─── Widget render descriptors ─────────────────────────────────────────────

/**
 * Per-widget-type rendering hints.  The host reads these to decide which
 * React component to mount for each widget in the panel.
 */
export const WIDGET_RENDER_INFO = {
  joystick: {
    /** Minimum bounding box the host should allocate (logical px). */
    minSize: { w: 120, h: 120 },
    /** Input events the host should capture and route to panel.setJoystickInput(). */
    inputEvents: ['pointermove', 'pointerdown', 'pointerup'],
    /** Visual hint for the host's widget palette. */
    icon: 'joystick',
  },
  button: {
    minSize: { w: 64, h: 64 },
    inputEvents: ['pointerdown', 'pointerup'],
    icon: 'button',
  },
  slider: {
    minSize: { w: 200, h: 40 },
    inputEvents: ['input'],   // <input type="range">
    icon: 'slider',
  },
  dpad: {
    minSize: { w: 120, h: 120 },
    inputEvents: ['pointerdown', 'pointerup'],
    icon: 'dpad',
  },
  dial: {
    minSize: { w: 100, h: 100 },
    inputEvents: ['pointermove', 'pointerdown', 'pointerup'],
    icon: 'dial',
  },
  gauge:     { minSize: { w: 120, h: 60 },  inputEvents: [], icon: 'gauge' },
  matrix:    { minSize: { w: 90, h: 90 },   inputEvents: [], icon: 'matrix' },
  sevenseg:  { minSize: { w: 120, h: 52 },  inputEvents: [], icon: 'sevenseg' },
  // Character displays. These three shipped in WIDGET_TYPES without a render
  // descriptor, so a host reading `renderInfo[w.type]` got `undefined` and had
  // to invent a size — found by the gate below, which now requires every
  // declared type to have one.
  lcd:       { minSize: { w: 180, h: 60 },  inputEvents: [], icon: 'lcd' },
  oled:      { minSize: { w: 200, h: 90 },  inputEvents: [], icon: 'oled' },
  // A scrolling transcript face: wider and taller than the OLED, because its
  // default window is 40x8 against the OLED's 21x4.
  terminal:  { minSize: { w: 320, h: 150 }, inputEvents: [], icon: 'terminal' },
  keypad:    { minSize: { w: 160, h: 160 }, inputEvents: ['pointerdown', 'pointerup'], icon: 'keypad' },
  // New display widgets
  bargraph:  { minSize: { w: 160, h: 40 },  inputEvents: [], icon: 'bargraph' },
  simplevga: { minSize: { w: 160, h: 120 }, inputEvents: [], icon: 'simplevga' },
  mono_lcd:  { minSize: { w: 178, h: 128 }, inputEvents: [], icon: 'mono_lcd' },
  rgb_light: { minSize: { w: 60, h: 60 },   inputEvents: [], icon: 'rgb_light' },
  // New input widget
  keyboard:  { minSize: { w: 240, h: 80 },  inputEvents: ['keydown', 'keyup'], icon: 'keyboard' },
  // Decorations: presentation only, no input events, never bound.
  text:      { minSize: { w: 60, h: 24 },   inputEvents: [], icon: 'text' },
  image:     { minSize: { w: 60, h: 60 },   inputEvents: [], icon: 'image' },
};

// ─── Stage-view descriptor ─────────────────────────────────────────────────

/**
 * Create a stage-view descriptor for a given panel + board pair.
 *
 * The returned object is the contract the host reads:
 *
 *   - `id`, `label`, `icon` — tab identity.
 *   - `panel` — the ControllerPanel instance (host reads widgets from it).
 *   - `getWidgets()` — snapshot of current widgets with render info.
 *   - `enter(board)` — called when the user switches to this view.
 *                       Binds the panel to the board and enters play mode.
 *   - `exit()` — called when leaving the view. Disposes the binding,
 *                re-enters edit mode.
 *   - `serialize()` / `restore(data)` — project persistence.
 *
 * @param {ControllerPanel} panel
 * @returns {ControllerStageView}
 */
export function createControllerStageView(panel) {

  /** @type {{ dispose: () => void, sync: () => void } | null} */
  let binding = null;

  return {
    id: 'controller',
    label: 'Controller',
    icon: 'gamepad',    // host maps this to its icon set

    panel,

    /** Current widgets with render info attached. */
    getWidgets() {
      return panel.getWidgets().map(w => ({
        ...w,
        render: WIDGET_RENDER_INFO[w.type] ?? null,
      }));
    },

    /** All known widget types the host can offer in its "add widget" palette. */
    widgetTypes: { ...WIDGET_TYPES },

    /** Rendering hints per type. */
    renderInfo: WIDGET_RENDER_INFO,

    /**
     * Enter the controller view.  Binds to the board and switches to play mode.
     * @param {import('./board.js').BoardImpl} board
     */
    enter(board) {
      if (binding) binding.dispose();
      binding = bindPanelToBoard(panel, board);
      binding.sync();
      panel.setMode('play');
    },

    /** Exit the controller view.  Unbinds and returns to edit mode. */
    exit() {
      if (binding) {
        binding.dispose();
        binding = null;
      }
      panel.setMode('edit');
    },

    /** Serialize the panel for project persistence. */
    serialize() {
      return panel.toJSON();
    },

    /**
     * Restore a panel from saved project data.
     * Returns a new ControllerPanel — the caller should replace the old one.
     * @param {object} data - Output of `serialize()`.
     * @returns {ControllerPanel}
     */
    restore(data) {
      return ControllerPanel.fromJSON(data);
    },
  };
}

/**
 * @typedef {object} ControllerStageView
 * @property {string} id
 * @property {string} label
 * @property {string} icon
 * @property {ControllerPanel} panel
 * @property {() => Array<object>} getWidgets
 * @property {object} widgetTypes
 * @property {object} renderInfo
 * @property {(board: import('./board.js').BoardImpl) => void} enter
 * @property {() => void} exit
 * @property {() => object} serialize
 * @property {(data: object) => ControllerPanel} restore
 */
