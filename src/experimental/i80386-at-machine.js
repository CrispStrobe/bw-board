import {I8086Machine, PCAT80286_BOOT_640K} from '../i8086-machine.js';
import ExperimentalI80386 from './i80386.js';
import ExperimentalATA16 from './ata16.js';
import VGAMemory from './vga-memory.js';

const MP_TABLE_BASE = 0x9fd00;
const MP_FLOAT_BASE = 0x9fc00;
const LAPIC_BASE = 0xfee00000;
const IOAPIC_BASE = 0xfec00000;

function xv6MpTable() {
  const bytes = new Uint8Array(0x200);
  const put16 = (at, value) => { bytes[at] = value & 0xff; bytes[at + 1] = value >>> 8; };
  const put32 = (at, value) => { put16(at, value); put16(at + 2, value >>> 16); };
  bytes.set(Buffer.from('PCMP'), 0);
  put16(4, 80); bytes[6] = 4; bytes[7] = 0;
  bytes.set(Buffer.from('BWXV6           '), 8);
  put32(28, 0); put16(32, 0); put16(34, 3); put32(36, LAPIC_BASE);
  put16(40, 0); bytes[42] = 0; bytes[43] = 0;
  let at = 44;
  bytes[at] = 0; bytes[at + 1] = 0; bytes[at + 2] = 0x14; bytes[at + 3] = 2; at += 20;
  bytes[at] = 1; bytes[at + 1] = 0; bytes.set(Buffer.from('ISA     '), at + 2); at += 8;
  bytes[at] = 2; bytes[at + 1] = 2; bytes[at + 2] = 0x11; bytes[at + 3] = 1; put32(at + 4, IOAPIC_BASE);
  let sum = 0; for (let i = 0; i < 80; i++) sum = (sum + bytes[i]) & 0xff; bytes[7] = (-sum) & 0xff;
  bytes.set(Buffer.from('_MP_'), 0x100); put32(0x104, MP_TABLE_BASE); bytes[0x108] = 1; bytes[0x109] = 4;
  sum = 0; for (let i = 0; i < 16; i++) sum = (sum + bytes[0x100 + i]) & 0xff; bytes[0x10a] = (-sum) & 0xff;
  return {float: bytes.slice(0x100, 0x110), config: bytes.slice(0, 80)};
}

/**
 * Opt-in bridge from the bounded 80386 executor to the existing AT devices.
 * The ordinary I8086Machine constructor and its hot path remain unchanged.
 */
