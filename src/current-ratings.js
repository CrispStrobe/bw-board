/**
 * Current ratings — two budgets: chip I/O pins and supply rail.
 *
 * OWNERSHIP: bw-parts owns the rating DATA (bw-parts/current-ratings.json).
 * bw-board owns the SEMANTICS and the DRC checks.
 *
 * Schema (from bw-parts cf3eb7d):
 *   { chip_mA: number|'circuit'|null, supply_mA: number|'circuit'|null }
 *   number    — rated mA
 *   0         — not a consumer of this budget
 *   'circuit' — depends on wiring → mapped to null here
 *   null      — not yet rated → mapped to null here
 *
 * Two budgets:
 *   chip_mA   — current through MCU I/O pins (120 mA chip total, §4.1)
 *   supply_mA — current from the power rail (USB 500 mA limit)
 *
 * @module
 */

// ─── Vendored data from bw-parts/current-ratings.json (cf3eb7d) ─────────

/** @type {Record<string, {chip_mA: number|string|null, supply_mA: number|string|null}>} */
const BW_PARTS_RATINGS = {
  "resistor":        { chip_mA: 0, supply_mA: 0 },
  "capacitor":       { chip_mA: 0, supply_mA: 0 },
  "polarized_cap":   { chip_mA: 0, supply_mA: 0 },
  "diode":           { chip_mA: 0, supply_mA: 0 },
  "zener":           { chip_mA: 0, supply_mA: 0 },
  "inductor":        { chip_mA: 0, supply_mA: 0 },
  "button":          { chip_mA: 0, supply_mA: 0 },
  "potentiometer":   { chip_mA: 0, supply_mA: 0 },
  "slide_switch":    { chip_mA: 0, supply_mA: 0 },
  "dip_switch_spst": { chip_mA: 0, supply_mA: 0 },
  "dip_switch_dpst": { chip_mA: 0, supply_mA: 0 },
  "ldr":             { chip_mA: 0, supply_mA: 0 },
  "photodiode":      { chip_mA: 0, supply_mA: 0 },
  "flex_sensor":     { chip_mA: 0, supply_mA: 0 },
  "force_sensor":    { chip_mA: 0, supply_mA: 0 },
  "tilt_switch":     { chip_mA: 0, supply_mA: 0 },
  "tilt_switch_v2":  { chip_mA: 0, supply_mA: 0 },
  "ntc":             { chip_mA: 0, supply_mA: 0 },
  "keypad_4x4":      { chip_mA: 0, supply_mA: 0 },
  "ir_remote":       { chip_mA: 0, supply_mA: 0 },
  "switch":          { chip_mA: 0, supply_mA: 0 },
  "light_sensor":    { chip_mA: 0.1,  supply_mA: 0.1 },
  "ir_receiver":     { chip_mA: 5,    supply_mA: 5 },
  "ultrasonic":      { chip_mA: 0,    supply_mA: 15 },
  "ultrasonic_3pin": { chip_mA: 0,    supply_mA: 15 },
  "pir":             { chip_mA: 0,    supply_mA: 0.15 },
  "soil_moisture":   { chip_mA: 0.05, supply_mA: 0.05 },
  "tmp36":           { chip_mA: 0,    supply_mA: 0.05 },
  "gas_sensor":      { chip_mA: 0,    supply_mA: 150 },
  "led":             { chip_mA: "circuit", supply_mA: "circuit" },
  "rgb_led":         { chip_mA: "circuit", supply_mA: "circuit" },
  "light_bulb":      { chip_mA: "circuit", supply_mA: "circuit" },
  "seven_segment":   { chip_mA: "circuit", supply_mA: "circuit" },
  "neopixel":        { chip_mA: 0, supply_mA: "circuit" },
  "neopixel_jewel":  { chip_mA: 0, supply_mA: "circuit" },
  "neopixel_ring":   { chip_mA: 0, supply_mA: "circuit" },
  "neopixel_strip":  { chip_mA: 0, supply_mA: "circuit" },
  "servo":           { chip_mA: 0, supply_mA: 350 },
  "vibration_motor": { chip_mA: 0, supply_mA: 80 },
  "dc_motor":        { chip_mA: 0, supply_mA: "circuit" },
  "dc_motor_encoder":{ chip_mA: 0, supply_mA: "circuit" },
  "hobby_gearmotor": { chip_mA: 0, supply_mA: "circuit" },
  "buzzer":          { chip_mA: "circuit", supply_mA: 30 },
  "seven_segment_clock": { chip_mA: 0, supply_mA: 10 },
  "char_lcd":        { chip_mA: 0, supply_mA: 2 },
  "lcd_i2c":         { chip_mA: 0, supply_mA: 2 },
  "battery_9v":      { chip_mA: 0, supply_mA: 0 },
  "battery_aa":      { chip_mA: 0, supply_mA: 0 },
  "battery_coin":    { chip_mA: 0, supply_mA: 0 },
  "solar_cell":      { chip_mA: 0, supply_mA: 0 },
  "potato_battery":  { chip_mA: 0, supply_mA: 0 },
  "lemon_battery":   { chip_mA: 0, supply_mA: 0 },
  "lm7805":          { chip_mA: 0, supply_mA: 5 },
  "ld1117v33":       { chip_mA: 0, supply_mA: 5 },
  "breadboard_psu":  { chip_mA: 0, supply_mA: 10 },
  "npn":             { chip_mA: "circuit", supply_mA: "circuit" },
  "pnp":             { chip_mA: "circuit", supply_mA: "circuit" },
  "nmos":            { chip_mA: "circuit", supply_mA: "circuit" },
  "pmos":            { chip_mA: "circuit", supply_mA: "circuit" },
  "nmos_power":      { chip_mA: "circuit", supply_mA: "circuit" },
  "pmos_power":      { chip_mA: "circuit", supply_mA: "circuit" },
  "tip120":          { chip_mA: "circuit", supply_mA: "circuit" },
  "relay":           { chip_mA: 0, supply_mA: "circuit" },
  "relay_dpdt":      { chip_mA: 0, supply_mA: "circuit" },
  "motor_driver_l293d": { chip_mA: 0, supply_mA: "circuit" },
  "optocoupler":     { chip_mA: 0, supply_mA: 0 },
  "74hc00": { chip_mA: 0, supply_mA: 1 }, "74hc02": { chip_mA: 0, supply_mA: 1 },
  "74hc04": { chip_mA: 0, supply_mA: 1 }, "74hc08": { chip_mA: 0, supply_mA: 1 },
  "74hc10": { chip_mA: 0, supply_mA: 1 }, "74hc11": { chip_mA: 0, supply_mA: 1 },
  "74hc14": { chip_mA: 0, supply_mA: 1 }, "74hc20": { chip_mA: 0, supply_mA: 1 },
  "74hc21": { chip_mA: 0, supply_mA: 1 }, "74hc27": { chip_mA: 0, supply_mA: 1 },
  "74hc32": { chip_mA: 0, supply_mA: 1 }, "74hc73": { chip_mA: 0, supply_mA: 1 },
  "74hc74": { chip_mA: 0, supply_mA: 1 }, "74hc75": { chip_mA: 0, supply_mA: 1 },
  "74hc86": { chip_mA: 0, supply_mA: 1 }, "74hc93": { chip_mA: 0, supply_mA: 1 },
  "74hc95": { chip_mA: 0, supply_mA: 1 }, "74hc132": { chip_mA: 0, supply_mA: 1 },
  "74hc283": { chip_mA: 0, supply_mA: 1 }, "74hc595": { chip_mA: 0, supply_mA: 1 },
  "cd4017": { chip_mA: 0, supply_mA: 1 }, "cd4511": { chip_mA: 0, supply_mA: 1 },
  "pcf8574": { chip_mA: 0, supply_mA: 0.1 },
  "555": { chip_mA: 0, supply_mA: 15 }, "556": { chip_mA: 0, supply_mA: 30 },
  "opamp": { chip_mA: 0, supply_mA: 3 }, "lm393": { chip_mA: 0, supply_mA: 2.5 },
  "lm339": { chip_mA: 0, supply_mA: 2.5 },
  "arduino_uno": { chip_mA: 0, supply_mA: 50 }, "attiny85": { chip_mA: 0, supply_mA: 12 },
  "stc_mcu": { chip_mA: 0, supply_mA: 20 }, "mcu": { chip_mA: 0, supply_mA: 20 },
  "multimeter": { chip_mA: 0, supply_mA: 0 }, "oscilloscope": { chip_mA: 0, supply_mA: 0 },
  "function_gen": { chip_mA: 0, supply_mA: 0 }, "power_supply": { chip_mA: 0, supply_mA: 0 },
  "vcc": { chip_mA: 0, supply_mA: 0 }, "gnd": { chip_mA: 0, supply_mA: 0 },
  "vsource": { chip_mA: 0, supply_mA: 0 }, "isource": { chip_mA: 0, supply_mA: 0 },
  "breadboard_full": { chip_mA: 0, supply_mA: 0 }, "breadboard_half": { chip_mA: 0, supply_mA: 0 },
  "breadboard_mini": { chip_mA: 0, supply_mA: 0 },
  "header": { chip_mA: 0, supply_mA: 0 }, "usb_a": { chip_mA: 0, supply_mA: 0 },
  "temp_sensor": { chip_mA: null, supply_mA: null },
  "eeprom": { chip_mA: null, supply_mA: null },
  "led_matrix": { chip_mA: null, supply_mA: null },
  "led_cube": { chip_mA: null, supply_mA: null },
  "microbit": { chip_mA: null, supply_mA: null },
};

