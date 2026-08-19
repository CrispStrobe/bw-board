/**
 * I2C sensor device model tests — BMP280, TCS34725, BH1750, INA219,
 * VL53L0X, ADS1115, PCF8591, APDS9960.
 *
 * Each device is wired into a BoardImpl with MCU pins on SCL/SDA,
 * getDeviceState is asserted for the face-facing readable state, and
 * I2C register transactions are driven via the board's I2C inject helper
 * or directly through the device's i2cHandlers.
 *
 * Hand-computed oracles throughout.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerI2CSensors } from '../src/devices/i2c-sensors.js';

registerI2CSensors();

const net = (id, ...ts) => ({
    id,
    terminals: ts.map(([part, terminal]) => ({ part, terminal })),
});

/**
 * Build a minimal board with an I2C sensor + MCU pins for SCL/SDA.
 * Returns { board, handlers } where handlers is the i2cHandlers object
 * for direct register-level testing.
 */
function i2cRig(kind, params = {}, extraTerminals = []) {
    const board = new BoardImpl(3.3);
    const sensorTerms = ['vcc', 'gnd', 'sda', 'scl', ...extraTerminals];
    board.setNetlist([
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sda', 'scl'] },
        { id: 'U1', kind, params, terminals: sensorTerms },
    ], [
        net('nv', ['VCC', 'vcc'], ['U1', 'vcc']),
        net('ng', ['GND', 'gnd'], ['U1', 'gnd']),
        net('n_sda', ['MCU', 'sda'], ['U1', 'sda']),
        net('n_scl', ['MCU', 'scl'], ['U1', 'scl']),
    ]);
    board.setPower(true);

    // Get the I2C handlers from the device state for direct testing
    const st = board.getDeviceState('U1');
    const handlers = st.i2cHandlers || st._i2c?.handlers;

    /**
     * Perform a register read via the handlers directly.
     * Write the register address, then read `count` bytes.
     */
    function readRegs(addr7, regAddr, count) {
        // Write phase: set register pointer
        handlers.onAddress(addr7, 0);       // write
        handlers.onWriteByte(regAddr);
        // Read phase
        handlers.onAddress(addr7, 1);       // read
        const bytes = [];
        for (let i = 0; i < count; i++) {
            bytes.push(handlers.onReadByte());
        }
        return bytes;
    }

    /** Write a byte to a register. */
    function writeReg(addr7, regAddr, value) {
        handlers.onAddress(addr7, 0);
        handlers.onWriteByte(regAddr);
        handlers.onWriteByte(value);
    }

    /** Write a 16-bit value to a register (MSB first, for INA219). */
    function writeReg16(addr7, regAddr, value) {
        handlers.onAddress(addr7, 0);
        handlers.onWriteByte(regAddr);
        handlers.onWriteByte((value >> 8) & 0xff);
        handlers.onWriteByte(value & 0xff);
    }

    return { board, handlers, readRegs, writeReg, writeReg16 };
}

// ─── BMP280 ──────────────────────────────────────────────────────────

