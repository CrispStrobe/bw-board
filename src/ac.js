/**
 * True small-signal AC analysis (spec-updates/ac-small-signal.md).
 *
 * Every nonlinear device is linearized at the DC operating point; C and L
 * stamp complex admittances (jωC, 1/jωL); every independent source, MCU
 * pin drive, and device drive is KILLED (its Thévenin collapses to its
 * output conductance) except the one swept source, which drives a unit
 * phasor. The complex system G + jB is solved as the real-equivalent
 * bordered form
 *
 *     [ G  −B ] [xr]   [br]
 *     [ B   G ] [xi] = [bi]
 *
 * so the EXISTING sparse LU does the complex solve — and since only the
 * VALUES change with ω (never the pattern), every frequency point after
 * the first is a numeric refactor.
 *
 * The linearizations evaluate the same model functions the DC stamps use
 * (imported from mna.js) — an AC answer computed from a different model
 * than the operating point is a plausible wrong Bode plot.
 *
 * @module
 */

import {
  findNet, junctionOpts, pwlKneeCurrent, smoothVov, MOS_SMOOTH_DELTA,
  shockleyParams, shockleyEval, shockleyJunctionFromTotal,
} from './mna.js';
import { CooMatrix, SparseLU, toCSC } from './sparse.js';
import { getDevice } from './devices.js';

const VT = 0.02585;

/**
 * Small-signal junction conductance at the operating voltage — the exact
 * derivative of the model the DC stamp used (C1 knee or Shockley).
 */
function junctionG(part, vAcross, vf, rd) {
  const opts = junctionOpts(part);
  if (!opts) {
    // C1 PWL knee: derivative of pwlKneeCurrent.
    const EPS = 0.025;
    if (vAcross < vf - EPS) return 1e-9;
    if (vAcross > vf + EPS) return 1 / rd;
    return (vAcross - vf + EPS) / (2 * EPS * rd);
  }
  // Composite small-signal conductance: junction gj behind rs, evaluated
  // at the operating TOTAL voltage — the same composite the DC stamp uses.
  const p = shockleyParams(opts, vf);
  const vJ = shockleyJunctionFromTotal(vAcross, Math.min(vAcross, vf), p);
  const { gj } = shockleyEval(vJ, p);
  return gj / (1 + gj * p.rs);
}

/**
 * Run a small-signal sweep.
 *
 * @param {object} args
 * @param {import('./types.js').Part[]} args.parts - SOLVER-view parts
 * @param {import('./types.js').Net[]} args.nets - SOLVER-view nets
 * @param {Map<string, any>} args.pinSources
 * @param {Map<string, number>} args.controls
 * @param {number} args.vcc
 * @param {Map<string, number>} args.opVoltages - converged DC node voltages
 * @param {Map<string, object>} [args.deviceStates]
 * @param {string} args.sourceId - the swept vsource part id (unit phasor)
 * @param {number[]} args.freqs - Hz, each > 0
 * @param {string[]} [args.probes] - net ids to report (default: all)
 * @returns {Array<{hz: number, results: Map<string, {mag: number, phaseDeg: number}>}>}
 */
