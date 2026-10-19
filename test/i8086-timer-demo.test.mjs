// The interrupt example: the TIMERDEMO8086 preset booting the timer-demo ROM,
// end to end through the real core, 8259 and 8254. This is the one example that
// proves the tier DELIVERS and SERVICES interrupts while the CPU runs: the ROM
// hooks INT 8 and the on-screen counter only climbs if 8254 OUT0 -> 8259 IR0 ->
// CPU INT 8 -> the ISR -> B800 -> EOI all actually happen, tick after tick.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, TIMERDEMO8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'timer-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

function boot() {
    const m = new I8086Machine(TIMERDEMO8086);
    m.loadRom(demo);
    m.reset();
    return m;
}
/** The four hex digits the ISR paints at the counter cell (B800 offset 0x8C). */
function screenHex(m) {
    let s = '';
    for (let i = 0; i < 4; i++) s += String.fromCharCode(m._read(0xb8000 + 0x8c + i * 2));
    return s;
}
const ramCounter = (m) => m._read(0x500) | (m._read(0x501) << 8);

test('the timer ISR runs: the RAM counter and the on-screen counter both climb', () => {
    const m = boot();
    for (let i = 0; i < 4000; i++) m.step();
    const early = ramCounter(m);
    for (let i = 0; i < 8000; i++) m.step();
    const later = ramCounter(m);
    assert.ok(early > 0, 'the ISR fired at least once in the first slice');
    assert.ok(later > early, 'and keeps firing — the tick is repeating, not a one-shot');
});

test('the on-screen hex digits track the RAM counter the ISR maintains', () => {
    const m = boot();
    for (let i = 0; i < 12000; i++) m.step();
    // Sample at a quiet point: the ROM's main loop is `hlt; jmp main`, so once
    // the CPU is halted the last ISR has fully returned and painted. Sampling
    // mid-ISR (counter incremented, screen not yet repainted) would be a 1-off.
    let guard = 0;
    while (!m.cpu.halted && guard++ < 2000) m.step();
    assert.ok(m.cpu.halted, 'reached the idle HLT between ticks');
    const expected = ramCounter(m).toString(16).toUpperCase().padStart(4, '0');
    assert.equal(screenHex(m), expected, 'the four cells at B800 spell the counter value');
});

test('nothing ticks with interrupts masked — the climb is the PIC path, not a side effect', () => {
    // Prove the counter only moves because the interrupt is actually delivered:
    // hold the CPU with IF clear (never let the ROM run its STI) by clearing it
    // every step, and the ISR must never run.
    const m = boot();
    for (let i = 0; i < 12000; i++) { m.cpu.flags &= ~0x200; m.step(); }
    assert.equal(ramCounter(m), 0, 'IF clear -> the maskable timer interrupt is never taken');
});

test('the preset is a self-contained interrupt machine — PIC + PIT + CGA, no BIOS', () => {
    const m = new I8086Machine(TIMERDEMO8086);
    assert.deepEqual(Object.keys(m.chips).sort(), ['cga1', 'pic1', 'pit1']);
    const rom = TIMERDEMO8086.regions.find((r) => r.kind === 'rom');
    assert.ok(rom.start <= 0xffff0 && rom.end >= 0xfffff, 'ROM covers the reset vector');
    assert.ok(TIMERDEMO8086.chips.find((c) => c.kind === 'pit').irq === 0, 'PIT OUT0 is wired to IR0');
});
