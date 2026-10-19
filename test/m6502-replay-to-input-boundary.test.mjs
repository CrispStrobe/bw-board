/**
 * `replayToInputBoundary` on the 6502 target — every refusal code, driven.
 *
 * WHY THIS FILE EXISTS. The method ran for months as a lite-only graft: it was
 * carried across a vendoring boundary by hand at every pin bump, declared in a
 * divergence ledger, and had no test in the repository that owns the target it
 * is a method of. It is upstream now, and this is the suite that makes it
 * upstream in fact rather than by location.
 *
 * THE SHAPE OF THE THING UNDER TEST. It runs the machine FORWARD to the exact
 * tick at which a recorded input was delivered, so a replay can re-apply that
 * input where it happened rather than near it. Everything it can refuse, it
 * refuses with a CODE — and a coded refusal that nothing constructs is a string
 * nobody has read. Each `code` below is reached by building the state that
 * produces it, not by passing an argument shaped like the guard.
 *
 * TWO CASES CARRY AN EXPLICIT TIMEOUT, AND ONE OF THEM IT CANNOT SAVE. Read this
 * before trusting it. `input-boundary-stalled` is the only thing standing between
 * this method and a loop that never ends — every other exit (stopped, overshoot,
 * reaching the tick) depends on the machine advancing, and that guard is the one
 * that fires when it does not. Measured 2026-09-11: delete it and the runner
 * wedges with no output at all.
 *
 * The `{timeout}` does NOT convert that into a named failure. The loop is
 * SYNCHRONOUS, and a node:test timeout is a timer — JavaScript cannot preempt a
 * synchronous loop to fire it, so the case hangs exactly as it did before. That
 * was measured too, by adding the timeout and watching it hang anyway. The
 * timeout is kept because it does catch an asynchronous variant and costs
 * nothing, but the mutation behind case 9 is verified by an out-of-process wall
 * clock, and anyone re-checking it should use one rather than waiting.
 *
 * A HUNG JOB READS AS "STILL RUNNING" RATHER THAN AS THE DEFECT IT IS. That is
 * the cost of this guard's absence, and it is why the guard is not redundant
 * with the overshoot check two lines below it.
 *
 * THE ONE THAT MATTERS MOST IS `input-boundary-inexact`. The 6502 retires whole
 * instructions, so a tick inside one has no machine state to stop at. Running
 * past it and reporting success would replay the input at the wrong time and
 * say it did not — the failure this method exists to prevent.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';

/** NOP; JMP $8000 — a program whose only job is to move the clock. */
const SPIN = [0xea, 0x4c, 0x00, 0x80];

const makeTarget = (rom = SPIN) => {
  const adapter = createM6502Adapter({});
  const machine = adapter.machine;
  machine.loadRom(rom);
  machine.mem[0xfffc] = 0x00; machine.mem[0xfffd] = 0x80;
  machine.reset();
  return {adapter, machine, target: createM6502DebugTarget(adapter)};
};

/**
 * The tick `n` instruction boundaries ahead, computed by running a SECOND
 * machine rather than by arithmetic on instruction lengths.
 *
 * This is the fixture's load-bearing part. `machine.cycles + 2` is not a
 * boundary just because NOP is two cycles: the instruction after it is a
 * three-cycle JMP, so +2 from the wrong place lands mid-instruction and the
 * accept case would assert on `input-boundary-inexact` while reading as a
 * test of the accept path. Measured that way on the first draft.
 */
const boundaryAhead = (rom, n) => {
  const {machine} = makeTarget(rom);
  for (let i = 0; i < n; i++) machine.step();
  return machine.cycles;
};

