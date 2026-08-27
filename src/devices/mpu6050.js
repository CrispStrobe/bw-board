/**
 * MPU-6050 — InvenSense 6-axis IMU (accelerometer + gyroscope), clean-room
 * from the MPU-6000/6050 register map (RM-MPU-6000A, rev 4.2) and product
 * specification (PS-MPU-6000A, rev 3.4).
 *
 * I2C slave at 0x68 (AD0 low) or 0x69 (AD0 high), on the bidirectional
 * i2c-slave.js engine. Register-pointer semantics: first write byte sets
 * the pointer, subsequent bytes auto-increment.
 *
 * Key behaviors modeled:
 *   - **Sleep at power-on** (PWR_MGMT_1 bit 6 = 1 after reset) — the
 *     classic trap: readings stay zero until you clear the sleep bit.
 *     Every i2cdevlib/MPU6050 tutorial starts with `setSleepEnabled(false)`.
 *   - WHO_AM_I (0x75) returns 0x68 (the fixed identity, regardless of AD0).
 *   - Accel registers (0x3B-0x40): from params.ax/ay/az in g-units,
 *     scaled by the sensitivity for the configured FS_SEL (default ±2 g
 *     → 16384 LSB/g).
 *   - Gyro registers (0x43-0x48): from params.gx/gy/gz in deg/s,
 *     scaled by the configured FS_SEL (default ±250 → 131 LSB/(deg/s)).
 *   - Temperature (0x41-0x42): from params.temperature in °C,
 *     formula per datasheet: regval = (T + 36.53) × 340.
 *   - Config registers (SMPLRT_DIV, CONFIG, GYRO_CONFIG, ACCEL_CONFIG,
 *     INT_ENABLE, INT_STATUS, PWR_MGMT_1/2, USER_CTRL, FIFO_EN,
 *     SIGNAL_PATH_RESET) store and read back. FIFO and DMP are unmodeled;
 *     FIFO_COUNT reads 0. Stated.
 *
 * Orientation presets via params.orientation: 'flat' (default, az=1g),
 * 'upright' (ay=-1g), 'left' (ax=-1g), 'right' (ax=1g), 'facedown'
 * (az=-1g). These set the default a-values when ax/ay/az are not
 * explicitly provided.
 *
 * @module
 */

import { registerDevice } from '../devices.js';
import { createI2CSlave, feedI2CSlave } from './i2c-slave.js';

const R_OUT = 50;
const R_OFF = 1e9;
const R_INPUT = 1e6;

// Sensitivity tables per datasheet.
const ACCEL_SENS = [16384, 8192, 4096, 2048];    // LSB/g for FS_SEL 0..3
const GYRO_SENS = [131, 65.5, 32.8, 16.4];       // LSB/(deg/s) for FS_SEL 0..3

const ORIENTATIONS = {
    flat:      { ax: 0, ay: 0, az: 1 },
    upright:   { ax: 0, ay: -1, az: 0 },
    left:      { ax: -1, ay: 0, az: 0 },
    right:     { ax: 1, ay: 0, az: 0 },
    facedown:  { ax: 0, ay: 0, az: -1 },
};

