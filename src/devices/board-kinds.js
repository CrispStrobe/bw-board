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

// ─── Pi Pico ─────────────────────────────────────────────────────────────

const PICO_TERMINALS = [
  'gp0', 'gp1', 'gp2', 'gp3', 'gp4', 'gp5', 'gp6', 'gp7',
  'gp8', 'gp9', 'gp10', 'gp11', 'gp12', 'gp13', 'gp14', 'gp15',
  'gp16', 'gp17', 'gp18', 'gp19', 'gp20', 'gp21', 'gp22',
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

/**
 * Register board-kind device models.
 */
export function registerBoardKinds() {
  registerDevice('arduino_nano', boardModel(NANO_TERMINALS, 5.0));
  registerDevice('arduino_uno', boardModel(UNO_TERMINALS, 5.0));
  registerDevice('pi_pico', boardModel(PICO_TERMINALS, 3.3));
  registerDevice('eater6502', boardModel(EATER6502_TERMINALS, 5.0));
}
