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

import { stm32g0TemperatureVolts } from './chip-temperature.js';

// ── Power-on SRAM ─────────────────────────────────────────────────────
// SRAM is NOT zero at power-on: its cells settle to whatever each one
// favours. A program that never zeroes .bss (no startup code) reads that
// garbage on silicon; a simulator that hands it zeroes hides the bug. The
// fill is a deterministic LCG with every byte non-zero, so a missing .bss
// clear shows up the same way on every run.
export function fillPowerOnRam (sram, seed = 0x5eed_1234) {
  let x = seed >>> 0;
  for (let i = 0; i < sram.length; i++) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    sram[i] = (x >>> 24) || 0xa5;
  }
  return sram;
}

const AHB_DIV = [1, 1, 1, 1, 1, 1, 1, 1, 2, 4, 8, 16, 64, 128, 256, 512];
const APB_DIV = [1, 1, 1, 1, 2, 4, 8, 16];

// ── RCC clock tree, shared by both families ───────────────────────────
// Ready flags follow their enables after the datasheet start-up time, the
// system clock switch only completes onto a READY source (SWS follows SW
// then), and every consumer — the core's instruction rate, the timers'
// count rate, the USART's baud — asks this tree for its clock. A program
// that never configures the PLL therefore runs at the reset oscillator,
// exactly as on silicon.
class Stm32ClockTree {
  constructor ({ hseHz = 0, fixedClockHz = null } = {}) {
    this.hseHz = hseHz;               // 0: no crystal fitted — HSERDY never sets
    this.fixedClockHz = fixedClockHz; // legacy: every clock pinned (cross-sim parity only)
    /** accesses to peripherals whose clock was off — the teaching signal */
    this.gatedAccesses = [];
    /** clock-tree misconfiguration notes (switch to an unready source, too few
     *  flash wait states, PLL out of range) — a second teaching ledger */
    this.clockNotes = [];
    this.onClockChange = null;
    this._pending = {};               // ready flag -> ns still to wait
    this.sws = 0;                     // the source the switch actually selected
  }

  noteGated (what) { this.gatedAccesses.push(what); }
  noteClock (what) { if (this.clockNotes.at(-1) !== what) this.clockNotes.push(what); }

  _startReady (flag, ns) { this._pending[flag] = ns; this[flag] = false; }
  _dropReady (flag) { delete this._pending[flag]; this[flag] = false; }

  advanceNs (deltaNs) {
    let changed = false;
    for (const flag of Object.keys(this._pending)) {
      this._pending[flag] -= Number(deltaNs);
      if (this._pending[flag] <= 0) { delete this._pending[flag]; this[flag] = true; changed = true; }
    }
    if (changed) this._settle();
  }

  nextWakeNs () {
    let h = Infinity;
    for (const ns of Object.values(this._pending)) h = Math.min(h, Math.max(1, ns));
    return h;
  }

  /** Complete a pending clock switch when its source is ready, then publish. */
  _settle () {
    const want = this._swRequested();
    if (want !== this.sws && this._sourceReady(want)) this.sws = want;
    else if (want !== this.sws) this.noteClock(`system clock switch to ${this._sourceName(want)} waits: source not ready`);
    if (this.onClockChange) this.onClockChange();
  }

  hclkHz () {
    if (this.fixedClockHz) return this.fixedClockHz;
    return this.sysclkHz() / AHB_DIV[this._hpre()];
  }
  pclkHz () {
    if (this.fixedClockHz) return this.fixedClockHz;
    return this.hclkHz() / APB_DIV[this._ppre()];
  }
  /** Timers run at PCLK, doubled when the APB prescaler divides (RM0360 §6.2, RM0444 §5.2). */
  timerClockHz () {
    if (this.fixedClockHz) return this.fixedClockHz;
    return APB_DIV[this._ppre()] === 1 ? this.pclkHz() : 2 * this.pclkHz();
  }
}

// ── RCC, STM32F030 (RM0360 §6) ─────────────────────────────────────────
// Reset: HSI 8 MHz is the system clock. The PLL takes HSI/2 or HSE/PREDIV,
// multiplies by PLLMUL (2..16), and must be locked (PLLRDY) before SW=10
// takes effect. FLASH_ACR needs one wait state above 24 MHz.
export class Stm32Rcc extends Stm32ClockTree {
  static HSI_HZ = 8_000_000;
  static HSI_STARTUP_NS = 2_000;   // DS10235 tSU(HSI) max 2 µs
  static PLL_LOCK_NS = 200_000;    // DS10235 tLOCK max 200 µs
  static HSE_STARTUP_NS = 2_000_000;

  constructor (opts = {}) {
    super(opts);
    this.base = 0x40021000;
    this.size = 0x400;
    this.family = 'f0';
    this.cr = 0x80 | 1;  // HSITRIM=16, HSION; HSIRDY is the hsiRdy flag
    this.hsiRdy = true; this.hseRdy = false; this.pllRdy = false;
    this.cfgr = 0;       // 0x04
    this.cfgr2 = 0;      // 0x2C: PREDIV
    this.cfgr3 = 0;      // 0x30: USART1SW
    this.ahbenr = 0x14;  // 0x14: SRAMEN|FLITFEN at reset; GPIOA bit17, GPIOB 18, GPIOC 19
    this.apb1enr = 0;    // 0x1C: TIM3 bit1, TIM14 bit8
    this.apb2enr = 0;    // 0x18: USART1 bit14, ADC bit9
    this.other = new Map(); // registers stored without behaviour
    this.flashLatency = () => 1;
  }

  read (off) {
    switch (off) {
      case 0x00: return (this.cr & ~((1 << 1) | (1 << 17) | (1 << 25)))
        | (this.hsiRdy ? 1 << 1 : 0) | (this.hseRdy ? 1 << 17 : 0) | (this.pllRdy ? 1 << 25 : 0);
      case 0x04: return (this.cfgr & ~0xc) | (this.sws << 2);
      case 0x14: return this.ahbenr;
      case 0x18: return this.apb2enr;
      case 0x1c: return this.apb1enr;
      case 0x2c: return this.cfgr2;
      case 0x30: return this.cfgr3;
      default: return this.other.get(off) ?? 0;
    }
  }