export function acSweep(args) {
  const {
    parts, nets, pinSources, controls, vcc, opVoltages,
    deviceStates, sourceId, freqs, probes,
  } = args;

  const partById = new Map(parts.map(p => [p.id, p]));
  const source = partById.get(sourceId);
  if (!source || source.kind !== 'vsource') {
    throw new Error(`acSweep: "${sourceId}" is not a vsource on this bench`);
  }

  // ── Node indexing ───────────────────────────────────────────────────
  // AC ground = every net that is DC-pinned by a rail or a NON-swept
  // voltage source: gnd symbols, vcc rails, other vsources' terminals.
  // (An ideal DC-pinned node cannot move at any frequency.)
  const grounded = new Set();
  for (const net of nets) {
    for (const t of net.terminals) {
      const p = partById.get(t.part);
      if (!p) continue;
      if (p.kind === 'gnd') grounded.add(net.id);
      if (p.kind === 'vcc' && t.terminal === 'vcc') grounded.add(net.id);
      if (p.kind === 'vsource' && p.id !== sourceId) grounded.add(net.id);
    }
  }
  // The swept source's neg terminal is its reference.
  const srcNeg = findNet(nets, sourceId, 'neg');
  if (srcNeg) grounded.add(srcNeg);

  /** @type {Map<string, number>} */
  const nodeIndex = new Map();
  let nodeCount = 0;
  for (const net of nets) {
    if (!grounded.has(net.id)) nodeIndex.set(net.id, nodeCount++);
  }
  const idxOf = (netId) => (netId && !grounded.has(netId)) ? nodeIndex.get(netId) : undefined;
  const vOp = (netId) => netId ? (opVoltages.get(netId) ?? 0) : 0;
  const netOf = (partId, terminal) => findNet(nets, partId, terminal);

  // Extra rows: the swept source and each op-amp output.
  let acRows = 0;
  const rowIndex = new Map();
  const srcPos = netOf(sourceId, 'pos');
  if (idxOf(srcPos) === undefined) {
    throw new Error('acSweep: the swept source drives a DC-pinned or missing net');
  }
  rowIndex.set(sourceId, acRows++);
  for (const p of parts) {
    if (p.kind === 'opamp' && idxOf(netOf(p.id, 'out')) !== undefined) {
      rowIndex.set(p.id, acRows++);
    }
    if (p.kind === 'vcvs' && idxOf(netOf(p.id, 'outp')) !== undefined) {
      rowIndex.set(p.id, acRows++);
    }
  }

  const N = nodeCount + acRows;
  const dim = 2 * N; // real-equivalent bordered system
  if (nodeCount === 0) return freqs.map(hz => ({ hz, results: new Map() }));

  const A = new CooMatrix(dim);
  const b = new Float64Array(dim);

  // Complex entry: value g + j·susceptance at (i, j).
  const addC = (i, j, g, susc) => {
    if (g !== 0) { A.add(i, j, g); A.add(i + N, j + N, g); }
    if (susc !== 0) { A.add(i, j + N, -susc); A.add(i + N, j, susc); }
  };
  const addG2 = (na, nb, g, susc = 0) => {
    const ia = idxOf(na);
    const ib = idxOf(nb);
    if (ia !== undefined) addC(ia, ia, g, susc);
    if (ib !== undefined) addC(ib, ib, g, susc);
    if (ia !== undefined && ib !== undefined) {
      addC(ia, ib, -g, -susc);
      addC(ib, ia, -g, -susc);
    }
  };

  // ── Frequency-independent stamps, collected as closures ─────────────
  // The susceptance parts get scaled by ω each point; conductances are
  // stamped once per fill. We simply re-fill per point (reset keeps the
  // pattern, so the LU refactors).
  const fill = (omega) => {
    A.reset();
    b.fill(0);

    for (const part of parts) {
      const P = part.params ?? {};
      switch (part.kind) {
        case 'resistor':
          addG2(netOf(part.id, 'a'), netOf(part.id, 'b'), 1 / (P.ohms ?? 1000));
          break;
        case 'buzzer':
          addG2(netOf(part.id, 'a'), netOf(part.id, 'b'), 1 / 100);
          break;
        case 'button':
        case 'switch': {
          const closed = (controls.get(part.id) ?? 0) === 1;
          addG2(netOf(part.id, 'a'), netOf(part.id, 'b'), closed ? 1 / 0.001 : 1e-12);
          break;
        }
        case 'potentiometer': {
          const pos = controls.get(part.id) ?? (Number.isFinite(P.position) ? P.position : 0.5);
          const total = P.ohms ?? 10000;
          addG2(netOf(part.id, 'a'), netOf(part.id, 'wiper'), 1 / Math.max(1, total * (1 - pos)));
          addG2(netOf(part.id, 'wiper'), netOf(part.id, 'b'), 1 / Math.max(1, total * pos));
          break;
        }
        case 'ldr':
        case 'ntc': {
          const hi = part.kind === 'ldr' ? (P.rDark ?? 1e6) : (P.rCold ?? 1e5);
          const lo = part.kind === 'ldr' ? (P.rLight ?? 100) : (P.rHot ?? 1000);
          const x = controls.get(part.id) ?? 0;
          addG2(netOf(part.id, 'a'), netOf(part.id, 'b'),
            1 / Math.max(0.001, hi * Math.pow(lo / hi, x)));
          break;
        }
        case 'capacitor':
          addG2(netOf(part.id, 'a'), netOf(part.id, 'b'), 0, omega * (P.farads ?? 1e-4));
          break;
        case 'inductor':
          // Y = 1/(jωL) = −j/(ωL)
          addG2(netOf(part.id, 'a'), netOf(part.id, 'b'), 0,
            -1 / (omega * Math.max(P.henrys ?? P.henries ?? 1e-3, 1e-12)));
          break;
        case 'transformer': {
          // Coupled pair (spec-updates/coupled-inductors.md): Y(ω) =
          // Γ/(jω) — pure susceptance B = −Γ/ω with the full 2×2
          // pattern; the diagonal entries reduce to the lone inductor's.
          const n = Number(P.ratio) || 0;
          const lm = Number(P.lm ?? 10);
          const l1 = Number(P.l1 ?? (n ? lm : 1));
          const l2 = Number(P.l2 ?? (n ? lm / (n * n) : 1));
          const k = Math.min(Math.max(Number(P.k ?? 0.999), 1e-6), 0.999999);
          const m = k * Math.sqrt(l1 * l2);
          const det = l1 * l2 - m * m;
          const p1 = netOf(part.id, 'p1'); const p2 = netOf(part.id, 'p2');
          const s1 = netOf(part.id, 's1'); const s2 = netOf(part.id, 's2');
          const addPort = (rA, rB, cA, cB, susc) => {
            const ra = idxOf(rA); const rb = idxOf(rB);
            const ca = idxOf(cA); const cb = idxOf(cB);
            if (ra !== undefined && ca !== undefined) addC(ra, ca, 0, susc);
            if (ra !== undefined && cb !== undefined) addC(ra, cb, 0, -susc);
            if (rb !== undefined && ca !== undefined) addC(rb, ca, 0, -susc);
            if (rb !== undefined && cb !== undefined) addC(rb, cb, 0, susc);
          };
          addPort(p1, p2, p1, p2, -(l2 / det) / omega);
          addPort(p1, p2, s1, s2, -(-m / det) / omega);
          addPort(s1, s2, p1, p2, -(-m / det) / omega);
          addPort(s1, s2, s1, s2, -(l1 / det) / omega);
          break;
        }
        case 'led':
        case 'diode': {
          const na = netOf(part.id, 'anode');
          const nc = netOf(part.id, 'cathode');
          const vf = P.vf ?? (part.kind === 'diode' ? 0.7 : 2.0);
          addG2(na, nc, junctionG(part, vOp(na) - vOp(nc), vf, 10));
          break;
        }
        case 'zener': {
          const na = netOf(part.id, 'anode');
          const nc = netOf(part.id, 'cathode');
          const v = vOp(na) - vOp(nc);
          const vf = P.vf ?? 0.7;
          const vz = P.vz ?? 5.1;
          let g = 1e-9;
          if (v >= vf) g = 1 / 10;
          else if (v <= -vz) g = 1 / (P.rz ?? 5);
          addG2(na, nc, g);
          break;
        }
        case 'npn':
        case 'pnp': {
          const nB = netOf(part.id, 'base');
          const nC = netOf(part.id, 'collector');
          const nE = netOf(part.id, 'emitter');
          const vJ = part.kind === 'npn'
            ? vOp(nB) - vOp(nE)
            : vOp(nE) - vOp(nB);
          const gpi = junctionG(part, vJ, P.vbe ?? 0.7, 10);
          // Junction between B and E regardless of polarity.
          addG2(nB, nE, gpi);
          // Saturated at the OP? Then the output is a stiff clamp, not a
          // VCCS — same region logic as the DC stamp, read off the OP.
          const vOut = part.kind === 'npn'
            ? vOp(nC) - vOp(nE)
            : vOp(nE) - vOp(nC);
          const conducting = pwlKneeCurrent(vJ, P.vbe ?? 0.7, 10) > 1e-9;
          if (conducting && vOut < (P.vceSat ?? 0.2) * 1.5) {
            addG2(nC, nE, 10);
            break;
          }
          const gm = (P.beta ?? 100) * gpi;
          const iC = idxOf(nC);
          const iB = idxOf(nB);
          const iE = idxOf(nE);
          // VCCS: i(C→E) = gm·(vB − vE) for BOTH polarities — the pnp's
          // reversed junction sense and reversed current direction cancel.
          if (iC !== undefined && iB !== undefined) addC(iC, iB, gm, 0);
          if (iC !== undefined && iE !== undefined) addC(iC, iE, -gm, 0);
          if (iE !== undefined && iB !== undefined) addC(iE, iB, -gm, 0);
          if (iE !== undefined) addC(iE, iE, gm, 0);
          break;
        }
        case 'nmos':
        case 'pmos': {
          const nG = netOf(part.id, 'gate');
          const nD = netOf(part.id, 'drain');
          const nS = netOf(part.id, 'source');
          const vth = P.vth ?? (part.kind === 'nmos' ? 2.0 : -2.0);
          const k = P.k ?? 0.5;
          const vgs = part.kind === 'nmos'
            ? vOp(nG) - vOp(nS)
            : vOp(nS) - vOp(nG);
          const [vovS, dVovS] = smoothVov(vgs - Math.abs(vth));
          const gm = 2 * k * vovS * dVovS;
          const taper = vovS / (vovS + MOS_SMOOTH_DELTA);
          const gds = 0.001 * taper * taper + 1e-9;
          addG2(nD, nS, gds);
          const iD = idxOf(nD);
          const iG = idxOf(nG);
          const iS = idxOf(nS);
          // i(D→S) = gm·(vG − vS) for both channel types (senses cancel).
          if (iD !== undefined && iG !== undefined) addC(iD, iG, gm, 0);
          if (iD !== undefined && iS !== undefined) addC(iD, iS, -gm, 0);
          if (iS !== undefined && iG !== undefined) addC(iS, iG, -gm, 0);
          if (iS !== undefined) addC(iS, iS, gm, 0);
          break;
        }
        case 'opamp': {
          if (!rowIndex.has(part.id)) break;
          const row = nodeCount + rowIndex.get(part.id);
          const iO = idxOf(netOf(part.id, 'out'));
          if (iO === undefined) break;
          const iP = idxOf(netOf(part.id, 'inp'));
          const iN = idxOf(netOf(part.id, 'inn'));
          const gain = P.gain ?? 1e6;
          addC(iO, row, 1, 0);
          addC(row, iO, 1, 0);
          if (iP !== undefined) addC(row, iP, -gain, 0);
          if (iN !== undefined) addC(row, iN, gain, 0);
          break;
        }
        case 'vcvs': {
          if (!rowIndex.has(part.id)) break;
          const row = nodeCount + rowIndex.get(part.id);
          const iOp = idxOf(netOf(part.id, 'outp'));
          if (iOp === undefined) break;
          const iOn = idxOf(netOf(part.id, 'outn'));
          addC(iOp, row, 1, 0);
          addC(row, iOp, 1, 0);
          if (iOn !== undefined) { addC(iOn, row, -1, 0); addC(row, iOn, -1, 0); }
          // Region at the OP: a railed buffer is small-signal dead — its
          // output cannot move, so the row pins the AC output to 0.
          const gain = P.gain ?? 1;
          const vinOp = vOp(netOf(part.id, 'inp')) - vOp(netOf(part.id, 'inn'));
          const railLow = P.railLow;
          const railHigh = P.railHigh;
          const railed = (railHigh !== undefined && gain * vinOp > railHigh)
            || (railLow !== undefined && gain * vinOp < railLow);
          if (!railed) {
            const iIp = idxOf(netOf(part.id, 'inp'));
            const iIn = idxOf(netOf(part.id, 'inn'));
            if (iIp !== undefined) addC(row, iIp, -gain, 0);
            if (iIn !== undefined) addC(row, iIn, gain, 0);
          }
          break;
        }
        case 'vccs': {
          const gm = P.gm ?? 1e-3;
          // Clamped at the OP → the output is a fixed current: small-signal 0.
          if (P.iMax > 0) {
            const vinOp = vOp(netOf(part.id, 'inp')) - vOp(netOf(part.id, 'inn'));
            if (Math.abs(gm * vinOp) >= P.iMax) break;
          }
          const iOp = idxOf(netOf(part.id, 'outp'));
          const iOn = idxOf(netOf(part.id, 'outn'));
          const iIp = idxOf(netOf(part.id, 'inp'));
          const iIn = idxOf(netOf(part.id, 'inn'));
          if (iOp !== undefined && iIp !== undefined) addC(iOp, iIp, -gm, 0);
          if (iOp !== undefined && iIn !== undefined) addC(iOp, iIn, gm, 0);
          if (iOn !== undefined && iIp !== undefined) addC(iOn, iIp, gm, 0);
          if (iOn !== undefined && iIn !== undefined) addC(iOn, iIn, -gm, 0);
          break;
        }
        case 'mcu': {
          for (const terminal of part.terminals) {
            const src = pinSources.get(terminal);
            if (!src || src === 'high-z') continue;
            const i = idxOf(netOf(part.id, terminal));
            if (i !== undefined) addC(i, i, 1 / src.rTh, 0);
          }
          break;
        }
        case 'vsource': {
          if (part.id !== sourceId) break; // others are AC ground
          const row = nodeCount + rowIndex.get(part.id);
          const iP = idxOf(srcPos);
          addC(iP, row, 1, 0);
          addC(row, iP, 1, 0);
          b[row] = 1; // unit phasor, 0°
          break;
        }
        case 'vcc':
        case 'gnd':
        case 'isource':
          break; // AC ground / open
        default: {
          // Registered devices: their PASSIVE loading only. Drives collapse
          // to their output conductance (a killed Thévenin); stamp() runs
          // against a g-only ctx so behavioral models contribute their
          // input impedance without injecting bias.
          const model = getDevice(part.kind);
          if (!model) break;
          const state = deviceStates?.get(part.id) ?? { drives: {} };
          for (const [terminal, drive] of Object.entries(state.drives ?? {})) {
            if (!drive) continue;
            const g = 1 / Math.max(drive.rTh, 1e-3);
            if (drive.ref) {
              addG2(netOf(part.id, terminal), netOf(part.id, drive.ref), g);
            } else {
              const i = idxOf(netOf(part.id, terminal));
              if (i !== undefined) addC(i, i, g, 0);
            }
          }
          if (model.stamp) {
            const ctx = {
              netFor: (t) => netOf(part.id, t),
              conductance: (tA, tB, g) => addG2(netOf(part.id, tA),
                tB ? netOf(part.id, tB) : undefined, g),
              thevenin: (t, _v, rTh) => {
                const i = idxOf(netOf(part.id, t));
                if (i !== undefined) addC(i, i, 1 / Math.max(rTh, 1e-3), 0);
              },
              theveninBetween: (tP, tN, _v, rTh) =>
                addG2(netOf(part.id, tP), netOf(part.id, tN), 1 / Math.max(rTh, 1e-3)),
              current: () => {},
              vcc,
              tSeconds: 0,
              control: controls.get(part.id),
            };
            model.stamp(ctx, part, state);
          }
          break;
        }
      }
    }
    // gmin on every node diagonal, both blocks.
    for (let i = 0; i < nodeCount; i++) addC(i, i, 1e-12, 0);
  };

  // ── Sweep: factor once, refactor per point ──────────────────────────
  const out = [];
  let lu = null;
  for (const hz of freqs) {
    const omega = 2 * Math.PI * hz;
    fill(omega);
    const csc = toCSC(A);
    if (lu && lu.samePattern(csc) && lu.refactor(csc)) {
      // reused
    } else {
      lu = new SparseLU();
      lu.factor(csc); // throws the singular contract
    }
    const x = lu.solve(b);
    const results = new Map();
    const report = probes ?? [...nodeIndex.keys()];
    for (const netId of report) {
      if (grounded.has(netId)) {
        results.set(netId, { mag: 0, phaseDeg: 0 });
        continue;
      }
      const i = nodeIndex.get(netId);
      if (i === undefined) continue;
      const re = x[i];
      const im = x[i + N];
      results.set(netId, {
        mag: Math.hypot(re, im),
        phaseDeg: Math.atan2(im, re) * 180 / Math.PI,
      });
    }
    out.push({ hz, results });
  }
  return out;
}
