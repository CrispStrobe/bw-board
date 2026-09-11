// A WRITE FACT SAYS WHAT THE ADDRESS BECAME. IT DID NOT SAY WHAT IT WAS.
//
// "This address is now 5" and "this write changed something" are different
// claims, and a recorder that only makes the first cannot reconstruct a diff: a
// no-op write -- a program storing the value already there, which real code does
// constantly through read-modify-write and masked register updates -- is
// indistinguishable from a write that changed the machine.
//
// THE COST IS THE REASON THIS IS NOT FREE AND THE REASON IT IS GATED. Reading
// the prior value is an extra memory access per write, and this module's header
// carries a measured table precisely because per-access costs here are not
// hypothetical. It goes behind the same listener opt-in as the register and
// instruction samples: `accesses` is null unless a listener exists and an
// instruction bracket is open, so a machine nobody is watching pays nothing --
// asserted below by counting reads rather than by asserting it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { installInstructionDebugEvents } from '../src/instruction-debug-events.js';

// mov al,[0x0500] ; mov [0x0501],al
const CODE = [0xa0, 0x00, 0x05, 0xa2, 0x01, 0x05];
const build = () => {
    const r = new Uint8Array(0x8000).fill(0x90);
    r.set(CODE, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    const m = new I8086Machine(BREADBOARD8086, {});
    m.loadRom(r);
    m.reset();
    m.step();
    return m;
};
const install = (m, facts, opt = true) => {
    const d = installInstructionDebugEvents({
        cpu: m.cpu, machine: m, cpuId: 'i8086', timeDomain: 'i8086-cycles',
        addressMask: 0xfffff, pcOf: c => c.pc & 0xfffff, clock: () => m.cycles,
        captureWriteBefore: opt
    });
    if (facts) d.onDebugEvent(f => facts.push(f));
    return d;
};

test('a write fact carries the value that was there before it', () => {
    const m = build();
    m.mem[0x0500] = 0x5a;
    m.mem[0x0501] = 0x11;                 // a KNOWN prior value at the destination
    const facts = [];
    install(m, facts);
    m.step();
    m.step();

    assert.equal(m.mem[0x0501], 0x5a, 'the program did not run; nothing below means anything');
    assert.ok(facts.length > 0, 'no facts at all -- the instrument, not the core');
    const writes = facts.filter(f => f.phase === 'access' && f.memory?.direction === 'write');
    assert.ok(writes.length > 0, 'no write facts -- check the field, not the core');

    const store = writes.find(f => f.memory.address === 0x0501);
    assert.ok(store, 'the store to 0x0501 was not recorded');
    assert.equal(store.memory.value, 0x5a, 'the value written');
    assert.equal(store.memory.before, 0x11, 'the value that was there');
});

test('a no-op write is distinguishable from one that changed the machine', () => {
    // THE CLAIM THE FIELD EXISTS FOR. Without `before` both facts read
    // identically and a diff cannot be reconstructed from the stream.
    const m = build();
    m.mem[0x0500] = 0x5a;
    m.mem[0x0501] = 0x5a;                 // already what the program will store
    const facts = [];
    install(m, facts);
    m.step();
    m.step();

    const store = facts.filter(f => f.phase === 'access' && f.memory?.direction === 'write')
        .find(f => f.memory.address === 0x0501);
    assert.ok(store, 'the store was not recorded');
    assert.equal(store.memory.before, store.memory.value,
        'a no-op write must show before === value, which is what makes it a no-op');
});

test('with NO listener the prior value is never read', () => {
    // The cost claim, counted rather than asserted. The counter is installed
    // BEFORE the module, so the module's wrapper sits above it and every read
    // the module performs passes through here.
    const m = build();
    let reads = 0;
    const original = m.cpu.read;
    m.cpu.read = a => { reads++; return original.call(m.cpu, a); };

    install(m, null);                      // installed, but nobody subscribed
    const before = reads;
    m.cpu.write(0x0501, 0x99);
    assert.equal(reads, before,
        `an unwatched write performed ${reads - before} read(s); the sample must be behind the opt-in`);
    assert.equal(m.mem[0x0501], 0x99, 'and the write itself must still happen');
});
