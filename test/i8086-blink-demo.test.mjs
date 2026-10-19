// The BLINK board — the smallest 8086 that is about PINS: an 8086, RAM, an 8255,
// nothing else. It is what lite's LED panel (8255 output pins), switch panel
// (setInput drives a bit) and pseudocode pin I/O point at, and the minimal-GPIO
// board the Z80 and 6502 tiers had while the 8086 did not. The demo walks a bit
// across the LEDs on PORT B and mirrors an active-low switch from PORT C.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, BLINK8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'blink-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

function boot(switches = 0xff) {
    const m = new I8086Machine(BLINK8086);
    m.loadRom(demo);
    m.reset();
    m.chips.ppi1.setInputPort('c', switches);   // switches are active-low; 0xff = all open
    for (let i = 0; i < 2000; i++) m.step();
    return m;
}
function ledsOverTime(m, samples = 40) {
    const seen = new Set();
    for (let k = 0; k < samples; k++) { for (let i = 0; i < 3000; i++) m.step(); seen.add(m._in(0x61) & 0xff); }
    return seen;
}

test('the board is the minimal GPIO 8086 — an 8255 and nothing else', () => {
    const m = new I8086Machine(BLINK8086);
    assert.deepEqual(Object.keys(m.chips), ['ppi1']);
    assert.ok(!BLINK8086.regions.some((r) => r.start === 0xb8000), 'no CGA text page');
    assert.ok(!BLINK8086.chips.some((c) => c.kind === 'cga' || c.kind === 'fdc' || c.kind === 'pic'),
        'no CGA, no floppy, no PIC — nothing that is not the lesson');
});

test('the ROM configures the 8255: port B output (LEDs), port C input (switches)', () => {
    const m = boot();
    const ppi = m.chips.ppi1;
    assert.equal(ppi.dirB & 0xff, 0xff, 'port B is all output — a pin here drives an LED');
    assert.equal(ppi.dirC & 0xff, 0x00, 'port C is all input — a pin here reads a switch');
});

test('the LEDs on PORT B walk a single bit across all eight positions', () => {
    const seen = ledsOverTime(boot(0xff));   // all switches open -> LEDs = the walking bit
    for (const bit of [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]) {
        assert.ok(seen.has(bit), `LED position 0x${bit.toString(16)} lit during the walk`);
    }
});

test('a CLOSED switch (active low) mirrors onto its LED through the walk', () => {
    // Close switch bit 2 -> port C bit 2 low -> LED 2 stays lit at every step.
    const seen = ledsOverTime(boot(0xfb), 24);
    assert.ok([...seen].every((v) => v & 0x04), 'bit 2 is set in every LED value while the switch is closed');
    // And an open switch does NOT force its LED on: bit 5 is only the walking bit.
    assert.ok([...seen].some((v) => !(v & 0x20)), 'bit 5 (an open switch) is dark except when the walk reaches it');
});

test('the LEDs are on port B, not port A — port A stays clear of the keyboard question', () => {
    // A learner's first board must not drive LEDs on the port a PC latches the
    // keyboard scancode into. The ROM never writes port A.
    const m = boot();
    assert.equal(m.chips.ppi1.dirA & 0xff, 0xff, 'port A configured output by the mode word but never driven with LED data');
    // Nothing meaningful was written to port A (outA stays 0), while port B carries the pattern.
    assert.equal(m.chips.ppi1.outA & 0xff, 0x00, 'the demo left port A alone');
});