describe('BMP280', () => {
    it('chip ID reads 0x58', () => {
        const { readRegs } = i2cRig('bmp280', { temperature: 25 });
        const [id] = readRegs(0x76, 0xd0, 1);
        assert.equal(id, 0x58);
    });

    it('alternate address 0x77', () => {
        const { handlers } = i2cRig('bmp280', { addr: 0x77 });
        assert.equal(handlers.onAddress(0x76, 0), false, 'rejects 0x76');
        assert.equal(handlers.onAddress(0x77, 0), true, 'accepts 0x77');
    });

    it('temperature registers read 0x80 in sleep mode (mode=00)', () => {
        const { readRegs } = i2cRig('bmp280', { temperature: 25 });
        // ctrl_meas defaults to 0x00 (sleep mode)
        const [msb, lsb, xlsb] = readRegs(0x76, 0xfa, 3);
        assert.equal(msb, 0x80, 'temp MSB in sleep = 0x80');
    });

    it('temperature reads correctly after enabling forced mode', () => {
        const { readRegs, writeReg } = i2cRig('bmp280', { temperature: 25 });
        // Set ctrl_meas to forced mode: osrs_t=001, osrs_p=001, mode=01
        // = 0b001_001_01 = 0x25
        writeReg(0x76, 0xf4, 0x25);

        // Temperature: 25°C → raw = 25 × 5120 = 128000
        // 20-bit shifted: 128000 << 4 = 2048000 = 0x1F4000
        // MSB=0x1F, LSB=0x40, XLSB=0x00
        const [msb, lsb, xlsb] = readRegs(0x76, 0xfa, 3);
        const raw20 = ((msb << 16) | (lsb << 8) | xlsb) >> 4;
        const tempBack = raw20 / 5120;
        assert.ok(Math.abs(tempBack - 25) < 0.1,
            `25°C round-trips: got ${tempBack}`);
    });

    it('pressure reads correctly in normal mode', () => {
        const { readRegs, writeReg } = i2cRig('bmp280', {
            temperature: 20,
            pressure: 101325,   // standard atmosphere, Pa
        });
        // normal mode
        writeReg(0x76, 0xf4, 0x27); // osrs_t=1, osrs_p=1, mode=11

        const [msb, lsb, xlsb] = readRegs(0x76, 0xf7, 3);
        const raw20 = ((msb << 16) | (lsb << 8) | xlsb) >> 4;
        // raw = pressure * 2.56 = 101325 * 2.56 ≈ 259392
        const pressBack = raw20 / 2.56;
        assert.ok(Math.abs(pressBack - 101325) < 10,
            `101325 Pa round-trips: got ${pressBack}`);
    });

    it('soft reset restores chip ID and sleep mode', () => {
        const { readRegs, writeReg } = i2cRig('bmp280', {});
        writeReg(0x76, 0xf4, 0x27); // set normal mode
        writeReg(0x76, 0xe0, 0xb6); // soft reset
        const [id] = readRegs(0x76, 0xd0, 1);
        assert.equal(id, 0x58, 'chip ID restored');
        const [ctrl] = readRegs(0x76, 0xf4, 1);
        assert.equal(ctrl, 0x00, 'back to sleep mode');
    });

    it('getDeviceState exposes temperature and pressure', () => {
        const { board } = i2cRig('bmp280', { temperature: 30, pressure: 99000 });
        const st = board.getDeviceState('U1');
        assert.equal(st.temperature, 30);
        assert.equal(st.pressure, 99000);
    });
});

// ─── TCS34725 ────────────────────────────────────────────────────────