// ─── Name aliases ───────────────────────────────────────────────────────
const NAME_ALIASES = {
  'timer_555': '555', 'timer_556': '556', 'gearmotor': 'hobby_gearmotor',
  'h_bridge': 'motor_driver_l293d', 'shift_register': '74hc595',
  'dip_switch': 'dip_switch_spst', 'tilt_sensor': 'tilt_switch',
  'clock_display': 'seven_segment_clock', 'char_lcd_i2c': 'lcd_i2c',
  'ambient_light': 'light_sensor', 'phototransistor': 'light_sensor',
  'decade_counter': 'cd4017', 'battery': 'battery_9v', 'vreg': 'lm7805',
};

// ─── Local-only kinds ───────────────────────────────────────────────────
const LOCAL_ONLY = {
  fuse:              { chip_mA: 0, supply_mA: 0 },
  solenoid:          { chip_mA: 0, supply_mA: 300 },
  stepper:           { chip_mA: 0, supply_mA: 500 },
  piezo:             { chip_mA: 0, supply_mA: 1 },
  bargraph:          { chip_mA: "circuit", supply_mA: "circuit" },
  ir_transmitter:    { chip_mA: "circuit", supply_mA: 20 },
  darlington_driver: { chip_mA: "circuit", supply_mA: "circuit" },
  gate_and: { chip_mA: 0, supply_mA: 0.08 }, gate_or: { chip_mA: 0, supply_mA: 0.08 },
  gate_not: { chip_mA: 0, supply_mA: 0.08 }, gate_nand: { chip_mA: 0, supply_mA: 0.08 },
  gate_nor: { chip_mA: 0, supply_mA: 0.08 }, gate_xor: { chip_mA: 0, supply_mA: 0.08 },
  dff: { chip_mA: 0, supply_mA: 0.08 }, jkff: { chip_mA: 0, supply_mA: 0.08 },
};

