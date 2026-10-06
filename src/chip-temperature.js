/**
 * The chips' own temperature sensors, read at the bench temperature.
 *
 * A chip sits on the bench, so its internal sensor sees `board.temperatureC`
 * (default 25 °C, set with board.setTemperature) like every other part. Each
 * function below turns a temperature into what that chip's converter would
 * read, from the datasheet's TYPICAL figures: an uncalibrated part, which is
 * also what generated C assumes when it converts back. A real chip is off by
 * a few degrees until calibrated; the emulator is not, so a program that
 * reads 25 at 25 °C here reads "about 25" on silicon.
 *
 * Which chips have one:
 *   ATmega328P / 168P / 88PA  ADC MUX 1000, against the internal 1.1 V
 *       ("Temperature vs. Sensor Output Voltage (Typical Case)":
 *        242 mV at -45 °C, 314 mV at +25 °C, 380 mV at +85 °C)
 *   ATtiny85  ADC MUX 1111 (ADC4), against the internal 1.1 V
 *       ("Temperature vs. Sensor Output Voltage (Typical Case)":
 *        230 LSB at -40 °C, 300 LSB at +25 °C, 370 LSB at +85 °C)
 *   ATtiny88  ADC MUX 1000 (ADC8), against the internal 1.1 V (REFS0 = 0 on
 *       this part): the same table, ATtiny48/88 datasheet 8008H Table 17-2
 *   RP2040    ADC input 4: Vbe = 0.706 V at 27 °C, -1.721 mV/°C
 *       (datasheet §4.9.5: T = 27 - (ADC_voltage - 0.706) / 0.001721)
 *   STM32F030 ADC channel 16 with ADC_CCR.TSEN: V30 = 1.43 V typical,
 *       Avg_Slope 4.3 mV/°C, voltage FALLING as the chip warms
 * The ATmega2560 and the STC 8051 parts have no sensor.
 */

/** Piecewise-linear interpolation through [x, y] points, clamped at the ends. */
function interpolate (points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (x <= x1) {
      const [x0, y0] = points[i - 1];
      return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
    }
  }
  return points[points.length - 1][1];
}

const ATMEGA_MV = [[-45, 242], [25, 314], [85, 380]];
const ATTINY_LSB = [[-40, 230], [25, 300], [85, 370]];   // ATtiny85 and ATtiny48/88 alike

/**
 * ADC counts (10-bit) the AVR's temperature channel reads at `celsius`, or
 * null when the chip has no modelled sensor. The datasheets require the
 * internal 1.1 V reference for this channel, so the counts are against 1.1 V.
 * @param {string} sensor - 'atmega' | 'attiny85' | 'attiny88'
 * @param {number} celsius
 * @returns {number|null}
 */
export function avrTemperatureCounts (sensor, celsius) {
  let counts;
  if (sensor === 'atmega') counts = interpolate(ATMEGA_MV, celsius) / 1100 * 1024;
  else if (sensor === 'attiny85' || sensor === 'attiny88') counts = interpolate(ATTINY_LSB, celsius);
  else return null;
  return Math.max(0, Math.min(1023, Math.round(counts)));
}

/** RP2040 temperature-sensor voltage (ADC input 4) at `celsius`. */
export function rp2040TemperatureVolts (celsius) {
  return 0.706 - 0.001721 * (celsius - 27);
}

/** STM32F030 temperature-sensor voltage (ADC channel 16) at `celsius`. */
export function stm32f0TemperatureVolts (celsius) {
  return 1.43 - 0.0043 * (celsius - 30);
}

/** The bench temperature a board reports, 25 °C without a board. */
export function benchCelsius (board) {
  const t = board && Number(board.temperatureC);
  return Number.isFinite(t) ? t : 25;
}