describe('replayToInputBoundary refuses everything it cannot do exactly', () => {
  it('lands on an exact instruction boundary and reports the time it reached', () => {
    const {machine, target} = makeTarget();
    const want = boundaryAhead(SPIN, 4);
    assert.ok(want > machine.cycles,
      `fixture: the target boundary ${want} is not ahead of ${machine.cycles}`);

    const out = target.replayToInputBoundary({ticks: want, domain: 'm6502-cycles'});
    assert.equal(out.accepted, true, `refused the accept case: ${JSON.stringify(out)}`);
    assert.equal(out.boundary, 'input');
    assert.equal(machine.cycles, want, 'it reported success from the wrong tick');
    assert.equal(BigInt(out.time.ticks), BigInt(want),
      'the reported time is not the time it stopped at');
    assert.equal(out.time.domain, 'm6502-cycles');
  });

  it('a tick INSIDE an instruction is refused, never rounded to the next one', () => {
    const {machine, target} = makeTarget();
    const boundary = boundaryAhead(SPIN, 4);
    const inside = boundary - 1;
    assert.ok(inside > machine.cycles, 'fixture: the mid-instruction tick is not ahead');

    const out = target.replayToInputBoundary({ticks: inside, domain: 'm6502-cycles'});
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'input-boundary-inexact');
    assert.ok(machine.cycles !== inside,
      'fixture: the machine reached the mid-instruction tick, so this proves nothing');
  });

  it('a boundary already behind the machine is refused as passed, not run backwards', () => {
    const {machine, target} = makeTarget();
    machine.step(); machine.step();
    const out = target.replayToInputBoundary({ticks: 1, domain: 'm6502-cycles'});
    assert.equal(out.code, 'input-boundary-passed');
  });

  it('ticks that are not an integer are refused — NOT coerced to NaN and accepted', () => {
    // THE REASON THE PARSE IS BigInt() AND NOT Number(). Number('12x') is NaN,
    // every NaN comparison is false, so `requested < machine.cycles` is false,
    // the while-loop test is false, and a malformed boundary falls straight
    // through to `{accepted: true}` having moved nothing. BigInt() throws on
    // exactly this input, which is what makes the refusal possible.
    const {target} = makeTarget();
    for (const ticks of ['12x', 'nonsense', undefined, null, {}, 1.5, NaN]) {
      const out = target.replayToInputBoundary({ticks, domain: 'm6502-cycles'});
      assert.equal(out.accepted, false, `accepted a boundary of ${String(ticks)}`);
      assert.equal(out.code, 'invalid-input-boundary', `wrong code for ${String(ticks)}`);
    }
  });

  it('a boundary from another machine\'s clock is refused by domain', () => {
    const {machine, target} = makeTarget();
    const want = boundaryAhead(SPIN, 4);
    for (const domain of ['z80-tstates', 'i8086-cycles', '', undefined]) {
      const out = target.replayToInputBoundary({ticks: want, domain});
      assert.equal(out.code, 'invalid-input-boundary', `accepted domain ${String(domain)}`);
    }
    assert.equal(machine.cycles, 7,
      'a refused domain still ran the machine — the guard is after the stepping');
  });

  it('a RESET-EPOCH domain is the same clock, and is accepted', () => {
    // restoreCheckpoint() renames the domain per epoch (`m6502-cycles-reset-3`)
    // so facts from two timelines cannot be read as one that jumped. A boundary
    // recorded before a restore is still on THIS clock, so the suffix is
    // stripped rather than treated as a foreign domain. Without the strip, every
    // input recorded before any restore becomes unreplayable.
    const {machine, target} = makeTarget();
    const want = boundaryAhead(SPIN, 4);
    const out = target.replayToInputBoundary({ticks: want, domain: 'm6502-cycles-reset-3'});
    assert.equal(out.accepted, true, `the reset epoch was rejected: ${JSON.stringify(out)}`);
    assert.equal(machine.cycles, want);
  });

  it('a negative or out-of-range tick is refused rather than looped on', () => {
    const {target} = makeTarget();
    for (const ticks of [-1, Number.MAX_SAFE_INTEGER + 2]) {
      const out = target.replayToInputBoundary({ticks, domain: 'm6502-cycles'});
      assert.equal(out.code, 'invalid-input-boundary', `accepted ticks ${ticks}`);
    }
  });

  it('a STOPPED cpu refuses by name instead of spinning to the budget', {timeout: 15_000}, () => {
    // STP (0xDB) halts the 65C02 until reset. Without this guard the loop runs
    // forever on a machine that will never reach the boundary: step() keeps
    // returning cycles while the program counter never moves.
    const {adapter, machine, target} = makeTarget([0xdb]);
    machine.step();
    assert.equal(adapter.machine.cpu.stopped, true, 'fixture: STP did not stop the cpu');

    const out = target.replayToInputBoundary({ticks: machine.cycles + 100, domain: 'm6502-cycles'});
    assert.equal(out.code, 'stopped-before-input');
  });

  it('a machine whose clock does not advance refuses as STALLED, not silently', {timeout: 15_000}, () => {
    // Constructed rather than found: no ROM makes m6502 step() return 0, and a
    // guard whose state nothing can build is a guard nobody can check. The
    // substitution is one method on the instance the target already closed over,
    // which is exactly the condition the code names.
    const {machine, target} = makeTarget();
    const want = boundaryAhead(SPIN, 4);
    machine.step = () => 0;

    const out = target.replayToInputBoundary({ticks: want, domain: 'm6502-cycles'});
    assert.equal(out.code, 'input-boundary-stalled');
  });

  it('a WAI fast-forward that LEAPS past the boundary is refused, not rounded', () => {
    // MEASURED 2026-09-11, and recorded because it is a real limit rather than a
    // bug: WAI does not idle one cycle at a time — m6502 step() fast-forwards it
    // (1000 cycles in this build). An input recorded during that window has a
    // tick the machine can no longer stop at, so it refuses as inexact.
    //
    // That is the correct answer for THIS method — better a named refusal than
    // an input replayed at the wrong time — but it does mean a wake-from-WAI
    // input is not timed-replayable, and the honest place for that fact is a
    // test rather than someone's afternoon.
    const {machine, target} = makeTarget([0xcb, 0xea]);
    machine.step();
    assert.equal(machine.cpu.waiting, true, 'fixture: WAI did not put the cpu in wait');
    const insideTheLeap = machine.cycles + 5;

    const out = target.replayToInputBoundary({ticks: insideTheLeap, domain: 'm6502-cycles'});
    assert.equal(out.accepted, false);
    assert.equal(out.code, 'input-boundary-inexact');
    assert.ok(machine.cycles > insideTheLeap,
      `fixture: the fast-forward did not leap past ${insideTheLeap} (at ${machine.cycles})`);
  });
});
