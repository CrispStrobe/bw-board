// STM32F030 / STM32G030 light-tier fidelity: the model must fail where the
// silicon fails, so a firmware bug cannot pass in simulation. Every case is a
// direct register poke or a hand-assembled image (no compiler), so CI runs it.
//
// References: RM0360 (F030) §6 RCC, §8 GPIO, §23 USART; RM0444 (G030) §2.2
// memory map, §5 RCC, §15 ADC; DS10235 / DS12991 for start-up and sensor
// figures.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';
import { attachStm32F0, attachStm32G0, fillPowerOnRam } from '../src/stm32f0-board.js';
import { createStm32F0Adapter, createStm32G0Adapter } from '../src/stm32-adapter.js';
import { stm32g0TemperatureVolts } from '../src/chip-temperature.js';
import { createRp2040jsDebugTarget } from '../src/rp2040js-debug.js';

const RCC = 0x40021000;
const FLASH_ACR = 0x40022000;
const USART1 = 0x40013800;
const TIM3 = 0x40000400;
const TIM14 = 0x40002000;
const ADC = 0x40012400;

function rig (family, opts = {}) {
  const m = new CortexM0Machine(family === 'g0'
    ? { sramBytes: 8192, flashBytes: 64 * 1024 }
    : { sramBytes: 4096, flashBytes: 16 * 1024 });
  const bytes = []; const pins = [];
  const b = (family === 'g0' ? attachStm32G0 : attachStm32F0)(m, {
    onSerialByte: (x) => bytes.push({ x, t: Number(m.timeNs()) }),
    onPinChange: (pin, mode, high) => pins.push({ pin, mode, high }),
    ...opts,
  });
  const w = (a, v) => m._write(a, v >>> 0, 4);
  const r = (a) => m._read(a, 4) >>> 0;
  return { m, b, bytes, pins, w, r };
}

// The PLL recipe each family's reference manual describes.
function pllTo48 (t) {          // F030: HSI/2 * 12 = 48 MHz, 1 wait state
  t.w(FLASH_ACR, 0x11);
  t.w(RCC + 0x04, 10 << 18);    // PLLMUL x12, PLLSRC HSI/2
  t.w(RCC + 0x00, t.r(RCC) | (1 << 24));
  t.m.tickNs(250_000);          // > tLOCK 200 µs
  assert.ok(t.r(RCC) & (1 << 25), 'PLLRDY');
  t.w(RCC + 0x04, (10 << 18) | 2);
}
function pllTo64 (t) {          // G030: HSI16 /1 *8 /2 = 64 MHz, 2 wait states
  t.w(FLASH_ACR, 0x0004_0602);
  t.w(RCC + 0x0c, 2 | (0 << 4) | (8 << 8) | (1 << 28) | (1 << 29));
  t.w(RCC + 0x00, t.r(RCC) | (1 << 24));
  t.m.tickNs(50_000);           // > tLOCK 40 µs
  assert.ok(t.r(RCC) & (1 << 25), 'PLLRDY');
  t.w(RCC + 0x08, 2);
}

// A two-word image whose reset handler is `b .` — the instruction rate probe.
function spinImage () {
  const img = new Uint8Array(16);
  const dv = new DataView(img.buffer);
  dv.setUint32(0, 0x20001000, true);
  dv.setUint32(4, 0x08000009, true);
  dv.setUint16(8, 0xe7fe, true);  // b .
  return img;
}