// ─── Build the consumed ratings ─────────────────────────────────────────

function parseRating(mA) {
  if (mA === 'circuit' || mA === null || mA === undefined) return null;
  if (typeof mA !== 'number') return null; // guard against any other string
  return mA / 1000;
}

/** @type {Record<string, {chipAmps: number|null, supplyAmps: number|null}>} */
export const CURRENT_RATINGS = {};

for (const [kind, r] of Object.entries(BW_PARTS_RATINGS)) {
  CURRENT_RATINGS[kind] = { chipAmps: parseRating(r.chip_mA), supplyAmps: parseRating(r.supply_mA) };
}
for (const [kind, r] of Object.entries(LOCAL_ONLY)) {
  if (!(kind in CURRENT_RATINGS)) {
    CURRENT_RATINGS[kind] = { chipAmps: parseRating(r.chip_mA), supplyAmps: parseRating(r.supply_mA) };
  }
}

function resolve(kind) {
  return CURRENT_RATINGS[kind] ?? (NAME_ALIASES[kind] ? CURRENT_RATINGS[NAME_ALIASES[kind]] : undefined);
}

/** @param {string} kind @returns {number | null} */
export function getMaxCurrent(kind) { const r = resolve(kind); return r ? r.chipAmps : null; }

/** @param {string} kind @returns {number | null} */
export function getSupplyCurrent(kind) { const r = resolve(kind); return r ? r.supplyAmps : null; }

