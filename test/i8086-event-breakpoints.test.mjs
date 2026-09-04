/**
 * E6.8.3 — breakpoints on I/O ports and on interrupts.
 *
 * The machine side (`machine.hooks.onPortAccess` / `.onInterrupt`) is the
 * support-chip lane's; the software-INT emit sites in the core and everything
 * here is mine. The split matters to one test below: a SOFTWARE `int 21h` and
 * a DELIVERED IRQ must arrive as different `source` values, because the core
 * emits one and the machine emits the other, and the two paths meet in a
 * single funnel (`_interrupt`) where emitting would double-fire.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine } from '../src/i8086-machine.js';
import { createI8086DebugTarget } from '../src/i8086-debug.js';

/** A machine with a PPI at port 60h, so IN and OUT reach something real. */
const build = (prog, at = 0) => {
    const machine = new I8086Machine({
        clockHz: 5_000_000,
        regions: [{ kind: 'ram', start: 0, end: 0xfffff }],
        chips: [{ kind: 'ppi', name: 'ppi', at: 0x60 }],
    });
    machine.mem.set(prog, at);
    machine.cpu.cs = 0; machine.cpu.ip = at;
    machine.cpu.ds = 0; machine.cpu.es = 0; machine.cpu.ss = 0; machine.cpu.sp = 0x2000;
    const t = createI8086DebugTarget({ machine });
    return { machine, t };
};

test('the target declares the new kinds', () => {
    const { t } = build([0x90]);
    const kinds = t.capabilities().breakpoints;
    assert.deepEqual(kinds, ['code', 'write', 'port', 'int']);
});

test('a port breakpoint stops on the access, and reports what crossed the bus', () => {
    // mov al,55h ; out 60h,al ; hlt
    const { t } = build([0xb0, 0x55, 0xe6, 0x60, 0xf4]);
    const halts = [];
    t.onHalt((info) => halts.push(info));
    const id = t.setBreakpoint({ kind: 'port', port: 0x60 });
    assert.equal(typeof id, 'number');
    t.run(); t.runFor(1_000_000);
    assert.equal(t.state(), 'halted');
    // The VALUE is the point. A port breakpoint that only said "something
    // touched 60h" would leave the user to guess the one fact they stopped
    // to see, and on an `in` it is a fact only the device can supply.
    assert.equal(halts.length, 1);
    assert.equal(halts[0].cause, 'port');
    assert.equal(halts[0].bp, id);
    assert.equal(halts[0].port, 0x60);
    assert.equal(halts[0].dir, 'out');
    assert.equal(halts[0].value, 0x55, 'the byte that actually crossed the bus');
});

test('direction filters, and an absent direction means either', () => {
    // in al,60h ; out 60h,al ; hlt  -- one IN then one OUT to the same port.
    const prog = [0xe4, 0x60, 0xe6, 0x60, 0xf4];

    // Watching only 'out' must NOT stop on the IN that comes first.
    const a = build(prog);
    a.t.setBreakpoint({ kind: 'port', port: 0x60, dir: 'out' });
    a.t.run(); a.t.runFor(1_000_000);
    assert.equal(a.t.state(), 'halted');
    assert.ok(a.machine.cpu.ip > 2, 'it ran past the IN and stopped on the OUT');

    // Watching either stops on the IN, which is first.
    const b = build(prog);
    b.t.setBreakpoint({ kind: 'port', port: 0x60 });
    b.t.run(); b.t.runFor(1_000_000);
    assert.equal(b.t.state(), 'halted');
    assert.equal(b.machine.cpu.ip, 2, 'stopped immediately after the IN');
});

test('a different port is not watched', () => {
    // out 61h,al ; hlt -- the speaker port, while we watch the PPI's 60h.
    const { t, machine } = build([0xe6, 0x61, 0xf4]);
    t.setBreakpoint({ kind: 'port', port: 0x60 });
    t.run(); t.runFor(1_000_000);
    assert.ok(machine.cpu.halted, 'it ran to the HLT rather than stopping');
});