export class ExperimentalI80386ATMachine extends I8086Machine {
  constructor(config = PCAT80386_EXPERIMENTAL, hooks = {}) {
    if (config.cpuBackend !== 'i80386-experimental')
      throw new Error("experimental 386 AT requires cpuBackend 'i80386-experimental'");
    const bootstrap = {...config, variant: '80286', cpuBackend: 'protected286-experimental'};
    super(bootstrap, hooks);
    this.config = config;
    this.variant = '80386';
    this.cpuBackend = 'i80386-experimental';
    this.functionalInstructionCycles = config.functionalInstructionCycles ?? 1;
    if (!Number.isInteger(this.functionalInstructionCycles) ||
        this.functionalInstructionCycles < 1 || this.functionalInstructionCycles > 16)
      throw new Error('experimental 386 functionalInstructionCycles must be 1 through 16');
    const bus = {
      read: address => this._read386(address),
      fetch: address => this._read386(address),
      write: (address, value) => this._write386(address, value),
      inPort: (port, width) => this._in386(port, width),
      outPort: (port, value, width) => this._out386(port, value, width),
    };
    this.cpu = new ExperimentalI80386(bus, {deliverFaults: true});
    this.cpu.onInterrupt = event => { if (this.hooks.onInterrupt) this.hooks.onInterrupt(event); };
    this.ata = null;
    this._xv6Mp = config.experimentalXv6Mp ? xv6MpTable() : null;
    this._mpReady = false;
    this._lapic = new Uint32Array(1024);
    this._lapicTimerNext = 0;
    this._lapicTimerInterval = 0;
    this._lapicTimerPending = false;
    this._ioapic = new Uint32Array(256);
    // Synthetic IOAPIC identity/version: ID 2 and 24 interrupt inputs, as
    // described by the MP table exposed to xv6.
    this._ioapic[0] = 2 << 24;
    this._ioapic[1] = (23 << 16) | 0x11;
    this._ioapicSelect = 0;
    this._apicIrq = new Uint8Array(24);
    this.vgaMemory = null;
    if (config.experimentalVgaMemory) {
      const vga = this.chips[config.experimentalVgaMemory];
      if (!vga) throw new Error(`experimental VGA memory names missing chip '${config.experimentalVgaMemory}'`);
      this.vgaMemory = new VGAMemory(vga);
    }
    if (hooks.ataImage !== undefined) {
      this.ata = new ExperimentalATA16(hooks.ataImage, hooks.ataGeometry ?? {
        cylinders: 306, heads: 4, sectors: 17,
      }, {
        onIRQ: active => {
          // Keep firmware diagnostics on the legacy PIC.  The BIOS does not
          // know about the synthetic MP/IOAPIC surface; switch ATA IRQ14 to
          // the APIC only once the table is published for the guest kernel.
          if (this._xv6Mp && this._mpReady && (this.cpu.cr0 & 1)) {
            // ATA presents an edge-like request. Latch the assertion until
            // IOAPIC arbitration consumes it; do not lose a short pulse when
            // the device deasserts before the next CPU boundary.
            if (active) this._apicIrq[14] = 1;
          }
          else this.chips.pic2?.setIRQ(6, active ? 1 : 0);
        },
        intersectorDelayCycles: hooks.ataIntersectorDelayCycles ?? 8192,
      });
      this.attachDevice('ata', this.ata);
    }
  }

  reset() {
    super.reset();
    this.ata?.reset();
    this.vgaMemory?.reset();
  }

  _gate386(address) {
    const value = address >>> 0;
    return this._a20Configured && !this._a20Enabled ? (value & ~0x100000) >>> 0 : value;
  }

  _decode386(address) {
    const gated = this._gate386(address);
    // IBM AT-compatible reset alias. It is decode, not address truncation:
    // unrelated addresses above 16MiB remain open bus.
    if (gated >= 0xffff0000) return 0xff0000 + (gated - 0xffff0000);
    return gated;
  }

  _read386(address) {
    const decoded = this._decode386(address);
    if (this._xv6Mp && this._mpReady && decoded >= MP_FLOAT_BASE && decoded < MP_FLOAT_BASE + 16)
      return this._xv6Mp.float[decoded - MP_FLOAT_BASE];
    if (this._xv6Mp && this._mpReady && decoded >= MP_TABLE_BASE && decoded < MP_TABLE_BASE + 80)
      return this._xv6Mp.config[decoded - MP_TABLE_BASE];
    if (this._xv6Mp && decoded >= LAPIC_BASE && decoded < LAPIC_BASE + 0x1000) {
      const offset = decoded - LAPIC_BASE;
      const index = offset >>> 2;
      // INIT/STARTUP delivery completes immediately in this single-CPU model.
      const value = index === 0x300 / 4 ? (this._lapic[index] & ~0x1000) : (this._lapic[index] ?? 0);
      return (value >>> ((offset & 3) * 8)) & 0xff;
    }
    if (this._xv6Mp && decoded >= IOAPIC_BASE && decoded < IOAPIC_BASE + 0x20) {
      const offset = decoded - IOAPIC_BASE;
      if (offset < 4) return (this._ioapicSelect >>> ((offset & 3) * 8)) & 0xff;
      if (offset >= 0x10 && offset < 0x14) {
        const value = this._ioapic[this._ioapicSelect] ?? 0;
        return (value >>> ((offset & 3) * 8)) & 0xff;
      }
      return 0;
    }
    const video = this.vgaMemory?.read(decoded);
    if (video !== undefined && video !== null) return video;
    return decoded < this.memoryBytes ? this._read(decoded) : 0xff;
  }

