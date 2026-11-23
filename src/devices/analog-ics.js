/**
 * Analog ICs and discrete power devices.
 *
 * - TIP120: Darlington transistor (behavioral: high beta, 2× Vbe drop)
 * - LM393: Dual comparator (open-collector output)
 * - TMP36: Analog temperature sensor (10mV/°C + 500mV offset)
 * - Light bulb: resistive load with brightness proportional to power
 *
 * @module
 */

import { ledSegment, vceShape } from '../photo-junctions.js';
import { registerDevice } from '../devices.js';
import { classDefaults } from '../parts-library.js';

const R_INPUT = 1e6;
const R_OUT = 50;
/** TIP120 law (see the registration): pair beta, base knee slope, saturation. */
const TIP120_BETA = 1000;
const TIP120_RD_BASE = 200;
const TIP120_VSAT_OFFSET = 0.5;
const TIP120_VSAT_WIDTH = 0.1;

/**
 * Register analog IC and discrete device models.
 */
/**
 * Register analog IC and discrete device models.
 *
 * Includes: TIP120, LM393 (dual comparator), LM339 (quad comparator),
 * TMP36, light bulb, optocoupler, 556 (dual 555 timer).
 */
export function registerAnalogICs() {

  // ─── TIP120 Darlington transistor ─────────────────────────────────
  // ONE NEWTON-SOLVED LAW, like the optocoupler below (2026-11-23).
  //
  // It was a switch: `update()` turned a 2 Ohm collector-emitter resistor on
  // when Vbe passed 1.4 V and off below it. That is a fine model of a
  // Darlington slammed hard on or off, and no model at all of one working
  // LINEARLY -- an emitter follower, a current regulator, an op-amp loop
  // holding a motor's speed. There the switch is a relay in a feedback loop:
  // on, the emitter rises past base - 1.4 V, so off; off, it falls, so on.
  // It flipped at every solve with no time between flips, the integrator's
  // step fell to its femtosecond floor at t = 24.5 ns, and an LM358 driving
  // a TIP120 into an encoder motor (lab-motor-speed) never finished its
  // first millisecond: the advance ran out of device sub-step work.
  //
  // Now the base takes the pair's two junctions as one smooth knee at `vbe`
  // (1.4 V; `ledSegment`, rd = 200 Ohm, exponentially dark below), beside
  // the `rBase` input resistance it always had, and the collector passes
  // beta x that base current (the card's beta, 1000), shaped by a logistic
  // saturation centred `VSAT_OFFSET` above the emitter: a Darlington cannot
  // pull its collector below the output transistor's own base, so it
  // saturates near 0.6-0.9 V instead of at 2 Ohm. On or off it is the same
  // switch as before; in between it is an amplifier.
  registerDevice('tip120', {
    terminals: ['base', 'collector', 'emitter'],

    init() {
      return { drives: {}, _on: false };
    },

    stamp(ctx, part) {
      // Base: high impedance (Darlington input). The value is READ from
      // `classDefaults('tip120').rBase` rather than derived from R_INPUT here,
      // because the SPICE exporter has to reproduce this exact resistance and a
      // literal in a stamp is a number no exporter can see. See the note beside
      // it in parts-library.js.
      const d = classDefaults('tip120');
      const rBase = Number(part.params?.rBase) > 0 ? Number(part.params.rBase) : d.rBase;
      ctx.conductance('base', 'emitter', 1 / rBase);
      if (!ctx.netFor('base') || !ctx.netFor('emitter')) return;
      const vbeKnee = part.params?.vbe ?? d.vbe;
      const beta = Number(part.params?.beta) > 0 ? Number(part.params.beta) : TIP120_BETA;
      const out = Boolean(ctx.netFor('collector'));
      ctx.nonlinearCurrents('darlington', (read, scale) => {
        const vbe = read('base') - read('emitter');
        const [iB, gB] = ledSegment(vbe, vbeKnee * scale, TIP120_RD_BASE);
        const currents = new Map([['base', -iB], ['emitter', iB]]);
        const jacobian = new Map([
          ['base', new Map([['base', -gB], ['emitter', gB]])],
          ['emitter', new Map([['base', gB], ['emitter', -gB]])],
        ]);
        if (out) {
          // Only the junction current is amplified, not its 1 uS leakage.
          const ion = Math.max(iB - 1e-6 * vbe, 0);
          const gon = iB - 1e-6 * vbe > 0 ? gB - 1e-6 : 0;
          const x = (read('collector') - read('emitter') - TIP120_VSAT_OFFSET) / TIP120_VSAT_WIDTH;
          const sh = 1 / (1 + Math.exp(-Math.max(-50, Math.min(50, x))));
          const dsh = sh * (1 - sh) / TIP120_VSAT_WIDTH;
          const ic = beta * ion * sh;
          const dB = beta * gon * sh;
          const dC = beta * ion * dsh;
          currents.set('collector', -ic);
          currents.set('emitter', iB + ic);
          jacobian.set('collector', new Map([['base', -dB], ['emitter', dB + dC], ['collector', -dC]]));
          jacobian.set('emitter', new Map([['base', gB + dB], ['emitter', -gB - dB - dC], ['collector', dC]]));
        }
        return { region: 'smooth', currents, jacobian, residualOhms: 1e5 };
      });
    },

    update(part, state, read) {
      // Reporting only: the electrical law is solved inside the network.
      state._on = read('base') - read('emitter') > (part.params?.vbe ?? classDefaults('tip120').vbe);
      return false;
    },
  });

  // ─── LM393 Dual comparator ────────────────────────────────────────
  // Open-collector output: pulls LOW when V+ < V-, floats when V+ > V-.
  // Two independent comparators in one package.
  registerDevice('lm393', {
    terminals: ['1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out', 'vcc', 'gnd'],

    init() {
      return {
        drives: { '1_out': null, '2_out': null }, // null = high-Z (open collector)
        // null = NOT YET EVALUATED: the first update always applies its
        // drive. The old init of 0-with-floating-drives was inconsistent
        // — a comparator whose first comparison came out low never sank
        // until the input crossed high and back (found by the E3.6
        // hysteresis oracle's fresh-bench case).
        _comp: [null, null], // 0=LOW(sinking), 1=floating
      };
    },

    update(part, state, read) {
      // E3.6: optional hysteresis in volts (default 0 — the bare LM393
      // has none, and the datasheet-honest default keeps every existing
      // bench bit-identical; h=0 uses the exact legacy comparison).
      const h = part.params?.hysteresis ?? 0;
      let changed = false;
      for (let i = 1; i <= 2; i++) {
        const d = read(`${i}_pos`) - read(`${i}_neg`);
        const prev = state._comp[i - 1];
        const comp = (h === 0 || prev === null) ? (d > 0 ? 1 : 0)
          : (prev === 1 ? (d < -h / 2 ? 0 : 1) : (d > h / 2 ? 1 : 0));
        if (comp !== prev) {
          state._comp[i - 1] = comp;
          // Open-collector: high → float (null), low → sink (Vce_sat ~0.2 V)
          state.drives[`${i}_out`] = comp ? null : { vTh: 0.2, rTh: 10 };
          changed = true;
        }
      }
      return changed;
    },
  });

  // ─── TMP36 analog temperature sensor ──────────────────────────────
  // Output: 10mV/°C + 500mV offset. At 25°C: 750mV.
  // Control param sets temperature in °C.
  registerDevice('tmp36', {
    terminals: ['vcc', 'out', 'gnd'],

    init(part) {
      const tempC = part.params?.tempC ?? 25;
      const vOut = 0.5 + tempC * 0.01; // 500mV + 10mV/°C
      return {
        drives: { out: { vTh: vOut, rTh: R_OUT } },
        _tempC: tempC,
        _benchT: 25,
      };
    },

    stamp(ctx, part, state) {
      // E2.2: capture the bench temperature; it is the DEFAULT reading —
      // an explicit params.tempC pins the sensor and is never overridden.
      state._benchT = ctx.temperatureC ?? 25;
    },

    update(part, state) {
      const tempC = part.params?.tempC ?? state._benchT ?? 25;
      if (Math.abs(tempC - state._tempC) < 0.1) return false;

      state._tempC = tempC;
      const vOut = 0.5 + tempC * 0.01;
      state.drives.out = { vTh: vOut, rTh: R_OUT };
      return true;
    },
  });

  // ─── Light bulb ───────────────────────────────────────────────────
  // Resistive load. Brightness proportional to power dissipated.
  // Rated for a specific voltage; brightness = (V/Vrated)² clamped to [0,1].
  registerDevice('light_bulb', {
    terminals: ['a', 'b'],

    init(part) {
      return { drives: {}, brightness: 0, _tempK: 0, _lastTNs: null, _rNow: null };
    },

    stamp(ctx, part, state) {
      // E3.6, opt-in with params.filament: a PTC filament whose
      // resistance grows with its own dissipation — cold it is
      // params.ohms/10 (tungsten's ~10:1 hot/cold ratio), at rated
      // dissipation it warms to params.ohms, and the one-pole thermal
      // state in update() makes INRUSH demonstrable: the first
      // milliseconds draw ~10× the steady current, which is why real
      // bulbs die at switch-on. Default (no param) stays the fixed
      // resistor every existing bench solved.
      const ohms = part.params?.ohms ?? 500;
      const r = part.params?.filament ? (state._rNow ?? ohms / 10) : ohms;
      ctx.conductance('a', 'b', 1 / r);
    },

    update(part, state, read, tNs) {
      const vA = read('a');
      const vB = read('b');
      const v = Math.abs(vA - vB);
      const vRated = part.params?.vRated ?? 5.0;
      const newBrightness = Math.min(1.0, (v / vRated) ** 2);
      let changed = false;

      if (part.params?.filament) {
        const rHot = part.params?.ohms ?? 500;
        const rCold = rHot / 10;
        // Thermal pole: tauMs (default 30 ms — small-bulb scale).
        const tauMs = part.params?.tauMs ?? 30;
        // Steady temp normalized so rated dissipation (vRated²/rHot)
        // lands the filament AT rHot: tSS = P / pRated, r = rCold + (rHot−rCold)·min(tSS,1)… 
        const r = state._rNow ?? rCold;
        const p = v * v / r;
        const pRated = vRated * vRated / rHot;
        const tSS = Math.min(p / pRated, 1.5);
        const dtMs = state._lastTNs === null ? 0 : Number(tNs - state._lastTNs) / 1e6;
        state._lastTNs = tNs;
        const alpha = dtMs <= 0 ? 0 : 1 - Math.exp(-dtMs / tauMs);
        state._tempK = state._tempK + (tSS - state._tempK) * alpha;
        const rNew = rCold + (rHot - rCold) * Math.min(state._tempK, 1);
        if (state._rNow === null || Math.abs(rNew - state._rNow) > state._rNow * 0.02) {
          state._rNow = rNew;
          changed = true; // the network must see the new filament
        } else {
          state._rNow = rNew;
        }
      }

      if (Math.abs(newBrightness - state.brightness) >= 0.001) {
        state.brightness = newBrightness;
      }
      return changed;
    },
  });

  // ─── Optocoupler ──────────────────────────────────────────────────
  // One Newton-solved law (photo-junctions.js, 2026-11-23). The LED is a
  // smooth junction segment (rd = 50 Ω above vf, exponentially dark below,
  // 1 µS leakage); the phototransistor passes CTR·iLed shaped by its VCE
  // saturation, so it saturates at ≈0.2 V instead of being a linear
  // conductance. The old model set that conductance from the LED current in
  // update() and asked for a re-solve whenever it moved by 5 %: an event per
  // step while a coupled capacitor charged, and a diode-pump detector behind
  // it failed at the integrator's minimum step after the LED switched off.
  registerDevice('optocoupler', {
    terminals: ['anode', 'cathode', 'collector', 'emitter'],

    init() {
      return { drives: {}, _on: false };
    },

    stamp(ctx, part) {
      const rd = 50; // dynamic R of the internal LED
      const vf = part.params?.vf ?? 1.2;
      const ctr = part.params?.ctr ?? 1.0;
      const led = ctx.netFor('anode') && ctx.netFor('cathode');
      const out = ctx.netFor('collector') && ctx.netFor('emitter');
      if (!led) return; // no LED current, nothing on the output either
      ctx.nonlinearCurrents('optocoupler', (read, scale) => {
        const vLed = read('anode') - read('cathode');
        const [iLed, gLed] = ledSegment(vLed, vf * scale, rd);
        const currents = new Map([['anode', -iLed], ['cathode', iLed]]);
        const jacobian = new Map([
          ['anode', new Map([['anode', -gLed], ['cathode', gLed]])],
          ['cathode', new Map([['anode', gLed], ['cathode', -gLed]])],
        ]);
        if (out) {
          const ion = Math.max(iLed - 1e-6 * vLed, 0); // photon-producing part only
          const gon = iLed - 1e-6 * vLed > 0 ? gLed - 1e-6 : 0;
          const [sh, dsh] = vceShape(read('collector') - read('emitter'));
          const i = ctr * ion * sh;
          const dLed = ctr * gon * sh;
          const dVce = ctr * ion * dsh;
          currents.set('collector', -i);
          currents.set('emitter', i);
          jacobian.set('collector', new Map([['anode', -dLed], ['cathode', dLed],
            ['collector', -dVce], ['emitter', dVce]]));
          jacobian.set('emitter', new Map([['anode', dLed], ['cathode', -dLed],
            ['collector', dVce], ['emitter', -dVce]]));
        }
        return { region: 'smooth', currents, jacobian, residualOhms: 1e5 };
      });
    },

    update(part, state, read) {
      // Reporting only: the electrical law is solved inside the network.
      state._on = read('anode') - read('cathode') > (part.params?.vf ?? 1.2);
      return false;
    },
  });

  // ─── LM339 Quad comparator ────────────────────────────────────────
  // Same as LM393 but four channels. Open-collector outputs.
  registerDevice('lm339', {
    terminals: ['1_pos', '1_neg', '1_out', '2_pos', '2_neg', '2_out',
                '3_pos', '3_neg', '3_out', '4_pos', '4_neg', '4_out', 'vcc', 'gnd'],

    init() {
      return {
        drives: { '1_out': null, '2_out': null, '3_out': null, '4_out': null },
        _comp: [null, null, null, null], // null = not yet evaluated (see lm393)
      };
    },

    update(part, state, read) {
      const h = part.params?.hysteresis ?? 0; // E3.6, same contract as lm393
      let changed = false;
      for (let i = 1; i <= 4; i++) {
        const d = read(`${i}_pos`) - read(`${i}_neg`);
        const prev = state._comp[i - 1];
        const result = (h === 0 || prev === null) ? (d > 0 ? 1 : 0)
          : (prev === 1 ? (d < -h / 2 ? 0 : 1) : (d > h / 2 ? 1 : 0));
        if (result !== prev) {
          state._comp[i - 1] = result;
          state.drives[`${i}_out`] = result ? null : { vTh: 0.2, rTh: 10 };
          changed = true;
        }
      }
      return changed;
    },
  });

  // ─── 556 Dual timer ───────────────────────────────────────────────
  // Two independent 555 timer channels in one package.
  // Terminals prefixed with 1_ and 2_ for each channel.
  registerDevice('timer_556', {
    terminals: [
      '1_trigger', '1_threshold', '1_control', '1_discharge', '1_output', '1_reset',
      '2_trigger', '2_threshold', '2_control', '2_discharge', '2_output', '2_reset',
      'vcc', 'gnd',
    ],

    init(part) {
      const rOut = part.params?.rOut ?? 50;
      return {
        drives: {
          '1_output': { vTh: 0, rTh: rOut },
          '2_output': { vTh: 0, rTh: rOut },
        },
        _ch: [
          { ffOut: 0, dischargeActive: true },
          { ffOut: 0, dischargeActive: true },
        ],
      };
    },

    stamp(ctx, part, state) {
      const rDiv = 5000;
      const rDischarge = 10;

      for (const prefix of ['1_', '2_']) {
        // Internal divider on control pin
        ctx.conductance('vcc', `${prefix}control`, 1 / rDiv);
        ctx.conductance(`${prefix}control`, 'gnd', 1 / (rDiv * 2));
      }

      // Discharge switches
      const ch1 = state._ch[0];
      const ch2 = state._ch[1];
      if (ch1.dischargeActive) ctx.conductance('1_discharge', 'gnd', 1 / rDischarge);
      if (ch2.dischargeActive) ctx.conductance('2_discharge', 'gnd', 1 / rDischarge);
    },

    update(part, state, read) {
      const vcc = read('vcc');
      const vGnd = read('gnd');
      const rOut = part.params?.rOut ?? 50;
      let changed = false;

      for (let ch = 0; ch < 2; ch++) {
        const prefix = `${ch + 1}_`;
        const cs = state._ch[ch];

        const vThreshold = read(`${prefix}threshold`) - vGnd;
        const vTrigger = read(`${prefix}trigger`) - vGnd;
        const vControl = read(`${prefix}control`) - vGnd;
        const vReset = read(`${prefix}reset`) - vGnd;
        const effectiveVcc = vcc - vGnd;

        if (effectiveVcc < 0.5) continue;

        const upperThreshold = vControl;
        const lowerThreshold = vControl / 2;
        const resetActive = vReset < (effectiveVcc * 0.3);

        let newFf = cs.ffOut;
        if (resetActive) newFf = 0;
        else {
          if (vThreshold > upperThreshold) newFf = 0;
          if (vTrigger < lowerThreshold) newFf = 1;
        }

        if (newFf !== cs.ffOut) {
          cs.ffOut = newFf;
          cs.dischargeActive = (newFf === 0);
          state.drives[`${prefix}output`] = {
            vTh: newFf ? vcc : vGnd,
            rTh: rOut,
          };
          changed = true;
        }
      }
      return changed;
    },
  });
}