export const PORT_LIMITS = {
  perPin: { sink: 0.020, source: 0.000230 },
  perPort: { sink: 0.080 },
  perChip: { sink: 0.120 },
  supplyUsb: { sink: 0.500 },
};

/** @param {Array<{id: string, kind: string}>} parts */
export function aggregateCurrent(parts) {
  let totalAmps = 0, supplyAmps = 0;
  const unrated = [], supplyUnrated = [];
  for (const p of parts) {
    const chip = getMaxCurrent(p.kind);
    const supply = getSupplyCurrent(p.kind);
    if (chip === null) unrated.push({ id: p.id, kind: p.kind }); else totalAmps += chip;
    if (supply === null) supplyUnrated.push({ id: p.id, kind: p.kind }); else supplyAmps += supply;
  }
  return { totalAmps, unrated, complete: unrated.length === 0,
           supplyAmps, supplyUnrated, supplyComplete: supplyUnrated.length === 0 };
}

/** @param {Array<{id: string, kind: string}>} parts @param {Map<string, number>} [solvedCurrents] */
export function checkCurrentBudget(parts, solvedCurrents) {
  const warnings = [];
  const chipLimit = PORT_LIMITS.perChip.sink;
  const supplyLimit = PORT_LIMITS.supplyUsb.sink;

  if (solvedCurrents && solvedCurrents.size > 0) {
    let totalAmps = 0;
    const contributors = [];
    for (const [id, amps] of solvedCurrents) {
      totalAmps += Math.abs(amps);
      if (Math.abs(amps) > 0.001) contributors.push(id);
    }
    if (totalAmps > chipLimit) {
      warnings.push({ severity: 'danger', type: 'aggregate-current',
        message: `Total I/O current ${(totalAmps*1000).toFixed(1)} mA exceeds chip limit of ${(chipLimit*1000).toFixed(0)} mA.`,
        partIds: contributors });
    }
    return warnings;
  }

  const agg = aggregateCurrent(parts);

  // Chip budget
  if (agg.totalAmps > chipLimit) {
    const ids = agg.unrated.map(u => u.id);
    warnings.push({ severity: 'warning', type: 'aggregate-current',
      message: agg.complete
        ? `Up to ${(agg.totalAmps*1000).toFixed(1)} mA at maximum ratings — may exceed chip limit of ${(chipLimit*1000).toFixed(0)} mA.`
        : `Up to ${(agg.totalAmps*1000).toFixed(1)} mA at maximum ratings (${ids.join(', ')} depend on your wiring) — may exceed chip limit of ${(chipLimit*1000).toFixed(0)} mA.`,
      partIds: parts.filter(p => { const r = getMaxCurrent(p.kind); return r !== null && r > 0; }).map(p => p.id),
      unratedIds: ids.length ? ids : undefined });
  } else if (!agg.complete && agg.totalAmps > chipLimit * 0.5) {
    const ids = agg.unrated.map(u => u.id);
    warnings.push({ severity: 'warning', type: 'aggregate-current',
      message: `Current budget: up to ${(agg.totalAmps*1000).toFixed(1)} mA counted; ${ids.join(', ')} depend on your wiring.`,
      unratedIds: ids });
  }

  // Supply budget
  if (agg.supplyAmps > supplyLimit) {
    const ids = agg.supplyUnrated.map(u => u.id);
    warnings.push({ severity: 'danger', type: 'supply-current',
      message: agg.supplyComplete
        ? `Total supply current ${(agg.supplyAmps*1000).toFixed(1)} mA exceeds USB limit of ${(supplyLimit*1000).toFixed(0)} mA.`
        : `At least ${(agg.supplyAmps*1000).toFixed(1)} mA supply current (${ids.join(', ')} depend on your wiring) exceeds USB limit of ${(supplyLimit*1000).toFixed(0)} mA.`,
      partIds: parts.filter(p => { const r = getSupplyCurrent(p.kind); return r !== null && r > 0; }).map(p => p.id),
      unratedIds: ids.length ? ids : undefined });
  }

  return warnings;
}
