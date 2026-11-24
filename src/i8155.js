// SPDX-License-Identifier: MIT
/**
 * Independently authored Intel 8155 functional model.
 * Hardware references and intentional limits: docs/CP1-HARDWARE.md.
 * No historical emulator implementation or ROM is included.
 */

const PORTS = ['a', 'b', 'c'];
const WIDTH = { a: 0xff, b: 0xff, c: 0x3f };

function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
}

function portName(port) {
  const name = String(port).toLowerCase().replace(/^p/, '');
  if (!PORTS.includes(name)) throw new RangeError('8155 port must be A, B, or C');
  return name;
}

export class Unsupported8155ModeError extends Error {
  constructor(command) {
    super(`8155 strobed port mode is not implemented (command 0x${command.toString(16).padStart(2, '0')})`);
    this.name = 'Unsupported8155ModeError';
    this.command = command;
  }
}

export class Intel8155 {
  constructor(options = {}) {
    this.onPortChange = options.onPortChange ?? null;
    this.onTimerOutput = options.onTimerOutput ?? null;
    this.readPortInput = options.readPort ?? (() => 0xff);
    this.ram = new Uint8Array(256);
    this.output = { a: 0, b: 0, c: 0 };
    this.command = 0;
    this.timerReload = 0;
    this.timerLength = 0;
    this.timerMode = 0;
    this.timerRemaining = 0;
    this.timerRunning = false;
    this.timerOutput = 1;
    this.timerFlag = false;
    this.timerPendingStart = false;
    this.timerStopAfterTerminal = false;
    this.timerReleasePulse = false;
    this.resetAsserted = false;
    this.addressLatch = 0;
    this.ioLatch = false;
    this.selectedLatch = false;
    this.capabilities = Object.freeze({
      ram: true, basicPorts: true, strobedPorts: false,
      timerWaveforms: true,
      timerCountReadback: 'remaining-pulses; not the silicon phase-encoded count',
    });
  }

  /** Hardware RESET clears I/O control and latches, not RAM or count/mode. */
  reset() {
    this.command = 0;
    this.output.a = this.output.b = this.output.c = 0;
    this.timerRunning = false;
    this.timerFlag = false;
    this.timerPendingStart = false;
    this.timerStopAfterTerminal = false;
    this.timerReleasePulse = false;
    this.selectedLatch = false;
    this._setTimerOutput(1);
    for (const port of PORTS) this._publish(port);
  }

  /** Deterministic simulator power-on values; physical uninitialised RAM is unspecified. */
  powerCycle(fill = 0) {
    integer(fill, 0, 255, 'RAM fill');
    this.ram.fill(fill);
    this.timerReload = this.timerLength = this.timerMode = this.timerRemaining = 0;
    this.addressLatch = 0;
    this.ioLatch = false;
    this.resetAsserted = false;
    this.reset();
  }

  setReset(asserted) {
    const next = !!asserted;
    if (next && !this.resetAsserted) this.reset();
    this.resetAsserted = next;
  }

  isOutput(port) {
    const name = portName(port);
    return name === 'a' ? !!(this.command & 1)
      : name === 'b' ? !!(this.command & 2)
        : (this.command & 0x0c) === 0x0c;
  }

  getPortState(port) {
    const name = portName(port);
    const mask = WIDTH[name];
    const input = Number(this.readPortInput(name)) & mask;
    const output = this.isOutput(name);
    return {
      value: output ? this.output[name] : input,
      latch: this.output[name], input,
      direction: output ? 'output' : 'input',
      drivenMask: output ? mask : 0,
      width: name === 'c' ? 6 : 8,
    };
  }

  _publish(port) {
    if (this.onPortChange) this.onPortChange(port, this.getPortState(port));
  }

  /** Falling ALE captures all three bus qualifiers, including chip select. */
  latchAddress(address, ioMode, selected = true) {
    this.addressLatch = integer(address, 0, 255, '8155 address');
    this.ioLatch = !!ioMode;
    this.selectedLatch = !!selected;
  }

  readLatched() {
    if (!this.selectedLatch || this.resetAsserted) return 0xff;
    return this.ioLatch ? this.readIO(this.addressLatch) : this.ram[this.addressLatch];
  }

