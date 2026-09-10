/**
 * CONFORMANCE: every target's DECLARATION must be true of its BEHAVIOUR.
 *
 * `debug-replay-contract.js` declares four capabilities and, until this file,
 * nothing checked that a target's answer matched what it actually does. A
 * target could declare `canVetoDebugInput` and ignore the return value, or
 * honour one without declaring it, and no test would notice: the declaration
 * and the implementation are asserted in different files, by different people,
 * and the per-target list lived somewhere a fifth target's author would never
 * open.
 *
 * SO THE POPULATION IS DERIVED FROM THE SOURCE, not listed here. A file that
 * implements either half appears in the scan, and a scanned file with no driver
 * row REDDENS — which is the only part of this that keeps working when someone
 * who has not read this comment adds a target.
 *
 * SIX CLAIMS, FOUR EXERCISABLE. FOUR TARGETS, THREE ALWAYS DRIVABLE. Both
 * numbers are stated here rather than left to be inferred from a green run,
 * because a conformance test that passes LOOKS like conformance and that is
 * exactly the failure this file would otherwise be:
 *
 *   C1  declares-apply   => a valid fact is accepted            exercisable
 *   C2  declares-record  => driving an input produces a fact     exercisable
 *   C3  does NOT declare veto => a refusing listener changes nothing
 *                                                                exercisable
 *   C4  declares-veto    => a refusing listener stops the input
 *                           NO UPSTREAM SUBJECT: nothing here declares a veto.
 *                           Asserted as an absence, so the day a target
 *                           declares one this file reddens and someone has to
 *                           write the positive case.
 *   C5  a SAMPLING BOARD is never silent                        exercisable
 *   C6  a target that can PARK says so                          NO SUBJECT
 *                           A core in HALT/WAI/SLEEP advances the clock and
 *                           retires nothing, and a consumer then sees the tick
 *                           counter jump with nothing explaining it —
 *                           indistinguishable from a dropped record. Measured
 *                           live: a halted z80 passes 200,000 cycles in 50
 *                           steps, a 6502 in WAI passes 50,000, and before
 *                           bw-board `c8d7101` neither published anything.
 *                           `instruction-debug-events.js` now brackets
 *                           `machine.step` and emits an `idle/elapse` fact —
 *                           but NO TARGET IN THIS TREE INSTALLS THAT MODULE, so
 *                           the claim has no subject here. Asserted as an
 *                           absence, like C4, so the day a target does install
 *                           it, this file reddens and someone has to write the
 *                           positive case rather than inheriting a green run.
 *                           A live board changes input nets outside the target
 *                           and nothing records them, so a session with one
 *                           cannot be replayed. Every target must SAY so —
 *                           through replaySupport's reasons, or by refusing the
 *                           input outright. What it must not do is accept the
 *                           replay and reproduce a run whose board inputs were
 *                           never in the log. Two spellings, one claim: the
 *                           claim is that it is stated, not how.
 *
 * AND ONE PREDICATE ANSWERS RIGHT FOR THE WRONG REASON, which belongs in the
 * file and not in a workaround: `emu8051-adapter` has no `capabilities()` at
 * all, so `canVetoDebugInput` returns false for it structurally. That is the
 * correct answer — its facts are observations of a read the core has already
 * issued, so it has no "before" at which to refuse — but the predicate would
 * answer the same if the adapter grew a veto tomorrow.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';
import { createEmu8051Adapter } from '../src/emu8051-adapter.js';
import { createZ80Adapter } from '../src/z80-adapter.js';
import { createI8086Adapter } from '../src/i8086-adapter.js';
import { BoardImpl } from '../src/board.js';
import {
  canApplyReplayInput, canRecordDebugInput, canVetoDebugInput, replayOutcome, replaySupport
} from '../src/debug-replay-contract.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'src');

/** Every source file implementing either half. The population, derived. */
const implementers = readdirSync(SRC)
  .filter(name => name.endsWith('.js') && name !== 'debug-replay-contract.js')
  .filter(name => {
    const text = readFileSync(join(SRC, name), 'utf8');
    return text.includes('applyReplayInput(') || text.includes('onDebugInput(');
  })
  .sort();

// The emu8051 build, discovered the way its own suites discover it.
const WASM = [
  join(HERE, '..', 'emu8051-stc', 'build', 'emu8051.js'),
  join(HERE, '..', '..', 'emu8051-stc', 'build', 'emu8051.js')
].find(existsSync);
const require = createRequire(import.meta.url);

/** The only property that matters: a board that OFFERS an input to sample. */
const samplingBoard = () => ({ advanceTo() {}, setPin() {}, readPin() { return 1; } });

