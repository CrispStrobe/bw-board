// The rp2040js boundary-A adapter, proven against HAND-ASSEMBLED ARMv6-M
// Thumb — no toolchain in the loop, every opcode computed from the ARM
// architecture manual, so the oracle is arithmetic, not trust.
//
// BLINK — GP25 (the Pico's onboard LED) via SIO, delay-looped:
//
//   addr  enc     asm
//   0x00  0x2005  movs r0, #5            ; FUNCTION_SIO
//   0x02  0x4907  ldr  r1, =0x400140CC   ; IO_BANK0 GPIO25_CTRL (lit @0x20)
//   0x04  0x6008  str  r0, [r1]          ; funcsel = SIO
//   0x06  0x2001  movs r0, #1
//   0x08  0x0640  lsls r0, r0, #25       ; bit 25
//   0x0A  0x4906  ldr  r1, =0xd0000000   ; SIO base (lit @0x24)
//   0x0C  0x6248  str  r0, [r1, #0x24]   ; GPIO_OE_SET
//   loop:
//   0x0E  0x6148  str  r0, [r1, #0x14]   ; GPIO_OUT_SET
//   0x10  0x22C8  movs r2, #200
//   0x12  0x3A01  subs r2, #1            ; d1
//   0x14  0xD1FD  bne  d1
//   0x16  0x6188  str  r0, [r1, #0x18]   ; GPIO_OUT_CLR
//   0x18  0x22C8  movs r2, #200
//   0x1A  0x3A01  subs r2, #1            ; d2
//   0x1C  0xD1FD  bne  d2
//   0x1E  0xE7F6  b    loop
//   0x20  0x400140CC, 0x24: 0xd0000000   ; literal pool
//
// Cycle arithmetic from rp2040js's own model (cortex-m0-core: 1 cycle base,
// +1 taken branch, SIO access +0): each half-period is str(1) + movs(1) +
// 199×(subs 1 + bne 2) + (subs 1 + bne 1) = 602 cycles; the low half adds
// b(2) → full period = 602 + 604 = 1206 cycles = 9648 ns at 125 MHz.
// 2 ms / 9648 ns ≈ 207 periods ≈ 414 toggles. Assertions bracket that.
//
// ADC — channel 0 (GP26), started over APB, result left in r0:
//
//   addr  enc     asm
//   0x00  0x4904  ldr  r1, =0x4004c000   ; ADC base (lit @0x14)
//   0x02  0x2005  movs r0, #5            ; CS = EN | START_ONCE
//   0x04  0x6008  str  r0, [r1]
//   0x06  0x2201  movs r2, #1
//   0x08  0x0212  lsls r2, r2, #8        ; CS.READY mask
//   rdy:
//   0x0A  0x6808  ldr  r0, [r1]
//   0x0C  0x4210  tst  r0, r2
//   0x0E  0xD0FC  beq  rdy
//   0x10  0x6848  ldr  r0, [r1, #4]      ; RESULT
//   0x12  0xE7FE  b    .
//   0x14  0x4004c000                     ; literal pool
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRp2040jsAdapter, RP2040_PINS, RAM_START } from '../src/rp2040js-adapter.js';
import { BoardImpl as BoardImplRef } from '../src/board.js';
import { registerAllDevices } from '../src/register-all.js';
registerAllDevices();

const BLINK = new Uint16Array([
  0x2005, 0x4907, 0x6008, 0x2001, 0x0640, 0x4906, 0x6248,
  0x6148, 0x22C8, 0x3A01, 0xD1FD, 0x6188, 0x22C8, 0x3A01, 0xD1FD, 0xE7F6,
  0x40CC, 0x4001, // 0x400140CC little-endian halfwords
  0x0000, 0xd000, // 0xd0000000
]);

const ADC = new Uint16Array([
  0x4904, 0x2005, 0x6008, 0x2201, 0x0212,
  0x6808, 0x4210, 0xD0FC, 0x6848, 0xE7FE,
  0xc000, 0x4004, // 0x4004c000
]);

function stubBoard(analogVolts = 0) {
  const calls = [];
  return {
    calls,
    setPin: (name, mode, high) => calls.push({ name, mode, high }),
    advanceTo: (tNs) => calls.push({ advanceTo: tNs }),
    readAnalog: () => analogVolts,
  };
}

test('pin map: GP0–GP28, ADC channels on GP26–GP28 — the Pico names', () => {
  assert.equal(Object.keys(RP2040_PINS).length, 29);
  assert.deepEqual(RP2040_PINS.GP25, { index: 25 });
  assert.deepEqual(RP2040_PINS.GP26, { index: 26, adcChannel: 0 });
  assert.deepEqual(RP2040_PINS.GP28, { index: 28, adcChannel: 2 });
});

