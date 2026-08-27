// PCF8574 as an INPUT expander, and the INT pin that makes it worth using.
//
// The model could only be written to. Its I2C decoder sampled SDA and never
// drove it, so there was no way for a reading master to get a byte back: the
// half of the part that reads buttons did not exist. And INT — the pin that
// says "something changed, come and look" — appeared exactly once in the
// whole device, in the terminals list. Declared, never stamped, never driven.
//
// Both halves are the same feature. Reading is how you use an expander for
// buttons; INT is how you do it without polling the bus forever.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const PINS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

/**
 * One expander with a bit-banged master, two buttons on p0/p1, and INT
 * pulled up so it can be read as a real node.
 *
 * The "buttons" are MCU open-drain pins: pulled low is pressed, released
 * lets the expander's own weak pull-up win — which is exactly how a button
 * to ground behaves against a quasi-bidirectional port.
 */
function bus({ address } = {}) {
  const board = new BoardImpl(5.0);
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'R3', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {},
      terminals: ['P2.1', 'P2.2', 'P1.0', 'P1.1'] },
    { id: 'U1', kind: 'pcf8574', params: address === undefined ? {} : { address },
      terminals: ['sda', 'scl', 'vcc', 'gnd', ...PINS, 'int', 'a0', 'a1', 'a2'] },
  ];
  const nets = [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'U1', terminal: 'vcc' },
      { part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }, { part: 'R3', terminal: 'a' }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' }, { part: 'U1', terminal: 'gnd' },
      { part: 'U1', terminal: 'a0' }, { part: 'U1', terminal: 'a1' }, { part: 'U1', terminal: 'a2' }] },
    { id: 'nsda', terminals: [{ part: 'MCU', terminal: 'P2.1' }, { part: 'U1', terminal: 'sda' },
      { part: 'R1', terminal: 'b' }] },
    { id: 'nscl', terminals: [{ part: 'MCU', terminal: 'P2.2' }, { part: 'U1', terminal: 'scl' },
      { part: 'R2', terminal: 'b' }] },
    { id: 'nint', terminals: [{ part: 'U1', terminal: 'int' }, { part: 'R3', terminal: 'b' }] },
    { id: 'nbtn0', terminals: [{ part: 'MCU', terminal: 'P1.0' }, { part: 'U1', terminal: 'p0' }] },
    { id: 'nbtn1', terminals: [{ part: 'MCU', terminal: 'P1.1' }, { part: 'U1', terminal: 'p1' }] },
  ];
  for (let i = 2; i < 8; i++) {
    nets.push({ id: `n_p${i}`, terminals: [{ part: 'U1', terminal: `p${i}` }] });
  }
  board.setNetlist(parts, nets);

  let t = 0n;
  const tick = () => { t += 5_000n; board.advanceTo(t); };
  const sda = (h) => { board.setPin('P2.1', 'opendrain', h); tick(); };
  const scl = (h) => { board.setPin('P2.2', 'opendrain', h); tick(); };

  // Buttons start released.
  board.setPin('P1.0', 'opendrain', 1);
  board.setPin('P1.1', 'opendrain', 1);
  sda(1); scl(1);

  const start = () => { sda(1); scl(1); sda(0); scl(0); };
  const stop = () => { sda(0); scl(1); sda(1); };
  const writeByte = (b) => {
    for (let i = 7; i >= 0; i--) { sda((b >> i) & 1); scl(1); scl(0); }
    sda(1); scl(1); scl(0);                       // ACK slot: slave pulls low
  };
  /** Clock in eight bits the SLAVE drives, then NACK. */
  const readByte = () => {
    sda(1);                                       // master releases the line
    let v = 0;
    for (let i = 7; i >= 0; i--) {
      scl(1);
      if (board.nodeVoltage('nsda') > 2.5) v |= 1 << i;
      scl(0);
    }
    sda(1); scl(1); scl(0);                       // NACK
    return v;
  };

  const api = {
    board,
    /** Press (true) or release a button on p0/p1. */
    press(n, down) { board.setPin(`P1.${n}`, 'opendrain', down ? 0 : 1); tick(); tick(); return api; },
    write(addr, data) { start(); writeByte(addr << 1); writeByte(data); stop(); return api; },
    read(addr) { start(); writeByte((addr << 1) | 1); const v = readByte(); stop(); return v; },
    /** INT as wired: LOW = asserted. */
    intLow: () => board.nodeVoltage('nint') < 2.5,
  };
  return api;
}

