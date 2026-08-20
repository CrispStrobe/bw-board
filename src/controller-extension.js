/**
 * Controller — Scratch extension for the controller panel.
 *
 * Exposes the panel's widgets as reporter / boolean blocks so programs can
 * read joystick axes, slider values, and button states.  Also provides a
 * "set widget" command for program-driven animation of the panel.
 *
 * The panel instance is resolved lazily from vm.runtime.controllerPanel
 * (written by the host tab component) or injected explicitly via setPanel().
 *
 * Block surface matches the RUNTIME_EXTENSIONS registry shape:
 *   controllerValue(NAME)   → reporter (scalar: slider value, button 0/1, joystick magnitude)
 *   controllerX(NAME)       → reporter (joystick X axis, -100..100)
 *   controllerY(NAME)       → reporter (joystick Y axis, -100..100)
 *   controllerPressed(NAME) → boolean  (button pressed?)
 *   setWidget(NAME, VALUE)  → command  (set slider/dial value from program)
 *
 * The NAME dropdown is populated dynamically from the panel's widget list.
 *
 * @module
 */

// ─── Translations ──────────────────────────────────────────────────────────

const translations = {
  en: {
    'ctrl.name':       'Controller',
    'ctrl.value':      'value of [NAME]',
    'ctrl.x':          '[NAME] x',
    'ctrl.y':          '[NAME] y',
    'ctrl.pressed':    '[NAME] pressed?',
    'ctrl.setWidget':  'set [NAME] to [VALUE]',
    'ctrl.setBargraph': 'set bargraph [NAME] to [VALUE]',
    'ctrl.vgaDraw':    'VGA [NAME] draw x [X] y [Y] color [COLOR]',
    'ctrl.vgaClear':   'VGA [NAME] clear',
    'ctrl.lcdPixel':   'LCD [NAME] pixel x [X] y [Y] [ON]',
    'ctrl.lcdText':    'LCD [NAME] text [TEXT]',
    'ctrl.lcdClear':   'LCD [NAME] clear',
    'ctrl.rgbLight':   'set light [NAME] color [COLOR]',
    'ctrl.readKey':    'read key from [NAME]',
    'ctrl.hasKey':     '[NAME] has input?',
    'ctrl.noPanel':    '(no panel)',
  },
  de: {
    'ctrl.name':       'Controller',
    'ctrl.value':      'Wert von [NAME]',
    'ctrl.x':          '[NAME] x',
    'ctrl.y':          '[NAME] y',
    'ctrl.pressed':    '[NAME] gedrückt?',
    'ctrl.setWidget':  'setze [NAME] auf [VALUE]',
    'ctrl.setBargraph': 'Bargraph [NAME] auf [VALUE]',
    'ctrl.vgaDraw':    'VGA [NAME] Pixel x [X] y [Y] Farbe [COLOR]',
    'ctrl.vgaClear':   'VGA [NAME] löschen',
    'ctrl.lcdPixel':   'LCD [NAME] Pixel x [X] y [Y] [ON]',
    'ctrl.lcdText':    'LCD [NAME] Text [TEXT]',
    'ctrl.lcdClear':   'LCD [NAME] löschen',
    'ctrl.rgbLight':   'Licht [NAME] Farbe [COLOR]',
    'ctrl.readKey':    'Taste lesen von [NAME]',
    'ctrl.hasKey':     '[NAME] hat Eingabe?',
    'ctrl.noPanel':    '(kein Panel)',
  },
  fr: {
    'ctrl.name':       'Contrôleur',
    'ctrl.value':      'valeur de [NAME]',
    'ctrl.x':          '[NAME] x',
    'ctrl.y':          '[NAME] y',
    'ctrl.pressed':    '[NAME] appuyé ?',
    'ctrl.setWidget':  'mettre [NAME] à [VALUE]',
    'ctrl.setBargraph': 'bargraphe [NAME] à [VALUE]',
    'ctrl.vgaDraw':    'VGA [NAME] pixel x [X] y [Y] couleur [COLOR]',
    'ctrl.vgaClear':   'VGA [NAME] effacer',
    'ctrl.lcdPixel':   'LCD [NAME] pixel x [X] y [Y] [ON]',
    'ctrl.lcdText':    'LCD [NAME] texte [TEXT]',
    'ctrl.lcdClear':   'LCD [NAME] effacer',
    'ctrl.rgbLight':   'lumière [NAME] couleur [COLOR]',
    'ctrl.readKey':    'lire touche de [NAME]',
    'ctrl.hasKey':     '[NAME] a une entrée ?',
    'ctrl.noPanel':    '(pas de panneau)',
  },
};