  write (off, v) {
    v >>>= 0;
    switch (off) {
      case 0x00: this._writeCr(v); break;
      case 0x04: {
        // PLLSRC/PLLXTPRE/PLLMUL are frozen while the PLL runs (RM0360 §6.4.2)
        const pllBits = 0x003f8000;
        if (this.cr & (1 << 24)) v = (v & ~pllBits) | (this.cfgr & pllBits);
        this.cfgr = v & ~0xc;
        this._settle();
        break;
      }
      case 0x14: this.ahbenr = v; break;
      case 0x18: this.apb2enr = v; break;
      case 0x1c: this.apb1enr = v; break;
      case 0x2c: if (!(this.cr & (1 << 24))) this.cfgr2 = v & 0xf; break;
      case 0x30: this.cfgr3 = v; break;
      default: this.other.set(off, v); break;
    }
  }

  _writeCr (v) {
    const was = this.cr;
    // The running system clock source cannot be switched off.
    if (this.sws === 0) v |= 1;
    if (this.sws === 1) v |= 1 << 16;
    if (this.sws === 2) v |= 1 << 24;
    this.cr = v & ~((1 << 1) | (1 << 17) | (1 << 25));
    const rose = (bit) => !(was & (1 << bit)) && (v & (1 << bit));
    const fell = (bit) => (was & (1 << bit)) && !(v & (1 << bit));
    if (rose(0)) this._startReady('hsiRdy', Stm32Rcc.HSI_STARTUP_NS);
    if (fell(0)) this._dropReady('hsiRdy');
    if (rose(16) && this.hseHz) this._startReady('hseRdy', Stm32Rcc.HSE_STARTUP_NS);
    if (fell(16)) this._dropReady('hseRdy');
    if (rose(24)) {
      if (this._pllInputReady()) this._startReady('pllRdy', Stm32Rcc.PLL_LOCK_NS);
      else this.noteClock('PLLON set while the PLL input oscillator is not ready');
    }
    if (fell(24)) this._dropReady('pllRdy');
    this._settle();
  }

  _pllFromHse () { return ((this.cfgr >>> 15) & 3) === 2; }
  _pllInputReady () { return this._pllFromHse() ? this.hseRdy : this.hsiRdy; }
  pllHz () {
    const inHz = this._pllFromHse() ? this.hseHz / ((this.cfgr2 & 0xf) + 1) : Stm32Rcc.HSI_HZ / 2;
    const mul = Math.min(16, ((this.cfgr >>> 18) & 0xf) + 2);
    return inHz * mul;
  }
  _swRequested () { return this.cfgr & 3; }
  _sourceReady (sw) { return sw === 0 ? this.hsiRdy : sw === 1 ? this.hseRdy : sw === 2 ? this.pllRdy : false; }
  _sourceName (sw) { return ['HSI', 'HSE', 'PLL', 'HSI48'][sw]; }
  _hpre () { return (this.cfgr >>> 4) & 0xf; }
  _ppre () { return (this.cfgr >>> 8) & 7; }

  sysclkHz () {
    if (this.fixedClockHz) return this.fixedClockHz;
    if (this.sws === 1) return this.hseHz;
    if (this.sws === 2) {
      const hz = this.pllHz();
      if (hz > 48_000_000) this.noteClock(`PLL output ${hz / 1e6} MHz exceeds the F030's 48 MHz`);
      return hz;
    }
    return Stm32Rcc.HSI_HZ;
  }

  /** USART1 kernel clock: CFGR3.USART1SW (RM0360 §6.4.13). LSE is not fitted. */
  usart1ClockHz () {
    if (this.fixedClockHz) return this.fixedClockHz;
    switch (this.cfgr3 & 3) {
      case 0: return this.pclkHz();
      case 1: return this.sysclkHz();
      case 3: return this.hsiRdy ? Stm32Rcc.HSI_HZ : 0;
      default: return 0;
    }
  }

  /** Wait states the flash needs at the current HCLK (RM0360 §3.5.1). */
  requiredFlashLatency () { return this.hclkHz() > 24_000_000 ? 1 : 0; }

  gpioEnabled (portIndex) { return ((this.ahbenr >>> (17 + portIndex)) & 1) === 1; }
  tim3Enabled () { return ((this.apb1enr >>> 1) & 1) === 1; }
  tim14Enabled () { return (this.apb1enr >>> 8) & 1; }
  usart1Enabled () { return (this.apb2enr >>> 14) & 1; }
  adcEnabled () { return (this.apb2enr >>> 9) & 1; }
}

// ── RCC, STM32G030 (RM0444 §5) ─────────────────────────────────────────
// Reset: HSISYS = HSI16 / HSIDIV(1) = 16 MHz. The PLL takes HSI16 or HSE
// (PLLSRC), divides by M, multiplies by N (VCO 64..344 MHz) and PLLRCLK =
// VCO / R feeds the system clock (max 64 MHz). Enable bits live in IOPENR
// (0x34), APBENR1 (0x3C) and APBENR2 (0x40); the F0's AHBENR/APB2ENR/APB1ENR
// offsets are OTHER registers on this part (CRRCR, CIER, CIFR) and enable
// nothing. FLASH_ACR needs 1 wait state above 24 MHz and 2 above 48 MHz.
export class Stm32G0Rcc extends Stm32ClockTree {
  static HSI_HZ = 16_000_000;
  static HSI_STARTUP_NS = 2_000;   // DS12991 tSU(HSI16) max 2 µs (typ)
  static PLL_LOCK_NS = 40_000;     // DS12991 tLOCK max 40 µs
  static HSE_STARTUP_NS = 2_000_000;

