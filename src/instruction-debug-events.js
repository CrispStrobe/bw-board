
/**
 * Instrument an instruction-atomic CPU without pretending that its individual
 * bus accesses have cycle timestamps. The instruction boundary is observed
 * directly; accesses are real, ordered evidence but share the instruction's
 * start time and are therefore explicitly reconstructed.
 *
 * WHERE THIS CAME FROM, AND WHY IT IS HERE NOW. It was written downstream, in a
 * consumer's copy of the vendored tree, and stayed there — the divergence
 * ledger recorded it as "forward-ported here and never upstreamed", which is a
 * history rather than a reason. It is 145 lines with no imports, and both of
 * its consumers are vendored files, so nothing kept it down there.
 *
 * TEN LEDGER ENTRIES TURNED OUT TO BE FIVE THINGS, and four of them were this
 * module. `debugTime()` stamping facts and checkpoints from one clock, and the
 * `instruction-retire` boundary a target advertises, were recorded as separate
 * per-file facts on two targets. They are one mechanism and a three-line
 * delegation, twice. The ledger even said so — one entry's own note reads "the
 * same mechanism as the Z80 target — named here separately because the gate is
 * per-file" — so ten rows looked like ten facts because ten rows is what a
 * per-file gate produces.
 *
 * THE CONTRACT IS NOT NEW TO THIS TREE, and that is the argument for the module
 * rather than against it. `avr8js-debug.js` already publishes the same event
 * shape — `{cpuId, kind: 'instruction', phase: 'retire', fidelity: 'recorded',
 * time}` for a retire, `{kind: 'device'|'memory', phase: 'access', fidelity:
 * 'reconstructed'}` for the accesses inside it — hand-rolled inline. This is
 * that contract with one implementation instead of two.
 *
 * TWO MEASURED DIFFERENCES FROM THAT INLINE INSTANCE, stated because a caller
 * meeting both will otherwise find them the hard way. Neither is changed here;
 * `avr8js-debug.js` is untouched by this commit.
 *
 *   MULTIPLICITY. `onDebugEvent` here accepts MANY listeners and returns an
 *   unsubscribe. The avr8js target accepts ONE and THROWS
 *   `'the AVR debug event listener is already attached'` on a second. Same
 *   method name, different contract — a driver written against either breaks on
 *   the other. The many-listener form is the one that matches the replay
 *   surface's `onDebugInput` on all four targets, which is why it is the shape
 *   that travelled.
 *
 *   THE EPOCH. This module carries one: `time()` notices a tick regression and
 *   `openTimeEpoch()` lets a restore declare one outright, so a fact recorded
 *   after a rewind names a different timeline. `avr8js-debug.js` has no epoch,
 *   so a restore there is indistinguishable from progress — the same limit the
 *   replay surface documents, unfixed on that target.
 *
 * @module
 */
export function installInstructionDebugEvents({cpu, machine, cpuId, timeDomain, port = false,
  captureRegisters, captureInstruction}) {
  const listeners = new Set();
  let accesses = null;
  let timeEpoch = 0;
  let lastTicks = null;

  const publish = event => {
    for (const listener of [...listeners]) listener(event);
  };
  const time = ticks => {
    const value = BigInt(ticks);
    if (lastTicks !== null && value < lastTicks) timeEpoch++;
    lastTicks = value;
    return {
      ticks: value,
      domain: timeEpoch ? `${timeDomain}-reset-${timeEpoch}` : timeDomain,
      hz: machine.clockHz
    };
  };

  const originalRead = cpu.read;
  cpu.read = address => {
    const value = originalRead(address);
    if (accesses) accesses.push({kind: 'memory', memory: {
      space: 'mem', address: address & 0xffff, width: 1, direction: 'read', value: value & 0xff
    }});
    return value;
  };

  const originalWrite = cpu.write;
  cpu.write = (address, value) => {
    if (accesses) accesses.push({kind: 'memory', memory: {
      space: 'mem', address: address & 0xffff, width: 1, direction: 'write', value: value & 0xff
    }});
    return originalWrite(address, value);
  };

  if (port) {
    const originalIn = cpu.inPort;
    cpu.inPort = address => {
      const value = originalIn(address);
      if (accesses) accesses.push({kind: 'port', port: {
        address: address & 0xffff, direction: 'read', value: value & 0xff
      }});
      return value;
    };
    const originalOut = cpu.outPort;
    cpu.outPort = (address, value) => {
      if (accesses) accesses.push({kind: 'port', port: {
        address: address & 0xffff, direction: 'write', value: value & 0xff
      }});
      return originalOut(address, value);
    };
  }

  const originalStep = cpu.step.bind(cpu);
  cpu.step = () => {
    if (!listeners.size) return originalStep();
    const pcBefore = cpu.pc & 0xffff;
    const ticksBefore = machine.cycles;
    // These samples are intentionally behind listener opt-in. Instruction
    // bytes must be captured before execution: code may overwrite itself.
    const registersBefore = captureRegisters ? captureRegisters() : null;
    const instruction = captureInstruction ? captureInstruction(pcBefore) : {address: pcBefore};
    accesses = [];
    let cycles;
    try {
      cycles = originalStep();
    } finally {
      const captured = accesses;
      accesses = null;
      for (const access of captured) publish({
        cpuId, ...access, phase: 'access', fidelity: 'reconstructed', time: time(ticksBefore),
        cause: 'instruction-access'
      });
    }
    if (cycles > 0) {
      const registersAfter = captureRegisters ? captureRegisters() : null;
      const registerChanges = {};
      if (registersBefore && registersAfter) {
        for (const [name, after] of Object.entries(registersAfter)) {
          const before = registersBefore[name];
          if (!Object.is(before, after)) registerChanges[name] = {before, after};
        }
      }
      publish({
        cpuId,
        kind: 'instruction',
        phase: 'retire',
        fidelity: 'recorded',
        time: time(ticksBefore + cycles),
        pcBefore,
        pcAfter: cpu.pc & 0xffff,
        instruction,
        ...(registersAfter ? {registersAfter} : {}),
        changes: {cycles, registers: registerChanges}
      });
    }
    return cycles;
  };

  return {
    onDebugEvent(listener) {
      if (typeof listener !== 'function') throw new TypeError('debug event listener must be a function');
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    debugTime() {
      return {
        ticks: machine.cycles,
        domain: timeEpoch ? `${timeDomain}-reset-${timeEpoch}` : timeDomain,
        hz: machine.clockHz
      };
    },
    openTimeEpoch() {
      timeEpoch++;
      lastTicks = null;
    }
  };
}
