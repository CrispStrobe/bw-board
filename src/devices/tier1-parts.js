/**
 * Tier 1 parts from the target catalogue — the gap-closers.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_OUT = 50;
// Input pins draw nothing here, on purpose. These models used to declare
// `ctx.conductance(pin, null, 1 / R_INPUT)` with R_INPUT = 1e6 — a call that
// names no second terminal, which stampTwoTerminal's air-leg guard declines,
// so it never stamped. 1 MOhm is not a CMOS input either (a 74HC draws 1 uA
// max). The ideal high-Z input IS the model, and GMIN keeps every pin a real
// node. See spec-updates/ideal-high-z-inputs.md.

export function registerTier1Parts() {

  // ─── Photodiode ───────────────────────────────────────────────────
  // Reverse-biased diode that generates current proportional to light.
  // In photoconductive mode: acts as a light-controlled current source.
  registerDevice('photodiode', {
    terminals: ['anode', 'cathode'],
    init() { return { drives: {}, _current: 0 }; },
    stamp(ctx, part, state) {
      if (state._current > 0) {
        // Photo-current flows cathode → anode (reverse direction)
        ctx.current('cathode', -state._current);
        ctx.current('anode', state._current);
      }
    },
    update(part, state) {
      const light = part.params?.light ?? 0;
      const iMax = part.params?.iMax ?? 0.001; // 1mA at full light
      const newCurrent = light * iMax;
      if (Math.abs(newCurrent - state._current) < 1e-7) return false;
      state._current = newCurrent;
      return true;
    },
  });

  // ─── Soil moisture sensor ─────────────────────────────────────────
  // Resistance between probes varies with moisture (like a resistive sensor).
  // Dry = high R, wet = low R. Also has analog output pin (voltage divider).
  registerDevice('soil_moisture', {
    terminals: ['vcc', 'gnd', 'out'],
    init(part) {
      const moisture = part.params?.moisture ?? 0;
      const vOut = 5.0 * (1 - moisture); // dry = high voltage, wet = low
      return { drives: { out: { vTh: vOut, rTh: R_OUT } }, _moisture: moisture };
    },
    stamp(ctx) { /* output via state.drives */ },
    update(part, state, read) {
      const moisture = part.params?.moisture ?? 0;
      if (Math.abs(moisture - state._moisture) < 0.01) return false;
      const vcc = read('vcc') || 5.0;
      state._moisture = moisture;
      state.drives.out = { vTh: vcc * (1 - moisture), rTh: R_OUT };
      return true;
    },
  });

  // ─── Relay DPDT ───────────────────────────────────────────────────
  // Double-pole double-throw: two independent SPDT switches controlled by one coil.
  registerDevice('relay_dpdt', {
    terminals: ['coil_a', 'coil_b', 'com1', 'nc1', 'no1', 'com2', 'nc2', 'no2'],
    init() { return { drives: {}, energized: false, _pendingState: null }; },
    stamp(ctx, part, state) {
      const coilR = part.params?.coilR ?? 200;
      ctx.conductance('coil_a', 'coil_b', 1 / coilR);
      const rContact = 0.1;
      const rOpen = 1e9;
      if (state.energized) {
        ctx.conductance('com1', 'no1', 1 / rContact);
        ctx.conductance('com1', 'nc1', 1 / rOpen);
        ctx.conductance('com2', 'no2', 1 / rContact);
        ctx.conductance('com2', 'nc2', 1 / rOpen);
      } else {
        ctx.conductance('com1', 'nc1', 1 / rContact);
        ctx.conductance('com1', 'no1', 1 / rOpen);
        ctx.conductance('com2', 'nc2', 1 / rContact);
        ctx.conductance('com2', 'no2', 1 / rOpen);
      }
    },
    update(part, state, read, tNs) {
      const pullInV = part.params?.pullInV ?? 3.7;
      const dropOutV = part.params?.dropOutV ?? 1.5;
      const switchTimeMs = part.params?.switchTimeMs ?? 5;
      const switchTimeNs = BigInt(Math.round(switchTimeMs * 1e6));
      const vCoil = Math.abs(read('coil_a') - read('coil_b'));
      let target = state.energized;
      if (vCoil > pullInV) target = true;
      else if (vCoil < dropOutV) target = false;
      if (target === state.energized && !state._pendingState) return false;
      if (target !== state.energized && !state._pendingState) {
        if (switchTimeNs === 0n) { state.energized = target; return true; }
        state._pendingState = { target, deadlineNs: tNs + switchTimeNs };
        return false;
      }
      if (state._pendingState && state._pendingState.target !== target) {
        state._pendingState = null; return false;
      }
      if (state._pendingState && tNs >= state._pendingState.deadlineNs) {
        state.energized = state._pendingState.target;
        state._pendingState = null;
        return true;
      }
      return false;
    },
  });

  // ─── Solar cell ───────────────────────────────────────────────────
  // Photovoltaic: voltage source proportional to light, with internal R.
  registerDevice('solar_cell', {
    terminals: ['pos', 'neg'],
    init(part) {
      const light = part.params?.light ?? 1.0;
      const voc = (part.params?.voc ?? 0.6) * light;
      return { drives: { pos: { vTh: voc, rTh: part.params?.rInternal ?? 5 } }, _light: light };
    },
    stamp(ctx, part, state) {
      const light = part.params?.light ?? 1.0;
      const voc = (part.params?.voc ?? 0.6) * light;
      const rInt = part.params?.rInternal ?? 5;
      ctx.thevenin('pos', voc, rInt);
    },
    update(part, state) {
      const light = part.params?.light ?? 1.0;
      if (Math.abs(light - state._light) < 0.01) return false;
      const voc = (part.params?.voc ?? 0.6) * light;
      state._light = light;
      state.drives.pos = { vTh: voc, rTh: part.params?.rInternal ?? 5 };
      return true;
    },
  });

  // ─── Gearmotor ───────────────────────────────────────────────────
  // DC motor with gear ratio: output speed = motor speed / ratio.
  registerDevice('gearmotor', {
    terminals: ['a', 'b'],
    init() { return { drives: {}, omega: 0, outputRpm: 0, _lastTNs: 0n }; },
    stamp(ctx, part, state) {
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;
      ctx.conductance('a', 'b', 1 / R);
      const backEMF = kV * state.omega;
      if (Math.abs(backEMF) > 1e-12) {
        ctx.current('a', -backEMF / R);
        ctx.current('b', backEMF / R);
      }
    },
    update(part, state, read, tNs) {
      const R = part.params?.windingR ?? 10;
      const kV = part.params?.kV ?? 0.01;
      const kT = part.params?.kT ?? kV;
      const J = part.params?.J ?? 0.001;
      const ratio = part.params?.gearRatio ?? 48;
      if (state._lastTNs === 0n) { state._lastTNs = tNs; return false; }
      const dtSec = Number(tNs - state._lastTNs) / 1e9;
      state._lastTNs = tNs;
      if (dtSec <= 0) return false;
      const current = (read('a') - read('b') - kV * state.omega) / R;
      const torque = kT * current;
      const oldOmega = state.omega;
      state.omega = Math.max(0, state.omega + (torque / J) * dtSec);
      state.outputRpm = (state.omega * 60 / (2 * Math.PI)) / ratio;
      return Math.abs(state.omega - oldOmega) > 0.1;
    },
  });

  // ─── 74HC75: 4-bit level-triggered latch ──────────────────────────
  // Transparent when enable HIGH, latches on falling edge of enable.
  //
  // BOTH outputs. The real DIP16 brings out Q and /Q for all four bits —
  // that is what fills a sixteen-pin package for a four-bit latch — and
  // this modelled Q only, so four of the chip's pins could be wired on a
  // board and reached by nothing in the app. Naming follows the 74HC73
  // and '74 next door: q_bar, not qn.
  registerDevice('74hc75', {
    terminals: ['1d', '2d', '3d', '4d', '1e', '2e',
                '1q', '2q', '3q', '4q',
                '1q_bar', '2q_bar', '3q_bar', '4q_bar', 'vcc', 'gnd'],
    init() {
      return {
        drives: { '1q': { vTh: 0, rTh: R_OUT }, '2q': { vTh: 0, rTh: R_OUT },
                  '3q': { vTh: 0, rTh: R_OUT }, '4q': { vTh: 0, rTh: R_OUT },
                  '1q_bar': { vTh: 0, rTh: R_OUT }, '2q_bar': { vTh: 0, rTh: R_OUT },
                  '3q_bar': { vTh: 0, rTh: R_OUT }, '4q_bar': { vTh: 0, rTh: R_OUT } },
        _latch: [0, 0, 0, 0],
        _lastEn: [false, false],
      };
    },
    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const threshold = vcc * 0.5;
      let changed = false;
      // Enable 1 controls bits 1,2; Enable 2 controls bits 3,4
      const en1 = read('1e') > threshold;
      const en2 = read('2e') > threshold;
      // Level-triggered: transparent while enable HIGH
      const bits = [read('1d') > threshold ? 1 : 0, read('2d') > threshold ? 1 : 0,
                    read('3d') > threshold ? 1 : 0, read('4d') > threshold ? 1 : 0];
      for (let i = 0; i < 2; i++) {
        if (en1) { if (bits[i] !== state._latch[i]) { state._latch[i] = bits[i]; changed = true; } }
      }
      for (let i = 2; i < 4; i++) {
        if (en2) { if (bits[i] !== state._latch[i]) { state._latch[i] = bits[i]; changed = true; } }
      }
      state._lastEn = [en1, en2];
      // Reconcile every pass rather than only when the latch moves. The old
      // form wrote the drives inside `if (changed)`, which was harmless while
      // init's zeros matched a zero latch — but /Q starts HIGH, so a
      // conditional write would leave all four inverted outputs stuck low
      // until the first bit happened to change.
      for (let i = 0; i < 4; i++) {
        const q = state._latch[i] ? vcc : 0;
        const qb = state._latch[i] ? 0 : vcc;
        if (state.drives[`${i + 1}q`].vTh !== q) {
          state.drives[`${i + 1}q`] = { vTh: q, rTh: R_OUT };
          changed = true;
        }
        if (state.drives[`${i + 1}q_bar`].vTh !== qb) {
          state.drives[`${i + 1}q_bar`] = { vTh: qb, rTh: R_OUT };
          changed = true;
        }
      }
      return changed;
    },
  });

  // ─── 74HC283: 4-bit binary full adder ─────────────────────────────
  // A0-A3 + B0-B3 + Cin → S0-S3 + Cout. Purely combinational.
  registerDevice('74hc283', {
    terminals: ['a0','a1','a2','a3','b0','b1','b2','b3','cin','s0','s1','s2','s3','cout','vcc','gnd'],
    init() {
      return { drives: { s0:{vTh:0,rTh:R_OUT}, s1:{vTh:0,rTh:R_OUT},
                         s2:{vTh:0,rTh:R_OUT}, s3:{vTh:0,rTh:R_OUT}, cout:{vTh:0,rTh:R_OUT} } };
    },
    update(part, state, read) {
      const vcc = read('vcc') || 5.0;
      const t = vcc * 0.5;
      const a = (read('a0')>t?1:0)|(read('a1')>t?2:0)|(read('a2')>t?4:0)|(read('a3')>t?8:0);
      const b = (read('b0')>t?1:0)|(read('b1')>t?2:0)|(read('b2')>t?4:0)|(read('b3')>t?8:0);
      const cin = read('cin') > t ? 1 : 0;
      const sum = a + b + cin;
      const s = sum & 0xF;
      const cout = (sum >> 4) & 1;
      let changed = false;
      for (let i = 0; i < 4; i++) {
        const bit = (s >> i) & 1;
        const d = { vTh: bit ? vcc : 0, rTh: R_OUT };
        if ((state.drives[`s${i}`]?.vTh ?? -1) !== d.vTh) { state.drives[`s${i}`] = d; changed = true; }
      }
      const cd = { vTh: cout ? vcc : 0, rTh: R_OUT };
      if ((state.drives.cout?.vTh ?? -1) !== cd.vTh) { state.drives.cout = cd; changed = true; }
      return changed;
    },
  });

  // ─── Header (passive connector) ──────────────────────────────────
  // Just terminal pairs — no electrical behavior, purely a wiring helper.
  registerDevice('header', {
    terminals: ['p1','p2','p3','p4','p5','p6','p7','p8'],
    init() { return { drives: {} }; },
    stamp() { /* purely passive — terminals only */ },
    update() { return false; },
  });

  // ─── USB-A connector ──────────────────────────────────────────────
  // 5V power + data lines. Power modeled as a voltage source.
  registerDevice('usb_a', {
    terminals: ['vbus', 'dm', 'dp', 'gnd'],
    init() { return { drives: { vbus: { vTh: 5.0, rTh: 0.5 } } }; },
    stamp(ctx) { ctx.thevenin('vbus', 5.0, 0.5); },
    update() { return false; },
  });

  // ─── IR remote transmitter ────────────────────────────────────────
  // Modulated IR LED. Electrically an LED; state tracks protocol data.
  registerDevice('ir_remote', {
    terminals: ['anode', 'cathode'],
    init() { return { drives: {}, transmitting: false }; },
    stamp(ctx) { ctx.conductance('anode', 'cathode', 1 / 110); },
    update(part, state, read) {
      const v = read('anode') - read('cathode');
      const newTx = v > 1.0;
      if (newTx === state.transmitting) return false;
      state.transmitting = newTx;
      return false;
    },
  });

  // ─── Clock display (TM1637-style 4-digit 7-segment) ───────────────
  // 2-wire serial interface (CLK + DIO). Stores 4 digits + colon state.
  registerDevice('clock_display', {
    terminals: ['clk', 'dio', 'vcc', 'gnd'],
    init() {
      return { drives: {}, digits: [0, 0, 0, 0], colon: false,
               _bitCount: 0, _byte: 0, _lastClk: false };
    },
    update(part, state, read) {
      // Simplified TM1637 protocol: clock in bytes, decode as segment data
      const vcc = read('vcc') || 5.0;
      const threshold = vcc * 0.5;
      const clk = read('clk') > threshold;
      const dio = read('dio') > threshold;

      if (clk && !state._lastClk) {
        // Rising clock edge: sample DIO
        state._byte = (state._byte << 1) | (dio ? 1 : 0);
        state._bitCount++;
        if (state._bitCount >= 8) {
          // Got a byte — simplified: treat as digit data
          const idx = Math.min(3, Math.floor(state._bitCount / 8) - 1);
          state.digits[idx] = state._byte & 0x7F;
          state.colon = !!(state._byte & 0x80);
          state._byte = 0;
          state._bitCount = 0;
        }
      }
      state._lastClk = clk;
      return false; // display state only, no electrical change
    },
  });
}
