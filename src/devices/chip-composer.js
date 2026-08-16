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

  // CD4093 — Quad 2-input Schmitt NAND (CMOS equivalent of 74HC132)
  { kind: 'cd4093', pins: ['1a','1b','1y','2a','2b','2y','gnd','3y','3a','3b','4y','4a','4b','vcc'],
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

// ─── Custom chips (sequential logic beyond simple gates/FFs) ────────────

/** 74HC93 — 4-bit ripple counter. CLK-A drives QA, QA→CLK-B drives QB-QD. */
const CHIP_74HC93 = {
  terminals: ['clk_a', 'clk_b', 'r0_1', 'r0_2', 'qa', 'qb', 'qc', 'qd', 'vcc', 'gnd'],

  init() {
    return {
      drives: { qa: { vTh: 0, rTh: R_OUT }, qb: { vTh: 0, rTh: R_OUT },
                qc: { vTh: 0, rTh: R_OUT }, qd: { vTh: 0, rTh: R_OUT } },
      count: 0,
      _lastClkA: false,
      _lastClkB: false,
    };
  },

  stamp(ctx) {
    ctx.conductance('clk_a', null, 1 / R_INPUT);
    ctx.conductance('clk_b', null, 1 / R_INPUT);
    ctx.conductance('r0_1', null, 1 / R_INPUT);
    ctx.conductance('r0_2', null, 1 / R_INPUT);
  },

  update(part, state, read) {
    const vcc = read('vcc') || 5.0;
    const threshold = vcc * 0.5;

    // Reset: both R0 pins HIGH → counter resets
    if (read('r0_1') > threshold && read('r0_2') > threshold) {
      if (state.count !== 0) {
        state.count = 0;
        state.drives.qa = { vTh: 0, rTh: R_OUT };
        state.drives.qb = { vTh: 0, rTh: R_OUT };
        state.drives.qc = { vTh: 0, rTh: R_OUT };
        state.drives.qd = { vTh: 0, rTh: R_OUT };
        return true;
      }
      return false;
    }

    let changed = false;

    // CLK-A falling edge increments QA (divide-by-2)
    const clkA = read('clk_a') > threshold;
    if (!clkA && state._lastClkA) {
      state.count = (state.count ^ 1); // toggle bit 0
      changed = true;
    }
    state._lastClkA = clkA;

    // CLK-B falling edge increments QB-QD (divide-by-8)
    // In normal wiring, QA feeds CLK-B externally
    const clkB = read('clk_b') > threshold;
    if (!clkB && state._lastClkB) {
      // Increment upper 3 bits
      const upper = (state.count >> 1) + 1;
      state.count = (state.count & 1) | ((upper & 7) << 1);
      changed = true;
    }
    state._lastClkB = clkB;

    if (changed) {
      state.drives.qa = { vTh: (state.count & 1) ? vcc : 0, rTh: R_OUT };
      state.drives.qb = { vTh: (state.count & 2) ? vcc : 0, rTh: R_OUT };
      state.drives.qc = { vTh: (state.count & 4) ? vcc : 0, rTh: R_OUT };
      state.drives.qd = { vTh: (state.count & 8) ? vcc : 0, rTh: R_OUT };
    }
    return changed;
  },
};

/** CD4511 — BCD-to-7-segment latch/decoder/driver. */
const CHIP_CD4511 = {
  terminals: ['a', 'b', 'c', 'd', 'le', 'bl', 'lt',
              'qa', 'qb', 'qc', 'qd', 'qe', 'qf', 'qg', 'vcc', 'gnd'],

  init() {
    const drives = {};
    for (const s of ['qa','qb','qc','qd','qe','qf','qg']) {
      drives[s] = { vTh: 0, rTh: R_OUT };
    }
    return { drives, _latchedBCD: 0 };
  },

  stamp(ctx) {
    for (const p of ['a','b','c','d','le','bl','lt']) {
      ctx.conductance(p, null, 1 / R_INPUT);
    }
  },

  update(part, state, read) {
    const vcc = read('vcc') || 5.0;
    const threshold = vcc * 0.5;

    const blActive = read('bl') < threshold; // blank: active LOW
    const ltActive = read('lt') < threshold; // lamp test: active LOW
    const leActive = read('le') > threshold; // latch enable: active HIGH = latch (hold)

    // BCD-to-7-segment truth table (common cathode, outputs active HIGH)
    //        qg qf qe qd qc qb qa
    const SEGMENTS = [
      0b0111111, // 0: a-f on
      0b0000110, // 1: b,c
      0b1011011, // 2: a,b,d,e,g
      0b1001111, // 3: a,b,c,d,g
      0b1100110, // 4: b,c,f,g
      0b1101101, // 5: a,c,d,f,g
      0b1111101, // 6: a,c,d,e,f,g
      0b0000111, // 7: a,b,c
      0b1111111, // 8: all
      0b1101111, // 9: a,b,c,d,f,g
    ];

    let segments;

    if (ltActive) {
      segments = 0b1111111; // lamp test: all on
    } else if (blActive) {
      segments = 0b0000000; // blank: all off
    } else {
      // Read BCD input (or use latched value)
      if (!leActive) {
        const bcd = (read('d') > threshold ? 8 : 0) |
                    (read('c') > threshold ? 4 : 0) |
                    (read('b') > threshold ? 2 : 0) |
                    (read('a') > threshold ? 1 : 0);
        state._latchedBCD = bcd;
      }
      segments = state._latchedBCD < 10 ? SEGMENTS[state._latchedBCD] : 0;
    }

    let changed = false;
    const segNames = ['qa','qb','qc','qd','qe','qf','qg'];
    for (let i = 0; i < 7; i++) {
      const on = (segments >> i) & 1;
      const newV = on ? vcc : 0;
      if ((state.drives[segNames[i]]?.vTh ?? -1) !== newV) {
        state.drives[segNames[i]] = { vTh: newV, rTh: R_OUT };
        changed = true;
      }
    }
    return changed;
  },
};

/** 74HC95 — 4-bit parallel-load shift register.
 *  Mode=L: shift right on CLK (serial in from SER).
 *  Mode=H: parallel load from A-D on CLK. */
const CHIP_74HC95 = {
  terminals: ['ser', 'a', 'b', 'c', 'd', 'mode', 'clk', 'qa', 'qb', 'qc', 'qd', 'vcc', 'gnd'],

  init() {
    return {
      drives: { qa: { vTh: 0, rTh: R_OUT }, qb: { vTh: 0, rTh: R_OUT },
                qc: { vTh: 0, rTh: R_OUT }, qd: { vTh: 0, rTh: R_OUT } },
      reg: 0, // 4-bit register
      _lastClk: false,
    };
  },

  stamp(ctx) {
    for (const p of ['ser', 'a', 'b', 'c', 'd', 'mode', 'clk']) {
      ctx.conductance(p, null, 1 / R_INPUT);
    }
  },

  update(part, state, read) {
    const vcc = read('vcc') || 5.0;
    const threshold = vcc * 0.5;
    const clkHigh = read('clk') > threshold;

    if (!clkHigh || state._lastClk) { state._lastClk = clkHigh; return false; }
    state._lastClk = clkHigh;

    const modeParallel = read('mode') > threshold;
    let newReg;

    if (modeParallel) {
      // Parallel load
      newReg = ((read('a') > threshold ? 1 : 0)) |
               ((read('b') > threshold ? 1 : 0) << 1) |
               ((read('c') > threshold ? 1 : 0) << 2) |
               ((read('d') > threshold ? 1 : 0) << 3);
    } else {
      // Shift right: MSB ← SER, others shift right
      const ser = read('ser') > threshold ? 1 : 0;
      newReg = ((state.reg >> 1) | (ser << 3)) & 0xF;
    }

    if (newReg === state.reg) return false;
    state.reg = newReg;
    state.drives.qa = { vTh: (newReg & 1) ? vcc : 0, rTh: R_OUT };
    state.drives.qb = { vTh: (newReg & 2) ? vcc : 0, rTh: R_OUT };
    state.drives.qc = { vTh: (newReg & 4) ? vcc : 0, rTh: R_OUT };
    state.drives.qd = { vTh: (newReg & 8) ? vcc : 0, rTh: R_OUT };
    return true;
  },
};

/** 74HC374 — Octal D flip-flop with 3-state outputs (DIP-20).
 *  Positive-edge CLK captures D0-D7 → Q0-Q7.
 *  /OE (active LOW) enables outputs; HIGH → high-Z. */
const CHIP_74HC374 = {
  terminals: ['oeb','q0','d0','d1','q1','q2','d2','d3','q3','gnd',
              'clk','q4','d4','d5','q5','q6','d6','d7','q7','vcc'],

  init() {
    const drives = {};
    for (let i = 0; i < 8; i++) drives[`q${i}`] = { vTh: 0, rTh: R_OUT };
    return { drives, reg: 0, _lastClk: false };
  },

  stamp(ctx) {
    ctx.conductance('clk', null, 1 / R_INPUT);
    ctx.conductance('oeb', null, 1 / R_INPUT);
    for (let i = 0; i < 8; i++) ctx.conductance(`d${i}`, null, 1 / R_INPUT);
  },

  update(part, state, read) {
    const vcc = read('vcc') || 5.0;
    const th = vcc * 0.5;
    const clkHigh = read('clk') > th;

    // Capture on rising edge
    if (clkHigh && !state._lastClk) {
      let newReg = 0;
      for (let i = 0; i < 8; i++) if (read(`d${i}`) > th) newReg |= 1 << i;
      state.reg = newReg;
    }
    state._lastClk = clkHigh;

    // Output enable
    const oe = read('oeb') < th;
    let changed = false;
    for (let i = 0; i < 8; i++) {
      const v = oe ? ((state.reg >> i) & 1 ? vcc : 0) : 0;
      const r = oe ? R_OUT : 1e9;
      if ((state.drives[`q${i}`]?.vTh ?? -1) !== v || (state.drives[`q${i}`]?.rTh ?? -1) !== r) {
        state.drives[`q${i}`] = { vTh: v, rTh: r };
        changed = true;
      }
    }
    return changed;
  },
};

/** 74HC688 — 8-bit identity comparator (DIP-20).
 *  /P=Q output goes LOW when P0-P7 = Q0-Q7 and /G is LOW. */
const CHIP_74HC688 = {
  terminals: ['gb','p0','q0','p1','q1','p2','q2','p3','q3','gnd',
              'p4','q4','p5','q5','p6','q6','p7','q7','pqb','vcc'],

  init() {
    return { drives: { pqb: { vTh: 5, rTh: R_OUT } } };
  },

  stamp(ctx) {
    ctx.conductance('gb', null, 1 / R_INPUT);
    for (let i = 0; i < 8; i++) {
      ctx.conductance(`p${i}`, null, 1 / R_INPUT);
      ctx.conductance(`q${i}`, null, 1 / R_INPUT);
    }
  },

  update(part, state, read) {
    const vcc = read('vcc') || 5.0;
    const th = vcc * 0.5;
    const enabled = read('gb') < th; // active LOW
    let equal = true;
    if (enabled) {
      for (let i = 0; i < 8; i++) {
        if ((read(`p${i}`) > th) !== (read(`q${i}`) > th)) { equal = false; break; }
      }
    } else {
      equal = false; // disabled → output HIGH (inactive)
    }
    const newV = equal ? 0 : vcc; // active LOW
    if ((state.drives.pqb?.vTh ?? -1) !== newV) {
      state.drives.pqb = { vTh: newV, rTh: R_OUT };
      return true;
    }
    return false;
  },
};

/**
 * Register all 74HC/CD logic chips from the table + custom chips.
 */
export function registerLogicChips() {
  for (const def of CHIPS) {
    registerDevice(def.kind, buildChipModel(def));
  }
  // Custom sequential chips
  registerDevice('74hc93', CHIP_74HC93);
  registerDevice('74hc95', CHIP_74HC95);
  registerDevice('cd4511', CHIP_CD4511);
  registerDevice('74hc374', CHIP_74HC374);
  registerDevice('74hc688', CHIP_74HC688);
  // TTL LS-series aliases — same logic, same pinout
  const hc32 = buildChipModel(CHIPS.find(c => c.kind === '74hc32'));
  registerDevice('74ls32', hc32);
}

export { CHIPS, buildChipModel };
