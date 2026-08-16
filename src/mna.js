/**
 * Modified Nodal Analysis (MNA) solver.
 *
 * Linear MNA with Newton–Raphson for nonlinear elements (diodes/LEDs).
 * Used only for branchCurrent and resistance — the closed-form path
 * in board.js handles everything else.
 *
 * Matrix form:  [G  B] [v]   [I]
 *               [C  D] [j] = [E]
 *
 * Where:
 *   G = conductance matrix (n×n, n = number of non-ground nodes)
 *   B, C, D = voltage source coupling
 *   v = node voltages
 *   j = branch currents through voltage sources
 *   I = current source vector
 *   E = voltage source values
 *
 * @module
 */

/**
 * Dense matrix backed by a flat Float64Array.
 */
import { getDevice } from './devices.js';

class Matrix {
  /**
   * @param {number} rows
   * @param {number} cols
   */
  constructor(rows, cols) {
    this.rows = rows;
    this.cols = cols;
    this.data = new Float64Array(rows * cols);
  }

  /** @param {number} r @param {number} c @returns {number} */
  get(r, c) { return this.data[r * this.cols + c]; }

  /** @param {number} r @param {number} c @param {number} v */
  set(r, c, v) { this.data[r * this.cols + c] = v; }

  /** @param {number} r @param {number} c @param {number} v */
  add(r, c, v) { this.data[r * this.cols + c] += v; }

  /** Create a copy */
  clone() {
    const m = new Matrix(this.rows, this.cols);
    m.data.set(this.data);
    return m;
  }
}

/**
 * Solve Ax = b using Gaussian elimination with partial pivoting.
 * Modifies A and b in place. Returns x.
 *
 * @param {Matrix} A - n×n matrix
 * @param {Float64Array} b - n-vector
 * @returns {Float64Array} solution vector x
 */
function solve(A, b) {
  const n = A.rows;
  if (A.cols !== n || b.length !== n) {
    throw new Error(`Dimension mismatch: A is ${A.rows}×${A.cols}, b has ${b.length} elements`);
  }

  // Forward elimination with partial pivoting
  for (let col = 0; col < n; col++) {
    // Find pivot
    let maxVal = Math.abs(A.get(col, col));
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(A.get(row, col));
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }

    if (maxVal < 1e-15) {
      throw new Error(`Singular matrix at column ${col}`);
    }

    // Swap rows
    if (maxRow !== col) {
      for (let j = col; j < n; j++) {
        const tmp = A.get(col, j);
        A.set(col, j, A.get(maxRow, j));
        A.set(maxRow, j, tmp);
      }
      const tmp = b[col];
      b[col] = b[maxRow];
      b[maxRow] = tmp;
    }

    // Eliminate below
    const pivot = A.get(col, col);
    for (let row = col + 1; row < n; row++) {
      const factor = A.get(row, col) / pivot;
      for (let j = col; j < n; j++) {
        A.add(row, j, -factor * A.get(col, j));
      }
      b[row] -= factor * b[col];
    }
  }

  // Back substitution
  const x = new Float64Array(n);
  for (let row = n - 1; row >= 0; row--) {
    let sum = b[row];
    for (let j = row + 1; j < n; j++) {
      sum -= A.get(row, j) * x[j];
    }
    x[row] = sum / A.get(row, row);
  }

  return x;
}

// ─── LED / diode model for Newton–Raphson ────────────────────────────────────

/**
 * Diode companion model for Newton-Raphson linearization.
 *
 * Two models available:
 *   1. Piecewise-linear (default, fast): sharp knee at Vf.
 *   2. Shockley exponential (accurate): I = Is × (e^(V/nVt) - 1).
 *
 * The Shockley model gives a smooth I-V curve with realistic behavior
 * near the knee voltage, better for small-signal and temperature analysis.
 *
 * @param {number} vAcross - voltage across the diode (anode - cathode)
 * @param {number} vf - forward voltage (piecewise) or nominal Vf (Shockley)
 * @param {number} rd - dynamic resistance at rated current
 * @param {object} [opts] - optional Shockley parameters
 * @param {number} [opts.is] - saturation current (default: computed from Vf)
 * @param {number} [opts.n] - ideality factor (default: 1.8 for LED, 1.0 for Si)
 * @param {boolean} [opts.shockley] - use Shockley model (default: false)
 * @returns {{ gEq: number, iEq: number }}
 */
function diodeCompanion(vAcross, vf, rd, opts) {
  if (opts && opts.shockley) {
    return shockleyCompanion(vAcross, vf, rd, opts.is, opts.n);
  }

  // Piecewise-linear (original model)
  if (vAcross < vf) {
    const gOff = 1e-9;
    return { gEq: gOff, iEq: 0 };
  } else {
    const gEq = 1 / rd;
    const iEq = -vf / rd;
    return { gEq, iEq };
  }
}

/**
 * Shockley diode companion model.
 * I = Is × (e^(V / nVt) - 1)
 * Linearized at operating point V0:
 *   G_eq = dI/dV = Is/(nVt) × e^(V0/nVt)
 *   I_eq = I(V0) - G_eq × V0
 *
 * @param {number} vAcross
 * @param {number} vf - nominal forward voltage (used to compute Is if not given)
 * @param {number} rd - dynamic resistance (fallback)
 * @param {number} [is] - saturation current
 * @param {number} [n] - ideality factor
 * @returns {{ gEq: number, iEq: number }}
 */
function shockleyCompanion(vAcross, vf, rd, is, n) {
  const VT = 0.02585; // thermal voltage at 25°C (kT/q)
  const nVt = (n ?? 1.8) * VT;

  // Compute Is from Vf if not given: at Vf, I ≈ 20mA (rated)
  // Is = I_rated / (e^(Vf/nVt) - 1)
  if (is === undefined) {
    const expVf = Math.exp(Math.min(vf / nVt, 80)); // clamp to avoid overflow
    is = 0.020 / Math.max(expVf - 1, 1e-30);
  }

  // Clamp vAcross to avoid overflow in exp
  const vClamped = Math.min(vAcross, nVt * 80);

  if (vClamped < -5 * nVt) {
    // Deep reverse bias: essentially off
    return { gEq: 1e-12, iEq: 0 };
  }

  const expV = Math.exp(vClamped / nVt);
  const iD = is * (expV - 1);
  const gEq = is * expV / nVt; // dI/dV

  // Clamp gEq to avoid numerical issues
  const gClamped = Math.min(Math.max(gEq, 1e-12), 1e6);

  // Norton: I_eq = I(V0) - G_eq × V0
  const iEq = iD - gClamped * vAcross;

  return { gEq: gClamped, iEq };
}

// ─── MNA circuit builder ─────────────────────────────────────────────────────

/**
 * @typedef {import('./types.js').Part} Part
 * @typedef {import('./types.js').Net} Net
 * @typedef {import('./types.js').TheveninSource} TheveninSource
 */

/**
 * Build and solve an MNA system from parts and nets.
 *
 * @param {Part[]} parts
 * @param {Net[]} nets
 * @param {Map<string, TheveninSource>} pinSources - PinId → Thévenin equivalent
 * @param {Map<string, number>} controls - part id → control value
 * @param {number} vcc
 * @param {object} [opts]
 * @param {boolean} [opts.powerOff] - if true, omit VCC/GND/MCU sources (for resistance)
 * @param {string} [opts.testNodeA] - inject test current from this net (for resistance)
 * @param {string} [opts.testNodeB] - inject test current to this net (for resistance)
 * @param {number} [opts.testCurrent] - test current magnitude (default 0.001 A)
 * @param {number} [opts.tSeconds] - simulation time, for time-varying sources (default 0)
 * @param {Map<string, number>} [opts.capVoltages] - part id → present capacitor voltage.
 *   When given (and not in transient mode), each capacitor is stamped as a voltage
 *   source holding its stored voltage — which is what a capacitor IS at an instant.
 *   Without it, capacitors are DC-open (legacy operating-point behaviour).
 * @param {{dtSec: number, capVoltages: Map<string, number>, inductorCurrents: Map<string, number>}} [opts.transient]
 *   Backward-Euler transient step: capacitors stamp as G=C/dt ∥ I=G·V_prev,
 *   inductors as G=dt/L ∥ I=I_prev. The result then carries capVoltagesNext /
 *   inductorCurrentsNext for the caller to store.
 * @returns {{ nodeVoltages: Map<string, number>, branchCurrents: Map<string, Map<string, number>>,
 *             capVoltagesNext?: Map<string, number>, inductorCurrentsNext?: Map<string, number>,
 *             converged?: boolean }}
 */
