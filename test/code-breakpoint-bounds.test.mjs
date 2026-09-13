// A CODE BREAKPOINT OUTSIDE THE ADDRESS SPACE MUST NOT HALT SOMEWHERE INSIDE IT.
//
// Both bridges DECLARE runTo with addressMax: 0xffff, and the convergence dropped
// the bound that enforced it on setBreakpoint({kind:'code'}). Declaration kept,
// consequence dropped. The z80 masked the address at the store site, so 0x10000
// wrapped to 0x0000 and the breakpoint FIRED THERE — a caller sets a breakpoint
// outside the machine, gets a handle implying success, and the program halts at
// address zero, reported as a working breakpoint. (The 6502 stored it raw, so its
// out-of-range handle is a breakpoint that can never fire — accepted but dead.)
//
// THE ASSERTION IS ON THE CONSEQUENCE, not the refusal: "no halt occurs at a
// wrapped address". A refusal test ("an out-of-range address is refused") passes
// the day someone reinstates the check at a different boundary; the halt test
// does not. The in-range control proves the breakpoint mechanism actually fires,
// so a green out-of-range leg is "did not fire wrong", not "never fires".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Z80Machine } from '../src/z80-machine.js';
import { createZ80DebugTarget } from '../src/z80-debug.js';
import { createM6502Adapter } from '../src/m6502-adapter.js';
import { createM6502DebugTarget } from '../src/m6502-debug.js';

const CORES = {
  z80: () => {
    const machine = new Z80Machine({ clockHz: 3_500_000, regions: [{ kind: 'ram', start: 0, end: 0xffff }] }, {});
    machine.cpu.pc = 0;                       // a NOP sled — RAM is 0x00 = NOP
    // reachable: the program runs from 0x0000 upward.
    return { target: createZ80DebugTarget({ machine }), pc: () => machine.cpu.pc, reachable: 0x0002 };
  },
  m6502: () => {
    const adapter = createM6502Adapter({});
    adapter.machine.loadRom([0xea, 0xea, 0xea, 0xea, 0x4c, 0x00, 0x80]);   // NOP*4; JMP $8000
    adapter.machine.mem[0xfffc] = 0x00; adapter.machine.mem[0xfffd] = 0x80;
    adapter.machine.reset();
    // reachable: this program runs from the reset vector $8000, not from 0.
    return { target: createM6502DebugTarget(adapter), pc: () => adapter.machine.cpu.pc, reachable: 0x8002 };
  }
};

for (const [name, make] of Object.entries(CORES)) {
  test(`${name}: an out-of-range code breakpoint never halts at a wrapped address`, () => {
    const { target, pc } = make();

    // CONTROL: the mechanism fires. A breakpoint at a real address halts THERE,
    // so a non-halt below is "did not fire wrong", not a dead instrument.
    const inRange = make();
    inRange.target.setBreakpoint({ kind: 'code', addr: inRange.reachable });
    inRange.target.run();
    assert.equal(inRange.target.runFor(1_000_000), 'halted', 'control: an in-range breakpoint fires');
    assert.equal(inRange.pc(), inRange.reachable, 'control: it halts at the address requested');

    // THE DEFECT: a breakpoint at 0x10000 — outside the 16-bit space the target
    // declares — must not become a halt at the wrapped address 0x0000.
    target.setBreakpoint({ kind: 'code', addr: 0x10000 });
    target.run();
    const outcome = target.runFor(1_000_000);
    assert.notEqual(outcome, 'halted',
      `an out-of-range code breakpoint must not halt the program (halted at pc ${pc()})`);
  });

  if (name === 'm6502' || name === 'z80') {
    test(`${name}: advertised maximum, acceptance, successor, and refusal name agree`, () => {
      const { target } = make();
      const max = target.capabilities().runTo[0].addressMax;
      assert.equal(max, 0xffff);
      assert.equal(typeof target.setBreakpoint({ kind: 'code', addr: max }), 'number');
      const refusal = target.setBreakpoint({ kind: 'code', addr: max + 1 });
      assert.ok(refusal?.unsupported);
      const named = /0x([0-9a-f]+)\s*$/.exec(refusal.unsupported);
      assert.ok(named, `refusal names no maximum: ${JSON.stringify(refusal.unsupported)}`);
      assert.equal(parseInt(named[1], 16), max);
    });
  }
}