describe('STM32G030 memory map is its own (RM0444 §2.2)', () => {
  it('GPIO lives on IOPORT at 0x50000000/0x50000400/0x50000800', () => {
    const t = rig('g0');
    t.w(RCC + 0x34, 7);
    t.w(0x50000000, 1); t.w(0x50000400, 4); t.w(0x50000800, 1 << 28);
    assert.equal(t.b.gpioA.moder, 1);
    assert.equal(t.b.gpioB.moder, 4);
    assert.equal(t.b.gpioC.moder, 1 << 28);
    assert.deepEqual(t.m.unmapped, []);
  });

  it('the F0 GPIO address is reserved on the G0: the access is logged, nothing moves', () => {
    const t = rig('g0');
    t.w(RCC + 0x34, 7);
    t.w(0x48000000, 1);
    t.r(0x48000010);
    assert.equal(t.b.gpioA.moder, 0);
    assert.ok(t.m.unmapped.some((u) => u.addr === 0x48000000 && u.rw === 'w'));
    assert.ok(t.m.unmapped.some((u) => u.addr === 0x48000010 && u.rw === 'r'));
  });

  it('the F030 keeps GPIO at 0x48000000 and has nothing at 0x50000000', () => {
    const t = rig('f0');
    t.w(RCC + 0x14, 1 << 17);
    t.w(0x48000000, 1);
    assert.equal(t.b.gpioA.moder, 1);
    t.w(0x50000000, 4);
    assert.ok(t.m.unmapped.some((u) => u.addr === 0x50000000));
  });
});