export function solveMNA(parts, nets, pinSources, controls, vcc, opts = {}) {
  const powerOff = opts.powerOff ?? false;
  const testNodeA = opts.testNodeA;
  const testNodeB = opts.testNodeB;
  const testCurrent = opts.testCurrent ?? 0.001;
  const tSeconds = opts.tSeconds ?? 0;
  const transient = opts.transient ?? null;
  const capVoltagesIn = transient ? transient.capVoltages : opts.capVoltages;
  // Every node gets a tiny conductance to the reference (gmin). This keeps a
  // floating net (e.g. behind a DC-open capacitor or an off transistor) from
  // making the matrix singular — which used to be caught silently and returned
  // a plausible, wrong all-zeros solution.
  const GMIN = 1e-12;

  // Build node list. Ground is implicit (node index -1 → not in matrix).
  // For resistance measurement, use testNodeB as the reference so that
  // the test nodes are always relative to each other, even if the GND
  // part is on a disconnected net.
  let groundNetId = null;

  if (powerOff && testNodeB) {
    groundNetId = testNodeB;
  } else {
    for (const net of nets) {
      for (const t of net.terminals) {
        const part = parts.find(p => p.id === t.part);
        if (part && part.kind === 'gnd') {
          groundNetId = net.id;
          break;
        }
      }
      if (groundNetId) break;
    }
    // No gnd symbol on the bench: the battery's negative pole is the
    // reference — exactly where a scope ground clip goes on a real
    // single-supply build. Without this, MCU pin Thevenin sources stamp
    // against a node no net maps to, pin current has no return path, and
    // a battery-fed board with pin-driven LEDs reads brightness 0 forever.
    // (spec-updates/ground-fallback-vsource-neg.md, 2026-08-10)
    if (!groundNetId) {
      outer:
      for (const net of nets) {
        for (const t of net.terminals) {
          if (t.terminal !== 'neg') continue;
          const part = parts.find(p => p.id === t.part);
          if (part && part.kind === 'vsource') {
            groundNetId = net.id;
            break outer;
          }
        }
      }
    }
  }

  // Assign node indices (skip ground and, when power is off, skip nets that
  // only connect to active sources and have no passive element terminals).
  const passiveKinds = new Set(['resistor', 'capacitor', 'diode', 'led',
    'potentiometer', 'button', 'switch', 'buzzer', 'ldr', 'ntc',
    'npn', 'pnp', 'zener', 'inductor', 'nmos', 'pmos', 'opamp',
    'vsource', 'isource']);

  // EVERY net bearing a gnd symbol IS the reference — EXCEPT in the
  // power-off resistance measurement, where testNodeB is the reference
  // and gnd symbols are deliberately inactive (the T-network test's
  // contract: a dangling gnd must not become a shunt path). The election above
  // picks one net as node 0 — but a circuit can have DISJOINT ground
  // islands (the .dig-translated PC module: the clock's local gnd
  // symbol vs the chips' gnd net), and leaving the others as ordinary
  // nets lets them float: the clock's "ground" rode up to 4.97 V and
  // the oscillator sat dead. Hand-wired boards never showed it because
  // their grounds share rails. Merge all gnd-bearing nets into the
  // elected one — physically they are the same node.
  if (groundNetId && !(powerOff && testNodeB)) {
    const isGndNet = (net) => net.id !== groundNetId && net.terminals.some((t) => {
      const p = parts.find((pp) => pp.id === t.part);
      return p && p.kind === 'gnd';
    });
    const main = nets.find((n) => n.id === groundNetId);
    for (let i = nets.length - 1; i >= 0; i--) {
      if (isGndNet(nets[i])) {
        main.terminals.push(...nets[i].terminals);
        nets.splice(i, 1);
      }
    }
  }

  /** @type {Map<string, number>} net id → node index */
  const nodeIndex = new Map();
  let nodeCount = 0;
  for (const net of nets) {
    if (net.id === groundNetId) continue;

    if (powerOff) {
      // Only include nets that have at least one passive element terminal
      const hasPassive = net.terminals.some(t => {
        const p = parts.find(pp => pp.id === t.part);
        return p && passiveKinds.has(p.kind);
      });
      if (!hasPassive) continue;
    }

    nodeIndex.set(net.id, nodeCount++);
  }

  if (nodeCount === 0) {
    return { nodeVoltages: new Map(), branchCurrents: new Map() };
  }

  // Count voltage sources (VCC only, unless powerOff)
  let vsCount = 0;
  /** @type {Map<string, number>} part id → voltage source index in the extra rows */
  const vsIndex = new Map();
  const capPairSeen = new Set();

  if (!powerOff) {
    for (const part of parts) {
      if (part.kind === 'vcc') {
        const vccNet = findNet(nets, part.id, 'vcc');
        if (vccNet && nodeIndex.has(vccNet)) {
          vsIndex.set(part.id, vsCount++);
        }
      }
      // Op-amp output is a voltage source (VCVS with rail clamping)
      if (part.kind === 'opamp') {
        const outNet = findNet(nets, part.id, 'out');
        if (outNet && nodeIndex.has(outNet)) {
          vsIndex.set(part.id, vsCount++);
        }
      }
      // Independent voltage source (may have current limit for CC mode)
      if (part.kind === 'vsource') {
        const posNet = findNet(nets, part.id, 'pos');
        if (posNet && nodeIndex.has(posNet)) {
          vsIndex.set(part.id, vsCount++);
        }
      }
      // Named power supply kinds that act as voltage sources
      if ((part.kind === 'battery_9v' || part.kind === 'battery_aa' || part.kind === 'battery_coin' ||
           part.kind === 'solar_cell') && part.params?.iLimit) {
        // These can have current limits too, but they are registered devices
        // and don't participate in the vsource MNA row. Skip here.
      }
      // Instantaneous solve with known capacitor charge: the capacitor IS a
      // voltage source at an instant, so it holds its stored voltage.
      // ONE row per distinct net pair: six decoupling caps across the same
      // rail pair used to make six IDENTICAL rows — linearly dependent,
      // matrix singular, and the silent singular-bail returned ALL-ZERO
      // voltages for the whole bench (eater6502-full-build, 2026-08-17).
      // Parallel caps share their node voltage, so they always store the
      // same value and one source row speaks for all of them. A cap with
      // both terminals on one net constrains nothing and gets no row.
      if (part.kind === 'capacitor' && !transient && capVoltagesIn) {
        const netA = findNet(nets, part.id, 'a');
        const netB = findNet(nets, part.id, 'b');
        const pairKey = `${netA ?? '-'}\u0000${netB ?? '-'}`;
        if (netA !== netB && !capPairSeen.has(pairKey) &&
            ((netA && nodeIndex.has(netA)) || (netB && nodeIndex.has(netB)))) {
          capPairSeen.add(pairKey);
          vsIndex.set(part.id, vsCount++);
        }
      }
    }
  }

  const dim = nodeCount + vsCount;
  const A = new Matrix(dim, dim);
  const b = new Float64Array(dim);

  // Part index for looking up nets
  /** @type {Map<string, Part>} */
  const partMap = new Map(parts.map(p => [p.id, p]));

  // ─── Stamp elements ─────────────────────────────────────────────────────

  // Diode/LED/transistor operating points for Newton–Raphson
  /** @type {Map<string, number>} part id → voltage across junction */
  const diodeVoltages = new Map();
  // Op-amp output region: 'linear' | 'high' | 'low' (rail saturation).
  /** @type {Map<string, string>} */
  const opampRegions = new Map();
  // BJT operating regions: 'active' (Ic = beta*Ib VCCS) or 'saturated'
  // (Vce clamped near vceSat). Without this, a switching transistor's
  // collector gets driven arbitrarily negative — the audit measured
  // -420V on pc24 — because beta*Ib exceeded anything the load allows.
  const bjtRegions = new Map();
  const mosRegions = new Map();
  for (const part of parts) {
    if (part.kind === 'led' || part.kind === 'diode' || part.kind === 'npn'
        || part.kind === 'pnp' || part.kind === 'zener'
        || part.kind === 'nmos' || part.kind === 'pmos') {
      diodeVoltages.set(part.id, 0); // initial guess
    }
    if (part.kind === 'opamp') opampRegions.set(part.id, 'linear');
    if (part.kind === 'npn' || part.kind === 'pnp') bjtRegions.set(part.id, 'active');
    if (part.kind === 'nmos' || part.kind === 'pmos') mosRegions.set(part.id, 'saturation');
  }

  // Newton–Raphson iterations
  const MAX_NR_ITER = 50;
  const NR_TOL = 1e-6;
  // Junction-voltage damping: an exponential nonlinearity can fling NR across
  // volts per iteration and oscillate forever; classic per-step limiting keeps
  // every update inside the model's trust region.
  const NR_MAX_STEP = 0.5;

  let solution = new Float64Array(dim);
  let converged = false;

  for (let iter = 0; iter < MAX_NR_ITER; iter++) {
    // Clear matrix
    A.data.fill(0);
    b.fill(0);

    for (const part of parts) {
      switch (part.kind) {
        case 'resistor':
          stampResistor(A, b, part, nets, nodeIndex, groundNetId);
          break;

        case 'led':
        case 'diode':
          stampDiode(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages);
          break;

        case 'potentiometer':
          stampPotentiometer(A, b, part, nets, nodeIndex, groundNetId, controls);
          break;

        case 'button':
        case 'switch':
          stampButton(A, b, part, nets, nodeIndex, groundNetId, controls);
          break;

        case 'vcc':
          if (!powerOff) {
            // params.volts makes the rail per-part adjustable (a 3.3V
            // rail beside the 5V one); the board default stays the
            // fallback. board.js's seed path already honored this —
            // the solver must agree or the seed lies.
            stampVoltageSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex,
              Number.isFinite(part.params?.volts) ? part.params.volts : vcc);
          }
          break;

        case 'mcu':
          if (!powerOff) {
            stampMcuPins(A, b, part, nets, nodeIndex, groundNetId, pinSources);
          }
          break;

        // Chip-qualified drives (opts.qualifiedSources) are stamped after
        // this loop — they attach to parts of ANY kind, including ones the
        // solver has no model for (a machine's w65c22).


        case 'buzzer':
          stampBuzzerResistance(A, b, part, nets, nodeIndex, groundNetId);
          break;

        case 'ldr':
        case 'ntc':
          stampVariableResistor(A, b, part, nets, nodeIndex, groundNetId, controls);
          break;

        case 'inductor': {
          if (transient) {
            // Backward-Euler companion: i(t+dt) = i(t) + (dt/L)·v(t+dt)
            // → conductance dt/L in parallel with a Norton source of i(t).
            const L = /** @type {number} */ (part.params.henrys ?? part.params.henries ?? 0.001);
            const g = transient.dtSec / Math.max(L, 1e-12);
            const iPrev = transient.inductorCurrents.get(part.id) ?? 0;
            const netA = findNet(nets, part.id, 'a');
            const netB = findNet(nets, part.id, 'b');
            stampTwoTerminal(A, netA, netB, g, nodeIndex);
            const idxA = netA ? nodeIndex.get(netA) : undefined;
            const idxB = netB ? nodeIndex.get(netB) : undefined;
            if (idxA !== undefined) b[idxA] -= iPrev; // i flows a→b
            if (idxB !== undefined) b[idxB] += iPrev;
          } else {
            // DC steady-state: an inductor is a short (1 mΩ wire).
            stampTwoTerminal(A,
              findNet(nets, part.id, 'a'),
              findNet(nets, part.id, 'b'),
              1 / 0.001,
              nodeIndex);
          }
          break;
        }

        case 'capacitor': {
          if (transient) {
            // Backward-Euler companion: i = C/dt · (v(t+dt) − v(t))
            // → conductance C/dt in parallel with a Norton source C/dt·v(t).
            const C = /** @type {number} */ (part.params.farads ?? 0.0001);
            const g = C / Math.max(transient.dtSec, 1e-15);
            const vPrev = transient.capVoltages.get(part.id) ?? 0;
            const netA = findNet(nets, part.id, 'a');
            const netB = findNet(nets, part.id, 'b');
            stampTwoTerminal(A, netA, netB, g, nodeIndex);
            const idxA = netA ? nodeIndex.get(netA) : undefined;
            const idxB = netB ? nodeIndex.get(netB) : undefined;
            if (idxA !== undefined) b[idxA] += g * vPrev;
            if (idxB !== undefined) b[idxB] -= g * vPrev;
          } else if (capVoltagesIn && vsIndex.has(part.id)) {
            // Instantaneous solve: hold the stored voltage as a source row.
            // (Only the first cap of each net pair carries the row — see
            // the allocation above.)
            stampCapAsSource(A, b, part, nets, nodeIndex, vsIndex,
              capVoltagesIn.get(part.id) ?? 0);
          }
          // else: DC operating point — a capacitor is open (gmin covers the net).
          break;
        }

        case 'npn':
          stampNPN(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, bjtRegions.get(part.id));
          break;

        case 'pnp':
          stampPNP(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, bjtRegions.get(part.id));
          break;

        case 'nmos':
          stampNMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, mosRegions.get(part.id));
          break;

        case 'pmos':
          stampPMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, mosRegions.get(part.id));
          break;

        case 'opamp':
          stampOpamp(A, b, part, nets, nodeIndex, groundNetId, vsIndex, opampRegions, vcc);
          break;

        case 'vsource':
          stampIndependentVSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc, tSeconds, controls);
          break;

        case 'isource':
          stampCurrentSource(A, b, part, nets, nodeIndex, groundNetId);
          break;

        case 'zener':
          stampZener(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages);
          break;

        // ─── Drawable parts: minimal electrical models ─────────────
        // These are not full simulations — they provide input impedance
        // and supply current so the net they sit on is loaded correctly.
        // Without this, the simulator reports voltages as if the part
        // were absent, which is worse than not drawing it.

        case 'char_lcd': {
          // HD44780: ~1mA supply current, data pins are high-Z inputs.
          // Model: VCC-GND current draw as a resistor (~5kΩ at 5V = 1mA).
          const vccNet = findNet(nets, part.id, 'vcc');
          const gndNet = findNet(nets, part.id, 'gnd');
          stampTwoTerminal(A, vccNet, gndNet, 1 / 5000, nodeIndex); // ~1mA at 5V
          break;
        }

        case 'shift_register': {
          // 74HC595: ~80µA supply + data/clock/latch are CMOS inputs (~10MΩ).
          // Outputs are push-pull but modeled separately as LEDs.
          const dataNet = findNet(nets, part.id, 'data');
          const clockNet = findNet(nets, part.id, 'clock');
          const latchNet = findNet(nets, part.id, 'latch');
          // CMOS input: very high impedance to GND (doesn't load the pin)
          if (dataNet) stampTwoTerminal(A, dataNet, undefined, 1e-7, nodeIndex);
          if (clockNet) stampTwoTerminal(A, clockNet, undefined, 1e-7, nodeIndex);
          if (latchNet) stampTwoTerminal(A, latchNet, undefined, 1e-7, nodeIndex);
          break;
        }

        case 'ir_receiver': {
          // IR receiver module: ~5mA supply, output is open-collector with pull-up.
          const vNet = findNet(nets, part.id, 'vcc');
          const gNet = findNet(nets, part.id, 'gnd');
          stampTwoTerminal(A, vNet, gNet, 1 / 1000, nodeIndex); // ~5mA at 5V
          break;
        }

        case 'temp_sensor': {
          // DS18B20: ~1mA supply, DQ is open-drain (needs external pull-up).
          const vNet = findNet(nets, part.id, 'vcc');
          const gNet = findNet(nets, part.id, 'gnd');
          stampTwoTerminal(A, vNet, gNet, 1 / 5000, nodeIndex); // ~1mA at 5V
          break;
        }

        case 'eeprom': {
          // I2C EEPROM: ~1mA supply, SDA/SCL are open-drain (high-Z input).
          const vNet = findNet(nets, part.id, 'vcc');
          const gNet = findNet(nets, part.id, 'gnd');
          stampTwoTerminal(A, vNet, gNet, 1 / 5000, nodeIndex);
          break;
        }

        // gnd, seven_segment, rgb_led, led_matrix:
        // handled elsewhere or composite

        default: {
          // Registered device models (src/devices.js): stamp whatever the
          // device currently drives as Thévenin sources — exactly like MCU
          // pins — plus the model's own analog loading.
          const model = getDevice(part.kind);
          if (model) {
            const state = (opts.deviceStates && opts.deviceStates.get(part.id)) || { drives: {} };
            stampDevice(A, b, part, nets, nodeIndex, model, state, controls, vcc, tSeconds,
              transient ? transient.dtSec : undefined);
          }
          break;
        }
      }
    }

    // Chip-qualified drives: Norton sources on arbitrary part terminals —
    // how a machine adapter's `via.pa0` reaches the net a seated (possibly
    // unmodeled) chip is wired to. Grouped per part so findNet gets the
    // part id, exactly like stampMcuPins gets it from its part.
    if (!powerOff && opts.qualifiedSources) {
      for (const [partId, terms] of opts.qualifiedSources) {
        for (const [terminal, source] of terms) {
          const pinNet = findNet(nets, partId, terminal);
          if (!pinNet) continue;
          const nodeIdx = nodeIndex.get(pinNet);
          if (nodeIdx === undefined) continue;
          const g = 1 / source.rTh;
          A.add(nodeIdx, nodeIdx, g);
          b[nodeIdx] += source.vTh / source.rTh;
        }
      }
    }

    // Inject test current for resistance measurement
    if (testNodeA && testNodeB) {
      const idxA = nodeIndex.get(testNodeA);
      const idxB = nodeIndex.get(testNodeB);
      if (idxA !== undefined) b[idxA] += testCurrent;
      if (idxB !== undefined) b[idxB] -= testCurrent;
    }

    // gmin from every node to the reference: keeps floating nets solvable.
    for (let i = 0; i < nodeCount; i++) A.add(i, i, GMIN);

    // Solve
    const Acopy = A.clone();
    const bcopy = new Float64Array(b);
    try {
      solution = solve(Acopy, bcopy);
    } catch {
      // Singular matrix — bail
      break;
    }

    // Update diode/transistor operating points and check convergence
    let maxDelta = 0;
    for (const part of parts) {
      if (!diodeVoltages.has(part.id)) continue;

      let vNew;
      if (part.kind === 'npn') {
        // Track Vbe
        const netB = findNet(nets, part.id, 'base');
        const netE = findNet(nets, part.id, 'emitter');
        const idxB = netB ? nodeIndex.get(netB) : undefined;
        const idxE = netE ? nodeIndex.get(netE) : undefined;
        vNew = (idxB !== undefined ? solution[idxB] : 0) - (idxE !== undefined ? solution[idxE] : 0);
      } else if (part.kind === 'pnp') {
        const netE = findNet(nets, part.id, 'emitter');
        const netB = findNet(nets, part.id, 'base');
        const idxE = netE ? nodeIndex.get(netE) : undefined;
        const idxB = netB ? nodeIndex.get(netB) : undefined;
        vNew = (idxE !== undefined ? solution[idxE] : 0) - (idxB !== undefined ? solution[idxB] : 0);
      } else if (part.kind === 'nmos' || part.kind === 'pmos') {
        // Track Vgs
        const netG = findNet(nets, part.id, 'gate');
        const netS = findNet(nets, part.id, 'source');
        const idxG = netG ? nodeIndex.get(netG) : undefined;
        const idxS = netS ? nodeIndex.get(netS) : undefined;
        const vG = idxG !== undefined ? solution[idxG] : 0;
        const vS = idxS !== undefined ? solution[idxS] : 0;
        vNew = part.kind === 'nmos' ? (vG - vS) : (vS - vG);
      } else {
        // LED, diode, zener: anode - cathode
        const anodeNet = findNet(nets, part.id, 'anode');
        const cathodeNet = findNet(nets, part.id, 'cathode');
        const anodeIdx = anodeNet ? nodeIndex.get(anodeNet) : undefined;
        const cathodeIdx = cathodeNet ? nodeIndex.get(cathodeNet) : undefined;
        vNew = (anodeIdx !== undefined ? solution[anodeIdx] : 0) -
               (cathodeIdx !== undefined ? solution[cathodeIdx] : 0);
      }

      const vOld = diodeVoltages.get(part.id) ?? 0;

      // Damped update: never move a junction voltage more than NR_MAX_STEP
      // per iteration. The raw delta still drives the convergence check, so
      // a clamped step cannot be mistaken for convergence.
      const rawDelta = vNew - vOld;
      const vDamped = vOld + Math.max(-NR_MAX_STEP, Math.min(NR_MAX_STEP, rawDelta));
      maxDelta = Math.max(maxDelta, Math.abs(rawDelta));
      diodeVoltages.set(part.id, vDamped);
    }

    // Op-amp region transitions: linear ↔ saturated at a supply rail.
    let regionChanged = false;
    for (const part of parts) {
      if (part.kind !== 'opamp' || !vsIndex.has(part.id)) continue;
      const gain = /** @type {number} */ (part.params.gain ?? 1e6);
      const railLow = /** @type {number} */ (part.params.railLow ?? 0);
      const railHigh = /** @type {number} */ (part.params.railHigh ?? vcc);
      const netP = findNet(nets, part.id, 'inp');
      const netN = findNet(nets, part.id, 'inn');
      const idxP = netP ? nodeIndex.get(netP) : undefined;
      const idxN = netN ? nodeIndex.get(netN) : undefined;
      const vP = idxP !== undefined ? solution[idxP] : (netP === groundNetId ? 0 : 0);
      const vN = idxN !== undefined ? solution[idxN] : (netN === groundNetId ? 0 : 0);
      const vIdeal = gain * (vP - vN);
      const region = opampRegions.get(part.id);
      let next = region;
      if (region === 'linear') {
        if (vIdeal > railHigh) next = 'high';
        else if (vIdeal < railLow) next = 'low';
      } else if (region === 'high') {
        if (vIdeal < railHigh) next = 'linear';
      } else if (region === 'low') {
        if (vIdeal > railLow) next = 'linear';
      }
      if (next !== region) {
        opampRegions.set(part.id, next);
        regionChanged = true;
      }
    }

    // BJT region transitions: active ↔ saturated.
    for (const part of parts) {
      if (part.kind !== 'npn' && part.kind !== 'pnp') continue;
      const beta = /** @type {number} */ (part.params.beta ?? 100);
      const vbe = /** @type {number} */ (part.params.vbe ?? 0.7);
      const vceSat = /** @type {number} */ (part.params.vceSat ?? 0.2);
      const netC = findNet(nets, part.id, 'collector');
      const netE = findNet(nets, part.id, 'emitter');
      const idxC = netC ? nodeIndex.get(netC) : undefined;
      const idxE = netE ? nodeIndex.get(netE) : undefined;
      const vC = idxC !== undefined ? solution[idxC] : 0;
      const vE = idxE !== undefined ? solution[idxE] : 0;
      // Both polarities express "how far the output junction is from
      // its saturation floor" as a positive number in active mode.
      const vOut = part.kind === 'npn' ? vC - vE : vE - vC;
      const region = bjtRegions.get(part.id);
      let next = region;
      if (region === 'active') {
        // The VCCS demanded more collector current than the load can
        // pass: the solver answers by driving the junction below its
        // saturation floor. That is the entry signal — but ONLY for a
        // CONDUCTING device. An off transistor whose output is pulled
        // past the rail (a cutoff PNP with a grounded emitter, say)
        // also shows vOut < vceSat, and clamping THAT invented -0.2 V
        // collectors and above-rail followers, oscillating against
        // the leave test forever (sweep escalation 2026-08-15).
        const vJon = diodeVoltages.get(part.id) ?? 0;
        if (vJon > vbe - 0.05 && vOut < vceSat) next = 'saturated';
      } else {
        // Leave saturation when base drive no longer sustains it:
        // the base junction has fallen out of conduction, or the
        // clamp current exceeds beta*Ib (with margin against
        // flip-flopping; the outer loop re-iterates on change).
        const vJ = diodeVoltages.get(part.id) ?? 0; // vBE (npn) / vEB (pnp)
        const rd = 10;
        const iB = vJ > vbe ? (vJ - vbe) / rd : 0;
        const gS = 10;
        const iC = Math.max(0, gS * (vOut - vceSat));
        if (vJ < vbe - 0.15 || beta * iB < iC * 0.95) next = 'active';
      }
      if (next !== region) {
        bjtRegions.set(part.id, next);
        regionChanged = true;
      }
    }

    // MOSFET region transitions: saturation ↔ triode. Same doctrine
    // as the BJTs: enter triode only while CONDUCTING and the channel
    // has collapsed below the overdrive; back to saturation when the
    // drain lifts clear (small hysteresis against flip-flopping).
    for (const part of parts) {
      if (part.kind !== 'nmos' && part.kind !== 'pmos') continue;
      const vth = /** @type {number} */ (part.params.vth ?? (part.kind === 'nmos' ? 2.0 : -2.0));
      const vgs = diodeVoltages.get(part.id) ?? 0; // vGS (nmos) / vSG (pmos)
      const vov = vgs - Math.abs(vth);
      const netD = findNet(nets, part.id, 'drain');
      const netS = findNet(nets, part.id, 'source');
      const idxD = netD ? nodeIndex.get(netD) : undefined;
      const idxS = netS ? nodeIndex.get(netS) : undefined;
      const vD = idxD !== undefined ? solution[idxD] : 0;
      const vS = idxS !== undefined ? solution[idxS] : 0;
      const vds = part.kind === 'nmos' ? vD - vS : vS - vD;
      const region = mosRegions.get(part.id);
      let next = region;
      if (vov <= 0) {
        next = 'saturation'; // cutoff path owns it; reset for clean re-entry
      } else if (region === 'saturation') {
        if (vds < vov * 0.95) next = 'triode';
      } else {
        if (vds > vov * 1.05) next = 'saturation';
      }
      if (next !== region) {
        mosRegions.set(part.id, next);
        regionChanged = true;
      }
    }

    // Check vsource current limits (CC mode transition).
    // If a source with iLimit has |I| > iLimit, reduce its voltage to
    // clamp the current. This iterates alongside NR until both settle.
    let ccChanged = false;
    for (const part of parts) {
      if (part.kind !== 'vsource') continue;
      const iLimit = part.params?.iLimit;
      if (iLimit == null || iLimit <= 0) continue;
      const vsIdx = vsIndex.get(part.id);
      if (vsIdx === undefined) continue;

      const iActual = solution[nodeCount + vsIdx];
      if (Math.abs(iActual) > iLimit * 1.01) {
        // Overcurrent: reduce the source voltage. The effective voltage that
        // would give exactly iLimit depends on the load, but we can estimate
        // by computing Rload = V/I and setting V_new = iLimit * Rload.
        const nominalV = (controls && controls.has(part.id))
          ? controls.get(part.id) : sourceVoltage(part, tSeconds, vcc);
        const rLoad = Math.abs(iActual) > 1e-12 ? Math.abs(nominalV / iActual) : 1e6;
        const clampedV = iLimit * rLoad * Math.sign(nominalV);
        // Store the clamped voltage for this iteration
        if (!part._ccClampedVolts || Math.abs(part._ccClampedVolts - clampedV) > 0.001) {
          part._ccClampedVolts = clampedV;
          ccChanged = true;
        }
      } else if (part._ccClampedVolts !== undefined) {
        // Current is within limit — revert to CV mode
        if (Math.abs(iActual) < iLimit * 0.99) {
          delete part._ccClampedVolts;
          ccChanged = true;
        }
      }
    }

    // If nothing nonlinear, or everything settled, stop.
    if ((diodeVoltages.size === 0 && opampRegions.size === 0 && !ccChanged)
        || (maxDelta < NR_TOL && !regionChanged && !ccChanged)) {
      converged = true;
      break;
    }
  }

  // ─── Extract results ────────────────────────────────────────────────────

  /** @type {Map<string, number>} */
  const nodeVoltages = new Map();
  if (groundNetId) nodeVoltages.set(groundNetId, 0);
  for (const [netId, idx] of nodeIndex) {
    nodeVoltages.set(netId, solution[idx]);
  }

  // Compute branch currents for each part
  /** @type {Map<string, Map<string, number>>} part id → terminal → current */
  const branchCurrents = new Map();

  for (const part of parts) {
    const currents = new Map();
    branchCurrents.set(part.id, currents);

    if (part.kind === 'resistor') {
      const netA = findNet(nets, part.id, 'a');
      const netB = findNet(nets, part.id, 'b');
      const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      const ohms = /** @type {number} */ (part.params.ohms ?? 1000);
      const i = (vA - vB) / ohms; // current from a to b
      currents.set('a', -i); // into terminal a
      currents.set('b', i);  // into terminal b
    }

    if (part.kind === 'led' || part.kind === 'diode') {
      const anodeNet = findNet(nets, part.id, 'anode');
      const cathodeNet = findNet(nets, part.id, 'cathode');
      const vAnode = anodeNet ? (nodeVoltages.get(anodeNet) ?? 0) : 0;
      const vCathode = cathodeNet ? (nodeVoltages.get(cathodeNet) ?? 0) : 0;
      // A bare LED is a ~2 V junction; a bare diode is silicon, 0.7 V.
      // (Sweep finding 2026-08-15: both defaulted to 2.0, so an
      // unparameterized diode behaved exactly like an LED.)
      const vf = /** @type {number} */ (part.params.vf ?? (part.kind === 'diode' ? 0.7 : 2.0));
      const rd = 10; // dynamic resistance
      const vAcross = vAnode - vCathode;
      const i = vAcross >= vf ? (vAcross - vf) / rd : 0;
      currents.set('anode', i);    // into anode
      currents.set('cathode', -i); // out of cathode
    }

    if (part.kind === 'zener') {
      const anodeNet = findNet(nets, part.id, 'anode');
      const cathodeNet = findNet(nets, part.id, 'cathode');
      const vAnode = anodeNet ? (nodeVoltages.get(anodeNet) ?? 0) : 0;
      const vCathode = cathodeNet ? (nodeVoltages.get(cathodeNet) ?? 0) : 0;
      const vf = /** @type {number} */ (part.params.vf ?? 0.7);
      const vz = /** @type {number} */ (part.params.vz ?? 5.1);
      const rd = 10;
      const rzener = /** @type {number} */ (part.params.rz ?? 5);
      const vAcross = vAnode - vCathode;
      let i;
      if (vAcross >= vf) i = (vAcross - vf) / rd;
      else if (vAcross <= -vz) i = (vAcross + vz) / rzener;
      else i = 0;
      currents.set('anode', i);
      currents.set('cathode', -i);
    }

    if (part.kind === 'npn' || part.kind === 'pnp') {
      // Extract collector current from node voltages
      const netB = findNet(nets, part.id, 'base');
      const netC = findNet(nets, part.id, 'collector');
      const netE = findNet(nets, part.id, 'emitter');
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      const vC = netC ? (nodeVoltages.get(netC) ?? 0) : 0;
      const vE = netE ? (nodeVoltages.get(netE) ?? 0) : 0;
      const beta = /** @type {number} */ (part.params.beta ?? 100);
      const vbeThresh = /** @type {number} */ (part.params.vbe ?? 0.7);
      const rd = 10;

      let ib, ic;
      if (part.kind === 'npn') {
        const vbe = vB - vE;
        ib = vbe >= vbeThresh ? (vbe - vbeThresh) / rd : 0;
        ic = beta * ib;
      } else {
        const veb = vE - vB;
        ib = veb >= vbeThresh ? (veb - vbeThresh) / rd : 0;
        ic = beta * ib;
      }
      currents.set('base', ib);
      currents.set('collector', ic);
      currents.set('emitter', -(ib + ic));
    }

    if (part.kind === 'nmos' || part.kind === 'pmos') {
      const netG = findNet(nets, part.id, 'gate');
      const netD = findNet(nets, part.id, 'drain');
      const netS = findNet(nets, part.id, 'source');
      const vG = netG ? (nodeVoltages.get(netG) ?? 0) : 0;
      const vD = netD ? (nodeVoltages.get(netD) ?? 0) : 0;
      const vS = netS ? (nodeVoltages.get(netS) ?? 0) : 0;
      const vth = /** @type {number} */ (part.params.vth ?? (part.kind === 'nmos' ? 2.0 : -2.0));
      const k = /** @type {number} */ (part.params.k ?? 0.5);
      let id;
      if (part.kind === 'nmos') {
        const vgs = vG - vS;
        id = vgs >= vth ? k * (vgs - vth) * (vgs - vth) : 0;
      } else {
        const vsg = vS - vG;
        id = vsg >= Math.abs(vth) ? k * (vsg - Math.abs(vth)) * (vsg - Math.abs(vth)) : 0;
      }
      currents.set('drain', id);
      currents.set('source', -id);
      currents.set('gate', 0); // gate draws no DC current
    }

    if (part.kind === 'isource') {
      const amps = /** @type {number} */ (part.params.amps ?? 0.001);
      currents.set('pos', amps);
      currents.set('neg', -amps);
    }

    if (part.kind === 'ldr' || part.kind === 'ntc') {
      const netA = findNet(nets, part.id, 'a');
      const netB = findNet(nets, part.id, 'b');
      const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      let ohms;
      if (part.kind === 'ldr') {
        const rDark = /** @type {number} */ (part.params.rDark ?? 1000000);
        const rLight = /** @type {number} */ (part.params.rLight ?? 100);
        const light = controls.get(part.id) ?? 0;
        ohms = Math.max(0.001, rDark * Math.pow(rLight / rDark, light));
      } else {
        const rCold = /** @type {number} */ (part.params.rCold ?? 100000);
        const rHot = /** @type {number} */ (part.params.rHot ?? 1000);
        const temp = controls.get(part.id) ?? 0;
        ohms = Math.max(0.001, rCold * Math.pow(rHot / rCold, temp));
      }
      const i = (vA - vB) / ohms;
      currents.set('a', -i);
      currents.set('b', i);
    }

    if (part.kind === 'inductor') {
      const netA = findNet(nets, part.id, 'a');
      const netB = findNet(nets, part.id, 'b');
      const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      let i;
      if (transient) {
        const L = /** @type {number} */ (part.params.henrys ?? part.params.henries ?? 0.001);
        const iPrev = transient.inductorCurrents.get(part.id) ?? 0;
        i = iPrev + (transient.dtSec / Math.max(L, 1e-12)) * (vA - vB);
      } else {
        // DC: inductor is a wire, current = V_drop / R_wire
        i = (vA - vB) / 0.001;
      }
      currents.set('a', -i);
      currents.set('b', i);
    }

    if (part.kind === 'capacitor') {
      const netA = findNet(nets, part.id, 'a');
      const netB = findNet(nets, part.id, 'b');
      const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      let i = 0;
      if (transient) {
        const C = /** @type {number} */ (part.params.farads ?? 0.0001);
        const vPrev = transient.capVoltages.get(part.id) ?? 0;
        i = (C / Math.max(transient.dtSec, 1e-15)) * ((vA - vB) - vPrev);
      } else if (vsIndex.has(part.id)) {
        // Instantaneous: the source row's current variable is the cap current.
        i = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
      }
      currents.set('a', -i);
      currents.set('b', i);
    }

    if (part.kind === 'opamp' && vsIndex.has(part.id)) {
      // Output current from the source row (positive = out of the output).
      const iOut = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
      currents.set('out', iOut);
      currents.set('inp', 0);
      currents.set('inn', 0);
    }

    if (part.kind === 'vsource' && vsIndex.has(part.id)) {
      const iSrc = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
      currents.set('pos', iSrc);
      currents.set('neg', -iSrc);
    }

    // Drawable parts: supply current from VCC to GND
    if (part.kind === 'char_lcd' || part.kind === 'ir_receiver' ||
        part.kind === 'temp_sensor' || part.kind === 'eeprom') {
      const vNet = findNet(nets, part.id, 'vcc');
      const gNet = findNet(nets, part.id, 'gnd');
      const vV = vNet ? (nodeVoltages.get(vNet) ?? 0) : 0;
      const vG = gNet ? (nodeVoltages.get(gNet) ?? 0) : 0;
      const rSupply = part.kind === 'ir_receiver' ? 1000 : 5000;
      const iSupply = (vV - vG) / rSupply;
      currents.set('vcc', -iSupply);
      currents.set('gnd', iSupply);
    }

    if (part.kind === 'vcc' && vsIndex.has(part.id)) {
      const vsIdx = vsIndex.get(part.id);
      const iVcc = solution[nodeCount + vsIdx];
      currents.set('vcc', iVcc);
    }

    // Registered device models may report their own terminal currents.
    {
      const model = getDevice(part.kind);
      if (model && model.branchCurrents) {
        const state = (opts.deviceStates && opts.deviceStates.get(part.id)) || { drives: {} };
        const read = (terminal) => {
          const n = findNet(nets, part.id, terminal);
          return n ? (nodeVoltages.get(n) ?? 0) : 0;
        };
        for (const [t, i] of model.branchCurrents(part, state, read)) currents.set(t, i);
      }
    }
  }

  // Transient next-state: what the caller stores for the next step.
  if (transient) {
    const capVoltagesNext = new Map();
    const inductorCurrentsNext = new Map();
    for (const part of parts) {
      if (part.kind === 'capacitor') {
        const netA = findNet(nets, part.id, 'a');
        const netB = findNet(nets, part.id, 'b');
        const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
        const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
        capVoltagesNext.set(part.id, vA - vB);
      }
      if (part.kind === 'inductor') {
        const c = branchCurrents.get(part.id);
        inductorCurrentsNext.set(part.id, c ? (c.get('b') ?? 0) : 0);
      }
    }
    return { nodeVoltages, branchCurrents, capVoltagesNext, inductorCurrentsNext, converged };
  }

  return { nodeVoltages, branchCurrents, converged };
}

