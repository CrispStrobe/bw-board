/**
 * Maximum current ratings per part kind.
 *
 * Used by static port-current checks: sum the max current of everything
 * on a port and warn before exceeding aggregate limits.
 *
 * Sources cited where available. Unrated kinds return null (not 0) —
 * a part that silently contributes 0 mA to a sum produces a confident
 * wrong total; null produces a question.
 *
 * Values are in AMPS.
 *
 * @module
 */

/**
 * Maximum current draw per part kind in typical use.
 * null = not rated (cannot be summed — must be flagged).
 *
 * @type {Record<string, number | null>}
 */
export const CURRENT_RATINGS = {
  // ─── LEDs and indicators ──────────────────────────────────────────
  led: 0.020,           // 20 mA typical (datasheet: absolute max 25-30 mA)
  rgb_led: 0.060,       // 20 mA × 3 channels
  seven_segment: 0.020, // per segment, but typically one lit = 20 mA
  neopixel: 0.060,      // 60 mA per pixel at full white (20 mA × 3)
  bargraph: 0.020,      // per segment
  ir_transmitter: 0.020,// IR LED, same as visible LED
  ir_remote: 0.020,     // IR LED
  light_bulb: 0.100,    // typical miniature bulb

  // ─── Sensors (typical supply current) ─────────────────────────────
  ldr: 0.001,           // sensing current through divider, not supply
  ntc: 0.001,           // sensing current
  phototransistor: 0.005, // max collector current ~5 mA
  photodiode: 0.001,    // photocurrent ~1 mA max
  tmp36: 0.00005,       // 50 µA quiescent (TMP36 datasheet)
  ultrasonic: 0.015,    // HC-SR04: 15 mA operating
  pir: 0.000065,        // ~65 µA quiescent (typical PIR)
  tilt_sensor: 0,       // passive switch, no current
  flex_sensor: 0.001,   // sensing current through divider
  force_sensor: 0.001,  // sensing current
  gas_sensor: 0.150,    // MQ series heater: ~150 mA (significant!)
  ambient_light: 0.001, // ~1 mA
  soil_moisture: 0.020, // ~20 mA (electrolysis current)
  temp_sensor: 0.001,   // DS18B20 style: ~1 mA

  // ─── Motors and actuators ─────────────────────────────────────────
  dc_motor: 0.500,      // typical small DC motor stall current
  dc_motor_encoder: 0.500,
  gearmotor: 0.500,
  servo: 0.500,         // typical servo stall current
  stepper: 0.500,       // per coil, typical
  vibration_motor: 0.100, // ~100 mA
  solenoid: 0.300,      // typical small solenoid
  buzzer: 0.030,        // ~30 mA (piezo buzzer with driver)
  piezo: 0.001,         // passive piezo, negligible current

  // ─── Relays ───────────────────────────────────────────────────────
  relay: 0.080,         // typical 5V relay coil: ~25 mA; with driver: ~80 mA
  relay_dpdt: 0.080,

  // ─── ICs ──────────────────────────────────────────────────────────
  shift_register: 0.080, // 74HC595: 70 mA max (outputs active)
  char_lcd: 0.002,      // HD44780: ~2 mA (no backlight)
  char_lcd_i2c: 0.020,  // with backlight: ~20 mA
  pcf8574: 0.0001,      // 100 µA quiescent
  timer_555: 0.006,     // ~6 mA (NE555 quiescent)
  timer_556: 0.012,     // 2 × 555
  opamp: 0.002,         // typical: 1-4 mA
  lm393: 0.001,         // 1 mA
  lm339: 0.002,         // 2 mA (4 comparators)
  ir_receiver: 0.001,   // ~1 mA

  // ─── Logic ICs (per chip, not per gate) ───────────────────────────
  '74hc00': 0.00008,    // 80 µA quiescent (CMOS)
  '74hc02': 0.00008,
  '74hc04': 0.00008,
  '74hc08': 0.00008,
  '74hc10': 0.00008,
  '74hc11': 0.00008,
  '74hc14': 0.00008,
  '74hc20': 0.00008,
  '74hc21': 0.00008,
  '74hc27': 0.00008,
  '74hc32': 0.00008,
  '74hc73': 0.00008,
  '74hc74': 0.00008,
  '74hc75': 0.00008,
  '74hc86': 0.00008,
  '74hc93': 0.00008,
  '74hc95': 0.00008,
  '74hc132': 0.00008,
  cd4511: 0.00008,
  decade_counter: 0.00008,
  dff: 0.00008,
  jkff: 0.00008,
  '74hc283': 0.00008,

  // ─── Power (these SUPPLY current, not consume it) ─────────────────
  // Rated as 0 because they don't load a port — they source.
  vcc: 0,
  gnd: 0,
  battery: 0,
  battery_9v: 0,
  battery_aa: 0,
  battery_coin: 0,
  vsource: 0,
  isource: 0,
  solar_cell: 0,

  // ─── Passives ─────────────────────────────────────────────────────
  // Passives limit or store current; they don't independently draw from a port.
  // Rated as 0: they are current-limiters, not current-consumers. The LED or
  // motor on the other end of the resistor is the thing with the rating.
  resistor: 0,
  capacitor: 0,
  polarized_cap: 0,
  inductor: 0,
  diode: 0,
  zener: 0,

  // ─── Transistors (current depends on circuit) ─────────────────────
  npn: null,
  pnp: null,
  nmos: null,
  pmos: null,
  tip120: null,
  darlington_driver: null,

  // ─── Switches (passive, no current rating) ────────────────────────
  button: 0,
  switch: 0,
  potentiometer: 0,     // passive — draws from VCC/GND, not from an MCU port
  dip_switch: 0,
  keypad_4x4: 0,

  // ─── Connectors (passive) ─────────────────────────────────────────
  header: 0,
  usb_a: 0,            // provides power, doesn't consume from MCU

  // ─── Drivers ──────────────────────────────────────────────────────
  h_bridge: 0.006,     // L293D quiescent: ~6 mA (output current from VCC2, not logic)
  optocoupler: 0.010,  // LED side: ~10 mA

  // ─── Display composites ───────────────────────────────────────────
  led_matrix: 0.160,   // 8×8 matrix: up to 8 LEDs at 20 mA = 160 mA (multiplexed)
  led_cube: 0.160,     // same as matrix (one scan line at a time)
  clock_display: 0.080, // 4-digit 7-seg: ~80 mA max

  // ─── Other ────────────────────────────────────────────────────────
  eeprom: 0.005,       // ~5 mA during write
  mcu: 0,             // the MCU itself doesn't load its own ports
  fuse: 0,            // passes current, doesn't consume
  vreg: 0.005,        // quiescent current ~5 mA (7805)
  lm7805: 0.005,
  ld1117v33: 0.005,

  // ─── Abstract gate primitives (not user-facing) ───────────────────
  gate_and: 0.00008,
  gate_or: 0.00008,
  gate_not: 0.00008,
  gate_nand: 0.00008,
  gate_nor: 0.00008,
  gate_xor: 0.00008,
};

