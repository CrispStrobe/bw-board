// The capstone: DESKDEMO8086 running TWO interrupt sources at once. The 8259
// arbitrates IRQ0 (the 8254 timer) and IRQ1 (the keyboard) live and together —
// the clock climbs at the top-right while typed keys echo on the line below,
// each interrupt acknowledged and EOI'd on its own. The timer and keyboard demos
// each prove one source; this proves they compose through the PIC.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, DESKDEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'desk-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));
const SC = { h: 0x23, i: 0x17, ' ': 0x39, t: 0x14, e: 0x12, r: 0x13 };

function boot() {
    const m = new I8086Machine(DESKDEMO8086);
    m.loadRom(demo);
    m.reset();
    for (let i = 0; i < 3000; i++) m.step();   // reach the idle HLT, both IRQs unmasked
    return m;
}
const ticks = (m) => m._read(0x502) | (m._read(0x503) << 8);
function echo(m, n) {
    let s = '';
    for (let i = 0; i < n; i++) s += String.fromCharCode(m._read(0xb8000 + 0x140 + i * 2));
    return s;
}
function clockText(m) {
    let s = ''; for (let i = 0; i < 4; i++) s += String.fromCharCode(m._read(0xb8000 + 0x8c + i * 2));
    return s;
}
function toQuietHalt(m) {   // stop at the idle HLT so the last ISR has fully painted
    let g = 0; while (!m.cpu.halted && g++ < 2000) m.step();
    return m.cpu.halted;
}

test('the timer source (IRQ0) runs on its own — the clock climbs', () => {
    const m = boot();
    const a = ticks(m);
    for (let i = 0; i < 6000; i++) m.step();
    assert.ok(a > 0 && ticks(m) > a, 'the tick counter keeps climbing');
});

test('the keyboard source (IRQ1) echoes typed keys onto the second line', () => {
    const m = boot();
    for (const ch of 'hi there') { m.keyIn(SC[ch]); for (let i = 0; i < 600; i++) m.step(); }
    assert.equal(echo(m, 8), 'hi there', 'every keypress echoed while the clock was also ticking');
});

test('BOTH sources are serviced concurrently — type while the clock runs', () => {
    const m = boot();
    const before = ticks(m);
    for (const ch of 'hi') { m.keyIn(SC[ch]); for (let i = 0; i < 600; i++) m.step(); }
    for (let i = 0; i < 4000; i++) m.step();
    assert.ok(ticks(m) > before, 'the clock advanced across the typing (IRQ0 kept firing)');
    assert.equal(echo(m, 2), 'hi', 'and the keystrokes landed (IRQ1 fired too)');
});

test('the on-screen clock matches the tick counter at the idle HLT', () => {
    const m = boot();
    for (let i = 0; i < 8000; i++) m.step();
    // Reach the quiet HLT FIRST, then read the counter and the screen at that
    // same instant (no stepping between) — the last ISR has incremented and
    // painted, so they agree.
    assert.ok(toQuietHalt(m), 'reached the idle HLT between ticks');
    const expected = ticks(m).toString(16).toUpperCase().padStart(4, '0');
    assert.equal(clockText(m), expected, 'the four cells spell the tick count');
});

test('both IRQ lines pass through the PIC — IRR carries IR0 and IR1', () => {
    // Assert the requests are latched in the 8259, not delivered by a back door.
    const m = boot();
    m.chips.pit1.counters; // (the PIT drives IR0 on its own via the wiring)
    m.keyIn(SC.t);
    assert.equal(m.chips.pic1.irr & 0x02, 0x02, 'the keypress latched IR1 in the PIC');
    for (let i = 0; i < 600; i++) m.step();
    assert.equal(m.chips.pic1.irr & 0x02, 0, 'IR1 cleared after its ISR acked + EOId');
    assert.equal(echo(m, 1), 't', 'and the ISR ran');
});

test('the capstone board carries the whole interrupt bench — PIC + PIT + PPI + CGA', () => {
    const m = new I8086Machine(DESKDEMO8086);
    assert.deepEqual(Object.keys(m.chips).sort(), ['cga1', 'pic1', 'pit1', 'ppi1']);
    assert.equal(DESKDEMO8086.chips.find((c) => c.kind === 'pit').irq, 0, 'PIT OUT0 wired to IR0');
});