// ─── Stamp functions ─────────────────────────────────────────────────────────

/**
 * Find the net connected to a specific terminal of a part.
 * @param {Net[]} nets
 * @param {string} partId
 * @param {string} terminal
 * @returns {string | undefined}
 */
function findNet(nets, partId, terminal) {
  for (const net of nets) {
    for (const t of net.terminals) {
      if (t.part === partId && t.terminal === terminal) {
        return net.id;
      }
    }
  }
  return undefined;
}

/**
 * Stamp a resistor into the conductance matrix.
 * @param {Matrix} A
 * @param {Float64Array} b
 * @param {Part} part
 * @param {Net[]} nets
 * @param {Map<string, number>} nodeIndex
 * @param {string | null} groundNetId
 */
function stampResistor(A, b, part, nets, nodeIndex, groundNetId) {
  const netA = findNet(nets, part.id, 'a');
  const netB = findNet(nets, part.id, 'b');
  const ohms = /** @type {number} */ (part.params.ohms ?? 1000);
  const g = 1 / ohms;

  const idxA = netA ? nodeIndex.get(netA) : undefined;
  const idxB = netB ? nodeIndex.get(netB) : undefined;

  if (idxA !== undefined) A.add(idxA, idxA, g);
  if (idxB !== undefined) A.add(idxB, idxB, g);
  if (idxA !== undefined && idxB !== undefined) {
    A.add(idxA, idxB, -g);
    A.add(idxB, idxA, -g);
  }
}

