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

/**
 * A CPU that does exactly what a test tells it to on each step.
 *
 * `plan` is consumed one entry per step: `{reads, writes, ins, outs, cycles,
 * pcAfter, throws}`. Everything is optional.
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
      cpu, machine: { cycles: 0, clockHz: 1e6 }, cpuId: 'test', timeDomain: 'test-ticks',
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

  it('debugTime reports the machine clock and the domain of the current era', () => {
    const cpu = fakeCpu([{}]);
    const machine = { cycles: 4242, clockHz: 3_500_000 };
    const events = install(cpu, machine);
    assert.deepEqual(events.debugTime(),
      { ticks: 4242, domain: 'test-ticks', hz: 3_500_000 });

    events.openTimeEpoch();
    assert.equal(events.debugTime().domain, 'test-ticks-reset-1');
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