  constructor (opts = {}) {
    super(opts);
    this.base = 0x40021000;
    this.size = 0x400;
    this.family = 'g0';
    this.cr = 1 << 8;        // HSION; HSIDIV=000
    this.hsiRdy = true; this.hseRdy = false; this.pllRdy = false;
    this.cfgr = 0;           // 0x08
    this.pllcfgr = 0x1000;   // 0x0C: reset PLLN=16
    this.ccipr = 0;          // 0x54: USART1SEL
    this.iopenr = 0;         // 0x34: GPIOA bit0, GPIOB 1, GPIOC 2
    this.ahbenr = 0x100;     // 0x38: FLASHEN at reset
    this.apbenr1 = 0;        // 0x3C: TIM3 bit1
    this.apbenr2 = 0;        // 0x40: SYSCFG 0, TIM1 11, SPI1 12, USART1 14, TIM14 15, TIM16 17, TIM17 18, ADC 20
    this.other = new Map();
  }

  read (off) {
    switch (off) {
      case 0x00: return (this.cr & ~((1 << 10) | (1 << 17) | (1 << 25)))
        | (this.hsiRdy ? 1 << 10 : 0) | (this.hseRdy ? 1 << 17 : 0) | (this.pllRdy ? 1 << 25 : 0);
      case 0x08: return (this.cfgr & ~0x38) | (this.sws << 3);
      case 0x0c: return this.pllcfgr;
      case 0x34: return this.iopenr;
      case 0x38: return this.ahbenr;
      case 0x3c: return this.apbenr1;
      case 0x40: return this.apbenr2;
      case 0x54: return this.ccipr;
      default: return this.other.get(off) ?? 0;
    }
  }

  write (off, v) {
    v >>>= 0;
    switch (off) {
      case 0x00: this._writeCr(v); break;
      case 0x08: this.cfgr = v & ~0x38; this._settle(); break;
      // PLLCFGR is written only while the PLL is off (RM0444 §5.4.4)
      case 0x0c: if (!(this.cr & (1 << 24))) this.pllcfgr = v; else this.noteClock('PLLCFGR written while PLLON: ignored'); break;
      case 0x34: this.iopenr = v; break;
      case 0x38: this.ahbenr = v; break;
      case 0x3c: this.apbenr1 = v; break;
      case 0x40: this.apbenr2 = v; break;
      case 0x54: this.ccipr = v; break;
      default: this.other.set(off, v); break;
    }
  }

  _writeCr (v) {
    const was = this.cr;
    if (this.sws === 0) v |= 1 << 8;
    if (this.sws === 1) v |= 1 << 16;
    if (this.sws === 2) v |= 1 << 24;
    this.cr = v & ~((1 << 10) | (1 << 17) | (1 << 25));
    const rose = (bit) => !(was & (1 << bit)) && (v & (1 << bit));
    const fell = (bit) => (was & (1 << bit)) && !(v & (1 << bit));
    if (rose(8)) this._startReady('hsiRdy', Stm32G0Rcc.HSI_STARTUP_NS);
    if (fell(8)) this._dropReady('hsiRdy');
    if (rose(16) && this.hseHz) this._startReady('hseRdy', Stm32G0Rcc.HSE_STARTUP_NS);
    if (fell(16)) this._dropReady('hseRdy');
    if (rose(24)) {
      const src = this.pllcfgr & 3;
      const ready = src === 2 ? this.hsiRdy : src === 3 ? this.hseRdy : false;
      if (ready) this._startReady('pllRdy', Stm32G0Rcc.PLL_LOCK_NS);
      else this.noteClock('PLLON set with no ready PLL source (PLLCFGR.PLLSRC)');
    }
    if (fell(24)) this._dropReady('pllRdy');
    this._settle();
  }

  hsisysHz () { return Stm32G0Rcc.HSI_HZ / (1 << ((this.cr >>> 11) & 7)); }
  pllVcoHz () {
    const src = this.pllcfgr & 3;
    const inHz = src === 2 ? Stm32G0Rcc.HSI_HZ : src === 3 ? this.hseHz : 0;
    const m = ((this.pllcfgr >>> 4) & 7) + 1;
    const n = (this.pllcfgr >>> 8) & 0x7f;
    return inHz / m * n;
  }
  pllRHz () {
    const r = ((this.pllcfgr >>> 29) & 7) + 1;
    if (!((this.pllcfgr >>> 28) & 1)) return 0; // PLLREN off: no R output
    return this.pllVcoHz() / r;
  }
  _swRequested () { return this.cfgr & 7; }
  _sourceReady (sw) {
    if (sw === 0) return this.hsiRdy;
    if (sw === 1) return this.hseRdy;
    if (sw === 2) return this.pllRdy && this.pllRHz() > 0;
    return false; // LSI/LSE not modelled
  }
  _sourceName (sw) { return ['HSISYS', 'HSE', 'PLLRCLK', 'LSI', 'LSE'][sw] ?? `SW=${sw}`; }
  _hpre () { return (this.cfgr >>> 8) & 0xf; }
  _ppre () { return (this.cfgr >>> 12) & 7; }

  sysclkHz () {
    if (this.fixedClockHz) return this.fixedClockHz;
    if (this.sws === 1) return this.hseHz;
    if (this.sws === 2) {
      const vco = this.pllVcoHz(); const hz = this.pllRHz();
      if (vco < 64e6 || vco > 344e6) this.noteClock(`PLL VCO ${vco / 1e6} MHz outside 64..344 MHz`);
      if (hz > 64e6) this.noteClock(`PLLRCLK ${hz / 1e6} MHz exceeds the G030's 64 MHz`);
      return hz;
    }
    return this.hsisysHz();
  }

  /** USART1 kernel clock: CCIPR.USART1SEL (RM0444 §5.4.21). LSE is not fitted. */
  usart1ClockHz () {
    if (this.fixedClockHz) return this.fixedClockHz;
    switch (this.ccipr & 3) {
      case 0: return this.pclkHz();
      case 1: return this.sysclkHz();
      case 2: return this.hsiRdy ? Stm32G0Rcc.HSI_HZ : 0;
      default: return 0;
    }
  }