/**
 * Stamp a diode/LED using its linearized companion model.
 * @param {Matrix} A
 * @param {Float64Array} b
 * @param {Part} part
 * @param {Net[]} nets
 * @param {Map<string, number>} nodeIndex
 * @param {string | null} groundNetId
 * @param {Map<string, number>} diodeVoltages
 */
function stampDiode(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages) {
  const anodeNet = findNet(nets, part.id, 'anode');
  const cathodeNet = findNet(nets, part.id, 'cathode');
  const vf = /** @type {number} */ (part.params.vf ?? (part.kind === 'diode' ? 0.7 : 2.0));
  const rd = 10;

  const vAcross = diodeVoltages.get(part.id) ?? 0;
  const { gEq, iEq } = diodeCompanion(vAcross, vf, rd);

  const idxA = anodeNet ? nodeIndex.get(anodeNet) : undefined;
  const idxC = cathodeNet ? nodeIndex.get(cathodeNet) : undefined;

  // Stamp conductance
  if (idxA !== undefined) A.add(idxA, idxA, gEq);
  if (idxC !== undefined) A.add(idxC, idxC, gEq);
  if (idxA !== undefined && idxC !== undefined) {
    A.add(idxA, idxC, -gEq);
    A.add(idxC, idxA, -gEq);
  }

  // Stamp Norton current source
  if (idxA !== undefined) b[idxA] -= iEq; // current into anode
  if (idxC !== undefined) b[idxC] += iEq; // current out of cathode
}

