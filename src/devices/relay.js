/**
 * Relay (SPDT) — coil with threshold/hysteresis, switching delay,
 * contacts as controlled switch stamps.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_CONTACT = 0.1;   // closed contact resistance (Ohm)
const R_OPEN = 1e9;       // open contact (effectively infinite)

/**
 * Register the relay device model.
 */
export function registerRelay() {
  registerDevice('relay', {
    terminals: ['coil_a', 'coil_b', 'com', 'nc', 'no'],
    requiredParams: [],

    init(part) {
      return {
        drives: {},
        energized: false,
        // Switching delay state
        _pendingState: null,  // null | { target: boolean, deadlineNs: bigint }
      };
    },

    stamp(ctx, part, state) {
      const coilR = part.params?.coilR ?? 200;

      // Coil: resistor between coil_a and coil_b
      ctx.conductance('coil_a', 'coil_b', 1 / coilR);

      // Contacts: controlled switch via conductance
      if (state.energized) {
        // Energized: com↔no closed, com↔nc open
        ctx.conductance('com', 'no', 1 / R_CONTACT);
        ctx.conductance('com', 'nc', 1 / R_OPEN);
      } else {
        // De-energized: com↔nc closed, com↔no open
        ctx.conductance('com', 'nc', 1 / R_CONTACT);
        ctx.conductance('com', 'no', 1 / R_OPEN);
      }
    },

    update(part, state, read, tNs) {
      const pullInV = part.params?.pullInV ?? 3.7;
      const dropOutV = part.params?.dropOutV ?? 1.5;
      const switchTimeMs = part.params?.switchTimeMs ?? 5;
      const switchTimeNs = BigInt(Math.round(switchTimeMs * 1e6));

      // Coil voltage = |V(coil_a) - V(coil_b)|
      const vCoil = Math.abs(read('coil_a') - read('coil_b'));

      // Determine target state from hysteresis
      let target = state.energized;
      if (vCoil > pullInV) target = true;
      else if (vCoil < dropOutV) target = false;

      // No change needed
      if (target === state.energized && !state._pendingState) {
        return false;
      }

      // Start a new transition
      if (target !== state.energized && !state._pendingState) {
        if (switchTimeNs === 0n) {
          // Instant switching
          state.energized = target;
          state._pendingState = null;
          return true;
        }
        state._pendingState = { target, deadlineNs: tNs + switchTimeNs };
        return false;
      }

      // Cancel pending if target reversed
      if (state._pendingState && state._pendingState.target !== target) {
        state._pendingState = null;
        return false;
      }

      // Check deadline
      if (state._pendingState && tNs >= state._pendingState.deadlineNs) {
        state.energized = state._pendingState.target;
        state._pendingState = null;
        return true;
      }

      return false;
    },
  });
}
