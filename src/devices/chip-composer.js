/**
 * Chip composer — one DIP template, many chips from tables.
 *
 * Each chip definition declares:
 *   - pins: terminal names in DIP order (pin 1..N)
 *   - gates: array of { type, inputs: [pin], output: pin } entries
 *   - ffs: array of { type, clk, d/j/k, set, rst, q, q_bar } entries
 *
 * The composer wires the internal logic primitives to the external pins
 * and generates a device model that the registry can consume.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_INPUT = 1e6;

// ─── Logic evaluation functions ─────────────────────────────────────────

const LOGIC = {
  and: (ins) => ins.every(Boolean) ? 1 : 0,
  or: (ins) => ins.some(Boolean) ? 1 : 0,
  not: (ins) => ins[0] ? 0 : 1,
  nand: (ins) => ins.every(Boolean) ? 0 : 1,
  nor: (ins) => ins.some(Boolean) ? 0 : 1,
  xor: (ins) => (ins[0] ^ ins[1]) ? 1 : 0,
  schmitt_inv: (ins, state, idx, vcc) => {
    // Schmitt inverter: hysteresis at 30%/70% VCC (same as gates but explicit)
    return ins[0] ? 0 : 1;
  },
  schmitt_nand: (ins) => ins.every(Boolean) ? 0 : 1,
};

// ─── Chip definitions ───────────────────────────────────────────────────

/**
 * @typedef {object} ChipDef
 * @property {string} kind - registry kind name
 * @property {string[]} pins - terminal names, pin 1 to pin N
 * @property {Array<{type: string, inputs: string[], output: string}>} [gates]
 * @property {Array<{type: string, clk: string, d?: string, j?: string, k?: string,
 *            set?: string, rst?: string, q: string, q_bar?: string}>} [ffs]
 */

