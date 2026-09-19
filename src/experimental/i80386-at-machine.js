import {I8086Machine, PCAT80286_BOOT_640K} from '../i8086-machine.js';
import ExperimentalI80386 from './i80386.js';

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
    return decoded < this.memoryBytes ? this._read(decoded) : 0xff;
  }

  _write386(address, value) {
    const decoded = this._decode386(address);
    if (decoded < this.memoryBytes) this._write(decoded, value);
  }

  loadRom(bytes, at = 0xffff0000) {
    if (at === 0xffff0000) return super.loadRom(bytes, 0xff0000);
    return super.loadRom(bytes, at);
  }

  _in386(port, width) {
    if (![8, 16, 32].includes(width)) throw new Error(`unsupported 386 I/O width ${width}`);
    let value = 0;
    for (let byte = 0; byte < width / 8; byte++) value |= this._in((port + byte) & 0xffff) << (byte * 8);
    return value >>> 0;
  }

  _out386(port, value, width) {
    if (![8, 16, 32].includes(width)) throw new Error(`unsupported 386 I/O width ${width}`);
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
    if (!this._pic || !this._pic.intActive || !(cpu.eflags & 0x200) || cpu._interruptShadow) return false;
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
    const executed = !this.cpu.halted && !this.cpu.shutdown;
    const cycles = super.step();
    if (!executed || cycles !== 1 || this.functionalInstructionCycles === 1) return cycles;
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
  // deterministic four clocks per completed instruction.
  functionalInstructionCycles: 4,
  // The installed memory remains the AT profile's sparse 640KiB + 512KiB.
  // The reset ROM alias is decoded by the adapter without a 4GiB allocation.
});

export default ExperimentalI80386ATMachine;
