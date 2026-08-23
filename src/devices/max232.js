/**
 * MAX232 — dual RS-232 driver/receiver (DIP-16), E5.10.
 *
 * What it claims: the LEVEL story of the canonical wiring. The two
 * drivers invert TTL to ±8 V behind ~300 Ω (the real pump makes about
 * ±8.5 V from 5 V); the two receivers invert RS-232 back to TTL with the
 * datasheet's ~1.3 V threshold and a real 5 kΩ input load. V+ and V−
 * present the pump rails behind 1 kΩ so a probe reads them, and the four
 * capacitor pins are honest nodes (a drawn 1 µF to them wires cleanly)
 * without pretending to simulate the switched pump itself.
 *
 * What it does NOT claim: pump ripple, slew, or the serial DATA path —
 * bytes ride the ACIA/UART hooks, this part makes the drawn level
 * shifting truthful.
 *
 * Terminals in DIP-16 package order (TI MAX232 datasheet, SLLS047):
 * 1 C1+, 2 V+, 3 C1−, 4 C2+, 5 C2−, 6 V−, 7 T2OUT, 8 R2IN,
 * 9 R2OUT, 10 T2IN, 11 T1IN, 12 R1OUT, 13 R1IN, 14 T1OUT, 15 GND, 16 VCC.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

const R_DRIVER = 300;    // RS-232 driver output impedance
const R_RAIL = 1000;     // V+/V− presented behind this
const R_RXIN = 5000;     // datasheet receiver input resistance
const R_INPUT = 1e6;     // TTL input loading
const V_PUMP = 8;        // the pump's ±rail from a 5 V supply (≈ ±8.5 V real)
const V_TTL_TH = 1.4;    // TTL input center (it is a TTL-input part)
const V_RS232_TH = 1.3;  // receiver threshold, datasheet typical

export function registerMax232() {
  registerDevice('max232', {
    terminals: ['c1p', 'vp', 'c1m', 'c2p', 'c2m', 'vm',
      't2out', 'r2in', 'r2out', 't2in', 't1in', 'r1out', 'r1in', 't1out',
      'gnd', 'vcc'],

    init() {
      return { drives: {}, _sig: '' };
    },

    stamp(ctx) {
      ctx.conductance('t1in', null, 1 / R_INPUT);
      ctx.conductance('t2in', null, 1 / R_INPUT);
      // Receiver inputs really do load the line — it is how a
      // disconnected RS-232 input idles low (mark) through the 5 k.
      ctx.conductance('r1in', null, 1 / R_RXIN);
      ctx.conductance('r2in', null, 1 / R_RXIN);
      // Pump capacitor pins: real nodes, no invented behavior.
      for (const t of ['c1p', 'c1m', 'c2p', 'c2m']) {
        ctx.conductance(t, null, 1e-12);
      }
    },

    update(part, state, read) {
      const vccV = read('vcc');
      const powered = vccV > 3;
      const drives = {};
      if (powered) {
        // Pump rails, visible to a probe.
        drives.vp = { vTh: V_PUMP, rTh: R_RAIL };
        drives.vm = { vTh: -V_PUMP, rTh: R_RAIL };
        // Drivers: TTL in, INVERTED ±8 V out.
        drives.t1out = { vTh: read('t1in') > V_TTL_TH ? -V_PUMP : V_PUMP, rTh: R_DRIVER };
        drives.t2out = { vTh: read('t2in') > V_TTL_TH ? -V_PUMP : V_PUMP, rTh: R_DRIVER };
        // Receivers: RS-232 in, INVERTED TTL out. An open input reads
        // 0 V through its own 5 k load — below threshold — so R*OUT
        // idles HIGH, which is the datasheet's fail-safe.
        drives.r1out = { vTh: read('r1in') > V_RS232_TH ? 0 : vccV, rTh: R_DRIVER };
        drives.r2out = { vTh: read('r2in') > V_RS232_TH ? 0 : vccV, rTh: R_DRIVER };
      }
      const sig = JSON.stringify(drives);
      if (sig === state._sig) return false;
      state._sig = sig;
      state.drives = drives;
      return true;
    },
  });
}
