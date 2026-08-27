// PCF8574 address straps — A0, A1, A2.
//
// They are why the chip has sixteen pins, and the model did not have them:
// it answered at one address, so two expanders could not share a bus, which
// is most of what a port expander is for.
//
// The test that matters is the LAST one. A model that ignores the straps
// still passes "writes to 0x20 land", because 0x20 is the default — it only
// fails when a second chip is strapped elsewhere and both answer at once.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const PINS = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];

/**
 * Two expanders on one bus. `straps` is [a2, a1, a0] per chip, each pin tied
 * hard to a rail — which is how a real board sets them.
 */
function bus(strapsA, strapsB, paramsA = {}, paramsB = {}) {
  const board = new BoardImpl(5.0);
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'R1', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'R2', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P2.1', 'P2.2'] },
  ];
  const hi = [{ part: 'VCC', terminal: 'vcc' }, { part: 'R1', terminal: 'a' }, { part: 'R2', terminal: 'a' }];
  const lo = [{ part: 'GND', terminal: 'gnd' }];
  const sdaNet = [{ part: 'MCU', terminal: 'P2.1' }, { part: 'R1', terminal: 'b' }];
  const sclNet = [{ part: 'MCU', terminal: 'P2.2' }, { part: 'R2', terminal: 'b' }];
  const nets = [];

  for (const [id, straps, params] of [['U1', strapsA, paramsA], ['U2', strapsB, paramsB]]) {
    parts.push({ id, kind: 'pcf8574', params,
      terminals: ['sda', 'scl', 'vcc', 'gnd', ...PINS, 'int', 'a0', 'a1', 'a2'] });
    hi.push({ part: id, terminal: 'vcc' });
    lo.push({ part: id, terminal: 'gnd' });
    sdaNet.push({ part: id, terminal: 'sda' });
    sclNet.push({ part: id, terminal: 'scl' });
    const [a2, a1, a0] = straps;
    [['a0', a0], ['a1', a1], ['a2', a2]].forEach(([pin, v]) => (v ? hi : lo).push({ part: id, terminal: pin }));
    for (const p of PINS) nets.push({ id: `n_${id}_${p}`, terminals: [{ part: id, terminal: p }] });
  }
  nets.push({ id: 'nv', terminals: hi }, { id: 'ng', terminals: lo },
    { id: 'nsda', terminals: sdaNet }, { id: 'nscl', terminals: sclNet });
  board.setNetlist(parts, nets);

  let t = 0n;
  const tick = () => { t += 5_000n; board.advanceTo(t); };
  const sda = (h) => { board.setPin('P2.1', 'opendrain', h); tick(); };
  const scl = (h) => { board.setPin('P2.2', 'opendrain', h); tick(); };
  const start = () => { sda(1); scl(1); sda(0); scl(0); };
  const stop = () => { sda(0); scl(1); sda(1); };
  const writeByte = (b) => {
    for (let i = 7; i >= 0; i--) { sda((b >> i) & 1); scl(1); scl(0); }
    sda(1); scl(1); scl(0);          // ACK slot
  };
  return {
    /** One I2C write of `data` to 7-bit address `addr`. */
    send(addr, data) { start(); writeByte(addr << 1); writeByte(data); stop(); },
    /** The eight port pins of one chip, as a byte. */
    port(id) {
      return PINS.reduce((acc, p, i) =>
        acc + (board.nodeVoltage(`n_${id}_${p}`) > 2.5 ? 1 << i : 0), 0);
    },
  };
}

describe('PCF8574 address straps', () => {
  it('unstrapped, it answers at 0x20 — the address it always did', () => {
    const b = bus([0, 0, 0], [0, 0, 0]);
    b.send(0x20, 0x00);
    assert.equal(b.port('U1'), 0x00, 'the write landed');
  });

  it('a strap moves the address, and the old one stops working', () => {
    const b = bus([0, 0, 1], [0, 0, 0]);   // U1 strapped A0 high -> 0x21
    b.send(0x21, 0x00);
    assert.equal(b.port('U1'), 0x00, 'U1 answers at 0x21');

    const c = bus([0, 0, 1], [0, 0, 0]);
    c.send(0x20, 0x00);
    assert.equal(c.port('U1'), 0xFF, 'and ignores 0x20 — its pins stay at the idle high');
  });

  it('all eight addresses are reachable', () => {
    for (let n = 0; n < 8; n++) {
      const straps = [(n >> 2) & 1, (n >> 1) & 1, n & 1];
      const b = bus(straps, [1, 1, 1]);    // the other chip parked at 0x27
      b.send(0x20 | n, 0x00);
      assert.equal(b.port('U1'), 0x00, `strapped ${n.toString(2).padStart(3, '0')} -> 0x${(0x20 | n).toString(16)}`);
    }
  });

  it('two expanders share the bus and only the addressed one moves', () => {
    // The whole point of the pins, and the only test a strap-ignoring model
    // cannot pass: with both at 0x20 it would drive BOTH ports.
    const b = bus([0, 0, 0], [0, 0, 1]);   // U1 at 0x20, U2 at 0x21
    b.send(0x20, 0x0F);
    assert.equal(b.port('U1'), 0x0F, 'U1 took the write');
    assert.equal(b.port('U2'), 0xFF, 'U2 did not');

    b.send(0x21, 0xF0);
    assert.equal(b.port('U2'), 0xF0, 'U2 took its own');
    assert.equal(b.port('U1'), 0x0F, 'and U1 kept what it had');
  });

  it('an explicit params.address still wins, for circuits that set one', () => {
    // Backwards compatibility: a bench that chose an address before the
    // straps existed must keep it, straps or no straps.
    const b = bus([1, 1, 1], [0, 0, 0], { address: 0x24 });
    b.send(0x24, 0x00);
    assert.equal(b.port('U1'), 0x00, 'the param decided, not the pins');
  });
});