export function registerMPU6050() {

    registerDevice('mpu6050', {
        terminals: ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'],

        init(part) {
            const state = {
                // INT starts released. How it drives once asserted is the
                // host's choice, not ours — see INT_PIN_CFG in update().
                drives: { sda: { vTh: 0, rTh: R_OFF }, int: { vTh: 0, rTh: R_OFF } },
                ptr: 0,
                // Power-on: DEVICE_RESET cleared, SLEEP SET, CLKSEL = 0 (internal 8 MHz).
                regs: new Uint8Array(128),
                _first: true,
            };
            // PWR_MGMT_1 (0x6B) power-on value: SLEEP bit set.
            state.regs[0x6b] = 0x40;
            // WHO_AM_I (0x75): always 0x68.
            state.regs[0x75] = 0x68;

            const handlers = {
                onAddress: (a7, rw) => {
                    const ad0 = part.params?.ad0 ?? 0;
                    const mine = a7 === (0x68 | (ad0 ? 1 : 0));
                    if (mine && rw === 0) state._first = true;
                    return mine;
                },
                onWriteByte: (b) => {
                    if (state._first) {
                        state.ptr = b & 0x7f;
                        state._first = false;
                        return true;
                    }
                    writeMpuReg(state, state.ptr, b);
                    state.ptr = (state.ptr + 1) & 0x7f;
                    return true;
                },
                onReadByte: () => {
                    const v = readMpuReg(part, state, state.ptr);
                    state.ptr = (state.ptr + 1) & 0x7f;
                    return v;
                },
            };
            state.i2cHandlers = handlers;
            state._i2c = createI2CSlave(handlers);
            return state;
        },

        stamp(ctx) {
            ctx.conductance('scl', null, 1 / R_INPUT);
            ctx.conductance('ad0', null, 1 / R_INPUT);
        },

        update(part, state, read) {
            const vcc = read('vcc') || 3.3;
            const th = vcc * 0.5;

            // INT — declared since the part was written, never driven, so the
            // one thing an IMU's interrupt pin is for (not polling a 6-axis
            // sensor over I2C at the sample rate) could not be wired.
            //
            // The host decides how it behaves, and getting these two bits
            // backwards is the classic MPU-6050 wiring fault:
            //   INT_PIN_CFG (0x37) bit 7 ACTL — 1 = ACTIVE LOW
            //                      bit 6 OPEN — 1 = OPEN DRAIN
            // Defaults are 0/0, i.e. active HIGH and push-pull, which is why
            // a tutorial that ties INT to a pull-up and waits for a falling
            // edge sees nothing until it sets ACTL.
            //
            // STATED DIVERGENCE: the interrupt is gated on
            // INT_ENABLE.DATA_RDY_EN and on being awake, but not on sample
            // TIMING — this model has no sample clock, its readings come
            // straight from params, so data is always ready. The pin
            // therefore asserts as soon as the host enables it, rather than
            // at the rate SMPLRT_DIV would set. Sooner than silicon, never
            // later: it cannot hide an interrupt a real part would raise.
            const sleeping = !!(state.regs[0x6b] & 0x40);
            const dataRdyEn = !!(state.regs[0x38] & 0x01);
            const cfg = state.regs[0x37];
            const activeLow = !!(cfg & 0x80);
            const openDrain = !!(cfg & 0x40);
            const asserted = !sleeping && dataRdyEn;

            let want;
            if (!asserted) {
                // Idle. Push-pull holds the INACTIVE level; open-drain lets
                // go and leaves the line to the board's pull-up.
                want = openDrain
                    ? { vTh: 0, rTh: R_OFF }
                    : { vTh: activeLow ? vcc : 0, rTh: R_OUT };
            } else if (openDrain) {
                // Open-drain can only pull DOWN, so an active-high open-drain
                // interrupt cannot signal at all — a real configuration
                // mistake, and the model reproduces it rather than papering
                // over it.
                want = activeLow ? { vTh: 0, rTh: R_OUT } : { vTh: 0, rTh: R_OFF };
            } else {
                want = { vTh: activeLow ? 0 : vcc, rTh: R_OUT };
            }
            let changed = false;
            const now = state.drives.int;
            if (now.rTh !== want.rTh || now.vTh !== want.vTh) {
                state.drives.int = want;
                changed = true;
            }

            const driveLow = feedI2CSlave(state._i2c, read('scl') > th, read('sda') > th);
            const nowLow = state.drives.sda.rTh === R_OUT;
            if (driveLow !== nowLow) {
                state.drives.sda = driveLow ? { vTh: 0, rTh: R_OUT } : { vTh: 0, rTh: R_OFF };
                changed = true;
            }
            return changed;
        },
    });
}