test('a software INT is source "int" and a fault is source "exception"', () => {
    const seen = [];
    // int 21h ; hlt   -- with a real IVT entry so the CPU has somewhere to go.
    const { t, machine } = build([0xcd, 0x21, 0xf4]);
    machine.mem[0x21 * 4] = 0x02; machine.mem[0x21 * 4 + 1] = 0x00;   // -> 0000:0002 (the hlt)
    machine.hooks.onInterrupt = (ev) => seen.push(ev);
    machine.step();
    assert.deepEqual(seen, [{ vector: 0x21, source: 'int' }]);

    // A divide fault raises vector 0 and must NOT look like a program INT.
    const seen2 = [];
    const d = build([0xb8, 0x01, 0x00, 0xbb, 0x00, 0x00, 0xf7, 0xf3, 0xf4]); // mov ax,1; mov bx,0; div bx
    d.machine.hooks.onInterrupt = (ev) => seen2.push(ev);
    for (let i = 0; i < 3; i++) d.machine.step();
    assert.equal(seen2.length, 1, 'exactly one event');
    assert.equal(seen2[0].vector, 0);
    assert.equal(seen2[0].source, 'exception',
        'a divide fault is not a program INT — different question, different answer');
});

test('THE DOUBLE-FIRE TRAP: a delivered interrupt emits ONCE, as irq', () => {
    // The core's public interrupt() routes through the SAME _interrupt()
    // funnel the opcode handlers use. Emitting from that funnel would report
    // every hardware IRQ twice -- once as 'irq' from the machine and once as
    // 'int' from the core -- and "break on INT 21h" would start tripping on
    // the timer tick. This is the test that keeps the emit sites where they
    // are.
    const { machine } = build([0xf4]);
    const seen = [];
    machine.hooks.onInterrupt = (ev) => seen.push(ev);
    machine.cpu.interrupt(8);                       // as hardware delivery does
    assert.equal(seen.length, 0,
        'the CORE must not emit for a delivered interrupt — the machine does that');
});

test('an interrupt breakpoint filters by vector and by source', () => {
    const { t, machine } = build([0xcd, 0x21, 0xf4]);
    machine.mem[0x21 * 4] = 0x02; machine.mem[0x21 * 4 + 1] = 0x00;
    t.setBreakpoint({ kind: 'int', vector: 0x21, source: 'int' });
    t.run(); t.runFor(1_000_000);
    assert.equal(t.state(), 'halted', 'stopped on int 21h');

    // A watch on a DIFFERENT vector does not fire.
    const b = build([0xcd, 0x21, 0xf4]);
    b.machine.mem[0x21 * 4] = 0x02; b.machine.mem[0x21 * 4 + 1] = 0x00;
    b.t.setBreakpoint({ kind: 'int', vector: 0x10 });
    b.t.run(); b.t.runFor(1_000_000);
    assert.ok(b.machine.cpu.halted, 'ran to the HLT instead');
});

test('the refusals name what was wrong', () => {
    const { t } = build([0x90]);
    assert.match(t.setBreakpoint({ kind: 'port' }).unsupported, /port required/);
    assert.match(t.setBreakpoint({ kind: 'port', port: 1, dir: 'sideways' }).unsupported, /'in', 'out'/);
    assert.match(t.setBreakpoint({ kind: 'int', source: 'vibes' }).unsupported, /source must be one of/);
    assert.match(t.setBreakpoint({ kind: 'nonsense' }).unsupported, /unknown breakpoint kind/);
});

test('clearing a port or interrupt breakpoint detaches the hook', () => {
    const { t, machine } = build([0xe6, 0x60, 0xf4]);
    const id = t.setBreakpoint({ kind: 'port', port: 0x60 });
    assert.ok(machine.hooks.onPortAccess, 'attached while watched');
    t.clearBreakpoint(id);
    assert.equal(machine.hooks.onPortAccess, null,
        'and detached again, so an unwatched machine pays nothing');
    t.run(); t.runFor(1_000_000);
    assert.ok(machine.cpu.halted, 'and it no longer stops');
});
