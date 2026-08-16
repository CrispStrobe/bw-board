/**
 * USI bridge tests — ATtiny85 USI-based I2C master.
 *
 * Golden sequence: the classic TinyWireM master pattern from the ATtiny85
 * datasheet §15.3.4 "Two-wire Mode". The firmware:
 *   1. Generates START (pull SDA low while SCL high)
 *   2. Loads address byte into USIDR
 *   3. Clears counter (write 0xF0 to USISR — clears flags, sets counter=0)
 *   4. Toggles USITC 16 times (USICR = 0x2B: USIWM1|USICS1|USICLK|USITC)
 *      → counter overflows after 16 toggles = 8 bits shifted
 *   5. Reads ACK bit (set counter to 14 = 0x0E, toggle 2 times for 1 bit)
 *   6. For write: loads data into USIDR, repeats shift; for read: loads 0xFF
 *   7. STOP: release SDA after SCL goes high
 *
 * We drive the USI registers directly (simulating what compiled TinyWireM
 * code does) and verify that bytes arrive at the board's I2C device handlers.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createAvr8jsAdapter, CHIPS } from '../src/avr8js-adapter.js';
import { createUSIBridge } from '../src/usi-bridge.js';
import { BoardImpl } from '../src/board.js';
import { registerSSD1306 } from '../src/devices/ssd1306.js';
import { registerBoardICs } from '../src/devices/board-ics.js';

try { registerSSD1306(); } catch {}
try { registerBoardICs(); } catch {}

// USI register addresses (ATtiny85)
const USIDR = 0x2F;
const USISR = 0x2E;
const USICR = 0x2D;

// USICR value for two-wire mode, software clock strobe + toggle:
// USIWM1=1, USICS1=1, USICLK=1, USITC=1 → 0b0010_1011 = 0x2B
const USI_SHIFT_TOGGLE = 0x2B;
// Same without USITC (just write the mode)
const USI_MODE_TWI = 0x2A;

/**
 * Simulate the TinyWireM "transfer 8 bits" sequence:
 *   - Write data to USIDR
 *   - Clear flags + set counter to 0 (USISR = 0xF0: clear flags, cnt=0)
 *   - Toggle USITC 16 times → 8 bits shifted, counter overflows
 *   - Return USIDR (the byte shifted in from slave)
 */
function usiTransfer8(cpu, dataByte) {
  cpu.writeData(USIDR, dataByte);
  // Clear overflow flag, set counter=0 → need 16 toggles to overflow
  cpu.writeData(USISR, (1 << 6) | 0x00); // clear USIOIF, counter=0
  for (let i = 0; i < 16; i++) {
    cpu.writeData(USICR, USI_SHIFT_TOGGLE);
  }
  return cpu.readData(USIDR);
}

/**
 * Transfer 1 bit (ACK/NACK clock). Counter starts at 0x0E → 2 toggles.
 * dataByte: 0xFF to read slave's ACK, or 0x00 to send master ACK.
 */
function usiTransfer1(cpu, dataByte) {
  cpu.writeData(USIDR, dataByte);
  // Clear overflow flag, set counter=14 → need 2 toggles to overflow
  cpu.writeData(USISR, (1 << 6) | 0x0E);
  cpu.writeData(USICR, USI_SHIFT_TOGGLE);
  cpu.writeData(USICR, USI_SHIFT_TOGGLE);
  return cpu.readData(USIDR);
}

/**
 * Signal START condition: firmware acknowledges start by writing 1 to USISIF.
 * In real TinyWireM: pull SDA low while SCL high, then write USISIF to clear.
 */
function usiStart(cpu) {
  // Writing 1 to USISIF clears it and triggers startCondition() in bridge
  cpu.writeData(USISR, 0xF0); // USISIF=1 → triggers start, clear other flags, counter=0
}

/**
 * Full I2C write transaction via USI.
 */
function usiI2CWrite(cpu, addr7, bytes) {
  usiStart(cpu);
  // Send address byte (8-bit transfer)
  usiTransfer8(cpu, (addr7 << 1) | 0);
  // Clock ACK bit (1-bit transfer, release SDA with 0xFF)
  const ackBit = usiTransfer1(cpu, 0xFF);
  const results = [{ ack: (ackBit & 0x80) === 0 }];

  for (const b of bytes) {
    usiTransfer8(cpu, b);
    const dAck = usiTransfer1(cpu, 0xFF);
    results.push({ ack: (dAck & 0x80) === 0, sent: b });
  }
  return results;
}

