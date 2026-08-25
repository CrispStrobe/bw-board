/**
 * STM32F0 peripherals for the standalone Cortex-M0 machine — Phase 1 of
 * STM32-PATH.md. Register semantics ported from Renode's MIT peripheral
 * models (renode/renode-infrastructure, Copyright Antmicro, MIT — see
 * STM32_GPIOPort.cs / STM32_Timer.cs / STM32_UART.cs) and checked
 * against the RM0360 reference manual; the JS is ours.
 *
 * Modeled honestly, including the classic classroom bug: a peripheral
 * whose RCC clock is NOT enabled does not function — firmware that
 * forgets the enable fails here exactly as on silicon, with a named
 * note in the RCC ledger instead of a silent success.
 *
 * The unmapped-access ledger in CortexM0Machine covers everything this
 * file does not claim.
 *
 * @module
 */

// ── RCC (F0 subset): the clock-enable ledger ──────────────────────────
export class Stm32Rcc {
  constructor () {
    this.base = 0x40021000;
    this.size = 0x400;
    this.ahbenr = 0;   // 0x14: GPIOA bit17, GPIOB 18, GPIOC 19
    this.apb1enr = 0;  // 0x1C: TIM3 bit1
    this.apb2enr = 0;  // 0x18: USART1 bit14
    /** accesses to peripherals whose clock was off — the teaching signal */
    this.gatedAccesses = [];
  }

  read (off) {
    switch (off) {
      // CR: report HSI+PLL ready so init loops terminate (bits 1, 25)
      case 0x00: return 0x0200_0002 | 0x0100_0000;
      case 0x04: return 0; // CFGR: reset state
      case 0x14: return this.ahbenr;
      case 0x18: return this.apb2enr;
      case 0x1c: return this.apb1enr;
      default: return 0;
    }
  }

  write (off, v) {
    if (off === 0x14) this.ahbenr = v >>> 0;
    else if (off === 0x18) this.apb2enr = v >>> 0;
    else if (off === 0x1c) this.apb1enr = v >>> 0;
    // CR/CFGR writes accepted (PLL config is a no-op at this fidelity)
  }

  gpioEnabled (portIndex) { return (this.ahbenr >>> (17 + portIndex)) & 1; }
  tim3Enabled () { return (this.apb1enr >>> 1) & 1; }
  usart1Enabled () { return (this.apb2enr >>> 14) & 1; }

  noteGated (what) { this.gatedAccesses.push(what); }
}

// ── GPIO v2 (MODER/IDR/ODR/BSRR/PUPDR), one instance per port ─────────
// Boundary A: pin changes go OUT through onPinChange(pinName, mode,
// driveHigh) and come IN through setInput(bit, level).
export class Stm32Gpio {
  /**
   * @param {object} opts
   * @param {number} opts.base e.g. 0x48000000 for GPIOA
   * @param {number} opts.portIndex 0 = A, 1 = B, …
   * @param {string} opts.portLetter
   * @param {Stm32Rcc} opts.rcc
   * @param {(pin: string, mode: string, driveHigh: boolean) => void} [opts.onPinChange]
   */
  constructor ({ base, portIndex, portLetter, rcc, onPinChange }) {
    this.base = base;
    this.size = 0x400;
    this.portIndex = portIndex;
    this.portLetter = portLetter;
    this.rcc = rcc;
    this.onPinChange = onPinChange || (() => {});
    this.moder = 0; this.otyper = 0; this.pupdr = 0;
    this.odr = 0;
    this.inputs = 0; // external levels, bit per pin
    this.driven = 0; // which pins something external actually drives —
                     // an undriven input reads its pull, like the pad does
    this.afrl = 0; this.afrh = 0;
  }

  _enabled () {
    if (this.rcc.gpioEnabled(this.portIndex)) return true;
    this.rcc.noteGated(`GPIO${this.portLetter} accessed with its RCC clock off`);
    return false;
  }

