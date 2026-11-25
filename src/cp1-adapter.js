// SPDX-License-Identifier: MIT
// Boundary A: a single Cp1Machine owns CPU, peripherals, display and elapsed time.
import { Cp1Machine } from './cp1-machine.js';

function nanoseconds(value, label) {
  const number = typeof value === 'bigint' ? Number(value) : value;
  if (!Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER) {
    throw new RangeError(`${label} must be a nonnegative, safely representable nanosecond duration`);
  }
  return number;
}

export function createCp1Adapter(options = {}) {
  const machine = options.machine ?? new Cp1Machine(options);
  if (!(machine instanceof Cp1Machine)) throw new TypeError('CP1 adapter requires a Cp1Machine');
  let board = null;
  let unloggedInputs = false;
  let requestedNs = machine.tMs * 1000000;
  let lastOwnedCycles = machine.cycles;
  let lastBoardNs = null;
  let boardOffsetNs = 0n;
  let inputTopology = null;
  const stats = { pinChangeCount: 0, advanceToCount: 0, inputSampleCount: 0 };
  const prefix = options.partId ? `${options.partId}.` : '';
  const pinName = pin => prefix + pin;
  const timeNs = () => BigInt(Math.round(machine.tMs * 1000000));

  function adoptBoardClock() {
    // The designer's board can outlive an emulator instance. Keep debugger
    // time machine-relative and translate only at the electrical boundary.
    // Adoption also handles a designer advancing the board while this owner
    // is paused; it does not execute any CPU cycles to catch up.
    const actual = typeof board?.timeNs === 'bigint' ? board.timeNs : null;
    const machineNow = timeNs();
    if (actual !== null && actual > machineNow + boardOffsetNs) {
      boardOffsetNs = actual - machineNow;
    }
  }

  function isWiredInput(pin) {
    // BoardImpl returns digital zero for a missing net. An unused CP1 header
    // pin is electrically released, so that sentinel must not ground P1.
    // Opaque Boundary-A implementations have no topology; their explicit
    // readPin return value remains authoritative.
    if (!Array.isArray(board?.nets) || !Array.isArray(board?.parts)) return true;
    if (inputTopology?.nets !== board.nets || inputTopology?.parts !== board.parts) {
      const owner = options.partId ?? board.parts.find(part => part.kind === 'kosmos-cp1')?.id;
      const connected = new Set();
      if (owner !== undefined) {
        for (const net of board.nets) {
          const terminals = net.terminals ?? [];
          for (const terminal of terminals) {
            if (terminal.part !== owner) continue;
            if (terminals.some(other => other.part !== owner || other.terminal !== terminal.terminal)) {
              connected.add(String(terminal.terminal).toLowerCase());
            }
          }
        }
      }
      inputTopology = { nets: board.nets, parts: board.parts, owner, connected };
    }
    return inputTopology.owner === undefined || inputTopology.connected.has(pin.toLowerCase());
  }

  function advanceBoard(at = timeNs()) {
    if (!board?.advanceTo) return;
    const absolute = at + boardOffsetNs;
    if ((lastBoardNs !== null && absolute < lastBoardNs) ||
        (typeof board.timeNs === 'bigint' && absolute < board.timeNs)) {
      throw new Error('CP1 board time cannot run backwards; restore the board and machine together');
    }
    board.advanceTo(absolute);
    lastBoardNs = absolute;
    stats.advanceToCount++;
  }

  machine.addPortListener((port, state) => {
    if (!board) return;
    // A sampled net level is not an independent voltage source. Once a pin
    // becomes an output, discard its earlier input sample rather than report
    // that stale value as an opposed external driver.
    const keep = state.direction === 'output' ? 0
      : state.direction === 'quasi' ? state.externalDrivenMask & state.latch
        : state.externalDrivenMask;
    if (keep !== state.externalDrivenMask) machine.setPortInput(port, state.input, keep);
  });

  machine.addPinListener((pin, mode, high, tMs) => {
    if (!board) return;
    advanceBoard(BigInt(Math.round(tMs * 1000000)));
    board.setPin(pinName(pin), mode, high);
    stats.pinChangeCount++;
  });

  /** Read only pins whose peripheral permits external input. */
  function samplePort(port) {
    if (!board?.readPin) return;
    const state = machine.getPortState(port);
    if (!state.available || state.direction === 'output') return;
    advanceBoard();
    let value = 0, drivenMask = 0;
    for (let bit = 0; bit < state.width; bit++) {
      // A quasi pin whose latch is zero is an active sink, not a released input.
      if (state.direction === 'quasi' && !(state.latch & (1 << bit))) continue;
      const pin = `P${port}.${bit}`;
      if (!isWiredInput(pin)) continue;
      const level = board.readPin(pinName(pin));
      if (level === undefined || level === null || (typeof level === 'number' && !Number.isFinite(level))) continue;
      drivenMask |= 1 << bit;
      if (level) value |= 1 << bit;
      stats.inputSampleCount++;
    }
    machine.setPortInput(port, value, drivenMask);
  }

  const existingInputRead = machine.onPortInputRead;
  machine.onPortInputRead = (port, currentMachine) => {
    if (existingInputRead) existingInputRead(port, currentMachine);
    samplePort(port);
  };

  function syncInputs() {
    adoptBoardClock();
    for (let port = 1; port <= (machine.expansion ? 5 : 2); port++) samplePort(port);
  }

  function syncOwnership() {
    // A debugger may perform explicit instruction steps on this same machine.
    // Rebase scheduling credit when that owner advances it between adapter calls.
    if (machine.cycles !== lastOwnedCycles) requestedNs = machine.tMs * 1000000;
  }

  const adapter = {
    machine,
    clockHz: machine.clockHz,
    machineClockHz: machine.machineHz,
    stats,
    capabilities: Object.freeze({
      ...machine.capabilities,
      serial: false,
      boardPins: ['P1.0..P1.7', 'P2.0..P2.7', ...(machine.expansion ? ['P3.0..P3.7', 'P4.0..P4.7', 'P5.0..P5.5'] : [])],
      boardFloatingDetection: 'undefined/null samples preserve floating; boolean readPin cannot describe high impedance',
      electricalPinModel: 'shared Board quasi/pushpull Thevenin policy; not calibrated NMOS 8049 or 8155 I/V curves',
      boardTimeOrigin: 'machine-relative timeNs; existing board time is translated by an attachment offset',
    }),
    unloggedBoardInputs() { return unloggedInputs; },
    onSerial() {},
    sendSerial() { return false; },
    timeNs,
    syncInputs,

    attachBoard(nextBoard) {
      if (!nextBoard || typeof nextBoard.setPin !== 'function') throw new TypeError('CP1 board must implement setPin(name, mode, high)');
      board = nextBoard;
      inputTopology = null;
      unloggedInputs = typeof board.readPin === 'function';
      lastBoardNs = null;
      boardOffsetNs = 0n;
      adoptBoardClock();
      advanceBoard();
      machine.publishPins();
      syncInputs();
      lastOwnedCycles = machine.cycles;
      requestedNs = machine.tMs * 1000000;
      return this;
    },

    detachBoard() {
      board = null;
      unloggedInputs = false;
      lastBoardNs = null;
      boardOffsetNs = 0n;
      inputTopology = null;
    },

    advanceNs(deltaNs) {
      const duration = nanoseconds(deltaNs, 'CP1 elapsed time');
      syncOwnership();
      if (requestedNs + duration > Number.MAX_SAFE_INTEGER) throw new RangeError('CP1 requested time exceeds the safe nanosecond range');
      requestedNs += duration;
      syncInputs();
      const result = machine.advanceToMs(requestedNs / 1000000);
      lastOwnedCycles = machine.cycles;
      advanceBoard();
      return result;
    },

    advanceTo(targetNs) {
      const target = nanoseconds(targetNs, 'CP1 target time');
      syncOwnership();
      requestedNs = Math.max(requestedNs, target);
      syncInputs();
      const result = machine.advanceToMs(requestedNs / 1000000);
      lastOwnedCycles = machine.cycles;
      advanceBoard();
      return result;
    },

    step() {
      syncInputs();
      const cycles = machine.step();
      lastOwnedCycles = machine.cycles;
      requestedNs = machine.tMs * 1000000;
      advanceBoard();
      return cycles;
    },

    reset() {
      adoptBoardClock();
      machine.reset();
      requestedNs = machine.tMs * 1000000;
      lastOwnedCycles = machine.cycles;
      syncInputs();
    },

    loadRom(bytes) {
      adoptBoardClock();
      const profile = machine.loadRom(bytes);
      requestedNs = machine.tMs * 1000000;
      lastOwnedCycles = machine.cycles;
      syncInputs();
      return profile;
    },

    setKey(key, pressed, contact = 0) { machine.setKey(key, pressed, contact); },
    releaseKeys() { machine.releaseKeys(); },
    setPortInput(port, value, drivenMask) { machine.setPortInput(port, value, drivenMask); },
    snapshot(options) { return machine.snapshot(options); },
  };
  return adapter;
}

export const createKosmosCp1Adapter = createCp1Adapter;
export default createCp1Adapter;