  /** Wait states the flash needs at the current HCLK (RM0444 §3.3.4, range 1). */
  requiredFlashLatency () {
    const h = this.hclkHz();
    return h > 48_000_000 ? 2 : h > 24_000_000 ? 1 : 0;
  }

  gpioEnabled (portIndex) { return ((this.iopenr >>> portIndex) & 1) === 1; }
  tim3Enabled () { return ((this.apbenr1 >>> 1) & 1) === 1; }
  tim14Enabled () { return (this.apbenr2 >>> 15) & 1; }
  usart1Enabled () { return (this.apbenr2 >>> 14) & 1; }
  adcEnabled () { return (this.apbenr2 >>> 20) & 1; }
}

// ── FLASH interface: ACR wait states only ──────────────────────────────
// Clock-raising firmware writes FLASH_ACR.LATENCY first; too few wait states
// for HCLK reads garbage on silicon. That cannot be emulated faithfully, so it
// is ledgered in rcc.clockNotes. Every other FLASH register lands in the
// machine's unmapped ledger.
export class Stm32Flash {
  constructor ({ rcc, machine, family = 'f0' }) {
    this.base = 0x40022000;
    this.size = 0x400;
    this.rcc = rcc;
    this.machine = machine;
    this.family = family;
    this.acr = family === 'g0' ? 0x0004_0600 : 0x30;
  }
  latency () { return this.acr & 7; }
  check () {
    const need = this.rcc.requiredFlashLatency();
    if (this.latency() < need) {
      this.rcc.noteClock(`FLASH_ACR.LATENCY=${this.latency()} too low for HCLK ${this.rcc.hclkHz() / 1e6} MHz (needs ${need})`);
    }
  }
  read (off) {
    if (off === 0) return this.acr;
    this.machine.unmapped.push({ rw: 'r', addr: this.base + off, size: 4, t: this.machine.timeNsInternal });
    return 0;
  }
  write (off, v) {
    if (off === 0) {
      v >>>= 0;
      // F0: PRFTBS (bit 5) mirrors PRFTBE (bit 4)
      this.acr = this.family === 'f0' ? (v & ~0x20) | ((v & 0x10) << 1) : v;
      return;
    }
    this.machine.unmapped.push({ rw: 'w', addr: this.base + off, size: 4, value: v, t: this.machine.timeNsInternal });
  }
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
  constructor ({ base, portIndex, portLetter, rcc, onPinChange, onInputRead }) {
    this.base = base;
    // Called before IDR is read, so an adapter can bring the board up to the
    // core's time when a device changed a level on its own (an echo ending).
    this.onInputRead = onInputRead || null;
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
    /** peripherals that own AF pads re-check their routing on MODER/AFR writes */
    this.onConfigChange = [];
  }

  /** The pad is in alternate-function mode with exactly this AF number. */
  routesAf (pin, af) {
    if (((this.moder >>> (2 * pin)) & 3) !== 2) return false;
    const afr = pin < 8 ? this.afrl : this.afrh;
    return ((afr >>> (4 * (pin & 7))) & 0xf) === af;
  }