  read (off) {
    if (!this._enabled()) return 0;
    switch (off) {
      case 0x00: return this.moder;
      case 0x04: return this.otyper;
      case 0x0c: return this.pupdr;
      case 0x10: { // IDR: outputs read back ODR; a driven input reads the
        // pad; an UNDRIVEN input reads its pull (up=1, down/none=0) — the
        // pull-up button idiom depends on exactly this
        let v = 0;
        for (let pin = 0; pin < 16; pin++) {
          const mode = (this.moder >>> (2 * pin)) & 3;
          let bit;
          if (mode === 1) bit = (this.odr >>> pin) & 1;
          else if ((this.driven >>> pin) & 1) bit = (this.inputs >>> pin) & 1;
          else bit = ((this.pupdr >>> (2 * pin)) & 3) === 1 ? 1 : 0;
          v |= bit << pin;
        }
        return v;
      }
      case 0x14: return this.odr;
      case 0x20: return this.afrl;
      case 0x24: return this.afrh;
      default: return 0;
    }
  }

  write (off, v) {
    if (!this._enabled()) return;
    switch (off) {
      case 0x00: this.moder = v >>> 0; this._publishAll(); break;
      case 0x04: this.otyper = v >>> 0; break;
      case 0x0c: this.pupdr = v >>> 0; this._publishAll(); break;
      case 0x14: this.odr = v & 0xffff; this._publishAll(); break;
      case 0x18: { // BSRR: low half sets, high half resets — atomic on silicon
        this.odr = ((this.odr | (v & 0xffff)) & ~((v >>> 16) & 0xffff)) & 0xffff;
        this._publishAll();
        break;
      }
      case 0x20: this.afrl = v >>> 0; break;
      case 0x24: this.afrh = v >>> 0; break;
      default: break;
    }
  }

  _publishAll () {
    for (let pin = 0; pin < 16; pin++) {
      const mode = (this.moder >>> (2 * pin)) & 3;
      const name = `P${this.portLetter}${pin}`;
      if (mode === 1) {
        this.onPinChange(name, 'pushpull', ((this.odr >>> pin) & 1) === 1);
      } else if (mode === 0) {
        const pull = (this.pupdr >>> (2 * pin)) & 3;
        this.onPinChange(name,
          pull === 1 ? 'input-pullup' : pull === 2 ? 'input-pulldown' : 'input',
          pull === 1);
      }
      // AF/analog pins are owned by their peripheral (USART etc.)
    }
  }

  /** An external driver asserts a level on the pad. */
  setInput (pin, high) {
    this.driven |= (1 << pin);
    if (high) this.inputs |= (1 << pin); else this.inputs &= ~(1 << pin);
  }

  /** The external driver lets go — the pull owns the pad again. */
  releaseInput (pin) { this.driven &= ~(1 << pin); }
}

// ── TIM3 (general-purpose, the 1 ms timebase + wake source) ───────────
// Update event when CNT reaches ARR; UIF sets; IRQ 16 when UIE.
export class Stm32Tim3 {
  /** @param {{rcc: Stm32Rcc, clockHz: number, irq?: number}} opts */
  constructor ({ rcc, clockHz, irq = 16 }) {
    this.base = 0x40000400;
    this.size = 0x400;
    this.rcc = rcc;
    this.clockHz = clockHz;
    this.irq = irq;
    this.cr1 = 0; this.dier = 0; this.sr = 0;
    this.psc = 0; this.arr = 0xffff; this.cnt = 0;
    this._accNs = 0;
  }

  _enabled () {
    if (this.rcc.tim3Enabled()) return true;
    this.rcc.noteGated('TIM3 accessed with its RCC clock off');
    return false;
  }

  read (off) {
    if (!this._enabled()) return 0;
    switch (off) {
      case 0x00: return this.cr1;
      case 0x0c: return this.dier;
      case 0x10: return this.sr;
      case 0x24: return this.cnt;
      case 0x28: return this.psc;
      case 0x2c: return this.arr;
      default: return 0;
    }
  }

