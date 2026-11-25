// SPDX-License-Identifier: MIT
/** Passive command observations over the one real 8049/8155 machine. */
import {CP1_SEMANTIC_PROFILES} from './cp1-semantic-profiles.js';

const integer = (value, max) => Number.isSafeInteger(value) && value >= 0 && value <= max;
const copy = value => value && typeof value === 'object'
  ? Array.isArray(value) ? value.map(copy) : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
  : value;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Custom profiles are explicit, data-only inputs; a ROM name never qualifies one. */
export function validateCp1SemanticProfile(candidate) {
  const fail = () => { throw new TypeError('Invalid hash-qualified CP1 semantic profile'); };
  if (!candidate || candidate.version !== 1 || typeof candidate.id !== 'string' ||
      !candidate.id.length || candidate.id.length > 128 || !/^[a-f0-9]{40}$/.test(candidate.romSha1) ||
      typeof candidate.evidence !== 'string' || !candidate.evidence.length || candidate.evidence.length > 1024) fail();
  const registers = candidate.registers;
  if (!registers || !integer(registers.pc, 127) ||
      !integer(registers.accumulator?.opcode, 127) || !integer(registers.accumulator?.operand, 127) ||
      registers.accumulator.opcode === registers.accumulator.operand ||
      !integer(candidate.commandBoundary, 2047) || !integer(candidate.monitorBoundary, 2047) ||
      candidate.commandBoundary === candidate.monitorBoundary || !Array.isArray(candidate.haltOpcodes) ||
      candidate.haltOpcodes.length > 256 || !candidate.haltOpcodes.every(opcode => integer(opcode, 255))) fail();
  if (registers.comparison !== undefined && (!integer(registers.comparison.address, 127) ||
      !integer(registers.comparison.mask, 255) || registers.comparison.mask === 0 ||
      typeof registers.comparison.label !== 'string')) fail();
  const display = candidate.errorDisplay;
  if (display !== undefined && (!integer(display.indicatorAddress, 127) || !integer(display.indicatorValue, 127) ||
      !Array.isArray(display.digitAddresses) || display.digitAddresses.length !== 3 ||
      !display.digitAddresses.every(addr => integer(addr, 127)) || !Array.isArray(display.digitMasks) ||
      display.digitMasks.length !== 10 || !display.digitMasks.every(mask => integer(mask, 127)) ||
      new Set(display.digitMasks).size !== 10)) fail();
  // Construct only supported fields, rather than preserving executable or unknown input.
  return freeze({
    version: 1, id: candidate.id, romSha1: candidate.romSha1, evidence: candidate.evidence,
    registers: {pc: registers.pc, accumulator: {opcode: registers.accumulator.opcode, operand: registers.accumulator.operand},
      ...(registers.comparison === undefined ? {} : {comparison: {
        address: registers.comparison.address, mask: registers.comparison.mask, label: registers.comparison.label,
      }})},
    commandBoundary: candidate.commandBoundary, monitorBoundary: candidate.monitorBoundary,
    haltOpcodes: candidate.haltOpcodes.slice(),
    ...(display === undefined ? {} : {errorDisplay: {
      indicatorAddress: display.indicatorAddress, indicatorValue: display.indicatorValue,
      digitAddresses: display.digitAddresses.slice(), digitMasks: display.digitMasks.slice(),
    }}),
  });
}

