/**
 * Boundary-D debug target for Z80Machine — the Searle-shape breadboard
 * (and the CP/M machine) becomes breakable, steppable, inspectable.
 * Mirrors m6502-debug.js: this module owns the stepping loop with a
 * breakpoint check around each machine.step(). No symbols/yield concept
 * yet — raw Z80 programs (BASIC interpreters, CP/M) are address-level.
 *
 * @module
 */
import { disasmZ80 } from './z80-disasm.js';
import { replayAccepted, replayRefused } from './debug-replay-contract.js';
import { loadSNA, SNA_SIZE } from './zx-sna.js';
import { loadZ80 } from './zx-z80file.js';

/** @param {{ machine: import('./z80-machine.js').Z80Machine }} adapter */
export function createZ80DebugTarget(adapter) {
  const machine = adapter.machine;
  const cpu = machine.cpu;

  let runState = 'halted';
  let pendingStep = null;
  const haltListeners = [];
  const breakpoints = new Map();
  let nextBpId = 1;
  const halt = (info) => { runState = 'halted'; for (const cb of haltListeners) cb(info); };

  // Write watchpoints trap TRUE writes by wrapping the core's write
  // callback (installed only while a watch exists) — emu8051 parity.
  // The trap sits ABOVE the machine's ROM filter, so a store aimed at
  // ROM still fires: the program wrote, even if memory refused.
  const writeWatches = new Map(); // id → { addr, len }
  let watchHit = null;
  let origWrite = null;
  const syncWriteTrap = () => {
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
  };

  // ─── The RECORD half of the replay surface ──────────────────────────
  // Declared in debug-replay-contract.js. Facts are stamped from the machine's
  // OWN clock: `{ticks: machine.cycles, domain, hz: machine.clockHz}`. Those two
  // operands are what `z80-machine.js:270` divides into `tMs`, and taking them
  // undivided keeps the stamp integral — `tMs` is a lossy projection, and reading
  // it instead of its operands is what once made this look impossible.
  //
  // TICK TYPES DIFFER BETWEEN TARGETS AND THAT IS FINE. Here ticks are a Number
  // of CPU cycles at `machine.clockHz`; the 8051 adapter's are a BigInt of
  // nanoseconds at 1e9. The recorder accepts both. The DOMAIN string is what
  // stops two targets' stamps being compared to each other, so a third target
  // should copy the mechanism and not the units.
  //
  // THE EPOCH IS DETECTED, NOT ANNOUNCED — and an earlier version of this file
  // claimed no epoch was needed at all. That was false, and it was false because
  // the claim was checked against `zx-sna.js` and `zx-z80file.js`, the snapshot
  // FILE parsers, and not against the machine's own `loadState`:
  // `z80-machine.js:373` is `this.cycles = s.cycles`.
  //
  // A restore therefore moves the clock BACKWARDS, which is worse than the
  // 8051's reset: a reset restarts at zero going forward, a restore rewinds into
  // ticks this domain has already issued. Measured: facts at ticks 0, then
  // 100000, then 0 again, all in domain 'z80-cycles'. A downstream recorder
  // refuses exactly that — `recorder.js:261` raises INVALID_INPUT_ORDER, "Input
  // time decreased in domain" — and it fires in the workflow snapshots exist
  // for: record, restore a checkpoint, press a key.
  //
  // WHY DETECTION RATHER THAN A HOOK. This target never calls `loadState`; the
  // restore is driven by the caller, so there is no call site here to bump an
  // epoch at, the way the 8051 bumps one inside its own `reset()`. Watching the
  // clock needs no cooperation from the machine and covers every rewind path a
  // subsequent input can SEE. `m6502-machine.js:806` is the same assignment, so
  // this mechanism transfers verbatim rather than being re-derived.
  //
  // WHAT IT CANNOT SEE, STATED RATHER THAN IMPLIED. A rewind followed by running
  // PAST the old high-water mark, with no input in between, is invisible from
  // this side: ticks 100000, 100001, then restore to 100000 and run to 150000 —
  // the next fact stamps 150000, monotonic, same domain, and the log implies
  // 50000 cycles elapsed between two facts that sit on opposite sides of a
  // restore. No amount of watching the clock detects that; the machine would
  // have to say so. Closing it needs a machine-side signal on `loadState`, and
  // until there is one this is the boundary — every rewind an input can observe,
  // not every rewind.
  const observedInputs = new Map();
  let inputListeners = [];
  let inputTimeEpoch = 0;
  let lastTicks = null;

  /**
   * Notice a rewind, EAGERLY — before the dedup gate, not after it.
   *
   * A first version of this ran inside the stamp, which `publishInput` only
   * reaches once a value has already been found to have changed. A suppressed
   * input therefore never updated `lastTicks` and never bumped the epoch, and
   * the dedup map survived the rewind holding values from an abandoned
   * timeline. Constructed: hold 'a', snapshot, run on, press 'b', restore, then
   * press 'b' again in the restored era — a genuine a→b transition, DROPPED,
   * because the map still remembered 'b' from the timeline that no longer
   * exists. Two facts, one domain, the third gone without trace. Silent loss in
   * the log, which is worse than the INVALID_INPUT_ORDER it replaced: that at
   * least threw.
   *
   * So the clock is checked first, and a rewind clears the map as well as
   * bumping the epoch — the 8051's sentence transfers word for word, with
   * "reset" read as "rewind": the map remembers values from before it, and
   * keeping them would suppress the first fact afterwards for every input whose
   * value happens to match.
   */
  function noticeRewind() {
    const ticks = machine.cycles;
    if (lastTicks !== null && ticks < lastTicks) {
      inputTimeEpoch++;
      observedInputs.clear();
    }
    lastTicks = ticks;
  }

  /** The stamp, with any discontinuity already carried into the domain. */
  const inputTime = () => ({
    ticks: machine.cycles,
    domain: inputTimeEpoch ? `z80-cycles-rewind-${inputTimeEpoch}` : 'z80-cycles',
    hz: machine.clockHz
  });

  /**
   * Emit a fact, but only when the value has CHANGED.
   *
   * @param {string} producer e.g. 'z80.keys'
   * @param {string} key the dedup key: what "the same input" means here
   * @param {object} payload the recorded value
   */
  function publishInput(producer, key, payload) {
    // FIRST, before the dedup gate: an unchanged value must still be able to
    // notice that the timeline moved under it.
    noticeRewind();
    const signature = JSON.stringify(payload);
    if (observedInputs.get(key) === signature) return;
    observedInputs.set(key, signature);
    const fact = {time: inputTime(), producer, payload: {...payload}};
    // Each listener gets its own copy: a recorder that stored the object and a
    // listener that mutated it would corrupt the log in place.
    for (const listener of inputListeners) {
      listener({...fact, time: {...fact.time}, payload: {...fact.payload}});
    }
  }

  // Call-class opcodes for step-over: CALL nn, CALL cc,nn, and RST n.
  const isCallClass = (op) => op === 0xcd || (op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7;

  /**
   * Emit a fact with NO dedup, because a serial byte is an EVENT and not a
   * level: the same byte typed twice is two characters, and suppressing the
   * second would replay a transcript with something missing. The dedup map is
   * not consulted at all — a level's key could otherwise collide with it.
   */
  function publishEvent(producer, payload) {
    noticeRewind();
    const fact = {time: inputTime(), producer, payload: {...payload}};
    for (const listener of inputListeners) {
      listener({...fact, time: {...fact.time}, payload: {...fact.payload}});
    }
  }

  return {
    capabilities() {
      return { steps: ['insn', 'over', 'out'], breakpoints: ['code', 'write'], timeFreezes: true, consumes: [] };
    },

    state() { return runState; },

    regs() {
      return {
        pc: cpu.pc, sp: cpu.sp,
        a: cpu.a, f: cpu.f, bc: cpu.bc, de: cpu.de, hl: cpu.hl,
        ix: cpu.ix, iy: cpu.iy, i: cpu.i, r: cpu.r,
        af_: cpu.af_, bc_: cpu.bc_, de_: cpu.de_, hl_: cpu.hl_,
        iff1: cpu.iff1, im: cpu.im, cycles: machine.cycles,
      };
    },

    /** Live disassembly (vector-length-ground; reads through the bus,
     *  so a 128K machine disassembles the PAGE the CPU actually sees). */
    disasm(addr) {
      const rd = machine.readBus ?? ((a) => machine.mem[a & 0xffff]);
      return disasmZ80((a) => rd(a & 0xffff), addr & 0xffff);
    },

    /** Normalise a code address and advance it in the Z80's 16-bit space. */
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
      if (spec.kind === 'write') {
        if (spec.addr == null) return { unsupported: 'addr required' };
        const id = nextBpId++;
        writeWatches.set(id, { addr: spec.addr & 0xffff, len: spec.len ?? 1 });
        syncWriteTrap();
        return id;
      }
      if (spec.kind !== 'code') return { unsupported: `unknown breakpoint kind: ${spec.kind}` };
      if (spec.addr == null) return { unsupported: 'addr required' };
      const id = nextBpId++;
      breakpoints.set(id, { kind: 'code', addr: spec.addr & 0xffff });
      return id;
    },

    clearBreakpoint(id) {
      breakpoints.delete(id);
      if (writeWatches.delete(id)) syncWriteTrap();
    },

    run() { runState = 'running'; pendingStep = null; },

    /** The session's pause verb: stop executing NOW and tell the
     *  halt listeners why — same contract as a breakpoint hit. */
    halt() { halt({ cause: 'pause' }); },

    step(kind, count = 1) {
      if (kind === 'insn') {
        runState = 'running';
        pendingStep = { kind: 'insn', remaining: count };
        return undefined;
      }
      if (kind === 'over') {
        // Depth-wait only when the next opcode is call-class; a PUSH
        // must not turn step-over into run-until-someday. A false
        // conditional CALL never deepens, so the depth check falls
        // through to a single-step naturally.
        if (!isCallClass(machine.mem[cpu.pc & 0xffff])) {
          runState = 'running';
          pendingStep = { kind: 'insn', remaining: 1 };
          return undefined;
        }
        runState = 'running';
        pendingStep = { kind: 'over', sp0: cpu.sp, entered: false };
        return undefined;
      }
      if (kind === 'out') {
        runState = 'running';
        pendingStep = { kind: 'out', sp0: cpu.sp };
        return undefined;
      }
      if (kind === 'cycle') {
        return { unsupported:
          "this Z80 core has no cycle step. Z80Machine.step() executes a whole instruction and " +
          "returns its T-state count — there is no sub-instruction state to stop in, so a cycle " +
          "step here would be an instruction step with a different label. Step one instruction; " +
          "regs().cycles reports what it cost." };
      }
      return { unsupported: `step kind '${kind}' not supported` };
    },

    /** Spend up to budgetNs of simulated time. Returns 'halted' or 'budget'. */
    runFor(budgetNs) {
      if (runState !== 'running') return 'halted';
      const deadline = machine.tMs + budgetNs / 1e6;
      while (machine.tMs < deadline) {
        for (const [id, bp] of breakpoints) {
          if (bp.addr === cpu.pc) { halt({ cause: 'breakpoint', bp: id }); return 'halted'; }
        }
        if (pendingStep) {
          if (pendingStep.kind === 'insn' && pendingStep.remaining <= 0) { halt({ cause: 'step' }); return 'halted'; }
          if (pendingStep.kind === 'over' && pendingStep.entered
            && ((cpu.sp - pendingStep.sp0) & 0x8000) === 0) { halt({ cause: 'step' }); return 'halted'; }
          if (pendingStep.kind === 'out'
            && cpu.sp !== pendingStep.sp0 && ((cpu.sp - pendingStep.sp0) & 0x8000) === 0) {
            halt({ cause: 'step' }); return 'halted';
          }
        }
        machine.step();
        if (watchHit) {
          const hit = watchHit;
          watchHit = null;
          halt({ cause: 'watchpoint', ...hit });
          return 'halted';
        }
        if (pendingStep?.kind === 'insn') pendingStep.remaining--;
        if (pendingStep?.kind === 'over') pendingStep.entered = true;
      }
      return runState === 'halted' ? 'halted' : 'budget';
    },

    timeNs() { return BigInt(Math.round(machine.tMs * 1e6)); },

    /** Face-input contract, joystick side: the VdpScreen button mask
     *  onto the Kempston port. False without the interface. */
    setButtons(mask) {
      if (typeof machine.setButtons !== 'function') return false;
      const accepted = machine.setButtons(mask);
      // Recorded HERE, at the entry point, rather than inside the machine: this
      // is the boundary the contract is about, and it is the same method replay
      // routes through, so a replayed input and a live one take one path.
      if (accepted !== false) publishInput('z80.buttons', 'buttons', {mask});
      return accepted;
    },

    /**
     * Face-input contract, Spectrum flavor: key NAMES, not a button
     * mask — the ULA scans a real 8x5 matrix and the face's keyboard
     * focus routing passes held key names straight through. Returns
     * false when the machine has no ULA to receive them.
     */
    setKeys(names) {
      if (!machine.ula || typeof machine.ula.setKeys !== 'function') return false;
      machine.ula.setKeys(names);
      publishInput('z80.keys', 'keys', {names: [...names]});
      return true;
    },

    /**
     * The RECORD half: subscribe to host-input facts as they are observed.
     * Returns an unsubscribe function.
     *
     * Named `onDebugInput` because that is the name the recorder consumes —
     * `subscribeDebugTargetInputs` tests for it and skips a target without one.
     *
     * @param {(fact: {time: object, producer: string, payload: object}) => void} listener
     * @returns {() => void} unsubscribe
     */
    /**
     * A received serial byte, RECORDED on the way in.
     *
     * THIS METHOD IS THE CORRECTION. The first version of this surface refused
     * `z80.serial` by name, saying "this build has no serial input path for the
     * Z80 target". It has one: `z80-adapter.js:245`, whose own header line 14
     * calls it "sendSerial like every other serial-bearing adapter". The claim
     * was written after greping `z80-machine.js` — the file that declares the
     * clock — and not the adapter the target already holds a reference to. A
     * refusal naming a gap the build does not have is worse than an absent
     * method: an absent method is a TypeError somebody fixes, and a refusal is
     * a considered statement that the tier CANNOT do it, which a driver
     * believes.
     *
     * THE BYPASS IS STATED RATHER THAN CLAIMED CLOSED: a caller holding the
     * adapter can still call `adapter.sendSerial` directly and will not be
     * recorded. Closing that means recording inside the adapter, which is where
     * the 8051 does it; this target's machinery lives here because
     * `onDebugInput` does.
     *
     * @param {number} byte
     * @returns {boolean} whether a chip took it
     */
    sendSerial(byte) {
      // Several callers build this target over a bare {machine}. The adapter is
      // where the serial path lives — including the CP/M mode's key queue,
      // which the target has no way to know about — so a missing adapter is a
      // refusal here rather than a chip scan reimplemented badly.
      if (typeof adapter?.sendSerial !== 'function') return false;
      const accepted = adapter.sendSerial(byte & 0xff) === true;
      if (accepted) publishEvent('z80.serial', {byte: byte & 0xff});
      return accepted;
    },

    onDebugInput(listener) {
      if (typeof listener !== 'function') throw new TypeError('debug input listener must be a function');
      inputListeners.push(listener);
      return () => { inputListeners = inputListeners.filter(l => l !== listener); };
    },

    /**
     * Apply a recorded host-input fact — the APPLY half of the replay surface
     * declared in debug-replay-contract.js.
     *
     * It routes through the same two methods the face uses, `setButtons` and
     * `setKeys`, rather than reaching into the machine again: a replayed input
     * taking a different path from a live one would replay something the
     * recording never captured.
     *
     * EVERY FAILURE IS A RETURN VALUE. A producer this build has no path for is
     * refused with a reason naming what is missing, not thrown — the driver
     * decides whether an unreplayable fact ends the session, and a throw would
     * be indistinguishable from the emulator breaking.
     *
     * `z80.serial` is refused HERE ON PURPOSE. A downstream copy of this target
     * routes it through an `adapter.sendSerial` this build does not have.
     * Refusing by name is the honest answer and it names the gap; accepting
     * silently would replay nothing and report success.
     *
     * @param {{producer: string, payload: object}} input a recorded fact
     * @returns {{accepted: boolean, code?: string, reason?: string}}
     */
    applyReplayInput(input) {
      const payload = input?.payload;
      if (input?.producer === 'z80.buttons') {
        if (!Number.isSafeInteger(payload?.mask)) {
          return replayRefused('invalid-replay-input', 'z80.buttons needs a safe-integer mask');
        }
        // SEEDED BEFORE APPLYING, so the replay does not come back out of the
        // recorder as a freshly observed fact. Without this, replaying a log
        // while recording produces a second copy of every fact in it, and a
        // log replayed twice grows.
        observedInputs.set('buttons', JSON.stringify({mask: payload.mask & 0x1f}));
        return this.setButtons(payload.mask & 0x1f)
          ? replayAccepted()
          : replayRefused('no-input-path',
            'this machine has no joystick interface to receive a button mask');
      }
      if (input?.producer === 'z80.keys') {
        const names = payload?.names;
        // Bounded on purpose: a recorded fact is untrusted by the time it is
        // replayed, and the ULA matrix is 8x5 — forty is every key at once,
        // which is already impossible on real hardware.
        if (!Array.isArray(names) || names.length > 40 ||
            !names.every(name => typeof name === 'string' && name.length <= 16)) {
          return replayRefused('invalid-replay-input',
            'z80.keys needs at most 40 key names of at most 16 characters');
        }
        observedInputs.set('keys', JSON.stringify({names: [...names]}));
        return this.setKeys([...names])
          ? replayAccepted()
          : replayRefused('no-input-path', 'this machine has no ULA to receive key names');
      }
      if (input?.producer === 'z80.serial') {
        const byte = input?.payload?.byte;
        if (!Number.isInteger(byte) || byte < 0 || byte > 0xff) {
          return replayRefused('invalid-replay-input', 'z80.serial needs a byte in 0..255');
        }
        // NOT routed through this.sendSerial, which records: a replayed byte
        // re-entering the log would double every byte on a second pass.
        if (typeof adapter?.sendSerial !== 'function') {
          return replayRefused('no-input-path',
            'this target was built without an adapter, and the serial input path '
            + 'lives there (z80-adapter.js:245)');
        }
        return adapter.sendSerial(byte) === true
          ? replayAccepted()
          : replayRefused('no-input-path', 'no chip in this build takes a received byte');
      }
      return replayRefused('unsupported-replay-input',
        `no replay path for producer ${input?.producer ?? '(none)'}`);
    },

    video() {
      // The ULA is the Spectrum's video chip; otherwise any chip
      // implementing the common videoFrame() contract counts (MC6845
      // and friends arrive on this same surface).
      if (machine.ula && typeof machine.ula.videoFrame === 'function') return machine.ula.videoFrame();
      for (const chip of Object.values(machine.chips || {})) {
        if (typeof chip.videoFrame === 'function') return chip.videoFrame();
      }
      return null;
    },

    /** Audio-face contract: the beeper's current {hz, on}, or null. */
    audio() {
      // Per-voice, always an array (E6.8.11a); empty when this machine has
      // no ULA rather than null, so a caller can iterate without a guard.
      if (machine.ula && typeof machine.ula.audioTone === 'function') return machine.ula.audioTone();
      return [];
    },

    /** Insert a .TAP for the ROM fast-load trap; false without support. */
    insertTape(tapBuf) {
      if (typeof machine.insertTape !== 'function') return false;
      machine.insertTape(tapBuf);
      return true;
    },

    /** Load a 48K snapshot — the face's drag-a-file-in path. A 48K
     *  .SNA is exactly its fixed size; anything else is tried as .z80
     *  (all three header generations). Returns false on machines
     *  without a ULA or on formats that refuse (128K, junk). */
    loadSnapshot(buf) {
      if (!machine.ula) return false;
      try {
        if (buf.length === SNA_SIZE) loadSNA(machine, buf);
        else loadZ80(machine, buf);
        return true;
      } catch {
        return false;
      }
    },

    readMem(space, addr, len) {
      if (space !== 'mem') return { unsupported: `no space '${space}' on z80` };
      const rd = machine.readBus ?? ((a) => machine.mem[a & 0xffff]);
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) out[i] = rd((addr + i) & 0xffff);
      return out;
    },

    writeMem(space, addr, data) {
      if (space !== 'mem') return { refused: `no space '${space}' on z80` };
      // A debugger patches what the CPU sees, ROM included — that is
      // the point of a poke. On 128K that means the mapped ROM slot
      // and the mapped page; on 48K, flat memory as always.
      const wr = machine._zx128
        ? (a, v) => {
          if (a < 0x4000) machine.roms[machine._bank.rom][a] = v;
          else machine.writeBus(a, v);
        }
        : (a, v) => { machine.mem[a & 0xffff] = v & 0xff; };
      for (let i = 0; i < data.length; i++) wr((addr + i) & 0xffff, data[i] & 0xff);
      return undefined;
    },
  };
}

export default createZ80DebugTarget;
