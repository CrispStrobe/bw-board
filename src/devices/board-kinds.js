/**
 * Board-kind device models — Arduino Nano, Arduino Uno, Pi Pico.
 *
 * These represent the development board as a whole. Their power pins (5V,
 * 3V3, GND, VIN, VBUS, VSYS) are stamped as Thévenin sources / ground
 * references so the solver sees them as real supply terminals — identical
 * to what standalone VCC/GND parts provide.
 *
 * GPIO terminals are NOT stamped here. They are driven by the boundary-A
 * adapter (avr8js-adapter, rp2040js-adapter) via board.setPin(); the
 * board copies those pin states into this model's `state.drives` before
 * each solve (the `gpioFollowsPinStates` flag below) — the same Thévenin
 * treatment MCU-kind pins get. The device model itself handles only the
 * power rails the adapter doesn't touch. (Until 2026-08-13 this header
 * CLAIMED the pinSources path covered board-kind GPIO; no such path
 * existed, and a bench LED on a board-kind part never lit at engine
 * level — the app's canvas had been reading pin states directly.)
 *
 * Why not just use separate VCC/GND parts? Because the designer places
 * ONE board (e.g. an Arduino Nano), and that board has 5V, 3V3, GND, GND2
 * pins on its header. Making those act as real sources means a user can
 * wire an LED to the Nano's 5V pin and see the correct voltage without
 * having to also place a standalone VCC part.
 *
 * @module
 */

import { registerDevice } from '../devices.js';

/** Very low source impedance for regulated supply pins (mΩ). */
const R_SUPPLY = 0.1;

// ─── Terminal classification ─────────────────────────────────────────────

/** Classify a terminal name by electrical role. */
function classifyTerminal(name) {
  // Ground pins: gnd, gnd2, gnd3, gnd_1–gnd_7, agnd, swd_gnd
  if (/^gnd\d?$|^gnd_\d+$|^agnd$|^swd_gnd$/.test(name)) return 'gnd';
  // 5V supply: 5v
  if (name === '5v') return '5v';
  // 3.3V supply: 3v3
  if (name === '3v3') return '3v3';
  // USB VBUS (5V from USB)
  if (name === 'vbus') return '5v';
  // VSYS on Pico: system supply, 1.8–5.5V, typically 5V from USB
  if (name === 'vsys') return 'vsys';
  // VIN: external voltage input (7–12V for Arduino, not driven by the board)
  if (name === 'vin') return 'vin';
  // Reference and control pins with no power role
  if (name === 'aref' || name === 'adc_vref' || name === '3v3_en') return 'ref';
  if (name === 'reset' || name === 'reset2' || name === 'run') return 'ref';
  if (name === 'swclk' || name === 'swdio') return 'ref';
  // Everything else is a GPIO (d0–d13, a0–a7, gp0–gp28)
  return 'gpio';
}

/**
 * Build a device model for a board kind given its terminal list.
 * Power terminals are stamped; GPIO terminals are left for the adapter.
 */
function boardModel(allTerminals, boardVcc) {
  const powerTerminals = [];
  const gpioTerminals = [];
  for (const t of allTerminals) {
    const role = classifyTerminal(t);
    if (role === 'gpio') gpioTerminals.push(t);
    else powerTerminals.push({ name: t, role });
  }

  return {
    terminals: allTerminals,

    init() {
      const drives = {};
      for (const { name, role } of powerTerminals) {
        if (role === '5v') {
          drives[name] = { vTh: 5.0, rTh: R_SUPPLY };
        } else if (role === '3v3') {
          drives[name] = { vTh: 3.3, rTh: R_SUPPLY };
        } else if (role === 'vsys') {
          // Default: USB-powered, VSYS ≈ 5V through a Schottky diode
          drives[name] = { vTh: 4.7, rTh: R_SUPPLY };
        } else if (role === 'gnd') {
          drives[name] = { vTh: 0, rTh: R_SUPPLY };
        }
        // vin, ref: not driven (high-Z), so no entry in drives
      }
      return { drives };
    },

    stamp(ctx, part, state) {
      for (const { name, role } of powerTerminals) {
        if (role === '5v') {
          ctx.thevenin(name, 5.0, R_SUPPLY);
        } else if (role === '3v3') {
          ctx.thevenin(name, 3.3, R_SUPPLY);
        } else if (role === 'vsys') {
          ctx.thevenin(name, 4.7, R_SUPPLY);
        } else if (role === 'gnd') {
          ctx.thevenin(name, 0, R_SUPPLY);
        }
        // vin: external input, high-Z (a pull-down to stop it floating)
        else if (role === 'vin') {
          ctx.conductance(name, null, 1 / 1e6);
        }
      }
    },

    update() { return false; }, // static power rails

    // The board copies pinStates onto state.drives for GPIO terminals
    // before each solve; power-rail entries (set at init) are never
    // overwritten. vcc is the board's logic level — a Pico pin drives
    // 3.3 V, a Nano pin 5 V, whatever the bench supply is.
    gpioFollowsPinStates: true,
    vcc: boardVcc,
  };
}

