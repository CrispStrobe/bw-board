
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
/**
 * FOUR PARAMETERS, EVERY DEFAULT EXACTLY TODAY'S BEHAVIOUR. They exist because
 * one core in this tree spells all four differently, and the spelling — not the
 * mechanism — was the whole of the incompatibility. Measured on avr8js:
 *
 *   accessors    it has `readData`/`writeData`; `read`/`write` are undefined
 *   runInstruction  it has no `cpu.step` at all — `avrInstruction(cpu)` is a
 *                free function the adapter calls, so the bracket is injected
 *                rather than wrapped
 *   pcOf         its `pc` counts WORDS (`progMem` is a Uint16Array indexed by
 *                it); the existing AVR target already publishes `pc * 2`
 *   clock        its cycle count lives on the CPU; the adapter has no `cycles`
 *
 * None of that is something avr8js cannot express, which is why the answer to
 * "what is missing" was nothing and no patch went to a third party.
 *
 * @param {object} opts
 * @param {{read?: string, write?: string, inPort?: string, outPort?: string}} [opts.accessors]
 *   Property names on `cpu` for the four wrappable accessors.
 * @param {(cpu: object) => number} [opts.pcOf] the program counter, in the units facts carry.
 * @param {() => number} [opts.clock] the tick count facts are stamped with.
 * @param {number} [opts.addressMask=0xffff] width of the MEMORY address space, as
 *   a mask. The default is every core this module served when it was written; a
 *   20-bit core passes 0xfffff. `pcOf` was already a parameter, so without this a
 *   wide-address core reports its program counter correctly and every memory fact
 *   truncated -- right for exactly the first 64K, which is where a small test
 *   program's operands live and not where its code does.
 *
 *   THE I/O RECORDERS ARE DELIBERATELY NOT COVERED. I/O space is 16 bits on every
 *   core this module serves, so widening it would describe an address space that
 *   does not exist.
 */
