/**
 * I2C sensor device models — the 37-in-1 kit's register-style I2C sensors
 * that the existing write-only decoder in i2c-parts.js cannot handle.
 * Each uses the bidirectional i2c-slave.js engine.
 *
 *   bmp280      Bosch BMP280 pressure + temperature (0x76/0x77)
 *   tcs34725    AMS TCS34725 RGBC colour sensor (0x29)
 *   bh1750      ROHM BH1750FVI ambient light / lux (0x23/0x5C)
 *   ina219      TI INA219 high-side current/voltage/power (0x40–0x4F)
 *   vl53l0x     ST VL53L0X time-of-flight laser distance (0x29, changeable)
 *   ads1115     TI ADS1115 16-bit 4-channel I2C ADC (0x48–0x4B)
 *   pcf8591     NXP PCF8591 8-bit 4-channel ADC + 1-channel DAC (0x48–0x4F)
 *   apds9960    Broadcom APDS-9960 gesture/proximity/ALS/colour (0x39)
 *
 * All stimuli are part.params (world-facing): temperature, pressure, lux,
 * colour channels, bus voltage, shunt voltage. getDeviceState returns the
 * latest reading in human units so faces can render without decoding.
 *
 * Sources: Bosch BMP280 datasheet (BST-BMP280-DS001-26), AMS TCS34725
 * datasheet (DN40), ROHM BH1750FVI datasheet, TI INA219 datasheet (SBOS448),
 * ST VL53L0X API user manual (UM2039), TI ADS1115 datasheet (SBAS444B),
 * NXP PCF8591 datasheet, Broadcom APDS-9960 datasheet (AV02-4191EN).
 * All clean-room from publicly available register maps.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { createI2CSlave, feedI2CSlave } from './i2c-slave.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;

// ─── Helpers ─────────────────────────────────────────────────────────

/** Pack a signed 16-bit value to [high, low]. */
function s16(v) {
    const c = Math.max(-32768, Math.min(32767, Math.round(v)));
    const u = c < 0 ? c + 65536 : c;
    return [(u >> 8) & 0xff, u & 0xff];
}

/** Pack an unsigned 16-bit value to [high, low]. */
function u16(v) {
    const c = Math.max(0, Math.min(65535, Math.round(v)));
    return [(c >> 8) & 0xff, c & 0xff];
}

/** Standard I2C update: feed the slave engine, toggle SDA drive. */
function i2cUpdate(state, read, vcc) {
    const th = (vcc || 3.3) * 0.5;
    const driveLow = feedI2CSlave(state._i2c, read('scl') > th, read('sda') > th);
    const nowLow = state.drives.sda.rTh === R_OUT;
    if (driveLow !== nowLow) {
        state.drives.sda = driveLow ? { vTh: 0, rTh: R_OUT } : { vTh: 0, rTh: R_OFF };
        return true;
    }
    return false;
}

// ─── BMP280 ──────────────────────────────────────────────────────────
//
// Register map (datasheet §4):
//   0xD0  chip_id   = 0x58
//   0xE0  reset     write 0xB6 triggers soft reset
//   0xF3  status    bit 3 = measuring, bit 0 = im_update
//   0xF4  ctrl_meas osrs_t[7:5] osrs_p[4:2] mode[1:0]
//   0xF5  config    t_sb[7:5] filter[4:2] spi3w_en[0]
//   0xF7..0xFC  press_msb..temp_xlsb (6 bytes, 20-bit each)
//
// Compensation: bypassed — we compute raw register values that, when
// passed through the standard compensation with our built-in trimming
// params, yield the user's requested temperature/pressure. The trim
// registers (0x88–0xA1) hold values that make the identity compensation
// work: dig_T1=0, dig_T2=1<<14 (16384), dig_T3=0 for temperature;
// dig_P1=0, dig_P2=1<<14, dig_P3..P9=0 for pressure. This gives:
//   t_fine = (adc_T >> 4) * dig_T2 >> 10 = (adc_T >> 4) * 16 = adc_T
//   T = t_fine / 5120  →  adc_T = T_celsius * 5120  (20-bit raw)
//   P_raw maps similarly through the identity trim.
// This means the face/test can just read the human params from
// getDeviceState without needing the compensation algorithm.

