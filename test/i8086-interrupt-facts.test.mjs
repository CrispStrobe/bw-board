// THE INTERRUPT EVENT KIND, RESTORED WITH ITS PUBLISHER.
//
// Before the module adoption this target published `kind: 'interrupt'` through
// its own hand-rolled path. The adoption dropped it, not as a wiring omission
// but because the shared module had no interrupt vocabulary at all -- zero
// occurrences, and no other target had ever published one. `publishInterrupt`
// supplies it, so the target can observe again.
//
// WHY IT MATTERS MORE THAN A MISSING FIELD: a replay driven from a fact log that
// contains no interrupts diverges at the first one and nowhere before it. Every
// fact before the divergence matches, which is exactly the shape that makes a
// log look trustworthy right up to the point it is useless.
//
// THE DECLARATION AND THE FACT GO IN ONE COMMIT. `capabilities().events` lost
// 'interrupt' when the publication left, and it is only being put back now
// because there is something behind it again -- declaring a kind nothing
// publishes is the same defect pointing the other way.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, PCXT8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

// mov al,[0500] ; mov [0501],al ; out 00,al ; jmp $-8 -- exercises memory read,
// memory write, port write and instruction retire, so a test asserting that every
// DECLARED kind is published has a program capable of producing all of them.
const CODE = [0xa0, 0x00, 0x05, 0xa2, 0x01, 0x05, 0xe6, 0x00, 0xeb, 0xf6];
const build = (code = []) => {
    const r = new Uint8Array(0x10000).fill(0x90);
    r.set(code, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf0], 0xfff0);
    const machine = new I8086Machine(PCXT8086, {});
    machine.loadRom(r);
    machine.reset();
    machine.step();
    return {machine, target: createI8086DebugTarget({machine})};
};

test('a delivered NMI is published as an interrupt fact', () => {
    const {machine, target} = build();
    const facts = [];
    target.onDebugEvent(f => facts.push(f));

    machine.nmi();
    machine.step();

    assert.ok(facts.length > 0, 'no facts at all -- the instrument, not the machine');
    const ints = facts.filter(f => f.kind === 'interrupt');
    assert.equal(ints.length, 1, `expected one interrupt fact, saw ${ints.length}`);
    assert.equal(ints[0].interrupt.vector, 2, 'NMI is vector 2');
    assert.equal(ints[0].interrupt.source, 'nmi',
        "source distinguishes a delivered line from a software INT n, which is a different question");
    assert.equal(ints[0].phase, 'accepted');
});

test('and an ordinary run publishes none, so the kind carries information', () => {
    // A target that emitted an interrupt fact per step would satisfy the case
    // above while making the kind meaningless.
    const {machine, target} = build();
    const facts = [];
    target.onDebugEvent(f => facts.push(f));
    for (let i = 0; i < 8; i++) machine.step();

    assert.ok(facts.length > 0, 'no facts at all -- the instrument, not the machine');
    assert.equal(facts.filter(f => f.kind === 'interrupt').length, 0,
        'an interrupt was reported on a run where none was delivered');
});

test("'interrupt' is declared, and every declared kind is still one it publishes", () => {
    const {machine, target} = build(CODE);
    const declared = target.capabilities().events;
    assert.ok(declared.includes('interrupt'),
        'the target publishes interrupt facts and does not declare the kind');

    const seen = new Set();
    target.onDebugEvent(f => seen.add(f.kind));
    // The program FIRST -- an NMI redirects execution to the vector, so firing it
    // early means the `out` never runs and 'port' never appears.
    for (let i = 0; i < 12; i++) machine.step();
    machine.nmi();
    machine.step();

    for (const kind of declared) {
        assert.ok(seen.has(kind), `declared '${kind}' but never published one`);
    }
    for (const kind of seen) {
        assert.ok(declared.includes(kind), `published '${kind}' without declaring it`);
    }
});

test('an interrupt breakpoint still fires, with no subscriber anywhere', () => {
    // The watch path predates the event path and must not depend on it: a target
    // whose interrupt observation only works while somebody is subscribed would
    // pass every case above.
    const {machine, target} = build();
    const id = target.setBreakpoint({kind: 'int', vector: 2});
    assert.ok(Number.isInteger(id), `setBreakpoint refused: ${JSON.stringify(id)}`);

    target.run();
    machine.nmi();
    const verdict = target.runFor(200_000);
    assert.equal(verdict, 'halted', 'the interrupt breakpoint did not stop the run');
});