  _configChanged () { for (const f of this.onConfigChange) f(); }

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
        if (this.onInputRead) this.onInputRead();
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
      case 0x00: this.moder = v >>> 0; this._publishAll(); this._configChanged(); break;
      // OTYPER republishes: it changes the pad's DRIVE, not its level, so it
      // produces no edge of its own. Written BEFORE MODER (the usual idiom)
      // the following MODER write would republish anyway; written to a pin
      // that is ALREADY an output — make it an output, then make it open
      // drain — nothing else ever would, and the pad would keep its push-pull
      // description forever. Same class of miss as the PUPDR one on 0x0c.
      case 0x04: this.otyper = v >>> 0; this._publishAll(); break;
      case 0x0c: this.pupdr = v >>> 0; this._publishAll(); break;
      case 0x14: this.odr = v & 0xffff; this._publishAll(); break;
      case 0x18: { // BSRR: low half sets, high half resets — atomic on silicon
        this.odr = ((this.odr | (v & 0xffff)) & ~((v >>> 16) & 0xffff)) & 0xffff;
        this._publishAll();
        break;
      }
      case 0x20: this.afrl = v >>> 0; this._configChanged(); break;
      case 0x24: this.afrh = v >>> 0; this._configChanged(); break;
      default: break;
    }
  }

  /**
   * Describe every pad to the board: MODER picks input vs output, OTYPER
   * picks push-pull vs open drain, PUPDR the pull.
   *
   * OPEN DRAIN IS NOT A WEAKER PUSH-PULL — it is half a driver. Driving 0
   * pulls the pad to ground through the SAME on-resistance push-pull uses;
   * driving 1 simply lets go, and the pad is HIGH-Z. Nothing on the chip
   * decides its level then: an LED to ground stays dark and an external
   * pull-up is what makes the pad high, through THAT resistor. When PUPDR
   * also asks for the internal pull-up, the released pad is not floating but
   * weakly pulled — which is exactly `pin-model.js`'s `quasi` (weak pull-up
   * high, strong pull-down low), so that mode is reused rather than a
   * seventh one invented.
   *
   * A push-pull output ignores PUPDR here on purpose: silicon keeps the pull
   * connected, but a ~40 kΩ pull beside a 25 Ω driver moves nothing a solver
   * can see, and publishing it would only make the two tiers describe the
   * same pad differently.
   */
  _publishAll () {
    for (let pin = 0; pin < 16; pin++) {
      const mode = (this.moder >>> (2 * pin)) & 3;
      const name = `P${this.portLetter}${pin}`;
      if (mode === 1) {
        const high = ((this.odr >>> pin) & 1) === 1;
        if ((this.otyper >>> pin) & 1) {
          // Open drain. A pull-DOWN on a released open-drain pad would need a
          // Thévenin the pin model does not carry; it is not an idiom anyone
          // writes, so it floats and is ledgered (LABWIRED-BRIDGE.md §6).
          const pull = (this.pupdr >>> (2 * pin)) & 3;
          this.onPinChange(name, pull === 1 ? 'quasi' : 'opendrain', high);
        } else {
          this.onPinChange(name, 'pushpull', high);
        }
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
  /** TIM3's compare channels this package routes to header pins:
   *  CH1=PA6, CH2=PA7, CH4=PB1 (AF1) — the codegen's PWM vocabulary. */
  static PWM_PINS = { 1: 'PA6', 2: 'PA7', 4: 'PB1' };

  /** @param {{rcc: Stm32Rcc, clockHz: number|(() => number), irq?: number,
   *           onPinChange?: (pin: string, mode: string, high: boolean) => void,
   *           pinRouted?: (pin: string) => boolean}} opts
   *  clockHz: a fixed count clock, or a function asking the RCC tree.
   *  pinRouted: the board's AF check; a compare output reaches its pad only
   *  while that pad is in AF mode with AF1. Absent (a bare unit), every
   *  channel counts as routed. */
  constructor ({ rcc, clockHz, irq = 16, onPinChange, pinRouted }) {
    this.base = 0x40000400;
    this.size = 0x400;
    this.rcc = rcc;
    this._clk = typeof clockHz === 'function' ? clockHz : () => clockHz;
    this.pinRouted = pinRouted || (() => true);
    this.irq = irq;
    this.onPinChange = onPinChange || (() => {});
    this.cr1 = 0; this.dier = 0; this.sr = 0;
    this.psc = 0; this.arr = 0xffff; this.cnt = 0;
    this.ccmr1 = 0; this.ccmr2 = 0; this.ccer = 0;
    this.ccr = [0, 0, 0, 0, 0]; // 1-indexed, [0] unused
    this._pwmLevel = {};        // channel -> last published level
    this._accNs = 0;
  }

  /** PWM mode 1, upcounting (the only OCxM this model speaks): the pad
   *  is high while CNT < CCR. OCxM lives in CCMR1 (ch1/2) or CCMR2
   *  (ch3/4), bits 6:4 low byte / 14:12 high byte; 110 = PWM mode 1. */
  _pwmActive (ch) {
    if (!((this.ccer >>> (4 * (ch - 1))) & 1)) return false; // CCxE
    const ccmr = ch <= 2 ? this.ccmr1 : this.ccmr2;
    const mode = (ccmr >>> ((ch % 2 === 1) ? 4 : 12)) & 7;
    return mode === 6 && (ch in Stm32Tim3.PWM_PINS);
  }

  get clockHz () { return this._clk(); }

  _publishPwm () {
    for (const ch of [1, 2, 4]) {
      if (!this._pwmActive(ch)) continue;
      // Not AF1 on its pad: the compare runs but nothing leaves the chip.
      // Forget the level so routing it later publishes the current one.
      if (!this.pinRouted(Stm32Tim3.PWM_PINS[ch])) { delete this._pwmLevel[ch]; continue; }
      const level = this.cnt < this.ccr[ch];
      if (this._pwmLevel[ch] !== level) {
        this._pwmLevel[ch] = level;
        this.onPinChange(Stm32Tim3.PWM_PINS[ch], 'pushpull', level);
      }
    }
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
      case 0x18: return this.ccmr1;
      case 0x1c: return this.ccmr2;
      case 0x20: return this.ccer;
      case 0x24: return this.cnt;
      case 0x28: return this.psc;
      case 0x2c: return this.arr;
      case 0x34: return this.ccr[1];
      case 0x38: return this.ccr[2];
      case 0x3c: return this.ccr[3];
      case 0x40: return this.ccr[4];
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
      case 0x18: this.ccmr1 = v >>> 0; this._publishPwm(); break;
      case 0x1c: this.ccmr2 = v >>> 0; this._publishPwm(); break;
      case 0x20: this.ccer = v >>> 0; this._publishPwm(); break;
      case 0x24: this.cnt = v & 0xffff; break;
      case 0x28: this.psc = v & 0xffff; break;
      case 0x2c: this.arr = v & 0xffff; break;
      case 0x34: this.ccr[1] = v & 0xffff; this._publishPwm(); break;
      case 0x38: this.ccr[2] = v & 0xffff; this._publishPwm(); break;
      case 0x3c: this.ccr[3] = v & 0xffff; break;
      case 0x40: this.ccr[4] = v & 0xffff; this._publishPwm(); break;
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
      this._publishPwm();
    }
    machine.setIrq(this.irq, (this.sr & this.dier & 1) !== 0);
  }

  nextWakeNs () {
    if (!this._running()) return Infinity;
    const tickNs = 1e9 / (this.clockHz / (this.psc + 1));
    let horizon = Infinity;
    if (this.dier & 1) {
      if (this.sr & this.dier & 1) return 1;
      horizon = ((this.arr - this.cnt) + 1) * tickNs - this._accNs;
    }
    // A parked core must not glide past a PWM edge: the compare crossing
    // and the wrap are both wake horizons while any channel drives a pad
    // (the edge publishes from inside the park, and the machine stamps
    // time before advancing peripherals, so the edge time is exact).
    for (const ch of [1, 2, 4]) {
      if (!this._pwmActive(ch)) continue;
      const edges = [];
      if (this.cnt < this.ccr[ch] && this.ccr[ch] <= this.arr) edges.push(this.ccr[ch] - this.cnt);
      edges.push((this.arr - this.cnt) + 1); // the wrap re-raises the pad
      for (const e of edges) horizon = Math.min(horizon, e * tickNs - this._accNs);
    }
    return horizon === Infinity ? Infinity : Math.max(1, horizon);
  }
}

// ── TIM14 (RM0360 §17: 16-bit up-counter, update interrupt) ───────────
// The F030's spare timer: TIM3 is the generated code's 1 ms tick, so a
// program that needs a second, faster time base -- a tone's half-period --
// gets TIM14. Only what such a program uses is modelled: CR1.CEN, DIER.UIE,
// SR.UIF (rc_w0), EGR.UG, CNT, PSC, ARR; the update fires when CNT passes ARR
// and raises NVIC line 19 while UIE is set. Counting is arithmetic (whole
// periods per advance), so a 2 kHz tone costs nothing per count.
export class Stm32Tim14 {
  /** @param {{rcc: Stm32Rcc, clockHz: number|(() => number), irq?: number}} opts */
  constructor ({ rcc, clockHz, irq = 19 }) {
    this.base = 0x40002000;
    this.size = 0x400;
    this.rcc = rcc;
    this._clk = typeof clockHz === 'function' ? clockHz : () => clockHz;
    this.irq = irq;
    this.cr1 = 0; this.dier = 0; this.sr = 0;
    this.psc = 0; this.arr = 0xffff; this.cnt = 0;
    this._accNs = 0;
  }

  _enabled () {
    if (this.rcc.tim14Enabled()) return true;
    this.rcc.noteGated('TIM14 accessed with its RCC clock off');
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
      case 0x10: this.sr &= v >>> 0; break;            // rc_w0
      case 0x14: if (v & 1) { this.cnt = 0; this._accNs = 0; } break; // EGR.UG
      case 0x24: this.cnt = v & 0xffff; break;
      case 0x28: this.psc = v & 0xffff; break;
      case 0x2c: this.arr = v & 0xffff; break;
      default: break;
    }
  }

  get clockHz () { return this._clk(); }

  _running () { return (this.cr1 & 1) === 1 && this.rcc.tim14Enabled(); }
  _tickNs () { return 1e9 / (this.clockHz / (this.psc + 1)); }

  advanceNs (deltaNs, machine) {
    if (this._running()) {
      const tickNs = this._tickNs();
      this._accNs += Number(deltaNs);
      const ticks = Math.floor(this._accNs / tickNs);
      if (ticks > 0) {
        this._accNs -= ticks * tickNs;
        const period = this.arr + 1;
        const total = this.cnt + ticks;
        if (total >= period) this.sr |= 1;          // UIF: at least one update
        this.cnt = total % period;
      }
    }
    machine.setIrq(this.irq, (this.sr & this.dier & 1) !== 0);
  }

  nextWakeNs () {
    if (!this._running() || !(this.dier & 1)) return Infinity;
    if (this.sr & 1) return 1;
    return Math.max(1, ((this.arr - this.cnt) + 1) * this._tickNs() - this._accNs);
  }
}

