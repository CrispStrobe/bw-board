/**
 * Accelerometers — the two the Arduino CC0 corpus teaches with, both
 * driven by the ORIENTATION stimulus contract: params gx/gy/gz in g
 * (via setPartParam — the environment-stimulus channel), so one face
 * (drag-to-tilt) feeds every accelerometer alike. Defaults are a chip
 * lying flat on the bench: x=0, y=0, z=+1.
 *
 * adxl335 — ADI ADXL335/3xx family, ANALOG 3-axis (datasheet: 0 g bias
 * at Vs/2, ratiometric sensitivity Vs/10 per g — 300 mV/g at 3 V).
 * Self-test pin ST high adds the datasheet deflection (-1.08 g X,
 * +1.08 g Y, +1.83 g Z), which is exactly what it is for: proving the
 * beam moves without moving the bench.
 *
 * memsic2125 — MEMSIC MX2125 thermal 2-axis, PWM output: 100 Hz, 50%
 * duty at 0 g, 12.5 %/g (the Arduino sketch's ((pulse/10)-500)*8 → mg
 * inverts exactly this). Edges are REAL deadlines — pulseIn timing is
 * the whole point, so the board substeps to each transition instead of
 * quantizing to the generic 1 ms grid (state._nextEdgeNs).
 */

import { registerDevice } from '../devices.js';

const R_OUT = 32000; // ADXL335 datasheet: ~32 kΩ output resistance

export function registerAccelerometers() {

  registerDevice('adxl335', {
    terminals: ['vcc', 'gnd', 'xout', 'yout', 'zout', 'st'],

    init() {
      return {
        drives: {
          xout: { vTh: 1.5, rTh: R_OUT },
          yout: { vTh: 1.5, rTh: R_OUT },
          zout: { vTh: 1.8, rTh: R_OUT },
        },
        _last: null,
      };
    },

    stamp() { /* output drives carry it */ },

    update(part, state, read) {
      const vcc = read('vcc');
      if (vcc < 1.8) {
        // Below the operating floor the outputs collapse; drive 0 weakly.
        const key = 'off';
        if (state._last === key) return false;
        state._last = key;
        for (const t of ['xout', 'yout', 'zout']) state.drives[t] = { vTh: 0, rTh: R_OUT };
        return true;
      }
      const st = read('st') > 2;
      const g = {
        x: (part.params?.gx ?? 0) + (st ? -1.08 : 0),
        y: (part.params?.gy ?? 0) + (st ? 1.08 : 0),
        z: (part.params?.gz ?? 1) + (st ? 1.83 : 0),
      };
      const bias = vcc / 2;
      const sens = vcc / 10;               // ratiometric: 300 mV/g at 3 V
      const clamp = (v) => Math.max(0, Math.min(vcc, v));
      const key = `${vcc.toFixed(2)}|${g.x}|${g.y}|${g.z}`;
      if (state._last === key) return false;
      state._last = key;
      state.drives.xout = { vTh: clamp(bias + g.x * sens), rTh: R_OUT };
      state.drives.yout = { vTh: clamp(bias + g.y * sens), rTh: R_OUT };
      state.drives.zout = { vTh: clamp(bias + g.z * sens), rTh: R_OUT };
      return true;
    },
  });

  const PERIOD_NS = 10_000_000n;           // 100 Hz
  const duty = (gVal) => Math.max(0.05, Math.min(0.95, 0.5 + 0.125 * gVal));

  registerDevice('memsic2125', {
    terminals: ['vcc', 'gnd', 'xout', 'yout'],

    init() {
      return {
        drives: { xout: { vTh: 0, rTh: 200 }, yout: { vTh: 0, rTh: 200 } },
        _t0: null,                          // period start
        _nextEdgeNs: 0n,                    // board substeps to this
      };
    },

    stamp() { /* output drives carry it */ },

    update(part, state, read, tNs) {
      const vcc = read('vcc');
      if (vcc < 2.5) return false;          // below operating range: idle low
      if (state._t0 === null) state._t0 = tNs;
      const phase = (tNs - state._t0) % PERIOD_NS;
      const dx = duty(part.params?.gx ?? 0);
      const dy = duty(part.params?.gy ?? 0);
      const periodStart = tNs - phase;
      let changed = false;
      let next = periodStart + PERIOD_NS;  // worst case: next period start
      for (const [t, d] of [['xout', dx], ['yout', dy]]) {
        const highUntil = periodStart + BigInt(Math.round(d * 1e7));
        const level = tNs < highUntil ? vcc : 0;
        if (state.drives[t].vTh !== level) { state.drives[t] = { vTh: level, rTh: 200 }; changed = true; }
        if (tNs < highUntil && highUntil < next) next = highUntil;
      }
      state._nextEdgeNs = next;
      return changed;
    },
  });
}

export default registerAccelerometers;
