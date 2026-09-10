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
  // NO EPOCH HERE, UNLIKE THE 8051. That adapter bumps a counter into its domain
  // on reset, because a reset restarts its clock and facts either side are not
  // comparable. This machine has no reset — `cycles` is set once in the
  // constructor — and the snapshot loaders do not touch it, so the domain is
  // constant. If a reset is ever added, the epoch is what to add with it.
  const observedInputs = new Map();
  let inputListeners = [];

  /**
   * Emit a fact, but only when the value has CHANGED.
   *
   * @param {string} producer e.g. 'z80.keys'
   * @param {string} key the dedup key: what "the same input" means here
   * @param {object} payload the recorded value
   */
  function publishInput(producer, key, payload) {
    const signature = JSON.stringify(payload);
    if (observedInputs.get(key) === signature) return;
    observedInputs.set(key, signature);
    const fact = {
      time: {ticks: machine.cycles, domain: 'z80-cycles', hz: machine.clockHz},
      producer,
      payload: {...payload}
    };
    // Each listener gets its own copy: a recorder that stored the object and a
    // listener that mutated it would corrupt the log in place.
    for (const listener of inputListeners) {
      listener({...fact, time: {...fact.time}, payload: {...fact.payload}});
    }
  }

  // Call-class opcodes for step-over: CALL nn, CALL cc,nn, and RST n.
  const isCallClass = (op) => op === 0xcd || (op & 0xc7) === 0xc4 || (op & 0xc7) === 0xc7;

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
        return replayRefused('no-input-path',
          'this build has no serial input path for the Z80 target');
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