const rom8086 = code => {
  const img = new Uint8Array(0x8000);
  img.set(code, 0);
  img.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
  return img;
};

/**
 * One row per implementer. `drive` must cause the target to observe a host
 * input; `fact` must be one the constructed machine can actually take.
 *
 * `applied` is OPTIONAL and its absence is a stated limit rather than an
 * oversight: it reads back what the machine received, and the 8051's replayed
 * pin value moves no SFR this surface exposes — measured at review time, with
 * the probe returning nothing either way. A row without it exercises C3 only
 * through fact delivery, which every target can show.
 */
const ROWS = {
  'z80-debug.js': {
    make: async () => createZ80DebugTarget({ machine: new Z80Machine(
      { clockHz: 3_500_000, regions: [{ kind: 'rom', start: 0x0000, end: 0x3fff }], ula: true }, {}) }),
    drive: target => target.setKeys(['a']),
    fact: { producer: 'z80.keys', payload: { names: ['a'] } },
    // A config WITH a buffer port: that is the only route this machine samples
    // board inputs through, so it is the only one where a board is unlogged.
    withSamplingBoard: () => {
      const adapter = createZ80Adapter({ config: {
        clockHz: 4_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xffff }],
        ports: [{ kind: 'buffer', name: 'inputs', at: 0x10 }]
      } });
      adapter.attachBoard(samplingBoard());
      return createZ80DebugTarget(adapter);
    },
    applied: target => target.setKeys(['b']) && true
  },
  'm6502-debug.js': {
    make: async () => {
      const adapter = createM6502Adapter({});
      adapter.machine.loadRom([0xea, 0x4c, 0x00, 0x80]);
      adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;
      adapter.machine.reset();
      const target = createM6502DebugTarget(adapter);
      target.machineRef = adapter.machine;
      return target;
    },
    drive: target => target.setButtons(0b0001),
    fact: { producer: 'm6502.buttons', payload: { mask: 0b0010 } },
    withSamplingBoard: () => {
      const adapter = createM6502Adapter({});
      adapter.machine.loadRom([0xea, 0x4c, 0x00, 0x80]);
      adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;
      adapter.machine.reset();
      adapter.attachBoard(samplingBoard());
      return createM6502DebugTarget(adapter);
    },
    applied: target => (target.machineRef.chips.via1.inA & 0x0f) !== 0x0f
  },
  'i8086-debug.js': {
    make: async () => {
      const machine = new I8086Machine(BREADBOARD8086);
      machine.loadRom(rom8086([0x90, 0xeb, 0xfd]));
      machine.reset(); machine.step();
      const target = createI8086DebugTarget({ machine });
      target.machineRef = machine;
      return target;
    },
    drive: target => target.setInput('ppi1', 'b', 0, 1),
    fact: { producer: 'i8086.gpio', payload: { chip: 'ppi1', port: 'b', bit: 1, level: 1 } },
    withSamplingBoard: () => {
      const adapter = createI8086Adapter({ config: BREADBOARD8086, rom: rom8086([0x90, 0xeb, 0xfd]) });
      adapter.attachBoard(samplingBoard());
      return createI8086DebugTarget(adapter);
    },
    applied: target => (target.machineRef.chips.ppi1.inB & 0x03) !== 0
  },
  'emu8051-adapter.js': {
    skip: WASM ? false : 'emu8051 WASM build not present',
    make: async () => {
      const mod = require(WASM);
      const Module = await (typeof mod === 'function' ? mod : mod.default)();
      const adapter = createEmu8051Adapter(Module, { mode: 'poll' });
      const board = new BoardImpl(5);
      board.setNetlist([
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }
      ], [
        { id: 'n0', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R', terminal: 'a' }] },
        { id: 'n1', terminals: [{ part: 'R', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] }
      ]);
      adapter.attachBoard(board);
      return adapter;
    },
    drive: adapter => { adapter.runNs(2_000_000); return true; },
    // This one says it the OTHER way: it has no replayRefusalReasons and
    // refuses the input outright while a board is attached, because a live
    // board re-asserts its own pin values through the same native setter
    // replay uses. Same claim, different spelling.
    withSamplingBoard: async () => {
      const mod = require(WASM);
      const Module = await (typeof mod === 'function' ? mod : mod.default)();
      const adapter = createEmu8051Adapter(Module, { mode: 'poll' });
      const board = new BoardImpl(5);
      board.setNetlist([
        { id: 'MCU', kind: 'mcu', params: {}, terminals: ['P1.0'] },
        { id: 'VCC', kind: 'vcc', params: {}, terminals: ['vcc'] },
        { id: 'R', kind: 'resistor', params: { ohms: 1000 }, terminals: ['a', 'b'] }
      ], [
        { id: 'n0', terminals: [{ part: 'VCC', terminal: 'vcc' }, { part: 'R', terminal: 'a' }] },
        { id: 'n1', terminals: [{ part: 'R', terminal: 'b' }, { part: 'MCU', terminal: 'P1.0' }] }
      ]);
      adapter.attachBoard(board);
      return adapter;
    },
    // A boardless adapter is the only state this target permits a replay in;
    // the row's own `fact` is applied against a second, boardless one.
    fact: { producer: 'emu8051.pin', payload: { port: 1, bit: 0, level: 1 } },
    applyOn: async () => {
      const mod = require(WASM);
      const Module = await (typeof mod === 'function' ? mod : mod.default)();
      return createEmu8051Adapter(Module, { mode: 'poll' });
    }
  }
};

