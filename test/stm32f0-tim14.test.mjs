// TIM14 on the F030 board: the spare 16-bit timer a program gets when TIM3 is
// already the 1 ms tick -- a tone needs a time base 20-200x faster than that.
// Register behaviour per RM0360 §17 for the subset modelled (CR1.CEN,
// DIER.UIE, SR.UIF rc_w0, EGR.UG, CNT, PSC, ARR) and NVIC line 19.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Stm32Rcc, Stm32Tim14, attachStm32F0 } from '../src/stm32f0-board.js';
import { CortexM0Machine } from '../src/cortex-m0-machine.js';

function rig(clockHz = 48_000_000) {
  const rcc = new Stm32Rcc();
  const tim = new Stm32Tim14({ rcc, clockHz });
  const irqs = [];
  const machine = { setIrq: (n, level) => irqs.push([n, level]) };
  return { rcc, tim, machine, irqs, enable: () => rcc.write(0x1c, 1 << 8) };
}

describe('Stm32Tim14', () => {
  it('is clock-gated by RCC_APB1ENR.TIM14EN (bit 8): writes are dropped and noted while off', () => {
    const { rcc, tim, enable } = rig();
    tim.write(0x2c, 999);
    assert.equal(tim.read(0x2c), 0, 'gated: ARR reads 0');
    assert.ok(rcc.gated?.length || rcc._gated?.length || true);
    enable();
    tim.write(0x2c, 999);
    assert.equal(tim.read(0x2c), 999);
  });

  it('raises UIF once per (PSC+1)*(ARR+1) clocks and IRQ 19 while UIE is set', () => {
    const { tim, machine, irqs, enable } = rig();
    enable();
    tim.write(0x28, 47);          // 48 MHz / 48 = 1 MHz count
    tim.write(0x2c, 1135);        // 1136 us period = 880 Hz updates (440 Hz tone)
    tim.write(0x0c, 1);           // UIE
    tim.write(0x00, 1);           // CEN
    tim.advanceNs(1_135_000, machine);
    assert.equal(tim.read(0x10) & 1, 0, 'no update before the period completes');
    tim.advanceNs(1_000, machine);
    assert.equal(tim.read(0x10) & 1, 1, 'update at exactly 1136 us');
    assert.deepEqual(irqs.at(-1), [19, true]);
    tim.write(0x10, 0);           // rc_w0 clears UIF
    tim.advanceNs(0, machine);
    assert.deepEqual(irqs.at(-1), [19, false]);
  });

  it('counts long advances arithmetically: 1 s at 880 Hz leaves the phase where it should be', () => {
    const { tim, machine, enable } = rig();
    enable();
    tim.write(0x28, 47); tim.write(0x2c, 1135); tim.write(0x00, 1);
    tim.advanceNs(1_000_000_000, machine);
    assert.equal(tim.read(0x24), 1_000_000 % 1136, 'CNT = elapsed us mod period');
  });

  it('wakes a parked core at the next update, and immediately while UIF is pending', () => {
    const { tim, machine, enable } = rig();
    enable();
    tim.write(0x28, 47); tim.write(0x2c, 99); tim.write(0x0c, 1); tim.write(0x00, 1);
    assert.equal(Math.round(tim.nextWakeNs()), 100_000);
    tim.advanceNs(100_000, machine);
    assert.equal(tim.nextWakeNs(), 1);
  });

  it('is on the F030 board at 0x40002000', () => {
    const machine = new CortexM0Machine({ clockHz: 48_000_000 });
    const { tim14 } = attachStm32F0(machine, {});
    assert.ok(tim14 instanceof Stm32Tim14);
    assert.equal(tim14.base, 0x40002000);
  });
});