/** @type {ChipDef[]} */
const CHIPS = [
  // 74HC00 — Quad 2-input NAND (14-pin DIP)
  { kind: '74hc00', pins: ['1a','1b','1y','2a','2b','2y','gnd','3y','3a','3b','4y','4a','4b','vcc'],
    gates: [
      { type: 'nand', inputs: ['1a','1b'], output: '1y' },
      { type: 'nand', inputs: ['2a','2b'], output: '2y' },
      { type: 'nand', inputs: ['3a','3b'], output: '3y' },
      { type: 'nand', inputs: ['4a','4b'], output: '4y' },
    ]},

  // 74HC02 — Quad 2-input NOR
  { kind: '74hc02', pins: ['1y','1a','1b','2y','2a','2b','gnd','3a','3b','3y','4a','4b','4y','vcc'],
    gates: [
      { type: 'nor', inputs: ['1a','1b'], output: '1y' },
      { type: 'nor', inputs: ['2a','2b'], output: '2y' },
      { type: 'nor', inputs: ['3a','3b'], output: '3y' },
      { type: 'nor', inputs: ['4a','4b'], output: '4y' },
    ]},

  // 74HC04 — Hex inverter
  { kind: '74hc04', pins: ['1a','1y','2a','2y','3a','3y','gnd','4y','4a','5y','5a','6y','6a','vcc'],
    gates: [
      { type: 'not', inputs: ['1a'], output: '1y' },
      { type: 'not', inputs: ['2a'], output: '2y' },
      { type: 'not', inputs: ['3a'], output: '3y' },
      { type: 'not', inputs: ['4a'], output: '4y' },
      { type: 'not', inputs: ['5a'], output: '5y' },
      { type: 'not', inputs: ['6a'], output: '6y' },
    ]},

  // 74HC08 — Quad 2-input AND
  { kind: '74hc08', pins: ['1a','1b','1y','2a','2b','2y','gnd','3y','3a','3b','4y','4a','4b','vcc'],
    gates: [
      { type: 'and', inputs: ['1a','1b'], output: '1y' },
      { type: 'and', inputs: ['2a','2b'], output: '2y' },
      { type: 'and', inputs: ['3a','3b'], output: '3y' },
      { type: 'and', inputs: ['4a','4b'], output: '4y' },
    ]},

  // 74HC10 — Triple 3-input NAND
  { kind: '74hc10', pins: ['1a','1b','2a','2b','2c','2y','gnd','3y','3a','3b','3c','1y','1c','vcc'],
    gates: [
      { type: 'nand', inputs: ['1a','1b','1c'], output: '1y' },
      { type: 'nand', inputs: ['2a','2b','2c'], output: '2y' },
      { type: 'nand', inputs: ['3a','3b','3c'], output: '3y' },
    ]},

  // 74HC11 — Triple 3-input AND
  { kind: '74hc11', pins: ['1a','1b','2a','2b','2c','2y','gnd','3y','3a','3b','3c','1y','1c','vcc'],
    gates: [
      { type: 'and', inputs: ['1a','1b','1c'], output: '1y' },
      { type: 'and', inputs: ['2a','2b','2c'], output: '2y' },
      { type: 'and', inputs: ['3a','3b','3c'], output: '3y' },
    ]},

  // 74HC14 — Hex Schmitt inverter
  { kind: '74hc14', pins: ['1a','1y','2a','2y','3a','3y','gnd','4y','4a','5y','5a','6y','6a','vcc'],
    gates: [
      { type: 'schmitt_inv', inputs: ['1a'], output: '1y' },
      { type: 'schmitt_inv', inputs: ['2a'], output: '2y' },
      { type: 'schmitt_inv', inputs: ['3a'], output: '3y' },
      { type: 'schmitt_inv', inputs: ['4a'], output: '4y' },
      { type: 'schmitt_inv', inputs: ['5a'], output: '5y' },
      { type: 'schmitt_inv', inputs: ['6a'], output: '6y' },
    ]},

  // 74HC20 — Dual 4-input NAND
  { kind: '74hc20', pins: ['1a','1b','nc1','1c','1d','1y','gnd','2y','2a','2b','nc2','2c','2d','vcc'],
    gates: [
      { type: 'nand', inputs: ['1a','1b','1c','1d'], output: '1y' },
      { type: 'nand', inputs: ['2a','2b','2c','2d'], output: '2y' },
    ]},

  // 74HC21 — Dual 4-input AND
  { kind: '74hc21', pins: ['1a','1b','nc1','1c','1d','1y','gnd','2y','2a','2b','nc2','2c','2d','vcc'],
    gates: [
      { type: 'and', inputs: ['1a','1b','1c','1d'], output: '1y' },
      { type: 'and', inputs: ['2a','2b','2c','2d'], output: '2y' },
    ]},

  // 74HC27 — Triple 3-input NOR
  { kind: '74hc27', pins: ['1a','1b','2a','2b','2c','2y','gnd','3y','3a','3b','3c','1y','1c','vcc'],
    gates: [
      { type: 'nor', inputs: ['1a','1b','1c'], output: '1y' },
      { type: 'nor', inputs: ['2a','2b','2c'], output: '2y' },
      { type: 'nor', inputs: ['3a','3b','3c'], output: '3y' },
    ]},

  // 74HC32 — Quad 2-input OR
  { kind: '74hc32', pins: ['1a','1b','1y','2a','2b','2y','gnd','3y','3a','3b','4y','4a','4b','vcc'],
    gates: [
      { type: 'or', inputs: ['1a','1b'], output: '1y' },
      { type: 'or', inputs: ['2a','2b'], output: '2y' },
      { type: 'or', inputs: ['3a','3b'], output: '3y' },
      { type: 'or', inputs: ['4a','4b'], output: '4y' },
    ]},

  // 74HC86 — Quad 2-input XOR
  { kind: '74hc86', pins: ['1a','1b','1y','2a','2b','2y','gnd','3y','3a','3b','4y','4a','4b','vcc'],
    gates: [
      { type: 'xor', inputs: ['1a','1b'], output: '1y' },
      { type: 'xor', inputs: ['2a','2b'], output: '2y' },
      { type: 'xor', inputs: ['3a','3b'], output: '3y' },
      { type: 'xor', inputs: ['4a','4b'], output: '4y' },
    ]},

  // 74HC132 — Quad 2-input Schmitt NAND
  { kind: '74hc132', pins: ['1a','1b','1y','2a','2b','2y','gnd','3y','3a','3b','4y','4a','4b','vcc'],
    gates: [
      { type: 'schmitt_nand', inputs: ['1a','1b'], output: '1y' },
      { type: 'schmitt_nand', inputs: ['2a','2b'], output: '2y' },
      { type: 'schmitt_nand', inputs: ['3a','3b'], output: '3y' },
      { type: 'schmitt_nand', inputs: ['4a','4b'], output: '4y' },
    ]},

  // 74HC74 — Dual D flip-flop (with preset/clear)
  { kind: '74hc74', pins: ['1clr','1d','1clk','1pre','1q','1q_bar','gnd','2q_bar','2q','2pre','2clk','2d','2clr','vcc'],
    ffs: [
      { type: 'd', clk: '1clk', d: '1d', set: '1pre', rst: '1clr', q: '1q', q_bar: '1q_bar' },
      { type: 'd', clk: '2clk', d: '2d', set: '2pre', rst: '2clr', q: '2q', q_bar: '2q_bar' },
    ]},

  // 74HC73 — Dual JK flip-flop (with clear)
  { kind: '74hc73', pins: ['1clk','1clr','1k','vcc','2clk','2clr','2j','2q_bar','2q','2k','gnd','1q','1q_bar','1j'],
    ffs: [
      { type: 'jk', clk: '1clk', j: '1j', k: '1k', rst: '1clr', q: '1q', q_bar: '1q_bar' },
      { type: 'jk', clk: '2clk', j: '2j', k: '2k', rst: '2clr', q: '2q', q_bar: '2q_bar' },
    ]},
];