// ── ADC (RM0360 §12: ISR/CR/CHSELR/DR, 12-bit) ────────────────────────
// The sample comes from the BOARD's solved node voltage via onAnalogRead
// (channel n = PA n), scaled against vref. Conversion completes at
// ADSTART — the emulator is exact and the firmware's EOC poll exits on
// its first read, which is the same observable behavior as a 1 µs
// conversion the tick grid cannot resolve anyway.
export class Stm32Adc {
  /** @param {{rcc: Stm32Rcc, onAnalogRead?: (ch: number) => number,
   *   onTemperature?: () => number, vref?: number}} opts */
  constructor ({ rcc, onAnalogRead, onTemperature, vref = 3.3 }) {
    this.base = 0x40012400;
    this.size = 0x400;
    this.rcc = rcc;
    this.onAnalogRead = onAnalogRead || (() => 0);
    // Channel 16 is the on-die temperature sensor, powered by ADC_CCR.TSEN.
    this.onTemperature = onTemperature || (() => 1.43);
    this.vref = vref;
    this.cr = 0; this.isr = 0; this.chselr = 0; this.dr = 0; this.ccr = 0;
  }

  _enabled () {
    if (this.rcc.adcEnabled()) return true;
    this.rcc.noteGated('ADC accessed with its RCC clock off');
    return false;
  }

  /** 16: the temperature sensor (0 V until TSEN powers it);
   *  17/18 (VREFINT, VBAT) are not modelled and read 0. */
  _channelVolts (ch) {
    if (ch < 16) return this.onAnalogRead(ch);
    return ch === 16 && (this.ccr & (1 << 23)) ? this.onTemperature() : 0;
  }

  _convert () {
    let ch = -1;
    for (let i = 0; i < 19; i++) if ((this.chselr >>> i) & 1) { ch = i; break; }
    if (ch >= 0) {
      const volts = this._channelVolts(ch);
      const counts = Math.round((Math.max(0, Math.min(this.vref, volts)) / this.vref) * 4095);
      this.dr = counts & 0xfff;
      this.isr |= (1 << 2);               // EOC
    }
    this.cr &= ~(1 << 2);                 // conversion done
  }

  read (off) {
    if (!this._enabled()) return 0;
    switch (off) {
      case 0x00: return this.isr;
      case 0x08: return this.cr;
      case 0x28: return this.chselr;
      case 0x308: return this.ccr;
      case 0x40: { // DR: reading clears EOC, like the silicon
        this.isr &= ~(1 << 2);
        return this.dr;
      }
      default: return 0;
    }
  }

  write (off, v) {
    if (!this._enabled()) return;
    switch (off) {
      case 0x00: this.isr &= ~(v >>> 0); break; // rc_w1: write 1 clears
      case 0x08: {
        this.cr = v >>> 0;
        if (this.cr & 1) this.isr |= 1;         // ADEN -> ADRDY
        if (this.cr & (1 << 2)) this._convert(); // ADSTART: convert now
        break;
      }
      case 0x28: this.chselr = v >>> 0; break;
      case 0x308: this.ccr = v >>> 0; break;   // ADC_CCR: TSEN is bit 23
      default: break;
    }
  }
}

// ── ADC, STM32G030 (RM0444 §15) ───────────────────────────────────────
// Differs from the F0 where firmware notices: the ADC's internal voltage
// regulator (CR.ADVREGEN, bit 28) must be on for tADCVREG_STUP (20 µs,
// DS12991) before ADEN — ADEN written earlier does not take, and ADRDY never
// sets, so an init that skips the regulator or the wait hangs on ADRDY just
// as on silicon. Calibration (ADCAL) needs the regulator too and completes
// on its own. A conversion needs ADEN with ADRDY. The temperature sensor is
// channel 12 (VREFINT 13, VBAT 14 — not modelled, read 0).
export class Stm32G0Adc extends Stm32Adc {
  static VREG_STARTUP_NS = 20_000;

