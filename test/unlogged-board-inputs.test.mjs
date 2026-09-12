/**
 * A LIVE BOARD MAKES A SESSION UNREPLAYABLE, and the targets now say so.
 *
 * The record half of the replay surface covers each target's OWN entry points —
 * `setButtons`, `keyIn`, `sendSerial`. The ADAPTER's `syncInputs` is a
 * different class of input: it reads the board every advance and pushes values
 * into the machine without passing anything that could log them. Measured
 * across the tree: seven of eight adapters sample board inputs and none of them
 * records, including all three that implement the replay surface. Only
 * `emu8051-adapter` records from that site, and only because there the adapter
 * IS the target.
 *
 * So until this landed, these three would record a session, accept a replay,
 * and reproduce a run whose board inputs were never in the log — silently. The
 * contract module named the case in the abstract months earlier ("a live board
 * changes input nets outside the debug target, so a restored run would silently
 * diverge") and nothing connected the two.
 *
 * THIS DOES NOT RECORD BOARD INPUTS AND IS NOT A STEP TOWARDS IT. Logging every
 * polled pin is what the 8051's deduplication exists to survive; that is a
 * design question. This converts a silent wrong answer into a stated refusal,
 * which is what the surface is for.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { createZ80Adapter } from '../src/z80-adapter.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { Z80Machine } from '../src/z80-machine.js';
import { createI8086Adapter } from '../src/i8086-adapter.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { BREADBOARD8086, I8086Machine } from '../src/i8086-machine.js';
import { replaySupport, replaySupportRefusal } from '../src/debug-replay-contract.js';

/** A board that samples: the only property that matters is `readPin`. */
const sampling = () => ({ advanceTo() {}, setPin() {}, readPin() { return 1; } });
/** A board that drives outputs but never offers an input. */
const blind = () => ({ advanceTo() {}, setPin() {} });

const rom8086 = () => {
  const img = new Uint8Array(0x8000);
  img.set([0x90, 0xeb, 0xfd], 0);
  img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
  return img;
};

const TARGETS = {
  m6502: {
    reason: /input-net sampling/,
    make: () => {
      const adapter = createM6502Adapter({});
      adapter.machine.loadRom([0xea, 0x4c, 0x00, 0x80]);
      adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;
      adapter.machine.reset();
      return { adapter, target: createM6502DebugTarget(adapter) };
    }
  },
  z80: {
    reason: /buffer-input sampling/,
    // GATED ON BUFFER CHIPS, because that is the only route this machine
    // samples board inputs through — see the `no buffer chips` case below.
    make: () => {
      const adapter = createZ80Adapter({ config: {
        clockHz: 4_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        ports: [{ kind: 'buffer', name: 'inputs', at: 0x10 }]
      } });
      return { adapter, target: createZ80DebugTarget(adapter) };
    }
  },
  i8086: {
    reason: /input sampling/,
    make: () => {
      const adapter = createI8086Adapter({ config: BREADBOARD8086, rom: rom8086() });
      return { adapter, target: createI8086DebugTarget(adapter) };
    }
  }
};

for (const [name, spec] of Object.entries(TARGETS)) {
  describe(`${name}: a sampling board is a stated refusal`, () => {
    it('with NO board, replay is supported', () => {
      const { target } = spec.make();
      assert.deepEqual(replaySupport(target), { supported: true, reasons: [] });
    });

    it('with a SAMPLING board, replay is refused and the reason names why', () => {
      const { adapter, target } = spec.make();
      adapter.attachBoard(sampling());
      const support = replaySupport(target);
      assert.equal(support.supported, false);
      assert.equal(support.reasons.length, 1, support.reasons.join('; '));
      assert.match(support.reasons[0], spec.reason);

      // And it composes into the refusal shape a driver returns.
      const refusal = replaySupportRefusal(support);
      assert.equal(refusal.accepted, false);
      assert.equal(refusal.code, 'replay-unsupported');
      assert.match(refusal.reason, spec.reason);
    });

    it('with a board that offers NO readPin, replay is still supported', () => {
      // The discriminator is sampling, not attachment. A board that only
      // receives output changes no input net, so refusing there would be a
      // refusal about the wrong fact.
      const { adapter, target } = spec.make();
      adapter.attachBoard(blind());
      assert.deepEqual(replaySupport(target), { supported: true, reasons: [] });
    });

    it('THE CALLER’S REASONS AND THE TARGET’S COMPOSE, which is why it is a list', () => {
      const { adapter, target } = spec.make();
      adapter.attachBoard(sampling());
      const support = replaySupport(target, ['the host clock is not recorded']);
      assert.equal(support.reasons.length, 2, support.reasons.join('; '));
      assert.match(support.reasons.join(' | '), /host clock/);
      assert.match(support.reasons.join(' | '), spec.reason);
    });

  });
}

