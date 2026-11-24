// SPDX-License-Identifier: MIT
/**
 * 4046-type CMOS phase-locked loop: a VCO, two phase comparators and a
 * source-follower demodulator output (DIP-16, terminal names below).
 *
 *   1 pcp_out   phase pulses: HIGH while comparator II rests (locked)
 *   2 pc1_out   comparator I: XOR of sig_in and comp_in
 *   3 comp_in   comparator input (usually vco_out, or a divider)
 *   4 vco_out   VCO square wave
 *   5 inh       inhibit: HIGH stops the VCO (output LOW)
 *   6 c1a 7 c1b timing capacitor C1 between these two pins
 *   8 vss
 *   9 vco_in    VCO control voltage
 *  10 dem_out   demodulator: follows vco_in (a resistor to vss loads it)
 *  11 r1        R1 to vss: sets the VCO's span
 *  12 r2        R2 to vss: offset (minimum frequency); open = 0 Hz minimum
 *  13 pc2_out   comparator II: edge-triggered phase-frequency detector,
 *               three-state (HIGH, LOW or off)
 *  14 sig_in    signal input, self-biased at half supply through 200 kΩ
 *               to each rail so an AC-coupled signal toggles it
 *  15 zener     internal zener; not modelled (left open)
 *  16 vdd
 *
 * THE VCO is the real chip's current-steered capacitor, so the external
 * R1, R2 and C1 set the frequency in the circuit, not a param:
 *   - pin r1 is held at vco_in (clamped to the rails) by a stiff follower;
 *     the current it pushes through R1 is I1 = V(vco_in)/R1;
 *   - pin r2 is held at half the supply; I2 = (VDD/2)/R2 through R2;
 *   - I1 + I2 is mirrored into one side of C1 while the other side is held
 *     at vss; when the charged side reaches half the supply above vss the
 *     sides swap, the output toggles, and the capacitor (now reversed)
 *     charges again from minus to plus half supply.
 * Each half period sweeps C1 through VDD, so f = (I1 + I2) / (2 C1 VDD):
 * with R2 open f = V(vco_in) / (2 R1 C1 VDD), from 0 Hz at vco_in = vss to
 * 1/(2 R1 C1) at vco_in = vdd (the CD4046B's linear range, its 30 pF of
 * stray capacitance and 0.9 V of follower offset left out).
 *
 * COMPARATOR II (the phase-frequency detector) counts rising edges: an edge
 * on sig_in first drives pc2_out HIGH (VCO too slow), an edge on comp_in
 * first drives it LOW; the other input's edge returns it to off. Locked,
 * both edges coincide and pc2_out rests in the off state, which is what
 * pcp_out (HIGH while off) shows. Comparator I is the XOR: locked it gives
 * a square wave whose average sets the VCO, 90 degrees out of phase.
 *
 * Logic thresholds are half the supply (sig_in with ±5 % hysteresis);
 * outputs are 400 Ω Thévenin drivers to the rails. The device state reports
 * the VCO frequency (`vcoHz`, from its last full period), its edges, and
 * whether comparator II rests (`locked`).
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 400;
const R_HOLD = 50;        // C1's held side to vss
const G_FOLLOW = 1;       // pin r1 / r2 holding conductance (1 Ω)
const R_BIAS = 200e3;     // sig_in self-bias, to each rail
const R_DEM = 1000;       // demodulator follower output resistance

const TERMS = ['pcp_out', 'pc1_out', 'comp_in', 'vco_out', 'inh', 'c1a', 'c1b', 'vss',
  'vco_in', 'dem_out', 'r1', 'r2', 'pc2_out', 'sig_in', 'zener', 'vdd'];

export function registerPll4046() {
  registerDevice('cd4046', {
    terminals: TERMS,

    init() {
      return {
        drives: { vco_out: { vTh: 0, rTh: R_OUT }, pc1_out: { vTh: 0, rTh: R_OUT },
          pcp_out: { vTh: 0, rTh: R_OUT }, pc2_out: null },
        phase: 0,          // 0: c1a charging, c1b held; 1: the other way
        sig: 0, comp: 0,   // last logic levels of the comparator inputs
        up: false, down: false,
        vcoHz: 0, _lastRiseNs: null, edges: 0, locked: true,
      };
    },

    stamp(ctx, part, state) {
      const st = state ?? { phase: 0 };
      const r2Wired = Boolean(ctx.netFor('r2'));
      const r1Wired = Boolean(ctx.netFor('r1'));
      // Self-bias of the signal input.
      if (ctx.netFor('sig_in')) {
        ctx.conductance('vdd', 'sig_in', 1 / R_BIAS);
        ctx.conductance('sig_in', 'vss', 1 / R_BIAS);
      }
      // C1's held side.
      const active = st.phase === 0 ? 'c1a' : 'c1b';
      const held = st.phase === 0 ? 'c1b' : 'c1a';
      if (ctx.netFor(held)) ctx.conductance(held, 'vss', 1 / R_HOLD);
      const inhibited = Boolean(st.inhibited);
      if (!ctx.netFor('vdd') || !ctx.netFor('vss')) return;

      // The VCO: followers on r1 (vco_in) and r2 (half supply), their
      // currents mirrored into C1's active side. Linear, with clamps.
      if (r1Wired || r2Wired) {
        const capWired = Boolean(ctx.netFor(active));
        const inWired = Boolean(ctx.netFor('vco_in'));
        ctx.nonlinearCurrents('vco', (read) => {
          const vss = read('vss');
          const vdd = read('vdd');
          const span = vdd - vss;
          const currents = new Map();
          const jac = new Map();
          const add = (row, col, s) => {
            if (!jac.has(row)) jac.set(row, new Map());
            const m = jac.get(row);
            m.set(col, (m.get(col) ?? 0) + s);
          };
          let iCap = 0;
          const capRow = new Map();
          const vddRow = new Map();
          let iVdd = 0;
          if (r1Wired) {
            // target = clamp(vin, vss, vdd)
            let target; const d = new Map();
            const vin = inWired ? read('vco_in') : vss;
            if (vin <= vss) { target = vss; d.set('vss', 1); } else if (vin >= vdd) { target = vdd; d.set('vdd', 1); } else { target = vin; if (inWired) d.set('vco_in', 1); }
            const i = G_FOLLOW * (target - read('r1'));
            currents.set('r1', i);
            for (const [k, s] of d) add('r1', k, G_FOLLOW * s);
            add('r1', 'r1', -G_FOLLOW);
            iVdd -= i;
            for (const [k, s] of d) vddRow.set(k, (vddRow.get(k) ?? 0) - G_FOLLOW * s);
            vddRow.set('r1', (vddRow.get('r1') ?? 0) + G_FOLLOW);
            // mirrored into C1: the current through R1 is i
            iCap += i;
            for (const [k, s] of d) capRow.set(k, (capRow.get(k) ?? 0) + G_FOLLOW * s);
            capRow.set('r1', (capRow.get('r1') ?? 0) - G_FOLLOW);
          }
          if (r2Wired) {
            const i = G_FOLLOW * (vss + span / 2 - read('r2'));
            currents.set('r2', i);
            add('r2', 'vss', G_FOLLOW / 2); add('r2', 'vdd', G_FOLLOW / 2); add('r2', 'r2', -G_FOLLOW);
            iVdd -= i;
            vddRow.set('vss', (vddRow.get('vss') ?? 0) - G_FOLLOW / 2);
            vddRow.set('vdd', (vddRow.get('vdd') ?? 0) - G_FOLLOW / 2);
            vddRow.set('r2', (vddRow.get('r2') ?? 0) + G_FOLLOW);
            iCap += i;
            capRow.set('vss', (capRow.get('vss') ?? 0) + G_FOLLOW / 2);
            capRow.set('vdd', (capRow.get('vdd') ?? 0) + G_FOLLOW / 2);
            capRow.set('r2', (capRow.get('r2') ?? 0) - G_FOLLOW);
          }
          // The mirror delivers only a positive current, and none while inhibited.
          const on = capWired && !inhibited && iCap > 0;
          if (capWired) {
            currents.set(active, on ? iCap : 0);
            jac.set(active, on ? new Map(capRow) : new Map([[active, 0]]));
            if (on) {
              iVdd -= iCap;
              for (const [k, s] of capRow) vddRow.set(k, (vddRow.get(k) ?? 0) - s);
            }
          }
          currents.set('vdd', iVdd);
          jac.set('vdd', vddRow.size ? vddRow : new Map([['vdd', 0]]));
          return { region: on ? 'charging' : 'idle', currents, jacobian: jac, residualOhms: 1 };
        });
      }

      // Demodulator output: follows vco_in through R_DEM.
      if (ctx.netFor('dem_out') && ctx.netFor('vco_in')) {
        ctx.nonlinearCurrents('dem', (read) => {
          const i = (read('vco_in') - read('dem_out')) / R_DEM;
          return {
            region: 'linear',
            currents: new Map([['dem_out', i], ['vdd', -i]]),
            jacobian: new Map([
              ['dem_out', new Map([['vco_in', 1 / R_DEM], ['dem_out', -1 / R_DEM]])],
              ['vdd', new Map([['vco_in', -1 / R_DEM], ['dem_out', 1 / R_DEM]])],
            ]),
            residualOhms: R_DEM,
          };
        });
      }
    },

    update(part, state, read, tNs) {
      const vss = read('vss');
      const vdd = read('vdd');
      const span = vdd - vss;
      let changed = false;
      const drive = (pin, high) => {
        const vTh = high ? vdd : vss;
        const d = state.drives[pin];
        if (!d || d.vTh !== vTh) { state.drives[pin] = { vTh, rTh: R_OUT }; changed = true; }
      };
      if (span < 2) {
        for (const pin of ['vco_out', 'pc1_out', 'pcp_out']) drive(pin, false);
        if (state.drives.pc2_out) { state.drives.pc2_out = null; changed = true; }
        return changed;
      }
      const half = vss + span / 2;
      const connected = (t) => (typeof read.connected === 'function' ? read.connected(t) : true);

      // Inhibit.
      const inh = connected('inh') && read('inh') > half;
      if (inh !== Boolean(state.inhibited)) { state.inhibited = inh; changed = true; }

      // VCO: swap when the charging side reaches half supply above vss.
      if (!inh) {
        const active = state.phase === 0 ? 'c1a' : 'c1b';
        if (connected(active) && read(active) - vss >= span / 2) {
          state.phase ^= 1;
          changed = true;
          if (state.phase === 0) {
            // a rising output edge: measure the period
            const t = BigInt(tNs);
            if (state._lastRiseNs !== null && t > BigInt(state._lastRiseNs)) {
              state.vcoHz = 1e9 / Number(t - BigInt(state._lastRiseNs));
            }
            state._lastRiseNs = String(t);
          }
          state.edges += 1;
        }
      }
      drive('vco_out', !inh && state.phase === 0);

      // Comparator inputs (sig_in with hysteresis).
      const hyst = 0.05 * span;
      const vs = connected('sig_in') ? read('sig_in') : vss;
      const sig = state.sig ? (vs > half - hyst ? 1 : 0) : (vs > half + hyst ? 1 : 0);
      const comp = (connected('comp_in') ? read('comp_in') : vss) > half ? 1 : 0;
      const sigRise = sig === 1 && state.sig === 0;
      const compRise = comp === 1 && state.comp === 0;
      if (sig !== state.sig || comp !== state.comp) changed = true;
      state.sig = sig;
      state.comp = comp;

      // Comparator II: phase-frequency detector.
      let { up, down } = state;
      if (sigRise && compRise) { up = false; down = false; } else if (sigRise) { if (down) down = false; else up = true; } else if (compRise) { if (up) up = false; else down = true; }
      if (up !== state.up || down !== state.down) { state.up = up; state.down = down; changed = true; }
      const pc2 = up ? { vTh: vdd, rTh: R_OUT } : down ? { vTh: vss, rTh: R_OUT } : null;
      const old = state.drives.pc2_out;
      if ((old === null) !== (pc2 === null) || (old && pc2 && old.vTh !== pc2.vTh)) { state.drives.pc2_out = pc2; changed = true; }
      state.locked = !up && !down;

      drive('pc1_out', (sig ^ comp) === 1);
      drive('pcp_out', state.locked);
      return changed;
    },
  });
}