// ─── Composer ───────────────────────────────────────────────────────────

/**
 * Build a device model from a chip definition.
 */
function buildChipModel(def) {
  const allTerminals = [...new Set(def.pins.filter(p => p !== null && !p.startsWith('nc')))];

  return {
    terminals: allTerminals,

    init() {
      const drives = {};
      // Initialize output pins
      if (def.gates) {
        for (const g of def.gates) {
          drives[g.output] = { vTh: 0, rTh: R_OUT };
        }
      }
      if (def.ffs) {
        for (const ff of def.ffs) {
          drives[ff.q] = { vTh: 0, rTh: R_OUT };
          if (ff.q_bar) drives[ff.q_bar] = { vTh: 5, rTh: R_OUT };
        }
      }
      return {
        drives,
        _ffState: def.ffs ? def.ffs.map(() => ({ q: 0, lastClk: false })) : [],
      };
    },

    stamp(ctx) {
      // Input impedance on all input pins
      const outputPins = new Set();
      if (def.gates) for (const g of def.gates) outputPins.add(g.output);
      if (def.ffs) for (const ff of def.ffs) { outputPins.add(ff.q); if (ff.q_bar) outputPins.add(ff.q_bar); }

      for (const pin of allTerminals) {
        if (pin === 'vcc' || pin === 'gnd') continue;
        if (outputPins.has(pin)) continue;
        ctx.conductance(pin, null, 1 / R_INPUT);
      }
    },

    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const VIH = 0.7 * vcc;
      const VIL = 0.3 * vcc;

      function readLogic(pin) {
        const v = read(pin);
        return v > VIH ? 1 : (v < VIL ? 0 : -1); // -1 = undefined
      }

      let changed = false;

      // Evaluate combinational gates
      if (def.gates) {
        for (const g of def.gates) {
          const inputs = g.inputs.map(p => readLogic(p) === 1 ? true : false);
          const fn = LOGIC[g.type];
          const result = fn ? fn(inputs) : 0;
          const newDrive = { vTh: result ? vcc : 0, rTh: R_OUT };
          if ((state.drives[g.output]?.vTh ?? -1) !== newDrive.vTh) {
            state.drives[g.output] = newDrive;
            changed = true;
          }
        }
      }

      // Evaluate flip-flops
      if (def.ffs) {
        for (let i = 0; i < def.ffs.length; i++) {
          const ff = def.ffs[i];
          const fs = state._ffState[i];
          const clkHigh = readLogic(ff.clk) === 1;
          // Active-LOW set/reset for 74HC series
          const setActive = ff.set ? readLogic(ff.set) === 0 : false;
          const rstActive = ff.rst ? readLogic(ff.rst) === 0 : false;

          let newQ = fs.q;

          if (rstActive) newQ = 0;
          else if (setActive) newQ = 1;
          else if (clkHigh && !fs.lastClk) {
            // Rising edge
            if (ff.type === 'd') {
              newQ = readLogic(ff.d) === 1 ? 1 : 0;
            } else if (ff.type === 'jk') {
              const j = readLogic(ff.j) === 1 ? 1 : 0;
              const k = readLogic(ff.k) === 1 ? 1 : 0;
              if (j && k) newQ = fs.q ? 0 : 1;
              else if (j) newQ = 1;
              else if (k) newQ = 0;
            }
          }
          fs.lastClk = clkHigh;

          if (newQ !== fs.q) {
            fs.q = newQ;
            state.drives[ff.q] = { vTh: newQ ? vcc : 0, rTh: R_OUT };
            if (ff.q_bar) state.drives[ff.q_bar] = { vTh: newQ ? 0 : vcc, rTh: R_OUT };
            changed = true;
          }
        }
      }

      return changed;
    },
  };
}

/**
 * Register all 74HC/CD logic chips from the table.
 */
export function registerLogicChips() {
  for (const def of CHIPS) {
    registerDevice(def.kind, buildChipModel(def));
  }
}

export { CHIPS, buildChipModel };
