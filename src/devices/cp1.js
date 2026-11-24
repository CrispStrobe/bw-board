// SPDX-License-Identifier: MIT
/**
 * CP1 system connector. Execution belongs to Cp1Machine, not this solver model.
 * GPIO uses Board's shared quasi/pushpull Thevenin policy. In particular its
 * quasi pull-up is a generic lesson-model value, not a calibrated NMOS 8049
 * current-voltage characteristic. See docs/CP1-HARDWARE.md.
 * Optional CP3 terminals remain discoverable here; extractCp1Machine gates
 * their electrical use when the connector's expansion option is disabled.
 */
import {registerDevice} from '../devices.js';

export const CP1_TERMINALS = Object.freeze([
  ...Array.from({length: 5}, (_, port) => Array.from({length: port === 4 ? 6 : 8},
    (__, bit) => `P${port + 1}.${bit}`)).flat(), '5v', 'gnd'
]);

export function registerCp1Device() {
  registerDevice('kosmos-cp1', {
    terminals: [...CP1_TERMINALS],
    automaticSupplyFallbackTerminals: new Set(['5v']),
    init() {
      return {drives: {'5v': {vTh: 5, rTh: 0.1}, gnd: {vTh: 0, rTh: 0.1}}};
    },
    update() { return false; },
    gpioFollowsPinStates: true, vcc: 5
  });
}
