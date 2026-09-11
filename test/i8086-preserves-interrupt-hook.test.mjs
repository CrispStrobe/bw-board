// THE OTHER HALF OF THE SAME DEFECT.
//
// `2a5a607` stopped this target silencing the machine's own `onPortAccess`, and
// the reasoning there applies unchanged to `onInterrupt`: it is the MACHINE's
// hook, a host may already be listening on it, and this target was assigning its
// watch handler over the top.
//
// Both were found the same way and only one was fixed, because the lite test that
// caught it exercises ports. Nothing exercises the interrupt side, so it stayed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

const build = () => {
    const r = new Uint8Array(0x10000).fill(0x90);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf0], 0xfff0);
    const machine = new I8086Machine(PCXT8086, {});
    machine.loadRom(r);
    machine.reset();
    machine.step();
    return machine;
};

test('the machine keeps its own interrupt observer when no target exists', () => {
    // The control: without this, a failure below could mean the machine never
    // delivers rather than that the target silenced it.
    const machine = build();
    const seen = [];
    machine.hooks.onInterrupt = ev => seen.push(ev.vector);
    machine.nmi();
    machine.step();
    assert.deepEqual(seen, [2], 'the machine does not deliver NMI to its own hook at all');
});

test('and keeps it once a target attaches and a listener registers', () => {
    const machine = build();
    const seen = [];
    machine.hooks.onInterrupt = ev => seen.push(ev.vector);

    const target = createI8086DebugTarget({machine});
    target.onDebugEvent(() => {});         // re-syncs the hooks, which is what overwrote it

    machine.nmi();
    machine.step();
    assert.deepEqual(seen, [2],
        "the machine's own interrupt hook went quiet when the debugger attached");
});

test('an interrupt WATCH still fires, and the machine hook fires too — both, not either', () => {
    const machine = build();
    const seen = [];
    machine.hooks.onInterrupt = ev => seen.push(ev.vector);

    const target = createI8086DebugTarget({machine});
    const id = target.setBreakpoint({kind: 'int', vector: 2});
    assert.ok(Number.isInteger(id), `setBreakpoint refused: ${JSON.stringify(id)}`);

    target.run();
    machine.nmi();
    const verdict = target.runFor(200_000);
    assert.equal(verdict, 'halted', 'the interrupt breakpoint did not stop the run');
    assert.deepEqual(seen, [2], 'and the pre-existing hook saw it as well');
});

test('clearing the last watch leaves the original in place, not null', () => {
    const machine = build();
    const seen = [];
    machine.hooks.onInterrupt = ev => seen.push(ev.vector);

    const target = createI8086DebugTarget({machine});
    const id = target.setBreakpoint({kind: 'int', vector: 2});
    target.clearBreakpoint(id);

    machine.nmi();
    machine.step();
    assert.deepEqual(seen, [2], 'clearing the last watch erased the hook the machine came with');
});

test('a prior observer that THROWS does not cost the debugger its own interrupt record', () => {
    // The interrupt twin of the port case in i8086-preserves-machine-hooks.test.mjs,
    // and the same claim: our own watch scan is a pure assignment that cannot
    // throw, so it runs BEFORE `publishInterrupt` and before the foreign hook.
    // Call foreign code first and one throwing observer silently costs the user
    // the breakpoint they asked for.
    //
    // `target.run()` is load-bearing here too — `runFor` on a target that was
    // never run returns 'halted' for free, which passes under either ordering.
    const machine = build();
    const seen = [];
    machine.hooks.onInterrupt = ev => { seen.push(ev.vector); throw new Error('foreign observer exploded'); };

    const target = createI8086DebugTarget({machine});
    const halts = [];
    target.onHalt(h => halts.push(h));
    const id = target.setBreakpoint({kind: 'int', vector: 2});
    assert.ok(Number.isInteger(id), `fixture: setBreakpoint refused: ${JSON.stringify(id)}`);
    target.run();

    machine.nmi();
    assert.throws(() => machine.step(), /foreign observer exploded/,
        'fixture: the prior hook never threw, so this case proves nothing');
    assert.deepEqual(seen, [2], 'fixture: the prior hook never ran at all');

    assert.equal(target.runFor(1), 'halted',
        'the interrupt breakpoint was lost because a foreign observer threw BEFORE the '
        + 'watch scan. Scan first, call foreign code last.');
    assert.deepEqual(halts.map(h => h.cause), ['interrupt'],
        `the run stopped, but not for the interrupt watch: ${JSON.stringify(halts)}`);
});
