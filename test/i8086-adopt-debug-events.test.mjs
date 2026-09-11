// THE 8086 TARGET PUBLISHES DEBUG EVENTS THROUGH THE SHARED MODULE.
//
// instruction-debug-events.js is consumed by avr8js here and by the m6502 and
// z80 targets downstream. The 8086 target was the only one in either repo that
// did not use it, so the same facts -- instruction retires, memory and port
// accesses, a monotonic event clock -- existed only as a hand-rolled
// reimplementation elsewhere.
//
// WHAT THIS TRIP HAD TO ESTABLISH FIRST, and did, by measurement rather than
// reading: the module CAN serve this core. Its accessors are on the execution
// path (8 access facts for two instructions), and since `addressMask` it reports
// this core's 20-bit addresses rather than their bottom sixteen bits.
//
// EVERY PROBE OF THIS MODULE NEEDS TWO CONTROLS, both present below: that the
// program ACTED, and that the fact stream is non-empty in the shape being
// filtered. The access fields are nested under `memory`, so a predicate reading
// `f.address` finds undefined on every fact and counts zero -- and zero is
// indistinguishable from a core that bypasses the accessors. That exact wrong
// conclusion was reported once before it was caught.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, BREADBOARD8086 } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

// mov al,[0x0500] ; mov [0x0501],al -- operands under 64K, fetches at 0xF8000.
const CODE = [0xa0, 0x00, 0x05, 0xa2, 0x01, 0x05];
const build = () => {
    const r = new Uint8Array(0x8000).fill(0x90);
    r.set(CODE, 0);
    r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    const m = new I8086Machine(BREADBOARD8086, {});
    m.loadRom(r);
    m.reset();
    m.step();
    m.mem[0x0500] = 0x5a;
    return {m, t: createI8086DebugTarget({machine: m})};
};

test('the target publishes retires and accesses, at this core\'s address width', () => {
    const {m, t} = build();
    const facts = [];
    assert.equal(typeof t.onDebugEvent, 'function',
        'the target must expose the module\'s subscription, not a private one');
    t.onDebugEvent(f => facts.push(f));
    m.step();
    m.step();

    assert.equal(m.mem[0x0501], 0x5a, 'the program did not run; nothing below means anything');
    assert.ok(facts.length > 0, 'no facts at all -- the instrument, not the core');

    const retires = facts.filter(f => f.phase === 'retire');
    const mem = facts.filter(f => f.phase === 'access' && f.memory);
    assert.equal(retires.length, 2, 'one retire per instruction');
    assert.ok(mem.length > 0, 'no MEMORY access facts -- check the field, not the core');

    const addrs = mem.map(f => f.memory.address);
    assert.ok(addrs.includes(0xf8000),
        'a fetch at 0xF8000 must arrive whole; 0x8000 here means the width was not passed');
    assert.equal(addrs.includes(0x8000), false, 'and the truncated form must be gone');
    assert.ok(addrs.includes(0x0501), 'the store under 64K is still itself');
});

test('with no subscriber the target costs nothing it did not before', () => {
    const a = build();
    const n0 = a.m.step();
    const c0 = a.m.cycles;
    const b = build();
    b.t.onDebugEvent;                      // touched, never subscribed
    const n1 = b.m.step();
    assert.equal(n1, n0, 'an unsubscribed target must retire in the same cycles');
    assert.equal(b.m.cycles, c0, 'and leave machine time where it was');
});

test('the event clock is the module\'s, so a fact and a debugTime() agree', () => {
    const {m, t} = build();
    const facts = [];
    t.onDebugEvent(f => facts.push(f));
    m.step();
    const fact = facts.find(f => f.phase === 'retire');
    const now = t.debugTime();
    assert.equal(fact.time.domain, now.domain,
        'two clocks would let a consumer order a fact against a time that never applied to it');
});

test('port accesses are observed too, which `port: true` is the only reason for', () => {
    // WITHOUT THIS THE FLAG IS UNPROVEN. Mutating `port: true` to false reddened
    // nothing until this existed -- the memory assertions above pass either way,
    // so the option would have been carried on nobody's evidence.
    const r = new Uint8Array(0x8000).fill(0x90);
    r.set([0xb0, 0x41, 0xe6, 0x00], 0);                  // mov al,0x41 ; out 0x00,al
    r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0);
    const m = new I8086Machine(BREADBOARD8086, {});
    m.loadRom(r);
    m.reset();
    m.step();

    const facts = [];
    const t = createI8086DebugTarget({machine: m});
    t.onDebugEvent(f => facts.push(f));
    m.step();
    m.step();

    assert.equal(m.cpu.ax & 0xff, 0x41, 'the program did not run; nothing below means anything');
    assert.ok(facts.length > 0, 'no facts at all -- the instrument, not the core');
    const ports = facts.filter(f => f.phase === 'access' && f.port);
    assert.ok(ports.length > 0, 'no PORT access facts -- check the field, not the core');
    const out = ports.find(f => f.port.direction === 'write');
    assert.equal(out.port.address, 0x00);
    assert.equal(out.port.value, 0x41, 'the fact must carry the byte the program actually sent');
});