describe('TCS34725', () => {
    it('ID register reads 0x44', () => {
        const { readRegs } = i2cRig('tcs34725', {}, ['int', 'led']);
        const [id] = readRegs(0x29, 0x92, 1); // 0x80 | 0x12 → reg 0x12
        assert.equal(id, 0x44);
    });

    it('address is fixed at 0x29', () => {
        const { handlers } = i2cRig('tcs34725', {}, ['int', 'led']);
        assert.equal(handlers.onAddress(0x29, 0), true);
        assert.equal(handlers.onAddress(0x28, 0), false);
    });

    it('RGBC reads 0 when not enabled', () => {
        const { readRegs } = i2cRig('tcs34725',
            { red: 1000, green: 2000, blue: 500 }, ['int', 'led']);
        // ENABLE defaults to 0x00 (off)
        const [rl, rh] = readRegs(0x29, 0x16, 2);
        assert.equal(rl, 0, 'red low = 0 when off');
        assert.equal(rh, 0, 'red high = 0 when off');
    });

    it('RGBC reads correctly after enabling PON + AEN', () => {
        const { readRegs, writeReg } = i2cRig('tcs34725',
            { red: 1000, green: 2000, blue: 500 }, ['int', 'led']);
        // Enable: PON=1, AEN=1 → 0x03
        writeReg(0x29, 0x00, 0x03);

        // Red: 1000 → LE: low=0xE8, high=0x03
        const [rl, rh] = readRegs(0x29, 0x16, 2);
        assert.equal(rl | (rh << 8), 1000, 'red = 1000');

        // Green: 2000 → LE: low=0xD0, high=0x07
        const [gl, gh] = readRegs(0x29, 0x18, 2);
        assert.equal(gl | (gh << 8), 2000, 'green = 2000');

        // Blue: 500
        const [bl, bh] = readRegs(0x29, 0x1a, 2);
        assert.equal(bl | (bh << 8), 500, 'blue = 500');

        // Clear: auto = R+G+B = 3500
        const [cl, ch] = readRegs(0x29, 0x14, 2);
        assert.equal(cl | (ch << 8), 3500, 'clear = sum of RGB');
    });

    it('explicit clear channel overrides auto-sum', () => {
        const { readRegs, writeReg } = i2cRig('tcs34725',
            { red: 100, green: 200, blue: 300, clear: 5000 }, ['int', 'led']);
        writeReg(0x29, 0x00, 0x03);
        const [cl, ch] = readRegs(0x29, 0x14, 2);
        assert.equal(cl | (ch << 8), 5000, 'clear = explicit 5000');
    });

    it('STATUS shows AVALID when enabled', () => {
        const { readRegs, writeReg } = i2cRig('tcs34725', {}, ['int', 'led']);
        const [s0] = readRegs(0x29, 0x13, 1);
        assert.equal(s0 & 0x01, 0, 'AVALID clear when off');
        writeReg(0x29, 0x00, 0x03); // enable
        const [s1] = readRegs(0x29, 0x13, 1);
        assert.equal(s1 & 0x01, 1, 'AVALID set when on');
    });

    it('getDeviceState exposes RGBC', () => {
        const { board } = i2cRig('tcs34725',
            { red: 10, green: 20, blue: 30 }, ['int', 'led']);
        const st = board.getDeviceState('U1');
        assert.equal(st.red, 10);
        assert.equal(st.green, 20);
        assert.equal(st.blue, 30);
        assert.equal(st.clear, 60); // auto-sum
    });
});

// ─── BH1750 ──────────────────────────────────────────────────────────

describe('BH1750', () => {
    it('default address is 0x23', () => {
        const { handlers } = i2cRig('bh1750', {}, ['addr']);
        assert.equal(handlers.onAddress(0x23, 0), true);
        assert.equal(handlers.onAddress(0x5c, 0), false);
    });

    it('alternate address 0x5C when addr=high', () => {
        const { handlers } = i2cRig('bh1750', { addr: 'high' }, ['addr']);
        assert.equal(handlers.onAddress(0x5c, 0), true);
        assert.equal(handlers.onAddress(0x23, 0), false);
    });

    it('reads 0 when powered down', () => {
        const { handlers } = i2cRig('bh1750', { lux: 500 }, ['addr']);
        // Power down by default
        handlers.onAddress(0x23, 1);
        const h = handlers.onReadByte();
        const l = handlers.onReadByte();
        assert.equal(h, 0, 'high byte 0 when off');
        assert.equal(l, 0, 'low byte 0 when off');
    });

    it('H-Resolution mode: 500 lux reads correctly', () => {
        const { handlers } = i2cRig('bh1750', { lux: 500 }, ['addr']);
        // Power on + H-Resolution continuous mode (0x10)
        handlers.onAddress(0x23, 0);
        handlers.onWriteByte(0x01);         // power on
        handlers.onAddress(0x23, 0);
        handlers.onWriteByte(0x10);         // continuous H-res

        // Read: raw = 500 / 1.2 ≈ 417 = 0x01A1
        handlers.onAddress(0x23, 1);
        const h = handlers.onReadByte();
        const l = handlers.onReadByte();
        const raw = (h << 8) | l;
        // Oracle: round(500 / 1.2) = 417
        assert.equal(raw, 417, 'raw = round(500/1.2) = 417');
        // Back to lux: 417 * 1.2 = 500.4 ≈ 500
        const luxBack = raw * 1.2;
        assert.ok(Math.abs(luxBack - 500) < 1, `500 lux round-trips: got ${luxBack}`);
    });

    it('H-Resolution Mode2: double resolution (0.5 lx)', () => {
        const { handlers } = i2cRig('bh1750', { lux: 100 }, ['addr']);
        handlers.onAddress(0x23, 0);
        handlers.onWriteByte(0x11);         // mode2

        handlers.onAddress(0x23, 1);
        const h = handlers.onReadByte();
        const l = handlers.onReadByte();
        const raw = (h << 8) | l;
        // Oracle: round(100 / 0.6) = 167
        assert.equal(raw, 167, 'Mode2 raw = round(100/0.6) = 167');
    });

    it('reset clears measurement mode', () => {
        const { handlers } = i2cRig('bh1750', { lux: 200 }, ['addr']);
        handlers.onAddress(0x23, 0);
        handlers.onWriteByte(0x10);         // start measurement
        handlers.onAddress(0x23, 0);
        handlers.onWriteByte(0x07);         // reset

        handlers.onAddress(0x23, 1);
        const h = handlers.onReadByte();
        assert.equal(h, 0, 'reads 0 after reset');
    });

    it('getDeviceState exposes lux', () => {
        const { board } = i2cRig('bh1750', { lux: 1234 }, ['addr']);
        const st = board.getDeviceState('U1');
        assert.equal(st.lux, 1234);
    });
});