  writeLatched(value) {
    integer(value, 0, 255, '8155 data');
    if (!this.selectedLatch || this.resetAsserted) return;
    if (this.ioLatch) this.writeIO(this.addressLatch, value);
    else this.ram[this.addressLatch] = value;
  }

  readMemory(address) { return this.ram[integer(address, 0, 255, '8155 RAM address')]; }
  writeMemory(address, value) {
    const at = integer(address, 0, 255, '8155 RAM address');
    this.ram[at] = integer(value, 0, 255, '8155 RAM data');
  }

  readIO(address) {
    integer(address, 0, 255, '8155 I/O address');
    switch (address & 7) {
      case 0: {
        const result = (this.timerFlag ? 0x40 : 0) |
          ((this.command & 0x10) ? 0x04 : 0) | ((this.command & 0x20) ? 0x20 : 0);
        this.timerFlag = false;
        return result;
      }
      case 1: return this.getPortState('a').value;
      case 2: return this.getPortState('b').value;
      case 3: return this.getPortState('c').value;
      // A functional remaining-pulse count is intentional. The real device's
      // phase/decrement-by-two representation is a documented unsupported detail.
      case 4: return this.timerRemaining & 0xff;
      case 5: return ((this.timerRemaining >> 8) & 0x3f) | (this.timerMode << 6);
      default: return 0xff;
    }
  }

  writeIO(address, value) {
    integer(address, 0, 255, '8155 I/O address');
    integer(value, 0, 255, '8155 I/O data');
    switch (address & 7) {
      case 0: this.writeCommand(value); break;
      case 1: this._writePort('a', value); break;
      case 2: this._writePort('b', value); break;
      case 3: this._writePort('c', value); break;
      case 4: this.timerReload = (this.timerReload & 0xff00) | value; break;
      case 5: this.timerReload = (this.timerReload & 0x00ff) | (value << 8); break;
      default: break;
    }
  }

  _writePort(port, value) {
    // The Intel latch cannot be loaded while its port is an input.
    if (!this.isOutput(port)) return;
    const next = value & WIDTH[port];
    if (this.output[port] === next) return;
    this.output[port] = next;
    this._publish(port);
  }

  writeCommand(value) {
    integer(value, 0, 255, '8155 command');
    const pcMode = (value >> 2) & 3;
    if (pcMode === 1 || pcMode === 2) throw new Unsupported8155ModeError(value);
    const timerCommand = value >>> 6;
    if (timerCommand === 3 && (this.timerReload & 0x3fff) < 2) {
      throw new RangeError('8155 timer count must be 2..16383 before START');
    }
    const oldDirections = PORTS.map(port => this.isOutput(port));
    this.command = value;
    PORTS.forEach((port, i) => {
      const output = this.isOutput(port);
      if (!output) this.output[port] = 0;
      if (oldDirections[i] !== output) this._publish(port);
    });
    if (timerCommand === 1) {
      this.timerRunning = false;
      this.timerPendingStart = false;
      this.timerStopAfterTerminal = false;
    } else if (timerCommand === 2) {
      if (this.timerRunning) this.timerStopAfterTerminal = true;
    } else if (timerCommand === 3) {
      this.timerStopAfterTerminal = false;
      if (this.timerRunning) this.timerPendingStart = true;
      else this._startTimer();
    }
  }

  _setTimerOutput(value) {
    if (this.timerOutput === value) return;
    this.timerOutput = value;
    if (this.onTimerOutput) this.onTimerOutput(value);
  }

  _startTimer() {
    this.timerLength = this.timerReload & 0x3fff;
    this.timerMode = this.timerReload >>> 14;
    this.timerRemaining = this.timerLength;
    this.timerRunning = true;
    this.timerPendingStart = false;
    this.timerStopAfterTerminal = false;
    this.timerReleasePulse = false;
    this.timerFlag = false;
    this._setTimerOutput(1);
  }

