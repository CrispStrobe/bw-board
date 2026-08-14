/**
 * Environment Stimulus — Scratch extension for injecting world conditions
 * into the circuit simulation.
 *
 * The blocks-side face of the controller panel's dual binding: where the
 * controller panel binds a widget to a part via the GUI, this extension
 * lets a program (or the user from the palette) set environment parameters
 * directly: "set temperature of dht1 to 35".
 *
 * Block surface:
 *   set [PARAM] of [PART] to [VALUE]  — command: inject stimulus
 *   ([PARAM] of [PART])               — reporter: read current stimulus
 *
 * Two cascading dynamic menus:
 *   PARTS  — lists placed parts from the board that have stimulus params
 *   PARAMS — lists the world-facing params of the selected part
 *
 * Wired through board.setPartParam (for device-model params) or
 * board.setControl (for basic control-value parts).
 *
 * @module
 */

import { STIMULUS_CATALOGUE, getStimulusParts } from './stimulus-catalogue.js';

// ─── Translations ──────────────────────────────────────────────────────────

const translations = {
  en: {
    'stim.name':       'Environment',
    'stim.set':        'set [PARAM] of [PART] to [VALUE]',
    'stim.get':        '[PARAM] of [PART]',
    'stim.noParts':    '(no parts)',
    'stim.noParams':   '(none)',
  },
  de: {
    'stim.name':       'Umgebung',
    'stim.set':        'setze [PARAM] von [PART] auf [VALUE]',
    'stim.get':        '[PARAM] von [PART]',
    'stim.noParts':    '(keine Teile)',
    'stim.noParams':   '(keine)',
  },
  fr: {
    'stim.name':       'Environnement',
    'stim.set':        'mettre [PARAM] de [PART] à [VALUE]',
    'stim.get':        '[PARAM] de [PART]',
    'stim.noParts':    '(pas de pièces)',
    'stim.noParams':   '(aucun)',
  },
};

// ─── Language detection ────────────────────────────────────────────────────

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

export class StimulusExtension {
  constructor() {
    /** @type {import('./board.js').BoardImpl | null} */
    this._board = null;

    /** @type {object | null} */
    this._runtime =
      typeof Scratch !== 'undefined' && Scratch.vm?.runtime
        ? Scratch.vm.runtime
        : null;
  }

  // ── Board resolution ─────────────────────────────────────────────────

  get board() {
    return this._board || (this._runtime && this._runtime.circuitBoard) || null;
  }

  setBoard(board) { this._board = board; }
  clearBoard() { this._board = null; }

  // ── getInfo ──────────────────────────────────────────────────────────

  getInfo() {
    return {
      id: 'environment',
      name: t('stim.name'),
      color1: '#27AE60',
      color2: '#229954',
      color3: '#1E8449',
      blocks: [
        {
          opcode: 'setStimulus',
          blockType: Scratch.BlockType.COMMAND,
          text: t('stim.set'),
          arguments: {
            PARAM: { type: Scratch.ArgumentType.STRING, menu: 'PARAMS', defaultValue: '' },
            PART: { type: Scratch.ArgumentType.STRING, menu: 'PARTS', defaultValue: '' },
            VALUE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
          },
        },
        {
          opcode: 'getStimulus',
          blockType: Scratch.BlockType.REPORTER,
          text: t('stim.get'),
          arguments: {
            PARAM: { type: Scratch.ArgumentType.STRING, menu: 'PARAMS', defaultValue: '' },
            PART: { type: Scratch.ArgumentType.STRING, menu: 'PARTS', defaultValue: '' },
          },
        },
      ],
      menus: {
        PARTS: {
          acceptReporters: true,
          items: '_getPartsMenu',
        },
        PARAMS: {
          acceptReporters: true,
          items: '_getParamsMenu',
        },
      },
    };
  }

  // ── Dynamic menus ────────────────────────────────────────────────────

  _getPartsMenu() {
    const b = this.board;
    if (!b) return [{ text: t('stim.noParts'), value: '' }];
    const stimParts = getStimulusParts(b);
    if (stimParts.length === 0) return [{ text: t('stim.noParts'), value: '' }];
    return stimParts.map(sp => ({
      text: `${sp.partId} (${sp.kind})`,
      value: sp.partId,
    }));
  }

  _getParamsMenu() {
    const b = this.board;
    if (!b) return [{ text: t('stim.noParams'), value: '' }];
    // Collect all unique params from all stimulus parts
    const stimParts = getStimulusParts(b);
    const seen = new Set();
    const items = [];
    for (const sp of stimParts) {
      for (const p of sp.params) {
        const key = p.param;
        if (!seen.has(key)) {
          seen.add(key);
          const label = p.unit ? `${p.label} (${p.unit})` : p.label;
          items.push({ text: label, value: key });
        }
      }
    }
    if (items.length === 0) return [{ text: t('stim.noParams'), value: '' }];
    return items;
  }

  // ── Commands ─────────────────────────────────────────────────────────

  setStimulus({ PARAM, PART, VALUE }) {
    const b = this.board;
    if (!b) return;
    const partId = String(PART);
    const paramName = String(PARAM);
    const value = Number(VALUE);

    const part = b.getParts().find(p => p.id === partId);
    if (!part) return;

    const catEntry = STIMULUS_CATALOGUE[part.kind];
    if (!catEntry) return;

    const paramDef = catEntry.find(p => p.param === paramName);
    if (!paramDef) return;

    // Clamp to valid range
    const clamped = Math.max(paramDef.min, Math.min(paramDef.max, value));

    if (paramDef.mechanism === 'control') {
      b.setControl(partId, clamped);
    } else {
      b.setPartParam(partId, paramName, clamped);
    }
  }

  // ── Reporters ────────────────────────────────────────────────────────

  getStimulus({ PARAM, PART }) {
    const b = this.board;
    if (!b) return 0;
    const partId = String(PART);
    const paramName = String(PARAM);

    const part = b.getParts().find(p => p.id === partId);
    if (!part) return 0;

    const catEntry = STIMULUS_CATALOGUE[part.kind];
    if (!catEntry) return 0;

    const paramDef = catEntry.find(p => p.param === paramName);
    if (!paramDef) return 0;

    if (paramDef.mechanism === 'control') {
      return b.controls.get(partId) ?? 0;
    } else {
      return b.getPartParam(partId, paramName) ?? 0;
    }
  }
}

// ── Self-register when loaded as a Scratch extension ───────────────────────

if (typeof Scratch !== 'undefined' && Scratch.extensions?.register) {
  Scratch.extensions.register(new StimulusExtension());
}