/**
 * Get the maximum current rating for a part kind.
 * Returns the rating in amps, or null if the kind cannot be rated
 * (current depends on the specific circuit, not the kind alone).
 *
 * @param {string} kind
 * @returns {number | null}
 */
export function getMaxCurrent(kind) {
  if (kind in CURRENT_RATINGS) return CURRENT_RATINGS[kind];
  return null; // unknown kind — cannot be summed
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
  perPin: { sink: 0.020, source: 0.000230 },  // 20 mA sink, 230 µA source (§4.1 mode tables)
  perPort: { sink: 0.080 },                     // 80 mA per port (8051 family guidance, not in STC12 datasheet)
  perChip: { sink: 0.120 },                     // 120 mA total chip (§4.1 intro: "had better drive lower than")
};

/**
 * Compute aggregate current for a list of part kinds.
 *
 * Returns the sum of rated parts, a list of unrated part kinds, and whether
 * the total is complete. When the total is incomplete, the consumer should
 * warn: "at least X mA (parts Y, Z not counted) exceeds limit" — never
 * silently sum what it can.
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
 * Returns DRC warnings for aggregate current budget violations.
 *
 * When `solvedCurrents` is provided (a Map of partId → amps from MNA),
 * uses actual solved currents instead of kind maximums. This gives a
 * realistic answer ("24 mA through your 1kΩ resistors") instead of a
 * worst-case bound ("up to 160 mA at maximum ratings").
 *
 * @param {Array<{id: string, kind: string}>} parts
 * @param {Map<string, number>} [solvedCurrents] - partId → actual amps from MNA
 * @returns {Array<{severity: 'warning' | 'danger', message: string}>}
 */
export function checkCurrentBudget(parts, solvedCurrents) {
  const warnings = [];
  const chipLimit = PORT_LIMITS.perChip.sink;

  if (solvedCurrents && solvedCurrents.size > 0) {
    // Use actual solved currents — realistic, not worst-case
    let totalAmps = 0;
    for (const [, amps] of solvedCurrents) {
      totalAmps += Math.abs(amps);
    }

    if (totalAmps > chipLimit) {
      const totalMa = (totalAmps * 1000).toFixed(1);
      const limitMa = (chipLimit * 1000).toFixed(0);
      warnings.push({
        severity: 'danger',
        message: `Total current draw ${totalMa} mA exceeds chip limit of ${limitMa} mA.`,
      });
    }
    return warnings;
  }

  // Fallback: kind-level maximums (upper bound, stated as such)
  const { totalAmps, unrated, complete } = aggregateCurrent(parts);

  if (totalAmps > chipLimit) {
    const totalMa = (totalAmps * 1000).toFixed(1);
    const limitMa = (chipLimit * 1000).toFixed(0);
    if (complete) {
      warnings.push({
        severity: 'warning',
        message: `Up to ${totalMa} mA at maximum ratings — may exceed chip limit of ${limitMa} mA. Actual current depends on resistor values.`,
      });
    } else {
      const names = unrated.map(u => u.id).join(', ');
      warnings.push({
        severity: 'warning',
        message: `Up to ${totalMa} mA at maximum ratings (${names} not counted) — may exceed chip limit of ${limitMa} mA.`,
      });
    }
  } else if (!complete) {
    const totalMa = (totalAmps * 1000).toFixed(1);
    const names = unrated.map(u => u.id).join(', ');
    warnings.push({
      severity: 'warning',
      message: `Current budget incomplete: up to ${totalMa} mA counted, but ${names} could not be rated.`,
    });
  }

  return warnings;
}
