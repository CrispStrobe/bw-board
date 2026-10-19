/**
 * `installInstructionDebugEvents`, driven directly.
 *
 * The module arrived from a downstream consumer where its only two callers are
 * debug targets, so this is the first place it is exercised on its own terms.
 * That matters more than usual: a module tested only through its consumers is
 * tested against whatever those consumers happen to do, and the properties it
 * actually promises — the reconstructed/recorded distinction, the shared
 * instruction start time, the epoch — are exactly the ones a consumer can
 * satisfy accidentally.
 *
 * THE FAKE CPU IS THE POINT OF THE FILE. A real core would make several of
 * these unobservable: a step that throws, a step that retires zero cycles, and
 * a program that overwrites the instruction being executed are all easy to
 * construct here and hard to arrange on hardware.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { installInstructionDebugEvents } from '../src/instruction-debug-events.js';
import { Z80Machine } from '../src/z80-machine.js';
import { M6502Machine } from '../src/m6502-machine.js';

/**
 * A CPU that does exactly what a test tells it to on each step.
 *
 * `plan` is consumed one entry per step: `{reads, writes, ins, outs, cycles,
 * pcAfter, throws, during}`. Everything is optional. `during` runs INSIDE the
 * step, which is the only place a peripheral's own callback can fire.
 */
function fakeCpu(plan = [], machine = null) {
  const cpu = {
    pc: 0x100,
    a: 0, x: 0,
    read: address => cpu.mem[address & 0xffff] ?? 0,
    write: (address, value) => { cpu.mem[address & 0xffff] = value & 0xff; },
    inPort: () => 0x5a,
    outPort: () => {},
    mem: new Uint8Array(0x10000),
    step() {
      const s = plan.shift() ?? {};
      for (const a of s.reads ?? []) cpu.read(a);
      for (const [a, v] of s.writes ?? []) cpu.write(a, v);
      for (const p of s.ins ?? []) cpu.inPort(p);
      for (const [p, v] of s.outs ?? []) cpu.outPort(p, v);
      if (s.during) s.during();
      if (s.regs) Object.assign(cpu, s.regs);
      if (s.throws) throw new Error(s.throws);
      cpu.pc = s.pcAfter ?? (cpu.pc + 1);
      // THE MACHINE CLOCK MOVES DURING THE STEP, as a real one does. Without
      // this the instruction's start and end ticks are equal in every fixture,
      // and a mutation stamping the accesses at the END instead of the start
      // is inert — which is exactly what happened on the first pass.
      if (machine) machine.cycles += s.cycles ?? 4;
      return s.cycles ?? 4;
    }
  };
  return cpu;
}

const install = (cpu, machine, opts = {}) => installInstructionDebugEvents({
  cpu, machine, cpuId: 'test', timeDomain: 'test-ticks',
  rewindLabel: 'reset',            // required; 'reset' keeps the synthetic domain's existing assertions
  captureRegisters: () => ({ a: cpu.a, x: cpu.x }),
  captureInstruction: address => ({ address, bytes: [cpu.mem[address], cpu.mem[address + 1]] }),
  ...opts
});

const record = events => {
  const seen = [];
  const stop = events.onDebugEvent(e => seen.push(e));
  return { seen, stop };
};

describe('the retire is RECORDED and the accesses are RECONSTRUCTED', () => {
  it('one step publishes its accesses, then its retire', () => {
    // Ordering is the contract: a driver deciding where to break needs the
    // accesses to arrive before the boundary they belong to.
    const machine = { cycles: 1000, clockHz: 1e6 };
    const cpu = fakeCpu([{ reads: [0x20], writes: [[0x30, 0xaa]], cycles: 7, pcAfter: 0x104 }], machine);
    const events = install(cpu, machine);
    const { seen } = record(events);

    machine.cycles = 1000;
    cpu.step();

    assert.deepEqual(seen.map(e => `${e.kind}/${e.phase}`),
      ['memory/access', 'memory/access', 'instruction/retire']);
    assert.deepEqual(seen.map(e => e.fidelity),
      ['reconstructed', 'reconstructed', 'recorded']);
    assert.deepEqual(seen.map(e => e.cpuId), ['test', 'test', 'test']);
  });

  it('every access inside one instruction shares that instruction’s START time', () => {
    // The module's whole premise: the accesses are real and ordered, and their
    // individual cycle times are NOT known, so they are stamped with the
    // instruction's start and declared reconstructed rather than invented.
    const machine = { cycles: 500, clockHz: 1e6 };
    const cpu = fakeCpu([{ reads: [0x20, 0x21], writes: [[0x30, 1]], cycles: 9 }], machine);
    const events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();

    const accesses = seen.filter(e => e.phase === 'access');
    assert.equal(accesses.length, 3);
    assert.ok(accesses.every(e => e.time.ticks === 500n),
      `accesses were stamped ${accesses.map(e => e.time.ticks).join(', ')}, not all 500`);

    // And the retire is stamped at the END: start + the cycles it consumed.
    const retire = seen.find(e => e.phase === 'retire');
    assert.equal(retire.time.ticks, 509n, 'the retire lands after the instruction it reports');
  });

  it('reads and writes carry their direction, address and value', () => {
    const cpu = fakeCpu([{ reads: [0x1234], writes: [[0x5678, 0xbe]] }]);
    const cpuMem = 0x77;
    const machine = { cycles: 0, clockHz: 1e6 };
    const events = install(cpu, machine);
    cpu.mem[0x1234] = cpuMem;
    const { seen } = record(events);

    cpu.step();

    const [readFact, writeFact] = seen.filter(e => e.kind === 'memory');
    assert.deepEqual(readFact.memory,
      { space: 'mem', address: 0x1234, width: 1, direction: 'read', value: cpuMem });
    assert.deepEqual(writeFact.memory,
      { space: 'mem', address: 0x5678, width: 1, direction: 'write', value: 0xbe });
  });
});