  _write386(address, value) {
    const decoded = this._decode386(address);
    if (this._xv6Mp && this._mpReady && ((decoded >= MP_FLOAT_BASE && decoded < MP_FLOAT_BASE + 16) ||
        (decoded >= MP_TABLE_BASE && decoded < MP_TABLE_BASE + 80))) return;
    if (this._xv6Mp && decoded >= LAPIC_BASE && decoded < LAPIC_BASE + 0x1000) {
      const offset = decoded - LAPIC_BASE;
      const index = offset >>> 2;
      const shift = (offset & 3) * 8;
      const mask = 0xff << shift;
      this._lapic[index] = ((this._lapic[index] & ~mask) | ((value & 0xff) << shift)) >>> 0;
      // xv6 programs a periodic timer with an initial count.  Model it in
      // board-cycle units; this is deterministic functional timing rather
      // than a claim about a particular bus frequency.
      if (index === 0x380 / 4) {
        this._lapicTimerInterval = this._lapic[index] >>> 0;
        this._lapicTimerNext = this.cycles + this._lapicTimerInterval;
        this._lapicTimerPending = false;
      } else if (index === 0x320 / 4 && (value & 0x10000)) {
        this._lapicTimerPending = false;
      }
      return;
    }
    if (this._xv6Mp && decoded >= IOAPIC_BASE && decoded < IOAPIC_BASE + 0x20) {
      const offset = decoded - IOAPIC_BASE;
      if (offset < 4) {
        const shift = (offset & 3) * 8;
        this._ioapicSelect = ((this._ioapicSelect & ~(0xff << shift)) | ((value & 0xff) << shift)) >>> 0;
      } else if (offset >= 0x10 && offset < 0x14) {
        const shift = (offset & 3) * 8;
        const old = this._ioapic[this._ioapicSelect] ?? 0;
        this._ioapic[this._ioapicSelect] = ((old & ~(0xff << shift)) | ((value & 0xff) << shift)) >>> 0;
      }
      return;
    }
    if (this.vgaMemory?.write(decoded, value)) {
      this.displayRevision = (this.displayRevision + 1) >>> 0;
      return;
    }
    if (decoded < this.memoryBytes) this._write(decoded, value);
  }

  loadRom(bytes, at = 0xffff0000) {
    if (at === 0xffff0000) return super.loadRom(bytes, 0xff0000);
    return super.loadRom(bytes, at);
  }

  _in386(port, width) {
    if (![8, 16, 32].includes(width)) throw new Error(`unsupported 386 I/O width ${width}`);
    if (this.ata && (port >= 0x1f0 && port <= 0x1f7 || port === 0x3f6)) this._flushChips();
    if (this.ata && port === 0x1f0) {
      if (width !== 16 && width !== 32)
        throw new Error('experimental ATA data register requires 16- or 32-bit I/O');
      const low = this.ata.readData16();
      const value = width === 32 ? (low | (this.ata.readData16() << 16)) >>> 0 : low;
      this.hooks.onPortAccess?.({dir: 'in', port, width, value});
      this._chipDeadline = this._wakeHorizon();
      return value;
    }
    if (this.ata && width === 8 && port >= 0x1f1 && port <= 0x1f7) {
      const value = this.ata.readRegister(port - 0x1f0);
      this.hooks.onPortAccess?.({dir: 'in', port, width, value});
      this._chipDeadline = this._wakeHorizon();
      return value;
    }
    if (this.ata && width === 8 && port === 0x3f6) {
      const value = this.ata.readRegister(7, {alternate: true});
      this.hooks.onPortAccess?.({dir: 'in', port, width, value});
      this._chipDeadline = this._wakeHorizon();
      return value;
    }
    let value = 0;
    for (let byte = 0; byte < width / 8; byte++) value |= this._in((port + byte) & 0xffff) << (byte * 8);
    return value >>> 0;
  }