describe('the conformance table covers every implementer in the source', () => {
  it('scanned the source and found the implementers', () => {
    assert.ok(implementers.length >= 4,
      `the scan found ${implementers.join(', ') || 'nothing'} — it must have stopped matching`);
  });

  it('every scanned implementer has a driver row', () => {
    // The half that keeps working after everyone here has forgotten this file.
    assert.deepEqual(implementers, Object.keys(ROWS).sort(),
      'a file implementing the surface with no row here is a target this file does not check');
  });
});

for (const [name, row] of Object.entries(ROWS)) {
  const skip = row.skip ?? false;

  describe(`${name}: the declaration is true of the behaviour`, () => {
    it('C1: declares-apply => a valid fact is accepted', { skip }, async () => {
      const target = await row.make();
      assert.equal(canApplyReplayInput(target), true, 'this row is for a target that applies');
      const applier = row.applyOn ? await row.applyOn() : target;
      const outcome = replayOutcome(applier.applyReplayInput(row.fact));
      assert.equal(outcome.accepted, true,
        `${name} declares it applies and refused a valid fact: ${outcome.reason}`);
    });

    it('C2: declares-record => driving an input produces a fact', { skip }, async () => {
      const target = await row.make();
      assert.equal(canRecordDebugInput(target), true, 'this row is for a target that records');
      const facts = [];
      const stop = target.onDebugInput(fact => facts.push(fact));
      assert.equal(typeof stop, 'function', 'onDebugInput must return an unsubscribe');
      assert.notEqual(row.drive(target), false, 'the driver must actually reach the machine');
      assert.ok(facts.length > 0, `${name} declares it records and produced no fact`);
      // The declared fact shape, checked on a fact the target really emitted.
      const fact = facts[0];
      assert.equal(typeof fact.producer, 'string');
      assert.ok(fact.payload && typeof fact.payload === 'object');
      assert.ok(fact.time && fact.time.domain, 'a fact carries a timeline');
    });

    it('C5: a SAMPLING BOARD is never silent', { skip }, async () => {
      // A live board changes input nets outside the debug target and nothing
      // records them, so a session with one cannot be replayed. Measured across
      // the tree: seven of eight adapters sample board inputs and only the 8051
      // records from that site. Every target must SAY so; what it must not do
      // is accept the replay and reproduce a run whose board inputs were never
      // in the log.
      //
      // TWO SPELLINGS, ONE CLAIM. Three targets report a reason through
      // replaySupport; the 8051 refuses the input outright, because a live
      // board re-asserts its own pin values through the same native setter
      // replay uses. The claim is that the state is STATED, not how — asserting
      // one spelling would have made the other look like a defect.
      assert.equal(typeof row.withSamplingBoard, 'function',
        `${name} has no sampling-board construction, so nothing checks it says anything`);
      const target = await row.withSamplingBoard();

      const support = replaySupport(target);
      const refusal = replayOutcome(target.applyReplayInput(row.fact));
      assert.ok(support.supported === false || refusal.accepted === false,
        `${name}: a sampling board is attached and the target neither reports a `
        + 'replay-support reason nor refuses the input — the session is silently '
        + 'unreplayable');

      // And whichever way it speaks, it must name the board rather than answer
      // with something generic.
      const said = support.supported === false
        ? support.reasons.join('; ')
        : `${refusal.code}: ${refusal.reason}`;
      assert.match(said, /board/i, `${name} refused without naming the board: ${said}`);
    });

    it('C5 control: with NO board, the same target is replayable', { skip }, async () => {
      // Without this, C5 passes for a target that refuses everything always,
      // which is the failure mode of a check that only looks for a refusal.
      const target = await row.make();
      const support = replaySupport(target);
      const refusal = replayOutcome(
        (row.applyOn ? await row.applyOn() : target).applyReplayInput(row.fact));
      assert.equal(support.supported, true, support.reasons.join('; '));
      assert.equal(refusal.accepted, true, refusal.reason);
    });

    it('C3: does NOT declare veto => a refusing listener changes nothing', { skip }, async () => {
      // The behavioural half of the declaration. A target that ignores the
      // return must go on delivering to other listeners AND go on applying the
      // input; a target that honoured one without declaring it would fail here
      // rather than silently give a recorder a guarantee the contract does not
      // promise.
      const target = await row.make();
      assert.equal(canVetoDebugInput(target), false, 'this row is for a fire-and-forget target');

      const seen = [];
      target.onDebugInput(() => ({ accepted: false, code: 'conformance-refusal' }));
      target.onDebugInput(fact => seen.push(fact));

      const drove = row.drive(target);
      assert.notEqual(drove, false, 'a refusing listener must not make the drive fail');
      assert.ok(seen.length > 0, 'a refusing listener must not stop delivery to other listeners');
      if (row.applied) {
        assert.equal(row.applied(target), true,
          'a refusing listener must not stop the input reaching the machine');
      }
    });
  });
}

