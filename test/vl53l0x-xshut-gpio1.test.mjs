// VL53L0X XSHUT and GPIO1 — the two pins every breakout brings out and the
// model declared without ever driving or reading.
//
// XSHUT is the shutdown, and it is the ONLY way to run more than one sensor:
// every VL53L0X boots at 0x29, so the procedure is hold them all down,
// release one, give it a new address, release the next. A model that answers
// on the bus whatever XSHUT does makes that impossible to build or to teach —
// and it is the first thing anyone doing multi-zone ranging hits.
//
// GPIO1 is the ranging-complete interrupt. RESULT_INTERRUPT_STATUS already
// reported "new data ready"; the pin that saves the host from polling for it
// was stamped so it would not float, and otherwise inert.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const SYSRANGE_START = 0x00, SYSTEM_INTERRUPT_CLEAR = 0x0b;
const I2C_ADDR_REG = 0x8a, RANGE_MSB = 0x1e;

/**
 * One or two sensors on a bus, each with XSHUT driven from an MCU pin and
 * GPIO1 pulled up so the interrupt can be read as a real node.
 *
 * @param {number} n how many sensors
 * @param {boolean} wireXshut leave false to model a breakout whose XSHUT is
 *   not brought out to the bench at all
 */
function rig(n = 1, wireXshut = true) {
  const board = new BoardImpl(3.3);
  const parts = [
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'MCU', kind: 'mcu', params: {},
      terminals: ['sda', 'scl', 'x0', 'x1'] },
  ];
  const hi = [{ part: 'VCC', terminal: 'vcc' }];
  const lo = [{ part: 'GND', terminal: 'gnd' }];
  const sdaNet = [{ part: 'MCU', terminal: 'sda' }];
  const sclNet = [{ part: 'MCU', terminal: 'scl' }];
  const nets = [];

  for (let i = 0; i < n; i++) {
    const id = `U${i + 1}`;
    parts.push({ id, kind: 'vl53l0x', params: { distance_mm: 100 * (i + 1) },
      terminals: ['vcc', 'gnd', 'sda', 'scl', 'xshut', 'gpio1'] });
    parts.push({ id: `RG${i}`, kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] });
    hi.push({ part: id, terminal: 'vcc' }, { part: `RG${i}`, terminal: 'a' });
    lo.push({ part: id, terminal: 'gnd' });
    sdaNet.push({ part: id, terminal: 'sda' });
    sclNet.push({ part: id, terminal: 'scl' });
    nets.push({ id: `n_int${i}`, terminals: [
      { part: id, terminal: 'gpio1' }, { part: `RG${i}`, terminal: 'b' }] });
    if (wireXshut) {
      nets.push({ id: `n_x${i}`, terminals: [
        { part: 'MCU', terminal: `x${i}` }, { part: id, terminal: 'xshut' }] });
    }
  }
  nets.push({ id: 'nv', terminals: hi }, { id: 'ng', terminals: lo },
    { id: 'nsda', terminals: sdaNet }, { id: 'nscl', terminals: sclNet });
  board.setNetlist(parts, nets);

  let t = 0n;
  const tick = () => { t += 5_000n; board.advanceTo(t); };
  const sda = (h) => { board.setPin('sda', 'opendrain', h); tick(); };
  const scl = (h) => { board.setPin('scl', 'opendrain', h); tick(); };
  // XSHUT is driven push-pull, as a host GPIO does.
  for (let i = 0; i < n; i++) board.setPin(`x${i}`, 'pushpull', 1);
  sda(1); scl(1); tick();

  const start = () => { sda(1); scl(1); sda(0); scl(0); };
  const stop = () => { sda(0); scl(1); sda(1); };
  const writeByte = (b) => {
    for (let i = 7; i >= 0; i--) { sda((b >> i) & 1); scl(1); scl(0); }
    sda(1); scl(1); scl(0);
  };
  const readByte = () => {
    sda(1);
    let v = 0;
    for (let i = 7; i >= 0; i--) {
      scl(1);
      if (board.nodeVoltage('nsda') > 1.65) v |= 1 << i;
      scl(0);
    }
    sda(1); scl(1); scl(0);
    return v;
  };

  const api = {
    board,
    /** Power a sensor down (false) or release it (true). */
    enable(i, on) { board.setPin(`x${i}`, 'pushpull', on ? 1 : 0); tick(); tick(); return api; },
    write(addr, reg, v) { start(); writeByte(addr << 1); writeByte(reg); writeByte(v); stop(); return api; },
    read(addr, reg) { start(); writeByte(addr << 1); writeByte(reg); start(); writeByte((addr << 1) | 1); const v = readByte(); stop(); return v; },
    /** Does anything answer at this address? A dead bus reads 0xFF. */
    answers(addr) { return api.read(addr, 0xc0) === 0xee; },
    intLow: (i) => board.nodeVoltage(`n_int${i}`) < 1.65,
  };
  return api;
}