  _out386(port, value, width) {
    if (![8, 16, 32].includes(width)) throw new Error(`unsupported 386 I/O width ${width}`);
    if (this.ata && (port >= 0x1f0 && port <= 0x1f7 || port === 0x3f6)) this._flushChips();
    if (this.ata && port === 0x1f0) {
      if (width !== 16 && width !== 32)
        throw new Error('experimental ATA data register requires 16- or 32-bit I/O');
      this.ata.writeData16(value & 0xffff);
      if (width === 32) this.ata.writeData16(value >>> 16);
      this.hooks.onPortAccess?.({dir: 'out', port, width,
        value: width === 32 ? value >>> 0 : value & 0xffff});
      this._chipDeadline = this._wakeHorizon();
      return;
    }
    if (this.ata && width === 8 && port >= 0x1f1 && port <= 0x1f7) {
      // The Rev1 BIOS performs its last RAM verification after drive
      // diagnostics (90h/91h). Publish the firmware MP table only when the
      // first actual boot-sector read is dispatched, so POST never sees it as
      // altered RAM.
      if (this._xv6Mp && port === 0x1f7 && (value & 0xff) === 0x20) this._mpReady = true;
      const taskValue = this.config.experimentalAtaSlaveAlias && port === 0x1f6
        ? (value & ~0x10) : value;
      this.ata.writeRegister(port - 0x1f0, taskValue);
      this.hooks.onPortAccess?.({dir: 'out', port, width, value: value & 0xff});
      this._chipDeadline = this._wakeHorizon();
      return;
    }
    if (this.ata && width === 8 && port === 0x3f6) {
      this.ata.writeRegister(7, value, {control: true});
      this.hooks.onPortAccess?.({dir: 'out', port, width, value: value & 0xff});
      this._chipDeadline = this._wakeHorizon();
      return;
    }
    for (let byte = 0; byte < width / 8; byte++)
      this._out((port + byte) & 0xffff, value >>> (byte * 8));
  }

  _serviceInterrupts() {
    const cpu = this.cpu;
    if (cpu.shutdown) return false;
    if (this._nmiPending && !this._nmiMasked && !cpu._nmiShadow && !cpu._nmiActive) {
      this._nmiPending = false;
      if (this.hooks.onInterrupt) this.hooks.onInterrupt({vector: 2, source: 'nmi'});
      cpu.interrupt(2, {nmi: true});
      return true;
    }
    if (this._xv6Mp && this._lapicTimerInterval && this.cycles >= this._lapicTimerNext) {
      const lvt = this._lapic[0x320 / 4] ?? 0;
      const svr = this._lapic[0x0f0 / 4] ?? 0;
      if (!(lvt & 0x10000) && (svr & 0x100)) this._lapicTimerPending = true;
      this._lapicTimerNext += this._lapicTimerInterval;
    }
    if (this._xv6Mp && this._lapicTimerPending && (cpu.eflags & 0x200) && !cpu._interruptShadow) {
      this._lapicTimerPending = false;
      const vector = (this._lapic[0x320 / 4] ?? 0) & 0xff;
      if (this.hooks.onInterrupt) this.hooks.onInterrupt({vector, source: 'lapic-timer'});
      cpu.interrupt(vector);
      return true;
    }
    // Firmware uses the 8259 during POST.  Once xv6 has taken the MP/APIC
    // handoff in protected mode, stale PIC edges must not leak into the
    // kernel as vectors 8/14; hardware IRQs are then arbitrated by IOAPIC.
    const apicMode = this._xv6Mp && this._mpReady && (cpu.cr0 & 1);
    if (this._xv6Mp && (cpu.eflags & 0x200) && !cpu._interruptShadow) {
      for (let irq = 0; irq < this._apicIrq.length; irq++) {
        if (!this._apicIrq[irq]) continue;
        const low = this._ioapic[0x10 + irq * 2] ?? 0;
        if (low & 0x10000) continue;
        this._apicIrq[irq] = 0;
        if (this.hooks.onInterrupt) this.hooks.onInterrupt({vector: low & 0xff, source: 'apic-irq', irq});
        cpu.interrupt(low & 0xff);
        return true;
      }
    }
    if (apicMode || !this._pic || !this._pic.intActive || !(cpu.eflags & 0x200) || cpu._interruptShadow) return false;
    let vector;
    if (this._picCascade && this._pic._serviceable() === this._picCascade.line && this._picCascade.slave.intActive) {
      this._pic.acknowledge();
      vector = this._picCascade.slave.acknowledge();
    } else vector = this._pic.acknowledge();
    if (this.hooks.onInterrupt) this.hooks.onInterrupt({vector, source: 'irq'});
    cpu.interrupt(vector);
    return true;
  }