/**
 * Full I2C read transaction via USI.
 */
function usiI2CRead(cpu, addr7, count) {
  usiStart(cpu);
  // Send address byte with R bit
  usiTransfer8(cpu, (addr7 << 1) | 1);
  const ackBit = usiTransfer1(cpu, 0xFF);
  const addressed = (ackBit & 0x80) === 0;

  const data = [];
  for (let i = 0; i < count; i++) {
    // Release SDA (0xFF), shift 8 bits → read device byte
    const val = usiTransfer8(cpu, 0xFF);
    data.push(val);
    // Master sends ACK (0x00) for all but last, NACK (0xFF) for last
    usiTransfer1(cpu, i < count - 1 ? 0x00 : 0xFF);
  }
  return { addressed, data };
}

// =====================================================================
// Unit tests: USI bridge register-level
// =====================================================================
describe('USI bridge: register-level mechanics', () => {

  it('adapter creates usiBridge for ATtiny85, not for ATmega328P', () => {
    const t85 = createAvr8jsAdapter({ chip: 'attiny85' });
    assert.ok(t85.usiBridge, 'ATtiny85 should have USI bridge');

    const m328 = createAvr8jsAdapter({ chip: 'atmega328p' });
    assert.strictEqual(m328.usiBridge, null, 'ATmega328P should not have USI bridge');
  });

  it('USIDR read/write round-trips', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    adapter.cpu.writeData(USIDR, 0xA5);
    assert.strictEqual(adapter.cpu.readData(USIDR), 0xA5);
  });

  it('USISR counter can be loaded and read back', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    // Write counter = 5, clear flags
    adapter.cpu.writeData(USISR, 0x05);
    const val = adapter.cpu.readData(USISR);
    assert.strictEqual(val & 0x0F, 5, 'counter should be 5');
  });

  it('16 USITC toggles cause counter overflow (USIOIF set)', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    // Set two-wire mode, clear counter
    adapter.cpu.writeData(USISR, 0xF0); // clear flags, counter=0
    for (let i = 0; i < 16; i++) {
      adapter.cpu.writeData(USICR, USI_SHIFT_TOGGLE);
    }
    const sr = adapter.cpu.readData(USISR);
    assert.ok(sr & 0x40, 'USIOIF should be set after 16 toggles');
  });

  it('counter does not overflow after only 14 toggles', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    adapter.cpu.writeData(USISR, 0xF0);
    for (let i = 0; i < 14; i++) {
      adapter.cpu.writeData(USICR, USI_SHIFT_TOGGLE);
    }
    const sr = adapter.cpu.readData(USISR);
    assert.strictEqual(sr & 0x40, 0, 'USIOIF should NOT be set after 14 toggles');
    assert.strictEqual(sr & 0x0F, 14, 'counter should be 14');
  });
});