export function installInstructionDebugEvents({cpu, machine, cpuId, timeDomain, port = false,
  captureRegisters, captureInstruction, idleCause = () => 'parked',
  accessors: accessorNames = {}, pcOf = c => c.pc & 0xffff, addressMask = 0xffff,
  clock = () => machine.cycles, rewindLabel}) {
  // REQUIRED, no default: the suffix stamped on a domain after a BACKWARD clock
  // move is a per-target FACT, not a module constant. Pass 'rewind' when the
  // core's reset() ADVANCES the clock (the backward moves are loadState /
  // checkpoint restore — z80, 6502, 8086); pass 'reset' when reset() zeroes it.
  // There is no safe default — `-reset-` is wrong for every core that reaches
  // this code, and a default would go invisible the moment a fifth consumer
  // forgot it. lite's comment forbids converging the two namings for exactly
  // this reason, so the parameter — not a constant — is the fix.
  if (typeof rewindLabel !== 'string' || !rewindLabel) {
    throw new TypeError(
      'installInstructionDebugEvents needs rewindLabel: "rewind" if this core\'s '
      + 'reset() advances the clock (the backward move is loadState/restore), '
      + '"reset" if reset() zeroes it. State it; there is no safe default.');
  }
  const NAME = {read: 'read', write: 'write', inPort: 'inPort', outPort: 'outPort',
    ...accessorNames};
  const listeners = new Set();
  let accesses = null;
  let timeEpoch = 0;
  let lastTicks = null;

  /** Set by the instruction wrapper when a step actually retired something. */
  let retired = false;

  const publish = event => {
    for (const listener of [...listeners]) listener(event);
  };

  /** One emitter for the wrapper and the public method, so they cannot drift. */
  const emitIdle = (cycles, ticks, cause = idleCause()) => {
    if (!listeners.size) return false;
    if (!Number.isFinite(cycles) || cycles <= 0) return false;
    publish({
      cpuId,
      kind: 'idle',
      phase: 'elapse',
      fidelity: 'recorded',
      time: time(ticks),
      cause,
      changes: {cycles}
    });
    return true;
  };
  const time = ticks => {
    const value = BigInt(ticks);
    if (lastTicks !== null && value < lastTicks) timeEpoch++;
    lastTicks = value;
    return {
      ticks: value,
      domain: timeEpoch ? `${timeDomain}-${rewindLabel}-${timeEpoch}` : timeDomain,
      hz: machine.clockHz
    };
  };

  /**
   * THE ACCESSOR WRAPPERS ARE INSTALLED WITH THE FIRST LISTENER AND REMOVED
   * WITH THE LAST, and the reason is a measured cost rather than tidiness.
   *
   * They used to go on at construction and stay on, paying `if (accesses)` for
   * every data access forever. Measured on a memory-bound program with NO
   * listener attached — a debugger nobody has opened:
   *
   *   6502   400k steps   no target 104ms   target installed 118ms   1.14x
   *   z80    400k steps   no target  78ms   target installed 112ms   1.43x
   *
   * The z80 is worse because it passes `port: true` and therefore wraps four
   * methods rather than two. The underlying constant is about 45ns per access,
   * so the ratio is a property of how memory-bound the program is: the same
   * wrapper on a pin-toggle loop measures 1.06x and looks free. A soak whose
   * program does 42 accesses per simulated millisecond cannot see this; the one
   * that does 6000 can.
   *
   * THE STEP WRAPPER IS LAZY TOO, and it is here because the measurement said
   * so rather than for symmetry. With only the accessors made lazy, a target
   * with no listener still cost 1.44x on a two-access instruction — and the
   * ratio FELL as accesses per step rose (1.44x at 2, 1.28x at 16, 1.05x at
   * 128), which is the signature of a per-STEP cost rather than a per-access
   * one. With eager accessors the ratio rises instead. That is about 25ns per
   * instruction: a rounding error on a core doing real work per step, and 2.5%
   * on a 4MHz Z80 retiring a million instructions a second.
   *
   * An earlier version of this comment argued the step wrapper should stay,
   * because its guard is per-instruction rather than per-access. That was true
   * and it was not a measurement.
   *
   * RESTORING IS CONDITIONAL, because we are not the only thing that may wrap
   * these. If someone wrapped `cpu.read` after us, ours is no longer the
   * outermost and putting the original back would silently discard theirs. In
   * that case the wrapper stays and the `accesses` null check keeps it inert —
   * a cost, but not a corruption.
   */
  let hooks = null;

  const installHooks = () => {
    if (hooks) return;
    hooks = {read: cpu[NAME.read], write: cpu[NAME.write], inPort: cpu[NAME.inPort],
        outPort: cpu[NAME.outPort], step: cpu.step, ours: {}};

    // A core need not HAVE a step to wrap. avr8js's `avrInstruction(cpu)` is a
    // free function, so there is nothing on the cpu to replace; that adapter
    // reaches the same bracket through `aroundInstruction`. Wrapping is the
    // convenience for cores that do have one, not the mechanism.
    if (typeof hooks.step === 'function') {
      originalStep = hooks.step.bind(cpu);
      hooks.ours.step = stepWrapper;
      cpu.step = stepWrapper;
    }

    // THE OUTER BRACKET: machine.step, above the short-circuit.
    //
    // A parked core is invisible from inside `cpu.step` on some machines and
    // visible-but-silent on others — measured: a halted z80 advances 80,000
    // cycles with `cpu.step` called ZERO times, while a 6502 in WAI calls it
    // twenty times and gets 0 back each time. Neither publishes anything, and
    // a consumer sees the tick counter jump with nothing to explain it.
    //
    // Both are visible from OUTSIDE `machine.step`, which is why the bracket
    // goes there: the machine advanced and nothing retired.
    if (typeof machine?.step === 'function') {
      hooks.machineStep = machine.step;
      const outer = () => {
        const before = clock();
        retired = false;
        const n = hooks.machineStep.call(machine);
        if (!retired) {
          const advanced = clock() - before;
          // STP on the 6502 returns 0 and advances nothing: time genuinely
          // stopped, and an elapse fact there would claim otherwise.
          //
          // The `> 0` here is belt-and-braces: `emitIdle` refuses a non-advance
          // itself, and that guard is the one with tests behind it. Mutating
          // this one away is therefore INERT, and it is recorded as inert
          // rather than chased — it reads at the call site, which is worth a
          // line that cannot fail on its own.
          if (advanced > 0) emitIdle(advanced, clock());
        }
        return n;
      };
      hooks.ours.machineStep = outer;
      machine.step = outer;
    }

    // `.call(cpu, …)` rather than a bare call: the saved accessor may be a
    // PROTOTYPE METHOD that uses `this`. The z80 and 6502 cores here bind or
    // close over their state so a bare call works, and avr8js's `readData`
    // reads `this.data` — it throws. Restoring the receiver is invisible to a
    // function that ignores it, which is why the captured streams do not move.
    hooks.ours.read = address => {
      const value = hooks.read.call(cpu, address);
      if (accesses) accesses.push({kind: 'memory', memory: {
        space: 'mem', address: address & addressMask, width: 1, direction: 'read', value: value & 0xff
      }});
      return value;
    };
    cpu[NAME.read] = hooks.ours.read;

    hooks.ours.write = (address, value) => {
      if (accesses) accesses.push({kind: 'memory', memory: {
        space: 'mem', address: address & addressMask, width: 1, direction: 'write', value: value & 0xff
      }});
      return hooks.write.call(cpu, address, value);
    };
    cpu[NAME.write] = hooks.ours.write;

    if (port) {
      hooks.ours.inPort = address => {
        const value = hooks.inPort.call(cpu, address);
        if (accesses) accesses.push({kind: 'port', port: {
          address: address & 0xffff, direction: 'read', value: value & 0xff
        }});
        return value;
      };
      cpu[NAME.inPort] = hooks.ours.inPort;

      hooks.ours.outPort = (address, value) => {
        if (accesses) accesses.push({kind: 'port', port: {
          address: address & 0xffff, direction: 'write', value: value & 0xff
        }});
        return hooks.outPort.call(cpu, address, value);
      };
      cpu[NAME.outPort] = hooks.ours.outPort;
    }
  };

  const removeHooks = () => {
    if (!hooks) return;
    // Only put back what is still ours. See the note above.
    if (hooks.ours.machineStep && machine.step === hooks.ours.machineStep) {
      machine.step = hooks.machineStep;
    }
    if (hooks.ours.step && cpu.step === hooks.ours.step) cpu.step = hooks.step;
    originalStep = null;
    if (cpu[NAME.read] === hooks.ours.read) cpu[NAME.read] = hooks.read;
    if (cpu[NAME.write] === hooks.ours.write) cpu[NAME.write] = hooks.write;
    if (port) {
      if (cpu[NAME.inPort] === hooks.ours.inPort) cpu[NAME.inPort] = hooks.inPort;
      if (cpu[NAME.outPort] === hooks.ours.outPort) cpu[NAME.outPort] = hooks.outPort;
    }
    hooks = null;
  };

  let originalStep = null;
  /**
   * THE INSTRUCTION BRACKET, as a function rather than only as a wrapper.
   *
   * `execute` runs one instruction and returns the cycles it consumed. Wrapping
   * `cpu.step` is one caller of this; a core whose step is a FREE FUNCTION —
   * avr8js, where the adapter calls `avrInstruction(cpu)` — is the other, and
   * it reaches this through `aroundInstruction` below. One body, so a bracketed
   * instruction means the same thing however the core is driven.
   */
  const runInstruction = (execute) => {
    if (!listeners.size) return execute();
    const pcBefore = pcOf(cpu);
    const ticksBefore = clock();
    // These samples are intentionally behind listener opt-in. Instruction
    // bytes must be captured before execution: code may overwrite itself.
    const registersBefore = captureRegisters ? captureRegisters() : null;
    const instruction = captureInstruction ? captureInstruction(pcBefore) : {address: pcBefore};
    accesses = [];
    let cycles;
    try {
      cycles = execute();
    } finally {
      const captured = accesses;
      accesses = null;
      for (const access of captured) publish({
        cpuId, ...access, phase: 'access', fidelity: 'reconstructed', time: time(ticksBefore),
        // PROVENANCE IS STATED, NOT INFERRED. An access the wrappers saw the
        // CPU issue and one a peripheral completed on its own clock are both
        // real and both belong to this instruction, but they are not the same
        // evidence — and a consumer cannot tell them apart from the payload.
        // `cause` says which; a contributed access brings its own.
        cause: access.cause ?? 'instruction-access'
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
      retired = true;
      publish({
        cpuId,
        kind: 'instruction',
        phase: 'retire',
        fidelity: 'recorded',
        time: time(ticksBefore + cycles),
        pcBefore,
        pcAfter: pcOf(cpu),
        instruction,
        ...(registersAfter ? {registersAfter} : {}),
        changes: {cycles, registers: registerChanges}
      });
    }
    return cycles;
  };

  const stepWrapper = () => runInstruction(originalStep);

  /**
   * An access this module did not observe itself.
   *
   * The accessor wrappers see what goes through the CPU. They cannot see an
   * access a PERIPHERAL completes on its own clock — an SPI transfer finishing
   * some cycles after the store that started it, a TWI START issued from a
   * bridge callback. Those are real, ordered evidence about the same
   * instruction, observed by something else.
   *
   * WHY IT GOES IN THE WINDOW RATHER THAN OUT. If an instruction is open, a
   * contributed access joins the ones the wrappers collected and publishes with
   * them, before the retire it belongs to and stamped with the instruction's
   * START time. That is not a nicety: a consumer deciding where to break needs
   * every access for an instruction to arrive before its boundary, and it
   * cannot tell which of them the CPU issued directly. Outside a window there
   * is no instruction to belong to, so the fact goes out immediately at the
   * current clock.
   *
   * FIDELITY IS THE SAME AND THAT IS AN ASSERTION, NOT AN OVERSIGHT.
   * `reconstructed` here means one thing: this timestamp was reconstructed from
   * the instruction boundary rather than measured at the access. That is
   * equally true of a wrapped access and a contributed one — neither has a
   * timestamp of its own, both inherit the instruction's start. What DOES
   * differ is where the observation came from, and that is what `cause` is
   * for: `instruction-access` for one the wrappers saw, `peripheral-access`
   * for one contributed from outside. A caller may override it.
   *
   * The same rule the accessor wrappers follow: with no listener it does
   * nothing at all.
   */
  const contributeAccess = access => {
    if (!listeners.size) return false;
    if (!access || typeof access !== 'object' || typeof access.kind !== 'string') {
      throw new TypeError('recordAccess needs an access fact carrying a kind');
    }
    const tagged = {...access, cause: access.cause ?? 'peripheral-access'};
    if (accesses) {
      accesses.push(tagged);
      return true;
    }
    publish({cpuId, ...tagged, phase: 'access', fidelity: 'reconstructed', time: time(clock())});
    return true;
  };

  return {
    onDebugEvent(listener) {
      if (typeof listener !== 'function') throw new TypeError('debug event listener must be a function');
      listeners.add(listener);
      installHooks();                       // first listener puts them on; later ones are no-ops
      return () => {
        listeners.delete(listener);
        if (!listeners.size) removeHooks();  // last one out takes them off again
      };
    },
    /**
     * Run one instruction inside the bracket, for a core with no `cpu.step`.
     *
     * The injected half of the same duality the accessors have: a wrapped
     * method where one exists, an explicit call where it does not. avr8js's
     * adapter owns the instruction loop and calls a free function, so it calls
     * this instead of having its step wrapped — and gets the identical fact
     * stream, because there is one body behind both.
     *
     * With no listener it is the bare call, so an unlistened target pays a
     * `listeners.size` check and nothing else — the same rule the wrapper
     * follows.
     *
     * @param {() => number} execute runs one instruction, returns its cycles
     * @returns {number} whatever `execute` returned
     */
    aroundInstruction(execute) {
      if (typeof execute !== 'function') {
        throw new TypeError('aroundInstruction needs a function that runs one instruction');
      }
      return runInstruction(execute);
    },

    /**
     * TIME PASSED AND NOTHING RETIRED, declared by whoever knows it did.
     *
     * The module could only ever say "an instruction retired". A consumer
     * reading the stream therefore sees the tick counter jump between two
     * retires with nothing explaining it — which is indistinguishable from a
     * DROPPED RECORD, and that is the defect rather than the missing feature.
     *
     * MEASURED, live, on two shipping cores today:
     *
     *   6502 in WAI    50 steps  cycles 2012 -> 52012  (+50,000)   0 facts
     *   z80 in HALT    50 steps  cycles    4 -> 200004 (+200,000)  0 facts
     *
     * TWO KINDS, NOT ONE, and the distinction is the point. A core parked in
     * WAI/HALT/SLEEP is not the same event as time jumping forward to a
     * scheduled peripheral callback: the first is "nothing happened for N
     * cycles", the second is "N cycles passed and then a thing fired". One
     * `cycles-advanced` fact covering both would be the same defect as one
     * refusal code for every situation, which this surface removed from the
     * replay half earlier today.
     *
     * DECLARED RATHER THAN OBSERVED, and that is forced rather than chosen.
     * Measured: on the 6502 a parked step still calls `cpu.step` (20 calls for
     * 20,000 cycles), so this module's wrapper sees it and could infer it. On
     * the z80 the machine short-circuits the CPU entirely — `cpu.step` is
     * called ZERO times while 80,000 cycles pass — so there is nothing for a
     * wrapper to observe. The same event is inferable on one core and invisible
     * on another, exactly as an instruction bracket is a wrapped method on one
     * and an injected call on another.
     *
     * So the module supplies the VOCABULARY and the caller supplies the fact.
     * Emitting these automatically where they can be inferred would change how
     * much a shipping target publishes, which is a separate decision from
     * having a way to say it at all.
     *
     * @param {{cycles: number, ticks?: number, cause?: string}} elapse
     */
    publishIdleElapse({cycles, ticks = clock(), cause = idleCause()} = {}) {
      return emitIdle(cycles, ticks, cause);
    },

    /**
     * Time advanced to a SCHEDULED event, and that event fired.
     *
     * The other half of the pair above, and deliberately its own kind. A
     * consumer distinguishing "the core slept through the slice" from "the
     * clock jumped to a timer callback" is asking a real question, and one fact
     * shape cannot answer it.
     *
     * @param {{cycles: number, ticks?: number, event?: object}} jump
     */
    publishClockJump({cycles, ticks = clock(), event = null} = {}) {
      if (!listeners.size) return false;
      if (!Number.isFinite(cycles) || cycles <= 0) return false;
      publish({
        cpuId,
        kind: 'clock',
        phase: 'fire',
        fidelity: 'recorded',
        time: time(ticks),
        ...(event ? {event} : {}),
        changes: {cycles}
      });
      return true;
    },

    /**
     * Contribute an access observed elsewhere. See `contributeAccess`.
     *
     * @param {{kind: string}} access the fact's own fields, without the
     *   envelope: this module supplies cpuId, phase, fidelity, time and cause,
     *   so a contributed access is indistinguishable from an observed one
     *   except in what it describes. That uniformity is the point — a target
     *   that hand-rolled its own envelope was the duplication this removes.
     * @returns {boolean} false if nobody is listening
     */
    recordAccess(access) {
      return contributeAccess(access);
    },
    debugTime() {
      return {
        // BigInt, LIKE THE STAMPS. It used to return the raw counter while
        // every fact this module publishes carries a BigInt, so `===` or
        // `deepEqual` between a read and a stamp of the SAME instant was false
        // forever, with both printing the same digits. Nothing downstream
        // broke, because five separate places in the consumer layer already
        // coerce `time.ticks` through their own BigInt() normaliser before
        // daring to compare it — that duplication was the compensation, and it
        // is what a new caller does not know to write.
        //
        // `time()` is not reused here: it MOVES the epoch state, and reading
        // the clock must not (a driver that merely asked the time after a
        // restore would consume the regression and leave the next real fact in
        // an era nothing explains).
        ticks: BigInt(clock()),
        domain: timeEpoch ? `${timeDomain}-${rewindLabel}-${timeEpoch}` : timeDomain,
        hz: machine.clockHz
      };
    },
    openTimeEpoch() {
      timeEpoch++;
      lastTicks = null;
    }
  };
}