/**
 * Stamp a potentiometer as two resistors (a-wiper and wiper-b).
 * @param {Matrix} A
 * @param {Float64Array} b
 * @param {Part} part
 * @param {Net[]} nets
 * @param {Map<string, number>} nodeIndex
 * @param {string | null} groundNetId
 * @param {Map<string, number>} controls
 */
function stampPotentiometer(A, b, part, nets, nodeIndex, groundNetId, controls) {
  const position = controls.get(part.id) ?? 0.5;
  const totalOhms = /** @type {number} */ (part.params.ohms ?? 10000);

  // R_a_wiper = totalOhms * (1 - position), R_wiper_b = totalOhms * position
  // Avoid zero resistance
  const rAW = Math.max(1, totalOhms * (1 - position));
  const rWB = Math.max(1, totalOhms * position);

  const netA = findNet(nets, part.id, 'a');
  const netW = findNet(nets, part.id, 'wiper');
  const netB = findNet(nets, part.id, 'b');

  // Stamp a-wiper as a resistor
  stampTwoTerminal(A, netA, netW, 1 / rAW, nodeIndex);
  // Stamp wiper-b as a resistor
  stampTwoTerminal(A, netW, netB, 1 / rWB, nodeIndex);
}

/**
 * Stamp a button: closed = very low resistance, open = very high resistance.
 * @param {Matrix} A
 * @param {Float64Array} b
 * @param {Part} part
 * @param {Net[]} nets
 * @param {Map<string, number>} nodeIndex
 * @param {string | null} groundNetId
 * @param {Map<string, number>} controls
 */
