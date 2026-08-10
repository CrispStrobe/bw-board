/**
 * Maximum current ratings per part kind.
 *
 * OWNERSHIP: bw-parts owns the rating DATA (bw-parts/current-ratings.json).
 * bw-board owns the SEMANTICS (what 0 vs null means for the DRC).
 *
 * This module loads bw-parts' canonical data at import time via a vendored
 * copy, applies the semantic mapping, and resolves name aliases.
 *
 * Three states after mapping:
 *   number > 0 — this kind draws this much (amps)
 *   0          — not a consumer of chip supply current (passives, sources)
 *   null       — depends on the circuit; DRC says "depends on your wiring"
 *
 * bw-parts uses a four-state schema:
 *   number     — rated mA
 *   0          — not a consumer
 *   "circuit"  — depends on wiring → mapped to null here
 *   null       — not yet rated → mapped to null here (flagged separately)
 *
 * @module
 */

// ─── Vendored data from bw-parts/current-ratings.json ───────────────────
// This is the canonical source. bw-parts owns names and ratings.
// When bw-parts updates, re-vendor this object.
// Units in bw-parts: mA. Converted to amps below.

/** @type {Record<string, number | string | null>} */
const BW_PARTS_RATINGS = {
  "resistor": 0, "capacitor": 0, "polarized_cap": 0,
  "diode": 0, "zener": 0, "inductor": 0,
  "button": 0, "potentiometer": 0, "slide_switch": 0,
  "dip_switch_spst": 0, "dip_switch_dpst": 0,
  "ldr": 0, "photodiode": 0, "flex_sensor": 0,
  "force_sensor": 0, "tilt_switch": 0, "tilt_switch_v2": 0,
  "ntc": 0, "keypad_4x4": 0, "ir_remote": 0, "switch": 0,
  "light_sensor": 0.1, "ir_receiver": 5, "ultrasonic": 15,
  "ultrasonic_3pin": 15, "pir": 0.15, "soil_moisture": 0.05,
  "tmp36": 0.05, "gas_sensor": 150,
  "led": "circuit", "rgb_led": "circuit", "light_bulb": "circuit",
  "neopixel": "circuit", "neopixel_jewel": "circuit",
  "neopixel_ring": "circuit", "neopixel_strip": "circuit",
  "seven_segment": "circuit",
  "vibration_motor": 80, "dc_motor": "circuit",
  "dc_motor_encoder": "circuit", "servo": 350,
  "hobby_gearmotor": "circuit", "buzzer": 30,
  "seven_segment_clock": 10, "char_lcd": 2, "lcd_i2c": 2,
  "battery_9v": 0, "battery_aa": 0, "battery_coin": 0,
  "solar_cell": 0, "potato_battery": 0, "lemon_battery": 0,
  "lm7805": 5, "ld1117v33": 5, "breadboard_psu": 10,
  "npn": "circuit", "pnp": "circuit",
  "nmos": "circuit", "pmos": "circuit",
  "nmos_power": "circuit", "pmos_power": "circuit",
  "tip120": "circuit",
  "relay": "circuit", "relay_dpdt": "circuit",
  "motor_driver_l293d": "circuit",
  "optocoupler": 0,
  "74hc00": 1, "74hc02": 1, "74hc04": 1, "74hc08": 1,
  "74hc10": 1, "74hc11": 1, "74hc14": 1, "74hc20": 1,
  "74hc21": 1, "74hc27": 1, "74hc32": 1, "74hc73": 1,
  "74hc74": 1, "74hc75": 1, "74hc86": 1, "74hc93": 1,
  "74hc95": 1, "74hc132": 1, "74hc283": 1, "74hc595": 1,
  "cd4017": 1, "cd4511": 1, "pcf8574": 0.1,
  "555": 15, "556": 30, "opamp": 3, "lm393": 2.5, "lm339": 2.5,
  "arduino_uno": 50, "attiny85": 12, "stc_mcu": 20, "mcu": 20,
  "multimeter": 0, "oscilloscope": 0, "function_gen": 0,
  "power_supply": 0,
  "vcc": 0, "gnd": 0, "vsource": 0, "isource": 0,
  "breadboard_full": 0, "breadboard_half": 0, "breadboard_mini": 0,
  "header": 0, "usb_a": 0,
  "temp_sensor": null, "eeprom": null,
  "led_matrix": null, "led_cube": null, "microbit": null,
};

