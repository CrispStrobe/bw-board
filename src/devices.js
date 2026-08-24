/**
 * Device model registry — the extension point for part kinds beyond the
 * built-in electrical set (logic gates, shift registers, relays, motors,
 * servos, timer ICs, …).
 *
 * A device model is registered once per kind and contributes three things:
 *
 *  1. `terminals` (required) — names, consumed by netlist validation.
 *  2. Analog presence — optional `stamp(ctx, part, state)`, called on every
 *     Newton–Raphson iteration to add input impedance or other passive
 *     loading, plus GENERIC stamping of `state.drives`: any terminal the
 *     device currently drives is stamped as a Thévenin source, exactly like
 *     an MCU pin. A device that drives nothing and loads nothing is invisible
 *     to the network — often right for a purely mechanical state.
 *  3. Digital/behavioral step — optional `update(part, state, read, tNs)`,
 *     called by the board AFTER each solve with `read(terminal) → volts`.
 *     The model inspects its inputs, mutates its own `state` (including
 *     `state.drives`), and returns `true` if anything changed that requires
 *     re-solving the network. The board iterates solve → update to a
 *     fixpoint (bounded), which lets gate chains settle within one event.
 *
 * The honesty rule applies here as everywhere: a model that cannot represent
 * something reports it (a refusal string, a warning) — it never invents a
 * plausible number.
 *
 * @module
 */

/**
 * @typedef {object} DeviceModel
 * @property {string[]} terminals - terminal names, for validation
 * @property {string[]} [requiredParams] - params validation should insist on
 * @property {(part: import('./types.js').Part) => object} [init]
 *   Create per-part persistent state. Default: `{ drives: {} }`.
 *   `state.drives` maps terminal → {vTh, rTh} | null (null = high-Z).
 * @property {(ctx: DeviceStampCtx, part: import('./types.js').Part, state: object) => void} [stamp]
 *   Add passive/analog loading each NR iteration (input impedance etc.).
 * @property {(part: import('./types.js').Part, state: object,
 *             read: (terminal: string) => number, tNs: bigint) => boolean} [update]
 *   Behavioral step; return true if the network must be re-solved.
 * @property {(part: import('./types.js').Part, state: object,
 *             read: (terminal: string) => number) => Map<string, number>} [branchCurrents]
 *   Optional terminal currents for the instruments.
 * Scheduled events: `update()` may set `state._wakeNs` (BigInt, absolute
 * sim time) and the board sub-steps advanceTo TO that instant exactly —
 * the canonical deadline field (spec-updates/scheduled-device-events.md);
 * clear it (null) when consumed. Legacy per-device deadline fields keep
 * working.
 * @property {(part: import('./types.js').Part, state: object,
 *             verb: string, value: *) => boolean} [control]
 *   High-level user/program intent — the write counterpart of
 *   getDeviceState (boundary B setDeviceControl,
 *   spec-updates/set-device-control.md). Return true if the verb was
 *   handled (the board re-solves and notifies); anything else means "not
 *   a verb this device understands" and the board records a visible
 *   refusal warning rather than dropping it silently.
 */

/**
 * @typedef {object} DeviceStampCtx
 * @property {(terminal: string) => string | undefined} netFor
 * @property {(tA: string, tB: string | null, g: number) => void} conductance
 *   Conductance between two terminals' nets (tB null = to reference).
 * @property {(terminal: string, vTh: number, rTh: number) => void} thevenin
 *   Norton-stamp a Thévenin source driving this terminal.
 * @property {(terminal: string, amps: number) => void} current
 *   Inject a current into this terminal's net.
 * @property {number} vcc
 * @property {number} tSeconds
 * @property {number} [dtSec] - present during transient sub-steps
 * @property {number | undefined} control - this part's control value
 */

/** @type {Map<string, DeviceModel>} */
const REGISTRY = new Map();

/**
 * Register a device model for a part kind. Re-registering a kind replaces the
 * model (useful in tests); registering over a BUILT-IN kind is refused — the
 * built-ins are the shared contract, not a default.
 *
 * @param {string} kind
 * @param {DeviceModel} model
 */
export function registerDevice(kind, model) {
  if (BUILTIN_KINDS.has(kind)) {
    throw new Error(`Cannot register device over built-in kind "${kind}"`);
  }
  if (!model || !Array.isArray(model.terminals) || model.terminals.length === 0) {
    throw new Error(`Device model for "${kind}" must declare its terminals`);
  }
  REGISTRY.set(kind, model);
}

/**
 * Whether a device model is registered for this kind. The circuit UI asks
 * this before deciding whether a board-level kind (arduino_uno, attiny85,
 * ...) keeps its identity in the engine netlist or collapses to the
 * generic 'mcu' surface — a registered model is strictly more truthful
 * (power rails source, gpioFollowsPinStates, readPin works).
 * @param {string} kind
 * @returns {boolean}
 */
export function hasDevice(kind) {
  return REGISTRY.has(kind);
}

/** @param {string} kind @returns {DeviceModel | undefined} */
export function getDevice(kind) {
  return REGISTRY.get(kind);
}

/** @returns {string[]} */
export function registeredKinds() {
  return [...REGISTRY.keys()];
}

/** @param {string} kind */
export function unregisterDevice(kind) {
  REGISTRY.delete(kind);
}

/** Create a part's initial state via the model (or the default shape). */
export function initDeviceState(part) {
  const model = REGISTRY.get(part.kind);
  if (!model) return null;
  const state = model.init ? model.init(part) : {};
  if (!state.drives) state.drives = {};
  return state;
}

/**
 * Part kinds owned by the core engine. The registry may not shadow them.
 * (Kept here, not imported from board.js, to avoid a dependency cycle.)
 */
const BUILTIN_KINDS = new Set([
  'vcc', 'gnd', 'resistor', 'capacitor', 'inductor', 'transformer', 'diode', 'led', 'zener',
  'potentiometer', 'button', 'switch', 'buzzer', 'ldr', 'ntc',
  'npn', 'pnp', 'nmos', 'pmos', 'opamp', 'vsource', 'isource', 'mcu',
  'seven_segment', 'rgb_led', 'led_matrix', 'led_cube',
  // char_lcd moved OUT of the built-ins 2026-08-14: it was a
  // validation-only entry with no board behavior, while the registry
  // has the real HD44780 silicon — registerHD44780() provides the
  // kind under the designer catalog's terminal names.
  'shift_register', 'ir_receiver', 'temp_sensor', 'eeprom',
]);

export { BUILTIN_KINDS };
