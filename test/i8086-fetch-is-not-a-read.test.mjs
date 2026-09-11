// A FETCH IS NOT A READ, AND NOW THE BUS CAN TELL.
//
// The core already held this distinction and already kept fetches out of `_rd8`
// for exactly this reason -- routing them there "would record every instruction
// byte twice, once as the fetch it is and once as a data read it is not". Then
// it used `this.read()` for the bus access anyway, so both arrived at any
// observer indistinguishable.
//
// The consequence reached the debug stream: instruction fetches were published
// as memory facts, six per instruction, drowning the reads and writes the
// PROGRAM performed. A fact derivable from another fact -- and a fetch is
// derivable from the instruction fact beside it -- is noise with a timestamp.
//
// `this.fetch` is a second accessor that DEFAULTS TO `this.read`, so the bus
// still sees every access and nothing about execution changes. What changes is
// that an observer can now say "program reads only" -- a thing that could not be
// expressed while both arrived through one name.
//
// ALL THREE FETCH SITES MOVE TOGETHER. A partial change is worse than either
// extreme: some fetches in the stream and some not, keyed on whether an
// instruction happened to carry a prefix, is unexplainable to anyone reading a
// log. The prefix loop is the site most likely to be forgotten and the one where
// forgetting is worst -- it is where a duplicate-read bug was bisected and fixed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086, } from '../src/i8086.js';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

const build = code => {
    const r = new Uint8Array(0x8000).fill(0x90);
    r.set(code, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    const machine = new I8086Machine(BREADBOARD8086, {});
    machine.loadRom(r);
    machine.reset();
    machine.step();                       // consume the reset-vector jump
    machine.mem[0x0500] = 0x5a;
    return machine;
};
const memFacts = (machine, steps) => {
    const facts = [];
    createI8086DebugTarget({machine}).onDebugEvent(f => {
        if (f.phase === 'access' && f.memory) facts.push(f.memory);
    });
    for (let i = 0; i < steps; i++) machine.step();
    return facts;
};

test('fetch defaults to read, so nothing about the bus changes', () => {
    // THE WHOLE OF WHY THIS IS SAFE, and it is one line. Every byte still
    // reaches read() exactly once -- the invariant a duplicate-read bisect
    // established -- and it holds only while this binding does.
    const machine = build([0x90]);
    assert.equal(typeof machine.cpu.fetch, 'function', 'the core has no fetch accessor');
    assert.equal(machine.cpu.fetch, machine.cpu.read,
        'fetch must BE read until something deliberately rebinds one');
});

test('a program with two data accesses produces exactly two memory facts', () => {
    // ASSERTED AGAINST A CONSTANT, not against "fewer than before". A comparison
    // with an unstated previous number cannot fail in a way anyone can check.
    //
    //   mov al,[0500]   one data READ
    //   mov [0501],al   one data WRITE
    //   hlt             stops the machine, so the count is exactly one pass
    const machine = build([0xa0, 0x00, 0x05, 0xa2, 0x01, 0x05, 0xf4]);
    const facts = memFacts(machine, 3);

    assert.equal(machine.mem[0x0501], 0x5a, 'the program did not run; nothing below means anything');
    assert.equal(facts.length, 2,
        `expected exactly the two data accesses, saw ${facts.length}: ` +
        facts.map(f => `${f.direction}@0x${f.address.toString(16)}`).join(' '));
    assert.deepEqual(facts.map(f => f.direction), ['read', 'write']);
    assert.equal(facts[0].address, 0x0500);
    assert.equal(facts[1].address, 0x0501);
});

test('a PREFIXED instruction produces the same fact shape as an unprefixed one', () => {
    // THE SPECIFIC WAY A PARTIAL CHANGE FAILS. The prefix loop is a third fetch
    // site; miss it and a prefixed instruction leaks its bytes into the stream
    // while an unprefixed one does not.
    const plain = memFacts(build([0xa0, 0x00, 0x05, 0xf4]), 2);
    // DS: -- the segment this access already uses, so the effective address is
    // identical and the comparison is about the FETCH bytes rather than about
    // segmentation. A CS: prefix would move the operand to 0xF8500 and the two
    // would differ for a reason that has nothing to do with this change.
    const prefixed = memFacts(build([0x3e, 0xa0, 0x00, 0x05, 0xf4]), 2);   // DS: mov al,[0500]

    assert.equal(plain.length, 1, `unprefixed produced ${plain.length} facts, expected 1`);
    assert.equal(prefixed.length, 1,
        `the CS-prefixed form produced ${prefixed.length} facts, expected 1 -- ` +
        'the prefix loop is still publishing its fetches');
    assert.equal(prefixed[0].direction, plain[0].direction);
    assert.equal(prefixed[0].address, plain[0].address);
});

test('the bus still sees the fetches, which is what makes this safe', () => {
    // The facts are suppressed for OBSERVERS, not for the machine. A read side
    // effect on a memory-mapped window must still fire; this asserts the bytes
    // still travel, by counting them underneath.
    const machine = build([0xa0, 0x00, 0x05, 0xf4]);
    let reads = 0;
    const original = machine.cpu.read;
    machine.cpu.read = a => { reads++; return original.call(machine.cpu, a); };
    machine.cpu.fetch = machine.cpu.read;      // as the default binding has it
    machine.step();
    assert.ok(reads >= 4,
        `only ${reads} bus reads for a 3-byte instruction plus its operand; ` +
        'suppressing the FACT must not suppress the access');
});
