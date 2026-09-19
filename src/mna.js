/**
 * Modified Nodal Analysis (MNA) solver.
 *
 * Linear MNA with Newton–Raphson for nonlinear elements (diodes, LEDs,
 * BJTs, MOSFETs, op-amp rails, CC-limited sources), backward-Euler
 * transient companions for C/L, and an instantaneous mode where charged
 * capacitors pin their nets. board.js routes to this whenever the bench
 * contains anything beyond the closed-form walker's vocabulary
 * (`_needsMNA`), and the instruments (branchCurrent, resistance) always
 * come here.
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
import { CooMatrix, SparseLU, toCSC } from './sparse.js';
import { spiceExpValue, spicePulseVoltage, spicePwlValue, spiceSineValue } from './source-waveforms.js';

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

/**
 * Solve the assembled CooMatrix system — sparse LU with a three-level
 * reuse ladder (spec-updates/sparse-lu-factor-reuse.md):
 *
 *   1. identical pattern AND identical values → substitution only
 *      (the idle-transient / repeated-instrument-read case);
 *   2. identical pattern, new values → numeric refactor along the stored
 *      pivot order and reach lists, no DFS (the NR-iteration case);
 *   3. otherwise → full factorization with partial pivoting.
 *
 * The cache is module-level: two boards alternating solves miss it and
 * refactor — never corrupt (pattern equality gates every reuse), and a
 * failed refactor drops the cache before falling back to a full factor.
 *
 * @param {CooMatrix} A
 * @param {Float64Array} b - consumed
 * @returns {Float64Array}
 */
let _luCache = null; // { lu: SparseLU, values: Float64Array }

function solveAssembled(A, b) {
  const csc = toCSC(A);
  const c = _luCache;
  if (c && c.lu.samePattern(csc)) {
    const vals = csc.values;
    const prev = c.values;
    let same = vals.length === prev.length;
    if (same) {
      for (let i = 0; i < vals.length; i++) {
        if (vals[i] !== prev[i]) { same = false; break; }
      }
    }
    if (same) return c.lu.solve(b);
    if (c.lu.refactor(csc)) {
      c.values = vals.slice();
      return c.lu.solve(b);
    }
    // Refactor bailed: its partial writes invalidated the stored factors.
    _luCache = null;
  }
  const lu = new SparseLU();
  lu.factor(csc); // throws "Singular matrix at column N" — same contract as dense
  _luCache = { lu, values: csc.values.slice() };
  return lu.solve(b);
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
    // COMPOSITE linearization: junction + series rs as one branch,
    // i(v_total) with v_total = vJ + i·rs. `vAcross` here is the stored
    // JUNCTION voltage state (the NR variable); the returned Norton is in
    // terms of the TOTAL branch voltage the network sees. rs = 0 (the
    // direct-call/test path) reduces exactly to the bare exponential.
    const p = shockleyParams({ ...opts, rs: opts.rs ?? 0 }, vf);
    const { i, gj } = shockleyEval(vAcross, p);
    const gEq = gj / (1 + gj * p.rs);
    const vTotalOp = vAcross + i * p.rs;
    return { gEq, iEq: i - gEq * vTotalOp };
  }

  // Piecewise-linear knee with a C1 parabolic blend over ±PWL_KNEE_EPS.
  // A HARD corner plus an inductor is a Newton oscillator: the flyback
  // decay tail parks the junction exactly at vf, the on/off branches
  // alternate per step, and the adaptive integrator tracked the orbit
  // forever at err ≈ 0.73 (a single 1 ms advance read −4.7 V where fine
  // stepping settles at +0.7 V) — the diode-corner twin of the MOS
  // smoothVov fix. Outside the band both branches are BIT-IDENTICAL to
  // the original lines, so every corpus operating point away from the
  // knee is untouched.
  const EPS = kneeEps(rd);
  if (vAcross < vf - EPS) {
    const gOff = 1e-9;
    return { gEq: gOff, iEq: 0 };
  }
  if (vAcross > vf + EPS) {
    const gEq = 1 / rd;
    const iEq = -vf / rd;
    return { gEq, iEq };
  }
  // In-band: i(v) = (v − vf + ε)² / (4·ε·rd) — joins i = 0 at vf−ε and the
  // line (v−vf)/rd at vf+ε with matching slope at both ends.
  const u = vAcross - vf + EPS;
  const gEq = u / (2 * EPS * rd);
  const i = (u * u) / (4 * EPS * rd);
  return { gEq, iEq: i - gEq * vAcross };
}

/** Half-width of the PWL knee's C1 blend band (volts), for an LED-scale part. */
const PWL_KNEE_EPS = 0.025;

/**
 * THE BLEND BAND IS A FRACTION OF THE DEVICE'S OWN RATED OVERDRIVE, NOT AN
 * ABSOLUTE VOLTAGE.
 *
 * A flat 0.025 V is a detail for an LED and a catastrophe for silicon, and the
 * reason is that the knee has a natural voltage scale: the part sits at
 * `i_rated * rd` above its knee when it carries its rated current. That is
 * 0.020*10 = 0.2 V for an LED -- eight times the band, so the rated point is
 * far out on the linear segment -- and 0.020*0.568 = 0.01136 V for a 1N4148,
 * which is INSIDE it. So silicon never reached its linear segment at its own
 * rated current, and the smoothing ate the calibration: 5 V through 150 R,
 * which is the rated bias BY DEFINITION of vf, read 20.0176 mA instead of
 * 20.0000, and the effective bulk resistance came out 0.4356 instead of 0.568.
 *
 * This was invisible while every junction shared rd = 10, because at that
 * value no kind could get near the band at its rated point. Per-kind rd is
 * what exposed it -- a fix uncovering a defect that the thing it fixed had
 * been hiding.
 *
 * alpha = 0.5 puts the rated point at exactly twice the half-width, i.e.
 * comfortably linear, while keeping the band as wide as the device allows for
 * Newton's sake. For an LED min() picks 0.025 unchanged, so every LED operating
 * point in the corpus is bit-identical.
 */
const KNEE_EPS_ALPHA = 0.5;
const kneeEps = rd =>
  Math.min(PWL_KNEE_EPS, KNEE_EPS_ALPHA * JUNCTION_I_RATED * Math.max(rd, 1e-9));