  step() {
    const completedBefore = this.cpu.cycles;
    const cycles = super.step();
    // The core increments its counter only after a completed instruction.
    // This also detects an IRQ waking HLT and executing its first handler
    // instruction. A delivered fault that completed no instruction receives
    // no flat charge; a completed HLT does, while later idle horizons do not
    // move the core counter.
    const completed = this.cpu.cycles !== completedBefore;
    if (!completed || cycles !== 1 || this.functionalInstructionCycles === 1) return cycles;
    const extra = this.functionalInstructionCycles - 1;
    this.cycles += extra;
    this._chipDebt += extra;
    return this.functionalInstructionCycles;
  }

  enableI8088CycleTiming() {
    throw new Error('experimental 386 AT refuses 8088 cycle timing');
  }

  checkpointSupport() {
    return {supported: false, reasons: ['experimental 386 architectural state is not covered by the legacy machine checkpoint codec']};
  }

  captureCheckpoint() { return {ok: false, ...this.checkpointSupport()}; }
  restoreCheckpoint() { return {ok: false, ...this.checkpointSupport()}; }
  saveState() { throw new Error('experimental 386 AT checkpoint is unsupported'); }
  loadState() { throw new Error('experimental 386 AT checkpoint is unsupported'); }
  _architecturalRegisters() {
    throw new Error('experimental 386 AT legacy debug register snapshot is unsupported');
  }
}

export const PCAT80386_EXPERIMENTAL = Object.freeze({
  ...PCAT80286_BOOT_640K,
  variant: '80386',
  cpuBackend: 'i80386-experimental',
  // Functional device pacing only. The instruction executor does not yet
  // provide measured 80386 timings, so board time advances by a declared,
  // deterministic six clocks per completed instruction. This is a functional
  // board-scheduling charge, not a measured 80386 instruction timing claim.
  functionalInstructionCycles: 6,
  // The installed memory remains the AT profile's sparse 640KiB + 512KiB.
  // The reset ROM alias is decoded by the adapter without a 4GiB allocation.
});

/**
 * Opt-in 4MiB installed-RAM profile. The 16MiB address space is retained for
 * the original AT ROM aliases; only the declared RAM regions are writable.
 */