function stampButton(A, b, part, nets, nodeIndex, groundNetId, controls) {
  const pressed = (controls.get(part.id) ?? 0) === 1;
  const netA = findNet(nets, part.id, 'a');
  const netB = findNet(nets, part.id, 'b');
  const g = pressed ? 1 / 0.001 : 1e-12; // 1mΩ when closed, effectively open when not
  stampTwoTerminal(A, netA, netB, g, nodeIndex);
}

/**
 * Stamp a VCC voltage source.
 * @param {Matrix} A
 * @param {Float64Array} b
 * @param {Part} part
 * @param {Net[]} nets
 * @param {Map<string, number>} nodeIndex
 * @param {string | null} groundNetId
 * @param {Map<string, number>} vsIndex
 * @param {number} vcc
 */
function stampVoltageSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc) {
  const vccNet = findNet(nets, part.id, 'vcc');
  if (!vccNet) return;
  const nodeIdx = nodeIndex.get(vccNet);
  if (nodeIdx === undefined) return;
  const vsIdx = vsIndex.get(part.id);
  if (vsIdx === undefined) return;

  const dim = nodeIndex.size;
  const row = dim + vsIdx;

  // Voltage source from ground to vccNet: V(vccNet) - V(gnd) = volts
  // V(gnd) = 0, so V(vccNet) = volts.  Per-part params.volts overrides
  // the board default so the designer can expose editable rail voltages.
  const volts = part.params?.volts ?? vcc;
  A.set(row, nodeIdx, 1);
  A.set(nodeIdx, row, 1);
  b[row] = volts;
}

/**
 * Stamp MCU pins as Norton equivalents.
 * @param {Matrix} A
 * @param {Float64Array} b
 * @param {Part} part
 * @param {Net[]} nets
 * @param {Map<string, number>} nodeIndex
 * @param {string | null} groundNetId
 * @param {Map<string, TheveninSource>} pinSources
 */
function stampMcuPins(A, b, part, nets, nodeIndex, groundNetId, pinSources) {
  for (const terminal of part.terminals) {
    const source = pinSources.get(terminal);
    if (!source || source === 'high-z') continue;

    const pinNet = findNet(nets, part.id, terminal);
    if (!pinNet) continue;
    const nodeIdx = nodeIndex.get(pinNet);
    if (nodeIdx === undefined) continue;

    // Norton equivalent: G = 1/Rth, I = Vth/Rth
    const g = 1 / source.rTh;
    const iNorton = source.vTh / source.rTh;

    A.add(nodeIdx, nodeIdx, g);
    b[nodeIdx] += iNorton;
  }
}

/**
 * Stamp a buzzer as a small resistance.
 * @param {Matrix} A
 * @param {Float64Array} b
 * @param {Part} part
 * @param {Net[]} nets
 * @param {Map<string, number>} nodeIndex
 * @param {string | null} groundNetId
 */
function stampBuzzerResistance(A, b, part, nets, nodeIndex, groundNetId) {
  const netA = findNet(nets, part.id, 'a');
  const netB = findNet(nets, part.id, 'b');
  const g = 1 / 100; // 100 Ω
  stampTwoTerminal(A, netA, netB, g, nodeIndex);
}

/**
 * Stamp a registered device: its `state.drives` as Norton sources, then the
 * model's own `stamp(ctx)` for input impedance / analog loading.
 */
function stampDevice(A, b, part, nets, nodeIndex, model, state, controls, vcc, tSeconds, dtSec) {
  // Drives: terminal → {vTh, rTh} | null
  for (const [terminal, drive] of Object.entries(state.drives ?? {})) {
    if (!drive) continue;
    const net = findNet(nets, part.id, terminal);
    const idx = net ? nodeIndex.get(net) : undefined;
    if (idx === undefined) continue;
    const g = 1 / Math.max(drive.rTh, 1e-3);
    A.add(idx, idx, g);
    b[idx] += drive.vTh * g;
  }
  if (!model.stamp) return;
  const ctx = {
    netFor: (terminal) => findNet(nets, part.id, terminal),
    conductance: (tA, tB, g) => {
      const netA = findNet(nets, part.id, tA);
      const netB = tB ? findNet(nets, part.id, tB) : undefined;
      stampTwoTerminal(A, netA, netB, g, nodeIndex);
    },
    thevenin: (terminal, vTh, rTh) => {
      const net = findNet(nets, part.id, terminal);
      const idx = net ? nodeIndex.get(net) : undefined;
      if (idx === undefined) return;
      const g = 1 / Math.max(rTh, 1e-3);
      A.add(idx, idx, g);
      b[idx] += vTh * g;
    },
    current: (terminal, amps) => {
      const net = findNet(nets, part.id, terminal);
      const idx = net ? nodeIndex.get(net) : undefined;
      if (idx !== undefined) b[idx] += amps;
    },
    vcc,
    tSeconds,
    dtSec,
    control: controls.get(part.id),
  };
  model.stamp(ctx, part, state);
}

/**
 * Helper: stamp a conductance between two nets.
 * @param {Matrix} A
 * @param {string | undefined} netA
 * @param {string | undefined} netB
 * @param {number} g - conductance
 * @param {Map<string, number>} nodeIndex
 */
function stampTwoTerminal(A, netA, netB, g, nodeIndex) {
  const idxA = netA ? nodeIndex.get(netA) : undefined;
  const idxB = netB ? nodeIndex.get(netB) : undefined;

  if (idxA !== undefined) A.add(idxA, idxA, g);
  if (idxB !== undefined) A.add(idxB, idxB, g);
  if (idxA !== undefined && idxB !== undefined) {
    A.add(idxA, idxB, -g);
    A.add(idxB, idxA, -g);
  }
}

// ─── New component stamp functions ──────────────────────────────────────────

/**
 * Stamp a variable resistor (LDR or NTC). Resistance depends on control value.
 */
function stampVariableResistor(A, b, part, nets, nodeIndex, groundNetId, controls) {
  let ohms;
  if (part.kind === 'ldr') {
    const rDark = /** @type {number} */ (part.params.rDark ?? 1000000);
    const rLight = /** @type {number} */ (part.params.rLight ?? 100);
    const light = controls.get(part.id) ?? 0;
    ohms = rDark * Math.pow(rLight / rDark, light);
  } else {
    // ntc
    const rCold = /** @type {number} */ (part.params.rCold ?? 100000);
    const rHot = /** @type {number} */ (part.params.rHot ?? 1000);
    const temp = controls.get(part.id) ?? 0;
    ohms = rCold * Math.pow(rHot / rCold, temp);
  }
  ohms = Math.max(ohms, 0.001);
  const netA = findNet(nets, part.id, 'a');
  const netB = findNet(nets, part.id, 'b');
  stampTwoTerminal(A, netA, netB, 1 / ohms, nodeIndex);
}

/**
 * Stamp an NPN transistor. Simplified Ebers-Moll:
 * Terminals: base, collector, emitter.
 * B-E junction: diode with Vbe ≈ 0.7V.
 * C-E: controlled current source Ic = β × Ib (β from params, default 100).
 * Linearized: Ic = gm × Vbe - Ic0 (Norton companion model).
 */
function stampNPN(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, region = 'active') {
  const beta = /** @type {number} */ (part.params.beta ?? 100);
  const vbe = /** @type {number} */ (part.params.vbe ?? 0.7);
  const rd = 10; // base-emitter dynamic resistance
  const vceSat = /** @type {number} */ (part.params.vceSat ?? 0.2);

  const netB = findNet(nets, part.id, 'base');
  const netC = findNet(nets, part.id, 'collector');
  const netE = findNet(nets, part.id, 'emitter');

  const idxB = netB ? nodeIndex.get(netB) : undefined;
  const idxC = netC ? nodeIndex.get(netC) : undefined;
  const idxE = netE ? nodeIndex.get(netE) : undefined;

  // B-E junction: diode model
  const vAcross = diodeVoltages.get(part.id) ?? 0;
  const { gEq, iEq } = diodeCompanion(vAcross, vbe, rd);

  // Stamp B-E diode
  if (idxB !== undefined) A.add(idxB, idxB, gEq);
  if (idxE !== undefined) A.add(idxE, idxE, gEq);
  if (idxB !== undefined && idxE !== undefined) {
    A.add(idxB, idxE, -gEq);
    A.add(idxE, idxB, -gEq);
  }
  if (idxB !== undefined) b[idxB] -= iEq;
  if (idxE !== undefined) b[idxE] += iEq;

  // Saturated: the VCCS is replaced by a Vce clamp — a stiff
  // conductance holding collector ≈ emitter + vceSat, so Ic becomes
  // whatever the LOAD passes at Vce(sat), which is the physics of a
  // switched-on transistor. The region decision lives in the Newton
  // loop beside the op-amp's.
  if (region === 'saturated') {
    const gS = 10; // 100 mΩ-class clamp
    if (idxC !== undefined) A.add(idxC, idxC, gS);
    if (idxE !== undefined) A.add(idxE, idxE, gS);
    if (idxC !== undefined && idxE !== undefined) {
      A.add(idxC, idxE, -gS);
      A.add(idxE, idxC, -gS);
    }
    if (idxC !== undefined) b[idxC] += gS * vceSat;
    if (idxE !== undefined) b[idxE] -= gS * vceSat;
    return;
  }

  // C-E current source: Ic = β × Ib = β × gEq × Vbe + β × iEq
  // This is a voltage-controlled current source from B-E to C-E.
  // gm = β × gEq, Ic0 = β × iEq
  const gm = beta * gEq;
  const ic0 = beta * iEq;

  // Stamp: current from collector to emitter proportional to Vbe
  if (idxC !== undefined && idxB !== undefined) A.add(idxC, idxB, gm);
  if (idxC !== undefined && idxE !== undefined) A.add(idxC, idxE, -gm);
  if (idxE !== undefined && idxB !== undefined) A.add(idxE, idxB, -gm);
  if (idxE !== undefined) A.add(idxE, idxE, gm);

  if (idxC !== undefined) b[idxC] -= ic0;
  if (idxE !== undefined) b[idxE] += ic0;
}