test('hand-assembled blink: GP25 toggles push-pull at the computed rate', () => {
  const a = createRp2040jsAdapter({ program: BLINK });
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(2_000_000); // 2 ms simulated

  const gp25 = b.calls.filter(c => c.name === 'GP25' && c.mode === 'pushpull');
  assert.ok(gp25.length > 0, 'GP25 driven push-pull');
  let toggles = 0;
  for (let i = 1; i < gp25.length; i++) if (gp25[i].high !== gp25[i - 1].high) toggles++;
  assert.ok(toggles >= 380 && toggles <= 450,
    `~414 toggles expected from the cycle arithmetic, saw ${toggles}`);

  const adv = b.calls.filter(c => c.advanceTo !== undefined);
  assert.ok(adv.length > 0, 'board clock advanced');
  const last = adv[adv.length - 1].advanceTo;
  // 2 ms of budget; overshoot bounded by one instruction (≤ 5 cycles = 40 ns).
  assert.ok(last >= 2_000_000n && last <= 2_000_400n, `advanceTo=${last}`);
});

test('time first, edge second: every setPin is preceded by advanceTo, monotonic', () => {
  const a = createRp2040jsAdapter({ program: BLINK });
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(100_000);

  let lastAdvance = -1n;
  let prevWasAdvance = false;
  for (const c of b.calls) {
    if (c.advanceTo !== undefined) {
      assert.ok(c.advanceTo >= lastAdvance, 'advanceTo never goes backwards');
      lastAdvance = c.advanceTo;
      prevWasAdvance = true;
    } else {
      assert.ok(prevWasAdvance, `setPin(${c.name}) arrived without a preceding advanceTo`);
      prevWasAdvance = false;
    }
  }
});

test('determinism: two identical runs publish identical edge sequences', () => {
  const run = () => {
    const a = createRp2040jsAdapter({ program: BLINK });
    const b = stubBoard();
    a.attachBoard(b);
    a.advanceNs(500_000);
    return JSON.stringify(b.calls, (k, v) => typeof v === 'bigint' ? v.toString() : v);
  };
  assert.equal(run(), run());
});

test('attachBoard publishes every header pin in an input mode at reset', () => {
  const a = createRp2040jsAdapter();
  const b = stubBoard();
  a.attachBoard(b);
  const byName = new Map(b.calls.filter(c => c.name).map(c => [c.name, c]));
  assert.equal(byName.size, 29, 'all 29 header pins published');
  for (const [name, c] of byName) {
    assert.ok(c.mode === 'input' || c.mode === 'input-pullup' || c.mode === 'input-pulldown',
      `${name} at reset is an input mode, got ${c.mode}`);
  }
});

test('ADC: a conversion started over APB reads the board voltage, 12-bit', () => {
  // 1.65 V of 3.3 V full scale → round(0.5 × 4095) = 2048.
  const a = createRp2040jsAdapter({ program: ADC });
  const b = stubBoard(1.65);
  a.attachBoard(b);
  a.advanceNs(50_000); // sample time is 2 µs; 50 µs is plenty
  assert.equal(a.stats.adcReadCount, 1, 'exactly one conversion');
  assert.equal(a.core.registers[0], 2048, 'RESULT reached r0');
});

test('timeNs matches the simulation clock and freezes between advances', () => {
  const a = createRp2040jsAdapter({ program: BLINK });
  a.advanceNs(10_000);
  const t1 = a.timeNs();
  assert.ok(t1 >= 10_000n && t1 <= 10_100n, `t=${t1}`);
  assert.equal(a.timeNs(), t1, 'no advance, no time');
  a.advanceNs(10_000);
  assert.ok(a.timeNs() > t1);
});

test('loadProgram resets PC to the origin and runs from SRAM', () => {
  const a = createRp2040jsAdapter();
  a.loadProgram(BLINK);
  assert.equal(a.core.PC, RAM_START);
  const b = stubBoard();
  a.attachBoard(b);
  a.advanceNs(10_000);
  assert.ok(b.calls.some(c => c.name === 'GP25' && c.mode === 'pushpull'),
    'the loaded program drives GP25');
});