describe('RCC clock tree drives the core, timers and USART', () => {
  it('reset clocks: F030 HSI 8 MHz, G030 HSI16 16 MHz — not the PLL top', () => {
    assert.equal(rig('f0').m.clockHz, 8_000_000);
    assert.equal(rig('g0').m.clockHz, 16_000_000);
  });

  it('RCC_CR ready bits reflect enables: PLLRDY only after PLLON and its lock time', () => {
    const f = rig('f0');
    assert.equal(f.r(RCC) & ((1 << 25) | (1 << 17)), 0, 'no PLL/HSE ready out of reset');
    assert.equal(f.r(RCC) & 3, 3, 'HSION + HSIRDY');
    f.w(RCC + 0x00, f.r(RCC) | (1 << 24));
    f.m.tickNs(100_000);
    assert.equal(f.r(RCC) & (1 << 25), 0, 'F0 PLL not locked at 100 µs');
    f.m.tickNs(150_000);
    assert.ok(f.r(RCC) & (1 << 25), 'F0 PLL locked by 250 µs');
    f.w(RCC + 0x00, f.r(RCC) & ~(1 << 24));
    assert.equal(f.r(RCC) & (1 << 25), 0, 'PLLRDY drops with PLLON');

    const g = rig('g0');
    assert.equal(g.r(RCC) & ((1 << 8) | (1 << 10)), (1 << 8) | (1 << 10), 'HSION + HSIRDY');
    g.w(RCC + 0x0c, 2 | (8 << 8) | (1 << 28) | (1 << 29));
    g.w(RCC + 0x00, g.r(RCC) | (1 << 24));
    assert.equal(g.r(RCC) & (1 << 25), 0, 'G0 PLL not locked at once');
    g.m.tickNs(50_000);
    assert.ok(g.r(RCC) & (1 << 25));
  });

  it('a switch to an unlocked PLL does not happen (SWS stays on HSI) and is noted', () => {
    const f = rig('f0');
    f.w(RCC + 0x04, (10 << 18) | 2);
    assert.equal((f.r(RCC + 0x04) >>> 2) & 3, 0, 'SWS still HSI');
    assert.equal(f.m.clockHz, 8_000_000);
    assert.ok(f.b.rcc.clockNotes.some((n) => /waits: source not ready/.test(n)));
  });

  it('F030: configured PLL x12 switches the core to 48 MHz and SWS follows', () => {
    const f = rig('f0');
    pllTo48(f);
    assert.equal((f.r(RCC + 0x04) >>> 2) & 3, 2);
    assert.equal(f.m.clockHz, 48_000_000);
    assert.deepEqual(f.b.rcc.clockNotes, []);
  });

  it('G030: PLLCFGR HSI16/1*8/2 switches the core to 64 MHz', () => {
    const g = rig('g0');
    pllTo64(g);
    assert.equal((g.r(RCC + 0x08) >>> 3) & 7, 2);
    assert.equal(g.m.clockHz, 64_000_000);
    assert.deepEqual(g.b.rcc.clockNotes, []);
  });

  it('PLL configuration is frozen while the PLL runs', () => {
    const f = rig('f0');
    f.w(RCC + 0x04, 10 << 18);
    f.w(RCC + 0x00, f.r(RCC) | (1 << 24));
    f.w(RCC + 0x04, 4 << 18);
    assert.equal((f.r(RCC + 0x04) >>> 18) & 0xf, 10);
    const g = rig('g0');
    g.w(RCC + 0x0c, 2 | (8 << 8) | (1 << 28) | (1 << 29));
    g.w(RCC + 0x00, g.r(RCC) | (1 << 24));
    g.w(RCC + 0x0c, 2 | (20 << 8));
    assert.equal((g.r(RCC + 0x0c) >>> 8) & 0x7f, 8);
  });

  it('too few flash wait states for the new HCLK are ledgered', () => {
    const f = rig('f0');
    f.w(FLASH_ACR, 0x10);      // LATENCY 0
    f.w(RCC + 0x04, 10 << 18);
    f.w(RCC + 0x00, f.r(RCC) | (1 << 24));
    f.m.tickNs(250_000);
    f.w(RCC + 0x04, (10 << 18) | 2);
    assert.ok(f.b.rcc.clockNotes.some((n) => /LATENCY=0 too low/.test(n)));
  });

  for (const [family, make, pll, slow, fast] of [
    ['F030', createStm32F0Adapter, pllTo48, 8e6, 48e6],
    ['G030', createStm32G0Adapter, pllTo64, 16e6, 64e6],
  ]) {
    it(`${family}: a program that never configures the PLL executes ${fast / slow}x fewer instructions`, () => {
      const run = (configure) => {
        const a = make({ program: spinImage() });
        const t = { m: a.machine, w: (x, v) => a.machine._write(x, v >>> 0, 4), r: (x) => a.machine._read(x, 4) >>> 0 };
        if (configure) pll(t);
        const before = a.machine.stats.instructions;
        a.advanceNs(1_000_000);
        return { n: a.machine.stats.instructions - before, hz: a.clockHz };
      };
      const atReset = run(false); const atPll = run(true);
      assert.equal(atReset.hz, slow);
      assert.equal(atPll.hz, fast);
      const ratio = atPll.n / atReset.n;
      assert.ok(Math.abs(ratio - fast / slow) < 0.05 * fast / slow, `instruction ratio ${ratio}`);
    });
  }

  it('the debug target charges each instruction at the CURRENT clock, after a PLL switch', () => {
    const a = createStm32F0Adapter({ program: spinImage() });
    const target = createRp2040jsDebugTarget(a);   // created at the 8 MHz reset clock
    const count = () => {
      const before = a.machine.core.cycles;
      target.run(); target.runFor(1_000_000); target.pause?.();
      return a.machine.core.cycles - before;
    };
    const slow = count();
    pllTo48({ m: a.machine, w: (x, v) => a.machine._write(x, v >>> 0, 4), r: (x) => a.machine._read(x, 4) >>> 0 });
    const fast = count();
    assert.ok(Math.abs(fast / slow - 6) < 0.3, `cycles per ms ratio ${fast / slow}`);
  });

  it('timers count from the RCC timer clock: TIM14 PSC=7 is 1 MHz at the F030 reset clock', () => {
    const f = rig('f0');
    f.w(RCC + 0x1c, 1 << 8);
    f.w(TIM14 + 0x28, 7); f.w(TIM14 + 0x2c, 0xffff); f.w(TIM14 + 0x00, 1);
    f.m.tickNs(1000_000);
    assert.equal(f.r(TIM14 + 0x24), 1000, '1000 counts in 1 ms at 8 MHz / 8');
    pllTo48(f);
    f.w(TIM14 + 0x24, 0);
    f.m.tickNs(1000_000);
    assert.equal(f.r(TIM14 + 0x24), 6000, 'six times faster on the 48 MHz PLL');
  });

  it('a fixedClockHz board pins every clock (legacy cross-simulator parity only)', () => {
    const f = rig('f0', { fixedClockHz: 48_000_000 });
    assert.equal(f.m.clockHz, 48_000_000);
    assert.equal(f.b.rcc.timerClockHz(), 48_000_000);
  });

  it('the adapter refuses the old clockHz option instead of pinning a fast clock', () => {
    assert.throws(() => createStm32F0Adapter({ clockHz: 48_000_000 }), /fixedClockHz/);
    assert.throws(() => createStm32G0Adapter({ clockHz: 64_000_000 }), /fixedClockHz/);
  });
});