// ─── Name aliases: bw-board kind → bw-parts kind ────────────────────────
// bw-parts owns names. Where bw-board uses a different slug, map here.
const NAME_ALIASES = {
  'timer_555': '555',
  'timer_556': '556',
  'gearmotor': 'hobby_gearmotor',
  'h_bridge': 'motor_driver_l293d',
  'shift_register': '74hc595',
  'dip_switch': 'dip_switch_spst',
  'tilt_sensor': 'tilt_switch',
  'clock_display': 'seven_segment_clock',
  'char_lcd_i2c': 'lcd_i2c',
  'ambient_light': 'light_sensor',
  'phototransistor': 'light_sensor',
  'decade_counter': 'cd4017',
  'battery': 'battery_9v',      // generic battery → defaults to 9V
  'vreg': 'lm7805',             // generic vreg → defaults to 7805
  'fuse': null,                  // not in bw-parts (rated 0 here)
  'solenoid': null,              // not in bw-parts
  'stepper': null,               // not in bw-parts
  'piezo': null,                 // not in bw-parts
  'bargraph': null,              // not in bw-parts
  'ir_transmitter': null,        // not in bw-parts
  'darlington_driver': null,     // not in bw-parts
  'soil_moisture': 'soil_moisture',
};

// ─── Build the consumed ratings table ───────────────────────────────────

/** @type {Record<string, number | null>} */
export const CURRENT_RATINGS = {};

// First: import everything from bw-parts, converting mA → A
for (const [kind, rating] of Object.entries(BW_PARTS_RATINGS)) {
  if (rating === 'circuit') {
    CURRENT_RATINGS[kind] = null; // circuit-dependent
  } else if (rating === null) {
    CURRENT_RATINGS[kind] = null; // not yet rated
  } else {
    CURRENT_RATINGS[kind] = rating / 1000; // mA → A
  }
}

// Then: add bw-board-only kinds not in bw-parts (with local ratings)
const LOCAL_ONLY = {
  fuse: 0,
  solenoid: 0.300,
  stepper: 0.500,
  piezo: 0.001,
  bargraph: 0.020,
  ir_transmitter: 0.020,
  darlington_driver: null,
  // Abstract gate primitives (internal, not user-facing)
  gate_and: 0.00008, gate_or: 0.00008, gate_not: 0.00008,
  gate_nand: 0.00008, gate_nor: 0.00008, gate_xor: 0.00008,
  // Digital IC abstractions
  dff: 0.00008, jkff: 0.00008,
  // Named regulator aliases already covered via bw-parts
};

for (const [kind, rating] of Object.entries(LOCAL_ONLY)) {
  if (!(kind in CURRENT_RATINGS)) {
    CURRENT_RATINGS[kind] = rating;
  }
}

/**
 * Get the maximum current rating for a part kind.
 * Checks bw-parts canonical name first, then bw-board aliases.
 *
 * @param {string} kind
 * @returns {number | null}
 */
export function getMaxCurrent(kind) {
  if (kind in CURRENT_RATINGS) return CURRENT_RATINGS[kind];
  // Check alias
  const alias = NAME_ALIASES[kind];
  if (alias && alias in CURRENT_RATINGS) return CURRENT_RATINGS[alias];
  return null; // unknown kind
}

