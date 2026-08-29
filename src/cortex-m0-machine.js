/**
 * A standalone ARMv6-M machine around rp2040js's Cortex-M0+ core — the
 * STM32-PATH.md Phase 0 deliverable, and the base every M0/M0+ part
 * (STM32F0/C0/G0, SAMD21, nRF51, and the F103-subset) builds on.
 *
 * The core's entire SoC surface is a bus: readUint8/16/32,
 * writeUint8/16/32, onBreak, logger (verified by grep against the
 * shipped cortex-m0-core.js — see STM32-PATH.md). This module IS that
 * bus: flash + SRAM + a peripheral dispatch table, with the honesty
 * rule taken (clean-room) from the reverse-engineering emulators: an
 * access nothing claims is NEVER a silent zero — it lands in
 * `unmapped`, and the census test asserts that list is empty for every
 * shipped program.
 *
 * Idle contract: the core sets `waiting` on WFI/WFE; advanceNs jumps a
 * waiting core to the nearest peripheral wake horizon (`nextWakeNs()`
 * per peripheral, veto by omission), the same shape as
 * m6502-machine._wakeHorizon and the z80 HALT jump.
 *
 * @module
 */

// Deep import by FILE PATH: rp2040js's `exports` map exposes only the
// package root, which does not re-export CortexM0Core. A relative path
// bypasses the map in Node; the lite bundle will need a webpack alias
// for the same reason (recorded in STM32-PATH.md Phase 1).
import { CortexM0Core } from '../node_modules/rp2040js/dist/esm/cortex-m0-core.js';

const FLASH_BASE_DEFAULT = 0x08000000; // where ST parts map flash
const SRAM_BASE = 0x20000000;

export class CortexM0Machine {
  /**
   * @param {object} [opts]
   * @param {number} [opts.clockHz] core clock (default 48 MHz, the F0 PLL top)
   * @param {number} [opts.flashBase] flash mapping (default STM32 0x08000000)
   * @param {number} [opts.flashBytes]
   * @param {number} [opts.sramBytes]
   */
  constructor(opts = {}) {
    this.clockHz = opts.clockHz ?? 48_000_000;
    this.flashBase = opts.flashBase ?? FLASH_BASE_DEFAULT;
    this.flash = new Uint8Array(opts.flashBytes ?? 64 * 1024);
    this.sram = new Uint8Array(opts.sramBytes ?? 16 * 1024);
    /** peripheral list: { base, size, read(offset), write(offset, value, size), advanceNs?, nextWakeNs? } */
    this.peripherals = [];
    /** accesses nothing claimed — the honesty ledger, never a silent zero */
    this.unmapped = [];
    this.timeNsInternal = 0n;
    this.stats = { instructions: 0, sleptNs: 0n };

    const machine = this;
    // The bus object the core sees — its whole world.
    const bus = {
      logger: { warn () {}, error () {}, info () {}, debug () {} },
      onBreak () { /* bkpt: the debug target hooks this later */ },
      readUint8 (addr) { return machine._read(addr, 1); },
      readUint16 (addr) { return machine._read(addr, 2); },
      readUint32 (addr) { return machine._read(addr, 4) >>> 0; },
      writeUint8 (addr, v) { machine._write(addr, v, 1); },
      writeUint16 (addr, v) { machine._write(addr, v, 2); },
      writeUint32 (addr, v) { machine._write(addr, v, 4); },
    };
    this.core = new CortexM0Core(bus);
    // Exposed for the debug target's write-watch wrap: the core calls
    // bus.writeUint8/16/32 through property lookup on THIS object, so
    // replacing a method here intercepts every store.
    this.bus = bus;

    // The System Control Space is CORE-side silicon (NVIC, VTOR): every
    // M0 firmware talks to it, so the machine provides it natively
    // rather than each board remembering to. SysTick and unimplemented
    // SCS registers land in the unmapped ledger like anything else.
    this.addPeripheral({
      base: 0xe000e000,
      size: 0x1000,
      read: (off) => {
        if (off === 0x100) return this.core.enabledInterrupts >>> 0;
        if (off === 0x200) return this.core.pendingInterrupts >>> 0;
        if (off === 0xd08) return this.core.VTOR >>> 0;
        this.unmapped.push({ rw: 'r', addr: 0xe000e000 + off, size: 4, t: this.timeNsInternal });
        return 0;
      },
      write: (off, v) => {
        if (off === 0x100) { this.core.enabledInterrupts |= v; this.core.interruptsUpdated = true; }
        else if (off === 0x180) this.core.enabledInterrupts &= ~v;
        else if (off === 0x280) this.core.pendingInterrupts &= ~v;
        else if (off === 0xd08) this.core.VTOR = v >>> 0;
        else this.unmapped.push({ rw: 'w', addr: 0xe000e000 + off, size: 4, value: v, t: this.timeNsInternal });
      }
    });
  }

