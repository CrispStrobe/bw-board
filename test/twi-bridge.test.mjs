/**
 * TWI transaction bridge tests.
 *
 * 1. Unit tests: scripted TWI transactions against device handlers directly
 * 2. Integration tests: compiled Wire-based Arduino sketches on avr8js
 *    against the board's I2C device models via the TWI bridge
 *
 * The compiled hex files live in rom/arduino-drivers/ and are skipped if
 * not available.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createTWIBridge } from '../src/twi-bridge.js';
import { createAvr8jsAdapter } from '../src/avr8js-adapter.js';
import { parseIntelHex } from '../src/intel-hex.js';
import { BoardImpl } from '../src/board.js';
import { registerRtcDisplay } from '../src/devices/rtc-display.js';
import { registerMPU6050 } from '../src/devices/mpu6050.js';
import { registerSSD1306, ssd1306Pixel } from '../src/devices/ssd1306.js';
import { registerBoardICs } from '../src/devices/board-ics.js';
import { unregisterDevice } from '../src/devices.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROM_DIR = path.resolve(here, '../rom/arduino-drivers');

function hexPath(name) { return path.join(ROM_DIR, `${name}.hex`); }

// Register devices (idempotent)
try { registerRtcDisplay(); } catch {}
try { registerMPU6050(); } catch {}
try { registerSSD1306(); } catch {}
try { registerBoardICs(); } catch {}

// =====================================================================
// Unit tests: TWI bridge with mock TWI
// =====================================================================
describe('TWI bridge: unit tests', () => {

  it('routes connectToSlave to the matching device handler', () => {
    // Fake TWI that records complete* calls
    const calls = [];
    const fakeTWI = {
      completeStart()      { calls.push('start'); },
      completeStop()       { calls.push('stop'); },
      completeConnect(ack) { calls.push(`connect:${ack}`); },
      completeWrite(ack)   { calls.push(`write:${ack}`); },
      completeRead(val)    { calls.push(`read:${val}`); },
    };

    const bridge = createTWIBridge(fakeTWI);

    // Add two devices
    const dev50 = {
      onAddress: (a7, rw) => a7 === 0x50,
      onWriteByte: (b) => true,
      onReadByte: () => 0x42,
    };
    const dev68 = {
      onAddress: (a7, rw) => a7 === 0x68,
      onWriteByte: (b) => true,
      onReadByte: () => 0xAB,
      onStop: () => {},
    };
    bridge.devices = [dev50, dev68];

    // START
    bridge.start(false);
    assert.deepStrictEqual(calls, ['start']);

    // Connect to 0x68 (write)
    calls.length = 0;
    bridge.connectToSlave(0x68, true);
    assert.deepStrictEqual(calls, ['connect:true']);
    assert.strictEqual(bridge.active, dev68);

    // Write a byte
    calls.length = 0;
    bridge.writeByte(0x75);
    assert.deepStrictEqual(calls, ['write:true']);

    // Read a byte
    calls.length = 0;
    bridge.readByte(true);
    assert.deepStrictEqual(calls, ['read:171']); // 0xAB = 171

    // Stop
    calls.length = 0;
    bridge.stop();
    assert.deepStrictEqual(calls, ['stop']);
    assert.strictEqual(bridge.active, null);
  });

  it('NACKs when no device matches the address', () => {
    const calls = [];
    const fakeTWI = {
      completeStart()      { calls.push('start'); },
      completeStop()       { calls.push('stop'); },
      completeConnect(ack) { calls.push(`connect:${ack}`); },
      completeWrite(ack)   { calls.push(`write:${ack}`); },
      completeRead(val)    { calls.push(`read:${val}`); },
    };

    const bridge = createTWIBridge(fakeTWI);
    bridge.devices = [{
      onAddress: (a7) => a7 === 0x50,
      onWriteByte: () => true,
      onReadByte: () => 0,
    }];

    bridge.connectToSlave(0x3C, true);
    assert.deepStrictEqual(calls, ['connect:false']);
    assert.strictEqual(bridge.active, null);
  });

  it('routes to AT24C02 handler and reads/writes EEPROM', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'EE', kind: 'at24c02', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['A4', 'A5'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'EE', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'EE', terminal: 'gnd' }] },
       { id: 'sda', terminals: [{ part: 'MCU', terminal: 'A4' }, { part: 'EE', terminal: 'sda' }] },
       { id: 'scl', terminals: [{ part: 'MCU', terminal: 'A5' }, { part: 'EE', terminal: 'scl' }] }],
    );

    const handlers = board.getI2CHandlers();
    assert.ok(handlers.length >= 1, 'board should have I2C handlers');

    // Find the AT24C02 handler
    const eeHandler = handlers.find(h => h.onAddress(0x50, 0));
    assert.ok(eeHandler, 'AT24C02 should claim address 0x50');

    // Write address 0x00
    eeHandler.onWriteByte(0x00);
    // Write data byte
    eeHandler.onWriteByte(0xDE);
    eeHandler.onStop();

    // Read it back: set pointer with a write, then read
    eeHandler.onAddress(0x50, 0);
    eeHandler.onWriteByte(0x00);
    // Repeated START → read
    eeHandler.onAddress(0x50, 1);
    const val = eeHandler.onReadByte();
    assert.strictEqual(val, 0xDE, 'should read back what was written');
  });

  it('routes to MPU6050 handler: WHO_AM_I reads 0x68', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'MPU', kind: 'mpu6050', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['A4', 'A5'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'MPU', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'MPU', terminal: 'gnd' }, { part: 'MPU', terminal: 'ad0' }] },
       { id: 'sda', terminals: [{ part: 'MCU', terminal: 'A4' }, { part: 'MPU', terminal: 'sda' }] },
       { id: 'scl', terminals: [{ part: 'MCU', terminal: 'A5' }, { part: 'MPU', terminal: 'scl' }] }],
    );

    const handlers = board.getI2CHandlers();
    const mpuHandler = handlers.find(h => h.onAddress(0x68, 0));
    assert.ok(mpuHandler, 'MPU6050 should claim address 0x68');

    // Set register pointer to WHO_AM_I (0x75)
    mpuHandler.onWriteByte(0x75);
    // Switch to read
    mpuHandler.onAddress(0x68, 1);
    const whoAmI = mpuHandler.onReadByte();
    assert.strictEqual(whoAmI, 0x68, 'WHO_AM_I should return 0x68');
  });

  it('routes to DS3231 handler: reads time registers', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'RTC', kind: 'ds3231', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['A4', 'A5'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'RTC', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'RTC', terminal: 'gnd' }] },
       { id: 'sda', terminals: [{ part: 'MCU', terminal: 'A4' }, { part: 'RTC', terminal: 'sda' }] },
       { id: 'scl', terminals: [{ part: 'MCU', terminal: 'A5' }, { part: 'RTC', terminal: 'scl' }] }],
    );

    const handlers = board.getI2CHandlers();
    const rtcHandler = handlers.find(h => h.onAddress(0x68, 0));
    assert.ok(rtcHandler, 'DS3231 should claim address 0x68');

    // Read status register (0x0F) — OSF should be set on power-up
    rtcHandler.onWriteByte(0x0F);
    rtcHandler.onAddress(0x68, 1);
    const status = rtcHandler.onReadByte();
    assert.ok(status & 0x80, 'OSF flag should be set on power-up');
  });

  it('routes to SSD1306 handler: accepts init commands', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'OLED', kind: 'ssd1306', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['A4', 'A5'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'OLED', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'OLED', terminal: 'gnd' }] },
       { id: 'sda', terminals: [{ part: 'MCU', terminal: 'A4' }, { part: 'OLED', terminal: 'sda' }] },
       { id: 'scl', terminals: [{ part: 'MCU', terminal: 'A5' }, { part: 'OLED', terminal: 'scl' }] }],
    );

    const handlers = board.getI2CHandlers();
    const oledHandler = handlers.find(h => h.onAddress(0x3C, 0));
    assert.ok(oledHandler, 'SSD1306 should claim address 0x3C');

    // Send display ON command: control byte 0x00, then command 0xAF
    oledHandler.onWriteByte(0x00);  // control byte: Co=0, D/C#=0
    oledHandler.onWriteByte(0xAF);  // display ON
    oledHandler.onStop();

    // Check state
    const state = board.getDeviceState('OLED');
    assert.ok(state, 'OLED state should exist');
    assert.strictEqual(state.displayOn, true, 'display should be ON after 0xAF');
  });
});

// =====================================================================
// Integration tests: avr8js adapter with compiled sketches
// =====================================================================
describe('TWI bridge: adapter creates AVRTWI for ATmega328P', () => {

  it('adapter has twi and twiBridge for ATmega328P', () => {
    const adapter = createAvr8jsAdapter({ chip: 'atmega328p' });
    assert.ok(adapter.twi, 'ATmega328P adapter should have TWI peripheral');
    assert.ok(adapter.twiBridge, 'ATmega328P adapter should have TWI bridge');
    assert.ok(adapter.spi, 'ATmega328P adapter should have SPI peripheral');
    assert.ok(adapter.spiBridge, 'ATmega328P adapter should have SPI bridge');
  });

  it('adapter TWI bridge discovers board I2C devices on attachBoard', () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'MPU', kind: 'mpu6050', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'] },
       { id: 'EE', kind: 'at24c02', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['A4', 'A5'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'MPU', terminal: 'vcc' }, { part: 'EE', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'MPU', terminal: 'gnd' }, { part: 'MPU', terminal: 'ad0' }, { part: 'EE', terminal: 'gnd' }] },
       { id: 'sda', terminals: [{ part: 'MCU', terminal: 'A4' }, { part: 'MPU', terminal: 'sda' }, { part: 'EE', terminal: 'sda' }] },
       { id: 'scl', terminals: [{ part: 'MCU', terminal: 'A5' }, { part: 'MPU', terminal: 'scl' }, { part: 'EE', terminal: 'scl' }] }],
    );

    const adapter = createAvr8jsAdapter({ chip: 'atmega328p' });
    adapter.attachBoard(board);

    assert.ok(adapter.twiBridge.devices.length >= 2,
      `TWI bridge should discover at least 2 I2C devices, got ${adapter.twiBridge.devices.length}`);
  });
});

// =====================================================================
// Arduino sketch integration tests (require compiled hex files)
// =====================================================================
describe('TWI bridge: RTClib DS3231 via Wire on avr8js', () => {
  const hexFile = hexPath('rtclib_demo');

  it('RTClib begin + adjust + now against DS3231 model', {
    skip: !existsSync(hexFile) && 'rtclib_demo.hex not built',
  }, async () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'RTC', kind: 'ds3231', params: {},
         terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {},
         terminals: ['A4', 'A5', 'D13'] }],
      [{ id: 'vcc', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'RTC', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'RTC', terminal: 'gnd' }] },
       { id: 'sda', terminals: [
          { part: 'MCU', terminal: 'A4' },
          { part: 'RTC', terminal: 'sda' }] },
       { id: 'scl', terminals: [
          { part: 'MCU', terminal: 'A5' },
          { part: 'RTC', terminal: 'scl' }] }],
    );

    const hex = readFileSync(hexFile, 'utf8');
    const program = parseIntelHex(hex);
    const adapter = createAvr8jsAdapter({ chip: 'atmega328p' });
    adapter.loadProgram(program);
    adapter.attachBoard(board);

    // Collect serial output
    const serial = [];
    adapter.onSerial(b => serial.push(b));

    // Run 500ms of simulated time (DS3231 I2C is fast)
    adapter.advanceNs(500_000_000);

    console.log(`# RTClib: serial bytes=${serial.length}, pinChanges=${adapter.stats.pinChangeCount}`);

    // The sketch writes hour, minute, second to serial on success.
    // It also sets D13 HIGH. If the TWI bridge worked, we should see
    // serial output with the time we set (12:30:00).
    if (serial.length >= 3) {
      console.log(`#   hour=${serial[0]} min=${serial[1]} sec=${serial[2]}`);
      assert.strictEqual(serial[0], 12, 'hour should be 12');
      assert.strictEqual(serial[1], 30, 'minute should be 30');
      assert.strictEqual(serial[2], 0, 'second should be 0');
    } else {
      // At minimum, the sketch should have produced TWI transactions
      assert.ok(adapter.stats.pinChangeCount > 10,
        'sketch should have generated pin activity');
    }

    // Check DS3231 state
    const rtcState = board.getDeviceState('RTC');
    assert.ok(rtcState, 'RTC device state should exist');
    // After adjust(), OSF should be cleared
    assert.strictEqual(rtcState.osf, false,
      'OSF should be cleared after RTClib clears it');
  });
});

describe('TWI bridge: i2cdevlib MPU6050 via Wire on avr8js', () => {
  const hexFile = hexPath('mpu6050_demo');

  it('MPU6050 initialize + testConnection + getMotion6', {
    skip: !existsSync(hexFile) && 'mpu6050_demo.hex not built',
  }, async () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'MPU', kind: 'mpu6050', params: { orientation: 'flat' },
         terminals: ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'] },
       { id: 'MCU', kind: 'mcu', params: {},
         terminals: ['A4', 'A5', 'D13'] }],
      [{ id: 'vcc', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'MPU', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'MPU', terminal: 'gnd' },
          { part: 'MPU', terminal: 'ad0' }] },
       { id: 'sda', terminals: [
          { part: 'MCU', terminal: 'A4' },
          { part: 'MPU', terminal: 'sda' }] },
       { id: 'scl', terminals: [
          { part: 'MCU', terminal: 'A5' },
          { part: 'MPU', terminal: 'scl' }] }],
    );

    const hex = readFileSync(hexFile, 'utf8');
    const program = parseIntelHex(hex);
    const adapter = createAvr8jsAdapter({ chip: 'atmega328p' });
    adapter.loadProgram(program);
    adapter.attachBoard(board);

    const serial = [];
    adapter.onSerial(b => serial.push(b));

    // Run 500ms
    adapter.advanceNs(500_000_000);

    console.log(`# MPU6050: serial bytes=${serial.length}, pinChanges=${adapter.stats.pinChangeCount}`);

    // The sketch writes 6 bytes: ax_h, ax_l, ay_h, ay_l, az_h, az_l
    // For 'flat' orientation: ax=0, ay=0, az=1g → az = 16384 (0x4000)
    if (serial.length >= 6) {
      const ax = (serial[0] << 8) | serial[1];
      const ay = (serial[2] << 8) | serial[3];
      const az = (serial[4] << 8) | serial[5];
      console.log(`#   ax=${ax} ay=${ay} az=${az}`);
      // az should be ~16384 for flat orientation at ±2g (default FS_SEL=0)
      assert.ok(Math.abs(az - 16384) < 100,
        `az should be ~16384 for flat, got ${az}`);
      assert.ok(Math.abs(ax) < 100, `ax should be ~0 for flat, got ${ax}`);
      assert.ok(Math.abs(ay) < 100, `ay should be ~0 for flat, got ${ay}`);
    } else {
      assert.ok(adapter.stats.pinChangeCount > 10,
        'sketch should have generated pin activity');
    }

    // MPU6050 should be awake (sleep bit cleared by initialize())
    const mpuState = board.getDeviceState('MPU');
    assert.ok(mpuState, 'MPU device state should exist');
    assert.strictEqual(mpuState.regs[0x6b] & 0x40, 0,
      'MPU6050 should be awake after initialize()');
  });
});

describe('TWI bridge: Adafruit SSD1306 via Wire on avr8js', () => {
  const hexFile = hexPath('ssd1306_demo');

  it('SSD1306 begin + drawPixel + display flushes to framebuffer', {
    skip: !existsSync(hexFile) && 'ssd1306_demo.hex not built',
  }, async () => {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'OLED', kind: 'ssd1306', params: {},
         terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {},
         terminals: ['A4', 'A5', 'D13'] }],
      [{ id: 'vcc', terminals: [
          { part: 'VCC', terminal: 'vcc' },
          { part: 'OLED', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [
          { part: 'GND', terminal: 'gnd' },
          { part: 'OLED', terminal: 'gnd' }] },
       { id: 'sda', terminals: [
          { part: 'MCU', terminal: 'A4' },
          { part: 'OLED', terminal: 'sda' }] },
       { id: 'scl', terminals: [
          { part: 'MCU', terminal: 'A5' },
          { part: 'OLED', terminal: 'scl' }] }],
    );

    const hex = readFileSync(hexFile, 'utf8');
    const program = parseIntelHex(hex);
    const adapter = createAvr8jsAdapter({ chip: 'atmega328p' });
    adapter.loadProgram(program);
    adapter.attachBoard(board);

    // Run 2s — SSD1306 init is slow (many commands)
    adapter.advanceNs(2_000_000_000);

    console.log(`# SSD1306: pinChanges=${adapter.stats.pinChangeCount}`);

    const oledState = board.getDeviceState('OLED');
    assert.ok(oledState, 'OLED device state should exist');

    // Check if the display was turned on
    assert.strictEqual(oledState.displayOn, true,
      'display should be ON after begin()');

    // Check if charge pump was enabled (Adafruit library enables it for SSD1306_SWITCHCAPVCC)
    assert.strictEqual(oledState.chargePump, true,
      'charge pump should be enabled for SWITCHCAPVCC mode');

    // Check for pixels in the first 8 columns of page 0
    // The sketch draws 8 columns × 8 rows of white pixels
    let litPixels = 0;
    for (let x = 0; x < 8; x++) {
      for (let y = 0; y < 8; y++) {
        if (ssd1306Pixel(oledState, x, y)) litPixels++;
      }
    }
    console.log(`#   lit pixels in 8x8 block: ${litPixels}`);
    // Should have some pixels if display() was called
    assert.ok(litPixels > 0,
      `expected lit pixels in 8x8 block after display(), got ${litPixels}`);
  });
});