export function createCp1SemanticObserver(machine, {profiles = CP1_SEMANTIC_PROFILES} = {}) {
  if (!Array.isArray(profiles) || profiles.length > 64) throw new TypeError('CP1 semantic profiles must be a bounded array');
  const qualified = new Map(profiles.map(candidate => {
    const profile = validateCp1SemanticProfile(candidate);
    return [profile.romSha1, profile];
  }));
  if (qualified.size !== profiles.length) throw new TypeError('Duplicate CP1 semantic ROM profile');
  let identity = null, profile = null, execution = 'unknown', active = null;
  let before = null, terminalSignature = null, lastEvent = null;
  let sequence = 0, boundaryId = 0, epoch = 0;
  const listeners = new Set();

  function resetObservation() {
    active = before = terminalSignature = lastEvent = null;
    execution = 'unknown';
    epoch++;
  }
  function refreshProfile() {
    if (identity === machine.romProfile) return;
    identity = machine.romProfile;
    profile = qualified.get(identity.sha1) ?? null;
    resetObservation();
  }
  function registers() {
    const ram = machine.cpu.ram;
    const refs = profile.registers;
    return {
      pc: ram[refs.pc],
      accumulator: {opcode: ram[refs.accumulator.opcode], operand: ram[refs.accumulator.operand]},
      ...(refs.comparison === undefined ? {} : {comparison: {
        label: refs.comparison.label, value: !!(ram[refs.comparison.address] & refs.comparison.mask),
      }}),
    };
  }
  function point() {
    if (!profile || machine.cpu.interruptInProgress) return null;
    if (machine.cpu.pc === profile.commandBoundary) return 'command';
    if (machine.cpu.pc === profile.monitorBoundary) return 'monitor';
    return null;
  }
  function readCommand(pc) {
    return integer(pc, machine.capacity - 1) ? {address: pc, ...machine.readCell(pc)} : null;
  }
  function armBoundary() {
    const state = registers();
    active = {id: ++boundaryId, started: false, command: readCommand(state.pc),
      accumulatorBefore: state.accumulator, startCycles: machine.cycles};
    execution = 'ready';
  }
  function errorState() {
    const display = profile.errorDisplay;
    if (!display || (machine.cpu.ram[display.indicatorAddress] & 0x7f) !== display.indicatorValue) return null;
    const digits = display.digitAddresses.map(addr => machine.cpu.ram[addr] & 0x7f);
    const values = digits.map(mask => display.digitMasks.indexOf(mask));
    return {code: values.some(value => value < 0) ? null : values[0] * 100 + values[1] * 10 + values[2], digits};
  }
  function emit(kind, details) {
    const event = freeze({type: `cp1.${kind}`, kind, sequence: ++sequence,
      profileId: profile.id, romSha1: profile.romSha1, rawPc: machine.cpu.pc,
      cycles: machine.cycles, tNs: BigInt(Math.round(machine.tMs * 1e6)),
      ...registers(), ...details});
    lastEvent = event;
    for (const listener of [...listeners]) listener(event);
  }
  function completion(pending, outcome) {
    return {command: pending.command, accumulatorBefore: pending.accumulatorBefore,
      startCycles: pending.startCycles, commandCycles: machine.cycles - pending.startCycles, outcome};
  }
  function afterStep() {
    if (before?.point === 'command' && machine.cpu.lastStep?.kind !== 'interrupt' && active && !active.started) {
      active.started = true;
      active.startCycles = before.cycles;
      terminalSignature = null;
      execution = 'running';
    }
    const current = point();
    if (current === 'command') {
      const finished = active?.started ? active : null;
      if (!active || finished) armBoundary();
      if (finished) emit('command', completion(finished, 'completed'));
    } else if (current === 'monitor') {
      const pending = active?.started ? active : null;
      const error = errorState();
      const signature = error ? `error:${error.code}:${error.digits.join(',')}` : 'monitor';
      active = null;
      execution = error ? 'error' : 'halted';
      const changed = terminalSignature !== signature;
      terminalSignature = signature;
      if (error && (pending || changed)) emit('error', {error, command: pending?.command ?? null});
      else if (pending) {
        const hlt = pending.command && profile.haltOpcodes.includes(pending.command.opcode);
        // A generic monitor return may be STEP or STP. Only an observed HLT is
        // counted as a completed command; do not guess that an interrupted one finished.
        if (hlt) emit('command', completion(pending, 'halted'));
        emit('halt', {reason: hlt ? 'hlt' : 'monitor', command: pending.command});
      }
    } else if (active?.started) execution = 'running';
    before = null;
  }

  refreshProfile();
  if (profile && point() === 'command') armBoundary();
  const unsubscribe = machine.addExecutionListener(event => {
    refreshProfile();
    if (event.kind === 'program-edit') {
      // Editing during an unfinished command invalidates its attribution. A
      // command-boundary edit is safe and is re-read before its first instruction.
      if (active?.started) resetObservation();
      return;
    }
    if (event.kind !== 'before-step' && event.kind !== 'step') { resetObservation(); return; }
    if (!profile) return;
    if (event.kind === 'before-step') {
      const current = point();
      if (current === 'command' && !active) armBoundary();
      if (current === 'command' && !active.started) {
        const state = registers();
        active.command = readCommand(state.pc);
        active.accumulatorBefore = state.accumulator;
      }
      before = {point: current, cycles: machine.cycles};
    } else afterStep();
  });

  return {
    controlState() {
      refreshProfile();
      const current = point();
      if (current === 'command' && !active) armBoundary();
      return {available: !!profile, epoch, execution: current === 'monitor'
        ? errorState() ? 'error' : 'halted' : execution,
      atCommandBoundary: current === 'command', boundaryId: active?.id ?? null,
      pc: profile ? machine.cpu.ram[profile.registers.pc] : null};
    },
    snapshot() {
      refreshProfile();
      if (!profile) return {
        available: false, profileQualified: false, romSha1: identity.sha1, profileId: null,
        reason: 'No qualified semantic profile for this exact ROM; 8049 debugging remains available.',
        execution: 'unknown', sequence, epoch, lastEvent: null,
      };
      const current = point();
      const state = registers();
      if (current === 'command' && !active) armBoundary();
      return {available: true, profileQualified: true, profileId: profile.id, romSha1: profile.romSha1,
        ...state, execution: current === 'monitor' ? errorState() ? 'error' : 'halted' : execution,
        atCommandBoundary: current === 'command',
        command: copy(current === 'command' && !active?.started ? readCommand(state.pc) : active?.command ?? null),
        boundaryId: active?.id ?? null, epoch, sequence, lastEvent: copy(lastEvent)};
    },
    onEvent(listener) {
      if (typeof listener !== 'function') throw new TypeError('CP1 event listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    destroy() { unsubscribe(); listeners.clear(); active = before = null; },
  };
}
