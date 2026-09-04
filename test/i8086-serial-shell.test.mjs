// The UART-shell example: the SERIALSHELL8086 preset booting the serial-
// monitor ROM into a banner-and-echo shell, end to end through the real core
// and 16550. This is the "boots when you open it" example, proven to reach a
// prompt and echo typed input the way the Circuit Designer's SerialConsole
// would show it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { I8086Machine, SERIALSHELL8086 } from '../src/i8086-machine.js';

const romPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'rom', 'serial-monitor.bin');
const monitor = new Uint8Array(readFileSync(romPath));

function bootShell() {
    const out = [];
    const m = new I8086Machine(SERIALSHELL8086, { onSerial: (b) => out.push(b & 0xff) });
    m.loadRom(monitor);
    m.reset();
    return { m, out, text: () => String.fromCharCode(...out) };
}

test('it boots itself and prints the shell banner', () => {
    const s = bootShell();
    for (let i = 0; i < 5000 && s.text().indexOf('> ') < 0; i++) s.m.step();
    assert.match(s.text(), /8086 serial shell/);
    assert.match(s.text(), /> $/);   // and it stops at the prompt, waiting for input
});

test('it echoes typed input back to the terminal', () => {
    const s = bootShell();
    for (let i = 0; i < 5000 && s.text().indexOf('> ') < 0; i++) s.m.step();
    const bannerLen = s.out.length;

    // Type "Hi!" — the machine's serialIn is the SerialConsole's sendSerial.
    for (const ch of 'Hi!') {
        s.m.serialIn(ch.charCodeAt(0));
        for (let i = 0; i < 2000; i++) s.m.step();
    }
    const echoed = String.fromCharCode(...s.out.slice(bannerLen));
    assert.equal(echoed, 'Hi!', 'each typed byte came back exactly once, in order');
});

test('the preset is a self-contained UART machine — one chip, no BIOS, no disk', () => {
    const m = new I8086Machine(SERIALSHELL8086);
    assert.deepEqual(Object.keys(m.chips), ['uart1']);
    const rom = SERIALSHELL8086.regions.find((r) => r.kind === 'rom');
    assert.ok(rom.start <= 0xffff0 && rom.end >= 0xfffff, 'ROM covers the reset vector');
});