describe('C4 has NO upstream subject, and that is asserted rather than assumed', () => {
  it('no target here declares a veto, so the positive direction is unexercised', async () => {
    // The moment one does, this reddens and someone has to write:
    //   declares-veto => a refusing listener DOES stop the input.
    // Until then, three claims are exercised and four are declared, and a green
    // run on this file must not be read as four.
    for (const [name, row] of Object.entries(ROWS)) {
      if (row.skip) continue;
      const target = await row.make();
      assert.equal(canVetoDebugInput(target), false,
        `${name} now declares a veto — C4 needs a positive case, which this file does not have`);
    }
  });

  it('the predicate CAN say true, so the assertion above is not vacuous', () => {
    const declaring = {
      applyReplayInput: () => ({ accepted: true }),
      onDebugInput: () => () => {},
      capabilities: () => ({ extensions: { inputAdmission: 'may-refuse' } })
    };
    assert.equal(canVetoDebugInput(declaring), true);
  });

  it('emu8051-adapter answers false for a STRUCTURAL reason, stated here', () => {
    // It has no capabilities() at all, so the predicate would answer false even
    // if it grew a veto. The answer is right and the reason is not the one the
    // predicate is checking; recorded so nobody reads this row as evidence.
    const text = readFileSync(join(SRC, 'emu8051-adapter.js'), 'utf8');
    assert.equal(text.includes('capabilities()'), false,
      'emu8051-adapter grew a capabilities() — canVetoDebugInput now means what it says '
      + 'for it, and this note can go');
  });
});

describe('C6 has NO subject in this tree, and that is asserted rather than assumed', () => {
  // A conformance check added later, against callers that already exist, is a
  // check nobody has ever seen fail. So this one is written now, while its
  // subject is absent, in the form that will notice a subject arriving.
  it('no target here installs instruction-debug-events, so the claim is unexercised', () => {
    const installers = readdirSync(SRC)
      .filter(name => name.endsWith('.js') && name !== 'instruction-debug-events.js')
      .filter(name => readFileSync(join(SRC, name), 'utf8').includes('installInstructionDebugEvents'));

    assert.deepEqual(installers, [],
      `${installers.join(', ')} now installs instruction-debug-events — C6 needs a positive case: `
      + 'drive that target into HALT/WAI/SLEEP and assert an idle/elapse fact appears. '
      + 'Five claims are exercised in this file and six are declared; do not let a green run '
      + 'be read as six.');
  });

  it('and the module it would be about really can produce that fact', async () => {
    // Guards the absence above from being satisfied by a module that cannot do
    // the thing either — an absence is only informative if the thing exists.
    //
    // DRIVEN, NOT GREPPED. My first version matched the module's source for
    // `machine.step = outer`, and commenting that line out left the text in the
    // comment and the assertion green — the same trap as a file documenting a
    // sibling answering a vocabulary grep with the sibling's answer, in the
    // check written the same afternoon I named it.
    const { installInstructionDebugEvents } =
      await import('../src/instruction-debug-events.js');
    const machine = new Z80Machine(
      { clockHz: 4_000_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
    machine.load(Uint8Array.from([0x76]), 0);          // HALT
    machine.cpu.pc = 0;

    const seen = [];
    installInstructionDebugEvents({ cpu: machine.cpu, machine, cpuId: 't', timeDomain: 'ticks' })
      .onDebugEvent(e => seen.push(`${e.kind}/${e.phase}`));

    machine.step();                                    // executes the HALT
    seen.length = 0;
    machine.step();                                    // now parked

    assert.ok(machine.cpu.halted, 'the fixture must actually park');
    assert.deepEqual(seen, ['idle/elapse'],
      'the module can no longer report that time passed with nothing retiring');
  });
});