describe('STM32G030 RCC enable bits are only the G0 ones', () => {
  it('TIM14EN is APBENR2 bit 15; the F0 APB1ENR bit 8 offset enables nothing', () => {
    const g = rig('g0');
    g.w(RCC + 0x1c, 1 << 8);
    g.w(TIM14 + 0x2c, 1234);
    assert.notEqual(g.r(TIM14 + 0x2c), 1234);
    assert.ok(g.b.rcc.gatedAccesses.some((a) => /TIM14/.test(a)));
  });
  it('USART1 and ADC do not wake on the F0 APB2ENR offset', () => {
    const g = rig('g0');
    g.w(RCC + 0x18, (1 << 14) | (1 << 9));
    g.w(USART1 + 0x0c, 139);
    g.w(ADC + 0x28, 1);
    assert.ok(g.b.rcc.gatedAccesses.some((a) => /USART1/.test(a)));
    assert.ok(g.b.rcc.gatedAccesses.some((a) => /ADC/.test(a)));
  });
  it('GPIO does not wake on the F0 AHBENR bits', () => {
    const g = rig('g0');
    g.w(RCC + 0x14, 7 << 17);
    g.w(0x50000000, 1);
    assert.equal(g.b.gpioA.moder, 0);
    assert.ok(g.b.rcc.gatedAccesses.some((a) => /GPIOA/.test(a)));
  });
});

describe('STM32G030 ADC (RM0444 §15.3)', () => {
  const adcOn = (opts) => { const g = rig('g0', opts); g.w(RCC + 0x40, 1 << 20); return g; };

  it('ADEN without ADVREGEN never brings ADRDY up', () => {
    const g = adcOn();
    g.w(ADC + 0x08, 1);
    g.m.tickNs(1_000_000);
    assert.equal(g.r(ADC + 0x00) & 1, 0);
    assert.ok(g.b.rcc.gatedAccesses.some((a) => /ADVREGEN/.test(a)));
  });

  it('ADEN before the 20 µs regulator start-up does not take; after it, ADRDY sets', () => {
    const g = adcOn();
    g.w(ADC + 0x08, 1 << 28);
    g.m.tickNs(10_000);
    g.w(ADC + 0x08, (1 << 28) | 1);
    assert.equal(g.r(ADC + 0x00) & 1, 0, 'too early');
    g.m.tickNs(15_000);
    g.w(ADC + 0x08, (1 << 28) | 1);
    assert.equal(g.r(ADC + 0x00) & 1, 1, 'ADRDY after tADCVREG_STUP');
  });

  it('CCRDY after a CHSELR write; ADCAL completes (self-clears, EOCAL) once the regulator settled', () => {
    const g = adcOn();
    g.w(ADC + 0x28, 1 << 3);
    assert.ok(g.r(ADC + 0x00) & (1 << 13), 'CCRDY');
    g.w(ADC + 0x00, 1 << 13);
    assert.equal(g.r(ADC + 0x00) & (1 << 13), 0, 'CCRDY is rc_w1');
    g.w(ADC + 0x08, 1 << 28); g.m.tickNs(25_000);
    g.w(ADC + 0x08, (1 << 28) | (1 << 31));
    assert.equal(g.r(ADC + 0x08) & (1 << 31), 0, 'ADCAL cleared');
    assert.ok(g.r(ADC + 0x00) & (1 << 11), 'EOCAL');
  });

  it('FLASH_ACR reads back LATENCY (G0 poll) and F0 PRFTBS mirrors PRFTBE; mapped, not unmapped', () => {
    const g = rig('g0'); g.w(FLASH_ACR, (g.r(FLASH_ACR) & ~7) | 2);
    assert.equal(g.r(FLASH_ACR) & 7, 2);
    const f = rig('f0'); f.w(FLASH_ACR, 0x11);
    assert.equal(f.r(FLASH_ACR), 0x31);
    assert.deepEqual([...g.m.unmapped, ...f.m.unmapped], []);
  });

  it('no conversion without ADRDY', () => {
    const g = adcOn({ onAnalogRead: () => 3.3 });
    g.w(ADC + 0x28, 1);
    g.w(ADC + 0x08, 1 << 2);
    assert.equal(g.r(ADC + 0x00) & 4, 0, 'no EOC');
  });

  it('the temperature sensor is channel 12 with G0 characteristics; channel 16 is not it', () => {
    const g = adcOn({ onAnalogRead: () => 0, onTemperature: () => stm32g0TemperatureVolts(30) });
    g.w(ADC + 0x08, 1 << 28); g.m.tickNs(25_000); g.w(ADC + 0x08, (1 << 28) | 1);
    g.w(ADC + 0x308, 1 << 23);
    g.w(ADC + 0x28, 1 << 12);
    g.w(ADC + 0x08, (1 << 28) | 1 | (1 << 2));
    assert.equal(g.r(ADC + 0x40), Math.round(0.76 / 3.3 * 4095));
    g.w(ADC + 0x28, 1 << 16);
    g.w(ADC + 0x08, (1 << 28) | 1 | (1 << 2));
    assert.equal(g.r(ADC + 0x40), 0);
    assert.ok(stm32g0TemperatureVolts(60) > stm32g0TemperatureVolts(30), 'the G0 sensor rises as it warms');
    assert.ok(Math.abs(stm32g0TemperatureVolts(31) - stm32g0TemperatureVolts(30) - 0.0025) < 1e-12);
  });
});

