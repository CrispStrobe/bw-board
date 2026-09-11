// WHAT THE TARGET DOES AND WHAT IT SAYS IT DOES CAME APART.
//
// Adopting the shared event module moved the 8086 target's event publication out
// of this file, and the `events:` and `runTo:` declarations went with it -- while
// the mechanisms stayed. The run-to machinery is still here and `breakpoints`
// still lists 'code'; nothing advertises it. Every capability-driven consumer
// therefore fail-closes on a target that works.
//
// `events` is the worse of the two: the target publishes memory, port and
// instruction facts while declaring none, so a consumer gating on the
// declaration silently skips a target that is PRODUCING. A skipped consumer and
// a broken one look identical from outside.
//
// THE ASSERTIONS ARE AGAINST BEHAVIOUR, NOT AGAINST A LIST. A test that compares
// the declaration to a hard-coded array passes just as well when both are wrong.
// Each declared kind here has to be observed coming out of the target, and each
// declared run-to bound has to be accepted by setBreakpoint.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

//  mov al,[0500] ; mov [0501],al ; out 00,al ; jmp $-8
const CODE = [0xa0, 0x00, 0x05, 0xa2, 0x01, 0x05, 0xe6, 0x00, 0xeb, 0xf6];
const build = () => {
    const r = new Uint8Array(0x10000).fill(0x90);
    r.set(CODE, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf0], 0xfff0);
    const machine = new I8086Machine(PCXT8086, {});
    machine.loadRom(r);
    machine.reset();
    machine.step();
    return {machine, target: createI8086DebugTarget({machine})};
};

test('every event kind it declares is one it actually publishes', () => {
    const {machine, target} = build();
    const declared = target.capabilities().events;
    assert.ok(Array.isArray(declared) && declared.length > 0,
        'the target publishes facts and declares no event kinds; a consumer gating on ' +
        'this skips a working target and the skip is indistinguishable from a failure');

    const seen = new Set();
    target.onDebugEvent(f => seen.add(f.kind));
    for (let i = 0; i < 12; i++) machine.step();

    assert.ok(seen.size > 0, 'no facts at all -- the instrument, not the target');
    for (const kind of declared) {
        assert.ok(seen.has(kind),
            `declared '${kind}' but never published one; saw ${[...seen].join(', ')}`);
    }
});

test('and it does not publish a kind it never declared', () => {
    // The other direction. A declaration that is a subset of reality is as
    // broken as one that oversells: a consumer filtering on it drops facts.
    const {machine, target} = build();
    const declared = new Set(target.capabilities().events);
    const seen = new Set();
    target.onDebugEvent(f => seen.add(f.kind));
    for (let i = 0; i < 12; i++) machine.step();

    for (const kind of seen) {
        assert.ok(declared.has(kind),
            `published '${kind}' without declaring it; declared ${[...declared].join(', ')}`);
    }
});

test('the run-to bounds it declares are bounds setBreakpoint actually accepts', () => {
    const {target} = build();
    const [runTo] = target.capabilities().runTo ?? [];
    assert.ok(runTo, 'the run-to mechanism is present and nothing advertises it');
    assert.equal(runTo.kind, 'address');
    assert.equal(runTo.space, 'code');

    // The declared ceiling must be reachable, and one past it must be refused.
    const ok = target.setBreakpoint({kind: 'code', addr: runTo.addressMax});
    assert.ok(Number.isInteger(ok), `the declared maximum was refused: ${JSON.stringify(ok)}`);
    const over = target.setBreakpoint({kind: 'code', addr: runTo.addressMax + 1});
    assert.ok(over && over.unsupported,
        'an address past the declared maximum was accepted, so the bound is decoration');
});
