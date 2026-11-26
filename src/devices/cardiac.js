// SPDX-License-Identifier: MIT
/** Modern circuit adapter for CARDIAC's decimal card I/O. Board owns all time. */
import {registerDevice} from '../devices.js';
import {
  createCardiacMachine, controlCardiacMachine, resetCardiacMachine,
  stepCardiacMachine, enqueueCardiacInput, formatCardiacProgram
} from '../cardiac-machine.js';

export const CARDIAC_TERMINALS = Object.freeze(['IN', 'OUT', '5v', 'gnd']);

export function cardiacInstructionPeriodNs(part) {
  const hz = part.params?.instructionHz ?? 10;
  if (typeof hz !== 'number' || !Number.isFinite(hz) || hz < 1 || hz > 1000) {
    throw new RangeError('CARDIAC instructionHz must be a number from 1 to 1000.');
  }
  return BigInt(Math.round(1e9 / hz));
}

export function cardiacInputWord(voltage) {
  if (!Number.isFinite(voltage)) throw new RangeError('CARDIAC IN voltage must be finite.');
  return Math.round(Math.max(0, Math.min(5, voltage)) * 999 / 5);
}

function schedule(part, state) {
  const m = state.machine;
  if (!m.running || m.waiting || m.halted || m.error) state._nextInstructionNs = null;
  else if (state._nextInstructionNs === null) state._nextInstructionNs = state._timeNs + cardiacInstructionPeriodNs(part);
  state._wakeNs = state._nextInstructionNs;
}

function synchronize(state) {
  // The machine is authoritative; these fields support existing Board panels.
  Object.assign(state, state.machine);
  state.outputHigh = state.machine.lastOutput === 1;
  const desired = {
    '5v': {vTh: 5, rTh: 0.1}, gnd: {vTh: 0, rTh: 0.1},
    OUT: {vTh: state.outputHigh ? 5 : 0, rTh: state.outputHigh ? 220 : 10}
  };
  const changed = Object.entries(desired).some(([pin, d]) =>
    state.drives[pin]?.vTh !== d.vTh || state.drives[pin]?.rTh !== d.rTh);
  state.drives = desired;
  return changed;
}

export function registerCardiacDevice() {
  registerDevice('cardiac', {
    terminals: [...CARDIAC_TERMINALS],
    automaticSupplyFallbackTerminals: new Set(['5v']),
    init(part) {
      cardiacInstructionPeriodNs(part);
      const state = {
        machine: createCardiacMachine(part.params?.program), drives: {},
        inputVoltage: 0, sampledInput: null, _timeNs: 0n, _nextInstructionNs: null,
        _paramsProgram: part.params?.program, _paramsInstructionHz: part.params?.instructionHz
      };
      synchronize(state); schedule(part, state);
      return state;
    },
    reset(part, state) {
      resetCardiacMachine(state.machine);
      state._timeNs = 0n; state._nextInstructionNs = null; state.sampledInput = null;
      synchronize(state); schedule(part, state);
    },
    stamp(ctx) { ctx.conductance('IN', 'gnd', 1 / 33000); },
    update(part, state, read, tNs) {
      state._timeNs = tNs;
      if (part.params?.program !== state._paramsProgram) {
        try {
          const next = part.params?.program ?? {words: [], entry: 0};
          // Saving the initial image must not erase live self-modification.
          if (formatCardiacProgram(next) !== formatCardiacProgram(state.machine.program)) {
            controlCardiacMachine(state.machine, 'loadProgram', next);
            state._nextInstructionNs = null; state.sampledInput = null;
          }
        } catch (error) {
          state.machine.error = String(error.message); state.machine.running = false;
          state.machine.status = 'error';
        }
        state._paramsProgram = part.params?.program;
      }
      if (part.params?.instructionHz !== state._paramsInstructionHz) {
        try { cardiacInstructionPeriodNs(part); state._nextInstructionNs = null; }
        catch (error) {
          state.machine.error = String(error.message); state.machine.running = false;
          state.machine.status = 'error';
        }
        state._paramsInstructionHz = part.params?.instructionHz;
      }
      state.inputVoltage = read('IN') - read('gnd');
      const m = state.machine;
      if (m.running && !m.waiting && !m.halted && !m.error &&
          state._nextInstructionNs !== null && tNs >= state._nextInstructionNs) {
        stepCardiacMachine(m, {ignoreBreakpoint: false});
        state._nextInstructionNs = m.running && !m.waiting && !m.halted && !m.error ?
          tNs + cardiacInstructionPeriodNs(part) : null;
      }
      schedule(part, state);
      return synchronize(state);
    },
    control(part, state, verb, value) {
      cardiacInstructionPeriodNs(part);
      if (verb === 'sampleInput') {
        const card = cardiacInputWord(state.inputVoltage);
        enqueueCardiacInput(state.machine, card, {source: 'circuit'});
        state.sampledInput = {value: card, voltage: state.inputVoltage, atNs: state._timeNs.toString()};
      } else if (!controlCardiacMachine(state.machine, verb, value)) return false;
      if (['loadProgram', 'reset', 'restore', 'step', 'halt', 'pause', 'setPc'].includes(verb)) {
        state._nextInstructionNs = null;
      }
      if (verb === 'loadProgram' || verb === 'reset') state.sampledInput = null;
      schedule(part, state); synchronize(state);
      return true;
    },
    vcc: 5
  });
}