// ─── INA219 ──────────────────────────────────────────────────────────

describe('INA219', () => {
    it('default address is 0x40', () => {
        const { handlers } = i2cRig('ina219', {}, ['vin_p', 'vin_n']);
        assert.equal(handlers.onAddress(0x40, 0), true);
        assert.equal(handlers.onAddress(0x41, 0), false);
    });

    it('config register defaults to 0x399F', () => {
        const { readRegs } = i2cRig('ina219', {}, ['vin_p', 'vin_n']);
        const [h, l] = readRegs(0x40, 0x00, 2);
        assert.equal((h << 8) | l, 0x399f, 'default config');
    });

    it('bus voltage: 5V reads correctly', () => {
        const { readRegs } = i2cRig('ina219',
            { busVoltage: 5, current_mA: 100 }, ['vin_p', 'vin_n']);
        const [h, l] = readRegs(0x40, 0x02, 2);
        const regVal = (h << 8) | l;
        // Bus voltage in bits 15:3, 4 mV LSB
        // 5V = 5000mV / 4 = 1250 → shifted left 3 = 10000 | CNVR(bit1)
        const busRaw = regVal >> 3;
        const busV = busRaw * 0.004;
        assert.ok(Math.abs(busV - 5) < 0.01, `5V bus reads back: got ${busV}`);
        assert.equal(regVal & 0x02, 0x02, 'CNVR bit set');
    });

    it('shunt voltage: 100mA through 0.1Ω = 10mV', () => {
        const { readRegs } = i2cRig('ina219',
            { busVoltage: 5, current_mA: 100, shuntOhms: 0.1 }, ['vin_p', 'vin_n']);
        const [h, l] = readRegs(0x40, 0x01, 2);
        const raw = (h << 8) | l;
        // Shunt: 100mA × 0.1Ω = 10mV, LSB = 10µV → raw = 10mV × 100 = 1000
        assert.equal(raw, 1000, 'shunt raw = 1000 (10mV at 10µV/LSB)');
    });

    it('soft reset restores config', () => {
        const { readRegs, writeReg16 } = i2cRig('ina219', {}, ['vin_p', 'vin_n']);
        // Change config
        writeReg16(0x40, 0x00, 0x0001);
        let [h, l] = readRegs(0x40, 0x00, 2);
        assert.equal((h << 8) | l, 0x0001, 'config changed');

        // Reset
        writeReg16(0x40, 0x00, 0x8000);
        [h, l] = readRegs(0x40, 0x00, 2);
        assert.equal((h << 8) | l, 0x399f, 'config restored after reset');
    });

    it('alternate address 0x41', () => {
        const { handlers } = i2cRig('ina219', { addr: 0x41 }, ['vin_p', 'vin_n']);
        assert.equal(handlers.onAddress(0x41, 0), true);
        assert.equal(handlers.onAddress(0x40, 0), false);
    });

    it('getDeviceState exposes voltage/current/power', () => {
        const { board } = i2cRig('ina219',
            { busVoltage: 12, current_mA: 250, shuntOhms: 0.1 }, ['vin_p', 'vin_n']);
        const st = board.getDeviceState('U1');
        assert.equal(st.busVoltage, 12);
        assert.equal(st.current_mA, 250);
        assert.equal(st.shuntVoltage, 25);  // 250mA × 0.1Ω = 25mV
        assert.equal(st.power_mW, 3000);    // 12V × 250mA = 3000mW
    });
});

