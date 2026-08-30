/**
 * Named part variants — real part numbers as aliases with fixed params.
 *
 * These are thin wrappers that register specific part numbers with their
 * datasheet parameters pre-set. Consumers use the real part name (e.g.
 * 'battery_9v', 'lm7805') and get correct electrical behavior.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
const R_INPUT = 1e6;

/**
 * Register named part variants.
 */
export function registerNamedParts() {

  // ─── Battery variants ─────────────────────────────────────────────

  // 9V PP3 battery: 9V EMF, ~1Ω internal resistance
  registerDevice('battery_9v', {
    terminals: ['pos', 'neg'],
    init() { return { drives: { pos: { vTh: 9.0, rTh: 1.0 } } }; },
    stamp(ctx) { ctx.thevenin('pos', 9.0, 1.0); },
    update() { return false; },
  });

  // 1.5V AA battery: 1.5V EMF, ~0.3Ω internal resistance
  registerDevice('battery_aa', {
    terminals: ['pos', 'neg'],
    init() { return { drives: {} }; },
    stamp(ctx, part) {
      const volts = part.params?.volts ?? 1.5;
      const rInternal = part.params?.rInternal ?? 0.3;
      // One source between the cell's own terminals. A simultaneous
      // state.drives source would put a second Norton in parallel, halve the
      // declared internal resistance, and incorrectly reference pos to ground.
      ctx.theveninBetween('pos', 'neg', volts, rInternal);
    },
    update() { return false; },
  });

  // 3V coin cell (CR2032): 3V EMF, ~10Ω internal resistance (high for coin cells)
  registerDevice('battery_coin', {
    terminals: ['pos', 'neg'],
    init() { return { drives: { pos: { vTh: 3.0, rTh: 10.0 } } }; },
    stamp(ctx) { ctx.thevenin('pos', 3.0, 10.0); },
    update() { return false; },
  });

  // ─── Named voltage regulators ─────────────────────────────────────

  // LM7805: 5V output, 1.5V dropout
  registerDevice('lm7805', {
    terminals: ['in', 'out', 'gnd'],
    init() {
      return { drives: { out: { vTh: 5.0, rTh: 1.0 } }, _vOut: 5.0 };
    },
    stamp(ctx) { ctx.conductance('in', 'gnd', 1 / R_INPUT); },
    update(part, state, read) {
      const vIn = read('in') - read('gnd');
      const actual = Math.min(5.0, Math.max(0, vIn - 1.5));
      if (Math.abs(actual - state._vOut) < 0.01) return false;
      state._vOut = actual;
      state.drives.out = { vTh: read('gnd') + actual, rTh: 1.0 };
      return true;
    },
  });

  // LD1117V33: 3.3V output, 1.1V dropout
  registerDevice('ld1117v33', {
    terminals: ['in', 'out', 'gnd'],
    init() {
      return { drives: { out: { vTh: 3.3, rTh: 0.5 } }, _vOut: 3.3 };
    },
    stamp(ctx) { ctx.conductance('in', 'gnd', 1 / R_INPUT); },
    update(part, state, read) {
      const vIn = read('in') - read('gnd');
      const actual = Math.min(3.3, Math.max(0, vIn - 1.1));
      if (Math.abs(actual - state._vOut) < 0.01) return false;
      state._vOut = actual;
      state.drives.out = { vTh: read('gnd') + actual, rTh: 0.5 };
      return true;
    },
  });

  // The rest of the 78xx/AMS1117 families are the same regulator with
  // different setpoints — one factory, datasheet numbers only.
  const regulator = (kind, vOut, dropout, rOut) => registerDevice(kind, {
    terminals: ['in', 'out', 'gnd'],
    init() {
      return { drives: { out: { vTh: vOut, rTh: rOut } }, _vOut: vOut };
    },
    stamp(ctx) { ctx.conductance('in', 'gnd', 1 / R_INPUT); },
    update(part, state, read) {
      const vIn = read('in') - read('gnd');
      const actual = Math.min(vOut, Math.max(0, vIn - dropout));
      if (Math.abs(actual - state._vOut) < 0.01) return false;
      state._vOut = actual;
      state.drives.out = { vTh: read('gnd') + actual, rTh: rOut };
      return true;
    },
  });
  regulator('lm7809', 9.0, 2.0, 1.0);
  regulator('lm7812', 12.0, 2.0, 1.0);
  regulator('ams1117_50', 5.0, 1.1, 0.5);
  regulator('ams1117_33', 3.3, 1.1, 0.5);

  // ─── Gas sensor (MQ-series style) ────────────────────────────────
  // Resistance decreases with gas concentration.
  // Control param: gas = 0..1 (concentration).
  // Clean air: ~100kΩ, high concentration: ~1kΩ.
  // Two things you can buy, not two names for one. The bare MQ ELEMENT is
  // four wires: a sense resistance that falls with gas, and a heater coil you
  // must power yourself. The MODULE is that element on a carrier with a load
  // resistor, a comparator and a trim pot — four different wires: vcc, gnd,
  // an analog out and a digital one. bw-parts describes the module and this
  // modelled only the element, so its sidecar named pins the engine could not
  // reach. params.package picks; the default stays `element`.
  const ELEMENT = ['a', 'b', 'heater_a', 'heater_b'];
  const MODULE = ['vcc', 'gnd', 'aout', 'dout'];
  const isModule = (part) => part?.params?.package === 'module';
  const senseOhms = (part) => {
    const gas = part.params?.gas ?? 0;
    const rClean = part.params?.rClean ?? 100000;
    const rSaturated = part.params?.rSaturated ?? 1000;
    return rClean * Math.pow(rSaturated / rClean, gas);
  };

  registerDevice('gas_sensor', {
    terminals: ELEMENT,
    terminalsFor: (part) => (isModule(part) ? MODULE : ELEMENT),
    init(part) {
      return {
        drives: isModule(part) ? { aout: { vTh: 0, rTh: R_OUT }, dout: { vTh: 0, rTh: R_OUT } } : {},
        _ohms: 100000,
      };
    },
    stamp(ctx, part, state) {
      if (isModule(part)) {
        // The carrier powers its own heater off the rail. The sense divider
        // is a Thevenin source on aout rather than an internal node, which is
        // what a module's buffered output behaves like anyway.
        ctx.conductance('vcc', 'gnd', 1 / 30);
        return;
      }
      ctx.conductance('a', 'b', 1 / state._ohms);
      // Heater coil: ~30Ω resistive element
      ctx.conductance('heater_a', 'heater_b', 1 / 30);
    },
    update(part, state, read) {
      const newOhms = senseOhms(part);
      let changed = false;
      if (Math.abs(newOhms - state._ohms) / state._ohms >= 0.01) {
        state._ohms = newOhms;
        changed = true;
      }
      if (!isModule(part)) return changed;

      // aout is the divider the carrier builds: Vcc * RL / (Rs + RL). More
      // gas means less Rs, which means MORE volts out — the opposite of what
      // "resistance falls" sounds like, and the reason the test says so.
      const vcc = read('vcc') || 5.0;
      const rl = part.params?.loadOhms ?? 10000;
      const aout = vcc * rl / (state._ohms + rl);
      // dout is a comparator against a trim pot, and it is ACTIVE LOW: the
      // module pulls it down when the gas passes the setpoint.
      const trip = part.params?.trip ?? 0.5;
      const dout = (part.params?.gas ?? 0) >= trip ? 0 : vcc;
      if (Math.abs((state.drives.aout?.vTh ?? -1) - aout) > 1e-3) {
        state.drives.aout = { vTh: aout, rTh: R_OUT };
        changed = true;
      }
      if ((state.drives.dout?.vTh ?? -1) !== dout) {
        state.drives.dout = { vTh: dout, rTh: R_OUT };
        changed = true;
      }
      return changed;
    },
  });

  // ─── Ambient light sensor (analog, like TEMT6000) ─────────────────
  // Output voltage proportional to light level. Linear: 0V (dark) to VCC (bright).
  registerDevice('ambient_light', {
    terminals: ['vcc', 'out', 'gnd'],
    init(part) {
      const light = part.params?.light ?? 0.5;
      return { drives: { out: { vTh: 5.0 * light, rTh: R_OUT } }, _light: light };
    },
    stamp(ctx) { /* output driven by state.drives */ },
    update(part, state, read) {
      const light = part.params?.light ?? 0.5;
      if (Math.abs(light - state._light) < 0.01) return false;
      const vcc = read('vcc') || 5.0;
      state._light = light;
      state.drives.out = { vTh: vcc * light, rTh: R_OUT };
      return true;
    },
  });

  // ─── IR transmitter (just an IR LED electrically) ─────────────────
  // Same as a regular LED but with IR wavelength (not visible).
  // The device state tracks whether it's "emitting" for simulation purposes.
  registerDevice('ir_transmitter', {
    terminals: ['anode', 'cathode'],
    init() { return { drives: {}, emitting: false }; },
    stamp(ctx) {
      // Forward voltage ~1.2V for IR, dynamic R ~10Ω
      ctx.conductance('anode', 'cathode', 1 / 110); // simplified
    },
    update(part, state, read) {
      const v = read('anode') - read('cathode');
      const newEmitting = v > 1.0;
      if (newEmitting === state.emitting) return false;
      state.emitting = newEmitting;
      return false; // no electrical re-solve needed
    },
  });
}
