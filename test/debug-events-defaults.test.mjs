/**
 * EVERY PARAMETER'S DEFAULT IS EXACTLY TODAY'S BEHAVIOUR, proved by the fact
 * stream rather than by reading the diff.
 *
 * `instruction-debug-events.js` gained four parameters so that one core whose
 * spelling differs everywhere — avr8js — can use it: an accessor-name map, an
 * injected instruction bracket, a program-counter transform and a clock. Three
 * machines already depend on this module and none of them may change by a byte.
 *
 * SO THE FIXTURE IS A CAPTURE, TAKEN BEFORE THE PARAMETERS EXISTED. Every fact
 * below was produced by the module as it stood at bw-board `3a26e9a`, running
 * the programs in this file. If a default drifts, one of these lines stops
 * matching and names itself. Reading the diff would have proved nothing: the
 * whole risk is a default that looks equivalent and is not.
 *
 * The programs are chosen to reach every fact kind the defaults produce — a
 * memory read, a memory write, instruction retires, and a parked core — so an
 * unchanged stream is a claim about all of them rather than about whichever
 * ones a shorter program happened to hit.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installInstructionDebugEvents } from '../src/instruction-debug-events.js';
import { Z80Machine } from '../src/z80-machine.js';
import { M6502Machine } from '../src/m6502-machine.js';
import { GOLDEN } from './fixtures/debug-events-golden.mjs';

/** BigInt is not JSON, and the stamps are BigInt. */
const serialise = event => JSON.stringify(event, (k, v) => (typeof v === 'bigint' ? `${v}n` : v));

const machines = {
  z80: {
    domain: 'z80-tstates',
    make: () => {
      const machine = new Z80Machine(
        { clockHz: 4_000_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
      machine.load(Uint8Array.from([0x3a, 0x00, 0x20, 0x32, 0x01, 0x20, 0x76]), 0);
      machine.cpu.pc = 0;                       // LD A,(2000) / LD (2001),A / HALT
      return machine;
    }
  },
  m6502: {
    domain: 'm6502-cycles',
    make: () => {
      const machine = new M6502Machine({ clockHz: 1_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0x7fff }, { kind: 'rom', start: 0x8000, end: 0xffff }],
        chips: [] }, {});
      machine.loadRom([0xad, 0x00, 0x02, 0x8d, 0x01, 0x02, 0x58, 0xcb]);
      machine.mem[0xfffc] = 0x00; machine.mem[0xfffd] = 0x80;   // LDA / STA / CLI / WAI
      machine.reset();
      return machine;
    }
  }
};

const streamOf = (name, options = {}) => {
  const machine = machines[name].make();
  const events = installInstructionDebugEvents({
    cpu: machine.cpu, machine, cpuId: name, timeDomain: machines[name].domain, ...options });
  const facts = [];
  events.onDebugEvent(event => facts.push(serialise(event)));
  for (let i = 0; i < 6; i++) machine.step();
  return facts;
};

describe('the defaults reproduce the captured stream exactly', () => {
  for (const name of Object.keys(machines)) {
    it(`${name}: every fact, byte for byte`, () => {
      assert.deepEqual(streamOf(name), GOLDEN[name],
        `${name}'s fact stream changed. A parameter's default is no longer what the module did `
        + 'at 3a26e9a. If the change is intended, re-capture — but read the diff first: three '
        + 'machines depend on this and none of them was supposed to move.');
    });
  }

  it('the fixture is not empty, and covers more than one kind of fact', () => {
    // An empty or single-kind golden satisfies the assertions above while
    // proving almost nothing.
    for (const name of Object.keys(machines)) {
      assert.ok(GOLDEN[name].length >= 10, `${name} golden has only ${GOLDEN[name].length} facts`);
      const kinds = new Set(GOLDEN[name].map(f => JSON.parse(f).kind));
      assert.ok(kinds.size >= 2, `${name} golden covers only ${[...kinds]}`);
    }
  });
});