  addPeripheral (p) { this.peripherals.push(p); }

  _find (addr) {
    for (const p of this.peripherals) {
      if (addr >= p.base && addr < p.base + p.size) return p;
    }
    return null;
  }

  _read (addr, size) {
    addr >>>= 0;
    if (addr >= this.flashBase && addr < this.flashBase + this.flash.length) {
      return this._readBytes(this.flash, addr - this.flashBase, size);
    }
    if (addr >= SRAM_BASE && addr < SRAM_BASE + this.sram.length) {
      return this._readBytes(this.sram, addr - SRAM_BASE, size);
    }
    // The M0's fixed-at-0 vector table: ST parts alias flash at 0 out
    // of reset; serving flash for low addresses is that aliasing.
    if (addr < this.flash.length) {
      return this._readBytes(this.flash, addr, size);
    }
    const p = this._find(addr);
    if (p) return p.read(addr - p.base, size) >>> 0;
    this.unmapped.push({ rw: 'r', addr, size, t: this.timeNsInternal });
    return 0;
  }

  _write (addr, value, size) {
    addr >>>= 0;
    if (addr >= SRAM_BASE && addr < SRAM_BASE + this.sram.length) {
      this._writeBytes(this.sram, addr - SRAM_BASE, value, size);
      return;
    }
    const p = this._find(addr);
    if (p) { p.write(addr - p.base, value >>> 0, size); return; }
    this.unmapped.push({ rw: 'w', addr, size, value, t: this.timeNsInternal });
  }

  _readBytes (mem, off, size) {
    let v = 0;
    for (let i = 0; i < size; i++) v |= mem[off + i] << (8 * i);
    return v >>> 0;
  }

  _writeBytes (mem, off, value, size) {
    for (let i = 0; i < size; i++) mem[off + i] = (value >>> (8 * i)) & 0xff;
  }

  /** Load a flat binary at the flash base and boot from its vector table
   *  (word 0 = initial SP, word 1 = reset handler — the real M0 boot). */
  loadFirmware (bytes) {
    this.flash.set(bytes.subarray(0, this.flash.length));
    this.core.VTOR = this.flashBase;
    this.core.SP = this._readBytes(this.flash, 0, 4);
    this.core.PC = this._readBytes(this.flash, 4, 4) & ~1;
  }

  timeNs () { return this.timeNsInternal; }

  /** Nearest peripheral wake in ns (Infinity when none) — the park
   *  horizon advanceNs and the debug target's execute loop share. */
  wakeHorizonNs () {
    let h = Infinity;
    for (const p of this.peripherals) {
      if (typeof p.nextWakeNs === 'function') h = Math.min(h, p.nextWakeNs(this));
    }
    return h;
  }

