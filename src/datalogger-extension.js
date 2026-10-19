/**
 * Datalogger — Scratch extension for time-series data capture.
 *
 * MakeCode's micro:bit datalogger is the UX reference: log values with
 * named columns, view them in a table, export CSV.  Our version is simpler
 * because there is no filesystem — data lives in-memory and persists
 * with the project via serialize/restore.
 *
 * Block surface (RUNTIME_EXTENSIONS shape):
 *   log [VALUE] as [SERIES]          — command: append timestamped value
 *   clear series [SERIES]            — command: clear one series
 *   clear all logs                   — command: clear everything
 *   (latest value of [SERIES])       — reporter: most recent logged value
 *   (entries in [SERIES])            — reporter: count of entries
 *   (number of series)              — reporter: how many series exist
 *   (series names)                  — reporter: comma-separated list
 *
 * The DataLogger instance is resolved lazily from vm.runtime.dataLogger
 * or injected via setLogger().
 *
 * @module
 */

import { DataLogger } from './datalogger.js';

// ─── Translations ──────────────────────────────────────────────────────────

const translations = {
  en: {
    'dl.name':        'Data Logger',
    'dl.log':         'log [VALUE] as [SERIES]',
    'dl.clearSeries': 'clear series [SERIES]',
    'dl.clearAll':    'clear all logs',
    'dl.latest':      'latest value of [SERIES]',
    'dl.count':       'entries in [SERIES]',
    'dl.seriesCount': 'number of series',
    'dl.seriesNames': 'series names',
    'dl.noSeries':    '(none)',
    'dl.default':     'data',
  },
  de: {
    'dl.name':        'Datenlogger',
    'dl.log':         'logge [VALUE] als [SERIES]',
    'dl.clearSeries': 'lösche Serie [SERIES]',
    'dl.clearAll':    'lösche alle Daten',
    'dl.latest':      'letzter Wert von [SERIES]',
    'dl.count':       'Einträge in [SERIES]',
    'dl.seriesCount': 'Anzahl Serien',
    'dl.seriesNames': 'Seriennamen',
    'dl.noSeries':    '(keine)',
    'dl.default':     'Daten',
  },
  fr: {
    'dl.name':        'Enregistreur',
    'dl.log':         'enregistrer [VALUE] dans [SERIES]',
    'dl.clearSeries': 'effacer série [SERIES]',
    'dl.clearAll':    'effacer tout',
    'dl.latest':      'dernière valeur de [SERIES]',
    'dl.count':       "entrées dans [SERIES]",
    'dl.seriesCount': 'nombre de séries',
    'dl.seriesNames': 'noms des séries',
    'dl.noSeries':    '(aucune)',
    'dl.default':     'données',
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

export class DataLoggerExtension {
  constructor() {
    /** @type {DataLogger | null} */
    this._logger = null;

    /** @type {object | null} */
    this._runtime =
      typeof Scratch !== 'undefined' && Scratch.vm?.runtime
        ? Scratch.vm.runtime
        : null;
  }

  // ── Logger resolution ────────────────────────────────────────────────

  get logger() {
    return this._logger || (this._runtime && this._runtime.dataLogger) || null;
  }

  /** Auto-create a logger if none exists. */
  _ensureLogger() {
    let l = this.logger;
    if (!l) {
      l = new DataLogger();
      this._logger = l;
      // Also publish for other consumers
      if (this._runtime) this._runtime.dataLogger = l;
    }
    return l;
  }

  setLogger(logger) { this._logger = logger; }
  clearLogger() { this._logger = null; }

  // ── getInfo ──────────────────────────────────────────────────────────

  getInfo() {
    return {
      id: 'datalogger',
      name: t('dl.name'),
      color1: '#E67E22',
      color2: '#D35400',
      color3: '#A04000',
      blocks: [
        {
          opcode: 'logValue',
          blockType: Scratch.BlockType.COMMAND,
          text: t('dl.log'),
          arguments: {
            VALUE: { type: Scratch.ArgumentType.NUMBER, defaultValue: 0 },
            SERIES: { type: Scratch.ArgumentType.STRING, defaultValue: t('dl.default') },
          },
        },
        {
          opcode: 'clearSeries',
          blockType: Scratch.BlockType.COMMAND,
          text: t('dl.clearSeries'),
          arguments: {
            SERIES: { type: Scratch.ArgumentType.STRING, menu: 'SERIES_MENU', defaultValue: '' },
          },
        },
        {
          opcode: 'clearAll',
          blockType: Scratch.BlockType.COMMAND,
          text: t('dl.clearAll'),
        },
        '---',
        {
          opcode: 'latestValue',
          blockType: Scratch.BlockType.REPORTER,
          text: t('dl.latest'),
          arguments: {
            SERIES: { type: Scratch.ArgumentType.STRING, menu: 'SERIES_MENU', defaultValue: '' },
          },
        },
        {
          opcode: 'entryCount',
          blockType: Scratch.BlockType.REPORTER,
          text: t('dl.count'),
          arguments: {
            SERIES: { type: Scratch.ArgumentType.STRING, menu: 'SERIES_MENU', defaultValue: '' },
          },
        },
        {
          opcode: 'seriesCount',
          blockType: Scratch.BlockType.REPORTER,
          text: t('dl.seriesCount'),
        },
        {
          opcode: 'seriesNames',
          blockType: Scratch.BlockType.REPORTER,
          text: t('dl.seriesNames'),
        },
      ],
      menus: {
        SERIES_MENU: {
          acceptReporters: true,
          items: '_getSeriesMenu',
        },
      },
    };
  }

  // ── Dynamic menu ─────────────────────────────────────────────────────

  _getSeriesMenu() {
    const l = this.logger;
    if (!l) return [{ text: t('dl.noSeries'), value: '' }];
    const names = l.getSeriesNames();
    if (names.length === 0) return [{ text: t('dl.noSeries'), value: '' }];
    return names.map(n => ({ text: n, value: n }));
  }

  // ── Commands ─────────────────────────────────────────────────────────

  logValue({ VALUE, SERIES }) {
    this._ensureLogger().log(Number(VALUE), String(SERIES));
  }

  clearSeries({ SERIES }) {
    const l = this.logger;
    if (l) l.clear(String(SERIES));
  }

  clearAll() {
    const l = this.logger;
    if (l) l.clear();
  }

  // ── Reporters ────────────────────────────────────────────────────────

  latestValue({ SERIES }) {
    const l = this.logger;
    return l ? l.getLatest(String(SERIES)) : 0;
  }

  entryCount({ SERIES }) {
    const l = this.logger;
    return l ? l.getEntryCount(String(SERIES)) : 0;
  }

  seriesCount() {
    const l = this.logger;
    return l ? l.getSeriesCount() : 0;
  }

  seriesNames() {
    const l = this.logger;
    return l ? l.getSeriesNames().join(', ') : '';
  }
}

// ── Self-register when loaded as a Scratch extension ───────────────────────

if (typeof Scratch !== 'undefined' && Scratch.extensions?.register) {
  Scratch.extensions.register(new DataLoggerExtension());
}