/**
 * STC12 port and chip current limits.
 *
 * Per-pin: §4.1 mode tables (all ports P0-P5): "Sink Current up to 20mA,
 *   pull-up Current is 230µA, actual pull-up current is 250uA ~ 150uA"
 * Push-pull source: §4.1 push-pull row: "current can be up to 20mA"
 * Per-chip: §4.1 intro: "the whole chip had better drive lower than 120mA"
 *   (guidance — "had better", not absolute max)
 * Per-port: NOT in the STC12 datasheet. 80 mA is 8051-family convention.
 *
 * A DRC warning is the right response to exceeding these; a refusal is not.
 */
export const PORT_LIMITS = {
  perPin: { sink: 0.020, source: 0.000230 },
  perPort: { sink: 0.080 },
  perChip: { sink: 0.120 },
};

/**
 * Compute aggregate current for a list of part kinds.
 *
 * @param {Array<{id: string, kind: string}>} parts
 * @returns {{ totalAmps: number, unrated: Array<{id: string, kind: string}>, complete: boolean }}
 */
export function aggregateCurrent(parts) {
  let totalAmps = 0;
  const unrated = [];
  for (const p of parts) {
    const rating = getMaxCurrent(p.kind);
    if (rating === null) {
      unrated.push({ id: p.id, kind: p.kind });
    } else {
      totalAmps += rating;
    }
  }
  return { totalAmps, unrated, complete: unrated.length === 0 };
}

/**
 * Check a circuit's parts against chip current limits.
 *
 * @param {Array<{id: string, kind: string}>} parts
 * @param {Map<string, number>} [solvedCurrents] - partId → actual amps from MNA
 * @returns {Array<{severity: 'warning'|'danger', type: string, message: string, partIds?: string[], unratedIds?: string[]}>}
 */
export function checkCurrentBudget(parts, solvedCurrents) {
  const warnings = [];
  const chipLimit = PORT_LIMITS.perChip.sink;

  if (solvedCurrents && solvedCurrents.size > 0) {
    let totalAmps = 0;
    const contributors = [];
    for (const [id, amps] of solvedCurrents) {
      totalAmps += Math.abs(amps);
      if (Math.abs(amps) > 0.001) contributors.push(id);
    }
    if (totalAmps > chipLimit) {
      warnings.push({
        severity: 'danger',
        type: 'aggregate-current',
        message: `Total current draw ${(totalAmps * 1000).toFixed(1)} mA exceeds chip limit of ${(chipLimit * 1000).toFixed(0)} mA.`,
        partIds: contributors,
      });
    }
    return warnings;
  }

  const { totalAmps, unrated, complete } = aggregateCurrent(parts);
  const contributors = parts
    .filter(p => { const r = getMaxCurrent(p.kind); return r !== null && r > 0; })
    .map(p => p.id);
  const unratedIds = unrated.map(u => u.id);

  if (totalAmps > chipLimit) {
    const totalMa = (totalAmps * 1000).toFixed(1);
    const limitMa = (chipLimit * 1000).toFixed(0);
    if (complete) {
      warnings.push({
        severity: 'warning', type: 'aggregate-current',
        message: `Up to ${totalMa} mA at maximum ratings — may exceed chip limit of ${limitMa} mA. Actual current depends on resistor values.`,
        partIds: contributors,
      });
    } else {
      warnings.push({
        severity: 'warning', type: 'aggregate-current',
        message: `Up to ${totalMa} mA at maximum ratings (${unratedIds.join(', ')} depend on your wiring) — may exceed chip limit of ${limitMa} mA.`,
        partIds: contributors, unratedIds,
      });
    }
  } else if (!complete && totalAmps > chipLimit * 0.5) {
    // Only warn about incomplete totals when the rated subtotal is
    // significant (>50% of limit). With LEDs as circuit-dependent,
    // almost every circuit has unrated parts — warning on all of them
    // is noise that gets the warning switched off in the user's head.
    warnings.push({
      severity: 'warning', type: 'aggregate-current',
      message: `Current budget: up to ${(totalAmps * 1000).toFixed(1)} mA counted; ${unratedIds.join(', ')} depend on your wiring and are not included.`,
      unratedIds,
    });
  }

  return warnings;
}