describe('USART1 transmits only with an AF TX pad, a baud, and in real time', () => {
  function usart (family, { af = true, brr = 69, te = true } = {}) {
    const t = rig(family);
    if (family === 'g0') { t.w(RCC + 0x34, 1); t.w(RCC + 0x40, 1 << 14); t.w(0x50000000, 2 << 18); if (af) t.w(0x50000024, 1 << 4); } else {
      t.w(RCC + 0x14, 1 << 17); t.w(RCC + 0x18, 1 << 14); t.w(0x48000000, 2 << 18); if (af) t.w(0x48000024, 1 << 4);
    }
    t.w(USART1 + 0x0c, brr);
    t.w(USART1 + 0x00, 1 | (te ? 8 : 0));
    return t;
  }
  const frameNs = (hz, brr) => 10 * 1e9 * brr / hz;

  for (const family of ['f0', 'g0']) {
    const hz = family === 'g0' ? 16e6 : 8e6;
    const brr = family === 'g0' ? 139 : 69;      // ~115200 baud from the reset clock
    it(`${family}: bytes leave at the configured baud, after TE's idle frame`, () => {
      const t = usart(family, { brr });
      t.w(USART1 + 0x28, 0x48);
      assert.equal(t.r(USART1 + 0x1c) & 0x80, 0, 'TXE low: the byte waits behind the idle frame');
      t.m.tickNs(frameNs(hz, brr) * 2 - 2000);
      assert.equal(t.bytes.length, 0, 'not out before idle + one frame');
      t.m.tickNs(4000);
      assert.deepEqual(t.bytes.map((b) => b.x), [0x48]);
      assert.equal(t.r(USART1 + 0x1c) & 0x40, 0x40, 'TC once the line is empty');
    });

    it(`${family}: TXE is low while a byte waits; writing again overwrites it`, () => {
      const t = usart(family, { brr });
      t.w(USART1 + 0x28, 0x41);     // waits behind the idle frame
      t.w(USART1 + 0x28, 0x42);     // overwrites TDR: on silicon 'A' is lost
      assert.equal(t.r(USART1 + 0x1c) & 0x80, 0);
      t.m.tickNs(frameNs(hz, brr) * 3);
      assert.deepEqual(t.bytes.map((b) => b.x), [0x42]);
    });

    it(`${family}: no AF on the TX pad: frames shift out into nothing`, () => {
      const t = usart(family, { af: false, brr });
      t.w(USART1 + 0x28, 0x48);
      t.m.tickNs(frameNs(hz, brr) * 3);
      assert.deepEqual(t.bytes, []);
      assert.equal(t.b.usart1.lostTx, 1);
    });

    it(`${family}: no baud (BRR=0) or no TE: nothing shifts`, () => {
      const a = usart(family, { brr: 0 });
      a.w(USART1 + 0x28, 0x48); a.m.tickNs(5_000_000);
      assert.deepEqual(a.bytes, []);
      assert.equal(a.r(USART1 + 0x1c) & 0x40, 0, 'TC never sets');
      const b = usart(family, { te: false, brr });
      b.w(USART1 + 0x28, 0x48); b.m.tickNs(5_000_000);
      assert.deepEqual(b.bytes, []);
    });
  }
});

