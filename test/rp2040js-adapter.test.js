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
    assert.ok(c.mode === 'input' || c.mode === 'input-pullup',
      `${name} at reset is an input, got ${c.mode}`);
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
