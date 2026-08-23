/**
 * Logic gates — 74HC-flavored CMOS: AND, OR, NOT, NAND, NOR, XOR.
 *
 * Inputs: threshold at 30% VCC (V_IL) and 70% VCC (V_IH).
 * Outputs: Thévenin driver with configurable R_out (default 50 Ohm).
 * Propagation delay: not yet modelled (would need scheduled events in the
 * board loop — noted in the spec, deferred to a second pass).
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT_DEFAULT = 50;
const R_INPUT = 1e6; // CMOS gate input impedance

/**
 * Build terminal list for a gate with N inputs.
 * @param {number} n
 * @returns {string[]}
 */
function gateTerminals(n) {
  const t = [];
  for (let i = 0; i < n; i++) t.push(`in${i}`);
  t.push('out');
  return t;
}

/**
 * Read input logic levels using CMOS thresholds.
 * @param {import('../types.js').Part} part
 * @param {(terminal: string) => number} read
 * @param {number} vcc
 * @returns {number[]} array of 0 or 1 per input
 */
function readInputs(part, state, read, vcc) {
  const n = part.params?.inputs ?? 2;
  const vIL = 0.3 * vcc;
  const vIH = 0.7 * vcc;
  const levels = [];
  for (let i = 0; i < n; i++) {
    const v = read(`in${i}`);
    if (v > vIH) levels.push(1);
    else if (v < vIL) levels.push(0);
    else levels.push(state._lastInputs?.[i] ?? 0); // hysteresis: hold
  }
  return levels;
}

function makeGateModel(kind, evalFn) {
  return {
    terminals: null, // computed per-part — see init
    requiredParams: [],
    init(part) {
      const n = part.params?.inputs ?? (kind === 'gate_not' ? 1 : 2);
      return {
        drives: { out: { vTh: 0, rTh: part.params?.rOut ?? R_OUT_DEFAULT } },
        _lastInputs: new Array(n).fill(0),
        _outLevel: 0,
      };
    },
    stamp(ctx, part, state) {
      // High-impedance loading on each input
      const n = part.params?.inputs ?? (kind === 'gate_not' ? 1 : 2);
      for (let i = 0; i < n; i++) {
        ctx.conductance(`in${i}`, null, 1 / R_INPUT);
      }
      // update() has no ctx; the rail is captured here (stamp runs before
      // every update pass) so thresholds and the output high level track
      // the board's actual supply instead of a hard-coded 5 V.
      state._vcc = ctx.vcc;
    },
    update(part, state, read, tNs) {
      const vcc = state._vcc ?? 5.0;
      const inputs = readInputs(part, state, read, vcc);
      const outLevel = evalFn(inputs);
      const rOut = part.params?.rOut ?? R_OUT_DEFAULT;
      const tpdNs = part.params?.tpdNs;

      if (!tpdNs) {
        // Immediate switching — today's fixpoint behaviour, bit-identical
        // (spec-updates/scheduled-device-events.md rule 3).
        if (outLevel === state._outLevel &&
            inputs.every((v, i) => v === state._lastInputs[i])) {
          return false;
        }
        state._lastInputs = inputs;
        state._outLevel = outLevel;
        state.drives.out = { vTh: outLevel ? vcc : 0, rTh: rOut };
        return true;
      }

      // Scheduled switching with INERTIAL semantics: a computed change is
      // pended tpd into the future; inputs reverting first cancel it — a
      // pulse shorter than tpd does not propagate, which is the physics
      // and the teaching point. `_wakeNs` is the canonical deadline the
      // board sub-steps to exactly.
      state._lastInputs = inputs;
      if (outLevel === state._outLevel) {
        if (state._pendingOut) {
          state._pendingOut = null;
          state._wakeNs = null;
        }
      } else if (!state._pendingOut || state._pendingOut.level !== outLevel) {
        state._pendingOut = { level: outLevel, atNs: tNs + BigInt(tpdNs) };
        state._wakeNs = state._pendingOut.atNs;
      }
      if (state._pendingOut && tNs >= state._pendingOut.atNs) {
        state._outLevel = state._pendingOut.level;
        state.drives.out = { vTh: state._outLevel ? vcc : 0, rTh: rOut };
        state._pendingOut = null;
        state._wakeNs = null;
        return true;
      }
      return false;
    },
  };
}

/** @param {number[]} ins */
const AND = (ins) => ins.every(x => x) ? 1 : 0;
const OR = (ins) => ins.some(x => x) ? 1 : 0;
const NOT = (ins) => ins[0] ? 0 : 1;
const NAND = (ins) => ins.every(x => x) ? 0 : 1;
const NOR = (ins) => ins.some(x => x) ? 0 : 1;
const XOR = (ins) => (ins[0] ^ ins[1]) ? 1 : 0;

const GATE_KINDS = {
  gate_and: AND,
  gate_or: OR,
  gate_not: NOT,
  gate_nand: NAND,
  gate_nor: NOR,
  gate_xor: XOR,
};

/**
 * Register all logic gate device models.
 * Call once at startup.
 */
export function registerLogicGates() {
  for (const [kind, evalFn] of Object.entries(GATE_KINDS)) {
    const model = makeGateModel(kind, evalFn);
    // Dynamic terminals based on input count
    const defaultInputs = kind === 'gate_not' ? 1 : 2;
    model.terminals = gateTerminals(defaultInputs);
    registerDevice(kind, model);
  }
}

export { GATE_KINDS, R_OUT_DEFAULT, R_INPUT };