  write (off, v) {
    if (!this._enabled()) return;
    switch (off) {
      case 0x00: this.cr1 = v >>> 0; break;
      case 0x0c: this.dier = v >>> 0; break;
      case 0x10: this.sr &= v >>> 0; break;       // rc_w0: write 0 clears
      case 0x14: if (v & 1) { this.cnt = 0; }break; // EGR.UG
      case 0x24: this.cnt = v & 0xffff; break;
      case 0x28: this.psc = v & 0xffff; break;
      case 0x2c: this.arr = v & 0xffff; break;
      default: break;
    }
  }

  _running () { return (this.cr1 & 1) === 1 && this.rcc.tim3Enabled(); }

  advanceNs (deltaNs, machine) {
    if (!this._running()) return;
    const tickNs = 1e9 / (this.clockHz / (this.psc + 1));
    this._accNs += Number(deltaNs);
    while (this._accNs >= tickNs) {
      this._accNs -= tickNs;
      if (this.cnt >= this.arr) {
        this.cnt = 0;
        this.sr |= 1; // UIF
      } else {
        this.cnt++;
      }
    }
    machine.setIrq(this.irq, (this.sr & this.dier & 1) !== 0);
  }

  nextWakeNs () {
    if (!this._running() || !(this.dier & 1)) return Infinity;
    if (this.sr & this.dier & 1) return 1;
    const tickNs = 1e9 / (this.clockHz / (this.psc + 1));
    const ticksLeft = (this.arr - this.cnt) + 1;
    return Math.max(1, ticksLeft * tickNs - this._accNs);
  }
}

// ── USART1 (the F0's v2 peripheral: ISR/TDR/RDR) ──────────────────────
export class Stm32Usart1 {
  /** @param {{rcc: Stm32Rcc, onByte?: (b: number) => void}} opts */
  constructor ({ rcc, onByte }) {
    this.base = 0x40013800;
    this.size = 0x400;
    this.rcc = rcc;
    this.onByte = onByte || (() => {});
    this.cr1 = 0; this.brr = 0;
    this.rx = [];
  }

  _enabled () {
    if (this.rcc.usart1Enabled()) return true;
    this.rcc.noteGated('USART1 accessed with its RCC clock off');
    return false;
  }

  read (off) {
    if (!this._enabled()) return 0;
    switch (off) {
      case 0x00: return this.cr1;
      case 0x0c: return this.brr;
      // ISR: TXE(7) + TC(6) always ready at this fidelity; RXNE(5) live
      case 0x1c: return 0xc0 | (this.rx.length ? 0x20 : 0);
      case 0x24: return this.rx.length ? this.rx.shift() : 0;
      default: return 0;
    }
  }

  write (off, v) {
    if (!this._enabled()) return;
    switch (off) {
      case 0x00: this.cr1 = v >>> 0; break;
      case 0x0c: this.brr = v >>> 0; break;
      case 0x28: if (this.cr1 & 1) this.onByte(v & 0xff); break; // TDR, UE gate
      default: break;
    }
  }

  feed (byte) { this.rx.push(byte & 0xff); }
}

/**
 * Assemble the F030 board onto a CortexM0Machine: RCC, GPIOA/B, TIM3,
 * USART1. Returns the peripheral instances for adapters and tests.
 */
export function attachStm32F0 (machine, { onPinChange, onSerialByte } = {}) {
  const rcc = new Stm32Rcc();
  const gpioA = new Stm32Gpio({ base: 0x48000000, portIndex: 0, portLetter: 'A', rcc, onPinChange });
  const gpioB = new Stm32Gpio({ base: 0x48000400, portIndex: 1, portLetter: 'B', rcc, onPinChange });
  const tim3 = new Stm32Tim3({ rcc, clockHz: machine.clockHz });
  const usart1 = new Stm32Usart1({ rcc, onByte: onSerialByte });
  for (const p of [rcc, gpioA, gpioB, tim3, usart1]) machine.addPeripheral(p);
  return { rcc, gpioA, gpioB, tim3, usart1 };
}