describe('each default equals its explicit spelling', () => {
  // The golden catches a default drifting. This catches the other direction: a
  // default that no longer MEANS what its documented equivalent means, which a
  // capture cannot see because both sides move together.
  const explicit = {
    accessors: { read: 'read', write: 'write', inPort: 'inPort', outPort: 'outPort' },
    pcOf: cpu => cpu.pc & 0xffff
  };

  for (const name of Object.keys(machines)) {
    it(`${name}: spelling every default out loud changes nothing`, () => {
      assert.deepEqual(streamOf(name, explicit), streamOf(name));
    });
  }

  it('a DIFFERENT value really does change the stream, so the check is not vacuous', () => {
    // Without this, the two assertions above pass for a module that ignores the
    // parameters entirely.
    const shifted = streamOf('z80', { pcOf: cpu => (cpu.pc & 0xffff) + 1 });
    assert.notDeepEqual(shifted, GOLDEN.z80, 'pcOf was ignored');
  });
});

describe('the injected bracket produces the same facts as the wrapped one', () => {
  /**
   * The bracket is the INNER one — the instruction. Idle is published by the
   * separate outer `machine.step` bracket, which a core driven through
   * `aroundInstruction` does not go through; the first draft of this test
   * asserted whole-stream equality and reddened on exactly those two idle
   * facts, which is the module telling the truth. So the claim is stated where
   * it is actually true: everything the INSTRUCTION bracket produces is
   * indistinguishable, and idle is accounted for separately below.
   */
  const withoutIdle = facts => facts.filter(f => JSON.parse(f).kind !== 'idle');

  const drivenByHand = () => {
    const machine = machines.m6502.make();
    const events = installInstructionDebugEvents({
      cpu: machine.cpu, machine, cpuId: 'm6502', timeDomain: 'm6502-cycles' });
    const facts = [];
    events.onDebugEvent(event => facts.push(serialise(event)));
    // Drive it the way an adapter whose step is a free function would: call the
    // core directly, going round the wrapper the module put on cpu.step, and
    // advance the machine clock ourselves as that adapter's own loop does.
    const bare = Object.getPrototypeOf(machine.cpu).step.bind(machine.cpu);
    for (let i = 0; i < 6; i++) machine.cycles += events.aroundInstruction(bare) || 0;
    return facts;
  };

  it('every non-idle fact, byte for byte', () => {
    assert.deepEqual(withoutIdle(drivenByHand()), withoutIdle(GOLDEN.m6502));
  });

  it('and the idle facts are the ones the outer bracket owns', () => {
    // Names the difference rather than filtering it away silently: if idle ever
    // starts coming out of the instruction bracket too, this reds.
    assert.ok(GOLDEN.m6502.some(f => JSON.parse(f).kind === 'idle'),
      'the golden no longer parks, so this test compares nothing');
    assert.equal(drivenByHand().filter(f => JSON.parse(f).kind === 'idle').length, 0);
  });

  it('refuses anything that is not a function, BY NAME', () => {
    const machine = machines.z80.make();
    const events = installInstructionDebugEvents({
      cpu: machine.cpu, machine, cpuId: 'z80', timeDomain: 'z80-tstates' });
    for (const bad of [undefined, null, 42, 'step', {}]) {
      // The message matters, not just the class. Deleting the type check leaves
      // this throwing a TypeError anyway — `execute is not a function`, raised
      // from inside the bracket after it has already begun. A bare
      // `assert.throws(…, TypeError)` passes against that, and did: the
      // mutation that removes the guard survived it. Naming the message is what
      // separates a refusal from a crash.
      assert.throws(() => events.aroundInstruction(bad),
        /aroundInstruction needs a function that runs one instruction/);
    }
  });

  it('leaves no `step` behind on a core that never had one', () => {
    // `removeHooks` restores `cpu.step` from the saved value. On a core with no
    // step, both the saved value and ours are undefined, so an unguarded
    // restore ASSIGNS undefined — creating a `step` property that answers
    // `'step' in cpu` with true and `typeof cpu.step` with 'undefined'. A
    // caller probing for a step then finds one that cannot be called.
    const cpu = { pc: 0, cycles: 0, readData: () => 0, writeData: () => {} };
    const events = installInstructionDebugEvents({
      cpu, machine: { clockHz: 1 }, cpuId: 'avr', timeDomain: 'avr-cycles',
      accessors: { read: 'readData', write: 'writeData' },
      pcOf: c => c.pc * 2, clock: () => cpu.cycles });
    const off = events.onDebugEvent(() => {});
    off();
    assert.equal('step' in cpu, false, 'the restore invented a `step`');
  });

  it('is the bare call with no listener attached', () => {
    let ran = 0;
    const machine = machines.z80.make();
    const events = installInstructionDebugEvents({
      cpu: machine.cpu, machine, cpuId: 'z80', timeDomain: 'z80-tstates' });
    assert.equal(events.aroundInstruction(() => { ran++; return 7; }), 7);
    assert.equal(ran, 1);
  });
});