describe('VL53L0X XSHUT', () => {
  it('released, the sensor is on the bus', () => {
    const b = rig(1);
    assert.equal(b.answers(0x29), true, 'MODEL_ID reads back');
  });

  it('held LOW, it leaves the bus entirely', () => {
    // Not "returns zeroes" — it must not ACK at all, or holding one down
    // while you talk to its neighbour still collides.
    const b = rig(1);
    b.enable(0, false);
    assert.equal(b.answers(0x29), false, 'no reply while shut down');
  });

  it('and comes back when released', () => {
    const b = rig(1);
    b.enable(0, false);
    b.enable(0, true);
    assert.equal(b.answers(0x29), true);
  });

  it('shutdown is a RESET: the assigned address is forgotten', () => {
    // The half that makes the multi-sensor procedure honest. If shutdown
    // were a pause, re-addressing would survive it, the second sensor would
    // never need its own address, and a bench that skipped a step would
    // still appear to work.
    const b = rig(1);
    b.write(0x29, I2C_ADDR_REG, 0x30);
    assert.equal(b.answers(0x30), true, 're-addressed');
    b.enable(0, false).enable(0, true);
    assert.equal(b.answers(0x30), false, 'the new address did not survive');
    assert.equal(b.answers(0x29), true, 'it booted back at 0x29');
  });

  it('TWO sensors: the whole reason the pin exists', () => {
    // Both boot at 0x29. Hold both down, bring one up, move it, then bring
    // the other up — the standard procedure, and it cannot even be
    // expressed against a model that always answers.
    const b = rig(2);
    b.enable(0, false).enable(1, false);
    assert.equal(b.answers(0x29), false, 'bus quiet with both down');

    b.enable(0, true);
    b.write(0x29, I2C_ADDR_REG, 0x30);          // move the first one
    b.enable(1, true);                          // the second wakes at 0x29

    assert.equal(b.answers(0x30), true, 'first sensor at its new address');
    assert.equal(b.answers(0x29), true, 'second still at the default');
    // And they are different sensors: distance_mm was 100 and 200.
    b.write(0x30, SYSRANGE_START, 0x01);
    b.write(0x29, SYSRANGE_START, 0x01);
    assert.notEqual(b.read(0x30, RANGE_MSB) << 8 | b.read(0x30, RANGE_MSB + 1),
      b.read(0x29, RANGE_MSB) << 8 | b.read(0x29, RANGE_MSB + 1),
      'the two report their own ranges');
  });

  it('an UNWIRED xshut leaves the sensor running — breakouts pull it up', () => {
    // Backwards compatibility, asserted: every bench written before this pin
    // did anything wires four legs, and read() alone cannot tell "not
    // connected" from "held at 0 V".
    const b = rig(1, false);
    assert.equal(b.answers(0x29), true);
  });
});

describe('VL53L0X GPIO1', () => {
  it('idles released, so the pull-up holds it high', () => {
    const b = rig(1);
    assert.equal(b.intLow(0), false);
  });

  it('starting a range pulls it low when the measurement is ready', () => {
    const b = rig(1);
    b.write(0x29, SYSRANGE_START, 0x01);
    assert.equal(b.intLow(0), true, 'data ready is announced on the pin');
  });

  it('the interrupt-clear register releases it', () => {
    // Without an acknowledge the pin would stay low for the rest of the
    // bench and a second measurement would look identical to the first.
    const b = rig(1);
    b.write(0x29, SYSRANGE_START, 0x01);
    assert.equal(b.intLow(0), true);
    b.write(0x29, SYSTEM_INTERRUPT_CLEAR, 0x01);
    assert.equal(b.intLow(0), false, 'acknowledged');
  });

  it('it can fire again after being cleared', () => {
    const b = rig(1);
    b.write(0x29, SYSRANGE_START, 0x01);
    b.write(0x29, SYSTEM_INTERRUPT_CLEAR, 0x01);
    b.write(0x29, SYSRANGE_START, 0x01);
    assert.equal(b.intLow(0), true, 'a second measurement is reported');
  });

  it('a shut-down sensor drives nothing, interrupt included', () => {
    const b = rig(1);
    b.write(0x29, SYSRANGE_START, 0x01);
    assert.equal(b.intLow(0), true);
    b.enable(0, false);
    assert.equal(b.intLow(0), false, 'powered down means released');
  });

  it('two sensors interrupt independently', () => {
    const b = rig(2);
    b.enable(0, true).enable(1, false);
    b.write(0x29, SYSRANGE_START, 0x01);
    assert.equal(b.intLow(0), true, 'the running one fired');
    assert.equal(b.intLow(1), false, 'the shut-down one did not');
  });
});
