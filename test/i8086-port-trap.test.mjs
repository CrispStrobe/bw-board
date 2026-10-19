// E6.8.3 (machine half) — the port-access and interrupt traps. The machine fires
// hooks.onPortAccess({dir,port,value}) on every IN and OUT, and
// hooks.onInterrupt({vector,source}) for the interrupts IT delivers (IRQ, NMI),
// so the debugger can break on "anything touches port 61h" and on "IRQ0 fired".
// The debugger surface (i8086-debug.js capabilities/setBreakpoint) is lego-a4's
// half; these are the hooks it hangs on. A software INT n (source 'int') executes
// inside the core and is emitted there, not here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, KBDDEMO8086, TIMERDEMO8086, PCXT8086 } from '../src/i8086-machine.js';

test('onPortAccess fires on OUT with an event object carrying the written value', () => {
    const hits = [];
    const m = new I8086Machine(PCXT8086);
    m.hooks.onPortAccess = (ev) => hits.push(ev);
    m._out(0x3d8, 0x29);
    assert.deepEqual(hits.at(-1), { dir: 'out', port: 0x3d8, value: 0x29 });
});

test('onPortAccess fires on IN with the value the program actually reads', () => {
    const hits = [];
    const m = new I8086Machine(PCXT8086);
    m.hooks.onPortAccess = (ev) => hits.push(ev);
    const got = m._in(0x3da);                 // CGA status — a live value
    assert.equal(hits.at(-1).dir, 'in');
    assert.equal(hits.at(-1).port, 0x3da);
    assert.equal(hits.at(-1).value, got, 'the hook reports exactly what the IN returned');
});

test('it fires on UNDECODED ports too — the program made the access even if nothing answered', () => {
    const hits = [];
    const m = new I8086Machine(PCXT8086);
    m.hooks.onPortAccess = (ev) => hits.push(ev);
    m._out(0x0999, 0x55);
    m._in(0x0999);
    assert.deepEqual(hits, [
        { dir: 'out', port: 0x999, value: 0x55 },
        { dir: 'in', port: 0x999, value: 0xff },   // open bus reads high
    ]);
});

test('onInterrupt fires for a delivered IRQ with source "irq" and the resolved vector', () => {
    const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'keyboard-demo.bin');
    const m = new I8086Machine(KBDDEMO8086);
    m.loadRom(new Uint8Array(readFileSync(romPath)));
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();   // reach the idle HLT, PIC unmasked
    const ints = [];
    m.hooks.onInterrupt = (ev) => ints.push(ev);
    m.keyIn(0x1e);                             // raises IRQ1
    for (let i = 0; i < 400; i++) m.step();
    assert.ok(ints.some((e) => e.source === 'irq' && e.vector === 9),
        'IRQ1 delivered as vector 9 with source "irq"');
});

test('onInterrupt fires for an NMI with source "nmi", vector 2, ignoring IF', () => {
    const m = new I8086Machine(TIMERDEMO8086);
    m.loadRom((() => { const r = new Uint8Array(0x8000); r.set([0xfa, 0xf4], 0); // cli ; hlt
        r.set([0xea, 0x00, 0x00, 0x00, 0xf8], 0x7ff0); return r; })());
    m.reset();
    m.step();                                  // execute the far jump / land at cli;hlt
    const ints = [];
    m.hooks.onInterrupt = (ev) => ints.push(ev);
    m.nmi();
    m.step();
    assert.deepEqual(ints.at(-1), { vector: 2, source: 'nmi' });
});

test('the port trap does not disturb the keyboard-ack side effect on port B', () => {
    const m = new I8086Machine(KBDDEMO8086);
    let count = 0;
    m.hooks.onPortAccess = () => { count++; };
    m.keyIn(0x1e);
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'IRQ1 asserted');
    m._out(0x61, 0x80);                        // ack strobe — the trap must not swallow it
    assert.equal(m.chips.pic1.irr & 0x02, 0, 'IRQ1 cleared by the strobe, trap notwithstanding');
    assert.ok(count > 0, 'and the trap still saw the accesses');
});

test('no hooks set = no cost and no crash', () => {
    const m = new I8086Machine(PCXT8086);
    assert.doesNotThrow(() => { m._out(0x61, 0x03); m._in(0x3da); m.nmi(); m.step(); });
});
