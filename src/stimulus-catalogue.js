/**
 * Stimulus parameter catalogue — which device kinds expose which
 * world-facing parameters, with labels, ranges, and units.
 *
 * This drives the environment-stimulus extension's dropdown menus and
 * range validation.  It is also the single source of truth for the
 * controller panel's binding palette.
 *
 * Two kinds of controllable parameter:
 *
 *   1. **Control value** — a single 0..1 scalar stored in board.controls,
 *      used by basic parts: potentiometer (wiper position), switch/button
 *      (open/closed), LDR (light), thermistor (temperature).
 *      Set via board.setControl(partId, value).
 *
 *   2. **Part params** — named properties on part.params, used by device
 *      models: dht11.temperature, hall.field, gas.gas, ultrasonic.distance.
 *      Set via board.setPartParam(partId, param, value).
 *
 * The catalogue unifies both under one shape so the extension doesn't
 * need to know which mechanism a given parameter uses.
 *
 * @module
 */

/**
 * @typedef {object} StimulusParam
 * @property {string} param    - Key name (e.g. 'temperature', 'field')
 * @property {string} label    - Human-readable label (e.g. 'Temperature')
 * @property {number} min      - Minimum valid value
 * @property {number} max      - Maximum valid value
 * @property {number} step     - Suggested step size
 * @property {string} unit     - Unit string (e.g. '°C', '%', 'cm')
 * @property {'control' | 'param'} mechanism - How to apply the value
 */

