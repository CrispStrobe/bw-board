// SPDX-License-Identifier: MIT
/**
 * Microtronic system-level Circuits model. CPU execution is documented learner
 * behavior, not a TMS1600/2114 bus simulation. Digital outputs reach the same
 * solver as every external resistor, switch and LED; time comes only from Board.
 */
import {registerDevice} from '../devices.js';
import {
  createMicrotronicMachine, resetMicrotronicMachine, controlMicrotronicMachine,
  stepMicrotronicMachine, observeMicrotronicInputs,
  parseMicrotronicProgram, formatMicrotronicProgram
} from '../microtronic-machine.js';

export const MICROTRONIC_TERMINALS = Object.freeze([
  'IN1', 'IN2', 'IN3', 'IN4', 'OUT1', 'OUT2', 'OUT3', 'OUT4', 'CLOCK', '5v', 'gnd'
]);
const HALF_SECOND = 500_000_000n;

export function microtronicInstructionPeriodNs(part) {
  const hz = part.params?.instructionHz ?? 20;
  if (typeof hz !== 'number' || !Number.isFinite(hz) || hz < 1 || hz > 1000) {
    throw new Error('Microtronic instructionHz must be a number from 1 to 1000.');
  }
  return BigInt(Math.round(1e9 / hz));
}

function schedule(part, state) {
  const now = state._timeNs;
  const clockNext = (now / HALF_SECOND + 1n) * HALF_SECOND;
  if (!state.running || state.waitingForKey !== null || state.error) state._nextInstructionNs = null;
  else if (state._nextInstructionNs === null) state._nextInstructionNs = now + microtronicInstructionPeriodNs(part);
  state._wakeNs = state._nextInstructionNs !== null && state._nextInstructionNs < clockNext ? state._nextInstructionNs : clockNext;
}

function driveOutputs(state) {
  const desired = {
    '5v': {vTh: 5, rTh: 0.1}, gnd: {vTh: 0, rTh: 0.1},
    CLOCK: {vTh: state.clockHigh ? 5 : 0, rTh: state.clockHigh ? 1000 : 10}
  };
  for (let i = 0; i < 4; i++) {
    const high = !!(state.output & (1 << i));
    desired[`OUT${i + 1}`] = {vTh: high ? 5 : 0, rTh: high ? 220 : 10};
  }
  let changed = false;
  for (const [pin, drive] of Object.entries(desired)) {
    if (state.drives[pin]?.vTh !== drive.vTh || state.drives[pin]?.rTh !== drive.rTh) changed = true;
  }
  state.drives = desired;
  return changed;
}

export function registerMicrotronicDevice() {
  registerDevice('busch-microtronic', {
    terminals: [...MICROTRONIC_TERMINALS],
    automaticSupplyFallbackTerminals: new Set(['5v']),
    init(part) {
      microtronicInstructionPeriodNs(part);
      const state = {
        ...createMicrotronicMachine(part.params?.program ?? 'F00'),
        drives: {}, clockHigh: false, _timeNs: 0n, _nextInstructionNs: null,
        _paramsProgram: part.params?.program, _paramsInstructionHz: part.params?.instructionHz
      };
      driveOutputs(state);
      schedule(part, state);
      return state;
    },
    reset(part, state) {
      resetMicrotronicMachine(state);
      state._timeNs = 0n; state._nextInstructionNs = null; state.clockHigh = false;
      driveOutputs(state); schedule(part, state);
    },
    stamp(ctx) {
      for (let i = 1; i <= 4; i++) ctx.conductance(`IN${i}`, 'gnd', 1 / 33000);
    },
    update(part, state, read, tNs) {
      state._timeNs = tNs;
      // Keypad persistence may write the exact current canonical source back
      // into params. Equality must preserve the running machine and its PC.
      if (part.params?.program !== state._paramsProgram) {
        try {
          const next = parseMicrotronicProgram(part.params?.program ?? 'F00');
          if (formatMicrotronicProgram(next) !== state.programSource) {
            controlMicrotronicMachine(state, 'loadProgram', next);
            state._nextInstructionNs = null;
          }
          state._paramsProgram = part.params?.program;
        } catch (error) {
          state.error = String(error.message); state.running = false;
          state._paramsProgram = part.params?.program;
        }
      }
      if (part.params?.instructionHz !== state._paramsInstructionHz) {
        try {
          microtronicInstructionPeriodNs(part);
          state._nextInstructionNs = null;
          state._paramsInstructionHz = part.params?.instructionHz;
        } catch (error) {
          state.error = String(error.message); state.running = false;
        }
      }
      const ground = read('gnd');
      let inputs = 0;
      for (let i = 0; i < 4; i++) if (read(`IN${i + 1}`) - ground >= 2.5) inputs |= 1 << i;
      observeMicrotronicInputs(state, inputs);
      state.clockHigh = (tNs / HALF_SECOND) % 2n === 1n;
      if (state.running && !state.error && state.waitingForKey === null &&
          state._nextInstructionNs !== null && tNs >= state._nextInstructionNs) {
        stepMicrotronicMachine(state, {singleStep: false});
        state._nextInstructionNs = state.running && state.waitingForKey === null ?
          tNs + microtronicInstructionPeriodNs(part) : null;
      }
      schedule(part, state);
      return driveOutputs(state);
    },
    control(part, state, verb, value) {
      microtronicInstructionPeriodNs(part);
      const handled = controlMicrotronicMachine(state, verb, value);
      if (!handled) return false;
      // loadProgram is an intentional runtime write; the next params update
      // may persist it, but stale authored params must not immediately erase it.
      if (verb === 'loadProgram' || verb === 'reset' || verb === 'step' || verb === 'halt' || verb === 'setPc' ||
          (verb === 'key' && ['HALT', 'RESET', 'STEP', 'STP'].includes(String(value).toUpperCase()))) {
        state._nextInstructionNs = null;
      }
      schedule(part, state);
      driveOutputs(state);
      return true;
    },
    vcc: 5
  });
}