// ─── Language detection (same pattern as circuit.js) ───────────────────────

function detectLanguage() {
  const candidates = [];
  try {
    if (typeof window !== 'undefined' && window.ReduxStore?.getState) {
      candidates.push(window.ReduxStore.getState().locales?.locale);
    }
  } catch { /* ignore */ }
  try { candidates.push(localStorage.getItem('tw:language')); } catch { /* ignore */ }
  try {
    if (typeof Scratch !== 'undefined' && Scratch.vm?.runtime?.getLocale) {
      candidates.push(Scratch.vm.runtime.getLocale());
    }
  } catch { /* ignore */ }
  try { candidates.push(document.documentElement.lang); } catch { /* ignore */ }
  try { candidates.push(navigator.language); } catch { /* ignore */ }
  for (const c of candidates) {
    if (typeof c !== 'string' || !c) continue;
    const lower = c.toLowerCase();
    if (lower.startsWith('de')) return 'de';
    if (lower.startsWith('fr')) return 'fr';
    if (lower.startsWith('en')) return 'en';
  }
  return 'en';
}

let currentLang = detectLanguage();

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === 'tw:language') currentLang = detectLanguage();
  });
}

function t(key) {
  return translations[currentLang]?.[key] ?? translations.en[key] ?? key;
}

// ─── Extension ─────────────────────────────────────────────────────────────

export class ControllerExtension {
  constructor() {
    /** @type {import('./controller.js').ControllerPanel | null} */
    this._panel = null;

    /** @type {object | null} */
    this._runtime =
      typeof Scratch !== 'undefined' && Scratch.vm?.runtime
        ? Scratch.vm.runtime
        : null;
  }

  // ── Panel resolution ─────────────────────────────────────────────────

  get panel() {
    return this._panel || (this._runtime && this._runtime.controllerPanel) || null;
  }

  /** Explicitly attach a panel (overrides the runtime fallback). */
  setPanel(panel) { this._panel = panel; }

  /** Detach the explicit panel. */
  clearPanel() { this._panel = null; }

  // ── getInfo ──────────────────────────────────────────────────────────

