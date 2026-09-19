// The 80286 reaches PINS. The BLINK board is the minimal GPIO machine — an 8255
// and nothing else — and here it runs on the fast real-mode 80286 core (the one
// graded to zero SST286 real-mode fails), driven by the SAME rom/blink-demo.bin
// the 8086 tier uses. The demo is pure 186-compatible code (CLI/MOV/OUT/IN/NOT/
// OR/ROL/LOOP), so the 286 walks the LEDs on PORT B byte-for-byte identically:
// "an 80286 blinking an LED on a breadboard" is a picked target, not a fork.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, BLINK80286 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'blink-demo.bin');
const demo = new Uint8Array(readFileSync(romPath));

function boot(switches = 0xff) {
    const m = new I8086Machine(BLINK80286);
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

test('the blink board runs as a real 80286 — same board, 286 core', () => {
    const m = new I8086Machine(BLINK80286);
    assert.equal(m.variant, '80286', 'the machine is a 286');
    assert.equal(m.cpu._is286, true, 'the core reports itself a 286');
    assert.deepEqual(Object.keys(m.chips), ['ppi1'], 'an 8255 and nothing else — the minimal GPIO board');
});

test('the ROM configures the 8255 on the 286: port B output (LEDs), port C input (switches)', () => {
    const ppi = boot().chips.ppi1;
    assert.equal(ppi.dirB & 0xff, 0xff, 'port B is all output — a pin here drives an LED');
    assert.equal(ppi.dirC & 0xff, 0x00, 'port C is all input — a pin here reads a switch');
});

test('the 80286 walks a single bit across all eight LEDs on PORT B', () => {
    const seen = ledsOverTime(boot(0xff));   // all switches open -> LEDs = the walking bit
    for (const bit of [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80]) {
        assert.ok(seen.has(bit), `LED position 0x${bit.toString(16)} lit during the 286's walk`);
    }
});

test('a CLOSED switch (active low) mirrors onto its LED through the 286 walk', () => {
    // Close switch bit 2 -> port C bit 2 low -> LED 2 stays lit at every step.
    const seen = ledsOverTime(boot(0xfb), 24);
    assert.ok([...seen].every((v) => v & 0x04), 'bit 2 is set in every LED value while the switch is closed');
    assert.ok([...seen].some((v) => !(v & 0x20)), 'bit 5 (an open switch) is dark except when the walk reaches it');
});

test('the 286 blink is byte-identical to the 8086 blink — the core is the only difference', async () => {
    const { BLINK8086 } = await import('../src/i8086-machine.js');
    const ledSet = (config) => {
        const m = new I8086Machine(config);
        m.loadRom(demo); m.reset();
        m.chips.ppi1.setInputPort('c', 0xff);
        for (let i = 0; i < 2000; i++) m.step();
        return ledsOverTime(m);
    };
    assert.deepEqual([...ledSet(BLINK80286)].sort((a, b) => a - b),
        [...ledSet(BLINK8086)].sort((a, b) => a - b),
        'the 286 and the 8086 light the same LED pattern from the same ROM');
});
