/**
 * 555 timer — behavioral model.
 *
 * Two comparators + SR flip-flop + discharge switch.
 * Internal voltage divider provides 2/3 and 1/3 VCC thresholds
 * (overridden if the control pin is externally driven).
 *
 * Outputs:
 *   - output: Thévenin driver (HIGH/LOW via flip-flop)
 *   - discharge: controlled switch to GND (closed when output LOW)
 *
 * @module
 */

import { registerDevice, getDevice } from '../devices.js';

const R_OUT_DEFAULT = 50;
const R_DISCHARGE = 10;     // discharge switch on-resistance
const R_DIVIDER = 5000;     // internal divider resistors (3 × 5kΩ)

/**
 * Register the 555 timer device model.
 */
export function registerTimer555() {
  registerDevice('timer_555', {
    terminals: ['vcc', 'gnd', 'trigger', 'threshold', 'control', 'discharge', 'output', 'reset'],

    init(part) {
      return {
        drives: {
          output: { vTh: 0, rTh: part.params?.rOut ?? R_OUT_DEFAULT },
        },
        ffOut: 0,            // flip-flop output: 0=LOW, 1=HIGH
        _dischargeActive: true, // discharge switch closed when output LOW
        _lastToggleNs: 0n,   // for params-based free-running mode
        _freeRunning: false,
        _freeRunChecked: false,
      };
    },

    stamp(ctx, part, state) {
      const rOut = part.params?.rOut ?? R_OUT_DEFAULT;

      // threshold / trigger / reset draw nothing — comparator inputs. (The
      // 1 MOhm declarations that used to sit here named no second terminal
      // and never stamped; spec-updates/ideal-high-z-inputs.md. The divider
      // below is a different matter: both its legs are real and it has always
      // stamped.)
      // Internal voltage divider: VCC → 5kΩ → control → 5kΩ → (1/3 tap) → 5kΩ → GND
      // This provides 2/3 VCC at the control pin and 1/3 VCC at the internal tap.
      // Stamp as conductance from vcc to control, and control to gnd.
      ctx.conductance('vcc', 'control', 1 / R_DIVIDER);       // top 5kΩ
      ctx.conductance('control', 'gnd', 1 / (R_DIVIDER * 2)); // bottom 10kΩ (two 5kΩ in series)

      // Discharge switch: when active, low resistance from discharge to gnd
      if (state._dischargeActive) {
        ctx.conductance('discharge', 'gnd', 1 / R_DISCHARGE);
      }

      // Output drive is handled by state.drives (generic device stamping)
    },

    update(part, state, read, tNs) {
      const vcc = read('vcc');
      const vGnd = read('gnd');
      const vThreshold = read('threshold');
      const vTrigger = read('trigger');
      const vControl = read('control');
      const vReset = read('reset');
      const rOut = part.params?.rOut ?? R_OUT_DEFAULT;

      const effectiveVcc = vcc - vGnd;
      if (effectiveVcc < 0.5) {
        if (state.ffOut !== 0) {
          state.ffOut = 0;
          state.drives.output = { vTh: vGnd, rTh: rOut };
          state._dischargeActive = true;
          return true;
        }
        return false;
      }

      // ── Params-based free-running fallback ──────────────────────────
      // When params.frequency is set and function pins (threshold,
      // trigger) sit on island nets (floating at the internal divider
      // bias), oscillate at the specified frequency. This lets bench
      // 555s produce a clock without a wired R/C astable circuit.
      const freq = part.params?.frequency;
      if (freq && freq > 0) {
        if (!state._freeRunChecked) {
          state._freeRunChecked = true;
          // Island detection: on island nets, threshold and trigger sit at
          // ≈0 V because GMIN ties every node to the reference and nothing
          // external drives them. (This used to credit a 1 MΩ input-loading
          // stamp that named no second terminal and therefore never ran —
          // the reading was always GMIN's; see
          // spec-updates/ideal-high-z-inputs.md.) When both pins sit near
          // 0 V with power present, they're floating — engage free-running.
          const tol = effectiveVcc * 0.2;
          const thrIsland = Math.abs(vThreshold - vGnd) < tol;
          const trgIsland = Math.abs(vTrigger - vGnd) < tol;
          state._freeRunning = thrIsland && trgIsland;
          if (state._freeRunning) state._lastToggleNs = BigInt(tNs);
        }

        if (state._freeRunning) {
          const duty = part.params?.duty ?? 0.5;
          const periodNs = BigInt(Math.round(1e9 / freq));
          const highNs = BigInt(Math.round(Number(periodNs) * duty));
          const lowNs = periodNs - highNs;
          const elapsed = BigInt(tNs) - state._lastToggleNs;

          let newFf = state.ffOut;
          if (state.ffOut === 1 && elapsed >= highNs) {
            newFf = 0;
            state._lastToggleNs = BigInt(tNs);
          } else if (state.ffOut === 0 && elapsed >= lowNs) {
            newFf = 1;
            state._lastToggleNs = BigInt(tNs);
          }

          if (newFf !== state.ffOut) {
            state.ffOut = newFf;
            state.drives.output = {
              vTh: newFf ? vcc : vGnd, rTh: rOut,
            };
            state._dischargeActive = (newFf === 0);
            return true;
          }
          return false;
        }
      }

      // ── Wired comparator mode (standard behavioral model) ──────────
      const upperThreshold = vControl - vGnd;
      const lowerThreshold = upperThreshold / 2;
      const resetActive = (vReset - vGnd) < (effectiveVcc * 0.3);

      let newFf = state.ffOut;

      if (resetActive) {
        newFf = 0;
      } else {
        if ((vThreshold - vGnd) > upperThreshold) {
          newFf = 0;
        }
        if ((vTrigger - vGnd) < lowerThreshold) {
          newFf = 1;
        }
      }

      if (newFf === state.ffOut) return false;

      state.ffOut = newFf;
      state.drives.output = {
        vTh: newFf ? vcc : vGnd,
        rTh: rOut,
      };
      state._dischargeActive = (newFf === 0);

      return true;
    },
  });

  // The gallery's kind is '555' (the designer catalog's name); the
  // registry only knew 'timer_555', so every gallery 555 was accepted
  // by validation and modelled by NOTHING — output stuck at 0V forever
  // (audit escalation, pc27; same disease as rgb_led). One model, two
  // names; terminal order follows the kind table's catalog order.
  const base = getDevice('timer_555');
  registerDevice('555', {
    terminals: ['gnd', 'trigger', 'output', 'reset', 'control', 'threshold', 'discharge', 'vcc'],
    init: (part) => base.init(part),
    stamp: (ctx, part, state) => base.stamp(ctx, part, state),
    update: (part, state, read, tNs) => base.update(part, state, read, tNs),
  });

  // ─── 556 — Dual 555 Timer (DIP-14) ──────────────────────────────────
  // Two independent 555 sections sharing VCC and GND.
  // Section 1: 1dis, 1thr, 1ctl, 1rst, 1out, 1trg
  // Section 2: 2dis, 2thr, 2ctl, 2rst, 2out, 2trg
  registerDevice('556', {
    terminals: ['1dis','1thr','1ctl','1rst','1out','1trg','gnd',
                '2trg','2out','2rst','2ctl','2thr','2dis','vcc'],

    init(part) {
      const rOut = part.params?.rOut ?? R_OUT_DEFAULT;
      return {
        drives: {
          '1out': { vTh: 0, rTh: rOut },
          '2out': { vTh: 0, rTh: rOut },
        },
        ff: [0, 0],               // flip-flop state per section
        _discharge: [true, true], // discharge switch per section
      };
    },

    stamp(ctx, part, state) {
      // Comparator inputs draw nothing; the per-section divider does stamp.
      for (const pfx of ['1', '2']) {
        // Internal divider: vcc → 5kΩ → control → 10kΩ → gnd
        ctx.conductance('vcc', `${pfx}ctl`, 1 / R_DIVIDER);
        ctx.conductance(`${pfx}ctl`, 'gnd', 1 / (R_DIVIDER * 2));
      }
      // Discharge switches
      if (state._discharge[0]) ctx.conductance('1dis', 'gnd', 1 / R_DISCHARGE);
      if (state._discharge[1]) ctx.conductance('2dis', 'gnd', 1 / R_DISCHARGE);
    },

    update(part, state, read) {
      const rOut = part.params?.rOut ?? R_OUT_DEFAULT;
      const vcc = read('vcc');
      const vGnd = read('gnd');
      const effectiveVcc = vcc - vGnd;

      if (effectiveVcc < 0.5) {
        let c = false;
        for (let s = 0; s < 2; s++) {
          if (state.ff[s] !== 0) {
            state.ff[s] = 0;
            state.drives[`${s + 1}out`] = { vTh: vGnd, rTh: rOut };
            state._discharge[s] = true;
            c = true;
          }
        }
        return c;
      }

      let changed = false;
      for (let s = 0; s < 2; s++) {
        const pfx = `${s + 1}`;
        const vCtl = read(`${pfx}ctl`) - vGnd;
        const upper = vCtl;
        const lower = vCtl / 2;
        const resetActive = (read(`${pfx}rst`) - vGnd) < (effectiveVcc * 0.3);
        let newFf = state.ff[s];

        if (resetActive) {
          newFf = 0;
        } else {
          if ((read(`${pfx}thr`) - vGnd) > upper) newFf = 0;
          if ((read(`${pfx}trg`) - vGnd) < lower) newFf = 1;
        }

        if (newFf !== state.ff[s]) {
          state.ff[s] = newFf;
          state.drives[`${pfx}out`] = { vTh: newFf ? vcc : vGnd, rTh: rOut };
          state._discharge[s] = (newFf === 0);
          changed = true;
        }
      }
      return changed;
    },
  });
}