  getInfo() {
    return {
      id: 'controller',
      name: t('ctrl.name'),
      color1: '#7C3AED',
      color2: '#6D28D9',
      color3: '#5B21B6',
      blocks: [
        {
          opcode: 'controllerValue',
          blockType: Scratch.BlockType.REPORTER,
          text: t('ctrl.value'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
        {
          opcode: 'controllerX',
          blockType: Scratch.BlockType.REPORTER,
          text: t('ctrl.x'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
        {
          opcode: 'controllerY',
          blockType: Scratch.BlockType.REPORTER,
          text: t('ctrl.y'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
        {
          opcode: 'controllerPressed',
          blockType: Scratch.BlockType.BOOLEAN,
          text: t('ctrl.pressed'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
        '---',
        {
          opcode: 'setWidget',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.setWidget'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
            VALUE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
          },
        },
        {
          opcode: 'setBargraphLevel',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.setBargraph'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
            VALUE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
          },
        },
        '---',
        {
          opcode: 'vgaDrawPixel',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.vgaDraw'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
            X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            COLOR: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
          },
        },
        {
          opcode: 'vgaClear',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.vgaClear'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
        '---',
        {
          opcode: 'monoLcdPixel',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.lcdPixel'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
            X: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            Y: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            ON: { type: Scratch.ArgumentType.NUMBER, defaultValue: 1 },
          },
        },
        {
          opcode: 'monoLcdText',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.lcdText'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
            TEXT: { type: Scratch.ArgumentType.STRING, defaultValue: 'Hello' },
          },
        },
        {
          opcode: 'monoLcdClear',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.lcdClear'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
        '---',
        {
          opcode: 'setRgbLight',
          blockType: Scratch.BlockType.COMMAND,
          text: t('ctrl.rgbLight'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
            COLOR: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0xFF0000 },
          },
        },
        '---',
        {
          opcode: 'readKeyboard',
          blockType: Scratch.BlockType.REPORTER,
          text: t('ctrl.readKey'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
        {
          opcode: 'keyboardHasInput',
          blockType: Scratch.BlockType.BOOLEAN,
          text: t('ctrl.hasKey'),
          arguments: {
            NAME: { type: Scratch.ArgumentType.STRING, menu: 'WIDGETS', defaultValue: '' },
          },
        },
      ],
      menus: {
        WIDGETS: {
          acceptReporters: true,
          items: '_getWidgetMenu',
        },
      },
    };
  }

  // ── Dynamic menu ─────────────────────────────────────────────────────

  _getWidgetMenu() {
    const p = this.panel;
    if (!p) return [{ text: t('ctrl.noPanel'), value: '' }];
    const names = p.getWidgetNames();
    if (names.length === 0) return [{ text: t('ctrl.noPanel'), value: '' }];
    return names.map(n => ({ text: n, value: n }));
  }

  // ── Reporters ────────────────────────────────────────────────────────

  controllerValue({ NAME }) {
    const p = this.panel;
    return p ? p.getValue(String(NAME)) : 0;
  }

  controllerX({ NAME }) {
    const p = this.panel;
    return p ? p.getX(String(NAME)) : 0;
  }

  controllerY({ NAME }) {
    const p = this.panel;
    return p ? p.getY(String(NAME)) : 0;
  }

  controllerPressed({ NAME }) {
    const p = this.panel;
    return p ? p.isPressed(String(NAME)) : false;
  }

  // ── Display/input widget commands ──────────────────────────────────

  setBargraphLevel({ NAME, VALUE }) {
    const p = this.panel;
    if (p) p.setBargraphValue(String(NAME), Number(VALUE));
  }

  vgaDrawPixel({ NAME, X, Y, COLOR }) {
    const p = this.panel;
    if (p) p.setVgaPixel(String(NAME), Number(X), Number(Y), Number(COLOR));
  }

  vgaClear({ NAME }) {
    const p = this.panel;
    if (p) p.clearVga(String(NAME));
  }

  monoLcdPixel({ NAME, X, Y, ON }) {
    const p = this.panel;
    if (p) p.setMonoLcdPixel(String(NAME), Number(X), Number(Y), !!Number(ON));
  }

  monoLcdText({ NAME, TEXT }) {
    const p = this.panel;
    if (p) p.setMonoLcdText(String(NAME), String(TEXT));
  }

  monoLcdClear({ NAME }) {
    const p = this.panel;
    if (p) p.clearMonoLcd(String(NAME));
  }

  setRgbLight({ NAME, COLOR }) {
    const p = this.panel;
    if (p) p.setRgbLightColor(String(NAME), Number(COLOR));
  }

  readKeyboard({ NAME }) {
    const p = this.panel;
    return p ? p.readKeyboardKey(String(NAME)) : 0;
  }

  keyboardHasInput({ NAME }) {
    const p = this.panel;
    return p ? p.hasKeyboardInput(String(NAME)) : false;
  }

  // ── Generic set widget ──────────────────────────────────────────────

  setWidget({ NAME, VALUE }) {
    const p = this.panel;
    if (!p) return;
    const name = String(NAME);
    const w = p.getWidget(name);
    if (!w) return;
    const val = Number(VALUE);
    if (w.type === 'slider' || w.type === 'dial') {
      p.setSliderInput(name, val);
    } else if (w.type === 'gauge') {
      p.setGaugeValue(name, val);
    } else if (w.type === 'button') {
      p.setButtonInput(name, !!val);
    } else if (w.type === 'joystick') {
      // setWidget on a joystick sets X; use controllerY block for Y
      p.setJoystickInput(name, val, p.getY(name));
    } else if (w.type === 'dpad') {
      const v = Math.round(val);
      p.setDpadInput(name, 'up',    !!(v & 1));
      p.setDpadInput(name, 'down',  !!(v & 2));
      p.setDpadInput(name, 'left',  !!(v & 4));
      p.setDpadInput(name, 'right', !!(v & 8));
    } else if (w.type === 'bargraph') {
      p.setBargraphValue(name, val);
    } else if (w.type === 'sevenseg') {
      p.setSevenSegValue(name, val);
    } else if (w.type === 'matrix') {
      p.setMatrixValue(name, val);
    } else if (w.type === 'rgb_light') {
      p.setRgbLightColor(name, val);
    } else if (w.type === 'lcd') {
      p.setLcdText(name, String(VALUE));
    } else if (w.type === 'oled') {
      p.setOledText(name, String(VALUE));
    } else if (w.type === 'mono_lcd') {
      p.setMonoLcdText(name, String(VALUE));
    }
  }
}

// ── Self-register when loaded as a Scratch extension ───────────────────────

if (typeof Scratch !== 'undefined' && Scratch.extensions?.register) {
  Scratch.extensions.register(new ControllerExtension());
}