  /** Advance time and peripherals WITHOUT executing instructions — the
   *  debug target's park path. Applies the same level-triggered wake
   *  rule as advanceNs: an interrupt that pended before the WFI parked
   *  never edges again, so the tick must check the level or the debug
   *  loop sleeps through its own wake (the bug advanceNs already had). */
  tickNs (deltaNs) {
    const d = BigInt(Math.max(1, Math.round(deltaNs)));
    // Time BEFORE peripherals: a peripheral that publishes a pin edge
    // during its advance stamps it via machine.timeNs(), and the park
    // ends AT the edge (wake horizon) — so the slice-end time is the
    // edge's true time. The old order stamped every edge one park
    // early, which SWAPS an asymmetric PWM duty at the board.
    this.timeNsInternal += d;
    this._advancePeripherals(d);
    if (this.core.waiting && this.core.checkForInterrupts()) {
      this.core.waiting = false;
    }
  }

  /** Interrupt lines: pend IRQn on the core (level handled by callers). */
  setIrq (irq, value) { this.core.setInterrupt(irq, value); }

  advanceNs (deltaNs) {
    // BigInt OR Number. `timeNs()` on every adapter here returns a bigint, so a
    // host that computes its next slice from one and hands it back — which is
    // the natural thing to write, and what `labwired-adapter.js` accepts
    // without complaint — used to hit `Math.round(1_000_000n)` and throw
    // "Cannot convert a BigInt value to a number". That made the SAME host code
    // work on the heavy tier and die on the light one, which is precisely the
    // difference boundary A exists to erase.
    const target = this.timeNsInternal
      + (typeof deltaNs === 'bigint' ? deltaNs : BigInt(Math.round(deltaNs)));
    const nsPerCycle = 1e9 / this.clockHz;
    while (this.timeNsInternal < target) {
      if (this.core.waiting) {
        // Level-triggered wake, the core's own top-of-executeInstruction
        // rule applied here: an interrupt that PENDED BEFORE the WFI
        // parked never produces a later edge, so the park must check the
        // level or sleep through its own wake (measured: the tick ISR
        // ran 600 us late and the blink froze at 0.38x time).
        if (this.core.checkForInterrupts()) {
          this.core.waiting = false;
          continue;
        }
        // Jump a parked core to the nearest peripheral wake, the slice
        // end, or 1 ms — whichever is first. A peripheral that advances
        // time but offers no horizon would be a veto; Phase 0 has none.
        let wake = target;
        for (const p of this.peripherals) {
          if (typeof p.nextWakeNs === 'function') {
            const w = this.timeNsInternal + BigInt(Math.max(1, Math.round(p.nextWakeNs(this))));
            if (w < wake) wake = w;
          }
        }
        const cap = this.timeNsInternal + 1_000_000n;
        if (wake > cap) wake = cap;
        if (wake > target) wake = target;
        // Floor of 1 us: a peripheral may report "wake ready" while the
        // core stays parked (an interrupt pended but never NVIC-enabled
        // — the firmware bug this machine must survive, not hang on).
        // Sub-microsecond interrupt latency is below this fidelity.
        if (wake < this.timeNsInternal + 1000n) wake = this.timeNsInternal + 1000n;
        if (wake > target) wake = target;
        const slept = wake - this.timeNsInternal;
        this.stats.sleptNs += slept;
        // Time before peripherals — see tickNs: the park ends at a wake
        // horizon, so an edge published during this advance carries its
        // true time instead of the park's start.
        this.timeNsInternal = wake;
        this._advancePeripherals(slept);
        continue;
      }
      const cycles = this.core.executeInstruction();
      this.stats.instructions++;
      const ns = BigInt(Math.max(1, Math.round(cycles * nsPerCycle)));
      this.timeNsInternal += ns; // time first — same rule as the park path
      this._advancePeripherals(ns);
    }
  }

  _advancePeripherals (deltaNs) {
    for (const p of this.peripherals) {
      if (typeof p.advanceNs === 'function') p.advanceNs(deltaNs, this);
    }
  }
}

export default CortexM0Machine;