// REGRESSION GUARD B (upstream defect found by simulating the pin take against
// lite's suites). The stated refusal (replayRefusalReasons) and the checkpoint
// enforcement (capabilities().recording, its checkpointRefusal, captureCheckpoint)
// must read ONE predicate — adapter.unloggedBoardInputs(). When they were two —
// the reason on that accessor, the enforcement on the machine's _unloggedBoardInputs
// flag — a board sampling unlogged inputs was ANNOUNCED un-replayable and still
// handed a checkpoint that replays into the very divergence the reason warns of.
//
// WHY THIS DOES NOT USE THE ADAPTER FIXTURES ABOVE. Those adapters (pre-sync) still
// poke machine._unloggedBoardInputs, so the machine's checkpointSupport() reports
// unsupported and MASKS whether the bridge itself gates. This is the state the pin
// take moves away from: the adapters sync onto unloggedBoardInputs() and stop
// poking the flag, at which point the bridge is the only thing that can refuse. So
// the take is simulated directly — a controlled adapter whose accessor answers and
// whose machine flag is NOT set — which is exactly how lego-ac reproduced it.
describe('a bridge refuses checkpoint from the SAME predicate it states the refusal from', () => {
  const CORES = {
    z80: () => {
      const machine = new Z80Machine({ clockHz: 3_500_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
      return unlogged => createZ80DebugTarget({ machine, unloggedBoardInputs: () => unlogged });
    },
    m6502: () => {
      const adapter = createM6502Adapter({});
      adapter.machine.loadRom([0xea]); adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80; adapter.machine.reset();
      return unlogged => createM6502DebugTarget({ machine: adapter.machine, unloggedBoardInputs: () => unlogged });
    }
    // i8086 is deliberately not here: it is another session's converged file, and
    // it gates recording/captureCheckpoint without declaring checkpointRefusal, so
    // it is not a control for the full property. Its own event/checkpoint gaps are
    // routed to that session. The logged-vs-unlogged legs below are self-
    // discriminating without it.
  };

  for (const [name, coreFactory] of Object.entries(CORES)) {
    it(`${name}: unlogged inputs refuse checkpoint; logged inputs allow it`, () => {
      const make = coreFactory();

      // Uncaptured input state: the reason is stated AND the checkpoint is refused,
      // from one predicate. The logged control below (make(false)) proves this is
      // conditional on sampling, not an always-on refusal.
      const unlogged = make(true);
      assert.ok(unlogged.replayRefusalReasons().length > 0, 'precondition: the accessor reports unlogged inputs');
      const capsU = unlogged.capabilities();
      assert.deepEqual(capsU.recording, [],
        'recording must be empty when inputs are unlogged — a checkpoint over them replays into a divergence');
      assert.ok((capsU.extensions?.checkpointRefusal ?? []).length > 0,
        'the refusal must be declared in capabilities, not only via replayRefusalReasons');
      assert.equal(unlogged.captureCheckpoint().code, 'INCOMPLETE_CHECKPOINT_STATE',
        'captureCheckpoint must refuse, not hand back a snapshot it just warned about');

      // Control, same core: with inputs logged, the reason is gone and the
      // checkpoint is NOT refused for uncaptured input — so the refusal is about
      // sampling, not a blanket veto.
      const logged = make(false);
      assert.equal(logged.replayRefusalReasons().length, 0, 'control: nothing unlogged');
      assert.notEqual(logged.captureCheckpoint()?.code, 'INCOMPLETE_CHECKPOINT_STATE',
        'control: a logged session is not refused for uncaptured input');
    });
  }
});

describe('the z80 gate is on BUFFER CHIPS, not on attachment', () => {
  it('a config with no buffer chip samples nothing, so it refuses nothing', () => {
    // Measured, not assumed: this machine reads board inputs only through
    // buffer ports. A config without one is not in the unlogged-input state
    // however live the board is, and saying otherwise would refuse a session
    // that is perfectly replayable.
    const adapter = createZ80Adapter({ config: {
      clockHz: 4_000_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }], ports: []
    } });
    const target = createZ80DebugTarget(adapter);
    adapter.attachBoard(sampling());
    assert.deepEqual(replaySupport(target), { supported: true, reasons: [] });
  });
});

describe('the contract collects the reasons safely', () => {
  it('a target that THROWS while being asked is not thereby supported', () => {
    // The module's central rule is that a refusal is a return value. A question
    // that cannot be answered is not an answer of yes.
    const hostile = {
      applyReplayInput: () => ({ accepted: true }),
      replayRefusalReasons() { throw new Error('half-built target'); }
    };
    let support;
    assert.doesNotThrow(() => { support = replaySupport(hostile); });
    assert.equal(support.supported, false);
    assert.match(support.reasons[0], /failed while reporting/);
  });

  it('a target with no replayRefusalReasons is not thereby refused', () => {
    const plain = { applyReplayInput: () => ({ accepted: true }) };
    assert.deepEqual(replaySupport(plain), { supported: true, reasons: [] });
  });

  it('non-string and empty reasons are dropped rather than listed', () => {
    const noisy = {
      applyReplayInput: () => ({ accepted: true }),
      replayRefusalReasons: () => ['a real reason', '', null, 42, undefined]
    };
    assert.deepEqual(replaySupport(noisy).reasons, ['a real reason']);
  });
});
