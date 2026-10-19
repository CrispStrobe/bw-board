// THE i8086 WRITE FACT SAYS WHAT THE ADDRESS WAS, NOT JUST WHAT IT BECAME.
//
// Adopting the shared event module moved this target's write facts onto the
// module's recorder, which publishes `value` and -- until `captureWriteBefore`
// existed -- no prior value. So "this address is now 5" and "this write changed
// something" became the same fact, and a recorder that cannot tell a no-op write
// from a real one cannot reconstruct a diff. Real 8086 code makes no-op writes
// constantly through read-modify-write and masked register updates.
//
// THIS ASSERTS THE FIELD AND ITS VALUE, not that an option was passed. A test
// that checks the flag reached the constructor proves the flag reached the
// constructor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

// mov al,[0x0500] ; mov [0x0501],al
const CODE = [0xa0, 0x00, 0x05, 0xa2, 0x01, 0x05];
const build = prior => {
    const r = new Uint8Array(0x8000).fill(0x90);
    r.set(CODE, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    const machine = new I8086Machine(BREADBOARD8086, {});
    machine.loadRom(r);
    machine.reset();
    machine.step();                       // consume the reset-vector jump
    machine.mem[0x0500] = 0x5a;           // the source byte
    machine.mem[0x0501] = prior;          // a KNOWN prior value at the destination
    const facts = [];
    createI8086DebugTarget({machine}).onDebugEvent(f => facts.push(f));
    machine.step();
    machine.step();
    return {machine, facts};
};
const storeTo501 = facts => facts.find(f =>
    f.phase === 'access' && f.memory?.direction === 'write' && f.memory.address === 0x0501);

test('a write fact carries the byte that was there before it', () => {
    const {machine, facts} = build(0x11);
    assert.equal(machine.mem[0x0501], 0x5a, 'the program did not run; nothing below means anything');
    assert.ok(facts.length > 0, 'no facts at all -- the instrument, not the core');

    const store = storeTo501(facts);
    assert.ok(store, 'the store to 0x0501 was not recorded at all');
    assert.equal(store.memory.value, 0x5a, 'the value written');
    assert.equal(store.memory.before, 0x11,
        'the prior value; without it a no-op write is indistinguishable from a real one');
});

test('and a no-op write is visibly a no-op', () => {
    // THE CLAIM THE FIELD EXISTS FOR, and the reason asserting presence alone is
    // not enough: `before` always equal to `value` would satisfy a presence check
    // while carrying no information.
    const {facts} = build(0x5a);          // already what the program will store
    const store = storeTo501(facts);
    assert.ok(store, 'the store was not recorded');
    assert.equal(store.memory.before, store.memory.value,
        'a write of the value already present must show before === value');
});

test('the two cases really do differ, so neither is passing by accident', () => {
    const changed = storeTo501(build(0x11).facts).memory;
    const noop = storeTo501(build(0x5a).facts).memory;
    assert.equal(changed.value, noop.value, 'both write the same byte');
    assert.notEqual(changed.before, noop.before,
        'the ONLY thing separating a real write from a no-op here is `before`');
});
