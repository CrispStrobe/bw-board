// THE ACCESS FACTS CARRY THE ADDRESS THE CORE USED, NOT ITS BOTTOM SIXTEEN BITS.
//
// installInstructionDebugEvents was written for cores whose memory space is 16
// bits, and hard-coded `address & 0xffff` at its memory recorders. `pcOf` was
// already a parameter, so a wide-address core could report its program counter
// correctly while every memory fact it produced was truncated.
//
// WHY THAT IS WORSE THAN AN OBVIOUS BUG: it is right for exactly the first 64K.
// On an 8086 the operands of a small test program sit under 64K and read
// perfectly, while the instruction fetches at 0xF8000 arrive as 0x8000 — so the
// first thing anyone checks looks correct, and the facts describing where the
// code actually lives are wrong. A consumer diffing two runs, or keying a cache
// on the address, gets collisions between ROM and RAM that never resolve.
//
// The I/O recorders keep their 16-bit mask deliberately: I/O space IS 16 bits on
// every core this module serves, so widening it would describe an address space
// that does not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { installInstructionDebugEvents } from '../src/instruction-debug-events.js';

// mov al,[0x0500] ; mov [0x0501],al — operands under 64K, fetches at 0xF8000.
const CODE = [0xa0, 0x00, 0x05, 0xa2, 0x01, 0x05];
const romWith = code => {
    const r = new Uint8Array(0x8000).fill(0x90);
    r.set(code, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    return r;
};
const run = opts => {
    const m = new I8086Machine(BREADBOARD8086, {});
    m.loadRom(romWith(CODE));
    m.reset();
    m.step();                       // consume the reset-vector jump
    m.mem[0x0500] = 0x5a;
    const facts = [];
    installInstructionDebugEvents({
        cpu: m.cpu, machine: m, cpuId: 'i8086', timeDomain: 'i8086-cycles',
        pcOf: c => c.pc & 0xfffff, ...opts
    }).onDebugEvent(f => facts.push(f));
    m.step();
    m.step();
    // The control every probe of this module needs: prove the subject ACTED and
    // that the stream is non-empty, before believing anything a filter says.
    assert.equal(m.mem[0x0501], 0x5a, 'the program did not run; nothing below means anything');
    assert.ok(facts.length > 0, 'no facts at all — the instrument, not the subject');
    const mem = facts.filter(f => f.phase === 'access' && f.memory);
    assert.ok(mem.length > 0, 'no MEMORY access facts — check the field, not the core');
    return mem.map(f => f.memory.address);
};

test('the default is unchanged: sixteen bits, as every current consumer gets today', () => {
    const addrs = run({});
    assert.ok(addrs.includes(0x8000),
        'a fetch at 0xF8000 arrives truncated under the default, which is what today does');
    assert.ok(addrs.every(a => a <= 0xffff), 'nothing above 16 bits escapes the default mask');
});

test('a 20-bit core can ask for its own width, and gets the address the core used', () => {
    const addrs = run({addressMask: 0xfffff});
    assert.ok(addrs.includes(0xf8000),
        'the fetch at 0xF8000 must arrive as 0xF8000, not 0x8000');
    assert.ok(addrs.includes(0x0500), 'the operand read under 64K is still itself');
    assert.equal(addrs.includes(0x8000), false,
        'and the truncated form must be GONE, not merely accompanied by the right one');
});

test('widening memory does not widen anything else that was already correct', () => {
    // The operands live under 64K, so they are identical either way. Asserting it
    // says the parameter is scoped to the wide addresses rather than rewriting
    // every fact it touches.
    const wide = run({addressMask: 0xfffff}).filter(a => a <= 0xffff);
    const narrow = run({}).filter(a => a <= 0xffff && a !== 0x8000 && a < 0x8000);
    for (const a of narrow) assert.ok(wide.includes(a), `address 0x${a.toString(16)} changed under the wider mask`);
});