// FOLLOWER — the digital-input leg, hand-assembled: GP25 mirrors GP2,
// which the BOARD drives. The pad's INPUT ENABLE must be set — pads
// reset with IE off in rp2040js, so GPIO_IN reads 0 no matter what the
// board does until the firmware writes the pad (the SDK's gpio_init
// does; so does generateC's bw_setup for input pins).
//   0x00  0x2005  movs r0, #5
//   0x02  0x4909  ldr  r1, =0x400140CC   ; GPIO25_CTRL (lit @0x28)
//   0x04  0x6008  str  r0, [r1]
//   0x06  0x4909  ldr  r1, =0x40014014   ; GPIO2_CTRL  (lit @0x2C)
//   0x08  0x6008  str  r0, [r1]
//   0x0A  0x2042  movs r0, #0x42         ; IE | SCHMITT
//   0x0C  0x4908  ldr  r1, =0x4001c00c   ; PADS GPIO2  (lit @0x30)
//   0x0E  0x6008  str  r0, [r1]
//   0x10  0x2001  movs r0, #1
//   0x12  0x0640  lsls r0, r0, #25
//   0x14  0x4907  ldr  r1, =0xd0000000   ; SIO (lit @0x34)
//   0x16  0x6248  str  r0, [r1, #0x24]   ; OE_SET GP25
//   loop:
//   0x18  0x684A  ldr  r2, [r1, #4]      ; GPIO_IN
//   0x1A  0x2304  movs r3, #4            ; bit 2
//   0x1C  0x421A  tst  r2, r3
//   0x1E  0xD001  beq  off
//   0x20  0x6148  str  r0, [r1, #0x14]   ; OUT_SET
//   0x22  0xE7F9  b    loop
//   0x24  0x6188  str  r0, [r1, #0x18]   ; OUT_CLR (off:)
//   0x26  0xE7F7  b    loop
test('digital input: GP25 follows the board level on GP2 within a slice', () => {
  const FOLLOWER = new Uint16Array([
    0x2005, 0x4909, 0x6008, 0x4909, 0x6008, 0x2042, 0x4908, 0x6008,
    0x2001, 0x0640, 0x4907, 0x6248,
    0x684A, 0x2304, 0x421A, 0xD001, 0x6148, 0xE7F9, 0x6188, 0xE7F7,
    0x40CC, 0x4001, 0x4014, 0x4001, 0xc00c, 0x4001, 0x0000, 0xd000,
  ]);
  const a = createRp2040jsAdapter({ program: FOLLOWER });
  let gp2Level = 0;
  const b = stubBoard();
  b.readPin = (name) => (name === 'GP2' ? gp2Level : 0);
  a.attachBoard(b);

  const lastGp25 = () => {
    const g = b.calls.filter(c => c.name === 'GP25' && c.mode === 'pushpull');
    return g.length ? g[g.length - 1].high : undefined;
  };

  a.advanceNs(100_000);
  assert.equal(lastGp25(), false, 'GP2 low -> GP25 low');
  gp2Level = 1;
  a.advanceNs(100_000);
  assert.equal(lastGp25(), true, 'the board raised GP2 -> GP25 follows high');
  gp2Level = 0;
  a.advanceNs(100_000);
  assert.equal(lastGp25(), false, 'and back down');
});

test('the pin join is case-blind: GP15 lights a bench LED wired to gp15', () => {
  // The exact production failure: adapters speak the datasheet spelling
  // (GP15), sidecars and the inferred bench speak lowercase (gp15). The
  // board joins case-blind; neither side needs to know about the other's
  // spelling. (bw-board's own AVR path had been "fixed" by patching a
  // vendored copy downstream — which the next re-vendor would destroy.)
  const b = new BoardImplRef(3.3);
  b.setNetlist(
    [{ id: 'MCU', kind: 'mcu', params: {}, terminals: ['gp15'] },
     { id: 'R1', kind: 'resistor', params: { ohms: 330 }, terminals: ['a', 'b'] },
     { id: 'L1', kind: 'led', params: {}, terminals: ['anode', 'cathode'] },
     { id: 'GND', kind: 'gnd', params: {}, terminals: ['gnd'] }],
    [{ id: 'n1', terminals: [{ part: 'MCU', terminal: 'gp15' }, { part: 'R1', terminal: 'a' }] },
     { id: 'n2', terminals: [{ part: 'R1', terminal: 'b' }, { part: 'L1', terminal: 'anode' }] },
     { id: 'n3', terminals: [{ part: 'L1', terminal: 'cathode' }, { part: 'GND', terminal: 'gnd' }] }]);
  b.setPower(true);
  b.setPin('GP15', 'pushpull', true);
  assert.ok(b.ledBrightness('L1') > 0.05, 'the LED lights across the case divide');
  assert.equal(b.readPin('GP15'), 1, 'the read leg joins the same way');
  b.setPin('GP15', 'pushpull', false);
  assert.equal(b.ledBrightness('L1'), 0, 'and follows the drive back down');
});
