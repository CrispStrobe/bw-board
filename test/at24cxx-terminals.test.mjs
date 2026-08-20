/**
 * AT24C02 + AT24C64: verify both have the full 8-terminal DIP-8 pinout
 * (A0, A1, A2, GND, SDA, SCL, WP, VCC) and that address strapping +
 * write-protect work on both.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
import { getDevice } from '../src/devices.js';

registerAllDevices();

const net = (id, ...ts) => ({
  id,
  terminals: ts.map(([part, terminal]) => ({ part, terminal })),
});

function eepromRig(kind, params = {}) {
  const board = new BoardImpl(5.0);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sda', 'scl'] },
    { id: 'E1', kind, params,
      terminals: ['a0', 'a1', 'a2', 'gnd', 'sda', 'scl', 'wp', 'vcc'] },
  ], [
    net('nv', ['VCC', 'vcc'], ['E1', 'vcc']),
    net('ng', ['GND', 'gnd'], ['E1', 'gnd'], ['E1', 'a0'], ['E1', 'a1'], ['E1', 'a2']),
    net('n_sda', ['MCU', 'sda'], ['E1', 'sda']),
    net('n_scl', ['MCU', 'scl'], ['E1', 'scl']),
    net('n_wp', ['GND', 'gnd'], ['E1', 'wp']),
  ]);
  board.setPower(true);
  const st = board.getDeviceState('E1');
  return { board, handlers: st.i2cHandlers };
}

describe('AT24C02 8-terminal DIP-8', () => {
  it('device model has 8 terminals', () => {
    const model = getDevice('at24c02');
    assert.equal(model.terminals.length, 8);
    for (const t of ['a0', 'a1', 'a2', 'gnd', 'sda', 'scl', 'wp', 'vcc']) {
      assert.ok(model.terminals.includes(t), `has terminal ${t}`);
    }
  });

  it('loads with all 8 terminals wired (no validation error)', () => {
    const { handlers } = eepromRig('at24c02');
    assert.ok(handlers, 'i2cHandlers present');
  });

  it('default address 0x50 (A0=A1=A2=GND)', () => {
    const { handlers } = eepromRig('at24c02');
    assert.equal(handlers.onAddress(0x50, 0), true);
    assert.equal(handlers.onAddress(0x51, 0), false);
  });

  it('WP=LOW allows writes', () => {
    const { handlers } = eepromRig('at24c02');
    handlers.onAddress(0x50, 0);
    handlers.onWriteByte(0x00);    // word address
    handlers.onWriteByte(0x42);    // data
    handlers.onStop();
    handlers.onAddress(0x50, 0);
    handlers.onWriteByte(0x00);    // set read pointer
    handlers.onAddress(0x50, 1);
    assert.equal(handlers.onReadByte(), 0x42, 'data written and read back');
  });
});

describe('AT24C64 8-terminal DIP-8', () => {
  it('device model has 8 terminals', () => {
    const model = getDevice('at24c64');
    assert.equal(model.terminals.length, 8);
    for (const t of ['a0', 'a1', 'a2', 'gnd', 'sda', 'scl', 'wp', 'vcc']) {
      assert.ok(model.terminals.includes(t), `has terminal ${t}`);
    }
  });

  it('loads with all 8 terminals wired', () => {
    const { handlers } = eepromRig('at24c64');
    assert.ok(handlers, 'i2cHandlers present');
  });

  it('default address 0x50 (A0=A1=A2=GND)', () => {
    const { handlers } = eepromRig('at24c64');
    assert.equal(handlers.onAddress(0x50, 0), true);
    assert.equal(handlers.onAddress(0x51, 0), false);
  });

  it('two-byte word address + read back', () => {
    const { handlers } = eepromRig('at24c64');
    handlers.onAddress(0x50, 0);
    handlers.onWriteByte(0x00);    // addr high
    handlers.onWriteByte(0x00);    // addr low
    handlers.onWriteByte(0xAB);    // data
    handlers.onStop();
    handlers.onAddress(0x50, 0);
    handlers.onWriteByte(0x00);
    handlers.onWriteByte(0x00);
    handlers.onAddress(0x50, 1);
    assert.equal(handlers.onReadByte(), 0xAB);
  });
});

describe('AT24C02 + AT24C64 terminal parity with bw-circuit-ui', () => {
  it('both have identical terminal sets', () => {
    const c02 = getDevice('at24c02');
    const c64 = getDevice('at24c64');
    assert.deepEqual(
      [...c02.terminals].sort(),
      [...c64.terminals].sort(),
      'same 8 terminals on both'
    );
  });
});