  constructor (opts) {
    super(opts);
    if (!opts.onTemperature) this.onTemperature = () => stm32g0TemperatureVolts(25);
    this.tempChannel = 12;
    this._vregNs = 0;           // how long the regulator has been on
  }

  _vregReady () { return (this.cr & (1 << 28)) !== 0 && this._vregNs >= Stm32G0Adc.VREG_STARTUP_NS; }

  advanceNs (deltaNs) {
    if (this.cr & (1 << 28)) this._vregNs += Number(deltaNs);
  }

  write (off, v) {
    if (off !== 0x08) { super.write(off, v); return; }
    if (!this._enabled()) return;
    v >>>= 0;
    const keep = this.cr;
    // ADVREGEN is writable only while ADEN=0; ADEN/ADSTART/ADCAL are set-only
    if (keep & 1) v = (v & ~(1 << 28)) | (keep & (1 << 28));
    if (!(v & (1 << 28))) this._vregNs = 0;
    this.cr = (v & ~(1 | (1 << 2) | (1 << 31))) | (keep & 1);
    if (v & (1 << 1)) { this.cr &= ~1; this.isr &= ~1; return; } // ADDIS
    if (v & (1 << 31)) {
      if (this._vregReady() && !(keep & 1)) this.isr |= 1 << 11; // EOCAL; ADCAL self-clears
      else this.rcc.noteGated('ADC calibration requested without a settled ADVREGEN regulator (or with ADEN set)');
    }
    if ((v & 1) && !(keep & 1)) {
      if (this._vregReady()) { this.cr |= 1; this.isr |= 1; }
      else this.rcc.noteGated('ADC ADEN set before ADVREGEN had settled (RM0444 §15.3: wait tADCVREG_STUP)');
    }
    if ((v & (1 << 2)) && (this.cr & 1) && (this.isr & 1)) this._convert();
  }

  _channelVolts (ch) {
    if (ch < 12) return this.onAnalogRead(ch);
    if (ch === this.tempChannel) return (this.ccr & (1 << 23)) ? this.onTemperature() : 0;
    return 0;
  }
}

// ── USART1 (the v2 peripheral: ISR/TDR/RDR, F0 and G0 alike) ─────────
// Transmission is timed: a byte moves TDR -> shift register and leaves
// 1 start + 8 data + stop bits later at the baud BRR sets from the USART
// kernel clock. Nothing shifts until UE and TE are set and BRR is valid
// (>= 16); TXE/TC report the real state, so a program that does not wait
// for TXE overwrites its own bytes, as on silicon. A frame reaches the wire
// (onByte) only when a TX pad is in AF mode with the USART's AF number;
// otherwise it shifts out into nothing and is counted in lostTx.
export class Stm32Usart1 {
  /** @param {{rcc: Stm32Rcc, onByte?: (b: number) => void,
   *    txRouted?: () => boolean}} opts
   *  txRouted: the board's AF check; absent (a bare unit) the pad counts as routed. */
  constructor ({ rcc, onByte, txRouted }) {
    this.base = 0x40013800;
    this.size = 0x400;
    this.rcc = rcc;
    this.onByte = onByte || (() => {});
    this.txRouted = txRouted || (() => true);
    this.cr1 = 0; this.cr2 = 0; this.brr = 0;
    this.rx = [];
    this.tdr = null;     // byte waiting in TDR (TXE = tdr === null)
    this.shift = null;   // byte in the shift register, or 'idle' for TE's idle frame
    this.shiftNs = 0;    // time left on the frame in the shift register
    this.tc = true;
    this.lostTx = 0;
  }

  _enabled () {
    if (this.rcc.usart1Enabled()) return true;
    this.rcc.noteGated('USART1 accessed with its RCC clock off');
    return false;
  }

  /** Baud from BRR and the kernel clock (RM0360 §23.5.4 / RM0444 §27.5.7). */
  baud () {
    const fck = this.rcc.usart1ClockHz ? this.rcc.usart1ClockHz() : 0;
    if (!fck || this.brr < 16) return 0;
    if (this.cr1 & (1 << 15)) { // OVER8
      const div = (this.brr & 0xfff0) | ((this.brr & 7) << 1);
      return div ? 2 * fck / div : 0;
    }
    return fck / this.brr;
  }

  frameNs () {
    const baud = this.baud();
    if (!baud) return Infinity;
    const m = ((this.cr1 >>> 27) & 2) | ((this.cr1 >>> 12) & 1); // M1:M0
    const data = m === 1 ? 9 : m === 2 ? 7 : 8;
    const stop = ((this.cr2 >>> 12) & 3) === 2 ? 2 : 1;
    return (1 + data + stop) * 1e9 / baud;
  }

  _canShift () { return (this.cr1 & 1) && (this.cr1 & (1 << 3)) && this.baud() > 0; }

  _load () {
    if (this.shift === null && this.tdr !== null) {
      this.shift = this.tdr; this.tdr = null; this.shiftNs = this.frameNs(); this.tc = false;
    }
  }

  read (off) {
    if (!this._enabled()) return 0;
    switch (off) {
      case 0x00: return this.cr1;
      case 0x04: return this.cr2;
      case 0x0c: return this.brr;
      case 0x1c: {
        const ue = this.cr1 & 1;
        return (this.tdr === null ? 0x80 : 0) | (this.tc ? 0x40 : 0) | (this.rx.length ? 0x20 : 0)
          | (ue && (this.cr1 & 8) ? 1 << 21 : 0) | (ue && (this.cr1 & 4) ? 1 << 22 : 0);
      }
      case 0x24: return this.rx.length ? this.rx.shift() : 0;
      default: return 0;
    }
  }

