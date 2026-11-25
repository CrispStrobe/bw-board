// SPDX-License-Identifier: MIT
/** KIM-1 system device: one shared Board clock, solver-visible GPIO, no ROM. */
import {registerDevice} from '../devices.js';
import {
  createKim1Machine, resetKim1Machine, controlKim1Machine, stepKim1Machine,
  observeKim1Inputs, advanceKim1Cycles, kim1TimerDeadlineCycles,
  parseKim1Program, formatKim1Program, KIM1_DEFAULT_PROGRAM
} from '../kim1-machine.js';

export const KIM1_TERMINALS = Object.freeze([
  ...Array.from({length: 8}, (_, i) => `PA${i}`),
  ...Array.from({length: 6}, (_, i) => `PB${i}`), 'PB7', '5v', 'gnd'
]);
const SECOND = 1_000_000_000n;

/** Hardware nominal is 1 MHz; the slow default makes real circuit changes visible. */
export function kim1ClockHz(part) {
  const hz = part.params?.clockHz ?? 1000;
  if (!Number.isSafeInteger(hz) || hz < 1 || hz > 1_000_000) {
    throw new Error('KIM-1 clockHz must be an integer from 1 through 1000000.');
  }
  return hz;
}

function cycleDelay(state, cycles, includePhase = false) {
  const hz = BigInt(state._clockHz);
  const scaled = BigInt(cycles) * SECOND - (includePhase ? state._cyclePhase : 0n);
  return (scaled + hz - 1n) / hz;
}

function schedule(state) {
  if (!state.running || state.error) state._nextInstructionNs = null;
  else if (state._nextInstructionNs === null) state._nextInstructionNs = state._timeNs + cycleDelay(state, 1);
  const timerCycles = kim1TimerDeadlineCycles(state);
  const timer = timerCycles === null ? null : state._timeNs + cycleDelay(state, timerCycles, true);
  const instruction = state._nextInstructionNs;
  state._wakeNs = timer === null ? instruction : instruction === null ? timer : timer < instruction ? timer : instruction;
}

function driveOutputs(state) {
  const desired = {'5v': {vTh: 5, rTh: 0.1}, gnd: {vTh: 0, rTh: 0.1}};
  const riot = state.riots[0];
  for (const prefix of ['PA', 'PB']) {
    const ddr = prefix === 'PA' ? riot.ddra : riot.ddrb;
    const value = prefix === 'PA' ? riot.pa : riot.pb;
    for (let bit = 0; bit < 8; bit++) {
      if (prefix === 'PB' && bit === 6) continue;
      const timerPin = prefix === 'PB' && bit === 7 && riot.timer.irqEnabled && riot.timer.expired;
      const output = timerPin || !!(ddr & (1 << bit));
      const high = !timerPin && !!(value & (1 << bit));
      desired[`${prefix}${bit}`] = output ? {vTh: high ? 5 : 0, rTh: high ? 220 : 10} : null;
    }
  }
  const changed = Object.keys(desired).some(pin =>
    state.drives[pin]?.vTh !== desired[pin]?.vTh || state.drives[pin]?.rTh !== desired[pin]?.rTh);
  state.drives = desired;
  return changed;
}

function advanceClock(state, tNs) {
  if (tNs < state._timeNs) throw new Error('KIM-1 Board clock moved backwards without reset.');
  const scaled = (tNs - state._timeNs) * BigInt(state._clockHz) + state._cyclePhase;
  const cycles = Number(scaled / SECOND);
  if (!Number.isSafeInteger(cycles)) throw new Error('KIM-1 elapsed cycle interval is too large.');
  state._cyclePhase = scaled % SECOND;
  state._timeNs = tNs;
  advanceKim1Cycles(state, cycles);
}

export function registerKim1Device() {
  registerDevice('kim-1', {
    terminals: [...KIM1_TERMINALS],
    automaticSupplyFallbackTerminals: new Set(['5v']),
    init(part) {
      const state = createKim1Machine(part.params?.program ?? KIM1_DEFAULT_PROGRAM);
      Object.assign(state, {drives: {}, _timeNs: 0n, _cyclePhase: 0n, _clockHz: kim1ClockHz(part),
        _nextInstructionNs: null, _wakeNs: null, _paramsProgram: part.params?.program,
        _paramsClockHz: part.params?.clockHz});
      driveOutputs(state); schedule(state);
      return state;
    },
    reset(part, state) {
      resetKim1Machine(state);
      state._timeNs = 0n; state._cyclePhase = 0n; state._nextInstructionNs = null;
      state._clockHz = kim1ClockHz(part);
      driveOutputs(state); schedule(state);
    },
    stamp(ctx) {
      // Tiny numerical reference for otherwise floating inputs; authored
      // switches should use explicit pull resistors. This is not a TTL model.
      for (const pin of KIM1_TERMINALS) if (/^P[AB]/.test(pin)) ctx.conductance(pin, 'gnd', 1e-9);
    },
    update(part, state, read, tNs) {
      advanceClock(state, tNs);
      if (part.params?.program !== state._paramsProgram) {
        try {
          const source = part.params?.program ?? KIM1_DEFAULT_PROGRAM;
          if (formatKim1Program(parseKim1Program(source)) !== state.programSource) {
            controlKim1Machine(state, 'loadProgram', source);
            state._nextInstructionNs = null;
          }
          state._paramsProgram = part.params?.program;
        } catch (error) {
          state.error = String(error.message); state.running = false;
          state._paramsProgram = part.params?.program;
        }
      }
      if (part.params?.clockHz !== state._paramsClockHz) {
        try {
          state._clockHz = kim1ClockHz(part);
          state._paramsClockHz = part.params?.clockHz;
          state._nextInstructionNs = null;
        } catch (error) { state.error = String(error.message); state.running = false; }
      }
      const ground = read('gnd');
      let a = 0, b = 0;
      for (let bit = 0; bit < 8; bit++) {
        if (read(`PA${bit}`) - ground >= 2.5) a |= 1 << bit;
        if (bit !== 6 && read(`PB${bit}`) - ground >= 2.5) b |= 1 << bit;
      }
      observeKim1Inputs(state, a, b);
      if (state.running && !state.error && state._nextInstructionNs !== null && tNs >= state._nextInstructionNs) {
        const cycles = stepKim1Machine(state, {singleStep: false, advanceTimers: false});
        state._nextInstructionNs = state.running && cycles > 0 ? tNs + cycleDelay(state, cycles) : null;
      }
      schedule(state);
      return driveOutputs(state);
    },
    control(part, state, verb, value) {
      kim1ClockHz(part);
      const handled = controlKim1Machine(state, verb, value, {advanceTimers: false});
      if (!handled) return false;
      state._nextInstructionNs = null;
      schedule(state); driveOutputs(state);
      return true;
    },
    vcc: 5
  });
}