// ─── Arduino Nano ────────────────────────────────────────────────────────

const NANO_TERMINALS = [
  'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'd8', 'd9', 'd10', 'd11', 'd12', 'd13',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  '5v', '3v3', 'gnd', 'gnd2', 'vin', 'aref', 'reset', 'reset2',
];

// ─── Arduino Uno ─────────────────────────────────────────────────────────

const UNO_TERMINALS = [
  'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7',
  'd8', 'd9', 'd10', 'd11', 'd12', 'd13',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5',
  '5v', '3v3', 'gnd', 'gnd2', 'gnd3', 'vin', 'aref', 'reset',
];

// ─── Arduino Mega 2560 ───────────────────────────────────────────────────
// 78 terminals, spellings from the bw-parts sidecar (arduino_mega.json).
// Unregistered until 2026-08-16, so a Mega body was ELECTRICALLY DEAD —
// same class of bug as the bare-chip gap, found by the example sweep.

const MEGA_TERMINALS = [
  'd0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8', 'd9',
  'd10', 'd11', 'd12', 'd13', 'gnd', 'aref', 'd14', 'd15', 'd16', 'd17',
  'd18', 'd19', 'd20', 'd21', 'reset', '3v3', '5v', 'gnd2', 'gnd3', 'vin',
  'a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7',
  'a8', 'a9', 'a10', 'a11', 'a12', 'a13', 'a14', 'a15',
  'd22', 'd23', 'd24', 'd25', 'd26', 'd27', 'd28', 'd29', 'd30', 'd31',
  'd32', 'd33', 'd34', 'd35', 'd36', 'd37', 'd38', 'd39', 'd40', 'd41',
  'd42', 'd43', 'd44', 'd45', 'd46', 'd47', 'd48', 'd49', 'd50', 'd51',
  'd52', 'd53',
];

// ─── Pi Pico ─────────────────────────────────────────────────────────────

const PICO_TERMINALS = [
  'gp0', 'gp1', 'gp2', 'gp3', 'gp4', 'gp5', 'gp6', 'gp7',
  'gp8', 'gp9', 'gp10', 'gp11', 'gp12', 'gp13', 'gp14', 'gp15',
  'gp16', 'gp17', 'gp18', 'gp19', 'gp20', 'gp21', 'gp22',
  'gp25',  // onboard LED pin (not on header, but electrically real)
  'gp26', 'gp27', 'gp28',
  'vbus', 'vsys', '3v3', '3v3_en', 'adc_vref',
  'gnd_1', 'gnd_2', 'gnd_3', 'gnd_4', 'gnd_5', 'gnd_6', 'gnd_7',
  'agnd', 'swd_gnd',
  'run', 'swclk', 'swdio',
];

// ─── Eater 6502 breadboard computer ─────────────────────────────────────

const EATER6502_TERMINALS = [
  // VIA1 port A (PA0-PA7) — main GPIO, LED bar, LCD, etc.
  'via1.pa0', 'via1.pa1', 'via1.pa2', 'via1.pa3',
  'via1.pa4', 'via1.pa5', 'via1.pa6', 'via1.pa7',
  // VIA1 port B (PB0-PB7) — PB6 is T2 pulse input, PB7 is T1 square wave
  'via1.pb0', 'via1.pb1', 'via1.pb2', 'via1.pb3',
  'via1.pb4', 'via1.pb5', 'via1.pb6', 'via1.pb7',
  // Power rails
  '5v', 'gnd',
];

// ─── Bare MCU chips (DIP bodies, not dev boards) ────────────────────────
//
// A bare chip differs from a dev board in exactly one way: it has no
// regulator, so its vcc/avcc/gnd pins are CONSUMERS — the bench supplies
// them via wired VCC/GND symbols. Stamping them as sources here would
// fight whatever the user actually wired (a 3.3 V bench on an attiny's
// vcc pin must win). So: no power drives, no stamp; GPIO terminals
// follow pinStates exactly like board-kind GPIO does.
//
// Without this registration the chip was ELECTRICALLY ABSENT: the
// boundary-A adapter published pin states nobody consumed, because
// board.js's _pinSources recognizes only kind 'mcu' (the STC12 body).
// The blinkenrocket pendant's matrix stayed dark with a perfectly
// running firmware (owner report, 2026-08-16).

function bareChipModel(allTerminals, chipVcc) {
  return {
    terminals: allTerminals,
    init() { return { drives: {} }; },
    update() { return false; },
    gpioFollowsPinStates: true,
    vcc: chipVcc,
  };
}

