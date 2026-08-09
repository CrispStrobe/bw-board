/**
 * Digital ICs — decade counter (4017), D flip-flop, JK flip-flop,
 * multiplexer (4051), buffer/driver (ULN2803).
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_INPUT = 1e6;

/**
 * Register digital IC device models.
 */
export function registerDigitalICs() {

  // ─── CD4017 Decade Counter ─────────────────────────────────────────
  // 10 decoded outputs (Q0-Q9), one active at a time.
  // CLK rising edge advances the count. RST resets to Q0.
  // CO (carry out) goes HIGH for counts 0-4, LOW for 5-9.
  registerDevice('decade_counter', {
    terminals: ['clk', 'rst', 'en', 'q0', 'q1', 'q2', 'q3', 'q4',
                'q5', 'q6', 'q7', 'q8', 'q9', 'co'],

    init() {
      const drives = { co: { vTh: 5, rTh: R_OUT } };
      for (let i = 0; i < 10; i++) {
        drives[`q${i}`] = { vTh: i === 0 ? 5 : 0, rTh: R_OUT };
      }
      return { drives, count: 0, _lastClk: false };
    },

    stamp(ctx) {
      ctx.conductance('clk', null, 1 / R_INPUT);
      ctx.conductance('rst', null, 1 / R_INPUT);
      ctx.conductance('en', null, 1 / R_INPUT);
    },

    update(part, state, read) {
      const vcc = 5.0;
      const threshold = vcc * 0.5;

      const clkHigh = read('clk') > threshold;
      const rstHigh = read('rst') > threshold;
      const enLow = read('en') < threshold; // enable is active LOW

      let newCount = state.count;

      // Reset
      if (rstHigh) {
        newCount = 0;
      } else if (enLow && clkHigh && !state._lastClk) {
        // Rising edge on CLK with enable active
        newCount = (state.count + 1) % 10;
      }
      state._lastClk = clkHigh;

      if (newCount === state.count) return false;

      state.count = newCount;
      for (let i = 0; i < 10; i++) {
        state.drives[`q${i}`] = { vTh: i === newCount ? vcc : 0, rTh: R_OUT };
      }
      // Carry out: HIGH for counts 0-4
      state.drives.co = { vTh: newCount < 5 ? vcc : 0, rTh: R_OUT };
      return true;
    },
  });

  // ─── D Flip-Flop ──────────────────────────────────────────────────
  // Captures D on CLK rising edge. Outputs Q and Q_bar.
  registerDevice('dff', {
    terminals: ['d', 'clk', 'set', 'rst', 'q', 'q_bar'],

    init() {
      return {
        drives: { q: { vTh: 0, rTh: R_OUT }, q_bar: { vTh: 5, rTh: R_OUT } },
        _q: 0,
        _lastClk: false,
      };
    },

    stamp(ctx) {
      ctx.conductance('d', null, 1 / R_INPUT);
      ctx.conductance('clk', null, 1 / R_INPUT);
      ctx.conductance('set', null, 1 / R_INPUT);
      ctx.conductance('rst', null, 1 / R_INPUT);
    },

    update(part, state, read) {
      const vcc = 5.0;
      const threshold = vcc * 0.5;

      const clkHigh = read('clk') > threshold;
      const setHigh = read('set') > threshold;
      const rstHigh = read('rst') > threshold;

      let newQ = state._q;

      // Async set/reset (active HIGH)
      if (setHigh) newQ = 1;
      else if (rstHigh) newQ = 0;
      else if (clkHigh && !state._lastClk) {
        // Rising edge: capture D
        newQ = read('d') > threshold ? 1 : 0;
      }
      state._lastClk = clkHigh;

      if (newQ === state._q) return false;
      state._q = newQ;
      state.drives.q = { vTh: newQ ? vcc : 0, rTh: R_OUT };
      state.drives.q_bar = { vTh: newQ ? 0 : vcc, rTh: R_OUT };
      return true;
    },
  });

  // ─── JK Flip-Flop ─────────────────────────────────────────────────
  // J=K=1 toggles, J=1/K=0 sets, J=0/K=1 resets, J=K=0 holds.
  registerDevice('jkff', {
    terminals: ['j', 'k', 'clk', 'set', 'rst', 'q', 'q_bar'],

    init() {
      return {
        drives: { q: { vTh: 0, rTh: R_OUT }, q_bar: { vTh: 5, rTh: R_OUT } },
        _q: 0,
        _lastClk: false,
      };
    },

    stamp(ctx) {
      ctx.conductance('j', null, 1 / R_INPUT);
      ctx.conductance('k', null, 1 / R_INPUT);
      ctx.conductance('clk', null, 1 / R_INPUT);
      ctx.conductance('set', null, 1 / R_INPUT);
      ctx.conductance('rst', null, 1 / R_INPUT);
    },

    update(part, state, read) {
      const vcc = 5.0;
      const threshold = vcc * 0.5;

      const clkHigh = read('clk') > threshold;
      const setHigh = read('set') > threshold;
      const rstHigh = read('rst') > threshold;

      let newQ = state._q;

      if (setHigh) newQ = 1;
      else if (rstHigh) newQ = 0;
      else if (clkHigh && !state._lastClk) {
        const j = read('j') > threshold ? 1 : 0;
        const k = read('k') > threshold ? 1 : 0;
        if (j && k) newQ = state._q ? 0 : 1; // toggle
        else if (j) newQ = 1;
        else if (k) newQ = 0;
        // else hold
      }
      state._lastClk = clkHigh;

      if (newQ === state._q) return false;
      state._q = newQ;
      state.drives.q = { vTh: newQ ? vcc : 0, rTh: R_OUT };
      state.drives.q_bar = { vTh: newQ ? 0 : vcc, rTh: R_OUT };
      return true;
    },
  });

  // ─── ULN2803 Darlington Driver ────────────────────────────────────
  // 8 Darlington pairs. Input HIGH → output sinks to GND (open collector).
  // Commonly used to drive relays, stepper motors, LEDs.
  registerDevice('darlington_driver', {
    terminals: ['in0', 'in1', 'in2', 'in3', 'in4', 'in5', 'in6', 'in7',
                'out0', 'out1', 'out2', 'out3', 'out4', 'out5', 'out6', 'out7',
                'com', 'gnd'],

    init() {
      const drives = {};
      for (let i = 0; i < 8; i++) {
        drives[`out${i}`] = null; // high-Z by default (open collector off)
      }
      return { drives, _levels: new Array(8).fill(0) };
    },

    stamp(ctx) {
      for (let i = 0; i < 8; i++) {
        ctx.conductance(`in${i}`, null, 1 / R_INPUT);
      }
    },

    update(part, state, read) {
      const vcc = 5.0;
      const threshold = vcc * 0.5;
      let changed = false;

      for (let i = 0; i < 8; i++) {
        const level = read(`in${i}`) > threshold ? 1 : 0;
        if (level !== state._levels[i]) {
          state._levels[i] = level;
          // Input HIGH → output sinks (Vce_sat ≈ 1V, Rce ≈ 2Ω)
          // Input LOW → output open (high-Z)
          state.drives[`out${i}`] = level
            ? { vTh: 1.0, rTh: 2 }  // saturated: Vce_sat through low R
            : null;                    // off: open collector
          changed = true;
        }
      }
      return changed;
    },
  });

  // ─── Piezo element ─────────────────────────────────────────────────
  // Unlike a buzzer (which has a built-in oscillator), a piezo needs
  // an external signal. It's essentially a high-impedance capacitor
  // that produces sound proportional to voltage change rate.
  registerDevice('piezo', {
    terminals: ['a', 'b'],

    init() {
      return { drives: {}, _lastV: 0, frequency: 0 };
    },

    stamp(ctx, part) {
      // Piezo is a capacitor (~20nF typically) with very high parallel R
      const capF = part.params?.capacitance ?? 20e-9;
      // At audio frequencies, impedance is significant but we model as
      // a simple high-R load for DC purposes
      ctx.conductance('a', 'b', 1 / 1e6);
    },

    update(part, state, read, tNs) {
      // Track voltage for frequency detection (like buzzer tone detection)
      const v = read('a') - read('b');
      // Frequency detection would happen in advanceTo similar to buzzer
      // For now, just track the voltage state
      state._lastV = v;
      return false;
    },
  });
}