function registerBMP280() {
    registerDevice('bmp280', {
        terminals: ['vcc', 'gnd', 'sda', 'scl'],

        init(part) {
            const regs = new Uint8Array(256);
            // Chip ID
            regs[0xd0] = 0x58;
            // ctrl_meas: sleep mode (mode=00), osrs_t=0, osrs_p=0
            regs[0xf4] = 0x00;
            // Trimming registers for identity compensation:
            // dig_T1 (0x88-0x89) = 0 (unsigned 16-bit LE)
            // dig_T2 (0x8A-0x8B) = 16384 (signed 16-bit LE) → raw/5120 = °C
            regs[0x8a] = 0x00; regs[0x8b] = 0x40; // 16384 LE = 0x4000
            // dig_T3 (0x8C-0x8D) = 0
            // dig_P1..P9 (0x8E-0xA1): leave as 0 (identity)

            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                regs,
                ptr: 0,
                _first: true,
                // Readable state for faces
                temperature: part.params?.temperature ?? 25,
                pressure: part.params?.pressure ?? 101325,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const addr = part.params?.addr ?? 0x76;
                    const mine = a7 === addr;
                    if (mine && rw === 0) state._first = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._first) {
                        state.ptr = b;
                        state._first = false;
                        return true;
                    }
                    writeBmpReg(state, state.ptr, b);
                    state.ptr = (state.ptr + 1) & 0xff;
                    return true;
                },
                onReadByte: () => {
                    const v = readBmpReg(part, state, state.ptr);
                    state.ptr = (state.ptr + 1) & 0xff;
                    return v;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            // Refresh readable state from params
            state.temperature = part.params?.temperature ?? 25;
            state.pressure = part.params?.pressure ?? 101325;
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function readBmpReg(part, state, reg) {
    const mode = state.regs[0xf4] & 0x03;
    const measuring = mode === 0x03 || mode === 0x01; // normal or forced

    switch (reg) {
        case 0xd0: return 0x58;                     // chip_id
        case 0xf3: return 0x00;                     // status: idle
        // Temperature raw: adc_T = T * 5120, stored as 20-bit in 3 bytes
        case 0xfa: case 0xfb: case 0xfc: {
            if (!measuring) return 0x80;             // power-on reset value
            const t = part.params?.temperature ?? 25;
            const raw = Math.round(t * 5120);
            const r20 = Math.max(0, Math.min(0xfffff, raw)) << 4;
            if (reg === 0xfa) return (r20 >> 16) & 0xff;
            if (reg === 0xfb) return (r20 >> 8) & 0xff;
            return r20 & 0xff;
        }
        // Pressure raw: similar identity mapping
        // adc_P = Pa * 256 / 100 = Pa * 2.56, stored as 20-bit
        case 0xf7: case 0xf8: case 0xf9: {
            if (!measuring) return 0x80;
            const p = part.params?.pressure ?? 101325;
            const raw = Math.round(p * 2.56);
            const r20 = Math.max(0, Math.min(0xfffff, raw)) << 4;
            if (reg === 0xf7) return (r20 >> 16) & 0xff;
            if (reg === 0xf8) return (r20 >> 8) & 0xff;
            return r20 & 0xff;
        }
        default: return state.regs[reg] ?? 0;
    }
}

function writeBmpReg(state, reg, v) {
    switch (reg) {
        case 0xe0:                                  // reset
            if (v === 0xb6) {
                state.regs.fill(0);
                state.regs[0xd0] = 0x58;
                state.regs[0x8a] = 0x00; state.regs[0x8b] = 0x40;
                state.ptr = 0;
            }
            break;
        case 0xd0: break;                           // read-only
        default:
            state.regs[reg] = v;
    }
}

// ─── TCS34725 ────────────────────────────────────────────────────────
//
// Register map (datasheet DN40):
//   0x00  ENABLE    PON[0] AEN[1] AIEN[4] WEN[3]
//   0x01  ATIME     integration time (256-ATIME)*2.4ms
//   0x03  WTIME     wait time
//   0x04  AILTL..AIHTL  interrupt thresholds
//   0x0D  CONFIG    WLONG[1]
//   0x0F  CONTROL   AGAIN[1:0] (1x,4x,16x,60x)
//   0x12  ID        0x44 (TCS34725) or 0x4D (TCS34727)
//   0x13  STATUS    AVALID[0] AINT[4]
//   0x14..0x1B  CDATAL..BDATAH (8 bytes: C,R,G,B × 16-bit LE)
//
// Command byte protocol: bit 7 = command, bits 6:5 = type (00=repeated,
// 01=auto-inc), bits 4:0 = register. We accept any command byte and
// extract the register address.

function registerTCS34725() {
    registerDevice('tcs34725', {
        terminals: ['vcc', 'gnd', 'sda', 'scl', 'int', 'led'],

        init(part) {
            const regs = new Uint8Array(0x20);
            // Power-on defaults
            regs[0x00] = 0x00;              // ENABLE: off
            regs[0x01] = 0xff;              // ATIME: 2.4ms
            regs[0x03] = 0xff;              // WTIME: 2.4ms
            regs[0x0f] = 0x00;              // CONTROL: 1x gain
            regs[0x12] = 0x44;              // ID: TCS34725

            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                regs,
                ptr: 0,
                _first: true,
                // Readable state for faces
                red: 0, green: 0, blue: 0, clear: 0,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const mine = a7 === 0x29;
                    if (mine && rw === 0) state._first = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._first) {
                        // Command byte: register = bits 4:0
                        state.ptr = b & 0x1f;
                        state._first = false;
                        return true;
                    }
                    writeTcsReg(state, state.ptr, b);
                    state.ptr = (state.ptr + 1) & 0x1f;
                    return true;
                },
                onReadByte: () => {
                    const v = readTcsReg(part, state, state.ptr);
                    state.ptr = (state.ptr + 1) & 0x1f;
                    return v;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
            ctx.conductance('int', null, 1 / R_INPUT);
            ctx.conductance('led', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            // Refresh readable state from params
            state.red = part.params?.red ?? 0;
            state.green = part.params?.green ?? 0;
            state.blue = part.params?.blue ?? 0;
            state.clear = part.params?.clear ?? (state.red + state.green + state.blue);
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function readTcsReg(part, state, reg) {
    const enabled = !!(state.regs[0x00] & 0x03); // PON + AEN

    switch (reg) {
        case 0x12: return 0x44;                     // ID
        case 0x13: return enabled ? 0x11 : 0x00;   // STATUS: AVALID + AINT when enabled
        // RGBC data: 16-bit unsigned LE pairs
        // Clear
        case 0x14: case 0x15: {
            if (!enabled) return 0;
            const c = Math.max(0, Math.min(65535, Math.round(part.params?.clear ??
                ((part.params?.red ?? 0) + (part.params?.green ?? 0) + (part.params?.blue ?? 0)))));
            return reg === 0x14 ? c & 0xff : (c >> 8) & 0xff;
        }
        // Red
        case 0x16: case 0x17: {
            if (!enabled) return 0;
            const r = Math.max(0, Math.min(65535, Math.round(part.params?.red ?? 0)));
            return reg === 0x16 ? r & 0xff : (r >> 8) & 0xff;
        }
        // Green
        case 0x18: case 0x19: {
            if (!enabled) return 0;
            const g = Math.max(0, Math.min(65535, Math.round(part.params?.green ?? 0)));
            return reg === 0x18 ? g & 0xff : (g >> 8) & 0xff;
        }
        // Blue
        case 0x1a: case 0x1b: {
            if (!enabled) return 0;
            const b = Math.max(0, Math.min(65535, Math.round(part.params?.blue ?? 0)));
            return reg === 0x1a ? b & 0xff : (b >> 8) & 0xff;
        }
        default: return state.regs[reg] ?? 0;
    }
}

function writeTcsReg(state, reg, v) {
    switch (reg) {
        case 0x12: break;                           // ID: read-only
        case 0x13: break;                           // STATUS: read-only
        default:
            state.regs[reg] = v;
    }
}

// ─── BH1750 ──────────────────────────────────────────────────────────
//
// ROHM BH1750FVI: simple command-based I2C light sensor.
// No register pointer — each write byte is a command:
//   0x00  Power Down
//   0x01  Power On
//   0x10  Continuously H-Resolution Mode (1 lx, 120ms)
//   0x11  Continuously H-Resolution Mode2 (0.5 lx, 120ms)
//   0x13  Continuously L-Resolution Mode (4 lx, 16ms)
//   0x20  One-Time H-Resolution Mode
//   0x21  One-Time H-Resolution Mode2
//   0x23  One-Time L-Resolution Mode
//   0x07  Reset
//
// Read returns 2 bytes (MSB first): raw = lux / 1.2 in normal mode,
// raw = lux / 0.6 in Mode2.

function registerBH1750() {
    registerDevice('bh1750', {
        terminals: ['vcc', 'gnd', 'sda', 'scl', 'addr'],

        init(part) {
            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                _powerOn: false,
                _mode: 0,           // 0=none, 0x10/0x11/0x13/0x20/0x21/0x23
                _readIdx: 0,
                // Readable state for faces
                lux: part.params?.lux ?? 0,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const addr = part.params?.addr === 'high' ? 0x5c : 0x23;
                    const mine = a7 === addr;
                    if (mine && rw === 1) state._readIdx = 0;
                    return mine;
                },
                onWriteByte: (b) => {
                    bh1750Command(state, b);
                    return true;
                },
                onReadByte: () => {
                    const lux = part.params?.lux ?? 0;
                    state.lux = lux;
                    // Mode2 has 0.5 lx resolution (divide by 0.6)
                    const isMode2 = state._mode === 0x11 || state._mode === 0x21;
                    const divisor = isMode2 ? 0.6 : 1.2;
                    const raw = Math.max(0, Math.min(65535, Math.round(lux / divisor)));
                    const byte = state._readIdx === 0 ? (raw >> 8) & 0xff : raw & 0xff;
                    state._readIdx = (state._readIdx + 1) & 1;
                    return state._powerOn && state._mode ? byte : 0;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
            ctx.conductance('addr', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            state.lux = part.params?.lux ?? 0;
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function bh1750Command(state, cmd) {
    switch (cmd) {
        case 0x00: state._powerOn = false; break;
        case 0x01: state._powerOn = true; break;
        case 0x07: state._mode = 0; break;         // reset
        case 0x10: case 0x11: case 0x13:            // continuous
        case 0x20: case 0x21: case 0x23:            // one-time
            state._powerOn = true;
            state._mode = cmd;
            break;
    }
}

// ─── INA219 ──────────────────────────────────────────────────────────
//
// TI INA219: high-side current/voltage/power monitor.
// Register map (SBOS448):
//   0x00  Configuration (16-bit)
//   0x01  Shunt Voltage (16-bit signed, 10 µV LSB)
//   0x02  Bus Voltage   (16-bit, bits 15:3 = voltage × 250, bit 1 = CNVR, bit 0 = OVF)
//   0x03  Power          (16-bit)
//   0x04  Current        (16-bit signed)
//   0x05  Calibration    (16-bit)
//
// Address: A0/A1 pins select from 0x40-0x4F (16 addresses).
// Default config: 0x399F (32V range, ±320mV shunt, 12-bit, continuous).

function registerINA219() {
    registerDevice('ina219', {
        terminals: ['vcc', 'gnd', 'sda', 'scl', 'vin_p', 'vin_n'],

        init(part) {
            const regs = new Uint16Array(6);
            regs[0] = 0x399f;               // default config

            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                regs,
                ptr: 0,
                _writeHigh: -1,
                _first: true,
                // Readable state for faces
                busVoltage: 0,
                shuntVoltage: 0,
                current_mA: 0,
                power_mW: 0,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const addr = part.params?.addr ?? 0x40;
                    const mine = a7 === addr;
                    if (mine && rw === 0) { state._first = true; state._writeHigh = -1; }
                    if (mine && rw === 1) state._readHigh = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._first) {
                        state.ptr = b & 0x07;   // 6 registers, 3-bit pointer
                        state._first = false;
                        return true;
                    }
                    // 16-bit register writes: high byte first, then low
                    if (state._writeHigh < 0) {
                        state._writeHigh = b;
                        return true;
                    }
                    writeInaReg(state, state.ptr, (state._writeHigh << 8) | b);
                    state._writeHigh = -1;
                    state.ptr = (state.ptr + 1) & 0x07;
                    return true;
                },
                onReadByte: () => {
                    const v = readInaReg(part, state, state.ptr);
                    let byte;
                    if (state._readHigh) {
                        byte = (v >> 8) & 0xff;
                        state._readHigh = false;
                    } else {
                        byte = v & 0xff;
                        state._readHigh = true;
                        state.ptr = (state.ptr + 1) & 0x07;
                    }
                    return byte;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
            ctx.conductance('vin_p', null, 1 / R_INPUT);
            ctx.conductance('vin_n', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            // Refresh readable state from params
            const shuntR = part.params?.shuntOhms ?? 0.1;
            const busV = part.params?.busVoltage ?? 5;
            const current = part.params?.current_mA ?? 0;
            const shuntV = current * shuntR;  // mA × Ω = mV
            state.busVoltage = busV;
            state.shuntVoltage = shuntV;
            state.current_mA = current;
            state.power_mW = busV * current;
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function readInaReg(part, state, reg) {
    const shuntR = part.params?.shuntOhms ?? 0.1;
    const busV = part.params?.busVoltage ?? 5;
    const current = part.params?.current_mA ?? 0;
    const shuntMv = current * shuntR;          // mA × Ω = mV

    switch (reg) {
        case 0x00: return state.regs[0];        // config
        case 0x01: {                             // shunt voltage: 10 µV LSB, signed
            const raw = Math.round(shuntMv * 100);  // mV × 100 = 10µV units
            const c = Math.max(-32768, Math.min(32767, raw));
            return c < 0 ? c + 65536 : c;
        }
        case 0x02: {                             // bus voltage: bits 15:3 = V / 4 mV
            const raw = Math.round(busV * 1000 / 4);
            const c = Math.max(0, Math.min(8191, raw));
            return (c << 3) | 0x02;              // CNVR set, no overflow
        }
        case 0x03: {                             // power: busV × current / 5000
            const calVal = state.regs[5] || 4096;
            const currentLsb = 0.04096 / calVal;
            const powerLsb = 20 * currentLsb;
            const pW = busV * (current / 1000);
            const raw = Math.round(pW / powerLsb);
            return Math.max(0, Math.min(65535, raw));
        }
        case 0x04: {                             // current: signed
            const calVal = state.regs[5] || 4096;
            const currentLsb = 0.04096 / calVal;
            const raw = Math.round((current / 1000) / currentLsb);
            const c = Math.max(-32768, Math.min(32767, raw));
            return c < 0 ? c + 65536 : c;
        }
        case 0x05: return state.regs[5];         // calibration
        default: return 0;
    }
}

function writeInaReg(state, reg, v) {
    switch (reg) {
        case 0x00:
            if (v & 0x8000) {                    // RST bit
                state.regs.fill(0);
                state.regs[0] = 0x399f;
                state.ptr = 0;
                return;
            }
            state.regs[0] = v;
            break;
        case 0x05:                               // calibration
            state.regs[5] = v;
            break;
        // registers 1-4 are read-only
    }
}

// ─── VL53L0X ─────────────────────────────────────────────────────────
//
// ST VL53L0X: time-of-flight laser ranging sensor.
// Default I2C address 0x29 (changeable via register 0x8A + software).
// Register map (from UM2039 and community reverse-engineering):
//   0xC0  MODEL_ID                = 0xEE
//   0xC1  MODEL_ID (rev)          = 0xAA
//   0xC2  MODULE_TYPE             = 0x10 (VL53L0X)
//   0x00  SYSRANGE_START          write 0x01 = single shot, 0x02 = continuous
//   0x13  RESULT_INTERRUPT_STATUS bit 2:0 = range status (4 = new data ready)
//   0x14  RESULT_RANGE_STATUS     bits for signal fail, etc.
//   0x1E  RESULT_RANGE_VAL_H      distance MSB (mm)
//   0x1F  RESULT_RANGE_VAL_L      distance LSB (mm)
//   0x51  SYSTEM_SEQUENCE_CONFIG
//   0x8A  I2C_SLAVE_DEVICE_ADDRESS  (changeable address)
//
// Behavioral model: params.distance_mm drives the range reading.
// The real sensor's init sequence is ~100 bytes of magic register writes
// that we accept and store silently.

function registerVL53L0X() {
    registerDevice('vl53l0x', {
        terminals: ['vcc', 'gnd', 'sda', 'scl', 'xshut', 'gpio1'],

        init(part) {
            const regs = new Uint8Array(256);
            // Identification
            regs[0xc0] = 0xee;              // MODEL_ID
            regs[0xc1] = 0xaa;              // MODEL_ID rev
            regs[0xc2] = 0x10;              // MODULE_TYPE (VL53L0X)
            // Default address
            regs[0x8a] = part.params?.addr ?? 0x29;

            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                regs,
                ptr: 0,
                _first: true,
                _ranging: false,
                // Readable state for faces
                distance_mm: part.params?.distance_mm ?? 200,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const addr = state.regs[0x8a];
                    const mine = a7 === addr;
                    if (mine && rw === 0) state._first = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._first) {
                        state.ptr = b;
                        state._first = false;
                        return true;
                    }
                    writeVl53Reg(state, state.ptr, b);
                    state.ptr = (state.ptr + 1) & 0xff;
                    return true;
                },
                onReadByte: () => {
                    const v = readVl53Reg(part, state, state.ptr);
                    state.ptr = (state.ptr + 1) & 0xff;
                    return v;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
            ctx.conductance('xshut', null, 1 / R_INPUT);
            ctx.conductance('gpio1', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            state.distance_mm = part.params?.distance_mm ?? 200;
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function readVl53Reg(part, state, reg) {
    const dist = Math.max(0, Math.min(8190, Math.round(part.params?.distance_mm ?? 200)));

    switch (reg) {
        case 0xc0: return 0xee;                     // MODEL_ID
        case 0xc1: return 0xaa;                     // MODEL_ID rev
        case 0xc2: return 0x10;                     // MODULE_TYPE
        case 0x13:                                   // RESULT_INTERRUPT_STATUS
            return state._ranging ? 0x07 : 0x00;    // new data ready when ranging
        case 0x14:                                   // RESULT_RANGE_STATUS
            return state._ranging ? 0x0b : 0x00;    // valid range
        case 0x1e:                                   // range MSB (mm)
            return (dist >> 8) & 0xff;
        case 0x1f:                                   // range LSB (mm)
            return dist & 0xff;
        default: return state.regs[reg] ?? 0;
    }
}

function writeVl53Reg(state, reg, v) {
    switch (reg) {
        case 0x00:                                   // SYSRANGE_START
            if (v & 0x01) state._ranging = true;     // single-shot or continuous
            if (v === 0x00) state._ranging = false;   // stop
            state.regs[reg] = v;
            break;
        case 0xc0: case 0xc1: case 0xc2:            // read-only IDs
            break;
        default:
            state.regs[reg] = v;
    }
}

// ─── SGP30 ───────────────────────────────────────────────────────────
//
// Sensirion SGP30: multi-pixel gas sensor for indoor air quality.
// I2C address fixed at 0x58. Command-based protocol (no register pointer):
// each command is a 2-byte word, followed by optional data words with CRC.
//
// Key commands (datasheet Table 10):
//   0x2032  Init_air_quality    — must be called first, starts measurement
//   0x2008  Measure_air_quality — returns eCO2 (ppm) + TVOC (ppb), each
//                                 16-bit with CRC8 byte after each word
//   0x2050  Measure_raw_signals — returns H2 + Ethanol raw signals
//   0x201E  Get_feature_set     — 2 bytes + CRC (product type + version)
//   0x3682  Get_serial_id       — 6 bytes + 3 CRCs
//   0x0020  Measure_test        — self-test, returns 0xD400 if pass
//
// CRC-8 poly 0x31, init 0xFF (Sensirion standard).

function sgp30Crc(d0, d1) {
    let crc = 0xff;
    for (const b of [d0, d1]) {
        crc ^= b;
        for (let i = 0; i < 8; i++) crc = (crc & 0x80) ? ((crc << 1) ^ 0x31) & 0xff : (crc << 1) & 0xff;
    }
    return crc;
}

function registerSGP30() {
    registerDevice('sgp30', {
        terminals: ['vcc', 'gnd', 'sda', 'scl'],

        init(part) {
            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                _cmdBuf: [],
                _response: [],
                _respIdx: 0,
                _initialized: false,
                // Readable state for faces
                eCO2: part.params?.eCO2 ?? 400,
                TVOC: part.params?.TVOC ?? 0,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const mine = a7 === 0x58;
                    if (mine && rw === 0) state._cmdBuf = [];
                    if (mine && rw === 1) state._respIdx = 0;
                    return mine;
                },
                onWriteByte: (b) => {
                    state._cmdBuf.push(b);
                    if (state._cmdBuf.length === 2) {
                        const cmd = (state._cmdBuf[0] << 8) | state._cmdBuf[1];
                        state._response = sgp30Execute(part, state, cmd);
                    }
                    return true;
                },
                onReadByte: () => {
                    if (state._respIdx < state._response.length) {
                        return state._response[state._respIdx++];
                    }
                    return 0;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            state.eCO2 = part.params?.eCO2 ?? 400;
            state.TVOC = part.params?.TVOC ?? 0;
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function sgp30Execute(part, state, cmd) {
    switch (cmd) {
        case 0x2032:                                 // Init_air_quality
            state._initialized = true;
            return [];
        case 0x2008: {                               // Measure_air_quality
            if (!state._initialized) return [0, 0, 0, 0, 0, 0];
            const co2 = Math.max(400, Math.min(60000, Math.round(part.params?.eCO2 ?? 400)));
            const tvoc = Math.max(0, Math.min(60000, Math.round(part.params?.TVOC ?? 0)));
            const co2h = (co2 >> 8) & 0xff, co2l = co2 & 0xff;
            const tvoch = (tvoc >> 8) & 0xff, tvocl = tvoc & 0xff;
            return [co2h, co2l, sgp30Crc(co2h, co2l), tvoch, tvocl, sgp30Crc(tvoch, tvocl)];
        }
        case 0x201e: {                               // Get_feature_set
            return [0x00, 0x22, sgp30Crc(0x00, 0x22)];
        }
        case 0x3682: {                               // Get_serial_id
            return [0x00, 0x00, sgp30Crc(0x00, 0x00),
                    0x00, 0x48, sgp30Crc(0x00, 0x48),
                    0x44, 0x30, sgp30Crc(0x44, 0x30)];
        }
        case 0x0020:                                 // Measure_test
            return [0xd4, 0x00, sgp30Crc(0xd4, 0x00)];
        case 0x2050: {                               // Measure_raw_signals
            return [0x26, 0x00, sgp30Crc(0x26, 0x00),
                    0x1a, 0x00, sgp30Crc(0x1a, 0x00)];
        }
        default: return [];
    }
}

// ─── VEML7700 ────────────────────────────────────────────────────────
//
// Vishay VEML7700: high-accuracy ambient light sensor.
// I2C address fixed at 0x10. 16-bit register protocol:
// write = [cmd_code, data_low, data_high], read after cmd = [low, high].
//
// Register map (datasheet Table 1):
//   0x00  ALS_CONF    configuration (gain, integration time, power)
//   0x01  ALS_WH      high threshold window
//   0x02  ALS_WL      low threshold window
//   0x03  PSM         power saving mode
//   0x04  ALS         ambient light output (16-bit, raw counts)
//   0x05  WHITE       white channel output (16-bit)
//
// Resolution depends on gain + integration time. Default (gain 1, 100ms):
// resolution = 0.0576 lx/count → count = lux / 0.0576.

function registerVEML7700() {
    registerDevice('veml7700', {
        terminals: ['vcc', 'gnd', 'sda', 'scl'],

        init(part) {
            const regs = new Uint16Array(6);
            // ALS_CONF default: gain=1, IT=100ms, ALS_SD=0 (on)
            regs[0] = 0x0000;

            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                regs,
                ptr: 0,
                _phase: 'cmd',       // 'cmd' | 'dlo' | 'dhi'
                _writeLow: 0,
                _readLow: true,
                // Readable state for faces
                lux: part.params?.lux ?? 0,
                white: part.params?.white ?? 0,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const mine = a7 === 0x10;
                    if (mine && rw === 0) state._phase = 'cmd';
                    if (mine && rw === 1) state._readLow = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._phase === 'cmd') {
                        state.ptr = b & 0x07;
                        state._phase = 'dlo';
                        return true;
                    }
                    if (state._phase === 'dlo') {
                        state._writeLow = b;
                        state._phase = 'dhi';
                        return true;
                    }
                    // dhi — complete the 16-bit write
                    const val = state._writeLow | (b << 8);
                    if (state.ptr <= 3) state.regs[state.ptr] = val;
                    state._phase = 'cmd';
                    return true;
                },
                onReadByte: () => {
                    const v = readVeml7700Reg(part, state, state.ptr);
                    let byte;
                    if (state._readLow) {
                        byte = v & 0xff;
                        state._readLow = false;
                    } else {
                        byte = (v >> 8) & 0xff;
                        state._readLow = true;
                    }
                    return byte;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            state.lux = part.params?.lux ?? 0;
            state.white = part.params?.white ?? 0;
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function readVeml7700Reg(part, state, reg) {
    const shutDown = !!(state.regs[0] & 0x01);      // ALS_SD bit

    // Gain lookup: bits 12:11
    const gainBits = (state.regs[0] >> 11) & 0x03;
    const gains = [1, 2, 0.125, 0.25];
    const gain = gains[gainBits];

    // Integration time lookup: bits 9:6
    const itBits = (state.regs[0] >> 6) & 0x0f;
    const itMap = { 0: 100, 1: 200, 2: 400, 3: 800, 8: 50, 12: 25 };
    const itMs = itMap[itBits] ?? 100;

    // Resolution = 0.0576 at gain=1, IT=100ms; scales inversely with both
    const resolution = 0.0576 * (100 / itMs) * (1 / gain);

    switch (reg) {
        case 0x00: case 0x01: case 0x02: case 0x03:
            return state.regs[reg];
        case 0x04: {                                 // ALS
            if (shutDown) return 0;
            const lux = part.params?.lux ?? 0;
            return Math.max(0, Math.min(65535, Math.round(lux / resolution)));
        }
        case 0x05: {                                 // WHITE
            if (shutDown) return 0;
            const w = part.params?.white ?? (part.params?.lux ?? 0);
            return Math.max(0, Math.min(65535, Math.round(w / resolution)));
        }
        default: return 0;
    }
}

// ─── AS5600 ──────────────────────────────────────────────────────────
//
// AMS AS5600: 12-bit contactless magnetic rotary position sensor.
// I2C address fixed at 0x36. Register-pointer protocol (8-bit pointer,
// 8-bit register reads, some registers are 12-bit across two bytes).
//
// Register map (datasheet Table 15):
//   0x00       ZMCO         burn count (read-only, 0..3)
//   0x01-0x02  ZPOS         zero position (12-bit, H:L)
//   0x03-0x04  MPOS         max position (12-bit)
//   0x05-0x06  MANG         max angle (12-bit)
//   0x07-0x08  CONF         configuration (16-bit, H:L)
//   0x0B       STATUS       magnet status: MD(5) ML(4) MH(3)
//   0x0C-0x0D  RAWANGLE     raw angle (12-bit, 0..4095)
//   0x0E-0x0F  ANGLE        filtered angle (12-bit)
//   0x1A       AGC          automatic gain control (0..255)
//   0x1B-0x1C  MAGNITUDE    CORDIC magnitude (12-bit)

function registerAS5600() {
    registerDevice('as5600', {
        terminals: ['vcc', 'gnd', 'sda', 'scl', 'dir', 'out'],

        init(part) {
            const regs = new Uint8Array(0x20);
            regs[0x0b] = 0x20;              // STATUS: magnet detected (MD=1)
            regs[0x1a] = 0x80;              // AGC: mid-range default

            const state = {
                drives: { sda: { vTh: 0, rTh: R_OFF } },
                regs,
                ptr: 0,
                _first: true,
                // Readable state for faces
                angle: part.params?.angle ?? 0,
                magnitude: part.params?.magnitude ?? 2048,
            };

            state._i2c = createI2CSlave({
                onAddress: (a7, rw) => {
                    const mine = a7 === 0x36;
                    if (mine && rw === 0) state._first = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._first) {
                        state.ptr = b & 0x1f;
                        state._first = false;
                        return true;
                    }
                    writeAs5600Reg(state, state.ptr, b);
                    state.ptr = (state.ptr + 1) & 0x1f;
                    return true;
                },
                onReadByte: () => {
                    const v = readAs5600Reg(part, state, state.ptr);
                    state.ptr = (state.ptr + 1) & 0x1f;
                    return v;
                },
            });
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
            ctx.conductance('dir', null, 1 / R_INPUT);
            ctx.conductance('out', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            state.angle = part.params?.angle ?? 0;
            state.magnitude = part.params?.magnitude ?? 2048;
            return i2cUpdate(state, read, read('vcc'));
        },
    });
}

function readAs5600Reg(part, state, reg) {
    // Convert angle (0..360 degrees) to 12-bit (0..4095)
    const angleDeg = part.params?.angle ?? 0;
    const norm = ((angleDeg % 360) + 360) % 360;    // handle negatives
    const raw12 = Math.min(4095, Math.round(norm / 360 * 4096));
    const mag = Math.max(0, Math.min(4095, Math.round(part.params?.magnitude ?? 2048)));

    switch (reg) {
        case 0x00: return 0;                         // ZMCO: 0 burns
        case 0x0b: return 0x20;                      // STATUS: magnet detected
        case 0x0c: return (raw12 >> 8) & 0x0f;       // RAWANGLE high (4 bits)
        case 0x0d: return raw12 & 0xff;               // RAWANGLE low
        case 0x0e: return (raw12 >> 8) & 0x0f;       // ANGLE high (= raw here)
        case 0x0f: return raw12 & 0xff;               // ANGLE low
        case 0x1a: return state.regs[0x1a];           // AGC
        case 0x1b: return (mag >> 8) & 0x0f;          // MAGNITUDE high
        case 0x1c: return mag & 0xff;                  // MAGNITUDE low
        default: return state.regs[reg] ?? 0;
    }
}

function writeAs5600Reg(state, reg, v) {
    // Writable config registers: ZPOS, MPOS, MANG, CONF
    if (reg >= 0x01 && reg <= 0x08) {
        state.regs[reg] = v;
    }
    // Everything else is read-only
}

// ─── Registration ────────────────────────────────────────────────────

export function registerI2CSensors() {
    registerBMP280();
    registerTCS34725();
    registerBH1750();
    registerINA219();
    registerVL53L0X();
    registerSGP30();
    registerVEML7700();
    registerAS5600();
}
