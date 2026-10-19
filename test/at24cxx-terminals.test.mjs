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

/**
 * Same rig, but each strap pin goes where you say. The default rig ties
 * A0-A2 and WP to GND, which is exactly the case where the strap logic is
 * INVISIBLE: a model that ignored the pins entirely passes every test that
 * only ever grounds them. Both mutations (address pins ignored, WP ignored)
 * survived the original suite. This is what kills them.
 */
function strappedRig(kind, straps = {}) {
  const board = new BoardImpl(5.0);
  const hi = (t) => straps[t] === 1;
  const toVcc = ['a0', 'a1', 'a2', 'wp'].filter(hi);
  const toGnd = ['a0', 'a1', 'a2', 'wp'].filter((t) => !hi(t));
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sda', 'scl'] },
    { id: 'E1', kind, params: {},
      terminals: ['a0', 'a1', 'a2', 'gnd', 'sda', 'scl', 'wp', 'vcc'] },
  ], [
    net('nv', ['VCC', 'vcc'], ['E1', 'vcc'], ...toVcc.map((t) => ['E1', t])),
    net('ng', ['GND', 'gnd'], ['E1', 'gnd'], ...toGnd.map((t) => ['E1', t])),
    net('n_sda', ['MCU', 'sda'], ['E1', 'sda']),
    net('n_scl', ['MCU', 'scl'], ['E1', 'scl']),
  ]);
  board.setPower(true);
  board.advanceTo(10_000n);          // let update() sample the straps
  return { board, handlers: board.getDeviceState('E1').i2cHandlers };
}

describe('AT24Cxx address straps and write-protect are ELECTRICAL', () => {
  for (const kind of ['at24c02', 'at24c64']) {
    it(`${kind}: A0 HIGH moves the device from 0x50 to 0x51`, () => {
      const { handlers } = strappedRig(kind, { a0: 1 });
      assert.equal(handlers.onAddress(0x51, 0), true, 'answers at 0x51');
      assert.equal(handlers.onAddress(0x50, 0), false, 'and no longer at 0x50');
    });

    it(`${kind}: A2A1A0 = 101 puts it at 0x55`, () => {
      const { handlers } = strappedRig(kind, { a0: 1, a2: 1 });
      assert.equal(handlers.onAddress(0x55, 0), true);
      assert.equal(handlers.onAddress(0x50, 0), false);
      assert.equal(handlers.onAddress(0x51, 0), false);
    });

    it(`${kind}: all three straps HIGH is 0x57, the top of the range`, () => {
      const { handlers } = strappedRig(kind, { a0: 1, a1: 1, a2: 1 });
      assert.equal(handlers.onAddress(0x57, 0), true);
      assert.equal(handlers.onAddress(0x50, 0), false);
    });
  }

  it('at24c02: WP HIGH discards the write at STOP — but still ACKs', () => {
    const wordAddr = (h) => { h.onWriteByte(0x00); };
    // Baseline: WP low, the byte lands.
    const open = strappedRig('at24c02', { wp: 0 });
    open.handlers.onAddress(0x50, 0); wordAddr(open.handlers);
    open.handlers.onWriteByte(0x42); open.handlers.onStop();
    open.handlers.onAddress(0x50, 0); wordAddr(open.handlers);
    open.handlers.onAddress(0x50, 1);
    assert.equal(open.handlers.onReadByte(), 0x42, 'WP low: byte written');

    // WP high: the device still answers, but the byte does not land.
    const prot = strappedRig('at24c02', { wp: 1 });
    assert.equal(prot.handlers.onAddress(0x50, 0), true,
      'a write-protected part still ACKs its address');
    wordAddr(prot.handlers);
    prot.handlers.onWriteByte(0x42);
    prot.handlers.onStop();
    prot.handlers.onAddress(0x50, 0); wordAddr(prot.handlers);
    prot.handlers.onAddress(0x50, 1);
    assert.equal(prot.handlers.onReadByte(), 0xff,
      'WP high: the write was discarded, erased 0xFF stands');
  });
});

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