function getAccel(part) {
    const orient = ORIENTATIONS[part.params?.orientation] ?? ORIENTATIONS.flat;
    return {
        ax: part.params?.ax ?? orient.ax,
        ay: part.params?.ay ?? orient.ay,
        az: part.params?.az ?? orient.az,
    };
}

function readMpuReg(part, state, reg) {
    // If sleeping, sensor data reads as 0 (the classic trap).
    const sleeping = !!(state.regs[0x6b] & 0x40);

    const accelFs = (state.regs[0x1c] >> 3) & 0x03;
    const gyroFs = (state.regs[0x1b] >> 3) & 0x03;

    switch (reg) {
        // Accelerometer: 0x3B-0x40 (XH,XL,YH,YL,ZH,ZL)
        case 0x3b: case 0x3c: case 0x3d: case 0x3e: case 0x3f: case 0x40: {
            if (sleeping) return 0;
            const { ax, ay, az } = getAccel(part);
            const vals = [ax, ay, az];
            const off = reg - 0x3b;
            const axis = Math.floor(off / 2);
            const raw = Math.round(vals[axis] * ACCEL_SENS[accelFs]);
            const clamped = Math.max(-32768, Math.min(32767, raw));
            const u16 = clamped < 0 ? clamped + 65536 : clamped;
            return (off & 1) ? (u16 & 0xff) : (u16 >> 8) & 0xff;
        }
        // Temperature: 0x41-0x42
        case 0x41: case 0x42: {
            if (sleeping) return 0;
            const temp = part.params?.temperature ?? 25;
            const raw = Math.round((temp + 36.53) * 340);
            const clamped = Math.max(-32768, Math.min(32767, raw));
            const u16 = clamped < 0 ? clamped + 65536 : clamped;
            return reg === 0x41 ? (u16 >> 8) & 0xff : u16 & 0xff;
        }
        // Gyroscope: 0x43-0x48 (XH,XL,YH,YL,ZH,ZL)
        case 0x43: case 0x44: case 0x45: case 0x46: case 0x47: case 0x48: {
            if (sleeping) return 0;
            const gx = part.params?.gx ?? 0;
            const gy = part.params?.gy ?? 0;
            const gz = part.params?.gz ?? 0;
            const vals = [gx, gy, gz];
            const off = reg - 0x43;
            const axis = Math.floor(off / 2);
            const raw = Math.round(vals[axis] * GYRO_SENS[gyroFs]);
            const clamped = Math.max(-32768, Math.min(32767, raw));
            const u16 = clamped < 0 ? clamped + 65536 : clamped;
            return (off & 1) ? (u16 & 0xff) : (u16 >> 8) & 0xff;
        }
        // FIFO count: always 0 (FIFO unmodeled).
        case 0x72: case 0x73: return 0;
        // WHO_AM_I: 0x75 — hardcoded 0x68.
        case 0x75: return 0x68;
        // INT_STATUS (0x3A): DATA_RDY_INT always set when not sleeping.
        case 0x3a: return sleeping ? 0 : 0x01;
        default: return state.regs[reg] ?? 0;
    }
}

function writeMpuReg(state, reg, v) {
    switch (reg) {
        case 0x6b:                                      // PWR_MGMT_1
            if (v & 0x80) {                             // DEVICE_RESET
                state.regs.fill(0);
                state.regs[0x6b] = 0x40;                // back to sleep
                state.regs[0x75] = 0x68;
                state.ptr = 0;
                return;
            }
            state.regs[0x6b] = v & 0x7f;               // strip DEVICE_RESET
            break;
        case 0x6a:                                      // USER_CTRL
            if (v & 0x01) { /* SIG_COND_RESET: no-op */ }
            if (v & 0x04) { /* FIFO_RESET: no-op */ }
            state.regs[reg] = v & ~0x05;                // self-clearing bits
            break;
        case 0x68:                                      // SIGNAL_PATH_RESET
            state.regs[reg] = 0;                        // self-clearing
            break;
        case 0x75:                                      // WHO_AM_I: read-only
            break;
        default:
            state.regs[reg] = v;
    }
}

export default registerMPU6050;