/** PWL knee current with the C1 blend — extraction must match the stamp. */
function pwlKneeCurrent(v, vf, rd) {
  // Same kneeEps as diodeCompanion. If these two ever disagree, a current read
  // off the extraction describes a different device than the one the stamp
  // solved, which is the whole class of defect this lane has been closing.
  const eps = kneeEps(rd);
  if (v < vf - eps) return 0;
  if (v > vf + eps) return (v - vf) / rd;
  const u = v - vf + eps;
  return (u * u) / (4 * eps * rd);
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
/**
 * Junction model resolution — OPT-IN Shockley via `params.model:
 * 'shockley'`; the sharp-knee PWL stays the default.
 *
 * Why not Shockley-by-default yet: the closed-form walker answers LED
 * benches with the knee, so a default flip makes nodeVoltage (walker) and
 * branchCurrent (MNA) disagree by ~4 % on the same bench — the
 * two-solvers-two-truths trap — and silently moves every LED/diode value
 * in the shipped example corpus. The flip is a coordinated change (walker
 * routing + corpus re-measurement together), tracked as ROADMAP E1.3b;
 * the machinery (companion, pnjlim, extraction) is complete and tested
 * behind the param. Ideality: LEDs 1.8, silicon 1.0, via params.n.
 */
/**
 * THE JUNCTION-ROUTING POLICY, in one place, with a toggle.
 *
 * 'auto'     — per-circuit: Shockley where the walker's knee model is not
 *              adequate, PWL where it is. The default, and what the E1.3b
 *              measurement supports.
 * 'shockley' — every junction exponential. The E1.3b full flip, kept reachable
 *              so it can be turned on wholesale the day the ~4x solve cost is
 *              acceptable, without re-deriving any of this.
 * 'pwl'      — every junction piecewise. The pre-E1.3b behaviour, kept so a
 *              regression can be bisected against it rather than argued about.
 *
 * A part's own `params.model` always wins: an explicit choice on the part is a
 * statement about that device, and a global policy must not overrule it.
 */
export const JUNCTION_ROUTING = {mode: 'auto'};

/** The headroom below which the walker stops being adequate. Derived; see board.js. */
export const MNA_HEADROOM_V = 2.0;

/**
 * The piecewise path's junction dynamic resistance, in ohms — the value
 * `board.js` calls LED_RD and `mna.js` repeats as `const rd = 10` in seven
 * places. The exponential path's `rs` is THE SAME PHYSICAL QUANTITY and
 * currently defaults to 2 instead, so the routing toggle does not switch
 * models of one device, it switches DEVICES. Recorded here, and its cost
 * measured in test/junction-rs-divergence.test.mjs, rather than silently
 * fixed: correcting it in isolation makes the suite worse.
 */
export const JUNCTION_RD = 10;

/**
 * The current at which a junction's `vf` is specified, in amps. A datasheet
 * gives an LED as `Vf @ If = 20 mA`; the number is meaningless without it.
 * Matches board.js LED_I_RATED, which normalises brightness by the same value.
 */
import { classDefaults } from './parts-library.js';

export const JUNCTION_I_RATED = 0.020;

/**
 * The square-law transconductance for a MOSFET, in A/V².
 *
 * ACCEPTS THE SPICE SPELLING AS WELL AS OURS. Our stamp wants a single lumped
 * `k` in `Id = k(Vgs-Vth)²`. Every real SPICE model card instead gives `KP`
 * with per-instance `W` and `L`, where `Id = (KP/2)(W/L)(Vgs-Vth)²`, so
 *
 *     k = KP/2 * W/L
 *
 * Refusing kp/w/l would mean no foreign MOSFET netlist could be read without a
 * hand conversion first — and the corpus work depends on ingesting thousands of
 * them (2,822 MOSFET topologies in one dataset alone). Extending the vocabulary
 * is cheaper than a translation table, and a translation table would be another
 * place for the number to drift.
 *
 * An explicit `k` still wins: somebody who lumped it themselves meant it.
 */
/**
 * The numerical floor under a channel's output conductance — at GMIN's scale,
 * deliberately, and not above it.
 *
 * Its only job is to stop an exactly-singular row at the triode/saturation
 * boundary, where the triode `gds = 2K*(Vov - Vds)` passes through zero. Every
 * other operating point already has the channel's own conductance holding the
 * drain.
 *
 * It was 1e-7 (10 MOhm), which sounds negligible and is not, because what
 * matters at CUTOFF is the ratio to GMIN. A drain-source leak ties a floating
 * node to whatever the other off device touches; GMIN ties it to GROUND, which
 * is where ngspice puts it. At 1e-7 the leak still out-argued GMIN 15:1 through
 * the taper and a CMOS NAND's internal node read 0.200 V between two cut-off
 * NMOS; at GMIN's own scale it reads 0, which is ngspice's answer and the one a
 * probe on an unconnected node should give.
 */
export const MOS_GDS_FLOOR = 1e-12;

/**
 * GMIN: the conductance ngspice places ACROSS EVERY PN JUNCTION, and nowhere
 * else. Not a node-diagonal term -- proven at 1 TOhm: `R1 a b 1T` with no
 * junction gives exactly 5.000000 V, and with one reverse diode 2.495000 V,
 * which is (5e-12 - 1e-14)/2e-12 and only solves if the junction carries a
 * 1e-12 conductance IN PARALLEL with its saturation current.
 *
 * A floored CONDUCTANCE is not the same term and does not produce that number.
 * A Newton stamp of `g = 1e-12, Ieq = i(V0) - g*V0` makes the branch carry
 * exactly `i(V0)` at convergence -- for a reverse diode, a pure 1e-14 A current
 * source with no conductance at all. Measured on the deck above: 4.989999 V,
 * because 1e-14 A through 1 TOhm is 0.01 V. The missing piece is the GMIN*V
 * term in the junction CURRENT, which is what makes the junction a conductance
 * as well as a source.
 */
export const JUNCTION_GMIN = 1e-12;

/**
 * A SATURATED MOSFET'S OUTPUT CONDUCTANCE, FROM THE MODEL AND NOT FROM A
 * NUMERICAL CONVENIENCE.
 *
 * This was a flat `0.001 * taper^2` — a 1 kOhm resistor across every conducting
 * channel, put there for Newton stability. It is not a small correction. On the
 * ADI cascode bench (LEVEL=1, VTO=1, KP=1e-4, W/L=20, Vgs=1.8) the channel
 * sources 640 uA and that 1 kOhm passed 3.4 mA beside it:
 *
 *     ngspice   Id 655 uA,  V(out) 11.40 V
 *     engine    Id 4.56 mA, V(out)  7.85 V
 *
 * SPICE's level-1 saturation slope is `LAMBDA * Id`, and LAMBDA DEFAULTS TO 0 —
 * an ideal current source. So the model's answer is "no output conductance
 * unless the deck states one", and a deck that states LAMBDA gets it. The
 * numerical floor stays, at the GMIN scale rather than three orders above it,
 * and the taper still carries the sub-threshold leak so a cut-off drain is not
 * left floating.
 *
 * @param {object} params  the part's params (`lambda`, optional)
 * @param {number} id0     the channel current at the expansion point
 * @param {number} taper   0 at cutoff, 1 fully conducting
 */
/**
 * THE LEVEL-1 TRIODE LAW, WITH CHANNEL-LENGTH MODULATION, IN ONE PLACE.
 *
 *   Id  = K*(2*Vov*Vds - Vds^2) * (1 + LAMBDA*Vds)
 *   gds = dId/dVds = K*[ 2*(Vov - Vds)*(1 + LAMBDA*Vds) + (2*Vov*Vds - Vds^2)*LAMBDA ]
 *   gm  = dId/dVgs = 2*K*Vds*dVov * (1 + LAMBDA*Vds)
 *
 * SPICE APPLIES LAMBDA IN THE LINEAR REGION TOO, and this engine applied it
 * only in saturation. Measured, on a device held firmly in triode (Vds = 62 mV
 * against Vov = 4 V) so that nothing else could account for the difference:
 *
 *   .model NM NMOS(LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0.1)   ngspice d = 6.182569e-2
 *   .model NM NMOS(LEVEL=1 VTO=1 KP=1.0e-4 LAMBDA=0)     ngspice d = 6.220612e-2
 *
 * The current is pinned by the 10k load, so the drain-source voltage is what
 * moves: 0.0618257/0.0622061 = 0.993886, against 1/(1 + 0.1*0.0618) = 0.993855.
 * Agreement to 3e-5, in both directions.
 *
 * Corpus consequence: ADI2005 v3 row 417, a source-degenerated amplifier whose
 * device is in triode at Vds = 2.55 V against Vov = 3.93 V. ngspice reads the
 * drain at 4.217489 V, which needs Id = 13.897 mA; the law WITHOUT the lambda
 * factor gives 13.797 mA and a drain 56 mV high. With it, 13.90 mA.
 *
 * AT LAMBDA = 0 THIS IS BIT-IDENTICAL to the expression it replaces, so every
 * deck that states no LAMBDA is untouched.
 *
 * AND THE TWO REGIONS STILL MEET, now in slope as well as value. At Vds = Vov:
 * Id = K*Vov^2*(1 + LAMBDA*Vov), which is the saturation law at Vds = Vov; and
 * gds = K*LAMBDA*Vov^2, which is `mosGds`'s LAMBDA*|Id|. Before this the triode
 * gds went to zero at the boundary while saturation's was LAMBDA*Id, so the
 * meeting was in value only.
 *
 * ONE definition, three readers: both stamps and the current extraction. The
 * vceSat split happened because a law had two copies.
 *
 * @param {number} k       K, or KP/2 * (W/L)
 * @param {number} vov     smoothed overdrive at the operating point
 * @param {number} vds     effective drain-source voltage (already clamped)
 * @param {number} dVov    d(vov_s)/d(vov), for gm
 * @param {object} params  the part's params; `lambda` defaults to 0
 * @returns {{id: number, gds: number, gm: number}}
 */
export function mosTriode(k, vov, vds, dVov, params) {
  const raw = Number(params?.lambda ?? 0);
  const lambda = Number.isFinite(raw) && raw > 0 ? raw : 0;
  const mod = 1 + lambda * vds;
  const base = 2 * vov * vds - vds * vds;
  return {
    id: k * base * mod,
    gds: k * (2 * (vov - vds) * mod + base * lambda),
    gm: 2 * k * vds * dVov * mod,
  };
}

export function mosGds(params, id0, taper) {
  const lambda = Number(params?.lambda ?? 0);
  const model = Number.isFinite(lambda) && lambda > 0 ? lambda * Math.abs(id0) : 0;
  // NO FLAT FLOOR. A cut-off MOSFET conducts nothing, and `solveMNA` already
  // ties EVERY node to the reference through GMIN — so a flat drain-source
  // leak is not insurance, it is a second, WRONGER tie: GMIN pulls a floating
  // node to GROUND, which is where ngspice puts it, while a drain-source leak
  // pulls it towards whatever the other off device happens to touch.
  //
  // Measured on a CMOS NAND with both inputs low, where N1 sits between two
  // cut-off NMOS: 1 nS on each made it a divider between OUT and ground and it
  // read 2.410857 V, against ngspice's 0. The taper already carries this to
  // zero; the flat term was what stopped it arriving.
  return (model + MOS_GDS_FLOOR) * taper * taper;
}

/**
 * THE BODY EFFECT: a MOSFET's threshold rises with its source-bulk bias.
 *
 *     Vth = VTO + GAMMA * (sqrt(PHI + Vsb) - sqrt(PHI))
 *
 * GAMMA defaults to 0 in SPICE, so this is identity for any model that does not
 * state it — which is why the shipped gallery cannot move.
 *
 * WHY IT IS WORTH HAVING. It is the largest single cause of numeric
 * disagreement left in the ADI2005 corpus: of 311 disagreements in a 2,000-deck
 * sample, **107 are decks that state a non-zero GAMMA and have a MOSFET whose
 * source sits off its bulk** — every Wilson current mirror (63) and every plain
 * NMOS differential pair (44). Corpus-wide that condition holds for 624 of
 * 12,471 decks. A stacked device (a cascode's upper transistor, a diff pair's
 * tail-connected pair, a mirror's output leg) has its source above the bulk BY
 * CONSTRUCTION, so its threshold is simply not VTO.
 *
 * HISTORIC THREE-TERMINAL CASE. The ordinary board symbol still has gate,
 * drain and source; `bulkAtGround` records the older exact case where an
 * imported deck tied its fourth terminal to node 0. An imported four-terminal
 * device can now carry an explicit `bulk` terminal instead. That distinction
 * matters: its two junction currents must return through the real bulk net,
 * not through an invented fixed potential.
 *
 * The Jacobian omits `gmb` (the bulk transconductance), so the threshold is
 * evaluated at the stored Vsb and iterated to a fixed point inside Newton —
 * the same technique `bjtVceSat` uses. Convergence is a little slower; the
 * converged answer satisfies the correct equations, which is the part that
 * matters.
 *
 * @param {object} params  vth, gamma, phi, bulkAtGround
 * @param {number} vsb     source-bulk bias, from the solve
 */
/**
 * THE FOURTH TERMINAL'S TWO DIODES.
 *
 * A SPICE MOSFET has four terminals, and the bulk carries a pn junction to the
 * source and another to the drain. The original three-terminal engine parts
 * had no representation for those diodes — and they are not a detail. Measured on
 * an ADI2005 NMOS diff pair with a 13k tail resistor to a -15 V rail
 * (`test/mosfet-bulk-junction.test.mjs` carries the deck):
 *
 *   bulk at node 0, as the deck writes it   ngspice TAIL = -0.639395 V
 *   bulk moved to VSS                       ngspice TAIL = -1.667870 V
 *   bulk at 0 but IS crushed to 1e-30       ngspice TAIL = -1.559280 V
 *
 * and our three-terminal answer was -1.673589 V — within 6 mV of the
 * bulk-at-VSS deck. So the channel model was already right and the whole 1.03 V
 * was ONE MISSING DIODE: with the source a volt below the grounded bulk, the
 * bulk-source junction is forward biased and conducts. 1e-14·(e^(0.639395/vt)−1)
 * = 0.553 mA per device, two devices, 1.107 mA — and (TAIL−VSS)/13k demands
 * 1.1047 mA. The arithmetic closes to 0.2 %, which is how this was identified
 * rather than guessed.
 *
 * This applies only where the importer could tell us where the bulk is:
 * `bulkAtGround`, bulk on source, or an actual optional `bulk` terminal. A
 * third-node bulk without that terminal remains declined; a potential we would
 * have to invent is not a potential we know.
 *
 * IS = 1e-14 A and N = 1 are SPICE's own defaults for the bulk junction when no
 * area is given; `shockleyEval`'s reverse branch already returns −IS with a
 * 1e-12 conductance, which is what ngspice's GMIN puts there.
 *
 * @param {number} vAcross  bulk→source for an n-channel, source→bulk for a p
 * @param {object} [params]  the part's params; `bulkIs` overrides SPICE's default
 * @returns {{gEq: number, iEq: number}} Norton companion
 */
export function mosBulkJunction(vAcross, params = {}) {
  const is = Number.isFinite(params.bulkIs) && params.bulkIs > 0 ? params.bulkIs : MOS_BULK_IS;
  const p = { is, nVt: MOS_BULK_N * JUNCTION_THERMAL_VOLTAGE, rs: 0 };
  const { i, gj } = shockleyEval(vAcross, p);
  return { gEq: gj, iEq: i - gj * vAcross };
}

/** SPICE's default bulk-junction saturation current and ideality. */
const MOS_BULK_IS = 1e-14;
const MOS_BULK_N = 1;

export function mosVth(params = {}, vsb = 0) {
  const vth = Number(params.vth ?? 2.0);
  const gamma = Number(params.gamma ?? 0);
  if (!Number.isFinite(gamma) || gamma === 0
      || (!params.bulkAtGround && !params.bulkExplicit)) return vth;
  const phi = Number(params.phi ?? 0.6);
  if (!Number.isFinite(phi) || phi <= 0) return vth;
  // A NEGATIVE Vsb forward-biases the bulk junction, which is not a normal
  // operating condition and which this model has no business extrapolating
  // into: the square root would go complex below -PHI. Clamped at 0, which is
  // the no-shift case.
  const v = Math.max(vsb, 0);
  return vth + gamma * (Math.sqrt(phi + v) - Math.sqrt(phi));
}

export function mosK(params = {}) {
  if (params.k !== undefined) return params.k;
  const {kp, w, l} = params;
  if (kp !== undefined) {
    const ratio = (w !== undefined && l !== undefined && l > 0) ? w / l : 1;
    return (kp / 2) * ratio;
  }
  return 0.5;
}

/**
 * Silicon signal-diode bulk resistance, in ohms — our own reference part,
 * `D1N4148 D(IS=2.52e-9 RS=0.568 N=1.752)` in test/golden/run_ngspice_diode.py.
 *
 * NOT the LED's 10. This is load-bearing, not tidiness: the knee conversion
 * subtracts `iRated * rd`, so sharing the LED's value would subtract 0.2 V from
 * a part whose real bulk drop at 20 mA is 11 mV. MEASURED on 5 V through 1 kOhm,
 * against ngspice's 0.6532 V:
 *
 *     vf as knee,      rd=10      0.7426 V   +13.68 %
 *     converted,       rd=10      0.5446 V   -16.63 %   <- worse than before
 *     converted,       rd=0.568   0.6911 V    +5.80 %   <- and better than both
 *
 * So the per-kind split is what makes the conversion an improvement for silicon
 * rather than a regression. A shared rd was the reason it looked like one.
 *
 * The 0.568 itself is NOT declared here any more. It was `export const
 * SILICON_RD`, which after junctionRd started reading the table had no code
 * readers left -- a second home for a number, kept alive only by a test that
 * pinned it against the card it was copied from. It lives in
 * parts-library.js: classDefaults('diode').rs, and 1N4148's own card.
 */

/**
 * Vce(sat) FROM EBERS-MOLL, because a constant is wrong at every drive but one.
 *
 * The saturated stamp held Vce at a fixed `vceSat` (0.2 V by default). The real
 * quantity is a smooth function of how hard the base is driven, and ngspice
 * shows it moving by a factor of five across ordinary bench conditions while
 * ours did not move at all:
 *
 *     forced beta (Ic/Ib)    ours      ngspice
 *              1.2         0.200480   0.029907
 *             11.5         0.200480   0.068744
 *            112.8         0.200480   0.144079
 *
 * So no value of the constant can be right; it is a model gap, not a
 * calibration. The textbook expression reproduces ngspice to five digits on all
 * three with the SPICE default reverse beta of 1:
 *
 *     Vce(sat) = Vt * ln[ (1 + (1 + Ic/Ib)/Br) / (1 - Ic/(Ib*Bf)) ]
 *
 * Guarded because the log's argument leaves the physical range as the device
 * comes out of saturation: at Ic/Ib -> Bf the denominator reaches zero and
 * Vce(sat) diverges, which is the model saying "this is no longer saturated" —
 * the region test says so too, and the fallback keeps the stamp finite while
 * that decision is being made.
 *
 * @param {number} iC collector current, amps
 * @param {number} iB base current, amps
 * @param {number} betaF forward beta
 * @param {number} betaR reverse beta (SPICE's BR; 1 by default)
 * @param {number} fallback value to use when the device is not in the saturated range
 */
export function ebersMollVceSat(iC, iB, betaF, betaR = 1, fallback = 0.2) {
  if (!(iB > 0) || !(iC >= 0) || !(betaF > 0) || !(betaR > 0)) return fallback;
  const forced = iC / iB;
  const denom = 1 - forced / betaF;
  if (!(denom > 1e-6)) return fallback;          // at or past the edge of saturation
  const arg = (1 + (1 + forced) / betaR) / denom;
  if (!(arg > 1)) return fallback;
  const v = JUNCTION_THERMAL_VOLTAGE * Math.log(arg);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

/** The dynamic/bulk resistance for a junction part, by kind. */
// ONE TABLE, NOT A TERNARY. This branched on `kind === 'diode'` while
// junctionOpts read classDefaults, so the two paths agreed for led and diode
// and DISAGREED FOR ZENER: a zener is silicon (classDefaults rs = 0.568) but
// fell into the ternary's else and got rd = 10, an 18x split between the model
// the solver uses and the model the exporter writes. Reading the same table is
// the only form of this that cannot drift.
// BOTH SPELLINGS, because `rd` and `rs` are one quantity and callers write
// whichever their path taught them. Reading only `rd` here meant a card that
// carried `rs` -- 1N4001 at 0.045 R, a 1 A rectifier's real bulk -- reached the
// exponential path and was INVISIBLE to the piecewise one, which silently fell
// back to the class default. LED_RED hid that by carrying both.
export const junctionRd = part =>
  /** @type {number} */ (
    part?.params?.rd ?? part?.params?.rs ?? classDefaults(part?.kind).rs ?? JUNCTION_RD);

/**
 * The PIECEWISE KNEE for a part whose `vf` is the DATASHEET total drop.
 *
 * The piecewise model answers `vf + i*rd`, so feeding it the datasheet drop
 * makes the part drop `vf + 0.020*rd` at its own rated current -- 0.2 V too
 * much for an LED, which is why the piecewise path read 18.75 mA where the
 * exponential path read exactly 20.000 mA at the rated bias. The exponential
 * path already calibrates the TOTAL drop to vf (`shockleyParams`:
 * `vJrated = vf - 0.020*rs`); this is the same subtraction for the other path,
 * so one `vf` means one thing in both.
 *
 * MEASURED against ngspice: applying this takes the piecewise path from
 * -7.13/-9.14/-14.39 % to -0.58/-2.74/-4.14 % on the three corpus LED devices.
 *
 * ONLY FOR CLASSES THAT HAVE A RATED CURRENT AND A DATASHEET COUNTERPART --
 * led and diode. Zener forward drop and BJT `vbe` are deliberately NOT passed
 * through here: they can never reach the exponential path (stampZener,
 * stampNPN and stampPNP hold no reference to it), so there is no second answer
 * for them to agree with, and 0.020 A is the LED's rating, not theirs. 0.7 is
 * equally the knee number for a silicon junction, so the corpus gives no tell.
 * test/junction-knee-classes.test.mjs pins that exclusion with its reasons.
 *
 * `iRated` is a parameter because the rating is a property of the PART, not a
 * constant: the bargraph carries its own `iFull`, and a knee derived from the
 * wrong rating is exactly the error this function exists to remove, one level
 * down. Callers with no rating of their own must not call it at all.
 */
export const kneeFromVf = (vf, rd = JUNCTION_RD, iRated = JUNCTION_I_RATED) =>
  vf - iRated * rd;

/**
 * The model this junction will actually be solved with.
 *
 * `headroomV` is the supply margin over the total forward drop, or undefined
 * where the caller cannot compute it — in which case 'auto' keeps today's
 * behaviour (opt-in only) rather than guessing.
 */
export function junctionModelOf(part, headroomV) {
  const explicit = part?.params?.model;
  if (explicit === 'shockley' || explicit === 'pwl') return explicit;
  if (JUNCTION_ROUTING.mode === 'shockley') return 'shockley';
  if (JUNCTION_ROUTING.mode === 'pwl') return 'pwl';
  if (typeof headroomV !== 'number' || !Number.isFinite(headroomV)) return 'pwl';
  return headroomV < MNA_HEADROOM_V ? 'shockley' : 'pwl';
}

/**
 * WHY THE BJT HAS NO `model: 'shockley'` ESCAPE HATCH, measured rather than
 * assumed — and why the piecewise knee is the BETTER approximation here.
 *
 * The diodes got an exponential mode because SPICE has no spelling for our
 * knee. The obvious next step is to give the transistor's base-emitter junction
 * the same treatment, with saturation current IS/BF since Gummel-Poon writes
 * Ib = IS/BF*(exp(Vbe/(N*Vt)) - 1). I implemented that and it made agreement
 * WORSE, on every bench:
 *
 *     RB    RC     mode       V(base)    ngspice
 *     10k   1k     pwl        0.695747   0.699884    <- 4.1 mV
 *     10k   1k     shockley   0.769464   0.699884    <- 69.6 mV
 *     4k7   220    pwl        0.705229   0.736786
 *     4k7   220    shockley   0.788862   0.736786
 *
 * THE REASON IS SATURATION, and it is the whole difficulty. A single junction
 * puts all of Ib across B-E, giving Vt*ln(Ib*Bf/Is) = 0.770 V at Ib = 0.43 mA.
 * ngspice's 0.6999 V implies only 0.0285 mA crosses B-E; the other 0.40 mA
 * flows through the FORWARD-BIASED BASE-COLLECTOR junction, which is what
 * saturation IS. One exponential junction cannot express that, and adding it
 * alone is worse than the knee it replaced, because the knee at least does not
 * claim to be the exponential.
 *
 * So a faithful BJT needs BOTH junctions — full Ebers-Moll with a reverse beta
 * — not a translated diode. That is a real piece of work and it is named here
 * so the next person does not repeat the cheap version. The saturation VOLTAGE
 * is already exact (see `ebersMollVceSat`); it is the base NODE that is 4 mV
 * out, and 4 mV is what the knee costs.
 */

/**
 * FULL EBERS-MOLL FOR A BJT — BOTH JUNCTIONS, WITH A REVERSE BETA.
 *
 * The comment above says why a single exponential base-emitter junction is
 * WORSE than the knee it would replace, and names this as the work that is
 * actually needed. This is that work.
 *
 * Transport form, the same one SPICE's Gummel-Poon reduces to when a `.model`
 * line gives only Is and Bf (NF = NR = 1, BR = 1, no Early effect, no
 * high-level injection) — which is exactly what every deck we export declares:
 *
 *   iF = Is * (exp(Vbe / nVt) - 1)          forward transport
 *   iR = Is * (exp(Vbc / nVt) - 1)          reverse transport
 *   Ib = iF/BF + iR/BR
 *   Ic = iF - iR * (1 + 1/BR)
 *   Ie = -(Ib + Ic)
 *
 * SATURATION FALLS OUT rather than being clamped. Forward-bias the collector
 * junction and iR grows, taking its share of Ib and pulling Ic down; Vce
 * settles wherever the two junctions balance. That is what a saturated
 * transistor IS, and it is why the measured base error was 4.1 mV with the knee
 * and 69.6 mV with one exponential junction: one junction has to carry all of
 * Ib, so it reports Vt*ln(Ib*Bf/Is) = 0.770 V where only 0.0285 mA of the
 * 0.43 mA actually crosses B-E.
 *
 * GATED ON THE SAME SWITCH THE DIODES USE, and off by default. The piecewise
 * BJT is what 2,163 corpus circuits and 5,000 tests are written against, and
 * `JUNCTION_ROUTING.mode = 'shockley'` (what the oracle sweep sets) or an
 * explicit `params.model` is how you ask for the exponential one. So this adds
 * a model rather than replacing one, and no shipped number moves.
 *
 * @param {Part} part
 * @returns {{is: number, nVt: number, bf: number, br: number, vaf: number, rb: number} | null}
 *   null when this part is not on the exponential path.
 */
function ebersMollParams(part) {
  const model = part?._junctionModel ?? junctionModelOf(part, undefined);
  if (model !== 'shockley') return null;
  const cls = classDefaults(part.kind);
  // The card is the only home of an electrical value: `is`, `beta` and `br`
  // come from the part, then from the class table the exporter's `.model` line
  // is derived from. A literal here would be the LDR defect again — the deck
  // saying one number and the solve using another.
  const is = Number(part.params?.is ?? cls.is);
  const bf = Number(part.params?.beta ?? cls.beta);
  const br = Number(part.params?.br ?? cls.br);
  const n = Number(part.params?.n ?? cls.n ?? 1);
  // Forward Early voltage. ABSENT MEANS INFINITE, not zero and not a default
  // number: a card that does not declare VAF must solve exactly as it did
  // before this parameter existed, and `Infinity` is the only value of it that
  // makes the Early term vanish algebraically rather than numerically. A zero
  // would be a divide-by-zero dressed as a default, so it is rejected here
  // along with a negative -- SPICE treats VAF=0 as "no Early effect" and so do
  // we, by falling back to Infinity rather than by a branch downstream.
  const vafDeclared = Number(part.params?.vaf ?? cls.vaf ?? Infinity);
  const vaf = vafDeclared > 0 ? vafDeclared : Infinity;
  const rb = Number(part.params?.rb ?? 0);
  if (!(is > 0) || !(bf > 0) || !(br > 0) || !(n > 0)
      || !Number.isFinite(rb) || rb < 0) return null;
  return { is, nVt: n * JUNCTION_THERMAL_VOLTAGE, bf, br, vaf, rb };
}

/**
 * Linearise Ebers-Moll at a stored (Vbe, Vbc) and return the stamp.
 *
 * Signs are for an NPN with currents flowing INTO the device at each terminal.
 * A PNP is the same device with every junction voltage negated, so the caller
 * passes (Veb, Vcb) and negates the resulting currents — one model, two stamps.
 *
 * @returns {{gpi: number, gmu: number, gcF: number, gcR: number,
 *            ieqB: number, ieqC: number, ib: number, ic: number}}
 */
export function ebersMollCompanion(vbe, vbc, p) {
  const cap = 80 * p.nVt;
  const expF = Math.exp(Math.min(vbe, cap) / p.nVt);
  const expR = Math.exp(Math.min(vbc, cap) / p.nVt);
  const iF = p.is * (expF - 1);
  const iR = p.is * (expR - 1);
  const gF = Math.min(p.is * expF / p.nVt, 1e6);
  const gR = Math.min(p.is * expR / p.nVt, 1e6);

  // GMIN GOES ON THE JUNCTIONS, AND NOT DIVIDED BY BETA.
  //
  // These conductances used to be FLOORED at 1e-12 "the way shockleyEval
  // floors its own". Two things were wrong with that, and they compound:
  //
  //  - A floor on the slope is not a parallel conductance, and the CURRENT is
  //    what fixes the answer. The Newton stamp makes the branch carry exactly
  //    `i(V0)` at convergence, so a floored reverse junction is a pure
  //    saturation-current source with no conductance at all -- see
  //    JUNCTION_GMIN for the 1 TOhm measurement. Measured on a base behind a
  //    coupling capacitor: engine 0.009954 V against ngspice 0.276875 V.
  //  - The floor also landed on `gF`, which reaches the base only as
  //    `gF / BF`. That one is a JACOBIAN error rather than a wrong answer: a
  //    converged solution does not depend on it. It is still wrong, because a
  //    Jacobian entry that is not the derivative of its own current costs
  //    convergence -- and the honest test of it is the derivative, not the
  //    voltage. `JUNCTION_GMIN` added to `ib` differentiates to `JUNCTION_GMIN`
  //    on `gpi`, undivided; a mutation dividing it by BF is invisible in every
  //    node voltage, which is exactly why it needs its own assertion.
  //
  // ngspice adds GMIN to the base-emitter and base-collector JUNCTION currents
  // themselves, so it appears once on each junction at full strength. The
  // transport terms (`iF`, `ic`) are not junction currents and get none.
  // THE EARLY EFFECT, on the TRANSPORT current and nothing else.
  //
  // ngspice's BJT computes its base-charge factor as q1 = 1/(1 - Vbc/VAF -
  // Vbe/VAR) and its transport current as (iF - iR)/qb; with no VAR and no
  // high-current knee that is exactly (iF - iR) * (1 - Vbc/VAF), which is the
  // form below. `vaf` is Infinity unless a card declares it, so `early` is
  // exactly 1 and `dEarly` exactly 0 for every part that does not, and the
  // stamp is then bit-identical to the one before this term existed.
  //
  // IT MUST NOT TOUCH THE BASE CURRENT. Ib stays iF/BF + iR/BR: Early raises
  // the collector current at a FIXED base current, which is the same statement
  // as beta rising with Vce, and putting the factor on Ib as well would cancel
  // the whole effect while still looking like an implementation of it.
  //
  // MEASURED, on the corpus family that made the case -- ADI2005 v2's "BJT
  // Emitter Follower", 59 decks, one model card (IS=1e-14 BF=200 VAF=100) and
  // a 22 MOhm base resistor:
  //
  //     ngspice V(BASE) 1.022540    before 1.006830    delta 15.7 mV
  //
  // and the removal test that isolated it: with VAF deleted from the card the
  // two engines AGREE, with IKF or RC deleted instead they still differ by the
  // same 15.7 mV. Vce is about 4.6 V there, so the factor is 1.046 -- a few
  // percent on Ic, which on a 22 MOhm base is 16 mV of base voltage.
  // `?? Infinity` rather than assuming the field: this function is exported and
  // a caller assembling `p` by hand (several tests do) would otherwise divide
  // by undefined and stamp NaN through the whole matrix.
  const vaf = p.vaf ?? Infinity;
  const early = 1 - vbc / vaf;
  const dEarly = Number.isFinite(vaf) ? -1 / vaf : 0;
  const ict = iF - iR;

  const ib = iF / p.bf + iR / p.br + JUNCTION_GMIN * (vbe + vbc);
  const ic = ict * early - iR / p.br - JUNCTION_GMIN * vbc;

  const gpi = gF / p.bf + JUNCTION_GMIN;   // d Ib / d Vbe
  const gmu = gR / p.br + JUNCTION_GMIN;   // d Ib / d Vbc
  const gcF = gF * early;                  // d Ic / d Vbe
  // d Ic / d Vbc: the reverse transport slope through the same factor, plus the
  // factor's OWN derivative times the transport current -- the term a chain
  // rule left out would make the Jacobian disagree with the current it stamps,
  // which costs iterations rather than accuracy and is invisible in any
  // converged voltage. It has its own finite-difference assertion.
  const gcR = -gR * early + ict * dEarly - gR / p.br - JUNCTION_GMIN;

  return {
    gpi, gmu, gcF, gcR,
    ieqB: ib - gpi * vbe - gmu * vbc,
    ieqC: ic - gcF * vbe - gcR * vbc,
    ib, ic,
  };
}

/**
 * Stamp the linearised Ebers-Moll companion.
 *
 * `sign` is +1 for an NPN and -1 for a PNP: the PNP's terminal currents are the
 * NPN's negated, and its junction voltages were negated on the way in, so one
 * stamp serves both rather than a transcribed copy that can drift.
 */
function stampEbersMoll(A, b, idxB, idxC, idxE, c, sign) {
  const add = (r, col, v) => { if (r !== undefined && col !== undefined) A.add(r, col, v); };
  const inj = (r, v) => { if (r !== undefined) b[r] -= sign * v; };

  // Vbe = vB - vE, Vbc = vB - vC.
  // Row B: +Ib
  add(idxB, idxB, c.gpi + c.gmu);
  add(idxB, idxE, -c.gpi);
  add(idxB, idxC, -c.gmu);
  inj(idxB, c.ieqB);
  // Row C: +Ic
  add(idxC, idxB, c.gcF + c.gcR);
  add(idxC, idxE, -c.gcF);
  add(idxC, idxC, -c.gcR);
  inj(idxC, c.ieqC);
  // Row E: -(Ib + Ic)
  add(idxE, idxB, -(c.gpi + c.gmu + c.gcF + c.gcR));
  add(idxE, idxE, c.gpi + c.gcF);
  add(idxE, idxC, c.gmu + c.gcR);
  inj(idxE, -(c.ieqB + c.ieqC));
}

function junctionOpts(part) {
  // The board resolved this once per solve and stamped it (board.js,
  // setNetlist). Reading the stamp rather than re-deciding is what keeps
  // `junctionCurrent`'s "must match what was stamped" true.
  const model = part?._junctionModel ?? junctionModelOf(part, undefined);
  if (model !== 'shockley') return undefined;
  return {
    shockley: true,
    is: part.params?.is,
    n: part.params?.n ?? classDefaults(part.kind).n ?? 1.0,
    // SERIES BULK RESISTANCE. IT IS THE SAME PHYSICAL QUANTITY AS THE
    // PIECEWISE PATH'S rd, SO THERE IS ONE DEFINITION AND BOTH PATHS READ IT.
    //
    // classDefaults is that definition (src/parts-library.js) and junctionRd
    // reads the same table, so `rs` and `rd` cannot drift apart per kind. They
    // did: rs defaulted to 2 here while rd was 10, which meant the routing
    // toggle switched DEVICES rather than models of one device, and every
    // accuracy number measured across it was partly a device swap.
    //
    // DO NOT RE-TUNE THIS AGAINST THE CORPUS. A sweep elects whatever RS the
    // reference devices were built with -- an exact 0.04% diagonal at RS = 5,
    // 10, 25 and 40 -- because shockleyParams ALGEBRAICALLY RECONSTRUCTS the
    // device when rs matches, so the residual is only JUNCTION_THERMAL_VOLTAGE
    // (0.02585, really
    // 26.83 C) against ngspice's default. It is a tautology with a units
    // artefact on top, not a fit. The value comes from the PART.
    //
    // Moving it is still coupled to the piecewise knee (kneeFromVf subtracts
    // 0.020*rd), so change classDefaults, not this line.
    rs: part.params?.rs ?? classDefaults(part.kind).rs ?? 0,
  };
}

/**
 * Shockley parameters with the TOTAL-drop calibration: Is is chosen so
 * that junction + rs together drop exactly vf at the rated 20 mA — the
 * teaching anchor "this LED drops vf at its rated current" stays true
 * with bulk resistance in the model.
 */
function shockleyParams(opts, vf) {
  const nVt = opts.n * JUNCTION_THERMAL_VOLTAGE;
  const rs = opts.rs ?? 0;
  let is = opts.is;
  if (is === undefined) {
    const vJrated = vf - 0.020 * rs;
    const expVf = Math.exp(Math.min(vJrated / nVt, 80));
    is = 0.020 / Math.max(expVf - 1, 1e-30);
  }
  return { nVt, is, rs };
}

/** Junction current and conductance at a JUNCTION voltage. */
function shockleyEval(vJ, p) {
  const vClamped = Math.min(vJ, p.nVt * 80);
  // `+ JUNCTION_GMIN * v` on the current and `+ JUNCTION_GMIN` on the slope:
  // the parallel conductance ngspice puts across the junction. It replaces the
  // old 1e-12 FLOOR on the slope, which looked like the same thing and is not
  // -- see JUNCTION_GMIN for the measurement that separates them. In forward
  // bias the term is ~7e-13 A against milliamps, so nothing there moves.
  if (vClamped < -5 * p.nVt) {
    return { i: -p.is + JUNCTION_GMIN * vClamped, gj: JUNCTION_GMIN };
  }
  const expV = Math.exp(vClamped / p.nVt);
  return {
    i: p.is * (expV - 1) + JUNCTION_GMIN * vClamped,
    gj: Math.min(p.is * expV / p.nVt + JUNCTION_GMIN, 1e6),
  };
}

/**
 * Recover the junction voltage from a TOTAL (node-difference) voltage:
 * solve vJ + f(vJ)·rs = vTotal by scalar Newton from the last state.
 */
function shockleyJunctionFromTotal(vTotal, vJ0, p) {
  if (!(p.rs > 0)) return vTotal;
  let vJ = vJ0;
  for (let k = 0; k < 40; k++) {
    const { i, gj } = shockleyEval(vJ, p);
    const resid = vJ + i * p.rs - vTotal;
    if (Math.abs(resid) < 1e-12) break;
    let step = resid / (1 + gj * p.rs);
    // The scalar Newton needs its own junction limiting.
    if (step > p.nVt * 4) step = p.nVt * 4;
    if (step < -p.nVt * 4) step = -p.nVt * 4;
    vJ -= step;
    if (Math.abs(step) < 1e-12) break;
  }
  return vJ;
}

/** Fixed junction thermal voltage used by the current DC junction models. */
export const JUNCTION_THERMAL_VOLTAGE = 0.02585;

/** Junction current at a solved voltage — must match what was stamped. */
function junctionCurrent(part, vAcross, vf, rd) {
  const opts = junctionOpts(part);
  if (!opts) {
    // Must match what was stamped, which now feeds the knee, not the datasheet vf.
    return pwlKneeCurrent(vAcross, kneeFromVf(vf, rd), rd);
  }
  const VT = 0.02585;
  // Total-voltage evaluation of the composite: recover the junction
  // voltage behind rs, then the current — must match the stamp.
  const p = shockleyParams(opts, vf);
  const vJ = shockleyJunctionFromTotal(vAcross, Math.min(vAcross, vf), p);
  return shockleyEval(vJ, p).i;
}

/**
 * SPICE-style junction voltage limiting (pnjlim): past the critical
 * voltage, an exponential junction's NR update is pulled back along a
 * logarithm instead of clamped flat — the classic cure for the two-
 * junction oscillation the 0.5 V clamp cannot settle.
 * @param {number} vnew @param {number} vold @param {number} nVt @param {number} vcrit
 */
function pnjlim(vnew, vold, nVt, vcrit) {
  if (vnew > vcrit && Math.abs(vnew - vold) > 2 * nVt) {
    if (vold > 0) {
      const arg = 1 + (vnew - vold) / nVt;
      return arg > 0 ? vold + nVt * Math.log(arg) : vcrit;
    }
    return nVt * Math.log(vnew / nVt);
  }
  return vnew;
}

/**
 * SPICE's critical junction voltage: where the exponential's curvature makes an
 * unlimited Newton step unsafe. One definition, so the diode path and the
 * Ebers-Moll path cannot pick different ones.
 */
function junctionVcrit(is, nVt) {
  return nVt * Math.log(nVt / (Math.SQRT2 * is));
}

/** Critical voltage + nVt for a part's junction (Shockley parts only). */
function junctionLimitParams(part, vf) {
  const opts = junctionOpts(part);
  if (!opts) return null;
  const p = shockleyParams(opts, vf);
  return { nVt: p.nVt, vcrit: junctionVcrit(p.is, p.nVt), p };
}

/**
 * SPICE-style FET gate-voltage limiting (fetlim, from the published
 * SPICE3 algorithm): a square-law device has a hard corner at Vth, and a
 * flat clamp bounces the NR iterate across it forever — measured on the
 * cross-coupled latch, which orbited the symmetric operating point at
 * ±0.5 V per iteration without ever settling. fetlim lands threshold
 * crossings AT Vth ± 0.5 and shrinks steps near the corner.
 * @param {number} vnew @param {number} vold @param {number} vto
 */
function fetlim(vnew, vold, vto) {
  const vtsthi = Math.abs(2 * (vold - vto)) + 2;
  const vtstlo = vtsthi / 2 + 2;
  const vtox = vto + 3.5;
  const delv = vnew - vold;
  if (vold >= vto) {
    if (vold >= vtox) {
      if (delv <= 0) {
        if (vnew >= vtox) {
          if (-delv > vtstlo) vnew = vold - vtstlo;
        } else {
          vnew = Math.max(vnew, vto + 2);
        }
      } else if (delv > vtsthi) {
        vnew = vold + vtsthi;
      }
    } else if (delv <= 0) {
      if (vnew < vto - 0.5) vnew = vto - 0.5;
    } else if (vnew > vtox) {
      vnew = vtox;
    }
  } else if (delv <= 0) {
    if (-delv > vtsthi) vnew = vold - vtsthi;
  } else if (vnew <= vto + 0.5) {
    if (delv > vtstlo) vnew = vold + vtstlo;
  } else {
    vnew = vto + 0.5;
  }
  return vnew;
}

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
    // Deep reverse bias: the saturation current in parallel with GMIN. The
    // Norton current is `i - g*V` = `(-is + GMIN*V) - GMIN*V` = `-is`, which is
    // why the source term is the plain saturation current and the conductance
    // carries the GMIN.
    return { gEq: JUNCTION_GMIN, iEq: -is };
  }

  const expV = Math.exp(vClamped / nVt);
  const iD = is * (expV - 1) + JUNCTION_GMIN * vClamped;
  const gEq = is * expV / nVt + JUNCTION_GMIN; // dI/dV, GMIN in parallel

  // Upper clamp only: GMIN is already the floor, and a floor is not the same
  // term as a parallel conductance.
  const gClamped = Math.min(gEq, 1e6);

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
 * @param {boolean} [opts.dcSources] - use each waveform source's explicit dcValue
 * @param {Map<string, number>} [opts.capVoltages] - part id → present capacitor voltage.
 *   When given (and not in transient mode), each capacitor is stamped as a voltage
 *   source holding its stored voltage — which is what a capacitor IS at an instant.
 *   Without it, capacitors are DC-open (legacy operating-point behaviour).
 * @param {{dtSec: number, capVoltages: Map<string, number>, inductorCurrents: Map<string, number>}} [opts.transient]
 *   Backward-Euler transient step: capacitors stamp as G=C/dt ∥ I=G·V_prev,
 *   inductors as G=dt/L ∥ I=I_prev. The result then carries capVoltagesNext /
 *   inductorCurrentsNext for the caller to store.
 * Raw branchCurrents are amperes OUT of the named part terminal into its net.
 * Source-row unknowns retain their MNA orientation; extraction converts them.
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
  const dcSources = opts.dcSources === true;
  // E2.2: silicon junctions shift −2 mV/°C. Assigned on EVERY entry (no
  // stale state); solveMNA is synchronous and never re-enters, and a
  // worker thread has its own module instance.
  benchTemperatureC = opts.temperatureC ?? 25;
  tempVfShiftV = (benchTemperatureC - 25) * -0.002;
  const transient = opts.transient ?? null;
  // A BIAS POINT AND AN INSTANT ARE DIFFERENT QUESTIONS, AND ONLY ONE WAS
  // REACHABLE.
  //
  // Outside a transient this solver already has both answers for a capacitor:
  // with `capVoltages` it holds the stored voltage as a source row (which for
  // an UNCHARGED capacitor is 0 V, i.e. a SHORT between its two nets), and
  // without it the capacitor is an OPEN, which is what `.op` means by one.
  // `BoardImpl._solveMNA` always passes `capVoltages`, correctly, because an
  // instrument must see the circuit as it is at `timeNs`. The consequence was
  // that no caller could ask for the other answer at all.
  //
  // It is not a hypothetical gap. ADI2005 v3 row 69, a two-stage
  // Miller-compensated op-amp: the 3 pF between COMP and OUT pinned the
  // compensation node to the output, both read 1.792744 V, and ngspice has COMP
  // at 2.298037 V with OUT on the -3.3 V rail because the output PMOS ends 2 mV
  // into cutoff. A 5.09 V disagreement from one capacitor being the wrong
  // element.
  //
  // `capacitorsOpen` selects the branch explicitly rather than by the absence
  // of an argument, so a caller states which question it is asking. It changes
  // nothing by default, and it is ignored inside a transient, where the
  // companion model is the only correct answer.
  const capVoltagesIn = transient ? transient.capVoltages
    : (opts.capacitorsOpen ? null : opts.capVoltages);
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

  // One part lookup for the whole solve. The election / merge / node-index
  // passes below each ran `parts.find` per terminal — O(parts × terminals)
  // scans repeated up to 50× by the NR loop on imported boards.
  /** @type {Map<string, Part>} */
  const partMap = new Map(parts.map(p => [p.id, p]));

  if (powerOff && testNodeB) {
    groundNetId = testNodeB;
  } else {
    for (const net of nets) {
      for (const t of net.terminals) {
        const part = partMap.get(t.part);
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
          const part = partMap.get(t.part);
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
    'npn', 'pnp', 'zener', 'inductor', 'transformer', 'nmos', 'pmos', 'opamp',
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
  // The merge is a SOLVER-LOCAL VIEW. It used to splice the caller's `nets`
  // array and push into the elected net's own terminals — the board's
  // netlist was permanently rewritten by the first solve, and any caller
  // holding the array saw its topology change under it. The caller's arrays
  // and net objects are never touched now; merged-away gnd net ids still
  // answer nodeVoltage as 0 via `mergedGndIds` at extraction.
  /** @type {Set<string>} */
  const mergedGndIds = new Set();
  if (groundNetId && !(powerOff && testNodeB)) {
    const isGndNet = (net) => net.id !== groundNetId && net.terminals.some((t) => {
      const p = partMap.get(t.part);
      return p && p.kind === 'gnd';
    });
    for (const net of nets) if (isGndNet(net)) mergedGndIds.add(net.id);
  }
  if (mergedGndIds.size) {
    const view = [];
    let mergedMain = null;
    for (const net of nets) {
      if (net.id === groundNetId) {
        mergedMain = { id: net.id, terminals: net.terminals.slice() };
        view.push(mergedMain);
      } else if (!mergedGndIds.has(net.id)) {
        view.push(net);
      }
    }
    for (const net of nets) {
      if (mergedGndIds.has(net.id)) mergedMain.terminals.push(...net.terminals);
    }
    nets = view;
  } else {
    // Fresh wrapper either way, so the terminal map below attaches to an
    // array only this solve can see — never to the caller's.
    nets = nets.slice();
  }

  // terminal → net id. `findNet` was a linear scan of all nets × all
  // terminals, called several times per element per stamp per NR
  // iteration — the dominant cost on imported boards before the O(n³)
  // solve even starts (ROADMAP E1.1; spec-updates/sparse-lu-factor-reuse.md).
  // Memoized ON THE ARRAY, not per call: the board hands the same nets
  // array to every solve until setNetlist builds a new one, so the map
  // is a pure function of the array's identity. Measured on the
  // perf-budget LED bench: ~19K → ~22K setPin/sec — the rebuild was
  // ~8% self time, real but not the bench's dominant cost.
  if (!nets[NETS_TERM_MAP]) nets[NETS_TERM_MAP] = buildTermMap(nets);

  /** @type {Map<string, number>} net id → node index */
  const nodeIndex = new Map();
  let nodeCount = 0;
  for (const net of nets) {
    if (net.id === groundNetId) continue;

    if (powerOff) {
      // Only include nets that have at least one passive element terminal
      const hasPassive = net.terminals.some(t => {
        const p = partMap.get(t.part);
        return p && passiveKinds.has(p.kind);
      });
      if (!hasPassive) continue;
    }

    nodeIndex.set(net.id, nodeCount++);
  }

  if (nodeCount === 0) {
    return { nodeVoltages: new Map(), branchCurrents: new Map() };
  }

  // SPICE NPN RB IS BETWEEN THE EXTERNAL BASE PIN AND THE INTRINSIC BASE.
  // It therefore needs one real MNA voltage, not a correction applied after
  // the solve.  Allocate that node only for an explicit positive RB; omitted
  // and zero RB retain the old matrix shape and arithmetic exactly.
  /** @type {Map<string, number>} part id → intrinsic base node index */
  const bjtBaseIndex = new Map();
  for (const part of parts) {
    const em = part.kind === 'npn' ? ebersMollParams(part) : null;
    if (!em || !(em.rb > 0)) continue;
    const key = `\u0000intrinsic-base:${part.id}`;
    bjtBaseIndex.set(part.id, nodeCount);
    nodeIndex.set(key, nodeCount++);
  }

  // Count voltage sources (VCC only, unless powerOff)
  let vsCount = 0;
  /** @type {Map<string, number>} part id → voltage source index in the extra rows */
  const vsIndex = new Map();
  const railOwner = new Map();   // vcc netId -> the part that owns its row
  /** Rails driven to two different voltages — a short, worth reporting. */
  const railConflicts = [];
  const capPairSeen = new Set();

  if (!powerOff) {
    for (const part of parts) {
      if (part.kind === 'vcc') {
        const vccNet = findNet(nets, part.id, 'vcc');
        // ONE constraint row per rail. A schematic draws one power symbol per
        // connection point, so a rail routinely carries several vcc parts;
        // giving each its own row makes two rows enforce V(net) = 5, the
        // current split between them indeterminate, and the matrix singular.
        // The solve then failed with EVERY node — the rail included — at 0 V
        // and converged:false, naming nothing. Deduped HERE rather than at
        // stamping time because an allocated row that never gets filled is
        // exactly as singular as a duplicated one.
        if (vccNet && nodeIndex.has(vccNet) && !railOwner.has(vccNet)) {
          railOwner.set(vccNet, part.id);
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
      // Controlled voltage source (spec-updates/controlled-sources.md)
      if (part.kind === 'vcvs') {
        const outpNet = findNet(nets, part.id, 'outp');
        const outnNet = findNet(nets, part.id, 'outn');
        // Ground is implicit and absent from nodeIndex. The symmetric stamp
        // below still needs its constraint row when EITHER output is live.
        if ((outpNet && nodeIndex.has(outpNet)) ||
            (outnNet && nodeIndex.has(outnNet))) {
          vsIndex.set(part.id, vsCount++);
        }
      }
      // Independent voltage source (may have current limit for CC mode)
      if (part.kind === 'vsource') {
        const posNet = findNet(nets, part.id, 'pos');
        const negNet = findNet(nets, part.id, 'neg');
        // Ground is implicit and therefore absent from nodeIndex. The source
        // still needs one MNA row when EITHER terminal is a live node; the
        // stamp below already handles an absent (ground) index on either side.
        if ((posNet && nodeIndex.has(posNet)) || (negNet && nodeIndex.has(negNet))) {
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
  // Sparse-by-default assembly: the stamps write into a coordinate map with
  // dense semantics; reset() keeps the slot pattern across NR iterations.
  const A = new CooMatrix(dim);
  const b = new Float64Array(dim);

  // ─── Stamp elements ─────────────────────────────────────────────────────

  // Diode/LED/transistor operating points for Newton–Raphson
  /** @type {Map<string, number>} part id → voltage across junction */
  const diodeVoltages = new Map();
  // Op-amp output region: 'linear' | 'high' | 'low' (rail saturation) |
  // 'ilim+' | 'ilim-' (output short-circuit current limit — see
  // spec-updates/opamp-output-limit.md).
  /** @type {Map<string, string>} */
  // Settled by the Newton loop below and RETURNED: the region an op-amp or
  // railed vcvs converged in is not private bookkeeping, it is a property of
  // the operating point. src/ac.js linearises about that point and cannot
  // tell a saturated or current-limited stage from a linear one without it —
  // it was reporting ideal small-signal gain for a stage welded to a rail
  // (spec-updates/ac-operating-region.md). Recomputing it there from the node
  // voltages would find the rails and miss the current limit entirely, since
  // whether iShort binds is a fact about the branch current.
  const opampRegions = new Map();
  // BJT operating regions: 'active' (Ic = beta*Ib VCCS) or 'saturated'
  // (Vce clamped near vceSat). Without this, a switching transistor's
  // collector gets driven arbitrarily negative — the audit measured
  // -420V on pc24 — because beta*Ib exceeded anything the load allows.
  const bjtRegions = new Map();
  /** Per-part Vce(sat), computed from the drive rather than held constant. */
  const bjtVceSat = new Map();
  // SECOND JUNCTION STATE, for the Ebers-Moll path only. `diodeVoltages` holds
  // Vbe (npn) / Veb (pnp); this holds Vbc (npn) / Vcb (pnp). Two junctions need
  // two Newton variables, and the saturated region is precisely where the
  // second one stops being a function of the first.
  /** @type {Map<string, number>} */
  const bjtVbc = new Map();
  // TRIODE NEEDS Vds AS WELL AS Vgs. The level-1 linear-region current is
  // `k*(2*Vov*Vds - Vds^2)`, quadratic in Vds, so one Newton variable is not
  // enough — the same shape as the BJT's second junction. `diodeVoltages`
  // holds Vgs (nmos) / Vsg (pmos); this holds Vds (nmos) / Vsd (pmos).
  /** @type {Map<string, number>} */
  const mosVds = new Map();
  // THE BODY EFFECT NEEDS THE SOURCE'S OWN POTENTIAL, not a difference between
  // two terminals — so it cannot be derived from vgs and vds and needs its own
  // state. Tracked only for a part whose bulk the deck tied to ground; with
  // bulk on source, Vsb is 0 and `mosVth` is identity.
  /** @type {Map<string, number>} */
  const mosVsb = new Map();
  // THE BULK-DRAIN JUNCTION'S OWN STATE. `mosVsb` already carries V(source);
  // the second bulk diode sits on the DRAIN and needs its own, for the same
  // reason: it is a potential, not a terminal difference. Both are tracked only
  // where the deck told us the bulk is at the reference.
  /** @type {Map<string, number>} */
  const mosVdb = new Map();
  const mosRegions = new Map();
  /** vccs iMax clamp state: 'linear' | 'clamp+' | 'clamp-' */
  const vccsClamps = new Map();
  for (const part of parts) {
    if (part.kind === 'led' || part.kind === 'diode' || part.kind === 'npn'
        || part.kind === 'pnp' || part.kind === 'zener'
        || part.kind === 'nmos' || part.kind === 'pmos') {
      diodeVoltages.set(part.id, 0); // initial guess
      if ((part.kind === 'npn' || part.kind === 'pnp') && ebersMollParams(part)) {
        bjtVbc.set(part.id, 0);
      }
      if (part.kind === 'nmos' || part.kind === 'pmos') {
        mosVds.set(part.id, 0);
        if (part.params?.bulkAtGround || findNet(nets, part.id, 'bulk') !== undefined) {
          mosVsb.set(part.id, 0);
          mosVdb.set(part.id, 0);
        }
      }
    }
    if (part.kind === 'opamp') opampRegions.set(part.id, 'linear');
    if (part.kind === 'vcvs' && (part.params?.railLow !== undefined
        || part.params?.railHigh !== undefined
        || outputCurrentLimit(part) > 0)) {
      opampRegions.set(part.id, 'linear'); // shares the op-amp rail/ilim FSM
    }
    if (part.kind === 'vccs' && part.params?.iMax > 0) {
      vccsClamps.set(part.id, 'linear');
    }
    if (part.kind === 'npn' || part.kind === 'pnp') bjtRegions.set(part.id, 'active');
    if (part.kind === 'nmos' || part.kind === 'pmos') mosRegions.set(part.id, 'saturation');
  }

  // Newton–Raphson iterations
  const NR_TOL = 1e-6;
  // Junction-voltage damping: an exponential nonlinearity can fling NR across
  // volts per iteration and oscillate forever; classic per-step limiting keeps
  // every update inside the model's trust region.
  const NR_MAX_STEP = 0.5;

  /**
   * THE ITERATION BUDGET IS A CONSEQUENCE OF THE STEP CLAMP, NOT A ROUND NUMBER.
   *
   * It was 50, and 50 is not enough for a circuit on wide rails. Junction
   * limiting moves each junction at most `NR_MAX_STEP` per iteration, so a node
   * that starts one rail away and must end at the other cannot arrive in fewer
   * than `span / NR_MAX_STEP` iterations however well conditioned it is. At
   * +/-15 V that is 60, and the loop gave up at 50.
   *
   * The failure was silent in the worst way: not an oscillation, but a STEADY
   * WALK. Instrumenting ADI2005 v3 row 526, a two-stage Miller-compensated
   * op-amp, the residual fell by exactly 0.5 V per iteration -- 2.67, 2.17,
   * 1.67, 1.17, 0.673, 0.173 -- and the budget ran out two iterations from the
   * answer. It read as "engine-non-convergence: bias point", which is the
   * reason a reader would then go looking for a model or a continuation defect.
   * Sixty of the 66 non-convergences in that 12,471-deck corpus were this one
   * topology on +/-15 V rails, and finer source stepping does nothing for it
   * (measured: two denser ladders, no change).
   *
   * So it is derived from the widest source pair the netlist actually contains,
   * with 50 kept as the floor so nothing narrow gets less than before, and a
   * margin for Newton's own convergence once the walk arrives. Circuits that do
   * not need the iterations still exit at `NR_TOL` and pay nothing.
   *
   * THE `+ 20` IS A FLOOR AND NOT A MEASUREMENT, said plainly: removing it
   * leaves exactly `span / NR_MAX_STEP` and the op-amp still converges, so no
   * case in the corpus requires it. It is there because the walk and Newton's
   * own convergence are two costs and only the first is bounded by the span --
   * a circuit that arrives on its last permitted iteration would still need a
   * few more to satisfy NR_TOL. `test/newton-budget-from-rail-span.test.mjs`
   * records that its mutation survives.
   */
  const sourceSpan = (() => {
    let lo = 0; let hi = 0;
    for (const part of parts) {
      for (const key of ['volts', 'emf', 'vcc']) {
        const v = Number(part.params?.[key]);
        if (!Number.isFinite(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
    }
    return hi - lo;
  })();
  const MAX_NR_ITER = Math.max(50, Math.ceil(sourceSpan / NR_MAX_STEP) + 20);

  let solution = new Float64Array(dim);
  let converged = false;

  // Device KCL-visibility: everything a registered device stamps — its
  // state.drives and every ctx primitive its model.stamp calls — is recorded
  // per part, overwritten each NR iteration so the surviving record matches
  // the linearization the final solution was solved against ("the extraction
  // must read the same element the solve stamped"). Extraction derives each
  // terminal's current from exactly these records, so ALL ~40 registered
  // models become KCL-visible at once instead of the per-model
  // branchCurrents hooks (which remain as overrides). Before this, a relay
  // coil carrying 25 mA read 0 A because no hook existed for it.
  /** @type {Map<string, Array<object>>} part id → stamped-companion records */
  const deviceStamps = new Map();

  // The Newton loop, callable per ladder rung. Knobs: `gmin` (GMIN
  // stepping) and `srcScale` (source stepping — every independent source,
  // pin drive, device drive, and rail scales together, so a 0.1 rung is
  // the same circuit at a tenth of the excitation). All nonlinear state
  // (junction voltages, region FSMs, CC clamps) lives in the enclosing
  // scope, so each rung seeds the next — the point of a continuation.
  const runNewton = (gmin, srcScale = 1, selectiveShunt = false) => {
  for (let iter = 0; iter < MAX_NR_ITER; iter++) {
    // Clear values; the assembled pattern survives for factor reuse.
    A.reset();
    b.fill(0);

    // A schematic conventionally draws ONE power symbol per connection point,
    // so a single rail routinely carries several `vcc` parts. Each used to get
    // its own voltage-source row, and two rows enforcing V(net) = 5 make the
    // matrix singular: the split of current between the two identical sources
    // is indeterminate. The solve then failed and EVERY node — the rail
    // included — read 0 V, with converged:false and nothing naming the cause.
    // Found by running 26 imported boards past lcapy: 25 failed, and the
    // minimal reproduction is two vcc symbols on one net.
    //
    // One constraint per rail. Parts on the same net asking for DIFFERENT
    // voltages are a real conflict (a 5 V symbol shorted to a 3.3 V one) and
    // are reported rather than silently resolved to whichever came first.
    const railStamped = new Map();          // netId -> volts already stamped
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
          // Recorded as a companion for the same reason a registered device's
          // stamps are: an exporter that has no card for this kind would
          // otherwise drop it, and a CLOSED button dropped from a deck is an
          // open circuit — the opposite of what the engine solved.
          deviceStamps.set(part.id, [{ kind: 'cond', tA: 'a', tB: 'b',
            g: stampButton(A, b, part, nets, nodeIndex, groundNetId, controls) }]);
          break;

        case 'vcc':
          if (!powerOff) {
            // params.volts makes the rail per-part adjustable (a 3.3V
            // rail beside the 5V one); the board default stays the
            // fallback. board.js's seed path already honored this —
            // the solver must agree or the seed lies.
            const railVolts = (Number.isFinite(part.params?.volts) ? part.params.volts : vcc) * srcScale;
            const railNet = findNet(nets, part.id, 'vcc');
            if (vsIndex.has(part.id)) {
              railStamped.set(railNet, railVolts);
              stampVoltageSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, railVolts);
            } else if (railNet && railStamped.has(railNet)
                       && railStamped.get(railNet) !== railVolts) {
              // Two symbols on one net asking for different voltages is a real
              // short between rails, not a duplicate. Say so instead of
              // silently keeping whichever was stamped first.
              railConflicts.push(`${railNet}: ${railStamped.get(railNet)} V and ${railVolts} V`);
            }
          }
          break;

        case 'mcu':
          if (!powerOff) {
            stampMcuPins(A, b, part, nets, nodeIndex, groundNetId, pinSources, srcScale);
          }
          break;

        // Chip-qualified drives (opts.qualifiedSources) are stamped after
        // this loop — they attach to parts of ANY kind, including ones the
        // solver has no model for (a machine's w65c22).

        case 'buzzer':
          // See the button above. A dropped buzzer left its node at the full
          // 5 V rail in the deck against the engine's 4.0 — 5 x 100/125, the
          // buzzer being a 100 Ohm load — on 53 corpus circuits.
          deviceStamps.set(part.id, [{ kind: 'cond', tA: 'a', tB: 'b',
            g: stampBuzzerResistance(A, b, part, nets, nodeIndex, groundNetId) }]);
          break;

        case 'ldr':
        case 'ntc':
          stampVariableResistor(A, b, part, nets, nodeIndex, groundNetId, controls);
          break;

        case 'inductor': {
          if (transient) {
            // Companion models (spec-updates/adaptive-transient.md):
            //   BE:   i(t+h) = i(t) + (h/L)·v(t+h)
            //         → G = h/L, Norton I = i(t)
            //   trap: i(t+h) = i(t) + (h/2L)·(v(t+h) + v(t))
            //         → G = h/2L, Norton I = i(t) + G·v(t)
            const L = /** @type {number} */ (part.params.henrys ?? part.params.henries ?? 0.001);
            const h = Math.max(transient.dtSec, 1e-15);
            const iPrev = transient.inductorCurrents.get(part.id) ?? 0;
            const trap = transient.method === 'trap';
            const g = trap ? h / (2 * Math.max(L, 1e-12)) : h / Math.max(L, 1e-12);
            const vPrev = trap ? (transient.inductorVoltages?.get(part.id) ?? 0) : 0;
            const iNorton = iPrev + (trap ? g * vPrev : 0);
            const netA = findNet(nets, part.id, 'a');
            const netB = findNet(nets, part.id, 'b');
            stampTwoTerminal(A, netA, netB, g, nodeIndex);
            const idxA = netA ? nodeIndex.get(netA) : undefined;
            const idxB = netB ? nodeIndex.get(netB) : undefined;
            if (idxA !== undefined) b[idxA] -= iNorton; // i flows a→b
            if (idxB !== undefined) b[idxB] += iNorton;
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

        case 'transformer': {
          // Coupled pair (spec-updates/coupled-inductors.md): with
          // Γ = L⁻¹, BE gives i(t+h) = i(t) + h·Γ·v(t+h) and trap
          // i(t+h) = i(t) + (h/2)·Γ·(v(t+h)+v(t)) — a full 2×2
          // conductance whose off-diagonal terms ARE the mutual
          // coupling. State rides the inductor maps as <id>:p / <id>:s.
          const netP1 = findNet(nets, part.id, 'p1');
          const netP2 = findNet(nets, part.id, 'p2');
          const netS1 = findNet(nets, part.id, 's1');
          const netS2 = findNet(nets, part.id, 's2');
          if (transient) {
            const { g11, g12, g22 } = transformerGamma(part);
            const h = Math.max(transient.dtSec, 1e-15);
            const trap = transient.method === 'trap';
            const sc = trap ? h / 2 : h;
            const iP = transient.inductorCurrents.get(part.id + ':p') ?? 0;
            const iS = transient.inductorCurrents.get(part.id + ':s') ?? 0;
            const vpP = trap ? (transient.inductorVoltages?.get(part.id + ':p') ?? 0) : 0;
            const vpS = trap ? (transient.inductorVoltages?.get(part.id + ':s') ?? 0) : 0;
            const inP = iP + (trap ? sc * (g11 * vpP + g12 * vpS) : 0);
            const inS = iS + (trap ? sc * (g12 * vpP + g22 * vpS) : 0);
            stampPortCoupling(A, netP1, netP2, netP1, netP2, sc * g11, nodeIndex);
            stampPortCoupling(A, netP1, netP2, netS1, netS2, sc * g12, nodeIndex);
            stampPortCoupling(A, netS1, netS2, netP1, netP2, sc * g12, nodeIndex);
            stampPortCoupling(A, netS1, netS2, netS1, netS2, sc * g22, nodeIndex);
            const ip1 = netP1 ? nodeIndex.get(netP1) : undefined;
            const ip2 = netP2 ? nodeIndex.get(netP2) : undefined;
            const is1 = netS1 ? nodeIndex.get(netS1) : undefined;
            const is2 = netS2 ? nodeIndex.get(netS2) : undefined;
            if (ip1 !== undefined) b[ip1] -= inP; // i flows p1→p2 (dot at p1)
            if (ip2 !== undefined) b[ip2] += inP;
            if (is1 !== undefined) b[is1] -= inS;
            if (is2 !== undefined) b[is2] += inS;
          } else {
            // DC: each winding the same 1 mΩ short a lone inductor is,
            // and NO coupling — di/dt = 0 induces nothing.
            stampTwoTerminal(A, netP1, netP2, 1 / 0.001, nodeIndex);
            stampTwoTerminal(A, netS1, netS2, 1 / 0.001, nodeIndex);
          }
          break;
        }

        case 'capacitor': {
          if (transient) {
            // Companion models (spec-updates/adaptive-transient.md):
            //   BE:   i = (C/h)·(v(t+h) − v(t))
            //         → G = C/h, Norton I = G·v(t)
            //   trap: i = (2C/h)·(v(t+h) − v(t)) − i(t)
            //         → G = 2C/h, Norton I = G·v(t) + i(t)
            const C = /** @type {number} */ (part.params.farads ?? 0.0001);
            const h = Math.max(transient.dtSec, 1e-15);
            const trap = transient.method === 'trap';
            const g = (trap ? 2 * C : C) / h;
            const vPrev = transient.capVoltages.get(part.id) ?? 0;
            const iPrev = trap ? (transient.capCurrents?.get(part.id) ?? 0) : 0;
            const iNorton = g * vPrev + iPrev;
            const netA = findNet(nets, part.id, 'a');
            const netB = findNet(nets, part.id, 'b');
            stampTwoTerminal(A, netA, netB, g, nodeIndex);
            const idxA = netA ? nodeIndex.get(netA) : undefined;
            const idxB = netB ? nodeIndex.get(netB) : undefined;
            if (idxA !== undefined) b[idxA] += iNorton;
            if (idxB !== undefined) b[idxB] -= iNorton;
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
          stampNPN(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages,
            bjtRegions.get(part.id), bjtVceSat.get(part.id), bjtVbc, bjtBaseIndex);
          break;

        case 'pnp':
          stampPNP(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, bjtRegions.get(part.id), bjtVceSat.get(part.id), bjtVbc);
          break;

        case 'nmos':
          stampNMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, mosRegions.get(part.id), mosVds, mosVsb, mosVdb);
          break;

        case 'pmos':
          stampPMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, mosRegions.get(part.id), mosVds, mosVsb, mosVdb);
          break;

        case 'opamp':
          stampOpamp(A, b, part, nets, nodeIndex, groundNetId, vsIndex, opampRegions, vcc, srcScale);
          break;

        case 'vcvs':
          stampVCVS(A, b, part, nets, nodeIndex, vsIndex, opampRegions, srcScale);
          break;

        case 'vccs':
          // The iMax clamp is a DYNAMIC limit (slew): at DC it has no
          // meaning and makes the macromodel's operating point a clamp±
          // ping-pong through the rails — so it engages only in transient.
          stampVCCS(A, b, part, nets, nodeIndex, transient ? vccsClamps : null);
          break;

        case 'vsource':
          stampIndependentVSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc, tSeconds, controls, srcScale, dcSources);
          break;

        case 'isource':
          stampCurrentSource(A, b, part, nets, nodeIndex, groundNetId, tSeconds, srcScale, dcSources);
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
          // 74HC595: data/clock/latch are CMOS inputs, and an ideal CMOS input
          // is what this builtin stamps — nothing. Three stampTwoTerminal
          // calls used to sit here passing `undefined` for the far net, which
          // the air-leg guard below declines, so they never loaded the pins
          // they claimed to (spec-updates/ideal-high-z-inputs.md). Deleting
          // them makes this case agree with the registered `74hc595` model.
          // Outputs are push-pull but modeled separately as LEDs.
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
            let state = (opts.deviceStates && opts.deviceStates.get(part.id)) || { drives: {} };
            // Ownership: a chip-qualified pin drive (a machine emulating
            // this chip at bus level) outranks the device model's own
            // electrical drive on that terminal. Without this, a Z80's
            // OUT-latch Q pins fought the '374 model (whose clk/d nets
            // are dead on a machine bench, so it drove its power-on 0)
            // and every lit LED sat at a divider instead of ON.
            const qual = opts.qualifiedSources && opts.qualifiedSources.get(part.id);
            if (qual && state.drives) {
              const drives = { ...state.drives };
              let changed = false;
              for (const term of qual.keys()) {
                if (term in drives) { delete drives[term]; changed = true; }
              }
              if (changed) state = { ...state, drives };
            }
            // AN EXPLICIT AUTOMATIC BOARD-SUPPLY FALLBACK YIELDS TO AN IDEAL
            // RAIL ON THE SAME NET.
            //
            // A `vcc` part is a voltage-source ROW: it pins its net exactly.
            // A device Thevenin in parallel with it cannot move that node, but
            // it CAN carry a physically real conflict current. Therefore the
            // default is to preserve every drive. Suppression requires the
            // device model to name a terminal as an automatic supply fallback.
            //
            // Found by the ngspice sweep. A Pico with VBUS on a 3.3 V bench
            // rail reported 17 A on that pin against ngspice's 0 (the exporter
            // writes no card for the MCU, so the deck had no such source), and
            // a Pico's VSYS — a 4.7 V drive — reported -3 A into a 5 V rail.
            // 595 of the 2,163 corpus circuits wire a board supply pin to a
            // `vcc` part, and in every one of those the shared supply IS a
            // `vcc` part, so this is the whole measured population.
            //
            // This is the gallery's development-board abstraction, not a
            // Schottky-OR physics claim. Physical batteries, solar cells,
            // regulators and ground/GPIO drives do not opt in and retain the
            // source or short current an ammeter would read.
            //
            // Limited to `vcc` rails deliberately. An op-amp output is also a
            // voltage-source row, but it is rail-clamped and nonlinear, so
            // "cannot move that node" is not true of it in the same way; no
            // corpus circuit needed it.
            if (railOwner.size && state.drives) {
              const fallbackNames = model.automaticSupplyFallbackTerminals;
              const kept = {};
              let dropped = false;
              for (const [term, drive] of Object.entries(state.drives)) {
                const fallback = fallbackNames?.has(term) === true;
                const net = drive && fallback ? findNet(nets, part.id, term) : null;
                if (net && railOwner.has(net) && railOwner.get(net) !== part.id) {
                  dropped = true;
                  continue;
                }
                kept[term] = drive;
              }
              if (dropped) state = { ...state, drives: kept };
            }
            const rec = [];
            deviceStamps.set(part.id, rec);
            stampDevice(A, b, part, nets, nodeIndex, model, state, controls, vcc, tSeconds,
              transient ? transient.dtSec : undefined, srcScale, groundNetId, rec);
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
          b[nodeIdx] += (source.vTh * srcScale) / source.rTh;
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

    // GMIN, AND WHERE NGSPICE ACTUALLY PUTS IT.
    //
    // ngspice puts GMIN across pn JUNCTIONS and nothing on a node diagonal.
    // Proven at 1 TOhm: `R1 a b 1T` with no junction gives exactly 5.000000 V,
    // and with one reverse diode 2.495000 V = (5e-12 - 1e-14)/2e-12.
    //
    // A blanket node shunt is therefore a conductance to the reference that the
    // reference does not have, and on a high-impedance net it is not a rounding
    // term -- it is the answer. Measured against ngspice on the same deck:
    //
    //   1T divider, far node floating   engine 2.500000 V   ngspice 5.000000 V
    //   BJT base behind a coupling cap  engine 0.009954 V   ngspice 0.276875 V
    //
    // The first is 1e-12 S of shunt against 1e-12 S of resistor: a perfect
    // 50/50 divider out of nothing. Lowering GMIN globally was measured and is
    // WORSE (1,612 -> 1,559 agreeing ADI decks, convergence failures doubled),
    // because the shunt is also what keeps a floating net solvable.
    //
    // So it is kept where it earns its keep and removed where it lies. A node
    // whose diagonal is already non-zero has a real conductance on it -- a
    // resistor, or a junction whose own `gj` floor is 1e-12, which is ngspice's
    // junction GMIN by another name -- and needs no help. A node whose diagonal
    // is zero is attached to nothing the DC solve can see (a capacitor is open
    // at an operating point), and that is the singular matrix this term exists
    // to prevent.
    //
    // Selective mode runs as a REFINEMENT, after a full-shunt solve has
    // converged and seeded the junction state, because the blanket shunt is
    // also the continuation that gets a hard operating point to converge at
    // all. If the refinement does not converge, the full-shunt answer stands.
    for (let i = 0; i < nodeCount; i++) {
      // Selective: only a node with NOTHING else on it keeps the shunt. The
      // diagonal here excludes `gmin` -- every stamp has run and this loop is
      // what adds it -- so a non-zero diagonal means a real conductance is
      // already holding the node.
      //
      // A ZERO DIAGONAL IS NOT THE SAME AS AN UNDETERMINED ROW, and reading it
      // that way put a shunt on nodes that never needed one. A voltage source
      // contributes NO conductance to its terminals' diagonals -- its branch
      // current is a separate unknown -- so a node touched only by a source
      // looked bare while its KCL row was already complete: `sum of currents =
      // 0` becomes `i_branch = 0`, and the branch row supplies the voltage.
      //
      // The shunt there is not a neutral aid but a current source loading a
      // floating subnet. Measured on ADI2005 v2 deck 1090, one off NMOS and a
      // 5 V source whose far node touches nothing else:
      //
      //     node 3's shunt draws 4.841 pA, which flows through V1 into node 2
      //     ours    V(2) -0.159004  V(3) 4.840996
      //     ngspice V(2)  0.000000  V(3) 5.000000
      //
      // and 159 mV is the whole of that deck's disagreement. ngspice has no node
      // shunt and solves the subnet exactly, because it was never singular.
      //
      // Asked of the MATRIX rather than of a parallel bookkeeping of which parts
      // own a branch: the question is whether THIS ROW already has an unknown
      // that determines it, and the row is where that is written down. If the
      // resulting system IS singular after all -- an isolated source between two
      // otherwise bare nodes can slide -- `solveAssembled` throws, the
      // refinement is rejected, and the full-shunt answer stands, which is the
      // fallback this refinement has always had.
      if (selectiveShunt) {
        if (A.get(i, i) !== 0) continue;
        let determinedByBranch = false;
        for (let j = nodeCount; j < dim; j++) {
          if (A.get(i, j) !== 0) { determinedByBranch = true; break; }
        }
        if (determinedByBranch) continue;
      }
      A.add(i, i, gmin);
    }

    // Solve
    const bcopy = new Float64Array(b);
    try {
      solution = solveAssembled(A, bcopy);
    } catch {
      // Singular matrix — bail
      return false;
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
        const idxB = bjtBaseIndex.get(part.id) ?? (netB ? nodeIndex.get(netB) : undefined);
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

      // TRIODE'S SECOND VARIABLE. Tracked for every MOSFET, so a device that
      // enters the linear region mid-solve already has a state to linearise
      // about rather than starting from zero on the iteration it switches.
      if (mosVsb.has(part.id)) {
        // Source-to-bulk bias. The older grounded-bulk case is the same
        // expression with vB=0; an explicit fourth terminal supplies vB from
        // the actual matrix node, so its junction current returns through the
        // real rail rather than through an invented fixed potential.
        const netS4 = findNet(nets, part.id, 'source');
        const netB4 = findNet(nets, part.id, 'bulk');
        const iS4 = netS4 ? nodeIndex.get(netS4) : undefined;
        const iB4 = netB4 ? nodeIndex.get(netB4) : undefined;
        const vS4 = iS4 !== undefined ? solution[iS4] : 0;
        const vB4 = iB4 !== undefined ? solution[iB4] : 0;
        const vNew4 = part.kind === 'nmos' ? (vS4 - vB4) : (vB4 - vS4);
        const vOld4 = mosVsb.get(part.id) ?? 0;
        maxDelta = Math.max(maxDelta, Math.abs(vNew4 - vOld4));
        mosVsb.set(part.id,
          vOld4 + Math.max(-NR_MAX_STEP, Math.min(NR_MAX_STEP, vNew4 - vOld4)));
      }

      // V(drain), same convention, for the bulk-drain junction. A forward-biased
      // bulk diode is an exponential, so it takes the same step limiting the
      // other junctions get; without it a first iteration that puts the drain a
      // volt below a grounded bulk asks for e^40.
      if (mosVdb.has(part.id)) {
        const netD5 = findNet(nets, part.id, 'drain');
        const netB5 = findNet(nets, part.id, 'bulk');
        const iD5 = netD5 ? nodeIndex.get(netD5) : undefined;
        const iB5 = netB5 ? nodeIndex.get(netB5) : undefined;
        const vD5 = iD5 !== undefined ? solution[iD5] : 0;
        const vB5 = iB5 !== undefined ? solution[iB5] : 0;
        const vNew5 = part.kind === 'nmos' ? (vD5 - vB5) : (vB5 - vD5);
        const vOld5 = mosVdb.get(part.id) ?? 0;
        maxDelta = Math.max(maxDelta, Math.abs(vNew5 - vOld5));
        mosVdb.set(part.id,
          vOld5 + Math.max(-NR_MAX_STEP, Math.min(NR_MAX_STEP, vNew5 - vOld5)));
      }

      if (mosVds.has(part.id)) {
        const netD3 = findNet(nets, part.id, 'drain');
        const netS3 = findNet(nets, part.id, 'source');
        const iD3 = netD3 ? nodeIndex.get(netD3) : undefined;
        const iS3 = netS3 ? nodeIndex.get(netS3) : undefined;
        const vD3 = iD3 !== undefined ? solution[iD3] : 0;
        const vS3 = iS3 !== undefined ? solution[iS3] : 0;
        const vNew3 = part.kind === 'nmos' ? (vD3 - vS3) : (vS3 - vD3);
        const vOld3 = mosVds.get(part.id) ?? 0;
        maxDelta = Math.max(maxDelta, Math.abs(vNew3 - vOld3));
        mosVds.set(part.id,
          vOld3 + Math.max(-NR_MAX_STEP, Math.min(NR_MAX_STEP, vNew3 - vOld3)));
      }

      // SECOND JUNCTION, EBERS-MOLL ONLY. Vbc (npn) / Vcb (pnp) is an
      // independent Newton variable — in saturation it is precisely the one
      // that stops being a function of Vbe — and it gets the same logarithmic
      // pull-back, because two exponentials in series-opposition are what a
      // flat clamp oscillates on.
      if (bjtVbc.has(part.id)) {
        const emp = ebersMollParams(part);
        const netC2 = findNet(nets, part.id, 'collector');
        const netB2 = findNet(nets, part.id, 'base');
        const idxC2 = netC2 ? nodeIndex.get(netC2) : undefined;
        const idxB2 = bjtBaseIndex.get(part.id) ?? (netB2 ? nodeIndex.get(netB2) : undefined);
        const vC2 = idxC2 !== undefined ? solution[idxC2] : 0;
        const vB2 = idxB2 !== undefined ? solution[idxB2] : 0;
        const vNew2 = part.kind === 'npn' ? (vB2 - vC2) : (vC2 - vB2);
        const vOld2 = bjtVbc.get(part.id) ?? 0;
        maxDelta = Math.max(maxDelta, Math.abs(vNew2 - vOld2));
        bjtVbc.set(part.id, emp
          ? pnjlim(vNew2, vOld2, emp.nVt, junctionVcrit(emp.is, emp.nVt))
          : vOld2 + Math.max(-NR_MAX_STEP, Math.min(NR_MAX_STEP, vNew2 - vOld2)));
      }

      const vOld = diodeVoltages.get(part.id) ?? 0;

      // Limited update. Shockley diodes/LEDs get pnjlim — the logarithmic
      // pull-back that settles exponential junctions (a flat clamp
      // oscillates on two junctions in series-opposition). Everything else
      // keeps the flat NR_MAX_STEP clamp. The RAW delta still drives the
      // convergence check, so a limited step cannot fake convergence.
      let rawDelta = vNew - vOld;
      let vLimited;
      // A BJT on the Ebers-Moll path is an exponential junction like any
      // other and needs the same limiter; the flat NR_MAX_STEP clamp was
      // written for the knee, which has no exponential to overshoot.
      const emLim = bjtVbc.has(part.id) ? ebersMollParams(part) : null;
      const explicitShockleyZener = part.kind === 'zener'
        && junctionModelOf(part, undefined) === 'shockley' && vNew >= 0;
      const lim = emLim
        ? { p: { nVt: emLim.nVt, is: emLim.is, rs: 0 }, nVt: emLim.nVt,
            vcrit: junctionVcrit(emLim.is, emLim.nVt), noRs: true }
        : (part.kind === 'led' || part.kind === 'diode' || explicitShockleyZener)
          ? junctionLimitParams(part,
              effVf(/** @type {number} */ (part.params.vf ?? (part.kind === 'led' ? 2.0 : 0.7))))
          : null;
      if (lim) {
        // The solve gives TOTAL branch volts; the NR state is the
        // JUNCTION voltage behind rs — recover it, limit it, and drive
        // convergence from the junction-space delta (total-minus-junction
        // would carry the i·rs drop as phantom non-convergence).
        const vJnew = shockleyJunctionFromTotal(vNew, vOld, lim.p);
        rawDelta = vJnew - vOld;
        vLimited = pnjlim(vJnew, vOld, lim.nVt, lim.vcrit);
      } else if (part.kind === 'nmos' || part.kind === 'pmos') {
        // The stored variable is vGS (nmos) / vSG (pmos), so the effective
        // threshold is |vth| in both senses.
        const vth = Math.abs(/** @type {number} */ (
          part.params.vth ?? (part.kind === 'nmos' ? 2.0 : -2.0)));
        vLimited = fetlim(vNew, vOld, vth);
      } else {
        vLimited = vOld + Math.max(-NR_MAX_STEP, Math.min(NR_MAX_STEP, rawDelta));
      }
      maxDelta = Math.max(maxDelta, Math.abs(rawDelta));
      diodeVoltages.set(part.id, vLimited);
    }

    // Op-amp / railed-vcvs region transitions: linear ↔ saturated at a
    // supply rail. The vcvs shares the FSM (controlled-sources.md); one
    // that declared no rails never enters opampRegions and skips here.
    let regionChanged = false;
    for (const part of parts) {
      if ((part.kind !== 'opamp' && part.kind !== 'vcvs')
          || !vsIndex.has(part.id) || !opampRegions.has(part.id)) continue;
      const gain = /** @type {number} */ (part.params.gain ?? (part.kind === 'vcvs' ? 1 : 1e6));
      const railLow = /** @type {number} */ (part.params.railLow ?? 0);
      const railHigh = /** @type {number} */ (part.params.railHigh ?? vcc);
      const netP = findNet(nets, part.id, 'inp');
      const netN = findNet(nets, part.id, 'inn');
      const idxP = netP ? nodeIndex.get(netP) : undefined;
      const idxN = netN ? nodeIndex.get(netN) : undefined;
      const vP = idxP !== undefined ? solution[idxP] : (netP === groundNetId ? 0 : 0);
      const vN = idxN !== undefined ? solution[idxN] : (netN === groundNetId ? 0 : 0);
      const vIdeal = gain * (vP - vN);
      // The output the row constrains: one node for an op-amp, the
      // difference of two for a vcvs (which is what its row holds).
      const nodeV = (terminal) => {
        const n = findNet(nets, part.id, terminal);
        const i = n ? nodeIndex.get(n) : undefined;
        return i !== undefined ? solution[i] : 0;
      };
      // Rails scale with source stepping — a full-height rail against
      // tenth-height sources would flip regions against the wrong bound.
      const rHi = railHigh * srcScale;
      const rLo = railLow * srcScale;
      const region = opampRegions.get(part.id);
      let next = region;
      if (region === 'linear') {
        if (vIdeal > rHi) next = 'high';
        else if (vIdeal < rLo) next = 'low';
      } else if (region === 'high') {
        if (vIdeal < rHi) next = 'linear';
      } else if (region === 'low') {
        if (vIdeal > rLo) next = 'linear';
      }
      // Output short-circuit current limit (spec-updates/opamp-output-limit.md).
      // The branch variable is positive INTO the output pin, so i > 0 is the
      // part SINKING and i < 0 is it SOURCING. The limit scales with source
      // stepping for the same reason the rails do: in a linear network every
      // current scales with the sources, and a full-height limit against
      // tenth-height sources would make the continuation cross regions that
      // the full-height solve never visits.
      const iMax = outputCurrentLimit(part) * srcScale;
      if (iMax > 0) {
        // The commanded output, rails included — what the part is TRYING to
        // hold. In limit it cannot, and the sign of the miss says whether the
        // limit still binds.
        const vTarget = Math.min(rHi, Math.max(rLo, vIdeal));
        const vOut = part.kind === 'opamp'
          ? nodeV('out') : nodeV('outp') - nodeV('outn');
        const iBranch = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
        if (next === region && (region === 'linear' || region === 'high' || region === 'low')) {
          // Enter only from a region the rail FSM left alone this pass, so
          // one iteration never changes two things about the same part.
          if (iBranch > iMax) next = 'ilim+';
          else if (iBranch < -iMax) next = 'ilim-';
        } else if (region === 'ilim+') {
          // Sinking flat out and STILL not down to target: stay. It leaves
          // the moment the output is at or below what it is aiming for.
          if (vOut <= vTarget) next = 'linear';
        } else if (region === 'ilim-') {
          if (vOut >= vTarget) next = 'linear';
        }
      }
      if (next !== region) {
        opampRegions.set(part.id, next);
        regionChanged = true;
      }
    }

    // BJT region transitions: active ↔ saturated.
    for (const part of parts) {
      if (part.kind !== 'npn' && part.kind !== 'pnp') continue;
      // Ebers-Moll produces its own saturation, so it takes no region and no
      // clamp. Running this FSM alongside it would be two answers to one
      // question, and the clamp — a stiff 10 S conductance — would win.
      if (bjtVbc.has(part.id)) continue;
      const beta = /** @type {number} */ (part.params.beta ?? 100);
      const vbe = effVf(/** @type {number} */ (part.params.vbe ?? 0.7));
      const vceSat = /** @type {number} */ (part.params.vceSat ?? bjtVceSat.get(part.id) ?? 0.2);
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
        if (vJon > vbe - 0.05 && vOut < vceSat) {
          next = 'saturated';
          // SEED THE ESTIMATE ON ENTRY, not only on the pass after. The store
          // below lives in the already-saturated branch, so a device that
          // entered saturation on the final Newton iteration never got one and
          // kept the constant — visible as one row of a vceSat sweep stuck at
          // 0.200480 while its six neighbours agreed with ngspice to 1e-4.
          if (part.params?.vceSat === undefined) {
            const rdEntry = 10, gSEntry = 10;
            const iBEntry = pwlKneeCurrent(vJon, vbe, rdEntry);
            const iCEntry = Math.max(0, gSEntry * (vOut - vceSat));
            const betaREntry = /** @type {number} */ (part.params?.betaR ?? 1);
            bjtVceSat.set(part.id, ebersMollVceSat(iCEntry, iBEntry, beta, betaREntry, vceSat));
          }
        }
      } else {
        // Leave saturation when base drive no longer sustains it:
        // the base junction has fallen out of conduction, or the
        // clamp current exceeds beta*Ib (with margin against
        // flip-flopping; the outer loop re-iterates on change).
        // iB through the SAME C1 knee the stamp uses — the old hard-knee
        // read ZERO for an in-band vbe that genuinely carries current, so
        // the region entered and left every iteration (collector stuck at
        // 1.8 V on the ngspice NPN-switch golden, expected 0.07 V).
        const vJ = diodeVoltages.get(part.id) ?? 0; // vBE (npn) / vEB (pnp)
        const rd = 10;
        const iB = pwlKneeCurrent(vJ, vbe, rd);
        const gS = 10;
        const iC = Math.max(0, gS * (vOut - vceSat));
        // Vce(sat) FROM THE DRIVE, not a constant. iB and iC are already here
        // for the leave test, and they are exactly what Ebers-Moll needs. A
        // fixed point inside Newton: Vce(sat) depends only logarithmically on
        // the ratio, so it settles in a couple of iterations.
        if (part.params?.vceSat === undefined) {
          const betaR = /** @type {number} */ (part.params?.betaR ?? 1);
          bjtVceSat.set(part.id, ebersMollVceSat(iC, iB, beta, betaR, vceSat));
        }
        if (vJ < vbe - 0.15 || beta * iB < iC * 0.95) next = 'active';
      }
      if (next !== region) {
        bjtRegions.set(part.id, next);
        regionChanged = true;
      }
    }

    // MOSFET region transitions: saturation ↔ triode at the physical
    // Level-1 boundary. The two laws now meet in BOTH value and first
    // derivative at Vds=Vov (`mosTriode`), so the old 0.95/1.05 hysteresis is
    // no longer numerical protection: inside that band it selects a different
    // physical equation. Keep the state only to make a branch change visible
    // to the convergence loop; choose its value from the exact boundary.
    for (const part of parts) {
      if (part.kind !== 'nmos' && part.kind !== 'pmos') continue;
      // The SAME threshold the stamp used, body effect included — a region
      // decision taken against VTO while the stamp conducts at a shifted
      // threshold is the vceSat split one level down.
      const vth = mosVth(
        { ...part.params, vth: part.params.vth ?? (part.kind === 'nmos' ? 2.0 : -2.0),
          bulkExplicit: findNet(nets, part.id, 'bulk') !== undefined },
        mosVsb.get(part.id) ?? 0);
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
      if (vov <= 0) next = 'saturation'; // cutoff path owns it; reset for clean re-entry
      else next = vds < vov ? 'triode' : 'saturation';
      if (next !== region) {
        mosRegions.set(part.id, next);
        regionChanged = true;
      }
    }

    // vccs iMax clamp transitions (the op-amp macromodel's slew limit) —
    // transient only; see the stamp-site note.
    for (const part of parts) {
      if (!transient || !vccsClamps.has(part.id)) continue;
      const gm = /** @type {number} */ (part.params.gm ?? 1e-3);
      const iMax = /** @type {number} */ (part.params.iMax);
      const netP = findNet(nets, part.id, 'inp');
      const netN = findNet(nets, part.id, 'inn');
      const iP = netP ? nodeIndex.get(netP) : undefined;
      const iN = netN ? nodeIndex.get(netN) : undefined;
      const vin = (iP !== undefined ? solution[iP] : 0)
        - (iN !== undefined ? solution[iN] : 0);
      const iLin = gm * vin;
      const region = vccsClamps.get(part.id);
      let next = region;
      if (region === 'linear') {
        if (iLin > iMax) next = 'clamp+';
        else if (iLin < -iMax) next = 'clamp-';
      } else if (region === 'clamp+') {
        if (iLin < iMax * 0.99) next = 'linear';
      } else if (iLin > -iMax * 0.99) {
        next = 'linear';
      }
      if (next !== region) {
        vccsClamps.set(part.id, next);
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
      return true;
    }
  }
  return false;
  };

  converged = runNewton(GMIN);

  // E1.4 fallback ladder: GMIN stepping. A heavily inflated gmin makes any
  // operating point easy; each rung's solution seeds the next as gmin
  // ratchets back down to the real value. Operating-point/instantaneous
  // solves only — inflating gmin under a transient step's companion
  // history would quietly change the physics of that step.
  // (Source stepping is the spec's rung (b) and is NOT implemented yet —
  // stated in spec-updates/shockley-junction-limiting.md.)
  if (!converged && !transient) {
    let laddered = true;
    for (let k = 9; k >= 0; k--) {
      if (!runNewton(GMIN * Math.pow(10, k))) { laddered = false; break; }
    }
    converged = laddered;
  }

  // Rung (b): source stepping. Every source ramps together from a tenth of
  // its value — at low excitation any operating point is easy, and each
  // rung's solution seeds the next along a continuous branch. This is what
  // settles bistables (a cross-coupled latch defeats plain NR AND gmin:
  // its trouble is the region FSMs flip-flopping at full drive, not a
  // floating node).
  if (!converged && !transient) {
    let laddered = true;
    for (const s of [0.1, 0.2, 0.4, 0.6, 0.8, 1.0]) {
      if (!runNewton(GMIN, s)) { laddered = false; break; }
    }
    converged = laddered;
  }

  // THE REFINEMENT. Everything above ran with the blanket node shunt, because
  // that shunt is the continuation that makes a hard operating point converge.
  // Now that the junction state is seeded by a converged solve, the same
  // Newton runs once more with the shunt kept ONLY on nodes that have nothing
  // else on them -- which is where ngspice puts it. See the long note at the
  // shunt itself for the two measurements this exists to fix.
  //
  // IT IS A REFINEMENT AND NOT A REPLACEMENT. If it does not converge, the
  // full-shunt answer stands: a converged solve with a small wrong term beats
  // an iterate with no term, and a caller cannot tell an iterate from an answer.
  // `solution` and the junction state are only overwritten on success, so a
  // failed refinement leaves the accepted answer exactly as it was.
  // THE REFINEMENT: RE-CONVERGE WITHOUT THE TERM THAT IS NOT PHYSICAL.
  //
  // Everything above ran with the blanket node shunt, because that shunt is the
  // continuation that gets a hard operating point to converge. The accepted
  // answer therefore contains a conductance to the reference that ngspice does
  // not have -- worth 2.5 V on a 1 TOhm divider. See JUNCTION_GMIN.
  //
  // So Newton runs once more with the shunt kept ONLY on nodes that have
  // nothing else on them -- and only where a cheap first step has proved that
  // it matters.
  //
  //  - A single LINEAR re-solve cannot finish the job on its own. It is exact
  //    for a linear network and one step for an exponential, so where the shunt
  //    was doing real work it falls short: a diode-connected MOSFET whose
  //    gate-drain node hangs on its bulk junction reached 4.867521 V against
  //    ngspice's 4.999380 V, and a two-open-switch interlock was 864 mV out.
  //    Looping the re-solve is worse still (4.840996) because `runNewton`
  //    re-adds the shunt its ladders rely on.
  //  - I also froze the region FSMs here, on the theory that re-stamping
  //    re-drives them and that this was what moved the piecewise BJT bench
  //    0.067245 -> 0.195212 V. IT IS NOT, and the freeze was inert: with a
  //    circuit that has BOTH a shunt-held node and a saturated BJT, frozen and
  //    unfrozen give the same 0.195212 V to six figures. The movement comes
  //    from ITERATING a bench that is not uniquely converged, not from region
  //    state, so the freeze was a mechanism with nothing behind it and is gone.
  //    What protects that bench is the threshold below, and only that.
  //
  // IT IS A REFINEMENT AND NOT A REPLACEMENT. If it does not converge the
  // full-shunt answer stands, device state included: a converged solve with a
  // small wrong term beats an iterate with no term, and a caller cannot tell an
  // iterate from an answer.
  if (converged && !transient) {
    const shunted = Float64Array.from(solution);
    const snap = [diodeVoltages, mosVsb, mosVdb, mosVds, bjtVbc].map((m) => new Map(m));
    const restore = () => {
      solution = shunted;
      for (const [m, saved] of [[diodeVoltages, snap[0]], [mosVsb, snap[1]],
        [mosVdb, snap[2]], [mosVds, snap[3]], [bjtVbc, snap[4]]]) {
        m.clear();
        for (const [k, v] of saved) m.set(k, v);
      }
    };
    const allFinite = (v) => {
      for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) return false;
      return true;
    };

    // STEP ONE: the same assembly, minus the shunt. `A` and `b` still hold the
    // final iteration's stamps -- `solveAssembled` copies to CSC and mutates
    // neither -- so this changes exactly one thing and nothing is re-evaluated.
    let removed = 0;
    for (let i = 0; i < nodeCount; i++) {
      if (A.get(i, i) - GMIN !== 0) { A.add(i, i, -GMIN); removed++; }
    }
    let moved = 0;
    if (removed) {
      try {
        const once = solveAssembled(A, new Float64Array(b));
        if (allFinite(once)) {
          for (let i = 0; i < once.length; i++) moved = Math.max(moved, Math.abs(once[i] - solution[i]));
          solution = once;
        }
      } catch { /* singular without it: the shunted answer stands */ }
    }

    // STEP TWO, AND ONLY WHERE STEP ONE PROVED IT IS NEEDED.
    //
    // How far step one moved the answer IS the measurement of whether the shunt
    // was load-bearing, and it decides whether the junctions must re-converge.
    // A circuit at ordinary impedances does not move at all -- the term is
    // eleven orders below its conductances -- and it keeps step one's answer,
    // bit-identical to before this block existed. A circuit whose nodes hung on
    // the shunt moves by volts, and there the frozen linearisation is stale and
    // one step is not enough: the dangling gate-drain bench needed this to go
    // from 4.867521 V to 5.000000 V against ngspice's 4.999380 V.
    //
    // Deriving the condition is the point. Keying it to a device kind would be
    // a list to keep, and the thing that matters is not which parts are present
    // but whether the shunt was holding a node up.
    //
    // WHY IT HAS TO BE CONDITIONAL. Iterating unconditionally moves the
    // PIECEWISE BJT bench 0.067245 -> 0.195212 V, because that bench is not
    // uniquely converged -- any second trajectory lands on a different
    // consistent point. Its step-one move is ~1e-11 V, so the threshold leaves
    // it alone, and the two cases separate by seven orders of magnitude rather
    // than by a predicate anyone has to maintain.
    //
    // WHAT THE THRESHOLD DOES NOT PROMISE. A circuit with BOTH a shunt-held
    // node and a region-bearing device does take the iteration, and there the
    // piecewise answer does move: the same motor bench with one dangling 1 TOhm
    // resistor added reads 0.195212 V rather than 0.067245 V. No gallery
    // circuit is in that class -- the 2,131-circuit A/B is +10 and zero
    // regressions -- but it is a real consequence and not a case the threshold
    // rules out.
    if (moved > 1e-6) {
      const ok2 = runNewton(GMIN, 1, true);
      if (!ok2 || !allFinite(solution)) restore();
    }
  }

  // ─── Extract results ────────────────────────────────────────────────────

  /** @type {Map<string, number>} */
  const nodeVoltages = new Map();
  if (groundNetId) nodeVoltages.set(groundNetId, 0);
  // Merged-away gnd island nets are physically the reference too. The caller
  // still holds them (the merge no longer rewrites its netlist), so they must
  // answer here — absent entries would read as "unknown net", not 0 V.
  for (const id of mergedGndIds) nodeVoltages.set(id, 0);
  for (const [netId, idx] of nodeIndex) {
    if (netId.startsWith('\u0000intrinsic-base:')) continue;
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
      const i = (vA - vB) / ohms; // current from a to b, INSIDE the part
      // Every raw terminal reading is OUT-OF-PART positive. `i` enters at a
      // and leaves at b. OP adapts this once to its explicit INTO contract.
      currents.set('a', -i); // out of terminal a
      currents.set('b', i);  // out of terminal b
    }

    // A button or switch is stamped as a plain two-terminal conductance
    // (stampButton: 1 mOhm closed, 1e-12 S open), so its branch current is
    // as computable as a resistor's — but no rule extracted it, and
    // `branchCurrent` returns a flat 0 for a terminal it finds nothing for.
    // An ammeter probe on a closed button in a live loop therefore read
    // 0.0 mA, which is indistinguishable from an open circuit and is the
    // one answer a continuity-minded learner will not question.
    // The buzzer had the same gap the button did: stamped as a plain
    // 100 Ω (stampBuzzerResistance) but no extraction rule, so its
    // branchCurrent read 0.0 mA while its own net carried 43 mA — a
    // KCL-invisible part (found by the EXPECTED-quantities gate on
    // 44-darlington-motor, where the buzzer IS the load being taught).
    if (part.kind === 'potentiometer') {
      // A POT CARRIED CURRENT AND REPORTED NONE, on every terminal.
      //
      // stampPotentiometer puts two resistors in the matrix, so the wiper
      // voltage was right — 5 V across a 10k pot solves the wiper to 2.500000 —
      // while `branchCurrent` returned 0 for a, b AND wiper, when 0.5 mA is
      // flowing. Same shape as the buzzer's missing walker case: the extraction
      // switch had no arm for the kind, so a real reading came back as a
      // confident zero. A meter on a pot read 0 A.
      //
      // MIRRORS THE STAMP RATHER THAN RE-DERIVING IT: same authored-position
      // fallback, same control precedence, same Math.max(1, ...) floor. If the
      // two ever disagree the current is about a different divider than the
      // voltage.
      const authored = Number.isFinite(part.params?.position) ? part.params.position : 0.5;
      const position = controls?.get(part.id) ?? authored;
      const totalOhms = /** @type {number} */ (part.params.ohms ?? 10000);
      const rAW = Math.max(1, totalOhms * (1 - position));
      const rWB = Math.max(1, totalOhms * position);
      const vAt = (term) => {
        const n = findNet(nets, part.id, term);
        return n ? (nodeVoltages.get(n) ?? 0) : 0;
      };
      const vA = vAt('a'), vW = vAt('wiper'), vB = vAt('b');
      const iAW = (vA - vW) / rAW;   // into `a`, on toward the wiper
      const iWB = (vW - vB) / rWB;   // out of the wiper, on toward `b`
      currents.set('a', -iAW);
      currents.set('b', iWB);
      // Out of the wiper is internal current arriving from a minus that to b.
      currents.set('wiper', iAW - iWB);
    }

    if (part.kind === 'buzzer') {
      const netA = findNet(nets, part.id, 'a');
      const netB = findNet(nets, part.id, 'b');
      const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      // Reads the SAME resistance the stamp used. The comment here already said
      // "must match stampBuzzerResistance" and the literal was the reason it
      // could stop matching: giving the stamp `params.ohms` made a 400 Ohm
      // buzzer report 4x its current, because extraction still divided by 100.
      const bzOhms = /** @type {number} */ (part.params?.ohms ?? classDefaults('buzzer').ohms);
      const i = (vA - vB) / bzOhms;
      currents.set('a', -i);
      currents.set('b', i);
    }

    if (part.kind === 'button' || part.kind === 'switch') {
      const netA = findNet(nets, part.id, 'a');
      const netB = findNet(nets, part.id, 'b');
      const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      const closed = (controls?.get(part.id) ?? 0) === 1;
      const g = closed ? 1 / 0.001 : 1e-12;   // must match stampButton
      const i = (vA - vB) * g;                // current from a to b
      currents.set('a', -i);                  // same convention as resistor
      currents.set('b', i);
    }

    if (part.kind === 'led' || part.kind === 'diode') {
      const anodeNet = findNet(nets, part.id, 'anode');
      const cathodeNet = findNet(nets, part.id, 'cathode');
      const vAnode = anodeNet ? (nodeVoltages.get(anodeNet) ?? 0) : 0;
      const vCathode = cathodeNet ? (nodeVoltages.get(cathodeNet) ?? 0) : 0;
      // A bare LED is a ~2 V junction; a bare diode is silicon, 0.7 V.
      // (Sweep finding 2026-08-15: both defaulted to 2.0, so an
      // unparameterized diode behaved exactly like an LED.)
      const vf = effVf(/** @type {number} */ (part.params.vf ?? (part.kind === 'diode' ? 0.7 : 2.0)));
      const rd = junctionRd(part); // bulk resistance, per kind
      const vAcross = vAnode - vCathode;
      // Same model as the stamp — a PWL current read off a Shockley solve
      // (or vice versa) is a plausible wrong number.
      const i = junctionCurrent(part, vAcross, vf, rd);
      currents.set('anode', -i);   // positive out of the part
      currents.set('cathode', i);
    }

    if (part.kind === 'zener') {
      const anodeNet = findNet(nets, part.id, 'anode');
      const cathodeNet = findNet(nets, part.id, 'cathode');
      const vAnode = anodeNet ? (nodeVoltages.get(anodeNet) ?? 0) : 0;
      const vCathode = cathodeNet ? (nodeVoltages.get(cathodeNet) ?? 0) : 0;
      // The forward junction shifts with temperature; vz stays put —
      // zener/avalanche tempco is a different, weaker physics and
      // pretending −2 mV/°C would be invention (E2.2 scope note).
      const vf = effVf(/** @type {number} */ (part.params.vf ?? 0.7));
      const vz = /** @type {number} */ (part.params.vz ?? 5.1);
      const rd = 10;
      const rzener = /** @type {number} */ (part.params.rz ?? 5);
      const ibv = zenerKneeCurrent(part);
      const vAcross = vAnode - vCathode;
      // THE SAME REGIONS AS THE STAMP, IN THE SAME ORDER. This reader is the
      // stamp's twin: a node voltage that agrees while the branch current does
      // not is the exact signature of one of the two moving without the other,
      // and it has cost this engine real debugging time before.
      let i;
      if (junctionModelOf(part, undefined) === 'shockley' && vAcross >= 0) {
        i = junctionCurrent(part, vAcross, vf, rd);
      } else if (vAcross >= vf) i = (vAcross - vf) / rd;
      else if (ibv > 0 && vAcross < 0) {
        const nB = Number.isFinite(Number(part.params.n)) && Number(part.params.n) > 0
          ? Number(part.params.n) : 1;
        i = -zenerBreakdown(-vAcross, vz, ibv, zenerSeriesR(part, rzener),
          nB * JUNCTION_THERMAL_VOLTAGE)[0];
      } else if (vAcross <= -vz) i = (vAcross + vz) / rzener;
      else i = 0;
      currents.set('anode', -i);
      currents.set('cathode', i);
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

      // THE SAME Vce(sat) THE STAMP USED. Reading the constant here while the
      // stamp used the derived value made the extraction report ic = 0.0000 mA
      // for a transistor whose load was passing 0.39 mA — the stamp and the
      // reader describing different devices, which is the defect this change
      // set out to remove and which I reintroduced one level down by patching
      // one reader of three.
      const vceSat = /** @type {number} */ (part.params.vceSat ?? bjtVceSat.get(part.id) ?? 0.2);

      // EBERS-MOLL: READ THE MODEL THE STAMP USED.
      //
      // Three readers of vceSat once disagreed here and the extraction reported
      // ic = 0.0000 mA against a 0.39 mA load. Same rule: if the stamp was
      // Ebers-Moll, the currents are Ebers-Moll's, evaluated at the CONVERGED
      // junction voltages read back off the node solution — not at the stored
      // Newton state, which is one limited step behind.
      const emX = bjtVbc.has(part.id) ? ebersMollParams(part) : null;
      if (emX) {
        const idxIntrinsic = bjtBaseIndex.get(part.id);
        const vModelBase = idxIntrinsic !== undefined ? solution[idxIntrinsic] : vB;
        const vbeX = part.kind === 'npn' ? vModelBase - vE : vE - vModelBase;
        const vbcX = part.kind === 'npn' ? vModelBase - vC : vC - vModelBase;
        const c = ebersMollCompanion(vbeX, vbcX, emX);
        const sgn = part.kind === 'npn' ? 1 : -1;
        if (idxIntrinsic !== undefined) {
          // RB belongs between the public base terminal and the intrinsic
          // Ebers-Moll base.  Read the current through the element that was
          // actually stamped; deriving it from the junction companion would
          // hide a stamp/reader split.  This path is NPN-only by construction.
          const baseOut = -(vB - vModelBase) / emX.rb;
          const collectorOut = -c.ic;
          currents.set('base', baseOut);
          currents.set('collector', collectorOut);
          currents.set('emitter', -(baseOut + collectorOut));
        } else {
          // Keep the pre-RB arithmetic untouched for omitted/zero RB and PNP.
          currents.set('base', -sgn * c.ib);
          currents.set('collector', -sgn * c.ic);
          currents.set('emitter', sgn * (c.ib + c.ic));
        }
        continue;
      }

      let ib, ic;
      // Same C1 knee the stamp uses — extraction and stamp must agree.
      if (part.kind === 'npn') {
        ib = pwlKneeCurrent(vB - vE, vbeThresh, rd);
        ic = beta * ib;
      } else {
        ib = pwlKneeCurrent(vE - vB, vbeThresh, rd);
        ic = beta * ib;
      }
      // SATURATED: beta*Ib is what the VCCS would DEMAND, not what the
      // branch passes. The stamp knows this — it replaces the VCCS with a
      // stiff Vce clamp (gS below, matching stampNPN/stampPNP) so the
      // collector current becomes whatever the LOAD passes at Vce(sat).
      // The extraction did not, and reported beta*Ib anyway: on
      // 38-npn-switch an ammeter probe on q1.collector read 43.0 mA while
      // the same series loop measured 5.8 mA in the load resistor and the
      // LED. That is a reading a learner cannot reconcile with KCL, and it
      // cost brickwright-lite's `electricity-transistor-switch` its
      // checkpoint (docs/LESSON-REVIEW-WAVE-1.md defect 6).
      if (bjtRegions.get(part.id) === 'saturated') {
        const gS = 10; // must match stampNPN / stampPNP
        const vOut = part.kind === 'npn' ? vC - vE : vE - vC;
        ic = Math.max(0, gS * (vOut - vceSat));
      }
      const polarity = part.kind === 'npn' ? 1 : -1;
      currents.set('base', -polarity * ib);
      currents.set('collector', -polarity * ic);
      currents.set('emitter', polarity * (ib + ic));
    }

    if (part.kind === 'nmos' || part.kind === 'pmos') {
      const netG = findNet(nets, part.id, 'gate');
      const netD = findNet(nets, part.id, 'drain');
      const netS = findNet(nets, part.id, 'source');
      const netB = findNet(nets, part.id, 'bulk');
      const vG = netG ? (nodeVoltages.get(netG) ?? 0) : 0;
      const vD = netD ? (nodeVoltages.get(netD) ?? 0) : 0;
      const vS = netS ? (nodeVoltages.get(netS) ?? 0) : 0;
      const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
      // THE SAME THRESHOLD AGAIN, third reader. `mosVsb` is not in scope here,
      // so it is recomputed from the solved node voltages — which is the
      // converged value the stamp iterated to, not one step behind it.
      const vBulkRef = part.kind === 'nmos' ? (vS - vB) : (vB - vS);
      const vth = mosVth(
        { ...part.params, vth: part.params.vth ?? (part.kind === 'nmos' ? 2.0 : -2.0),
          bulkExplicit: netB !== undefined },
        vBulkRef);
      const k = /** @type {number} */ (mosK(part.params)); // k, or KP/2*(W/L)
      let id;
      // Same smoothed square law as the stamp — a hard-corner current read
      // off a smoothed solve disagrees with KCL near threshold.
      // TRIODE: k·vov² is what the saturation VCCS would DEMAND, not what
      // the channel passes — the stamp models a resistor gOn = 2K·vov and
      // the current is gOn·vds (the BJT saturation lesson, again: the
      // extraction must read the same element the solve stamped).
      const inTriode = mosRegions.get(part.id) === 'triode';
      // THE OUTPUT CONDUCTANCE IS PART OF THE BRANCH, AND THE READER LEFT IT OUT.
      //
      // In saturation the stamp puts `gds` across drain-source beside the VCCS,
      // and this reader returned only the VCCS term — so `branchCurrent` did not
      // equal what the solve passed and KCL failed AT THE PART. Measured on the
      // ADI cascode bench before `mosGds` shrank it: M2's drain read 1.395 mA
      // while the 910 Ohm in series with it carried 4.556 mA. A learner putting
      // an ammeter in either lead gets two different answers, which is the
      // defect class this engine keeps closing — the reader must describe the
      // element the solve stamped.
      let outputConductanceActivation = 0;
      if (part.kind === 'nmos') {
        const vgs = vG - vS;
        const [vovS, dVovS] = smoothVov(vgs - vth, mosKsubthres(part));
        outputConductanceActivation = dVovS;
        // Same law the stamp uses, at the same operating point. `dVovS` is
        // passed for real rather than as a placeholder 1: only `.id` is read
        // here, but an argument that lies is a claim nobody checks until
        // someone reads `.gm` off the same call.
        const vdsE = Math.min(Math.max(vD - vS, 0), Math.max(vovS, 0));
        id = inTriode
          ? mosTriode(k, vovS, vdsE, dVovS, part.params).id   // must match stampNMOS
          : k * vovS * vovS;
      } else {
        const vsg = vS - vG;
        const [vovS, dVovS] = smoothVov(vsg - Math.abs(vth), mosKsubthres(part));
        outputConductanceActivation = dVovS;
        const vsdE = Math.min(Math.max(vS - vD, 0), Math.max(vovS, 0));
        id = inTriode
          ? mosTriode(k, vovS, vsdE, dVovS, part.params).id   // must match stampPMOS
          : k * vovS * vovS;
      }
      if (!inTriode) {
        // Same expression as the stamp, at the same operating point.
        const gds = mosGds(part.params, id, outputConductanceActivation);
        id += gds * (part.kind === 'nmos' ? (vD - vS) : (vS - vD));
      }
      currents.set('drain', part.kind === 'nmos' ? -id : id);
      currents.set('source', part.kind === 'nmos' ? id : -id);
      currents.set('gate', 0); // gate draws no DC current

      // THE BULK JUNCTIONS ARE PART OF THE BRANCH THE SOLVE STAMPED, so an
      // ammeter on the source lead must see them. This is the same lesson the
      // `gds` line above records: a reader that leaves out a stamped element
      // describes a different device than the one that was solved, and the two
      // answers then disagree at a net where the user can measure both.
      //
      // A THREE-TERMINAL PART CANNOT CONSERVE A FOUR-TERMINAL CURRENT. Net-level
      // KCL holds, because the junction current really does enter the source net
      // from the reference and this reading includes it. Part-level KCL does
      // NOT: drain + gate + source no longer sums to zero, because current
      // arrives through a terminal this part does not have. That is a true fact
      // about the model, not a rounding error, so it is reported rather than
      // absorbed — `bulk` carries the sum and the three leads plus `bulk` do
      // conserve.
      if (part.params?.bulkAtGround || netB !== undefined) {
        const stateS = part.kind === 'nmos' ? (vS - vB) : (vB - vS);
        const stateD = part.kind === 'nmos' ? (vD - vB) : (vB - vD);
        const nodeIsCathode = part.kind === 'nmos' ? 1 : -1;
        // `iS`/`iD` are the junction current flowing from the bulk INTO the
        // device node. In this reader's convention (positive = out of the part
        // into the net) that current ENTERS the part at the bulk and LEAVES at
        // the source, so it adds to the source lead and the bulk lead carries
        // its negative. Getting this sign wrong is not subtle: net KCL at the
        // tail came out at exactly -2*iS per device, which is how it was caught.
        const jS = mosBulkJunction(-stateS, part.params);
        const jD = mosBulkJunction(-stateD, part.params);
        const iS = (jS.iEq + jS.gEq * -stateS) * nodeIsCathode;
        const iD = (jD.iEq + jD.gEq * -stateD) * nodeIsCathode;
        currents.set('source', (currents.get('source') ?? 0) + iS);
        currents.set('drain', (currents.get('drain') ?? 0) + iD);
        currents.set('bulk', -(iS + iD));
      }
    }

    if (part.kind === 'isource') {
      const amps = dcSources ? sourceDcValue(part, 0.001) : sourceCurrent(part, tSeconds);
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
        const h = Math.max(transient.dtSec, 1e-15);
        if (transient.method === 'trap') {
          const vPrev = transient.inductorVoltages?.get(part.id) ?? 0;
          i = iPrev + (h / (2 * Math.max(L, 1e-12))) * ((vA - vB) + vPrev);
        } else {
          i = iPrev + (h / Math.max(L, 1e-12)) * (vA - vB);
        }
      } else {
        // DC: inductor is a wire, current = V_drop / R_wire
        i = (vA - vB) / 0.001;
      }
      // THE HOUSE CONVENTION IS OUT-OF-PART POSITIVE, and it is not negotiable
      // per device: net-level KCL is the sum of every terminal's reading on a
      // net, so one device using the opposite sign breaks Kirchhoff wherever it
      // shares a net with anything else.
      //
      // This briefly read `a: +i, b: -i` with a comment asserting "positive
      // INTO the named terminal". The motivation was real -- the non-UIC
      // initializer was reading a sign it did not expect -- but the repair was
      // at the wrong layer, and it broke every other consumer. Measured on
      // V -> R1 -> L1 -> R2 -> gnd, where NEITHER of the inductor's nets
      // carries a reference terminal so no question about the ground rail can
      // arise:
      //
      //   out-of-part (here)   KCL at L1.a's net 0.0000 mA, at L1.b's 0.0000 mA
      //   into-the-terminal    KCL at L1.a's net 49.9998 mA, at L1.b's -49.9997
      //
      // i.e. off by exactly twice the branch current, in both places. The full
      // suite passed in both states, which is the coverage gap this comment and
      // `test/inductor-kcl-convention.test.mjs` exist to close.
      //
      // AND THE INITIALIZER WAS NEVER WRONG. It reads an `operatingPoint()`
      // result, and that API reports INTO-THE-TERMINAL positive -- the exact
      // negative of this extraction. Two conventions in one engine, each
      // self-consistent, is the real defect; flipping one of them to match a
      // consumer of the other just moves the breakage. Both are pinned as they
      // are by `test/inductor-kcl-convention.test.mjs`.
      currents.set('a', -i);
      currents.set('b', i);
    }

    if (part.kind === 'transformer') {
      const vP = (nodeVoltages.get(findNet(nets, part.id, 'p1')) ?? 0)
        - (nodeVoltages.get(findNet(nets, part.id, 'p2')) ?? 0);
      const vS = (nodeVoltages.get(findNet(nets, part.id, 's1')) ?? 0)
        - (nodeVoltages.get(findNet(nets, part.id, 's2')) ?? 0);
      let iP; let iS;
      if (transient) {
        const { g11, g12, g22 } = transformerGamma(part);
        const h = Math.max(transient.dtSec, 1e-15);
        const trap = transient.method === 'trap';
        const sc = trap ? h / 2 : h;
        const iPp = transient.inductorCurrents.get(part.id + ':p') ?? 0;
        const iSp = transient.inductorCurrents.get(part.id + ':s') ?? 0;
        const vpP = trap ? (transient.inductorVoltages?.get(part.id + ':p') ?? 0) : 0;
        const vpS = trap ? (transient.inductorVoltages?.get(part.id + ':s') ?? 0) : 0;
        iP = iPp + sc * (g11 * (vP + vpP) + g12 * (vS + vpS));
        iS = iSp + sc * (g12 * (vP + vpP) + g22 * (vS + vpS));
      } else {
        iP = vP / 0.001;
        iS = vS / 0.001;
      }
      currents.set('p1', -iP);
      currents.set('p2', iP);
      currents.set('s1', -iS);
      currents.set('s2', iS);
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
        const h = Math.max(transient.dtSec, 1e-15);
        if (transient.method === 'trap') {
          const iPrev = transient.capCurrents?.get(part.id) ?? 0;
          i = (2 * C / h) * ((vA - vB) - vPrev) - iPrev;
        } else {
          i = (C / h) * ((vA - vB) - vPrev);
        }
      } else if (vsIndex.has(part.id)) {
        // Instantaneous: the source row's current variable is the cap current.
        i = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
      }
      currents.set('a', -i);
      currents.set('b', i);
    }

    if (part.kind === 'opamp' && vsIndex.has(part.id)) {
      // MNA source-row unknown is positive INTO the output; API is out.
      const iOut = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
      currents.set('out', -iOut);
      currents.set('inp', 0);
      currents.set('inn', 0);
    }

    if (part.kind === 'vcvs' && vsIndex.has(part.id)) {
      const iOut = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
      currents.set('outp', -iOut);
      currents.set('outn', iOut);
      currents.set('inp', 0);
      currents.set('inn', 0);
    }

    if (part.kind === 'vccs') {
      const region = vccsClamps.get(part.id) ?? 'linear';
      let i;
      if (region === 'clamp+') i = /** @type {number} */ (part.params.iMax);
      else if (region === 'clamp-') i = -(/** @type {number} */ (part.params.iMax));
      else {
        const nP = findNet(nets, part.id, 'inp');
        const nN = findNet(nets, part.id, 'inn');
        const vin = (nP ? (nodeVoltages.get(nP) ?? 0) : 0)
          - (nN ? (nodeVoltages.get(nN) ?? 0) : 0);
        i = (/** @type {number} */ (part.params.gm ?? 1e-3)) * vin;
      }
      currents.set('outp', i);
      currents.set('outn', -i);
      currents.set('inp', 0);
      currents.set('inn', 0);
    }

    if (part.kind === 'vsource' && vsIndex.has(part.id)) {
      const iSrc = solution[nodeCount + /** @type {number} */ (vsIndex.get(part.id))];
      currents.set('pos', -iSrc);
      currents.set('neg', iSrc);
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
      currents.set('vcc', -iVcc);
    }

    // Registered device models: terminal currents derived GENERICALLY from
    // the very companions the final NR iteration stamped (deviceStamps), so
    // every model is KCL-visible without writing a per-model hook. Sign
    // convention is the RESISTOR convention (positive = current OUT of the
    // part into the net) — the one dc-motor's hand-written hook documents as
    // what a meter placed in either lead expects, agreeing with a meter on a
    // series resistor. A device whose stamps all pair terminals sums to
    // zero; single-terminal companions (a logic output's Norton against the
    // reference) return through ground, which is exactly the physics.
    {
      const model = getDevice(part.kind);
      if (model) {
        const read = (terminal) => {
          const n = findNet(nets, part.id, terminal);
          return n ? (nodeVoltages.get(n) ?? 0) : 0;
        };
        const rec = deviceStamps.get(part.id);
        if (rec && rec.length) {
          const acc = new Map();
          const add = (t, i) => acc.set(t, (acc.get(t) ?? 0) + i);
          for (const r of rec) {
            if (r.kind === 'cond') {
              const i = (read(r.tA) - read(r.tB)) * r.g; // internal tA → tB
              add(r.tA, -i); add(r.tB, i);
            } else if (r.kind === 'norton') {
              add(r.t, (r.vth - read(r.t)) * r.g);
            } else if (r.kind === 'between') {
              const i = ((read(r.tP) - read(r.tN)) - r.vth) * r.g; // internal tP → tN
              add(r.tP, -i); add(r.tN, i);
            } else if (r.kind === 'inject') {
              add(r.t, r.amps);
            }
          }
          for (const [t, i] of acc) currents.set(t, i);
        }
        // A model's own branchCurrents hook stays as the per-terminal
        // override — it may know region physics the companions flatten.
        if (model.branchCurrents) {
          const state = (opts.deviceStates && opts.deviceStates.get(part.id)) || { drives: {} };
          for (const [t, i] of model.branchCurrents(part, state, read)) currents.set(t, i);
        }
      }
    }
  }

  // Transient next-state: what the caller stores for the next step. The
  // trapezoidal companions need the element's own current (cap) and voltage
  // (inductor) history too, so both are returned alongside the classic pair.
  if (transient) {
    const capVoltagesNext = new Map();
    const capCurrentsNext = new Map();
    const inductorCurrentsNext = new Map();
    const inductorVoltagesNext = new Map();
    for (const part of parts) {
      if (part.kind === 'capacitor') {
        const netA = findNet(nets, part.id, 'a');
        const netB = findNet(nets, part.id, 'b');
        const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
        const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
        capVoltagesNext.set(part.id, vA - vB);
        const c = branchCurrents.get(part.id);
        capCurrentsNext.set(part.id, c ? (c.get('b') ?? 0) : 0);
      }
      if (part.kind === 'inductor') {
        const c = branchCurrents.get(part.id);
        // Terminal B's reading IS the a -> b current under the out-of-part
        // convention restored above.
        inductorCurrentsNext.set(part.id, c ? (c.get('b') ?? 0) : 0);
        const netA = findNet(nets, part.id, 'a');
        const netB = findNet(nets, part.id, 'b');
        const vA = netA ? (nodeVoltages.get(netA) ?? 0) : 0;
        const vB = netB ? (nodeVoltages.get(netB) ?? 0) : 0;
        inductorVoltagesNext.set(part.id, vA - vB);
      }
      if (part.kind === 'transformer') {
        const c = branchCurrents.get(part.id);
        inductorCurrentsNext.set(part.id + ':p', c ? (c.get('p2') ?? 0) : 0);
        inductorCurrentsNext.set(part.id + ':s', c ? (c.get('s2') ?? 0) : 0);
        const vP = (nodeVoltages.get(findNet(nets, part.id, 'p1')) ?? 0)
          - (nodeVoltages.get(findNet(nets, part.id, 'p2')) ?? 0);
        const vS = (nodeVoltages.get(findNet(nets, part.id, 's1')) ?? 0)
          - (nodeVoltages.get(findNet(nets, part.id, 's2')) ?? 0);
        inductorVoltagesNext.set(part.id + ':p', vP);
        inductorVoltagesNext.set(part.id + ':s', vS);
      }
    }
    return { nodeVoltages, branchCurrents, capVoltagesNext, capCurrentsNext,
      inductorCurrentsNext, inductorVoltagesNext, converged, opampRegions, deviceStamps,
      railConflicts: railConflicts.length ? [...new Set(railConflicts)] : undefined };
  }

  return { nodeVoltages, branchCurrents, converged, opampRegions, deviceStamps,
    railConflicts: railConflicts.length ? [...new Set(railConflicts)] : undefined };
}

// ─── Stamp functions ─────────────────────────────────────────────────────────

/**
 * Per-solve terminal→net map. solveMNA attaches one (under a Symbol, on its
 * own private copy of the nets array — never on the caller's) so the tens of
 * findNet calls per stamp per NR iteration are O(1) lookups. Arrays without
 * the map — external callers of the exported findNet — keep the linear scan.
 */
/** Bench-temperature junction shift in volts (E2.2), set per solve. */
let tempVfShiftV = 0;
/** The bench temperature itself, for device ctx (same lifetime rules). */
let benchTemperatureC = 25;
/** A junction's effective forward drop at the bench temperature. */
const effVf = (raw) => raw + tempVfShiftV;

/**
 * A transformer's inverse inductance matrix Γ = L⁻¹ (E3.4,
 * spec-updates/coupled-inductors.md). Accepts {l1, l2, k} or the
 * pedagogical {ratio, lm, k}; k is clamped inside (0, 1) here as a
 * belt-and-braces for programmatic callers — validateNetlist REFUSES
 * out-of-range k with the reason named before a board ever solves.
 */
function transformerGamma(part) {
  const P = part.params ?? {};
  const n = Number(P.ratio) || 0;
  const lm = Number(P.lm ?? 10);
  const l1 = Number(P.l1 ?? (n ? lm : 1));
  const l2 = Number(P.l2 ?? (n ? lm / (n * n) : 1));
  const k = Math.min(Math.max(Number(P.k ?? 0.999), 1e-6), 0.999999);
  const m = k * Math.sqrt(l1 * l2);
  const det = l1 * l2 - m * m;
  return { l1, l2, m, g11: l2 / det, g12: -m / det, g22: l1 / det };
}

/**
 * Stamp the coupling between two ports: current at port (rowA→rowB)
 * responding to voltage across port (colA→colB) with conductance g.
 * With row === col this is exactly stampTwoTerminal's pattern.
 */
function stampPortCoupling(A, rowNetA, rowNetB, colNetA, colNetB, g, nodeIndex) {
  const ra = rowNetA ? nodeIndex.get(rowNetA) : undefined;
  const rb = rowNetB ? nodeIndex.get(rowNetB) : undefined;
  const ca = colNetA ? nodeIndex.get(colNetA) : undefined;
  const cb = colNetB ? nodeIndex.get(colNetB) : undefined;
  if (ra !== undefined && ca !== undefined) A.add(ra, ca, g);
  if (ra !== undefined && cb !== undefined) A.add(ra, cb, -g);
  if (rb !== undefined && ca !== undefined) A.add(rb, ca, -g);
  if (rb !== undefined && cb !== undefined) A.add(rb, cb, g);
}

const NETS_TERM_MAP = Symbol('bw-term-map');
const termKey = (partId, terminal) => partId + String.fromCharCode(0) + terminal;

/** @param {Net[]} nets @returns {Map<string, string>} */
function buildTermMap(nets) {
  const m = new Map();
  for (const net of nets) {
    for (const t of net.terminals) {
      const k = termKey(t.part, t.terminal);
      // First net in array order wins — the linear scan's exact semantics.
      if (!m.has(k)) m.set(k, net.id);
    }
  }
  return m;
}

/**
 * Find the net connected to a specific terminal of a part.
 * @param {Net[]} nets
 * @param {string} partId
 * @param {string} terminal
 * @returns {string | undefined}
 */
function findNet(nets, partId, terminal) {
  const m = /** @type {Map<string, string> | undefined} */ (nets[NETS_TERM_MAP]);
  if (m) return m.get(termKey(partId, terminal));
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
  // A leg on NO net carries no current. Ground has no matrix row, so
  // nodeIndex.get(gnd) is undefined exactly like a terminal on no net — the
  // two were indistinguishable and this element was stamped as if the loose
  // leg were GROUNDED. Net IDs are non-empty strings, so real ground passes.
  if (!netA || !netB) return;
  const ohms = /** @type {number} */ (part.params.ohms ?? 1000);
  const g = 1 / ohms;

  const idxA = nodeIndex.get(netA);
  const idxB = nodeIndex.get(netB);

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
  const vf = effVf(/** @type {number} */ (part.params.vf ?? (part.kind === 'diode' ? 0.7 : 2.0)));
  const rd = junctionRd(part);

  const vAcross = diodeVoltages.get(part.id) ?? 0;
  // The PWL branch wants the knee; the Shockley branch wants the datasheet
  // drop and already subtracts rs itself. Converting HERE rather than inside
  // diodeCompanion keeps the BJT callers (which pass vbe, a knee) untouched.
  const jOpts = junctionOpts(part);
  const { gEq, iEq } = diodeCompanion(vAcross, jOpts ? vf : kneeFromVf(vf, rd), rd, jOpts);

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
  // params.position is the AUTHORED default — where the example's trimmer
  // was left. The user's control always wins once touched; mid-travel
  // remains the fallback. (The LCD contrast pot defaulted to a washed-out
  // 0.25 contrast because every pot woke at 0.5 regardless of wiring.)
  const authored = Number.isFinite(part.params?.position) ? part.params.position : 0.5;
  const position = controls.get(part.id) ?? authored;
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
  return g;
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

  // Voltage source from ground to vccNet: V(vccNet) - V(gnd) = volts.
  // The CALLER resolves params.volts vs the board default (and applies
  // any source-stepping scale) — re-resolving params here silently undid
  // both, which is why the passed value is used as-is.
  const volts = vcc;
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
function stampMcuPins(A, b, part, nets, nodeIndex, groundNetId, pinSources, srcScale = 1) {
  for (const terminal of part.terminals) {
    const source = pinSources.get(terminal);
    if (!source || source === 'high-z') continue;

    const pinNet = findNet(nets, part.id, terminal);
    if (!pinNet) continue;
    const nodeIdx = nodeIndex.get(pinNet);
    if (nodeIdx === undefined) continue;

    // Norton equivalent: G = 1/Rth, I = Vth/Rth
    const g = 1 / source.rTh;
    const iNorton = (source.vTh * srcScale) / source.rTh;

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
  // params.ohms first, then the one table. The walker in board.js reads it the
  // same way; when this read only the table and the walker read the param, an
  // explicitly-sized buzzer drew the default here and the configured value
  // there — reintroducing the very disagreement this change closed, and my own
  // test caught it before it landed.
  const ohms = /** @type {number} */ (part.params?.ohms ?? classDefaults('buzzer').ohms);
  const g = 1 / ohms;
  stampTwoTerminal(A, netA, netB, g, nodeIndex);
  return g;
}

/**
 * Stamp a registered device: its `state.drives` as Norton sources, then the
 * model's own `stamp(ctx)` for input impedance / analog loading.
 */
function stampDevice(A, b, part, nets, nodeIndex, model, state, controls, vcc, tSeconds, dtSec, srcScale = 1, groundNetId = undefined, rec = null) {
  // KCL-visibility: `rec` collects one record per stamped companion so the
  // extraction can derive terminal currents from exactly what was stamped.
  // A terminal on the GROUND net has no matrix row (nodeIndex miss) and its
  // b-injection is skipped, but the current is physically real and returns
  // through the reference — those records are kept (guarded on the net
  // being ground, not merely unindexed, so a floating net fabricates
  // nothing).
  const rowOrGround = (net) => nodeIndex.has(net) || net === groundNetId;
  // E2.2: the bench temperature reaches device stamps through ctx (the
  // TMP36 defaults to it; an explicit params.tempC wins).
  // Drives: terminal → {vTh, rTh, ref?} | null
  //
  // Without `ref` the Norton is stamped against the reference node — right
  // for a logic output whose return is the shared ground, wrong for a
  // floating source. With `ref: '<terminal>'` the source drives `terminal`
  // relative to the device's OWN pin: the standard floating-Thévenin
  // companion (spec-updates/referenced-device-drives.md).
  for (const [terminal, drive] of Object.entries(state.drives ?? {})) {
    if (!drive) continue;
    const net = findNet(nets, part.id, terminal);
    if (!net) continue;
    const g = 1 / Math.max(drive.rTh, 1e-3);
    if (drive.ref) {
      const refNet = findNet(nets, part.id, drive.ref);
      if (!refNet) continue; // return pin in the air: no current path at all
      stampTwoTerminal(A, net, refNet, g, nodeIndex);
      const idx = nodeIndex.get(net);
      const refIdx = nodeIndex.get(refNet);
      if (idx !== undefined) b[idx] += drive.vTh * srcScale * g;
      if (refIdx !== undefined) b[refIdx] -= drive.vTh * srcScale * g;
      if (rec) rec.push({ kind: 'between', tP: terminal, tN: drive.ref, g, vth: drive.vTh * srcScale });
    } else {
      if (!rowOrGround(net)) continue;
      if (rec) rec.push({ kind: 'norton', t: terminal, g, vth: drive.vTh * srcScale });
      const idx = nodeIndex.get(net);
      if (idx === undefined) continue;
      A.add(idx, idx, g);
      b[idx] += drive.vTh * srcScale * g;
    }
  }
  if (!model.stamp) return;
  const ctx = {
    netFor: (terminal) => findNet(nets, part.id, terminal),
    conductance: (tA, tB, g) => {
      const netA = findNet(nets, part.id, tA);
      const netB = tB ? findNet(nets, part.id, tB) : undefined;
      // Record mirrors the stamp condition (stampTwoTerminal no-ops unless
      // BOTH legs are netted), so the derived current can never claim a
      // path the solve did not have.
      if (rec && netA && netB) rec.push({ kind: 'cond', tA, tB, g });
      stampTwoTerminal(A, netA, netB, g, nodeIndex);
    },
    thevenin: (terminal, vTh, rTh) => {
      const net = findNet(nets, part.id, terminal);
      if (!net || !rowOrGround(net)) return;
      const g = 1 / Math.max(rTh, 1e-3);
      if (rec) rec.push({ kind: 'norton', t: terminal, g, vth: vTh * srcScale });
      const idx = nodeIndex.get(net);
      if (idx === undefined) return;
      A.add(idx, idx, g);
      b[idx] += vTh * srcScale * g;
    },
    // Source between two of the device's own pins: vTh raises termPlus
    // above termMinus through rTh. Reduces exactly to `thevenin` when the
    // return pin sits on the reference net; representable nowhere else
    // before this existed — a battery whose neg is off-ground stamped its
    // EMF against ground instead (spec-updates/referenced-device-drives.md).
    theveninBetween: (termPlus, termMinus, vTh, rTh) => {
      const netP = findNet(nets, part.id, termPlus);
      const netN = findNet(nets, part.id, termMinus);
      if (!netP || !netN) return; // a leg in the air carries no current
      const g = 1 / Math.max(rTh, 1e-3);
      if (rec) rec.push({ kind: 'between', tP: termPlus, tN: termMinus, g, vth: vTh * srcScale });
      stampTwoTerminal(A, netP, netN, g, nodeIndex);
      const idxP = nodeIndex.get(netP);
      const idxN = nodeIndex.get(netN);
      if (idxP !== undefined) b[idxP] += vTh * srcScale * g;
      if (idxN !== undefined) b[idxN] -= vTh * srcScale * g;
    },
    current: (terminal, amps) => {
      const net = findNet(nets, part.id, terminal);
      if (!net || !rowOrGround(net)) return;
      if (rec) rec.push({ kind: 'inject', t: terminal, amps: amps * srcScale });
      const idx = nodeIndex.get(net);
      if (idx !== undefined) b[idx] += amps * srcScale;
    },
    vcc,
    tSeconds,
    temperatureC: benchTemperatureC,
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
  // A leg on NO net carries no current, so the element contributes nothing.
  //
  // This has to be said explicitly because the ground net has no matrix row —
  // it is the reference — so `nodeIndex.get(gnd)` is undefined, exactly like a
  // terminal that is on no net at all. The two states were indistinguishable,
  // and the code below adds the self-conductance in both cases, which is right
  // for ground and wrong for air: a resistor with one leg unconnected was
  // stamped as a resistor TO GROUND, silently loading whatever it touched.
  //
  // Found by an independent solver: a MAX4466 board read 2.5 V on its bias
  // node where lcapy said 5 V, because a 1k with one leg in the air was acting
  // as the lower half of a divider. Imported schematics have unconnected pins
  // constantly — no-fit parts, spare gates, test points — and every one of
  // them was a phantom load. Net IDs are non-empty strings, so a real ground
  // net still passes this guard.
  if (!netA || !netB) return;
  const idxA = nodeIndex.get(netA);
  const idxB = nodeIndex.get(netB);

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
/**
 * THE RESISTANCE A CONTROLLED PASSIVE PRESENTS, exported so nobody has to
 * guess it.
 *
 * An LDR and an NTC are resistors whose value is a function of a CONTROL, not a
 * stored number, so `params.ohms` does not exist and anything reading one gets
 * `undefined` and substitutes its own idea. bw-circuit-ui's SPICE exporter did
 * exactly that: `ENGINE_DEFAULTS.ldr = 1000`, a flat 1 kOhm, against this
 * function's 1,000,000 at the default dark control. A thousandfold, and it made
 * every LDR circuit in the corpus disagree with ngspice — 45 of 45.
 *
 * Exported rather than inlined because that is now the third number of this
 * kind (the buzzer's 100, the pot's divider, this): a value the solver computes
 * and an exporter must reproduce needs ONE definition, and a table of defaults
 * in the consumer is not it.
 *
 * @param {{id: string, kind: string, params?: Record<string, unknown>}} part
 * @param {Map<string, number>} [controls]
 * @returns {number|null} ohms, or null when the kind is not a controlled passive
 */
export function controlledResistance(part, controls = new Map()) {
  if (part.kind === 'ldr') {
    const rDark = /** @type {number} */ (part.params?.rDark ?? 1000000);
    const rLight = /** @type {number} */ (part.params?.rLight ?? 100);
    const light = controls.get(part.id) ?? 0;
    return Math.max(rDark * Math.pow(rLight / rDark, light), 0.001);
  }
  if (part.kind === 'ntc') {
    const rCold = /** @type {number} */ (part.params?.rCold ?? 100000);
    const rHot = /** @type {number} */ (part.params?.rHot ?? 1000);
    const temp = controls.get(part.id) ?? 0;
    return Math.max(rCold * Math.pow(rHot / rCold, temp), 0.001);
  }
  return null;
}

function stampVariableResistor(A, b, part, nets, nodeIndex, groundNetId, controls) {
  const ohms = /** @type {number} */ (controlledResistance(part, controls));
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
function stampNPN(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages,
  region = 'active', vceSatEff = undefined, bjtVbc, bjtBaseIndex) {
  const beta = /** @type {number} */ (part.params.beta ?? 100);
  const vbe = /** @type {number} */ (part.params.vbe ?? 0.7);
  const rd = 10; // base-emitter dynamic resistance
  // Explicit param wins (a typed number was meant); otherwise the value the
  // region loop derived from this part's own drive.
  const vceSat = /** @type {number} */ (part.params.vceSat ?? vceSatEff ?? 0.2);

  const netB = findNet(nets, part.id, 'base');
  const netC = findNet(nets, part.id, 'collector');
  const netE = findNet(nets, part.id, 'emitter');

  const idxB = netB ? nodeIndex.get(netB) : undefined;
  const idxC = netC ? nodeIndex.get(netC) : undefined;
  const idxE = netE ? nodeIndex.get(netE) : undefined;

  // FULL EBERS-MOLL WHEN THE ROUTING ASKS FOR IT.
  //
  // Both junctions, with a reverse beta, so saturation falls out of the model
  // instead of being clamped — and so the base node stops being 4 mV out
  // against ngspice, which is what the knee costs. See `ebersMollParams`.
  // The region machinery below is SKIPPED on this path deliberately: a Vce
  // clamp on top of a model that already produces Vce(sat) would be two
  // answers to one question, and the clamp would win.
  const em = ebersMollParams(part);
  if (em && bjtVbc) {
    const vbe = diodeVoltages.get(part.id) ?? 0;
    const vbc = bjtVbc.get(part.id) ?? 0;
    const idxIntrinsic = bjtBaseIndex?.get(part.id);
    const idxModelBase = idxIntrinsic ?? idxB;
    if (idxIntrinsic !== undefined && idxB !== undefined) {
      const gRb = 1 / em.rb;
      A.add(idxB, idxB, gRb);
      A.add(idxIntrinsic, idxIntrinsic, gRb);
      A.add(idxB, idxIntrinsic, -gRb);
      A.add(idxIntrinsic, idxB, -gRb);
    }
    stampEbersMoll(A, b, idxModelBase, idxC, idxE,
      ebersMollCompanion(vbe, vbc, em), 1);
    return;
  }

  // B-E junction: diode model.
  //
  // EXPONENTIAL WHEN THE ROUTING ASKS FOR IT, piecewise otherwise. SPICE has no
  // spelling for our knee, so against ngspice the base sat 31.7 mV high
  // (0.741546 against 0.709818) purely because the two sides were on different
  // junction models — the same gap the diodes had before `model: 'shockley'`,
  // and the BJT never got the escape hatch.
  //
  // A BJT's base-emitter junction carries Ib, and SPICE's Gummel-Poon writes
  // Ib = IS/BF * (exp(Vbe/(N*Vt)) - 1). So the junction's own saturation
  // current is IS/BF, which is the one line of translation this needs;
  // `diodeCompanion` already implements the rest.
  //
  // Gated on the SAME switch the diodes use, so the shipped default is
  // unchanged and no corpus value moves: `JUNCTION_ROUTING.mode = 'shockley'`
  // (what the oracle sweep sets) or an explicit `params.model` on the part.
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
function stampPNP(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, region = 'active', vceSatEff = undefined, bjtVbc) {
  const beta = /** @type {number} */ (part.params.beta ?? 100);
  const vbe = /** @type {number} */ (part.params.vbe ?? 0.7);
  const rd = 10;

  const netB = findNet(nets, part.id, 'base');
  const netC = findNet(nets, part.id, 'collector');
  const netE = findNet(nets, part.id, 'emitter');

  const idxB = netB ? nodeIndex.get(netB) : undefined;
  const idxC = netC ? nodeIndex.get(netC) : undefined;
  const idxE = netE ? nodeIndex.get(netE) : undefined;

  // FULL EBERS-MOLL WHEN THE ROUTING ASKS FOR IT — the same model as the NPN,
  // with every junction voltage negated and the terminal currents with it.
  // `stampEbersMoll`'s `sign` is the whole of the difference, so the two stamps
  // cannot drift the way the vceSat readers did.
  const em = ebersMollParams(part);
  if (em && bjtVbc) {
    const veb = diodeVoltages.get(part.id) ?? 0;   // vE - vB, as the loop stores it
    const vcb = bjtVbc.get(part.id) ?? 0;          // vC - vB
    stampEbersMoll(A, b, idxB, idxC, idxE, ebersMollCompanion(veb, vcb, em), -1);
    return;
  }

  // E-B junction: diode (reversed from NPN — emitter is higher)
  // The Newton store already computes vE - vB for pnp (the update loop
  // at ~line 640) — negating it again meant conduction required base
  // ABOVE emitter, so no PNP ever conducted (audit escalation, pc32).
  const vAcross = diodeVoltages.get(part.id) ?? 0;
  const { gEq, iEq } = diodeCompanion(vAcross, vbe, rd);
  // Explicit param wins; otherwise the value the region loop derived from
  // this part's own drive. The NPN got this and the PNP did not, so the region
  // decision and the PNP stamp disagreed about the clamp and the solve stopped
  // converging — a rename has as many sites as builders.
  const vceSat = /** @type {number} */ (part.params.vceSat ?? vceSatEff ?? 0.2);

  // Stamp E-B diode — in EVERY region. The saturated early-return used
  // to sit above this stamp (a botched mirror of stampNPN, where the
  // clamp correctly replaces only the VCCS): a saturated PNP then had
  // NO base junction at all, the base floated to 0 V through gmin, the
  // base resistor carried nothing, and the solve converged with
  // vEB = 5 V — off which the branch-current extraction read 430 mA
  // "into" a base whose entire path measured 0.43 mA of drive
  // (pc32-pnp-high-side, found by the EXPECTED-quantities gate).
  if (idxE !== undefined) A.add(idxE, idxE, gEq);
  if (idxB !== undefined) A.add(idxB, idxB, gEq);
  if (idxE !== undefined && idxB !== undefined) {
    A.add(idxE, idxB, -gEq);
    A.add(idxB, idxE, -gEq);
  }
  if (idxE !== undefined) b[idxE] -= iEq;
  if (idxB !== undefined) b[idxB] += iEq;

  if (region === 'saturated') {
    // Clamp emitter ≈ collector + vceSat (mirror of the NPN clamp);
    // replaces only the VCCS below, never the junction above.
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
 * A ZENER'S BREAKDOWN KNEE, WHERE THE CARD STATES THE CURRENT IT IS MEASURED AT.
 *
 * SPICE's diode model takes BV **and IBV**, and those two numbers together pin
 * one point on an exponential rather than describing a corner: ngspice places
 * the junction so that the current is exactly IBV when |Vj| = BV. Inverted,
 * which is the form that needs no solver:
 *
 *     |V| = BV + nVt*ln(I/IBV) + I*RS
 *
 * Measured against ngspice over the whole breakdown region of the corpus card
 * `D(BV=3.3 IBV=5m RS=5)`, five decades of current from 2.2 uA to 162 mA:
 * **worst voltage error 0.186 mV**.
 *
 * WHAT THE PIECEWISE MODEL COSTS. `1/rz` from a corner at vz is a straight line
 * through (vz, 0), so it reads vz + I*rz regardless of how far below the knee
 * the current sits. On ADI2005 v2's zener regulator -- 7.4 V through 8.2 kOhm
 * into this card, about 0.5 mA -- that is 3.3025 V against ngspice's 3.2435 V,
 * and the corpus reported the gap as 5.92e-2 V on 12 decks. The exponential is
 * BELOW BV at currents below IBV, which is the whole of the difference.
 *
 * SOLVED IN LOG SPACE because the relation is implicit in I once RS is present
 * and I spans decades: Newton on ln(I) converges from the RS-free estimate in a
 * handful of steps at any current, where Newton on I itself either overshoots
 * into the negative or crawls. The series resistance is inside the solve rather
 * than stamped separately, so the returned conductance is the SERIES
 * combination -- dV/dI = nVt/I + RS -- and the caller needs no extra node.
 *
 * @returns {[number, number]} the breakdown current magnitude and dI/d|V|
 */
/**
 * THE SERIES RESISTANCE IS THE CARD'S RS, NOT THE PIECEWISE `rz`.
 *
 * They are different quantities that happen to share a default of 5 ohms: `rz`
 * is the slope of the piecewise line through (vz, 0), while SPICE's RS is a real
 * series resistance. The ADI corpus card states RS=5, so reading `rz` here would
 * have matched ngspice BY COINCIDENCE on exactly the decks that motivated this
 * and diverged on the first card stating anything else -- measured, ngspice moves
 * from 3.240815 V at RS=0 to 3.250873 V at RS=20 on that bench while a reader
 * stuck on `rz` returns 3.243367 V for all of them.
 *
 * Read in ONE place for both the stamp and its branch-current twin.
 */
function zenerSeriesR(part, fallback) {
  const rs = Number(part?.params?.rs);
  return Number.isFinite(rs) && rs >= 0 ? rs : fallback;
}

// EXPORTED FOR ITS JACOBIAN, on the same grounds `ebersMollCompanion` is. The
// returned conductance enters only the NEWTON MATRIX -- `iEq = i(V0) - g*V0`
// makes the branch carry exactly `i(V0)` at convergence whatever `g` is -- so
// dropping RS from `dI/d|V|` is invisible in every converged voltage and costs
// only iterations. A mutation doing exactly that passed every voltage assertion
// in this device's suite, which is how the gap was found; it is now held by a
// finite-difference check, the only instrument that can see it.
/**
 * ngspice's own default for a diode card's breakdown knee current.
 *
 * SPICE places the junction so the current is IBV at |Vj| = BV whether or not
 * the card states IBV. Matching the reference means taking the same default:
 * measured on the gallery's zener clamp, a card stating only `BV=5.1` reads
 * 5.199200 V in ngspice against 5.141511 V from the piecewise corner -- 57.7 mV,
 * and the whole of that circuit's disagreement.
 */
const SPICE_DEFAULT_IBV = 1e-3;

/**
 * The knee current a card asks for: a number, SPICE's default, or the piecewise
 * corner.
 *
 *   ibv > 0     that knee current, exponential breakdown
 *   absent      SPICE_DEFAULT_IBV, exponential -- what ngspice does
 *   ibv === 0   the PIECEWISE corner, explicitly asked for
 *
 * The third case is the one that needed saying. An absence and an explicit zero
 * used to mean the same thing, and taking the SPICE default for both would have
 * made the piecewise model UNREACHABLE: `rz` dead, its three-region stamp dead,
 * and no way for a caller to ask for the knee-free device that 2,163 corpus
 * circuits were written against. An absence is a default; a zero is a choice,
 * and collapsing them removes a model rather than adding one.
 */
function zenerKneeCurrent(part) {
  const declared = Number(part?.params?.ibv);
  if (declared === 0) return 0;                      // piecewise, on purpose
  return Number.isFinite(declared) && declared > 0 ? declared : SPICE_DEFAULT_IBV;
}

export function zenerBreakdown(vRev, bv, ibv, rs, nVt) {
  // ln(I) ignoring RS is the starting point; it is exact when RS is 0.
  let lnI = Math.log(ibv) + (vRev - bv) / nVt;
  for (let k = 0; k < 60; k++) {
    const i = Math.exp(lnI);
    const f = bv + nVt * (lnI - Math.log(ibv)) + i * rs - vRev;
    const df = nVt + i * rs;                 // d|V|/d(lnI)
    const step = f / df;
    lnI -= step;
    if (Math.abs(step) < 1e-15) break;
  }
  const i = Math.exp(lnI);
  // dI/d|V| = 1 / (nVt/I + RS), AND NOTHING ELSE.
  //
  // JUNCTION_GMIN was inside this slope for one revision and did nothing at
  // all, which is this engine's own documented trap: the Newton stamp is
  // `iEq = i(V0) - g*V0`, so the branch carries exactly `i(V0)` at convergence
  // whatever `g` is. Adding GMIN to the slope and then building iEq from the
  // same slope cancels it term for term -- a FLOORED CONDUCTANCE IS NOT A
  // PARALLEL CONDUCTANCE, which JUNCTION_GMIN's own note says in as many words.
  //
  // It cost two Si7li decks: a zener whose cathode touches nothing else (its
  // deck's first line is the SPICE title, so the load resistor is eaten) has a
  // node determined ONLY by the junction's leakage. ngspice's exponential
  // carries no current at zero bias, so it puts that node at the anode
  // (-8.000580 V); we clamped it to the piecewise corner instead (-3.878413 V).
  // With GMIN a real parallel conductance in the stamp, the balance
  // `-I_rev(-V) + GMIN*V = 0` determines the node the way the reference does.
  return [i, 1 / (nVt / i + rs)];
}

/**
 * Stamp a Zener diode.
 * Forward: like a regular diode (Vf ≈ 0.7V).
 * Reverse: conducts at Vz (breakdown voltage), maintaining Vz across it.
 * Terminals: anode, cathode.
 */
function stampZener(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages) {
  const vf = effVf(/** @type {number} */ (part.params.vf ?? 0.7)); // vz stays put (see the branch-current twin)
  const vz = /** @type {number} */ (part.params.vz ?? 5.1);
  const rd = 10;
  const rzener = /** @type {number} */ (part.params.rz ?? 5); // zener dynamic R
  // The knee current. ABSENT MEANS "use the piecewise corner": a card that does
  // not state IBV must solve exactly as it did before this branch existed.
  const ibv = zenerKneeCurrent(part);

  const netA = findNet(nets, part.id, 'anode');
  const netC = findNet(nets, part.id, 'cathode');
  const idxA = netA ? nodeIndex.get(netA) : undefined;
  const idxC = netC ? nodeIndex.get(netC) : undefined;

  const vAcross = diodeVoltages.get(part.id) ?? 0;

  let gEq, iEq;
  if (junctionModelOf(part, undefined) === 'shockley' && vAcross >= 0) {
    // An explicit SPICE zener is still an ordinary Shockley junction in the
    // forward direction. Reuse the diode's composite junction+RS law rather
    // than the legacy teaching-model knee. `diodeVoltages` carries junction
    // voltage on this path, exactly as stampDiode's state does.
    ({ gEq, iEq } = diodeCompanion(vAcross, vf, rd, junctionOpts(part)));
  } else if (vAcross >= vf) {
    // Forward conduction
    gEq = 1 / rd;
    iEq = -vf / rd;
  } else if (ibv > 0 && vAcross < 0) {
    // EXPONENTIAL BREAKDOWN, when the card states the knee current.
    //
    // Continuous from zero reverse bias: at |V| well below BV the exponential
    // is e^(-BV/nVt) of IBV, which is indistinguishable from the off region it
    // replaces, so there is no corner to cross and no region test to get wrong.
    // `iEq = i(V0) - g*V0` with i the ANODE-TO-CATHODE current, which is the
    // convention both other branches here use -- checked by substituting the
    // linear model into it and recovering `vz/rzener` exactly.
    const u = -vAcross;
    // AND THE BREAKDOWN USES THE MODEL'S IDEALITY FACTOR, NOT 1. Measured
    // against ngspice at N = 1, 1.5, 1.752 and 2.5: the slope is N*Vt*ln(10) per
    // decade every time, to four figures. The first characterisation of this law
    // missed it because the ADI corpus card states no N -- so N was 1 and the two
    // forms agreed exactly. The gallery's zener states N=1.752, where it is 40 mV
    // of the 57.7.
    const nBreak = Number.isFinite(Number(part.params.n)) && Number(part.params.n) > 0
      ? Number(part.params.n) : 1;
    const [iRev, gRev] = zenerBreakdown(u, vz, ibv, zenerSeriesR(part, rzener),
      nBreak * JUNCTION_THERMAL_VOLTAGE);
    // GMIN AS A PARALLEL CONDUCTANCE, not as a floor on the slope: it goes into
    // the diagonal and NOT into the Norton source, so the branch really carries
    // `-I_rev + GMIN*V` and a node with only this junction on it is determined.
    gEq = gRev + JUNCTION_GMIN;
    iEq = -iRev + gRev * u;
  } else if (vAcross <= -vz) {
    // Zener breakdown, piecewise: a straight line through (vz, 0). Kept for
    // every card that states no IBV, where it is what 2,163 corpus circuits and
    // this suite are written against.
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
/**
 * Smoothed overdrive, C1 and EXACTLY ZERO BELOW CUTOFF.
 *
 *   vov_s = 0                      vov ≤ 0
 *         = δu²(2 − u), u=vov/δ    0 < vov < δ
 *         = vov                     vov ≥ δ
 *
 * The corner still has to be smoothed — a HARD cutoff branch (gOff below
 * Vth, square law above) gave Newton a discontinuous derivative exactly
 * where a near-threshold operating point lives, and the cross-coupled latch
 * orbited 1.84 → cutoff → 5 → fetlim 2.5 → 2.16 → 1.84 forever at every
 * transconductance tried. But the shape that smoothing takes is load-bearing,
 * and the first one chosen — ½·(vov + √(vov² + δ²)) — NEVER REACHES ZERO.
 *
 * A HYPERBOLA'S TAIL IS A CURRENT SOURCE ON A FLOATING NODE. At vov = −1 V,
 * a volt into cutoff, the old form returned vov_s = 6.24e-4 with derivative
 * 6.24e-4, so the device injected id0 = k·vov_s² through its own
 * gm = 2k·vov_s·dvov_s. Both are negligible; their RATIO is not. A node with
 * nothing else on it settles where id0/gm puts it, and that is
 * vov_s/(2·dvov_s) — HALF A VOLT, INDEPENDENT OF k. Making the device weaker
 * does not help, because the phantom current and the phantom conductance
 * shrink together. Corpus deck ADI #699's gate-drain node read −5.155 V
 * against ngspice's 0: not a near miss, a fixed point of the smoothing.
 *
 * At and below threshold this returns 0 with derivative 0, so an off device
 * stamps NOTHING
 * and the node is left to GMIN, which ties it to the reference — the same
 * place ngspice puts it. That is the identical argument MOS_GDS_FLOOR settles
 * for the output conductance; a numerical aid must not out-argue GMIN on a
 * node it does not own.
 *
 * Above +δ it is the SQUARE LAW EXACTLY, where the old form ran 0.2 mV high at
 * vov = 3 V. The one-sided cubic is C1 at both joins: value and slope are
 * zero at cutoff, and value δ / slope one at the square-law join. Unlike the
 * former symmetric parabola, it therefore cannot manufacture current at the
 * exact Level-1 threshold.
 *
 * Returns [vov_s, d(vov_s)/d(vov)].
 */
/**
 * HALF-WIDTH OF THE THRESHOLD BLEND, AND THE ERROR IT COSTS.
 *
 * The blend exists because a HARD cutoff branch gave Newton a discontinuous
 * derivative exactly where a near-threshold operating point lives: the
 * cross-coupled latch orbited 1.84 -> cutoff -> 5 -> fetlim 2.5 -> 2.16 -> 1.84
 * forever, at every transconductance tried. That reason has not gone away.
 *
 * BUT THE WIDTH IS AN ERROR TERM, AND IT WAS THE LARGEST ONE LEFT. Wherever a
 * device sits AT threshold with only leakage to balance it, the operating point
 * lands inside the band and the answer is wrong by of order delta. ADI2005 v3
 * row 187, an NMOS cascode: M1 is a volt below threshold and cut off, so CASC is
 * held only by leakage, and M2 settles wherever its blended current matches it.
 * ngspice puts CASC at 0.799205 V -- M2 exactly at threshold -- and we put it
 * 48 mV higher, M2 48 mV BELOW threshold, which is delta.
 *
 * Proven by sweeping the one number the mechanism turns on, on a
 * Miller-compensated op-amp bench:
 *
 *   delta = 0.05    worst error 4.88e-2 V
 *   delta = 0.02    worst error 2.00e-2 V
 *   delta = 0.005   worst error 5.98e-3 V
 *
 * Linear in delta, over a factor of ten. So this is not a modelling subtlety in
 * four topologies, it is one constant, and it accounted for all 69 remaining
 * MOSFET numeric disagreements in a 2,000-deck sample.
 *
 * 5 mV is chosen because it is the smallest value that keeps the corpus and the
 * full suite green -- including the latch the blend was introduced for -- not
 * because it is small. The measurement for the value it replaced is above; the
 * measurement for this one is in the commit that changed it.
 */
const MOS_SMOOTH_DELTA = 0.005;

/**
 * SUBTHRESHOLD CONDUCTION, WHERE A MODEL CARD DECLARES IT.
 *
 * LTspice's power MOSFETs are `VDMOS` models, and ngspice implements those with
 * real subthreshold conduction governed by `Ksubthres`. Our level-1 stamp cuts
 * off exactly (see smoothVov below, and that IS right for a level-1 card --
 * measured, ngspice's own level-1 MOS sits flat at 5e-12 right up to threshold).
 * So this branch is opt-in on the declared parameter and changes nothing for a
 * card without one.
 *
 * THE SHAPE WAS CHARACTERISED AGAINST ngspice, NOT COPIED FROM IT. A DC sweep of
 * `.model VD VDMOS(Vto=1 Kp=0.12 Ksubthres=0.1)` from Vgs 0.2 to 1.4 V, fitted:
 *
 *     Vov_eff = Ksub * ln(1 + exp(Vov / Ksub))        the SOFT-PLUS
 *     Id      = the ordinary square law on Vov_eff
 *
 * agrees with ngspice to **0.000 %** across 19 of 25 points, the residual 2.9 %
 * appearing only at 6.9e-11 A where ngspice's own leakage floor dominates. Two
 * independent consequences of that form were confirmed separately:
 *
 *   - deep subthreshold, Vov_eff -> Ksub*exp(Vov/Ksub), so Id ~ exp(2Vov/Ksub)
 *     and the slope is Ksub*ln(10)/2 V/decade. Measured at Ksub = 0.1, 0.2, 0.3
 *     and 0.5: every one within 0.2 % of that law.
 *   - above threshold Vov_eff -> Vov EXACTLY, so the square law is untouched --
 *     which is why VDMOS and our level-1 already agreed to five significant
 *     figures for Vgs >= 1.75 V, and why 80 of the 84 corpus decks with a VDMOS
 *     in play agreed before this existed.
 *
 * WHY THE TAIL IS ACCEPTABLE HERE, when smoothVov's note rejects a shape that
 * never reaches zero. That objection is about out-arguing GMIN: the old
 * hyperbola left a floating node at vov_s/(2*dvov_s) = HALF A VOLT regardless of
 * k, and ngspice put it at 0. The soft-plus has the same kind of tail -- its
 * ratio is Ksub/2 -- but it is ngspice's OWN tail, with ngspice's own slope, so a
 * node held only by this device settles where the reference settles it instead of
 * somewhere we invented. Matching the oracle is the whole point; the objection
 * was never to tails as such.
 */
function softPlusVov(vov, ksub) {
  const x = vov / ksub;
  // For large x the soft-plus IS the identity to within double precision, and
  // taking the exponential there would overflow for no gain.
  if (x > 40) return [vov, 1];
  const e = Math.exp(x);
  return [ksub * Math.log1p(e), e / (1 + e)];
}

/**
 * The declared subthreshold slope, or 0 for "this card has none".
 *
 * Read in ONE place and passed to every `smoothVov` call, because the six call
 * sites (nmos/pmos x the region FSM x the bias-point walker) must agree about
 * the same device -- a parameter threaded through five of six is a stamp whose
 * current and Jacobian describe different transistors.
 */
function mosKsubthres(part) {
  const k = Number(part?.params?.ksubthres);
  return Number.isFinite(k) && k > 0 ? k : 0;
}

function smoothVov(vov, ksub = 0) {
  if (ksub > 0) return softPlusVov(vov, ksub);
  if (vov <= 0) return [0, 0];
  if (vov >= MOS_SMOOTH_DELTA) return [vov, 1];
  const u = vov / MOS_SMOOTH_DELTA;
  return [MOS_SMOOTH_DELTA * u * u * (2 - u), u * (4 - 3 * u)];
}

/**
 * Stamp the two bulk junctions of a MOSFET whose bulk the deck tied to the
 * reference. See `mosBulkJunction` for why these exist and what they are worth.
 *
 * The polarity falls out of the state convention `mosVsb`/`mosVdb` already use.
 * An n-channel's bulk is p-type, so the junction runs bulk(anode) -> source
 * (cathode) and its forward voltage is 0 - V(source). A p-channel's bulk is
 * n-type, so it runs source(anode) -> bulk(cathode) and its forward voltage is
 * V(source) - 0. Both maps store V(source) negated for a p-channel, so in BOTH
 * cases the junction sees `-state`; only which end of the diode the node is
 * differs, and that is the one sign below.
 */
function stampMosBulkDiodes(A, b, part, nets, nodeIndex, groundNetId, idxS, idxD, mosVsb, mosVdb, mosVds) {
  // BULK TIED TO THE SOURCE IS ALSO A KNOWN BULK POTENTIAL.
  //
  // It shorts the bulk-SOURCE junction -- which is why that case needs no
  // threshold shift -- but NOT the bulk-drain one, and that is live whenever
  // the drain goes below the source. ADI2005 v3 row 4654 is the case in three
  // lines:
  //
  //   M1 VDD VDD 3 3 NMOS  /  V1 3 0 5
  //
  // a diode-connected device whose source and bulk sit at 5 V with its
  // drain/gate node dangling. Measured:
  //
  //   bulk at 5 V, as written    ngspice V(VDD) = 4.999380
  //   bulk moved to node 0       ngspice V(VDD) = 3.36e-19   <- our old answer
  //   bulk at 5 V, IS = 1e-30    ngspice V(VDD) = 5.000000   <- pure GMIN tie
  //
  // The junction's own forward drop is the 0.62 mV, and its ABSENCE was the
  // whole 5 V. 6 of the 24 remaining numeric disagreements in the full
  // 12,471-deck corpus are this one shape.
  //
  // The bulk node here IS the source node, so the drain junction is stamped
  // between `idxS` and `idxD` and sees -Vds: for an n-channel the bulk is
  // p-type and the junction runs bulk->drain, so its forward voltage is
  // V(source) - V(drain) = -Vds; for a p-channel every sign is already stored
  // inverted, so it is -Vds there too. One expression, both channel types --
  // the same coincidence the grounded-bulk case relies on.
  // A THREE-TERMINAL MOSFET'S BULK IS ON ITS SOURCE, and saying nothing about
  // it is not the same as it having none.
  //
  // The engine's ordinary `nmos`/`pmos` symbols declare `gate, drain, source`;
  // imported four-terminal devices may additionally declare `bulk`. The
  // three-terminal parts once carried NEITHER flag and stamped no junction -- while
  // the SPICE exporter writes them `M<ref> <d> <g> <s> <s>`, bulk on source,
  // which in ngspice carries a drain-bulk junction. Engine and deck were
  // different devices, and the gallery's `pc39-nmos-switch` is where it shows:
  // an open switch leaves the drain floating, held only by leak paths, and our
  // drain sat at 4.301317 V against ngspice's 4.245149 V.
  //
  // It went unseen because the blanket node shunt was standing in for the
  // missing junction -- a 1e-12 tie to ground where the junction's own GMIN
  // should have been. Removing that shunt is what exposed it, which is the
  // usual shape: a convergence removes the compensation and the original defect
  // becomes visible for the first time.
  //
  // THE ONE CASE THE DEFAULT MUST NOT CAPTURE is a deck that ties the bulk to
  // some THIRD node. The importer declines those -- it will not invent a
  // potential -- and marks them `bulkUnplaced`, which is why that flag exists
  // rather than the decline living only in a warning: a part whose refusal is
  // not in its params arrives here indistinguishable from one that said nothing
  // and would take the default, guessing the very potential we refused.
  //
  // Keying this off the terminal list instead was my first attempt and it does
  // not work: `nmos` is registered with exactly `gate, drain, source`, so a
  // four-terminal one cannot be built and the guard could never fire.
  if (part.params?.bulkUnplaced) return;
  const netB = findNet(nets, part.id, 'bulk');
  const explicitBulk = netB !== undefined;
  const idxB = netB ? nodeIndex.get(netB) : undefined;
  if (explicitBulk) {
    if (!mosVsb || !mosVdb) return;
    const nodeIsCathode = part.kind === 'nmos' ? 1 : -1;
    const one = (idx, state) => {
      if (idx === undefined) return;
      const {gEq, iEq} = mosBulkJunction(-(state ?? 0), part.params);
      A.add(idx, idx, gEq);
      if (idxB !== undefined) {
        A.add(idxB, idxB, gEq);
        A.add(idx, idxB, -gEq);
        A.add(idxB, idx, -gEq);
        b[idxB] -= nodeIsCathode * iEq;
      }
      b[idx] += nodeIsCathode * iEq;
    };
    one(idxS, mosVsb.get(part.id));
    one(idxD, mosVdb.get(part.id));
    return;
  }
  if (part.params?.bulkOnSource || !part.params?.bulkAtGround) {
    // A SOURCE AT THE REFERENCE HAS NO ROW, AND THAT IS NOT A REASON TO SKIP
    // THE JUNCTION.
    //
    // `idxS` is `undefined` whenever the source sits on the ground net, because
    // the reference is implicit and has no matrix row. The guard here required
    // BOTH indices, so the branch returned without stamping for the commonest
    // MOSFET wiring there is -- a grounded source. That is why the
    // `pc39-nmos-switch` drain kept reading 4.301317 V after the bulk-on-source
    // default was added: the default was reached and the stamp was not.
    //
    // Only the drain is needed. With the source at the reference the junction is
    // between the drain node and ground, which is a diagonal-and-RHS stamp.
    if (idxD === undefined || !mosVds) return;
    const vds = mosVds.get(part.id) ?? 0;
    const { gEq, iEq } = mosBulkJunction(-vds, part.params);
    const nodeIsCathode = part.kind === 'nmos' ? 1 : -1;
    A.add(idxD, idxD, gEq);
    b[idxD] += nodeIsCathode * iEq;
    if (idxS !== undefined) {
      A.add(idxS, idxS, gEq);
      A.add(idxD, idxS, -gEq);
      A.add(idxS, idxD, -gEq);
      b[idxS] -= nodeIsCathode * iEq;
    }
    return;
  }
  if (!part.params?.bulkAtGround) return;
  if (!mosVsb || !mosVdb) return;
  const idxGround = groundNetId !== undefined && groundNetId !== null
    ? nodeIndex.get(groundNetId) : undefined;
  // +1 when the DEVICE NODE is the cathode (n-channel), -1 when it is the anode.
  const nodeIsCathode = part.kind === 'nmos' ? 1 : -1;
  const one = (idx, state) => {
    if (idx === undefined) return;
    const { gEq, iEq } = mosBulkJunction(-(state ?? 0), part.params);
    A.add(idx, idx, gEq);
    if (idxGround !== undefined) {
      A.add(idxGround, idxGround, gEq);
      A.add(idx, idxGround, -gEq);
      A.add(idxGround, idx, -gEq);
      b[idxGround] -= nodeIsCathode * iEq;
    }
    b[idx] += nodeIsCathode * iEq;
  };
  one(idxS, mosVsb.get(part.id));
  one(idxD, mosVdb.get(part.id));
}

function stampNMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, region = 'saturation', mosVds, mosVsb, mosVdb) {
  // ONE definition of the threshold, read by the stamp, the region FSM and the
  // extraction alike. Three readers of one number is how the vceSat split
  // happened; this one is a function call in all three places.
  const vth = mosVth({...part.params, bulkExplicit: findNet(nets, part.id, 'bulk') !== undefined},
    mosVsb ? (mosVsb.get(part.id) ?? 0) : 0);
  const k = /** @type {number} */ (mosK(part.params)); // k, or KP/2*(W/L)

  const netG = findNet(nets, part.id, 'gate');
  const netD = findNet(nets, part.id, 'drain');
  const netS = findNet(nets, part.id, 'source');

  const idxG = netG ? nodeIndex.get(netG) : undefined;
  const idxD = netD ? nodeIndex.get(netD) : undefined;
  const idxS = netS ? nodeIndex.get(netS) : undefined;

  const vgs = diodeVoltages.get(part.id) ?? 0;

  stampMosBulkDiodes(A, b, part, nets, nodeIndex, groundNetId, idxS, idxD, mosVsb, mosVdb, mosVds);

  if (region === 'triode') {
    // THE LEVEL-1 LINEAR REGION, WITH ITS SECOND TERM.
    //
    // This was `gOn = 2K*Vov`, a plain resistor — the SMALL-Vds limit of the
    // triode law with the `-Vds^2` term dropped. That term is not a
    // refinement: at the saturation boundary, where Vds = Vov, it is half the
    // current. Measured on an ADI cascode at Vov = 0.35 V, RD = 36k, the
    // engine passed 240 uA where the deck's own numbers and ngspice give 125,
    // and the collapsed drain then held the device in triode so it never
    // recovered — a wrong model that also picks the wrong region.
    //
    //   Id  = K*(2*Vov*Vds - Vds^2)
    //   gds = dId/dVds = 2K*(Vov - Vds)
    //   gm  = dId/dVgs = 2K*Vds*dVov
    //
    // At Vds = Vov this returns K*Vov^2 and gds = 0, which is exactly the
    // saturation value — so the two regions now meet, and the FSM's hysteresis
    // is about which side to linearise on, not about a step in the current.
    const [vovS, dVovS] = smoothVov(vgs - vth, mosKsubthres(part));
    const vds = mosVds ? (mosVds.get(part.id) ?? 0) : 0;
    // Clamped at the boundary: past Vds = Vov the parabola turns over and
    // would report a FALLING current, which is what saturation replaces.
    const vdsEff = Math.min(Math.max(vds, 0), Math.max(vovS, 0));
    const tri = mosTriode(k, vovS, vdsEff, dVovS, part.params);
    const idTri = tri.id;
    const gds = tri.gds + MOS_GDS_FLOOR;
    const gm = tri.gm;
    // THE OFFSET MUST USE THE POINT THE CURRENT WAS EVALUATED AT.
    //
    // The companion is I(v) = idTri(vdsEff) + gds*(v - vdsEff), so the Norton
    // term is `idTri - gds*vdsEff`. Using the RAW `vds` injected current
    // whenever the clamp bit — and it bites exactly when the drain is on the
    // wrong side, `vds < 0`, where vdsEff is 0 and the raw value is negative.
    // Measured on a CMOS NAND with both inputs low: OUT settled at 5.431579 V
    // on a 5 V supply, 0.43 V ABOVE every source in the circuit, against
    // ngspice's 5.000000.
    const iEq = idTri - gm * vgs - gds * vdsEff;

    if (idxD !== undefined) A.add(idxD, idxD, gds);
    if (idxS !== undefined) A.add(idxS, idxS, gds);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gds);
      A.add(idxS, idxD, -gds);
    }
    if (idxD !== undefined && idxG !== undefined) A.add(idxD, idxG, gm);
    if (idxD !== undefined && idxS !== undefined) A.add(idxD, idxS, -gm);
    if (idxS !== undefined && idxG !== undefined) A.add(idxS, idxG, -gm);
    if (idxS !== undefined) A.add(idxS, idxS, gm);
    if (idxD !== undefined) b[idxD] -= iEq;
    if (idxS !== undefined) b[idxS] += iEq;
  } else {
    // On: Id = K·vov_s². Linearized about the smoothed overdrive:
    // gm = dId/dVgs = 2K·vov_s·(dvov_s/dvov); Norton offset from Id at
    // the expansion point.
    const [vovS, dVovS] = smoothVov(vgs - vth, mosKsubthres(part));
    const gm = 2 * k * vovS * dVovS;
    const id0 = k * vovS * vovS;
    const iEq = id0 - gm * vgs;

    // VCCS: drain current controlled by Vgs
    if (idxD !== undefined && idxG !== undefined) A.add(idxD, idxG, gm);
    if (idxD !== undefined && idxS !== undefined) A.add(idxD, idxS, -gm);
    if (idxS !== undefined && idxG !== undefined) A.add(idxS, idxG, -gm);
    if (idxS !== undefined && idxS !== undefined) A.add(idxS, idxS, gm);

    if (idxD !== undefined) b[idxD] -= iEq;
    if (idxS !== undefined) b[idxS] += iEq;

    // Output conductance, activated by the SAME threshold blend derivative
    // as gm.  This is exactly zero below the blend and exactly one above it;
    // vov/(vov+5mV) never reached one and therefore suppressed an explicitly
    // stated LAMBDA at every ordinary operating point.
    // A fixed 1 kΩ made a
    // sub-threshold drain a 1k/10k divider (0.458 V on the latch bench)
    // and the deep-cutoff branch that used to switch it to 1 nS was a
    // second Newton corner — the branch is gone; this expression IS the
    // cutoff behaviour (gds → the 1 nS leak as vov_s → 0).
    const gds = mosGds(part.params, id0, dVovS);
    if (idxD !== undefined) A.add(idxD, idxD, gds);
    if (idxS !== undefined) A.add(idxS, idxS, gds);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gds);
      A.add(idxS, idxD, -gds);
    }
  }
}

/** P-channel MOSFET: mirror of NMOS with reversed gate sense. */
function stampPMOS(A, b, part, nets, nodeIndex, groundNetId, diodeVoltages, region = 'saturation', mosVds, mosVsb, mosVdb) {
  // See stampNMOS. A p-channel's Vsb is V(bulk) - V(source); with the bulk at
  // ground and the source above it that is negative, i.e. a forward-biased
  // body junction, and `mosVth` clamps it to the no-shift case rather than
  // extrapolating a model that has no business there.
  const vth = mosVth({ ...part.params, vth: part.params.vth ?? -2.0,
    bulkExplicit: findNet(nets, part.id, 'bulk') !== undefined },
    mosVsb ? (mosVsb.get(part.id) ?? 0) : 0);
  const k = /** @type {number} */ (mosK(part.params)); // k, or KP/2*(W/L)

  const netG = findNet(nets, part.id, 'gate');
  const netD = findNet(nets, part.id, 'drain');
  const netS = findNet(nets, part.id, 'source');

  const idxG = netG ? nodeIndex.get(netG) : undefined;
  const idxD = netD ? nodeIndex.get(netD) : undefined;
  const idxS = netS ? nodeIndex.get(netS) : undefined;

  // For PMOS: Vsg > |Vth| to turn on
  const vsg = diodeVoltages.get(part.id) ?? 0;

  stampMosBulkDiodes(A, b, part, nets, nodeIndex, groundNetId, idxS, idxD, mosVsb, mosVdb, mosVds);

  if (region === 'triode') {
    // The level-1 linear region with its second term — see the NMOS note.
    // The stored variables are Vsg and Vsd, so every sign is already the
    // NMOS one and only the terminal roles swap.
    const [vovSt, dVovSt] = smoothVov(vsg - Math.abs(vth), mosKsubthres(part));
    const vsd = mosVds ? (mosVds.get(part.id) ?? 0) : 0;
    const vsdEff = Math.min(Math.max(vsd, 0), Math.max(vovSt, 0));
    const tri = mosTriode(k, vovSt, vsdEff, dVovSt, part.params);
    const idTri = tri.id;
    const gds = tri.gds + MOS_GDS_FLOOR;
    const gm = tri.gm;
    const iEq = idTri - gm * vsg - gds * vsdEff;   // see the NMOS note

    if (idxD !== undefined) A.add(idxD, idxD, gds);
    if (idxS !== undefined) A.add(idxS, idxS, gds);
    if (idxD !== undefined && idxS !== undefined) {
      A.add(idxD, idxS, -gds);
      A.add(idxS, idxD, -gds);
    }
    // Source-referenced VCCS, mirrored: current flows S -> D.
    if (idxS !== undefined && idxS !== undefined) A.add(idxS, idxS, gm);
    if (idxS !== undefined && idxG !== undefined) A.add(idxS, idxG, -gm);
    if (idxD !== undefined && idxS !== undefined) A.add(idxD, idxS, -gm);
    if (idxD !== undefined && idxG !== undefined) A.add(idxD, idxG, gm);
    if (idxS !== undefined) b[idxS] -= iEq;
    if (idxD !== undefined) b[idxD] += iEq;
  } else {
    const [vovS, dVovS] = smoothVov(vsg - Math.abs(vth), mosKsubthres(part));
    const gm = 2 * k * vovS * dVovS;
    const id0 = k * vovS * vovS;
    const iEq = id0 - gm * vsg;

    // PMOS: current flows source → drain (reversed from NMOS)
    if (idxS !== undefined && idxS !== undefined) A.add(idxS, idxS, gm);
    if (idxS !== undefined && idxG !== undefined) A.add(idxS, idxG, -gm);
    if (idxD !== undefined && idxS !== undefined) A.add(idxD, idxS, -gm);
    if (idxD !== undefined && idxG !== undefined) A.add(idxD, idxG, gm);

    if (idxS !== undefined) b[idxS] -= iEq;
    if (idxD !== undefined) b[idxD] += iEq;

    // Output conductance from the model — see the NMOS note and `mosGds`.
    const gds = mosGds(part.params, id0, dVovS);
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
 * Output limiting (spec-updates/opamp-output-limit.md): `rout` puts the ideal
 * source behind a finite output resistance, and `iShort` (default 40 mA, the
 * LM358/TL07x-class datasheet figure) gives the output a short-circuit current
 * limit. In the ilim± regions the row stops constraining a voltage and
 * constrains the branch CURRENT instead, which is what a real output stage in
 * current limit does: the loop is lost and the output collapses to i·Rload.
 *
 * Regression note: the previous implementation allocated a source row it never
 * stamped — a guaranteed-singular matrix, silently caught, returning all-zero
 * voltages for ANY circuit containing an op-amp.
 */
function stampOpamp(A, b, part, nets, nodeIndex, groundNetId, vsIndex, opampRegions, vcc, srcScale = 1) {
  const gain = /** @type {number} */ (part.params.gain ?? 1e6);
  // Rails scale with source stepping, explicit params included — the FSM
  // in the Newton loop scales the same way, and disagreement between the
  // two is a region that can never settle.
  const railLow = /** @type {number} */ (part.params.railLow ?? 0) * srcScale;
  const railHigh = /** @type {number} */ (part.params.railHigh ?? vcc) * srcScale;

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
  if (region === 'ilim+' || region === 'ilim-') {
    // Output current limit: the row constrains the BRANCH CURRENT, not a
    // voltage. i is positive INTO the output pin, so ilim+ is the part
    // sinking its full short-circuit current and ilim− is it sourcing.
    const iMax = outputCurrentLimit(part) * srcScale;
    A.set(row, row, 1);
    b[row] = region === 'ilim+' ? iMax : -iMax;
    return;
  }
  // Finite output resistance: the ideal source sits behind rout, and the
  // branch variable is the current into the pin, so V(out) = Videal + rout·i.
  // rout = 0 (the default) reduces this to the ideal row exactly.
  const rout = /** @type {number} */ (part.params.rout ?? 0);
  if (region === 'linear') {
    // V(out) − rout·i − gain·(V(inp) − V(inn)) = 0
    A.set(row, idxO, 1);
    if (rout !== 0) A.add(row, row, -rout);
    if (idxP !== undefined) A.add(row, idxP, -gain);
    if (idxN !== undefined) A.add(row, idxN, gain);
    b[row] = 0;
  } else {
    // Saturated at a rail: V(out) − rout·i = rail
    A.set(row, idxO, 1);
    if (rout !== 0) A.add(row, row, -rout);
    b[row] = region === 'high' ? railHigh : railLow;
  }
}

/**
 * Output short-circuit current limit, in amps, for an op-amp or a railed
 * vcvs. An explicit `params.iShort` wins (0 or negative disables the limit
 * entirely — the ideal source of before); an op-amp that declares nothing
 * gets the LM358/TL07x-class datasheet figure, because an op-amp that can
 * hold 2.5 V into 1 Ω teaches the wrong electronics. A vcvs is a modelling
 * primitive and stays ideal unless asked.
 */
export const OPAMP_ISHORT_DEFAULT = 0.040;
function outputCurrentLimit(part) {
  const declared = part.params?.iShort;
  if (declared !== undefined && declared !== null) {
    return typeof declared === 'number' && declared > 0 ? declared : 0;
  }
  return part.kind === 'opamp' ? OPAMP_ISHORT_DEFAULT : 0;
}

/**
 * Controlled voltage source (spec-updates/controlled-sources.md):
 * V(outp) − V(outn) = gain·(V(inp) − V(inn)), branch current in the row.
 * Control pins are ideal (no loading). With rails declared, the shared
 * op-amp region FSM clamps the output at railLow/railHigh (× srcScale,
 * consistent with source stepping).
 */
function stampVCVS(A, b, part, nets, nodeIndex, vsIndex, opampRegions, srcScale = 1) {
  const vsIdx = vsIndex.get(part.id);
  if (vsIdx === undefined) return;
  const row = nodeIndex.size + vsIdx;
  const gain = /** @type {number} */ (part.params.gain ?? 1);
  const idx = (t) => {
    const n = findNet(nets, part.id, t);
    return n ? nodeIndex.get(n) : undefined;
  };
  const iOp = idx('outp');
  const iOn = idx('outn');
  if (iOp !== undefined) A.add(iOp, row, 1);
  if (iOn !== undefined) A.add(iOn, row, -1);
  const region = opampRegions.get(part.id) ?? 'linear';
  if (region === 'ilim+' || region === 'ilim-') {
    // Same contract as the op-amp: the row holds the branch current.
    const iMax = outputCurrentLimit(part) * srcScale;
    A.set(row, row, 1);
    b[row] = region === 'ilim+' ? iMax : -iMax;
    return;
  }
  if (iOp !== undefined) A.add(row, iOp, 1);
  if (iOn !== undefined) A.add(row, iOn, -1);
  const rout = /** @type {number} */ (part.params.rout ?? 0);
  if (rout !== 0) A.add(row, row, -rout);
  if (region === 'linear') {
    const iIp = idx('inp');
    const iIn = idx('inn');
    if (iIp !== undefined) A.add(row, iIp, -gain);
    if (iIn !== undefined) A.add(row, iIn, gain);
    b[row] = 0;
  } else {
    const railLow = /** @type {number} */ (part.params.railLow ?? 0) * srcScale;
    const railHigh = /** @type {number} */ (part.params.railHigh ?? 5) * srcScale;
    b[row] = region === 'high' ? railHigh : railLow;
  }
}

/**
 * Controlled current source: gm·(V(inp) − V(inn)) injected INTO outp,
 * out of outn. With iMax declared, the clamp FSM pins the output current
 * at ±iMax (the macromodel's slew limit).
 */
function stampVCCS(A, b, part, nets, nodeIndex, vccsClamps) {
  const gm = /** @type {number} */ (part.params.gm ?? 1e-3);
  const idx = (t) => {
    const n = findNet(nets, part.id, t);
    return n ? nodeIndex.get(n) : undefined;
  };
  const iOp = idx('outp');
  const iOn = idx('outn');
  const region = vccsClamps?.get(part.id) ?? 'linear';
  if (region !== 'linear') {
    const iMax = /** @type {number} */ (part.params.iMax);
    const iClamp = region === 'clamp+' ? iMax : -iMax;
    if (iOp !== undefined) b[iOp] += iClamp;
    if (iOn !== undefined) b[iOn] -= iClamp;
    return;
  }
  const iIp = idx('inp');
  const iIn = idx('inn');
  // Injection into outp = +gm·vin → LHS: A[outp][inp] −= gm, etc.
  if (iOp !== undefined && iIp !== undefined) A.add(iOp, iIp, -gm);
  if (iOp !== undefined && iIn !== undefined) A.add(iOp, iIn, gm);
  if (iOn !== undefined && iIp !== undefined) A.add(iOn, iIp, gm);
  if (iOn !== undefined && iIn !== undefined) A.add(iOn, iIn, -gm);
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
  // A small series term on the branch diagonal: V(a)-V(b) - I*R = vStored.
  // As a PURE source row, a discharged cap wired straight across the rails
  // asserted V(rail)=0 against the supply's V(rail)=5 — overdetermined, and
  // elimination let the CAP win: the whole eater6502 bench read a dead rail
  // at every instant (2026-08-17). With 0.1 mΩ in the row, the supply wins,
  // the cap takes the inrush, and a charged cap under mA-scale load holds
  // its voltage to ~0.3 µV — inside the solver suite's 1e-6 contract.
  A.set(row, row, -1e-4);
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
 * Exact SPICE tags preserve their authored contracts independently of the
 * native function-generator shapes: `spice-pulse`, `spice-pwl`, `spice-exp`,
 * and `spice-sine`. A waveform's optional `dcValue` is deliberately ignored
 * here; it belongs to DC initialization, not evaluation at transient t=0.
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
  if (wave === 'spice-pulse') return spicePulseVoltage(p, tSeconds);
  if (wave === 'spice-pwl') return spicePwlValue(p, tSeconds);
  if (wave === 'spice-exp') return spiceExpValue(p, tSeconds);
  if (wave === 'spice-sine') return spiceSineValue(p, tSeconds);

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

/**
 * Evaluate an independent current source using the same exact waveform
 * contracts as a voltage source. The temporary view deliberately maps amps
 * to volts: sourceVoltage is unit-agnostic arithmetic, while the stamps retain
 * the distinct terminal/current convention.
 */
export function sourceCurrent(part, tSeconds, fallback = 0.001) {
  const params = part.params ?? {};
  return sourceVoltage({ ...part, params: { ...params, volts: params.amps ?? fallback } },
    tSeconds, fallback);
}

/** Explicit DC-analysis value, kept distinct from a waveform's value at t=0. */
export function sourceDcValue(part, fallback) {
  const p = part.params ?? {};
  const wave = String(p.wave ?? 'dc').toLowerCase();
  if (wave === 'dc') return part.kind === 'isource' ? Number(p.amps ?? fallback) : Number(p.volts ?? fallback);
  if (typeof p.dcValue !== 'number' || !Number.isFinite(p.dcValue)) {
    throw new Error(`time-varying source ${part.id} requires an explicit finite dcValue for DC bias`);
  }
  return p.dcValue;
}

// ─── Independent sources ────────────────────────────────────────────────────

/**
 * Independent voltage source. Terminals: pos, neg.
 * Params: {volts} — DC value; plus the waveform params of `sourceVoltage`
 * for time-varying operation (sine/square/triangle/pulse).
 */
function stampIndependentVSource(A, b, part, nets, nodeIndex, groundNetId, vsIndex, vcc, tSeconds = 0, controls = null, srcScale = 1, dcSources = false) {
  // Control value overrides params.volts for interactive adjustment (bench supply knob)
  let volts;
  if (part._ccClampedVolts !== undefined) {
    volts = part._ccClampedVolts;
  } else if (controls && controls.has(part.id)) {
    volts = controls.get(part.id);
  } else {
    volts = dcSources ? sourceDcValue(part, vcc) : sourceVoltage(part, tSeconds, vcc);
  }
  volts *= srcScale;
  const posNet = findNet(nets, part.id, 'pos');
  const negNet = findNet(nets, part.id, 'neg');

  const idxPos = posNet ? nodeIndex.get(posNet) : undefined;
  const idxNeg = negNet ? nodeIndex.get(negNet) : undefined;
  const vsIdx = vsIndex.get(part.id);
  if (vsIdx === undefined) return;

  const dim = nodeIndex.size;
  const row = dim + vsIdx;

  // V(pos) - V(neg) - rInternal·I = volts. With rInternal absent the
  // source is ideal, as before. rInternal was ACCEPTED on vsource for as
  // long as the gallery has carried `battery` benches — the UI resolves
  // that legacy kind to vsource ("same physics, older word", which is
  // only true at zero internal resistance) — and then silently dropped:
  // eight benches and the four German source-resistance lessons
  // (pc77–pc80) solved with ideal sources under documents teaching
  // exactly the loaded-terminal-voltage effect. Found by the
  // EXPECTED-quantities gate; the bw-board `battery` DEVICE always
  // honored it (referenced-drives oracle), so the gap was this stamp.
  if (idxPos !== undefined) {
    A.set(row, idxPos, 1);
    A.set(idxPos, row, 1);
  }
  if (idxNeg !== undefined) {
    A.set(row, idxNeg, -1);
    A.set(idxNeg, row, -1);
  }
  const rInt = Number(part.params?.rInternal) || 0;
  if (rInt > 0) A.set(row, row, -rInt);
  b[row] = volts;
}

/**
 * Independent current source. Terminals: pos, neg.
 * Current flows from neg to pos (conventional).
 * Params: {amps} — the source current.
 */
function stampCurrentSource(A, b, part, nets, nodeIndex, groundNetId, tSeconds = 0, srcScale = 1, dcSources = false) {
  const amps = (dcSources ? sourceDcValue(part, 0.001) : sourceCurrent(part, tSeconds)) * srcScale;
  const posNet = findNet(nets, part.id, 'pos');
  const negNet = findNet(nets, part.id, 'neg');

  const idxPos = posNet ? nodeIndex.get(posNet) : undefined;
  const idxNeg = negNet ? nodeIndex.get(negNet) : undefined;

  // Current source: inject current into pos, extract from neg
  if (idxPos !== undefined) b[idxPos] += amps;
  if (idxNeg !== undefined) b[idxNeg] -= amps;
}

export { Matrix, solve, diodeCompanion, findNet };
// Small-signal linearization helpers for the AC analysis (src/ac.js):
// the AC stamps MUST evaluate the same models as the DC stamps, so the
// model functions are shared rather than re-derived there.
export { junctionOpts, pwlKneeCurrent, smoothVov, MOS_SMOOTH_DELTA };
export { shockleyParams, shockleyEval, shockleyJunctionFromTotal };