/** @type {Record<string, StimulusParam[]>} */
export const STIMULUS_CATALOGUE = {

  // ── Basic parts (control-value mechanism) ────────────────────────────

  potentiometer: [
    { param: 'position', label: 'Position', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'control' },
  ],
  switch: [
    { param: 'closed', label: 'Closed', min: 0, max: 1, step: 1, unit: '', mechanism: 'control' },
  ],
  button: [
    { param: 'pressed', label: 'Pressed', min: 0, max: 1, step: 1, unit: '', mechanism: 'control' },
  ],
  ldr: [
    { param: 'light', label: 'Light', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'control' },
  ],
  thermistor: [
    { param: 'temperature', label: 'Temperature', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'control' },
  ],

  // ── Kit sensors (param mechanism) ────────────────────────────────────

  dht11: [
    { param: 'temperature', label: 'Temperature', min: 0, max: 50, step: 1, unit: '°C', mechanism: 'param' },
    { param: 'humidity', label: 'Humidity', min: 0, max: 95, step: 1, unit: '%', mechanism: 'param' },
  ],
  joystick: [
    { param: 'x', label: 'X axis', min: -1, max: 1, step: 0.01, unit: '', mechanism: 'param' },
    { param: 'y', label: 'Y axis', min: -1, max: 1, step: 0.01, unit: '', mechanism: 'param' },
    { param: 'pressed', label: 'Button', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],

  // ── 37-in-1 kit modules (param mechanism) ────────────────────────────

  hall_analog: [
    { param: 'field', label: 'Magnetic field', min: -1, max: 1, step: 0.01, unit: '', mechanism: 'param' },
    { param: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],
  hall_digital: [
    { param: 'field', label: 'Magnetic field', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
    { param: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],
  reed_switch: [
    { param: 'magnet', label: 'Magnet present', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],
  touch_ttp223: [
    { param: 'touched', label: 'Touched', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],
  photo_interrupter: [
    { param: 'blocked', label: 'Beam blocked', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],
  flame_sensor: [
    { param: 'flame', label: 'Flame intensity', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
    { param: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],
  ir_reflect: [
    { param: 'detect', label: 'Detected', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],
  sound_module: [
    { param: 'level', label: 'Sound level', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
    { param: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],
  heartbeat: [
    { param: 'bpm', label: 'Heart rate', min: 20, max: 240, step: 1, unit: 'bpm', mechanism: 'param' },
  ],
  led_7color: [
    { param: 'cycleHz', label: 'Cycle rate', min: 0.1, max: 10, step: 0.1, unit: 'Hz', mechanism: 'param' },
  ],

  // ── General sensors (param mechanism) ────────────────────────────────

  ultrasonic: [
    { param: 'distance', label: 'Distance', min: 0, max: 400, step: 1, unit: 'cm', mechanism: 'param' },
  ],
  pir: [
    { param: 'motion', label: 'Motion detected', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],
  tilt_sensor: [
    { param: 'tilted', label: 'Tilted', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],
  flex_sensor: [
    { param: 'bend', label: 'Bend', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],
  force_sensor: [
    { param: 'force', label: 'Force', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],
  phototransistor: [
    { param: 'light', label: 'Light', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],

  // ── Named parts (param mechanism) ────────────────────────────────────

  gas_sensor: [
    { param: 'gas', label: 'Gas concentration', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],
  ambient_light: [
    { param: 'light', label: 'Light level', min: 0, max: 1, step: 0.01, unit: '', mechanism: 'param' },
  ],

  // ── I2C / SPI devices with stimulus params ───────────────────────────

  ds18b20: [
    { param: 'temperature', label: 'Temperature', min: -55, max: 125, step: 0.0625, unit: '°C', mechanism: 'param' },
  ],
  ds3231: [
    { param: 'temperature', label: 'Temperature', min: -40, max: 85, step: 0.25, unit: '°C', mechanism: 'param' },
  ],
  mpu6050: [
    { param: 'temperature', label: 'Temperature', min: -40, max: 85, step: 0.1, unit: '°C', mechanism: 'param' },
    { param: 'accelX', label: 'Accel X', min: -2, max: 2, step: 0.01, unit: 'g', mechanism: 'param' },
    { param: 'accelY', label: 'Accel Y', min: -2, max: 2, step: 0.01, unit: 'g', mechanism: 'param' },
    { param: 'accelZ', label: 'Accel Z', min: -2, max: 2, step: 0.01, unit: 'g', mechanism: 'param' },
    { param: 'gyroX', label: 'Gyro X', min: -250, max: 250, step: 1, unit: '°/s', mechanism: 'param' },
    { param: 'gyroY', label: 'Gyro Y', min: -250, max: 250, step: 1, unit: '°/s', mechanism: 'param' },
    { param: 'gyroZ', label: 'Gyro Z', min: -250, max: 250, step: 1, unit: '°/s', mechanism: 'param' },
  ],
  xpt2046: [
    { param: 'touchX', label: 'Touch X', min: 0, max: 4095, step: 1, unit: '', mechanism: 'param' },
    { param: 'touchY', label: 'Touch Y', min: 0, max: 4095, step: 1, unit: '', mechanism: 'param' },
    { param: 'pressure', label: 'Pressure', min: 0, max: 4095, step: 1, unit: '', mechanism: 'param' },
  ],

  bmp280: [
    { param: 'temperature', label: 'Temperature', min: -40, max: 85, step: 0.1, unit: '°C', mechanism: 'param' },
    { param: 'pressure', label: 'Pressure', min: 30000, max: 110000, step: 100, unit: 'Pa', mechanism: 'param' },
  ],
  tcs34725: [
    { param: 'red', label: 'Red', min: 0, max: 65535, step: 1, unit: '', mechanism: 'param' },
    { param: 'green', label: 'Green', min: 0, max: 65535, step: 1, unit: '', mechanism: 'param' },
    { param: 'blue', label: 'Blue', min: 0, max: 65535, step: 1, unit: '', mechanism: 'param' },
    { param: 'clear', label: 'Clear', min: 0, max: 65535, step: 1, unit: '', mechanism: 'param' },
  ],
  bh1750: [
    { param: 'lux', label: 'Illuminance', min: 0, max: 65535, step: 1, unit: 'lx', mechanism: 'param' },
  ],
  ina219: [
    { param: 'busVoltage', label: 'Bus voltage', min: 0, max: 26, step: 0.01, unit: 'V', mechanism: 'param' },
    { param: 'current_mA', label: 'Current', min: -3200, max: 3200, step: 1, unit: 'mA', mechanism: 'param' },
    { param: 'shuntOhms', label: 'Shunt resistance', min: 0.001, max: 1, step: 0.001, unit: 'Ω', mechanism: 'param' },
  ],

  // ── Rotary encoder ───────────────────────────────────────────────────

  ky040: [
    { param: 'position', label: 'Position', min: -Infinity, max: Infinity, step: 1, unit: 'detents', mechanism: 'param' },
    { param: 'pressed', label: 'Button', min: 0, max: 1, step: 1, unit: '', mechanism: 'param' },
  ],
};

/**
 * Get stimulus params for a device kind.
 * @param {string} kind
 * @returns {StimulusParam[] | null}
 */
export function getStimulusParams(kind) {
  return STIMULUS_CATALOGUE[kind] ?? null;
}

/**
 * Get all device kinds that have stimulus params.
 * @returns {string[]}
 */
export function getStimulusKinds() {
  return Object.keys(STIMULUS_CATALOGUE);
}

/**
 * Given a board instance, return the parts that have stimulus params,
 * grouped as { partId, kind, params: StimulusParam[] }.
 * @param {import('./board.js').BoardImpl} board
 * @returns {{ partId: string, kind: string, params: StimulusParam[] }[]}
 */
export function getStimulusParts(board) {
  const result = [];
  for (const part of board.getParts()) {
    const params = STIMULUS_CATALOGUE[part.kind];
    if (params) {
      result.push({ partId: part.id, kind: part.kind, params });
    }
  }
  return result;
}