describe('PCF8574 reading its inputs', () => {
  it('an idle port reads all ones', () => {
    // Quasi-bidirectional: nothing pressed, so every weak pull-up wins.
    const b = bus();
    assert.equal(b.read(0x20), 0xFF);
  });

  it('a button pulling p0 down shows up in the read', () => {
    // The whole input half, and it returned nothing at all before: the
    // decoder sampled SDA and never drove it, so a reading master clocked
    // eight bits out of an undriven line.
    const b = bus();
    b.press(0, true);
    assert.equal(b.read(0x20), 0xFE, 'p0 low, the rest pulled up');
  });

  it('two buttons read independently', () => {
    const b = bus();
    b.press(0, true).press(1, true);
    assert.equal(b.read(0x20), 0xFC);
    b.press(0, false);
    assert.equal(b.read(0x20), 0xFD, 'releasing one leaves the other');
  });

  it('a pin the master drove LOW reads back low, whatever is outside', () => {
    // A latched 0 is a strong low: it is an OUTPUT now, and an input read of
    // it reports the latch, not a button that cannot overcome it.
    const b = bus();
    b.write(0x20, 0xFE);              // p0 driven low
    assert.equal(b.read(0x20) & 0x01, 0, 'p0 reads its own low');
  });

  it('only the addressed expander answers a read', () => {
    // A first draft asserted 0x00 here and was wrong about the hardware, not
    // about the model: when nobody drives SDA the bus pull-up holds it high
    // and the master clocks in 0xFF. That also means "all ones" cannot tell
    // "nobody answered" from "an idle port", so the button is what makes this
    // test discriminate — the real port reads 0xFE, and the wrong address
    // must NOT produce it.
    const b = bus();
    b.press(0, true);
    assert.equal(b.read(0x20), 0xFE, 'the right address reports the button');
    assert.equal(b.read(0x21), 0xFF,
      'the wrong one leaves the bus to its pull-up — not the port contents');
  });
});

describe('PCF8574 INT', () => {
  it('idles released, so the pull-up holds the line high', () => {
    const b = bus();
    b.read(0x20);                      // acknowledge the power-on state
    assert.equal(b.intLow(), false);
  });

  it('a button press pulls INT low without the master asking', () => {
    // The reason to wire the pin: the master learns something changed
    // without polling the bus.
    const b = bus();
    b.read(0x20);
    b.press(0, true);
    assert.equal(b.intLow(), true, 'INT asserted on the change');
  });

  it('reading the port releases INT', () => {
    const b = bus();
    b.read(0x20);
    b.press(0, true);
    assert.equal(b.intLow(), true);
    assert.equal(b.read(0x20), 0xFE, 'and the read reports the change');
    assert.equal(b.intLow(), false, 'acknowledged');
  });

  it('RELEASING a button also asserts INT — a change is a change', () => {
    // Easy to model only the press. A keypad that reports key-down and never
    // key-up looks like a stuck key.
    const b = bus();
    b.press(0, true);
    b.read(0x20);                      // acknowledge the press
    assert.equal(b.intLow(), false);
    b.press(0, false);
    assert.equal(b.intLow(), true, 'the release is an event too');
  });

  it('a write acknowledges as well as a read', () => {
    const b = bus();
    b.read(0x20);
    b.press(0, true);
    assert.equal(b.intLow(), true);
    b.write(0x20, 0xFF);
    assert.equal(b.intLow(), false, 'any access clears it');
  });

  it('INT stays asserted while the change is unread', () => {
    // It is a level, not a pulse: a master that is busy must still find it
    // low when it finally looks.
    const b = bus();
    b.read(0x20);
    b.press(0, true);
    for (let i = 0; i < 5; i++) b.press(1, false);   // time passes, no bus access
    assert.equal(b.intLow(), true, 'still asserted');
  });
});