// ─── VL53L0X ─────────────────────────────────────────────────────────

describe('VL53L0X', () => {
    it('MODEL_ID reads 0xEE at register 0xC0', () => {
        const { readRegs } = i2cRig('vl53l0x', {}, ['xshut', 'gpio1']);
        const [id] = readRegs(0x29, 0xc0, 1);
        assert.equal(id, 0xee);
    });

    it('identification bytes: 0xEE 0xAA 0x10', () => {
        const { readRegs } = i2cRig('vl53l0x', {}, ['xshut', 'gpio1']);
        const [a, b, c] = readRegs(0x29, 0xc0, 3);
        assert.equal(a, 0xee, 'MODEL_ID');
        assert.equal(b, 0xaa, 'MODEL_ID rev');
        assert.equal(c, 0x10, 'MODULE_TYPE');
    });

    it('default address is 0x29', () => {
        const { handlers } = i2cRig('vl53l0x', {}, ['xshut', 'gpio1']);
        assert.equal(handlers.onAddress(0x29, 0), true);
        assert.equal(handlers.onAddress(0x30, 0), false);
    });

    it('configurable address via params', () => {
        const { handlers } = i2cRig('vl53l0x', { addr: 0x30 }, ['xshut', 'gpio1']);
        assert.equal(handlers.onAddress(0x30, 0), true);
        assert.equal(handlers.onAddress(0x29, 0), false);
    });

    it('range reads 0 before starting measurement', () => {
        const { readRegs } = i2cRig('vl53l0x', { distance_mm: 500 }, ['xshut', 'gpio1']);
        // RESULT_INTERRUPT_STATUS should show no data
        const [status] = readRegs(0x29, 0x13, 1);
        assert.equal(status & 0x07, 0, 'no data ready before ranging');
    });

    it('distance reads correctly after starting ranging', () => {
        const { readRegs, writeReg } = i2cRig('vl53l0x',
            { distance_mm: 1234 }, ['xshut', 'gpio1']);
        // Start single-shot ranging
        writeReg(0x29, 0x00, 0x01);

        // Check data ready
        const [status] = readRegs(0x29, 0x13, 1);
        assert.equal(status & 0x07, 0x07, 'data ready after start');

        // Read range: 1234mm → MSB=0x04, LSB=0xD2
        const [msb, lsb] = readRegs(0x29, 0x1e, 2);
        const dist = (msb << 8) | lsb;
        assert.equal(dist, 1234, 'distance 1234mm round-trips');
    });

    it('stop ranging clears data-ready flag', () => {
        const { readRegs, writeReg } = i2cRig('vl53l0x',
            { distance_mm: 100 }, ['xshut', 'gpio1']);
        writeReg(0x29, 0x00, 0x01);    // start
        writeReg(0x29, 0x00, 0x00);    // stop
        const [status] = readRegs(0x29, 0x13, 1);
        assert.equal(status & 0x07, 0, 'no data after stop');
    });

    it('distance clamps to 0..8190mm', () => {
        const { readRegs, writeReg } = i2cRig('vl53l0x',
            { distance_mm: 10000 }, ['xshut', 'gpio1']);
        writeReg(0x29, 0x00, 0x01);
        const [msb, lsb] = readRegs(0x29, 0x1e, 2);
        assert.equal((msb << 8) | lsb, 8190, 'clamped to 8190');
    });

    it('getDeviceState exposes distance_mm', () => {
        const { board } = i2cRig('vl53l0x',
            { distance_mm: 350 }, ['xshut', 'gpio1']);
        const st = board.getDeviceState('U1');
        assert.equal(st.distance_mm, 350);
    });
});