// =====================================================================
// Protocol tests: AT24C02 EEPROM via USI
// =====================================================================
describe('USI bridge: AT24C02 EEPROM write+read via USI-TWI master', () => {

  function makeBoard() {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'EE', kind: 'at24c02', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P0', 'P2'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'EE', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'EE', terminal: 'gnd' }] },
       { id: 'sda', terminals: [{ part: 'MCU', terminal: 'P0' }, { part: 'EE', terminal: 'sda' }] },
       { id: 'scl', terminals: [{ part: 'MCU', terminal: 'P2' }, { part: 'EE', terminal: 'scl' }] }],
    );
    return board;
  }

  it('writes a byte to AT24C02 at address 0x50 and reads it back', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    const board = makeBoard();
    adapter.attachBoard(board);

    // Write: START → [0x50 W] → addr=0x10 → data=0xBE → STOP
    const writeResult = usiI2CWrite(adapter.cpu, 0x50, [0x10, 0xBE]);
    assert.ok(writeResult[0].ack, 'AT24C02 should ACK address 0x50');
    assert.ok(writeResult[1].ack, 'AT24C02 should ACK address byte');
    assert.ok(writeResult[2].ack, 'AT24C02 should ACK data byte');

    // STOP
    adapter.usiBridge.stopCondition();

    // Read back: write address pointer, then read
    const setPtr = usiI2CWrite(adapter.cpu, 0x50, [0x10]);
    assert.ok(setPtr[0].ack, 'AT24C02 should ACK for pointer set');
    adapter.usiBridge.stopCondition();

    // Repeated START → read
    const readResult = usiI2CRead(adapter.cpu, 0x50, 1);
    assert.ok(readResult.addressed, 'AT24C02 should ACK read address');
    assert.strictEqual(readResult.data[0], 0xBE, 'should read back 0xBE');

    adapter.usiBridge.stopCondition();
  });

  it('NACKs when no device at address 0x30', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    const board = makeBoard();
    adapter.attachBoard(board);

    usiStart(adapter.cpu);
    usiTransfer8(adapter.cpu, (0x30 << 1) | 0); // addr=0x30, write
    const ackBit = usiTransfer1(adapter.cpu, 0xFF);
    // NACK: bit 7 should be high
    assert.ok(ackBit & 0x80, 'should NACK for non-existent address 0x30');
  });

  it('multi-byte sequential write to AT24C02', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    const board = makeBoard();
    adapter.attachBoard(board);

    // Write 4 bytes starting at address 0x00
    const result = usiI2CWrite(adapter.cpu, 0x50, [0x00, 0xCA, 0xFE, 0xBA, 0xBE]);
    for (let i = 0; i < result.length; i++) {
      assert.ok(result[i].ack, `byte ${i} should be ACKed`);
    }
    adapter.usiBridge.stopCondition();

    // Read back all 4
    usiI2CWrite(adapter.cpu, 0x50, [0x00]); // set pointer
    adapter.usiBridge.stopCondition();

    const read = usiI2CRead(adapter.cpu, 0x50, 4);
    assert.deepStrictEqual(read.data, [0xCA, 0xFE, 0xBA, 0xBE]);
    adapter.usiBridge.stopCondition();
  });
});

// =====================================================================
// Protocol tests: SSD1306 OLED via USI
// =====================================================================
describe('USI bridge: SSD1306 OLED commands via USI-TWI master', () => {

  function makeOLEDBoard() {
    const board = new BoardImpl(5.0);
    board.setNetlist(
      [{ id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
       { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
       { id: 'OLED', kind: 'ssd1306', params: {}, terminals: ['vcc', 'gnd', 'sda', 'scl'] },
       { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P0', 'P2'] }],
      [{ id: 'vcc', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'OLED', terminal: 'vcc' }] },
       { id: 'gnd', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'OLED', terminal: 'gnd' }] },
       { id: 'sda', terminals: [{ part: 'MCU', terminal: 'P0' }, { part: 'OLED', terminal: 'sda' }] },
       { id: 'scl', terminals: [{ part: 'MCU', terminal: 'P2' }, { part: 'OLED', terminal: 'scl' }] }],
    );
    return board;
  }

  it('sends display-ON command to SSD1306 at 0x3C', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    const board = makeOLEDBoard();
    adapter.attachBoard(board);

    // SSD1306 command: control byte 0x00 (Co=0, D/C#=0), then command 0xAF
    const result = usiI2CWrite(adapter.cpu, 0x3C, [0x00, 0xAF]);
    assert.ok(result[0].ack, 'SSD1306 should ACK address 0x3C');
    adapter.usiBridge.stopCondition();

    const state = board.getDeviceState('OLED');
    assert.ok(state, 'OLED device state should exist');
    assert.strictEqual(state.displayOn, true, 'display should be ON after 0xAF');
  });

  it('sends charge pump enable + display ON sequence', () => {
    const adapter = createAvr8jsAdapter({ chip: 'attiny85' });
    const board = makeOLEDBoard();
    adapter.attachBoard(board);

    // Charge pump enable: 0x8D, 0x14
    usiI2CWrite(adapter.cpu, 0x3C, [0x00, 0x8D, 0x14]);
    adapter.usiBridge.stopCondition();

    // Display ON
    usiI2CWrite(adapter.cpu, 0x3C, [0x00, 0xAF]);
    adapter.usiBridge.stopCondition();

    const state = board.getDeviceState('OLED');
    assert.strictEqual(state.chargePump, true, 'charge pump should be enabled');
    assert.strictEqual(state.displayOn, true, 'display should be ON');
  });
});
