/**
 * Pin alternate-function lookup — reads bw-parts sidecars directly.
 *
 * Returns the three-state distinction the schema requires:
 *   - Array with entries: audited, pin has these functions
 *   - Empty array []: audited, pin has no alternates (GPIO only)
 *   - null: not yet audited (unknown)
 *   - undefined: unknown board kind or unknown pin name
 *
 * Does NOT re-encode the data — reads bw-parts' audited sidecars
 * so there is one source of truth with datasheet citations.
 *
 * TWIN IMPLEMENTATION: bw-circuit-ui has its own accessor at
 *   bw-circuit-ui/src/model/pin-functions.js (getPinFunctionsForPart)
 * which reads the same schema from vendored sidecars in the browser
 * bundle. That split is architecturally right (browser code cannot
 * import across a sibling repo path), but it means the four states
 * (null, [], [...], ["analog_only"]) are interpreted in two places.
 * If the schema gains a fifth state, BOTH accessors must be updated.
 * See spec-updates/pin-alternates-schema.md §Two implementations.
 *
 * @module
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** @type {Map<string, object>} boardKind → parsed sidecar */
const cache = new Map();

/** Path to bw-parts sidecars, relative to this file's location. */
const PARTS_DIR = path.resolve(here, '../../bw-parts/parts');

/**
 * Board kind → sidecar filename. The sidecar is the canonical source;
 * if bw-parts renames a file, update this map.
 */
const BOARD_FILES = {
  stc_mcu: 'stc_mcu.json',
  stc12: 'stc_mcu.json',          // alias
  arduino_uno: 'arduino_uno.json', // 28 terminals, entirely unaudited (all null)
  arduino_nano: 'arduino_nano.json', // 30 terminals including A6/A7 analog-only
  pi_pico: 'pi_pico.json',
};

function loadSidecar(boardKind) {
  if (cache.has(boardKind)) return cache.get(boardKind);

  const filename = BOARD_FILES[boardKind];
  if (!filename) { cache.set(boardKind, null); return null; }

  const filepath = path.resolve(PARTS_DIR, filename);
  if (!existsSync(filepath)) { cache.set(boardKind, null); return null; }

  try {
    const data = JSON.parse(readFileSync(filepath, 'utf8'));
    const terminals = data.terminals ?? [];
    // Build a name → terminal map for O(1) lookup
    const pinMap = new Map();
    for (const t of terminals) {
      if (t.name) pinMap.set(t.name, t);
    }
    cache.set(boardKind, pinMap);
    return pinMap;
  } catch {
    cache.set(boardKind, null);
    return null;
  }
}

/**
 * Get the alternate functions for a pin on a specific board.
 *
 * @param {string} boardKind - e.g. 'arduino_nano', 'stc_mcu', 'pi_pico'
 * @param {string} pinName - e.g. 'D13', 'P1.3', 'GP0'
 * @returns {string[] | null | undefined}
 *   - string[]: audited functions (may include 'analog_only')
 *   - []: audited, no alternates beyond GPIO
 *   - null: pin exists in sidecar but functions not yet audited
 *   - undefined: unknown board kind or pin not in sidecar
 */
export function getPinFunctions(boardKind, pinName) {
  const pinMap = loadSidecar(boardKind);
  if (!pinMap) return undefined; // unknown board kind

  const terminal = pinMap.get(pinName);
  if (!terminal) return undefined; // pin not in sidecar

  // Propagate the three-state distinction:
  // null = not audited, [] = audited none, [...] = audited with entries
  const fn = terminal.functions;
  if (fn === null || fn === undefined) return null;
  if (!Array.isArray(fn)) return null;
  return fn; // [] or [...] — both are valid audited states
}

/**
 * Get all pin names for a board kind.
 * @param {string} boardKind
 * @returns {string[] | undefined}
 */
export function getBoardPins(boardKind) {
  const pinMap = loadSidecar(boardKind);
  if (!pinMap) return undefined;
  return [...pinMap.keys()];
}

/**
 * Get the full terminal record for a pin (position, functions, notes).
 * @param {string} boardKind
 * @param {string} pinName
 * @returns {object | undefined}
 */
export function getPinInfo(boardKind, pinName) {
  const pinMap = loadSidecar(boardKind);
  if (!pinMap) return undefined;
  return pinMap.get(pinName);
}