describe('the instruction fact', () => {
  it('carries the pc either side and the cycles it consumed', () => {
    const cpu = fakeCpu([{ cycles: 12, pcAfter: 0x200 }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const { seen } = record(events);

    cpu.step();

    const retire = seen.find(e => e.kind === 'instruction');
    assert.equal(retire.pcBefore, 0x100);
    assert.equal(retire.pcAfter, 0x200);
    assert.equal(retire.changes.cycles, 12);
  });

  it('reports only the registers that CHANGED', () => {
    const cpu = fakeCpu([{ regs: { a: 0x42 } }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const { seen } = record(events);

    cpu.step();

    const retire = seen.find(e => e.kind === 'instruction');
    assert.deepEqual(retire.changes.registers, { a: { before: 0, after: 0x42 } },
      'x did not change and must not be listed');
    assert.deepEqual(retire.registersAfter, { a: 0x42, x: 0 });
  });

  it('CAPTURES THE INSTRUCTION BEFORE EXECUTING IT, because code overwrites itself', () => {
    // The module says so in a comment; this is the case that makes it true.
    // A capture taken afterwards reports the bytes the instruction WROTE, not
    // the ones that ran.
    const cpu = fakeCpu([{ writes: [[0x100, 0xff], [0x101, 0xff]] }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    cpu.mem[0x100] = 0xa9; cpu.mem[0x101] = 0x01;
    const { seen } = record(events);

    cpu.step();

    const retire = seen.find(e => e.kind === 'instruction');
    assert.deepEqual(retire.instruction, { address: 0x100, bytes: [0xa9, 0x01] },
      'the captured bytes are the ones that ran, not the ones the step wrote over them');
  });

  it('a step that retires NO cycles publishes no instruction fact', () => {
    // A halted or waiting core consumes nothing; reporting a retire would put
    // an instruction in the log that never happened.
    const cpu = fakeCpu([{ cycles: 0, reads: [0x10] }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const { seen } = record(events);

    cpu.step();

    assert.deepEqual(seen.map(e => e.kind), ['memory'],
      'the access is still evidence; the retire is not');
  });

  it('accesses are published even when the step THROWS', () => {
    // They are in a `finally`. An exception mid-instruction still leaves real
    // ordered evidence of what the CPU did before it failed, and losing it is
    // losing the only record of the failing instruction's behaviour.
    const cpu = fakeCpu([{ reads: [0x40], throws: 'bus fault' }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const { seen } = record(events);

    assert.throws(() => cpu.step(), /bus fault/);
    assert.deepEqual(seen.map(e => `${e.kind}/${e.phase}`), ['memory/access'],
      'the access survived the throw and no retire was claimed');
  });
});

describe('listeners', () => {
  it('takes MANY, and each gets every event', () => {
    // Deliberately different from avr8js-debug.js, which takes one and throws
    // on a second. Same method name, different contract — asserted here so the
    // divergence is visible rather than discovered by a driver.
    const cpu = fakeCpu([{}]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const a = [], b = [];
    events.onDebugEvent(e => a.push(e));
    events.onDebugEvent(e => b.push(e));

    cpu.step();

    assert.equal(a.length, 1);
    assert.equal(b.length, 1);
  });

  it('unsubscribing stops that listener and leaves the others', () => {
    const cpu = fakeCpu([{}, {}]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const a = [], b = [];
    const stopA = events.onDebugEvent(e => a.push(e));
    events.onDebugEvent(e => b.push(e));

    cpu.step();
    stopA();
    cpu.step();

    assert.equal(a.length, 1);
    assert.equal(b.length, 2);
  });

  it('refuses a listener that is not a function', () => {
    const events = install(fakeCpu(), { cycles: 0, clockHz: 1e6 });
    assert.throws(() => events.onDebugEvent(null), TypeError);
  });

  it('WITH NO LISTENERS THE INSTRUMENTATION IS SKIPPED, not merely silent', () => {
    // `if (!listeners.size) return originalStep()` — the register and
    // instruction samples are behind listener opt-in, so an uninstrumented run
    // pays nothing. Observable because the capture callbacks are the test's.
    let captured = 0;
    const cpu = fakeCpu([{}, {}]);
    const events = installInstructionDebugEvents({
      cpu, machine: { cycles: 0, clockHz: 1e6 }, cpuId: 'test', timeDomain: 'test-ticks', rewindLabel: 'reset',
      captureRegisters: () => { captured++; return { a: cpu.a }; },
      captureInstruction: address => ({ address })
    });

    cpu.step();
    assert.equal(captured, 0, 'nothing was sampled while nobody was listening');

    events.onDebugEvent(() => {});
    cpu.step();
    assert.ok(captured > 0, 'and sampling starts when someone is');
  });
});

describe('port access, and only when asked for', () => {
  it('publishes port facts when port: true', () => {
    const cpu = fakeCpu([{ ins: [0x1f], outs: [[0xfe, 0x07]] }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 }, { port: true });
    const { seen } = record(events);

    cpu.step();

    const ports = seen.filter(e => e.kind === 'port');
    assert.deepEqual(ports.map(e => e.port.direction), ['read', 'write']);
    assert.equal(ports[0].port.value, 0x5a, 'the value the CPU actually read back');
    assert.equal(ports[1].port.address, 0xfe);
  });

  it('leaves the port hooks alone when port is not set', () => {
    // A machine with no port space would otherwise publish facts about an
    // address space it does not have.
    const cpu = fakeCpu([{ ins: [0x1f] }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const { seen } = record(events);

    cpu.step();

    assert.equal(seen.filter(e => e.kind === 'port').length, 0);
  });
});

describe('the epoch: a fact after a rewind names a different timeline', () => {
  it('a tick REGRESSION opens a new era', () => {
    const cpu = fakeCpu([{}, {}]);
    const machine = { cycles: 1000, clockHz: 1e6 };
    const events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();
    assert.equal(seen.at(-1).time.domain, 'test-ticks', 'the first era is unnumbered');

    machine.cycles = 10;                 // a restore
    cpu.step();
    assert.equal(seen.at(-1).time.domain, 'test-ticks-reset-1');
  });

  it('openTimeEpoch declares one OUTRIGHT, which detection cannot do', () => {
    // The case a clock cannot see: a restore followed by running past the old
    // high-water mark is monotonic from the inside. Only the thing that
    // performed the restore knows, which is why this entry point exists.
    const cpu = fakeCpu([{}, {}]);
    const machine = { cycles: 1000, clockHz: 1e6 };
    const events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();
    machine.cycles = 5000;               // forward, but a different timeline
    events.openTimeEpoch();
    cpu.step();

    assert.equal(seen.at(-1).time.domain, 'test-ticks-reset-1',
      'the epoch moved on a declaration, with the clock going forward');
  });

  it('and it clears the high-water mark, so the NEXT regression is still seen', () => {
    // `lastTicks = null` inside openTimeEpoch. Without it a declared epoch at a
    // low tick would leave the old high mark in place and swallow the next
    // genuine regression.
    const cpu = fakeCpu([{}, {}, {}]);
    const machine = { cycles: 9000, clockHz: 1e6 };
    const events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();                          // high-water mark at 9000
    machine.cycles = 100;
    events.openTimeEpoch();              // declared, era 1
    cpu.step();
    assert.equal(seen.at(-1).time.domain, 'test-ticks-reset-1');

    machine.cycles = 50;                 // a genuine regression inside era 1
    cpu.step();
    assert.equal(seen.at(-1).time.domain, 'test-ticks-reset-2');
  });

  it('rewindLabel names the epoch suffix — the same regression, a different word', () => {
    // The parameter is REQUIRED and per-target: a core whose reset() ADVANCES the
    // clock (z80, 6502, 8086 — backward move is loadState/restore) stamps
    // `-rewind-`, not `-reset-`. This reds against the pre-parameter module, which
    // hardcoded `-reset-` for every core, and it is why lite forbids converging
    // the 8051's (correct) `-reset-` with the others.
    const cpu = fakeCpu([{}, {}]);
    const machine = { cycles: 1000, clockHz: 1e6 };
    const events = install(cpu, machine, { rewindLabel: 'rewind' });
    const { seen } = record(events);

    cpu.step();
    assert.equal(seen.at(-1).time.domain, 'test-ticks', 'the first era is unnumbered, label unused');
    machine.cycles = 10;                 // a restore
    cpu.step();
    assert.equal(seen.at(-1).time.domain, 'test-ticks-rewind-1',
      'the suffix is the caller\'s word, not a module constant');
    // debugTime() reads the SAME label, not a second spelling.
    assert.equal(events.debugTime().domain, 'test-ticks-rewind-1');
  });

  it('rewindLabel is REQUIRED — a caller that omits it is told, not defaulted', () => {
    // No safe default: `-reset-` is wrong for every core that reaches this code,
    // and a default would go invisible the moment a fifth consumer forgot it.
    const cpu = fakeCpu([{}]);
    assert.throws(
      () => installInstructionDebugEvents({ cpu, machine: { cycles: 0, clockHz: 1 },
        cpuId: 'x', timeDomain: 'x-ticks' }),
      /rewindLabel/,
      'omitting rewindLabel must throw and name the parameter');
  });

  it('debugTime() READS the clock and does not advance it', () => {
    // The split proved load-bearing on the replay surface: if asking the time
    // consumed a rewind, a driver that merely enquired after a restore would
    // leave the next real event stamped in an era nothing explains.
    const cpu = fakeCpu([{}, {}]);
    const machine = { cycles: 1000, clockHz: 1e6 };
    const events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();                          // high-water mark at 1000
    machine.cycles = 10;                 // a restore
    events.debugTime();                  // must NOT consume the regression
    events.debugTime();
    machine.cycles = 5000;               // then FORWARD, past the old mark
    cpu.step();

    // Running forward past the high-water mark is the one case a clock cannot
    // see, so the era must still be unnumbered — unless debugTime consumed the
    // regression on its way past, which is the mutation this catches. Reading
    // the clock at the SAME tick as the step would pass either way.
    assert.equal(seen.at(-1).time.domain, 'test-ticks',
      'reading the clock consumed the regression and opened an era nothing explains');
  });

  it('the READ and the STAMP are the same type, so === between them works', () => {
    // A module whose facts carry BigInt ticks and whose clock-read returns a
    // Number is a trap that no single call can see: both look right, both
    // print the same digits, and `===` or `deepEqual` between them is false
    // forever with nothing to indicate why. Found by a test that compared the
    // two and had to be written wrong to pass.
    //
    // Not hypothetical downstream: five separate places in the consumer layer
    // coerce `time.ticks` through their own BigInt() normaliser before daring
    // to compare it. That duplication is the compensation for this.
    const machine = { cycles: 700, clockHz: 1e6 };
    const cpu = fakeCpu([{ cycles: 4 }], machine);
    const events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();
    const stamp = seen.at(-1).time;
    const read = events.debugTime();

    assert.equal(typeof read.ticks, typeof stamp.ticks,
      `the read is ${typeof read.ticks} and the stamp is ${typeof stamp.ticks}`);
    assert.equal(read.ticks === stamp.ticks, true,
      `the values print the same (${read.ticks} / ${stamp.ticks}) and === says otherwise: `
      + 'a Number/BigInt split');
    assert.deepEqual(read, stamp, 'the read after the instruction is the retire stamp');

    // AND THE FIXTURE HAS TO ADVANCE THE CLOCK FOR THAT TO MEAN ANYTHING. The
    // retire stamp is a PROJECTION — `ticksBefore + cycles` — not a read. A
    // fake whose step leaves `machine.cycles` alone makes the two disagree by
    // the instruction's cost while both are perfectly correct, which is a
    // property of the fixture rather than of the module.
    assert.equal(machine.cycles, 704, 'the fixture stopped advancing the clock');
  });

  it('debugTime reports the machine clock and the domain of the current era', () => {
    const cpu = fakeCpu([{}]);
    const machine = { cycles: 4242, clockHz: 3_500_000 };
    const events = install(cpu, machine);
    assert.deepEqual(events.debugTime(),
      { ticks: 4242n, domain: 'test-ticks', hz: 3_500_000 });

    events.openTimeEpoch();
    assert.equal(events.debugTime().domain, 'test-ticks-reset-1');
  });
});

describe('an access observed by something OTHER than the wrappers', () => {
  // The wrappers see what goes through the CPU. They cannot see an access a
  // PERIPHERAL completes on its own clock — an SPI transfer finishing some
  // cycles after the store that started it, a TWI START issued from a bridge
  // callback. Those are real, ordered evidence about the same instruction,
  // observed by something else, and before this they were hand-rolled by every
  // target that had any.
  //
  // BOTH HALVES ARE TESTED ON PURPOSE. The hand-rolled logic being replaced had
  // an in-window path and an out-of-window one, and a fold that keeps only the
  // common case loses the half nobody thought to test.

  it('IN a window: it joins the instruction, before the retire, at the START time', () => {
    const machine = { cycles: 500, clockHz: 1e6 };
    let events;
    // `during` runs INSIDE the step, which is the only place a peripheral's own
    // callback can fire — and therefore the only place the window is open.
    const cpu = fakeCpu([{ reads: [0x20], cycles: 6, during: () => events.recordAccess(
      { kind: 'device', device: { id: 'twi0', bus: 'twi', event: 'start' } }) }], machine);
    events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();

    assert.deepEqual(seen.map(e => `${e.kind}/${e.phase}`),
      ['memory/access', 'device/access', 'instruction/retire']);
    const device = seen[1];
    assert.equal(device.time.ticks, 500n, 'the contributed access carries the instruction START');
    assert.ok(device.time.ticks < seen[2].time.ticks,
      'and the retire carries the completion time');
    assert.deepEqual(device.device, { id: 'twi0', bus: 'twi', event: 'start' });
  });

  it('OUT of a window: it publishes immediately and invents no instruction', () => {
    const machine = { cycles: 900, clockHz: 1e6 };
    const cpu = fakeCpu([{}], machine);
    const events = install(cpu, machine);
    const { seen } = record(events);

    events.recordAccess({ kind: 'device', device: { id: 'spi0', bus: 'spi', event: 'transfer' } });

    assert.deepEqual(seen.map(e => `${e.kind}/${e.phase}`), ['device/access']);
    assert.equal(seen[0].time.ticks, 900n, 'stamped at the clock, there being no instruction');
  });

  it('says WHERE it came from, and a wrapped access says something different', () => {
    // Condition from review: either the two are the same evidence and that is
    // asserted, or they are not and the fact says so. What must not happen is
    // that the difference exists unstated.
    const machine = { cycles: 10, clockHz: 1e6 };
    let events;
    const cpu = fakeCpu([{ reads: [0x20], cycles: 2,
      during: () => events.recordAccess({ kind: 'device', device: { id: 'x' } }) }], machine);
    events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();

    const [wrapped, contributed] = seen;
    assert.equal(wrapped.cause, 'instruction-access');
    assert.equal(contributed.cause, 'peripheral-access');
    // FIDELITY IS THE SAME, and that is the assertion rather than an accident:
    // `reconstructed` means the timestamp came from the instruction boundary
    // rather than the access, which is equally true of both.
    assert.equal(wrapped.fidelity, 'reconstructed');
    assert.equal(contributed.fidelity, 'reconstructed');
    assert.equal(wrapped.time.ticks, contributed.time.ticks,
      'both inherit the instruction start; that is what reconstructed MEANS here');
  });

  it('refuses a fact with no kind, and does nothing at all with no listener', () => {
    const machine = { cycles: 0, clockHz: 1e6 };
    const cpu = fakeCpu([{}], machine);
    const events = install(cpu, machine);

    assert.equal(events.recordAccess({ kind: 'device' }), false,
      'published to nobody');                       // no listener yet

    const { seen } = record(events);
    for (const bad of [undefined, null, 42, 'device', {}, { kind: 7 }]) {
      assert.throws(() => events.recordAccess(bad),
        /recordAccess needs an access fact carrying a kind/);
    }
    assert.deepEqual(seen, [], 'a refused contribution published nothing');
  });
});

describe('the accessor wrappers cost nothing while nobody is listening', () => {
  // MEASURED, not stylistic. With the wrappers installed at construction, a
  // memory-bound program paid for a debugger nobody had opened:
  //
  //   6502   400k steps   no target 104ms   target installed 118ms   1.14x
  //   z80    400k steps   no target  78ms   target installed 112ms   1.43x
  //
  // The z80 is worse because it passes `port: true` and wraps four methods
  // rather than two. The constant is ~45ns per access, so the ratio belongs to
  // the program: the same wrapper on a pin-toggle loop measures 1.06x and looks
  // free. That is why this is asserted STRUCTURALLY here rather than as a
  // timing — a wall clock on this hardware cannot separate 1.06x from noise,
  // and identity can.

  it('installs nothing until the first listener arrives', () => {
    const cpu = fakeCpu();
    const read = cpu.read, write = cpu.write;
    install(cpu, { cycles: 0, clockHz: 1e6 });

    assert.equal(cpu.read, read, 'cpu.read was wrapped with no listener attached');
    assert.equal(cpu.write, write, 'cpu.write was wrapped with no listener attached');
  });

  it('installs on the first listener and removes on the last', () => {
    const cpu = fakeCpu();
    const read = cpu.read, write = cpu.write;
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });

    const stopA = events.onDebugEvent(() => {});
    assert.notEqual(cpu.read, read, 'the first listener did not install the wrapper');
    const wrapped = cpu.read;

    const stopB = events.onDebugEvent(() => {});
    assert.equal(cpu.read, wrapped, 'a second listener must not wrap the wrapper');

    stopA();
    assert.equal(cpu.read, wrapped, 'the wrapper came off while a listener was still attached');

    stopB();
    assert.equal(cpu.read, read, 'the last listener left and the wrapper stayed');
    assert.equal(cpu.write, write);
  });

  it('and the facts still arrive after a re-attach', () => {
    // The cycle has to be idempotent: off, on, off, on must record the same
    // way the first attachment did, or the saving costs correctness.
    const cpu = fakeCpu([{ reads: [0x20] }, { reads: [0x20] }]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });

    const first = [];
    events.onDebugEvent(e => first.push(e))();     // attach and immediately detach
    cpu.step();
    assert.equal(first.length, 0, 'a detached listener still received a fact');

    const second = [];
    events.onDebugEvent(e => second.push(e));
    cpu.step();
    assert.deepEqual(second.map(e => `${e.kind}/${e.phase}`),
      ['memory/access', 'instruction/retire'], 're-attaching did not restore recording');
  });

  it('the PORT wrappers follow the same lifecycle, and only when port is set', () => {
    const cpu = fakeCpu();
    const inPort = cpu.inPort, outPort = cpu.outPort;
    const events = install(cpu, { cycles: 0, clockHz: 1e6 }, { port: true });

    assert.equal(cpu.inPort, inPort, 'ports wrapped with no listener');
    const stop = events.onDebugEvent(() => {});
    assert.notEqual(cpu.inPort, inPort);
    assert.notEqual(cpu.outPort, outPort);
    stop();
    assert.equal(cpu.inPort, inPort);
    assert.equal(cpu.outPort, outPort);
  });

  it('leaves the ports ALONE when port is not set, at every stage', () => {
    const cpu = fakeCpu();
    const inPort = cpu.inPort;
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const stop = events.onDebugEvent(() => {});
    assert.equal(cpu.inPort, inPort, 'a non-port target wrapped a port accessor');
    stop();
    assert.equal(cpu.inPort, inPort);
  });

  it('DOES NOT UNWRAP SOMEONE ELSE’S WRAPPER, even at the cost of leaving ours on', () => {
    // We are not necessarily the outermost. If another party wraps cpu.read
    // after us, restoring our original discards theirs silently — a corruption,
    // where leaving ours installed is only a cost, and the `accesses` null check
    // keeps it inert.
    const cpu = fakeCpu();
    const original = cpu.read;
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const stop = events.onDebugEvent(() => {});

    const oursRead = cpu.read, oursWrite = cpu.write;
    const theirs = address => oursRead(address);
    const theirsWrite = (address, value) => oursWrite(address, value);
    cpu.read = theirs;                       // someone wraps on top of us
    cpu.write = theirsWrite;

    stop();
    assert.equal(cpu.write, theirsWrite, 'write was restored over another party’s wrapper');
    assert.equal(cpu.read, theirs, 'the last listener leaving discarded another party’s wrapper');
    assert.notEqual(cpu.read, original);
  });

  it('and the same for STEP, which is the one I first tested only for read', () => {
    // EVERY wrapper this module installs, not the one the test happened to
    // drive. Removing the conditional restore for `step` passed the whole file
    // until this existed — one rule applied where I was looking rather than
    // across the surface it governs, in the file written for that exact
    // failure, again.
    const cpu = fakeCpu([{}]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const stop = events.onDebugEvent(() => {});

    const ours = cpu.step;
    const theirs = () => ours();
    cpu.step = theirs;

    stop();
    assert.equal(cpu.step, theirs, 'the last listener leaving discarded another party’s step wrapper');
  });

  it('and for the PORT pair', () => {
    const cpu = fakeCpu([{}]);
    const events = install(cpu, { cycles: 0, clockHz: 1e6 }, { port: true });
    const stop = events.onDebugEvent(() => {});

    const oursIn = cpu.inPort, oursOut = cpu.outPort;
    const theirsIn = a => oursIn(a), theirsOut = (a, v) => oursOut(a, v);
    cpu.inPort = theirsIn; cpu.outPort = theirsOut;

    stop();
    assert.equal(cpu.inPort, theirsIn);
    assert.equal(cpu.outPort, theirsOut);
  });

  it('THE STEP WRAPPER IS LAZY TOO, because the measurement said so', () => {
    // I first kept it, arguing its guard is per-instruction rather than
    // per-access and therefore a rounding error. That was true and it was not a
    // measurement. With only the accessors made lazy, a listener-less target
    // still cost 1.44x on a two-access instruction, and the ratio FELL as
    // accesses per step rose — 1.44x at 2, 1.28x at 16, 1.05x at 128 — which is
    // the signature of a per-STEP cost. With eager accessors it rises instead.
    const cpu = fakeCpu([{}]);
    const step = cpu.step;
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    assert.equal(cpu.step, step, 'the step wrapper went on with no listener attached');

    const stop = events.onDebugEvent(() => {});
    assert.notEqual(cpu.step, step, 'the first listener did not install the step wrapper');
    stop();
    assert.equal(cpu.step, step, 'the last listener left and the step wrapper stayed');
  });

  it('and stepping with NO listener still returns the core’s own cycles', () => {
    // The unwrapped path has to behave: an unlistened target is the common case
    // and it must be indistinguishable from no target at all.
    const cpu = fakeCpu([{ cycles: 11, pcAfter: 0x999 }]);
    install(cpu, { cycles: 0, clockHz: 1e6 });
    assert.equal(cpu.step(), 11);
    assert.equal(cpu.pc, 0x999);
  });
});

describe('TIME PASSED AND NOTHING RETIRED', () => {
  // The module could only say "an instruction retired", so a consumer saw the
  // tick counter jump between two retires with nothing explaining it — which is
  // indistinguishable from a dropped record. Measured live on two shipping
  // cores: a 6502 in WAI advanced 50,000 cycles over 50 steps and published
  // nothing; a z80 in HALT advanced 200,000 and published nothing.

  it('an idle elapse is its own fact, with the cycles and a cause', () => {
    const cpu = fakeCpu();
    const machine = { cycles: 4000, clockHz: 1e6 };
    const events = install(cpu, machine);
    const { seen } = record(events);

    assert.equal(events.publishIdleElapse({ cycles: 50_000, cause: 'wai' }), true);

    assert.equal(seen.length, 1);
    assert.deepEqual(
      { kind: seen[0].kind, phase: seen[0].phase, fidelity: seen[0].fidelity, cause: seen[0].cause },
      { kind: 'idle', phase: 'elapse', fidelity: 'recorded', cause: 'wai' });
    assert.equal(seen[0].changes.cycles, 50_000);
    // BigInt, like every other stamp this module makes — `time()` does
    // `BigInt(ticks)`, and comparing to a Number is what my first version did.
    assert.equal(seen[0].time.ticks, 4000n, 'stamped where the machine clock is');
  });

  it('a clock jump is a DIFFERENT kind, not the same fact with a flag', () => {
    // Collapsing the two would be the same defect as one refusal code for every
    // situation: "the core slept through the slice" and "the clock jumped to a
    // timer callback" are different questions and one shape cannot answer both.
    const cpu = fakeCpu();
    const events = install(cpu, { cycles: 900, clockHz: 1e6 });
    const { seen } = record(events);

    events.publishIdleElapse({ cycles: 10 });
    events.publishClockJump({ cycles: 25, event: { name: 'timer0' } });

    assert.deepEqual(seen.map(e => `${e.kind}/${e.phase}`), ['idle/elapse', 'clock/fire']);
    assert.notEqual(seen[0].kind, seen[1].kind, 'the two events must not share a kind');
    assert.deepEqual(seen[1].event, { name: 'timer0' });
    assert.equal(seen[0].event, undefined, 'an idle elapse has no scheduled event to name');
  });

  it('both are silent with no listener, like everything else here', () => {
    const cpu = fakeCpu();
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    assert.equal(events.publishIdleElapse({ cycles: 10 }), false);
    assert.equal(events.publishClockJump({ cycles: 10 }), false);
  });

  it('publishInterrupt emits the interrupt kind — the vocabulary the 8086 adoption dropped', () => {
    // Additive publisher (like idle/clock): no core here published an interrupt,
    // the 8086 hand-rolled one downstream, and its module adoption dropped it
    // because there was no verb. A caller that never calls this is unchanged, so
    // `capabilities().events` must not list 'interrupt' until one does.
    const cpu = fakeCpu();
    const events = install(cpu, { cycles: 700, clockHz: 1e6 });
    const { seen } = record(events);

    assert.equal(events.publishInterrupt({ vector: 0x21, source: 'pic' }), true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].kind, 'interrupt');
    assert.equal(seen[0].phase, 'accepted');
    assert.equal(seen[0].fidelity, 'recorded');
    assert.deepEqual(seen[0].interrupt, { vector: 0x21, source: 'pic' });
    assert.equal(seen[0].time.domain, 'test-ticks', 'stamped on the same clock as every other fact');
  });

  it('publishInterrupt is silent with no listener, like everything else here', () => {
    const cpu = fakeCpu();
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    assert.equal(events.publishInterrupt({ vector: 1, source: 'nmi' }), false);
  });

  it('REFUSES a non-advance rather than publishing a fact about nothing', () => {
    // Zero or negative cycles is not an elapse; publishing one would put a
    // "time passed" fact in the log for a moment when it did not.
    const cpu = fakeCpu();
    const events = install(cpu, { cycles: 0, clockHz: 1e6 });
    const { seen } = record(events);

    for (const cycles of [0, -1, NaN, undefined, '50', null]) {
      assert.equal(events.publishIdleElapse({ cycles }), false, `cycles=${String(cycles)}`);
      assert.equal(events.publishClockJump({ cycles }), false, `cycles=${String(cycles)}`);
    }
    assert.equal(events.publishIdleElapse(), false, 'no argument at all');
    assert.equal(seen.length, 0);
  });

  it('they share the EPOCH with everything else, so a rewind renames them too', () => {
    // The whole point is that these sit in one timeline with the retires. A
    // fact carrying its own unrelated domain would be a second clock.
    const cpu = fakeCpu([{}]);
    const machine = { cycles: 5000, clockHz: 1e6 };
    const events = install(cpu, machine);
    const { seen } = record(events);

    cpu.step();
    assert.equal(seen.at(-1).time.domain, 'test-ticks');

    machine.cycles = 10;                       // a restore
    events.publishIdleElapse({ cycles: 3 });
    assert.equal(seen.at(-1).time.domain, 'test-ticks-reset-1',
      'an idle fact after a rewind must name the new era');

    events.publishClockJump({ cycles: 3 });
    assert.equal(seen.at(-1).time.domain, 'test-ticks-reset-1');
  });

  it('an explicit ticks argument is honoured, for a caller stamping after the fact', () => {
    // The adapter shapes that need this know the tick the elapse STARTED at,
    // which is not necessarily where the clock is by the time they can say so.
    const cpu = fakeCpu();
    const events = install(cpu, { cycles: 9999, clockHz: 1e6 });
    const { seen } = record(events);
    events.publishIdleElapse({ cycles: 8, ticks: 100 });
    assert.equal(seen[0].time.ticks, 100n);
  });
});

describe('A PARKED CORE SAYS SO, on the real machines', () => {
  // Driven against Z80Machine and M6502Machine rather than the fake, because
  // the whole point is what those two do when they park — and they do it
  // differently. Measured before this landed:
  //
  //   z80  HALT   8,004 cycles pass, facts: the HALT's access and retire, then NOTHING
  //   6502 WAI    3,000 cycles pass, facts: NONE AT ALL
  //
  // A consumer saw the tick counter jump with nothing to explain it, which is
  // indistinguishable from a dropped record.

  const haltedZ80 = () => {
    const machine = new Z80Machine(
      { clockHz: 4_000_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
    machine.load(Uint8Array.from([0x76]), 0);           // HALT
    machine.cpu.pc = 0;
    return machine;
  };

  const waitingM6502 = () => {
    const machine = new M6502Machine({ clockHz: 1_000_000,
      regions: [{ kind: 'ram', start: 0, end: 0x7fff }, { kind: 'rom', start: 0x8000, end: 0xffff }],
      chips: [] }, {});
    machine.loadRom([0x58, 0xcb, 0xea, 0x4c, 0x02, 0x80]);   // CLI / WAI / NOP / JMP
    machine.mem[0xfffc] = 0x00; machine.mem[0xfffd] = 0x80;
    machine.reset();
    return machine;
  };

  const watch = (machine, cause) => {
    const events = installInstructionDebugEvents({
      cpu: machine.cpu, machine, cpuId: 't', timeDomain: 'ticks', idleCause: cause, rewindLabel: 'reset' });
    const seen = [];
    events.onDebugEvent(e => seen.push(e));
    return { events, seen };
  };

  it('the z80 in HALT — where cpu.step is never called at all', () => {
    // The hard case: the machine short-circuits the CPU, so nothing a cpu.step
    // wrapper can see happens. The bracket is on machine.step for this reason.
    const machine = haltedZ80();
    const { seen } = watch(machine, () => (machine.cpu.halted ? 'halt' : 'parked'));

    machine.step();                                     // executes the HALT
    const before = machine.cycles;
    seen.length = 0;
    machine.step();                                     // now parked

    assert.ok(machine.cpu.halted, 'the fixture must actually be halted');
    assert.ok(machine.cycles > before, 'and time must actually pass');
    assert.deepEqual(seen.map(e => `${e.kind}/${e.phase}`), ['idle/elapse']);
    assert.equal(seen[0].cause, 'halt');
    assert.equal(seen[0].changes.cycles, machine.cycles - before,
      'the fact must carry the cycles the MACHINE advanced, not the CPU');
  });

  it('the 6502 in WAI — where cpu.step runs and returns nothing', () => {
    const machine = waitingM6502();
    const { seen } = watch(machine, () => (machine.cpu.waiting ? 'wai' : 'parked'));

    for (let i = 0; i < 3; i++) machine.step();          // reach the WAI
    assert.ok(machine.cpu.waiting, 'the fixture must actually be waiting');
    const before = machine.cycles;
    seen.length = 0;
    machine.step();

    assert.deepEqual(seen.map(e => `${e.kind}/${e.phase}`), ['idle/elapse']);
    assert.equal(seen[0].cause, 'wai');
    assert.equal(seen[0].changes.cycles, machine.cycles - before);
  });

  it('a RETIRING step publishes no idle fact, so nothing is double-reported', () => {
    // The flag exists for this: an instruction that retired accounts for its
    // own cycles, and an elapse beside it would claim the time twice.
    const machine = waitingM6502();
    const { seen } = watch(machine);
    machine.step();                                     // CLI retires

    assert.ok(seen.some(e => e.kind === 'instruction'), 'the step retired');
    assert.equal(seen.filter(e => e.kind === 'idle').length, 0,
      'a retiring step also claimed an idle elapse');
  });

  it('a machine that advances NOTHING publishes nothing', () => {
    // STP on the 6502 returns 0 and stops time. An elapse fact there would say
    // time passed when it did not.
    const machine = waitingM6502();
    machine.cpu.stopped = true;
    machine.cpu.waiting = false;
    const { seen } = watch(machine);
    const before = machine.cycles;
    machine.step();

    assert.equal(machine.cycles, before, 'the fixture must really stop time');
    assert.deepEqual(seen, []);
  });

  it('the machine.step bracket follows the SAME lifecycle as the others', () => {
    const machine = haltedZ80();
    const step = machine.step;
    const events = installInstructionDebugEvents({
      cpu: machine.cpu, machine, cpuId: 't', timeDomain: 'ticks', rewindLabel: 'reset' });

    assert.equal(machine.step, step, 'machine.step was wrapped with no listener attached');
    const stop = events.onDebugEvent(() => {});
    assert.notEqual(machine.step, step);
    stop();
    assert.equal(machine.step, step, 'the last listener left and the bracket stayed');
  });

  it('and does not unwrap another party’s machine.step either', () => {
    const machine = haltedZ80();
    const events = installInstructionDebugEvents({
      cpu: machine.cpu, machine, cpuId: 't', timeDomain: 'ticks', rewindLabel: 'reset' });
    const stop = events.onDebugEvent(() => {});

    const ours = machine.step;
    const theirs = () => ours();
    machine.step = theirs;

    stop();
    assert.equal(machine.step, theirs);
  });

  it('the default cause is stated rather than invented', () => {
    // A target that does not say why its core parked gets 'parked', which is
    // true and uninformative — better than a guess that reads as a diagnosis.
    const machine = haltedZ80();
    const { seen } = watch(machine);
    machine.step();
    seen.length = 0;
    machine.step();
    assert.equal(seen[0].cause, 'parked');
  });
});