describe('TIM3 PWM reaches the pad only through AF1', () => {
  function pwm (afNumber) {
    const t = rig('g0');
    t.w(RCC + 0x34, 1); t.w(RCC + 0x3c, 2);
    t.w(0x50000020, afNumber << 24);  // AFRL PA6
    t.w(0x50000000, 2 << 12);         // PA6 AF mode
    t.w(TIM3 + 0x28, 15); t.w(TIM3 + 0x2c, 999);
    t.w(TIM3 + 0x18, 6 << 4); t.w(TIM3 + 0x34, 250); t.w(TIM3 + 0x20, 1); t.w(TIM3 + 0x00, 1);
    t.pins.length = 0;
    t.m.tickNs(3_000_000);
    return t.pins.filter((p) => p.pin === 'PA6');
  }
  it('AF1: the compare drives PA6', () => {
    const e = pwm(1);
    assert.ok(e.length >= 4, `edges ${e.length}`);
  });
  it('AF0 (or GPIO mode): the compare runs but PA6 never moves', () => {
    assert.deepEqual(pwm(0), []);
  });
  it('routing PA6 to AF1 later publishes the current level at once', () => {
    const t = rig('f0');
    t.w(RCC + 0x14, 1 << 17); t.w(RCC + 0x1c, 2);
    t.w(0x48000000, 2 << 12);
    t.w(TIM3 + 0x2c, 999); t.w(TIM3 + 0x18, 6 << 4); t.w(TIM3 + 0x34, 500); t.w(TIM3 + 0x20, 1); t.w(TIM3 + 0x00, 1);
    t.m.tickNs(10_000);
    assert.equal(t.pins.filter((p) => p.pin === 'PA6').length, 0);
    t.w(0x48000020, 1 << 24);
    assert.equal(t.pins.filter((p) => p.pin === 'PA6').length, 1);
  });
});

describe('SRAM at power-on is not zero', () => {
  it('attach fills SRAM with a deterministic non-zero pattern', () => {
    const a = rig('f0').m.sram; const b = rig('f0').m.sram;
    assert.ok(a.every((x) => x !== 0), 'no zero byte');
    assert.deepEqual(a, b, 'same pattern every power-on');
    assert.ok(new Set(a).size > 200, 'not a constant fill');
  });
  it("ramAtReset: 'zero' models a warm debugger reset", () => {
    assert.ok(rig('g0', { ramAtReset: 'zero' }).m.sram.every((x) => x === 0));
  });
  it('an uninitialised .bss variable read through the core is not 0', () => {
    const t = rig('g0');
    assert.notEqual(t.r(0x20000100), 0);
  });
  it('adapter resetToProgram restores the pattern, not zeroes', () => {
    const a = createStm32G0Adapter({ program: spinImage() });
    a.machine.sram.fill(0);
    a.resetToProgram();
    assert.deepEqual(a.machine.sram, fillPowerOnRam(new Uint8Array(8192)));
  });
});
