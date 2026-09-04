// E6.8.3 (machine half) — the port-access trap. The machine fires
// hooks.onPortAccess(dir, port, value) on every IN and OUT, so the debugger can
// break on "anything touches port 61h" — the breakpoint a workbench whose whole
// premise is "you wired this 8255 yourself" actually wants. The debugger surface
// (i8086-debug.js breakpoints) is the DOS/host lane's half; this is the hook it
// hangs on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { I8086Machine, KBDDEMO8086, PCXT8086 } from '../src/i8086-machine.js';

test('onPortAccess fires on OUT with direction, port and the written value', () => {
    const hits = [];
    const m = new I8086Machine(PCXT8086);
    m.hooks.onPortAccess = (dir, port, val) => hits.push({ dir, port, val });
    m._out(0x3d8, 0x29);
    assert.deepEqual(hits.at(-1), { dir: 'out', port: 0x3d8, val: 0x29 });
});

test('onPortAccess fires on IN with the value the program actually reads', () => {
    const hits = [];
    const m = new I8086Machine(PCXT8086);
    m.hooks.onPortAccess = (dir, port, val) => hits.push({ dir, port, val });
    const got = m._in(0x3da);                 // CGA status — a live value
    assert.equal(hits.at(-1).dir, 'in');
    assert.equal(hits.at(-1).port, 0x3da);
    assert.equal(hits.at(-1).val, got, 'the hook reports exactly what the IN returned');
});

test('it fires on UNDECODED ports too — the program made the access even if nothing answered', () => {
    const hits = [];
    const m = new I8086Machine(PCXT8086);
    m.hooks.onPortAccess = (dir, port, val) => hits.push({ dir, port, val });
    m._out(0x0999, 0x55);
    m._in(0x0999);
    assert.deepEqual(hits, [
        { dir: 'out', port: 0x999, val: 0x55 },
        { dir: 'in', port: 0x999, val: 0xff },   // open bus reads high
    ]);
});

test('the trap does not disturb the keyboard-ack side effect on port B', () => {
    const m = new I8086Machine(KBDDEMO8086);
    let count = 0;
    m.hooks.onPortAccess = () => { count++; };
    m.keyIn(0x1e);
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'IRQ1 asserted');
    m._out(0x61, 0x80);                        // ack strobe — the trap must not swallow it
    assert.equal(m.chips.pic1.irr & 0x02, 0, 'IRQ1 cleared by the strobe, trap notwithstanding');
    assert.ok(count > 0, 'and the trap still saw the accesses');
});

test('no hook set = no cost and no crash', () => {
    const m = new I8086Machine(PCXT8086);
    assert.doesNotThrow(() => { m._out(0x61, 0x03); m._in(0x3da); });
});