export const PCAT80386_EXPERIMENTAL_4M = Object.freeze({
  ...PCAT80386_EXPERIMENTAL,
  regions: PCAT80386_EXPERIMENTAL.regions.map(region =>
    region.kind === 'ram' && region.start === 0x100000
      ? {...region, end: 0x45ffff}
      : region),
  chips: PCAT80386_EXPERIMENTAL.chips.map(chip => chip.kind === 'rtc' ? {
    ...chip,
    // 640KiB conventional plus 3456KiB extended is exactly 4MiB installed.
    // The checksum covers CMOS registers 10h through 2Dh.
    initialCmos: [[0x10, 0x20], [0x14, 0x21], [0x15, 0x80], [0x16, 0x02],
      [0x17, 0x80], [0x18, 0x0d], [0x2e, 0x01], [0x2f, 0x50],
      [0x30, 0x80], [0x31, 0x0d], [0x32, 0x19]],
  } : chip),
});

/** IBM drive type 1 (306 cylinders, 4 heads, 17 sectors) in CMOS drive C. */
export const PCAT80386_EXPERIMENTAL_4M_HDD = Object.freeze({
  ...PCAT80386_EXPERIMENTAL_4M,
  chips: PCAT80386_EXPERIMENTAL_4M.chips.map(chip => chip.kind === 'rtc' ? {
    ...chip,
    initialCmos: [[0x10, 0x20], [0x12, 0x10], [0x14, 0x21],
      [0x15, 0x80], [0x16, 0x02], [0x17, 0x80], [0x18, 0x0d],
      [0x2e, 0x01], [0x2f, 0x60], [0x30, 0x80], [0x31, 0x0d], [0x32, 0x19]],
  } : chip),
});

/** Opt-in MP-table/LAPIC/IOAPIC surface for stock xv6's SMP bootstrap. */
export const PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP = Object.freeze({
  ...PCAT80386_EXPERIMENTAL_4M_HDD,
  experimentalXv6Mp: true,
  experimentalAtaSlaveAlias: true,
});

/** 16MiB installed-RAM profile for stock xv6's PHYSTOP (14MiB) build. */
export const PCAT80386_EXPERIMENTAL_16M_HDD_XV6_SMP = Object.freeze({
  ...PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP,
  regions: PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP.regions.map(region =>
    region.kind === 'ram' && region.start === 0x100000 ? {...region, end: 0xffffff} : region),
  chips: PCAT80386_EXPERIMENTAL_4M_HDD_XV6_SMP.chips.map(chip => chip.kind === 'rtc' ? {
    ...chip,
    initialCmos: [[0x10, 0x20], [0x12, 0x10], [0x14, 0x21],
      [0x15, 0x80], [0x16, 0x02], [0x17, 0x00], [0x18, 0x3c],
      [0x2e, 0x01], [0x2f, 0x0f], [0x30, 0x00], [0x31, 0x3c], [0x32, 0x19]],
  } : chip),
});

/** FreeDOS media profile: a 1.2MB disk in the AT high-capacity drive. */
export const PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS = Object.freeze({
  ...PCAT80386_EXPERIMENTAL_4M_HDD,
  chips: PCAT80386_EXPERIMENTAL_4M_HDD.chips.map(chip => chip.kind === 'fdc'
    ? {...chip,acceptedCcrByImageBytes:{1228800:[0]}} : chip),
});

/** Opt-in VGA board profile with external C000h option-ROM decode. */
export const PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS_VGA = Object.freeze({
  ...PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS,
  experimentalVgaMemory: 'vga1',
  regions: [
    ...PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS.regions.filter(region =>
      !(region.kind === 'ram' && region.start === 0xb8000)),
    {kind: 'rom', start: 0xc0000, end: 0xc7fff},
  ],
  chips: [
    ...PCAT80386_EXPERIMENTAL_4M_HDD_FREEDOS.chips
      .filter(chip => chip.kind !== 'cga')
      .map(chip => chip.kind === 'rtc' ? {...chip,
        initialCmos: chip.initialCmos.map(([index, value]) =>
          index === 0x14 ? [index, 0x01] : index === 0x2f ? [index, 0x40] : [index, value]),
      } : chip),
    {kind: 'vga', name: 'vga1', at: 0x3c0},
  ],
});

export default ExperimentalI80386ATMachine;
