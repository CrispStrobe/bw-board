/**
 * Boundary-D debug target for M6502Machine — the 6502 breadboard computer
 * becomes a breakable, steppable, inspectable program.
 *
 * Like avr8js-debug.js, this module owns the stepping loop: a breakpoint
 * check wraps each machine.step() call. The adapter provides boundary-A
 * (pin edges), this module provides boundary-D (debugger control).
 *
 * @module
 */

/**
 * @param {import('./m6502-adapter.js').createM6502Adapter} adapter
 * @param {object} [opts]
 * @param {object} [opts.symbols] — { scheduler: { tasks: [...] } }
 */
import { disasm6502 } from './w65c02-disasm.js';

import { replayAccepted, replayRefused } from './debug-replay-contract.js';

export function createM6502DebugTarget(adapter, opts = {}) {
  const machine = adapter.machine;
  const cpu = machine.cpu;
  const symbols = opts.symbols ?? null;

  let runState = 'halted'; // 'halted' | 'running'
  let pendingStep = null;  // { kind: 'insn'|'block'|'over'|'out', ... }
  const haltListeners = [];
  const breakpoints = new Map();
  let nextBpId = 1;

  function halt(info) {
    runState = 'halted';
    for (const cb of haltListeners) cb(info);
  }

  // Write watchpoints trap TRUE writes (any store to a watched address,
  // same-value included) by wrapping the core's write callback — the
  // same semantics emu8051's _emu_dbg_set_bp_write gives. The wrap is
  // installed only while at least one watch exists, so the fast path
  // stays untouched.
  const writeWatches = new Map(); // id → { addr, len }
  let watchHit = null;
  let origWrite = null;
  function syncWriteTrap() {
    if (writeWatches.size && !origWrite) {
      origWrite = cpu.write;
      cpu.write = (a, v) => {
        const aa = a & 0xffff;
        for (const [id, w] of writeWatches) {
          if (aa >= w.addr && aa < w.addr + w.len) watchHit = { bp: id, addr: aa, value: v & 0xff };
        }
        return origWrite(a, v);
      };
    } else if (!writeWatches.size && origWrite) {
      cpu.write = origWrite;
      origWrite = null;
    }
  }

  // ─── The replay surface ─────────────────────────────────────────────
  // Declared in debug-replay-contract.js. This is the z80 target's mechanism
  // COPIED rather than re-derived — deliberately, because re-deriving is where a
  // confident sentence about coverage comes back.
  //
  // The stamp is the machine's own clock: {ticks: machine.cycles, domain,
  // hz: machine.clockHz}, the two operands tMs is divided from.
  //
  // A REWIND IS DETECTED, and this machine has exactly one path that causes one:
  // m6502-machine.js:806 is `this.cycles = s.cycles` inside loadState. Measured
  // rather than assumed, by grepping `cycles` in the file that DECLARES it: the
  // only other assignment is `= 0` in the constructor, and reset() at line 510
  // does `this.cycles += 7` — it ADVANCES by the real 6502 reset sequence's cost
  // rather than rewinding. So unlike the 8051 no reset trigger is needed here,
  // and unlike a naive reading a restore still rewinds.
  //
  // NOR IS A RESET TRIGGER NEEDED FOR THE DEDUP MAP. m6502-machine.js:510 resets
  // the CPU and advances the chips; it does not reset them, so a VIA that was
  // holding a button level still holds it afterwards. The map stays true.
  //
  // WHAT DETECTION CANNOT SEE, the same boundary as the z80: a restore followed
  // by running PAST the old high-water mark with no input in between is
  // monotonic from this side and indistinguishable from ordinary progress.
  // Closing that needs a machine-side signal on loadState.
  const observedInputs = new Map();
  let inputListeners = [];
  let inputTimeEpoch = 0;
  let lastTicks = null;

  /**
   * THE CLOCK IS INJECTABLE, AND THE EPOCH IS DERIVED RATHER THAN OWNED.
   *
   * `opts.debugTime` lets an integrator hand this target the clock the rest of
   * that integration already uses. It matters because a consumer downstream
   * gives this target's checkpoints and instruction events a SHARED epoch, and
   * a record half carrying its own would put one machine on two timelines: a
   * checkpoint stamped in one era and an input stamped in another at the same
   * instant, with a replayer comparing domains by equality seeing two runs.
   *
   * The default is this target's own clock below, so a standalone target
   * behaves exactly as before.
   *
   * A CONSEQUENCE WORTH NAMING: with a clock injected, the domain string is a
   * property of the INTEGRATION, not of this target. A test here asserting
   * `m6502-cycles-rewind-N` is describing the DEFAULT wiring; the same code
   * wired to a shared clock will legitimately stamp something else. That is not
   * a bug — a domain names a timeline, and an integration's timeline is the one
   * its checkpoints are on.
   */
  const ownClock = () => {
    const ticks = machine.cycles;
    // The only rewind this machine has is loadState (m6502-machine.js:806).
    if (lastTicks !== null && ticks < lastTicks) inputTimeEpoch++;
    lastTicks = ticks;
    return {
      ticks,
      domain: inputTimeEpoch ? `m6502-cycles-rewind-${inputTimeEpoch}` : 'm6502-cycles',
      hz: machine.clockHz
    };
  };
  const clock = typeof opts.debugTime === 'function' ? opts.debugTime : ownClock;

  let lastDomain = null;

  /**
   * Take the stamp, and CLEAR THE DEDUP MAP WHENEVER THE ERA CHANGES.
   *
   * The map must not survive a rewind: it would hold levels from an abandoned
   * timeline, and the first genuine change afterwards whose value happened to
   * match one would be dropped without trace.
   *
   * The signal is the DOMAIN STRING, not a tick regression, and that is the
   * whole point of the design. An injected clock may know about a rewind this
   * target cannot see — downstream's is bumped explicitly by `restoreCheckpoint`
   * — so watching the domain inherits every trigger the clock has instead of
   * only the one this target could detect for itself. It is also why the era
   * gate lives HERE rather than inside `ownClock`: an injected clock is not
   * ours to put a side effect in.
   *
   * WHAT REMAINS UNCOVERED, stated rather than hidden: a clock whose own
   * detection is deferred — downstream's bumps on the next `cpu.step` — leaves a
   * window where a rewind has happened and the domain has not moved yet. An
   * input arriving inside it is stamped on the old era. Narrower than detecting
   * nothing, and the same window the integration's other events already sit in.
   */
  const stamp = () => {
    const time = clock();
    if (lastDomain !== null && time.domain !== lastDomain) observedInputs.clear();
    lastDomain = time.domain;
    return time;
  };

  /**
   * Emit a fact, but only when the value has CHANGED.
   *
   * For LEVELS only — a button mask that is set twice is one state, so the
   * second call is not a fact. Events use `publishEvent`.
   *
   * The stamp is taken FIRST, before the dedup gate: a suppressed input must
   * still be able to notice that the era moved under it.
   */
  function publishInput(producer, key, payload) {
    const time = stamp();
    const signature = JSON.stringify(payload);
    if (observedInputs.get(key) === signature) return;
    observedInputs.set(key, signature);
    emit(producer, payload, time);
  }

  /**
   * Emit a fact with NO dedup, because some inputs are events rather than
   * levels: the same serial byte typed twice is two bytes, and suppressing the
   * second would replay a transcript missing a character. The dedup map does
   * not apply and must not be consulted — a level's key would collide with it.
   */
  function publishEvent(producer, payload) {
    emit(producer, payload, stamp());
  }

  /**
   * SERIAL IS RECORDED AT THE ADAPTER, which is where the bypass was.
   *
   * This target used to record inside its own `sendSerial`, and said so: "a
   * caller holding the adapter can still call adapter.sendSerial directly and
   * will not be recorded". A downstream consumer had already closed that by
   * wrapping the adapter's method at construction, and this is that approach
   * brought back upstream — the adapter is the one place every caller passes
   * through.
   *
   * ONE DELIBERATE DIFFERENCE FROM THE DOWNSTREAM VERSION. It publishes BEFORE
   * calling the real method, because its listeners can VETO an input and a veto
   * has to happen before the byte reaches the machine. This one publishes
   * AFTER, and only when a chip took the byte, because it has no veto and does
   * have the rule that only a fact the machine TOOK is a fact — a logged byte
   * nothing received would replay a character that never arrived.
   *
   * TWO TARGETS OVER ONE ADAPTER NEED TWO DIFFERENT FUNCTIONS, and this was
   * measured rather than reasoned about — the first version of this wrap got it
   * wrong. `previous` is whatever `adapter.sendSerial` was at construction, so
   * wrapping CHAINS and each target records a live byte once. `rootSendSerial`
   * is the adapter'strue original, carried forward on the wrapper, and it is what
   * REPLAY uses — routing a replay through `previous` would publish the
   * replayed byte into the other target's log, which is what the first version
   * did (measured: replaying into the second target added a fact to the first).
   */
  const previousSendSerial = typeof adapter?.sendSerial === 'function'
    ? adapter.sendSerial.bind(adapter) : null;
  const rawSendSerial = adapter?.sendSerial?.rootDebugSendSerial ?? previousSendSerial;
  if (previousSendSerial) {
    const wrapped = byte => {
      const value = byte & 0xff;
      const accepted = previousSendSerial(value);
      if (accepted) publishEvent('m6502.serial', {byte: value});
      return accepted;
    };
    wrapped.rootDebugSendSerial = rawSendSerial;
    adapter.sendSerial = wrapped;
  }

  function emit(producer, payload, time) {
    const fact = {time, producer, payload: {...payload}};
    // Each listener gets its own copy: a recorder that stored the object and a
    // listener that mutated it would corrupt the log in place.
    for (const listener of inputListeners) {
      listener({...fact, time: {...fact.time}, payload: {...fact.payload}});
    }
  }

  return {
    capabilities() {
      return {
        steps: [...(symbols ? ['insn', 'block'] : ['insn']), 'over', 'out'],
        breakpoints: [...(symbols ? ['code', 'yield'] : ['code']), 'write'],
        timeFreezes: true,
        consumes: [],
        // Two audio contracts (E6.8.11a). 'tone' is what the hardware is
        // CONFIGURED to produce and 'samples' is what it SOUNDS like;
        // 'samples' is advertised only when a chip on this machine can
        // really render them, for the same reason `steps` does not list
        // anything the core cannot do.
        audio: machine.canRenderAudio && machine.canRenderAudio()
          ? ['tone', 'samples']
          : ['tone'],
      };
    },

    /** Per-voice {hz, on, vol}; always an array, empty when nothing sounds. */
    audio() {
      return typeof machine.audioTone === 'function' ? machine.audioTone() : [];
    },

    /**
     * Drain rendered samples into `dest`. Returns frames of REAL audio; the
     * rest of `dest` is silence the bus counted as an underrun rather than
     * stretching what it had.
     */
    readAudio(dest, frames) {
      if (!machine.canRenderAudio || !machine.canRenderAudio()) return 0;
      return machine.audio.read(dest, frames);
    },

    state() { return runState; },

    regs() {
      return {
        pc: cpu.pc,
        a: cpu.a,
        x: cpu.x,
        y: cpu.y,
        sp: cpu.s,
        p: cpu.p,
        cycles: machine.cycles,
      };
    },

    /** Live disassembly at addr (vector-length-ground table; reads the
     *  machine's memory, so POKEd code disassembles too). Returns
     *  { text, bytes, length } — parity-plus with emu8051's disasm(). */
    disasm(addr) {
      return disasm6502((a) => machine.mem[a & 0xffff], addr & 0xffff);
    },

    /** Normalise a code address and advance it in the 6502's 16-bit space. */
    nextCodeAddress(addr, length) {
      if (!Number.isSafeInteger(addr) || addr < 0 ||
          !Number.isSafeInteger(length) || length < 0) {
        return { unsupported: 'code address progression requires non-negative safe integers' };
      }
      return ((addr & 0xffff) + (length & 0xffff)) & 0xffff;
    },

    onHalt(cb) {
      haltListeners.push(cb);
      // The session treats the return value as an unsubscribe and
      // CALLS it on destroy — push()'s return (the new length) made
      // every bench teardown throw 'h is not a function'.
      return () => {
        const i = haltListeners.indexOf(cb);
        if (i >= 0) haltListeners.splice(i, 1);
      };
    },

    setBreakpoint(spec) {
      if (spec.kind === 'code') {
        if (spec.addr == null) return { unsupported: 'addr required' };
        const id = nextBpId++;
        breakpoints.set(id, { kind: 'code', addr: spec.addr });
        return id;
      }
      if (spec.kind === 'yield') {
        if (!symbols) return { unsupported: 'no symbols for yield breakpoints' };
        const task = symbols.scheduler?.tasks?.find(t => t.name === spec.task);
        if (!task) return { unsupported: `unknown task: ${spec.task}` };
        const y = task.yields?.find(yy => yy.state === spec.state);
        if (!y) return { unsupported: `unknown yield state ${spec.state}` };
        const id = nextBpId++;
        breakpoints.set(id, { kind: 'yield', addr: y.addr, task: spec.task, state: spec.state });
        return id;
      }
      if (spec.kind === 'write') {
        if (spec.addr == null) return { unsupported: 'addr required' };
        const id = nextBpId++;
        writeWatches.set(id, { addr: spec.addr & 0xffff, len: spec.len ?? 1 });
        syncWriteTrap();
        return id;
      }
      return { unsupported: `unknown breakpoint kind: ${spec.kind}` };
    },

    clearBreakpoint(id) {
      breakpoints.delete(id);
      if (writeWatches.delete(id)) syncWriteTrap();
    },

    run() { runState = 'running'; pendingStep = null; },

    /** The session's pause verb — same contract as a breakpoint hit. */
    halt() { halt({ cause: 'pause' }); },

    /** Reboot through the reset vector at $FFFC. */
    reset() { pendingStep = null; machine.reset(); runState = 'halted'; },

    halt() { halt({ cause: 'user' }); },

    step(kind, count = 1) {
      if (kind === 'insn') {
        runState = 'running';
        pendingStep = { kind: 'insn', remaining: count };
        return undefined;
      }
      if (kind === 'block') {
        if (!symbols) return { unsupported: 'block step requires symbols' };
        runState = 'running';
        pendingStep = { kind: 'block' };
        return undefined;
      }
      if (kind === 'over') {
        // Depth-wait only when the NEXT opcode is call-class (JSR/BRK);
        // anything else is a plain instruction step — a lone PHA must
        // not turn step-over into run-until-someday.
        const op = machine.mem[cpu.pc & 0xffff];
        if (op !== 0x20 && op !== 0x00) {
          runState = 'running';
          pendingStep = { kind: 'insn', remaining: 1 };
          return undefined;
        }
        runState = 'running';
        pendingStep = { kind: 'over', sp0: cpu.s, entered: false };
        return undefined;
      }
      if (kind === 'out') {
        // Run until the current frame returns: RTS/RTI pops lift the
        // (descending) stack pointer above where it stands now.
        runState = 'running';
        pendingStep = { kind: 'out', sp0: cpu.s };
        return undefined;
      }
      if (kind === 'cycle') {
        return { unsupported:
          "this 6502 core has no cycle step. W65C02.step() fetches an opcode and runs it to " +
          "completion, returning the instruction's cycle count — there is no sub-instruction " +
          "state to stop in, so a cycle step here would be an instruction step with a " +
          "different label. Step one instruction; regs().cycles reports what it cost." };
      }
      return { unsupported: `step kind '${kind}' not supported` };
    },

    /** Spend up to budgetNs of simulated time. Returns 'halted' or 'budget'. */
    runFor(budgetNs) {
      if (runState !== 'running') return 'halted';
      const budgetMs = budgetNs / 1e6;
      const deadline = machine.tMs + budgetMs;

      while (machine.tMs < deadline) {
        // Check breakpoints BEFORE executing
        for (const [id, bp] of breakpoints) {
          if (bp.addr === cpu.pc) {
            const tasks = this.position();
            halt({ cause: 'breakpoint', bp: id, bpKind: bp.kind, tasks });
            return 'halted';
          }
        }

        // Check pending step completion BEFORE executing
        if (pendingStep) {
          if (pendingStep.kind === 'insn') {
            if (pendingStep.remaining <= 0) {
              halt({ cause: 'step' });
              return 'halted';
            }
          }
          if (pendingStep.kind === 'block') {
            // Check if we're at a yield address
            const pos = this.position();
            if (pos.length > 0 && pendingStep.started) {
              halt({ cause: 'step', tasks: pos });
              return 'halted';
            }
            pendingStep.started = true;
          }
          if (pendingStep.kind === 'over' && pendingStep.entered && cpu.s >= pendingStep.sp0) {
            halt({ cause: 'step' });
            return 'halted';
          }
          if (pendingStep.kind === 'out' && cpu.s > pendingStep.sp0) {
            halt({ cause: 'step' });
            return 'halted';
          }
        }

        const n = machine.step();
        if (n === 0) {
          // STP — machine stopped
          halt({ cause: 'stopped' });
          return 'halted';
        }

        if (watchHit) {
          const hit = watchHit;
          watchHit = null;
          halt({ cause: 'watchpoint', ...hit });
          return 'halted';
        }

        if (pendingStep?.kind === 'insn') {
          pendingStep.remaining--;
        }
        if (pendingStep?.kind === 'over') pendingStep.entered = true;
      }

      return runState === 'halted' ? 'halted' : 'budget';
    },

    /**
     * The machine's video output, when the config declared a TMS9918
     * (CHIP vdp = TMS9918 AT $addr): the last VBLANK's frame as RGBA
     * for a canvas face, plus mode and frame counter so a poller can
     * skip unchanged frames. null when the machine has no VDP — the
     * UI shows no screen rather than a black lie.
     */
    /**
     * Face-input contract, write side: the face (VdpScreen with
     * keyboard focus, on-screen buttons) reports the pressed-button
     * mask; the machine maps it onto the snake hookup (active-low
     * PA0..3). Returns false when the machine has no VIA to receive it.
     */
    setButtons(mask) {
      if (typeof machine.setButtons !== 'function') return false;
      const accepted = machine.setButtons(mask);
      // Recorded at the entry point, which is also the path replay routes
      // through, so a replayed input and a live one take one route.
      if (accepted !== false) publishInput('m6502.buttons', 'buttons', {mask});
      return accepted;
    },

    /**
     * The RECORD half: subscribe to host-input facts as they are observed.
     * Named `onDebugInput` because that is the name the recorder consumes.
     *
     * @param {(fact: {time: object, producer: string, payload: object}) => void} listener
     * @returns {() => void} unsubscribe
     */
    onDebugInput(listener) {
      if (typeof listener !== 'function') throw new TypeError('debug input listener must be a function');
      inputListeners.push(listener);
      return () => { inputListeners = inputListeners.filter(l => l !== listener); };
    },

    /**
     * Send a byte to the machine's serial receiver, RECORDING it on the way.
     *
     * Delegates to `adapter.sendSerial` — the debug target had no serial entry
     * point before this, and the record half needs one: a byte that reaches the
     * machine without passing through here is not in the log. THAT BYPASS IS
     * REAL AND STATED: a caller holding the adapter can still call
     * `adapter.sendSerial` directly and will not be recorded. Closing it
     * properly means recording inside the adapter, which is where the 8051 does
     * it; this target's record machinery lives here because `onDebugInput` does.
     *
     * @param {number} byte
     * @returns {boolean} whether a receiver took it
     */
    sendSerial(byte) {
      // Delegates to the WRAPPED adapter method, which is what records now.
      // This method publishes nothing of its own: doing both would log every
      // byte twice for a caller who came through the target rather than round
      // it.
      //
      // Callers construct this target over a bare `{machine}` —
      // `code-address-progression.test.mjs:32` builds `{machine: {cpu: {}}}` —
      // so `adapter` is frequently an object with nothing on it.
      if (typeof adapter?.sendSerial !== 'function') return false;
      return adapter.sendSerial(byte & 0xff);
    },

    /**
     * The APPLY half. Every failure is a return value, never a throw.
     *
     * Three producers, all three with a measured path in a fully built target —
     * and every one of them GUARDED, because a target built over a bare
     * `{machine}` has neither an adapter nor a CPU and a refusal is what the
     * contract requires there, not a TypeError. Measured
     * rather than assumed, because the first draft of this method refused two of
     * them by name on the strength of a sentence about what the machine lacks:
     *
     *   m6502.buttons  machine.setButtons        m6502-machine.js:606
     *   m6502.serial   adapter.sendSerial        m6502-adapter.js:156
     *   m6502.nmi      machine.cpu.nmi()         w65c02.js:64 — the machine has
     *                  no `nmi()` of its own, but it is not the machine's to
     *                  have: m6502-machine.js:705 reaches the CPU's directly
     *                  for the vsync NMI, and this takes the same route.
     *
     * A CAVEAT ON REPLAYED NMI, stated rather than guarded. A config with
     * `simplevga {nmi: true}` generates its own NMIs from vsync. Those are
     * MACHINE events, not host input, so nothing records them and replay
     * regenerates them — but a driver that recorded an NMI from somewhere else
     * and replays it into such a config adds one the original run did not have.
     *
     * @param {{producer: string, payload: object}} input a recorded fact
     * @returns {{accepted: boolean, code?: string, reason?: string}}
     */
    applyReplayInput(input) {
      const payload = input?.payload;
      switch (input?.producer) {
        case 'm6502.buttons': {
          if (!Number.isSafeInteger(payload?.mask)) {
            return replayRefused('invalid-replay-input', 'm6502.buttons needs a safe-integer mask');
          }
          // Passed through UNMASKED. The machine reads bits 0..3 and ignores the
          // rest (m6502-machine.js:606), so masking here would change nothing the
          // machine sees while making the seed disagree with the raw value a live
          // call records — and the next live call with that raw value would then
          // read as a change that never happened.
          const mask = payload.mask;
          // THE ERA GATE RUNS BEFORE THE SEED, and the order is load-bearing.
          // Measured on the landed version: replaying an input immediately
          // after a rewind RE-RECORDED it, because the seed went into the map
          // and the publish path then cleared the map before the dedup gate
          // read it. A second replay pass therefore produced a log longer than
          // the run — in the one moment replay actually happens, just after a
          // restore. Stamping first consumes the era change, so the seed
          // survives to do its job.
          stamp();
          // Seeded before applying, so the replay does not come back out of the
          // recorder as a freshly observed fact.
          observedInputs.set('buttons', JSON.stringify({mask}));
          return this.setButtons(mask)
            ? replayAccepted()
            : replayRefused('no-input-path', 'this machine has no VIA to receive a button mask');
        }
        case 'm6502.serial': {
          if (!Number.isInteger(payload?.byte) || payload.byte < 0 || payload.byte > 0xff) {
            return replayRefused('invalid-replay-input', 'm6502.serial needs a byte in 0..255');
          }
          if (!rawSendSerial) {
            return replayRefused('no-input-path',
              'this target was built without an adapter, and the serial input path '
              + 'lives there (m6502-adapter.js:156)');
          }
          // The UNWRAPPED method: the wrapper records, and a replayed byte
          // re-entering the log would double every byte on a second pass.
          return rawSendSerial(payload.byte)
            ? replayAccepted()
            : replayRefused('no-input-path',
              'no chip in this config accepts a received byte');
        }
        case 'm6502.nmi':
          if (typeof cpu?.nmi !== 'function') {
            return replayRefused('no-input-path',
              'this machine has no CPU with an NMI entry point');
          }
          cpu.nmi();
          return replayAccepted();
        default:
          return replayRefused('unsupported-replay-input',
            `no replay path for producer ${input?.producer ?? '(none)'}`);
      }
    },

    video() {
      // Any chip implementing the common videoFrame() contract counts —
      // TMS9918, simplevga, and whatever video hardware comes next.
      for (const chip of Object.values(machine.chips || {})) {
        if (typeof chip.videoFrame === 'function') return chip.videoFrame();
      }
      return null;
    },

    position() {
      if (!symbols?.scheduler?.tasks) return [];
      const result = [];
      for (const task of symbols.scheduler.tasks) {
        if (!task.yields) continue;
        // Check state variable if present
        if (task.state) {
          const addr = task.state.addr;
          const size = task.state.size ?? 1;
          let val = 0;
          for (let i = size - 1; i >= 0; i--) val = (val << 8) | machine.mem[addr + i];
          const y = task.yields.find(yy => yy.state === val);
          if (y) result.push({ task: task.name, state: val });
        }
      }
      return result;
    },

    timeNs() { return adapter.timeNs(); },

    readMem(space, addr, len) {
      if (space !== 'mem') return { unsupported: `no space '${space}' on 6502` };
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = machine.mem[(addr + i) & 0xffff];
      return out;
    },

    writeMem(space, addr, data) {
      if (space !== 'mem') return { refused: `no space '${space}' on 6502` };
      for (let i = 0; i < data.length; i++) machine.mem[(addr + i) & 0xffff] = data[i];
      return undefined;
    },
  };
}