/**
 * Stamp a PNP transistor. Mirror of NPN with reversed polarities.
 * Terminals: base, collector, emitter.
 */
function stampPNP(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, region = 'active') {
  const beta = /** @type {number} */ (part.params.beta ?? 100);
  const vbe = /** @type {number} */ (part.params.vbe ?? 0.7);
  const rd = 10;

  const netB = findNet(nets, part.id, 'base');
  const netC = findNet(nets, part.id, 'collector');
  const netE = findNet(nets, part.id, 'emitter');

  const idxB = netB ? nodeIndex.get(netB) : undefined;
  const idxC = netC ? nodeIndex.get(netC) : undefined;
  const idxE = netE ? nodeIndex.get(netE) : undefined;

  // E-B junction: diode (reversed from NPN — emitter is higher)
  // The Newton store already computes vE - vB for pnp (the update loop
  // at ~line 640) — negating it again meant conduction required base
  // ABOVE emitter, so no PNP ever conducted (audit escalation, pc32).
  const vAcross = diodeVoltages.get(part.id) ?? 0;
  const { gEq, iEq } = diodeCompanion(vAcross, vbe, rd);
  const vceSat = /** @type {number} */ (part.params.vceSat ?? 0.2);
  if (region === 'saturated') {
    // Clamp emitter ≈ collector + vceSat (mirror of the NPN clamp).
    const gS = 10;
    if (idxE !== undefined) A.add(idxE, idxE, gS);
    if (idxC !== undefined) A.add(idxC, idxC, gS);
    if (idxE !== undefined && idxC !== undefined) {
      A.add(idxE, idxC, -gS);
      A.add(idxC, idxE, -gS);
    }
    if (idxE !== undefined) b[idxE] += gS * vceSat;
    if (idxC !== undefined) b[idxC] -= gS * vceSat;
    return;
  }

  // Stamp E-B diode
  if (idxE !== undefined) A.add(idxE, idxE, gEq);
  if (idxB !== undefined) A.add(idxB, idxB, gEq);
  if (idxE !== undefined && idxB !== undefined) {
    A.add(idxE, idxB, -gEq);
    A.add(idxB, idxE, -gEq);
  }
  if (idxE !== undefined) b[idxE] -= iEq;
  if (idxB !== undefined) b[idxB] += iEq;

  // C-E current source (reversed direction from NPN)
  const gm = beta * gEq;
  const ic0 = beta * iEq;

  if (idxE !== undefined && idxE !== undefined) A.add(idxE, idxE, gm);
  if (idxE !== undefined && idxB !== undefined) A.add(idxE, idxB, -gm);
  if (idxC !== undefined && idxE !== undefined) A.add(idxC, idxE, -gm);
  if (idxC !== undefined && idxB !== undefined) A.add(idxC, idxB, gm);

  if (idxE !== undefined) b[idxE] -= ic0;
  if (idxC !== undefined) b[idxC] += ic0;
}

/**
 * Stamp a Zener diode.
 * Forward: like a regular diode (Vf ≈ 0.7V).
 * Reverse: conducts at Vz (breakdown voltage), maintaining Vz across it.
 * Terminals: anode, cathode.
 */
function stampZener(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages) {
  const vf = /** @type {number} */ (part.params.vf ?? 0.7);
  const vz = /** @type {number} */ (part.params.vz ?? 5.1);
  const rd = 10;
  const rzener = /** @type {number} */ (part.params.rz ?? 5); // zener dynamic R

  const netA = findNet(nets, part.id, 'anode');
  const netC = findNet(nets, part.id, 'cathode');
  const idxA = netA ? nodeIndex.get(netA) : undefined;
  const idxC = netC ? nodeIndex.get(netC) : undefined;

  const vAcross = diodeVoltages.get(part.id) ?? 0;

  let gEq, iEq;
  if (vAcross >= vf) {
    // Forward conduction
    gEq = 1 / rd;
    iEq = -vf / rd;
  } else if (vAcross <= -vz) {
    // Zener breakdown (reverse conduction)
    gEq = 1 / rzener;
    iEq = vz / rzener; // current flows cathode→anode in breakdown
  } else {
    // Off region
    gEq = 1e-9;
    iEq = 0;
  }

  if (idxA !== undefined) A.add(idxA, idxA, gEq);
  if (idxC !== undefined) A.add(idxC, idxC, gEq);
  if (idxA !== undefined && idxC !== undefined) {
    A.add(idxA, idxC, -gEq);
    A.add(idxC, idxA, -gEq);
  }
  if (idxA !== undefined) b[idxA] -= iEq;
  if (idxC !== undefined) b[idxC] += iEq;
}

// ─── MOSFET stamp functions ─────────────────────────────────────────────────

/**
 * Stamp an N-channel MOSFET. Simplified square-law model:
 * Terminals: gate, drain, source.
 * Cutoff: Vgs < Vth → off (very high Rds).
 * Linear/saturation: Id = K × (Vgs - Vth)² (simplified).
 * Linearized as Norton companion for NR.
 */
function stampNMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, region = 'saturation') {
  const vth = /** @type {number} */ (part.params.vth ?? 2.0);
  const k = /** @type {number} */ (part.params.k ?? 0.5); // A/V² (transconductance parameter)

  const netG = findNet(nets, part.id, 'gate');
  const netD = findNet(nets, part.id, 'drain');
  const netS = findNet(nets, part.id, 'source');

  const idxG = netG ? nodeIndex.get(netG) : undefined;
  const idxD = netD ? nodeIndex.get(netD) : undefined;
  const idxS = netS ? nodeIndex.get(netS) : undefined;

  const vgs = diodeVoltages.get(part.id) ?? 0;

  if (vgs < vth) {
    // Cutoff: very high resistance drain-source
    const gOff = 1e-9;
    if (idxD !== undefined) A.add(idxD, idxD, gOff);
    if (idxS !== undefined) A.add(idxS, idxS, gOff);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gOff);
      A.add(idxS, idxD, -gOff);
    }
  } else if (region === 'triode') {
    // Fully-enhanced switch with small vds: the channel is a resistor,
    // Rds(on) ≈ 1/(2K·Vov). Without this region the saturation VCCS
    // demanded K·Vov² amps through any load and the drain ran away to
    // -2247 V (sweep escalation 2026-08-15) — the NPN lesson, again.
    const vov = vgs - vth;
    const gOn = 2 * k * Math.max(vov, 0.05);
    if (idxD !== undefined) A.add(idxD, idxD, gOn);
    if (idxS !== undefined) A.add(idxS, idxS, gOn);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gOn);
      A.add(idxS, idxD, -gOn);
    }
  } else {
    // On: Id = K(Vgs - Vth)². Linearized:
    // gm = dId/dVgs = 2K(Vgs - Vth)
    // Id0 = K(Vgs - Vth)² - gm × Vgs (Norton offset)
    const vov = vgs - vth;
    const gm = 2 * k * vov;
    const id0 = k * vov * vov;
    const iEq = id0 - gm * vgs;

    // VCCS: drain current controlled by Vgs
    if (idxD !== undefined && idxG !== undefined) A.add(idxD, idxG, gm);
    if (idxD !== undefined && idxS !== undefined) A.add(idxD, idxS, -gm);
    if (idxS !== undefined && idxG !== undefined) A.add(idxS, idxG, -gm);
    if (idxS !== undefined && idxS !== undefined) A.add(idxS, idxS, gm);

    if (idxD !== undefined) b[idxD] -= iEq;
    if (idxS !== undefined) b[idxS] += iEq;

    // Small Rds for stability
    const gds = 0.001; // 1kΩ output resistance
    if (idxD !== undefined) A.add(idxD, idxD, gds);
    if (idxS !== undefined) A.add(idxS, idxS, gds);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gds);
      A.add(idxS, idxD, -gds);
    }
  }
}

/** P-channel MOSFET: mirror of NMOS with reversed gate sense. */
function stampPMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, region = 'saturation') {
  const vth = /** @type {number} */ (part.params.vth ?? -2.0);
  const k = /** @type {number} */ (part.params.k ?? 0.5);

  const netG = findNet(nets, part.id, 'gate');
  const netD = findNet(nets, part.id, 'drain');
  const netS = findNet(nets, part.id, 'source');

  const idxG = netG ? nodeIndex.get(netG) : undefined;
  const idxD = netD ? nodeIndex.get(netD) : undefined;
  const idxS = netS ? nodeIndex.get(netS) : undefined;

  // For PMOS: Vsg > |Vth| to turn on
  const vsg = diodeVoltages.get(part.id) ?? 0;

  if (vsg < Math.abs(vth)) {
    const gOff = 1e-9;
    if (idxD !== undefined) A.add(idxD, idxD, gOff);
    if (idxS !== undefined) A.add(idxS, idxS, gOff);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gOff);
      A.add(idxS, idxD, -gOff);
    }
  } else if (region === 'triode') {
    // Enhanced switch, small |vds|: channel = Rds(on) ≈ 1/(2K·Vov).
    const gOn = 2 * k * Math.max(vsg - Math.abs(vth), 0.05);
    if (idxD !== undefined) A.add(idxD, idxD, gOn);
    if (idxS !== undefined) A.add(idxS, idxS, gOn);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gOn);
      A.add(idxS, idxD, -gOn);
    }
  } else {
    const vov = vsg - Math.abs(vth);
    const gm = 2 * k * vov;
    const id0 = k * vov * vov;
    const iEq = id0 - gm * vsg;

    // PMOS: current flows source → drain (reversed from NMOS)
    if (idxS !== undefined && idxS !== undefined) A.add(idxS, idxS, gm);
    if (idxS !== undefined && idxG !== undefined) A.add(idxS, idxG, -gm);
    if (idxD !== undefined && idxS !== undefined) A.add(idxD, idxS, -gm);
    if (idxD !== undefined && idxG !== undefined) A.add(idxD, idxG, gm);

    if (idxS !== undefined) b[idxS] -= iEq;
    if (idxD !== undefined) b[idxD] += iEq;

    const gds = 0.001;
    if (idxD !== undefined) A.add(idxD, idxD, gds);
    if (idxS !== undefined) A.add(idxS, idxS, gds);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gds);
      A.add(idxS, idxD, -gds);
    }
  }
}

