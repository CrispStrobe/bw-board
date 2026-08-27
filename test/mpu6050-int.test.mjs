// MPU-6050 INT — the pin that exists so you do not poll a 6-axis sensor over
// I2C at the sample rate. It was declared from the day the part was written
// and never driven, so it could be wired and did nothing.
//
// The interesting part is not "it goes high". It is that the HOST chooses how
// it goes high, via two bits in INT_PIN_CFG (0x37), and getting them backwards
// is the classic MPU-6050 wiring fault:
//
//   bit 7 ACTL — 1 = active LOW      (default 0: active HIGH)
//   bit 6 OPEN — 1 = open drain      (default 0: push-pull)
//
// Defaults are active-high push-pull, which is why a tutorial that ties INT to
// a pull-up and waits for a falling edge sees nothing until it sets ACTL.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BoardImpl } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';

registerAllDevices();

const INT_PIN_CFG = 0x37, INT_ENABLE = 0x38, PWR_MGMT_1 = 0x6b;
const DATA_RDY_EN = 0x01, ACTL = 0x80, OPEN = 0x40;

/** One IMU with INT pulled up through 4k7, so open-drain has something to pull. */
function rig() {
  const board = new BoardImpl(3.3);
  board.setNetlist([
    { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
    { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] },
    { id: 'MCU', kind: 'mcu', params: {}, terminals: ['sda', 'scl'] },
    { id: 'RP', kind: 'resistor', params: { ohms: 4700 }, terminals: ['a', 'b'] },
    { id: 'U1', kind: 'mpu6050', params: {},
      terminals: ['vcc', 'gnd', 'sda', 'scl', 'ad0', 'int'] },
  ], [
    { id: 'nv', terminals: [{ part: 'VCC', terminal: 'vcc' },
      { part: 'U1', terminal: 'vcc' }, { part: 'RP', terminal: 'a' }] },
    { id: 'ng', terminals: [{ part: 'GND', terminal: 'gnd' },
      { part: 'U1', terminal: 'gnd' }, { part: 'U1', terminal: 'ad0' }] },
    { id: 'nsda', terminals: [{ part: 'MCU', terminal: 'sda' }, { part: 'U1', terminal: 'sda' }] },
    { id: 'nscl', terminals: [{ part: 'MCU', terminal: 'scl' }, { part: 'U1', terminal: 'scl' }] },
    { id: 'nint', terminals: [{ part: 'RP', terminal: 'b' }, { part: 'U1', terminal: 'int' }] },
  ]);
  board.setPower(true);

  let t = 0n;
  const tick = () => { t += 5_000n; board.advanceTo(t); };
  const sda = (h) => { board.setPin('sda', 'opendrain', h); tick(); };
  const scl = (h) => { board.setPin('scl', 'opendrain', h); tick(); };
  sda(1); scl(1); tick();

  const writeByte = (b) => {
    for (let i = 7; i >= 0; i--) { sda((b >> i) & 1); scl(1); scl(0); }
    sda(1); scl(1); scl(0);
  };
  const api = {
    board,
    write(reg, v) {
      sda(1); scl(1); sda(0); scl(0);          // START
      writeByte(0x68 << 1); writeByte(reg); writeByte(v);
      sda(0); scl(1); sda(1);                   // STOP
      tick(); tick();
      return api;
    },
    /** Wake the part; it powers on asleep, which is the other classic trap. */
    wake() { return api.write(PWR_MGMT_1, 0x00); },
    volts: () => board.nodeVoltage('nint'),
    high: () => board.nodeVoltage('nint') > 1.65,
  };
  return api;
}

describe('MPU-6050 INT, default polarity (active high, push-pull)', () => {
  it('idles LOW before the interrupt is enabled', () => {
    // Push-pull holds the inactive level rather than releasing, so the 4k7
    // pull-up does NOT win. That is the difference from open-drain and it is
    // visible right here at idle.
    const r = rig().wake();
    assert.equal(r.high(), false, `idle should be driven low, got ${r.volts().toFixed(2)} V`);
  });

  it('goes HIGH once DATA_RDY_EN is set', () => {
    const r = rig().wake().write(INT_ENABLE, DATA_RDY_EN);
    assert.equal(r.high(), true, 'asserted');
  });

  it('a sleeping part does not interrupt, even with the enable set', () => {
    // It powers on asleep. Enabling the interrupt without clearing SLEEP is
    // the two classic traps stacked, and the pin must stay quiet.
    const r = rig().write(INT_ENABLE, DATA_RDY_EN);
    assert.equal(r.high(), false, 'asleep: no interrupt');
    r.wake();
    assert.equal(r.high(), true, 'and it fires as soon as it wakes');
  });

  it('clearing the enable puts it back', () => {
    const r = rig().wake().write(INT_ENABLE, DATA_RDY_EN);
    assert.equal(r.high(), true);
    r.write(INT_ENABLE, 0x00);
    assert.equal(r.high(), false);
  });
});

describe('MPU-6050 INT_PIN_CFG decides how the pin signals', () => {
  it('ACTL inverts it: idle HIGH, asserted LOW', () => {
    // The bit a falling-edge interrupt handler needs. Without it the host
    // waits for an edge that never comes in the direction it is watching.
    const r = rig().wake().write(INT_PIN_CFG, ACTL);
    assert.equal(r.high(), true, 'active-low idles high');
    r.write(INT_ENABLE, DATA_RDY_EN);
    assert.equal(r.high(), false, 'and pulls low when it fires');
  });

  it('OPEN releases at idle, so the pull-up decides', () => {
    // Open-drain is how several devices share one interrupt line. The
    // observable difference from push-pull is exactly the idle level: 3.3 V
    // from the pull-up instead of a driven 0 V.
    const pp = rig().wake();
    const od = rig().wake().write(INT_PIN_CFG, OPEN | ACTL);
    assert.equal(pp.high(), false, 'push-pull drives its idle low');
    assert.equal(od.high(), true, 'open-drain lets the pull-up hold it high');
  });

  it('open-drain + active-low is the useful combination, and it works', () => {
    const r = rig().wake().write(INT_PIN_CFG, OPEN | ACTL);
    assert.equal(r.high(), true, 'idle');
    r.write(INT_ENABLE, DATA_RDY_EN);
    assert.equal(r.high(), false, 'pulled down on the interrupt');
  });

  it('open-drain + active-HIGH cannot signal at all, and is not faked', () => {
    // A real configuration mistake: an open-drain output can only pull DOWN,
    // so asking it for an active-high interrupt asks for something the pin
    // cannot do. The model reproduces the dead line rather than quietly
    // driving high anyway, because a bench that shows it working teaches the
    // wrong thing about why the real board does not.
    const r = rig().wake().write(INT_PIN_CFG, OPEN);
    assert.equal(r.high(), true, 'idle high, via the pull-up');
    r.write(INT_ENABLE, DATA_RDY_EN);
    assert.equal(r.high(), true, 'still high — the interrupt is invisible');
  });
});