// Terminal spellings must match the bw-parts sidecar (the netlist's own
// namespace) — this is what the adapter's lowercased AVR pin names join
// against. DIP-28, per the audited sidecar.
const ATTINY88_TERMINALS = [
  'pc6', 'pd0', 'pd1', 'pd2', 'pd3', 'pd4', 'vcc', 'gnd',
  'pb6', 'pb7', 'pd5', 'pd6', 'pd7', 'pb0', 'pb1', 'pb2',
  'pb3', 'pb4', 'pb5', 'avcc', 'pa0', 'pc0', 'pc1', 'pc2',
  'pc3', 'pc4', 'pc5', 'pc7',
];

// DIP-8. pb5 doubles as reset on the real part; electrically it is a pin.
const ATTINY85_TERMINALS = [
  'pb5', 'pb3', 'pb4', 'gnd', 'pb0', 'pb1', 'pb2', 'vcc',
];

// STC15F2K60S2 PDIP-40. NOT pin-compatible with the STC12: VCC is pin 18
// (not 40), RST is pin 17 (P5.4, shared with GPIO), P0 runs ASCENDING
// (pin 1 = P0.0), XTAL shares P1.6/P1.7 (=ADC6/7). Pin order follows
// the DIP package (1..20 left, 40..21 right).
// Source: stc repo docs/PINOUT-STC15.md, cross-checked against the 100
// gallery benches' terminal references.
// Both upper- and lowercase forms are registered because the gallery
// benches mix cases (some generated by the circuit-builder with uppercase
// port names, others with lowercase).
const STC15_TERMINALS = [
  // Left side, pins 1–20 (top to bottom)
  'P0.0', 'P0.1', 'P0.2', 'P0.3', 'P0.4', 'P0.5', 'P0.6', 'P0.7', // 1-8
  'P1.0', 'P1.1', 'P1.2', 'P1.3', 'P1.4', 'P1.5',                  // 9-14
  'P1.6', 'P1.7',                                                     // 15-16 (XTAL2/XTAL1 shared)
  'P5.4',                                                              // 17 (RST shared)
  'VCC',                                                               // 18
  'P5.5',                                                              // 19
  'GND',                                                               // 20
  // Right side, pins 40 DOWN TO 21 — the order the package RENDERS in.
  // Pin 1 is top-left and pins descend the left column to 20 at the
  // bottom-left; pin 21 is bottom-right and they ascend to 40 at the
  // top-right. So a symbol drawn top-to-bottom lists 40, 39, … 21.
  // (Ordered 21→40 until this commit, which disagreed with
  // bw-circuit-ui's own stc15_mcu sidecar — and terminal order is what
  // drives wire-attachment positions on that side. The sidecar was
  // right; docs/PINOUT-STC15.md's DIP diagram in the stc repo settles
  // it: pin 40 = P4.5/ALE top-right, pin 21 = P3.0/RxD bottom-right.)
  'P4.5',                                                              // 40
  'P2.7', 'P2.6', 'P2.5', 'P2.4', 'P2.3', 'P2.2', 'P2.1', 'P2.0', // 39-32
  'P4.4',                                                              // 31
  'P4.2', 'P4.1',                                                     // 30-29
  'P3.7', 'P3.6', 'P3.5', 'P3.4', 'P3.3', 'P3.2', 'P3.1', 'P3.0', // 28-21
  // Lowercase aliases, same order (some benches use lowercase port names)
  'p0.0', 'p0.1', 'p0.2', 'p0.3', 'p0.4', 'p0.5', 'p0.6', 'p0.7',
  'p1.0', 'p1.1', 'p1.2', 'p1.3', 'p1.4', 'p1.5', 'p1.6', 'p1.7',
  'p5.4', 'vcc', 'p5.5', 'gnd',
  'p4.5',
  'p2.7', 'p2.6', 'p2.5', 'p2.4', 'p2.3', 'p2.2', 'p2.1', 'p2.0',
  'p4.4',
  'p4.2', 'p4.1',
  'p3.7', 'p3.6', 'p3.5', 'p3.4', 'p3.3', 'p3.2', 'p3.1', 'p3.0',
];

/**
 * Register board-kind device models.
 */
export function registerBoardKinds() {
  registerDevice('arduino_nano', boardModel(NANO_TERMINALS, 5.0));
  registerDevice('arduino_uno', boardModel(UNO_TERMINALS, 5.0));
  registerDevice('arduino_mega', boardModel(MEGA_TERMINALS, 5.0));
  registerDevice('pi_pico', boardModel(PICO_TERMINALS, 3.3));
  registerDevice('eater6502', boardModel(EATER6502_TERMINALS, 5.0));
  registerDevice('attiny88', bareChipModel(ATTINY88_TERMINALS, 5.0));
  registerDevice('attiny85', bareChipModel(ATTINY85_TERMINALS, 5.0));
  registerDevice('stc15_mcu', bareChipModel(STC15_TERMINALS, 5.0));
}