// ─── Op-amp stamp ───────────────────────────────────────────────────────────

/**
 * Stamp an op-amp as a VCVS with supply-rail clamping.
 * Terminals: inp (non-inverting), inn (inverting), out.
 *
 * Linear region:  V(out) − gain·V(inp) + gain·V(inn) = 0   (extra MNA row)
 * Saturated:      V(out) = railHigh | railLow               (same row, fixed)
 *
 * The region lives in `opampRegions` and is settled by the NR loop: an ideal
 * VCVS whose ideal output leaves [railLow, railHigh] flips to the rail; a
 * railed op-amp whose input difference reverses flips back. A real op-amp
 * cannot output 900 V, and a model that can teaches the wrong electronics.
 *
 * Regression note: the previous implementation allocated a source row it never
 * stamped — a guaranteed-singular matrix, silently caught, returning all-zero
 * voltages for ANY circuit containing an op-amp.
 */
function stampOpamp(A, b, part, nets, nodeIndex, groundNetId, vsIndex, opampRegions, vcc) {
  const gain = /** @type {number} */ (part.params.gain ?? 1e6);
  const railLow = /** @type {number} */ (part.params.railLow ?? 0);
  const railHigh = /** @type {number} */ (part.params.railHigh ?? vcc);

  const netP = findNet(nets, part.id, 'inp');
  const netN = findNet(nets, part.id, 'inn');
  const netO = findNet(nets, part.id, 'out');

  const idxP = netP ? nodeIndex.get(netP) : undefined;
  const idxN = netN ? nodeIndex.get(netN) : undefined;
  const idxO = netO ? nodeIndex.get(netO) : undefined;

  const vsIdx = vsIndex.get(part.id);
  if (vsIdx === undefined || idxO === undefined) return;

  const row = nodeIndex.size + vsIdx;

  // The output node carries the source's branch current variable.
  A.set(idxO, row, 1);

  const region = opampRegions.get(part.id) ?? 'linear';
  if (region === 'linear') {
    // V(out) − gain·(V(inp) − V(inn)) = 0
    A.set(row, idxO, 1);
    if (idxP !== undefined) A.add(row, idxP, -gain);
    if (idxN !== undefined) A.add(row, idxN, gain);
    b[row] = 0;
  } else {
    // Saturated at a rail: V(out) = rail
    A.set(row, idxO, 1);
    b[row] = region === 'high' ? railHigh : railLow;
  }
}

/**
 * Stamp a capacitor holding its stored voltage as a source row:
 * V(a) − V(b) = vStored. Used for instantaneous solves (no dt), where a
 * capacitor genuinely is a voltage source.
 */
function stampCapAsSource(A, b, part, nets, nodeIndex, vsIndex, vStored) {
  const netA = findNet(nets, part.id, 'a');
  const netB = findNet(nets, part.id, 'b');
  const idxA = netA ? nodeIndex.get(netA) : undefined;
  const idxB = netB ? nodeIndex.get(netB) : undefined;
  const vsIdx = vsIndex.get(part.id);
  if (vsIdx === undefined) return;
  const row = nodeIndex.size + vsIdx;
  if (idxA !== undefined) { A.set(row, idxA, 1); A.set(idxA, row, 1); }
  if (idxB !== undefined) { A.set(row, idxB, -1); A.set(idxB, row, -1); }
  b[row] = vStored;
}

/**
 * Evaluate a source's voltage at simulation time t.
 *
 * params.wave selects the shape; absent or 'dc' is a constant `volts`.
 *   { wave: 'sine'|'square'|'triangle'|'pulse', freq, amplitude, offset, phase, duty }
 * amplitude is the peak deviation from offset; duty applies to square/pulse
 * (fraction of the period spent high, default 0.5); phase is in degrees.
 * A 'pulse' swings offset → offset+amplitude; the others swing symmetrically.
 *
 * This is the whole electrical model of a function generator.
 *
 * @param {Part} part
 * @param {number} tSeconds
 * @param {number} vcc - fallback for a plain DC source with no volts param
 * @returns {number}
 */
export function sourceVoltage(part, tSeconds, vcc) {
  const p = part.params ?? {};
  const wave = /** @type {string} */ (p.wave ?? 'dc');
  const volts = /** @type {number} */ (p.volts ?? vcc);
  if (wave === 'dc') return volts;

  // PCM playback: the source plays a sample buffer — an audio line-in.
  // { wave: 'pcm', samples: number[]|Float32Array, rate: Hz,
  //   gain?: volts-per-unit (default 1), offset?: volts, loop?: bool }
  // Linear interpolation between samples; past the end it holds the
  // offset (silence), or wraps when loop is set. This is the primitive
  // under every sound-into-a-pin experiment (the blinkenrocket modem,
  // microphones, knock): the WAVEFORM is data, the source stays dumb.
  if (wave === 'pcm') {
    const samples = p.samples;
    const rate = /** @type {number} */ (p.rate ?? 44100);
    const gain = /** @type {number} */ (p.gain ?? 1);
    const offset = /** @type {number} */ (p.offset ?? 0);
    if (!samples || !samples.length) return offset;
    let pos = tSeconds * rate;
    if (p.loop) pos = pos % samples.length;
    if (pos < 0 || pos >= samples.length - 1) {
      // hold the final sample's tail only exactly at the end; past it, silence
      return pos >= samples.length ? offset : offset + gain * samples[Math.max(0, Math.floor(pos))];
    }
    const i = Math.floor(pos);
    const frac = pos - i;
    return offset + gain * (samples[i] * (1 - frac) + samples[i + 1] * frac);
  }

  const freq = /** @type {number} */ (p.freq ?? 1000);
  const amplitude = /** @type {number} */ (p.amplitude ?? volts);
  const offset = /** @type {number} */ (p.offset ?? 0);
  const phaseDeg = /** @type {number} */ (p.phase ?? 0);
  const duty = Math.min(1, Math.max(0, /** @type {number} */ (p.duty ?? 0.5)));

  // Position in the cycle, 0…1, phase-shifted.
  const cycles = tSeconds * freq + phaseDeg / 360;
  const frac = cycles - Math.floor(cycles);

  switch (wave) {
    case 'sine':
      return offset + amplitude * Math.sin(2 * Math.PI * frac);
    case 'square':
      return offset + (frac < duty ? amplitude : -amplitude);
    case 'pulse':
      return offset + (frac < duty ? amplitude : 0);
    case 'triangle':
      // Rises from −amplitude at frac=0 to +amplitude at frac=0.5, back down.
      return offset + amplitude * (frac < 0.5 ? (4 * frac - 1) : (3 - 4 * frac));
    default:
      return volts;
  }
}

// ─── Independent sources ────────────────────────────────────────────────────

/**
 * Independent voltage source. Terminals: pos, neg.
 * Params: {volts} — DC value; plus the waveform params of `sourceVoltage`
 * for time-varying operation (sine/square/triangle/pulse).
 */
function stampIndependentVSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc, tSeconds = 0, controls = null) {
  // Control value overrides params.volts for interactive adjustment (bench supply knob)
  let volts;
  if (part._ccClampedVolts !== undefined) {
    volts = part._ccClampedVolts;
  } else if (controls && controls.has(part.id)) {
    volts = controls.get(part.id);
  } else {
    volts = sourceVoltage(part, tSeconds, vcc);
  }
  const posNet = findNet(nets, part.id, 'pos');
  const negNet = findNet(nets, part.id, 'neg');

  const idxPos = posNet ? nodeIndex.get(posNet) : undefined;
  const idxNeg = negNet ? nodeIndex.get(negNet) : undefined;
  const vsIdx = vsIndex.get(part.id);
  if (vsIdx === undefined) return;

  const dim = nodeIndex.size;
  const row = dim + vsIdx;

  // V(pos) - V(neg) = volts
  if (idxPos !== undefined) {
    A.set(row, idxPos, 1);
    A.set(idxPos, row, 1);
  }
  if (idxNeg !== undefined) {
    A.set(row, idxNeg, -1);
    A.set(idxNeg, row, -1);
  }
  b[row] = volts;
}

/**
 * Independent current source. Terminals: pos, neg.
 * Current flows from neg to pos (conventional).
 * Params: {amps} — the source current.
 */
function stampCurrentSource(A, b, part, nets, nodeIndex, groundNetId) {
  const amps = /** @type {number} */ (part.params.amps ?? 0.001);
  const posNet = findNet(nets, part.id, 'pos');
  const negNet = findNet(nets, part.id, 'neg');

  const idxPos = posNet ? nodeIndex.get(posNet) : undefined;
  const idxNeg = negNet ? nodeIndex.get(negNet) : undefined;

  // Current source: inject current into pos, extract from neg
  if (idxPos !== undefined) b[idxPos] += amps;
  if (idxNeg !== undefined) b[idxNeg] -= amps;
}

export { Matrix, solve, diodeCompanion, findNet };