  /** Advance TIMER IN edges explicitly; the CP1 does not invent a timer clock. */
  clockTimer(pulses = 1) {
    integer(pulses, 0, 10000000, '8155 TIMER IN pulses');
    for (let pulse = 0; pulse < pulses; pulse++) {
      if (this.timerReleasePulse) {
        this.timerReleasePulse = false;
        this._setTimerOutput(1);
      }
      if (!this.timerRunning) continue;
      this.timerRemaining--;
      if (this.timerRemaining === 0) {
        this.timerFlag = true;
        if (this.timerMode >= 2) {
          this._setTimerOutput(0);
          this.timerReleasePulse = true;
        } else {
          this._setTimerOutput(1);
        }
        if (this.timerStopAfterTerminal) {
          this.timerRunning = false;
          this.timerPendingStart = false;
          this.timerStopAfterTerminal = false;
        } else if (this.timerPendingStart) {
          // Terminal count still latches status when a queued mode/count starts.
          this._startTimer();
          this.timerFlag = true;
        } else if (this.timerMode & 1) {
          this.timerRemaining = this.timerLength;
        } else {
          this.timerRunning = false;
        }
      } else if (this.timerMode < 2) {
        this._setTimerOutput(this.timerRemaining > Math.floor(this.timerLength / 2) ? 1 : 0);
      }
    }
  }

  saveState() {
    return {
      type: 'Intel8155', version: 1, ram: Array.from(this.ram), command: this.command,
      output: { ...this.output }, resetAsserted: this.resetAsserted,
      addressLatch: this.addressLatch, ioLatch: this.ioLatch, selectedLatch: this.selectedLatch,
      timerReload: this.timerReload, timerLength: this.timerLength, timerMode: this.timerMode,
      timerRemaining: this.timerRemaining, timerRunning: this.timerRunning,
      timerOutput: this.timerOutput, timerFlag: this.timerFlag,
      timerPendingStart: this.timerPendingStart,
      timerStopAfterTerminal: this.timerStopAfterTerminal, timerReleasePulse: this.timerReleasePulse,
    };
  }

  /** Validate the whole state before changing the live device. */
  loadState(state, { notify = true } = {}) {
    if (!state || state.type !== 'Intel8155' || state.version !== 1) throw new TypeError('Invalid 8155 state format');
    if (!Array.isArray(state.ram) || state.ram.length !== 256) throw new TypeError('8155 state RAM must have 256 bytes');
    const ram = Uint8Array.from(state.ram.map(v => integer(v, 0, 255, '8155 state RAM byte')));
    const command = integer(state.command, 0, 255, '8155 state command');
    if ([1, 2].includes((command >> 2) & 3)) throw new Unsupported8155ModeError(command);
    const output = {};
    for (const port of PORTS) {
      output[port] = integer(state.output?.[port], 0, WIDTH[port], `8155 state port ${port}`);
      const enabled = port === 'a' ? !!(command & 1) : port === 'b' ? !!(command & 2) : (command & 12) === 12;
      if (!enabled && output[port] !== 0) throw new RangeError('8155 input latch must be cleared');
    }
    const next = { command, output };
    for (const name of ['resetAsserted', 'ioLatch', 'selectedLatch', 'timerRunning', 'timerFlag', 'timerPendingStart', 'timerStopAfterTerminal', 'timerReleasePulse']) {
      if (typeof state[name] !== 'boolean') throw new TypeError(`8155 state ${name} must be boolean`);
      next[name] = state[name];
    }
    for (const [name, max] of [['addressLatch', 255], ['timerReload', 65535], ['timerLength', 16383], ['timerMode', 3], ['timerRemaining', 16383], ['timerOutput', 1]]) {
      next[name] = integer(state[name], 0, max, `8155 state ${name}`);
    }
    if (next.timerRemaining > next.timerLength || (next.timerRunning && (next.timerLength < 2 || next.timerRemaining === 0))) {
      throw new RangeError('Inconsistent 8155 timer state');
    }
    if (next.timerPendingStart && (!next.timerRunning || (next.timerReload & 0x3fff) < 2)) {
      throw new RangeError('Inconsistent 8155 pending timer START');
    }
    if (next.resetAsserted && (command !== 0 || next.timerRunning)) throw new RangeError('8155 held reset state has active controls');
    Object.assign(this, next);
    this.ram.set(ram);
    if (notify) {
      for (const port of PORTS) this._publish(port);
      if (this.onTimerOutput) this.onTimerOutput(this.timerOutput);
    }
  }
}

export default Intel8155;
