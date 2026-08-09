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
 * @returns {{ nodeVoltages: Map<string, number>, branchCurrents: Map<string, Map<string, number>> }}
 */
export function solveMNA(parts, nets, pinSources, controls, vcc, opts = {}) {
  const powerOff = opts.powerOff ?? false;
  const testNodeA = opts.testNodeA;
  const testNodeB = opts.testNodeB;
  const testCurrent = opts.testCurrent ?? 0.001;

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
  }

  // Assign node indices (skip ground and, when power is off, skip nets that
  // only connect to active sources and have no passive element terminals).
  const passiveKinds = new Set(['resistor', 'capacitor', 'diode', 'led',
    'potentiometer', 'button', 'switch', 'buzzer', 'ldr', 'ntc',
    'npn', 'pnp', 'zener', 'inductor', 'nmos', 'pmos', 'opamp',
    'vsource', 'isource']);

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

  if (!powerOff) {
    for (const part of parts) {
      if (part.kind === 'vcc') {
        const vccNet = findNet(nets, part.id, 'vcc');
        if (vccNet && nodeIndex.has(vccNet)) {
          vsIndex.set(part.id, vsCount++);
        }
      }
      // Op-amp output is a voltage source (VCVS)
      if (part.kind === 'opamp') {
        const outNet = findNet(nets, part.id, 'out');
        if (outNet && nodeIndex.has(outNet)) {
          vsIndex.set(part.id, vsCount++);
        }
      }
      // Independent voltage source
      if (part.kind === 'vsource') {
        const posNet = findNet(nets, part.id, 'pos');
        if (posNet && nodeIndex.has(posNet)) {
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
  for (const part of parts) {
    if (part.kind === 'led' || part.kind === 'diode' || part.kind === 'npn'
        || part.kind === 'pnp' || part.kind === 'zener'
        || part.kind === 'nmos' || part.kind === 'pmos') {
      diodeVoltages.set(part.id, 0); // initial guess
    }
  }

  // Newton–Raphson iterations
  const MAX_NR_ITER = 50;
  const NR_TOL = 1e-6;

  let solution = new Float64Array(dim);

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
            stampVoltageSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc);
          }
          break;

        case 'mcu':
          if (!powerOff) {
            stampMcuPins(A, b, part, nets, nodeIndex, groundNetId, pinSources);
          }
          break;

        case 'buzzer':
          stampBuzzerResistance(A, b, part, nets, nodeIndex, groundNetId);
          break;

        case 'ldr':
        case 'ntc':
          stampVariableResistor(A, b, part, nets, nodeIndex, groundNetId, controls);
          break;

        case 'inductor':
          // Inductor companion model is time-dependent and handled
          // separately in advanceTo. For DC steady-state MNA, an
          // inductor is a short circuit (zero resistance wire).
          stampTwoTerminal(A,
            findNet(nets, part.id, 'a'),
            findNet(nets, part.id, 'b'),
            1 / 0.001, // 1 mΩ — effectively a wire for DC
            nodeIndex);
          break;

        case 'npn':
          stampNPN(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages);
          break;

        case 'pnp':
          stampPNP(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages);
          break;

        case 'nmos':
          stampNMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages);
          break;

        case 'pmos':
          stampPMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages);
          break;

        case 'opamp':
          stampOpamp(A, b, part, nets, nodeIndex, groundNetId);
          break;

        case 'vsource':
          stampIndependentVSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc);
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

        // gnd, capacitor, inductor, seven_segment, rgb_led, led_matrix:
        // handled elsewhere or composite
      }
    }

    // Inject test current for resistance measurement
    if (testNodeA && testNodeB) {
      const idxA = nodeIndex.get(testNodeA);
      const idxB = nodeIndex.get(testNodeB);
      if (idxA !== undefined) b[idxA] += testCurrent;
      if (idxB !== undefined) b[idxB] -= testCurrent;
    }

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

      maxDelta = Math.max(maxDelta, Math.abs(vNew - vOld));
      diodeVoltages.set(part.id, vNew);
    }

    // If no diodes or converged, stop
    if (diodeVoltages.size === 0 || maxDelta < NR_TOL) break;
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
      const vf = /** @type {number} */ (part.params.vf ?? 2.0);
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
      // DC: inductor is a wire, current = V_drop / R_wire
      const i = (vA - vB) / 0.001;
      currents.set('a', -i);
      currents.set('b', i);
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
  }

  return { nodeVoltages, branchCurrents };
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
  const vf = /** @type {number} */ (part.params.vf ?? 2.0);
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

  // Voltage source from ground to vccNet: V(vccNet) - V(gnd) = vcc
  // V(gnd) = 0, so V(vccNet) = vcc
  A.set(row, nodeIdx, 1);
  A.set(nodeIdx, row, 1);
  b[row] = vcc;
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
function stampNPN(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages) {
  const beta = /** @type {number} */ (part.params.beta ?? 100);
  const vbe = /** @type {number} */ (part.params.vbe ?? 0.7);
  const rd = 10; // base-emitter dynamic resistance

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
function stampPNP(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages) {
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
  const vAcross = -(diodeVoltages.get(part.id) ?? 0);
  const { gEq, iEq } = diodeCompanion(vAcross, vbe, rd);

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
function stampNMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages) {
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
function stampPMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages) {
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
 * Stamp an ideal op-amp. Terminals: inp (non-inverting), inn (inverting), out.
 * Model: Vout = A × (Vinp - Vinn), with A → infinity (ideal).
 * In MNA: this is a VCVS with very high gain, stamped as a voltage source
 * whose value is A × (V+ - V-).
 */
function stampOpamp(A, b, part, nets, nodeIndex, groundNetId) {
  const gain = /** @type {number} */ (part.params.gain ?? 1e6); // open-loop gain

  const netP = findNet(nets, part.id, 'inp');
  const netN = findNet(nets, part.id, 'inn');
  const netO = findNet(nets, part.id, 'out');

  const idxP = netP ? nodeIndex.get(netP) : undefined;
  const idxN = netN ? nodeIndex.get(netN) : undefined;
  const idxO = netO ? nodeIndex.get(netO) : undefined;

  // Use the voltage source row for this opamp
  const dim = nodeIndex.size;
  const vsIdx = part._vsIdx; // set during counting
  // Actually we need to look it up from vsIndex passed around...
  // For now, use the simpler Norton approach: model as a VCCS with
  // very high transconductance, plus a small output resistance.

  // Norton: Iout = gm × (V+ - V-), gm = gain / Rout
  const rOut = /** @type {number} */ (part.params.rOut ?? 1);
  const gm = gain / rOut; // very large
  const gOut = 1 / rOut;

  // Output conductance
  if (idxO !== undefined) A.add(idxO, idxO, gOut);

  // VCCS: current into output proportional to (V+ - V-)
  if (idxO !== undefined && idxP !== undefined) A.add(idxO, idxP, gm);
  if (idxO !== undefined && idxN !== undefined) A.add(idxO, idxN, -gm);
}

// ─── Independent sources ────────────────────────────────────────────────────

/**
 * Independent voltage source. Terminals: pos, neg.
 * Params: {volts} — the source voltage.
 */
function stampIndependentVSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc) {
  const volts = /** @type {number} */ (part.params.volts ?? vcc);
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
