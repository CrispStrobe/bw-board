/**
 * Pin model — Thévenin equivalents for MCU port modes.
 *
 * The four STC12 modes come from STC12-PERIPHERAL-MODEL.md §3 and
 * datasheet §4.6. input-pullup is the AVR/Arduino INPUT_PULLUP idiom.
 * Values are order-of-magnitude fits, not precision — good enough to teach
 * the active-low lesson, not good enough for silicon correlation.
 *
 * @module
 */

/** @typedef {import('./types.js').PinMode} PinMode */
/** @typedef {import('./types.js').TheveninSource} TheveninSource */

/**
 * On-resistance for strong drive (sink or push-pull source).
 * Gives ~20 mA at 5 V into a short: 5 / 0.020 = 250 Ω is too high;
 * the pin itself is ~25 Ω and the 20 mA spec is with an external load.
 * We use 25 Ω — the load sets the actual current.
 */
const R_STRONG = 25;

/**
 * Weak pull-up resistance for quasi-bidirectional mode driving 1.
 * Datasheet says ~230 µA source current at VCC = 5 V.
 * R = VCC / I = 5 / 0.000230 ≈ 21739 Ω. We round to 21700.
 */
const R_QUASI_PULLUP = 21700;

/**
 * Internal pull-up resistance for input-pullup mode.
 * AVR datasheets specify 20–50 kΩ; we use the midpoint.
 * This is a range, not a precise value.
 */
const R_INPUT_PULLUP = 35000;

/**
 * Internal pull-down resistance for input-pulldown mode.
 * RP2040 Datasheet §2.19.6.3, Table 628: typical 50 kΩ (range 40–80 kΩ).
 */
const R_INPUT_PULLDOWN = 50000;

/**
 * Returns the Thévenin equivalent for a pin in the given mode and drive state.
 *
 * @param {PinMode} mode
 * @param {boolean} driveHigh
 * @param {number} vcc - Supply voltage (typically 5.0)
 * @returns {TheveninSource}
 */
export function pinThevenin(mode, driveHigh, vcc) {
  switch (mode) {
    case 'pushpull':
      return driveHigh
        ? { vTh: vcc, rTh: R_STRONG }
        : { vTh: 0, rTh: R_STRONG };

    case 'quasi':
      return driveHigh
        ? { vTh: vcc, rTh: R_QUASI_PULLUP }
        : { vTh: 0, rTh: R_STRONG };

    case 'input':
      return 'high-z';

    case 'input-pullup':
      return { vTh: vcc, rTh: R_INPUT_PULLUP };

    case 'input-pulldown':
      return { vTh: 0, rTh: R_INPUT_PULLDOWN };

    case 'opendrain':
      return driveHigh
        ? 'high-z'
        : { vTh: 0, rTh: R_STRONG };

    default:
      throw new Error(`Unknown pin mode: ${mode}`);
  }
}

export { R_STRONG, R_QUASI_PULLUP, R_INPUT_PULLUP, R_INPUT_PULLDOWN };
