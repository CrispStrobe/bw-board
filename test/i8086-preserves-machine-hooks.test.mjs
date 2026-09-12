/**
 * A DEBUG TARGET MUST NOT SILENCE THE MACHINE'S OWN INSTRUMENTATION.
 *
 * `i8086-debug.js` assigns its port-watch handler over `machine.hooks.onPortAccess`,
 * and with no watches it used to assign `null` — destroying whatever the machine
 * had been constructed with. Measured before the fix, on a machine built with its
 * own observer:
 *
 *     no target                 the hook fires   [0x33]
 *     target + one listener     the hook is null []
 *
 * That is worse than observing nothing: the machine's hook is how something ELSE
 * was watching, and it went quiet the moment a debugger attached.
 *
 * Same defect `sendSerial` had before `rootDebugSendSerial`. This is the accessor
 * where the chaining was still missing, and these cases are what will notice if it
 * goes missing again — including on the path with no watches, which is the one that
 * assigned `null`.
 */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createI8086DebugTarget} from '../src/i8086-debug.js';
import {I8086Machine} from '../src/i8086-machine.js';

const CONFIG = {clockHz: 5_000_000, regions: [{kind: 'ram', start: 0, end: 0xfffff}], chips: []};

/** `mov al,0x33 ; out 0x20,al` at 0000:0100. */
const machineWatching = (seen) => {
    const m = new I8086Machine(CONFIG, {onPortAccess: ev => seen.push(ev.value)});
    m.cpu.cs = 0; m.cpu.ip = 0x100;
    m.mem.set([0xb0, 0x33, 0xe6, 0x20], 0x100);
    return m;
};

test('the machine keeps its own port observer when no target exists at all', () => {
    const seen = [];
    const m = machineWatching(seen);
    m.step(); m.step();
    assert.deepEqual(seen, [0x33],
        'fixture: the machine hook does not fire even without a debugger, so nothing '
        + 'below can show a debugger silencing it');
});

test('and keeps it once a target attaches and a listener registers', () => {
    const seen = [];
    const m = machineWatching(seen);
    const target = createI8086DebugTarget({machine: m});
    const off = target.onDebugEvent(() => {});   // installs the wrappers
    m.step(); m.step();
    off();
    assert.deepEqual(seen, [0x33],
        'attaching a debug target SILENCED the machine\'s own onPortAccess. The watch '
        + 'handler must chain to whatever was there, not replace it — and with no port '
        + 'watches it must leave the prior hook in place rather than assign null.');
});

test('a port WATCH still fires, and the machine hook fires too — both, not either', () => {
    const seen = [];
    const m = machineWatching(seen);
    const target = createI8086DebugTarget({machine: m});
    target.onDebugEvent(() => {});
    const set = target.setBreakpoint({kind: 'port', port: 0x20});
    assert.ok(set && !set.unsupported, `fixture: the port watch was refused (${JSON.stringify(set)})`);

    m.step(); m.step();
    assert.deepEqual(seen, [0x33],
        'the machine hook stopped once a watch existed — the chain runs the watch INSTEAD '
        + 'of the prior observer rather than as well as it');
});

test('a prior observer that THROWS does not cost the debugger its own port record', () => {
    // ORDER IS THE CLAIM, and chaining alone does not make it. A chain that calls
    // the foreign hook FIRST loses everything after it the moment that hook throws:
    // the user asked to stop on port 0x20, an unrelated observer threw, and the
    // run continued with no breakpoint recorded and no sign why.
    //
    // Our scan is a pure assignment that cannot throw, so it runs first and the
    // foreign call last. Measured both ways on 2026-09-11 — scan-first leaves a
    // pending hit that the next runFor retires as `halted`/`cause: 'port'`;
    // prior-first leaves nothing and the same call returns `budget`.
    //
    // NOTE FOR ANYONE EDITING THIS: `target.run()` is load-bearing. `runFor` on a
    // target that was never run returns 'halted' immediately, which is how the
    // first draft of this test passed under BOTH orderings.
    const seen = [];
    const m = new I8086Machine(CONFIG, {
        onPortAccess: ev => { seen.push(ev.value); throw new Error('foreign observer exploded'); }
    });
    m.cpu.cs = 0; m.cpu.ip = 0x100;
    m.mem.set([0xb0, 0x33, 0xe6, 0x20], 0x100);

    const target = createI8086DebugTarget({machine: m});
    const halts = [];
    target.onHalt(h => halts.push(h));
    const set = target.setBreakpoint({kind: 'port', port: 0x20});
    assert.ok(set && !set.unsupported, `fixture: the port watch was refused (${JSON.stringify(set)})`);
    target.run();

    // The throw propagates out of the machine's unguarded call site — not ours to
    // swallow. What must survive it is the hit already recorded underneath.
    assert.throws(() => { m.step(); m.step(); }, /foreign observer exploded/,
        'fixture: the prior hook never threw, so this case proves nothing');
    assert.deepEqual(seen, [0x33], 'fixture: the prior hook never ran at all');

    assert.equal(target.runFor(1), 'halted',
        'the port breakpoint was lost because a foreign observer threw BEFORE the watch '
        + 'scan. Scan first, call foreign code last.');
    assert.deepEqual(halts.map(h => h.cause), ['port'],
        `the run stopped, but not for the port watch: ${JSON.stringify(halts)}`);
});