/**
 * THE PARAMETERS ARE LOAD-BEARING, not decorative. The tests above prove the
 * defaults did not move; these prove the four parameters actually reach a core
 * shaped like the one they were added for.
 *
 * The fake is avr8js's shape as MEASURED, not as imagined: `readData`/`writeData`
 * (there is no `read`/`write`), a `pc` counting WORDS, a cycle counter on the
 * CPU rather than the machine, and NO `cpu.step` — avr8js's `avrInstruction(cpu)`
 * is a free function, which is why the bracket had to become injectable.
 */
describe('a core that spells all four differently', () => {
  const makeAvrShaped = () => {
    const cpu = {
      pc: 0x10,                       // words: byte address 0x20
      cycles: 100,
      data: new Uint8Array(0x200),
      readData(address) { return this.data[address]; },
      writeData(address, value) { this.data[address] = value; }
    };
    // No `step`. The adapter runs one instruction itself.
    const machine = { clockHz: 16_000_000 };
    return { cpu, machine };
  };

  const install = ({ cpu, machine }) => installInstructionDebugEvents({
    cpu, machine, cpuId: 'avr', timeDomain: 'avr-cycles',
    accessors: { read: 'readData', write: 'writeData' },
    pcOf: c => c.pc * 2,
    clock: () => cpu.cycles
  });

  it('installs on readData/writeData and leaves read/write alone', () => {
    const target = makeAvrShaped();
    const events = install(target);
    const facts = [];
    events.onDebugEvent(event => facts.push(event));

    events.aroundInstruction(() => {
      target.cpu.readData(0x40);
      target.cpu.writeData(0x41, 0x5a);
      target.cpu.pc += 1;
      target.cpu.cycles += 2;
      return 2;
    });

    assert.equal(target.cpu.read, undefined, 'invented a `read` that the core does not have');
    const accesses = facts.filter(f => f.phase === 'access');
    assert.deepEqual(accesses.map(a => a.memory.direction), ['read', 'write']);
    assert.equal(accesses[1].memory.value, 0x5a);
    assert.equal(target.cpu.data[0x41], 0x5a, 'the wrapper swallowed the write');
  });

  it('reports the program counter in BYTES, which is what the word-counting core means', () => {
    const target = makeAvrShaped();
    const events = install(target);
    const facts = [];
    events.onDebugEvent(event => facts.push(event));

    events.aroundInstruction(() => { target.cpu.pc += 1; target.cpu.cycles += 1; return 1; });

    const retire = facts.find(f => f.kind === 'instruction');
    assert.equal(retire.pcBefore, 0x20);
    assert.equal(retire.pcAfter, 0x22);
  });

  it('stamps from the CPU counter, there being no machine.cycles to read', () => {
    const target = makeAvrShaped();
    assert.equal(target.machine.cycles, undefined, 'the fake stopped being the shape under test');
    const events = install(target);
    const facts = [];
    events.onDebugEvent(event => facts.push(event));

    events.aroundInstruction(() => { target.cpu.cycles += 3; return 3; });

    const retire = facts.find(f => f.kind === 'instruction');
    assert.equal(retire.time.ticks, 103n, 'stamped 100 + 3 from the CPU clock');
    // Asserted as a Number here when this lane found it, reported, and FIXED
    // in the follow-up: the read now carries a BigInt like every stamp, so
    // `===` between a read and a fact of the same instant finally holds.
    assert.equal(events.debugTime().ticks, 103n);
    assert.equal(events.debugTime().ticks === retire.time.ticks, true);
  });

  it('publishes idle through the declared vocabulary, not a second mechanism', () => {
    // The AVR adapter knows when it has parked; it says so with the method the
    // module already has, rather than growing a parallel one.
    const target = makeAvrShaped();
    const events = install(target);
    const facts = [];
    events.onDebugEvent(event => facts.push(event));

    target.cpu.cycles += 500;
    events.publishIdleElapse({ cycles: 500 });

    const idle = facts.find(f => f.kind === 'idle');
    assert.equal(idle.changes.cycles, 500);
    assert.equal(idle.time.ticks, 600n);
  });
});