  write (off, v) {
    if (!this._enabled()) return;
    switch (off) {
      case 0x00: {
        const teRose = !(this.cr1 & 8) && (v & 8) && (v & 1);
        this.cr1 = v >>> 0;
        if (!(this.cr1 & 1)) { this.tdr = null; this.shift = null; this.tc = true; break; }
        // Setting TE sends one idle frame before the first byte (RM0360 §23.5.2)
        if (teRose && this.shift === null) { this.shift = 'idle'; this.shiftNs = this.frameNs(); this.tc = false; }
        break;
      }
      case 0x04: this.cr2 = v >>> 0; break;
      case 0x0c: this.brr = v & 0xffff; break;
      case 0x20: if (v & (1 << 6)) this.tc = false; break; // ICR.TCCF
      case 0x28: // TDR, UE gate
        if (!(this.cr1 & 1)) break;
        this.tdr = v & 0xff; this.tc = false;
        if (this._canShift()) this._load();
        break;
      default: break;
    }
  }

  advanceNs (deltaNs) {
    let d = Number(deltaNs);
    while (d > 0 && this._canShift()) {
      this._load();
      if (this.shift === null) break;
      if (!Number.isFinite(this.shiftNs)) this.shiftNs = this.frameNs();
      if (d < this.shiftNs) { this.shiftNs -= d; break; }
      d -= this.shiftNs;
      const b = this.shift;
      this.shift = null;
      if (b !== 'idle') {
        if (this.txRouted()) this.onByte(b);
        else { this.lostTx++; this.rcc.noteGated('USART1 TX frame sent with no TX pad in its AF mode'); }
      }
      this._load();
      if (this.shift === null) this.tc = true;
    }
  }

  nextWakeNs () {
    if (this.shift === null || !this._canShift()) return Infinity;
    return Math.max(1, Number.isFinite(this.shiftNs) ? this.shiftNs : this.frameNs());
  }

  feed (byte) { this.rx.push(byte & 0xff); }
}

// Which pads carry what, per family (DS10235 Table 12 / DS12991 Table 13).
const F0_LAYOUT = {
  gpioBase: 0x48000000,
  usartTx: [['A', 9, 1], ['A', 2, 1], ['B', 6, 0]],
};
const G0_LAYOUT = {
  gpioBase: 0x50000000,   // IOPORT (RM0444 §2.2); 0x48000000 is reserved here
  usartTx: [['A', 9, 1], ['B', 6, 0], ['C', 4, 1]],
};

function attachStm32 (machine, family, {
  onPinChange, onSerialByte, onAnalogRead, onTemperature, onInputRead,
  fixedClockHz = null, hseHz = 0, ramAtReset = 'pattern',
} = {}) {
  const layout = family === 'g0' ? G0_LAYOUT : F0_LAYOUT;
  const rcc = family === 'g0' ? new Stm32G0Rcc({ fixedClockHz, hseHz }) : new Stm32Rcc({ fixedClockHz, hseHz });
  const flash = new Stm32Flash({ rcc, machine, family });
  const mk = (i, letter) => new Stm32Gpio({ base: layout.gpioBase + 0x400 * i, portIndex: i, portLetter: letter, rcc, onPinChange, onInputRead });
  const gpioA = mk(0, 'A'); const gpioB = mk(1, 'B'); const gpioC = mk(2, 'C');
  const ports = { A: gpioA, B: gpioB, C: gpioC };
  const padRoutes = (name, af) => {
    const port = ports[name[1]]; const pin = Number(name.slice(2));
    return !!port && port.routesAf(pin, af);
  };
  // TIM3 CH1/CH2/CH4 are AF1 on PA6/PA7/PB1 on both families.
  const tim3 = new Stm32Tim3({ rcc, clockHz: () => rcc.timerClockHz(), onPinChange, pinRouted: (pin) => padRoutes(pin, 1) });
  const tim14 = new Stm32Tim14({ rcc, clockHz: () => rcc.timerClockHz() });
  const adc = family === 'g0'
    ? new Stm32G0Adc({ rcc, onAnalogRead, onTemperature })
    : new Stm32Adc({ rcc, onAnalogRead, onTemperature });
  const usart1 = new Stm32Usart1({
    rcc, onByte: onSerialByte,
    txRouted: () => layout.usartTx.some(([p, pin, af]) => padRoutes(`P${p}${pin}`, af)),
  });
  for (const g of [gpioA, gpioB, gpioC]) g.onConfigChange.push(() => tim3._publishPwm());

  // The core runs at HCLK. Following it here is what makes a program that
  // never configures the PLL run at 8 / 16 MHz, like silicon.
  rcc.onClockChange = () => { machine.setClockHz(rcc.hclkHz()); flash.check(); };
  rcc.onClockChange();

  if (ramAtReset === 'pattern') fillPowerOnRam(machine.sram);
  else if (ramAtReset === 'zero') machine.sram.fill(0);
  else throw new TypeError(`ramAtReset must be 'pattern' or 'zero', got ${ramAtReset}`);

  for (const p of [rcc, flash, gpioA, gpioB, gpioC, tim3, tim14, adc, usart1]) machine.addPeripheral(p);
  return { rcc, flash, gpioA, gpioB, gpioC, tim3, tim14, adc, usart1 };
}

/**
 * Assemble the F030 board onto a CortexM0Machine: RCC clock tree, FLASH_ACR,
 * GPIOA/B/C at 0x48000000, TIM3, TIM14, ADC, USART1. SRAM gets its power-on
 * pattern (ramAtReset: 'zero' models a warm debugger reset instead).
 * fixedClockHz pins every clock (legacy; only for cross-simulator parity with
 * a model that has no clock tree). Returns the peripheral instances.
 */
export function attachStm32F0 (machine, opts = {}) { return attachStm32(machine, 'f0', opts); }

/**
 * The G030 is NOT an F030 at a different speed: its own RCC (IOPENR/APBENR1/
 * APBENR2, HSI16, PLLCFGR), GPIO on the IOPORT bus at 0x50000000, and the
 * G0 ADC (ADVREGEN, sensor on channel 12). Same options as attachStm32F0.
 */
export function attachStm32G0 (machine, opts = {}) { return attachStm32(machine, 'g0', opts); }
